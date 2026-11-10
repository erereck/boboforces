import type { NavGridImpl } from './build.ts';
import { NAV_GATE_BLOCK, NO_NAV_NODE, type NavNode } from './constants.ts';
import type { FlowField } from './index.ts';

/**
 * M3 (fase 3c): flow field (tecnico.md §8.3, GDD §4.1.4: "60 zumbis com flow field compartilhado"). Um Dijkstra de
 * várias fontes (os nós dos bobos de pé) sobre as ligações AO CONTRÁRIO: para cada nó, o custo até a fonte mais perto
 * pelo caminho e o próximo nó desse caminho. Todos os zumbis leem o mesmo campo, em vez de um A* por zumbi.
 *
 * - Fatiado: `run(budget)` fecha no máximo `budget` nós por chamada (orçamento em trabalho, regra 10).
 * - Buffer duplo: o campo pronto continua valendo enquanto o próximo é calculado; troca quando o cálculo termina.
 * - Sem alocação depois de criado (regra 11): as ligações que CHEGAM em cada nó (CSR invertido), os dois buffers e a
 *   fila binária com "decrease key" são montados uma vez, no loading.
 * - Alvos (`addTarget`, os nós dos zumbis): com eles, o cálculo para quando o último alvo fecha e o custo passa dele
 *   mais `FLOW_TARGET_MARGIN`, em vez de cobrir o mapa todo (medido no Construto: a área até o zumbi mais longe é uma
 *   fração dos 7161 nós). Os nós que ficaram na fila guardam um próximo nó válido (já fechado), só talvez não o melhor.
 * - Determinístico: a ordem das ligações e da fila só depende da grade, das fontes e dos alvos.
 */

/** Folga (metros equivalentes) depois do alvo mais longe: quem anda um pouco para trás continua no campo. */
export const FLOW_TARGET_MARGIN = 8;

/** Marca de nó fechado (custo final) na posição da fila. */
const CLOSED = -2;
const NOT_IN_HEAP = -1;

export class FlowFieldImpl implements FlowField {
  ready = 0;
  building = false;
  private readonly nav: NavGridImpl;
  /** Ligações que chegam em cada nó: as de `v` vão de `inStart[v]` a `inStart[v + 1]` (nó de origem e ligação). */
  private readonly inStart: Int32Array;
  private readonly inFrom: Int32Array;
  private readonly inLink: Int32Array;
  /** Campo pronto (frente) e o em cálculo (costas). */
  private frontDist: Float64Array;
  private frontNext: Int32Array;
  private frontLink: Uint8Array;
  private backDist: Float64Array;
  private backNext: Int32Array;
  private backLink: Uint8Array;
  /** Fila binária de mínimo pelo custo das costas, com a posição de cada nó (`NOT_IN_HEAP`, `CLOSED`). */
  private readonly heap: Int32Array;
  private readonly heapPos: Int32Array;
  private heapSize = 0;
  /** Alvos do cálculo em andamento (1 = ainda não fechou), quantos faltam e o custo em que o cálculo para. */
  private readonly target: Uint8Array;
  private targetsLeft = 0;
  private stopAt = Infinity;

  constructor(nav: NavGridImpl) {
    this.nav = nav;
    const n = nav.nodeCount;
    const total = nav.linkTarget.length;
    const inStart = new Int32Array(n + 1);
    for (let l = 0; l < total; l++) inStart[nav.linkTarget[l]! + 1]!++;
    for (let i = 0; i < n; i++) inStart[i + 1]! += inStart[i]!;
    const fill = inStart.slice(0, n);
    const inFrom = new Int32Array(total);
    const inLink = new Int32Array(total);
    for (let u = 0; u < n; u++) {
      for (let l = nav.linkStart[u]!; l < nav.linkStart[u + 1]!; l++) {
        const k = fill[nav.linkTarget[l]!]!++;
        inFrom[k] = u;
        inLink[k] = l;
      }
    }
    this.inStart = inStart;
    this.inFrom = inFrom;
    this.inLink = inLink;
    this.frontDist = new Float64Array(n).fill(Infinity);
    this.frontNext = new Int32Array(n).fill(NO_NAV_NODE);
    this.frontLink = new Uint8Array(n);
    this.backDist = new Float64Array(n).fill(Infinity);
    this.backNext = new Int32Array(n).fill(NO_NAV_NODE);
    this.backLink = new Uint8Array(n);
    this.heap = new Int32Array(Math.max(1, n));
    this.heapPos = new Int32Array(n).fill(NOT_IN_HEAP);
    this.target = new Uint8Array(n);
  }

  next(node: NavNode): NavNode {
    return this.ready > 0 && node >= 0 && node < this.frontNext.length ? this.frontNext[node]! : NO_NAV_NODE;
  }

  link(node: NavNode): number {
    return this.ready > 0 && node >= 0 && node < this.frontLink.length ? this.frontLink[node]! : 0;
  }

  distance(node: NavNode): number {
    return this.ready > 0 && node >= 0 && node < this.frontDist.length ? this.frontDist[node]! : Infinity;
  }

  begin(): void {
    this.backDist.fill(Infinity);
    this.backNext.fill(NO_NAV_NODE);
    this.backLink.fill(0);
    this.heapPos.fill(NOT_IN_HEAP);
    this.heapSize = 0;
    this.target.fill(0);
    this.targetsLeft = 0;
    this.stopAt = Infinity;
    this.building = true;
  }

  addTarget(node: NavNode): void {
    if (!this.building || node < 0 || node >= this.target.length || this.target[node] === 1) return;
    this.target[node] = 1;
    this.targetsLeft++;
  }

  addSource(node: NavNode): void {
    if (!this.building || node < 0 || node >= this.backDist.length || this.backDist[node] === 0) return;
    this.backDist[node] = 0;
    this.backNext[node] = NO_NAV_NODE;
    this.backLink[node] = 0;
    this.push(node);
  }

  run(budget: number): boolean {
    if (!this.building) return false;
    const nav = this.nav;
    const cost = nav.linkCost;
    const kind = nav.linkKind;
    const dist = this.backDist;
    const next = this.backNext;
    const link = this.backLink;
    const inStart = this.inStart;
    const inFrom = this.inFrom;
    const inLink = this.inLink;
    const pos = this.heapPos;
    const target = this.target;
    const linkGate = nav.linkGate;
    const gateBlock = nav.gateBlock;
    let closed = 0;
    while (this.heapSize > 0 && closed < budget) {
      const v = this.pop();
      const dv = dist[v]!;
      if (dv > this.stopAt) {
        // Todos os alvos cobertos, com a folga: o resto do mapa fica de fora deste campo.
        this.heapSize = 0;
        break;
      }
      pos[v] = CLOSED;
      closed++;
      if (target[v] === 1) {
        target[v] = 0;
        if (--this.targetsLeft === 0) this.stopAt = dv + FLOW_TARGET_MARGIN;
      }
      for (let k = inStart[v]!; k < inStart[v + 1]!; k++) {
        const u = inFrom[k]!;
        if (pos[u] === CLOSED) continue;
        const l = inLink[k]!;
        // M3 (fase 3d): portão fechado para os zumbis (porta paga fechada).
        const gate = linkGate[l]!;
        if (gate >= 0 && (gateBlock[gate]! & NAV_GATE_BLOCK.zombie) !== 0) continue;
        const nd = dv + cost[l]!;
        if (nd >= dist[u]!) continue;
        dist[u] = nd;
        next[u] = v;
        link[u] = kind[l]!;
        if (pos[u] === NOT_IN_HEAP) this.push(u);
        else this.up(pos[u]!);
      }
    }
    if (this.heapSize > 0) return false;
    // Pronto: as costas viram a frente (e a frente velha, as costas do próximo cálculo).
    this.backDist = this.frontDist;
    this.backNext = this.frontNext;
    this.backLink = this.frontLink;
    this.frontDist = dist;
    this.frontNext = next;
    this.frontLink = link;
    this.building = false;
    this.ready++;
    return true;
  }

  private push(node: number): void {
    const i = this.heapSize++;
    this.heap[i] = node;
    this.heapPos[node] = i;
    this.up(i);
  }

  private pop(): number {
    const heap = this.heap;
    const top = heap[0]!;
    const last = heap[--this.heapSize]!;
    if (this.heapSize > 0) {
      heap[0] = last;
      this.heapPos[last] = 0;
      this.down(0);
    }
    return top;
  }

  private up(i: number): void {
    const heap = this.heap;
    const pos = this.heapPos;
    const dist = this.backDist;
    const node = heap[i]!;
    const d = dist[node]!;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const pn = heap[p]!;
      if (dist[pn]! <= d) break;
      heap[i] = pn;
      pos[pn] = i;
      i = p;
    }
    heap[i] = node;
    pos[node] = i;
  }

  private down(i: number): void {
    const heap = this.heap;
    const pos = this.heapPos;
    const dist = this.backDist;
    const size = this.heapSize;
    const node = heap[i]!;
    const d = dist[node]!;
    for (;;) {
      const a = i * 2 + 1;
      if (a >= size) break;
      const b = a + 1;
      let c = a;
      if (b < size && dist[heap[b]!]! < dist[heap[a]!]!) c = b;
      const cn = heap[c]!;
      if (dist[cn]! >= d) break;
      heap[i] = cn;
      pos[cn] = i;
      i = c;
    }
    heap[i] = node;
    pos[node] = i;
  }
}
