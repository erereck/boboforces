/**
 * Empunhaduras do boneco armado (decisão #56; PLANO do porte §B3 e o estudo de anatomia §5.2–§5.3). Dona: frente F1.
 * Dados puros: a tabela de jogo (`figure-table.ts`) monta as posturas armadas com eles, pelo IK (`figure-ik.ts`).
 *
 * Moldura da mira: origem no meio dos ombros (`torso`·(0; 11,5; 0)), eixos do FutBobo (+x = esquerda do boneco, +y =
 * cima, +z = frente), girada só pelo pitch dos braços, Rx(−pitch), em volta da linha horizontal dos ombros (o tronco não
 * leva pitch). A arma vai NA moldura (o cano aponta na mira) e as mãos seguem pelo IK: a palma D vai ao `hand_r` e a E
 * ao `hand_l` (ou ao pente). Medidas em px de boneco; os vetores da arma vêm dos soquetes de `assets-src/models/
 * weapons.ts` (texels a 32 t/m: 1 t = 4/7 px), convertidos para o frame do FutBobo por Ry(π): (x, y, z) → (−x, y, −z).
 * O E.11 (`tools/modelgen/src/sockets.test.ts`) confere cada vetor contra o `.bfmodel` (± 0,25 t).
 *
 * Matriz da arma (`FigureGameTable.grip`): no espaço do antebraço D, em px, com os eixos DO MODELO da arma (+x =
 * direita, +y = cima, cano para −z) e a origem no soquete `hand_r`. O render faz antebraço D × grip × S(1/FIGURE_PX_M)
 * × T(−hand_r em m) para pôr a malha da arma (metros, eixos do modelo) no mundo.
 */

/** px de boneco por texel de arma: (1/32 m) / (7/128 m). */
const TEXEL_PX = 4 / 7;

/** Vetor de 3 números (px, frame do FutBobo, salvo onde diz texel). */
export type FigureVec3 = readonly [number, number, number];

export interface FigureGripDef {
  /** Id do modelo da arma (`model:<id>`), para o E.11. */
  readonly model: 'pistol' | 'rifle' | 'sniper';
  /** Palma D (= `hand_r`) na moldura da mira, base e ADS (px). */
  readonly base: FigureVec3;
  readonly ads: FigureVec3;
  /** Giro do tronco (rad; < 0 = ombro E à frente) na base e no ADS; a cabeça volta para a frente pelo pescoço. */
  readonly torsoY: number;
  /**
   * Correndo: palma D a partir do meio dos ombros nos eixos da RAIZ (sem girar; o estudo de anatomia §5.3 dá (−1; 6,5;
   * 2) no quadril para o fuzil), giro do tronco e a inclinação do cano (rad, < 0 = para baixo), fixos, sem o pitch.
   */
  readonly sprint: FigureVec3;
  readonly sprintTorsoY: number;
  readonly sprintTilt: number;
  /** Mão E correndo: no pente (`true`) ou na telha (`false`). */
  readonly sprintOnMag: boolean;
  /** `hand_l − hand_r` do modelo no frame do FutBobo (px): a telha (ou o apoio, na pistola). */
  readonly left: FigureVec3;
  /** Onde a mão E pega o pente (soquete `mag` + `magDownT` texels para baixo) − `hand_r`, no frame do FutBobo (px). */
  readonly mag: FigureVec3;
  /** Texels abaixo do soquete `mag` onde a mão E pega o pente (o E.11 refaz o `mag` com isto). */
  readonly magDownT: number;
  /**
   * ADS em pé: a cabeça desce (neckX, rad) sobre a coronha. O `neckZ` +0,15 do §B3 (deitar a cabeça para o lado da
   * arma) ficou de fora: com o pitch ele levava a quina da cabeça a 1,84 m, acima do `FIGURE_MAX_TOP_M` 1,81.
   */
  readonly adsHeadDip: number;
}

/**
 * As 3 empunhaduras (PLANO §B3; estudo de anatomia §5.3). Fuzil e sniper: palma D em (−2,0; −3,5; +2,5), ADS em
 * (−1,6; −1,3; +3,0) com a cabeça baixa sobre a coronha, tronco de lado (−0,80 e −0,85) para a mão E alcançar a telha (de
 * frente o alvo dela fica a 134% do alcance). Pistola: (−0,4; −2,0; +7,5) com as duas mãos, tronco −0,25; o ADS é a base
 * (o ADS mais alto do estudo passa do alcance). Correndo: cano −0,55, tronco −0,45 e mão E no pente (fuzil e sniper);
 * a pistola corre baixa com as duas mãos.
 *
 * Soquetes (texels, `weapons.ts`): pistola `hand_r` (0; −2,5; 0,5), `hand_l` (−1; −3,5; 0,5), `mag` (0; −5; 0,5);
 * fuzil (0; −2,5; 3,5), (0; 0,5; −11), (0; 0; −3,5); sniper (0; −3,5; 4,5), (0; −1; −12), (0; 0; −3).
 */
export const FIGURE_GRIPS = {
  pistol: {
    model: 'pistol',
    base: [-0.4, -2, 7.5],
    ads: [-0.4, -2, 7.5],
    torsoY: -0.25,
    // Baixa, à frente da barriga, com as duas mãos.
    sprint: [-0.4, -7.8, 2.3],
    sprintTorsoY: -0.25,
    sprintTilt: -0.55,
    sprintOnMag: false,
    // hand_l − hand_r = (−1; −1; 0) t.
    left: [1 * TEXEL_PX, -1 * TEXEL_PX, 0],
    // mag + 1 t para baixo − hand_r = (0; −3,5; 0) t: a base do pente, embaixo da empunhadura.
    mag: [0, -3.5 * TEXEL_PX, 0],
    magDownT: 1,
    adsHeadDip: 0,
  },
  rifle: {
    model: 'rifle',
    base: [-2, -3.5, 2.5],
    ads: [-1.6, -1.3, 3],
    torsoY: -0.8,
    sprint: [-1, -5, 2],
    sprintTorsoY: -0.45,
    sprintTilt: -0.55,
    sprintOnMag: true,
    // hand_l − hand_r = (0; 3; −14,5) t.
    left: [0, 3 * TEXEL_PX, 14.5 * TEXEL_PX],
    // mag + 4 t para baixo − hand_r = (0; −1,5; −7) t (o estudo de anatomia §5.3).
    mag: [0, -1.5 * TEXEL_PX, 7 * TEXEL_PX],
    magDownT: 4,
    adsHeadDip: 0.12,
  },
  sniper: {
    model: 'sniper',
    base: [-2, -3.5, 2.5],
    ads: [-1.6, -1.3, 3],
    torsoY: -0.85,
    sprint: [-1, -5, 2],
    sprintTorsoY: -0.45,
    sprintTilt: -0.55,
    sprintOnMag: true,
    // hand_l − hand_r = (0; 2,5; −16,5) t.
    left: [0, 2.5 * TEXEL_PX, 16.5 * TEXEL_PX],
    // mag + 2 t para baixo − hand_r = (0; 1,5; −7,5) t (o pente do sniper tem 3 t).
    mag: [0, 1.5 * TEXEL_PX, 7.5 * TEXEL_PX],
    magDownT: 2,
    adsHeadDip: 0.12,
  },
} as const satisfies Readonly<Record<string, FigureGripDef>>;

/** Empunhadura de cada `FigureGrip` armada, na ordem (pistola 1, fuzil 2, sniper 3). */
export const FIGURE_GRIP_DEFS: readonly FigureGripDef[] = [
  FIGURE_GRIPS.pistol,
  FIGURE_GRIPS.rifle,
  FIGURE_GRIPS.sniper,
];

/** Px de boneco por texel de arma (1 t = 1/32 m; 1 px = 7/128 m). */
export const FIGURE_TEXEL_PX = TEXEL_PX;

/**
 * Teto do alcance pedido ao IK (distância ombro → alvo sobre `FIGURE_ARM_REACH`). Passou disso numa amostra, a arma
 * inteira anda o mínimo (sem girar: o cano continua na mira) até as duas palmas caberem. Com 0,98 a palma fica no
 * máximo 0,08 px aquém do alvo (`figureSoftReach`), dentro do E.11 (≤ 0,1 px).
 */
export const FIGURE_REACH_MAX = 0.98;

/**
 * Teto das hitboxes dos braços armados nas amostras da tabela (m, a partir dos pés). Passou, a arma inteira desce (sem
 * girar: o cano continua na mira) até caber. Em pé, o fuzil e o sniper com o pitch inteiro levariam a mão E a 1,86–1,89 m
 * (acima da cabeça, contra o `FIGURE_MAX_TOP_M` 1,81); agachado e deslizando, mesmo com os braços saturados em +0,6, a
 * 0,98–1,04 m (contra o `FIGURE_CROUCH_TOP_M` 0,97). A folga da interpolação soma alguns mm entre as amostras, daí o
 * teto abaixo dos limites do contrato.
 */
export const FIGURE_ARM_TOP_M = { stand: 1.78, crouch: 0.955 } as const;

/**
 * Faixa do pitch dos braços e da arma (rad) por stance: [mínimo, máximo]. Fora dela a arma satura (o cano deixa de
 * seguir a mira; a cabeça e a hitbox seguem a tabela). Em pé, o pitch inteiro das amostras (PLANO §B3). Agachado, o
 * máximo é o `FIGURE_AIM.armPitchMaxCrouch` (0,6). Deslizando (tronco deitado −0,9), ±0,3: além disso a mão E só
 * alcança a telha com a arma andando até 5,4 px, e a paridade de 1 px (E.1) e a fase larga deixam de fechar.
 */
export const FIGURE_ARM_PITCH = {
  stand: [-1.2, 1.2],
  crouch: [-1.2, 0.6],
  slide: [-0.3, 0.3],
} as const;

/**
 * Recarga (PLANO §B6): a arma gira em volta do cano e desce; a cabeça olha o pente. `gunRoll` é no frame do FutBobo
 * (Rz(+0,6) leva o pente para o lado da mão E); nos eixos do modelo da arma (os da `grip`) é Rz(−0,6). As 3 chaves do
 * braço E (`FigureGameTable.reload`): telha (= a base), pente (com a arma girada e descida) e cinto.
 */
export const FIGURE_RELOAD = {
  gunRoll: 0.6,
  gunDropPx: 1,
  neckX: 0.35,
  /** Alvo da mão E no cinto, no espaço do tronco (px; o estudo de anatomia §5.3). */
  belt: [3.5, 1.5, 1.5],
} as const;
/** Chaves da recarga em `FigureGameTable.reload`: ((empunhadura − 1) × 3 + chave) × 4 + ângulo (shLX, shLY, shLZ, elL). */
export const FIGURE_RELOAD_KEY = { handguard: 0, mag: 1, belt: 2 } as const;
