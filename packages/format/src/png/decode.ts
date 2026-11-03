import { unzlibSync } from 'fflate';
import { crc32Update } from './crc32.ts';
import { PNG_COLOR_TYPE, PNG_MAX_SIDE, PNG_SIGNATURE, type RgbaImage } from './types.ts';

/** Imagem decodificada em RGBA8, linha a linha de cima para baixo. */
export type DecodedImage = RgbaImage;

export class PngError extends Error {
  override name = 'PngError';
}

interface Header {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  /** Amostras por pixel (1 cinza, 2 cinza+alfa, 3 RGB, 4 RGBA; paleta = 1). */
  channels: number;
}

function readU32(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}

function chunkName(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
}

const CHANNELS: Readonly<Record<number, number>> = {
  [PNG_COLOR_TYPE.gray]: 1,
  [PNG_COLOR_TYPE.rgb]: 3,
  [PNG_COLOR_TYPE.palette]: 1,
  [PNG_COLOR_TYPE.grayAlpha]: 2,
  [PNG_COLOR_TYPE.rgba]: 4,
};

/** Profundidades válidas por tipo de cor (especificação PNG, tabela 11.1). */
const VALID_DEPTHS: Readonly<Record<number, readonly number[]>> = {
  [PNG_COLOR_TYPE.gray]: [1, 2, 4, 8, 16],
  [PNG_COLOR_TYPE.rgb]: [8, 16],
  [PNG_COLOR_TYPE.palette]: [1, 2, 4, 8],
  [PNG_COLOR_TYPE.grayAlpha]: [8, 16],
  [PNG_COLOR_TYPE.rgba]: [8, 16],
};

function parseHeader(b: Uint8Array, o: number, length: number): Header {
  if (length !== 13) throw new PngError('PNG: IHDR com tamanho inválido');
  const width = readU32(b, o);
  const height = readU32(b, o + 4);
  const bitDepth = b[o + 8]!;
  const colorType = b[o + 9]!;
  const compression = b[o + 10]!;
  const filter = b[o + 11]!;
  const interlace = b[o + 12]!;
  if (width === 0 || height === 0 || width > PNG_MAX_SIDE || height > PNG_MAX_SIDE) {
    throw new PngError(`PNG: dimensões fora do limite (${width}×${height})`);
  }
  const depths = VALID_DEPTHS[colorType];
  if (!depths) throw new PngError(`PNG: tipo de cor ${colorType} inválido`);
  if (!depths.includes(bitDepth)) throw new PngError(`PNG: profundidade ${bitDepth} inválida para o tipo ${colorType}`);
  if (compression !== 0 || filter !== 0) throw new PngError('PNG: método de compressão/filtro desconhecido');
  if (interlace !== 0)
    throw new PngError('PNG: imagem entrelaçada (Adam7) não é suportada; exporte sem entrelaçamento');
  return { width, height, bitDepth, colorType, channels: CHANNELS[colorType]! };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Desfaz os filtros por linha no próprio buffer (cada linha continua precedida do byte de filtro). */
function unfilter(raw: Uint8Array, height: number, rowBytes: number, bpp: number): void {
  let prev = -1;
  for (let y = 0; y < height; y++) {
    const start = y * (rowBytes + 1);
    const type = raw[start]!;
    const row = start + 1;
    switch (type) {
      case 0:
        break;
      case 1:
        for (let i = bpp; i < rowBytes; i++) raw[row + i] = (raw[row + i]! + raw[row + i - bpp]!) & 0xff;
        break;
      case 2:
        if (prev >= 0) for (let i = 0; i < rowBytes; i++) raw[row + i] = (raw[row + i]! + raw[prev + i]!) & 0xff;
        break;
      case 3:
        for (let i = 0; i < rowBytes; i++) {
          const left = i >= bpp ? raw[row + i - bpp]! : 0;
          const up = prev >= 0 ? raw[prev + i]! : 0;
          raw[row + i] = (raw[row + i]! + ((left + up) >>> 1)) & 0xff;
        }
        break;
      case 4:
        for (let i = 0; i < rowBytes; i++) {
          const left = i >= bpp ? raw[row + i - bpp]! : 0;
          const up = prev >= 0 ? raw[prev + i]! : 0;
          const upLeft = prev >= 0 && i >= bpp ? raw[prev + i - bpp]! : 0;
          raw[row + i] = (raw[row + i]! + paeth(left, up, upLeft)) & 0xff;
        }
        break;
      default:
        throw new PngError(`PNG: filtro de linha ${type} inválido (linha ${y})`);
    }
    prev = row;
  }
}

/**
 * Decodificador PNG próprio sobre o inflate do fflate (tecnico.md §6.1): as texturas não dependem de `Image`,
 * `ImageBitmap`, `OffscreenCanvas` nem `getImageData`, e funcionam igual na web, no Switch e nas tools.
 *
 * Aceita todos os tipos de cor e profundidades do PNG sem entrelaçamento (o gerador do projeto só escreve RGBA8) e
 * sempre devolve RGBA8. 16 bits por amostra são reduzidos para 8 (byte alto). Confere o CRC de cada chunk.
 */
export function decodePng(bytes: Uint8Array): DecodedImage {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new PngError('PNG: assinatura inválida');
  }
  let header: Header | null = null;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let idatLength = 0;
  let ended = false;
  let o = PNG_SIGNATURE.length;
  while (o + 12 <= bytes.length) {
    const length = readU32(bytes, o);
    const typeAt = o + 4;
    const dataAt = o + 8;
    const end = dataAt + length;
    if (end + 4 > bytes.length) throw new PngError('PNG: chunk truncado');
    const name = chunkName(bytes, typeAt);
    const crc = (crc32Update(0xffffffff, bytes, typeAt, end) ^ 0xffffffff) >>> 0;
    if (crc !== readU32(bytes, end)) throw new PngError(`PNG: CRC inválido no chunk ${name}`);
    if (header === null && name !== 'IHDR') throw new PngError('PNG: IHDR precisa ser o primeiro chunk');
    if (name === 'IHDR') header = parseHeader(bytes, dataAt, length);
    else if (name === 'PLTE') palette = bytes.subarray(dataAt, end);
    else if (name === 'tRNS') transparency = bytes.subarray(dataAt, end);
    else if (name === 'IDAT') {
      idat.push(bytes.subarray(dataAt, end));
      idatLength += length;
    } else if (name === 'IEND') {
      ended = true;
      break;
    } else if ((bytes[typeAt]! & 0x20) === 0) {
      // Primeira letra maiúscula = chunk crítico: não dá para ignorar com segurança.
      throw new PngError(`PNG: chunk crítico desconhecido ${name}`);
    }
    o = end + 4;
  }
  if (!header) throw new PngError('PNG: sem IHDR');
  if (!ended) throw new PngError('PNG: sem IEND (arquivo truncado)');
  if (idatLength === 0) throw new PngError('PNG: sem dados de imagem (IDAT)');
  if (header.colorType === PNG_COLOR_TYPE.palette && !palette) throw new PngError('PNG: imagem com paleta sem PLTE');

  let compressed: Uint8Array;
  if (idat.length === 1) compressed = idat[0]!;
  else {
    compressed = new Uint8Array(idatLength);
    let at = 0;
    for (const part of idat) {
      compressed.set(part, at);
      at += part.length;
    }
  }

  const { width, height, bitDepth, channels } = header;
  const bitsPerPixel = bitDepth * channels;
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const expected = (rowBytes + 1) * height;
  let raw: Uint8Array;
  try {
    raw = unzlibSync(compressed, { out: new Uint8Array(expected) });
  } catch (e) {
    throw new PngError(`PNG: falha no inflate (${e instanceof Error ? e.message : String(e)})`);
  }
  if (raw.length !== expected) throw new PngError('PNG: dados de imagem com tamanho inesperado');
  unfilter(raw, height, rowBytes, bpp);
  return { width, height, data: expand(raw, header, rowBytes, palette, transparency) };
}

/** Converte as linhas já sem filtro para RGBA8. */
function expand(
  raw: Uint8Array,
  h: Header,
  rowBytes: number,
  palette: Uint8Array | null,
  trns: Uint8Array | null,
): Uint8Array {
  const { width, height, bitDepth, colorType } = h;
  const out = new Uint8Array(width * height * 4);
  const wide = bitDepth === 16;
  const maxSample = (1 << bitDepth) - 1;
  // Chave de transparência (tRNS) dos tipos cinza e RGB, comparada no valor da amostra original.
  const keyGray = trns && colorType === PNG_COLOR_TYPE.gray && trns.length >= 2 ? (trns[0]! << 8) | trns[1]! : -1;
  const keyRgb =
    trns && colorType === PNG_COLOR_TYPE.rgb && trns.length >= 6
      ? [(trns[0]! << 8) | trns[1]!, (trns[2]! << 8) | trns[3]!, (trns[4]! << 8) | trns[5]!]
      : null;
  const paletteSize = palette ? Math.floor(palette.length / 3) : 0;

  for (let y = 0; y < height; y++) {
    const row = y * (rowBytes + 1) + 1;
    let p = y * width * 4;
    for (let x = 0; x < width; x++, p += 4) {
      if (colorType === PNG_COLOR_TYPE.rgba || colorType === PNG_COLOR_TYPE.rgb) {
        const n = colorType === PNG_COLOR_TYPE.rgba ? 4 : 3;
        const s = row + x * n * (wide ? 2 : 1);
        if (wide) {
          const r = (raw[s]! << 8) | raw[s + 1]!;
          const g = (raw[s + 2]! << 8) | raw[s + 3]!;
          const b = (raw[s + 4]! << 8) | raw[s + 5]!;
          out[p] = raw[s]!;
          out[p + 1] = raw[s + 2]!;
          out[p + 2] = raw[s + 4]!;
          if (n === 4) out[p + 3] = raw[s + 6]!;
          else out[p + 3] = keyRgb && r === keyRgb[0] && g === keyRgb[1] && b === keyRgb[2] ? 0 : 255;
        } else {
          out[p] = raw[s]!;
          out[p + 1] = raw[s + 1]!;
          out[p + 2] = raw[s + 2]!;
          if (n === 4) out[p + 3] = raw[s + 3]!;
          else
            out[p + 3] =
              keyRgb && raw[s] === keyRgb[0] && raw[s + 1] === keyRgb[1] && raw[s + 2] === keyRgb[2] ? 0 : 255;
        }
      } else if (colorType === PNG_COLOR_TYPE.grayAlpha) {
        const s = row + x * (wide ? 4 : 2);
        const g = raw[s]!;
        out[p] = g;
        out[p + 1] = g;
        out[p + 2] = g;
        out[p + 3] = wide ? raw[s + 2]! : raw[s + 1]!;
      } else {
        // Cinza ou paleta: amostra de 1, 2, 4, 8 ou 16 bits.
        let sample: number;
        if (bitDepth === 16) sample = (raw[row + x * 2]! << 8) | raw[row + x * 2 + 1]!;
        else if (bitDepth === 8) sample = raw[row + x]!;
        else {
          const bit = x * bitDepth;
          sample = (raw[row + (bit >> 3)]! >> (8 - bitDepth - (bit & 7))) & maxSample;
        }
        if (colorType === PNG_COLOR_TYPE.palette) {
          if (sample >= paletteSize) throw new PngError(`PNG: índice de paleta ${sample} fora da PLTE`);
          out[p] = palette![sample * 3]!;
          out[p + 1] = palette![sample * 3 + 1]!;
          out[p + 2] = palette![sample * 3 + 2]!;
          out[p + 3] = trns && sample < trns.length ? trns[sample]! : 255;
        } else {
          const g = bitDepth === 16 ? sample >> 8 : Math.round((sample * 255) / maxSample);
          out[p] = g;
          out[p + 1] = g;
          out[p + 2] = g;
          out[p + 3] = sample === keyGray ? 0 : 255;
        }
      }
    }
  }
  return out;
}
