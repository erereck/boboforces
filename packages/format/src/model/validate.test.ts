import { describe, expect, it } from 'vitest';
import { MODEL_FORMAT, type ModelBox, type ModelDocument } from './types.ts';
import { modelTriangleCount, validateModel, validateModelLayers, validateModelPack } from './validate.ts';

function box(
  origin: readonly [number, number, number],
  size: readonly [number, number, number],
  uv: readonly [number, number] = [0, 0],
): ModelBox {
  return { origin, size, uv, layer: 'test_gun', inflate: 0, mirror: false };
}

/** Arma sintética mínima válida (ID registrado `model:pistol`). */
function weapon(): ModelDocument {
  return {
    format: MODEL_FORMAT,
    id: 'pistol',
    kind: 'weapon',
    flags: 0,
    parts: [
      { name: 'body', parent: -1, pivot: [0, 0, 0], boxes: [box([-1, 0, -8], [2, 2, 8])], meshes: [] },
      { name: 'mag', parent: 0, pivot: [0, -5, 0.5], boxes: [box([-1, -1, -1.5], [2, 1, 3], [0, 20])], meshes: [] },
    ],
    sockets: [
      { name: 'hand_r', part: 0, position: [0, -2.5, 0.5], direction: [0, 0, -1] },
      { name: 'muzzle', part: 0, position: [0, 1, -8], direction: [0, 0, -1] },
      { name: 'sight', part: 0, position: [0, 2, 0], direction: [0, 0, -1] },
    ],
    colliders: [],
    light: null,
    debrisColor: 0x5a6072,
    blocksNav: false,
  };
}

function prop(tris: number): ModelDocument {
  const nv = tris * 3;
  return {
    ...weapon(),
    id: 'barrel',
    kind: 'prop',
    parts: [
      {
        name: 'body',
        parent: -1,
        pivot: [0, 0, 0],
        boxes: [],
        meshes: [
          {
            positions: new Int16Array(nv * 3),
            normals: new Int8Array(nv * 3).fill(127),
            uvs: new Uint8Array(nv * 2),
            indices: Uint16Array.from({ length: nv }, (_, i) => i),
            layer: 'test_prop',
          },
        ],
      },
    ],
    sockets: [],
    colliders: [{ min: [-8, 0, -8], max: [8, 28, 8] }],
    blocksNav: true,
  };
}

describe('validateModel', () => {
  it('aceita a arma mínima e a prop dentro do teto', () => {
    expect(validateModel(weapon())).toEqual([]);
    expect(validateModel(prop(300))).toEqual([]);
    expect(modelTriangleCount(weapon())).toBe(24);
  });

  it('reprova arma sem soquete obrigatório e soquete de nome desconhecido', () => {
    const m = weapon();
    const out = validateModel({
      ...m,
      sockets: [...m.sockets.filter((s) => s.name !== 'muzzle'), { ...m.sockets[0]!, name: 'barrel' }],
    });
    expect(out.join('\n')).toMatch(/soquete obrigatório "muzzle"/);
    expect(out.join('\n')).toMatch(/arma só aceita/);
  });

  it('reprova teto de triângulos por tipo (prop 300, arma 600)', () => {
    expect(validateModel(prop(301)).join('\n')).toMatch(/301 triângulos \(teto de prop: 300\)/);
    const many = weapon();
    const boxes = Array.from({ length: 51 }, () => box([0, 0, 0], [1, 1, 1]));
    expect(validateModel({ ...many, parts: [{ ...many.parts[0]!, boxes }] }).join('\n')).toMatch(/612 triângulos/);
  });

  it('reprova ID não registrado, mãe depois da filha e UV fora da camada', () => {
    const m = weapon();
    expect(validateModel({ ...m, id: 'blaster-9000' }).join('\n')).toMatch(/não registrado/);
    const parts = [m.parts[0]!, { ...m.parts[1]!, parent: 1 }];
    expect(validateModel({ ...m, parts }).join('\n')).toMatch(/precisa vir antes/);
    const wide = [{ ...m.parts[0]!, boxes: [box([0, 0, 0], [20, 4, 14], [10, 0])] }];
    expect(validateModel({ ...m, parts: wide }).join('\n')).toMatch(/sai da camada/);
  });

  it('reprova prop sem colisor, colisor vazio e luz sem a flag emissive', () => {
    const p = prop(10);
    expect(validateModel({ ...p, colliders: [] }).join('\n')).toMatch(/prop sem caixa de colisão/);
    expect(validateModel({ ...p, colliders: [{ min: [0, 0, 0], max: [0, 4, 4] }] }).join('\n')).toMatch(/caixa vazia/);
    expect(validateModel({ ...p, light: { position: [0, 0, 0], level: 9 } }).join('\n')).toMatch(/flag emissive/);
  });

  it('confere camadas contra o manifesto e IDs repetidos no pacote', () => {
    expect(validateModelLayers(weapon(), new Set(['test_gun']))).toEqual([]);
    expect(validateModelLayers(weapon(), new Set(['other'])).join('\n')).toMatch(/"test_gun" não existe/);
    expect(validateModelPack({ models: [weapon(), weapon()] }).join('\n')).toMatch(/repetido no pacote/);
  });
});
