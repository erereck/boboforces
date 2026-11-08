// Os 2 arrays de textura na GPU (tecnico.md §6.1, item 4 do Teste Zero): `TEXTURE_2D_ARRAY` RGBA8 com a cadeia de mips
// enviada nível a nível (rota padrão) ou atlas 2D com padding (plano B, `#define ATLAS`): 2 níveis nos blocos e 3 nos
// modelos (`ATLAS_MAX_MIP_LEVELS`).
//
// Por que GL direto e `ExternalTexture`: o `DataArrayTexture` do three r187 só envia o nível 0 (os mips do texgen, com
// cobertura de alfa, se perderiam) e troca o filtro só recriando a textura. Aqui o render cria a textura com
// `texStorage3D`/`texStorage2D`, envia cada nível com `texSubImage*`, troca o filtro com `texParameteri` e reescreve
// camadas (skins compostas, 4 por skin) sem reenviar o resto. Toda ligação passa por `three.state` (o cache de estado do
// three fica certo) e o three só vê um `ExternalTexture` apontando para o objeto GL. Perda de contexto: o three troca o
// `properties` no restore; `sync()` percebe e reenvia tudo a partir das cópias da CPU.
import { TEXTURE_ARRAYS, type TextureArrayName } from '@boboforces/format';
import { ExternalTexture, type WebGLRenderer } from 'three';
import { ATLAS_MAX_MIP_LEVELS, ATLAS_PADDING } from './shared/glsl-common.ts';
import type { SharedTextures } from './shared/passes.ts';
import {
  arrayBytes,
  atlasBytes,
  atlasCellRect,
  atlasLayout,
  buildAtlasLevels,
  completeMipChain,
  modelLayerCount,
  writeAtlasCell,
  writeLayerRange,
  type AtlasLayout,
  type AtlasWrap,
  type MinFilterMode,
} from './texture-gpu-data.ts';
import type { AssembledTextureArray, RenderTextures, TextureMode } from './types.ts';

/** `SharedTextures` com o `assets` gravável (só a render-mundo escreve). */
export type MutableSharedTextures = { -readonly [K in keyof SharedTextures]: SharedTextures[K] };

interface GpuArray {
  readonly name: TextureArrayName;
  readonly size: number;
  readonly layers: number;
  /** Cadeia completa na CPU (os níveis que vieram da tira são as MESMAS referências de `assets`). */
  readonly levels: Uint8Array[];
  readonly wrap: AtlasWrap;
  readonly layout: AtlasLayout | null;
  readonly external: ExternalTexture;
  texture: WebGLTexture | null;
  readonly bytes: number;
}

export interface GpuTextures {
  /** Sobe os 2 arrays (rota da criação) e liga os uniforms; `null` libera. */
  set(textures: RenderTextures | null): void;
  /**
   * Reescreve k camadas reservadas SEGUIDAS de `modelos64` (`Renderer.writeModelLayer`): cadeia da CPU (nível 0, nível 1
   * dado ou reduzido, os seguintes com cobertura de alfa) e GPU, uma camada por chamada.
   */
  writeModelLayer(firstLayer: number, rgba: Uint8Array, level1?: Uint8Array): void;
  setMinFilter(mode: MinFilterMode): void;
  /** Reenvia tudo se o contexto foi restaurado (compara o `properties` do three; custo de uma comparação). */
  sync(): void;
  /** Bytes enviados (todos os níveis dos 2 arrays). */
  readonly bytes: number;
  dispose(): void;
}

function minFilterOf(gl: WebGL2RenderingContext, mode: MinFilterMode): number {
  if (mode === 'linear') return gl.LINEAR_MIPMAP_LINEAR;
  if (mode === 'off') return gl.NEAREST;
  return gl.NEAREST_MIPMAP_LINEAR;
}

export function createGpuTextures(three: WebGLRenderer, mode: TextureMode, shared: MutableSharedTextures): GpuTextures {
  const gl = three.getContext() as WebGL2RenderingContext;
  let blocks: GpuArray | null = null;
  let models: GpuArray | null = null;
  let minMode: MinFilterMode = 'nearest';
  let knownProperties: unknown = three.properties;
  /** Rascunho de uma célula do atlas (o nível 0 é o maior): reaproveitado entre camadas e skins. */
  let cellScratch = new Uint8Array(0);
  const blocksExternal = new ExternalTexture(null);
  blocksExternal.name = 'blocos16';
  const modelsExternal = new ExternalTexture(null);
  modelsExternal.name = 'modelos64';

  /** Estado de desempacotamento neutro (o three guarda o último valor em `state.pixelStorei`). */
  function unpackDefaults(): void {
    const state = three.state;
    state.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    state.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    state.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    state.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    state.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, 0);
    state.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    state.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    state.pixelStorei(gl.UNPACK_SKIP_IMAGES, 0);
  }

  function targetOf(a: GpuArray): number {
    return a.layout ? gl.TEXTURE_2D : gl.TEXTURE_2D_ARRAY;
  }

  function applyParams(a: GpuArray, levelCount: number): void {
    const target = targetOf(a);
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, minFilterOf(gl, minMode));
    // Rota array: REPEAT dentro da camada (blocos; o greedy repete a textura a cada 0,5 m) e CLAMP nos modelos (UV
    // dentro da camada). Atlas: CLAMP no atlas inteiro (a repetição é o `fract` do shader, o padding cobre o filtro).
    const wrap = a.layout || a.wrap === 'clamp' ? gl.CLAMP_TO_EDGE : gl.REPEAT;
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(target, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(target, gl.TEXTURE_BASE_LEVEL, 0);
    gl.texParameteri(target, gl.TEXTURE_MAX_LEVEL, levelCount - 1);
  }

  function upload(a: GpuArray): void {
    const texture = gl.createTexture();
    a.texture = texture;
    a.external.sourceTexture = texture;
    if (texture === null) return; // contexto perdido: o `sync` do restore reenvia
    const target = targetOf(a);
    three.state.bindTexture(target, texture);
    unpackDefaults();
    if (a.layout) {
      const levels = buildAtlasLevels(a.layout, a.levels, a.wrap);
      gl.texStorage2D(gl.TEXTURE_2D, levels.length, gl.RGBA8, a.layout.width, a.layout.height);
      for (let k = 0; k < levels.length; k++) {
        const w = a.layout.width >> k;
        const h = a.layout.height >> k;
        gl.texSubImage2D(gl.TEXTURE_2D, k, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, levels[k]!);
      }
      applyParams(a, levels.length);
    } else {
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, a.levels.length, gl.RGBA8, a.size, a.size, a.layers);
      for (let k = 0; k < a.levels.length; k++) {
        const side = Math.max(1, a.size >> k);
        gl.texSubImage3D(
          gl.TEXTURE_2D_ARRAY,
          k,
          0,
          0,
          0,
          side,
          side,
          a.layers,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          a.levels[k]!,
        );
      }
      applyParams(a, a.levels.length);
    }
  }

  /** Sobe UMA camada já escrita na CPU, todos os níveis (textura ligada e desempacotamento neutro). */
  function uploadLayer(a: GpuArray, layer: number): void {
    const layout = a.layout;
    if (layout) {
      // Atlas: a célula da camada (conteúdo + padding) em cada nível do atlas.
      const biggest = layout.cell * layout.cell * 4;
      if (cellScratch.length < biggest) cellScratch = new Uint8Array(biggest);
      for (let k = 0; k < layout.levels; k++) {
        const r = atlasCellRect(layout, layer, k);
        const cell = cellScratch.subarray(0, r.size * r.size * 4);
        writeAtlasCell(layout, layer, k, a.levels[k]!, a.wrap, cell, r.size, 0, 0);
        gl.texSubImage2D(gl.TEXTURE_2D, k, r.x, r.y, r.size, r.size, gl.RGBA, gl.UNSIGNED_BYTE, cell);
      }
      return;
    }
    // Array: profundidade 1 (o caminho provado no nx.js; profundidade k só depois de uma sonda no Eden e no console).
    for (let k = 0; k < a.levels.length; k++) {
      const side = Math.max(1, a.size >> k);
      const bytes = side * side * 4;
      const data = a.levels[k]!.subarray(layer * bytes, (layer + 1) * bytes);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, k, 0, 0, layer, side, side, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }
  }

  function release(a: GpuArray | null): void {
    if (!a) return;
    if (a.texture) gl.deleteTexture(a.texture);
    a.texture = null;
    a.external.sourceTexture = null;
  }

  function prepare(assembled: AssembledTextureArray, external: ExternalTexture, wrap: AtlasWrap): GpuArray {
    const name = assembled.name;
    const spec = TEXTURE_ARRAYS[name];
    const data = assembled.data;
    if (data.width !== spec.layerSize || data.height !== spec.layerSize) {
      throw new Error(`render: ${name} com camadas de ${data.width}×${data.height}, esperado ${spec.layerSize}`);
    }
    // Mips que a tira não trouxe são gerados aqui (com cobertura de alfa nas camadas cutout e nas reservadas).
    const levels = completeMipChain(data, spec.mipLevels, (layer) => {
      const info = assembled.info[layer];
      return info ? info.cutout || info.kind === 'cutout' : layer >= assembled.reservedStart;
    });
    const layout =
      mode === 'atlas'
        ? atlasLayout(data.layers, spec.layerSize, ATLAS_PADDING[name], ATLAS_MAX_MIP_LEVELS[name])
        : null;
    return {
      name,
      size: spec.layerSize,
      layers: data.layers,
      levels,
      wrap,
      layout,
      external,
      texture: null,
      bytes: layout ? atlasBytes(layout) : arrayBytes(spec.layerSize, data.layers, levels.length),
    };
  }

  function bindUniforms(): void {
    shared.blocks.value = blocks ? blocks.external : null;
    shared.models.value = models ? models.external : null;
    for (const [a, grid, size] of [
      [blocks, shared.blocksAtlas, shared.blocksAtlasSize],
      [models, shared.modelsAtlas, shared.modelsAtlasSize],
    ] as const) {
      const l = a?.layout;
      if (l) {
        grid.value.set(l.cols, l.rows, l.tile, l.padding);
        size.value.set(l.width, l.height);
      } else {
        // Rota array: os uniforms de atlas existem mas o shader não usa (valores inofensivos).
        grid.value.set(1, 1, a ? a.size : 1, 0);
        size.value.set(a ? a.size : 1, a ? a.size : 1);
      }
    }
  }

  /** O array montado com a cadeia COMPLETA da CPU em `data.levels` (o que subiu; os passes leem daqui). */
  function withChain(assembled: AssembledTextureArray, a: GpuArray): AssembledTextureArray {
    return { ...assembled, data: { ...assembled.data, levels: a.levels } };
  }

  return {
    set(textures: RenderTextures | null): void {
      release(blocks);
      release(models);
      blocks = null;
      models = null;
      shared.assets = null;
      if (textures) {
        if (textures.blocks.name !== 'blocos16' || textures.models.name !== 'modelos64') {
          throw new Error('render: setTextures espera { blocks: blocos16, models: modelos64 }');
        }
        blocks = prepare(textures.blocks, blocksExternal, 'repeat');
        models = prepare(textures.models, modelsExternal, 'clamp');
        shared.assets = { blocks: withChain(textures.blocks, blocks), models: withChain(textures.models, models) };
        upload(blocks);
        upload(models);
      }
      knownProperties = three.properties;
      bindUniforms();
    },

    writeModelLayer(firstLayer: number, rgba: Uint8Array, level1?: Uint8Array): void {
      const a = models;
      const assets = shared.assets?.models;
      if (!a || !assets) throw new Error('render: writeModelLayer antes do setTextures');
      const count = modelLayerCount(a.size, rgba.length, level1?.length);
      const start = assets.reservedStart;
      const end = start + assets.reservedCount;
      if (!Number.isInteger(firstLayer) || firstLayer < start || firstLayer + count > end) {
        throw new Error(
          `render: camadas ${firstLayer}..${firstLayer + count - 1} fora das reservadas (${start}..${end - 1})`,
        );
      }
      writeLayerRange(a.levels, a.size, firstLayer, rgba, level1);
      if (!a.texture) return;
      three.state.bindTexture(targetOf(a), a.texture);
      unpackDefaults();
      for (let layer = firstLayer; layer < firstLayer + count; layer++) uploadLayer(a, layer);
    },

    setMinFilter(next: MinFilterMode): void {
      if (next === minMode) return;
      minMode = next;
      for (const a of [blocks, models]) {
        if (!a?.texture) continue;
        const target = targetOf(a);
        three.state.bindTexture(target, a.texture);
        gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, minFilterOf(gl, minMode));
      }
    },

    sync(): void {
      if (three.properties === knownProperties) return;
      knownProperties = three.properties;
      if (typeof gl.isContextLost === 'function' && gl.isContextLost()) return;
      for (const a of [blocks, models]) {
        if (!a) continue;
        a.texture = null;
        upload(a);
      }
    },

    get bytes(): number {
      return (blocks?.bytes ?? 0) + (models?.bytes ?? 0);
    },

    dispose(): void {
      release(blocks);
      release(models);
      blocks = null;
      models = null;
      shared.assets = null;
      bindUniforms();
      blocksExternal.dispose();
      modelsExternal.dispose();
    },
  };
}
