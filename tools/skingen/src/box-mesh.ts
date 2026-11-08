// Geometria de revisão: caixas texturizadas no layout em cruz (`boxCrossRects` + `SKIN_FACE_AXES` do format). É a
// REFERÊNCIA de UV que o shader do programa 4 reproduz: a folha de contato do `modelgen` mostra como as caixas dos
// modelos mapeiam. O bobo de 6 partes + rosto saiu no passo 5 do porte do boneco (#56). Só para as ferramentas.
import { boxCrossRects, SKIN_FACE_AXES, type RgbaImage } from '@boboforces/format';
import { quadTris, type Tri, type Vec3 } from './raster.ts';

/** Normal de cada face na ordem de `FACE` (+X, −X, +Y, −Y, +Z, −Z). */
const FACE_NORMALS: readonly Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** Recuo da UV para dentro da face (texels). */
const UV_INSET = 1e-3;

export type Transform = (p: Vec3) => Vec3;
const identity: Transform = (p) => p;

function axisIndex(v: Vec3): 0 | 1 | 2 {
  return v[0] !== 0 ? 0 : v[1] !== 0 ? 1 : 2;
}

/**
 * Os 12 triângulos de uma caixa com UV em cruz. `min`/`size` em unidades da caixa (px de skin ou texels), `unit` =
 * metros por unidade, `inflate` em unidades por lado (não muda a UV), `uv` = canto da cruz na camada, `uvScale` =
 * texels de textura por unidade da caixa.
 */
export function boxTris(
  min: Vec3,
  size: Vec3,
  uv: readonly [number, number],
  tex: RgbaImage | null,
  options: {
    unit: number;
    inflate?: number;
    mirror?: boolean;
    transform?: Transform;
    unlit?: boolean;
    color?: number;
    uvScale?: number;
  },
): Tri[] {
  const { unit } = options;
  const inflate = options.inflate ?? 0;
  const transform = options.transform ?? identity;
  const k = options.uvScale ?? 1;
  const rects = boxCrossRects(uv[0], uv[1], size[0] * k, size[1] * k, size[2] * k);
  const s: Vec3 = [size[0] + inflate * 2, size[1] + inflate * 2, size[2] + inflate * 2];
  const c: Vec3 = [min[0] + size[0] / 2, min[1] + size[1] / 2, min[2] + size[2] / 2];
  const out: Tri[] = [];
  for (let f = 0; f < 6; f++) {
    const n = FACE_NORMALS[f]!;
    const axes = SKIN_FACE_AXES[f]!;
    const r = rects[f]!;
    const nk = axisIndex(n);
    const uk = axisIndex(axes.u);
    const vk = axisIndex(axes.v);
    if (s[nk] === 0 && n[nk]! < 0) continue; // plano: só uma das duas faces coincidentes
    const corner = (a: number, b: number): Vec3 => {
      const p: [number, number, number] = [c[0], c[1], c[2]];
      p[nk] += (n[nk]! * s[nk]) / 2;
      p[uk] += axes.u[uk]! * (a - 0.5) * s[uk];
      p[vk] += axes.v[vk]! * (b - 0.5) * s[vk];
      return transform([p[0] * unit, p[1] * unit, p[2] * unit]);
    };
    // UV recuada um milésimo de texel para dentro da face: pixel com o centro exatamente na aresta (o raster inclui as
    // arestas) lia a linha da face vizinha na cruz.
    const ua = (a: number): number => r.u + UV_INSET + (options.mirror === true ? 1 - a : a) * (r.w - 2 * UV_INSET);
    const va = (b: number): number => r.v + UV_INSET + b * (r.h - 2 * UV_INSET);
    const extra: { color?: number; unlit?: boolean } = {};
    if (options.color !== undefined) extra.color = options.color;
    if (options.unlit === true) extra.unlit = true;
    out.push(
      ...quadTris(
        [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)],
        [
          [ua(0), va(0)],
          [ua(1), va(0)],
          [ua(1), va(1)],
          [ua(0), va(1)],
        ],
        tex,
        extra,
      ),
    );
  }
  return out;
}
