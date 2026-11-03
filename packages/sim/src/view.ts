import type { BlockRegistry, WorldGrid } from '@boboforces/world';

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
  /** Slot da arma ativa. */
  readonly weapon: Uint8Array;
  readonly ammoClip: Uint16Array;
  readonly ammoReserve: Uint16Array;
  readonly kills: Uint16Array;
  readonly deaths: Uint16Array;
  /**
   * Recuo acumulado da arma (radianos, somado à mira do InputFrame no tiro). A câmera mostra o "chute" e a IA compensa
   * conforme o controle de recoil. Volta a 0 quando o bobo para de atirar.
   */
  readonly recoilPitch: Float32Array;
  readonly recoilYaw: Float32Array;

  readonly match: MatchView;
  /** A grade do mapa (estática); a IA usa para visão e caminho. */
  readonly world: WorldGrid;
  /** Registro de blocos do mapa (flags de "bloqueia visão/bala" para os raios da IA). */
  readonly blocks: BlockRegistry;
}

export type MatchPhase = 'warmup' | 'playing' | 'ended';

export interface MatchView {
  readonly phase: MatchPhase;
  /** Ticks restantes no relógio da partida, ou -1 sem limite. */
  readonly ticksLeft: number;
  /** Placar por time (`MAX_TEAMS`). */
  readonly teamScore: Int32Array;
  /** Time vencedor quando `phase === 'ended'`, ou -1. */
  readonly winnerTeam: number;
}
