import { assert } from '@boboforces/shared';
import { BLOCK_FLAG, createBlockRegistry, type BlockDefInput, type BlockRegistry } from './blocks.ts';
import type { Cell } from './cell.ts';
import { BLOCK_SIZE } from './constants.ts';
import { createWorldGrid, type WorldGrid } from './grid.ts';

/**
 * Arena de teste gerada por código (M0): chão, paredes e coberturas na grade de 0,5 m. É o mapa do teste golden e da
 * cena de teste do `game` até o Construto existir (M1). Não é conteúdo registrado: o id `test-arena` não entra em
 * `CONTENT_IDS`.
 */

/** Ponto de spawn em metros (pés) e radianos; `team = -1` vale para qualquer time (FFA). Mesmo formato do `SpawnPoint`
 * da sim, que importa este pacote. */
export interface MapSpawn {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly team: number;
}

/** Mapa pronto para a sim (grade estática + blocos + spawns). */
export interface TestMap {
  readonly grid: WorldGrid;
  readonly blocks: BlockRegistry;
  readonly spawns: readonly MapSpawn[];
}

const SOLID_FLAGS = BLOCK_FLAG.solid | BLOCK_FLAG.blocksBullets | BLOCK_FLAG.blocksSight | BLOCK_FLAG.walkable;

/**
 * Blocos dos mapas de teste, com IDs de conteúdo já registrados (`block:concrete`, `block:crate`, `block:missing`).
 * As camadas de textura (`faces`) são PROVISÓRIAS: o `texgen` (frente d) define a ordem final do array `blocos16`.
 */
export const TEST_BLOCK_DEFS: readonly BlockDefInput[] = [
  { key: 'concrete', shape: 'cube', faces: [1, 1, 1, 1, 1, 1], flags: SOLID_FLAGS, frames: 1, stepSound: 'concrete' },
  { key: 'crate', shape: 'cube', faces: [2, 2, 3, 3, 2, 2], flags: SOLID_FLAGS, frames: 1, stepSound: 'wood' },
  { key: 'missing', shape: 'cube', faces: [0, 0, 0, 0, 0, 0], flags: SOLID_FLAGS, frames: 1, stepSound: 'concrete' },
];

export function createTestBlocks(): BlockRegistry {
  return createBlockRegistry(TEST_BLOCK_DEFS);
}

/** Preenche a caixa de células [x0..x1] × [y0..y1] × [z0..z1] (inclusiva, em qualquer ordem). */
export function fillBox(
  grid: WorldGrid,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  cell: Cell,
): void {
  const ax = Math.min(x0, x1);
  const bx = Math.max(x0, x1);
  const ay = Math.min(y0, y1);
  const by = Math.max(y0, y1);
  const az = Math.min(z0, z1);
  const bz = Math.max(z0, z1);
  for (let y = ay; y <= by; y++) {
    for (let z = az; z <= bz; z++) {
      for (let x = ax; x <= bx; x++) grid.set(x, y, z, cell);
    }
  }
}

/** Centro da célula, em metros (para spawns e testes). */
export function cellCenter(c: number): number {
  return (c + 0.5) * BLOCK_SIZE;
}

/** Tamanho da arena em células: 64 × 16 × 64 (32 × 8 × 32 m; 2 × 1 × 2 chunks). */
export const TEST_ARENA_CELLS = { x: 64, y: 16, z: 64 } as const;

/**
 * Arena simétrica em Z (o time 0 nasce no sul, olhando para +Z; o time 1 no norte, olhando para -Z):
 * - chão de concreto (topo em 0,5 m) e paredes de 3 m em volta;
 * - pilar central de 2 m (cobertura alta), muretas e caixotes de 1 m (cobertura baixa), paredes laterais de 2 m;
 * - plataformas de 0,5 m (exercitam o degrau automático) e caixotes de 1 m perto dos spawns (exigem pulo).
 */
export function buildTestArena(): TestMap {
  const blocks = createTestBlocks();
  const concrete = blocks.byKey('concrete');
  const crate = blocks.byKey('crate');
  assert(concrete && crate, 'arena: blocos de teste ausentes');
  const { x: sx, y: sy, z: sz } = TEST_ARENA_CELLS;
  const grid = createWorldGrid(sx, sy, sz);
  const c = concrete.id;
  const k = crate.id;
  const mirrorZ = (z: number): number => sz - 1 - z;
  /** Coloca a peça e a espelhada em Z. */
  const pair = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, cell: Cell): void => {
    fillBox(grid, x0, y0, z0, x1, y1, z1, cell);
    fillBox(grid, x0, y0, mirrorZ(z0), x1, y1, mirrorZ(z1), cell);
  };

  // Chão (1 célula) e paredes de 3 m (6 células acima do chão).
  fillBox(grid, 0, 0, 0, sx - 1, 0, sz - 1, c);
  fillBox(grid, 0, 1, 0, sx - 1, 6, 0, c);
  fillBox(grid, 0, 1, sz - 1, sx - 1, 6, sz - 1, c);
  fillBox(grid, 0, 1, 0, 0, 6, sz - 1, c);
  fillBox(grid, sx - 1, 1, 0, sx - 1, 6, sz - 1, c);

  // Pilar central de 2 m (cobertura alta), cruzando o eixo de simetria.
  fillBox(grid, 30, 1, 30, 33, 4, 33, c);
  // Muretas de 1 m no meio (cobertura baixa), também cruzando o eixo.
  fillBox(grid, 18, 1, 31, 23, 2, 32, c);
  fillBox(grid, 40, 1, 31, 45, 2, 32, c);
  // Paredes laterais de 2 m.
  fillBox(grid, 6, 1, 26, 7, 4, 37, c);
  fillBox(grid, 56, 1, 26, 57, 4, 37, c);
  // Caixotes de 1 m no meio de cada metade.
  pair(14, 1, 22, 17, 2, 23, k);
  pair(46, 1, 22, 49, 2, 23, k);
  // Plataformas de 0,5 m (degrau automático) e caixotes de 1 m perto dos spawns (pulo).
  pair(26, 1, 12, 37, 1, 13, c);
  pair(30, 1, 16, 33, 2, 17, k);

  const floorTop = BLOCK_SIZE;
  const spawns: MapSpawn[] = [];
  for (const x of [20, 28, 36, 44]) {
    spawns.push({ x: cellCenter(x), y: floorTop, z: cellCenter(5), yaw: Math.PI, team: 0 });
  }
  for (const x of [20, 28, 36, 44]) {
    spawns.push({ x: cellCenter(x), y: floorTop, z: cellCenter(mirrorZ(5)), yaw: 0, team: 1 });
  }
  // Spawns de FFA nos cantos, olhando para o centro.
  const corner = Math.PI / 4;
  spawns.push({ x: cellCenter(4), y: floorTop, z: cellCenter(4), yaw: Math.PI + corner, team: -1 });
  spawns.push({ x: cellCenter(sx - 5), y: floorTop, z: cellCenter(4), yaw: Math.PI - corner, team: -1 });
  spawns.push({ x: cellCenter(4), y: floorTop, z: cellCenter(sz - 5), yaw: -corner, team: -1 });
  spawns.push({ x: cellCenter(sx - 5), y: floorTop, z: cellCenter(sz - 5), yaw: corner, team: -1 });

  return { grid, blocks, spawns };
}
