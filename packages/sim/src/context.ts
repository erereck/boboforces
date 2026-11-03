import type { Rng } from '@boboforces/shared';
import type { BlockRegistry, WorldGrid } from '@boboforces/world';
import type { HitPart } from './config/metrics.ts';
import type { MovementProfile } from './config/movement.ts';
import type { EntityId } from './entity.ts';
import type { EventQueue } from './event-queue.ts';
import type { SpawnPoint } from './sim.ts';
import type { SimState } from './state.ts';
import type { MatchPhase } from './view.ts';

/** Sem arma (queda, plano de morte). Vai no `weapon` dos eventos de dano/morte. */
export const WEAPON_NONE = 255;

/** Partes na ordem dos códigos u8 do dano pendente. */
export const HIT_PARTS: readonly HitPart[] = ['head', 'torso', 'arm', 'leg'];
export const PART_HEAD = 0;
export const PART_TORSO = 1;

/**
 * Dano do tick, aplicado no passo 5 (depois de TODOS os tiros do passo 3). Assim dois bobos que se acertam no mesmo
 * tick trocam a morte, em vez de o de índice menor ganhar sempre.
 */
export class DamageQueue {
  readonly capacity: number;
  count = 0;
  readonly target: Int32Array;
  readonly attacker: Uint32Array;
  readonly amount: Float64Array;
  readonly part: Uint8Array;
  readonly weapon: Uint8Array;
  readonly point: Float64Array;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.target = new Int32Array(capacity);
    this.attacker = new Uint32Array(capacity);
    this.amount = new Float64Array(capacity);
    this.part = new Uint8Array(capacity);
    this.weapon = new Uint8Array(capacity);
    this.point = new Float64Array(capacity * 3);
  }

  push(
    target: number,
    attacker: EntityId,
    amount: number,
    part: number,
    weapon: number,
    x: number,
    y: number,
    z: number,
  ): void {
    // Cheio só com bug (o teto é 1 tiro por bobo por tick): descarta em vez de alocar.
    if (this.count >= this.capacity) return;
    const i = this.count++;
    this.target[i] = target;
    this.attacker[i] = attacker;
    this.amount[i] = amount;
    this.part[i] = part;
    this.weapon[i] = weapon;
    this.point[i * 3] = x;
    this.point[i * 3 + 1] = y;
    this.point[i * 3 + 2] = z;
  }
}

/** Estado da partida (o `MatchView` lê daqui). */
export interface MatchState {
  phase: MatchPhase;
  ticksLeft: number;
  readonly teamScore: Int32Array;
  winnerTeam: number;
}

/** Tudo que os sistemas precisam, montado uma vez no `createSim`. Valores em ticks já convertidos pelo `hz` da partida. */
export interface SimContext {
  readonly s: SimState;
  readonly events: EventQueue;
  readonly damage: DamageQueue;
  readonly match: MatchState;
  readonly grid: WorldGrid;
  readonly blocks: BlockRegistry;
  readonly spawns: readonly SpawnPoint[];
  readonly profile: MovementProfile;
  readonly ffa: boolean;
  readonly warfare: boolean;
  readonly hz: number;
  readonly dt: number;
  /** Tick sendo simulado agora (o `tick` dos eventos). */
  tick: number;
  readonly maxHp: number;
  readonly respawnTicks: number;
  readonly spawnProtectTicks: number;
  readonly regenDelayTicks: number;
  readonly regenPerTick: number;
  readonly scoreLimit: number;
  /** Abaixo disto (pés, m) o bobo morre (tecnico.md §4.5). */
  readonly killPlaneY: number;
  readonly rngSpawn: Rng;
  readonly rngWeapons: Rng;
}

/** `a` e `b` são inimigos? No FFA todo mundo é; nos outros modos, times diferentes. */
export function hostile(ctx: SimContext, a: number, b: number): boolean {
  if (a === b) return false;
  return ctx.ffa || ctx.s.team[a] !== ctx.s.team[b];
}
