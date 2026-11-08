/**
 * PNG do fontbake: lê o RGBA que o msdf-bmfont-xml (jimp) grava e escreve a tira vertical final do atlas. Usa o PNG
 * próprio do `@boboforces/format` (o mesmo que o jogo usa para ler o atlas), então build e jogo não divergem.
 */
import { decodePng, encodePng } from '@boboforces/format';

export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** RGBA 8 bits, linha após linha, de cima para baixo. */
  readonly pixels: Uint8Array;
}

/** Lê qualquer PNG sem entrelaçamento e devolve RGBA 8 bits. */
export function decodePngRgba(bytes: Uint8Array): RgbaImage {
  const image = decodePng(bytes);
  return { width: image.width, height: image.height, pixels: image.data };
}

/**
 * Grava PNG 8 bits com deflate nível 9 (o atlas MSDF é o asset mais pesado da UI). MSDF não usa alfa: com tudo opaco
 * sai RGB, e o `decodePng` do jogo devolve RGBA do mesmo jeito. Determinístico.
 */
export function encodePngRgba(image: RgbaImage): Uint8Array {
  return encodePng(
    { width: image.width, height: image.height, data: image.pixels },
    { level: 9, dropOpaqueAlpha: true },
  );
}

/** Empilha imagens do mesmo tamanho numa tira vertical (= memória de um `TEXTURE_2D_ARRAY`, camada após camada). */
export function stackVertical(images: readonly RgbaImage[]): RgbaImage {
  const first = images[0];
  if (!first) throw new Error('png: nenhuma imagem para empilhar');
  const pixels = new Uint8Array(first.width * first.height * 4 * images.length);
  images.forEach((img, i) => {
    if (img.width !== first.width || img.height !== first.height)
      throw new Error('png: camadas de tamanhos diferentes');
    pixels.set(img.pixels, i * img.pixels.length);
  });
  return { width: first.width, height: first.height * images.length, pixels };
}

/**
 * Quantiza os canais RGB em `bits` por canal (o alfa fica): nível = round(v·(2^bits−1)/255), gravado em 8 bits por
 * replicação de bits. Determinística e idempotente (aplicar de novo não muda nada); erro de no máximo 1 em 255. No
 * MSDF, 7 bits deixam o degrau em 1/128 da faixa (~0,03 px do atlas com faixa 4), invisível de 13 a 132 px, e o PNG
 * comprime melhor (decisão #54: é o que põe o atlas dentro dos 120 KB).
 */
export function quantizeChannels(image: RgbaImage, bits: number): RgbaImage {
  if (!Number.isInteger(bits) || bits < 1 || bits > 8) throw new Error(`png: ${bits} bits por canal fora de 1..8`);
  if (bits === 8) return image;
  const levels = (1 << bits) - 1;
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    const level = Math.round((v * levels) / 255);
    // Replicação de bits: os bits altos do nível repetem embaixo (0 → 0, máximo → 255).
    let out = 0;
    for (let filled = 0; filled < 8; filled += bits) out |= (level << (8 - bits)) >> filled;
    lut[v] = out;
  }
  const pixels = new Uint8Array(image.pixels);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = lut[pixels[i] as number] as number;
    pixels[i + 1] = lut[pixels[i + 1] as number] as number;
    pixels[i + 2] = lut[pixels[i + 2] as number] as number;
  }
  return { width: image.width, height: image.height, pixels };
}
