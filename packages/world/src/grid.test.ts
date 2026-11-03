import { describe, expect, it } from 'vitest';
import { BLOCK_FLAG, createBlockRegistry } from './blocks.ts';
import {
  AIR,
  cellBlock,
  cellFlipped,
  cellIndex,
  cellRotation,
  cellToChunk,
  cellToLocal,
  makeCell,
  worldToCell,
} from './cell.ts';
import { BLOCK_SIZE, CHUNK_SIZE } from './constants.ts';
import { createWorldGrid } from './grid.ts';
import { packLight, packNormalAo } from './mesh/index.ts';

describe('célula u16', () => {
  it('empacota bloco, giro e inversão', () => {
    const c = makeCell(1023, 3, true);
    expect(c).toBeLessThanOrEqual(0xffff);
    expect(cellBlock(c)).toBe(1023);
    expect(cellRotation(c)).toBe(3);
    expect(cellFlipped(c)).toBe(true);
    expect(makeCell(5)).toBe(5);
  });

  it('índices e conversões', () => {
    expect(cellIndex(0, 0, 0)).toBe(0);
    expect(cellIndex(31, 31, 31)).toBe(CHUNK_SIZE ** 3 - 1);
    expect(cellIndex(1, 0, 0)).toBe(1);
    expect(cellIndex(0, 0, 1)).toBe(32);
    expect(cellIndex(0, 1, 0)).toBe(1024);
    expect(cellToChunk(-1)).toBe(-1);
    expect(cellToLocal(-1)).toBe(31);
    expect(worldToCell(0.49)).toBe(0);
    expect(worldToCell(0.5)).toBe(1);
    expect(worldToCell(-0.01)).toBe(-1);
    expect(BLOCK_SIZE).toBe(0.5);
  });
});

describe('WorldGrid', () => {
  it('get/set com chunks preguiçosos e ar fora dos limites', () => {
    const grid = createWorldGrid(80, 40, 70);
    expect([grid.chunksX, grid.chunksY, grid.chunksZ]).toEqual([3, 2, 3]);
    expect(grid.get(10, 10, 10)).toBe(AIR);
    grid.set(10, 10, 10, AIR);
    expect(grid.getChunk(0, 0, 0)).toBeNull();
    grid.set(40, 33, 5, makeCell(2));
    expect(grid.get(40, 33, 5)).toBe(2);
    expect(grid.get(-1, 0, 0)).toBe(AIR);
    expect(grid.get(80, 0, 0)).toBe(AIR);
    expect(() => grid.set(80, 0, 0, 1)).toThrow();
    const chunk = grid.getChunk(1, 1, 0);
    expect(chunk?.cells?.length).toBe(32 ** 3);
    const visited: string[] = [];
    grid.set(0, 0, 0, 1);
    grid.forEachChunk((c) => visited.push(`${c.cx},${c.cy},${c.cz}`));
    expect(visited).toEqual(['0,0,0', '1,1,0']);
  });
});

describe('BlockRegistry', () => {
  it('ar é o id 0 e os blocos recebem ids em ordem', () => {
    const reg = createBlockRegistry([
      {
        key: 'concrete',
        shape: 'cube',
        faces: [1, 1, 1, 1, 1, 1],
        flags: BLOCK_FLAG.solid | BLOCK_FLAG.blocksBullets,
        frames: 1,
        stepSound: 'concrete',
      },
    ]);
    expect(reg.size).toBe(2);
    expect(reg.get(0).key).toBe('air');
    expect(reg.byKey('concrete')?.id).toBe(1);
    expect(reg.flags[1]! & BLOCK_FLAG.solid).toBeTruthy();
    expect(() => reg.get(9)).toThrow();
  });
});

describe('vértice compacto', () => {
  it('empacota normal/AO e luz em u8', () => {
    expect(packNormalAo(5, 3, true)).toBe(5 | (3 << 5) | 128);
    expect(packLight(15, 15)).toBe(255);
  });
});
