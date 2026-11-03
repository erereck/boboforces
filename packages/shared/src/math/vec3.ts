/**
 * Vetores 3D sem alocação: toda operação escreve em `out` e devolve `out`.
 *
 * Convenção de eixos do projeto (vale para sim, render, input e ai): Y para cima, em metros. Yaw gira em torno de +Y;
 * yaw 0 olha para -Z (igual à câmera do three) e yaw positivo vira para a esquerda (anti-horário visto de cima).
 * Pitch positivo olha para cima. Ver `forwardFromYawPitch` e `docs/ARCHITECTURE.md`.
 *
 * `vec3()` aloca: use só em setup, pools e objetos de rascunho, nunca dentro do laço quente.
 */
export type Vec3 = [number, number, number];
export type ReadonlyVec3 = readonly [number, number, number];

/** Array numérico indexável (typed arrays e arrays comuns) para os acessos com passo de 3. */
export interface NumberArray {
  [index: number]: number;
  readonly length: number;
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return [x, y, z];
}

export function set3(out: Vec3, x: number, y: number, z: number): Vec3 {
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

export function copy3(out: Vec3, a: ReadonlyVec3): Vec3 {
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  return out;
}

export function add3(out: Vec3, a: ReadonlyVec3, b: ReadonlyVec3): Vec3 {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  out[2] = a[2] + b[2];
  return out;
}

export function sub3(out: Vec3, a: ReadonlyVec3, b: ReadonlyVec3): Vec3 {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
  return out;
}

/** Produto componente a componente. */
export function mul3(out: Vec3, a: ReadonlyVec3, b: ReadonlyVec3): Vec3 {
  out[0] = a[0] * b[0];
  out[1] = a[1] * b[1];
  out[2] = a[2] * b[2];
  return out;
}

export function scale3(out: Vec3, a: ReadonlyVec3, s: number): Vec3 {
  out[0] = a[0] * s;
  out[1] = a[1] * s;
  out[2] = a[2] * s;
  return out;
}

/** out = a + b * s */
export function addScaled3(out: Vec3, a: ReadonlyVec3, b: ReadonlyVec3, s: number): Vec3 {
  out[0] = a[0] + b[0] * s;
  out[1] = a[1] + b[1] * s;
  out[2] = a[2] + b[2] * s;
  return out;
}

export function negate3(out: Vec3, a: ReadonlyVec3): Vec3 {
  out[0] = -a[0];
  out[1] = -a[1];
  out[2] = -a[2];
  return out;
}

export function dot3(a: ReadonlyVec3, b: ReadonlyVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross3(out: Vec3, a: ReadonlyVec3, b: ReadonlyVec3): Vec3 {
  const ax = a[0];
  const ay = a[1];
  const az = a[2];
  const bx = b[0];
  const by = b[1];
  const bz = b[2];
  out[0] = ay * bz - az * by;
  out[1] = az * bx - ax * bz;
  out[2] = ax * by - ay * bx;
  return out;
}

export function lengthSq3(a: ReadonlyVec3): number {
  return a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
}

export function length3(a: ReadonlyVec3): number {
  return Math.sqrt(lengthSq3(a));
}

export function distanceSq3(a: ReadonlyVec3, b: ReadonlyVec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

export function distance3(a: ReadonlyVec3, b: ReadonlyVec3): number {
  return Math.sqrt(distanceSq3(a, b));
}

/** Normaliza; o vetor nulo continua nulo (sem NaN). */
export function normalize3(out: Vec3, a: ReadonlyVec3): Vec3 {
  const len = length3(a);
  if (len === 0) return set3(out, 0, 0, 0);
  return scale3(out, a, 1 / len);
}

export function lerp3(out: Vec3, a: ReadonlyVec3, b: ReadonlyVec3, t: number): Vec3 {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

export function equals3(a: ReadonlyVec3, b: ReadonlyVec3, epsilon = 1e-9): boolean {
  return Math.abs(a[0] - b[0]) <= epsilon && Math.abs(a[1] - b[1]) <= epsilon && Math.abs(a[2] - b[2]) <= epsilon;
}

/** Lê o vetor `index` de um array com passo 3 (SoA intercalado `xyzxyz…` das typed arrays da sim). */
export function load3(out: Vec3, arr: NumberArray, index: number): Vec3 {
  const i = index * 3;
  out[0] = arr[i]!;
  out[1] = arr[i + 1]!;
  out[2] = arr[i + 2]!;
  return out;
}

/** Grava o vetor `index` num array com passo 3. */
export function store3(arr: NumberArray, index: number, v: ReadonlyVec3): void {
  const i = index * 3;
  arr[i] = v[0];
  arr[i + 1] = v[1];
  arr[i + 2] = v[2];
}

/** Direção de visão unitária a partir de yaw/pitch, na convenção do projeto (yaw 0 → -Z). */
export function forwardFromYawPitch(out: Vec3, yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  out[0] = -Math.sin(yaw) * cp;
  out[1] = Math.sin(pitch);
  out[2] = -Math.cos(yaw) * cp;
  return out;
}

/** Frente no plano XZ (pitch ignorado), unitária. É a direção do `moveY` positivo. */
export function flatForwardFromYaw(out: Vec3, yaw: number): Vec3 {
  out[0] = -Math.sin(yaw);
  out[1] = 0;
  out[2] = -Math.cos(yaw);
  return out;
}

/** Direita no plano XZ, unitária. É a direção do `moveX` positivo. */
export function flatRightFromYaw(out: Vec3, yaw: number): Vec3 {
  out[0] = Math.cos(yaw);
  out[1] = 0;
  out[2] = -Math.sin(yaw);
  return out;
}
