import type { FigurePart } from '@boboforces/format';
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

/**
 * Acerto em bobo (ou zumbi). `bodyPart` diz QUAL dos 12 ossos do boneco foi atingido (`FIGURE_BONE` do format, #56:
 * cabeça, tronco, braço e antebraço D/E, coxa, canela e pé D/E; u8) e `dir*` é a direção do tiro (unitária): o render
 * acha o texel da skin no ponto (cor dos cubinhos) e joga os cubinhos nessa direção. `part` continua sendo a categoria
 * de dano (`FIGURE_PART_CATEGORY` do osso).
 */
export interface HitEvent extends EventBase {
  readonly type: 'hit';
  readonly shooter: EntityId;
  readonly target: EntityId;
  readonly part: HitPart;
  readonly bodyPart: FigurePart;
  readonly damage: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly dirX: number;
  readonly dirY: number;
  readonly dirZ: number;
}

/**
 * Morte. M1: direção do golpe (`dir*`, unitária; zero em queda e plano de morte), força em m/s e a parte que levou o
 * golpe final (`FIGURE_BONE`; corpo a corpo e plano de morte = tronco, queda = pé D). O DESMONTE é cosmético e fica
 * no render (os grupos do boneco viram corpos Verlet que somem em 4 s); a sim só conta a morte.
 */
export interface KillEvent extends EventBase {
  readonly type: 'kill';
  /** `NULL_ENTITY` para queda, plano de morte etc. */
  readonly killer: EntityId;
  readonly victim: EntityId;
  readonly weapon: number;
  readonly headshot: boolean;
  readonly bodyPart: FigurePart;
  readonly dirX: number;
  readonly dirY: number;
  readonly dirZ: number;
  readonly force: number;
}

/**
 * Bala/projétil acertou o cenário (decal, cubinhos com a cor do texel). M1: `face` é o índice da face atingida na
 * `NORMAL_TABLE` do world (0..5 eixos; rampas e cruz a partir do 6; -1 em prop) e `prop` o índice da caixa de prop em
 * `StaticColliders` (-1 = bloco da grade). Com `block` + `face` + o ponto, o render acha a camada e o texel.
 */
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
  readonly face: number;
  readonly prop: number;
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

/** M1: golpe corpo a corpo do zumbi (animação e som; o dano vem num `hit` à parte quando acerta). */
export interface MeleeEvent extends EventBase {
  readonly type: 'melee';
  readonly attacker: EntityId;
  /** `NULL_ENTITY` quando errou. */
  readonly target: EntityId;
}

export interface MatchPhaseEvent extends EventBase {
  readonly type: 'matchPhase';
  readonly phase: MatchPhase;
}

export type SimEvent =
  ShotEvent | HitEvent | KillEvent | ImpactEvent | SpawnEvent | MoveEvent | WeaponEvent | MeleeEvent | MatchPhaseEvent;

export type SimEventType = SimEvent['type'];
