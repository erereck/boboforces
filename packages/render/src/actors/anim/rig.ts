// Animação dos bonecos do FutBobo (#56, PLANO do porte §B6; contrato em `types.ts`). Frente F4. O motor do FutBobo
// (`character.ts`: respiração, passada com o pé plantado, passinho do goleiro, passinho de giro, molas, freada,
// achatamento, pé plano e piscada) portado sobre a POSE BASE da tabela de jogo (`figureGamePose`, a mesma de onde a
// sim tira as hitboxes), com o que mexe na cabeça e no tronco preso ao envelope (`motion-config.ts`, teste E.2).
//
// Por ator e por quadro (nunca por vista), na ordem do §B6:
//   1. postura e pitch do `ActorBuffer`;
//   2. pose base = `figureGamePose` misturada entre a postura anterior e a atual (120 ms, linear; entre posturas de pé
//      no chão o `bodyY` segue o `legDrop` das pernas misturadas, para a sola não afundar no meio da troca);
//   3. locomoção 2D com `ActorBuffer.velocity`: passada do FutBobo com fase própria (para trás com cos δ < 0), passinho
//      de lado com `hipsY` até ±0,35, sprint pelo bit; respiração parado; passinho de giro; pernas do pulo;
//   4. molas, freada, achatamento, dano e nascer, dentro do envelope;
//   5. recarga (braço E pelas chaves da tabela, giro e queda da arma, olhar no pente, sem a respiração) e recuo
//      (braços e arma na amostra `pitch + 0,12·recoil`, arma para trás, impulso na mola na borda do `firing`);
//   6. giro preguiçoso das pernas (≤ 0,35 rad, o tronco fecha a diferença pela composição exata) e pé plano (só o X do
//      tornozelo; o Z é −hipZ dentro do `figureFk`);
//   7. `figureFk` direto em `out`; o nascer soma a queda de cada osso ao m[13];
//   8. arma numa 4×4 em METROS (ver `weapon`): ORIENTAÇÃO da moldura da mira (yaw da raiz e o ângulo da mira dos
//      braços, a mesma moldura em que a tabela monta a arma) e ORIGEM no soquete da palma D vinda do FK (antebraço D ×
//      a palma da `grip`), mais recuo e recarga (decisão 3 da §I);
//   9. expressão com a piscada (hash sem estado de (entidade, nº da piscada), só com a neutra; manequins não piscam).
//
// LOD (§B6): L0 tudo; L1 (além de `nearM`, com `halfRate`) tudo em quadros alternados pela paridade da entidade (o
// quadro calculado integra os 2 quadros em subpassos ≤ 0,05 s); L2 (fora do frustum de todas as vistas, sem contar a
// vista que esconde o próprio corpo) só soma o deslocamento da raiz às 12 matrizes e à arma, com molas e fases
// congeladas; ao voltar do L2, 1 quadro cheio, com os filtros de velocidade e as bordas zerados (sem tranco falso).
//
// Sem three, sem alocação no quadro (rascunhos e estado em typed arrays; doubles mutáveis do closure em Float64Array)
// e sem sorteio nem relógio: a mesma sequência de `ActorBuffer` e `dt` dá as mesmas matrizes (E.17).
//
// Custo: o Switch roda o V8 sem JIT (proxy: Node `--jitless`, `scripts/bench-figure.ts`), onde cada conta com double
// aloca um número e cada chamada custa. Por isso o laço quente evita chamadas pequenas (o `approach` usa os fatores
// 1 − e^(−taxa·dt) calculados 1 vez por dt; `clamp` e `smooth` estão escritos no lugar), lê cada matriz do `out` uma
// vez só, pula as camadas com peso zero, os pesos assentados e as molas paradas (`FLAG.calm`), e o recuo lê só os
// braços da tabela. Os doubles que vão para funções não inlinadas passam pelo F64 (sem caixa no JIT).
import {
  FACE_EXPRESSIONS,
  FIGURE_ARM_PITCH,
  FIGURE_BONES,
  FIGURE_GRIP,
  FIGURE_GRIP_DEFS,
  FIGURE_MODE,
  FIGURE_PITCH_SAMPLES,
  FIGURE_POSE,
  FIGURE_POSE_SIZE,
  FIGURE_POSTURE_INFO,
  FIGURE_POSTURES,
  FIGURE_PX_M,
  FIGURE_STANCE,
  figureFk,
  figureGamePose,
  figurePosture,
  type FigureGameTable,
} from '@boboforces/format';
import type { FrameContext } from '../../shared/passes.ts';
import { ACTOR_POSE, NO_FIGURE, NO_MODEL, type ActorBuffer } from '../../types.ts';
import { actorKey, createEntityTable } from '../entity-table.ts';
import { FIGURE_MOTION, FIGURE_U_PER_M, type FigureMotionConfig } from './motion-config.ts';
import { flatShin, hash01, legDrop, sampleTrack, TAU, wrapPhase, wrapPi } from './motion-math.ts';
import { FIGURE_POSE_RESULT, type FigureLodStats, type FigurePoseResult, type FigureRig } from './types.ts';

/** Estado por entidade na `EntityTable(256, ANIM_FIELDS)` (§B6: ~47 campos). */
export const ANIM_FIELD = {
  /** Relógio da entidade (s; para no L2). Começa na defasagem da respiração do boneco (0..10 s). */
  clock: 0,
  /** Bits de `FLAG`. */
  flags: 1,
  postureCur: 2,
  posturePrev: 3,
  /** Peso da postura atual na mistura (0..1). */
  postureW: 4,
  airW: 5,
  runW: 6,
  sprintW: 7,
  /** Velocidade suavizada para a frente e para a direita (u/s, com sinal). */
  gait: 8,
  side: 9,
  runPhase: 10,
  shufflePhase: 11,
  stepPhase: 12,
  stepW: 13,
  pitch: 14,
  pitchVel: 15,
  roll: 16,
  rollVel: 17,
  bank: 18,
  neckLag: 19,
  accFastX: 20,
  accFastZ: 21,
  accSlowX: 22,
  accSlowZ: 23,
  /** Velocidade do quadro anterior em m/s, como veio do ActorBuffer (float32: parado ou constante, a aceleração dá 0 exato). */
  velX: 24,
  velZ: 25,
  squash: 26,
  squashVel: 27,
  airTime: 28,
  prevSpeed: 29,
  peakSpeed: 30,
  /** Tempo da freada (−1 = sem freada), lado do pé da frente (±1), força. */
  brakeT: 31,
  brakeFront: 32,
  brakeAmount: 33,
  /** cos δ do último movimento (a freada só dispara vindo de frente). */
  lastFwd: 34,
  /** Atraso das pernas em relação ao yaw (rad) e o giro preguiçoso. */
  legYaw: 35,
  lazyTurning: 36,
  turnWait: 37,
  prevYaw: 38,
  blinkNext: 39,
  blinkN: 40,
  /** Tempo desde o começo do nascer (−1 = não nascendo) e do tranco do dano (−1 = sem tranco). */
  spawnT: 41,
  damageT: 42,
  /** Raiz do último quadro escrito (L1 pulado e L2 somam a diferença) e o dt acumulado nos quadros pulados. */
  lastX: 43,
  lastY: 44,
  lastZ: 45,
  pendingDt: 46,
  /** Reação do giro preguiçoso (s): constante do boneco, sorteada pelo hash do EntityId na entrada. */
  reaction: 47,
} as const;
export const ANIM_FIELDS = 48;

/** Bits de `ANIM_FIELD.flags` (bordas do quadro anterior e LOD). */
const FLAG = {
  seen: 1,
  firing: 2,
  air: 4,
  spawning: 8,
  flash: 16,
  wasL2: 32,
  armed: 64,
  /** Molas, achatamento e filtros de aceleração zerados (parado): o bloco das molas é pulado. */
  calm: 128,
} as const;

/** Nível de LOD por ator (`begin`). */
export const FIGURE_LOD = { l0: 0, l1: 1, l2: 2 } as const;

/** Opções de criação (testes e bancada); o jogo usa o padrão. */
export interface FigureRigOptions {
  /** Ganhos do motor (`FIGURE_MOTION`); `FIGURE_MOTION_STOPPED` = só a pose base (E.1). */
  readonly motion?: FigureMotionConfig;
}

const S = ANIM_FIELD;
const P = FIGURE_POSE;
const STAND = FIGURE_STANCE.stand;
const SLIDE = FIGURE_STANCE.slide;
const CROUCH = FIGURE_STANCE.crouch;
const GRIP_NONE = FIGURE_GRIP.none;
const ZOMBIE_POSTURE = figurePosture(FIGURE_STANCE.stand, FIGURE_GRIP.none, FIGURE_MODE.base, true);
const NEUTRAL = FACE_EXPRESSIONS.indexOf('neutral');
const SLEEPING = FACE_EXPRESSIONS.indexOf('sleeping');
/** Vista sem dono (câmera livre ou 3ª pessoa): `NO_SLOT` de `actors/layout.ts`. */
const NO_OWNER = 255;
const FOREARM_R = 4 * 16;
/** Braço de repouso do FutBobo (`ARM_REST`), base dos deltas da respiração e da passada nos braços livres. */
const REST_SH_Z = 0.09;
const REST_ELBOW = -0.14;
/** Idade máxima (quadros) de uma entidade não vista antes de ser esquecida. */
const MAX_AGE = 120;
/** Média de |sen| num ciclo (2/π): o quique centrado. */
const MEAN_ABS_SIN = 2 / Math.PI;
/** Defasagens da passada do FutBobo (joelho +0,3 rad, quique da corrida −0,25 rad), pelas identidades da soma. */
const COS_03 = Math.cos(0.3);
const SIN_03 = Math.sin(0.3);
const COS_025 = Math.cos(0.25);
const SIN_025 = Math.sin(0.25);
/** dt máximo de um quadro (s): uma travada longa não vira um salto das molas. */
const MAX_DT = 0.25;

// Trilhas da recarga (`reload` 0..1; estudo de anatomia §5.6).
/** Peso "na recarga": arma girada, abaixada, cabeça no pente e braço E na telha. */
const RELOAD_HOLD: readonly number[] = [0, 0, 0.15, 1, 0.85, 1, 1, 0];
/** Peso "mão no pente". */
const RELOAD_MAG: readonly number[] = [0, 0, 0.12, 1, 0.3, 1, 0.45, 0, 0.62, 1, 0.78, 1, 0.9, 0];
/** Peso "mão no cinto". */
const RELOAD_BELT: readonly number[] = [0.3, 0, 0.45, 1, 0.55, 1, 0.62, 0];
const RELOAD_KEYS = 3;
const RELOAD_ANGLES = 4;

// Fatores do `approach` (1 − e^(−taxa·dt)) por taxa, recalculados quando o dt muda (`factors`).
const K_WEIGHT = 0;
const K_GAIT = 1;
const K_SIDE = 2;
const K_AIR = 3;
const K_SPRINT = 4;
const K_FAST = 5;
const K_SLOW = 6;
const K_BANK = 7;
const K_NECK = 8;
const K_PEAK = 9;
/** O dt dos fatores guardados (NaN = nenhum). */
const K_DT = 10;
const K_SIZE = 11;
/** Taxa do pico de velocidade da freada (1/s, `character.ts:3650`). */
const PEAK_RATE = 1.2;

// Amostras de pitch da tabela (as mesmas contas do `figureGamePose`, para o recuo ler só os braços).
const SAMPLES = FIGURE_PITCH_SAMPLES.length;
const PITCH_MIN = FIGURE_PITCH_SAMPLES[0];
const PITCH_STEP = FIGURE_PITCH_SAMPLES[1] - FIGURE_PITCH_SAMPLES[0];
/** Chaves dos braços na pose (ombros E e D, cotovelos): contíguas de `shLX` a `elR`. */
const ARM_FIRST = FIGURE_POSE.shLX;
const ARM_LAST = FIGURE_POSE.elR;
/** Floats por amostra em `FigureGameTable.grip` (afim 3×4; a translação, a palma D no antebraço D, em 9..11). */
const GRIP_ROW = 12;
const GRIP_PALM = 9;

/**
 * Os ângulos dos braços da postura no `pitch` em dst[ARM_FIRST .. ARM_LAST], interpolados como no `figureGamePose`
 * (que só compõe à parte o pescoço): o recuo não paga a pose inteira de novo.
 */
function sampleArms(t: FigureGameTable, posture: number, pitch: number, dst: Float32Array): void {
  // quente:
  let u = (pitch - PITCH_MIN) / PITCH_STEP;
  u = u > 0 ? (u < SAMPLES - 1 ? u : SAMPLES - 1) : 0;
  const s = u >= SAMPLES - 1 ? SAMPLES - 2 : Math.floor(u);
  const f = u - s;
  const src = t.poses;
  const a = (posture * SAMPLES + s) * FIGURE_POSE_SIZE;
  const b = a + FIGURE_POSE_SIZE;
  for (let k = ARM_FIRST; k <= ARM_LAST; k++) {
    const va = src[a + k]!;
    dst[k] = va + (src[b + k]! - va) * f;
  }
  // fim-quente
}

/** Menor `legDrop` das duas pernas da pose em p[0 ..]: a perna que apoia. */
function legDropMin(p: Float32Array): number {
  // quente:
  const l = legDrop(p[P.hipLX]!, p[P.hipLZ]!, p[P.kneeL]!);
  const r = legDrop(p[P.hipRX]!, p[P.hipRZ]!, p[P.kneeR]!);
  return l < r ? l : r;
  // fim-quente
}

/**
 * Animação de até `capacity` atores (o tamanho do `ActorBuffer`): estado por entidade numa `EntityTable(256, 48)` e
 * LOD L0–L2. Implementa `FigureRig` (`types.ts`).
 */
export function createFigureRig(capacity: number, options: FigureRigOptions = {}): FigureRig {
  const cfg = options.motion ?? FIGURE_MOTION;
  const motor = cfg.enabled;
  const cap = Math.max(1, capacity | 0);
  const entities = createEntityTable(256, ANIM_FIELDS);
  const spare = new Float32Array(ANIM_FIELDS);
  const levels = new Uint8Array(cap);
  // Rascunhos (criados uma vez).
  const pose = new Float32Array(FIGURE_POSE_SIZE);
  const poseB = new Float32Array(FIGURE_POSE_SIZE);
  const poseC = new Float32Array(FIGURE_POSE_SIZE);
  const root = new Float32Array(16);
  root[15] = 1;
  const weaponM = new Float32Array(16);
  // Faixa do ângulo da moldura da mira por postura (rad), a mesma da montagem da tabela (`armedArms`): mirando,
  // clamp(pitch dos braços; `FIGURE_ARM_PITCH` do stance); correndo, o `sprintTilt` fixo (mínimo = máximo).
  const aimLo = new Float64Array(FIGURE_POSTURES);
  const aimHi = new Float64Array(FIGURE_POSTURES);
  for (let p = 0; p < FIGURE_POSTURES; p++) {
    const grip = FIGURE_POSTURE_INFO[p * 3 + 1]!;
    if (grip === GRIP_NONE) continue;
    const def = FIGURE_GRIP_DEFS[grip - 1]!;
    const stance = FIGURE_POSTURE_INFO[p * 3]!;
    const range =
      stance === STAND ? FIGURE_ARM_PITCH.stand : stance === CROUCH ? FIGURE_ARM_PITCH.crouch : FIGURE_ARM_PITCH.slide;
    const sprint = FIGURE_POSTURE_INFO[p * 3 + 2]! === FIGURE_MODE.sprint;
    aimLo[p] = sprint ? def.sprintTilt : range[0];
    aimHi[p] = sprint ? def.sprintTilt : range[1];
  }
  // Dois jogos de fatores: o dt do quadro (L0) e o dt acumulado dos atores em L1 (2 quadros), sem recalcular a cada troca.
  const kFrame = new Float64Array(K_SIZE);
  const kOther = new Float64Array(K_SIZE);
  kFrame[K_DT] = NaN;
  kOther[K_DT] = NaN;
  // Doubles mutáveis do rig (num typed array: escrever double numa variável do closure aloca um número).
  const F64 = new Float64Array(8);
  const DT = 0;
  const NEAR2 = 1;
  const HAIR = 2;
  const SHIFT_X = 3;
  const SHIFT_Y = 4;
  const SHIFT_Z = 5;
  /** dt do quadro do ator (`animate`, `factors`) e o giro extra das pernas (`compensateTorso`). */
  const ADT = 6;
  const EXTRA = 7;
  F64[NEAR2] = 20 * 20;
  F64[HAIR] = Infinity;
  let table: FigureGameTable | null = null;
  let halfRate = true;
  let frame = 0;
  let lastResult: FigurePoseResult = FIGURE_POSE_RESULT.hidden;
  let lastArmed = false;
  let expression = 0;
  let l0 = 0;
  let l1 = 0;
  let l2 = 0;
  const stats = { l0: 0, l1: 0, l2: 0 };
  const statsView: FigureLodStats = stats;

  const springOmega2 = cfg.springOmega * cfg.springOmega;
  const springDamp = 2 * cfg.springZeta * cfg.springOmega;
  const squashOmega2 = cfg.squashOmega * cfg.squashOmega;
  const squashDamp = 2 * cfg.squashZeta * cfg.squashOmega;
  const springStep = cfg.springStepS;
  const pitchMax = cfg.pitchMax;
  const rollMax = cfg.rollMax;
  const squashMin = cfg.squashMin;
  const squashMax = cfg.squashMax;
  const U = FIGURE_U_PER_M;

  /**
   * Tronco com o quadril girado de `e` a mais: troca torsoX/Y/Z por R' = Ry(−e)·Rx·Ry·Rz (Euler XYZ do three), para o
   * tronco (e com ele cabeça, braços e arma) ficar onde estava no mundo. Composição exata (com o tronco inclinado, somar
   * −e ao `torsoY` não basta). O ângulo vem em F64[EXTRA] (double num typed array: sem caixa na chamada).
   */
  function compensateTorso(p: Float32Array): void {
    // quente:
    const e = F64[EXTRA]!;
    const x = p[P.torsoX]!;
    const y = p[P.torsoY]!;
    const z = p[P.torsoZ]!;
    const cx = Math.cos(x);
    const sx = Math.sin(x);
    const cy = Math.cos(y);
    const sy = Math.sin(y);
    const cz = Math.cos(z);
    const sz = Math.sin(z);
    const ch = Math.cos(e);
    const sh = Math.sin(e);
    const r00 = cy * cz;
    const r01 = -cy * sz;
    const r02 = sy;
    const r11 = cx * cz - sx * sy * sz;
    const r12 = -sx * cy;
    const r20 = sx * sz - cx * sy * cz;
    const r21 = sx * cz + cx * sy * sz;
    const r22 = cx * cy;
    // Linhas de Ry(−e)·R: l0 = ch·r0 − sh·r2; l1 = r1; l2 = sh·r0 + ch·r2.
    const m02 = ch * r02 - sh * r22;
    const ny = Math.asin(m02 < -1 ? -1 : m02 > 1 ? 1 : m02);
    if (m02 < 0.9999999 && m02 > -0.9999999) {
      p[P.torsoX] = Math.atan2(-r12, sh * r02 + ch * r22);
      p[P.torsoZ] = Math.atan2(-(ch * r01 - sh * r21), ch * r00 - sh * r20);
    } else {
      p[P.torsoX] = Math.atan2(sh * r01 + ch * r21, r11);
      p[P.torsoZ] = 0;
    }
    p[P.torsoY] = ny;
    // fim-quente
  }

  /**
   * Fatores do `approach` para o dt em F64[ADT]: o jogo guardado com esse dt, ou o recalculado no jogo do dt do
   * quadro (o de `begin`) ou no outro.
   */
  function factors(): Float64Array {
    // quente:
    const dt = F64[ADT]!;
    if (kFrame[K_DT] === dt) return kFrame;
    if (kOther[K_DT] === dt) return kOther;
    const K = dt === F64[DT] ? kFrame : kOther;
    K[K_DT] = dt;
    K[K_WEIGHT] = 1 - Math.exp(-cfg.weightRate * dt);
    K[K_GAIT] = 1 - Math.exp(-cfg.gaitRate * dt);
    K[K_SIDE] = 1 - Math.exp(-cfg.sideRate * dt);
    K[K_AIR] = 1 - Math.exp(-cfg.airRate * dt);
    K[K_SPRINT] = 1 - Math.exp(-cfg.sprintRate * dt);
    K[K_FAST] = 1 - Math.exp(-cfg.accelFastRate * dt);
    K[K_SLOW] = 1 - Math.exp(-cfg.accelSlowRate * dt);
    K[K_BANK] = 1 - Math.exp(-cfg.bankRate * dt);
    K[K_NECK] = 1 - Math.exp(-cfg.neckLagRate * dt);
    K[K_PEAK] = 1 - Math.exp(-PEAK_RATE * dt);
    return K;
    // fim-quente
  }

  /** Expressão com a piscada, sem avançar o estado. */
  function blinkExpression(e: number, st: Float32Array, s0: number, mannequin: boolean): number {
    // quente:
    if (mannequin || e !== NEUTRAL) return e;
    const clock = st[s0 + S.clock]!;
    const next = st[s0 + S.blinkNext]!;
    return clock >= next && clock < next + cfg.blinkS ? SLEEPING : e;
    // fim-quente
  }

  /** Teto do cabelo: raiz + escala·mix(em pé; baixo; peso de agachar ou deslizar). */
  function hairCeiling(y: number, scale: number, st: Float32Array, s0: number): number {
    // quente:
    const w = st[s0 + S.postureW]!;
    const lowPrev = FIGURE_POSTURE_INFO[st[s0 + S.posturePrev]! * 3]! !== STAND ? 1 : 0;
    const lowCur = FIGURE_POSTURE_INFO[st[s0 + S.postureCur]! * 3]! !== STAND ? 1 : 0;
    const low = lowPrev + (lowCur - lowPrev) * w;
    return y + scale * (cfg.hairCeilingStand + (cfg.hairCeilingLow - cfg.hairCeilingStand) * low);
    // fim-quente
  }

  /**
   * Quadro cheio do ator i (dt em F64[ADT]): estado em st[s0 ..], 12 ossos em out[o ..], arma em `weaponM`. Devolve se
   * está armado.
   */
  function animate(
    actors: ActorBuffer,
    i: number,
    out: Float32Array,
    o: number,
    st: Float32Array,
    s0: number,
    key: number,
    mannequin: boolean,
    tbl: FigureGameTable,
  ): boolean {
    // quente:
    const dt = F64[ADT]!;
    const position = actors.position;
    const px = position[i * 3]!;
    const py = position[i * 3 + 1]!;
    const pz = position[i * 3 + 2]!;
    const yaw = actors.yaw[i]!;
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);
    const sc = actors.scale[i]!;
    const scale = sc > 0 ? sc : 1;
    const bits = actors.pose[i]!;
    let flags = st[s0 + S.flags]!;
    const clock = st[s0 + S.clock]! + dt;
    st[s0 + S.clock] = clock;

    // 1. Postura e pitch.
    let posture = actors.posture[i]!;
    if (posture >= FIGURE_POSTURES) posture = 0;
    let pitch = mannequin ? 0 : actors.pitch[i]!;
    if (!(pitch === pitch)) pitch = 0;

    // 2. Pose base: a postura anterior e a atual misturadas em `postureBlendS`. Troca no meio da mistura: fica a
    // metade mais pesada (o salto é o menor dos dois).
    const cur0 = st[s0 + S.postureCur]!;
    const prev0 = st[s0 + S.posturePrev]!;
    const w0 = st[s0 + S.postureW]!;
    let cur = cur0;
    let prev = prev0;
    let w = w0;
    if (mannequin) {
      cur = posture;
      prev = posture;
      w = 1;
    } else if (posture !== cur) {
      if (w >= 0.5) {
        prev = cur;
        w = 0;
      }
      cur = posture;
    }
    if (w < 1) {
      w = cfg.postureBlendS > 0 ? w + dt / cfg.postureBlendS : 1;
      if (w > 1) w = 1;
    }
    if (cur !== cur0 || prev !== prev0 || w !== w0) {
      st[s0 + S.postureCur] = cur;
      st[s0 + S.posturePrev] = prev;
      st[s0 + S.postureW] = w;
    }
    const stanceCur = FIGURE_POSTURE_INFO[cur * 3]!;
    const gripCur = FIGURE_POSTURE_INFO[cur * 3 + 1]!;
    figureGamePose(tbl, cur, pitch, pose, 0);
    const blending = w < 1;
    // Pesos dos estados da mistura (sem mistura: 0 ou 1 da postura atual).
    let lowW = stanceCur !== STAND ? 1 : 0;
    let slideW = stanceCur === SLIDE ? 1 : 0;
    let crouchW = stanceCur === CROUCH ? 1 : 0;
    let zombieW = cur === ZOMBIE_POSTURE ? 1 : 0;
    let freeW = gripCur === GRIP_NONE && cur !== ZOMBIE_POSTURE ? 1 : 0;
    if (blending) {
      const stancePrev = FIGURE_POSTURE_INFO[prev * 3]!;
      figureGamePose(tbl, prev, pitch, poseB, 0);
      const planted = stanceCur !== SLIDE && stancePrev !== SLIDE;
      const dropMix = planted ? (1 - w) * legDropMin(poseB) + w * legDropMin(pose) : 0;
      for (let k = 0; k < FIGURE_POSE_SIZE; k++) {
        const a = poseB[k]!;
        pose[k] = a + (pose[k]! - a) * w;
      }
      if (planted) pose[P.bodyY] = pose[P.bodyY]! + dropMix - legDropMin(pose);
      const v = 1 - w;
      lowW = (stancePrev !== STAND ? v : 0) + lowW * w;
      slideW = (stancePrev === SLIDE ? v : 0) + slideW * w;
      crouchW = (stancePrev === CROUCH ? v : 0) + crouchW * w;
      zombieW = (prev === ZOMBIE_POSTURE ? v : 0) + zombieW * w;
      freeW = (FIGURE_POSTURE_INFO[prev * 3 + 1]! === GRIP_NONE && prev !== ZOMBIE_POSTURE ? v : 0) + freeW * w;
    }
    const armed = actors.weapon[i]! !== NO_MODEL && gripCur !== GRIP_NONE && cur !== ZOMBIE_POSTURE;

    let squash = 0;
    let fall = 0;
    let armPitch = pitch;
    let reloadHold = 0;
    const rc = actors.recoil[i]!;
    const recoil = rc > 0 ? (rc < 1 ? rc : 1) : 0;

    if (motor && mannequin) {
      // Manequim: respiração congelada (t = 0,5 + 0,37·índice), sem molas nem passada nem pé plano (as pernas não
      // mudam no X).
      const t = 0.5 + 0.37 * i;
      const b = Math.sin(t * 2.3);
      const s7 = Math.sin(t * 0.7);
      pose[P.bodyY] = pose[P.bodyY]! + 0.12 * b;
      pose[P.torsoX] = pose[P.torsoX]! + 0.02 * b;
      pose[P.bodyRotZ] = pose[P.bodyRotZ]! + 0.025 * s7;
      pose[P.torsoZ] = pose[P.torsoZ]! - cfg.breathUpright * 0.025 * s7;
      pose[P.hipLZ] = pose[P.hipLZ]! + 0.03 * s7;
      pose[P.hipRZ] = pose[P.hipRZ]! + 0.03 * s7;
      if (freeW > 0) {
        const s9 = Math.sin(t * 0.9);
        pose[P.shLZ] = pose[P.shLZ]! + freeW * (0.08 + 0.02 * b - REST_SH_Z);
        pose[P.shRZ] = pose[P.shRZ]! - freeW * (0.08 + 0.02 * b - REST_SH_Z);
        pose[P.shLX] = pose[P.shLX]! + freeW * 0.04 * s9;
        pose[P.shRX] = pose[P.shRX]! - freeW * 0.04 * s9;
        pose[P.elL] = pose[P.elL]! + freeW * (-0.12 - REST_ELBOW);
        pose[P.elR] = pose[P.elR]! + freeW * (-0.12 - REST_ELBOW);
      }
    } else if (motor) {
      const K = factors();
      // Pé plano da base (a tabela já traz o tornozelo plano): o motor só corrige o que ele mesmo mudar na canela.
      const shinBL = pose[P.bodyRotX]! + pose[P.hipLX]! + pose[P.kneeL]!;
      const shinBR = pose[P.bodyRotX]! + pose[P.hipRX]! + pose[P.kneeR]!;
      const dropBase = crouchW > 0 ? legDropMin(pose) : 0;
      const vel = actors.velocity;
      const sy = sinYaw;
      const cy = cosYaw;
      const mx = vel[i * 3]!;
      const mz = vel[i * 3 + 2]!;
      const wx = mx * U;
      const wz = mz * U;
      // Frente do BF = (−sen yaw, −cos yaw); direita = (cos yaw, −sen yaw).
      const vF = -wx * sy - wz * cy;
      const vS = wx * cy - wz * sy;
      const speed = Math.sqrt(wx * wx + wz * wz);
      const sliding = stanceCur === SLIDE;
      const airborne = (bits & ACTOR_POSE.airborne) !== 0 && !sliding;
      const sprintBit = (bits & ACTOR_POSE.sprint) !== 0;
      const still = sliding || airborne;
      /** As pernas mudaram no X (o pé plano precisa refazer a conta). */
      let legsMoved = false;

      // 3. Pesos, velocidade suavizada e fases (`approach` com os fatores do dt). Os pesos de alvo 0 ou 1 encostam no
      // alvo a 1e−5 (invisível) e param: um peso assentado não custa conta nem escrita.
      const kw = K[K_WEIGHT]!;
      let v0 = st[s0 + S.airW]!;
      let target = airborne ? 1 : 0;
      let airW = v0;
      if (v0 !== target) {
        airW = v0 + (target - v0) * K[K_AIR]!;
        if (airW - target < 1e-5 && target - airW < 1e-5) airW = target;
        st[s0 + S.airW] = airW;
      }
      v0 = st[s0 + S.runW]!;
      target = still ? 0 : speed < 25 ? speed / 25 : 1;
      let runW = v0;
      if (v0 !== target) {
        runW = v0 + (target - v0) * kw;
        if (runW - target < 1e-5 && target - runW < 1e-5) runW = target;
        st[s0 + S.runW] = runW;
      }
      v0 = st[s0 + S.sprintW]!;
      target = sprintBit ? 1 : 0;
      let sprintW = v0;
      if (v0 !== target) {
        sprintW = v0 + (target - v0) * K[K_SPRINT]!;
        if (sprintW - target < 1e-5 && target - sprintW < 1e-5) sprintW = target;
        st[s0 + S.sprintW] = sprintW;
      }
      // A velocidade suavizada encosta no alvo a 1e−3 u/s (5e−5 m/s) e para: andando reto e constante não custa conta.
      v0 = st[s0 + S.gait]!;
      target = still ? 0 : vF;
      let gait = v0;
      if (v0 !== target) {
        gait = v0 + (target - v0) * K[K_GAIT]!;
        if (gait - target < 1e-3 && target - gait < 1e-3) gait = target;
        st[s0 + S.gait] = gait;
      }
      v0 = st[s0 + S.side]!;
      target = still ? 0 : vS;
      let side = v0;
      if (v0 !== target) {
        side = v0 + (target - v0) * K[K_SIDE]!;
        if (side - target < 1e-3 && target - side < 1e-3) side = target;
        st[s0 + S.side] = side;
      }
      const aF = gait < 0 ? -gait : gait;
      const aS = side < 0 ? -side : side;
      // Fase guiada pela distância (o pé fica plantado): `cycle(v)` u por ciclo, para trás andando de ré.
      let cycle = 22 + 0.26 * aF;
      cycle = cycle < 26 ? 26 : cycle > 95 ? 95 : cycle;
      let runPhase = st[s0 + S.runPhase]!;
      if (aF > 0.5) {
        const rate = aF / cycle < 4.4 ? aF / cycle : 4.4;
        runPhase = wrapPhase(runPhase + (gait < 0 ? -TAU : TAU) * rate * dt);
        st[s0 + S.runPhase] = runPhase;
      }
      let shufflePhase = st[s0 + S.shufflePhase]!;
      if (aS > 0) {
        shufflePhase = wrapPhase(shufflePhase + (TAU * aS * dt) / 16);
        st[s0 + S.shufflePhase] = shufflePhase;
      }

      // Giro preguiçoso: a raiz é o yaw da sim; as pernas ficam no mundo até o limite e voltam com o passinho de giro
      // depois da reação do boneco (`character.ts:3221-3250`).
      const yawPrev = st[s0 + S.prevYaw]!;
      const dYaw = yaw === yawPrev ? 0 : wrapPi(yaw - yawPrev);
      st[s0 + S.prevYaw] = yaw;
      const legYawOld = st[s0 + S.legYaw]!;
      let legYaw = legYawOld - dYaw;
      const lazy = speed < 20 && !still;
      let stepT = 0;
      if (lazy) {
        let lazyTurning = st[s0 + S.lazyTurning]!;
        const absLeg = legYaw < 0 ? -legYaw : legYaw;
        if (lazyTurning === 0) {
          if (absLeg > cfg.lazyStart) {
            const turnWait = st[s0 + S.turnWait]! - dt;
            st[s0 + S.turnWait] = turnWait;
            if (turnWait <= 0) lazyTurning = 1;
          } else st[s0 + S.turnWait] = st[s0 + S.reaction]!;
        }
        if (lazyTurning !== 0) {
          const max = cfg.lazyTurnRate * dt;
          const step = absLeg < max ? absLeg : max;
          legYaw -= legYaw < 0 ? -step : step;
          if ((legYaw < 0 ? -legYaw : legYaw) < cfg.lazyStop) lazyTurning = 0;
        }
        st[s0 + S.lazyTurning] = lazyTurning;
      } else {
        // Andando, as pernas vão com o corpo (taxa de corrida do FutBobo, 10 rad/s).
        st[s0 + S.lazyTurning] = 0;
        st[s0 + S.turnWait] = st[s0 + S.reaction]!;
        if (legYaw !== 0) {
          const absLeg = legYaw < 0 ? -legYaw : legYaw;
          const max = 10 * dt;
          const step = absLeg < max ? absLeg : max;
          legYaw -= legYaw < 0 ? -step : step;
        }
      }
      const lazyMax = cfg.lazyYawMax;
      legYaw = legYaw < -lazyMax ? -lazyMax : legYaw > lazyMax ? lazyMax : legYaw;
      st[s0 + S.legYaw] = legYaw;
      if (lazy && dt > 0) {
        const turn = dYaw + legYaw - legYawOld;
        stepT = (turn < 0 ? -turn : turn) > 0.6 * dt ? 1 : 0;
      }
      v0 = st[s0 + S.stepW]!;
      let stepW = v0;
      if (v0 !== stepT) {
        stepW = v0 + (stepT - v0) * kw;
        if (stepW - stepT < 1e-5 && stepT - stepW < 1e-5) stepW = stepT;
        st[s0 + S.stepW] = stepW;
      }
      let stepPhase = st[s0 + S.stepPhase]!;
      if (stepT > 0 || stepW > 0.05) {
        stepPhase = wrapPhase(stepPhase + TAU * cfg.stepHz * dt);
        st[s0 + S.stepPhase] = stepPhase;
      }

      // Camadas de pernas e quique: passada (frente/trás), passinho (lado), passinho de giro e pulo.
      const fShare = (gait * gait) / (gait * gait + side * side + 1e-6);
      const strideW = runW * fShare;
      const shuffleW = runW - strideW;
      const legScale = 1 - (1 - cfg.crouchStride) * crouchW - (1 - cfg.zombieStride) * zombieW;
      if (strideW > 1e-4) {
        // `locomotion` do FutBobo (`character.ts:3565-3607`) com a fase própria; o sprint vem do bit.
        legsMoved = true;
        const sinP = Math.sin(runPhase);
        const cosP = Math.cos(runPhase);
        let g = (aF - 55) / 70;
        g = g <= 0 ? 0 : g >= 1 ? 1 : g * g * (3 - 2 * g);
        let d = (aF - 80) / 120;
        d = d <= 0 ? 0 : d >= 1 ? 1 : d * d * (3 - 2 * d);
        const reach = (cycle * (0.85 - 0.25 * d)) / 51.85;
        let amp = Math.asin(reach < 1 ? reach : 1);
        amp = (amp < 0.3 ? 0.3 : amp > 0.95 ? 0.95 : amp) + 0.08 * sprintW;
        const wl = strideW * legScale;
        pose[P.hipLX] = pose[P.hipLX]! + wl * (-amp * sinP - 0.06 * g);
        pose[P.hipRX] = pose[P.hipRX]! + wl * (amp * sinP - 0.06 * g);
        const c3 = cosP * COS_03 - sinP * SIN_03;
        const swingL = c3 > 0 ? c3 : 0;
        const swingR = c3 < 0 ? -c3 : 0;
        const kneeBase = 0.12 + 0.13 * g;
        const kneeAmp = 0.55 + 0.75 * g + 0.35 * sprintW;
        pose[P.kneeL] = pose[P.kneeL]! + wl * (kneeBase + kneeAmp * swingL + 0.22 * g * swingR);
        pose[P.kneeR] = pose[P.kneeR]! + wl * (kneeBase + kneeAmp * swingR + 0.22 * g * swingL);
        // Quique do FutBobo com a média tirada (|sen| tem média 2/π): a amplitude fica, a cabeça não afunda em média.
        const walkBob = 0.38 * ((cosP < 0 ? -cosP : cosP) - MEAN_ABS_SIN);
        const sr = sinP * COS_025 - cosP * SIN_025;
        const runBob = 1.05 * ((sr < 0 ? -sr : sr) - MEAN_ABS_SIN);
        pose[P.bodyY] =
          pose[P.bodyY]! +
          strideW * (cfg.strideBob * (walkBob + (runBob - walkBob) * g) - cfg.strideSink * 0.5 * sprintW);
        // Agachado e no zumbi (tronco inclinado) o balanço e a torção levariam a cabeça de lado: só as pernas andam.
        const upright = 1 - crouchW - zombieW;
        pose[P.bodyRotZ] = pose[P.bodyRotZ]! + strideW * upright * 0.035 * sinP * (1 - g);
        if (freeW > 0) {
          const k = strideW * freeW;
          const armAmp = (0.32 + 0.55 * g) * (amp / 0.9) + 0.12 * sprintW;
          pose[P.shLX] = pose[P.shLX]! + k * armAmp * sinP;
          pose[P.shRX] = pose[P.shRX]! - k * armAmp * sinP;
          const negS = sinP < 0 ? -sinP : 0;
          const posS = sinP > 0 ? sinP : 0;
          pose[P.shLZ] = pose[P.shLZ]! + k * (0.1 + 0.04 * g - 0.08 * g * negS - REST_SH_Z);
          pose[P.shRZ] = pose[P.shRZ]! - k * (0.1 + 0.04 * g - 0.08 * g * posS - REST_SH_Z);
          const elbow = -0.22 - 0.85 * g - 0.3 * sprintW;
          pose[P.elL] = pose[P.elL]! + k * (elbow - 0.3 * g * negS - REST_ELBOW);
          pose[P.elR] = pose[P.elR]! + k * (elbow - 0.3 * g * posS - REST_ELBOW);
        }
        const twist = (0.4 + 0.6 * g) * strideW * upright * cfg.strideTwist;
        const hy = -0.1 * sinP * twist;
        const ty = 0.17 * sinP * twist;
        pose[P.hipsY] = pose[P.hipsY]! + hy;
        pose[P.torsoY] = pose[P.torsoY]! + ty;
        pose[P.neckY] = pose[P.neckY]! - 0.5 * (hy + ty);
        const lean = strideW * cfg.strideLean * (0.05 + 0.13 * g + 0.26 * sprintW);
        pose[P.torsoX] = pose[P.torsoX]! + lean;
        pose[P.neckX] = pose[P.neckX]! - 0.6 * lean;
        if (zombieW > 0) pose[P.neckZ] = pose[P.neckZ]! + zombieW * strideW * cfg.zombieNeckZ * sinP;
      }
      if (shuffleW > 1e-4) {
        // Passinho do goleiro (`character.ts:3544-3561`): o quadril abre e fecha guiado pela distância de lado.
        const amount = aS < 90 ? aS / 90 : 1;
        const open = Math.cos(shufflePhase) * amount;
        const k = shuffleW * legScale * (cfg.shuffleWidth + cfg.shuffleHipZ * open);
        pose[P.hipLZ] = pose[P.hipLZ]! + k;
        pose[P.hipRZ] = pose[P.hipRZ]! - k;
        const ss = Math.sin(shufflePhase);
        pose[P.bodyY] = pose[P.bodyY]! + shuffleW * cfg.shuffleBob * ((ss < 0 ? -ss : ss) - MEAN_ABS_SIN) * amount;
      }
      const stepK = stepW * (1 - runW);
      if (stepK > 1e-4) {
        // Passinho de giro no lugar.
        legsMoved = true;
        const sS = Math.sin(stepPhase);
        const k = stepK * legScale;
        pose[P.hipLX] = pose[P.hipLX]! + k * 0.32 * sS;
        pose[P.hipRX] = pose[P.hipRX]! - k * 0.32 * sS;
        pose[P.kneeL] = pose[P.kneeL]! + k * 0.35 * (sS > 0 ? sS : 0);
        pose[P.kneeR] = pose[P.kneeR]! + k * 0.35 * (sS < 0 ? -sS : 0);
        pose[P.bodyY] = pose[P.bodyY]! + stepK * 0.25 * (sS < 0 ? -sS : sS);
      }
      // Agachado, a sola que apoia fica no chão (a P4f é cócoras funda: o ângulo mexe muito o pé).
      if (crouchW > 0 && (strideW > 1e-4 || stepK > 1e-4)) {
        pose[P.bodyY] = pose[P.bodyY]! + crouchW * (dropBase - legDropMin(pose));
      }
      const tuck = airW * (1 - lowW);
      if (tuck > 1e-4) {
        legsMoved = true;
        pose[P.hipLX] = pose[P.hipLX]! - 0.55 * tuck;
        pose[P.kneeL] = pose[P.kneeL]! + 1.1 * tuck;
        pose[P.hipRX] = pose[P.hipRX]! - 0.2 * tuck;
        pose[P.kneeR] = pose[P.kneeR]! + 0.6 * tuck;
      }
      // Respiração parado (`character.ts:3367-3380`), como delta sobre o repouso da tabela. Na recarga ela some com o
      // peso "na recarga": a cabeça olhando o pente já gasta ~0,66 px do envelope, e a respiração em fase somava até
      // ~0,6 px por cima (1,27 px em regime com o `reloadNeckX` 0,17; o E.2 pede ≤ 1).
      const reload = actors.reload[i]!;
      const reloading = armed && reload > 0 && reload < 1;
      if (reloading) reloadHold = sampleTrack(RELOAD_HOLD, reload);
      const idleW = (1 - runW) * (1 - airW) * (1 - slideW) * (1 - reloadHold);
      if (idleW > 1e-4) {
        const t = clock;
        const b = Math.sin(t * 2.3);
        const s7 = idleW * Math.sin(t * 0.7);
        pose[P.bodyY] = pose[P.bodyY]! + idleW * 0.12 * b;
        pose[P.torsoX] = pose[P.torsoX]! + idleW * 0.02 * b;
        pose[P.bodyRotZ] = pose[P.bodyRotZ]! + 0.025 * s7;
        pose[P.torsoZ] = pose[P.torsoZ]! - cfg.breathUpright * 0.025 * s7;
        pose[P.hipLZ] = pose[P.hipLZ]! + 0.03 * s7;
        pose[P.hipRZ] = pose[P.hipRZ]! + 0.03 * s7;
        if (freeW > 0) {
          const k = idleW * freeW;
          const s9 = Math.sin(t * 0.9);
          pose[P.shLZ] = pose[P.shLZ]! + k * (0.08 + 0.02 * b - REST_SH_Z);
          pose[P.shRZ] = pose[P.shRZ]! - k * (0.08 + 0.02 * b - REST_SH_Z);
          pose[P.shLX] = pose[P.shLX]! + k * 0.04 * s9;
          pose[P.shRX] = pose[P.shRX]! - k * 0.04 * s9;
          pose[P.elL] = pose[P.elL]! + k * (-0.12 - REST_ELBOW);
          pose[P.elR] = pose[P.elR]! + k * (-0.12 - REST_ELBOW);
        }
      }

      // 4. Eventos (bordas), molas, freada, achatamento, dano e nascer.
      // Com FLAG.calm as molas estão zeradas na tabela: nem lê.
      let pitchVel = 0;
      let rollVel = 0;
      let squashVel = 0;
      let pitchS = 0;
      let rollS = 0;
      let bank = 0;
      let neckLag = 0;
      if ((flags & FLAG.calm) === 0) {
        pitchVel = st[s0 + S.pitchVel]!;
        rollVel = st[s0 + S.rollVel]!;
        squashVel = st[s0 + S.squashVel]!;
        pitchS = st[s0 + S.pitch]!;
        rollS = st[s0 + S.roll]!;
        squash = st[s0 + S.squash]!;
        bank = st[s0 + S.bank]!;
        neckLag = st[s0 + S.neckLag]!;
      }
      let spawnT = st[s0 + S.spawnT]!;
      const spawning = (bits & ACTOR_POSE.spawning) !== 0;
      if (spawning && (flags & FLAG.spawning) === 0) {
        // Nasceu: as molas começam paradas.
        spawnT = 0;
        pitchS = 0;
        pitchVel = 0;
        rollS = 0;
        rollVel = 0;
        bank = 0;
        neckLag = 0;
        squash = 0;
        squashVel = 0;
        st[s0 + S.brakeT] = -1;
        st[s0 + S.damageT] = -1;
        st[s0 + S.legYaw] = 0;
      }
      if (spawnT >= 0) {
        spawnT += dt;
        if (spawnT >= cfg.spawnS) {
          spawnT = -1;
          squashVel -= cfg.landKick * cfg.spawnLand;
        } else {
          const f = 1 - spawnT / cfg.spawnS;
          fall = f * f;
        }
        st[s0 + S.spawnT] = spawnT;
      }
      if (airborne) {
        if ((flags & FLAG.air) === 0) squashVel += cfg.takeoffKick;
        st[s0 + S.airTime] = st[s0 + S.airTime]! + dt;
      } else if ((flags & FLAG.air) !== 0) {
        const air = st[s0 + S.airTime]! / cfg.landAirS;
        const s = air < 1 ? air : 1;
        squashVel -= cfg.landKick * s;
        pitchVel += cfg.landPitchKick * s;
        st[s0 + S.airTime] = 0;
      }
      const firing = (bits & ACTOR_POSE.firing) !== 0;
      if (firing && (flags & FLAG.firing) === 0 && armed) pitchVel -= cfg.recoilPitchKick;
      const flashAbove = actors.damageFlash[i]! > cfg.damageThreshold;
      // Inclinação do tronco das camadas (tranco, freada e mola), somada e presa a ±`pitchMax` no fim.
      let torsoPitch = 0;
      let damageT = st[s0 + S.damageT]!;
      if (flashAbove && (flags & FLAG.flash) === 0) {
        pitchVel -= cfg.damagePitchKick;
        rollVel += (hash01(key, Math.floor(clock * 64) + 7) < 0.5 ? -1 : 1) * cfg.damageRollKick;
        damageT = 0;
      }
      if (damageT >= 0) {
        damageT += dt;
        if (damageT >= cfg.damageS) damageT = -1;
        else {
          // Tranco: sobe em 20% do tempo e volta suave.
          const tk = damageT / cfg.damageS;
          let k = (tk - 0.2) / 0.8;
          k = tk < 0.2 ? tk / 0.2 : 1 - (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
          torsoPitch += cfg.damageTorsoX * k;
          pose[P.neckX] = pose[P.neckX]! + cfg.damageNeckX * k;
          pose[P.bodyY] = pose[P.bodyY]! + cfg.damageBodyY * k;
        }
        st[s0 + S.damageT] = damageT;
      }
      flags =
        (flags & ~(FLAG.spawning | FLAG.air | FLAG.firing | FLAG.flash)) |
        (spawning ? FLAG.spawning : 0) |
        (airborne ? FLAG.air : 0) |
        (firing ? FLAG.firing : 0) |
        (flashAbove ? FLAG.flash : 0);

      // Freada (`character.ts:3646-3701`): a passada cruza para baixo de `brakeBelow` depois de um embalo de frente.
      const travel = sliding ? 0 : speed;
      const prevSpeed = st[s0 + S.prevSpeed]!;
      st[s0 + S.prevSpeed] = travel;
      let peak = st[s0 + S.peakSpeed]!;
      peak = sliding ? 0 : travel > peak ? travel : peak + (travel - peak) * K[K_PEAK]!;
      st[s0 + S.peakSpeed] = peak;
      if (speed > 6) st[s0 + S.lastFwd] = vF / speed;
      let brakeT = st[s0 + S.brakeT]!;
      if (sliding) brakeT = -1;
      else if (
        brakeT < 0 &&
        runW > 0.5 &&
        prevSpeed >= cfg.brakeBelow &&
        travel < cfg.brakeBelow &&
        peak > cfg.brakePeak &&
        st[s0 + S.lastFwd]! > 0.4
      ) {
        brakeT = 0;
        const amount = peak / 220;
        st[s0 + S.brakeAmount] = amount < 0.45 ? 0.45 : amount > 1 ? 1 : amount;
        st[s0 + S.brakeFront] = Math.sin(runPhase) > 0 ? 1 : -1;
      }
      if (brakeT >= 0) {
        if (speed > 40 && brakeT > 0.05) brakeT = -1;
        else {
          legsMoved = true;
          brakeT += dt;
          let fade = (brakeT - 0.24) / 0.16;
          fade = fade <= 0 ? 0 : fade >= 1 ? 1 : fade * fade * (3 - 2 * fade);
          const env = (brakeT < 0.06 ? brakeT / 0.06 : 1) * (1 - fade);
          const amount = st[s0 + S.brakeAmount]!;
          const wb = env * amount;
          const body = wb * cfg.brakeBody;
          pose[P.bodyY] = pose[P.bodyY]! - 1.4 * body;
          pose[P.bodyRotX] = pose[P.bodyRotX]! - 0.08 * body;
          torsoPitch -= 0.12 * body;
          // Pé da frente finca (ponta para cima), o de trás arrasta a ponta; espelhado com o pé direito à frente.
          const wl = wb * (1 - lowW);
          const left = st[s0 + S.brakeFront]! > 0;
          const fHip = left ? P.hipLX : P.hipRX;
          const fKnee = left ? P.kneeL : P.kneeR;
          const fAnkle = left ? P.ankleL : P.ankleR;
          const bHip = left ? P.hipRX : P.hipLX;
          const bKnee = left ? P.kneeR : P.kneeL;
          const bAnkle = left ? P.ankleR : P.ankleL;
          pose[fHip] = pose[fHip]! + (-0.55 - pose[fHip]!) * wl;
          pose[fKnee] = pose[fKnee]! + (0.15 - pose[fKnee]!) * wl;
          pose[fAnkle] = pose[fAnkle]! + (-0.35 - pose[fAnkle]!) * wl;
          pose[bHip] = pose[bHip]! + (0.35 - pose[bHip]!) * wl;
          pose[bKnee] = pose[bKnee]! + (0.9 - pose[bKnee]!) * wl;
          pose[bAnkle] = pose[bAnkle]! + (0.45 - pose[bAnkle]!) * wl;
          if (freeW > 0) {
            const wa = wb * freeW;
            const zs = left ? 1 : -1;
            const fX = left ? P.shLX : P.shRX;
            const fY = left ? P.shLY : P.shRY;
            const fZ = left ? P.shLZ : P.shRZ;
            const fE = left ? P.elL : P.elR;
            const bX = left ? P.shRX : P.shLX;
            const bY = left ? P.shRY : P.shLY;
            const bZ = left ? P.shRZ : P.shLZ;
            const bE = left ? P.elR : P.elL;
            pose[fX] = pose[fX]! + (-0.7 - pose[fX]!) * wa;
            pose[fY] = pose[fY]! - pose[fY]! * wa;
            pose[fZ] = pose[fZ]! + (0.6 * zs - pose[fZ]!) * wa;
            pose[fE] = pose[fE]! + (-0.5 - pose[fE]!) * wa;
            pose[bX] = pose[bX]! + (-0.4 - pose[bX]!) * wa;
            pose[bY] = pose[bY]! - pose[bY]! * wa;
            pose[bZ] = pose[bZ]! + (-0.7 * zs - pose[bZ]!) * wa;
            pose[bE] = pose[bE]! + (-0.4 - pose[bE]!) * wa;
          }
          if (brakeT >= cfg.brakeS) {
            brakeT = -1;
            // Parou: o tronco segue à frente e assenta.
            pitchVel += cfg.brakeFollow * amount;
          }
        }
      }
      st[s0 + S.brakeT] = brakeT;

      // Molas do tronco (`updateInertia`, Euler explícito em subpassos ≤ `springStepS`) e do achatamento. Paradas
      // (tudo zerado, `FLAG.calm`) e sem impulso nem aceleração neste quadro, dariam zero de novo: o bloco é pulado.
      let ax = 0;
      let az = 0;
      if (dt > 0) {
        const accel = cfg.accelClamp;
        ax = ((mx - st[s0 + S.velX]!) * U) / dt;
        az = ((mz - st[s0 + S.velZ]!) * U) / dt;
        ax = ax < -accel ? -accel : ax > accel ? accel : ax;
        az = az < -accel ? -accel : az > accel ? accel : az;
      }
      const calm =
        (flags & FLAG.calm) !== 0 &&
        dt > 0 &&
        ax === 0 &&
        az === 0 &&
        pitchVel === 0 &&
        rollVel === 0 &&
        squashVel === 0;
      if (calm) {
        // Só o que não é mola: o tranco e a freada inclinam o tronco pelo envelope.
        if (torsoPitch !== 0) {
          const tp = torsoPitch < -pitchMax ? -pitchMax : torsoPitch > pitchMax ? pitchMax : torsoPitch;
          pose[P.torsoX] = pose[P.torsoX]! + tp;
        }
      } else if (dt > 0) {
        st[s0 + S.velX] = mx;
        st[s0 + S.velZ] = mz;
        const kf = K[K_FAST]!;
        const ks = K[K_SLOW]!;
        v0 = st[s0 + S.accFastX]!;
        const fastX = v0 + (ax - v0) * kf;
        v0 = st[s0 + S.accFastZ]!;
        const fastZ = v0 + (az - v0) * kf;
        v0 = st[s0 + S.accSlowX]!;
        const slowX = v0 + (ax - v0) * ks;
        v0 = st[s0 + S.accSlowZ]!;
        const slowZ = v0 + (az - v0) * ks;
        st[s0 + S.accFastX] = fastX;
        st[s0 + S.accFastZ] = fastZ;
        st[s0 + S.accSlowX] = slowX;
        st[s0 + S.accSlowZ] = slowZ;
        const impX = fastX - slowX;
        const impZ = fastZ - slowZ;
        const forward = -impX * sy - impZ * cy;
        // O "lateral" do FutBobo é para a ESQUERDA do boneco (+x dele).
        const leftward = -(impX * cy - impZ * sy);
        let bankT = 0;
        if (!sliding) {
          const bankMax = cfg.bankMax;
          bankT = (slowX * cy - slowZ * sy) * cfg.bankGain;
          bankT = (bankT < -bankMax ? -bankMax : bankT > bankMax ? bankMax : bankT) * runW;
        }
        bank += (bankT - bank) * K[K_BANK]!;
        let pitchT = -forward * cfg.pitchGain;
        pitchT = pitchT < -pitchMax ? -pitchMax : pitchT > pitchMax ? pitchMax : pitchT;
        let rollT = leftward * cfg.rollGain;
        rollT = rollT < -rollMax ? -rollMax : rollT > rollMax ? rollMax : rollT;
        // 1 subpasso a 20 Hz ou mais (o caso comum); mais quando o dt é grande (L1, travada).
        const n = dt <= springStep ? 1 : Math.ceil(dt / springStep);
        const h = dt / n;
        for (let k = 0; k < n; k++) {
          pitchVel += (springOmega2 * (pitchT - pitchS) - springDamp * pitchVel) * h;
          pitchS += pitchVel * h;
          rollVel += (springOmega2 * (rollT - rollS) - springDamp * rollVel) * h;
          rollS += rollVel * h;
          squashVel += (-squashOmega2 * squash - squashDamp * squashVel) * h;
          squash += squashVel * h;
          squash = squash < squashMin ? squashMin : squash > squashMax ? squashMax : squash;
        }
        neckLag += (pitchS - neckLag) * K[K_NECK]!;
        // Parado e assentado (resto abaixo do que se vê: 1e−6 rad no tronco é 2e−5 px na cabeça): zera e marca.
        flags &= ~FLAG.calm;
        if (
          ax === 0 &&
          az === 0 &&
          (fastX < 0 ? -fastX : fastX) + (fastZ < 0 ? -fastZ : fastZ) < 1e-2 &&
          (slowX < 0 ? -slowX : slowX) + (slowZ < 0 ? -slowZ : slowZ) < 1e-2 &&
          (pitchS < 0 ? -pitchS : pitchS) + (pitchVel < 0 ? -pitchVel : pitchVel) < 1e-6 &&
          (rollS < 0 ? -rollS : rollS) + (rollVel < 0 ? -rollVel : rollVel) < 1e-6 &&
          (bank < 0 ? -bank : bank) + (neckLag < 0 ? -neckLag : neckLag) < 1e-6 &&
          (squash < 0 ? -squash : squash) + (squashVel < 0 ? -squashVel : squashVel) < 1e-6
        ) {
          pitchS = 0;
          pitchVel = 0;
          rollS = 0;
          rollVel = 0;
          bank = 0;
          neckLag = 0;
          squash = 0;
          squashVel = 0;
          st[s0 + S.accFastX] = 0;
          st[s0 + S.accFastZ] = 0;
          st[s0 + S.accSlowX] = 0;
          st[s0 + S.accSlowZ] = 0;
          flags |= FLAG.calm;
        }
      }
      if (!calm) {
        st[s0 + S.pitch] = pitchS;
        st[s0 + S.pitchVel] = pitchVel;
        st[s0 + S.roll] = rollS;
        st[s0 + S.rollVel] = rollVel;
        st[s0 + S.bank] = bank;
        st[s0 + S.neckLag] = neckLag;
        st[s0 + S.squash] = squash;
        st[s0 + S.squashVel] = squashVel;
        // Envelope: o que as molas põem no tronco fica no teto (o E.2 mede cabeça e tronco).
        const pitchA = pitchS < -pitchMax ? -pitchMax : pitchS > pitchMax ? pitchMax : pitchS;
        const rollA = rollS < -rollMax ? -rollMax : rollS > rollMax ? rollMax : rollS;
        const lagA = neckLag < -pitchMax ? -pitchMax : neckLag > pitchMax ? pitchMax : neckLag;
        const tp = pitchS + torsoPitch;
        pose[P.torsoX] = pose[P.torsoX]! + (tp < -pitchMax ? -pitchMax : tp > pitchMax ? pitchMax : tp);
        pose[P.torsoZ] = pose[P.torsoZ]! + rollA;
        pose[P.neckX] = pose[P.neckX]! + cfg.neckLagShare * (lagA - pitchA);
        pose[P.pivZ] = pose[P.pivZ]! + bank;
      }

      // 5. Recuo e recarga (só armado).
      if (armed && recoil > 0) {
        // Braços na amostra da arma levantada (a tabela é a mesma; a mão segue a arma).
        armPitch = pitch + cfg.recoilArmPitch * recoil;
        sampleArms(tbl, cur, armPitch, poseC);
        if (blending) {
          sampleArms(tbl, prev, armPitch, poseB);
          for (let k = ARM_FIRST; k <= ARM_LAST; k++) {
            const a = poseB[k]!;
            pose[k] = a + (poseC[k]! - a) * w;
          }
        } else for (let k = ARM_FIRST; k <= ARM_LAST; k++) pose[k] = poseC[k]!;
      }
      if (reloading) {
        pose[P.neckX] = pose[P.neckX]! + cfg.reloadNeckX * reloadHold;
        // Braço E: telha → pente → cinto pelas chaves da tabela (uma chave toda zero = não montada: fica o braço).
        const r0 = (gripCur - 1) * RELOAD_KEYS * RELOAD_ANGLES;
        const rl = tbl.reload;
        let filled = 0;
        for (let k = 0; k < RELOAD_KEYS * RELOAD_ANGLES; k++) {
          const v = rl[r0 + k]!;
          filled += v < 0 ? -v : v;
        }
        if (filled > 0) {
          const mag = sampleTrack(RELOAD_MAG, reload);
          const belt = sampleTrack(RELOAD_BELT, reload);
          for (let a = 0; a < RELOAD_ANGLES; a++) {
            const pk = a === 3 ? P.elL : P.shLX + a;
            let v = pose[pk]!;
            v += (rl[r0 + a]! - v) * reloadHold;
            v += (rl[r0 + RELOAD_ANGLES + a]! - v) * mag;
            v += (rl[r0 + 2 * RELOAD_ANGLES + a]! - v) * belt;
            pose[pk] = v;
          }
        }
      }

      // 6. Pernas atrasadas (preguiça e strafe), o tronco fecha a diferença; pé plano (só o X do tornozelo).
      let strafeYaw = 0;
      if (runW > 1e-4 && aS > 1) {
        const a = Math.atan2(aS, aF);
        const max = cfg.strafeYawMax;
        strafeYaw = (side < 0 ? 1 : -1) * (gait < 0 ? -1 : 1) * (a < max ? a : max) * runW;
      }
      let extra = legYaw + strafeYaw;
      extra = extra < -lazyMax ? -lazyMax : extra > lazyMax ? lazyMax : extra;
      if (extra > 1e-6 || extra < -1e-6) {
        pose[P.hipsY] = pose[P.hipsY]! + extra;
        F64[EXTRA] = extra;
        compensateTorso(pose);
      }
      // O pé plano refaz a conta da canela só se ela mudou (passada, giro, pulo, freada) ou se a corrida tira peso.
      if (legsMoved || runW > 1e-4) {
        const shinL = pose[P.bodyRotX]! + pose[P.hipLX]! + pose[P.kneeL]!;
        const shinR = pose[P.bodyRotX]! + pose[P.hipRX]! + pose[P.kneeR]!;
        // A base quase sempre tem a canela perto da vertical (peso 1): sem chamada.
        const flatBL = shinBL > -0.7 && shinBL < 0.7 ? shinBL : flatShin(shinBL, 0);
        const flatBR = shinBR > -0.7 && shinBR < 0.7 ? shinBR : flatShin(shinBR, 0);
        pose[P.ankleL] = pose[P.ankleL]! - (flatShin(shinL, runW) - flatBL);
        pose[P.ankleR] = pose[P.ankleR]! - (flatShin(shinR, runW) - flatBR);
      }
    }
    st[s0 + S.flags] = (flags & ~FLAG.armed) | FLAG.seen | (armed ? FLAG.armed : 0);

    // 7. Raiz (= `figureRoot`: T·Ry(yaw + π)·S(px·escala·(1 − s/2, 1 + s, 1 − s/2))) e FK direto em `out`.
    const c = -cosYaw;
    const s = -sinYaw;
    const k = FIGURE_PX_M * scale;
    const kxz = k * (1 - 0.5 * squash);
    const ky = k * (1 + squash);
    // Só as 8 entradas que mudam: os zeros e o 1 da 4ª linha estão escritos desde a criação (o FK só lê a raiz).
    root[0] = c * kxz;
    root[2] = -s * kxz;
    root[5] = ky;
    root[8] = s * kxz;
    root[10] = c * kxz;
    root[12] = px;
    root[13] = py;
    root[14] = pz;
    figureFk(pose, 0, root, 0, out, o);
    if (fall > 0) {
      // Nascer: cada osso cai de uma altura (somado no mundo, sem acumular na hierarquia).
      const drop = fall * scale;
      for (let b = 0; b < FIGURE_BONES; b++) {
        const m = o + b * 16 + 13;
        out[m] = out[m]! + drop * (cfg.spawnDropBase + cfg.spawnDropPerBone * b);
      }
    }
    st[s0 + S.lastX] = px;
    st[s0 + S.lastY] = py;
    st[s0 + S.lastZ] = pz;

    // 8. Arma (decisão 3 da §I). A tabela monta a arma na moldura da mira (eixos da raiz girados por Rx(−a)) e as mãos
    // seguem pelo IK; entre as amostras o render interpola os ângulos de Euler dos braços e o antebraço D sai dessa
    // moldura (o cano chegava a ~7° fora da mira com a arma presa ao antebraço). Por isso a ORIENTAÇÃO é a da moldura,
    // sem o antebraço, e só a ORIGEM vem do FK: antebraço D × a palma D da `grip` (a translação, interpolada como no
    // `figureGripMatrix`). Nas amostras dá a mesma matriz de antes. A arma é rígida: leva a escala do ator, não o
    // achatamento (o cano fica na mira também no pouso).
    if (armed) {
      // Ângulo da mira (a moldura da tabela) e a palma D (px, no antebraço D) da postura atual; na mistura, as duas.
      const loC = aimLo[cur]!;
      const hiC = aimHi[cur]!;
      let aim = armPitch < loC ? loC : armPitch > hiC ? hiC : armPitch;
      let u = (armPitch - PITCH_MIN) / PITCH_STEP;
      u = u > 0 ? (u < SAMPLES - 1 ? u : SAMPLES - 1) : 0;
      const sg = u >= SAMPLES - 1 ? SAMPLES - 2 : Math.floor(u);
      const fg = u - sg;
      const gs = tbl.grip;
      let g = (cur * SAMPLES + sg) * GRIP_ROW + GRIP_PALM;
      let t0 = gs[g]! + (gs[g + GRIP_ROW]! - gs[g]!) * fg;
      let t1 = gs[g + 1]! + (gs[g + 1 + GRIP_ROW]! - gs[g + 1]!) * fg;
      let t2 = gs[g + 2]! + (gs[g + 2 + GRIP_ROW]! - gs[g + 2]!) * fg;
      if (blending && FIGURE_POSTURE_INFO[prev * 3 + 1]! !== GRIP_NONE) {
        const loP = aimLo[prev]!;
        const hiP = aimHi[prev]!;
        const aimP = armPitch < loP ? loP : armPitch > hiP ? hiP : armPitch;
        aim = aimP + (aim - aimP) * w;
        g = (prev * SAMPLES + sg) * GRIP_ROW + GRIP_PALM;
        const q0 = gs[g]! + (gs[g + GRIP_ROW]! - gs[g]!) * fg;
        const q1 = gs[g + 1]! + (gs[g + 1 + GRIP_ROW]! - gs[g + 1]!) * fg;
        const q2 = gs[g + 2]! + (gs[g + 2 + GRIP_ROW]! - gs[g + 2]!) * fg;
        t0 = q0 + (t0 - q0) * w;
        t1 = q1 + (t1 - q1) * w;
        t2 = q2 + (t2 - q2) * w;
      }
      // Eixos do modelo da arma no frame do FutBobo (como a `grip` da tabela): x = −x da raiz, y = cima da mira
      // (0, cos a, −sen a), z = −frente da mira (0, −sen a, −cos a); a recarga gira x e y em volta do cano (Rz).
      const ca = Math.cos(aim);
      const sa = Math.sin(aim);
      let x0 = -1;
      let x1 = 0;
      let x2 = 0;
      let y0 = 0;
      let y1 = ca;
      let y2 = -sa;
      const rot = cfg.reloadWeaponRotZ * reloadHold;
      if (rot !== 0) {
        // Giro Z no espaço da arma: col0' = c·col0 + s·col1; col1' = c·col1 − s·col0.
        const rcos = Math.cos(rot);
        const rsin = Math.sin(rot);
        x0 = -rcos;
        x1 = rsin * ca;
        x2 = -rsin * sa;
        y0 = rsin;
        y1 = rcos * ca;
        y2 = -rcos * sa;
      }
      // Raiz (giro do yaw e a escala do ator, sem o achatamento): (x, y, z) → escala·(c·x + s·z, y, −s·x + c·z).
      weaponM[0] = scale * (c * x0 + s * x2);
      weaponM[1] = scale * x1;
      weaponM[2] = scale * (c * x2 - s * x0);
      weaponM[3] = 0;
      weaponM[4] = scale * (c * y0 + s * y2);
      weaponM[5] = scale * y1;
      weaponM[6] = scale * (c * y2 - s * y0);
      weaponM[7] = 0;
      weaponM[8] = -scale * s * ca;
      weaponM[9] = -scale * sa;
      weaponM[10] = -scale * c * ca;
      weaponM[11] = 0;
      // Origem: o antebraço D (metros por px, com o achatamento) na palma D.
      const f = o + FOREARM_R;
      let wxp = out[f]! * t0 + out[f + 4]! * t1 + out[f + 8]! * t2 + out[f + 12]!;
      let wyp = out[f + 1]! * t0 + out[f + 5]! * t1 + out[f + 9]! * t2 + out[f + 13]!;
      let wzp = out[f + 2]! * t0 + out[f + 6]! * t1 + out[f + 10]! * t2 + out[f + 14]!;
      if (motor && !mannequin && recoil > 0) {
        // Recuo: a arma volta ao longo da mira (frente do BF com o pitch). O manequim fica parado (braços sem recuo).
        const back = cfg.recoilBackPx * recoil * FIGURE_PX_M * scale;
        const cp = Math.cos(pitch);
        wxp += back * sinYaw * cp;
        wyp -= back * Math.sin(pitch);
        wzp += back * cosYaw * cp;
      }
      if (reloadHold > 0) wyp -= cfg.reloadWeaponDropPx * reloadHold * FIGURE_PX_M * scale;
      weaponM[12] = wxp;
      weaponM[13] = wyp;
      weaponM[14] = wzp;
      weaponM[15] = 1;
    }

    // 9. Piscada: 0,13 s a cada 1,8 + h·3,6 s (h = hash da entidade e do número da piscada), só com a neutra.
    let e = actors.expression[i]!;
    if (!mannequin) {
      let next = st[s0 + S.blinkNext]!;
      if (clock >= next + cfg.blinkS) {
        let n = st[s0 + S.blinkN]!;
        for (let guard = 0; guard < 8 && clock >= next + cfg.blinkS; guard++) {
          n++;
          next += cfg.blinkS + cfg.blinkBaseS + cfg.blinkSpreadS * hash01(key, n + 16);
        }
        st[s0 + S.blinkNext] = next;
        st[s0 + S.blinkN] = n;
      }
      if (e === NEUTRAL && clock >= next && clock < next + cfg.blinkS) e = SLEEPING;
    }
    expression = e;
    F64[HAIR] = py + scale * (cfg.hairCeilingStand + (cfg.hairCeilingLow - cfg.hairCeilingStand) * lowW);
    return armed;
    // fim-quente
  }

  /** Estado novo da entidade (a tabela zera a entrada): postura sem mistura, sem bordas falsas no 1º quadro. */
  function initEntity(actors: ActorBuffer, i: number, st: Float32Array, s0: number, key: number): void {
    let posture = actors.posture[i]!;
    if (posture >= FIGURE_POSTURES) posture = 0;
    st[s0 + S.postureCur] = posture;
    st[s0 + S.posturePrev] = posture;
    st[s0 + S.postureW] = 1;
    st[s0 + S.brakeT] = -1;
    st[s0 + S.spawnT] = -1;
    st[s0 + S.damageT] = -1;
    st[s0 + S.reaction] = cfg.lazyReactionMin + cfg.lazyReactionSpread * hash01(key, 3);
    st[s0 + S.turnWait] = st[s0 + S.reaction]!;
    st[s0 + S.runPhase] = TAU * hash01(key, 1);
    // O relógio começa na defasagem da respiração do boneco (0..10 s): parados, não respiram juntos.
    const clock0 = 10 * hash01(key, 2);
    st[s0 + S.clock] = clock0;
    st[s0 + S.blinkNext] = clock0 + cfg.blinkFirstS + cfg.blinkFirstSpreadS * hash01(key, 0);
    resume(actors, i, st, s0);
    // Quem aparece nascendo nasce (a borda do `spawning` fica).
    st[s0 + S.flags] = st[s0 + S.flags]! & ~FLAG.spawning;
  }

  /**
   * Retomada sem memória do movimento (entidade nova, ou de volta do L2): a velocidade, o yaw e as bordas passam a ser
   * as de agora, para os filtros não verem uma aceleração falsa (tranco da mola) nem um pouso, tiro ou dano velhos.
   */
  function resume(actors: ActorBuffer, i: number, st: Float32Array, s0: number): void {
    const bits = actors.pose[i]!;
    const mx = actors.velocity[i * 3]!;
    const mz = actors.velocity[i * 3 + 2]!;
    const speed = Math.sqrt(mx * mx + mz * mz) * U;
    st[s0 + S.prevYaw] = actors.yaw[i]!;
    st[s0 + S.velX] = mx;
    st[s0 + S.velZ] = mz;
    // A freada não dispara por uma velocidade de antes do L2, nem continua uma que ficou pela metade.
    st[s0 + S.prevSpeed] = speed;
    st[s0 + S.peakSpeed] = speed;
    st[s0 + S.brakeT] = -1;
    // Os filtros guardam a aceleração de antes do L2: sem zerar, empurram a mola por ~0,3 s na volta (tranco falso).
    st[s0 + S.accFastX] = 0;
    st[s0 + S.accFastZ] = 0;
    st[s0 + S.accSlowX] = 0;
    st[s0 + S.accSlowZ] = 0;
    st[s0 + S.lastX] = actors.position[i * 3]!;
    st[s0 + S.lastY] = actors.position[i * 3 + 1]!;
    st[s0 + S.lastZ] = actors.position[i * 3 + 2]!;
    st[s0 + S.flags] =
      (st[s0 + S.flags]! & (FLAG.armed | FLAG.spawning)) |
      FLAG.seen |
      ((bits & ACTOR_POSE.airborne) !== 0 ? FLAG.air : 0) |
      ((bits & ACTOR_POSE.firing) !== 0 ? FLAG.firing : 0) |
      (actors.damageFlash[i]! > cfg.damageThreshold ? FLAG.flash : 0);
  }

  const rig: FigureRig = {
    get expression() {
      return expression;
    },
    get hairCeilingY() {
      return F64[HAIR]!;
    },
    get stats() {
      return statsView;
    },
    setTable(next) {
      if (next !== table) entities.clear();
      table = next;
    },
    setLod(nearM, half) {
      const near = Number.isFinite(nearM) && nearM > 0 ? nearM : 0;
      F64[NEAR2] = near * near;
      halfRate = half;
    },
    begin(frameCtx: FrameContext, actors: ActorBuffer, frameIndex: number) {
      // quente:
      frame = frameIndex | 0;
      const dt = frameCtx.dt;
      F64[DT] = dt > 0 ? (dt < MAX_DT ? dt : MAX_DT) : 0;
      l0 = 0;
      l1 = 0;
      l2 = 0;
      const views = frameCtx.views;
      const vc = views.count < 4 ? views.count : 4;
      const planes = views.planes;
      const eye = views.eye;
      const owners = views.owner;
      const near2 = F64[NEAR2]!;
      const count = actors.count < cap ? actors.count : cap;
      const figure = actors.figure;
      const position = actors.position;
      const scales = actors.scale;
      const slots = actors.localSlot;
      const radius = cfg.lodRadiusM;
      const lift = cfg.lodCenterM;
      for (let i = 0; i < count; i++) {
        if (figure[i] === NO_FIGURE) {
          levels[i] = FIGURE_LOD.l2;
          continue;
        }
        if (vc <= 0) {
          // Sem vistas preenchidas (testes, cena sem câmera): tudo cheio.
          levels[i] = FIGURE_LOD.l0;
          continue;
        }
        const sc = scales[i]!;
        const scale = sc > 0 ? sc : 1;
        const cx = position[i * 3]!;
        const cy = position[i * 3 + 1]! + lift * scale;
        const cz = position[i * 3 + 2]!;
        const r = -radius * scale;
        const slot = slots[i]!;
        let best = Infinity;
        for (let v = 0; v < vc; v++) {
          const owner = owners[v]!;
          // A vista em 1ª pessoa esconde o próprio corpo: não conta para ele.
          if (owner !== NO_OWNER && owner === slot) continue;
          let q = v * 24;
          let inside = true;
          for (let p = 0; p < 6; p++, q += 4) {
            if (planes[q]! * cx + planes[q + 1]! * cy + planes[q + 2]! * cz + planes[q + 3]! < r) {
              inside = false;
              break;
            }
          }
          if (!inside) continue;
          const dx = eye[v * 3]! - cx;
          const dy = eye[v * 3 + 1]! - cy;
          const dz = eye[v * 3 + 2]! - cz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < best) best = d2;
        }
        levels[i] = best === Infinity ? FIGURE_LOD.l2 : best <= near2 || !halfRate ? FIGURE_LOD.l0 : FIGURE_LOD.l1;
      }
      // fim-quente
    },
    pose(actors, i, out, o, force) {
      // quente:
      const tbl = table;
      if (tbl === null || i < 0 || i >= actors.count || actors.figure[i] === NO_FIGURE) {
        lastResult = FIGURE_POSE_RESULT.hidden;
        lastArmed = false;
        expression = i >= 0 && i < actors.count ? actors.expression[i]! : 0;
        F64[HAIR] = Infinity;
        return lastResult;
      }
      const entity = actors.entity[i]!;
      const mannequin = entity === 0;
      const key = actorKey(entity, i);
      const slot = entities.slot(key, frame);
      // A varredura pode trocar o array de estado: lido depois do `slot`.
      let st = entities.state;
      let s0 = slot * ANIM_FIELDS;
      if (slot < 0) {
        // Tabela lotada de entidades vivas: quadro sem memória (não acontece com ≤ 192 atores).
        spare.fill(0);
        st = spare;
        s0 = 0;
      }
      const flags = st[s0 + S.flags]!;
      const seen = (flags & FLAG.seen) !== 0;
      const level = i < cap ? levels[i]! : FIGURE_LOD.l0;
      const posture = actors.posture[i]!;
      const armedNow =
        actors.weapon[i]! !== NO_MODEL &&
        posture < FIGURE_POSTURES &&
        FIGURE_POSTURE_INFO[posture * 3 + 1]! !== GRIP_NONE &&
        posture !== ZOMBIE_POSTURE;
      let compute = force || !seen || level === FIGURE_LOD.l0 || ((flags & FLAG.armed) !== 0) !== armedNow;
      if (!compute && level === FIGURE_LOD.l1) compute = ((key + frame) & 1) === 0 || (flags & FLAG.wasL2) !== 0;
      if (level === FIGURE_LOD.l0) l0++;
      else if (level === FIGURE_LOD.l1) l1++;
      else l2++;

      if (!compute) {
        // L1 pulado ou L2: só o deslocamento da raiz (a pose velha anda junto).
        const position = actors.position;
        const x = position[i * 3]!;
        const y = position[i * 3 + 1]!;
        const z = position[i * 3 + 2]!;
        const dx = x - st[s0 + S.lastX]!;
        const dy = y - st[s0 + S.lastY]!;
        const dz = z - st[s0 + S.lastZ]!;
        if (dx !== 0 || dy !== 0 || dz !== 0) {
          for (let b = 0; b < FIGURE_BONES; b++) {
            const m = o + b * 16 + 12;
            out[m] = out[m]! + dx;
            out[m + 1] = out[m + 1]! + dy;
            out[m + 2] = out[m + 2]! + dz;
          }
          st[s0 + S.lastX] = x;
          st[s0 + S.lastY] = y;
          st[s0 + S.lastZ] = z;
        }
        if (level === FIGURE_LOD.l1) st[s0 + S.pendingDt] = st[s0 + S.pendingDt]! + F64[DT]!;
        else {
          // L2: molas e fases congeladas (sem dt guardado) e, ao voltar, 1 quadro cheio.
          st[s0 + S.pendingDt] = 0;
          st[s0 + S.flags] = flags | FLAG.wasL2;
        }
        F64[SHIFT_X] = dx;
        F64[SHIFT_Y] = dy;
        F64[SHIFT_Z] = dz;
        lastResult = FIGURE_POSE_RESULT.shifted;
        lastArmed = armedNow;
        expression = blinkExpression(actors.expression[i]!, st, s0, mannequin);
        const sc = actors.scale[i]!;
        F64[HAIR] = hairCeiling(y, sc > 0 ? sc : 1, st, s0);
        return lastResult;
      }

      let dt = F64[DT]!;
      if (!seen) {
        initEntity(actors, i, st, s0, key);
        dt = 0;
      } else {
        if ((flags & FLAG.wasL2) !== 0) resume(actors, i, st, s0);
        const pending = st[s0 + S.pendingDt]!;
        if (pending > 0) {
          dt += pending;
          if (dt > MAX_DT) dt = MAX_DT;
          st[s0 + S.pendingDt] = 0;
        }
      }
      st[s0 + S.flags] = st[s0 + S.flags]! & ~FLAG.wasL2;
      F64[ADT] = dt;
      lastArmed = animate(actors, i, out, o, st, s0, key, mannequin, tbl);
      lastResult = FIGURE_POSE_RESULT.computed;
      return lastResult;
      // fim-quente
    },
    weapon(out, o) {
      // quente:
      if (!lastArmed || lastResult === FIGURE_POSE_RESULT.hidden) return false;
      if (lastResult === FIGURE_POSE_RESULT.shifted) {
        out[o + 12] = out[o + 12]! + F64[SHIFT_X]!;
        out[o + 13] = out[o + 13]! + F64[SHIFT_Y]!;
        out[o + 14] = out[o + 14]! + F64[SHIFT_Z]!;
        return true;
      }
      out.set(weaponM, o);
      return true;
      // fim-quente
    },
    end(frameIndex) {
      stats.l0 = l0;
      stats.l1 = l1;
      stats.l2 = l2;
      entities.sweep(frameIndex | 0, MAX_AGE);
    },
    dispose() {
      entities.clear();
      table = null;
      lastResult = FIGURE_POSE_RESULT.hidden;
      lastArmed = false;
      kFrame[K_DT] = NaN;
      kOther[K_DT] = NaN;
    },
  };
  return rig;
}
