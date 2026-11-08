import {
  BLOCK_FLAG,
  COLLIDER_FLAG,
  createBlockRegistry,
  createWorldGrid,
  makeCell,
  type BlockDefInput,
  type BlockShape,
  type StaticColliders,
  type WorldGrid,
} from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import {
  buildNavGrid,
  createNavPath,
  findPath,
  isReachable,
  NAV_LINK,
  NAV_NODE_CELLS,
  NO_NAV_NODE,
  SEARCH_SLOTS,
  type NavGrid,
  type NavGridImpl,
} from './index.ts';

const METRICS = { height: 1.5, crouchHeight: 0.95, radius: 0.3, stepHeight: 0.5, jumpHeight: 1, maxDrop: 3 };
const SOLID = BLOCK_FLAG.solid | BLOCK_FLAG.walkable | BLOCK_FLAG.blocksBullets | BLOCK_FLAG.blocksSight;

const def = (key: string, shape: BlockShape, flags = SOLID): BlockDefInput => ({
  key,
  shape,
  faces: [0, 0, 0, 0, 0, 0],
  flags,
  frames: 1,
  stepSound: '',
});
// Ids: 1 concreto, 2 rampa 1:1, 3 laje, 4 rampa 1:2 baixa, 5 rampa 1:2 alta, 6 cerca (painel), 7 mato (cruz).
const BLOCKS = createBlockRegistry([
  def('concrete', 'cube'),
  def('ramp', 'ramp'),
  def('slab', 'slab'),
  def('half-low', 'rampHalfLow'),
  def('half-high', 'rampHalfHigh'),
  def('fence', 'panel', BLOCK_FLAG.solid | BLOCK_FLAG.cutout),
  def('grass', 'cross', BLOCK_FLAG.cutout),
]);
const CONCRETE = 1;

function box(grid: WorldGrid, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, cell: number) {
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) grid.set(x, y, z, cell);
}

/** Chão de concreto (y = 0, piso a 0,5 m) num mundo de sx × 16 × sz células. */
function floorWorld(sx = 16, sz = 16): WorldGrid {
  const grid = createWorldGrid(sx, 16, sz);
  box(grid, 0, 0, 0, sx - 1, 0, sz - 1, CONCRETE);
  return grid;
}

const nodeAt = (nav: NavGrid, xm: number, ym: number, zm: number): number => nav.nearestNode(xm, ym, zm);

function solve(nav: NavGrid, a: number, b: number, budget = 100000) {
  const path = createNavPath(nav);
  const status = findPath(nav, a, b, path, budget);
  return { status, path };
}

describe('nav: grade 2,5D', () => {
  it('chão liso: um nó por 2×2 células, todos ligados (8 vizinhos)', () => {
    expect(NAV_NODE_CELLS).toBe(2);
    const nav = buildNavGrid({ grid: floorWorld(), blocks: BLOCKS }, METRICS) as NavGridImpl;
    expect(nav.columnsX).toBe(8);
    expect(nav.columnsZ).toBe(8);
    expect(nav.nodeCount).toBe(64);
    expect(nav.componentCount).toBe(1);
    expect([...nav.floorY].every((y) => y === 0.5)).toBe(true);
    expect([...nav.clearance].every((c) => c === 1)).toBe(true);
    // Nó do meio: 4 de eixo + 4 diagonais, todos "walk".
    const mid = nodeAt(nav, 3.5, 0.5, 3.5);
    expect(nav.linkStart[mid + 1]! - nav.linkStart[mid]!).toBe(8);
    const pos = new Float64Array(3);
    nav.nodePosition(mid, pos);
    expect([...pos]).toEqual([3.5, 0.5, 3.5]);
  });

  it('parede separa; porta de 1,0 m (2 células alinhadas) liga por um nó', () => {
    const grid = floorWorld(16, 16);
    box(grid, 0, 1, 8, 15, 8, 9, CONCRETE); // parede de 1 m de espessura em z = 8..9, 4 m de altura (alta demais para cair de cima)
    let nav = buildNavGrid({ grid, blocks: BLOCKS }, METRICS);
    const a = nodeAt(nav, 2.5, 0.5, 1.5);
    const b = nodeAt(nav, 2.5, 0.5, 6.5);
    expect(isReachable(nav, a, b)).toBe(false);
    expect(solve(nav, a, b).status).toBe('unreachable');
    box(grid, 6, 1, 8, 7, 4, 9, 0); // porta: x = 6..7 (3,0–4,0 m), 4 células de altura
    nav = buildNavGrid({ grid, blocks: BLOCKS }, METRICS);
    const a2 = nodeAt(nav, 2.5, 0.5, 1.5);
    const b2 = nodeAt(nav, 2.5, 0.5, 6.5);
    expect(isReachable(nav, a2, b2)).toBe(true);
    const { status, path } = solve(nav, a2, b2);
    expect(status).toBe('found');
    const pos = new Float64Array(3);
    const through = [...path.nodes.subarray(0, path.length)].some((n) => {
      nav.nodePosition(n, pos);
      return pos[0] === 3.5 && pos[2] === 4.5;
    });
    expect(through).toBe(true);
  });

  it('porta desalinhada (x ímpar) não cabe no nó de 1 m', () => {
    const grid = floorWorld(16, 16);
    box(grid, 0, 1, 8, 15, 8, 9, CONCRETE);
    box(grid, 5, 1, 8, 6, 4, 9, 0);
    const nav = buildNavGrid({ grid, blocks: BLOCKS }, METRICS);
    expect(isReachable(nav, nodeAt(nav, 2.5, 0.5, 1.5), nodeAt(nav, 2.5, 0.5, 6.5))).toBe(false);
  });

  it('degrau de 0,5 m anda; de 1,0 m pula subindo e cai descendo', () => {
    const grid = floorWorld(16, 8);
    box(grid, 8, 1, 0, 9, 1, 7, CONCRETE); // degrau de 0,5 m em x = 8..9
    box(grid, 10, 1, 0, 15, 2, 7, CONCRETE); // plataforma de 1,0 m em x ≥ 10
    const nav = buildNavGrid({ grid, blocks: BLOCKS }, METRICS) as NavGridImpl;
    const low = nodeAt(nav, 3.5, 0.5, 1.5);
    const stepN = nodeAt(nav, 4.5, 1, 1.5);
    const high = nodeAt(nav, 5.5, 1.5, 1.5);
    const ground = nodeAt(nav, 2.5, 0.5, 3.5);
    const kindOf = (a: number, b: number): number => {
      for (let l = nav.linkStart[a]!; l < nav.linkStart[a + 1]!; l++)
        if (nav.linkTarget[l] === b) return nav.linkKind[l]!;
      return -1;
    };
    expect(nav.floorY[stepN]).toBe(1);
    expect(kindOf(low, stepN)).toBe(NAV_LINK.step);
    expect(kindOf(stepN, high)).toBe(NAV_LINK.step);
    // Do chão (0,5) direto para a plataforma (1,5) não há coluna vizinha: o teste é o degrau → plataforma.
    const grid2 = floorWorld(8, 8);
    box(grid2, 4, 1, 0, 7, 2, 7, CONCRETE); // 1,0 m acima do chão
    const nav2 = buildNavGrid({ grid: grid2, blocks: BLOCKS }, METRICS) as NavGridImpl;
    const a = nodeAt(nav2, 1.5, 0.5, 1.5);
    const b = nodeAt(nav2, 2.5, 1.5, 1.5);
    const kind2 = (x: number, y: number): number => {
      for (let l = nav2.linkStart[x]!; l < nav2.linkStart[x + 1]!; l++)
        if (nav2.linkTarget[l] === y) return nav2.linkKind[l]!;
      return -1;
    };
    expect(kind2(a, b)).toBe(NAV_LINK.jump);
    expect(kind2(b, a)).toBe(NAV_LINK.drop);
    expect(ground).not.toBe(NO_NAV_NODE);
  });

  it('rampa 1:1 e rampa 1:2 levam a um patamar alto andando', () => {
    // Patamar de 2 m (4 células acima do piso) em x ≥ 12; rampa 1:1 sobe para +X (giro 3: -Z → +X).
    const grid = floorWorld(16, 8);
    box(grid, 12, 1, 0, 15, 4, 7, CONCRETE);
    for (let i = 0; i < 4; i++) {
      const x = 8 + i;
      box(grid, x, 1, 0, x, i, 3, CONCRETE); // apoio (a 1ª coluna não tem: y de 1 a 0)
      box(grid, x, 1 + i, 0, x, 1 + i, 3, makeCell(2, 3));
    }
    // Rampa 1:2 (baixa + alta por nível) em z = 4..7 sobe 2 m em 8 células.
    for (let i = 0; i < 8; i++) {
      const x = 4 + i;
      const level = Math.floor(i / 2);
      if (level > 0) box(grid, x, 1, 4, x, level, 7, CONCRETE);
      box(grid, x, 1 + level, 4, x, 1 + level, 7, makeCell(i % 2 === 0 ? 4 : 5, 3));
    }
    const nav = buildNavGrid({ grid, blocks: BLOCKS }, METRICS);
    const start = nodeAt(nav, 2.5, 0.5, 0.5);
    const top = nodeAt(nav, 7.5, 2.5, 0.5);
    expect(nav.floorY[top]).toBe(2.5);
    const { status, path } = solve(nav, start, top);
    expect(status).toBe('found');
    // Só andando (sem pulo nem queda).
    expect([...path.pointLinks.subarray(0, path.pointCount)].every((k) => k <= NAV_LINK.step)).toBe(true);
    const back = solve(nav, top, start);
    expect(back.status).toBe('found');
  });

  it('teto baixo: nó só agachado e ligação "crouch"; cerca bloqueia; mato não', () => {
    const grid = floorWorld(16, 8);
    box(grid, 8, 3, 0, 9, 3, 7, CONCRETE); // laje de teto a 1,5 m: 1,0 m livre
    box(grid, 0, 1, 6, 15, 2, 6, 6); // cerca (painel) em z = 6
    box(grid, 0, 1, 2, 15, 1, 2, 7); // mato (cruz) em z = 2
    const nav = buildNavGrid({ grid, blocks: BLOCKS }, METRICS) as NavGridImpl;
    const under = nodeAt(nav, 4.5, 0.5, 0.5);
    expect(nav.clearance[under]).toBe(2);
    const left = nodeAt(nav, 3.5, 0.5, 0.5);
    let crouch = false;
    for (let l = nav.linkStart[left]!; l < nav.linkStart[left + 1]!; l++) {
      if (nav.linkTarget[l] === under) crouch = nav.linkKind[l] === NAV_LINK.crouch;
    }
    expect(crouch).toBe(true);
    expect(nodeAt(nav, 1.5, 0.5, 1.5)).not.toBe(NO_NAV_NODE); // mato: andável
    expect(nav.nearestNode(1.5, 0.5, 3.25)).not.toBe(NO_NAV_NODE);
    // Cerca em z = 6 (metros 3,0–3,5): a coluna de nós k = 3 some.
    const fenceCol = nav.columnStart[0 + 3 * nav.columnsX];
    expect(nav.columnStart[1 + 3 * nav.columnsX]! - fenceCol!).toBe(0);
  });

  it('caixa de prop sólida bloqueia nós; andável vira piso', () => {
    const grid = floorWorld(16, 16);
    const boxes = new Float32Array([2, 0.5, 2, 4, 1.5, 4, 5, 0.5, 5, 6, 1, 6]);
    const colliders: StaticColliders = {
      count: 2,
      boxes,
      flags: new Uint8Array([COLLIDER_FLAG.solid, COLLIDER_FLAG.solid | COLLIDER_FLAG.walkable]),
      owner: new Int32Array([0, 1]),
      query: () => {},
    };
    const nav = buildNavGrid({ grid, blocks: BLOCKS, colliders }, METRICS);
    // Bloqueadas: as colunas de nós (2..3, 2..3) debaixo da primeira caixa.
    const impl = nav as NavGridImpl;
    for (const [i, k] of [
      [2, 2],
      [3, 3],
    ] as const) {
      const col = i + k * impl.columnsX;
      expect(impl.columnStart[col + 1]! - impl.columnStart[col]!).toBe(0);
    }
    const onTop = nav.nearestNode(5.5, 1, 5.5);
    expect(nav.floorY[onTop]).toBe(1);
  });

  it('montagem determinística', () => {
    const grid = floorWorld(16, 16);
    box(grid, 4, 1, 4, 9, 4, 9, CONCRETE);
    const a = buildNavGrid({ grid, blocks: BLOCKS }, METRICS) as NavGridImpl;
    const b = buildNavGrid({ grid, blocks: BLOCKS }, METRICS) as NavGridImpl;
    expect(a.nodeCount).toBe(b.nodeCount);
    expect([...a.linkTarget]).toEqual([...b.linkTarget]);
    expect([...a.floorY]).toEqual([...b.floorY]);
  });
});

describe('nav: A* com orçamento', () => {
  it('fatiado: pending até achar; mesmo par devolve o resultado guardado', () => {
    const grid = floorWorld(64, 64);
    for (let z = 4; z < 60; z += 8) box(grid, z % 16 === 4 ? 0 : 8, 1, z, z % 16 === 4 ? 55 : 63, 4, z + 1, CONCRETE);
    const nav = buildNavGrid({ grid, blocks: BLOCKS }, METRICS);
    const a = nodeAt(nav, 1.5, 0.5, 0.5);
    const b = nodeAt(nav, 30.5, 0.5, 13.5);
    const path = createNavPath(nav);
    let calls = 0;
    let status = findPath(nav, a, b, path, 20);
    while (status === 'pending') {
      calls++;
      status = findPath(nav, a, b, path, 20);
    }
    expect(status).toBe('found');
    expect(calls).toBeGreaterThan(3);
    expect(path.nodes[0]).toBe(a);
    expect(path.nodes[path.length - 1]).toBe(b);
    expect(path.pointCount).toBeGreaterThan(1);
    expect(path.pointCount).toBeLessThan(path.length);
    // Pontos consecutivos do caminho bruto são vizinhos (≤ 1 coluna em cada eixo).
    const pa = new Float64Array(3);
    const pb = new Float64Array(3);
    for (let i = 1; i < path.length; i++) {
      nav.nodePosition(path.nodes[i - 1]!, pa);
      nav.nodePosition(path.nodes[i]!, pb);
      expect(Math.abs(pa[0]! - pb[0]!)).toBeLessThanOrEqual(1);
      expect(Math.abs(pa[2]! - pb[2]!)).toBeLessThanOrEqual(1);
    }
    expect(findPath(nav, a, b, path, 0)).toBe('found');
    // Outro alvo recomeça.
    expect(findPath(nav, a, nodeAt(nav, 2.5, 0.5, 0.5), path, 1000)).toBe('found');
    expect(path.length).toBe(2);
  });

  it('o mesmo nó dá um caminho de 1 nó; nó inválido é inalcançável', () => {
    const nav = buildNavGrid({ grid: floorWorld(), blocks: BLOCKS }, METRICS);
    const a = nodeAt(nav, 1.5, 0.5, 1.5);
    const r = solve(nav, a, a);
    expect(r.status).toBe('found');
    expect(r.path.length).toBe(1);
    expect(r.path.pointCount).toBe(1);
    expect(solve(nav, a, NO_NAV_NODE).status).toBe('unreachable');
  });

  it('caminho maior que a capacidade guarda o começo', () => {
    const nav = buildNavGrid({ grid: floorWorld(64, 4), blocks: BLOCKS }, METRICS);
    const a = nodeAt(nav, 0.5, 0.5, 0.5);
    const b = nodeAt(nav, 31.5, 0.5, 0.5);
    const path = createNavPath(nav, 8);
    expect(findPath(nav, a, b, path, 100000)).toBe('found');
    expect(path.length).toBe(8);
    expect(path.nodes[0]).toBe(a);
  });

  it(`pool de ${SEARCH_SLOTS} áreas: o pedido extra espera e anda quando uma área vaga`, () => {
    const grid = floorWorld(64, 64);
    const nav = buildNavGrid({ grid, blocks: BLOCKS }, METRICS);
    const a = nodeAt(nav, 0.5, 0.5, 0.5);
    const b = nodeAt(nav, 31.5, 0.5, 31.5);
    const paths = Array.from({ length: SEARCH_SLOTS + 1 }, () => createNavPath(nav));
    for (const p of paths.slice(0, SEARCH_SLOTS)) expect(findPath(nav, a, b, p, 1)).toBe('pending');
    const extra = paths[SEARCH_SLOTS]!;
    expect(findPath(nav, a, b, extra, 100000)).toBe('pending');
    expect(extra.length).toBe(0);
    expect(findPath(nav, a, b, paths[0]!, 100000)).toBe('found');
    expect(findPath(nav, a, b, extra, 100000)).toBe('found');
  });
});
