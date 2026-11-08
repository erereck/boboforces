/**
 * Tabela de jogo do boneco (decisão #56; PLANO do porte §B3, §B4 e §C3). Dona: frente F1. A sim tira dela as 12
 * hitboxes e o render tira dela os ângulos da pose base e a arma: os dois leem a MESMA tabela, montada uma vez no
 * loading (`createFigureGameTable`, pura, sem nada guardado no módulo) e solta no fim da partida.
 *
 * Por postura (`figurePosture`, 22) e amostra de pitch (`FIGURE_PITCH_SAMPLES`, 5):
 * - `poses`: a pose (`FIGURE_POSE_SIZE` ângulos e px) em (postura × 5 + amostra) × 34;
 * - `boxes`: as 12 hitboxes, uma por osso, em ((postura × 5 + amostra) × 12 + osso) × `FIGURE_HIT_STRIDE`, em METROS
 *   no frame da SIM com a raiz na origem e yaw 0 (x = direita do boneco, y a partir dos pés, z = frente; o mesmo de
 *   `sim/src/hitbox.ts`). Campos em `FIGURE_HIT_FIELD`: centro, meias medidas, R 3×3 linha-maior (r<linha><coluna>:
 *   p_sim = centro + R·p_caixa; as colunas são os eixos direita, cima e frente da caixa; R = I no repouso), categoria
 *   de dano e a faixa vertical (minY, maxY);
 * - `slack`: (postura × 4 intervalos × 12 ossos) × 3 = a folga (m) de cada eixo local da hitbox naquele intervalo de
 *   amostras, que `figureHitBoxes` soma às meias medidas com peso 4f(1 − f): zero nas amostras, cheia no meio;
 * - `broad`: postura × 2 = (maior raio no plano, maior topo) da postura em todo pitch, já com a folga: cobre o que a
 *   sim recebe entre as amostras;
 * - `grip`: (postura × 5 + amostra) × 12 = a arma no espaço do antebraço D, afim 3×4 coluna-maior em px (colunas de R
 *   em 0..8, translação em 9..11), com os eixos do MODELO da arma (+x direita, +y cima, cano para −z) e a origem no
 *   soquete `hand_r` (`figure-grips.ts`). Sem arma (e zumbi) = identidade;
 * - `reload`: ((empunhadura − 1) × 3 + chave) × 4 + ângulo: braço E (shLX, shLY, shLZ, elL) nas 3 chaves da recarga
 *   (`FIGURE_RELOAD_KEY`: telha, pente, cinto), na postura em pé base da empunhadura, no pitch 0.
 *
 * Hitbox de cada osso = a caixa envolvente, no espaço do osso, das caixas do corpo dele (`FIGURE_BODY_BOXES`): as
 * primárias, e antebraço + mão numa caixa só de 3,8 × 6,8 × 3,8 px em (0; −3,3; 0) (§B4).
 *
 * Mira ("cabeça presa ao olho", `FIGURE_AIM`):
 * - o tronco não leva pitch. A cabeça leva clamp(p; ±0,6) em pé (e no zumbi, que é postura em pé) e
 *   (0,1/0,6)·clamp(p; 0..0,6) agachada e deslizando (só levanta: olhando para baixo a quina de trás subiria por cima
 *   do muro de 1,0 m; decisão 2 da §I, `headPitchMinCrouch`), girada em X no espaço do quadril:
 *   H = Rx(−p_cabeça)·H_base, com H_base = R_tronco·R_pescoço da pose base SEM arma do stance (olha para a frente; o
 *   zumbi guarda o pescoço −0,2). O pescoço sai da composição exata R_pescoço = R_troncoᵀ·H com o tronco da postura, extraído em Euler XYZ como o
 *   three: com o tronco torcido da arma, neckY = −torsoY. No ADS em pé a cabeça desce sobre a coronha:
 *   p_cabeça = c − `adsHeadDip`·(1 − |c|/0,6) com c = clamp(p; ±0,6) (linear por intervalo, some nas amostras ±0,6, e
 *   o desvio cabeça–olho continua ≤ 1 px). Sem o `neckZ`
 *   +0,15 do §B3: deitar a cabeça levava a quina dela a 1,84 m com o pitch (acima do `FIGURE_MAX_TOP_M`). Entre as
 *   amostras o pescoço das armadas sai da mesma composição no `figureGamePose` (não da interpolação);
 * - `neckSlide` = −clamp(z do centro da cabeça; ±1,5 px), resolvido em cada postura e amostra (a raiz está no eixo do
 *   olho): em pé, agachado e deslizando. O zumbi não desliza (não tem câmera; a cabeça curvada fica 5 px à frente);
 * - braços e arma: a moldura da mira (origem no meio dos ombros, eixos da raiz) gira com o pitch inteiro, Rx(−p), em
 *   volta da linha horizontal dos ombros, dentro de `FIGURE_ARM_PITCH` (agachado os braços saturam em
 *   +`armPitchMaxCrouch` 0,6; deslizando, em ±0,3); correndo, o cano fica fixo em `sprintTilt`. A palma D vai à
 *   empunhadura e a E à telha (`left`) ou ao pente (`mag`), pelo IK (`figureSolveArm`). Se uma palma passa de
 *   `FIGURE_REACH_MAX` do alcance, a arma inteira anda o mínimo (projeção na interseção das duas bolas de alcance), sem
 *   girar: o cano continua na mira. Se a hitbox de um braço passa de `FIGURE_ARM_TOP_M`, a arma desce, sem girar.
 *
 * Entre as amostras o render interpola ÂNGULOS e a sim interpola centros e R: a cabeça visual gira em arco e o centro
 * interpolado anda na corda, ~1 cm para dentro no meio do intervalo em pé (A·Δ²/8 com A = 0,22 m e Δ = 0,6 rad); os
 * braços armados também mexem entre as amostras. Sem folga, a quina visual saía da hitbox (raios na caixa visual sem
 * acerto na sim, contra o E.1). A montagem mede esse excesso com o FK exato (`figureGamePose` + `figureFk`) em pontos
 * de cada intervalo que se mexe e grava a folga em `slack`; nas amostras a hitbox continua justa (topo em pé no pitch 0
 * = 1,75).
 *
 * Determinismo: só `Math.sin/cos/acos/asin/atan2/sqrt/exp` (o nx.js roda V8), sem `Math.random` nem relógio.
 */
import {
  FIGURE_AIM,
  FIGURE_BODY_BOXES,
  FIGURE_BONE,
  FIGURE_BONES,
  FIGURE_BOX_FIELD,
  FIGURE_BOX_STRIDE,
  FIGURE_CROUCH_POSE,
  FIGURE_GRIP,
  FIGURE_JOINT,
  FIGURE_MODE,
  FIGURE_PART_CATEGORY,
  FIGURE_PITCH_SAMPLES,
  FIGURE_POSE,
  FIGURE_POSE_SIZE,
  FIGURE_POSTURE_INFO,
  FIGURE_POSTURES,
  FIGURE_PX_M,
  FIGURE_REST_POSE,
  FIGURE_SLIDE_POSE,
  FIGURE_STANCE,
  FIGURE_ZOMBIE_POSE,
  figureFk,
  figurePosture,
  figureRoot,
  type FigurePart,
  type FigureStance,
} from './figure.ts';
import {
  FIGURE_ARM_PITCH,
  FIGURE_ARM_TOP_M,
  FIGURE_GRIP_DEFS,
  FIGURE_REACH_MAX,
  FIGURE_RELOAD,
  type FigureGripDef,
} from './figure-grips.ts';
import { FIGURE_ARM_REACH, figureSolveArm } from './figure-ik.ts';

// O IK e as empunhaduras saem pelo pacote junto da tabela (o índice do `format` exporta este arquivo).
export * from './figure-grips.ts';
export * from './figure-ik.ts';

/** Floats por hitbox: cx,cy,cz, hx,hy,hz, r00..r22, categoria, minY, maxY (m; x = direita, z = frente). */
export const FIGURE_HIT_STRIDE = 18;
/** Campos de uma hitbox da tabela (e da saída de `figureHitBoxes`). */
export const FIGURE_HIT_FIELD = {
  cx: 0,
  cy: 1,
  cz: 2,
  hx: 3,
  hy: 4,
  hz: 5,
  r00: 6,
  r01: 7,
  r02: 8,
  r10: 9,
  r11: 10,
  r12: 11,
  r20: 12,
  r21: 13,
  r22: 14,
  category: 15,
  minY: 16,
  maxY: 17,
} as const;

export interface FigureGameTable {
  /** FIGURE_POSTURES × 5 × FIGURE_POSE_SIZE. */
  readonly poses: Float32Array;
  /** FIGURE_POSTURES × 5 × 12 × FIGURE_HIT_STRIDE. */
  readonly boxes: Float32Array;
  /** FIGURE_POSTURES × 2 (raio no plano, topo). */
  readonly broad: Float32Array;
  /**
   * FIGURE_POSTURES × 4 intervalos × 12 × 3: folga (m) por eixo local da hitbox entre as amostras, somada às meias
   * medidas com peso 4f(1 − f) (só `figureHitBoxes` lê).
   */
  readonly slack: Float32Array;
  /** FIGURE_POSTURES × 5 × 12 (arma no espaço do antebraço D, px, eixos do modelo da arma). */
  readonly grip: Float32Array;
  /** 3 empunhaduras × 3 chaves × 4 ângulos do braço E. */
  readonly reload: Float32Array;
  /**
   * FIGURE_POSTURES × 4 intervalos × 12 × 9 (campo da F1, aditivo e opcional): a "barriga" de cada intervalo = a
   * hitbox exata no meio dele (FK da pose interpolada) menos a média das duas amostras, no centro (3) e nas colunas
   * direita e cima de R (6), no frame da sim. `figureHitBoxes` e `figureAimPoint` somam barriga·4f(1 − f): o centro
   * e os eixos andam no arco (quadrática pelo meio exato) e não na corda. Ausente (tabela sintética de teste) = corda.
   */
  readonly bulge?: Float32Array;
}

export interface FigureAimOut {
  y: number;
  z: number;
}

// Só números no topo do módulo: importar não monta nada (a tabela é da partida).
const SAMPLES = FIGURE_PITCH_SAMPLES.length;
const PITCH_MIN = FIGURE_PITCH_SAMPLES[0];
/** As amostras são equidistantes (o teste confere). */
const PITCH_STEP = FIGURE_PITCH_SAMPLES[1] - FIGURE_PITCH_SAMPLES[0];
const GRIP_STRIDE = 12;
const RELOAD_SIZE = 3 * 3 * 4;
const POSE_ROW = FIGURE_POSE_SIZE;
const BOX_ROW = FIGURE_BONES * FIGURE_HIT_STRIDE;
const HF = FIGURE_HIT_FIELD;
const INTERVALS = SAMPLES - 1;
/** Folga por intervalo: 12 ossos × 3 eixos locais. */
const SLACK_ROW = FIGURE_BONES * 3;
/** Barriga por intervalo: 12 ossos × (centro 3 + coluna direita 3 + coluna cima 3). */
const BULGE_ROW = FIGURE_BONES * 9;
/**
 * Folga da interpolação: `figureHitBoxes` soma M·4f(1 − f) a cada meia medida (zero nas amostras e quase zero no meio,
 * onde a barriga deixa a hitbox exata), com M = maior razão excesso(f)/(4f(1 − f)) medida em SLACK_AT × SLACK_GAIN +
 * SLACK_FLOOR_M. Com o meio exato o resto é de 3ª ordem e a razão anda quase em linha reta de uma ponta à outra (máximo
 * nas pontas, que 1/32 e 31/32 pegam com erro < 7%; o ganho 1,1 cobre). Cada ponto custa uma interpolação, a pose e um
 * FK; só os intervalos em que a pose muda são medidos (fora de ±0,6 a cabeça satura), e só os ossos que mudam neles.
 */
const SLACK_AT = [1 / 32, 1 / 4, 31 / 32] as const;
const SLACK_GAIN = 1.1;
const SLACK_FLOOR_M = 5e-5;
/** Abaixo disto (m) o excesso é ruído de float32 (a tabela guarda float32): sem folga. */
const SLACK_EPS_M = 1e-6;
/**
 * Folga (m) da fase larga sobre o maior valor lido nas amostras e nos pontos da folga (f = 0, 1/32, 1/2, 31/32, 1; as
 * hitboxes da medição são reusadas, sem interpolar de novo). Entre dois pontos (h ≤ 15/32 do intervalo) o topo ou o
 * raio passa do valor lido no máximo |T''|·h²/8: o arco da quina dá A·Δ² ≈ 0,20 m (A ≤ 0,55 m da quina da cabeça ao
 * pescoço, Δ = 0,6 rad) e a folga M·4f(1 − f) dá 8M ≈ 0,10 m, então ~8 mm. Cobre de sobra: a fase larga só corta cedo.
 */
const BROAD_MARGIN_M = 1e-2;
/**
 * Rascunho de vetores da montagem (float64), em grupos de 3: meio dos ombros, palmas D e E pedidas (com o
 * deslocamento), palmas D e E na moldura (sem ele), ombros D e E, deslocamento da arma, 2 de apoio e o eixo da mira
 * (cima, frente).
 */
const VEC = {
  mid: 0,
  right: 3,
  left: 6,
  grip: 9,
  second: 12,
  shoulderR: 15,
  shoulderL: 18,
  shift: 21,
  a: 24,
  b: 27,
  up: 30,
  front: 33,
} as const;
const VEC_SIZE = 36;

// --- Montagem (no loading; aloca só aqui) ---

/**
 * Cabeça presa ao olho, pela composição exata: H = Rx(θ) no espaço do quadril, com θ = (torsoX + neckX da pose base
 * `base`) − hp (a cabeça da base girada em X; as 4 bases só têm giros X no tronco e no pescoço), e R_pescoço =
 * R_troncoᵀ·H com o tronco de `pose`, extraído em Euler XYZ como o `setFromRotationMatrix` do three (as mesmas contas
 * do `figureGamePose` nas armadas). `hp` > 0 = olhar para cima (pitch da sim); no frame do FutBobo, `neckX` > 0 olha
 * para baixo. Com o tronco sem giro, sai neckX = θ − torsoX e neckY = neckZ = 0; com ele torcido, neckY ≈ −torsoY.
 */
function aimHead(pose: Float32Array, base: Float32Array, hp: number): void {
  const P = FIGURE_POSE;
  if (base[P.torsoY] !== 0 || base[P.torsoZ] !== 0 || base[P.neckY] !== 0 || base[P.neckZ] !== 0) {
    throw new Error('figure: pose base com giro Y ou Z no tronco ou no pescoço');
  }
  const theta = base[P.torsoX]! + base[P.neckX]! - hp;
  const cx = Math.cos(pose[P.torsoX]!);
  const sx = Math.sin(pose[P.torsoX]!);
  const cy = Math.cos(pose[P.torsoY]!);
  const sy = Math.sin(pose[P.torsoY]!);
  const cz = Math.cos(pose[P.torsoZ]!);
  const sz = Math.sin(pose[P.torsoZ]!);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  // R_tronco = Rx·Ry·Rz por linhas (t<linha><coluna>); Rx(θ) = [1, 0, 0; 0, c, −s; 0, s, c].
  const t00 = cy * cz;
  const t10 = cx * sz + sx * sy * cz;
  const t11 = cx * cz - sx * sy * sz;
  const t12 = -sx * cy;
  const t20 = sx * sz - cx * sy * cz;
  const t21 = sx * cz + cx * sy * sz;
  const t22 = cx * cy;
  // N = R_troncoᵀ·Rx(θ): n<i><j> = Σ t<k><i>·x<k><j>.
  const n00 = t00;
  const n01 = t10 * c + t20 * s;
  const n02 = t20 * c - t10 * s;
  const n11 = t11 * c + t21 * s;
  const n12 = t21 * c - t11 * s;
  const n21 = t12 * c + t22 * s;
  const n22 = t22 * c - t12 * s;
  pose[P.neckY] = Math.asin(n02 < -1 ? -1 : n02 > 1 ? 1 : n02);
  if (Math.abs(n02) < 0.9999999) {
    pose[P.neckX] = Math.atan2(-n12, n22);
    pose[P.neckZ] = Math.atan2(-n01, n00);
  } else {
    pose[P.neckX] = Math.atan2(n21, n11);
    pose[P.neckZ] = 0;
  }
}

/**
 * Pitch da cabeça agachada e deslizando a partir do da cabeça em pé `hp` (já em ±0,6): a fração 0,1/0,6, presa em
 * [`headPitchMinCrouch`; `headPitchMaxCrouch`]. Com o mínimo 0 a cabeça só levanta (decisão 2 da §I): olhando para
 * baixo, a quina de trás subiria por cima do muro de 1,0 m. A mesma conta vai escrita no `figureGamePose`.
 */
function crouchHeadPitch(hp: number): number {
  const v = hp * (FIGURE_AIM.headPitchMaxCrouch / FIGURE_AIM.headPitchMaxStand);
  const lo = FIGURE_AIM.headPitchMinCrouch;
  const hi = FIGURE_AIM.headPitchMaxCrouch;
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Forma de cada hitbox no espaço do osso, em px: a caixa envolvente das caixas do corpo do osso (centro e meias
 * medidas, 6 por osso). As caixas do corpo não têm giro próprio.
 */
function hitShapes(): Float64Array {
  const s = new Float64Array(FIGURE_BONES * 6);
  const F = FIGURE_BOX_FIELD;
  const n = FIGURE_BODY_BOXES.length / FIGURE_BOX_STRIDE;
  for (let b = 0; b < FIGURE_BONES; b++) {
    let x0 = Infinity;
    let y0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const o = i * FIGURE_BOX_STRIDE;
      if (FIGURE_BODY_BOXES[o + F.bone] !== b) continue;
      const cx = FIGURE_BODY_BOXES[o + F.cx]!;
      const cy = FIGURE_BODY_BOXES[o + F.cy]!;
      const cz = FIGURE_BODY_BOXES[o + F.cz]!;
      const hx = FIGURE_BODY_BOXES[o + F.sx]! / 2;
      const hy = FIGURE_BODY_BOXES[o + F.sy]! / 2;
      const hz = FIGURE_BODY_BOXES[o + F.sz]! / 2;
      x0 = Math.min(x0, cx - hx);
      y0 = Math.min(y0, cy - hy);
      z0 = Math.min(z0, cz - hz);
      x1 = Math.max(x1, cx + hx);
      y1 = Math.max(y1, cy + hy);
      z1 = Math.max(z1, cz + hz);
    }
    const o = b * 6;
    s[o] = (x0 + x1) / 2;
    s[o + 1] = (y0 + y1) / 2;
    s[o + 2] = (z0 + z1) / 2;
    s[o + 3] = (x1 - x0) / 2;
    s[o + 4] = (y1 - y0) / 2;
    s[o + 5] = (z1 - z0) / 2;
  }
  return s;
}

/**
 * Hitbox do osso `b` a partir da matriz dele no FK em px com a raiz identidade (frame do FutBobo: +x esquerda, +z
 * frente): centro e eixos levados ao frame da sim, que é o do FutBobo com x trocado de sinal (a raiz da sim é
 * Ry(π)·S(FIGURE_PX_M) e o z da sim é −Z do mundo), em metros; a direita da caixa é −x do osso. R reortonormalizada e
 * tudo escrito em float64 em `hit[0 .. 18)`.
 */
function boneHitBox(bones: Float32Array, b: number, shape: Float64Array, hit: Float64Array): void {
  const m = b * 16;
  const s = b * 6;
  const cx = shape[s]!;
  const cy = shape[s + 1]!;
  const cz = shape[s + 2]!;
  const m0 = bones[m]!;
  const m1 = bones[m + 1]!;
  const m2 = bones[m + 2]!;
  const m4 = bones[m + 4]!;
  const m5 = bones[m + 5]!;
  const m6 = bones[m + 6]!;
  const m8 = bones[m + 8]!;
  const m9 = bones[m + 9]!;
  const m10 = bones[m + 10]!;
  hit[HF.cx] = -(bones[m + 12]! + m0 * cx + m4 * cy + m8 * cz) * FIGURE_PX_M;
  hit[HF.cy] = (bones[m + 13]! + m1 * cx + m5 * cy + m9 * cz) * FIGURE_PX_M;
  hit[HF.cz] = (bones[m + 14]! + m2 * cx + m6 * cy + m10 * cz) * FIGURE_PX_M;
  hit[HF.hx] = shape[s + 3]! * FIGURE_PX_M;
  hit[HF.hy] = shape[s + 4]! * FIGURE_PX_M;
  hit[HF.hz] = shape[s + 5]! * FIGURE_PX_M;
  // Colunas (direita = −x do osso, cima, frente) no frame da sim: (x, y, z) do FutBobo → (−x, y, z).
  hit[HF.r00] = m0;
  hit[HF.r10] = -m1;
  hit[HF.r20] = -m2;
  hit[HF.r01] = -m4;
  hit[HF.r11] = m5;
  hit[HF.r21] = m6;
  hit[HF.r02] = -m8;
  hit[HF.r12] = m9;
  hit[HF.r22] = m10;
  orthonormalize(hit, 0);
  hit[HF.category] = FIGURE_PART_CATEGORY[b]!;
  verticalRange(hit, 0);
}

/** Pose sem arma de cada `stance` (o zumbi tem a dele). */
function basePose(posture: number, zombie: number): Float32Array {
  if (posture === zombie) return FIGURE_ZOMBIE_POSE;
  const stance = FIGURE_POSTURE_INFO[posture * 3]!;
  if (stance === FIGURE_STANCE.crouch) return FIGURE_CROUCH_POSE;
  if (stance === FIGURE_STANCE.slide) return FIGURE_SLIDE_POSE;
  return FIGURE_REST_POSE;
}

/** Rascunho da montagem (alocado uma vez por `createFigureGameTable`). */
interface Build {
  /** Raiz identidade: o FK sai em px no frame do FutBobo. */
  readonly unit: Float32Array;
  readonly pose: Float32Array;
  readonly bones: Float32Array;
  readonly shape: Float64Array;
  readonly hit: Float64Array;
  readonly arm: Float64Array;
  readonly v: Float64Array;
  readonly zombie: number;
}

/** v[d ..] = M_osso·(x, y, z) (ponto do osso `b` no FK em px). */
function bonePoint(bones: Float32Array, b: number, x: number, y: number, z: number, v: Float64Array, d: number): void {
  const m = b * 16;
  v[d] = bones[m + 12]! + bones[m]! * x + bones[m + 4]! * y + bones[m + 8]! * z;
  v[d + 1] = bones[m + 13]! + bones[m + 1]! * x + bones[m + 5]! * y + bones[m + 9]! * z;
  v[d + 2] = bones[m + 14]! + bones[m + 2]! * x + bones[m + 6]! * y + bones[m + 10]! * z;
}

/** v[d ..] = v[o ..] + (moldura da mira)·(x, y, z): eixos x da raiz, cima e frente da mira em v[VEC.up], v[VEC.front]. */
function aimPoint(v: Float64Array, d: number, o: number, x: number, y: number, z: number): void {
  v[d] = v[o]! + x;
  v[d + 1] = v[o + 1]! + v[VEC.up + 1]! * y + v[VEC.front + 1]! * z;
  v[d + 2] = v[o + 2]! + v[VEC.up + 2]! * y + v[VEC.front + 2]! * z;
}

/** |v[a ..] − v[b ..]|. */
function dist(v: Float64Array, a: number, b: number): number {
  const x = v[a]! - v[b]!;
  const y = v[a + 1]! - v[b + 1]!;
  const z = v[a + 2]! - v[b + 2]!;
  return Math.sqrt(x * x + y * y + z * z);
}

/**
 * Menor deslocamento da arma (as duas palmas juntas) que põe a palma D a ≤ r do ombro D e a E a ≤ r do ombro E: a
 * projeção da origem na interseção das bolas B(ombro D − palma D, r) e B(ombro E − palma E, r). Fora das duas, cai no
 * círculo da interseção; sem interseção, no meio dos dois centros. Escreve em v[VEC.shift].
 */
function reachShift(v: Float64Array, r: number): void {
  const A = VEC.a;
  const B = VEC.b;
  const S = VEC.shift;
  for (let k = 0; k < 3; k++) {
    v[A + k] = v[VEC.shoulderR + k]! - v[VEC.right + k]!;
    v[B + k] = v[VEC.shoulderL + k]! - v[VEC.left + k]!;
    v[S + k] = 0;
  }
  const la = Math.sqrt(v[A]! * v[A]! + v[A + 1]! * v[A + 1]! + v[A + 2]! * v[A + 2]!);
  const lb = Math.sqrt(v[B]! * v[B]! + v[B + 1]! * v[B + 1]! + v[B + 2]! * v[B + 2]!);
  if (la <= r && lb <= r) return;
  // Projeção na bola A; serve se cair dentro da B (e vice-versa).
  if (la > r) {
    const k = 1 - r / la;
    for (let i = 0; i < 3; i++) v[S + i] = v[A + i]! * k;
    let d2 = 0;
    for (let i = 0; i < 3; i++) d2 += (v[S + i]! - v[B + i]!) * (v[S + i]! - v[B + i]!);
    if (d2 <= r * r) return;
  }
  if (lb > r) {
    const k = 1 - r / lb;
    for (let i = 0; i < 3; i++) v[S + i] = v[B + i]! * k;
    let d2 = 0;
    for (let i = 0; i < 3; i++) d2 += (v[S + i]! - v[A + i]!) * (v[S + i]! - v[A + i]!);
    if (d2 <= r * r) return;
  }
  // Círculo da interseção: centro no meio, normal A → B, raio √(r² − D²/4).
  const nx = v[B]! - v[A]!;
  const ny = v[B + 1]! - v[A + 1]!;
  const nz = v[B + 2]! - v[A + 2]!;
  const d = Math.sqrt(nx * nx + ny * ny + nz * nz);
  const cx = (v[A]! + v[B]!) / 2;
  const cy = (v[A + 1]! + v[B + 1]!) / 2;
  const cz = (v[A + 2]! + v[B + 2]!) / 2;
  v[S] = cx;
  v[S + 1] = cy;
  v[S + 2] = cz;
  if (d >= 2 * r || d < 1e-9) return;
  const ux = nx / d;
  const uy = ny / d;
  const uz = nz / d;
  // Origem − centro, sem a componente da normal.
  let px = -cx;
  let py = -cy;
  let pz = -cz;
  const k = px * ux + py * uy + pz * uz;
  px -= k * ux;
  py -= k * uy;
  pz -= k * uz;
  const lp = Math.sqrt(px * px + py * py + pz * pz);
  if (lp < 1e-9) return;
  const rc = Math.sqrt(r * r - (d * d) / 4) / lp;
  v[S] = cx + px * rc;
  v[S + 1] = cy + py * rc;
  v[S + 2] = cz + pz * rc;
}

/** IK da palma em v[t ..] (px, frame do FutBobo) com o tronco do FK: ângulos em `arm`, devolve o alcance. */
function solveTo(bones: Float32Array, v: Float64Array, t: number, side: number, arm: Float64Array): number {
  const m = FIGURE_BONE.torso * 16;
  const x = v[t]! - bones[m + 12]!;
  const y = v[t + 1]! - bones[m + 13]!;
  const z = v[t + 2]! - bones[m + 14]!;
  // Inversa rígida do tronco: Rᵀ·(p − t).
  return figureSolveArm(
    bones[m]! * x + bones[m + 1]! * y + bones[m + 2]! * z,
    bones[m + 4]! * x + bones[m + 5]! * y + bones[m + 6]! * z,
    bones[m + 8]! * x + bones[m + 9]! * y + bones[m + 10]! * z,
    side,
    arm,
    0,
  );
}

/** Ombros e meio dos ombros do FK (px) em v; a moldura da mira com o pitch `a` dos braços. */
function aimFrame(b: Build, a: number): void {
  const v = b.v;
  const T = FIGURE_BONE.torso;
  bonePoint(b.bones, T, 0, FIGURE_JOINT.shoulderY, 0, v, VEC.mid);
  bonePoint(b.bones, T, -FIGURE_JOINT.shoulderX, FIGURE_JOINT.shoulderY, 0, v, VEC.shoulderR);
  bonePoint(b.bones, T, FIGURE_JOINT.shoulderX, FIGURE_JOINT.shoulderY, 0, v, VEC.shoulderL);
  // Rx(−a): cima = (0, cos a, −sen a), frente = (0, sen a, cos a).
  const c = Math.cos(a);
  const s = Math.sin(a);
  v[VEC.up] = 0;
  v[VEC.up + 1] = c;
  v[VEC.up + 2] = -s;
  v[VEC.front] = 0;
  v[VEC.front + 1] = s;
  v[VEC.front + 2] = c;
}

/** Maior y (px) das hitboxes dos braços (manga e antebraço + mão, os dois lados) no FK em px. */
function armTop(bones: Float32Array, shape: Float64Array): number {
  let top = -Infinity;
  for (let bone = FIGURE_BONE.upperArmR; bone <= FIGURE_BONE.forearmL; bone++) {
    const m = bone * 16;
    const s = bone * 6;
    const y =
      bones[m + 13]! +
      bones[m + 1]! * shape[s]! +
      bones[m + 5]! * shape[s + 1]! +
      bones[m + 9]! * shape[s + 2]! +
      Math.abs(bones[m + 1]!) * shape[s + 3]! +
      Math.abs(bones[m + 5]!) * shape[s + 4]! +
      Math.abs(bones[m + 9]!) * shape[s + 5]!;
    if (y > top) top = y;
  }
  return top;
}

/**
 * Ossos que mudam com o pitch numa postura: cabeça e braços. Tronco e pernas não dependem dele (o tronco não leva
 * pitch), então a montagem copia as caixas deles da 1ª amostra e o FK parcial (`pitchFk`) só refaz os outros.
 */
const PITCH_BONE: readonly boolean[] = [true, false, true, true, true, true, false, false, false, false, false, false];

/**
 * Filho = pai·[Rx(x)·Ry(y)·Rz(z) | (tx, ty, tz)] nas matrizes coluna-maior em px de `bones` (as contas do `figureFk`,
 * em float64, gravadas em float32). Só na montagem.
 */
function composeChild(
  bones: Float32Array,
  d: number,
  a: number,
  x: number,
  y: number,
  z: number,
  tx: number,
  ty: number,
  tz: number,
): void {
  const cx = Math.cos(x);
  const sx = Math.sin(x);
  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const cz = Math.cos(z);
  const sz = Math.sin(z);
  const l00 = cy * cz;
  const l01 = -cy * sz;
  const l02 = sy;
  const l10 = cx * sz + sx * sy * cz;
  const l11 = cx * cz - sx * sy * sz;
  const l12 = -sx * cy;
  const l20 = sx * sz - cx * sy * cz;
  const l21 = sx * cz + cx * sy * sz;
  const l22 = cx * cy;
  for (let r = 0; r < 3; r++) {
    const p0 = bones[a + r]!;
    const p1 = bones[a + 4 + r]!;
    const p2 = bones[a + 8 + r]!;
    bones[d + r] = p0 * l00 + p1 * l10 + p2 * l20;
    bones[d + 4 + r] = p0 * l01 + p1 * l11 + p2 * l21;
    bones[d + 8 + r] = p0 * l02 + p1 * l12 + p2 * l22;
    bones[d + 12 + r] = p0 * tx + p1 * ty + p2 * tz + bones[a + 12 + r]!;
  }
}

/**
 * FK parcial da pose em `bones` (px, raiz identidade), que já tem o tronco da MESMA postura (de um `figureFk`): refaz
 * só a cabeça (com o deslize do pescoço) e os 4 ossos dos braços, as partes que mudam com o pitch (`PITCH_BONE`). Um
 * terço das composições do FK inteiro.
 */
function pitchFk(pose: Float32Array, bones: Float32Array): void {
  headFk(pose, bones);
  armsFk(pose, bones);
}

/** Parte do `pitchFk` da cabeça (com o deslize do pescoço). */
function headFk(pose: Float32Array, bones: Float32Array): void {
  const P = FIGURE_POSE;
  const T = FIGURE_BONE.torso * 16;
  const H = FIGURE_BONE.head * 16;
  composeChild(
    bones,
    H,
    T,
    pose[P.neckX]!,
    pose[P.neckY]!,
    pose[P.neckZ]!,
    0,
    FIGURE_JOINT.neckY - pose[P.neckSink]!,
    0,
  );
  bones[H + 14] = bones[H + 14]! + pose[P.neckSlide]!;
}

/** Parte do `pitchFk` dos 4 ossos dos braços. */
function armsFk(pose: Float32Array, bones: Float32Array): void {
  const P = FIGURE_POSE;
  const J = FIGURE_JOINT;
  const T = FIGURE_BONE.torso * 16;
  const AR = FIGURE_BONE.upperArmR * 16;
  const AL = FIGURE_BONE.upperArmL * 16;
  composeChild(bones, AR, T, pose[P.shRX]!, pose[P.shRY]!, pose[P.shRZ]!, -J.shoulderX, J.shoulderY, 0);
  composeChild(bones, AL, T, pose[P.shLX]!, pose[P.shLY]!, pose[P.shLZ]!, J.shoulderX, J.shoulderY, 0);
  elbowChild(bones, FIGURE_BONE.forearmR * 16, AR, pose[P.elR]!);
  elbowChild(bones, FIGURE_BONE.forearmL * 16, AL, pose[P.elL]!);
}

/** `composeChild` do cotovelo: só giro X, junta em (0; −upperArm; 0). Metade das contas. */
function elbowChild(bones: Float32Array, d: number, a: number, x: number): void {
  const c = Math.cos(x);
  const s = Math.sin(x);
  const ty = -FIGURE_JOINT.upperArm;
  for (let r = 0; r < 3; r++) {
    const p0 = bones[a + r]!;
    const p1 = bones[a + 4 + r]!;
    const p2 = bones[a + 8 + r]!;
    bones[d + r] = p0;
    bones[d + 4 + r] = p1 * c + p2 * s;
    bones[d + 8 + r] = p2 * c - p1 * s;
    bones[d + 12 + r] = p1 * ty + bones[a + 12 + r]!;
  }
}

/** Iterações do teto dos braços (cada uma = IK dos 2 braços + FK); converge em 2 a 4. */
const ARM_TOP_ITERATIONS = 8;

/**
 * Braços e arma da postura armada em b.pose (pose base, tronco e pescoço já resolvidos, com o deslize; b.bones = FK
 * dela, que dá o tronco): alvos das palmas na moldura da mira, deslocamento de alcance, IK dos dois braços e o teto dos
 * braços (a arma desce, sem girar, até a hitbox dos braços ficar ≤ `FIGURE_ARM_TOP_M` do stance). Sai com b.bones = FK
 * da pose final e a afim da arma em grip[g ..] (frame do FutBobo, px).
 */
function armedArms(
  b: Build,
  def: FigureGripDef,
  stance: number,
  mode: number,
  pitch: number,
  grip: Float32Array,
  g: number,
): void {
  const v = b.v;
  const pose = b.pose;
  const P = FIGURE_POSE;
  const sprint = mode === FIGURE_MODE.sprint;
  let a: number;
  if (sprint) a = def.sprintTilt;
  else {
    const range =
      stance === FIGURE_STANCE.stand
        ? FIGURE_ARM_PITCH.stand
        : stance === FIGURE_STANCE.crouch
          ? FIGURE_ARM_PITCH.crouch
          : FIGURE_ARM_PITCH.slide;
    a = pitch < range[0] ? range[0] : pitch > range[1] ? range[1] : pitch;
  }
  const hold = sprint ? def.sprint : mode === FIGURE_MODE.ads ? def.ads : def.base;
  const second = sprint && def.sprintOnMag ? def.mag : def.left;
  // Correndo, a palma D fica no ponto da empunhadura nos eixos da raiz (o estudo de anatomia §5.3: (−1; 6,5; 2) no
  // quadril) e só a arma inclina; mirando, a empunhadura gira junto com a moldura.
  aimFrame(b, sprint ? 0 : a);
  aimPoint(v, VEC.grip, VEC.mid, hold[0], hold[1], hold[2]);
  if (sprint) aimFrame(b, a);
  aimPoint(v, VEC.second, VEC.grip, second[0], second[1], second[2]);
  for (let k = 0; k < 3; k++) {
    v[VEC.right + k] = v[VEC.grip + k]!;
    v[VEC.left + k] = v[VEC.second + k]!;
  }
  reachShift(v, FIGURE_REACH_MAX * FIGURE_ARM_REACH);
  const limit = (stance === FIGURE_STANCE.stand ? FIGURE_ARM_TOP_M.stand : FIGURE_ARM_TOP_M.crouch) / FIGURE_PX_M;
  for (let it = 0; it < ARM_TOP_ITERATIONS; it++) {
    for (let k = 0; k < 3; k++) {
      v[VEC.right + k] = v[VEC.grip + k]! + v[VEC.shift + k]!;
      v[VEC.left + k] = v[VEC.second + k]! + v[VEC.shift + k]!;
    }
    // O tronco do FK não depende dos braços: o IK lê o tronco de b.bones em toda iteração.
    solveTo(b.bones, v, VEC.right, -1, b.arm);
    pose[P.shRX] = b.arm[0]!;
    pose[P.shRY] = b.arm[1]!;
    pose[P.shRZ] = b.arm[2]!;
    pose[P.elR] = b.arm[3]!;
    solveTo(b.bones, v, VEC.left, 1, b.arm);
    pose[P.shLX] = b.arm[0]!;
    pose[P.shLY] = b.arm[1]!;
    pose[P.shLZ] = b.arm[2]!;
    pose[P.elL] = b.arm[3]!;
    // A cabeça (com o deslize) já está no FK: só os braços mudam aqui.
    armsFk(pose, b.bones);
    const excess = armTop(b.bones, b.shape) - limit;
    if (excess <= 0) break;
    // Desce a arma inteira o que passou (+ um fio): as palmas descem junto e o topo cai quase o mesmo.
    v[VEC.shift + 1] = v[VEC.shift + 1]! - excess - 1e-3;
  }
  // Arma: eixos do modelo = moldura da mira × Ry(π) (direita = −x, cano = +z da mira), origem na palma D pedida.
  // Colunas no frame do FutBobo: x do modelo = −x da raiz; y = cima da mira; z do modelo = −frente da mira.
  grip[g] = -1;
  grip[g + 1] = 0;
  grip[g + 2] = 0;
  grip[g + 3] = 0;
  grip[g + 4] = v[VEC.up + 1]!;
  grip[g + 5] = v[VEC.up + 2]!;
  grip[g + 6] = 0;
  grip[g + 7] = -v[VEC.front + 1]!;
  grip[g + 8] = -v[VEC.front + 2]!;
  grip[g + 9] = v[VEC.right]!;
  grip[g + 10] = v[VEC.right + 1]!;
  grip[g + 11] = v[VEC.right + 2]!;
}

/** Leva a afim da arma em grip[g ..] (frame do FutBobo, px) para o espaço do antebraço D do FK: Rᵀ·(R_arma | t − t_f). */
function gripToForearm(bones: Float32Array, grip: Float32Array, g: number, v: Float64Array): void {
  const m = FIGURE_BONE.forearmR * 16;
  for (let c = 0; c < 4; c++) {
    let x = grip[g + c * 3]!;
    let y = grip[g + c * 3 + 1]!;
    let z = grip[g + c * 3 + 2]!;
    if (c === 3) {
      x -= bones[m + 12]!;
      y -= bones[m + 13]!;
      z -= bones[m + 14]!;
    }
    v[VEC.a] = bones[m]! * x + bones[m + 1]! * y + bones[m + 2]! * z;
    v[VEC.a + 1] = bones[m + 4]! * x + bones[m + 5]! * y + bones[m + 6]! * z;
    v[VEC.a + 2] = bones[m + 8]! * x + bones[m + 9]! * y + bones[m + 10]! * z;
    grip[g + c * 3] = v[VEC.a]!;
    grip[g + c * 3 + 1] = v[VEC.a + 1]!;
    grip[g + c * 3 + 2] = v[VEC.a + 2]!;
  }
}

/**
 * Uma amostra de uma postura: pose base do stance, tronco da empunhadura, cabeça presa ao olho (composição exata e
 * deslize do pescoço), braços e arma; grava pose, hitboxes e `grip`.
 */
function buildSample(t: FigureGameTable, b: Build, p: number, s: number): void {
  const P = FIGURE_POSE;
  const pose = b.pose;
  const pitch = FIGURE_PITCH_SAMPLES[s]!;
  const stance = FIGURE_POSTURE_INFO[p * 3]!;
  const gripId = FIGURE_POSTURE_INFO[p * 3 + 1]!;
  const mode = FIGURE_POSTURE_INFO[p * 3 + 2]!;
  const zombie = p === b.zombie;
  const base = basePose(p, b.zombie);
  const def = gripId === FIGURE_GRIP.none || zombie ? null : FIGURE_GRIP_DEFS[gripId - 1]!;
  const row = p * SAMPLES + s;
  const g = row * GRIP_STRIDE;
  const maxHead = FIGURE_AIM.headPitchMaxStand;
  pose.set(base);
  if (def !== null) pose[P.torsoY] = mode === FIGURE_MODE.sprint ? def.sprintTorsoY : def.torsoY;
  // Cabeça: clamp(p; ±0,6), menos o mergulho do ADS em pé; agachado e deslizando, a fração 0,1/0,6 presa em
  // [headPitchMinCrouch; headPitchMaxCrouch] (só levanta: decisão 2 da §I).
  const ads = def !== null && mode === FIGURE_MODE.ads && stance === FIGURE_STANCE.stand;
  const dip = ads ? def.adsHeadDip : 0;
  let hp = pitch < -maxHead ? -maxHead : pitch > maxHead ? maxHead : pitch;
  // O mergulho do ADS some nas amostras ±0,6: o pitch da cabeça fica linear por intervalo, com as quinas nas amostras.
  hp -= dip * (1 - Math.abs(hp) / maxHead);
  if (stance !== FIGURE_STANCE.stand) hp = crouchHeadPitch(hp);
  aimHead(pose, base, hp);
  pose[P.neckSlide] = 0;
  // Tronco e pernas não mudam entre as amostras da postura (montadas em ordem): da 2ª em diante, só o FK parcial.
  if (s === 0) figureFk(pose, 0, b.unit, 0, b.bones, 0);
  else pitchFk(pose, b.bones);
  if (!zombie) {
    // Deslize do pescoço: o centro da cabeça volta ao eixo do olho (x = z = 0) ao longo da frente da raiz, até 1,5 px.
    // Com a raiz identidade a frente da raiz é +z: o deslize só soma ao z da cabeça (o resto do FK não muda).
    bonePoint(b.bones, FIGURE_BONE.head, 0, 4, 0, b.v, VEC.a);
    const zc = b.v[VEC.a + 2]!;
    const max = FIGURE_AIM.neckSlideMaxPx;
    const slide = zc > max ? -max : zc < -max ? max : -zc;
    pose[P.neckSlide] = slide;
    const h = FIGURE_BONE.head * 16 + 14;
    b.bones[h] = b.bones[h]! + pose[P.neckSlide]!;
  }
  if (def !== null) {
    armedArms(b, def, stance, mode, pitch, t.grip, g);
    gripToForearm(b.bones, t.grip, g, b.v);
  } else {
    t.grip[g] = 1;
    t.grip[g + 4] = 1;
    t.grip[g + 8] = 1;
  }
  t.poses.set(pose, row * POSE_ROW);
  for (let bone = 0; bone < FIGURE_BONES; bone++) {
    // Tronco e pernas não dependem do pitch: nas amostras seguintes são cópia exata da primeira.
    const o = row * BOX_ROW + bone * FIGURE_HIT_STRIDE;
    if (s > 0 && !PITCH_BONE[bone]) t.boxes.copyWithin(o, o - BOX_ROW, o - BOX_ROW + FIGURE_HIT_STRIDE);
    else {
      boneHitBox(b.bones, bone, b.shape, b.hit);
      t.boxes.set(b.hit, o);
    }
  }
}

/**
 * Chaves da recarga de cada empunhadura, na postura em pé base dela no pitch 0 (os ângulos do braço E são relativos ao
 * tronco): telha = o braço E da própria postura; pente = a palma E no pente da arma girada `gunRoll` em volta do cano
 * e descida `gunDropPx`; cinto = o alvo `belt` no espaço do tronco.
 */
function buildReload(t: FigureGameTable, b: Build): void {
  const P = FIGURE_POSE;
  const v = b.v;
  const center = (SAMPLES - 1) / 2;
  const c = Math.cos(FIGURE_RELOAD.gunRoll);
  const sn = Math.sin(FIGURE_RELOAD.gunRoll);
  for (let gi = 0; gi < FIGURE_GRIP_DEFS.length; gi++) {
    const def = FIGURE_GRIP_DEFS[gi]!;
    const p = figurePosture(FIGURE_STANCE.stand, (gi + 1) as 1 | 2 | 3, FIGURE_MODE.base, false);
    const row = p * SAMPLES + center;
    const r = gi * 3 * 4;
    // Telha: o braço E da postura no pitch 0.
    t.reload[r] = t.poses[row * POSE_ROW + P.shLX]!;
    t.reload[r + 1] = t.poses[row * POSE_ROW + P.shLY]!;
    t.reload[r + 2] = t.poses[row * POSE_ROW + P.shLZ]!;
    t.reload[r + 3] = t.poses[row * POSE_ROW + P.elL]!;
    // Tronco da postura (o FK não depende dos braços para isso).
    b.pose.set(t.poses.subarray(row * POSE_ROW, (row + 1) * POSE_ROW));
    figureFk(b.pose, 0, b.unit, 0, b.bones, 0);
    // A palma D da arma na amostra: grip (antebraço D) → frame do FutBobo pela translação do FK.
    bonePoint(
      b.bones,
      FIGURE_BONE.forearmR,
      t.grip[row * GRIP_STRIDE + 9]!,
      t.grip[row * GRIP_STRIDE + 10]!,
      t.grip[row * GRIP_STRIDE + 11]!,
      v,
      VEC.right,
    );
    // Pente: arma descida e girada Rz(gunRoll) em volta do cano (pitch 0: eixos da raiz).
    const m = def.mag;
    v[VEC.left] = v[VEC.right]! + m[0] * c - m[1] * sn;
    v[VEC.left + 1] = v[VEC.right + 1]! - FIGURE_RELOAD.gunDropPx + m[0] * sn + m[1] * c;
    v[VEC.left + 2] = v[VEC.right + 2]! + m[2];
    solveTo(b.bones, v, VEC.left, 1, b.arm);
    for (let k = 0; k < 4; k++) t.reload[r + 4 + k] = b.arm[k]!;
    // Cinto: alvo direto no espaço do tronco.
    figureSolveArm(FIGURE_RELOAD.belt[0], FIGURE_RELOAD.belt[1], FIGURE_RELOAD.belt[2], 1, b.arm, 0);
    for (let k = 0; k < 4; k++) t.reload[r + 8 + k] = b.arm[k]!;
  }
}

/**
 * Postura que sai igual a outra já montada (−1 se não há): o ADS que não muda nada em relação à base (a pistola: a
 * empunhadura do ADS é a da base e, em pé, sem o mergulho da cabeça). A montagem copia a base em vez de refazer.
 */
function twinOf(p: number, zombie: number): number {
  if (p === zombie) return -1;
  const grip = FIGURE_POSTURE_INFO[p * 3 + 1]!;
  if (grip === FIGURE_GRIP.none || FIGURE_POSTURE_INFO[p * 3 + 2] !== FIGURE_MODE.ads) return -1;
  const def = FIGURE_GRIP_DEFS[grip - 1]!;
  if (def.ads[0] !== def.base[0] || def.ads[1] !== def.base[1] || def.ads[2] !== def.base[2]) return -1;
  if (FIGURE_POSTURE_INFO[p * 3] === FIGURE_STANCE.stand && def.adsHeadDip !== 0) return -1;
  // O ADS vem logo depois da base, em pé e agachado.
  return p - 1;
}

/** Pura; aloca 1 vez; não guarda nada no módulo. O game monta no loading e passa à sim e ao render. */
export function createFigureGameTable(): FigureGameTable {
  const t: FigureGameTable = {
    poses: new Float32Array(FIGURE_POSTURES * SAMPLES * POSE_ROW),
    boxes: new Float32Array(FIGURE_POSTURES * SAMPLES * BOX_ROW),
    broad: new Float32Array(FIGURE_POSTURES * 2),
    slack: new Float32Array(FIGURE_POSTURES * INTERVALS * SLACK_ROW),
    grip: new Float32Array(FIGURE_POSTURES * SAMPLES * GRIP_STRIDE),
    reload: new Float32Array(RELOAD_SIZE),
    bulge: new Float32Array(FIGURE_POSTURES * INTERVALS * BULGE_ROW),
  };
  const unit = new Float32Array(16);
  unit[0] = 1;
  unit[5] = 1;
  unit[10] = 1;
  unit[15] = 1;
  const b: Build = {
    unit,
    pose: new Float32Array(FIGURE_POSE_SIZE),
    bones: new Float32Array(FIGURE_BONES * 16),
    shape: hitShapes(),
    hit: new Float64Array(FIGURE_HIT_STRIDE),
    arm: new Float64Array(4),
    v: new Float64Array(VEC_SIZE),
    zombie: figurePosture(FIGURE_STANCE.stand, FIGURE_GRIP.none, FIGURE_MODE.base, true),
  };
  for (let p = 0; p < FIGURE_POSTURES; p++) {
    const twin = twinOf(p, b.zombie);
    if (twin < 0) {
      for (let s = 0; s < SAMPLES; s++) buildSample(t, b, p, s);
      continue;
    }
    t.poses.copyWithin(p * SAMPLES * POSE_ROW, twin * SAMPLES * POSE_ROW, (twin + 1) * SAMPLES * POSE_ROW);
    t.boxes.copyWithin(p * SAMPLES * BOX_ROW, twin * SAMPLES * BOX_ROW, (twin + 1) * SAMPLES * BOX_ROW);
    t.grip.copyWithin(p * SAMPLES * GRIP_STRIDE, twin * SAMPLES * GRIP_STRIDE, (twin + 1) * SAMPLES * GRIP_STRIDE);
  }
  buildReload(t, b);
  measureSlack(t, b);
  return t;
}

/** A hitbox da cabeça das posturas `a` e `ref` é a mesma (± 1 µm) nas duas amostras do intervalo `iv`. */
function sameHead(t: FigureGameTable, a: number, ref: number, iv: number): boolean {
  for (let s = iv; s <= iv + 1; s++) {
    const oa = (a * SAMPLES + s) * BOX_ROW + FIGURE_BONE.head * FIGURE_HIT_STRIDE;
    const or = (ref * SAMPLES + s) * BOX_ROW + FIGURE_BONE.head * FIGURE_HIT_STRIDE;
    for (let k = 0; k <= HF.r22; k++) if (Math.abs(t.boxes[oa + k]! - t.boxes[or + k]!) > 1e-6) return false;
  }
  return true;
}

/**
 * Hitbox do osso `bone` interpolada no intervalo `i`, fração `f`, em out[d ..]: as mesmas contas do `figureHitBoxes`
 * (corda + barriga + folga, Gram-Schmidt, faixa vertical), só para um osso. Só na montagem (a medição da folga só
 * olha os ossos que mexem).
 */
function interpBone(
  t: FigureGameTable,
  posture: number,
  i: number,
  f: number,
  bone: number,
  out: Float64Array,
  d: number,
): void {
  const src = t.boxes;
  const a = (posture * SAMPLES + i) * BOX_ROW + bone * FIGURE_HIT_STRIDE;
  const b = a + BOX_ROW;
  const w = 4 * f * (1 - f);
  for (let k = 0; k <= HF.r22; k++) {
    const va = src[a + k]!;
    out[d + k] = va + (src[b + k]! - va) * f;
  }
  const bulge = t.bulge;
  if (bulge !== undefined) {
    const e = ((posture * INTERVALS + i) * FIGURE_BONES + bone) * 9;
    out[d + HF.cx] = out[d + HF.cx]! + w * bulge[e]!;
    out[d + HF.cy] = out[d + HF.cy]! + w * bulge[e + 1]!;
    out[d + HF.cz] = out[d + HF.cz]! + w * bulge[e + 2]!;
    out[d + HF.r00] = out[d + HF.r00]! + w * bulge[e + 3]!;
    out[d + HF.r10] = out[d + HF.r10]! + w * bulge[e + 4]!;
    out[d + HF.r20] = out[d + HF.r20]! + w * bulge[e + 5]!;
    out[d + HF.r01] = out[d + HF.r01]! + w * bulge[e + 6]!;
    out[d + HF.r11] = out[d + HF.r11]! + w * bulge[e + 7]!;
    out[d + HF.r21] = out[d + HF.r21]! + w * bulge[e + 8]!;
  }
  const s = ((posture * INTERVALS + i) * FIGURE_BONES + bone) * 3;
  out[d + HF.hx] = out[d + HF.hx]! + w * t.slack[s]!;
  out[d + HF.hy] = out[d + HF.hy]! + w * t.slack[s + 1]!;
  out[d + HF.hz] = out[d + HF.hz]! + w * t.slack[s + 2]!;
  orthonormalize(out, d);
  out[d + HF.category] = src[a + HF.category]!;
  verticalRange(out, d);
}

/**
 * Barriga, folga da interpolação (`slack`) e fase larga (`broad`) de cada postura. Em cada intervalo em que a pose
 * muda: (1) a hitbox exata no meio (FK da pose interpolada, como o render) menos a média das amostras vira a barriga
 * dos ossos que mexem; (2) em SLACK_AT mede quanto as quinas das caixas visuais passam de cada eixo local da hitbox
 * interpolada (com a barriga, ainda sem folga). A fase larga lê as amostras, o meio e esses pontos, com a folga do
 * peso de cada um, + BROAD_MARGIN_M. Tudo no FK em px com a raiz identidade (frame do FutBobo; a sim é (−x, y, z)·px),
 * e no FK parcial (`pitchFk`: só cabeça e braços mexem com o pitch; o tronco vem de um FK inteiro da postura).
 */
function measureSlack(t: FigureGameTable, b: Build): void {
  const F = FIGURE_BOX_FIELD;
  const PX = FIGURE_PX_M;
  const bulge = t.bulge!;
  const bodyBoxes = FIGURE_BODY_BOXES.length / FIGURE_BOX_STRIDE;
  // Caixas do corpo em 7 números (osso, centro, meias medidas), lidas no laço das quinas.
  const geo = new Float64Array(bodyBoxes * 7);
  for (let i = 0; i < bodyBoxes; i++) {
    const o = i * FIGURE_BOX_STRIDE;
    geo[i * 7] = FIGURE_BODY_BOXES[o + F.bone]!;
    geo[i * 7 + 1] = FIGURE_BODY_BOXES[o + F.cx]!;
    geo[i * 7 + 2] = FIGURE_BODY_BOXES[o + F.cy]!;
    geo[i * 7 + 3] = FIGURE_BODY_BOXES[o + F.cz]!;
    geo[i * 7 + 4] = FIGURE_BODY_BOXES[o + F.sx]! / 2;
    geo[i * 7 + 5] = FIGURE_BODY_BOXES[o + F.sy]! / 2;
    geo[i * 7 + 6] = FIGURE_BODY_BOXES[o + F.sz]! / 2;
  }
  const raw = new Float64Array(SLACK_AT.length * BOX_ROW);
  const mid = new Float64Array(BOX_ROW);
  const ratio = new Float64Array(SLACK_ROW);
  const over = new Float64Array(SLACK_ROW);
  const moving = new Uint8Array(INTERVALS * FIGURE_BONES);
  /** Fase larga da cabeça (raio², topo) por stance e intervalo, medida na postura sem arma e reusada nas outras. */
  const headBroad = new Float64Array(3 * INTERVALS * 2);
  const pose = b.pose;
  const bones = b.bones;
  const hit = b.hit;
  for (let p = 0; p < FIGURE_POSTURES; p++) {
    // Postura gêmea de uma já medida (a pistola: o ADS é a base): copia a medição.
    const twin = twinOf(p, b.zombie);
    if (twin >= 0) {
      t.slack.copyWithin(p * INTERVALS * SLACK_ROW, twin * INTERVALS * SLACK_ROW, (twin + 1) * INTERVALS * SLACK_ROW);
      bulge.copyWithin(p * INTERVALS * BULGE_ROW, twin * INTERVALS * BULGE_ROW, (twin + 1) * INTERVALS * BULGE_ROW);
      t.broad[p * 2] = t.broad[twin * 2]!;
      t.broad[p * 2 + 1] = t.broad[twin * 2 + 1]!;
      continue;
    }
    // Ossos cuja hitbox muda em cada intervalo (centro ou R). Os outros ficam parados no intervalo inteiro: as poses de
    // jogo não têm contragiro que volte ao mesmo lugar (o teste E.1 sem margem confere cada pitch). Tronco e pernas
    // são cópia exata da 1ª amostra (`buildSample`): nem entram na conta.
    let anyMoving = false;
    for (let iv = 0; iv < INTERVALS; iv++) {
      const rowA = (p * SAMPLES + iv) * BOX_ROW;
      for (let bone = 0; bone < FIGURE_BONES; bone++) {
        let differs = false;
        if (PITCH_BONE[bone]) {
          for (let k = 0; k <= HF.r22 && !differs; k++) {
            const at = rowA + bone * FIGURE_HIT_STRIDE + k;
            if (t.boxes[at] !== t.boxes[at + BOX_ROW]) differs = true;
          }
        }
        moving[iv * FIGURE_BONES + bone] = differs ? 1 : 0;
        if (differs) anyMoving = true;
      }
    }
    let radius2 = 0;
    let top = -Infinity;
    // Amostras direto da tabela (já ortonormais, com maxY gravado; a folga é zero nelas). Osso parado no intervalo
    // anterior repete a amostra anterior.
    for (let s = 0; s < SAMPLES; s++) {
      for (let bone = 0; bone < FIGURE_BONES; bone++) {
        if (s > 0 && moving[(s - 1) * FIGURE_BONES + bone] === 0) continue;
        const o = (p * SAMPLES + s) * BOX_ROW + bone * FIGURE_HIT_STRIDE;
        radius2 = Math.max(radius2, planeRadius2(t.boxes, o, 0, t.slack, 0));
        top = Math.max(top, t.boxes[o + HF.maxY]!);
      }
    }
    // A cabeça gira igual em todas as posturas do stance (composição exata do pescoço; o ADS em pé, com o mergulho, é
    // a exceção): onde as amostras dela batem com as da postura sem arma, a barriga, a folga e a fase larga da cabeça
    // vêm de lá e ela sai da medição.
    const stance = FIGURE_POSTURE_INFO[p * 3]!;
    const ref = p === b.zombie ? p : figurePosture(stance as FigureStance, FIGURE_GRIP.none, FIGURE_MODE.base, false);
    if (ref !== p) {
      for (let iv = 0; iv < INTERVALS; iv++) {
        const mh = iv * FIGURE_BONES + FIGURE_BONE.head;
        if (moving[mh] === 0 || !sameHead(t, p, ref, iv)) continue;
        moving[mh] = 0;
        const hs = ((ref * INTERVALS + iv) * FIGURE_BONES + FIGURE_BONE.head) * 3;
        const hd = ((p * INTERVALS + iv) * FIGURE_BONES + FIGURE_BONE.head) * 3;
        t.slack.copyWithin(hd, hs, hs + 3);
        bulge.copyWithin(hd * 3, hs * 3, hs * 3 + 9);
        radius2 = Math.max(radius2, headBroad[(stance * INTERVALS + iv) * 2]!);
        top = Math.max(top, headBroad[(stance * INTERVALS + iv) * 2 + 1]!);
      }
      anyMoving = false;
      for (let k = 0; k < INTERVALS * FIGURE_BONES; k++) if (moving[k] === 1) anyMoving = true;
    }
    if (anyMoving) {
      // Tronco (e o resto parado) da postura: um FK inteiro da 1ª amostra.
      figureFk(t.poses, p * SAMPLES * POSE_ROW, b.unit, 0, bones, 0);
    }
    for (let iv = 0; iv < INTERVALS; iv++) {
      const mv = iv * FIGURE_BONES;
      let any = false;
      for (let bone = 0; bone < FIGURE_BONES; bone++) if (moving[mv + bone] === 1) any = true;
      if (!any) continue;
      // Só a parte do FK que mexe no intervalo (a outra não é lida).
      const headMoves = moving[mv + FIGURE_BONE.head] === 1;
      const armsMove =
        moving[mv + FIGURE_BONE.upperArmR] === 1 ||
        moving[mv + FIGURE_BONE.upperArmL] === 1 ||
        moving[mv + FIGURE_BONE.forearmR] === 1 ||
        moving[mv + FIGURE_BONE.forearmL] === 1;
      const rowA = (p * SAMPLES + iv) * BOX_ROW;
      // (1) Barriga: hitbox exata no meio − média das amostras.
      const q = (p * INTERVALS + iv) * BULGE_ROW;
      figureGamePose(t, p, PITCH_MIN + (iv + 0.5) * PITCH_STEP, pose, 0);
      if (headMoves) headFk(pose, bones);
      if (armsMove) armsFk(pose, bones);
      for (let bone = 0; bone < FIGURE_BONES; bone++) {
        if (moving[mv + bone] === 0) continue;
        boneHitBox(bones, bone, b.shape, hit);
        mid.set(hit, bone * FIGURE_HIT_STRIDE);
        const a = rowA + bone * FIGURE_HIT_STRIDE;
        const d = q + bone * 9;
        for (let k = 0; k < 3; k++) {
          bulge[d + k] = hit[HF.cx + k]! - (t.boxes[a + HF.cx + k]! + t.boxes[a + BOX_ROW + HF.cx + k]!) / 2;
          // Colunas direita (r00, r10, r20) e cima (r01, r11, r21).
          const c0 = HF.r00 + k * 3;
          const c1 = HF.r01 + k * 3;
          bulge[d + 3 + k] = hit[c0]! - (t.boxes[a + c0]! + t.boxes[a + BOX_ROW + c0]!) / 2;
          bulge[d + 6 + k] = hit[c1]! - (t.boxes[a + c1]! + t.boxes[a + BOX_ROW + c1]!) / 2;
        }
      }
      // (2) Folga nos pontos do intervalo, com a barriga já valendo e a folga deste intervalo ainda 0.
      ratio.fill(0);
      over.fill(0);
      for (let n = 0; n < SLACK_AT.length; n++) {
        const f = SLACK_AT[n]!;
        const weight = 4 * f * (1 - f);
        const r = n * BOX_ROW;
        for (let bone = 0; bone < FIGURE_BONES; bone++) {
          if (moving[mv + bone] === 1) interpBone(t, p, iv, f, bone, raw, r + bone * FIGURE_HIT_STRIDE);
        }
        figureGamePose(t, p, PITCH_MIN + (iv + f) * PITCH_STEP, pose, 0);
        if (headMoves) headFk(pose, bones);
        if (armsMove) armsFk(pose, bones);
        for (let i = 0; i < bodyBoxes; i++) {
          const o = i * 7;
          const bone = geo[o]!;
          if (moving[mv + bone] === 0) continue;
          const m = bone * 16;
          const h = r + bone * FIGURE_HIT_STRIDE;
          const x = geo[o + 1]!;
          const y = geo[o + 2]!;
          const z = geo[o + 3]!;
          const hx = geo[o + 4]!;
          const hy = geo[o + 5]!;
          const hz = geo[o + 6]!;
          // Eixos do osso em locais (o interpretador do jitless paga cada leitura de typed array).
          const m0 = bones[m]!;
          const m1 = bones[m + 1]!;
          const m2 = bones[m + 2]!;
          const m4 = bones[m + 4]!;
          const m5 = bones[m + 5]!;
          const m6 = bones[m + 6]!;
          const m8 = bones[m + 8]!;
          const m9 = bones[m + 9]!;
          const m10 = bones[m + 10]!;
          // Centro da caixa visual no frame da sim, (−x, y, z)·px, menos o centro da hitbox.
          const dx = -(bones[m + 12]! + m0 * x + m4 * y + m8 * z) * PX - raw[h]!;
          const dy = (bones[m + 13]! + m1 * x + m5 * y + m9 * z) * PX - raw[h + 1]!;
          const dz = (bones[m + 14]! + m2 * x + m6 * y + m10 * z) * PX - raw[h + 2]!;
          for (let j = 0; j < 3; j++) {
            // Coluna j de R (r0j, r1j, r2j) nos campos 6 + j, 9 + j e 12 + j.
            const rx = raw[h + 6 + j]!;
            const ry = raw[h + 9 + j]!;
            const rz = raw[h + 12 + j]!;
            // Maior |coordenada j| das 8 quinas = |centro| + Σ |meio eixo da caixa visual projetado| (sem varrer quinas).
            const reach =
              Math.abs(rx * dx + ry * dy + rz * dz) +
              PX *
                (hx * Math.abs(ry * m1 + rz * m2 - rx * m0) +
                  hy * Math.abs(ry * m5 + rz * m6 - rx * m4) +
                  hz * Math.abs(ry * m9 + rz * m10 - rx * m8));
            const out = reach - raw[h + 3 + j]!;
            const k = bone * 3 + j;
            if (out > over[k]!) over[k] = out;
            if (out / weight > ratio[k]!) ratio[k] = out / weight;
          }
        }
      }
      // Só os ossos medidos: a cabeça reusada da postura sem arma já está gravada.
      const s = (p * INTERVALS + iv) * SLACK_ROW;
      for (let k = 0; k < SLACK_ROW; k++) {
        if (moving[mv + ((k / 3) | 0)] === 0) continue;
        t.slack[s + k] = over[k]! > SLACK_EPS_M ? ratio[k]! * SLACK_GAIN + SLACK_FLOOR_M : 0;
      }
      // Fase larga nos pontos medidos e no meio: a hitbox crua crescida da folga com o peso do ponto (= o que a sim
      // recebe; no meio a barriga a deixa exata e a folga entra cheia).
      for (let bone = 0; bone < FIGURE_BONES; bone++) {
        if (moving[mv + bone] === 0) continue;
        const g = s + bone * 3;
        let br2 = 0;
        let bt = -Infinity;
        for (let n = 0; n <= SLACK_AT.length; n++) {
          const f = n < SLACK_AT.length ? SLACK_AT[n]! : 0.5;
          const w = 4 * f * (1 - f);
          const h = n < SLACK_AT.length ? raw : mid;
          const o = n < SLACK_AT.length ? n * BOX_ROW + bone * FIGURE_HIT_STRIDE : bone * FIGURE_HIT_STRIDE;
          br2 = Math.max(br2, planeRadius2(h, o, w, t.slack, g));
          const ey =
            Math.abs(h[o + HF.r10]!) * (h[o + HF.hx]! + w * t.slack[g]!) +
            Math.abs(h[o + HF.r11]!) * (h[o + HF.hy]! + w * t.slack[g + 1]!) +
            Math.abs(h[o + HF.r12]!) * (h[o + HF.hz]! + w * t.slack[g + 2]!);
          bt = Math.max(bt, h[o + HF.cy]! + ey);
        }
        radius2 = Math.max(radius2, br2);
        top = Math.max(top, bt);
        if (bone === FIGURE_BONE.head && ref === p && p !== b.zombie) {
          headBroad[(stance * INTERVALS + iv) * 2] = br2;
          headBroad[(stance * INTERVALS + iv) * 2 + 1] = bt;
        }
      }
    }
    t.broad[p * 2] = Math.sqrt(radius2) + BROAD_MARGIN_M;
    t.broad[p * 2 + 1] = top + BROAD_MARGIN_M;
  }
}

/** Maior x² + z² das 8 quinas da hitbox em h[o ..], com as meias medidas crescidas de w·grow[g .. g+3). */
function planeRadius2(h: Float32Array | Float64Array, o: number, w: number, grow: Float32Array, g: number): number {
  const hx = h[o + HF.hx]! + w * grow[g]!;
  const hy = h[o + HF.hy]! + w * grow[g + 1]!;
  const hz = h[o + HF.hz]! + w * grow[g + 2]!;
  const cx = h[o + HF.cx]!;
  const cz = h[o + HF.cz]!;
  // Colunas de R × meias medidas, só x e z. As quinas vêm em pares c ± (u, v): o maior x² + z² do par é
  // |c|² + u² + v² + 2·|c·(u, v)|, então bastam 4 combinações de sinal.
  const ax = h[o + HF.r00]! * hx;
  const ay = h[o + HF.r01]! * hy;
  const az = h[o + HF.r02]! * hz;
  const bx = h[o + HF.r20]! * hx;
  const by = h[o + HF.r21]! * hy;
  const bz = h[o + HF.r22]! * hz;
  const c2 = cx * cx + cz * cz;
  let u = ax + ay + az;
  let v = bx + by + bz;
  let best = c2 + u * u + v * v + 2 * Math.abs(cx * u + cz * v);
  u = ax + ay - az;
  v = bx + by - bz;
  best = Math.max(best, c2 + u * u + v * v + 2 * Math.abs(cx * u + cz * v));
  u = ax - ay + az;
  v = bx - by + bz;
  best = Math.max(best, c2 + u * u + v * v + 2 * Math.abs(cx * u + cz * v));
  u = ax - ay - az;
  v = bx - by - bz;
  return Math.max(best, c2 + u * u + v * v + 2 * Math.abs(cx * u + cz * v));
}

// --- Acessores (por tick e por quadro: sem alocação) ---

/** Posição contínua na grade de amostras, em [0, SAMPLES − 1]; NaN cai na 1ª amostra. */
function pitchU(pitch: number): number {
  // quente:
  const u = (pitch - PITCH_MIN) / PITCH_STEP;
  return u > 0 ? (u < SAMPLES - 1 ? u : SAMPLES - 1) : 0;
  // fim-quente
}

/** Gram-Schmidt nas colunas de uma 3×3 linha-maior em m[o + 6 ..] (campos r00..r22 da hitbox); col2 = col0 × col1. */
function orthonormalize(m: Float64Array, o: number): void {
  // quente:
  let ax = m[o + HF.r00]!;
  let ay = m[o + HF.r10]!;
  let az = m[o + HF.r20]!;
  let n = 1 / Math.sqrt(ax * ax + ay * ay + az * az);
  ax *= n;
  ay *= n;
  az *= n;
  let bx = m[o + HF.r01]!;
  let by = m[o + HF.r11]!;
  let bz = m[o + HF.r21]!;
  const d = ax * bx + ay * by + az * bz;
  bx -= d * ax;
  by -= d * ay;
  bz -= d * az;
  n = 1 / Math.sqrt(bx * bx + by * by + bz * bz);
  bx *= n;
  by *= n;
  bz *= n;
  m[o + HF.r00] = ax;
  m[o + HF.r10] = ay;
  m[o + HF.r20] = az;
  m[o + HF.r01] = bx;
  m[o + HF.r11] = by;
  m[o + HF.r21] = bz;
  m[o + HF.r02] = ay * bz - az * by;
  m[o + HF.r12] = az * bx - ax * bz;
  m[o + HF.r22] = ax * by - ay * bx;
  // fim-quente
}

/** minY e maxY da hitbox em m[o ..] pela linha y de R. */
function verticalRange(m: Float64Array, o: number): void {
  // quente:
  const ey =
    Math.abs(m[o + HF.r10]!) * m[o + HF.hx]! +
    Math.abs(m[o + HF.r11]!) * m[o + HF.hy]! +
    Math.abs(m[o + HF.r12]!) * m[o + HF.hz]!;
  m[o + HF.minY] = m[o + HF.cy]! - ey;
  m[o + HF.maxY] = m[o + HF.cy]! + ey;
  // fim-quente
}

/**
 * Pose base da postura (0..FIGURE_POSTURES − 1) no `pitch` da sim: interpola os ÂNGULOS (e px) entre as amostras
 * vizinhas, com clamp nas pontas. Escreve FIGURE_POSE_SIZE floats em out[o ..].
 *
 * Postura armada: o pescoço sai da composição exata no pitch pedido, R_pescoço = R_troncoᵀ·Rx(−p_cabeça), e não da
 * interpolação. Com o tronco torcido (neckY ≈ −torsoY) os ângulos de Euler do pescoço não são lineares no pitch: a
 * interpolação deixava a cabeça bambear até ~0,05 rad em guinada e rolagem entre as amostras, e a folga da hitbox da
 * cabeça ia de 12,6 a 18 mm (topo em pé 1,814 m, acima do `FIGURE_MAX_TOP_M`). Custo: 8 senos e cossenos, 1 asin e
 * 2 atan2; nas amostras dá o mesmo da tabela. As bases armadas olham para a frente (H_base = I; o teste confere).
 */
export function figureGamePose(t: FigureGameTable, posture: number, pitch: number, out: Float32Array, o: number): void {
  // quente:
  const u = pitchU(pitch);
  const i = u >= SAMPLES - 1 ? SAMPLES - 2 : Math.floor(u);
  const f = u - i;
  const src = t.poses;
  const a = (posture * SAMPLES + i) * POSE_ROW;
  const b = a + POSE_ROW;
  for (let k = 0; k < POSE_ROW; k++) {
    const va = src[a + k]!;
    out[o + k] = va + (src[b + k]! - va) * f;
  }
  const grip = FIGURE_POSTURE_INFO[posture * 3 + 1]!;
  if (grip === FIGURE_GRIP.none) return;
  // Pitch da cabeça (o `u` já tirou o NaN e o clamp de ±1,2): clamp(p; ±0,6) menos o mergulho do ADS em pé, que some
  // nas amostras ±0,6; agachado e deslizando, a fração 0,1/0,6 presa em [mín; máx] (só levanta). Escrito aqui, não
  // pelo `crouchHeadPitch`: passar o double a uma função não inlinada aloca no V8.
  const stance = FIGURE_POSTURE_INFO[posture * 3]!;
  const stand = stance === FIGURE_STANCE.stand;
  const max = FIGURE_AIM.headPitchMaxStand;
  let hp = PITCH_MIN + u * PITCH_STEP;
  hp = hp < -max ? -max : hp > max ? max : hp;
  if (stand && FIGURE_POSTURE_INFO[posture * 3 + 2] === FIGURE_MODE.ads) {
    hp -= FIGURE_GRIP_DEFS[grip - 1]!.adsHeadDip * (1 - Math.abs(hp) / max);
  }
  if (!stand) {
    hp *= FIGURE_AIM.headPitchMaxCrouch / max;
    const lo = FIGURE_AIM.headPitchMinCrouch;
    hp = hp < lo ? lo : hp;
  }
  const P = FIGURE_POSE;
  const cx = Math.cos(out[o + P.torsoX]!);
  const sx = Math.sin(out[o + P.torsoX]!);
  const cy = Math.cos(out[o + P.torsoY]!);
  const sy = Math.sin(out[o + P.torsoY]!);
  const cz = Math.cos(out[o + P.torsoZ]!);
  const sz = Math.sin(out[o + P.torsoZ]!);
  const c = Math.cos(hp);
  const s = Math.sin(hp);
  // R_tronco = Rx·Ry·Rz por linhas (t<linha><coluna>); Rx(−hp) = [1, 0, 0; 0, c, s; 0, −s, c].
  const t00 = cy * cz;
  const t10 = cx * sz + sx * sy * cz;
  const t11 = cx * cz - sx * sy * sz;
  const t12 = -sx * cy;
  const t20 = sx * sz - cx * sy * cz;
  const t21 = sx * cz + cx * sy * sz;
  const t22 = cx * cy;
  // N = R_troncoᵀ·Rx(−hp): n<i><j> = Σ t<k><i>·x<k><j>.
  const n00 = t00;
  const n01 = t10 * c - t20 * s;
  const n02 = t10 * s + t20 * c;
  const n11 = t11 * c - t21 * s;
  const n12 = t11 * s + t21 * c;
  const n21 = t12 * c - t22 * s;
  const n22 = t12 * s + t22 * c;
  out[o + P.neckY] = Math.asin(n02 < -1 ? -1 : n02 > 1 ? 1 : n02);
  if (Math.abs(n02) < 0.9999999) {
    out[o + P.neckX] = Math.atan2(-n12, n22);
    out[o + P.neckZ] = Math.atan2(-n01, n00);
  } else {
    out[o + P.neckX] = Math.atan2(n21, n11);
    out[o + P.neckZ] = 0;
  }
  // fim-quente
}

/**
 * As 12 hitboxes da postura no `pitch` (raiz na origem, yaw 0, frame da sim): interpola centros, meias medidas e R,
 * soma ao centro e às colunas direita e cima a barriga do intervalo (`bulge` × 4f(1 − f): o meio fica exato, e o
 * centro anda no arco e não na corda) e REORTONORMALIZA as colunas (a 3×3 interpolada encolhe ~4,5% no meio do
 * intervalo); soma às meias medidas a folga medida da interpolação (`slack` × 4f(1 − f), zero nas amostras), para a
 * hitbox conter a caixa visual (que o render tira dos ângulos interpolados) em todo pitch; minY e maxY recalculados.
 * Escreve 12 × FIGURE_HIT_STRIDE em out[o ..].
 */
export function figureHitBoxes(t: FigureGameTable, posture: number, pitch: number, out: Float64Array, o: number): void {
  // quente:
  const u = pitchU(pitch);
  const i = u >= SAMPLES - 1 ? SAMPLES - 2 : Math.floor(u);
  const f = u - i;
  const src = t.boxes;
  const rowA = (posture * SAMPLES + i) * BOX_ROW;
  const rowB = rowA + BOX_ROW;
  const w = 4 * f * (1 - f);
  const slack = t.slack;
  const s = (posture * INTERVALS + i) * SLACK_ROW;
  const bulge = t.bulge;
  const q = (posture * INTERVALS + i) * BULGE_ROW;
  for (let bone = 0; bone < FIGURE_BONES; bone++) {
    const a = rowA + bone * FIGURE_HIT_STRIDE;
    const b = rowB + bone * FIGURE_HIT_STRIDE;
    const d = o + bone * FIGURE_HIT_STRIDE;
    for (let k = 0; k <= HF.r22; k++) {
      const va = src[a + k]!;
      out[d + k] = va + (src[b + k]! - va) * f;
    }
    if (bulge !== undefined) {
      const e = q + bone * 9;
      out[d + HF.cx] = out[d + HF.cx]! + w * bulge[e]!;
      out[d + HF.cy] = out[d + HF.cy]! + w * bulge[e + 1]!;
      out[d + HF.cz] = out[d + HF.cz]! + w * bulge[e + 2]!;
      out[d + HF.r00] = out[d + HF.r00]! + w * bulge[e + 3]!;
      out[d + HF.r10] = out[d + HF.r10]! + w * bulge[e + 4]!;
      out[d + HF.r20] = out[d + HF.r20]! + w * bulge[e + 5]!;
      out[d + HF.r01] = out[d + HF.r01]! + w * bulge[e + 6]!;
      out[d + HF.r11] = out[d + HF.r11]! + w * bulge[e + 7]!;
      out[d + HF.r21] = out[d + HF.r21]! + w * bulge[e + 8]!;
    }
    out[d + HF.hx] = out[d + HF.hx]! + w * slack[s + bone * 3]!;
    out[d + HF.hy] = out[d + HF.hy]! + w * slack[s + bone * 3 + 1]!;
    out[d + HF.hz] = out[d + HF.hz]! + w * slack[s + bone * 3 + 2]!;
    orthonormalize(out, d);
    out[d + HF.category] = src[a + HF.category]!;
    verticalRange(out, d);
  }
  // fim-quente
}

/**
 * Ponto que a IA mira no alvo (centro da hitbox da cabeça ou do tronco), em y (a partir dos pés) e z (frente do
 * alvo), no frame da sim; o chamador leva ao mundo pelo yaw do alvo. x = 0 (o eixo do boneco).
 */
export function figureAimPoint(
  t: FigureGameTable,
  posture: number,
  pitch: number,
  head: boolean,
  out: FigureAimOut,
): void {
  // quente:
  const u = pitchU(pitch);
  const i = u >= SAMPLES - 1 ? SAMPLES - 2 : Math.floor(u);
  const f = u - i;
  const src = t.boxes;
  const bone = head ? FIGURE_BONE.head : FIGURE_BONE.torso;
  const a = (posture * SAMPLES + i) * BOX_ROW + bone * FIGURE_HIT_STRIDE;
  const b = a + BOX_ROW;
  const ya = src[a + HF.cy]!;
  const za = src[a + HF.cz]!;
  out.y = ya + (src[b + HF.cy]! - ya) * f;
  out.z = za + (src[b + HF.cz]! - za) * f;
  // A barriga do intervalo, como no `figureHitBoxes` (o ponto é o centro da hitbox).
  const bulge = t.bulge;
  if (bulge !== undefined) {
    const e = ((posture * INTERVALS + i) * FIGURE_BONES + bone) * 9;
    const w = 4 * f * (1 - f);
    out.y = out.y + w * bulge[e + 1]!;
    out.z = out.z + w * bulge[e + 2]!;
  }
  // fim-quente
}

/**
 * Parte do corpo pela altura `h` de um ponto a partir dos pés (golpe corpo a corpo), pela base (minY) das hitboxes da
 * postura no `pitch` (as de `figureHitBoxes`): cabeça, tronco, coxa, canela e, abaixo de tudo, o pé (lado direito para
 * as pernas).
 *
 * O minY da cabeça sai da hitbox interpolada inteira (centro e R com a barriga, Gram-Schmidt, meias medidas com a
 * folga), não da média dos minY das amostras: a quina mais baixa da cabeça girando faz um "V" no minY quando a cabeça
 * passa pelo nível (ADS em pé com o mergulho, zumbi), e a média errava até 4,7 cm para baixo (golpe no pescoço contado
 * como cabeça). Tronco e pernas não mudam com o pitch: o minY deles é o da amostra.
 */
export function figureBodyPartAtHeight(t: FigureGameTable, posture: number, pitch: number, h: number): FigurePart {
  // quente:
  const u = pitchU(pitch);
  const i = u >= SAMPLES - 1 ? SAMPLES - 2 : Math.floor(u);
  const f = u - i;
  const src = t.boxes;
  const w = 4 * f * (1 - f);
  // Cabeça: as contas do `figureHitBoxes` para um osso, escritas aqui (um auxiliar que recebe `f`, double, e não é
  // inlinado alocaria). Só a linha y de R entra no minY.
  let a = (posture * SAMPLES + i) * BOX_ROW + FIGURE_BONE.head * FIGURE_HIT_STRIDE;
  const b = a + BOX_ROW;
  let cy = src[a + HF.cy]! + (src[b + HF.cy]! - src[a + HF.cy]!) * f;
  let ax = src[a + HF.r00]! + (src[b + HF.r00]! - src[a + HF.r00]!) * f;
  let ay = src[a + HF.r10]! + (src[b + HF.r10]! - src[a + HF.r10]!) * f;
  let az = src[a + HF.r20]! + (src[b + HF.r20]! - src[a + HF.r20]!) * f;
  let bx = src[a + HF.r01]! + (src[b + HF.r01]! - src[a + HF.r01]!) * f;
  let by = src[a + HF.r11]! + (src[b + HF.r11]! - src[a + HF.r11]!) * f;
  let bz = src[a + HF.r21]! + (src[b + HF.r21]! - src[a + HF.r21]!) * f;
  const bulge = t.bulge;
  if (bulge !== undefined) {
    const e = ((posture * INTERVALS + i) * FIGURE_BONES + FIGURE_BONE.head) * 9;
    cy += w * bulge[e + 1]!;
    ax += w * bulge[e + 3]!;
    ay += w * bulge[e + 4]!;
    az += w * bulge[e + 5]!;
    bx += w * bulge[e + 6]!;
    by += w * bulge[e + 7]!;
    bz += w * bulge[e + 8]!;
  }
  let n = 1 / Math.sqrt(ax * ax + ay * ay + az * az);
  ax *= n;
  ay *= n;
  az *= n;
  const d = ax * bx + ay * by + az * bz;
  bx -= d * ax;
  by -= d * ay;
  bz -= d * az;
  n = 1 / Math.sqrt(bx * bx + by * by + bz * bz);
  by *= n;
  // r12 = (col0 × col1).y = az·bx − ax·bz (com col1 normalizada).
  const r12 = (az * bx - ax * bz) * n;
  const s = ((posture * INTERVALS + i) * FIGURE_BONES + FIGURE_BONE.head) * 3;
  const hx = src[a + HF.hx]! + (src[b + HF.hx]! - src[a + HF.hx]!) * f + w * t.slack[s]!;
  const hy = src[a + HF.hy]! + (src[b + HF.hy]! - src[a + HF.hy]!) * f + w * t.slack[s + 1]!;
  const hz = src[a + HF.hz]! + (src[b + HF.hz]! - src[a + HF.hz]!) * f + w * t.slack[s + 2]!;
  const ey = Math.abs(ay) * hx + Math.abs(by) * hy + Math.abs(r12) * hz;
  if (h >= cy - ey) return FIGURE_BONE.head;
  // Tronco e pernas: o minY das amostras (iguais entre si; a interpolação fica por segurança).
  a += (FIGURE_BONE.torso - FIGURE_BONE.head) * FIGURE_HIT_STRIDE + HF.minY;
  let v = src[a]!;
  if (h >= v + (src[a + BOX_ROW]! - v) * f) return FIGURE_BONE.torso;
  a += (FIGURE_BONE.thighR - FIGURE_BONE.torso) * FIGURE_HIT_STRIDE;
  v = src[a]!;
  if (h >= v + (src[a + BOX_ROW]! - v) * f) return FIGURE_BONE.thighR;
  a += (FIGURE_BONE.shinR - FIGURE_BONE.thighR) * FIGURE_HIT_STRIDE;
  v = src[a]!;
  if (h >= v + (src[a + BOX_ROW]! - v) * f) return FIGURE_BONE.shinR;
  return FIGURE_BONE.footR;
  // fim-quente
}

/**
 * Matriz da arma no espaço do antebraço D (px) na postura e no `pitch`: interpola a afim 3×4 da tabela,
 * reortonormaliza as colunas e escreve a 4×4 coluna-maior INTEIRA em out[o .. o+16) (4ª linha 0, 0, 0, 1). O render
 * faz antebraço D × esta matriz.
 */
export function figureGripMatrix(
  t: FigureGameTable,
  posture: number,
  pitch: number,
  out: Float32Array,
  o: number,
): void {
  // quente:
  const u = pitchU(pitch);
  const i = u >= SAMPLES - 1 ? SAMPLES - 2 : Math.floor(u);
  const f = u - i;
  const src = t.grip;
  // Interpolação escrita aqui mesmo (sem auxiliar que receba `f`): por quadro e por ator, sem alocação.
  const a = (posture * SAMPLES + i) * GRIP_STRIDE;
  const b = a + GRIP_STRIDE;
  let ax = src[a]! + (src[b]! - src[a]!) * f;
  let ay = src[a + 1]! + (src[b + 1]! - src[a + 1]!) * f;
  let az = src[a + 2]! + (src[b + 2]! - src[a + 2]!) * f;
  let n = 1 / Math.sqrt(ax * ax + ay * ay + az * az);
  ax *= n;
  ay *= n;
  az *= n;
  let bx = src[a + 3]! + (src[b + 3]! - src[a + 3]!) * f;
  let by = src[a + 4]! + (src[b + 4]! - src[a + 4]!) * f;
  let bz = src[a + 5]! + (src[b + 5]! - src[a + 5]!) * f;
  const d = ax * bx + ay * by + az * bz;
  bx -= d * ax;
  by -= d * ay;
  bz -= d * az;
  n = 1 / Math.sqrt(bx * bx + by * by + bz * bz);
  bx *= n;
  by *= n;
  bz *= n;
  out[o] = ax;
  out[o + 1] = ay;
  out[o + 2] = az;
  out[o + 3] = 0;
  out[o + 4] = bx;
  out[o + 5] = by;
  out[o + 6] = bz;
  out[o + 7] = 0;
  out[o + 8] = ay * bz - az * by;
  out[o + 9] = az * bx - ax * bz;
  out[o + 10] = ax * by - ay * bx;
  out[o + 11] = 0;
  out[o + 12] = src[a + 9]! + (src[b + 9]! - src[a + 9]!) * f;
  out[o + 13] = src[a + 10]! + (src[b + 10]! - src[a + 10]!) * f;
  out[o + 14] = src[a + 11]! + (src[b + 11]! - src[a + 11]!) * f;
  out[o + 15] = 1;
  // fim-quente
}
