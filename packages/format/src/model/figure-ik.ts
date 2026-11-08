/**
 * IK de 2 ossos dos braços do boneco (decisão #56; PLANO do porte §B0 #5 e §B3). Dona: frente F1. Porte do `solveArm`
 * do FutBobo (`character.ts:4026-4095`, com `softReach` de `:2665-2668`) no caminho de peso 1, sem `Vector3`,
 * `Quaternion`, `Matrix4` nem `Euler`: só contas escalares. Roda SÓ na montagem da tabela de jogo (loading); por quadro
 * não há IK (a animação lê os ângulos da tabela).
 *
 * Espaço do tronco = o do osso `torso` do `figureFk` em px (frame do FutBobo: +x = esquerda do boneco, +z = frente),
 * com os ombros em (±6; 11,5; 0). Ângulos de saída = Euler XYZ do ombro (como o `setFromRotationMatrix(…, 'XYZ')` do
 * three) e o cotovelo (giro X, negativo = dobra para a frente). O lado esquerdo sai na convenção crua do FutBobo
 * (`shLX/shLY/shLZ/elL`) e o direito também (`shRX/shRY/shRZ/elR`): o `solveArm` já devolve o giro do osso do lado.
 *
 * Determinismo: só `Math.sqrt/acos/asin/atan2/exp` (o nx.js roda V8).
 */
import { FIGURE_JOINT } from './figure.ts';

/** Palma no osso do antebraço (`HAND_ANCHOR_Y` do FutBobo, `character.ts:2660`): dentro da mão, um pouco abaixo do meio. */
export const FIGURE_PALM_Y = -6;
/** Alcance do braço (px): ombro → cotovelo 4,9 + cotovelo → palma 6, menos o 0,001 do `longest` do FutBobo. */
export const FIGURE_ARM_REACH = FIGURE_JOINT.upperArm - FIGURE_PALM_Y - 0.001;

/**
 * Distância ombro → palma pedida, macia nos últimos 5% antes de esticar (`softReach` do FutBobo): o cotovelo não estala,
 * e a palma fica um pouco aquém do alvo (0,04 px a 97% do alcance, 0,08 px a 98%).
 */
export function figureSoftReach(distance: number, longest: number): number {
  const soft = longest * 0.95;
  return distance > soft ? soft + (longest - soft) * (1 - Math.exp((soft - distance) / (longest - soft))) : distance;
}

/**
 * Resolve o braço do lado `side` (+1 esquerdo, −1 direito) para a palma ir ao alvo (tx, ty, tz), em px no espaço do
 * tronco. Escreve [x, y, z, cotovelo] em out[o .. o+4) e devolve a distância ombro → alvo sobre o alcance
 * (`FIGURE_ARM_REACH`; > 1 = não alcança, a palma só aponta). Alvo em cima do ombro (< 1e−4 px): não escreve e devolve 0.
 *
 * O polo do cotovelo é o do FutBobo: com o braço à frente e um pouco para fora, o cotovelo aponta para baixo e para fora;
 * para outro alvo, o mesmo giro que leva o braço até ele leva o polo junto.
 */
export function figureSolveArm(
  tx: number,
  ty: number,
  tz: number,
  side: number,
  out: Float32Array | Float64Array,
  o: number,
): number {
  const upper = FIGURE_JOINT.upperArm;
  const fore = -FIGURE_PALM_Y;
  // Alvo a partir do ombro.
  let dx = tx - side * FIGURE_JOINT.shoulderX;
  let dy = ty - FIGURE_JOINT.shoulderY;
  let dz = tz;
  const raw = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (raw < 1e-4) return 0;
  dx /= raw;
  dy /= raw;
  dz /= raw;
  const longest = upper + fore - 0.001;
  let reach = figureSoftReach(raw, longest);

  // Polo: (lado·0,5; −1; 0) sem a componente da frente (lado·0,3; 0; 1), girado pelo giro frente → dir.
  const fl = Math.sqrt(0.09 + 1);
  const fx = (side * 0.3) / fl;
  const fz = 1 / fl;
  let px = side * 0.5;
  let py = -1;
  let pz = 0;
  let k = px * fx + pz * fz;
  px -= k * fx;
  pz -= k * fz;
  k = 1 / Math.sqrt(px * px + py * py + pz * pz);
  px *= k;
  py *= k;
  pz *= k;
  // Quaternion.setFromUnitVectors(frente, dir) do three.
  let qw = fx * dx + fz * dz + 1;
  let qx: number;
  let qy: number;
  let qz: number;
  if (qw < Number.EPSILON) {
    qw = 0;
    if (Math.abs(fx) > Math.abs(fz)) {
      qx = 0;
      qy = fx;
      qz = 0;
    } else {
      qx = 0;
      qy = -fz;
      qz = 0;
    }
  } else {
    // frente × dir, com frente.y = 0.
    qx = -fz * dy;
    qy = fz * dx - fx * dz;
    qz = fx * dy;
  }
  k = 1 / Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
  qx *= k;
  qy *= k;
  qz *= k;
  qw *= k;
  // Vector3.applyQuaternion do three: v + w·t + q × t, com t = 2·(q × v).
  const ux = 2 * (qy * pz - qz * py);
  const uy = 2 * (qz * px - qx * pz);
  const uz = 2 * (qx * py - qy * px);
  px = px + qw * ux + qy * uz - qz * uy;
  py = py + qw * uy + qz * ux - qx * uz;
  pz = pz + qw * uz + qx * uy - qy * ux;

  // Cotovelo pela lei dos cossenos (negativo: o antebraço dobra para a frente).
  const minReach = Math.abs(upper - fore) + 0.05;
  reach = reach < minReach ? minReach : reach > longest ? longest : reach;
  let c = (upper * upper + fore * fore - reach * reach) / (2 * upper * fore);
  c = c < -1 ? -1 : c > 1 ? 1 : c;
  const bend = Math.acos(c) - Math.PI;

  // Base sem giro: palma (com o cotovelo dobrado) e o lado do cotovelo (para baixo).
  let hx = 0;
  let hy = -upper - fore * Math.cos(bend);
  let hz = -fore * Math.sin(bend);
  k = 1 / Math.sqrt(hx * hx + hy * hy + hz * hz);
  hx *= k;
  hy *= k;
  hz *= k;
  let rx = hx * hy;
  let ry = -1 + hy * hy;
  let rz = hz * hy;
  k = 1 / Math.sqrt(rx * rx + ry * ry + rz * rz);
  rx *= k;
  ry *= k;
  rz *= k;
  const sx = hy * rz - hz * ry;
  const sy = hz * rx - hx * rz;
  const sz = hx * ry - hy * rx;

  // Base pedida: palma no alvo, cotovelo para o polo.
  k = px * dx + py * dy + pz * dz;
  px -= k * dx;
  py -= k * dy;
  pz -= k * dz;
  if (px * px + py * py + pz * pz < 1e-6) {
    px = dx * dz;
    py = dy * dz;
    pz = -1 + dz * dz;
  }
  k = 1 / Math.sqrt(px * px + py * py + pz * pz);
  px *= k;
  py *= k;
  pz *= k;
  const qsx = dy * pz - dz * py;
  const qsy = dz * px - dx * pz;
  const qsz = dx * py - dy * px;

  // Giro do ombro = base pedida × base sem giro (transposta); b<i><j> = dir_i·palma_j + polo_i·lado_j + …
  const b00 = dx * hx + px * rx + qsx * sx;
  const b01 = dx * hy + px * ry + qsx * sy;
  const b02 = dx * hz + px * rz + qsx * sz;
  const b11 = dy * hy + py * ry + qsy * sy;
  const b12 = dy * hz + py * rz + qsy * sz;
  const b21 = dz * hy + pz * ry + qsz * sy;
  const b22 = dz * hz + pz * rz + qsz * sz;
  // Euler XYZ como o setFromRotationMatrix do three.
  const y = Math.asin(b02 < -1 ? -1 : b02 > 1 ? 1 : b02);
  let x: number;
  let z: number;
  if (Math.abs(b02) < 0.9999999) {
    x = Math.atan2(-b12, b22);
    z = Math.atan2(-b01, b00);
  } else {
    x = Math.atan2(b21, b11);
    z = 0;
  }
  out[o] = x;
  out[o + 1] = y;
  out[o + 2] = z;
  out[o + 3] = bend;
  return raw / longest;
}
