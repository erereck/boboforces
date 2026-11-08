import { mipChainOffsets, TEXTURE_ARRAYS } from '@boboforces/format';
import { FONT_HEIGHT, forEachTextPixel, textWidth } from './font.ts';
import type { BuiltStrip } from './generate.ts';
import { RAMPS } from './palette.ts';
import type { RgbaImage } from './png.ts';

/**
 * Folha de contato para revisão (não vai para o jogo; fica em `local/m1/texturas.png`): a paleta mestra por rampa e,
 * para cada camada física, a camada repetida 3×3 (mostra a emenda) ampliada, a cadeia de mips e o nome. Camadas com
 * transparência ficam sobre um xadrez cinza.
 */
const BG = 0x0a0d0b;
const INK = 0xe4e1d5;
const DIM = 0x7d7f82;
const CHECK_A = 0x3a3d3b;
const CHECK_B = 0x585b59;

interface Canvas {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

function createCanvas(width: number, height: number): Canvas {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = (BG >> 16) & 0xff;
    data[i * 4 + 1] = (BG >> 8) & 0xff;
    data[i * 4 + 2] = BG & 0xff;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function put(c: Canvas, x: number, y: number, rgb: number, alpha = 255): void {
  if (x < 0 || y < 0 || x >= c.width || y >= c.height) return;
  const i = (y * c.width + x) * 4;
  const a = alpha / 255;
  c.data[i] = Math.round(((rgb >> 16) & 0xff) * a + c.data[i]! * (1 - a));
  c.data[i + 1] = Math.round(((rgb >> 8) & 0xff) * a + c.data[i + 1]! * (1 - a));
  c.data[i + 2] = Math.round((rgb & 0xff) * a + c.data[i + 2]! * (1 - a));
}

function rect(c: Canvas, x: number, y: number, w: number, h: number, rgb: number): void {
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) put(c, x + xx, y + yy, rgb);
}

function text(c: Canvas, x: number, y: number, s: string, rgb: number, scale = 2): void {
  forEachTextPixel(s, 0, 0, (px, py) => rect(c, x + px * scale, y + py * scale, scale, scale, rgb));
}

/** Desenha `img` repetida `reps`×`reps` e ampliada `scale`×, com xadrez atrás se tiver transparência. */
function blit(c: Canvas, img: RgbaImage, x: number, y: number, scale: number, reps: number, checker: boolean): void {
  const w = img.width * reps * scale;
  const h = img.height * reps * scale;
  if (checker) {
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++)
        put(c, x + xx, y + yy, (Math.floor(xx / 10) + Math.floor(yy / 10)) % 2 === 0 ? CHECK_A : CHECK_B);
  }
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const sx = Math.floor(xx / scale) % img.width;
      const sy = Math.floor(yy / scale) % img.height;
      const i = (sy * img.width + sx) * 4;
      const a = img.data[i + 3]!;
      if (a === 0) continue;
      put(c, x + xx, y + yy, (img.data[i]! << 16) | (img.data[i + 1]! << 8) | img.data[i + 2]!, a);
    }
  }
}

const GAP = 16;
const LABEL = FONT_HEIGHT * 2 + 6;

interface Section {
  readonly strip: BuiltStrip;
  readonly scale: number;
  readonly reps: number;
  readonly mipScale: number;
}

function cellSize(s: Section): { w: number; h: number } {
  const size = TEXTURE_ARRAYS[s.strip.spec.array].layerSize;
  const tile = size * s.reps * s.scale;
  const mip = (size / 2) * s.mipScale;
  return { w: tile, h: tile + 4 + mip + 4 + LABEL * 2 };
}

/** Monta a folha de contato das tiras (a primeira manda na largura). */
export function buildContactSheet(strips: readonly BuiltStrip[]): RgbaImage {
  const sections: Section[] = strips.map((strip) =>
    TEXTURE_ARRAYS[strip.spec.array].layerSize === 16
      ? { strip, scale: 3, reps: 3, mipScale: 3 }
      : { strip, scale: 1, reps: 2, mipScale: 1 },
  );
  const cols = 8;
  const first = cellSize(sections[0]!);
  const width = GAP + cols * (first.w + GAP);
  // Paleta: uma linha por rampa.
  const swatch = 20;
  const paletteHeight = RAMPS.length * (swatch + 4) + GAP;
  let height = GAP + LABEL + 8 + paletteHeight;
  for (const s of sections) {
    const cell = cellSize(s);
    const perRow = Math.max(1, Math.floor((width - GAP) / (cell.w + GAP)));
    height += LABEL + 8 + Math.ceil(s.strip.layers.length / perRow) * (cell.h + GAP);
  }
  const c = createCanvas(width, height);

  let y = GAP;
  const total = strips.map((s) => `${s.spec.file} (${s.layers.length})`).join(' + ');
  text(c, GAP, y, `BOBOFORCES TEXGEN - PALETA MESTRA (64) - ${total}`, INK);
  y += LABEL + 8;
  RAMPS.forEach((r, i) => {
    const ry = y + i * (swatch + 4);
    text(c, GAP, ry + 4, `${r.name} (${r.use})`, DIM);
    r.colors.forEach((rgb, k) => rect(c, GAP + 220 + k * (swatch + 4), ry, swatch, swatch, rgb));
  });
  y += paletteHeight;

  for (const s of sections) {
    const size = TEXTURE_ARRAYS[s.strip.spec.array].layerSize;
    const cell = cellSize(s);
    const perRow = Math.max(1, Math.floor((width - GAP) / (cell.w + GAP)));
    text(c, GAP, y, `${s.strip.spec.array}: ${s.strip.spec.file}`, INK);
    y += LABEL + 8;
    const rects = mipChainOffsets(size, TEXTURE_ARRAYS[s.strip.spec.array].mipLevels);
    s.strip.layers.forEach((layer, n) => {
      const cx = GAP + (n % perRow) * (cell.w + GAP);
      const cy = y + Math.floor(n / perRow) * (cell.h + GAP);
      const checker = layer.kind === 'cutout' || layer.kind === 'translucent';
      blit(c, layer.image, cx, cy, s.scale, s.reps, checker);
      let mx = cx;
      const my = cy + size * s.reps * s.scale + 4;
      s.strip.mips[n]!.forEach((mip, k) => {
        blit(c, mip, mx, my, s.mipScale, 1, checker);
        mx += rects[k]!.width * s.mipScale + 2;
      });
      const ly = my + (size / 2) * s.mipScale + 4;
      // Fonte 3×5 em 2×: 8 px por caractere; nome comprido é cortado na largura da célula.
      const name = textWidth(layer.name) * 2 > cell.w ? layer.name.slice(0, Math.floor(cell.w / 8)) : layer.name;
      text(c, cx, ly, name, INK);
      text(c, cx, ly + LABEL, layer.kind, DIM);
    });
    y += Math.ceil(s.strip.layers.length / perRow) * (cell.h + GAP) + LABEL;
  }
  return c;
}
