import { deflateSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { decodeModelPack, encodeModelPack } from './codec.ts';
import { BFMODEL_MAGIC, MODEL_FLAG, MODEL_FORMAT, type ModelDocument, type ModelPack } from './types.ts';

/** Modelo sintético com tudo o que o formato carrega (caixas, malha, soquetes, colisores e luz). */
function sample(): ModelDocument {
  return {
    format: MODEL_FORMAT,
    id: 'floodlight',
    kind: 'prop',
    flags: MODEL_FLAG.emissive | MODEL_FLAG.blobShadow,
    parts: [
      {
        name: 'body',
        parent: -1,
        pivot: [0, 0, 0],
        boxes: [
          { origin: [-1.5, 0, -2], size: [3, 4, 5], uv: [0, 0], layer: 'test_a', inflate: 0, mirror: false },
          { origin: [2, 0.5, -1], size: [2, 2, 2], uv: [20, 30], layer: 'test_b', inflate: 0.5, mirror: true },
        ],
        meshes: [
          {
            positions: Int16Array.from([0, 0, 0, 10, 0, 0, 10, 10, 0, -300, 200, 7]),
            normals: Int8Array.from([0, 0, -127, 0, 0, -127, 0, 0, -127, 127, 0, 0]),
            uvs: Uint8Array.from([0, 0, 10, 0, 10, 10, 64, 64]),
            indices: Uint16Array.from([0, 2, 1, 0, 3, 2]),
            layer: 'test_a',
          },
        ],
      },
      { name: 'lamp', parent: 0, pivot: [0, 70.5, -2], boxes: [], meshes: [] },
    ],
    sockets: [{ name: 'beam', part: 1, position: [0, 1.5, -3], direction: [0, 0, -1] }],
    colliders: [{ min: [-8, 0, -8], max: [8, 76, 8] }],
    light: { position: [0, 71, -10], level: 14 },
    debrisColor: 0x5a6072,
    blocksNav: true,
  };
}

describe('bfmodel (codec)', () => {
  it('ida e volta preserva o modelo', () => {
    const pack: ModelPack = { models: [sample(), { ...sample(), id: 'barrel', light: null, blocksNav: false }] };
    const back = decodeModelPack(encodeModelPack(pack));
    expect(back).toEqual(pack);
  });

  it('é determinístico (mesmos bytes)', () => {
    const pack = { models: [sample()] };
    expect(encodeModelPack(pack)).toEqual(encodeModelPack(pack));
  });

  it('normaliza a direção do soquete', () => {
    const m = {
      ...sample(),
      sockets: [{ name: 'beam', part: 0, position: [0, 0, 0] as const, direction: [0, 0, -5] as const }],
    };
    const back = decodeModelPack(encodeModelPack({ models: [m] }));
    expect(back.models[0]!.sockets[0]!.direction).toEqual([0, 0, -1]);
  });

  it('recusa valor fora da quantização', () => {
    const bad = sample();
    const part = bad.parts[0]!;
    const m = { ...bad, parts: [{ ...part, pivot: [0.25, 0, 0] as const }, bad.parts[1]!] };
    expect(() => encodeModelPack({ models: [m] })).toThrow(/meios texels/);
  });

  it('recusa o provisório da etapa de contratos com "rode npm run modelgen"', () => {
    const raw = new Uint8Array(6);
    new DataView(raw.buffer).setUint32(0, BFMODEL_MAGIC, true);
    expect(() => decodeModelPack(deflateSync(raw))).toThrow(/rode npm run modelgen/);
  });

  it('recusa magia errada, versão nova, deflate inválido e arquivo truncado', () => {
    const raw = new Uint8Array(8);
    expect(() => decodeModelPack(deflateSync(raw))).toThrow(/magia/);
    const v = new DataView(raw.buffer);
    v.setUint32(0, BFMODEL_MAGIC, true);
    v.setUint16(4, 9, true);
    expect(() => decodeModelPack(deflateSync(raw))).toThrow(/versão 9/);
    expect(() => decodeModelPack(Uint8Array.from([1, 2, 3, 4, 5]))).toThrow(/bfmodel/);
    const good = encodeModelPack({ models: [sample()] });
    const inflated = decodeModelPack(good);
    expect(inflated.models).toHaveLength(1);
    v.setUint16(4, 1, true);
    v.setUint16(6, 1, true);
    expect(() => decodeModelPack(deflateSync(raw))).toThrow(/truncado/);
  });
});
