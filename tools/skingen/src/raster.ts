// Rasterizador por software, SÓ para as folhas de contato de revisão (local/m1/skins.png e modelos.png): projeção
// ortográfica, z-buffer, textura nearest com alfa de recorte e luz chapada por face. Não vai para o jogo.
import type { RgbaImage } from '@boboforces/format';
import { createImage } from './strip.ts';

export type Vec3 = readonly [number, number, number];

export interface Target {
  readonly width: number;
  readonly height: number;
  readonly color: Uint8Array;
  readonly depth: Float32Array;
}

export function createTarget(width: number, height: number, background: number): Target {
  const color = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    color[i * 4] = (background >> 16) & 0xff;
    color[i * 4 + 1] = (background >> 8) & 0xff;
    color[i * 4 + 2] = background & 0xff;
    color[i * 4 + 3] = 255;
  }
  return { width, height, color, depth: new Float32Array(width * height).fill(-Infinity) };
}

export function targetImage(t: Target): RgbaImage {
  return { width: t.width, height: t.height, data: t.color };
}

/** Câmera ortográfica: `dir` aponta do objeto para a câmera; `scale` em px por metro; `cx`/`cy` = origem na tela. */
export interface Camera {
  readonly right: Vec3;
  readonly up: Vec3;
  readonly toward: Vec3;
  readonly scale: number;
  readonly cx: number;
  readonly cy: number;
}

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function camera(dir: Vec3, scale: number, cx: number, cy: number): Camera {
  const toward = norm(dir);
  const forward: Vec3 = [-toward[0], -toward[1], -toward[2]];
  const right = norm(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  return { right, up, toward, scale, cx, cy };
}

/** Câmeras de revisão: frente (o bobo olha para -Z), costas, isométrica pela frente-direita e lateral (+X). */
export const VIEW = {
  front: [0, 0, -1] as Vec3,
  back: [0, 0, 1] as Vec3,
  iso: [0.75, 0.62, -1] as Vec3,
  isoBack: [-0.75, 0.62, 1] as Vec3,
  side: [1, 0, 0] as Vec3,
  left: [-1, 0, 0] as Vec3,
} as const;

const LIGHT = norm([0.45, 1, -0.6]);

export interface Tri {
  readonly p: readonly [Vec3, Vec3, Vec3];
  /** UV em texels da camada (0..64). */
  readonly uv: readonly [readonly [number, number], readonly [number, number], readonly [number, number]];
  readonly tex: RgbaImage | null;
  /** Cor sólida quando não há textura. */
  readonly color?: number;
  /** Desenha sem luz (emissivo). */
  readonly unlit?: boolean;
}

function edge(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

/** Desenha um triângulo (frente e verso; o teste de profundidade resolve). */
export function drawTri(t: Target, cam: Camera, tri: Tri): void {
  const s = tri.p.map((p) => [
    cam.cx + dot(p, cam.right) * cam.scale,
    cam.cy - dot(p, cam.up) * cam.scale,
    dot(p, cam.toward),
  ]) as [number, number, number][];
  const [a, b, c] = s as [[number, number, number], [number, number, number], [number, number, number]];
  const area = edge(a[0], a[1], b[0], b[1], c[0], c[1]);
  if (Math.abs(area) < 1e-9) return;
  const n = norm(
    cross(
      [tri.p[1][0] - tri.p[0][0], tri.p[1][1] - tri.p[0][1], tri.p[1][2] - tri.p[0][2]],
      [tri.p[2][0] - tri.p[0][0], tri.p[2][1] - tri.p[0][1], tri.p[2][2] - tri.p[0][2]],
    ),
  );
  // Normal virada para a câmera (o verso da lona e dos planos também recebe luz).
  const facing = dot(n, cam.toward) < 0 ? -1 : 1;
  const lit = Math.max(0, facing * dot(n, LIGHT));
  const shade = tri.unlit === true ? 1 : 0.58 + 0.42 * lit;
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const x1 = Math.min(t.width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const y1 = Math.min(t.height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const w0 = edge(b[0], b[1], c[0], c[1], px, py) / area;
      const w1 = edge(c[0], c[1], a[0], a[1], px, py) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const z = a[2] * w0 + b[2] * w1 + c[2] * w2;
      const di = y * t.width + x;
      if (z <= t.depth[di]!) continue;
      let r: number;
      let g: number;
      let bl: number;
      if (tri.tex !== null) {
        const u = tri.uv[0][0] * w0 + tri.uv[1][0] * w1 + tri.uv[2][0] * w2;
        const v = tri.uv[0][1] * w0 + tri.uv[1][1] * w1 + tri.uv[2][1] * w2;
        const tx = Math.max(0, Math.min(tri.tex.width - 1, Math.floor(u)));
        const ty = Math.max(0, Math.min(tri.tex.height - 1, Math.floor(v)));
        const ti = (ty * tri.tex.width + tx) * 4;
        if (tri.tex.data[ti + 3]! < 128) continue;
        r = tri.tex.data[ti]!;
        g = tri.tex.data[ti + 1]!;
        bl = tri.tex.data[ti + 2]!;
      } else {
        const col = tri.color ?? 0xff00ff;
        r = (col >> 16) & 0xff;
        g = (col >> 8) & 0xff;
        bl = col & 0xff;
      }
      t.depth[di] = z;
      t.color[di * 4] = Math.min(255, Math.round(r * shade));
      t.color[di * 4 + 1] = Math.min(255, Math.round(g * shade));
      t.color[di * 4 + 2] = Math.min(255, Math.round(bl * shade));
    }
  }
}

/** Uma face de caixa como 2 triângulos: cantos no sentido da UV (0,0) (1,0) (1,1) (0,1). */
export function quadTris(
  corners: readonly [Vec3, Vec3, Vec3, Vec3],
  uvs: readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ],
  tex: RgbaImage | null,
  extra: { readonly color?: number; readonly unlit?: boolean } = {},
): Tri[] {
  return [
    { p: [corners[0], corners[1], corners[2]], uv: [uvs[0], uvs[1], uvs[2]], tex, ...extra },
    { p: [corners[0], corners[2], corners[3]], uv: [uvs[0], uvs[2], uvs[3]], tex, ...extra },
  ];
}

/** Copia uma imagem para outra, ampliada `scale` vezes (nearest), com alfa de recorte. */
export function blit(dst: Target, src: RgbaImage, x0: number, y0: number, scale = 1): void {
  for (let y = 0; y < src.height * scale; y++) {
    for (let x = 0; x < src.width * scale; x++) {
      const dx = x0 + x;
      const dy = y0 + y;
      if (dx < 0 || dy < 0 || dx >= dst.width || dy >= dst.height) continue;
      const si = (Math.floor(y / scale) * src.width + Math.floor(x / scale)) * 4;
      if (src.data[si + 3]! < 128) continue;
      dst.color.set(src.data.subarray(si, si + 3), (dy * dst.width + dx) * 4);
    }
  }
}

/** Retângulo sólido (fundo de células e de amostras de cor). */
export function fillRect(dst: Target, x0: number, y0: number, w: number, h: number, rgb: number): void {
  for (let y = Math.max(0, y0); y < Math.min(dst.height, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(dst.width, x0 + w); x++) {
      const i = (y * dst.width + x) * 4;
      dst.color[i] = (rgb >> 16) & 0xff;
      dst.color[i + 1] = (rgb >> 8) & 0xff;
      dst.color[i + 2] = rgb & 0xff;
    }
  }
}

/** Xadrez de fundo (mostra o transparente nas camadas ampliadas). */
export function checker(dst: Target, x0: number, y0: number, w: number, h: number, cell: number): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dark = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      fillRect(dst, x0 + x, y0 + y, 1, 1, dark ? 0x2b2f36 : 0x353a42);
    }
  }
}

/** Limpa só a profundidade (cada célula da folha tem a sua cena). */
export function clearDepth(t: Target): void {
  t.depth.fill(-Infinity);
}

/** Fonte 3×5 em caixa alta para os rótulos da folha (sem acento; `?` para o que faltar). */
const GLYPHS: Readonly<Record<string, string>> = {
  A: '010101111101101',
  B: '110101110101110',
  C: '011100100100011',
  D: '110101101101110',
  E: '111100110100111',
  F: '111100110100100',
  G: '011100101101011',
  H: '101101111101101',
  I: '111010010010111',
  J: '001001001101010',
  K: '101101110101101',
  L: '100100100100111',
  M: '101111111101101',
  N: '110101101101101',
  O: '010101101101010',
  P: '110101110100100',
  Q: '010101101110011',
  R: '110101110101101',
  S: '011100010001110',
  T: '111010010010010',
  U: '101101101101111',
  V: '101101101101010',
  W: '101101111111101',
  X: '101101010101101',
  Y: '101101010010010',
  Z: '111001010100111',
  '0': '111101101101111',
  '1': '010110010010111',
  '2': '110001010100111',
  '3': '110001010001110',
  '4': '101101111001001',
  '5': '111100110001110',
  '6': '011100111101111',
  '7': '111001010010010',
  '8': '111101111101111',
  '9': '111101111001110',
  '-': '000000111000000',
  '.': '000000000000010',
  ':': '000010000010000',
  '/': '001001010100100',
  '(': '010100100100010',
  ')': '010001001001010',
  '+': '000010111010000',
  ',': '000000000010100',
  '?': '110001010000010',
  '>': '100010001010100',
  '<': '001010100010001',
  '=': '000111000111000',
  '%': '101001010100101',
  _: '000000000000111',
  '!': '010010010000010',
  ';': '000010000010100',
  ' ': '000000000000000',
};

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Escreve um rótulo (fonte 3×5 ampliada `scale` vezes). Devolve a largura em px. */
export function label(dst: Target, text: string, x0: number, y0: number, rgb = 0xe2e0d6, scale = 2): number {
  let x = x0;
  for (const ch of stripAccents(text).toUpperCase()) {
    const g = GLYPHS[ch] ?? GLYPHS['?']!;
    for (let i = 0; i < 15; i++) {
      if (g[i] === '1') fillRect(dst, x + (i % 3) * scale, y0 + Math.floor(i / 3) * scale, scale, scale, rgb);
    }
    x += 4 * scale;
  }
  return x - x0;
}

/** Recorta uma área do alvo como imagem (para a silhueta em escala real). */
export function crop(t: Target, x0: number, y0: number, w: number, h: number): RgbaImage {
  const out = createImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((y0 + y) * t.width + x0 + x) * 4;
      out.data.set(t.color.subarray(si, si + 4), (y * w + x) * 4);
    }
  }
  return out;
}
