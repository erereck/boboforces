// Bancada da animação (só testes e `scripts/bench-figure.ts`; o jogo não importa): tabela de jogo SINTÉTICA com as
// posturas armadas diferentes das sem arma (independente da montagem da F1), quadro com vistas e escrita de um ator no
// `ActorBuffer`. Puro, sem three.
import {
  FIGURE_BONES,
  FIGURE_CROUCH_POSE,
  FIGURE_GRIP,
  FIGURE_HIT_STRIDE,
  FIGURE_MODE,
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
  figurePosture,
  type FigureGameTable,
  type FigureGrip,
} from '@boboforces/format';
import { createFrameViews, type FrameViews } from '../../shared/passes.ts';
import { ACTOR_KIND, ACTOR_POSE, createActorBuffer, type ActorBuffer, type RenderDebug } from '../../types.ts';
import { FIGURE_MOTION_STOPPED, type FigureMotionConfig } from './motion-config.ts';
import { createFigureRig } from './rig.ts';

const SAMPLES = FIGURE_PITCH_SAMPLES.length;
const ZOMBIE = FIGURE_POSTURES - 1;

/**
 * Tabela de jogo sintética e determinística: as bases congeladas do `figure.ts` por `stance`, a cabeça seguindo o
 * pitch e, nas armadas, tronco de lado e os dois braços à frente subindo com o pitch; `grip` girando com o pitch e
 * `reload` com 3 chaves por empunhadura. Hitboxes, folga e fase larga ficam zeradas (a animação não lê).
 */
export function createSyntheticFigureTable(): FigureGameTable {
  const P = FIGURE_POSE;
  const poses = new Float32Array(FIGURE_POSTURES * SAMPLES * FIGURE_POSE_SIZE);
  const grip = new Float32Array(FIGURE_POSTURES * SAMPLES * 12);
  for (let p = 0; p < FIGURE_POSTURES; p++) {
    const stance = FIGURE_POSTURE_INFO[p * 3]!;
    const g = FIGURE_POSTURE_INFO[p * 3 + 1]!;
    const base =
      p === ZOMBIE
        ? FIGURE_ZOMBIE_POSE
        : stance === FIGURE_STANCE.crouch
          ? FIGURE_CROUCH_POSE
          : stance === FIGURE_STANCE.slide
            ? FIGURE_SLIDE_POSE
            : FIGURE_REST_POSE;
    for (let s = 0; s < SAMPLES; s++) {
      const pitch = FIGURE_PITCH_SAMPLES[s]!;
      const o = (p * SAMPLES + s) * FIGURE_POSE_SIZE;
      poses.set(base, o);
      const head = Math.max(-0.6, Math.min(0.6, pitch)) * (stance === FIGURE_STANCE.stand ? 1 : 1 / 6);
      poses[o + P.neckX] = poses[o + P.neckX]! - head;
      if (g !== FIGURE_GRIP.none) {
        const twist = g === FIGURE_GRIP.pistol ? -0.25 : -0.8;
        poses[o + P.torsoY] = twist;
        poses[o + P.neckY] = -twist;
        poses[o + P.shRX] = -1.3 - 0.4 * pitch;
        poses[o + P.shRY] = 1.0;
        poses[o + P.shRZ] = 0.5;
        poses[o + P.elR] = -1.5;
        poses[o + P.shLX] = -1.0 - 0.4 * pitch;
        poses[o + P.shLY] = -0.3;
        poses[o + P.shLZ] = 0.3;
        poses[o + P.elL] = -1.1;
        poses[o + P.neckSlide] = -0.5 * Math.abs(pitch);
      }
      // Arma: giro em X com o pitch, translação fixa no antebraço (px).
      const q = (p * SAMPLES + s) * 12;
      const c = Math.cos(-pitch);
      const sn = Math.sin(-pitch);
      grip[q] = 1;
      grip[q + 4] = c;
      grip[q + 5] = sn;
      grip[q + 7] = -sn;
      grip[q + 8] = c;
      grip[q + 9] = 0.2;
      grip[q + 10] = -6;
      grip[q + 11] = 1.5;
    }
  }
  const reload = new Float32Array(3 * 3 * 4);
  const keys = [
    [-1.0, -0.3, 0.3, -1.1],
    [-0.5, -0.6, 0.0, -1.4],
    [0.1, -0.45, -0.1, -0.6],
  ];
  for (let g = 0; g < 3; g++) for (let k = 0; k < 3; k++) reload.set(keys[k]!, (g * 3 + k) * 4);
  return {
    poses,
    boxes: new Float32Array(FIGURE_POSTURES * SAMPLES * FIGURE_BONES * FIGURE_HIT_STRIDE),
    broad: new Float32Array(FIGURE_POSTURES * 2),
    slack: new Float32Array(FIGURE_POSTURES * (SAMPLES - 1) * FIGURE_BONES * 3),
    grip,
    reload,
  };
}

/** Quadro mutável (o `FrameContext` só lê). */
export interface HarnessFrame {
  dt: number;
  timeS: number;
  readonly debug: Readonly<RenderDebug>;
  readonly world: null;
  readonly views: FrameViews;
}

/**
 * Quadro com `views` vistas que aceitam tudo (planos 0·x + 1 ≥ 0) e o olho em `eye` (m). Vistas sem dono.
 */
export function createHarnessFrame(views = 1, eyeX = 0, eyeY = 1.55, eyeZ = 0): HarnessFrame {
  const v = createFrameViews();
  v.count = views;
  for (let k = 0; k < views; k++) {
    v.eye[k * 3] = eyeX;
    v.eye[k * 3 + 1] = eyeY;
    v.eye[k * 3 + 2] = eyeZ;
    for (let p = 0; p < 6; p++) v.planes[k * 24 + p * 4 + 3] = 1;
  }
  return { dt: 1 / 60, timeS: 0, debug: {} as Readonly<RenderDebug>, world: null, views: v };
}

// --- Roteiros do E.2: um "jogador" cinemático a 60 Hz e dois rigs (motor e motor parado) no mesmo ActorBuffer ---

/** Comando de um quadro (o roteiro escreve; o executor zera antes de cada quadro). */
export interface MoveControl {
  /** Velocidade pedida no frame do boneco (m/s): frente e direita. */
  forward: number;
  right: number;
  sprint: boolean;
  crouch: boolean;
  /** Começa um deslize (8 m/s por 0,7 s), se não estiver deslizando. */
  slide: boolean;
  /** Pula, se estiver no chão (1,0 m, gravidade 20). */
  jump: boolean;
  ads: boolean;
  /** Atira neste quadro (bit `firing`; o coice vai a 1 e cai). */
  fire: boolean;
  /** Clarão de dano 0..1 (o roteiro faz a curva). */
  flash: number;
  reload: number;
  yaw: number;
  pitch: number;
  grip: FigureGrip;
  zombie: boolean;
}

export type MoveScript = (t: number, c: MoveControl) => void;

/**
 * Métricas de um roteiro (px de boneco: distância do ponto ao mesmo ponto da pose base). Regras do envelope
 * (`FIGURE_ENVELOPE_PX`): em REGIME, a média móvel de 0,3 s ≤ 1 px; no transitório, o pico ≤ 2 px e o trecho
 * acima de 1 px ≤ 0,3 s.
 */
export interface EnvelopeMetrics {
  /** Cabeça (centro da caixa): pico, maior média de 0,3 s nas janelas de regime, maior média de 0,3 s no roteiro
   * todo (relatada) e maior trecho seguido acima de 1 px (s). */
  readonly headPeak: number;
  readonly headRegime: number;
  readonly headMean: number;
  readonly headOverS: number;
  /** O mesmo para o centro da caixa do tronco. */
  readonly torsoPeak: number;
  readonly torsoRegime: number;
  readonly torsoMean: number;
  readonly torsoOverS: number;
  /** Mãos (ponta do antebraço) e pés (centro da chuteira): pico. */
  readonly handPeak: number;
  readonly footPeak: number;
}

export interface EnvelopeScript {
  readonly name: string;
  readonly seconds: number;
  /** Trechos (s) em regime: o roteiro já parou de mudar o comando (a média de 0,3 s vale aqui). */
  readonly regime: readonly (readonly [number, number])[];
  readonly run: MoveScript;
}

const MOVE = { accel: 60, friction: 18.5, gravity: 20, jump: 1, slideSpeed: 8, slideS: 0.7 } as const;

function point(m: Float32Array, b: number, x: number, y: number, z: number, out: Float64Array, k: number): void {
  const o = b * 16;
  out[k] = m[o]! * x + m[o + 4]! * y + m[o + 8]! * z + m[o + 12]!;
  out[k + 1] = m[o + 1]! * x + m[o + 5]! * y + m[o + 9]! * z + m[o + 13]!;
  out[k + 2] = m[o + 2]! * x + m[o + 6]! * y + m[o + 10]! * z + m[o + 14]!;
}

/** Pontos medidos: cabeça, tronco, mão D, mão E, pé D, pé E (osso e px no espaço do osso). */
const POINTS: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 4, 0],
  [1, 0, 6, 0],
  [4, 0, -5.6, 0],
  [5, 0, -5.6, 0],
  [10, 0, -1.15, 0.55],
  [11, 0, -1.15, 0.55],
];

/**
 * Roda `script` por `seconds` a `hz` com dois rigs (o `motion` e o motor parado) no MESMO ActorBuffer e mede quanto
 * cabeça, tronco, mãos e pés se afastam da pose base. A entidade é nova no começo (sem transitório herdado).
 */
export function measureEnvelope(
  table: FigureGameTable,
  motion: FigureMotionConfig,
  scriptDef: EnvelopeScript,
  hz = 60,
  scale = 1,
  trace?: (t: number, head: number, torso: number) => void,
): EnvelopeMetrics {
  const script = scriptDef.run;
  const seconds = scriptDef.seconds;
  const actors: ActorBuffer = createActorBuffer(1);
  actors.count = 1;
  actors.entity[0] = 77;
  actors.kind[0] = ACTOR_KIND.bobo;
  actors.figure[0] = 0;
  actors.scale[0] = scale;
  actors.localSlot[0] = 255;
  const full = createFigureRig(1, { motion });
  const base = createFigureRig(1, { motion: FIGURE_MOTION_STOPPED });
  full.setTable(table);
  base.setTable(table);
  const frame = createHarnessFrame(1, 0, 1.55, 10);
  const dt = 1 / hz;
  frame.dt = dt;
  const a = new Float32Array(192);
  const b = new Float32Array(192);
  const pa = new Float64Array(POINTS.length * 3);
  const pb = new Float64Array(POINTS.length * 3);
  const c: MoveControl = {
    forward: 0,
    right: 0,
    sprint: false,
    crouch: false,
    slide: false,
    jump: false,
    ads: false,
    fire: false,
    flash: 0,
    reload: 0,
    yaw: 0,
    pitch: 0,
    grip: FIGURE_GRIP.rifle,
    zombie: false,
  };
  let x = 0;
  let y = 0;
  let z = 0;
  let vx = 0;
  let vy = 0;
  let vz = 0;
  let slideT = -1;
  let recoil = 0;
  const frames = Math.round(seconds * hz);
  const window = Math.max(1, Math.round(0.3 * hz));
  const head = new Float64Array(frames);
  const torso = new Float64Array(frames);
  let handPeak = 0;
  let footPeak = 0;
  const unit = FIGURE_PX_M * scale;
  const dist = (p: number): number =>
    Math.hypot(pa[p * 3]! - pb[p * 3]!, pa[p * 3 + 1]! - pb[p * 3 + 1]!, pa[p * 3 + 2]! - pb[p * 3 + 2]!) / unit;
  for (let f = 0; f < frames; f++) {
    const t = f * dt;
    c.forward = 0;
    c.right = 0;
    c.sprint = false;
    c.crouch = false;
    c.slide = false;
    c.jump = false;
    c.ads = false;
    c.fire = false;
    c.flash = 0;
    c.reload = 0;
    c.pitch = 0;
    c.grip = FIGURE_GRIP.rifle;
    c.zombie = false;
    script(t, c);
    const sy = Math.sin(c.yaw);
    const cy = Math.cos(c.yaw);
    const grounded = y <= 0 && vy <= 0;
    if (c.slide && slideT < 0 && grounded) {
      slideT = 0;
      vx = -sy * MOVE.slideSpeed;
      vz = -cy * MOVE.slideSpeed;
    }
    if (slideT >= 0) {
      slideT += dt;
      if (slideT >= MOVE.slideS) slideT = -1;
    } else if (grounded) {
      const wantX = -sy * c.forward + cy * c.right;
      const wantZ = -cy * c.forward - sy * c.right;
      if (wantX === 0 && wantZ === 0) {
        const k = Math.exp(-MOVE.friction * dt);
        vx *= k;
        vz *= k;
      } else {
        const dx = wantX - vx;
        const dz = wantZ - vz;
        const len = Math.sqrt(dx * dx + dz * dz);
        const step = MOVE.accel * dt;
        if (len <= step) {
          vx = wantX;
          vz = wantZ;
        } else {
          vx += (dx * step) / len;
          vz += (dz * step) / len;
        }
      }
      if (c.jump) vy = Math.sqrt(2 * MOVE.gravity * MOVE.jump);
    }
    if (!(y <= 0 && vy <= 0)) vy -= MOVE.gravity * dt;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    if (y < 0) {
      y = 0;
      vy = 0;
    }
    const sliding = slideT >= 0;
    const airborne = y > 0;
    const stance = sliding ? FIGURE_STANCE.slide : c.crouch ? FIGURE_STANCE.crouch : FIGURE_STANCE.stand;
    const mode = c.ads ? FIGURE_MODE.ads : c.sprint ? FIGURE_MODE.sprint : FIGURE_MODE.base;
    recoil = c.fire ? 1 : recoil * Math.exp(-12 * dt);
    actors.position[0] = x;
    actors.position[1] = y;
    actors.position[2] = z;
    actors.velocity[0] = vx;
    actors.velocity[1] = vy;
    actors.velocity[2] = vz;
    actors.yaw[0] = c.yaw;
    actors.pitch[0] = c.pitch;
    // O roteiro pode trocar a empunhadura (o TS estreita `c.grip` pela atribuição de antes da chamada).
    const grip = c.zombie ? FIGURE_GRIP.none : (c.grip as FigureGrip);
    actors.posture[0] = figurePosture(stance, grip, mode, c.zombie);
    actors.weapon[0] = grip === FIGURE_GRIP.none ? 255 : 0;
    actors.pose[0] =
      (stance === FIGURE_STANCE.crouch || sliding ? ACTOR_POSE.crouch : 0) |
      (c.ads ? ACTOR_POSE.ads : 0) |
      (c.sprint ? ACTOR_POSE.sprint : 0) |
      (airborne ? ACTOR_POSE.airborne : 0) |
      (c.fire ? ACTOR_POSE.firing : 0) |
      (sliding ? ACTOR_POSE.sliding : 0);
    actors.recoil[0] = recoil;
    actors.reload[0] = c.reload;
    actors.damageFlash[0] = c.flash;
    frame.timeS = t;
    full.begin(frame, actors, f);
    base.begin(frame, actors, f);
    full.pose(actors, 0, a, 0, false);
    base.pose(actors, 0, b, 0, false);
    full.end(f);
    base.end(f);
    for (let p = 0; p < POINTS.length; p++) {
      const q = POINTS[p]!;
      point(a, q[0], q[1], q[2], q[3], pa, p * 3);
      point(b, q[0], q[1], q[2], q[3], pb, p * 3);
    }
    head[f] = dist(0);
    torso[f] = dist(1);
    trace?.(t, head[f]!, torso[f]!);
    handPeak = Math.max(handPeak, dist(2), dist(3));
    footPeak = Math.max(footPeak, dist(4), dist(5));
  }
  // Média móvel de 0,3 s: no roteiro todo (relatada) e só nas janelas inteiras dentro dos trechos de regime.
  const inRegime = new Uint8Array(frames);
  for (const [t0, t1] of scriptDef.regime) {
    for (let f = Math.max(0, Math.ceil(t0 * hz)); f < Math.min(frames, Math.floor(t1 * hz)); f++) inRegime[f] = 1;
  }
  const stats = (d: Float64Array): [number, number, number, number] => {
    let peak = 0;
    let mean = 0;
    let regime = 0;
    let sum = 0;
    let inside = 0;
    let run = 0;
    let longest = 0;
    for (let f = 0; f < d.length; f++) {
      peak = Math.max(peak, d[f]!);
      sum += d[f]!;
      inside += inRegime[f]!;
      if (f >= window) {
        sum -= d[f - window]!;
        inside -= inRegime[f - window]!;
      }
      if (f >= window - 1) {
        mean = Math.max(mean, sum / window);
        if (inside === window) regime = Math.max(regime, sum / window);
      }
      run = d[f]! > 1 ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    return [peak, regime, mean, longest / hz];
  };
  const [headPeak, headRegime, headMean, headOverS] = stats(head);
  const [torsoPeak, torsoRegime, torsoMean, torsoOverS] = stats(torso);
  full.dispose();
  base.dispose();
  return {
    headPeak,
    headRegime,
    headMean,
    headOverS,
    torsoPeak,
    torsoRegime,
    torsoMean,
    torsoOverS,
    handPeak,
    footPeak,
  };
}

/** Clarão de dano que cai de 1 a 0 em 0,3 s depois de cada acerto em `hits` (s). */
export function damageFlash(t: number, hits: readonly number[]): number {
  let v = 0;
  for (const h of hits) if (t >= h && t < h + 0.3) v = Math.max(v, 1 - (t - h) / 0.3);
  return v;
}

function adad(half: number): EnvelopeScript {
  return {
    name: `ADAD ${half} s por lado`,
    seconds: 5,
    regime: [[1.3, 5]],
    run: (t, c) => {
      if (t >= 0.3) c.right = Math.floor((t - 0.3) / half) % 2 === 0 ? 4.8 : -4.8;
    },
  };
}

/** Os roteiros do E.2 (PLANO §E), com o nome que vai no relatório, a duração (s) e os trechos de regime. */
export const ENVELOPE_SCRIPTS: readonly EnvelopeScript[] = [
  {
    name: 'arrancar e parar a 6,8 m/s',
    seconds: 4,
    regime: [
      [0, 0.5],
      [1.5, 2.5],
      [3.5, 4],
    ],
    run: (t, c) => {
      if (t >= 0.5 && t < 2.5) {
        c.forward = 6.8;
        c.sprint = true;
      }
    },
  },
  adad(0.25),
  adad(0.35),
  adad(0.5),
  {
    name: 'pulo e pouso (parado e correndo)',
    seconds: 5.5,
    regime: [
      [2, 2.5],
      [3.2, 3.5],
      [4.8, 5.5],
    ],
    run: (t, c) => {
      c.jump = (t >= 0.5 && t < 0.52) || (t >= 3.5 && t < 3.52);
      if (t >= 2.5) c.forward = 4.8;
    },
  },
  {
    name: '10 tiros',
    seconds: 3,
    regime: [
      [0.8, 1.5],
      [2.5, 3],
    ],
    run: (t, c) => {
      const k = Math.round((t - 0.5) * 60);
      c.fire = k >= 0 && k < 60 && k % 6 === 0;
    },
  },
  {
    name: 'dano (1 acerto e rajada de 3)',
    seconds: 3,
    regime: [
      [1, 1.5],
      [2.6, 3],
    ],
    run: (t, c) => {
      c.flash = damageFlash(t, [0.5, 1.5, 1.65, 1.8]);
    },
  },
  {
    name: 'agachar e levantar (parado e andando agachado)',
    seconds: 4.5,
    regime: [
      [0.9, 1.5],
      [2.8, 3.3],
      [4, 4.5],
    ],
    run: (t, c) => {
      c.crouch = (t >= 0.5 && t < 1.5) || (t >= 2 && t < 3.5);
      if (t >= 2.2 && t < 3.3) c.forward = 2.4;
    },
  },
  {
    name: 'deslize',
    seconds: 3.2,
    regime: [[2.7, 3.2]],
    run: (t, c) => {
      if (t < 1.4) {
        c.forward = 6.8;
        c.sprint = t < 0.8;
      }
      c.slide = t >= 0.8 && t < 0.82;
      if (t >= 1.5 && t < 2.2) c.crouch = true;
    },
  },
  {
    name: 'correr (6,8 m/s)',
    seconds: 4,
    regime: [[1, 4]],
    run: (_t, c) => {
      c.forward = 6.8;
      c.sprint = true;
    },
  },
  {
    // Decisão 4 da §I: a cabeça olha o pente (`reloadNeckX` 0,17) dentro do envelope; a respiração some na recarga.
    name: 'recarga (2 s)',
    seconds: 3,
    regime: [
      [0.9, 2.1],
      [2.8, 3],
    ],
    run: (t, c) => {
      c.reload = t >= 0.5 && t < 2.5 ? (t - 0.5) / 2 : 0;
    },
  },
];

/** Roteiros fora do E.2, só relatados (giro no lugar, diagonal e ré, zumbi). */
export const EXTRA_SCRIPTS: readonly EnvelopeScript[] = [
  {
    name: 'giro no lugar (2 rad/s)',
    seconds: 4,
    regime: [
      [0.9, 2.4],
      [3.4, 4],
    ],
    run: (t, c) => {
      c.yaw = t >= 0.5 && t < 2.5 ? 2 * (t - 0.5) : t >= 2.5 ? 4 : 0;
    },
  },
  {
    name: 'diagonal e ré a 4,8 m/s',
    seconds: 4,
    regime: [
      [1, 2],
      [2.8, 4],
    ],
    run: (t, c) => {
      if (t >= 0.3 && t < 2) {
        c.forward = 3.39;
        c.right = 3.39;
      } else if (t >= 2) c.forward = -4.8;
    },
  },
  {
    name: 'zumbi andando',
    seconds: 3,
    regime: [[1, 3]],
    run: (t, c) => {
      c.zombie = true;
      if (t >= 0.3) c.forward = 3;
    },
  },
];
