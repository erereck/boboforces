import { BLOCK_FLAG, createBlockRegistry, createWorldGrid, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import type { CollisionWorld } from '../fx/verlet.ts';
import { fitBlobToGround } from './blob-shadows.ts';

const SOLID = BLOCK_FLAG.solid | BLOCK_FLAG.blocksBullets;
const faces = [0, 0, 0, 0, 0, 0] as const;

/** Chão em y = 0..0,5 m e uma plataforma de 4 × 4 células (2 × 2 m) 1 m mais alta em x, z = 4..8 células. */
function world(): CollisionWorld {
  const blocks = createBlockRegistry([{ key: 'floor', shape: 'cube', faces, flags: SOLID, frames: 1, stepSound: '' }]);
  const grid = createWorldGrid(32, 16, 32);
  for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) grid.set(x, 0, z, makeCell(1));
  for (let x = 4; x < 8; x++) for (let z = 4; z < 8; z++) for (let y = 1; y < 3; y++) grid.set(x, y, z, makeCell(1));
  return { grid, blocks };
}

describe('M12 (fase 5, revisão): o disco grande da prop assenta no chão', () => {
  const w = world();

  it('no plano: o disco inteiro', () => {
    expect(fitBlobToGround(w, 10, 0.5, 10, 3)).toBe(1);
  });

  it('na plataforma (2 × 2 m, topo a 1,5 m): encolhe até caber; grande demais, sem disco', () => {
    // Centro em (3, 3) m: a borda de um disco de 2,4 m (1,8..4,2 m) passa da beira (2..4 m); o de 0,75 × 2,4 = 1,8 m
    // (2,1..3,9 m) cabe.
    expect(fitBlobToGround(w, 3, 1.5, 3, 2.4)).toBe(0.75);
    // 4 m: nem 0,55 × 4 = 2,2 m cabe na plataforma de 2 m.
    expect(fitBlobToGround(w, 3, 1.5, 3, 4)).toBe(0);
    // Sem mundo (testes, menu): o disco inteiro.
    expect(fitBlobToGround(null, 3, 1.5, 3, 4)).toBe(1);
  });
});
