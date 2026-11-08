// Ganhos da animação dos bonecos do FutBobo (#56, PLANO do porte §B6). Frente F4. Os números do FutBobo vêm de
// `character.ts` (estudo de anatomia §4); o que mexe na cabeça e no tronco fica dentro do ENVELOPE
// (`FIGURE_ENVELOPE_PX`: ≤ 1 px da pose base em regime, ≤ 2 px no pico de ≤ 0,3 s), e o teste E.2
// (`envelope.test.ts`) é o teto de cada ganho. Velocidades na régua do FutBobo: u/s, com 1 m = `FIGURE_U_PER_M` u.
// Sem three.
import { FIGURE_PX_M } from '@boboforces/format';

/** Unidades de campo do FutBobo por metro: 1 px = 1,24 u (`character.ts:45`) e 1 px = `FIGURE_PX_M` m. */
export const FIGURE_U_PER_M = 1.24 / FIGURE_PX_M;

export interface FigureMotionConfig {
  /** false = motor parado: só a pose base (tabela + mistura de postura), sem nenhuma camada (E.1, base do E.2). */
  readonly enabled: boolean;
  /** Mistura linear entre a postura anterior e a atual (s), como o agachar de hoje. */
  readonly postureBlendS: number;
  /** Taxas do `approach` (1/s): pesos dos estados, velocidade da passada e do passinho (FutBobo 9, 10, 8). */
  readonly weightRate: number;
  readonly gaitRate: number;
  readonly sideRate: number;
  /** Peso do pulo (pernas recolhidas) e do sprint (1/s). */
  readonly airRate: number;
  readonly sprintRate: number;
  /**
   * Respiração parado: quanto do balanço lateral do corpo (`bodyRotZ` 0,025·sen(0,7t) nos pés) o tronco desfaz no
   * quadril. 1 = o quadril e as pernas balançam e o tronco fica de pé (a cabeça anda 0,33 px em vez de 0,7).
   */
  readonly breathUpright: number;

  // --- Passada (`locomotion`, `character.ts:3565-3607`) ---
  /** Escala do quique da passada (oscilação do `bodyY`; ≤ 1 px). */
  readonly strideBob: number;
  /** Escala do afundamento do sprint (`−0,5·sprint` px no FutBobo). */
  readonly strideSink: number;
  /** Escala da inclinação do tronco na passada (`torsoX` 0,05..0,44 no FutBobo; a postura de corrida é da tabela). */
  readonly strideLean: number;
  /** Escala da torção quadril × ombros (`hipsY`, `torsoY`, `neckY`). */
  readonly strideTwist: number;
  /** Pernas da passada agachado (em volta da P4f) e no zumbi. */
  readonly crouchStride: number;
  readonly zombieStride: number;
  /** Zumbi: `neckZ` = isto·sen(fase) andando. */
  readonly zombieNeckZ: number;
  /** Passinho de lado (goleiro, `character.ts:3544-3561`): abertura média e oscilação do quadril (rad), quique (px). */
  readonly shuffleWidth: number;
  readonly shuffleHipZ: number;
  readonly shuffleBob: number;
  /** As pernas apontam o rumo do strafe até isto (rad), por `hipsY`; o tronco fecha a diferença. */
  readonly strafeYawMax: number;

  // --- Giro preguiçoso (`character.ts:3221-3250`): só as pernas, o tronco fecha ---
  readonly lazyYawMax: number;
  readonly lazyStart: number;
  readonly lazyStop: number;
  readonly lazyTurnRate: number;
  /** Reação por boneco: min + hash·spread (s). */
  readonly lazyReactionMin: number;
  readonly lazyReactionSpread: number;
  /** Passinho de giro (Hz) e de quanto a perna sai (rad). */
  readonly stepHz: number;

  // --- Molas (`updateInertia`, `character.ts:3612-3665`) ---
  readonly springOmega: number;
  readonly springZeta: number;
  /** Subpasso máximo do Euler explícito (diverge acima de ~0,085 s). */
  readonly springStepS: number;
  /** Teto da aceleração (u/s²) e taxas dos filtros rápido e lento. */
  readonly accelClamp: number;
  readonly accelFastRate: number;
  readonly accelSlowRate: number;
  /** Arranque/freada: alvo = clamp(−frente·ganho; ±max) no `torsoX` (rad). */
  readonly pitchGain: number;
  readonly pitchMax: number;
  /** ADAD: alvo = clamp(lado·ganho; ±max) no `torsoZ`. */
  readonly rollGain: number;
  readonly rollMax: number;
  /** Curva: `pivZ` (pivô no quadril) = clamp(−lado lento·ganho; ±max)·corrida. */
  readonly bankGain: number;
  readonly bankMax: number;
  readonly bankRate: number;
  /** Atraso do pescoço: `neckX += share·(lag − pitch)`. */
  readonly neckLagRate: number;
  readonly neckLagShare: number;

  // --- Freada (`character.ts:3646-3701`) ---
  readonly brakeS: number;
  /** Dispara quando a velocidade cruza para baixo disto (u/s) depois de um pico acima de `brakePeak`. */
  readonly brakeBelow: number;
  readonly brakePeak: number;
  /** Escala das chaves do corpo da freada (`bodyY` −1,4, `bodyRotX` −0,08, `torsoX` −0,12); pernas inteiras. */
  readonly brakeBody: number;
  /** No fim, `pitchVel += follow·força` (o tronco segue à frente). */
  readonly brakeFollow: number;

  // --- Achatamento (`character.ts:4145-4151`) e pulo ---
  readonly squashOmega: number;
  readonly squashZeta: number;
  readonly squashMin: number;
  readonly squashMax: number;
  /** Decolagem: `squashVel += takeoff`. Pouso: `land(min(1; noAr/landAirS))` = `squashVel −= landKick·s`. */
  readonly takeoffKick: number;
  readonly landKick: number;
  readonly landAirS: number;
  /** Pouso: `pitchVel += landPitchKick·s` (estudo §5.6). */
  readonly landPitchKick: number;

  // --- Dano: borda do flash > limiar ---
  readonly damageThreshold: number;
  readonly damagePitchKick: number;
  readonly damageRollKick: number;
  /** Tranco: `torsoX`, `neckX` (rad) e `bodyY` (px) no pico, por `damageS`. */
  readonly damageTorsoX: number;
  readonly damageNeckX: number;
  readonly damageBodyY: number;
  readonly damageS: number;

  // --- Tiro e recarga ---
  /** Borda do `firing`: `pitchVel −= kick`. Braços e arma na amostra `pitch + armPitch·recoil`; arma recua (px). */
  readonly recoilPitchKick: number;
  readonly recoilArmPitch: number;
  readonly recoilBackPx: number;
  /**
   * Recarga: giro Z da arma (rad), arma desce (px) e a cabeça olha o pente (`neckX`). O `neckX` fica dentro do E.2
   * (cabeça ≤ 1 px da base em regime, WYSIWYG com a hitbox, que não segue a recarga): decisão 4 da §I, 0,35 → 0,17.
   */
  readonly reloadWeaponRotZ: number;
  readonly reloadWeaponDropPx: number;
  readonly reloadNeckX: number;

  // --- Nascer: cada osso cai `queda·(base + porOsso·osso)` m e encaixa em `spawnS`; no fim `land(spawnLand)` ---
  readonly spawnS: number;
  readonly spawnDropBase: number;
  readonly spawnDropPerBone: number;
  readonly spawnLand: number;

  // --- Piscar (só com a expressão neutra; manequins não piscam) ---
  readonly blinkS: number;
  readonly blinkBaseS: number;
  readonly blinkSpreadS: number;
  readonly blinkFirstS: number;
  readonly blinkFirstSpreadS: number;

  // --- Teto do cabelo: raiz + escala·mix(em pé; baixo; peso de agachar ou deslizar) (m) ---
  readonly hairCeilingStand: number;
  readonly hairCeilingLow: number;

  // --- LOD: esfera do teste de frustum (centro acima dos pés e raio, m × escala) ---
  readonly lodCenterM: number;
  readonly lodRadiusM: number;
}

/**
 * Valores do jogo. Os do envelope começaram na tabela do §B6 (pitch ±0,12, roll ±0,06, `pivZ` ±0,06, tranco −0,1 /
 * −0,08 / −0,3 px em 0,25 s, achatamento −6%..+5%) e foram ajustados pelo E.2 (relatório da F4). O E.2 roda a 60 Hz
 * e também a 30 e 144 Hz: as molas são Euler explícito com o passo do quadro, e a resposta cresce com a taxa (no limite
 * contínuo, o "10 tiros" com coice 1,8 dava 1,07 px de regime a 144–240 Hz); por isso o coice é 1,6.
 */
export const FIGURE_MOTION: FigureMotionConfig = Object.freeze({
  enabled: true,
  postureBlendS: 0.12,
  weightRate: 9,
  gaitRate: 10,
  sideRate: 8,
  airRate: 12,
  sprintRate: 9,
  breathUpright: 1,

  strideBob: 1,
  strideSink: 0,
  strideLean: 0.065,
  strideTwist: 1,
  crouchStride: 0.5,
  zombieStride: 0.6,
  zombieNeckZ: 0.15,
  shuffleWidth: 0.06,
  shuffleHipZ: 0.1,
  shuffleBob: 0.58,
  strafeYawMax: 0.35,

  lazyYawMax: 0.35,
  lazyStart: 0.3,
  lazyStop: 0.04,
  lazyTurnRate: 5,
  lazyReactionMin: 0.08,
  lazyReactionSpread: 0.22,
  stepHz: 2.4,

  springOmega: 16,
  springZeta: 0.4,
  springStepS: 0.05,
  accelClamp: 4000,
  accelFastRate: 30,
  accelSlowRate: 3,
  pitchGain: 0.00035,
  pitchMax: 0.072,
  rollGain: 0.0004,
  rollMax: 0.036,
  bankGain: 0.00045,
  bankMax: 0.04,
  bankRate: 6,
  neckLagRate: 10,
  neckLagShare: 0.5,

  brakeS: 0.4,
  brakeBelow: 28,
  brakePeak: 70,
  brakeBody: 0.46,
  brakeFollow: 5.2,

  squashOmega: 22,
  squashZeta: 0.35,
  squashMin: -0.09,
  squashMax: 0.07,
  takeoffKick: 0.9,
  landKick: 1.5,
  landAirS: 0.6,
  landPitchKick: 4,

  damageThreshold: 0.3,
  damagePitchKick: 3.1,
  damageRollKick: 4,
  damageTorsoX: -0.076,
  damageNeckX: -0.06,
  damageBodyY: -0.17,
  damageS: 0.25,

  recoilPitchKick: 1.6,
  recoilArmPitch: 0.12,
  recoilBackPx: 0.6,
  reloadWeaponRotZ: 0.6,
  reloadWeaponDropPx: 1,
  reloadNeckX: 0.17,

  spawnS: 0.4,
  spawnDropBase: 0.5,
  spawnDropPerBone: 0.11,
  spawnLand: 0.6,

  blinkS: 0.13,
  blinkBaseS: 1.8,
  blinkSpreadS: 3.6,
  blinkFirstS: 2,
  blinkFirstSpreadS: 3,

  hairCeilingStand: 1.99,
  hairCeilingLow: 0.99,

  lodCenterM: 0.875,
  lodRadiusM: 1.2,
});

/** Motor parado: a pose base pura (tabela + mistura de postura). E.1 e a referência do E.2. */
export const FIGURE_MOTION_STOPPED: FigureMotionConfig = Object.freeze({ ...FIGURE_MOTION, enabled: false });
