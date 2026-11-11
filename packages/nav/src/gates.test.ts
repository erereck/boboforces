import {
  BLOCK_FLAG,
  createBlockRegistry,
  createWorldGrid,
  type BlockDefInput,
  type WorldGrid,
} from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import {
  buildNavGrid,
  createFlowField,
  createNavPath,
  findPath,
  NAV_GATE_BLOCK,
  type NavGrid,
  type NavGridImpl,
} from './index.ts';

// M3 (fase 3d): portões da navegação (janela com barricada, porta paga), num mundo sintético de concreto.
const METRICS = { height: 1.5, crouchHeight: 0.95, radius: 0.3, stepHeight: 0.5, jumpHeight: 1, maxDrop: 3 };
const SOLID = BLOCK_FLAG.solid | BLOCK_FLAG.walkable | BLOCK_FLAG.blocksBullets | BLOCK_FLAG.blocksSight;
const def: BlockDefInput = {
  key: 'concrete',
  shape: 'cube',
  faces: [0, 0, 0, 0, 0, 0],
  flags: SOLID,
  frames: 1,
  stepSound: '',
};
const BLOCKS = createBlockRegistry([def]);

function box(grid: WorldGrid, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) grid.set(x, y, z, 1);
}

/**
 * 24 × 16 células (12 × 8 nós), chão a 0,5 m; parede de 2 m na coluna de nós 6 (x = 6..7 m) com uma passagem de 1 m na
 * linha de nós 4 (z = 4..5 m). O portão é a caixa da passagem.
 */
function walled(): NavGrid {
  const grid = createWorldGrid(24, 16, 16);
  box(grid, 0, 0, 0, 23, 0, 15);
  box(grid, 12, 1, 0, 13, 4, 7);
  box(grid, 12, 1, 10, 13, 4, 15);
  return buildNavGrid({ grid, blocks: BLOCKS }, METRICS);
}
const GATE = new Float32Array([6, 0.5, 4, 7, 2.5, 5]);
const node = (nav: NavGrid, i: number, k: number): number => nav.nearestNode(i + 0.5, 0.5, k + 0.5);

function astar(nav: NavGrid, a: number, b: number): string {
  return findPath(nav, a, b, createNavPath(nav), 100_000);
}

function flowReaches(nav: NavGrid, from: number, source: number): boolean {
  const f = createFlowField(nav);
  f.begin();
  f.addSource(source);
  f.run(1e9);
  return f.distance(from) < Infinity;
}

describe('nav: portões (M3, fase 3d)', () => {
  it('as ligações pela passagem ficam presas ao portão; as outras, não', () => {
    const nav = walled() as NavGridImpl;
    nav.assignGates(GATE, 1);
    let gated = 0;
    for (let l = 0; l < nav.linkGate.length; l++) if (nav.linkGate[l] === 0) gated++;
    // A passagem (coluna 6, linha 4) liga aos vizinhos dos dois lados: todas atravessam a caixa.
    expect(gated).toBeGreaterThanOrEqual(4);
    const far = node(nav, 2, 1);
    for (let l = nav.linkStart[far]!; l < nav.linkStart[far + 1]!; l++) expect(nav.linkGate[l]).toBe(-1);
  });

  it('janela: fecha o A* (bobos) e deixa o flow field (zumbis); porta fechada fecha os dois', () => {
    const nav = walled();
    nav.assignGates(GATE, 1);
    const a = node(nav, 2, 4);
    const b = node(nav, 10, 4);
    expect(astar(nav, a, b)).toBe('found');
    expect(flowReaches(nav, a, b)).toBe(true);
    nav.setGateBlock(0, NAV_GATE_BLOCK.bobo);
    expect(astar(nav, a, b)).toBe('unreachable');
    expect(flowReaches(nav, a, b)).toBe(true);
    nav.setGateBlock(0, NAV_GATE_BLOCK.bobo | NAV_GATE_BLOCK.zombie);
    expect(flowReaches(nav, a, b)).toBe(false);
    // Porta aberta (comprada): todos passam de novo; e reatribuir solta tudo.
    nav.setGateBlock(0, 0);
    expect(astar(nav, a, b)).toBe('found');
    nav.setGateBlock(0, NAV_GATE_BLOCK.bobo);
    nav.assignGates(GATE, 1);
    expect(astar(nav, a, b)).toBe('found');
  });

  it('janela de mão única: o zumbi entra pela janela, mas não sai por ela (M3, fase 5a)', () => {
    const nav = walled();
    // Lado de fora da passagem = +X (leste).
    nav.assignGates(GATE, 1, new Float32Array([1, 0]));
    nav.setGateBlock(0, NAV_GATE_BLOCK.bobo);
    const west = node(nav, 2, 4);
    const east = node(nav, 10, 4);
    // Bobo do lado de dentro (oeste): o zumbi de fora (leste) entra.
    expect(flowReaches(nav, east, west)).toBe(true);
    // Bobo do lado de fora (leste): o zumbi de dentro (oeste) não sai pela janela.
    expect(flowReaches(nav, west, east)).toBe(false);
  });
});
