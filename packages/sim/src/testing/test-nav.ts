import {
  buildNavGrid,
  NAV_LINK,
  NO_NAV_NODE,
  type NavGrid,
  type NavMetrics,
  type NavNode,
  type NavPath,
  type NavWorld,
  type PathStatus,
} from '@boboforces/nav';
import { assert } from '@boboforces/shared';
import { boxIntersectsSolid, createAabb, createSweepResult, sweepAabb, type Aabb } from '@boboforces/world';

/**
 * NAVEGAÇÃO DE TESTE (dublê da frente "mapa-nav"). Implementa o MESMO contrato de `@boboforces/nav` (`NavGrid`,
 * `NavPath`, `findPath` com orçamento) de um jeito simples e lento, só para os testes da IA, o golden do M1 e o bench
 * headless rodarem enquanto o `buildNavGrid`/`findPath` de verdade não existem. NÃO vai para o jogo.
 *
 * Como funciona: nós de 1 m (2×2 células) por coluna, com vários spans por coluna (térreo, plataforma, telhado). Os
 * pisos e as ligações saem de MOVIMENTOS SIMULADOS com as consultas do world (`sweepAabb`), então valem as mesmas
 * regras de colisão da sim (formas do catálogo inclusive, quando a frente mundo as entregar). A* com heurística
 * octile, orçamento por chamada e um estado de busca compartilhado pela grade (quem chama em fila, como o diretor de
 * IA faz, não perde progresso). O caminho é suavizado só em trechos planos (linha reta checada coluna a coluna).
 */

const box: Aabb = createAabb();
const sw = createSweepResult();

/** Spans durante a montagem (viram typed arrays no fim). */
interface Built {
  floor: number[];
  clear: number[];
  col: number[];
}

/** Estado do A* compartilhado pela grade (um pedido por vez avança; outro pedido recomeça a busca). */
export class TestNavSearch {
  owner: NavPath | null = null;
  from: NavNode = NO_NAV_NODE;
  to: NavNode = NO_NAV_NODE;
  stamp = 0;
  readonly seen: Uint32Array;
  readonly closed: Uint32Array;
  readonly g: Float32Array;
  readonly came: Int32Array;
  readonly heapNode: Int32Array;
  readonly heapF: Float32Array;
  heapSize = 0;

  constructor(n: number) {
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.g = new Float32Array(n);
    this.came = new Int32Array(n);
    this.heapNode = new Int32Array(n * 8 + 16);
    this.heapF = new Float32Array(n * 8 + 16);
  }

  push(node: number, f: number): void {
    let i = this.heapSize++;
    this.heapNode[i] = node;
    this.heapF[i] = f;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.heapF[p]! < f || (this.heapF[p] === f && this.heapNode[p]! <= node)) break;
      this.heapNode[i] = this.heapNode[p]!;
      this.heapF[i] = this.heapF[p]!;
      this.heapNode[p] = node;
      this.heapF[p] = f;
      i = p;
    }
  }

  pop(): number {
    const top = this.heapNode[0]!;
    const n = --this.heapSize;
    if (n > 0) {
      const node = this.heapNode[n]!;
      const f = this.heapF[n]!;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        let c = l;
        if (
          r < n &&
          (this.heapF[r]! < this.heapF[l]! ||
            (this.heapF[r] === this.heapF[l] && this.heapNode[r]! < this.heapNode[l]!))
        )
          c = r;
        if (this.heapF[c]! > f || (this.heapF[c] === f && this.heapNode[c]! >= node)) break;
        this.heapNode[i] = this.heapNode[c]!;
        this.heapF[i] = this.heapF[c]!;
        i = c;
      }
      this.heapNode[i] = node;
      this.heapF[i] = f;
    }
    return top;
  }
}

/** Grade de navegação de teste: o `NavGrid` do contrato mais o que o A* daqui precisa. */
export interface TestNavGrid extends NavGrid {
  readonly linkStart: Int32Array;
  readonly linkTo: Int32Array;
  readonly linkKind: Uint8Array;
  readonly linkCost: Float32Array;
  readonly columnStart: Int32Array;
  readonly nodeColumn: Int32Array;
  /** @internal */
  readonly search: TestNavSearch;
}

function setFeetBox(b: Aabb, x: number, y: number, z: number, r: number, h: number): void {
  b.minX = x - r;
  b.maxX = x + r;
  b.minZ = z - r;
  b.maxZ = z + r;
  b.minY = y;
  b.maxY = y + h;
}

/**
 * Monta a navegação de teste a partir do mundo (lento: só para testes e bench). Mesmas regras do contrato: degrau até
 * `stepHeight` andando, pulo até `jumpHeight`, queda até `maxDrop`, altura livre em pé ou só agachado.
 */
export function buildTestNav(world: NavWorld, metrics: NavMetrics): TestNavGrid {
  const { grid, blocks } = world;
  const colliders = world.colliders ?? null;
  const r = metrics.radius;
  const columnsX = Math.ceil(grid.sizeX / 2);
  const columnsZ = Math.ceil(grid.sizeZ / 2);
  const built: Built = { floor: [], clear: [], col: [] };
  const columnStart = new Int32Array(columnsX * columnsZ + 1);

  for (let cz = 0; cz < columnsZ; cz++) {
    for (let cx = 0; cx < columnsX; cx++) {
      const c = cx + cz * columnsX;
      columnStart[c] = built.floor.length;
      // Camada mais alta com algo nas 4 células da coluna (acima disso é céu).
      let top = -1;
      for (let ly = grid.sizeY - 1; ly >= 0 && top < 0; ly--) {
        for (let k = 0; k < 4; k++) {
          if (grid.get(cx * 2 + (k & 1), ly, cz * 2 + (k >> 1)) !== 0) {
            top = ly;
            break;
          }
        }
      }
      const x = cx + 0.5;
      const z = cz + 0.5;
      let last = Infinity;
      for (let ly = Math.min(grid.sizeY - 1, top + 1); ly >= 0; ly--) {
        setFeetBox(box, x, ly * 0.5 + 0.01, z, r, metrics.crouchHeight);
        if (boxIntersectsSolid(grid, blocks, box)) continue;
        sweepAabb(grid, blocks, box, 0, -0.6, 0, 0, sw, colliders);
        if (!sw.onGround) continue;
        const floor = box.minY;
        if (Math.abs(floor - last) < 0.05) continue;
        last = floor;
        // Em pé cabe? Caixa agachada varrida para cima (respeita laje e teto).
        setFeetBox(box, x, floor, z, r, metrics.crouchHeight);
        sweepAabb(grid, blocks, box, 0, metrics.height - metrics.crouchHeight, 0, 0, sw, colliders);
        built.floor.push(floor);
        built.clear.push(sw.hitY ? 2 : 1);
        built.col.push(c);
      }
    }
  }
  columnStart[columnsX * columnsZ] = built.floor.length;
  const nodeCount = built.floor.length;
  assert(nodeCount < 0xffff, 'nav de teste: nós demais');
  const floorY = Float32Array.from(built.floor);
  const clearance = Uint8Array.from(built.clear);
  const nodeColumn = Int32Array.from(built.col);

  // Ligações por movimento simulado entre colunas vizinhas (8 direções).
  const linkStart = new Int32Array(nodeCount + 1);
  const to: number[] = [];
  const kinds: number[] = [];
  const costs: number[] = [];
  for (let a = 0; a < nodeCount; a++) {
    linkStart[a] = to.length;
    const c = nodeColumn[a]!;
    const cx = c % columnsX;
    const cz = (c - cx) / columnsX;
    const fa = floorY[a]!;
    const height = clearance[a] === 1 ? metrics.height : metrics.crouchHeight;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= columnsX || nz >= columnsZ) continue;
        const nc = nx + nz * columnsX;
        for (let b = columnStart[nc]!; b < columnStart[nc + 1]!; b++) {
          const fb = floorY[b]!;
          const dy = fb - fa;
          let kind: number;
          if (Math.abs(dy) <= 0.05) kind = NAV_LINK.walk;
          else if (Math.abs(dy) <= metrics.stepHeight + 0.01) kind = NAV_LINK.step;
          else if (dy > 0 && dy <= metrics.jumpHeight + 0.01) kind = NAV_LINK.jump;
          else if (dy < 0 && -dy <= metrics.maxDrop + 0.01) kind = NAV_LINK.drop;
          else continue;
          if (clearance[a] === 2 || clearance[b] === 2) kind = kind === NAV_LINK.walk ? NAV_LINK.crouch : kind;
          // Simula o movimento: (pula,) anda no plano até o centro do vizinho e desce até o chão.
          setFeetBox(
            box,
            cx + 0.5,
            fa,
            cz + 0.5,
            r,
            Math.min(height, clearance[b] === 1 ? metrics.height : metrics.crouchHeight),
          );
          if (kind === NAV_LINK.jump) {
            sweepAabb(grid, blocks, box, 0, metrics.jumpHeight + 0.02, 0, 0, sw, colliders);
            if (sw.hitY) continue;
          }
          sweepAabb(grid, blocks, box, dx, 0, dz, kind === NAV_LINK.drop ? 0 : metrics.stepHeight, sw, colliders);
          if (Math.abs(sw.dx - dx) > 1e-6 || Math.abs(sw.dz - dz) > 1e-6) continue;
          sweepAabb(grid, blocks, box, 0, -(metrics.maxDrop + 1), 0, 0, sw, colliders);
          if (!sw.onGround || Math.abs(box.minY - fb) > 0.05) continue;
          to.push(b);
          kinds.push(kind);
          const horiz = dx !== 0 && dz !== 0 ? Math.SQRT2 : 1;
          costs.push(
            horiz + (kind === NAV_LINK.jump ? 1 : kind === NAV_LINK.drop ? 0.5 : kind === NAV_LINK.crouch ? 1 : 0),
          );
        }
      }
    }
  }
  linkStart[nodeCount] = to.length;
  const linkTo = Int32Array.from(to);
  const linkKind = Uint8Array.from(kinds);
  const linkCost = Float32Array.from(costs);

  // Componentes: ligações nos dois sentidos (o contrato conta a queda como ida e volta para isto).
  const component = new Uint16Array(nodeCount).fill(0xffff);
  const adj: number[][] = Array.from({ length: nodeCount }, () => []);
  for (let a = 0; a < nodeCount; a++) {
    for (let l = linkStart[a]!; l < linkStart[a + 1]!; l++) {
      adj[a]!.push(linkTo[l]!);
      adj[linkTo[l]!]!.push(a);
    }
  }
  let comp = 0;
  const stack: number[] = [];
  for (let s = 0; s < nodeCount; s++) {
    if (component[s] !== 0xffff) continue;
    component[s] = comp;
    stack.push(s);
    while (stack.length > 0) {
      const n = stack.pop()!;
      for (const m of adj[n]!) {
        if (component[m] !== 0xffff) continue;
        component[m] = comp;
        stack.push(m);
      }
    }
    comp++;
  }

  const nearestNode = (x: number, y: number, z: number): NavNode => {
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    let best = NO_NAV_NODE;
    let bestScore = Infinity;
    for (let ring = 0; ring <= 2 && best === NO_NAV_NODE; ring++) {
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= columnsX || nz >= columnsZ) continue;
          const c = nx + nz * columnsX;
          for (let n = columnStart[c]!; n < columnStart[c + 1]!; n++) {
            const f = floorY[n]!;
            // Prefere o piso sob os pés (até 0,6 m acima dele conta como "em cima").
            const dyAbove = y - f;
            const vertical = dyAbove >= -0.6 ? Math.abs(dyAbove) : 10 + Math.abs(dyAbove);
            const ddx = nx + 0.5 - x;
            const ddz = nz + 0.5 - z;
            const score = vertical * 2 + Math.sqrt(ddx * ddx + ddz * ddz);
            if (score < bestScore) {
              bestScore = score;
              best = n;
            }
          }
        }
      }
    }
    return best;
  };

  return {
    columnsX,
    columnsZ,
    nodeCount,
    floorY,
    clearance,
    component,
    linkStart,
    linkTo,
    linkKind,
    linkCost,
    columnStart,
    nodeColumn,
    search: new TestNavSearch(nodeCount),
    nearestNode,
    nodePosition(node, out, offset = 0) {
      const c = nodeColumn[node]!;
      const cx = c % columnsX;
      out[offset] = cx + 0.5;
      out[offset + 1] = floorY[node]!;
      out[offset + 2] = (c - cx) / columnsX + 0.5;
    },
  };
}

/** `createNavPath` da navegação de teste (mesmo contrato). */
export function createTestNavPath(nav: NavGrid, capacity = 256): NavPath {
  void nav;
  return {
    capacity,
    status: 'idle',
    from: NO_NAV_NODE,
    to: NO_NAV_NODE,
    nodes: new Int32Array(capacity),
    length: 0,
    points: new Float32Array(capacity * 3),
    pointCount: 0,
    pointLinks: new Uint8Array(capacity),
  };
}

type MutablePath = { -readonly [K in keyof NavPath]: NavPath[K] };

function heuristic(nav: TestNavGrid, a: number, b: number): number {
  const ca = nav.nodeColumn[a]!;
  const cb = nav.nodeColumn[b]!;
  const ax = ca % nav.columnsX;
  const bx = cb % nav.columnsX;
  const dx = Math.abs(ax - bx);
  const dz = Math.abs((ca - ax) / nav.columnsX - (cb - bx) / nav.columnsX);
  return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
}

/** Dá para andar em linha reta de `a` até `b` no mesmo piso plano (colunas sob os cantos da AABB, a cada 0,25 m)? */
function straightWalk(nav: TestNavGrid, a: number, b: number, radius: number): boolean {
  const fa = nav.floorY[a]!;
  if (Math.abs(nav.floorY[b]! - fa) > 0.05 || nav.clearance[a] !== 1 || nav.clearance[b] !== 1) return false;
  const ca = nav.nodeColumn[a]!;
  const cb = nav.nodeColumn[b]!;
  const ax = (ca % nav.columnsX) + 0.5;
  const az = Math.floor(ca / nav.columnsX) + 0.5;
  const bx = (cb % nav.columnsX) + 0.5;
  const bz = Math.floor(cb / nav.columnsX) + 0.5;
  const len = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(len / 0.25));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = ax + (bx - ax) * t;
    const pz = az + (bz - az) * t;
    for (let k = 0; k < 4; k++) {
      const qx = Math.floor(px + ((k & 1) === 0 ? -radius : radius));
      const qz = Math.floor(pz + ((k & 2) === 0 ? -radius : radius));
      if (qx < 0 || qz < 0 || qx >= nav.columnsX || qz >= nav.columnsZ) return false;
      const c = qx + qz * nav.columnsX;
      let ok = false;
      for (let n = nav.columnStart[c]!; n < nav.columnStart[c + 1]!; n++) {
        if (Math.abs(nav.floorY[n]! - fa) <= 0.05 && nav.clearance[n] === 1) {
          ok = true;
          break;
        }
      }
      if (!ok) return false;
    }
  }
  return true;
}

/** `findPath` da navegação de teste: A* fatiado pelo orçamento (`budget` nós expandidos por chamada). */
export function findTestPath(nav: NavGrid, from: NavNode, to: NavNode, out: NavPath, budget: number): PathStatus {
  const t = nav as TestNavGrid;
  const p = out as MutablePath;
  const s = t.search;
  if (from === NO_NAV_NODE || to === NO_NAV_NODE || nav.component[from] !== nav.component[to]) {
    p.from = from;
    p.to = to;
    p.status = 'unreachable';
    p.length = 0;
    p.pointCount = 0;
    return 'unreachable';
  }
  const fresh = s.owner !== out || s.from !== from || s.to !== to || out.status !== 'pending';
  if (fresh) {
    s.owner = out;
    s.from = from;
    s.to = to;
    s.stamp++;
    s.heapSize = 0;
    s.seen[from] = s.stamp;
    s.g[from] = 0;
    s.came[from] = -1;
    s.push(from, heuristic(t, from, to));
    p.from = from;
    p.to = to;
  }
  p.status = 'pending';
  let expanded = 0;
  while (s.heapSize > 0) {
    if (expanded >= budget) return 'pending';
    const n = s.pop();
    if (s.closed[n] === s.stamp) continue;
    s.closed[n] = s.stamp;
    expanded++;
    if (n === to) return finish(t, s, out, p);
    const gn = s.g[n]!;
    for (let l = t.linkStart[n]!; l < t.linkStart[n + 1]!; l++) {
      const m = t.linkTo[l]!;
      if (s.closed[m] === s.stamp) continue;
      const gm = gn + t.linkCost[l]!;
      if (s.seen[m] === s.stamp && gm >= s.g[m]!) continue;
      s.seen[m] = s.stamp;
      s.g[m] = gm;
      s.came[m] = n;
      s.push(m, gm + heuristic(t, m, to));
    }
  }
  s.owner = null;
  p.status = 'unreachable';
  p.length = 0;
  p.pointCount = 0;
  return 'unreachable';
}

function linkKindBetween(t: TestNavGrid, a: number, b: number): number {
  for (let l = t.linkStart[a]!; l < t.linkStart[a + 1]!; l++) if (t.linkTo[l] === b) return t.linkKind[l]!;
  return NAV_LINK.walk;
}

function finish(t: TestNavGrid, s: TestNavSearch, out: NavPath, p: MutablePath): PathStatus {
  s.owner = null;
  // Caminho de trás para a frente.
  let len = 0;
  for (let n = s.to; n !== -1; n = s.came[n]!) {
    if (len >= out.capacity) {
      p.status = 'unreachable';
      p.length = 0;
      p.pointCount = 0;
      return 'unreachable';
    }
    out.nodes[len++] = n;
  }
  out.nodes.subarray(0, len).reverse();
  p.length = len;
  // Pontos: o início, depois cada nó que não dá para pular em linha reta (trechos planos viram 1 segmento).
  let count = 0;
  const pushPoint = (node: number, link: number): void => {
    t.nodePosition(node, out.points, count * 3);
    out.pointLinks[count] = link;
    count++;
  };
  pushPoint(out.nodes[0]!, NAV_LINK.walk);
  let anchor = 0;
  let i = 1;
  while (i < len) {
    let j = i;
    // Avança enquanto o trecho anchor → j+1 é plano, só de andar e em linha reta.
    while (
      j + 1 < len &&
      linkKindBetween(t, out.nodes[j]!, out.nodes[j + 1]!) === NAV_LINK.walk &&
      linkKindBetween(t, out.nodes[anchor]!, out.nodes[anchor + 1]!) === NAV_LINK.walk &&
      straightWalk(t, out.nodes[anchor]!, out.nodes[j + 1]!, 0.3)
    ) {
      j++;
    }
    pushPoint(out.nodes[j]!, linkKindBetween(t, out.nodes[j - 1]!, out.nodes[j]!));
    anchor = j;
    i = j + 1;
  }
  p.pointCount = count;
  p.status = 'found';
  return 'found';
}

/** As funções de caminho da navegação de teste, no formato que a IA aceita (`NavPathApi` do ai). */
export const TEST_NAV_PATHS = { createNavPath: createTestNavPath, findPath: findTestPath } as const;

/**
 * A navegação de verdade (`buildNavGrid` do `nav`) se a frente mapa-nav já a entregou; senão, a de teste. `real` diz
 * qual (o bench troca as funções de caminho junto).
 */
export function buildNavOrTestNav(
  world: NavWorld,
  metrics: NavMetrics,
): { readonly nav: NavGrid; readonly real: boolean } {
  try {
    return { nav: buildNavGrid(world, metrics), real: true };
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith('M1: frente')) throw err;
    return { nav: buildTestNav(world, metrics), real: false };
  }
}
