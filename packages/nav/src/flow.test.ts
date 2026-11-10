import {
  BLOCK_FLAG,
  createBlockRegistry,
  createWorldGrid,
  type BlockDefInput,
  type WorldGrid,
} from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { buildNavGrid, createFlowField, NAV_LINK, NO_NAV_NODE, type FlowField, type NavGrid } from './index.ts';

// M3 (fase 3c): o flow field dos zumbis, em mundos sintéticos de concreto.
const METRICS = { height: 1.5, crouchHeight: 0.95, radius: 0.3, stepHeight: 0.5, jumpHeight: 1, maxDrop: 3 };
const SOLID = BLOCK_FLAG.solid | BLOCK_FLAG.walkable | BLOCK_FLAG.blocksBullets | BLOCK_FLAG.blocksSight;
const def = (key: string): BlockDefInput => ({
  key,
  shape: 'cube',
  faces: [0, 0, 0, 0, 0, 0],
  flags: SOLID,
  frames: 1,
  stepSound: '',
});
const BLOCKS = createBlockRegistry([def('concrete')]);
const CONCRETE = 1;

function box(grid: WorldGrid, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) grid.set(x, y, z, CONCRETE);
}

/** Chão de concreto (piso a 0,5 m) num mundo de sx × 16 × sz células. */
function floorWorld(sx: number, sz: number): WorldGrid {
  const grid = createWorldGrid(sx, 16, sz);
  box(grid, 0, 0, 0, sx - 1, 0, sz - 1);
  return grid;
}

/** Nó da coluna (i, k) de nós (1 m), no piso mais perto de `y`. */
const node = (nav: NavGrid, i: number, k: number, y = 0.5): number => nav.nearestNode(i + 0.5, y, k + 0.5);

/** Segue o campo de `from` até a fonte; devolve os nós (para em 1000 passos). */
function chain(field: FlowField, from: number): number[] {
  const out = [from];
  let n = from;
  while (field.next(n) !== NO_NAV_NODE && out.length < 1000) {
    n = field.next(n);
    out.push(n);
  }
  return out;
}

function solveAll(field: FlowField, sources: readonly number[]): void {
  field.begin();
  for (const s of sources) field.addSource(s);
  expect(field.run(1_000_000)).toBe(true);
}

describe('nav: flow field (M3, fase 3c)', () => {
  it('chão liso: custo octile até a fonte e o caminho chega nela', () => {
    const nav = buildNavGrid({ grid: floorWorld(16, 16), blocks: BLOCKS }, METRICS);
    const field = createFlowField(nav);
    const src = node(nav, 1, 1);
    expect(field.ready).toBe(0);
    expect(field.next(src)).toBe(NO_NAV_NODE);
    solveAll(field, [src]);
    expect(field.ready).toBe(1);
    expect(field.distance(src)).toBe(0);
    expect(field.next(src)).toBe(NO_NAV_NODE);
    // (7, 4): 3 diagonais + 3 retos.
    expect(field.distance(node(nav, 7, 4))).toBeCloseTo(3 * Math.SQRT2 + 3, 4);
    const path = chain(field, node(nav, 7, 7));
    expect(path.at(-1)).toBe(src);
    expect(path.length).toBe(7);
    expect(field.link(node(nav, 7, 7))).toBe(NAV_LINK.walk);
  });

  it('parede com uma passagem: o caminho dá a volta por ela', () => {
    // 24 × 24 células (12 × 12 nós); parede alta (2 m) na coluna de nós 6, aberta só nas linhas 10 e 11.
    const grid = floorWorld(24, 24);
    box(grid, 12, 1, 0, 13, 4, 19);
    const nav = buildNavGrid({ grid, blocks: BLOCKS }, METRICS);
    const field = createFlowField(nav);
    const src = node(nav, 2, 2);
    solveAll(field, [src]);
    const path = chain(field, node(nav, 10, 2));
    expect(path.at(-1)).toBe(src);
    const pos = new Float32Array(3);
    let passed = false;
    for (const n of path) {
      nav.nodePosition(n, pos);
      if (Math.floor(pos[0]!) === 6) {
        passed = true;
        expect(pos[2]).toBeGreaterThan(10);
      }
    }
    expect(passed).toBe(true);
    // Bem mais caro que a reta de 8 m.
    expect(field.distance(node(nav, 10, 2))).toBeGreaterThan(16);
  });

  it('a fonte mais perto ganha, e outra ilha fica sem caminho', () => {
    const grid = floorWorld(24, 16);
    // Parede de ponta a ponta na coluna de nós 8: a direita é outra ilha.
    box(grid, 16, 1, 0, 17, 4, 15);
    const nav = buildNavGrid({ grid, blocks: BLOCKS }, METRICS);
    const field = createFlowField(nav);
    const a = node(nav, 0, 0);
    const b = node(nav, 6, 7);
    solveAll(field, [a, b]);
    expect(chain(field, node(nav, 1, 2)).at(-1)).toBe(a);
    expect(chain(field, node(nav, 5, 5)).at(-1)).toBe(b);
    const island = node(nav, 10, 4);
    expect(island).not.toBe(NO_NAV_NODE);
    expect(field.next(island)).toBe(NO_NAV_NODE);
    expect(field.distance(island)).toBe(Infinity);
  });

  it('fatiado dá o mesmo campo, e o pronto vale até o novo terminar', () => {
    const nav = buildNavGrid({ grid: floorWorld(24, 24), blocks: BLOCKS }, METRICS);
    const whole = createFlowField(nav);
    const sliced = createFlowField(nav);
    const s1 = node(nav, 3, 3);
    solveAll(whole, [s1]);
    solveAll(sliced, [node(nav, 9, 9)]);
    const old = sliced.next(node(nav, 0, 0));
    sliced.begin();
    sliced.addSource(s1);
    let calls = 0;
    while (!sliced.run(5)) {
      calls++;
      // Ainda o campo velho.
      expect(sliced.next(node(nav, 0, 0))).toBe(old);
    }
    expect(calls).toBeGreaterThan(20);
    expect(sliced.ready).toBe(2);
    for (let n = 0; n < nav.nodeCount; n++) {
      expect(sliced.next(n)).toBe(whole.next(n));
      expect(sliced.distance(n)).toBe(whole.distance(n));
    }
  });

  it('subir na plataforma: a ligação do campo é de pulo', () => {
    // Plataforma de 1 m (2 células) da coluna de nós 4 em diante; a fonte em cima.
    const grid = floorWorld(16, 8);
    box(grid, 8, 1, 0, 15, 2, 7);
    const nav = buildNavGrid({ grid, blocks: BLOCKS }, METRICS);
    const field = createFlowField(nav);
    const top = node(nav, 6, 2, 1.5);
    solveAll(field, [top]);
    const path = chain(field, node(nav, 1, 2));
    expect(path.at(-1)).toBe(top);
    expect(path.some((n) => field.link(n) === NAV_LINK.jump)).toBe(true);
  });
});
