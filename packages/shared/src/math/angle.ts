import { clamp, mod } from './scalar.ts';

export const PI = Math.PI;
export const TAU = Math.PI * 2;
export const HALF_PI = Math.PI / 2;
export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

export function degToRad(deg: number): number {
  return deg * DEG_TO_RAD;
}

export function radToDeg(rad: number): number {
  return rad * RAD_TO_DEG;
}

/** Normaliza um ângulo para [-π, π). */
export function wrapAngle(a: number): number {
  return mod(a + PI, TAU) - PI;
}

/** Menor diferença assinada `b - a`, em [-π, π). */
export function angleDelta(a: number, b: number): number {
  return wrapAngle(b - a);
}

/** Interpola pelo caminho mais curto; o resultado sai normalizado em [-π, π). */
export function lerpAngle(a: number, b: number, t: number): number {
  return wrapAngle(a + angleDelta(a, b) * t);
}

// Quantização dos ângulos absolutos do InputFrame e dos snapshots (tecnico.md §4.2 e §13.3).

/** Yaw em radianos → u16 (0..65535 cobre uma volta inteira). */
export function yawToU16(rad: number): number {
  return Math.round((mod(rad, TAU) * 65536) / TAU) & 0xffff;
}

/** u16 → yaw em radianos, em [0, 2π). */
export function u16ToYaw(v: number): number {
  return ((v & 0xffff) * TAU) / 65536;
}

/** Pitch em radianos (limitado a ±π/2) → i16 em [-32767, 32767]. */
export function pitchToI16(rad: number): number {
  return Math.round((clamp(rad, -HALF_PI, HALF_PI) / HALF_PI) * 32767);
}

/** i16 → pitch em radianos, em [-π/2, π/2]. */
export function i16ToPitch(v: number): number {
  return (clamp(v, -32767, 32767) / 32767) * HALF_PI;
}
