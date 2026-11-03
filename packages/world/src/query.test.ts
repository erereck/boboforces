import { describe, expect, it } from 'vitest';
import { buildTestArena, cellCenter, createTestBlocks, fillBox } from './arena.ts';
import { BLOCK_FLAG } from './blocks.ts';
import { makeCell } from './cell.ts';
import { createWorldGrid, type WorldGrid } from './grid.ts';
import {
  boxIntersectsSolid,
  createAabb,
  createRayHit,
  createSweepResult,
  isCellSolid,
  raycastGrid,
  sweepAabb,
  type Aabb,
} from './query.ts';

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);

/** Chão de 20×20 células com o topo em 0,5 m. */
function flatFloor(): WorldGrid {
  const grid = createWorldGrid(20, 16, 20);
  fillBox(grid, 0, 0, 0, 19, 0, 19, concrete);
  return grid;
}

/** AABB do bobo (0,6 × 1,5 × 0,6) com os pés em (x, y, z). */
function bobo(x: number, y: number, z: number, height = 1.5): Aabb {
  const b = createAabb();
  b.minX = x - 0.3;
  b.maxX = x + 0.3;
  b.minY = y;
  b.maxY = y + height;
  b.minZ = z - 0.3;
  b.maxZ = z + 0.3;
  return b;
}

describe('raycastGrid (DDA)', () => {
  it('acerta o chão de cima, com ponto e normal', () => {
    const grid = flatFloor();
    const hit = createRayHit();
    expect(raycastGrid(grid, blocks, 2.1, 3, 2.2, 0, -1, 0, 10, BLOCK_FLAG.blocksBullets, hit)).toBe(true);
    expect(hit.distance).toBeCloseTo(2.5);
    expect(hit.y).toBeCloseTo(0.5);
    expect([hit.normalX, hit.normalY, hit.normalZ]).toEqual([0, 1, 0]);
    expect([hit.cellX, hit.cellY, hit.cellZ]).toEqual([4, 0, 4]);
    expect(hit.cell).toBe(concrete);
  });

  it('acerta parede na diagonal e respeita o alcance e a máscara', () => {
    const grid = flatFloor();
    fillBox(grid, 10, 1, 0, 10, 6, 19, concrete); // parede em x = 5,0..5,5 m
    const hit = createRayHit();
    const d = Math.SQRT1_2;
    expect(raycastGrid(grid, blocks, 1, 1.2, 1, d, 0, d, 20, BLOCK_FLAG.blocksBullets, hit)).toBe(true);
    expect(hit.x).toBeCloseTo(5);
    expect(hit.normalX).toBe(-1);
    expect(hit.distance).toBeCloseTo(4 / d);
    expect(raycastGrid(grid, blocks, 1, 1.2, 1, d, 0, d, 5, BLOCK_FLAG.blocksBullets, hit)).toBe(false);
    expect(raycastGrid(grid, blocks, 1, 1.2, 1, d, 0, d, 20, BLOCK_FLAG.emissive, hit)).toBe(false);
  });

  it('origem dentro de bloco acerta na distância 0; fora da grade sem nada à frente, não acerta', () => {
    const grid = flatFloor();
    const hit = createRayHit();
    expect(raycastGrid(grid, blocks, 1, 0.25, 1, 1, 0, 0, 5, BLOCK_FLAG.blocksBullets, hit)).toBe(true);
    expect(hit.distance).toBe(0);
    expect(raycastGrid(grid, blocks, 1, 3, 1, 0, 1, 0, 100, BLOCK_FLAG.blocksBullets, hit)).toBe(false);
    // De fora da grade para dentro: entra e acerta.
    expect(raycastGrid(grid, blocks, -5, 0.25, 1, 1, 0, 0, 10, BLOCK_FLAG.blocksBullets, hit)).toBe(true);
    expect(hit.x).toBeCloseTo(0);
  });
});

describe('sweepAabb', () => {
  it('cai e para no chão (onGround)', () => {
    const grid = flatFloor();
    const box = bobo(3, 2, 3);
    const out = createSweepResult();
    sweepAabb(grid, blocks, box, 0, -3, 0, 0, out);
    expect(box.minY).toBeCloseTo(0.5);
    expect(out.dy).toBeCloseTo(-1.5);
    expect(out.hitY).toBe(true);
    expect(out.onGround).toBe(true);
    // Parado no chão: gravidade pequena continua dando onGround sem afundar.
    sweepAabb(grid, blocks, box, 0, -0.003, 0, 0, out);
    expect(box.minY).toBe(0.5);
    expect(out.onGround).toBe(true);
  });

  it('para na parede e desliza no outro eixo', () => {
    const grid = flatFloor();
    fillBox(grid, 10, 1, 0, 10, 6, 19, concrete);
    const box = bobo(4.5, 0.5, 3);
    const out = createSweepResult();
    sweepAabb(grid, blocks, box, 0.5, -0.01, 0.4, 0.5, out);
    expect(box.maxX).toBeCloseTo(5);
    expect(out.hitX).toBe(true);
    expect(out.hitZ).toBe(false);
    expect(out.dz).toBeCloseTo(0.4);
    expect(out.stepped).toBe(false);
  });

  it('sobe degrau de 0,5 m sozinho, mas não de 1,0 m', () => {
    const grid = flatFloor();
    fillBox(grid, 10, 1, 0, 10, 1, 19, concrete); // degrau de 0,5 m em x = 5,0..5,5
    const box = bobo(4.65, 0.5, 3);
    const out = createSweepResult();
    sweepAabb(grid, blocks, box, 0.1, -0.003, 0, 0.5, out);
    expect(out.stepped).toBe(true);
    expect(box.minY).toBeCloseTo(1.0);
    expect(box.minX).toBeCloseTo(4.45);
    expect(out.onGround).toBe(true);

    const grid2 = flatFloor();
    fillBox(grid2, 10, 1, 0, 10, 2, 19, concrete); // 1,0 m
    const box2 = bobo(4.65, 0.5, 3);
    sweepAabb(grid2, blocks, box2, 0.1, -0.003, 0, 0.5, out);
    expect(out.stepped).toBe(false);
    expect(out.hitX).toBe(true);
    expect(box2.minY).toBe(0.5);
    expect(box2.maxX).toBeCloseTo(5);
  });

  it('degrau desligado (stepHeight 0) bloqueia', () => {
    const grid = flatFloor();
    fillBox(grid, 10, 1, 0, 10, 1, 19, concrete);
    const box = bobo(4.65, 0.5, 3);
    const out = createSweepResult();
    sweepAabb(grid, blocks, box, 0.1, -0.003, 0, 0, out);
    expect(out.hitX).toBe(true);
    expect(box.minY).toBe(0.5);
  });

  it('bate a cabeça no teto', () => {
    const grid = flatFloor();
    fillBox(grid, 0, 5, 0, 19, 5, 19, concrete); // teto em 2,5 m
    const box = bobo(3, 0.5, 3);
    const out = createSweepResult();
    sweepAabb(grid, blocks, box, 0, 1, 0, 0, out);
    expect(box.maxY).toBeCloseTo(2.5);
    expect(out.hitY).toBe(true);
    expect(out.onGround).toBe(false);
  });

  it('bordas X/Z da grade são paredes invisíveis; abaixo da grade é ar', () => {
    const grid = flatFloor();
    const box = bobo(0.5, 0.5, 3);
    const out = createSweepResult();
    sweepAabb(grid, blocks, box, -1, 0, 0, 0, out);
    expect(box.minX).toBeCloseTo(0);
    expect(isCellSolid(grid, blocks, -1, 3, 3)).toBe(true);
    expect(isCellSolid(grid, blocks, 3, -1, 3)).toBe(false);
  });

  it('boxIntersectsSolid ignora faces só encostadas', () => {
    const grid = flatFloor();
    expect(boxIntersectsSolid(grid, blocks, bobo(3, 0.5, 3))).toBe(false);
    expect(boxIntersectsSolid(grid, blocks, bobo(3, 0.4, 3))).toBe(true);
  });
});

describe('arena de teste', () => {
  it('spawns ficam livres, em cima do chão, e a arena é simétrica em Z', () => {
    const arena = buildTestArena();
    expect(arena.spawns.filter((s) => s.team === 0)).toHaveLength(4);
    expect(arena.spawns.filter((s) => s.team === 1)).toHaveLength(4);
    for (const s of arena.spawns) {
      expect(boxIntersectsSolid(arena.grid, arena.blocks, bobo(s.x, s.y, s.z))).toBe(false);
      expect(boxIntersectsSolid(arena.grid, arena.blocks, bobo(s.x, s.y - 0.01, s.z))).toBe(true);
    }
    const g = arena.grid;
    for (let y = 0; y < g.sizeY; y++) {
      for (let z = 0; z < g.sizeZ; z++) {
        for (let x = 0; x < g.sizeX; x++) expect(g.get(x, y, z)).toBe(g.get(x, y, g.sizeZ - 1 - z));
      }
    }
    expect(cellCenter(0)).toBe(0.25);
  });
});
