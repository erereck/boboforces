import {
  BLOCK_FLAG,
  BLOCK_SIZE,
  CHUNK_SHIFT,
  CHUNK_SIZE,
  COLLIDER_FLAG,
  COLLIDER_STRIDE,
  MAX_SHAPE_BOXES,
  SHAPE_BOX_STRIDE,
  SHAPE_STEPS,
  shapeCollision,
  shapeCollisionBoxes,
  shapeFloorHeight,
  type ShapeId,
} from '@boboforces/world';
import { MAX_NAV_GATES, NAV_LINK, NAV_NODE_CELLS, NAV_NODE_SIZE_M, NO_NAV_NODE, type NavNode } from './constants.ts';
import type { NavGrid, NavMetrics, NavWorld } from './index.ts';
import { createSearchPool, type SearchPool } from './search.ts';

/**
 * Montagem da grade 2,5D (tecnico.md §8.1). Só no loading e no `mapc`; linear no tamanho do mapa e sem objeto por
 * célula ou por ligação (o Switch roda JS interpretado: o laço precisa ser magro).
 *
 * 1. Por coluna de CÉLULA (0,5 m): junta os intervalos sólidos (formas do catálogo, por um MOLDE pré-calculado por
 *    bloco × orientação a partir das tabelas de `shapes.ts`, e caixas das props) e acha as SUPERFÍCIES: topo andável
 *    (cubo, laje, degrau, rampa; bloco com `solid` + `walkable`) com altura livre ≥ agachado em cima. Cada superfície
 *    guarda a altura no centro e nas 4 bordas (rampas!).
 * 2. Por coluna de NÓ (2×2 células = 1 m): forma um nó quando as 4 células têm superfícies dentro de um degrau umas das
 *    outras (a mais baixa livre é a referência). Piso do nó = maior altura de centro; altura livre = menor teto − maior
 *    piso: ≥ `height` em pé (1), ≥ `crouchHeight` só agachado (2).
 * 3. Ligações para as 8 vizinhas: nas 4 de eixo, compara as alturas das BORDAS que se encostam (rampa é contínua na
 *    borda, mesmo subindo 1 m por nó): ≤ degrau anda; subir até o pulo é `jump`; descer até `maxDrop` é `drop`. Nas
 *    diagonais, só andando e só se os dois caminhos em L existem (sem cortar quina).
 * 4. Componentes conexos (union-find, ligações nos dois sentidos) para o `isReachable` O(1).
 */

/** Folga numérica (metros) nas comparações de altura. */
const EPS = 1e-4;
const SQRT2 = Math.SQRT2;

/** Custos extras das ligações (metros equivalentes): a IA prefere andar, depois degrau, depois pular. */
export const NAV_COST = {
  step: 0.15,
  jump: 1.5,
  drop: 0.5,
  dropPerMeter: 0.3,
  crouchFactor: 2,
} as const;

/** Bordas da superfície da célula: +X, -X, +Z, -Z. */
const EDGE_PX = 0;
const EDGE_NX = 1;
const EDGE_PZ = 2;
const EDGE_NZ = 3;

/** Implementação concreta (o `findPath` e o `mapc` leem os campos extras). */
export interface NavGridImpl extends NavGrid {
  readonly metrics: NavMetrics;
  /** Primeiro nó de cada coluna de nós (`columnsX * columnsZ + 1` entradas); nós da coluna em ordem de altura. */
  readonly columnStart: Int32Array;
  /** Coluna (`i + k * columnsX`) de cada nó. */
  readonly nodeColumn: Int32Array;
  /** Ponto mais alto do piso sob o nó e teto (metros; `Infinity` = céu aberto). */
  readonly topY: Float32Array;
  readonly ceilY: Float32Array;
  /** Ligações em CSR: as de `node` vão de `linkStart[node]` a `linkStart[node + 1]`. */
  readonly linkStart: Int32Array;
  readonly linkTarget: Int32Array;
  readonly linkKind: Uint8Array;
  readonly linkCost: Float32Array;
  readonly componentCount: number;
  /** M3 (fase 3d): portão de cada ligação (-1 = nenhum) e o bloqueio de cada portão (`NAV_GATE_BLOCK`). */
  readonly linkGate: Int16Array;
  readonly gateBlock: Uint8Array;
  /** Caminhos criados (`createNavPath`) e as áreas de trabalho do A* compartilhadas. */
  pathCount: number;
  readonly search: SearchPool;
}

/**
 * Molde de colisão por bloco × orientação (índice `bloco * 8 + orientação`), relativo à base da célula, em metros:
 * base e topo do intervalo sólido, se o topo é piso andável, e as alturas do piso no centro, nas 4 bordas (máximo de
 * 2 pontos por borda) e o ponto mais alto (cantos incluídos).
 */
interface Templates {
  readonly solid: Uint8Array;
  readonly floor: Uint8Array;
  readonly bottom: Float32Array;
  readonly top: Float32Array;
  readonly center: Float32Array;
  readonly topMax: Float32Array;
  readonly edges: Float32Array;
}

function buildTemplates(flagsOf: Uint16Array, shapesOf: Uint8Array): Templates {
  const n = flagsOf.length * 8;
  const t: Templates = {
    solid: new Uint8Array(n),
    floor: new Uint8Array(n),
    bottom: new Float32Array(n),
    top: new Float32Array(n),
    center: new Float32Array(n),
    topMax: new Float32Array(n),
    edges: new Float32Array(n * 4),
  };
  const boxes = new Float32Array(MAX_SHAPE_BOXES * SHAPE_BOX_STRIDE);
  for (let block = 1; block < flagsOf.length; block++) {
    const flags = flagsOf[block]!;
    if ((flags & BLOCK_FLAG.solid) === 0) continue;
    const shape = shapesOf[block]! as ShapeId;
    const walkable = (flags & BLOCK_FLAG.walkable) !== 0;
    for (let o = 0; o < 8; o++) {
      const i = block * 8 + o;
      const kind = shapeCollision(shape, o);
      if (kind === 'none') continue;
      t.solid[i] = 1;
      const h = (fx: number, fz: number): number => shapeFloorHeight(shape, o, fx, fz);
      const hasFloor = h(0.5, 0.5) >= 0;
      let bottom = 0;
      let top = 1;
      if (kind === 'boxes') {
        const count = shapeCollisionBoxes(shape, o, boxes);
        let minY = SHAPE_STEPS;
        let maxY = 0;
        for (let b = 0; b < count; b++) {
          minY = Math.min(minY, boxes[b * SHAPE_BOX_STRIDE + 1]!);
          maxY = Math.max(maxY, boxes[b * SHAPE_BOX_STRIDE + 4]!);
        }
        bottom = minY / SHAPE_STEPS;
        top = maxY / SHAPE_STEPS;
      }
      if (hasFloor) {
        const c = h(0.5, 0.5);
        const px = Math.max(h(1, 0.25), h(1, 0.75));
        const nx = Math.max(h(0, 0.25), h(0, 0.75));
        const pz = Math.max(h(0.25, 1), h(0.75, 1));
        const nz = Math.max(h(0.25, 0), h(0.75, 0));
        const max = Math.max(c, px, nx, pz, nz, h(0, 0), h(1, 0), h(0, 1), h(1, 1));
        if (kind === 'slope') top = max;
        t.center[i] = c * BLOCK_SIZE;
        t.edges[i * 4 + EDGE_PX] = px * BLOCK_SIZE;
        t.edges[i * 4 + EDGE_NX] = nx * BLOCK_SIZE;
        t.edges[i * 4 + EDGE_PZ] = pz * BLOCK_SIZE;
        t.edges[i * 4 + EDGE_NZ] = nz * BLOCK_SIZE;
        t.topMax[i] = max * BLOCK_SIZE;
        t.floor[i] = walkable ? 1 : 0;
      } else {
        t.center[i] = t.topMax[i] = top * BLOCK_SIZE;
        for (let e = 0; e < 4; e++) t.edges[i * 4 + e] = top * BLOCK_SIZE;
      }
      t.bottom[i] = bottom * BLOCK_SIZE;
      t.top[i] = top * BLOCK_SIZE;
    }
  }
  return t;
}

/** Lista de números que cresce (typed array por baixo; só na montagem). */
class GrowF64 {
  data = new Float64Array(1024);
  length = 0;
  push(v: number): void {
    if (this.length === this.data.length) {
      const next = new Float64Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = v;
  }
}

export function buildNavGridImpl(world: NavWorld, metrics: NavMetrics): NavGridImpl {
  if (!(metrics.radius > 0 && metrics.radius * 2 <= NAV_NODE_SIZE_M)) {
    throw new Error('nav: o bobo precisa caber no nó de 1,0 m');
  }
  const grid = world.grid;
  const sizeX = grid.sizeX;
  const sizeY = grid.sizeY;
  const sizeZ = grid.sizeZ;
  const cellColumns = sizeX * sizeZ;
  const tpl = buildTemplates(world.blocks.flags, world.blocks.shapes);

  // --- Colisores das props por coluna de célula (só os sólidos; só props do jogo, filtradas no loading e no mapc) ---
  const propStart = new Int32Array(cellColumns + 1);
  let propList = new Int32Array(0);
  const colliders = world.colliders ?? null;
  if (colliders && colliders.count > 0) {
    const range = (i: number): [number, number, number, number] => {
      const o = i * COLLIDER_STRIDE;
      return [
        Math.max(0, Math.floor((colliders.boxes[o]! + EPS) / BLOCK_SIZE)),
        Math.max(0, Math.floor((colliders.boxes[o + 2]! + EPS) / BLOCK_SIZE)),
        Math.min(sizeX - 1, Math.floor((colliders.boxes[o + 3]! - EPS) / BLOCK_SIZE)),
        Math.min(sizeZ - 1, Math.floor((colliders.boxes[o + 5]! - EPS) / BLOCK_SIZE)),
      ];
    };
    const counts = new Int32Array(cellColumns);
    for (let i = 0; i < colliders.count; i++) {
      if ((colliders.flags[i]! & COLLIDER_FLAG.solid) === 0) continue;
      const [x0, z0, x1, z1] = range(i);
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) counts[x + z * sizeX]!++;
    }
    for (let c = 0; c < cellColumns; c++) propStart[c + 1] = propStart[c]! + counts[c]!;
    propList = new Int32Array(propStart[cellColumns]!);
    counts.fill(0);
    for (let i = 0; i < colliders.count; i++) {
      if ((colliders.flags[i]! & COLLIDER_FLAG.solid) === 0) continue;
      const [x0, z0, x1, z1] = range(i);
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const c = x + z * sizeX;
          propList[propStart[c]! + counts[c]!++] = i;
        }
      }
    }
  }

  // --- 1. Superfícies por coluna de célula ---
  // Pedaços da coluna (rascunho): base, topo, piso?, centro, ponto mais alto e 4 bordas, em metros.
  const cap = sizeY + 64;
  const pb = new Float64Array(cap);
  const pt = new Float64Array(cap);
  const pf = new Uint8Array(cap);
  const pc = new Float64Array(cap);
  const pm = new Float64Array(cap);
  const pe = new Float64Array(cap * 4);
  const order = new Int32Array(cap);
  // Intervalos juntados.
  const mb = new Float64Array(cap);
  const mt = new Float64Array(cap);
  const mf = new Uint8Array(cap);
  const mc = new Float64Array(cap);
  const mm = new Float64Array(cap);
  const me = new Float64Array(cap * 4);
  const surfStart = new Int32Array(cellColumns + 1);
  const sCenter = new GrowF64();
  const sTop = new GrowF64();
  const sCeil = new GrowF64();
  const sEdge = new GrowF64();
  const chunksY = Math.ceil(sizeY / CHUNK_SIZE);

  for (let z = 0; z < sizeZ; z++) {
    const cz = z >> CHUNK_SHIFT;
    const lz = z & (CHUNK_SIZE - 1);
    for (let x = 0; x < sizeX; x++) {
      const column = x + z * sizeX;
      surfStart[column] = sCenter.length;
      const cx = x >> CHUNK_SHIFT;
      const lx = x & (CHUNK_SIZE - 1);
      let n = 0;
      for (let cy = 0; cy < chunksY; cy++) {
        const chunk = grid.getChunk(cx, cy, cz);
        if (chunk === null) continue;
        const cells = chunk.cells;
        const base = cy * CHUNK_SIZE;
        const top = Math.min(CHUNK_SIZE, sizeY - base);
        if (cells === null && chunk.uniform === 0) continue;
        const colIndex = lx | (lz << CHUNK_SHIFT);
        for (let ly = 0; ly < top; ly++) {
          const cell: number = cells === null ? chunk.uniform : cells[colIndex | (ly << (CHUNK_SHIFT * 2))]!;
          if (cell === 0) continue;
          const t = (cell & 0x3ff) * 8 + ((cell >>> 10) & 7);
          if (tpl.solid[t] !== 1) continue;
          const y0 = (base + ly) * BLOCK_SIZE;
          pb[n] = y0 + tpl.bottom[t]!;
          pt[n] = y0 + tpl.top[t]!;
          pf[n] = tpl.floor[t]!;
          pc[n] = y0 + tpl.center[t]!;
          pm[n] = y0 + tpl.topMax[t]!;
          for (let e = 0; e < 4; e++) pe[n * 4 + e] = y0 + tpl.edges[t * 4 + e]!;
          order[n] = n;
          n++;
        }
      }
      const p0 = propStart[column]!;
      const p1 = propStart[column + 1]!;
      if (colliders && p1 > p0) {
        for (let p = p0; p < p1 && n < cap; p++) {
          const o = propList[p]! * COLLIDER_STRIDE;
          const top = colliders.boxes[o + 4]!;
          pb[n] = colliders.boxes[o + 1]!;
          pt[n] = top;
          pf[n] = (colliders.flags[propList[p]!]! & COLLIDER_FLAG.walkable) !== 0 ? 1 : 0;
          pc[n] = pm[n] = top;
          for (let e = 0; e < 4; e++) pe[n * 4 + e] = top;
          order[n] = n;
          n++;
        }
        // Ordena por base (inserção sobre os índices: listas curtas).
        for (let a = 1; a < n; a++) {
          const cur = order[a]!;
          let b = a - 1;
          while (b >= 0 && pb[order[b]!]! > pb[cur]!) {
            order[b + 1] = order[b]!;
            b--;
          }
          order[b + 1] = cur;
        }
      }
      // Junta os intervalos que se encostam; o pedaço mais alto define o topo (empate: o andável ganha).
      let m = 0;
      for (let a = 0; a < n; a++) {
        const p = order[a]!;
        if (m > 0 && pb[p]! <= mt[m - 1]! + EPS) {
          const last = m - 1;
          if (pt[p]! > mt[last]! + EPS || (pt[p]! >= mt[last]! - EPS && pf[p] === 1 && mf[last] === 0)) {
            mt[last] = pt[p]!;
            mf[last] = pf[p]!;
            mc[last] = pc[p]!;
            mm[last] = pm[p]!;
            for (let e = 0; e < 4; e++) me[last * 4 + e] = pe[p * 4 + e]!;
          }
          continue;
        }
        mb[m] = pb[p]!;
        mt[m] = pt[p]!;
        mf[m] = pf[p]!;
        mc[m] = pc[p]!;
        mm[m] = pm[p]!;
        for (let e = 0; e < 4; e++) me[m * 4 + e] = pe[p * 4 + e]!;
        m++;
      }
      for (let a = 0; a < m; a++) {
        if (mf[a] !== 1) continue;
        const ceil = a + 1 < m ? mb[a + 1]! : Infinity;
        if (ceil - mm[a]! < metrics.crouchHeight - EPS) continue;
        sCenter.push(mc[a]!);
        sTop.push(mm[a]!);
        sCeil.push(ceil);
        for (let e = 0; e < 4; e++) sEdge.push(me[a * 4 + e]!);
      }
    }
  }
  surfStart[cellColumns] = sCenter.length;
  const sC = sCenter.data;
  const sT = sTop.data;
  const sL = sCeil.data;
  const sE = sEdge.data;

  // --- 2. Nós (2×2 células) ---
  const columnsX = Math.ceil(sizeX / NAV_NODE_CELLS);
  const columnsZ = Math.ceil(sizeZ / NAV_NODE_CELLS);
  const nodeColumns = columnsX * columnsZ;
  const columnStart = new Int32Array(nodeColumns + 1);
  const nFloor = new GrowF64();
  const nTop = new GrowF64();
  const nCeil = new GrowF64();
  const nClear = new GrowF64();
  const nCol = new GrowF64();
  const nSurf = new GrowF64();
  const used = new Uint8Array(sCenter.length);
  const cellCol = new Int32Array(4);
  const chosen = new Int32Array(4);
  const step = metrics.stepHeight;
  for (let k = 0; k < columnsZ; k++) {
    for (let i = 0; i < columnsX; i++) {
      const column = i + k * columnsX;
      columnStart[column] = nFloor.length;
      const x0 = i * NAV_NODE_CELLS;
      const z0 = k * NAV_NODE_CELLS;
      if (x0 + 1 >= sizeX || z0 + 1 >= sizeZ) continue;
      cellCol[0] = x0 + z0 * sizeX;
      cellCol[1] = x0 + 1 + z0 * sizeX;
      cellCol[2] = x0 + (z0 + 1) * sizeX;
      cellCol[3] = x0 + 1 + (z0 + 1) * sizeX;
      for (;;) {
        // Referência: a superfície livre mais baixa das 4 células.
        let ref = -1;
        let refCell = -1;
        for (let c = 0; c < 4; c++) {
          const col = cellCol[c]!;
          for (let s = surfStart[col]!; s < surfStart[col + 1]!; s++) {
            if (used[s] === 1) continue;
            if (ref < 0 || sC[s]! < sC[ref]!) {
              ref = s;
              refCell = c;
            }
            break;
          }
        }
        if (ref < 0) break;
        chosen[refCell] = ref;
        let ok = true;
        for (let c = 0; c < 4 && ok; c++) {
          if (c === refCell) continue;
          const col = cellCol[c]!;
          let found = -1;
          for (let s = surfStart[col]!; s < surfStart[col + 1]!; s++) {
            if (used[s] === 1) continue;
            const h = sC[s]!;
            if (h > sC[ref]! + step + EPS) break;
            if (h >= sC[ref]! - EPS) {
              found = s;
              break;
            }
          }
          if (found < 0) ok = false;
          else chosen[c] = found;
        }
        if (!ok) {
          used[ref] = 1;
          continue;
        }
        let floor = -Infinity;
        let top = -Infinity;
        let ceil = Infinity;
        for (let c = 0; c < 4; c++) {
          const s = chosen[c]!;
          floor = Math.max(floor, sC[s]!);
          top = Math.max(top, sT[s]!);
          ceil = Math.min(ceil, sL[s]!);
        }
        const free = ceil - top;
        if (free < metrics.crouchHeight - EPS) {
          used[ref] = 1;
          continue;
        }
        for (let c = 0; c < 4; c++) used[chosen[c]!] = 1;
        nFloor.push(floor);
        nTop.push(top);
        nCeil.push(ceil);
        nClear.push(free >= metrics.height - EPS ? 1 : 2);
        nCol.push(column);
        for (let c = 0; c < 4; c++) nSurf.push(chosen[c]!);
      }
    }
  }
  columnStart[nodeColumns] = nFloor.length;
  const nodeCount = nFloor.length;
  const floorY = Float32Array.from(nFloor.data.subarray(0, nodeCount));
  const topY = Float32Array.from(nTop.data.subarray(0, nodeCount));
  const ceilY = Float32Array.from(nCeil.data.subarray(0, nodeCount));
  const clearance = Uint8Array.from(nClear.data.subarray(0, nodeCount));
  const nodeColumn = Int32Array.from(nCol.data.subarray(0, nodeCount));
  const surf = Int32Array.from(nSurf.data.subarray(0, nodeCount * 4));

  // --- 3. Ligações ---
  // Por direção de eixo: [célula de A, célula de B] × 2 na borda comum, borda de A, borda de B.
  const DIR_DX = [1, -1, 0, 0];
  const DIR_DZ = [0, 0, 1, -1];
  const DIR_PAIRS = [1, 0, 3, 2, 0, 1, 2, 3, 2, 0, 3, 1, 0, 2, 1, 3];
  const DIR_EDGE_A = [EDGE_PX, EDGE_NX, EDGE_PZ, EDGE_NZ];
  const DIR_EDGE_B = [EDGE_NX, EDGE_PX, EDGE_NZ, EDGE_PZ];
  const body = (node: number): number => (clearance[node] === 1 ? metrics.height : metrics.crouchHeight);

  /** Classifica a ligação A → B pela direção de eixo `d`; -1 = sem ligação. */
  const classify = (a: number, b: number, d: number): number => {
    let up = -Infinity;
    let down = Infinity;
    for (let p = 0; p < 4; p += 2) {
      const ca = DIR_PAIRS[d * 4 + p]!;
      const cb = DIR_PAIRS[d * 4 + p + 1]!;
      const delta = sE[surf[b * 4 + cb]! * 4 + DIR_EDGE_B[d]!]! - sE[surf[a * 4 + ca]! * 4 + DIR_EDGE_A[d]!]!;
      if (delta > up) up = delta;
      if (delta < down) down = delta;
    }
    if (up <= step + EPS && down >= -step - EPS) {
      // O corpo precisa passar pela borda: teto dos dois lados acima do piso mais alto + agachado.
      const floorMax = Math.max(topY[a]!, topY[b]!);
      if (Math.min(ceilY[a]!, ceilY[b]!) - floorMax < metrics.crouchHeight - EPS) return -1;
      if (clearance[a] === 2 || clearance[b] === 2) return NAV_LINK.crouch;
      return up < 0.05 && down > -0.05 ? NAV_LINK.walk : NAV_LINK.step;
    }
    if (down > step + EPS && up <= metrics.jumpHeight + EPS) {
      return ceilY[a]! >= topY[b]! + body(b) - EPS ? NAV_LINK.jump : -1;
    }
    if (up < -step - EPS && down >= -metrics.maxDrop - EPS) {
      return ceilY[b]! >= topY[a]! + body(a) - EPS ? NAV_LINK.drop : -1;
    }
    return -1;
  };

  // Passada 1: ligações de eixo (alvo e tipo, em listas planas) e o vizinho andável por direção (para as diagonais).
  const axisStart = new Int32Array(nodeCount + 1);
  const axisTarget = new GrowF64();
  const axisKind = new GrowF64();
  const axisWalk = new Int32Array(nodeCount * 4).fill(NO_NAV_NODE);
  const axisWalkKind = new Uint8Array(nodeCount * 4);
  for (let a = 0; a < nodeCount; a++) {
    axisStart[a] = axisTarget.length;
    const col = nodeColumn[a]!;
    const i = col % columnsX;
    const k = (col - i) / columnsX;
    for (let d = 0; d < 4; d++) {
      const ni = i + DIR_DX[d]!;
      const nk = k + DIR_DZ[d]!;
      if (ni < 0 || nk < 0 || ni >= columnsX || nk >= columnsZ) continue;
      const ncol = ni + nk * columnsX;
      for (let b = columnStart[ncol]!; b < columnStart[ncol + 1]!; b++) {
        const kind = classify(a, b, d);
        if (kind < 0) continue;
        axisTarget.push(b);
        axisKind.push(kind);
        if (kind !== NAV_LINK.jump && kind !== NAV_LINK.drop && axisWalk[a * 4 + d] === NO_NAV_NODE) {
          axisWalk[a * 4 + d] = b;
          axisWalkKind[a * 4 + d] = kind;
        }
      }
    }
  }
  axisStart[nodeCount] = axisTarget.length;

  // Passada 2: diagonais (dirX, dirZ como índices de direção) e montagem do CSR.
  const DIAG_X = [0, 0, 1, 1];
  const DIAG_Z = [2, 3, 2, 3];
  const severity = (kind: number): number => (kind === NAV_LINK.crouch ? 2 : kind === NAV_LINK.step ? 1 : 0);
  const diagTarget = new Int32Array(nodeCount * 4).fill(NO_NAV_NODE);
  const diagKind = new Uint8Array(nodeCount * 4);
  let total = axisTarget.length;
  for (let a = 0; a < nodeCount; a++) {
    for (let q = 0; q < 4; q++) {
      const dx = DIAG_X[q]!;
      const dz = DIAG_Z[q]!;
      const c1 = axisWalk[a * 4 + dx]!;
      const c2 = axisWalk[a * 4 + dz]!;
      if (c1 === NO_NAV_NODE || c2 === NO_NAV_NODE) continue;
      const b1 = axisWalk[c1 * 4 + dz]!;
      const b2 = axisWalk[c2 * 4 + dx]!;
      if (b1 === NO_NAV_NODE || b1 !== b2) continue;
      const worst = Math.max(
        severity(axisWalkKind[a * 4 + dx]!),
        severity(axisWalkKind[a * 4 + dz]!),
        severity(axisWalkKind[c1 * 4 + dz]!),
        severity(axisWalkKind[c2 * 4 + dx]!),
      );
      diagTarget[a * 4 + q] = b1;
      diagKind[a * 4 + q] = worst === 2 ? NAV_LINK.crouch : worst === 1 ? NAV_LINK.step : NAV_LINK.walk;
      total++;
    }
  }
  const linkStart = new Int32Array(nodeCount + 1);
  const linkTarget = new Int32Array(total);
  const linkKind = new Uint8Array(total);
  const linkCost = new Float32Array(total);
  let l = 0;
  for (let a = 0; a < nodeCount; a++) {
    linkStart[a] = l;
    for (let s = axisStart[a]!; s < axisStart[a + 1]!; s++) {
      const b = axisTarget.data[s]!;
      const kind = axisKind.data[s]!;
      let cost = 1;
      if (kind === NAV_LINK.step) cost += NAV_COST.step;
      else if (kind === NAV_LINK.crouch) cost *= NAV_COST.crouchFactor;
      else if (kind === NAV_LINK.jump) cost += NAV_COST.jump;
      else if (kind === NAV_LINK.drop) {
        cost += NAV_COST.drop + NAV_COST.dropPerMeter * Math.max(0, floorY[a]! - floorY[b]!);
      }
      linkTarget[l] = b;
      linkKind[l] = kind;
      linkCost[l] = cost;
      l++;
    }
    for (let q = 0; q < 4; q++) {
      const b = diagTarget[a * 4 + q]!;
      if (b === NO_NAV_NODE) continue;
      const kind = diagKind[a * 4 + q]!;
      linkTarget[l] = b;
      linkKind[l] = kind;
      linkCost[l] =
        kind === NAV_LINK.crouch ? SQRT2 * NAV_COST.crouchFactor : SQRT2 + (kind === NAV_LINK.step ? NAV_COST.step : 0);
      l++;
    }
  }
  linkStart[nodeCount] = l;

  // --- 4. Componentes (union-find; ligações nos dois sentidos) ---
  const parent = new Int32Array(nodeCount);
  for (let a = 0; a < nodeCount; a++) parent[a] = a;
  const find = (a: number): number => {
    let r = a;
    while (parent[r] !== r) r = parent[r]!;
    while (parent[a] !== r) {
      const next = parent[a]!;
      parent[a] = r;
      a = next;
    }
    return r;
  };
  for (let a = 0; a < nodeCount; a++) {
    for (let s = linkStart[a]!; s < linkStart[a + 1]!; s++) {
      const ra = find(a);
      const rb = find(linkTarget[s]!);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    }
  }
  const component = new Uint16Array(nodeCount);
  const label = new Int32Array(nodeCount).fill(-1);
  let componentCount = 0;
  for (let a = 0; a < nodeCount; a++) {
    const r = find(a);
    if (label[r] === -1) label[r] = componentCount++;
    // Mais de 65.535 componentes (mapa absurdamente picado): os excedentes dividem o último rótulo.
    component[a] = Math.min(label[r]!, 0xffff);
  }

  const nav: NavGridImpl = {
    columnsX,
    columnsZ,
    nodeCount,
    floorY,
    clearance,
    component,
    metrics,
    columnStart,
    nodeColumn,
    topY,
    ceilY,
    linkStart,
    linkTarget,
    linkKind,
    linkCost,
    componentCount,
    linkGate: new Int16Array(linkTarget.length).fill(-1),
    gateBlock: new Uint8Array(MAX_NAV_GATES),
    pathCount: 0,
    search: createSearchPool(nodeCount),
    nearestNode(x, y, z) {
      const ci = Math.floor(x / NAV_NODE_SIZE_M);
      const ck = Math.floor(z / NAV_NODE_SIZE_M);
      let best: NavNode = NO_NAV_NODE;
      let bestScore = Infinity;
      for (let k = ck - 2; k <= ck + 2; k++) {
        if (k < 0 || k >= columnsZ) continue;
        for (let i = ci - 2; i <= ci + 2; i++) {
          if (i < 0 || i >= columnsX) continue;
          const col = i + k * columnsX;
          const dx = x - (i + 0.5) * NAV_NODE_SIZE_M;
          const dz = z - (k + 0.5) * NAV_NODE_SIZE_M;
          const d2 = dx * dx + dz * dz;
          if (d2 > 4 + EPS) continue;
          for (let n = columnStart[col]!; n < columnStart[col + 1]!; n++) {
            const dy = y - floorY[n]!;
            // Nó acima dos pés pesa 3× (quem está no térreo não "pertence" ao mezanino de cima).
            const vy = dy < -step ? -dy * 3 : Math.abs(dy);
            const score = d2 + 4 * vy * vy;
            if (score < bestScore) {
              bestScore = score;
              best = n;
            }
          }
        }
      }
      return best;
    },
    nodePosition(node, out, offset = 0) {
      const col = nodeColumn[node]!;
      const i = col % columnsX;
      const k = (col - i) / columnsX;
      out[offset] = (i + 0.5) * NAV_NODE_SIZE_M;
      out[offset + 1] = floorY[node]!;
      out[offset + 2] = (k + 0.5) * NAV_NODE_SIZE_M;
    },
    assignGates(boxes, count) {
      assignGatesImpl(nav, boxes, count);
    },
    setGateBlock(gate, block) {
      if (gate >= 0 && gate < MAX_NAV_GATES) nav.gateBlock[gate] = block;
    },
  };
  return nav;
}

/**
 * M3 (fase 3d): a ligação u → v atravessa a caixa do portão se o segmento entre os centros dos nós, na altura do peito
 * (piso + 1 m), corta a caixa (teste de placas). Recalcula todas as ligações e solta todos os bloqueios.
 */
function assignGatesImpl(nav: NavGridImpl, boxes: Float32Array, count: number): void {
  const n = Math.min(count, MAX_NAV_GATES);
  nav.linkGate.fill(-1);
  nav.gateBlock.fill(0);
  if (n <= 0) return;
  const a = new Float32Array(3);
  const b = new Float32Array(3);
  for (let u = 0; u < nav.nodeCount; u++) {
    nav.nodePosition(u, a);
    for (let l = nav.linkStart[u]!; l < nav.linkStart[u + 1]!; l++) {
      nav.nodePosition(nav.linkTarget[l]!, b);
      for (let g = 0; g < n; g++) {
        if (segmentHitsBox(a[0]!, a[1]! + 1, a[2]!, b[0]!, b[1]! + 1, b[2]!, boxes, g * 6)) {
          nav.linkGate[l] = g;
          break;
        }
      }
    }
  }
}

/** O segmento a → b corta a caixa `boxes[o..o+5]` (placas, sem alocação). */
function segmentHitsBox(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  boxes: Float32Array,
  o: number,
): boolean {
  let t0 = 0;
  let t1 = 1;
  for (let k = 0; k < 3; k++) {
    const min = boxes[o + k]!;
    const max = boxes[o + 3 + k]!;
    const p = k === 0 ? ax : k === 1 ? ay : az;
    const d = (k === 0 ? bx : k === 1 ? by : bz) - p;
    if (Math.abs(d) < 1e-9) {
      if (p < min || p > max) return false;
      continue;
    }
    let ta = (min - p) / d;
    let tb = (max - p) / d;
    if (ta > tb) {
      const t = ta;
      ta = tb;
      tb = t;
    }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  return true;
}
