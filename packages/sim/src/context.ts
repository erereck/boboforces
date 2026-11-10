import type { FigurePart } from '@boboforces/format';
import type { Rng } from '@boboforces/shared';
import type { NavGrid } from '@boboforces/nav';
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

/**
 * M2 (fase 2a): o plano de morte entra no `weapon` do dano e da morte com este código (não é arma): a sim credita o
 * abate a quem feriu a vítima pouco antes (GDD §3.8), e o kill feed mostra a queda.
 */
export const WEAPON_KILL_PLANE = 254;

/**
 * M2 (fase 3b): regras de cada bobo (gameplay.md §6.5), uma por índice de entidade, montadas na criação a partir dos
 * bots da receita (`resolveBot`): ficam fora do estado (saem da receita), então não vão no snapshot nem no hash. Os
 * humanos e os bots sem regra ficam no padrão (vida da partida, ×1, sem restrição).
 */
export interface EntityRules {
  readonly maxHp: Float32Array;
  readonly damageMult: Float32Array;
  readonly speed: Float32Array;
  /** `AMMO_RULE`. */
  readonly ammo: Uint8Array;
  /** Armas permitidas (bit = código da arma); 0 = todas. */
  readonly weaponMask: Uint16Array;
  /** `RULE_FLAG`. */
  readonly flags: Uint8Array;
}

/** Munição por regra: normal, reserva infinita, pente infinito. */
export const AMMO_RULE = { normal: 0, infiniteReserve: 1, infiniteClip: 2 } as const;

/** Bits de `EntityRules.flags`. */
export const RULE_FLAG = { headshotImmune: 1, explodeOnDeath: 2 } as const;

/** Estado da partida (o `MatchView` lê daqui). */
export interface MatchState {
  phase: MatchPhase;
  ticksLeft: number;
  /** M2: ticks da contagem inicial que faltam (`warmup`). */
  countdownTicks: number;
  readonly teamScore: Int32Array;
  winnerTeam: number;
  /** M2: vencedor do FFA (EntityId) ou `NULL_ENTITY`. */
  winnerEntity: number;
}

/** Paredes invisíveis em X/Z (metros); o movimento desconta a meia largura da AABB. */
export interface PlayArea {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

/** Tudo que os sistemas precisam, montado uma vez no `createSim`. Valores em ticks já convertidos pelo `hz` da partida. */
/**
 * M2 (fase 4e): modificadores da partida (gameplay.md §4.5; `MatchRecipe.weapons`), fixos na partida (fora do estado e
 * do hash). Os padrões (`DEFAULT_MATCH_MODS`) são o jogo de sempre.
 */
export interface MatchMods {
  /** Multiplicador do dano de arma (0,25 a 5). */
  readonly damageMul: number;
  /** Só tiro na cabeça fere (bala e chumbo; explosão e faca seguem valendo). */
  readonly headshotOnly: boolean;
  /** Qualquer dano de arma mata. */
  readonly oneShot: boolean;
  readonly ads: boolean;
  readonly recoil: boolean;
  readonly spread: boolean;
  /** Fogo amigo: 0 (desligado: a bala passa pelo aliado), 0,5 ou 1. */
  readonly friendlyFire: number;
  readonly selfDamage: boolean;
  /** A sniper mata em qualquer parte do corpo. */
  readonly sniperBodyKill: boolean;
}

export const DEFAULT_MATCH_MODS: MatchMods = {
  damageMul: 1,
  headshotOnly: false,
  oneShot: false,
  ads: true,
  recoil: true,
  spread: true,
  friendlyFire: 0,
  selfDamage: true,
  sniperBodyKill: false,
};

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
  /** M2 (fase 5d): Bobo Training (os bots nascem espalhados pelos pontos sem time). */
  readonly training: boolean;
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
  /** M2 (fase 2a): morte súbita, janela da assistência, crédito do plano de morte (ticks) e o mínimo da assistência. */
  readonly suddenDeathTicks: number;
  readonly assistWindowTicks: number;
  readonly assistMinDamage: number;
  readonly killPlaneCreditTicks: number;
  /**
   * M2: rascunho do spawn pontuado, um valor por ponto do mapa, alocado na criação: a nota e uma marca (FFA: ponto já
   * testado; TDM: quantos inimigos o enxergam).
   */
  readonly spawnScore: Float64Array;
  readonly spawnMark: Uint8Array;
  /** M2 (fase 2b): navegação do mapa (Destravar) e o componente com mais nós (o "mapa de verdade"). */
  readonly nav: NavGrid | null;
  readonly navMainComponent: number;
  /** M2 (fase 2b): vida da caixinha de munição em ticks. */
  readonly ammoBoxTicks: number;
  /** M2 (fase 3b): regras por entidade. */
  readonly rules: EntityRules;
  /** M2 (fase 4e): modificadores da partida. */
  readonly mods: MatchMods;
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
  /** M3 (fase 2a): Bobo Zombies (`mode: 'zombies'`): o diretor de ondas, os renascimentos e o pool de zumbis. */
  readonly zombiesMode: boolean;
  readonly zombieRunProfile: MovementProfile;
  /** As regras do modo já resolvidas (padrões do `ZOMBIES_DEFAULTS`) e os tempos em ticks. */
  readonly zombieRules: ZombieModeRules;
  /** Humanos da partida (a fórmula das ondas). */
  readonly humans: number;
  /** O estado do diretor de ondas (no snapshot e no hash só no Bobo Zombies). */
  readonly waves: WaveState;
  readonly rngZombies: Rng;
}

/** M3 (fase 2a): as regras do Bobo Zombies resolvidas para a sim. */
export interface ZombieModeRules {
  /** Ondas até a vitória (0 = sem fim). */
  readonly waves: number;
  readonly quantity: number;
  readonly hpMul: number;
  readonly firstWaveTicks: number;
  readonly intermissionTicks: number;
  readonly spawnIntervalTicks: number;
}

/** M3 (fase 2a): o diretor de ondas. Tudo número, para o snapshot. */
export interface WaveState {
  /** Onda atual (0 = antes da 1ª). */
  wave: number;
  /** 1 = no intervalo antes da próxima onda. */
  resting: number;
  /** Ticks que faltam do intervalo. */
  restTicks: number;
  /** Zumbis da onda ainda por soltar, e ticks até o próximo. */
  toSpawn: number;
  spawnTicks: number;
  /** Vida dos zumbis desta onda e a chance (0..1) de cada um correr. */
  waveHp: number;
  runChance: number;
  /** Zumbis que faltam (por soltar + vivos). */
  left: number;
  /** O último zumbi da onda (`NULL_ENTITY` = nenhum ainda). */
  lastZombie: number;
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

/**
 * M2 (fase 4e): `a` pode ferir `b`? Inimigos sempre; com fogo amigo, também o aliado (bobo do mesmo time, nunca a si
 * mesmo). Quem decide se o abate conta é o `hostile`.
 */
export function canHurt(ctx: SimContext, a: number, b: number): boolean {
  if (a === b) return false;
  if (hostile(ctx, a, b)) return true;
  return ctx.mods.friendlyFire > 0 && ctx.s.kind[a] === ENTITY_KIND.bobo && ctx.s.kind[b] === ENTITY_KIND.bobo;
}

/** Entidade com corpo de bobo (bobo ou zumbi): anda, leva tiro e morre. */
export function isBody(kind: number): boolean {
  return kind === ENTITY_KIND.bobo || kind === ENTITY_KIND.zombie;
}
