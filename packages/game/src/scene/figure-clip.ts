// Clipes do gancho dos prints (`GameDebugApi.setFigureClip`, rodada 3 do porte do boneco; PLANO §D passo 6 e G13): um
// manequim posado pelo motor de animação com dt FIXO. O clipe é um "jogador" cinemático com a física do perfil Bobo
// (`MOVEMENT_BOBO`: aceleração, atrito, gravidade e pulo da sim) que só alimenta o rig: velocidade, no ar, correr e
// dano. O manequim não sai do lugar (o quadro da câmera continua valendo). Puro, sem relógio.
import { MOVEMENT_BOBO } from '@boboforces/sim';
import type { FigureClipName } from '../bench/types.ts';

export const FIGURE_CLIP_IDS = [
  'start',
  'stop',
  'strafe',
  'jump',
  'land',
  'hit',
  'walk',
  'sidestep',
  'backpedal',
] as const satisfies readonly FigureClipName[];
export type FigureClipId = (typeof FIGURE_CLIP_IDS)[number];

/** Preparo antes do quadro 0 (s): parado e armado, o regime antes do evento. */
const PREP_S = 0.5;
/** "Parar": 1 s correndo antes de soltar o direcional (mais o preparo parado). */
const STOP_RUN_S = 1;
/** "Pousar": caindo de 0,8 m, tocando o chão no quadro 0. */
const LAND_DROP_M = 0.8;
/** "ADAD": troca de lado a cada 0,25 s. */
const STRAFE_HALF_S = 0.25;
/** Clarão de dano: cai de 1 a 0 em 0,25 s (o `FLASH_S` da partida). */
const HIT_FLASH_S = 0.25;

const M = MOVEMENT_BOBO;

/** Comando do quadro no frame do boneco: frente e direita (m/s), correr, pular. */
interface ClipControl {
  forward: number;
  right: number;
  sprint: boolean;
  jump: boolean;
}

/** Comando de cada clipe no instante t (s; t < 0 é o preparo). */
function control(id: FigureClipId, t: number, c: ClipControl): void {
  c.forward = 0;
  c.right = 0;
  c.sprint = false;
  c.jump = false;
  switch (id) {
    case 'start':
      if (t >= 0) {
        c.forward = M.sprint;
        c.sprint = true;
      }
      break;
    case 'stop':
      if (t >= -STOP_RUN_S && t < 0) {
        c.forward = M.sprint;
        c.sprint = true;
      }
      break;
    case 'strafe':
      if (t >= 0) c.right = Math.floor(t / STRAFE_HALF_S) % 2 === 0 ? M.walk : -M.walk;
      break;
    case 'jump':
      c.jump = t >= 0 && t < 1e-9;
      break;
    case 'walk':
      if (t >= 0) c.forward = M.walk;
      break;
    case 'sidestep':
      if (t >= 0) c.right = M.walk;
      break;
    case 'backpedal':
      if (t >= 0) c.forward = -M.walk;
      break;
    default:
      break;
  }
}

export interface FigureClipRun {
  readonly id: FigureClipId;
  readonly dtS: number;
  /** Passos ao todo (preparo + o quadro pedido + 1: o passo 0 é o boneco novo, sem dt). */
  readonly totalSteps: number;
  /** Passos já aplicados (`advance`); `done` quando chega a `totalSteps`. */
  readonly steps: number;
  readonly done: boolean;
  /** Velocidade no mundo (m/s), no ar, correndo e clarão de dano do passo atual. */
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly airborne: boolean;
  readonly sprint: boolean;
  readonly flash: number;
  /** Aplica o próximo passo com o giro `yaw` do manequim (o "jogador" anda no frame dele). */
  advance(yaw: number): void;
}

/** Clipe `id` parado no quadro `frame` a `dtS` fixo; `null` com id, quadro ou dt inválidos. */
export function createFigureClip(id: string, frame: number, dtS: number): FigureClipRun | null {
  if (!(FIGURE_CLIP_IDS as readonly string[]).includes(id)) return null;
  if (!Number.isInteger(frame) || frame < 0 || frame > 600) return null;
  if (!(dtS > 0 && dtS <= 0.1)) return null;
  const clip = id as FigureClipId;
  const fallS = Math.sqrt((2 * LAND_DROP_M) / M.gravity);
  const prepS = PREP_S + (clip === 'stop' ? STOP_RUN_S : 0);
  const prepSteps = Math.ceil(prepS / dtS - 1e-9);
  const totalSteps = prepSteps + frame + 1;
  const c: ClipControl = { forward: 0, right: 0, sprint: false, jump: false };
  let steps = 0;
  let vx = 0;
  let vy = 0;
  let vz = 0;
  let y = 0;
  let airborne = false;
  let flash = 0;
  const run: FigureClipRun = {
    id: clip,
    dtS,
    totalSteps,
    get steps() {
      return steps;
    },
    get done() {
      return steps >= totalSteps;
    },
    get vx() {
      return vx;
    },
    get vy() {
      return vy;
    },
    get vz() {
      return vz;
    },
    get airborne() {
      return airborne;
    },
    get sprint() {
      return c.sprint;
    },
    get flash() {
      return flash;
    },
    advance(yaw) {
      if (steps >= totalSteps) return;
      const t = (steps - prepSteps) * dtS;
      // O passo 0 só põe o estado inicial (o rig não anda no 1º quadro de um boneco novo).
      const dt = steps === 0 ? 0 : dtS;
      steps++;
      control(clip, t, c);
      const sy = Math.sin(yaw);
      const cy = Math.cos(yaw);
      if (clip === 'land') {
        // Queda livre de 0,8 m que termina exatamente no quadro 0; antes dela, parado no chão.
        airborne = t >= -fallS && t < 0;
        vy = airborne ? -M.gravity * (t + fallS) : 0;
      } else {
        const grounded = y <= 0 && vy <= 0;
        if (grounded) {
          const wantX = -sy * c.forward + cy * c.right;
          const wantZ = -cy * c.forward - sy * c.right;
          if (wantX === 0 && wantZ === 0) {
            const k = Math.exp(-M.friction * dt);
            vx *= k;
            vz *= k;
          } else {
            const dx = wantX - vx;
            const dz = wantZ - vz;
            const len = Math.sqrt(dx * dx + dz * dz);
            const step = M.accel * dt;
            if (len <= step || dt === 0) {
              vx = wantX;
              vz = wantZ;
            } else {
              vx += (dx * step) / len;
              vz += (dz * step) / len;
            }
          }
          if (c.jump) vy = Math.sqrt(2 * M.gravity * M.jump);
        }
        if (!(y <= 0 && vy <= 0)) vy -= M.gravity * dt;
        y += vy * dt;
        if (y < 0) {
          y = 0;
          vy = 0;
        }
        airborne = y > 0 || vy > 0;
      }
      flash = clip === 'hit' && t >= 0 ? Math.max(0, 1 - t / HIT_FLASH_S) : 0;
    },
  };
  return run;
}
