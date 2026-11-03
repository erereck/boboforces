/**
 * TABELA DE MÉTRICAS CANÔNICA (tecnico.md §7.1, gameplay.md §3.1). Manda sobre arte e técnica: modelo, colisão,
 * câmera, navegação, mapas e validadores leem estes números. Mudou aqui, muda em todo lugar; não duplique valores.
 * Unidades: metros. A coluna "células" é derivada de `BLOCK_SIZE` (0,5 m) pelos testes.
 */
export const METRICS = {
  /** Altura em pé: bobo cabeçudo, ~3 cabeças (decisão #18). 3 células. */
  bodyHeight: 1.5,
  /** Altura do olho em pé. */
  eyeHeight: 1.3,
  /** Altura agachado (~2 células). */
  crouchHeight: 0.95,
  /** Olho agachado. */
  crouchEyeHeight: 0.8,
  /** Cabeça: cubo de ~0,5 m (1 célula, 8×8×8 px na skin). */
  headSize: 0.5,

  /** AABB de movimento: 0,6 × 1,5 × 0,6 m (altura vira `crouchHeight` agachado). */
  aabbWidth: 0.6,
  aabbHeight: 1.5,
  aabbCrouchHeight: 0.95,

  /** Degrau automático (1 célula). */
  stepHeight: 0.5,
  /** Pulo padrão do perfil Bobo (2 células). */
  jumpHeight: 1.0,
  /** Queda sem dano (10 células). */
  safeFallHeight: 5.0,

  /** Cobertura baixa: esconde o bobo agachado (2 células). */
  coverLow: 1.0,
  /** Cobertura alta: esconde em pé; ≥ 1,75 m (4 células = 2,0 m na grade). */
  coverHighMin: 1.75,
  /** Porta: 1,0 × 2,0 m (2 × 4 células). */
  doorWidth: 1.0,
  doorHeight: 2.0,
  /** Corredor mínimo e faixa confortável. */
  corridorMin: 1.0,
  corridorComfortMin: 1.5,
  corridorComfortMax: 2.0,
  /** Pé-direito mínimo e onde se espera pulo. */
  ceilingMin: 2.0,
  ceilingJump: 3.0,
  /** Andar de prédio. */
  storyHeight: 3.0,
  /** Plano de morte abaixo do menor bloco do mapa (tecnico.md §4.5). */
  killPlaneBelow: 10.0,
} as const;

/** Partes do corpo com hitbox própria ("o que você vê é o que acerta"). */
export type HitPart = 'head' | 'torso' | 'arm' | 'leg';

/**
 * Hitboxes (gameplay.md §3.1), largura × altura × profundidade em metros, orientadas pelo yaw.
 * A soma cabeça + tronco + perna = altura do bobo (1,5 m). A forma final é aprovada por print no M1, mas a altura total
 * e a cabeça de 0,5 m não mudam. A camada externa da skin não aumenta a hitbox.
 */
export const HITBOXES: Readonly<Record<HitPart, readonly [w: number, h: number, d: number]>> = {
  head: [0.5, 0.5, 0.5],
  torso: [0.45, 0.5, 0.28],
  arm: [0.18, 0.5, 0.18],
  leg: [0.22, 0.5, 0.22],
};

/** Multiplicador de dano por parte; a cabeça usa o multiplicador da arma (`HEADSHOT_MULTIPLIER`). */
export const PART_DAMAGE_MULTIPLIER: Readonly<Record<Exclude<HitPart, 'head'>, number>> = {
  torso: 1.0,
  arm: 0.8,
  leg: 0.8,
};

/**
 * Headshot por arma (gameplay.md §4.3): padrão 1,5x; sniper 2,0x; escopeta 1,25x. A cabeça grande é alvo fácil, por
 * isso os multiplicadores são baixos. Calibrado pelo robô de balanceamento.
 */
export const HEADSHOT_MULTIPLIER = {
  default: 1.5,
  sniper: 2.0,
  shotgun: 1.25,
} as const;

/** Vida base (gameplay.md §5.1). */
export const BASE_HP = 100;
