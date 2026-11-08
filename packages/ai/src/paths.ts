import {
  createNavPath,
  findPath,
  isReachable,
  NAV_LINK,
  NO_NAV_NODE,
  type NavGrid,
  type NavNode,
  type NavPath,
  type PathStatus,
} from '@boboforces/nav';
import { AI_BUDGET, AI_PATH, type AiBudget } from './config.ts';

/**
 * Caminhos da IA (tecnico.md §8.1 e §8.3): fila de pedidos com orçamento de nós de A* por tick e um seguidor de
 * caminho por bot ou zumbi.
 *
 * - UMA busca por vez (FIFO): o A* fatiado do `nav` (`findPath` com orçamento) continua de onde parou enquanto o mesmo
 *   pedido estiver na frente da fila. Só existe UM `NavPath` de busca (o estado do A* pode ser grande); quando ele
 *   termina, os pontos são copiados para a rota do agente, que é pequena e dele.
 * - O agente continua seguindo a rota velha enquanto a nova é calculada.
 * - Sem alocação depois do `bind` (rotas e fila pré-alocadas).
 */

/** As duas funções do `nav` que a IA usa (os testes e o bench trocam pela navegação de teste da sim). */
export interface NavPathApi {
  createNavPath(nav: NavGrid, capacity?: number): NavPath;
  findPath(nav: NavGrid, from: NavNode, to: NavNode, out: NavPath, budget: number): PathStatus;
}

/** O `@boboforces/nav` de verdade. */
export const NAV_PATH_API: NavPathApi = { createNavPath, findPath };

/** Direção no plano (unitária, ou zero) e o que fazer para seguir a rota neste tick. */
export interface Steer {
  x: number;
  z: number;
  jump: boolean;
  crouch: boolean;
  /** Distância que falta até o fim da rota (m, aproximada). */
  remaining: number;
}

export function createSteer(): Steer {
  return { x: 0, z: 0, jump: false, crouch: false, remaining: 0 };
}

/** Rota e estado de caminho de UM agente. */
export class PathFollower {
  readonly id: number;
  /** Rota copiada da busca: pontos (pés, m) e a ligação que chega a cada ponto (`NAV_LINK`). */
  readonly points = new Float32Array(AI_PATH.pathCapacity * 3);
  readonly links = new Uint8Array(AI_PATH.pathCapacity);
  count = 0;
  /** Próximo ponto da rota. */
  index = 0;
  hasRoute = false;
  /** Pedido na fila (ou sendo calculado) e ainda querido. */
  queued = false;
  wanted = false;
  reqFrom: NavNode = NO_NAV_NODE;
  reqTo: NavNode = NO_NAV_NODE;
  /** Objetivo do último pedido (NaN = nenhum). */
  goalX = Number.NaN;
  goalY = 0;
  goalZ = 0;
  lastRequestTick = -1_000_000;
  /** O último pedido não tem caminho (sem nó ou outra ilha): quem chama escolhe outro objetivo. */
  failed = false;
  /** Chegou no fim da rota neste tick. */
  arrived = false;
  /** Detector de "empacado". */
  stuckTick = 0;
  stuckX = 0;
  stuckZ = 0;
  stuckCount = 0;

  constructor(id: number) {
    this.id = id;
  }

  /** Esquece rota e pedido (morreu, renasceu ou trocou de objetivo de vez). */
  clear(): void {
    this.hasRoute = false;
    this.wanted = false;
    this.failed = false;
    this.arrived = false;
    this.goalX = Number.NaN;
    this.count = 0;
    this.index = 0;
    this.stuckCount = 0;
  }

  /** A rota não serve mais (saiu dela, empacou): o próximo `want` pede outra, respeitando o intervalo. */
  invalidate(): void {
    this.hasRoute = false;
    this.goalX = Number.NaN;
  }
}

/** Fila de pedidos e a busca única. Um por diretor. */
export class PathService {
  readonly api: NavPathApi;
  nav: NavGrid | null = null;
  readonly followers: readonly PathFollower[];
  private search: NavPath | null = null;
  private readonly queue: Int32Array;
  private head = 0;
  private size = 0;
  /** Chamadas de `findPath` e pedidos atendidos (estatística do bench). */
  calls = 0;
  served = 0;

  /** Nós de A* por tick e por chamada (`AiBudget`). */
  private readonly nodesPerTick: number;
  private readonly slice: number;

  constructor(
    api: NavPathApi,
    followers: readonly PathFollower[],
    budget: Pick<AiBudget, 'pathNodesPerTick' | 'pathSlice'> = AI_BUDGET,
  ) {
    this.nodesPerTick = budget.pathNodesPerTick;
    this.slice = budget.pathSlice;
    this.api = api;
    this.followers = followers;
    this.queue = new Int32Array(Math.max(1, followers.length));
  }

  /** Liga a navegação do mapa (no primeiro tick ou quando ela muda). Única alocação: o `NavPath` da busca. */
  bind(nav: NavGrid | null): void {
    if (nav === this.nav) return;
    this.nav = nav;
    this.search = nav ? this.api.createNavPath(nav, AI_PATH.pathCapacity) : null;
    this.head = 0;
    this.size = 0;
    for (const f of this.followers) {
      f.clear();
      f.queued = false;
    }
  }

  /** Pede caminho de `from` a `to` (o agente não pode estar na fila). */
  private request(f: PathFollower, from: NavNode, to: NavNode): void {
    f.reqFrom = from;
    f.reqTo = to;
    f.wanted = true;
    if (f.queued) return;
    f.queued = true;
    this.queue[(this.head + this.size) % this.queue.length] = f.id;
    this.size++;
  }

  /**
   * Quer ir até (gx, gy, gz): pede caminho se ainda não tem um para perto desse objetivo, se o objetivo andou mais de
   * `replanGoalM` e se já passou `replanTicks` desde o último pedido. Pedido impossível (sem nó, outra ilha) marca
   * `failed` na hora, sem gastar A*.
   */
  want(
    f: PathFollower,
    x: number,
    y: number,
    z: number,
    gx: number,
    gy: number,
    gz: number,
    tick: number,
    replanTicks: number,
  ): void {
    const nav = this.nav;
    if (nav === null || f.queued) return;
    const dgx = gx - f.goalX;
    const dgz = gz - f.goalZ;
    const moved = Number.isNaN(f.goalX) ? Infinity : Math.sqrt(dgx * dgx + dgz * dgz) + Math.abs(gy - f.goalY);
    if (moved <= AI_PATH.replanGoalM && (f.hasRoute || f.failed || f.arrived)) return;
    if (tick - f.lastRequestTick < replanTicks) return;
    f.goalX = gx;
    f.goalY = gy;
    f.goalZ = gz;
    f.lastRequestTick = tick;
    f.arrived = false;
    const from = nav.nearestNode(x, y, z);
    const to = nav.nearestNode(gx, gy, gz);
    if (from === NO_NAV_NODE || to === NO_NAV_NODE || !isReachable(nav, from, to)) {
      f.failed = true;
      return;
    }
    f.failed = false;
    this.request(f, from, to);
  }

  /** Atende a fila com o orçamento do tick (chamar uma vez por tick, antes dos cérebros). */
  service(): void {
    const nav = this.nav;
    const search = this.search;
    if (nav === null || search === null) return;
    let budget = this.nodesPerTick;
    while (budget > 0 && this.size > 0) {
      const f = this.followers[this.queue[this.head]!]!;
      if (!f.wanted) {
        this.pop(f);
        continue;
      }
      const slice = Math.min(this.slice, budget);
      budget -= slice;
      this.calls++;
      const status = this.api.findPath(nav, f.reqFrom, f.reqTo, search, slice);
      if (status === 'pending') continue;
      this.pop(f);
      f.wanted = false;
      this.served++;
      if (status === 'found' && search.pointCount > 0) {
        const n = Math.min(search.pointCount, AI_PATH.pathCapacity);
        for (let k = 0; k < n * 3; k++) f.points[k] = search.points[k]!;
        for (let k = 0; k < n; k++) f.links[k] = search.pointLinks[k]!;
        f.count = n;
        f.index = n > 1 ? 1 : 0;
        f.hasRoute = true;
        f.failed = false;
      } else {
        f.hasRoute = false;
        f.failed = true;
      }
    }
  }

  private pop(f: PathFollower): void {
    f.queued = false;
    this.head = (this.head + 1) % this.queue.length;
    this.size--;
  }

  /**
   * Segue a rota: escreve em `out` a direção até o próximo ponto (e pulo/agachar pela ligação). Devolve `false` sem
   * rota, ao chegar no fim (`f.arrived`) ou ao sair dela (`invalidate`, para pedir outra).
   */
  steer(f: PathFollower, x: number, y: number, z: number, onGround: boolean, out: Steer): boolean {
    out.x = 0;
    out.z = 0;
    out.jump = false;
    out.crouch = false;
    out.remaining = 0;
    if (!f.hasRoute) return false;
    const pts = f.points;
    const last = f.count - 1;
    let i = f.index;
    let px = pts[i * 3]!;
    let py = pts[i * 3 + 1]!;
    let pz = pts[i * 3 + 2]!;
    let dx = px - x;
    let dz = pz - z;
    let d = Math.sqrt(dx * dx + dz * dz);
    while (d < AI_PATH.arriveM && Math.abs(py - y) < AI_PATH.arriveDy) {
      if (i >= last) {
        f.hasRoute = false;
        f.arrived = true;
        return false;
      }
      i++;
      px = pts[i * 3]!;
      py = pts[i * 3 + 1]!;
      pz = pts[i * 3 + 2]!;
      dx = px - x;
      dz = pz - z;
      d = Math.sqrt(dx * dx + dz * dz);
    }
    f.index = i;
    // Fora da rota: longe do segmento anterior → atual, ou caiu bem abaixo do ponto.
    let off = d;
    if (i > 0) {
      const ax = pts[(i - 1) * 3]!;
      const az = pts[(i - 1) * 3 + 2]!;
      const sx = px - ax;
      const sz = pz - az;
      const len2 = sx * sx + sz * sz;
      const t = len2 > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * sx + (z - az) * sz) / len2)) : 0;
      const qx = ax + sx * t - x;
      const qz = az + sz * t - z;
      off = Math.sqrt(qx * qx + qz * qz);
    }
    if (off > AI_PATH.offPathM || y < py - 2.5) {
      f.invalidate();
      return false;
    }
    if (d > 1e-6) {
      out.x = dx / d;
      out.z = dz / d;
    }
    const link = f.links[i]!;
    out.jump = link === NAV_LINK.jump && onGround && d < AI_PATH.jumpTriggerM && py - y > 0.55;
    out.crouch = link === NAV_LINK.crouch;
    const lx = pts[last * 3]! - px;
    const lz = pts[last * 3 + 2]! - pz;
    out.remaining = d + Math.sqrt(lx * lx + lz * lz);
    return true;
  }
}
