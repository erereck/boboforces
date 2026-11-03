import type { BlockId } from '@boboforces/world';
import type { HitPart } from './config/metrics.ts';
import type { EntityId } from './entity.ts';
import type { MatchPhase } from './view.ts';

/**
 * Eventos que a sim emite (passo 9 da ordem fixa); é o único jeito de render, áudio, UI e rede saberem "o que
 * aconteceu". A sim nunca chama ninguém (tecnico.md §1.1). Cosméticos (detritos, partículas, decals) nascem destes
 * eventos fora da sim, com RNG próprio.
 *
 * VIDA ÚTIL: os objetos vêm de pool da sim e só valem até o próximo `step()`. Quem precisar guardar, copia.
 */
interface EventBase {
  readonly tick: number;
}

/** Disparo (hitscan) com origem no olho e direção unitária; `distance` até o que parou o raio. */
export interface ShotEvent extends EventBase {
  readonly type: 'shot';
  readonly shooter: EntityId;
  readonly weapon: number;
  readonly originX: number;
  readonly originY: number;
  readonly originZ: number;
  readonly dirX: number;
  readonly dirY: number;
  readonly dirZ: number;
  readonly distance: number;
}

export interface HitEvent extends EventBase {
  readonly type: 'hit';
  readonly shooter: EntityId;
  readonly target: EntityId;
  readonly part: HitPart;
  readonly damage: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface KillEvent extends EventBase {
  readonly type: 'kill';
  /** `NULL_ENTITY` para queda, plano de morte etc. */
  readonly killer: EntityId;
  readonly victim: EntityId;
  readonly weapon: number;
  readonly headshot: boolean;
}

/** Bala/projétil acertou o cenário (decal, cubinhos com a cor do texel). */
export interface ImpactEvent extends EventBase {
  readonly type: 'impact';
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly normalX: number;
  readonly normalY: number;
  readonly normalZ: number;
  readonly cellX: number;
  readonly cellY: number;
  readonly cellZ: number;
  readonly block: BlockId;
}

export interface SpawnEvent extends EventBase {
  readonly type: 'spawn';
  readonly entity: EntityId;
}

/** Movimento com som/câmera: pulo, pouso (com a velocidade de queda), deslize, degrau. */
export interface MoveEvent extends EventBase {
  readonly type: 'move';
  readonly entity: EntityId;
  readonly move: 'jump' | 'land' | 'slide' | 'step';
  readonly speed: number;
}

export interface WeaponEvent extends EventBase {
  readonly type: 'weapon';
  readonly entity: EntityId;
  readonly weapon: number;
  readonly action: 'switch' | 'reloadStart' | 'reloadEnd' | 'empty';
}

export interface MatchPhaseEvent extends EventBase {
  readonly type: 'matchPhase';
  readonly phase: MatchPhase;
}

export type SimEvent =
  ShotEvent | HitEvent | KillEvent | ImpactEvent | SpawnEvent | MoveEvent | WeaponEvent | MatchPhaseEvent;

export type SimEventType = SimEvent['type'];
