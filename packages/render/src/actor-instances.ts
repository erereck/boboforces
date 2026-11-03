// Atores provisórios do M0 (caixas coloridas) em arrays de instância, sem three (testável em Node). No M1 isto vira o
// bobo de 7 partes (tecnico.md §6.6) com a mesma ideia: um array de matrizes por parte, escrito 1x por frame.
import { TEAM_COLORS } from '@boboforces/ui';
import { ACTOR_POSE, type ActorBuffer } from './types.ts';

/**
 * Medidas das caixas provisórias. Espelham `METRICS` do sim (altura 1,5 m, cabeça 0,5 m, agachado 0,95 m, largura
 * 0,6 m); o render não importa o sim, então a fonte continua sendo `packages/sim/src/config/metrics.ts`.
 */
export const ACTOR_BOX = {
  width: 0.6,
  depth: 0.4,
  height: 1.5,
  crouchHeight: 0.95,
  head: 0.5,
} as const;

/** Floats por instância no atributo extra: [flash de dano, slot local dono]. */
export const ACTOR_EXTRA_COMPONENTS = 2;
/** Slot "ninguém" (o mesmo 255 do `ActorBuffer.localSlot`). */
export const NO_SLOT = 255;

export interface ActorInstanceArrays {
  readonly capacity: number;
  /** 16 floats por instância (column-major, como o three). */
  readonly bodyMatrix: Float32Array;
  readonly headMatrix: Float32Array;
  /** 3 floats por instância (0..1). */
  readonly bodyColor: Float32Array;
  readonly headColor: Float32Array;
  readonly extra: Float32Array;
}

export function createActorInstanceArrays(capacity: number): ActorInstanceArrays {
  return {
    capacity,
    bodyMatrix: new Float32Array(capacity * 16),
    headMatrix: new Float32Array(capacity * 16),
    bodyColor: new Float32Array(capacity * 3),
    headColor: new Float32Array(capacity * 3),
    extra: new Float32Array(capacity * ACTOR_EXTRA_COMPONENTS),
  };
}

/**
 * Escreve T · Ry(yaw) · Rx(pitch) · S em `out[o..o+16)`, column-major. Mesma convenção da câmera (`rotation.order =
 * 'YXZ'`): yaw 0 olha para -Z, yaw + vira para a esquerda, pitch + olha para cima.
 */
export function composeYawPitch(
  out: Float32Array,
  o: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
  sx: number,
  sy: number,
  sz: number,
): void {
  const cy = Math.cos(yaw);
  const sny = Math.sin(yaw);
  const cx = Math.cos(pitch);
  const snx = Math.sin(pitch);
  out[o] = cy * sx;
  out[o + 1] = 0;
  out[o + 2] = -sny * sx;
  out[o + 3] = 0;
  out[o + 4] = sny * snx * sy;
  out[o + 5] = cx * sy;
  out[o + 6] = cy * snx * sy;
  out[o + 7] = 0;
  out[o + 8] = sny * cx * sz;
  out[o + 9] = -snx * sz;
  out[o + 10] = cy * cx * sz;
  out[o + 11] = 0;
  out[o + 12] = x;
  out[o + 13] = y;
  out[o + 14] = z;
  out[o + 15] = 1;
}

/** Tom de pele provisório da cabeça (rampa `pele` da paleta mestra). */
const SKIN = 0xc48a68;
/** Ator sem time: cinza claro da rampa de concreto. */
const NO_TEAM = 0xbdbbb2;

function writeRgb(out: Float32Array, o: number, rgb: number): void {
  out[o] = ((rgb >> 16) & 0xff) / 255;
  out[o + 1] = ((rgb >> 8) & 0xff) / 255;
  out[o + 2] = (rgb & 0xff) / 255;
}

/**
 * Preenche as instâncias a partir do `ActorBuffer` (1x por frame, não por viewport). Devolve quantas instâncias valem.
 * Corpo: caixa da cor do time, do pé ao pescoço, girada só pelo yaw. Cabeça: gira com yaw e pitch em torno do pescoço.
 * Morto: o corpo deita e a cabeça some (escala zero). Sem alocação.
 */
export function writeActorInstances(actors: ActorBuffer, out: ActorInstanceArrays): number {
  const n = Math.min(actors.count, out.capacity);
  const { width, depth, height, crouchHeight, head } = ACTOR_BOX;
  for (let i = 0; i < n; i++) {
    const px = actors.position[i * 3]!;
    const py = actors.position[i * 3 + 1]!;
    const pz = actors.position[i * 3 + 2]!;
    const yaw = actors.yaw[i]!;
    const pose = actors.pose[i]!;
    const total = pose & ACTOR_POSE.crouch ? crouchHeight : height;
    const bodyHeight = total - head;
    const m = i * 16;
    if (pose & ACTOR_POSE.dead) {
      // De bruços: a caixa do corpo (base no pé) gira -90° em X e deita para a frente (-Z local).
      composeYawPitch(out.bodyMatrix, m, px, py + depth * 0.5, pz, yaw, -Math.PI / 2, width, height - head, depth);
      composeYawPitch(out.headMatrix, m, px, py, pz, yaw, 0, 0, 0, 0);
    } else {
      composeYawPitch(out.bodyMatrix, m, px, py, pz, yaw, 0, width, bodyHeight, depth);
      composeYawPitch(out.headMatrix, m, px, py + bodyHeight, pz, yaw, actors.pitch[i]!, head, head, head);
    }
    const team = actors.team[i]!;
    const teamColor = team < TEAM_COLORS.length ? TEAM_COLORS[team]! >>> 8 : NO_TEAM;
    writeRgb(out.bodyColor, i * 3, teamColor);
    writeRgb(out.headColor, i * 3, SKIN);
    out.extra[i * ACTOR_EXTRA_COMPONENTS] = actors.damageFlash[i]!;
    out.extra[i * ACTOR_EXTRA_COMPONENTS + 1] = actors.localSlot[i]!;
  }
  return n;
}
