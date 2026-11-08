// Cor dos cubinhos (arte-ux.md §4.1, tecnico.md §6.6): a CPU lê o texel atingido na cópia dos arrays (bloco pela
// camada da face e pela posição, no nível 0; skin do boneco pela caixa atingida e pelo ponto do acerto, no nível 1).
// É o que faz o detrito levar "a cor do alvo" sem amostrar textura no cubinho. Sem three, sem alocação; só roda nos
// frames com impacto. A cor por parte do bobo A (`skinTexelColor`) saiu no passo 5 do porte (#56).
import { FIGURE_BOX_FIELD, FIGURE_BOX_STRIDE, SKIN_FACE_AXES } from '@boboforces/format';
import { BITANGENT_TABLE, MAX_BLOCK_ID, shapeFaceSource, TANGENT_TABLE } from '@boboforces/world';
import { m4InverseRigidPoint, MAT4 } from '../actors/math.ts';
import type { AssembledTextureArray, RenderMap } from '../types.ts';

/** Cor padrão quando não dá para ler (array ainda não subiu, camada vazia). */
export const FALLBACK_DEBRIS_COLOR = 0x9a9a92;

/** Texel (x, y) da camada no nível `level` da cópia da CPU (0xRRGGBB), ou -1 se o nível falta ou o alfa é < 0,5. */
function texel(arr: AssembledTextureArray, layer: number, level: number, x: number, y: number): number {
  const size = arr.data.width >> level;
  if (layer < 0 || layer >= arr.data.layers || size < 1) return -1;
  const px = Math.min(size - 1, Math.max(0, x | 0));
  const py = Math.min(size - 1, Math.max(0, y | 0));
  const data = arr.data.levels[level];
  if (!data) return -1;
  const o = ((layer * size + py) * size + px) * 4;
  if (data[o + 3]! < 128) return -1;
  return (data[o]! << 16) | (data[o + 1]! << 8) | data[o + 2]!;
}

const f32 = Math.fround;
const fract32 = (v: number): number => f32(v - Math.floor(v));

/**
 * O mesmo hash do shader (`bfHashF` do glsl-common, só float; integração do M1), conta a conta em float32: a variante
 * sorteada por célula bate com a da tela. Devolve 0..1.
 */
export function cellHash01(cx: number, cy: number, cz: number): number {
  const px = fract32(f32(cx * f32(0.1031)));
  const py = fract32(f32(cy * f32(0.103)));
  const pz = fract32(f32(cz * f32(0.0973)));
  // p += dot(p, p.yzx + 33.33)
  const d = f32(f32(f32(px * f32(py + f32(33.33))) + f32(py * f32(pz + f32(33.33)))) + f32(pz * f32(px + f32(33.33))));
  const qx = f32(px + d);
  const qy = f32(py + d);
  const qz = f32(pz + d);
  return fract32(f32(f32(qx + qy) * qz));
}

/** Variante sorteada da célula (a conta do `bfBlockLayer` do shader). */
export function cellVariant(cx: number, cy: number, cz: number, variants: number): number {
  return Math.min(variants - 1, Math.floor(cellHash01(cx, cy, cz) * variants));
}

function wrapTexel(k: number, size: number): number {
  return ((k % size) + size) % size;
}

function axisFaceFromNormal(nx: number, ny: number, nz: number): number {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  if (ax >= ay && ax >= az) return nx >= 0 ? 0 : 1;
  if (ay >= az) return ny >= 0 ? 2 : 3;
  return nz >= 0 ? 4 : 5;
}

/**
 * Cor do texel de bloco no ponto do tiro (m), com a face pela `NORMAL_TABLE` (ou pela normal, se -1). `du`/`dv`
 * deslocam em texels (variedade entre os cubinhos). Usa a mesma UV do shader: (p·T, p·B)·2, e a variante da célula.
 */
export function blockTexelColor(
  blocks: AssembledTextureArray | null,
  map: RenderMap | null,
  blockId: number,
  normalIndex: number,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  du: number,
  dv: number,
): number {
  if (!blocks || !map) return FALLBACK_DEBRIS_COLOR;
  const id = blockId & MAX_BLOCK_ID;
  if (id <= 0 || id >= map.blocks.size) return FALLBACK_DEBRIS_COLOR;
  const n = normalIndex >= 0 && normalIndex < TANGENT_TABLE.length ? normalIndex : axisFaceFromNormal(nx, ny, nz);
  const face = shapeFaceSource(n);
  const base = map.blockFaceLayers[id * 6 + face];
  if (base === undefined) return FALLBACK_DEBRIS_COLOR;
  const def = map.blocks.get(id);
  // Recua um quarto de texel para dentro da face: a célula e a UV são as do bloco atingido.
  const inset = 0.25 / 32;
  const px = x - nx * inset;
  const py = y - ny * inset;
  const pz = z - nz * inset;
  let layer = base;
  if (def.variants > 1) {
    const variant = cellVariant(Math.floor(px * 2), Math.floor(py * 2), Math.floor(pz * 2), def.variants);
    layer += variant * Math.max(1, def.frames);
  }
  const t = TANGENT_TABLE[n]!;
  const b = BITANGENT_TABLE[n]!;
  const u = (px * t[0] + py * t[1] + pz * t[2]) * 2;
  const v = (px * b[0] + py * b[1] + pz * b[2]) * 2;
  const size = blocks.data.width;
  const tx = Math.floor((u - Math.floor(u)) * size + du);
  const ty = Math.floor((v - Math.floor(v)) * size + dv);
  const c = texel(blocks, layer, 0, wrapTexel(tx, size), wrapTexel(ty, size));
  return c < 0 ? FALLBACK_DEBRIS_COLOR : c;
}

/** Varia o brilho da cor em ±`amount` (0..1) com `r` em 0..1: "±1 tom" das props e variedade dos cubinhos. */
export function jitterColor(rgb: number, amount: number, r: number): number {
  const k = 1 + (r * 2 - 1) * amount;
  return (scaleChannel(rgb, 16, k, 0) << 16) | (scaleChannel(rgb, 8, k, 0) << 8) | scaleChannel(rgb, 0, k, 0);
}

/** Canal escalado e misturado com branco (`toWhite` 0..1), preso em 0..255. */
function scaleChannel(rgb: number, shift: number, k: number, toWhite: number): number {
  const c = ((rgb >> shift) & 0xff) * k;
  return Math.max(0, Math.min(255, Math.round(c * (1 - toWhite) + 255 * toWhite)));
}

/** Clareia a cor em direção ao branco (poeira do impacto). */
export function lightenColor(rgb: number, t: number): number {
  return (scaleChannel(rgb, 16, 1, t) << 16) | (scaleChannel(rgb, 8, 1, t) << 8) | scaleChannel(rgb, 0, 1, t);
}

// --- Boneco do FutBobo (#56, PLANO do porte §B13) ---

const FB = FIGURE_BOX_FIELD;

/**
 * Cor do texel de uma caixa do boneco do FutBobo (gabarito em boxes[bo ..]) no ponto `q` (px no espaço do OSSO da
 * caixa). Desfaz o centro e o giro próprio (Rx·Rz), leva ao cubo da caixa e, pelo giro Ry(π) do cubo das figuras, ao
 * frame do BF: a face é a de maior |coordenada|, e o texel sai do retângulo da cruz (`boxCrossRects`, sem alocar) com os
 * eixos de `SKIN_FACE_AXES`, como no vertex shader. Medida 0 (amostra de paleta, coluna) lê o canto, onde a GPU lê.
 * Nível 1 da cópia da CPU (a camada é `skinLayer` + a camada da caixa); sem o nível 1, o nível 0.
 */
export function figureBoxTexelColor(
  models: AssembledTextureArray | null,
  skinLayer: number,
  boxes: Float32Array,
  bo: number,
  qx: number,
  qy: number,
  qz: number,
  du: number,
  dv: number,
): number {
  if (!models) return FALLBACK_DEBRIS_COLOR;
  const px = qx - boxes[bo + FB.cx]!;
  const py = qy - boxes[bo + FB.cy]!;
  const pz = qz - boxes[bo + FB.cz]!;
  const rx = boxes[bo + FB.rotX]!;
  const rz = boxes[bo + FB.rotZ]!;
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  // Rᵀ = Rzᵀ·Rxᵀ.
  const ay = cx * py + sx * pz;
  const az = -sx * py + cx * pz;
  const ax = cz * px + sz * ay;
  const by0 = -sz * px + cz * ay;
  const sxs = boxes[bo + FB.sx]!;
  const sys = boxes[bo + FB.sy]!;
  const szs = boxes[bo + FB.sz]!;
  // Cubo da caixa (−0,5..0,5) e o frame do BF: Ry(π) leva (x, y, z) a (−x, y, −z).
  const p0 = sxs > 1e-6 ? -ax / sxs : 0;
  const p1 = sys > 1e-6 ? by0 / sys : 0;
  const p2 = szs > 1e-6 ? -az / szs : 0;
  let face: number;
  if (Math.abs(p0) >= Math.abs(p1) && Math.abs(p0) >= Math.abs(p2)) face = p0 >= 0 ? 0 : 1;
  else if (Math.abs(p1) >= Math.abs(p2)) face = p1 >= 0 ? 2 : 3;
  else face = p2 >= 0 ? 4 : 5;
  const axes = SKIN_FACE_AXES[face]!;
  const fa = cubeAlong(axes.u, p0, p1, p2);
  const fb = cubeAlong(axes.v, p0, p1, p2);
  const u = boxes[bo + FB.u]!;
  const v = boxes[bo + FB.v]!;
  const w = boxes[bo + FB.w]!;
  const h = boxes[bo + FB.h]!;
  const d = boxes[bo + FB.d]!;
  // Retângulos da cruz (a mesma ordem de `boxCrossRects`): +X, −X, +Y, −Y, +Z, −Z.
  let ru = u + d;
  let rv = v + d;
  let rw = w;
  let rh = h;
  if (face === 0) {
    ru = u;
    rw = d;
  } else if (face === 1) {
    ru = u + d + w;
    rw = d;
  } else if (face === 2) {
    rv = v;
    rh = d;
  } else if (face === 3) {
    ru = u + d + w;
    rv = v;
    rh = d;
  } else if (face === 4) {
    ru = u + 2 * d + w;
  }
  const tx = rw > 0 ? ru + Math.min(rw - 1, Math.max(0, Math.floor(fa * rw + du))) : ru;
  const ty = rh > 0 ? rv + Math.min(rh - 1, Math.max(0, Math.floor(fb * rh + dv))) : rv;
  const layer = skinLayer + boxes[bo + FB.layer]!;
  const level = models.data.levels[1] ? 1 : 0;
  const c = texel(models, layer, level, level === 1 ? tx >> 1 : tx, level === 1 ? ty >> 1 : ty);
  return c < 0 ? FALLBACK_DEBRIS_COLOR : c;
}

/** Fração 0..1 ao longo de um eixo de textura no cubo (−0,5..0,5), com o sinal do eixo. */
function cubeAlong(axis: readonly [number, number, number], p0: number, p1: number, p2: number): number {
  const k = axis[0] !== 0 ? 0 : axis[1] !== 0 ? 1 : 2;
  const value = k === 0 ? p0 : k === 1 ? p1 : p2;
  const f = 0.5 + (axis[k]! > 0 ? value : -value);
  return Math.min(0.999, Math.max(0, f));
}

/**
 * Caixa atingida do osso `bone` (PLANO §B13): entre as caixas do gabarito (bloco em boxes[base ..], `count` caixas) que
 * estão nesse osso, a de menor norma máxima de (q − centro)/(meia medida), com `q` = o ponto no espaço de cada caixa pela
 * matriz da instância (matrices[(start + k)·16 ..]). Escreve o ponto (px no osso) em out[0..2] e devolve k, ou −1.
 */
export function figureHitBox(
  matrices: Float32Array,
  start: number,
  boxes: Float32Array,
  base: number,
  count: number,
  bone: number,
  x: number,
  y: number,
  z: number,
  out: Float32Array,
): number {
  let best = -1;
  let bestNorm = Infinity;
  let bx = 0;
  let by = 0;
  let bz = 0;
  for (let k = 0; k < count; k++) {
    const b = base + k * FIGURE_BOX_STRIDE;
    if (boxes[b + FB.bone] !== bone) continue;
    m4InverseRigidPoint(matrices, (start + k) * MAT4, x, y, z, out, 0);
    const hx = Math.max(1e-3, boxes[b + FB.sx]! / 2);
    const hy = Math.max(1e-3, boxes[b + FB.sy]! / 2);
    const hz = Math.max(1e-3, boxes[b + FB.sz]! / 2);
    const nx = Math.abs(out[0]! - boxes[b + FB.cx]!) / hx;
    const ny = Math.abs(out[1]! - boxes[b + FB.cy]!) / hy;
    const nz = Math.abs(out[2]! - boxes[b + FB.cz]!) / hz;
    const norm = Math.max(nx, ny, nz);
    if (norm < bestNorm) {
      bestNorm = norm;
      best = k;
      bx = out[0]!;
      by = out[1]!;
      bz = out[2]!;
    }
  }
  out[0] = bx;
  out[1] = by;
  out[2] = bz;
  return best;
}
