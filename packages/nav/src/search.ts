import { NAV_GATE_BLOCK, NAV_LINK, NAV_NODE_SIZE_M, NO_NAV_NODE, type NavNode } from './constants.ts';
import type { NavGridImpl } from './build.ts';
import type { NavPath, PathStatus } from './index.ts';

/**
 * A* com orçamento (tecnico.md §8.1): heurística octile, fila binária com "decrease key", sem alocação depois do
 * loading.
 *
 * Memória: as áreas de trabalho do A* (custo, pai, fila, carimbo) são um POOL por grade (`SEARCH_SLOTS` áreas), não uma
 * por caminho: 64 bots + 64 zumbis com uma área cada passariam de 20 MB no Construto; o pool fica em ~1,5 MB. Um
 * caminho pega uma área ao começar a busca e devolve ao terminar (`found`/`unreachable`). Sem área livre, o pedido
 * espera (`pending` sem trabalho) — é a "fila de pedidos" do diretor de IA. Uma área presa por um caminho que parou de
 * chamar (bot que morreu no meio da busca) é retomada depois de `staleCalls()` chamadas de outros caminhos; o dono, se
 * voltar, recomeça do zero. Tudo por contagem de chamadas, nunca por relógio (determinístico).
 */

/** Áreas de trabalho do A* por grade. */
export const SEARCH_SLOTS = 8;
/** Pontos à frente que o suavizador tenta ligar em linha reta (limita o custo do `found`). */
export const SMOOTH_LOOKAHEAD = 24;

const CLOSED = -2;
const NOT_IN_HEAP = -1;
const SQRT2_MINUS_2 = Math.SQRT2 - 2;

interface SearchSlot {
  owner: NavPathImpl | null;
  /** Valor de `pool.calls` na última vez que o dono avançou a busca. */
  lastCall: number;
  generation: number;
  readonly g: Float32Array;
  readonly f: Float32Array;
  readonly parent: Int32Array;
  readonly heap: Int32Array;
  readonly heapPos: Int32Array;
  readonly stamp: Uint32Array;
  heapSize: number;
}

export interface SearchPool {
  readonly slots: SearchSlot[];
  calls: number;
}

/** Caminho concreto: os campos do contrato + o estado da busca. */
export interface NavPathImpl extends NavPath {
  from: NavNode;
  to: NavNode;
  slot: number;
}

function createSlot(nodeCount: number): SearchSlot {
  return {
    owner: null,
    lastCall: 0,
    generation: 0,
    g: new Float32Array(nodeCount),
    f: new Float32Array(nodeCount),
    parent: new Int32Array(nodeCount),
    heap: new Int32Array(nodeCount),
    heapPos: new Int32Array(nodeCount),
    stamp: new Uint32Array(nodeCount),
    heapSize: 0,
  };
}

export function createSearchPool(nodeCount: number): SearchPool {
  const slots: SearchSlot[] = [];
  for (let i = 0; i < SEARCH_SLOTS; i++) slots.push(createSlot(nodeCount));
  return { slots, calls: 0 };
}

export function createNavPathImpl(nav: NavGridImpl, capacity = 256): NavPathImpl {
  if (!(Number.isInteger(capacity) && capacity >= 2)) throw new Error('nav: capacidade do caminho precisa ser ≥ 2');
  nav.pathCount++;
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
    slot: -1,
  };
}

/** Chamadas sem avançar depois das quais uma área presa pode ser retomada. */
function staleCalls(nav: NavGridImpl): number {
  return 64 * Math.max(SEARCH_SLOTS, nav.pathCount);
}

// --- Fila binária mínima por f (desempate pelo índice do nó: determinístico) ---

function less(slot: SearchSlot, a: number, b: number): boolean {
  const fa = slot.f[a]!;
  const fb = slot.f[b]!;
  return fa < fb || (fa === fb && a < b);
}

function siftUp(slot: SearchSlot, pos: number): void {
  const heap = slot.heap;
  const node = heap[pos]!;
  while (pos > 0) {
    const up = (pos - 1) >> 1;
    const other = heap[up]!;
    if (!less(slot, node, other)) break;
    heap[pos] = other;
    slot.heapPos[other] = pos;
    pos = up;
  }
  heap[pos] = node;
  slot.heapPos[node] = pos;
}

function siftDown(slot: SearchSlot, pos: number): void {
  const heap = slot.heap;
  const size = slot.heapSize;
  const node = heap[pos]!;
  for (;;) {
    const l = pos * 2 + 1;
    if (l >= size) break;
    const r = l + 1;
    const child = r < size && less(slot, heap[r]!, heap[l]!) ? r : l;
    const c = heap[child]!;
    if (!less(slot, c, node)) break;
    heap[pos] = c;
    slot.heapPos[c] = pos;
    pos = child;
  }
  heap[pos] = node;
  slot.heapPos[node] = pos;
}

function heapPush(slot: SearchSlot, node: number): void {
  slot.heap[slot.heapSize] = node;
  slot.heapSize++;
  siftUp(slot, slot.heapSize - 1);
}

function heapPop(slot: SearchSlot): number {
  const top = slot.heap[0]!;
  slot.heapSize--;
  if (slot.heapSize > 0) {
    slot.heap[0] = slot.heap[slot.heapSize]!;
    siftDown(slot, 0);
  }
  return top;
}

function heuristic(nav: NavGridImpl, a: number, goalI: number, goalK: number): number {
  const col = nav.nodeColumn[a]!;
  const i = col % nav.columnsX;
  const k = (col - i) / nav.columnsX;
  const dx = Math.abs(i - goalI);
  const dz = Math.abs(k - goalK);
  return (dx + dz + SQRT2_MINUS_2 * Math.min(dx, dz)) * NAV_NODE_SIZE_M;
}

function release(nav: NavGridImpl, out: NavPathImpl): void {
  if (out.slot >= 0) {
    const slot = nav.search.slots[out.slot]!;
    if (slot.owner === out) slot.owner = null;
  }
  out.slot = -1;
}

/** Pega uma área livre (ou retoma uma presa há muito tempo); -1 = todas ocupadas. */
function acquire(nav: NavGridImpl, out: NavPathImpl): number {
  const pool = nav.search;
  let stale = -1;
  let staleCall = Infinity;
  for (let s = 0; s < pool.slots.length; s++) {
    const slot = pool.slots[s]!;
    if (slot.owner === null) return s;
    if (slot.lastCall < staleCall) {
      staleCall = slot.lastCall;
      stale = s;
    }
  }
  if (stale >= 0 && pool.calls - staleCall > staleCalls(nav)) {
    const prev = pool.slots[stale]!.owner;
    if (prev && prev !== out) prev.slot = -1;
    return stale;
  }
  return -1;
}

function startSearch(nav: NavGridImpl, out: NavPathImpl, slotIndex: number): void {
  const slot = nav.search.slots[slotIndex]!;
  slot.owner = out;
  slot.lastCall = nav.search.calls;
  slot.generation = (slot.generation + 1) >>> 0;
  if (slot.generation === 0) {
    slot.stamp.fill(0);
    slot.generation = 1;
  }
  slot.heapSize = 0;
  out.slot = slotIndex;
  const from = out.from;
  const goalCol = nav.nodeColumn[out.to]!;
  const gi = goalCol % nav.columnsX;
  const gk = (goalCol - gi) / nav.columnsX;
  slot.stamp[from] = slot.generation;
  slot.g[from] = 0;
  slot.f[from] = heuristic(nav, from, gi, gk);
  slot.parent[from] = NO_NAV_NODE;
  heapPush(slot, from);
}

function finish(nav: NavGridImpl, out: NavPathImpl, status: PathStatus): PathStatus {
  out.status = status;
  release(nav, out);
  return status;
}

/**
 * A* com orçamento (ver o contrato no `index.ts`). Mesmo `from`/`to` e `out` com a busca em andamento continua; outro
 * par recomeça; `found`/`unreachable` com o mesmo par devolve o resultado guardado sem trabalho.
 */
export function findPathImpl(
  nav: NavGridImpl,
  from: NavNode,
  to: NavNode,
  out: NavPathImpl,
  budget: number,
): PathStatus {
  const pool = nav.search;
  pool.calls++;
  const same = out.from === from && out.to === to && out.status !== 'idle';
  if (same && (out.status === 'found' || out.status === 'unreachable')) return out.status;
  if (!same) {
    release(nav, out);
    out.from = from;
    out.to = to;
    out.length = 0;
    out.pointCount = 0;
    out.status = 'pending';
    const n = nav.nodeCount;
    if (from < 0 || to < 0 || from >= n || to >= n) return finish(nav, out, 'unreachable');
    if (nav.component[from] !== nav.component[to]) return finish(nav, out, 'unreachable');
    if (from === to) {
      out.nodes[0] = from;
      out.length = 1;
      writePoints(nav, out);
      return finish(nav, out, 'found');
    }
  }
  // Busca em andamento: precisa de uma área (a sua, se ninguém tomou).
  let slotIndex = out.slot;
  if (slotIndex < 0 || pool.slots[slotIndex]!.owner !== out) {
    out.slot = -1;
    slotIndex = acquire(nav, out);
    if (slotIndex < 0) return 'pending';
    startSearch(nav, out, slotIndex);
  }
  const slot = pool.slots[slotIndex]!;
  slot.lastCall = pool.calls;
  const gen = slot.generation;
  const goal = out.to;
  const goalCol = nav.nodeColumn[goal]!;
  const gi = goalCol % nav.columnsX;
  const gk = (goalCol - gi) / nav.columnsX;
  const linkStart = nav.linkStart;
  const linkTarget = nav.linkTarget;
  const linkCost = nav.linkCost;
  const linkGate = nav.linkGate;
  const gateBlock = nav.gateBlock;
  for (let work = 0; work < budget; work++) {
    if (slot.heapSize === 0) return finish(nav, out, 'unreachable');
    const cur = heapPop(slot);
    if (cur === goal) {
      writeNodes(out, slot);
      writePoints(nav, out);
      return finish(nav, out, 'found');
    }
    slot.heapPos[cur] = CLOSED;
    const gCur = slot.g[cur]!;
    for (let l = linkStart[cur]!; l < linkStart[cur + 1]!; l++) {
      // M3 (fase 3d): portão fechado para os bobos (janela com barricada, porta paga fechada).
      const gate = linkGate[l]!;
      if (gate >= 0 && (gateBlock[gate]! & NAV_GATE_BLOCK.bobo) !== 0) continue;
      const nb = linkTarget[l]!;
      const cost = gCur + linkCost[l]!;
      if (slot.stamp[nb] !== gen) {
        slot.stamp[nb] = gen;
        slot.g[nb] = cost;
        slot.f[nb] = cost + heuristic(nav, nb, gi, gk);
        slot.parent[nb] = cur;
        slot.heapPos[nb] = NOT_IN_HEAP;
        heapPush(slot, nb);
        continue;
      }
      const pos = slot.heapPos[nb]!;
      if (pos === CLOSED || cost >= slot.g[nb]!) continue;
      const h = slot.f[nb]! - slot.g[nb]!;
      slot.g[nb] = cost;
      slot.f[nb] = cost + h;
      slot.parent[nb] = cur;
      if (pos === NOT_IN_HEAP) heapPush(slot, nb);
      else siftUp(slot, pos);
    }
  }
  out.status = 'pending';
  return 'pending';
}

/** Copia o caminho (pais a partir do alvo). Caminho maior que a capacidade: fica o COMEÇO (a IA pede outro depois). */
function writeNodes(out: NavPathImpl, slot: SearchSlot): void {
  let length = 0;
  for (let n = out.to; n !== NO_NAV_NODE; n = slot.parent[n]!) length++;
  const keep = Math.min(length, out.capacity);
  let index = length - 1;
  for (let n = out.to; n !== NO_NAV_NODE; n = slot.parent[n]!) {
    if (index < keep) out.nodes[index] = n;
    index--;
  }
  out.length = keep;
}

// --- Suavização por linha de visada na grade de nós ---

/** Ligação andável (walk/step) de `a` para algum nó da coluna (ci, ck); devolve o nó ou -1. */
function walkLinkToColumn(nav: NavGridImpl, a: number, ci: number, ck: number): number {
  if (ci < 0 || ck < 0 || ci >= nav.columnsX || ck >= nav.columnsZ) return NO_NAV_NODE;
  const col = ci + ck * nav.columnsX;
  if (nav.nodeColumn[a] === col) return a;
  for (let l = nav.linkStart[a]!; l < nav.linkStart[a + 1]!; l++) {
    const kind = nav.linkKind[l]!;
    if (kind !== NAV_LINK.walk && kind !== NAV_LINK.step) continue;
    const gate = nav.linkGate[l]!;
    if (gate >= 0 && (nav.gateBlock[gate]! & NAV_GATE_BLOCK.bobo) !== 0) continue;
    const b = nav.linkTarget[l]!;
    if (nav.nodeColumn[b] === col) return b;
  }
  return NO_NAV_NODE;
}

/**
 * Anda em linha reta de (ax, az) a (bx, bz) pelas colunas (DDA de 1 m) seguindo só ligações walk/step, começando no nó
 * `start`. Devolve o nó em que chegou na coluna final, ou -1 se a linha cai num buraco, parede ou mudança de nível.
 */
function traceLine(nav: NavGridImpl, start: number, ax: number, az: number, bx: number, bz: number): number {
  const size = NAV_NODE_SIZE_M;
  let ci = Math.floor(ax / size);
  let ck = Math.floor(az / size);
  const ei = Math.floor(bx / size);
  const ek = Math.floor(bz / size);
  let node = walkLinkToColumn(nav, start, ci, ck);
  if (node === NO_NAV_NODE) return NO_NAV_NODE;
  const dx = bx - ax;
  const dz = bz - az;
  const stepI = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepK = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaI = stepI !== 0 ? size / Math.abs(dx) : Infinity;
  const tDeltaK = stepK !== 0 ? size / Math.abs(dz) : Infinity;
  let tMaxI = stepI > 0 ? ((ci + 1) * size - ax) / dx : stepI < 0 ? (ci * size - ax) / dx : Infinity;
  let tMaxK = stepK > 0 ? ((ck + 1) * size - az) / dz : stepK < 0 ? (ck * size - az) / dz : Infinity;
  for (let guard = 0; guard < 4096; guard++) {
    if (ci === ei && ck === ek) return node;
    if (Math.abs(tMaxI - tMaxK) < 1e-9) {
      // Passa pela quina: os dois caminhos em L precisam existir.
      const viaI = walkLinkToColumn(nav, node, ci + stepI, ck);
      const viaK = walkLinkToColumn(nav, node, ci, ck + stepK);
      if (viaI === NO_NAV_NODE || viaK === NO_NAV_NODE) return NO_NAV_NODE;
      const endI = walkLinkToColumn(nav, viaI, ci + stepI, ck + stepK);
      const endK = walkLinkToColumn(nav, viaK, ci + stepI, ck + stepK);
      if (endI === NO_NAV_NODE || endI !== endK) return NO_NAV_NODE;
      node = endI;
      ci += stepI;
      ck += stepK;
      tMaxI += tDeltaI;
      tMaxK += tDeltaK;
    } else if (tMaxI < tMaxK) {
      ci += stepI;
      tMaxI += tDeltaI;
      node = walkLinkToColumn(nav, node, ci, ck);
    } else {
      ck += stepK;
      tMaxK += tDeltaK;
      node = walkLinkToColumn(nav, node, ci, ck);
    }
    if (node === NO_NAV_NODE) return NO_NAV_NODE;
    if (tMaxI > 1 && tMaxK > 1 && (ci !== ei || ck !== ek)) return NO_NAV_NODE;
  }
  return NO_NAV_NODE;
}

/** Os nós a e b se ligam em linha reta com folga do raio do corpo (3 linhas paralelas: centro e ± raio). */
function straightWalkable(nav: NavGridImpl, a: number, b: number): boolean {
  const colA = nav.nodeColumn[a]!;
  const colB = nav.nodeColumn[b]!;
  const ai = colA % nav.columnsX;
  const ak = (colA - ai) / nav.columnsX;
  const bi = colB % nav.columnsX;
  const bk = (colB - bi) / nav.columnsX;
  const ax = (ai + 0.5) * NAV_NODE_SIZE_M;
  const az = (ak + 0.5) * NAV_NODE_SIZE_M;
  const bx = (bi + 0.5) * NAV_NODE_SIZE_M;
  const bz = (bk + 0.5) * NAV_NODE_SIZE_M;
  if (traceLine(nav, a, ax, az, bx, bz) !== b) return false;
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 1e-6) return true;
  const r = nav.metrics.radius;
  const ox = (-(bz - az) / len) * r;
  const oz = ((bx - ax) / len) * r;
  return (
    traceLine(nav, a, ax + ox, az + oz, bx + ox, bz + oz) !== NO_NAV_NODE &&
    traceLine(nav, a, ax - ox, az - oz, bx - ox, bz - oz) !== NO_NAV_NODE
  );
}

/** Tipo da ligação de `a` para `b` (vizinhos no caminho). */
function linkKindBetween(nav: NavGridImpl, a: number, b: number): number {
  for (let l = nav.linkStart[a]!; l < nav.linkStart[a + 1]!; l++) if (nav.linkTarget[l] === b) return nav.linkKind[l]!;
  return NAV_LINK.walk;
}

function pushPoint(nav: NavGridImpl, out: NavPathImpl, node: number, kind: number): void {
  nav.nodePosition(node, out.points, out.pointCount * 3);
  out.pointLinks[out.pointCount] = kind;
  out.pointCount++;
}

/**
 * Pontos suavizados: do âncora, estica a reta até onde der (até `SMOOTH_LOOKAHEAD` nós); pulo, queda e agachado
 * quebram a reta (o ponto antes e o depois ficam, com o tipo da ligação para a IA).
 */
function writePoints(nav: NavGridImpl, out: NavPathImpl): void {
  out.pointCount = 0;
  const nodes = out.nodes;
  const n = out.length;
  if (n === 0) return;
  pushPoint(nav, out, nodes[0]!, NAV_LINK.walk);
  let anchor = 0;
  let segKind: number = NAV_LINK.walk;
  let j = 1;
  while (j < n) {
    const kind = linkKindBetween(nav, nodes[j - 1]!, nodes[j]!);
    if (kind === NAV_LINK.jump || kind === NAV_LINK.drop || kind === NAV_LINK.crouch) {
      if (anchor !== j - 1) pushPoint(nav, out, nodes[j - 1]!, segKind);
      pushPoint(nav, out, nodes[j]!, kind);
      anchor = j;
      segKind = NAV_LINK.walk;
      j++;
      continue;
    }
    if (j - anchor > 1 && (j - anchor > SMOOTH_LOOKAHEAD || !straightWalkable(nav, nodes[anchor]!, nodes[j]!))) {
      pushPoint(nav, out, nodes[j - 1]!, segKind);
      anchor = j - 1;
      segKind = NAV_LINK.walk;
      continue;
    }
    if (kind === NAV_LINK.step) segKind = NAV_LINK.step;
    j++;
  }
  if (anchor !== n - 1) pushPoint(nav, out, nodes[n - 1]!, segKind);
}
