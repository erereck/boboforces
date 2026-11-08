import { BLOCK_FLAG, createBlockRegistry, createWorldGrid, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { INST, INSTANCE_FLOATS } from '../actors/layout.ts';
import { createDebrisPool, setDebrisBudget, spawnDebris, stepDebris } from './debris.ts';
import { floorBelow, pointSolid, verletStep, VERLET_HIT, type CollisionWorld } from './verlet.ts';

const SOLID = BLOCK_FLAG.solid | BLOCK_FLAG.blocksBullets;
const faces = [0, 0, 0, 0, 0, 0] as const;

/** Chão de cubos em y = 0..1 (topo a 0,5 m), uma laje em (4, 1, 4) e uma rampa 1:1 em (6, 1, 4). */
function world(): CollisionWorld {
  const blocks = createBlockRegistry([
    { key: 'floor', shape: 'cube', faces, flags: SOLID, frames: 1, stepSound: '' },
    { key: 'slab', shape: 'slab', faces, flags: SOLID, frames: 1, stepSound: '' },
    { key: 'ramp', shape: 'ramp', faces, flags: SOLID, frames: 1, stepSound: '' },
    { key: 'grass', shape: 'cross', faces, flags: 0, frames: 1, stepSound: '' },
  ]);
  const grid = createWorldGrid(16, 16, 16);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) grid.set(x, 0, z, makeCell(1));
  grid.set(4, 1, 4, makeCell(2));
  grid.set(6, 1, 4, makeCell(3));
  grid.set(8, 1, 4, makeCell(4));
  // Parede em x = 12.
  for (let y = 1; y < 6; y++) for (let z = 0; z < 16; z++) grid.set(12, y, z, makeCell(1));
  return { grid, blocks };
}

describe('colisão cosmética contra a grade', () => {
  const w = world();

  it('respeita as formas: cubo, laje até meia célula, rampa pelo piso, cruz não colide', () => {
    expect(pointSolid(w, 1, 0.4, 1)).toBe(true);
    expect(pointSolid(w, 1, 0.6, 1)).toBe(false);
    // Laje (célula y = 1: 0,5..1 m): sólida só até 0,75 m.
    expect(pointSolid(w, 2.25, 0.7, 2.25)).toBe(true);
    expect(pointSolid(w, 2.25, 0.8, 2.25)).toBe(false);
    // Rampa canônica: piso 16 − z (alto em -Z): perto de z mínimo é alta, perto do máximo é baixa.
    expect(pointSolid(w, 3.25, 0.95, 2.02)).toBe(true);
    expect(pointSolid(w, 3.25, 0.6, 2.48)).toBe(false);
    expect(pointSolid(w, 4.25, 0.6, 2.25)).toBe(false);
    // Abaixo do mundo é chão; fora da grade em X/Z é ar.
    expect(pointSolid(w, 1, -1, 1)).toBe(true);
    expect(pointSolid(w, -3, 0.4, 1)).toBe(false);
  });

  it('acha o piso abaixo (sombra-blob e assentar)', () => {
    expect(floorBelow(w, 1, 3, 1, 5)).toBeCloseTo(0.5);
    expect(floorBelow(w, 2.25, 3, 2.25, 5)).toBeCloseTo(0.75);
    expect(floorBelow(w, 3.25, 3, 2.25, 5)).toBeCloseTo(0.75);
    expect(Number.isNaN(floorBelow(w, 1, 3, 1, 1))).toBe(true);
  });

  it('Verlet: cai, quica e assenta no chão na altura certa', () => {
    const pos = new Float32Array([1, 3, 1]);
    const prev = new Float32Array([1, 3, 1]);
    const params = { gravity: 14, bounce: 0.3, friction: 6, drag: 0 };
    let grounded = 0;
    for (let i = 0; i < 240; i++) {
      if (verletStep(pos, prev, 0, 1 / 60, 1 / 60, 0.05, 0.05, 0.05, w, params) & VERLET_HIT.ground) grounded++;
    }
    expect(grounded).toBeGreaterThan(0);
    expect(pos[1]).toBeCloseTo(0.55, 2);
    expect(Math.abs(pos[1]! - prev[1]!)).toBeLessThan(1e-3);
  });

  it('Verlet: bate na parede e volta', () => {
    const pos = new Float32Array([5.7, 1.5, 3]);
    const prev = new Float32Array([5.7 - 8 / 60, 1.5, 3]);
    const params = { gravity: 0, bounce: 0.5, friction: 0, drag: 0 };
    let wall = false;
    for (let i = 0; i < 30; i++) {
      if (verletStep(pos, prev, 0, 1 / 60, 1 / 60, 0.05, 0.05, 0.05, w, params) & VERLET_HIT.wall) wall = true;
    }
    expect(wall).toBe(true);
    expect(pos[0]!).toBeLessThan(6);
    expect(pos[0]! - prev[0]!).toBeLessThan(0);
  });
});

describe('cubinhos de detrito', () => {
  it('nascem com cor e luz por instância, quicam, somem no fim e respeitam o teto', () => {
    const w = world();
    const pool = createDebrisPool(32, 4);
    for (let i = 0; i < 6; i++) spawnDebris(pool, 1, 2, 1, 1, 2, 0, 0xff8000, 0.08, 1, 0.5, 0.25, 0, 0, 0, 3);
    // Teto 4: o anel reaproveita as posições 0..3.
    expect(pool.highWater).toBe(4);
    expect(pool.data[INST.r]).toBeCloseTo(1);
    expect(pool.data[INST.g]).toBeCloseTo(0x80 / 255);
    expect(pool.data[INST.sky]).toBe(0.5);
    expect(pool.dataDirtyMin).toBe(0);
    expect(pool.dataDirtyMax).toBe(3);
    let alive = 0;
    for (let f = 0; f < 30; f++) alive = stepDebris(pool, 1 / 60, w);
    expect(alive).toBe(4);
    // No chão (topo 0,5 + meio cubinho) e com a escala do lado.
    expect(pool.pos[1]!).toBeGreaterThan(0.5);
    const scale = Math.hypot(pool.matrices[0]!, pool.matrices[1]!, pool.matrices[2]!);
    expect(scale).toBeCloseTo(0.08, 3);
    for (let f = 0; f < 40; f++) alive = stepDebris(pool, 1 / 60, w);
    expect(alive).toBe(0);
    expect(pool.highWater).toBe(0);
    setDebrisBudget(pool, 0);
    expect(spawnDebris(pool, 0, 0, 0, 0, 0, 0, 0, 0.1, 1, 1, 1, 0, 0, 0, 0)).toBe(-1);
    expect(INSTANCE_FLOATS).toBe(16);
  });
});
