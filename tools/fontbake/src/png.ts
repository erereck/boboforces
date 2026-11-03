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
