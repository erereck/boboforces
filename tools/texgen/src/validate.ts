import { inPalette } from './palette.ts';
import type { TextureKind } from './paint.ts';
import type { RgbaImage } from './png.ts';

/** Lado de uma camada de bloco (`blocos16`, decisão #6). */
export const BLOCK_LAYER_SIZE = 16;
/** Teto de camadas do array de blocos (mínimo garantido de MAX_ARRAY_TEXTURE_LAYERS, tecnico.md §15.3). */
export const MAX_BLOCK_LAYERS = 256;

export interface ValidateOptions {
  readonly size: number;
  readonly kind: TextureKind;
}

/**
 * Regras de uma camada (arte-ux.md §1.3 e §12; tecnico.md §15.3). Devolve a lista de problemas em pt-BR (vazia = ok):
 * - tamanho exato (16×16 para blocos);
 * - toda cor visível está na paleta mestra;
 * - camada opaca: alfa sempre 255 (sem alfa parcial nem buraco);
 * - camada cutout: alfa só 0 ou 255 (o shader faz `discard` abaixo de 0,5; alfa parcial vira serrilhado sujo).
 */
export function validateTexture(name: string, image: RgbaImage, options: ValidateOptions): string[] {
  const problems: string[] = [];
  if (image.width !== options.size || image.height !== options.size) {
    problems.push(`${name}: tamanho ${image.width}×${image.height}, esperado ${options.size}×${options.size}`);
    return problems;
  }
  const d = image.data;
  const offPalette = new Set<number>();
  let partialAlpha = 0;
  let holes = 0;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]!;
    if (a === 0) {
      if (options.kind === 'opaque') holes++;
      continue;
    }
    if (a !== 255) partialAlpha++;
    const rgb = (d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!;
    if (!inPalette(rgb)) offPalette.add(rgb);
  }
  if (offPalette.size > 0) {
    const list = [...offPalette]
      .slice(0, 8)
      .map((c) => '#' + c.toString(16).padStart(6, '0'))
      .join(', ');
    problems.push(`${name}: ${offPalette.size} cor(es) fora da paleta mestra (${list})`);
  }
  if (partialAlpha > 0) problems.push(`${name}: ${partialAlpha} pixel(s) com alfa parcial`);
  if (holes > 0) problems.push(`${name}: camada opaca com ${holes} pixel(s) transparente(s)`);
  return problems;
}
