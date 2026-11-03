import type { DrawList, UiAtlasImage } from '@boboforces/ui';
import {
  BufferAttribute,
  BufferGeometry,
  DataArrayTexture,
  DoubleSide,
  DynamicDrawUsage,
  GLSL3,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  LinearFilter,
  Mesh,
  NormalBlending,
  OrthographicCamera,
  RawShaderMaterial,
  RGBAFormat,
  Scene,
  UnsignedByteType,
  Vector2,
  type WebGLRenderer,
} from 'three';
import type { UiPass, UiTarget } from '../ui-pass.ts';
import { buildUiBatch, createUiBatch, UI_FLOATS_PER_VERTEX, type UiAtlasInfo } from './ui-batch.ts';
import { UI_FRAGMENT_SHADER, UI_VERTEX_SHADER } from './ui-shader.ts';

/**
 * Backend three da DrawList (tecnico.md §9), no formato da costura `UiPassFactory` do renderer: um
 * `RawShaderMaterial` GLSL3, uma malha de quads dinâmica e um `DataArrayTexture` com as fontes MSDF (e, no futuro, as
 * páginas de sprites). 1 draw call por viewport. Viewport e scissor já chegam aplicados pelo renderer.
 *
 * Uso: `createRenderer(surface, opts, (three) => (ui = createMsdfUiPass(three)))` e depois `ui.setAtlas(atlas)`.
 */

export interface MsdfUiPassStats {
  /** Draw calls e quads do último `draw()`. */
  drawCalls: number;
  quads: number;
  /** Vezes que o lote cresceu (alocação; deveria ficar em 0 depois do primeiro menu). */
  grows: number;
}

export interface MsdfUiPass extends UiPass {
  /** Troca o atlas (fontes + sprites); `null` libera e passa a desenhar só retângulos. */
  setAtlas(atlas: UiAtlasImage | null): void;
  readonly stats: Readonly<MsdfUiPassStats>;
}

function createIndex(quads: number): BufferAttribute {
  const indices = quads * 4 > 0xffff ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
  for (let q = 0; q < quads; q++) {
    const v = q * 4;
    const o = q * 6;
    indices[o] = v;
    indices[o + 1] = v + 2;
    indices[o + 2] = v + 1;
    indices[o + 3] = v + 1;
    indices[o + 4] = v + 2;
    indices[o + 5] = v + 3;
  }
  return new BufferAttribute(indices, 1);
}

export interface UpdateRange {
  start: number;
  count: number;
}

/**
 * Prende uma faixa de upload FIXA no buffer (regra 11, sem alocação por frame). No three, cada `addUpdateRange` cria
 * um objeto `{ start, count }` e o upload esvazia a lista (`clearUpdateRanges`), o que obriga a recriar tudo a cada
 * frame. Aqui a lista guarda sempre o mesmo objeto e o `clearUpdateRanges` desta instância não faz nada: por frame só
 * muda `range.count` (antes do `needsUpdate`). Resta o comparador do `sort` interno do three (1 closure por upload);
 * sem faixa nenhuma, o upload seria do buffer inteiro (196 KB para 1.024 quads).
 */
export function pinUpdateRange(
  target: { updateRanges: UpdateRange[]; clearUpdateRanges(): void },
  range: UpdateRange,
): void {
  target.updateRanges.length = 0;
  target.updateRanges.push(range);
  target.clearUpdateRanges = keepUpdateRanges;
}

function keepUpdateRanges(): void {}

/** Cria o passe de UI sobre o `WebGLRenderer` do render (mesmo contexto GL, mesmo cache de programas). */
export function createMsdfUiPass(three: WebGLRenderer, initialQuads = 1024): MsdfUiPass {
  const batch = createUiBatch(initialQuads);
  const viewSize = new Vector2(1, 1);
  const pxScale = { value: 1 };
  const emptyTexture = new DataArrayTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, 1);
  emptyTexture.needsUpdate = true;
  const material = new RawShaderMaterial({
    name: 'ui',
    glslVersion: GLSL3,
    vertexShader: UI_VERTEX_SHADER,
    fragmentShader: UI_FRAGMENT_SHADER,
    uniforms: { viewSize: { value: viewSize }, pxScale, atlas: { value: emptyTexture } },
    transparent: true,
    blending: NormalBlending,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
  });
  const atlasUniform = material.uniforms['atlas'] as { value: DataArrayTexture };
  const geometry = new BufferGeometry();
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  const scene = new Scene();
  scene.add(mesh);
  // O shader ignora as matrizes; o three só exige uma câmera.
  const camera = new OrthographicCamera();

  let geometryQuads = 0;
  // Faixas de upload fixas (ver `pinUpdateRange`): por frame só muda o `count`.
  const vertexRange: UpdateRange = { start: 0, count: 0 };
  const colorRange: UpdateRange = { start: 0, count: 0 };
  let vertexBuffer: InterleavedBuffer | null = null;
  let colorAttribute: BufferAttribute | null = null;
  let atlasInfo: UiAtlasInfo | null = null;
  let atlasTexture: DataArrayTexture | null = null;
  const stats: MsdfUiPassStats = { drawCalls: 0, quads: 0, grows: 0 };

  /** (Re)cria os buffers da GPU quando o lote cresce (raro: só quando a UI fica maior que tudo que já se viu). */
  function syncGeometry(): void {
    if (geometryQuads === batch.capacity && vertexBuffer && colorAttribute) return;
    // dispose antes de soltar os atributos: é ele que libera os buffers antigos na GPU.
    geometry.dispose();
    for (const name of ['position', 'uv', 'data0', 'data1', 'color']) geometry.deleteAttribute(name);
    vertexBuffer = new InterleavedBuffer(batch.vertices, UI_FLOATS_PER_VERTEX).setUsage(DynamicDrawUsage);
    pinUpdateRange(vertexBuffer, vertexRange);
    geometry.setAttribute('position', new InterleavedBufferAttribute(vertexBuffer, 2, 0));
    geometry.setAttribute('uv', new InterleavedBufferAttribute(vertexBuffer, 2, 2));
    geometry.setAttribute('data0', new InterleavedBufferAttribute(vertexBuffer, 4, 4));
    geometry.setAttribute('data1', new InterleavedBufferAttribute(vertexBuffer, 4, 8));
    colorAttribute = new BufferAttribute(batch.colors, 4, true).setUsage(DynamicDrawUsage);
    pinUpdateRange(colorAttribute, colorRange);
    geometry.setAttribute('color', colorAttribute);
    geometry.setIndex(createIndex(batch.capacity));
    geometryQuads = batch.capacity;
  }

  return {
    stats,

    setAtlas(atlas: UiAtlasImage | null): void {
      atlasTexture?.dispose();
      atlasTexture = null;
      atlasInfo = null;
      atlasUniform.value = emptyTexture;
      if (!atlas) return;
      if (atlas.pixels.length !== atlas.width * atlas.height * atlas.layers * 4) {
        throw new Error('render/ui: atlas com tamanho de pixels inconsistente');
      }
      atlasTexture = new DataArrayTexture(atlas.pixels, atlas.width, atlas.height, atlas.layers);
      atlasTexture.format = RGBAFormat;
      atlasTexture.type = UnsignedByteType;
      // MSDF: linear e sem mips (mip de campo de distância borra a borda).
      atlasTexture.minFilter = LinearFilter;
      atlasTexture.magFilter = LinearFilter;
      atlasTexture.generateMipmaps = false;
      atlasTexture.unpackAlignment = 1;
      atlasTexture.needsUpdate = true;
      atlasUniform.value = atlasTexture;
      atlasInfo = {
        width: atlas.width,
        height: atlas.height,
        layers: atlas.layers,
        msdfRanges: atlas.msdfRanges,
        spriteBase: atlas.spriteBase,
      };
    },

    draw(list: DrawList, target: UiTarget): void {
      stats.drawCalls = 0;
      const quads = buildUiBatch(list, atlasInfo, batch, target.scale);
      stats.quads = quads;
      stats.grows = batch.grows;
      if (quads === 0) return;
      syncGeometry();
      vertexRange.count = quads * 4 * UI_FLOATS_PER_VERTEX;
      (vertexBuffer as InterleavedBuffer).needsUpdate = true;
      colorRange.count = quads * 16;
      (colorAttribute as BufferAttribute).needsUpdate = true;
      geometry.setDrawRange(0, quads * 6);

      // A DrawList fala em px da superfície; o viewport (já aplicado) cobre o alvo inteiro.
      const scale = target.scale > 0 ? target.scale : 1;
      viewSize.set(
        list.width > 0 ? list.width : target.width / scale,
        list.height > 0 ? list.height : target.height / scale,
      );
      pxScale.value = scale;
      const autoClear = three.autoClear;
      three.autoClear = false;
      three.render(scene, camera);
      three.autoClear = autoClear;
      stats.drawCalls = 1;
    },

    dispose(): void {
      geometry.dispose();
      material.dispose();
      emptyTexture.dispose();
      atlasTexture?.dispose();
      atlasTexture = null;
      atlasInfo = null;
    },
  };
}
