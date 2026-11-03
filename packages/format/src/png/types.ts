/** Imagem RGBA8 sem compressão, linha a linha de cima para baixo (entrada do codificador e saída do decodificador). */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** `width * height * 4` bytes RGBA. */
  readonly data: Uint8Array;
}

/** Assinatura de 8 bytes do PNG. */
export const PNG_SIGNATURE: readonly number[] = [137, 80, 78, 71, 13, 10, 26, 10];

/** Tipos de cor do IHDR. */
export const PNG_COLOR_TYPE = { gray: 0, rgb: 2, palette: 3, grayAlpha: 4, rgba: 6 } as const;

/** Lado máximo aceito (16384 = MAX_TEXTURE_SIZE comum; protege contra PNG malformado pedindo gigabytes). */
export const PNG_MAX_SIDE = 16384;
