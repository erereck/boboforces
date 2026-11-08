// Conta de matrizes 4×4 (column-major, como o three) e quatérnios sobre Float32Array, SEM alocação: o laço dos atores,
// dos detritos e do desmonte escreve direto nos arrays de instância. Sem three (testável em Node).
//
// Convenção dos eixos (docs/ARCHITECTURE.md §3): Y para cima, yaw 0 olha para -Z, yaw + vira para a esquerda.
// As funções `m4Translate`/`m4Rotate*`/`m4Scale` pós-multiplicam NO LUGAR (m = m · X), na ordem em que se lê a cadeia
// (raiz → filho), como um grafo de cena.

/** Floats por matriz. */
export const MAT4 = 16;

export function m4Identity(m: Float32Array, o = 0): void {
  m.fill(0, o, o + 16);
  m[o] = 1;
  m[o + 5] = 1;
  m[o + 10] = 1;
  m[o + 15] = 1;
}

export function m4Copy(out: Float32Array, oo: number, src: Float32Array, so: number): void {
  for (let k = 0; k < 16; k++) out[oo + k] = src[so + k]!;
}

/** Matriz nula (o vértice colapsa na origem: some sem custo de fragmento). */
export function m4Zero(m: Float32Array, o = 0): void {
  m.fill(0, o, o + 16);
}

/** m = m · T(x, y, z). */
export function m4Translate(m: Float32Array, x: number, y: number, z: number, o = 0): void {
  m[o + 12] = m[o]! * x + m[o + 4]! * y + m[o + 8]! * z + m[o + 12]!;
  m[o + 13] = m[o + 1]! * x + m[o + 5]! * y + m[o + 9]! * z + m[o + 13]!;
  m[o + 14] = m[o + 2]! * x + m[o + 6]! * y + m[o + 10]! * z + m[o + 14]!;
  m[o + 15] = m[o + 3]! * x + m[o + 7]! * y + m[o + 11]! * z + m[o + 15]!;
}

/** m = m · Rx(a): a > 0 leva +Y para +Z (a frente -Z sobe). */
export function m4RotateX(m: Float32Array, a: number, o = 0): void {
  if (a === 0) return;
  const c = Math.cos(a);
  const s = Math.sin(a);
  for (let k = 0; k < 4; k++) {
    const y = m[o + 4 + k]!;
    const z = m[o + 8 + k]!;
    m[o + 4 + k] = y * c + z * s;
    m[o + 8 + k] = z * c - y * s;
  }
}

/** m = m · Ry(a): a > 0 leva -Z para -X (vira para a esquerda, como o yaw). */
export function m4RotateY(m: Float32Array, a: number, o = 0): void {
  if (a === 0) return;
  const c = Math.cos(a);
  const s = Math.sin(a);
  for (let k = 0; k < 4; k++) {
    const x = m[o + k]!;
    const z = m[o + 8 + k]!;
    m[o + k] = x * c - z * s;
    m[o + 8 + k] = x * s + z * c;
  }
}

/** m = m · Rz(a): a > 0 leva +X para +Y. */
export function m4RotateZ(m: Float32Array, a: number, o = 0): void {
  if (a === 0) return;
  const c = Math.cos(a);
  const s = Math.sin(a);
  for (let k = 0; k < 4; k++) {
    const x = m[o + k]!;
    const y = m[o + 4 + k]!;
    m[o + k] = x * c + y * s;
    m[o + 4 + k] = y * c - x * s;
  }
}

/** m = m · S(sx, sy, sz). */
export function m4Scale(m: Float32Array, sx: number, sy: number, sz: number, o = 0): void {
  for (let k = 0; k < 4; k++) {
    m[o + k] = m[o + k]! * sx;
    m[o + 4 + k] = m[o + 4 + k]! * sy;
    m[o + 8 + k] = m[o + 8 + k]! * sz;
  }
}

/** out[oo..] = a[ao..] · b[bo..] (out não pode ser a nem b). */
export function m4Multiply(
  out: Float32Array,
  oo: number,
  a: Float32Array,
  ao: number,
  b: Float32Array,
  bo: number,
): void {
  for (let col = 0; col < 4; col++) {
    const b0 = b[bo + col * 4]!;
    const b1 = b[bo + col * 4 + 1]!;
    const b2 = b[bo + col * 4 + 2]!;
    const b3 = b[bo + col * 4 + 3]!;
    for (let row = 0; row < 4; row++) {
      out[oo + col * 4 + row] =
        a[ao + row]! * b0 + a[ao + 4 + row]! * b1 + a[ao + 8 + row]! * b2 + a[ao + 12 + row]! * b3;
    }
  }
}

/** Ponto transformado (afim) em `out[oo..oo+2]`. */
export function m4TransformPoint(
  m: Float32Array,
  o: number,
  x: number,
  y: number,
  z: number,
  out: Float32Array,
  oo: number,
): void {
  out[oo] = m[o]! * x + m[o + 4]! * y + m[o + 8]! * z + m[o + 12]!;
  out[oo + 1] = m[o + 1]! * x + m[o + 5]! * y + m[o + 9]! * z + m[o + 13]!;
  out[oo + 2] = m[o + 2]! * x + m[o + 6]! * y + m[o + 10]! * z + m[o + 14]!;
}

/**
 * Inverso de uma matriz de giro + escala UNIFORME + translação aplicado a um ponto (acerto → espaço da parte). Com
 * escala não uniforme (squash do pouso) o erro é pequeno e só afeta a cor do cubinho.
 */
export function m4InverseRigidPoint(
  m: Float32Array,
  o: number,
  x: number,
  y: number,
  z: number,
  out: Float32Array,
  oo: number,
): void {
  const dx = x - m[o + 12]!;
  const dy = y - m[o + 13]!;
  const dz = z - m[o + 14]!;
  const s2 = m[o]! * m[o]! + m[o + 1]! * m[o + 1]! + m[o + 2]! * m[o + 2]!;
  const inv = s2 > 1e-12 ? 1 / s2 : 0;
  out[oo] = (m[o]! * dx + m[o + 1]! * dy + m[o + 2]! * dz) * inv;
  out[oo + 1] = (m[o + 4]! * dx + m[o + 5]! * dy + m[o + 6]! * dz) * inv;
  out[oo + 2] = (m[o + 8]! * dx + m[o + 9]! * dy + m[o + 10]! * dz) * inv;
}

/** m = T(x, y, z) · R(q) · S(s) (quatérnio unitário em q[qo..qo+3] = x, y, z, w). */
export function m4FromQuat(
  m: Float32Array,
  o: number,
  x: number,
  y: number,
  z: number,
  q: Float32Array,
  qo: number,
  s: number,
): void {
  const qx = q[qo]!;
  const qy = q[qo + 1]!;
  const qz = q[qo + 2]!;
  const qw = q[qo + 3]!;
  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;
  m[o] = (1 - (yy + zz)) * s;
  m[o + 1] = (xy + wz) * s;
  m[o + 2] = (xz - wy) * s;
  m[o + 3] = 0;
  m[o + 4] = (xy - wz) * s;
  m[o + 5] = (1 - (xx + zz)) * s;
  m[o + 6] = (yz + wx) * s;
  m[o + 7] = 0;
  m[o + 8] = (xz + wy) * s;
  m[o + 9] = (yz - wx) * s;
  m[o + 10] = (1 - (xx + yy)) * s;
  m[o + 11] = 0;
  m[o + 12] = x;
  m[o + 13] = y;
  m[o + 14] = z;
  m[o + 15] = 1;
}

// --- quatérnios (x, y, z, w) ---

export function qIdentity(q: Float32Array, o = 0): void {
  q[o] = 0;
  q[o + 1] = 0;
  q[o + 2] = 0;
  q[o + 3] = 1;
}

export function qNormalize(q: Float32Array, o = 0): void {
  const len = Math.hypot(q[o]!, q[o + 1]!, q[o + 2]!, q[o + 3]!);
  if (len < 1e-12) {
    qIdentity(q, o);
    return;
  }
  const inv = 1 / len;
  q[o] = q[o]! * inv;
  q[o + 1] = q[o + 1]! * inv;
  q[o + 2] = q[o + 2]! * inv;
  q[o + 3] = q[o + 3]! * inv;
}

/** q = Ry(yaw) (giro em torno de +Y). */
export function qFromYaw(q: Float32Array, o: number, yaw: number): void {
  q[o] = 0;
  q[o + 1] = Math.sin(yaw / 2);
  q[o + 2] = 0;
  q[o + 3] = Math.cos(yaw / 2);
}

/** Integra a velocidade angular (rad/s, eixos do mundo) por `dt`: q ← q + ½·(ω, 0)·q·dt, normalizado. */
export function qIntegrate(q: Float32Array, o: number, wx: number, wy: number, wz: number, dt: number): void {
  const qx = q[o]!;
  const qy = q[o + 1]!;
  const qz = q[o + 2]!;
  const qw = q[o + 3]!;
  const h = dt * 0.5;
  q[o] = qx + h * (wx * qw + wy * qz - wz * qy);
  q[o + 1] = qy + h * (wy * qw + wz * qx - wx * qz);
  q[o + 2] = qz + h * (wz * qw + wx * qy - wy * qx);
  q[o + 3] = qw - h * (wx * qx + wy * qy + wz * qz);
  qNormalize(q, o);
}

/**
 * Meia extensão VERTICAL (e nos outros eixos) de uma caixa orientada por q com meias medidas (hx, hy, hz): a soma de
 * |R[eixo][k]|·h[k]. É o quanto o ponto mais baixo fica abaixo do centro (contato com o chão do desmonte).
 */
export function orientedHalfExtent(
  q: Float32Array,
  o: number,
  axis: 0 | 1 | 2,
  hx: number,
  hy: number,
  hz: number,
): number {
  const x = q[o]!;
  const y = q[o + 1]!;
  const z = q[o + 2]!;
  const w = q[o + 3]!;
  // Linha `axis` da matriz de giro.
  let r0: number;
  let r1: number;
  let r2: number;
  if (axis === 0) {
    r0 = 1 - 2 * (y * y + z * z);
    r1 = 2 * (x * y - w * z);
    r2 = 2 * (x * z + w * y);
  } else if (axis === 1) {
    r0 = 2 * (x * y + w * z);
    r1 = 1 - 2 * (x * x + z * z);
    r2 = 2 * (y * z - w * x);
  } else {
    r0 = 2 * (x * z - w * y);
    r1 = 2 * (y * z + w * x);
    r2 = 1 - 2 * (x * x + y * y);
  }
  return Math.abs(r0) * hx + Math.abs(r1) * hy + Math.abs(r2) * hz;
}

/**
 * Puxa q uma fração `t` (0..1) na direção de "deitado": o eixo local mais alinhado com a vertical vai para a vertical
 * exata (a parte assenta numa face em vez de ficar equilibrada na quina). Sem alocação.
 */
export function qSettle(q: Float32Array, o: number, t: number): void {
  const x = q[o]!;
  const y = q[o + 1]!;
  const z = q[o + 2]!;
  const w = q[o + 3]!;
  // Componente Y de cada eixo local no mundo (coluna k da matriz, linha 1).
  const ax = 2 * (x * y + w * z);
  const ay = 1 - 2 * (x * x + z * z);
  const az = 2 * (y * z - w * x);
  // Eixo local (no mundo) mais vertical.
  let vx: number;
  let vy: number;
  let vz: number;
  if (Math.abs(ax) >= Math.abs(ay) && Math.abs(ax) >= Math.abs(az)) {
    vx = 1 - 2 * (y * y + z * z);
    vy = ax;
    vz = 2 * (x * z - w * y);
  } else if (Math.abs(ay) >= Math.abs(az)) {
    vx = 2 * (x * y - w * z);
    vy = ay;
    vz = 2 * (y * z + w * x);
  } else {
    vx = 2 * (x * z + w * y);
    vy = az;
    vz = 1 - 2 * (x * x + y * y);
  }
  const sign = vy >= 0 ? 1 : -1;
  // Giro mínimo de v para (0, sign, 0): eixo = v × alvo, ângulo = acos(|vy|).
  const cx = -vz * sign;
  const cz = vx * sign;
  const sinA = Math.hypot(cx, cz);
  if (sinA < 1e-5) return;
  const angle = Math.atan2(sinA, Math.abs(vy)) * Math.min(1, Math.max(0, t));
  const half = angle / 2;
  const s = Math.sin(half) / sinA;
  const rx = cx * s;
  const rz = cz * s;
  const rw = Math.cos(half);
  // q ← r · q (giro no espaço do mundo).
  q[o] = rw * x + rx * w + 0 * z - rz * y;
  q[o + 1] = rw * y + 0 * w + rz * x - rx * z;
  q[o + 2] = rw * z + rz * w + rx * y - 0 * x;
  q[o + 3] = rw * w - rx * x - 0 * y - rz * z;
  qNormalize(q, o);
}
