import { WEAPON_SLOT_COUNT } from '@boboforces/input';
import type { NavGrid } from '@boboforces/nav';
import type { BlockRegistry, StaticColliders, WorldGrid } from '@boboforces/world';
import type { MatchMods } from './context.ts';

/**
 * Leitura do estado da sim para render, ui, audio, ai e input (tecnico.md §4.4: "o 3D só lê o estado").
 * Struct-of-arrays com capacidade fixa (`capacity` = MAX_ENTITIES): os arrays são da sim, SOMENTE LEITURA para quem
 * consome, e continuam os mesmos objetos entre ticks (dá para guardar a referência). Iterar de 0 a `count - 1`
 * conferindo `alive[i]`.
 *
 * Posição = centro da base da AABB (os pés), em metros. Ângulos em radianos (convenção do shared: yaw 0 olha para -Z).
 * `prev*` é o estado do tick anterior: o render interpola com `alpha` do passo fixo.
 */
export interface SimView {
  readonly tick: number;
  readonly capacity: number;
  /** Maior índice em uso + 1. */
  readonly count: number;

  readonly alive: Uint8Array;
  readonly generation: Uint16Array;
  /** `ENTITY_KIND`. */
  readonly kind: Uint8Array;
  /** Time 0..3 ou `NO_TEAM`. */
  readonly team: Uint8Array;
  /** Bits de `ENTITY_FLAG`. */
  readonly flags: Uint32Array;
  /** Índice do controlador (0..3 humanos, 4.. bots) ou `NO_CONTROLLER`. */
  readonly controller: Int16Array;

  /** 3 por entidade (x, y, z). */
  readonly position: Float64Array;
  readonly prevPosition: Float64Array;
  readonly velocity: Float64Array;
  readonly yaw: Float64Array;
  readonly prevYaw: Float64Array;
  readonly pitch: Float64Array;
  readonly prevPitch: Float64Array;

  readonly health: Float32Array;
  /** M3 (fase 2a): o tipo de cada zumbi do Bobo Zombies (`ZOMBIE_TYPE`; 0 fora do modo). */
  readonly zombieType: Uint8Array;
  /** M3 (fase 2b): os pontos de cada bobo no Bobo Zombies (0 fora do modo). */
  readonly points: Int32Array;
  /**
   * M3 (fase 2c): caído (`ENTITY_FLAG.downed`): ticks até sangrar ou levantar sozinho (`selfUp` 1) e o progresso do
   * reviver em ticks (0 = ninguém levantando).
   */
  readonly downTicks: Int32Array;
  readonly selfUp: Uint8Array;
  readonly reviveTicks: Int32Array;
  /** M2: código da arma na mão (`WEAPON_CODE`, índice em `WEAPONS`), ou `WEAPON_NONE` (zumbi). */
  readonly weapon: Uint8Array;
  /** M2: slot ativo do loadout (0..3: primária, pistola, faca, granada). */
  readonly slot: Uint8Array;
  /**
   * M2: loadout e munição por slot, `WEAPON_SLOT_COUNT` (4) por entidade: `loadout[e * 4 + s]` é o código da arma
   * do slot `s` (`WEAPON_NONE` = vazio), `slotClip` o pente (na granada, quantas sobram) e `slotReserve` a
   * reserva. A munição da arma na mão é `slotClip[e * 4 + slot[e]]` (`heldAmmo`).
   */
  readonly loadout: Uint8Array;
  readonly slotClip: Uint16Array;
  readonly slotReserve: Uint16Array;
  /** M2: quanto do ADS já entrou (0..1); a câmera aplica `WeaponDef.adsZoom` nessa fração. */
  readonly adsAmount: Float32Array;
  readonly kills: Uint16Array;
  readonly deaths: Uint16Array;
  /** M2 (fase 2a): assistências (25 de dano ou mais na vítima nos 10 s antes do abate de outro). */
  readonly assists: Uint16Array;
  /** M2 (fase 2c): ticks até renascer (morto; a tela de morte mostra a contagem). */
  readonly respawnTicks: Int32Array;
  /**
   * M2 (fase 3c): quem causou o último dano (EntityId; `NULL_ENTITY` = ninguém ou queda). A IA usa: o bot sempre sabe de
   * onde tomou dano (gameplay.md §6.3).
   */
  readonly lastAttacker: Uint32Array;
  /**
   * Recuo acumulado da arma (radianos, somado à mira do InputFrame no tiro). A câmera mostra o "chute" e a IA compensa
   * conforme o controle de recoil. Volta a 0 quando o bobo para de atirar.
   */
  readonly recoilPitch: Float32Array;
  readonly recoilYaw: Float32Array;

  /** M2 (fase 1b): projéteis em voo (foguete, granada). */
  readonly projectiles: ProjectileView;
  /** M2 (fase 2b): pickups no chão (a caixinha de munição). */
  readonly pickups: PickupView;
  readonly match: MatchView;
  /** A grade do mapa (estática); a IA usa para visão e caminho. */
  readonly world: WorldGrid;
  /** Registro de blocos do mapa (flags de "bloqueia visão/bala" para os raios da IA). */
  readonly blocks: BlockRegistry;
  /** M1: caixas das props (`SimMap.colliders`; raios da IA), ou `null`. */
  readonly colliders: StaticColliders | null;
  /** M1: navegação do mapa (`SimMap.nav`), ou `null` (M0 e testes: a IA anda reto). */
  readonly nav: NavGrid | null;
  /**
   * M1 (integração): área jogável em metros (`SimMap.playArea`; paredes invisíveis em X/Z), ou `null` = a grade
   * inteira. A IA não escolhe destino fora dela.
   */
  readonly playArea: {
    readonly minX: number;
    readonly minZ: number;
    readonly maxX: number;
    readonly maxZ: number;
  } | null;
  /** M2 (fase 4e): os modificadores da partida (a IA lê o ADS e o fogo amigo). */
  readonly mods: MatchMods;
}

/**
 * Projéteis em voo (pool fixo; iterar de 0 a `count - 1` conferindo `alive[i]`). 3 valores por projétil em
 * `position`, `prevPosition` (o render interpola) e `velocity` (m/s; o render orienta o foguete por ela).
 */
export interface ProjectileView {
  readonly count: number;
  readonly alive: Uint8Array;
  /** Código da arma (`WEAPON_CODE.rocket`, `WEAPON_CODE.grenade`). */
  readonly weapon: Uint8Array;
  readonly owner: Uint32Array;
  readonly position: Float64Array;
  readonly prevPosition: Float64Array;
  readonly velocity: Float64Array;
}

/** M2 (fase 2b): tipos de pickup (`PickupView.kind`). Valor novo entra no fim. */
export const PICKUP_KIND = { ammoBox: 0 } as const;

/**
 * Pickups no chão (pool fixo; iterar de 0 a `count - 1` conferindo `alive[i]`). Posição = pés da caixinha (m);
 * `prevPosition` para o render interpolar a queda.
 */
export interface PickupView {
  readonly count: number;
  readonly alive: Uint8Array;
  readonly kind: Uint8Array;
  readonly position: Float64Array;
  readonly prevPosition: Float64Array;
  /** Ticks até sumir (o render pisca no fim). */
  readonly ticksLeft: Int32Array;
}

/**
 * Fases da partida. `warmup` é a contagem inicial (M2: olhar em volta pode; andar, atirar e trocar de arma não; o
 * relógio parado). `suddenDeath` (M2) é a morte súbita depois de um empate no fim do tempo: o relógio conta os 60 s e
 * o primeiro abate que desempata encerra. Valor novo entra no FIM (o snapshot guarda o índice).
 */
export type MatchPhase = 'warmup' | 'playing' | 'ended' | 'suddenDeath';

/** M2: a partida está valendo (tiro, golpe e placar): jogando ou na morte súbita. */
export function isLivePhase(phase: MatchPhase): boolean {
  return phase === 'playing' || phase === 'suddenDeath';
}

export interface MatchView {
  readonly phase: MatchPhase;
  /** Ticks restantes no relógio da partida (na morte súbita, os dela), ou -1 sem limite. */
  readonly ticksLeft: number;
  /** M2: ticks que faltam da contagem inicial (`warmup`); 0 fora dela. */
  readonly countdownTicks: number;
  /** Placar por time (`MAX_TEAMS`). */
  readonly teamScore: Int32Array;
  /** Time vencedor quando `phase === 'ended'`, ou -1 (empate). */
  readonly winnerTeam: number;
  /** M2: no FFA, o bobo vencedor quando `phase === 'ended'` (`NULL_ENTITY` no empate e nos modos de time). */
  readonly winnerEntity: number;
  /**
   * M3 (fase 2a): Bobo Zombies (0 e -1 nos outros modos): a onda atual (0 = antes da 1ª), os zumbis que faltam (por
   * soltar + vivos), os ticks do intervalo antes da próxima onda (-1 = no meio de uma onda) e o último zumbi da onda
   * (`NULL_ENTITY` = nenhum). No fim, `winnerTeam` 0 = vitória, -1 = derrota.
   */
  readonly zombieWave: number;
  readonly zombiesLeft: number;
  readonly zombieRestTicks: number;
  readonly lastZombie: number;
  /** M3 (fase 2c): "levanta sozinho" que sobram (-1 = sem limite; 0 fora do modo). */
  readonly selfRevivesLeft: number;
}

/** M2: pente da arma na mão de `e` (`slotClip` do slot ativo; na granada, quantas sobram). */
export function heldClip(view: SimView, e: number): number {
  return view.slotClip[e * WEAPON_SLOT_COUNT + view.slot[e]!]!;
}

/** M2: reserva da arma na mão de `e`. */
export function heldReserve(view: SimView, e: number): number {
  return view.slotReserve[e * WEAPON_SLOT_COUNT + view.slot[e]!]!;
}
