// Cubo unitário das figuras (#56, PLANO do porte §B10), a escrita dos dados de uma instância de caixa e o GÊMEO em JS
// do vertex shader do programa 4 (`shader.ts`) para as caixas: a mesma conta, em float32, para os testes (E.7), a
// sonda do Eden (`figure-probe.ts`) e os cubinhos. Sem three, sem DOM.
//
// O cubo é o `addTexturedBox` do BF girado Ry(π): a "frente −Z" do BF cai no +z do FutBobo (a frente do boneco) e a
// "+X direita" cai em −x do FutBobo (a direita do boneco, porque o +x do FutBobo é a esquerda). A UV de todo vértice é
// u = u0 + aw·w + ad·d e v = v0 + bh·h + bd·d com coeficientes inteiros 0..2 por vértice (o h nunca entra no u e o w
// nunca entra no v); o cubo guarda (aw + 3·ad, bh + 3·bd) no `uv`, e a instância leva o canto e as medidas.
import { FIGURE_BOX_FIELD, FIGURE_BOX_FLAG } from '@boboforces/format';
import { addTexturedBox, GeometryBuilder, type GeometryArrays, type TexturedBox } from './geometry.ts';
import { FIGURE_INST, LAYER_FROM_INSTANCE, VERT_COMPONENTS, VERTEX_FLAG } from './layout.ts';

/** Vértices e índices do cubo (6 faces × 4 e 6 × 6). */
export const FIGURE_CUBE_VERTICES = 24;
export const FIGURE_CUBE_INDICES = 36;

function unitBox(tex: readonly [number, number, number]): GeometryArrays {
  const b = new GeometryBuilder();
  const box: TexturedBox = {
    min: [-0.5, -0.5, -0.5],
    size: [1, 1, 1],
    inflate: 0,
    tex,
    uv: [0, 0],
    layerSize: 1,
    mirror: false,
  };
  addTexturedBox(b, box, { layer: LAYER_FROM_INSTANCE, flags: VERTEX_FLAG.box });
  return b.build();
}

/**
 * O cubo das figuras: posição em −0,5..0,5 (frame do FutBobo), normal, `uv` = (aw + 3·ad, bh + 3·bd) e
 * `aVert` = (−1, box [+ face na frente], 0, −1). Os coeficientes saem do próprio `addTexturedBox` com medidas
 * unitárias (w, h e d separados), então o cubo nunca sai de sincronia com a cruz dos modelos.
 */
export function buildFigureCubeGeometry(): GeometryArrays {
  const byW = unitBox([1, 0, 0]);
  const byH = unitBox([0, 1, 0]);
  const byD = unitBox([0, 0, 1]);
  const n = byW.vertexCount;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const uvs = new Float32Array(n * 2);
  const verts = new Float32Array(n * VERT_COMPONENTS);
  for (let k = 0; k < n; k++) {
    // Ry(π): (x, y, z) → (−x, y, −z), na posição e na normal (giro, não espelho: o sentido dos triângulos fica).
    positions[k * 3] = -byW.positions[k * 3]!;
    positions[k * 3 + 1] = byW.positions[k * 3 + 1]!;
    positions[k * 3 + 2] = -byW.positions[k * 3 + 2]!;
    const nz = -byW.normals[k * 3 + 2]!;
    normals[k * 3] = -byW.normals[k * 3]!;
    normals[k * 3 + 1] = byW.normals[k * 3 + 1]!;
    normals[k * 3 + 2] = nz;
    const aw = byW.uvs[k * 2]!;
    const ad = byD.uvs[k * 2]!;
    const bh = byH.uvs[k * 2 + 1]!;
    const bd = byD.uvs[k * 2 + 1]!;
    uvs[k * 2] = aw + 3 * ad;
    uvs[k * 2 + 1] = bh + 3 * bd;
    verts[k * VERT_COMPONENTS] = LAYER_FROM_INSTANCE;
    verts[k * VERT_COMPONENTS + 1] = VERTEX_FLAG.box + (nz > 0.5 ? VERTEX_FLAG.face : 0);
    verts[k * VERT_COMPONENTS + 2] = 0;
    verts[k * VERT_COMPONENTS + 3] = -1;
  }
  return {
    positions,
    normals,
    uvs,
    verts,
    indices: byW.indices,
    vertexCount: n,
    indexCount: byW.indexCount,
  };
}

/**
 * Escreve a caixa do gabarito (`FIGURE_BOX_FIELD` em boxes[bo ..]) nos 16 floats da instância (`FIGURE_INST`) em
 * data[o ..]: camada absoluta, canto e medidas empacotados, slot, centro, flags, cos/sen do giro e tamanho. Só no
 * evento (ator entra, troca de gabarito, skin ou slot), nunca por quadro.
 */
export function writeFigureBoxData(
  data: Float32Array,
  o: number,
  boxes: Float32Array,
  bo: number,
  skinLayer: number,
  slot: number,
): void {
  const F = FIGURE_BOX_FIELD;
  const I = FIGURE_INST;
  const rx = boxes[bo + F.rotX]!;
  const rz = boxes[bo + F.rotZ]!;
  data[o + I.layer] = skinLayer + boxes[bo + F.layer]!;
  data[o + I.corner] = boxes[bo + F.u]! + 64 * boxes[bo + F.v]!;
  data[o + I.dims] = boxes[bo + F.w]! + 64 * boxes[bo + F.h]! + 4096 * boxes[bo + F.d]!;
  data[o + I.slot] = slot;
  data[o + I.cx] = boxes[bo + F.cx]!;
  data[o + I.cy] = boxes[bo + F.cy]!;
  data[o + I.cz] = boxes[bo + F.cz]!;
  data[o + I.flags] = boxes[bo + F.flags]!;
  data[o + I.cosX] = rx === 0 ? 1 : Math.cos(rx);
  data[o + I.sinX] = rx === 0 ? 0 : Math.sin(rx);
  data[o + I.cosZ] = rz === 0 ? 1 : Math.cos(rz);
  data[o + I.sinZ] = rz === 0 ? 0 : Math.sin(rz);
  data[o + I.sx] = boxes[bo + F.sx]!;
  data[o + I.sy] = boxes[bo + F.sy]!;
  data[o + I.sz] = boxes[bo + F.sz]!;
  data[o + 15] = 0;
}

// --- gêmeo do vertex shader (float32, conta a conta) ---

const f32 = Math.fround;

/** floor((x + 0,5) / n) em float32: o quociente do desempacotamento do VS. */
export function figureQuotient(x: number, n: number): number {
  return Math.floor(f32(f32(x + 0.5) / n));
}

/**
 * Texel (u, v) ANTES da divisão por 64 do vértice `k` do cubo para a caixa da instância data[o ..] e a expressão `e`
 * (0..7, a da 4ª linha), em out[oo], out[oo + 1]. Mesma conta do VS, em float32.
 */
export function figureVertexTexel(
  cube: GeometryArrays,
  k: number,
  data: Float32Array,
  o: number,
  expression: number,
  out: Float32Array,
  oo: number,
): void {
  const I = FIGURE_INST;
  const corner = data[o + I.corner]!;
  const dims = data[o + I.dims]!;
  const v0 = figureQuotient(corner, 64);
  const u0 = f32(corner - f32(v0 * 64));
  const dd = figureQuotient(dims, 4096);
  const rr = f32(dims - f32(dd * 4096));
  const dh = figureQuotient(rr, 64);
  const dw = f32(rr - f32(dh * 64));
  const ux = cube.uvs[k * 2]!;
  const uy = cube.uvs[k * 2 + 1]!;
  const ad = figureQuotient(ux, 3);
  const bd = figureQuotient(uy, 3);
  let tu = f32(f32(u0 + f32(f32(ux - f32(3 * ad)) * dw)) + f32(ad * dd));
  let tv = f32(f32(v0 + f32(f32(uy - f32(3 * bd)) * dh)) + f32(bd * dd));
  if (dw + dd <= 0.5) tu = f32(tu + 0.5);
  if (dh + dd <= 0.5) tv = f32(tv + 0.5);
  const flags = Math.round(cube.verts[k * VERT_COMPONENTS + 1]!);
  const boxFlags = Math.round(data[o + I.flags]!);
  if ((boxFlags & FIGURE_BOX_FLAG.face) !== 0 && (flags & VERTEX_FLAG.face) !== 0) {
    const hi = expression >= 3.5 ? 1 : 0;
    tu = f32(tu + f32(f32(16 * f32(expression - 4 * hi)) - 16));
    tv = f32(tv + f32(16 + 16 * hi));
  }
  out[oo] = tu;
  out[oo + 1] = tv;
}

/**
 * Posição do vértice `k` no espaço do osso (px): centro + Rx·Rz·(posição·tamanho), e a normal girada, como no VS, em
 * out[oo .. oo + 6) (posição, normal).
 */
export function figureVertexLocal(
  cube: GeometryArrays,
  k: number,
  data: Float32Array,
  o: number,
  out: Float32Array,
  oo: number,
): void {
  const I = FIGURE_INST;
  const cx = data[o + I.cosX]!;
  const sx = data[o + I.sinX]!;
  const cz = data[o + I.cosZ]!;
  const sz = data[o + I.sinZ]!;
  const qx = f32(cube.positions[k * 3]! * data[o + I.sx]!);
  const qy = f32(cube.positions[k * 3 + 1]! * data[o + I.sy]!);
  const qz = f32(cube.positions[k * 3 + 2]! * data[o + I.sz]!);
  const rx = f32(f32(cz * qx) - f32(sz * qy));
  const ry = f32(f32(sz * qx) + f32(cz * qy));
  out[oo] = f32(data[o + I.cx]! + rx);
  out[oo + 1] = f32(data[o + I.cy]! + f32(f32(cx * ry) - f32(sx * qz)));
  out[oo + 2] = f32(data[o + I.cz]! + f32(f32(sx * ry) + f32(cx * qz)));
  const nx = cube.normals[k * 3]!;
  const ny = cube.normals[k * 3 + 1]!;
  const nz = cube.normals[k * 3 + 2]!;
  const mx = f32(f32(cz * nx) - f32(sz * ny));
  const my = f32(f32(sz * nx) + f32(cz * ny));
  out[oo + 3] = mx;
  out[oo + 4] = f32(f32(cx * my) - f32(sx * nz));
  out[oo + 5] = f32(f32(sx * my) + f32(cx * nz));
}
