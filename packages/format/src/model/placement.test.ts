import { describe, expect, it } from 'vitest';
import { propColliderBoxes, propNavCells } from './placement.ts';
import { MODEL_FORMAT, type ModelDocument } from './types.ts';

/** Prop sintética de 1 m × 0,5 m (em X × Z), 1 m de altura, pivô no centro da pegada. */
function crate(blocksNav = true): ModelDocument {
  return {
    format: MODEL_FORMAT,
    id: 'sandbags',
    kind: 'prop',
    flags: 0,
    parts: [{ name: 'body', parent: -1, pivot: [0, 0, 0], boxes: [], meshes: [] }],
    sockets: [],
    colliders: [{ min: [-16, 0, -8], max: [16, 32, 8] }],
    light: null,
    debrisColor: 0,
    blocksNav,
  };
}

describe('propColliderBoxes', () => {
  it('posiciona e escala sem giro', () => {
    const out = new Float32Array(6);
    expect(propColliderBoxes(crate(), { x: 320, y: 32, z: 64, yaw: 0, scale: 32 }, out)).toBe(1);
    expect([...out]).toEqual([9, 1, 1.5, 11, 3, 2.5]);
  });

  it('quarto de volta troca X e Z exatamente (sem resto de seno)', () => {
    const out = new Float32Array(6);
    propColliderBoxes(crate(), { x: 0, y: 0, z: 0, yaw: 64, scale: 16 }, out);
    expect([...out]).toEqual([-0.25, 0, -0.5, 0.25, 1, 0.5]);
  });

  it('giro livre vira a caixa envolvente', () => {
    const out = new Float32Array(6);
    propColliderBoxes(crate(), { x: 0, y: 0, z: 0, yaw: 32, scale: 16 }, out);
    const half = (0.5 + 0.25) * Math.SQRT1_2;
    expect(out[0]).toBeCloseTo(-half, 5);
    expect(out[5]).toBeCloseTo(half, 5);
  });
});

describe('propNavCells', () => {
  it('ocupa as células da pegada (sem vazar para a vizinha na linha da grade)', () => {
    // Centro em (1,0 m, 1,0 m): pegada x 0,5..1,5 e z 0,75..1,25 → células x 1..2, z 1..2.
    expect(propNavCells(crate(), { x: 32, y: 0, z: 32, yaw: 0, scale: 16 })).toEqual([1, 1, 1, 2, 2, 1, 2, 2]);
  });

  it('prop baixa que não ocupa navegação e caixa acima da cabeça ficam de fora', () => {
    expect(propNavCells(crate(false), { x: 32, y: 0, z: 32, yaw: 0, scale: 16 })).toEqual([]);
    const high = { ...crate(), colliders: [{ min: [-16, 64, -8], max: [16, 96, 8] }] as const };
    expect(propNavCells(high, { x: 32, y: 0, z: 32, yaw: 0, scale: 16 })).toEqual([]);
  });
});
