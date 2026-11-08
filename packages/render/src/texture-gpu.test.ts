// O `texture-gpu.ts` contra um GL FALSO que guarda os bytes de cada nível (sem navegador): confere as chamadas da
// subida (profundidade 1 em laço, células do atlas) e que a GPU termina com os mesmos bytes da cadeia da CPU, nas duas
// rotas (array e atlas), também depois de um contexto restaurado.
import { Vector2, Vector4, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { ATLAS_MAX_MIP_LEVELS } from './shared/glsl-common.ts';
import { createGpuTextures, type MutableSharedTextures } from './texture-gpu.ts';
import { atlasCellRect, atlasLayout, buildAtlasLevels, levelBytes } from './texture-gpu-data.ts';
import type { AssembledTextureArray, RenderTextures, TextureMode } from './types.ts';

// Valores reais do WebGL2 (o código só compara com eles).
const GL = {
  TEXTURE_2D: 0x0de1,
  TEXTURE_2D_ARRAY: 0x8c1a,
  RGBA8: 0x8058,
  RGBA: 0x1908,
  UNSIGNED_BYTE: 0x1401,
  NEAREST: 0x2600,
  NEAREST_MIPMAP_LINEAR: 0x2702,
  LINEAR_MIPMAP_LINEAR: 0x2703,
  TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  REPEAT: 0x2901,
  CLAMP_TO_EDGE: 0x812f,
  TEXTURE_BASE_LEVEL: 0x813c,
  TEXTURE_MAX_LEVEL: 0x813d,
  UNPACK_FLIP_Y_WEBGL: 0x9240,
  UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
  UNPACK_ALIGNMENT: 0x0cf5,
  UNPACK_ROW_LENGTH: 0x0cf2,
  UNPACK_IMAGE_HEIGHT: 0x806e,
  UNPACK_SKIP_PIXELS: 0x0cf4,
  UNPACK_SKIP_ROWS: 0x0cf3,
  UNPACK_SKIP_IMAGES: 0x806d,
} as const;

interface FakeLevel {
  readonly w: number;
  readonly h: number;
  readonly d: number;
  readonly data: Uint8Array;
}

interface FakeTexture {
  readonly id: number;
  target: number;
  levels: FakeLevel[];
  readonly params: Map<number, number>;
  deleted: boolean;
}

interface Upload {
  readonly fn: 'texSubImage2D' | 'texSubImage3D';
  readonly texture: number;
  readonly level: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
  readonly h: number;
  readonly d: number;
}

function fakeRenderer() {
  const textures: FakeTexture[] = [];
  const uploads: Upload[] = [];
  let bound: FakeTexture | null = null;
  const current = (): FakeTexture => {
    if (!bound) throw new Error('nenhuma textura ligada');
    return bound;
  };
  const storage = (levels: number, w: number, h: number, d: number): FakeLevel[] =>
    Array.from({ length: levels }, (_, k) => {
      const lw = Math.max(1, w >> k);
      const lh = Math.max(1, h >> k);
      return { w: lw, h: lh, d, data: new Uint8Array(lw * lh * d * 4) };
    });
  const write = (
    level: FakeLevel,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    src: Uint8Array,
  ) => {
    expect(x + w <= level.w && y + h <= level.h && z + d <= level.d, 'subida fora da textura').toBe(true);
    expect(src.length).toBeGreaterThanOrEqual(w * h * d * 4);
    for (let zz = 0; zz < d; zz++) {
      for (let row = 0; row < h; row++) {
        const s = (zz * h + row) * w * 4;
        const o = (((z + zz) * level.h + y + row) * level.w + x) * 4;
        level.data.set(src.subarray(s, s + w * 4), o);
      }
    }
  };
  const gl = {
    ...GL,
    createTexture(): FakeTexture {
      const t: FakeTexture = { id: textures.length + 1, target: 0, levels: [], params: new Map(), deleted: false };
      textures.push(t);
      return t;
    },
    deleteTexture(t: FakeTexture): void {
      t.deleted = true;
    },
    texStorage2D(target: number, levels: number, _format: number, w: number, h: number): void {
      const t = current();
      t.target = target;
      t.levels = storage(levels, w, h, 1);
    },
    texStorage3D(target: number, levels: number, _format: number, w: number, h: number, d: number): void {
      const t = current();
      t.target = target;
      t.levels = storage(levels, w, h, d);
    },
    texSubImage2D(_t: number, level: number, x: number, y: number, w: number, h: number, ...rest: unknown[]): void {
      const t = current();
      uploads.push({ fn: 'texSubImage2D', texture: t.id, level, x, y, z: 0, w, h, d: 1 });
      write(t.levels[level]!, x, y, 0, w, h, 1, rest[2] as Uint8Array);
    },
    texSubImage3D(
      _t: number,
      level: number,
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      ...rest: unknown[]
    ): void {
      const t = current();
      uploads.push({ fn: 'texSubImage3D', texture: t.id, level, x, y, z, w, h, d });
      write(t.levels[level]!, x, y, z, w, h, d, rest[2] as Uint8Array);
    },
    texParameteri(_target: number, pname: number, value: number): void {
      current().params.set(pname, value);
    },
    isContextLost: () => false,
  };
  const three = {
    getContext: () => gl,
    state: {
      bindTexture(_target: number, texture: FakeTexture | null): void {
        bound = texture;
      },
      pixelStorei(): void {},
    },
    properties: {} as unknown,
  };
  // `restore` imita o three depois de um contexto restaurado (troca o `properties`).
  const restore = (): void => {
    three.properties = {};
  };
  return { three: three as unknown as WebGLRenderer, restore, textures, uploads };
}

function sharedTextures(): MutableSharedTextures {
  return {
    blocks: { value: null },
    blocksAtlas: { value: new Vector4() },
    blocksAtlasSize: { value: new Vector2() },
    models: { value: null },
    modelsAtlas: { value: new Vector4() },
    modelsAtlasSize: { value: new Vector2() },
    assets: null,
  };
}

/** Array montado só com o nível 0 (o render completa a cadeia), cor pela camada. */
function assembled(name: 'blocos16' | 'modelos64', layers: number, reserved: number): AssembledTextureArray {
  const size = name === 'blocos16' ? 16 : 64;
  const level0 = new Uint8Array(size * size * 4 * layers);
  for (let l = 0; l < layers - reserved; l++) level0.fill(10 + l, l * size * size * 4, (l + 1) * size * size * 4);
  const tools = layers - reserved;
  return {
    name,
    data: { width: size, height: size, layers, levels: [level0] },
    layers: new Map(Array.from({ length: tools }, (_, i) => [`camada${i}`, i] as const)),
    info: Array.from({ length: tools }, (_, i) => ({ name: `camada${i}`, kind: 'opaque', frames: 1, cutout: false })),
    reservedStart: tools,
    reservedCount: reserved,
  };
}

function gameTextures(): RenderTextures {
  return { blocks: assembled('blocos16', 3, 0), models: assembled('modelos64', 10, 8) };
}

/** Skin de k camadas (nível 0) e o nível 1, com bytes diferentes por camada e um recorte no alfa. */
function skin(k: number, seed: number): { rgba: Uint8Array; level1: Uint8Array } {
  const rgba = new Uint8Array(k * 64 * 64 * 4);
  const level1 = new Uint8Array(k * 32 * 32 * 4);
  for (let i = 0; i < rgba.length / 4; i++)
    rgba.set([(i * 3 + seed) & 255, seed, i & 255, i % 3 === 0 ? 0 : 255], i * 4);
  for (let i = 0; i < level1.length / 4; i++) level1.set([seed, (i * 5) & 255, 7, i % 4 === 0 ? 0 : 255], i * 4);
  return { rgba, level1 };
}

/** A textura de modelos do GL falso (a última `modelos64` criada que não foi apagada). */
function liveModels(textures: readonly FakeTexture[]): FakeTexture {
  const live = textures.filter((t) => !t.deleted);
  return live[live.length - 1]!;
}

function setup(mode: TextureMode) {
  const fake = fakeRenderer();
  const shared = sharedTextures();
  const gpu = createGpuTextures(fake.three, mode, shared);
  gpu.set(gameTextures());
  return { ...fake, shared, gpu };
}

describe('texture-gpu: rota array', () => {
  it('writeModelLayer sobe 4 camadas (sintéticas) em laço de profundidade 1 e a GPU fica igual à CPU', () => {
    const { gpu, shared, textures, uploads } = setup('array');
    const models = liveModels(textures);
    expect(models.target).toBe(GL.TEXTURE_2D_ARRAY);
    expect(models.levels).toHaveLength(7);
    expect(models.params.get(GL.TEXTURE_MAX_LEVEL)).toBe(6);
    uploads.length = 0;

    const { rgba, level1 } = skin(4, 40);
    gpu.writeModelLayer(2, rgba, level1);
    expect(uploads).toHaveLength(4 * 7);
    expect(uploads.every((u) => u.fn === 'texSubImage3D' && u.d === 1 && u.texture === models.id)).toBe(true);
    expect(new Set(uploads.map((u) => u.z))).toEqual(new Set([2, 3, 4, 5]));
    for (const u of uploads) expect([u.w, u.h]).toEqual([64 >> u.level, 64 >> u.level]);

    // A cópia da CPU (que os passes leem) tem o nível 0 e o nível 1 DADOS, e a GPU tem a cadeia inteira dela.
    const cpu = shared.assets!.models.data.levels;
    expect(cpu).toHaveLength(7);
    expect(cpu[0]!.subarray(2 * 16384, 6 * 16384)).toEqual(rgba);
    expect(cpu[1]!.subarray(2 * 4096, 6 * 4096)).toEqual(level1);
    for (let k = 0; k < 7; k++) expect(models.levels[k]!.data, `nível ${k}`).toEqual(cpu[k]);
    // A cadeia completa vale também para os blocos (eram só o nível 0) e mantém os nomes.
    expect(shared.assets!.blocks.data.levels).toHaveLength(5);
    expect(shared.assets!.models.layers.get('camada1')).toBe(1);
  });

  it('sem nível 1 dado, o render tira do nível 0; camadas fora da reserva e bytes errados são recusados', () => {
    const { gpu, shared, uploads } = setup('array');
    uploads.length = 0;
    const { rgba } = skin(1, 9);
    gpu.writeModelLayer(9, rgba);
    expect(uploads.map((u) => u.z)).toEqual([9, 9, 9, 9, 9, 9, 9]);
    expect(shared.assets!.models.data.levels[1]!.subarray(9 * 4096, 10 * 4096).some((v) => v !== 0)).toBe(true);

    const four = skin(4, 1);
    expect(() => gpu.writeModelLayer(7, four.rgba, four.level1)).toThrow('fora das reservadas (2..9)');
    expect(() => gpu.writeModelLayer(1, rgba)).toThrow('fora das reservadas');
    expect(() => gpu.writeModelLayer(2, rgba.subarray(4))).toThrow('k × 16384');
    expect(() => gpu.writeModelLayer(2, four.rgba, four.level1.subarray(4096))).toThrow('nível 1');
    expect(() => createGpuTextures(fakeRenderer().three, 'array', sharedTextures()).writeModelLayer(2, rgba)).toThrow(
      'antes do setTextures',
    );
  });

  it('contexto restaurado: reenvia tudo com as skins já escritas', () => {
    const { gpu, shared, restore, textures } = setup('array');
    const { rgba, level1 } = skin(4, 77);
    gpu.writeModelLayer(6, rgba, level1);
    restore();
    gpu.sync();
    const models = liveModels(textures);
    const cpu = shared.assets!.models.data.levels;
    for (let k = 0; k < 7; k++) expect(models.levels[k]!.data, `nível ${k}`).toEqual(cpu[k]);
  });
});

describe('texture-gpu: rota atlas (plano B)', () => {
  it('modelos com 3 níveis e blocos com 2; writeModelLayer escreve uma célula por camada e nível', () => {
    const { gpu, shared, textures, uploads } = setup('atlas');
    const live = textures.filter((t) => !t.deleted);
    const [blocks, models] = live as [FakeTexture, FakeTexture];
    expect(blocks.levels).toHaveLength(ATLAS_MAX_MIP_LEVELS.blocos16);
    expect(blocks.params.get(GL.TEXTURE_MAX_LEVEL)).toBe(1);
    expect(models.levels).toHaveLength(ATLAS_MAX_MIP_LEVELS.modelos64);
    expect(models.params.get(GL.TEXTURE_MAX_LEVEL)).toBe(2);
    const layout = atlasLayout(10, 64, 4, ATLAS_MAX_MIP_LEVELS.modelos64);
    expect([models.levels[0]!.w, models.levels[0]!.h]).toEqual([layout.width, layout.height]);
    expect(shared.modelsAtlas.value.toArray()).toEqual([layout.cols, layout.rows, 64, 4]);
    uploads.length = 0;

    const { rgba, level1 } = skin(4, 50);
    gpu.writeModelLayer(4, rgba, level1);
    expect(uploads).toHaveLength(4 * 3);
    for (const u of uploads) {
      expect(u.fn).toBe('texSubImage2D');
      expect(u.texture).toBe(models.id);
    }
    for (let layer = 4; layer < 8; layer++) {
      for (let k = 0; k < 3; k++) {
        const r = atlasCellRect(layout, layer, k);
        expect(uploads).toContainEqual({
          fn: 'texSubImage2D',
          texture: models.id,
          level: k,
          x: r.x,
          y: r.y,
          z: 0,
          w: r.size,
          h: r.size,
          d: 1,
        });
      }
    }
    // O atlas da GPU é exatamente o atlas montado da cadeia da CPU (com as skins novas e o padding certo).
    const cpu = shared.assets!.models.data.levels;
    expect(cpu[1]!.subarray(4 * 4096, 8 * 4096)).toEqual(level1);
    const expected = buildAtlasLevels(layout, cpu, 'clamp');
    for (let k = 0; k < 3; k++) expect(models.levels[k]!.data, `nível ${k}`).toEqual(expected[k]);
    // Os bytes contam os 3 níveis do atlas dos modelos e os 2 dos blocos.
    const blocksLayout = atlasLayout(3, 16, 4, ATLAS_MAX_MIP_LEVELS.blocos16);
    let bytes = 0;
    for (const l of [blocksLayout, layout])
      for (let k = 0; k < l.levels; k++) bytes += (l.width >> k) * (l.height >> k) * 4;
    expect(gpu.bytes).toBe(bytes);
    expect(levelBytes(64, 1, 4)).toBe(level1.length);
  });

  it('setMinFilter troca o filtro nas 2 texturas sem reenviar nada', () => {
    const { gpu, textures, uploads } = setup('atlas');
    uploads.length = 0;
    gpu.setMinFilter('linear');
    for (const t of textures.filter((x) => !x.deleted))
      expect(t.params.get(GL.TEXTURE_MIN_FILTER)).toBe(GL.LINEAR_MIPMAP_LINEAR);
    gpu.setMinFilter('off');
    for (const t of textures.filter((x) => !x.deleted)) expect(t.params.get(GL.TEXTURE_MIN_FILTER)).toBe(GL.NEAREST);
    expect(uploads).toHaveLength(0);
    gpu.dispose();
    expect(textures.every((t) => t.deleted)).toBe(true);
  });
});
