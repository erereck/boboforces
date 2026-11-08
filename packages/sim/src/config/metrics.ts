/**
 * TABELA DE MÉTRICAS CANÔNICA (tecnico.md §7.1, gameplay.md §3.1). Manda sobre arte e técnica: modelo, colisão,
 * câmera, navegação, mapas e validadores leem estes números. Mudou aqui, muda em todo lugar; não duplique valores.
 * Unidades: metros. A coluna "células" é derivada de `BLOCK_SIZE` (0,5 m) pelos testes.
 */
export const METRICS = {
  /**
   * Altura em pé: 1,75 m (decisão #55, altura B). 3½ células (4 na grade: a navegação pede `ceil(aabbHeight / 0,5)`
   * células livres).
   */
  bodyHeight: 1.75,
  /** Altura do olho em pé: corpo − 0,2 m (os olhos do rosto; fica dentro das janelas e seteiras de 1,0–2,0 m). */
  eyeHeight: 1.55,
  /** Altura agachado (~2 células). */
  crouchHeight: 0.95,
  /** Olho agachado. */
  crouchEyeHeight: 0.8,
  /** Cabeça do boneco do FutBobo (#56): cubo de 8 px = 0,4375 m (1 px = 7/128 m, `FIGURE_HEAD_HALF_M` × 2). */
  headSize: 0.4375,

  /** AABB de movimento: 0,6 × 1,75 × 0,6 m (altura vira `crouchHeight` agachado). */
  aabbWidth: 0.6,
  aabbHeight: 1.75,
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

/**
 * Categorias de dano das hitboxes ("o que você vê é o que acerta"; gameplay.md §3.1). As hitboxes são as 12 caixas do
 * boneco do FutBobo (#56, PLANO do porte §B4–§B5), uma por osso, tiradas de `FIGURE_BODY_BOXES` (px de 7/128 m) e
 * posadas pela tabela de jogo (`figureHitBoxes`, postura × pitch; `hitbox.ts`); `FIGURE_PART_CATEGORY` dá a categoria
 * de cada osso. Por categoria, em px:
 * - cabeça: 8 × 8 × 8 (0,4375 m, `headSize`);
 * - tronco: 8 × 12 × 4;
 * - braço: braço 4 × 5,2 × 4 e antebraço + mão 3,8 × 6,8 × 3,8 (uma caixa só), cortados a `ARM_HIT_CUT_M` do eixo;
 * - perna: coxa 4,25 × 5,6 × 4,3, canela 3,75 × 4,9 × 3,75 e pé 4,05 × 2,7 × 5,25.
 * Em pé, quadril 12 px + tronco 12 + cabeça 8 = 32 px = 1,75 m (`bodyHeight`). A tabela `HITBOXES` (uma caixa por
 * categoria, do bobo de caixas) saiu no passo 5 do porte: ninguém a lia.
 */
export type HitPart = 'head' | 'torso' | 'arm' | 'leg';

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
