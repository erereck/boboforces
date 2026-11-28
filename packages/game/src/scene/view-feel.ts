import type { WeaponCategory } from '@boboforces/sim';
import { DEG_TO_RAD, mix32, smoothstep, wrapAngle } from '@boboforces/shared';

/**
 * M12 (fase 1): a câmera e a arma na mão, só do render (a sim e os goldens não mudam). Uma `ViewFeel` por vista guarda
 * o que a cena precisa entre frames: o degrau e a escalada suaves, o pouso com peso, o FOV de velocidade, o balanço da
 * cabeça na passada do som, as molas da arma (atraso no giro, inclinação, corrida, coice por arma), o ADS com curva, a
 * troca, a recarga, a faca e a granada animadas, o tremor por trauma, o solavanco do dano e o recuo e a velocidade
 * interpolados entre ticks. Tudo em função do tempo ou por molas de solução exata: o mesmo resultado a 30, 60 e 144 Hz.
 * Puro e sem alocação por frame (a cena preenche as amostras e lê a saída, criadas uma vez).
 */
export const VIEW_FEEL = {
  // --- 1. degrau e escalada ---
  /** No chão, um salto de altura no tick é degrau a partir daqui (m) e se passa da rampa mais íngreme (45°). */
  stepMinM: 0.04,
  rampSlope: 1.05,
  rampSlackM: 0.02,
  /** No ar, a escalada (o "mantle"): o Δy do tick passa do balístico (vy·dt) por mais disto. */
  climbSlackM: 0.15,
  /** Salto maior que isto num tick é teleporte (renascer, empurrão da sim): sem suavizar. O degrau da sim é 0,5. */
  teleportM: 0.6,
  /**
   * Teto do deslocamento (m) e a mola crítica da volta a 0 (ω, 1/s): o degrau solto sobe em ~0,1 s sem tranco de
   * velocidade. Medido na escada de degraus de 0,25 m correndo a 6,8 m/s (um degrau a cada ~2 ticks): o desvio de uma
   * rampa por frame cai de 0,137 m (cru) para 0,046 a 60 Hz e 0,019 a 144 Hz, e o atraso (~2v/ω = 0,23 m) fica abaixo
   * do teto. Com ω 40 (≈ o τ 0,06 do levantamento) a escada correndo batia no teto e estalava.
   */
  stepCapM: 0.3,
  stepOmega: 60,
  // --- 2. pouso ---
  landMinSpeed: 3,
  landPerSpeed: 0.015,
  landMaxM: 0.12,
  landPitchMinRad: 0.5 * DEG_TO_RAD,
  landPitchMaxRad: 1.5 * DEG_TO_RAD,
  /** A curva do pouso é ωt·e^(1−ωt): o fundo em 1/ω (50 ms) e quase tudo de volta em ~0,25 s. */
  landOmega: 20,
  landWeaponM: 0.04,
  // --- 3. FOV de velocidade (graus no FOV horizontal dos Ajustes) ---
  sprintFovDeg: 4,
  slideFovDeg: 7,
  fovInS: 0.15,
  fovOutS: 0.25,
  // --- 4. balanço da cabeça e da arma ---
  /**
   * A passada do som dos passos (`MATCH_SOUND.walkStrideM`, `sprintStrideM` e `stepMinSpeed` em `scene/sound.ts`; a
   * cópia mora aqui porque o som é de outra frente: mudou lá, muda aqui). Uma descida da câmera por passo.
   */
  walkStrideM: 1.7,
  sprintStrideM: 2.3,
  stepMinSpeed: 0.8,
  /** Velocidade de andar do Bobo (balanço cheio da câmera) e de correr (balanço cheio da arma). */
  walkSpeed: 4.8,
  runSpeed: 6.8,
  bobWalkM: 0.02,
  bobSprintM: 0.03,
  bobSideM: 0.01,
  bobTauS: 0.08,
  /** Quanto a fase da câmera corre atrás da do som por segundo (passos/s por passo de diferença). */
  phasePull: 3,
  vmBobXM: 0.012,
  vmBobYM: 0.01,
  // --- 5. molas da arma ---
  /** Atraso no giro: alvo = −velocidade da mira · k (s), até ±2,5° e 1,5 cm; mola crítica ω 14. */
  swayK: 0.012,
  swayMaxRad: 2.5 * DEG_TO_RAD,
  swayMaxM: 0.015,
  swayOmega: 14,
  tiltRad: 3 * DEG_TO_RAD,
  slideRollRad: 0.15,
  tiltOmega: 12,
  sprintPitch: -0.25,
  sprintRoll: 0.2,
  sprintDropM: 0.04,
  /** A pose de corrida entra em ~0,2 s e sai em ~0,08 s (o gatilho corta a corrida). */
  sprintInTauS: 0.07,
  sprintOutTauS: 0.025,
  // --- 6. coice (mola k 300, amortecimento 22: ω0 17,3 e ζ 0,635) ---
  kickOmega: Math.sqrt(300),
  kickZeta: 22 / (2 * Math.sqrt(300)),
  kickZM: 0.045,
  kickPitchRad: 0.06,
  kickRollRad: 1.5 * DEG_TO_RAD,
  // --- 7. ADS ---
  adsOutMul: 0.7,
  // --- 8. troca e recarga ---
  /** O tempo da troca na sim (`MATCH_DEFAULTS.weaponSwitchS`). */
  switchS: 0.4,
  switchDropM: 0.25,
  switchPitchRad: 15 * DEG_TO_RAD,
  /** Fração da troca com a arma nova ainda embaixo (o easeOutBack sobe quase tudo no começo). */
  switchHold: 0.2,
  reloadDropM: 0.06,
  reloadRollRad: 20 * DEG_TO_RAD,
  magDropAt: 0.35,
  // --- 9. faca e granada ---
  stabS: 0.18,
  stabZM: -0.12,
  stabYawRad: 25 * DEG_TO_RAD,
  stabHitS: 0.03,
  stabHitZM: 0.02,
  stabHitPitchRad: 2 * DEG_TO_RAD,
  throwS: 0.25,
  throwZM: -0.1,
  throwYM: 0.03,
  throwPitchRad: -0.35,
  // --- 11. tremor por trauma ---
  traumaDecayPerS: 2.5,
  /** O tremor é trauma²: a parte que gira é pequena (a mira continua honesta) e a que desloca, ~3 cm. */
  shakeRotRad: 0.012,
  shakePosM: 0.03,
  shakeHz: 18,
  /** "FOV punch" na escopeta, na sniper e no foguete: +2% na tangente por 80 ms. */
  punch: 0.02,
  punchS: 0.08,
  /** Solavanco do dano: trauma por ponto de dano (20 de dano ≈ 0,15) e o empurrão de 0,5° a 1° para longe do tiro. */
  hurtTraumaPerDamage: 0.0075,
  hurtTraumaMax: 0.35,
  hurtMinRad: 0.5 * DEG_TO_RAD,
  hurtMaxRad: 1 * DEG_TO_RAD,
  hurtFullDamage: 50,
  hurtOmega: 18,
  hurtZeta: 0.8,
  /** Empurrão a menos disto do anterior não entra (s); o teto da mola é o `hurtMaxRad`. */
  hurtGapS: 0.15,
  // --- Reduzir efeitos: as molas da arma mais contidas ---
  reducedWeapon: 0.5,
  // --- 15. cápsulas douradas e o pente da recarga (cubinhos do `pushDebris`) ---
  casingColor: 0xd9a441,
  casingSizeM: 0.025,
  casingLifeS: 0.8,
  /** Cápsula dos outros só a até isto de uma câmera (o tiro local, sempre). */
  casingRangeM: 12,
  /** Para a direita e para cima da arma (m/s), mais o espalhamento do render. */
  casingRightMs: 1.8,
  casingUpMs: 1.6,
  casingSpreadMs: 0.35,
  magColor: 0x4a4f58,
  /** Lado do cubinho do pente (m): o de um pente, não o de uma cápsula. */
  magSizeM: 0.06,
  magLifeS: 1.5,
  /**
   * Onde o pente nasce na TELA (rodada 36: nascido no soquete, ele ficava atrás da arma, que é desenhada por cima do
   * mundo): o ponto do soquete `mag` projetado pela câmera do viewmodel, puxado para a esquerda da arma (x da tela em
   * −1..1, no máximo `magScreenMaxX`) e para a faixa de baixo (y entre `magScreenMinY` e `magScreenMaxY`), a
   * `magDepthM` à frente do olho. De lá é jogado um pouco para cima, para a frente e para a esquerda (m/s) e cai: uns
   * 0,3 s na tela (os cubinhos caem a 14 m/s²; nascido mais baixo ou mais perto, sumia em um frame).
   */
  magScreenMaxX: -0.08,
  magScreenMinY: -0.2,
  magScreenMaxY: -0.08,
  magDepthM: 0.9,
  magUpMs: 0.6,
  magForwardMs: 0.6,
  magLeftMs: 0.2,
} as const;

const F = VIEW_FEEL;

/**
 * O pico da resposta da mola subamortecida a um impulso de velocidade 1 (a partir do repouso): o impulso que dá o pico
 * `p` é `p / impulsePeak(ω, ζ)`. No coice (ω0 17,3, ζ 0,635) o pico sai em ~66 ms e vale ~0,028.
 */
export function impulsePeak(omega: number, zeta: number): number {
  const a = zeta * omega;
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  const tp = Math.atan2(wd, a) / wd;
  return (Math.exp(-a * tp) * Math.sin(wd * tp)) / wd;
}

/** A velocidade que leva o coice ao pico 1 na força 1, e a do solavanco do dano por radiano de pico. */
const KICK_IMPULSE = 1 / impulsePeak(F.kickOmega, F.kickZeta);
const HURT_IMPULSE = 1 / impulsePeak(F.hurtOmega, F.hurtZeta);

/** O que cada categoria de arma faz na mão (`VIEW_KICK`). */
export interface ViewKick {
  /** Força do coice (multiplica a mola: 1 = o pico de sempre, 4,5 cm para trás e 0,06 rad para cima). */
  readonly force: number;
  /** "FOV punch" no tiro. */
  readonly punch: boolean;
  /** Pulso da vibração do próprio tiro: o motor forte (0..1; o fraco é 60% dele) e a duração (ms). */
  readonly rumble: number;
  readonly ms: number;
  /** Solta o pente na recarga (o cubinho escuro do soquete `mag`). */
  readonly mag: boolean;
  /** Cospe a cápsula dourada no tiro (GDD §5.5). */
  readonly casing: boolean;
}

/**
 * A arma na mão por categoria. Os números do plano: o coice da pistola 1, SMG 0,5, fuzil 0,8, escopeta 2,2, sniper 3,
 * foguete 2,5 (o resto pelo parentesco); o "punch" na escopeta, na sniper e no foguete; a vibração de 0,15 a 0,6 por
 * 40 a 90 ms. O revólver (tambor), a escopeta (cartucho a cartucho), o foguete, o lança-granadas e a besta não soltam
 * pente; o revólver, o foguete, o lança-granadas e a besta não cospem cápsula.
 */
export const VIEW_KICK: Readonly<Record<WeaponCategory, ViewKick>> = {
  pistol: { force: 1, punch: false, rumble: 0.25, ms: 50, mag: true, casing: true },
  revolver: { force: 1.8, punch: false, rumble: 0.4, ms: 70, mag: false, casing: false },
  smg: { force: 0.5, punch: false, rumble: 0.15, ms: 40, mag: true, casing: true },
  rifle: { force: 0.8, punch: false, rumble: 0.2, ms: 45, mag: true, casing: true },
  lmg: { force: 0.7, punch: false, rumble: 0.2, ms: 45, mag: true, casing: true },
  dmr: { force: 1.5, punch: false, rumble: 0.35, ms: 60, mag: true, casing: true },
  shotgun: { force: 2.2, punch: true, rumble: 0.5, ms: 80, mag: false, casing: true },
  autoShotgun: { force: 1.4, punch: false, rumble: 0.4, ms: 70, mag: true, casing: true },
  sniper: { force: 3, punch: true, rumble: 0.6, ms: 90, mag: true, casing: true },
  explosive: { force: 2.5, punch: true, rumble: 0.6, ms: 90, mag: false, casing: false },
  launcher: { force: 2, punch: false, rumble: 0.5, ms: 80, mag: false, casing: false },
  crossbow: { force: 1.2, punch: false, rumble: 0.3, ms: 60, mag: false, casing: false },
  melee: { force: 0, punch: false, rumble: 0.3, ms: 60, mag: false, casing: false },
  throwable: { force: 0, punch: false, rumble: 0.2, ms: 50, mag: false, casing: false },
};

/** Mola de uma dimensão (posição e velocidade). */
export interface Spring {
  x: number;
  v: number;
}

/**
 * Avança a mola amortecida x'' = −ω²(x − alvo) − 2ζω·x' por `dt` pela solução EXATA (alvo constante no passo): o
 * resultado não depende do tamanho do passo. ζ ≥ 1 vira a crítica (as molas daqui não precisam da superamortecida).
 */
export function springStep(s: Spring, target: number, omega: number, zeta: number, dt: number): void {
  if (!(dt > 0)) return;
  const x0 = s.x - target;
  const v0 = s.v;
  if (zeta < 1) {
    const a = zeta * omega;
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    const e = Math.exp(-a * dt);
    const c = Math.cos(wd * dt);
    const sn = Math.sin(wd * dt);
    const b = (v0 + a * x0) / wd;
    const x = e * (x0 * c + b * sn);
    s.x = target + x;
    s.v = -a * x + e * wd * (b * c - x0 * sn);
    return;
  }
  const e = Math.exp(-omega * dt);
  const k = v0 + omega * x0;
  s.x = target + (x0 + k * dt) * e;
  s.v = (v0 - omega * k * dt) * e;
}

/** Aproxima `current` de `target` com a constante de tempo `tau` (s), sem depender do FPS. */
export function approachExp(current: number, target: number, tau: number, dt: number): number {
  if (!(dt > 0)) return current;
  if (!(tau > 0)) return target;
  return target + (current - target) * Math.exp(-dt / tau);
}

/** A curva do pouso (0 no toque, 1 no fundo em t = 1/ω, volta a 0): ωt·e^(1−ωt). */
export function landCurve(t: number, omega: number): number {
  if (!(t > 0)) return 0;
  const w = omega * t;
  return w > 12 ? 0 : w * Math.exp(1 - w);
}

/** easeOutBack: passa um pouco do fim (10%) e volta. */
export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

/** Ruído de valor suave em [−1, 1] (hash da rede inteira, interpolação smoothstep): o tremor sem `Math.random`. */
export function valueNoise(t: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const a = mix32((i ^ seed) >>> 0) / 0x80000000 - 1;
  const b = mix32(((i + 1) ^ seed) >>> 0) / 0x80000000 - 1;
  const s = f * f * (3 - 2 * f);
  return a + (b - a) * s;
}

export interface ViewFeel {
  /** Entidade seguida (o `EntityId`; -1 = nenhuma: o próximo tick começa do zero) e o último tick visto. */
  entity: number;
  tick: number;
  grounded: boolean;
  lastX: number;
  lastY: number;
  lastZ: number;
  lastVy: number;
  /** 12: o recuo e a velocidade do tick anterior (0) e do atual (1), interpolados pelo `alpha`. */
  recoilPitch0: number;
  recoilPitch1: number;
  recoilYaw0: number;
  recoilYaw1: number;
  velX0: number;
  velX1: number;
  velZ0: number;
  velZ1: number;
  /** 1: o deslocamento do degrau (m), o degrau do intervalo atual e quanto dele o `alpha` já mostrou. */
  readonly step: Spring;
  stepDy: number;
  stepSeen: number;
  /** 2: o pouso (tempo desde o toque, profundidade em m e o pender em rad). */
  landT: number;
  landAmp: number;
  landPitch: number;
  /** 3: o FOV de velocidade agora (graus). */
  fovDeg: number;
  /** 4: a fase da câmera (passos, 0..2), a réplica do acumulador do som (m, e o passo par/ímpar) e as amplitudes. */
  bobPhase: number;
  soundAcc: number;
  soundStep: number;
  bobV: number;
  bobH: number;
  vmWalk: number;
  /** 5: a mira do frame anterior (o atraso no giro), as molas e a pose de corrida. */
  hasAim: boolean;
  lastYaw: number;
  lastPitch: number;
  readonly swayX: Spring;
  readonly swayY: Spring;
  readonly tilt: Spring;
  sprint: number;
  /** 6: o coice e o giro alternado. */
  readonly kick: Spring;
  readonly kickRoll: Spring;
  rollSign: number;
  /** 7: o ADS linear e o suavizado (smoothstep): a câmera, a arma e a sensibilidade (fase 6) leem `adsBlend`. */
  adsLin: number;
  adsBlend: number;
  /** 8: a troca (tempo desde a arma nova), a recarga do frame anterior e o pente já solto nesta recarga. */
  switchT: number;
  lastWeapon: number;
  lastReload: number;
  magDropped: boolean;
  /** 9: a estocada, o tranco do acerto e o fim do arremesso (tempo desde cada um; grande = parado). */
  stabT: number;
  hitT: number;
  throwT: number;
  /** 11: o trauma (0..1), o "FOV punch" e o relógio do ruído. */
  trauma: number;
  punchT: number;
  clock: number;
  /** O solavanco do dano (yaw e pitch, rad) e o tempo desde o último empurrão. */
  readonly hurtYaw: Spring;
  readonly hurtPitch: Spring;
  hurtT: number;
  /** 3: corria quando saiu do chão (o FOV de corrida fica no pulo). */
  airSprint: boolean;
  /** 14: o ombro da 3ª pessoa (−1..1, desliza) e a 1ª pessoa forçada pela parede (com histerese). */
  side: number;
  wallFirst: boolean;
  /**
   * Da cena (a cola em `match.ts`): o último `shotAt` visto da entidade (o tiro novo), a granada na mão (0 nenhuma, 1 a
   * do slot ativo, 2 a do arremesso rápido) e o código dela, e se o fim do arremesso na tela é o do rápido.
   */
  shotAt: number;
  cooking: number;
  nadeCode: number;
  throwQuick: boolean;
}

const IDLE_S = 1e3;

export function createViewFeel(): ViewFeel {
  return {
    entity: -1,
    tick: -1,
    grounded: true,
    lastX: 0,
    lastY: 0,
    lastZ: 0,
    lastVy: 0,
    recoilPitch0: 0,
    recoilPitch1: 0,
    recoilYaw0: 0,
    recoilYaw1: 0,
    velX0: 0,
    velX1: 0,
    velZ0: 0,
    velZ1: 0,
    step: { x: 0, v: 0 },
    stepDy: 0,
    stepSeen: 0,
    landT: IDLE_S,
    landAmp: 0,
    landPitch: 0,
    fovDeg: 0,
    bobPhase: 0.5,
    soundAcc: 0,
    soundStep: 0,
    bobV: 0,
    bobH: 0,
    vmWalk: 0,
    hasAim: false,
    lastYaw: 0,
    lastPitch: 0,
    swayX: { x: 0, v: 0 },
    swayY: { x: 0, v: 0 },
    tilt: { x: 0, v: 0 },
    sprint: 0,
    kick: { x: 0, v: 0 },
    kickRoll: { x: 0, v: 0 },
    rollSign: 1,
    adsLin: 0,
    adsBlend: 0,
    switchT: IDLE_S,
    lastWeapon: -1,
    lastReload: -1,
    magDropped: false,
    stabT: IDLE_S,
    hitT: IDLE_S,
    throwT: IDLE_S,
    trauma: 0,
    punchT: IDLE_S,
    clock: 0,
    hurtYaw: { x: 0, v: 0 },
    hurtPitch: { x: 0, v: 0 },
    hurtT: IDLE_S,
    airSprint: false,
    side: 0,
    wallFirst: false,
    shotAt: -1e9,
    cooking: 0,
    nadeCode: -1,
    throwQuick: false,
  };
}

function zeroSpring(s: Spring): void {
  s.x = 0;
  s.v = 0;
}

/**
 * Esquece a entidade seguida (morreu, a vista passou para outro, a câmera de morte): o próximo tick recomeça do estado
 * dela, sem degrau nem pouso. A arma volta ao repouso e o tremor some (a explosão que matou não treme no renascer); o
 * ombro e o relógio ficam.
 */
export function resetViewFeel(f: ViewFeel): void {
  f.entity = -1;
  f.tick = -1;
  zeroSpring(f.step);
  f.stepDy = 0;
  f.stepSeen = 0;
  f.landT = IDLE_S;
  f.landAmp = 0;
  f.fovDeg = 0;
  f.bobPhase = 0.5;
  f.soundAcc = 0;
  f.soundStep = 0;
  f.bobV = 0;
  f.bobH = 0;
  f.vmWalk = 0;
  f.hasAim = false;
  zeroSpring(f.swayX);
  zeroSpring(f.swayY);
  zeroSpring(f.tilt);
  f.sprint = 0;
  zeroSpring(f.kick);
  zeroSpring(f.kickRoll);
  f.adsLin = 0;
  f.adsBlend = 0;
  f.switchT = IDLE_S;
  f.lastWeapon = -1;
  f.lastReload = -1;
  f.magDropped = false;
  f.stabT = IDLE_S;
  f.hitT = IDLE_S;
  f.throwT = IDLE_S;
  f.throwQuick = false;
  f.trauma = 0;
  f.punchT = IDLE_S;
  f.cooking = 0;
  zeroSpring(f.hurtYaw);
  zeroSpring(f.hurtPitch);
  f.hurtT = IDLE_S;
  f.airSprint = false;
}

/** O estado do tick novo da entidade seguida (a cena preenche; criado uma vez). */
export interface FeelTickSample {
  tick: number;
  entity: number;
  prevX: number;
  prevY: number;
  prevZ: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  recoilPitch: number;
  recoilYaw: number;
  /** Segundos por tick (1 / hz). */
  tickDt: number;
}

export function createFeelTickSample(): FeelTickSample {
  return {
    tick: 0,
    entity: -1,
    prevX: 0,
    prevY: 0,
    prevZ: 0,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    grounded: true,
    recoilPitch: 0,
    recoilYaw: 0,
    tickDt: 1 / 60,
  };
}

/**
 * Quanto de um Δy é salto (degrau no chão, escalada no ar) e não movimento: o que a câmera absorve. Na rampa (até 45°)
 * a altura muda junto com o passo no plano e não conta; o teleporte (renascer) também não.
 */
export function stepJump(
  dy: number,
  dxz: number,
  groundedBefore: boolean,
  groundedAfter: boolean,
  vy: number,
  dt: number,
): number {
  if (Math.abs(dy) > F.teleportM) return 0;
  if (groundedBefore && groundedAfter) {
    return Math.abs(dy) >= F.stepMinM && Math.abs(dy) > dxz * F.rampSlope + F.rampSlackM ? dy : 0;
  }
  if (!groundedBefore) {
    const extra = dy - vy * dt;
    return extra > F.climbSlackM ? extra : 0;
  }
  return 0;
}

/**
 * Um tick novo da entidade seguida (a cena chama quando `SimView.tick` mudou; com 2 ticks no frame, o do meio entra
 * junto). Detecta o degrau e o pouso PELO ESTADO (vale igual na predição do online, onde o evento chega atrasado) e
 * anda a janela do recuo e da velocidade.
 */
export function feelTick(f: ViewFeel, t: FeelTickSample): void {
  const n = t.tick - f.tick;
  if (t.entity !== f.entity || f.tick < 0 || n <= 0 || n > 8) {
    if (t.entity !== f.entity) resetViewFeel(f);
    f.entity = t.entity;
    f.tick = t.tick;
    f.grounded = t.grounded;
    f.lastX = t.x;
    f.lastY = t.y;
    f.lastZ = t.z;
    f.lastVy = t.vy;
    f.stepDy = 0;
    f.stepSeen = 0;
    f.recoilPitch0 = f.recoilPitch1 = t.recoilPitch;
    f.recoilYaw0 = f.recoilYaw1 = t.recoilYaw;
    f.velX0 = f.velX1 = t.vx;
    f.velZ0 = f.velZ1 = t.vz;
    return;
  }
  // O resto do degrau do intervalo que acabou entrou inteiro na posição: absorve o que o `alpha` ainda não tinha
  // mostrado.
  f.step.x -= f.stepDy * (1 - f.stepSeen);
  // Ticks do meio (2 ou mais no frame): o salto já está todo na posição anterior. O chão no tick do meio não vem na
  // amostra: no chão antes e no ar agora (pulou no lote), o do meio estava no chão se o Δy dele não é o balístico do
  // pulo (o degrau e o pulo no mesmo frame de 30 Hz); no ar antes, vale a regra do ar.
  let before = f.grounded;
  if (n >= 2) {
    const gx = t.prevX - f.lastX;
    const gz = t.prevZ - f.lastZ;
    const dyMid = t.prevY - f.lastY;
    const dtMid = t.tickDt * (n - 1);
    const midGrounded = t.grounded || Math.abs(dyMid - t.vy * dtMid) > F.stepMinM;
    f.step.x -= stepJump(dyMid, Math.hypot(gx, gz), f.grounded, f.grounded && midGrounded, t.vy, dtMid);
    before = f.grounded && midGrounded;
  }
  const dx = t.x - t.prevX;
  const dz = t.z - t.prevZ;
  f.stepDy = stepJump(t.y - t.prevY, Math.hypot(dx, dz), before, t.grounded, t.vy, t.tickDt);
  f.stepSeen = 0;
  // Pouso: a borda do chão, com a velocidade de queda do tick anterior (no tick do toque a sim já zerou o vy).
  if (t.grounded && !f.grounded) {
    const impact = -f.lastVy;
    const amp = Math.min(F.landMaxM, Math.max(0, (impact - F.landMinSpeed) * F.landPerSpeed));
    if (amp > 0) {
      f.landT = 0;
      f.landAmp = amp;
      f.landPitch = F.landPitchMinRad + (F.landPitchMaxRad - F.landPitchMinRad) * (amp / F.landMaxM);
    }
  }
  f.grounded = t.grounded;
  f.lastX = t.x;
  f.lastY = t.y;
  f.lastZ = t.z;
  f.lastVy = t.vy;
  f.tick = t.tick;
  f.recoilPitch0 = n === 1 ? f.recoilPitch1 : t.recoilPitch;
  f.recoilPitch1 = t.recoilPitch;
  f.recoilYaw0 = n === 1 ? f.recoilYaw1 : t.recoilYaw;
  f.recoilYaw1 = t.recoilYaw;
  f.velX0 = n === 1 ? f.velX1 : t.vx;
  f.velX1 = t.vx;
  f.velZ0 = n === 1 ? f.velZ1 : t.vz;
  f.velZ1 = t.vz;
}

/** O tiro da entidade seguida (o coice na força da arma, o giro alternado e, nas pesadas, o "FOV punch"). */
export function feelShot(f: ViewFeel, force: number, punch: boolean): void {
  f.kick.v += force * KICK_IMPULSE;
  f.rollSign = -f.rollSign;
  f.kickRoll.v += f.rollSign * Math.min(1, force) * KICK_IMPULSE;
  if (punch) f.punchT = 0;
}

/** A estocada da faca (e o tranco quando acerta). */
export function feelStab(f: ViewFeel): void {
  f.stabT = 0;
}

export function feelStabHit(f: ViewFeel): void {
  f.hitT = 0;
}

/** O fim do arremesso da granada. */
export function feelThrow(f: ViewFeel, quick: boolean): void {
  f.throwT = 0;
  f.throwQuick = quick;
  // No rápido, a granada fica na mão até o fim do arremesso e a arma volta subindo, como na troca.
  if (quick) f.switchT = -F.throwS;
}

/** Trauma do tremor (explosão), já multiplicado pelo ajuste (0 com Reduzir efeitos). */
export function feelTrauma(f: ViewFeel, amount: number): void {
  if (amount > 0) f.trauma = Math.min(1, f.trauma + amount);
}

/** Para onde o dano empurra a vista: para longe do tiro, para baixo (a queda) ou só o trauma (zona, sangrar). */
export const HURT_PUSH = { away: 0, down: 1, none: 2 } as const;
export type HurtPush = (typeof HURT_PUSH)[keyof typeof HURT_PUSH];

/**
 * O solavanco do dano levado: trauma pequeno no tamanho do dano e um empurrão de 0,5° a 1° (`push`): para longe de
 * onde veio o tiro (`from`: o ângulo da origem relativo à mira, positivo à esquerda, como o `HudModel.damageAngle`),
 * para baixo na queda, ou nenhum no dano sem direção. Um empurrão a menos de 150 ms do anterior não entra (a SMG
 * deixava a mola parada fora do tiro) e a mola tem teto de 1°. Com Reduzir efeitos, nada.
 */
export function feelHurt(f: ViewFeel, damage: number, from: number, push: HurtPush, reduced: boolean): void {
  if (reduced || !(damage > 0)) return;
  feelTrauma(f, Math.min(F.hurtTraumaMax, damage * F.hurtTraumaPerDamage));
  if (push === HURT_PUSH.none || f.hurtT < F.hurtGapS) return;
  f.hurtT = 0;
  const k = Math.min(1, damage / F.hurtFullDamage);
  const v0 = (F.hurtMinRad + (F.hurtMaxRad - F.hurtMinRad) * k) * HURT_IMPULSE;
  if (push === HURT_PUSH.down) {
    f.hurtPitch.v -= v0;
    return;
  }
  // Da esquerda (from > 0), a cabeça vai para a direita (yaw −); de frente, para cima; pelas costas, para baixo.
  f.hurtYaw.v += -Math.sin(from) * v0;
  f.hurtPitch.v += Math.cos(from) * v0 * 0.6;
}

/** Segura a mola do solavanco no teto (e corta a velocidade que empurra para fora). */
function capSpring(s: Spring, max: number): void {
  if (s.x > max) {
    s.x = max;
    if (s.v > 0) s.v = 0;
  } else if (s.x < -max) {
    s.x = -max;
    if (s.v < 0) s.v = 0;
  }
}

/** O que a cena sabe da vista neste frame (preenchido sem alocar). */
export interface FeelFrameSample {
  dt: number;
  alpha: number;
  grounded: boolean;
  sliding: boolean;
  sprinting: boolean;
  /** Velocidade no plano do tick (a mesma que o som dos passos lê, m/s). */
  speed: number;
  /** A mira da vista (sem recuo nem tremor; o atraso da arma lê a velocidade dela). */
  yaw: number;
  pitch: number;
  /** ADS pedido (0/1) e o tempo de entrada da arma na mão (s). */
  adsTarget: number;
  adsInS: number;
  /** Código da arma na mão (a troca) e a recarga (0..1; -1 = sem recarga). */
  weapon: number;
  reload: number;
  /** A arma muda sem a troca animada (a compra na loja do BoboStrike: a sim troca sem o tempo de troca). */
  quietSwitch: boolean;
  /** Reduzir efeitos (o ajuste ou o `reducedMotion` da plataforma). */
  reduced: boolean;
}

export function createFeelFrameSample(): FeelFrameSample {
  return {
    dt: 0,
    alpha: 1,
    grounded: true,
    sliding: false,
    sprinting: false,
    speed: 0,
    yaw: 0,
    pitch: 0,
    adsTarget: 0,
    adsInS: 0.2,
    weapon: -1,
    reload: -1,
    quietSwitch: false,
    reduced: false,
  };
}

/** O resultado do frame: deslocamentos somados à câmera e ao viewmodel (o ADS, o ajuste por arma e a escala, não). */
export interface FeelOutput {
  /** O degrau (m, vertical): vale também na 3ª pessoa. */
  stepY: number;
  /** Câmera da 1ª pessoa: deslocamento no mundo (m) e giro (rad), sem o degrau. */
  camX: number;
  camY: number;
  camZ: number;
  camYaw: number;
  camPitch: number;
  /** O tremor e o solavanco do dano (giro, rad): valem também na 3ª pessoa. */
  shakeYaw: number;
  shakePitch: number;
  /** Graus somados ao FOV horizontal dos Ajustes e o multiplicador da tangente (o "punch"). */
  fovAddDeg: number;
  fovMul: number;
  /** O recuo da sim e a velocidade no plano interpolados entre ticks. */
  recoilPitch: number;
  recoilYaw: number;
  velX: number;
  velZ: number;
  /** O viewmodel (m e rad, espaço da câmera). */
  vmX: number;
  vmY: number;
  vmZ: number;
  vmPitch: number;
  vmYaw: number;
  vmRoll: number;
  /** O ADS suavizado (0..1). */
  ads: number;
  /** Neste frame a recarga passou do ponto de soltar o pente. */
  dropMag: boolean;
  /** O fim do arremesso ainda está na tela (a granada fica na mão até ele acabar). */
  throwing: boolean;
}

export function createFeelOutput(): FeelOutput {
  return {
    stepY: 0,
    camX: 0,
    camY: 0,
    camZ: 0,
    camYaw: 0,
    camPitch: 0,
    shakeYaw: 0,
    shakePitch: 0,
    fovAddDeg: 0,
    fovMul: 1,
    recoilPitch: 0,
    recoilYaw: 0,
    velX: 0,
    velZ: 0,
    vmX: 0,
    vmY: 0,
    vmZ: 0,
    vmPitch: 0,
    vmYaw: 0,
    vmRoll: 0,
    ads: 0,
    dropMag: false,
    throwing: false,
  };
}

const NOISE_SEEDS = [0x51ed27, 0x2c9f13, 0x7a3b41, 0x1f6e59, 0x4d8c63] as const;

/** Um frame da vista: anda as molas e as curvas e escreve `out`. `yaw` (da câmera) orienta o balanço de lado. */
export function feelFrame(f: ViewFeel, s: FeelFrameSample, camYaw: number, out: FeelOutput): void {
  const dt = s.dt > 0 ? s.dt : 0;
  const alpha = Math.min(1, Math.max(0, s.alpha));
  const red = s.reduced;
  const weaponMul = red ? F.reducedWeapon : 1;
  f.clock += dt;

  // 12. o recuo e a velocidade entre ticks.
  out.recoilPitch = f.recoilPitch0 + (f.recoilPitch1 - f.recoilPitch0) * alpha;
  out.recoilYaw = f.recoilYaw0 + (f.recoilYaw1 - f.recoilYaw0) * alpha;
  out.velX = f.velX0 + (f.velX1 - f.velX0) * alpha;
  out.velZ = f.velZ0 + (f.velZ1 - f.velZ0) * alpha;

  // 7. ADS: linear por dentro (entra no `adsInS`, sai em 0,7× ele) e smoothstep por fora.
  const adsIn = s.adsInS > 0 ? s.adsInS : 0.2;
  if (s.adsTarget > f.adsLin) f.adsLin = Math.min(s.adsTarget, f.adsLin + dt / adsIn);
  else f.adsLin = Math.max(s.adsTarget, f.adsLin - dt / (adsIn * F.adsOutMul));
  f.adsBlend = smoothstep(0, 1, f.adsLin);
  const ads = f.adsBlend;
  out.ads = ads;
  const hip = 1 - ads;

  // 1. degrau: absorve o que o `alpha` mostrou do degrau deste intervalo e volta a 0.
  const step = f.step;
  if (alpha > f.stepSeen) {
    step.x -= f.stepDy * (alpha - f.stepSeen);
    f.stepSeen = alpha;
  }
  springStep(step, 0, F.stepOmega, 1, dt);
  if (step.x > F.stepCapM) {
    step.x = F.stepCapM;
    if (step.v > 0) step.v = 0;
  } else if (step.x < -F.stepCapM) {
    step.x = -F.stepCapM;
    if (step.v < 0) step.v = 0;
  }
  out.stepY = step.x;

  // 2. pouso.
  f.landT += dt;
  const land = landCurve(f.landT, F.landOmega);

  // 3. FOV de velocidade.
  // A corrida que sai do chão segue no ar (sem o FOV bombear a cada pulo).
  if (s.grounded) f.airSprint = s.sprinting;
  const running = s.sprinting || (!s.grounded && f.airSprint);
  const fovTarget = red ? 0 : s.sliding ? F.slideFovDeg : running ? F.sprintFovDeg : 0;
  f.fovDeg = approachExp(f.fovDeg, fovTarget, (fovTarget > f.fovDeg ? F.fovInS : F.fovOutS) / 3, dt);
  out.fovAddDeg = f.fovDeg * hip;

  // 4. balanço: a réplica do acumulador do som e a fase da câmera, que corre atrás dela sem saltar.
  const walking = s.grounded && !s.sliding;
  const stride = s.sprinting ? F.sprintStrideM : F.walkStrideM;
  if (walking) {
    if (s.speed < F.stepMinSpeed) f.soundAcc = stride * 0.5;
    else {
      f.soundAcc += s.speed * dt;
      if (f.soundAcc >= stride) {
        f.soundAcc = Math.min(stride, f.soundAcc - stride);
        f.soundStep ^= 1;
      }
      f.bobPhase += (s.speed * dt) / stride;
    }
  }
  const soundPhase = f.soundStep + f.soundAcc / stride;
  let gap = (soundPhase - f.bobPhase) % 2;
  if (gap > 1) gap -= 2;
  else if (gap < -1) gap += 2;
  f.bobPhase += gap * Math.min(1, F.phasePull * dt);
  f.bobPhase %= 2;
  if (f.bobPhase < 0) f.bobPhase += 2;
  const pace = Math.min(1, s.speed / F.walkSpeed);
  const bobOn = walking && s.speed >= F.stepMinSpeed && !red ? hip * pace : 0;
  f.bobV = approachExp(f.bobV, bobOn * (s.sprinting ? F.bobSprintM : F.bobWalkM), F.bobTauS, dt);
  f.bobH = approachExp(f.bobH, bobOn * F.bobSideM, F.bobTauS, dt);
  f.vmWalk = approachExp(f.vmWalk, walking ? Math.min(1, s.speed / F.runSpeed) : 0, F.bobTauS, dt);
  const ph = Math.PI * f.bobPhase;
  const bobY = -f.bobV * 0.5 * (1 + Math.cos(2 * ph));
  const bobSide = f.bobH * Math.cos(ph);

  // 11. tremor por trauma (trauma², ruído de hash) e o "punch".
  f.trauma = Math.max(0, f.trauma - F.traumaDecayPerS * dt);
  const shake = red ? 0 : f.trauma * f.trauma;
  const nt = f.clock * F.shakeHz;
  springStep(f.hurtYaw, 0, F.hurtOmega, F.hurtZeta, dt);
  springStep(f.hurtPitch, 0, F.hurtOmega, F.hurtZeta, dt);
  capSpring(f.hurtYaw, F.hurtMaxRad);
  capSpring(f.hurtPitch, F.hurtMaxRad);
  f.hurtT += dt;
  out.shakeYaw = shake * F.shakeRotRad * valueNoise(nt, NOISE_SEEDS[0]) + (red ? 0 : f.hurtYaw.x);
  out.shakePitch = shake * F.shakeRotRad * valueNoise(nt, NOISE_SEEDS[1]) + (red ? 0 : f.hurtPitch.x);
  f.punchT += dt;
  out.fovMul = !red && f.punchT < F.punchS ? 1 + F.punch * (1 - f.punchT / F.punchS) : 1;

  // A câmera da 1ª pessoa: o balanço (de lado pela direita da vista), o pouso e o tremor no lugar.
  const rx = Math.cos(camYaw);
  const rz = -Math.sin(camYaw);
  const landY = red ? 0 : -f.landAmp * land;
  out.camX = rx * bobSide + shake * F.shakePosM * valueNoise(nt, NOISE_SEEDS[2]);
  out.camY = bobY + landY + shake * F.shakePosM * valueNoise(nt, NOISE_SEEDS[3]);
  out.camZ = rz * bobSide + shake * F.shakePosM * valueNoise(nt, NOISE_SEEDS[4]);
  out.camYaw = 0;
  out.camPitch = red ? 0 : -f.landPitch * land;

  // 5. molas da arma: o atraso no giro (pela velocidade da mira), a inclinação de lado e a pose de corrida.
  let swayTx = 0;
  let swayTy = 0;
  if (f.hasAim && dt > 0) {
    const yawRate = wrapAngle(s.yaw - f.lastYaw) / dt;
    const pitchRate = (s.pitch - f.lastPitch) / dt;
    swayTx = Math.max(-1, Math.min(1, (yawRate * F.swayK) / F.swayMaxRad));
    swayTy = Math.max(-1, Math.min(1, (pitchRate * F.swayK) / F.swayMaxRad));
  }
  f.hasAim = true;
  f.lastYaw = s.yaw;
  f.lastPitch = s.pitch;
  springStep(f.swayX, swayTx, F.swayOmega, 1, dt);
  springStep(f.swayY, swayTy, F.swayOmega, 1, dt);
  const lateral = out.velX * rx + out.velZ * rz;
  const tiltTarget = s.sliding
    ? F.slideRollRad
    : -Math.max(-1, Math.min(1, (s.grounded ? lateral : 0) / F.walkSpeed)) * F.tiltRad;
  springStep(f.tilt, tiltTarget * hip, F.tiltOmega, 1, dt);
  const sprintTarget = s.sprinting && s.grounded && !s.sliding && s.adsTarget === 0 ? 1 : 0;
  f.sprint = approachExp(f.sprint, sprintTarget, sprintTarget > f.sprint ? F.sprintInTauS : F.sprintOutTauS, dt);

  // 6. o coice.
  springStep(f.kick, 0, F.kickOmega, F.kickZeta, dt);
  springStep(f.kickRoll, 0, F.kickOmega, F.kickZeta, dt);

  // 8. a troca (a arma nova sobe de baixo no tempo da sim) e a recarga (desce e gira; o pente cai a ~35%).
  if (s.weapon !== f.lastWeapon) {
    if (f.lastWeapon >= 0 && s.weapon >= 0 && !s.quietSwitch) f.switchT = 0;
    f.lastWeapon = s.weapon;
  }
  f.switchT += dt;
  let low = 0;
  if (f.switchT >= 0 && f.switchT < F.switchS) {
    // Um quinto do tempo embaixo (a arma nova chega de fora da tela) e o resto subindo.
    const t = (f.switchT / F.switchS - F.switchHold) / (1 - F.switchHold);
    low = t <= 0 ? 1 : 1 - easeOutBack(t);
  }
  out.dropMag = false;
  let reloadWave = 0;
  if (s.reload >= 0) {
    if (s.reload < f.lastReload || f.lastReload < 0) f.magDropped = false;
    if (!f.magDropped && s.reload >= F.magDropAt) {
      f.magDropped = true;
      out.dropMag = true;
    }
    reloadWave = Math.sin(Math.PI * Math.min(1, s.reload));
  } else f.magDropped = false;
  f.lastReload = s.reload;

  // 9. a estocada (para a frente e de lado para o meio), o tranco do acerto e o fim do arremesso.
  f.stabT += dt;
  f.hitT += dt;
  f.throwT += dt;
  let stabZ = 0;
  let stabYaw = 0;
  if (f.stabT < F.stabS) {
    const t = f.stabT / F.stabS;
    stabZ = F.stabZM * Math.sin(Math.PI * t);
    stabYaw = F.stabYawRad * (1 - t) * (1 - t) * smoothstep(0, 0.12, t);
  }
  const jolt = f.hitT < F.stabHitS ? 1 - f.hitT / F.stabHitS : 0;
  let throwK = 0;
  if (f.throwT < F.throwS) throwK = Math.sin((Math.PI * f.throwT) / F.throwS);
  out.throwing = f.throwT < F.throwS;

  // O viewmodel: tudo somado (o ADS segura o balanço e o atraso; Reduzir efeitos, as molas pela metade).
  const kickMul = (1 - 0.5 * ads) * weaponMul;
  const swayMul = (1 - 0.8 * ads) * weaponMul;
  const walkMul = f.vmWalk * hip * weaponMul;
  const sink = F.landWeaponM * (f.landAmp / F.landMaxM) * land * weaponMul;
  out.vmX = Math.sin(ph) * F.vmBobXM * walkMul + f.swayX.x * F.swayMaxM * swayMul;
  out.vmY =
    -Math.abs(Math.cos(ph)) * F.vmBobYM * walkMul -
    f.swayY.x * F.swayMaxM * swayMul -
    F.sprintDropM * f.sprint -
    sink -
    F.switchDropM * low -
    F.reloadDropM * reloadWave +
    F.throwYM * throwK;
  out.vmZ = f.kick.x * F.kickZM * kickMul + stabZ + F.stabHitZM * jolt + F.throwZM * throwK;
  out.vmPitch =
    f.kick.x * F.kickPitchRad * kickMul -
    f.swayY.x * F.swayMaxRad * swayMul +
    F.sprintPitch * f.sprint -
    F.switchPitchRad * low +
    F.stabHitPitchRad * jolt +
    F.throwPitchRad * throwK;
  out.vmYaw = -f.swayX.x * F.swayMaxRad * swayMul + stabYaw;
  out.vmRoll =
    f.tilt.x * weaponMul +
    F.sprintRoll * f.sprint +
    f.kickRoll.x * F.kickRollRad * weaponMul +
    F.reloadRollRad * reloadWave;
}

/** 14: o ombro desliza até o lado pedido (~0,15 s) em vez de pular. */
export function shoulderSideStep(current: number, target: number, dt: number): number {
  return approachExp(current, target, 0.05, dt);
}

/**
 * 14: a 1ª pessoa forçada pela parede com histerese: entra com o braço abaixo de `enterM` e só sai com ele acima de
 * `exitM` (sem piscar entre as duas no limite).
 */
export function wallForcesFirst(wasFirst: boolean, arm: number, enterM: number, exitM: number): boolean {
  return wasFirst ? arm < exitM : arm < enterM;
}
