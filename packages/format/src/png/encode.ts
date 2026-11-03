import { zlibSync } from 'fflate';
import { crc32Update } from './crc32.ts';
import { PNG_COLOR_TYPE, PNG_MAX_SIDE, PNG_SIGNATURE, type RgbaImage } from './types.ts';

export interface PngEncodeOptions {
  /** Nível do deflate (0..9). Padrão 9: as texturas são pequenas e geradas fora do jogo. */
  readonly level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  /**
   * Grava RGB (tipo 2, 3 bytes por pixel) quando TODOS os pixels são opacos. O decodificador devolve RGBA com alfa 255
   * do mesmo jeito. Liga no atlas MSDF (RGB puro, ~6% menor); fica desligado nas texturas, onde o alfa pode existir.
   */
  readonly dropOpaqueAlpha?: boolean;
}

function writeU32(b: Uint8Array, o: number, v: number): void {
  b[o] = (v >>> 24) & 0xff;
  b[o + 1] = (v >>> 16) & 0xff;
  b[o + 2] = (v >>> 8) & 0xff;
  b[o + 3] = v & 0xff;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Valor do byte filtrado `i` da linha com o filtro `type` (0..4), lendo a imagem original (`bpp` bytes por pixel). */
function filterByte(
  data: Uint8Array,
  rowStart: number,
  prevStart: number,
  i: number,
  type: number,
  bpp: number,
): number {
  const x = data[rowStart + i]!;
  const left = i >= bpp ? data[rowStart + i - bpp]! : 0;
  const up = prevStart >= 0 ? data[prevStart + i]! : 0;
  const upLeft = prevStart >= 0 && i >= bpp ? data[prevStart + i - bpp]! : 0;
  switch (type) {
    case 1:
      return (x - left) & 0xff;
    case 2:
      return (x - up) & 0xff;
    case 3:
      return (x - ((left + up) >>> 1)) & 0xff;
    case 4:
      return (x - paeth(left, up, upLeft)) & 0xff;
    default:
      return x;
  }
}

/**
 * Codificador PNG mínimo: RGBA8, sem entrelaçamento, só os chunks IHDR, IDAT e IEND (sem data, gama ou texto, para a
 * saída ser idêntica byte a byte entre máquinas). Escolhe o filtro de cada linha pela heurística da soma mínima
 * (especificação PNG §12.8). Determinístico: a mesma imagem sempre gera os mesmos bytes.
 */
export function encodePng(image: RgbaImage, options: PngEncodeOptions = {}): Uint8Array {
  const { width, height, data } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`PNG: dimensões inválidas (${width}×${height})`);
  }
  if (width > PNG_MAX_SIDE || height > PNG_MAX_SIDE) throw new Error(`PNG: lado acima de ${PNG_MAX_SIDE}`);
  if (data.length !== width * height * 4) throw new Error('PNG: data precisa ter width × height × 4 bytes');

  let opaque = options.dropOpaqueAlpha === true;
  for (let i = 3; opaque && i < data.length; i += 4) if (data[i] !== 255) opaque = false;
  const bpp = opaque ? 3 : 4;
  let pixels = data;
  if (opaque) {
    pixels = new Uint8Array(width * height * 3);
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
      pixels[j] = data[i]!;
      pixels[j + 1] = data[i + 1]!;
      pixels[j + 2] = data[i + 2]!;
    }
  }
  const rowBytes = width * bpp;
  const raw = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowBytes;
    const prevStart = y > 0 ? rowStart - rowBytes : -1;
    let best = 0;
    let bestScore = Infinity;
    for (let type = 0; type <= 4; type++) {
      let score = 0;
      for (let i = 0; i < rowBytes && score < bestScore; i++) {
        const v = filterByte(pixels, rowStart, prevStart, i, type, bpp);
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        best = type;
      }
    }
    const out = y * (rowBytes + 1);
    raw[out] = best;
    for (let i = 0; i < rowBytes; i++) raw[out + 1 + i] = filterByte(pixels, rowStart, prevStart, i, best, bpp);
  }
  const idat = zlibSync(raw, { level: options.level ?? 9 });

  const total = PNG_SIGNATURE.length + (12 + 13) + (12 + idat.length) + 12;
  const png = new Uint8Array(total);
  png.set(PNG_SIGNATURE, 0);
  let o = PNG_SIGNATURE.length;
  const chunk = (name: string, body: Uint8Array): void => {
    writeU32(png, o, body.length);
    for (let i = 0; i < 4; i++) png[o + 4 + i] = name.charCodeAt(i);
    png.set(body, o + 8);
    const crc = (crc32Update(0xffffffff, png, o + 4, o + 8 + body.length) ^ 0xffffffff) >>> 0;
    writeU32(png, o + 8 + body.length, crc);
    o += 12 + body.length;
  };
  const ihdr = new Uint8Array(13);
  writeU32(ihdr, 0, width);
  writeU32(ihdr, 4, height);
  ihdr[8] = 8;
  ihdr[9] = opaque ? PNG_COLOR_TYPE.rgb : PNG_COLOR_TYPE.rgba;
  // compressão 0, filtro 0, sem entrelaçamento: já são zero.
  chunk('IHDR', ihdr);
  chunk('IDAT', idat);
  chunk('IEND', new Uint8Array(0));
  return png;
}
