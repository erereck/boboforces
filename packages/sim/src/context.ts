import type { FigurePart } from '@boboforces/format';
import type { Rng } from '@boboforces/shared';
import type { BlockRegistry, StaticColliders, WorldGrid } from '@boboforces/world';
import type { HitPart } from './config/metrics.ts';
import type { MovementProfile } from './config/movement.ts';
import { ENTITY_KIND, type EntityId } from './entity.ts';
import type { EventQueue } from './event-queue.ts';
import type { FigureHitCache } from './hitbox.ts';
import type { SpawnPoint } from './sim.ts';
import type { SimState } from './state.ts';
import type { MatchPhase } from './view.ts';

/** Sem arma (queda, plano de morte, golpe do zumbi). Vai no `weapon` dos eventos de dano/morte. */
export const WEAPON_NONE = 255;

/** Partes na ordem dos códigos u8 do dano pendente. */
export const HIT_PARTS: readonly HitPart[] = ['head', 'torso', 'arm', 'leg'];
export const PART_HEAD = 0;
export const PART_TORSO = 1;

/**
 * Dano do tick, aplicado no passo 5 (depois de TODOS os tiros e golpes do passo 3). Assim dois bobos que se acertam no
 * mesmo tick trocam a morte, em vez de o de índice menor ganhar sempre. M1: cada item leva também a parte do modelo
 * (`FIGURE_BONE`), a direção unitária do golpe e a força (m/s) que vai no `KillEvent` se ele matar.
 */
export class DamageQueue {
  readonly capacity: number;
  count = 0;
  readonly target: Int32Array;
  readonly attacker: Uint32Array;
  readonly amount: Float64Array;
  readonly part: Uint8Array;
  readonly bodyPart: Uint8Array;
  readonly weapon: Uint8Array;
  readonly point: Float64Array;
  readonly dir: Float64Array;
  readonly force: Float32Array;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.target = new Int32Array(capacity);
    this.attacker = new Uint32Array(capacity);
    this.amount = new Float64Array(capacity);
    this.part = new Uint8Array(capacity);
    this.bodyPart = new Uint8Array(capacity);
    this.weapon = new Uint8Array(capacity);
    this.point = new Float64Array(capacity * 3);
    this.dir = new Float64Array(capacity * 3);
    this.force = new Float32Array(capacity);
  }

  /** Enfileira um dano; devolve o índice do item (para `setDirection`) ou -1 se a fila estiver cheia. */
  push(
    target: number,
    attacker: EntityId,
    amount: number,
    part: number,
    bodyPart: FigurePart,
    weapon: number,
    x: number,
    y: number,
    z: number,
  ): number {
    // Cheio só com bug (o teto é 1 tiro ou golpe por entidade por tick): descarta em vez de alocar.
    if (this.count >= this.capacity) return -1;
    const i = this.count++;
    this.target[i] = target;
    this.attacker[i] = attacker;
    this.amount[i] = amount;
    this.part[i] = part;
    this.bodyPart[i] = bodyPart;
    this.weapon[i] = weapon;
    this.point[i * 3] = x;
    this.point[i * 3 + 1] = y;
    this.point[i * 3 + 2] = z;
    this.dir[i * 3] = 0;
    this.dir[i * 3 + 1] = 0;
    this.dir[i * 3 + 2] = 0;
    this.force[i] = 0;
    return i;
  }

  /** Direção (unitária) e força (m/s) do golpe do item `i` (queda e plano de morte ficam com zero). */
  setDirection(i: number, dx: number, dy: number, dz: number, force: number): void {
    if (i < 0) return;
    this.dir[i * 3] = dx;
    this.dir[i * 3 + 1] = dy;
    this.dir[i * 3 + 2] = dz;
    this.force[i] = force;
  }
}

/** Estado da partida (o `MatchView` lê daqui). */
export interface MatchState {
  phase: MatchPhase;
  ticksLeft: number;
  readonly teamScore: Int32Array;
  winnerTeam: number;
}

/** Paredes invisíveis em X/Z (metros); o movimento desconta a meia largura da AABB. */
export interface PlayArea {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

/** Tudo que os sistemas precisam, montado uma vez no `createSim`. Valores em ticks já convertidos pelo `hz` da partida. */
export interface SimContext {
  readonly s: SimState;
  readonly events: EventQueue;
  readonly damage: DamageQueue;
  readonly match: MatchState;
  readonly grid: WorldGrid;
  readonly blocks: BlockRegistry;
  /** Caixas das props (colisão e raios), ou `null` (só a grade). */
  readonly colliders: StaticColliders | null;
  readonly spawns: readonly SpawnPoint[];
  /** Perfil de movimento do bobo (da receita) e do zumbi. */
  readonly profile: MovementProfile;
  readonly zombieProfile: MovementProfile;
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
  /** Área jogável do mapa, ou `null` (a grade inteira; a borda da grade já é parede para a colisão). */
  readonly playArea: PlayArea | null;
  /** Zumbis: vida, tempo morto e intervalo do golpe já em ticks/segundos da partida. */
  readonly zombieHp: number;
  readonly zombieRespawnTicks: number;
  readonly rngSpawn: Rng;
  readonly rngWeapons: Rng;
  /** Hitboxes do boneco: a tabela de jogo da partida e o cache de caixas por corpo por tick (`hitbox.ts`). */
  readonly figures: FigureHitCache;
}

/**
 * `a` e `b` são inimigos? Zumbis são inimigos de todo bobo e nunca uns dos outros. Entre bobos: no FFA todo mundo é;
 * nos outros modos, times diferentes.
 */
export function hostile(ctx: SimContext, a: number, b: number): boolean {
  if (a === b) return false;
  const s = ctx.s;
  const za = s.kind[a] === ENTITY_KIND.zombie;
  const zb = s.kind[b] === ENTITY_KIND.zombie;
  if (za || zb) return za !== zb;
  return ctx.ffa || s.team[a] !== s.team[b];
}

/** Entidade com corpo de bobo (bobo ou zumbi): anda, leva tiro e morre. */
export function isBody(kind: number): boolean {
  return kind === ENTITY_KIND.bobo || kind === ENTITY_KIND.zombie;
}
