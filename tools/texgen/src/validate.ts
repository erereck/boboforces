import { TEXTURE_ARRAYS } from '@boboforces/format';
import { hex, inPalette, TEAM_COLOR_SET } from './palette.ts';
import type { MaterialClass, TextureKind } from './paint.ts';
import type { RgbaImage } from './png.ts';

/** Lado de uma camada de bloco (`blocos16`, decisão #6). */
export const BLOCK_LAYER_SIZE = TEXTURE_ARRAYS.blocos16.layerSize;
/** Teto de camadas do array de blocos (mínimo garantido de MAX_ARRAY_TEXTURE_LAYERS, tecnico.md §15.3). */
export const MAX_BLOCK_LAYERS = TEXTURE_ARRAYS.blocos16.maxLayers;

export interface ValidateOptions {
  readonly size: number;
  readonly kind: TextureKind;
  /** Família de material: `debug` libera cor de time e preto puro; `continuo` cobra "sem xadrez de dithering". */
  readonly material?: MaterialClass;
}

/**
 * Janelas 2×2 em xadrez (a = d, b = c, a ≠ b) toleradas num material contínuo a cada 16×16 px (manchas encostando na
 * diagonal); uma camada 64×64 tolera 16 vezes isso.
 */
export const MAX_CHECKER_WINDOWS = 2;

/**
 * Regras de uma camada (arte-ux.md §1.3 e §12; tecnico.md §15.3). Devolve a lista de problemas em pt-BR (vazia = ok):
 * - tamanho exato (16×16 para blocos, 64×64 para os materiais de `modelos64`);
 * - toda cor visível está na paleta mestra;
 * - cor de time e preto puro (`#000000`) ficam fora do cenário (só o `missing`, de depuração, usa);
 * - opaca e emissiva: alfa sempre 255 (sem alfa parcial nem buraco);
 * - cutout: alfa só 0 ou 255, com pelo menos um buraco (o shader faz `discard` abaixo de 0,5; alfa parcial vira
 *   serrilhado sujo);
 * - translúcida: precisa ter alfa parcial (senão é opaca ou cutout);
 * - material contínuo: sem xadrez de dithering (vira moiré em 640×360).
 */
export function validateTexture(name: string, image: RgbaImage, options: ValidateOptions): string[] {
  const problems: string[] = [];
  const { size, kind } = options;
  if (image.width !== size || image.height !== size) {
    problems.push(`${name}: tamanho ${image.width}×${image.height}, esperado ${size}×${size}`);
    return problems;
  }
  const debug = options.material === 'debug';
  const d = image.data;
  const offPalette = new Set<number>();
  const reserved = new Set<number>();
  let partialAlpha = 0;
  let holes = 0;
  let visible = 0;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]!;
    if (a === 0) {
      holes++;
      continue;
    }
    visible++;
    if (a !== 255) partialAlpha++;
    const rgb = (d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!;
    if (!inPalette(rgb)) offPalette.add(rgb);
    else if (!debug && (TEAM_COLOR_SET.has(rgb) || rgb === 0x000000)) reserved.add(rgb);
  }
  if (offPalette.size > 0) {
    const list = [...offPalette].slice(0, 8).map(hex).join(', ');
    problems.push(`${name}: ${offPalette.size} cor(es) fora da paleta mestra (${list})`);
  }
  if (reserved.size > 0) {
    problems.push(`${name}: cor reservada (time ou preto puro) no cenário: ${[...reserved].map(hex).join(', ')}`);
  }
  if (kind === 'opaque' || kind === 'emissive') {
    if (partialAlpha > 0) problems.push(`${name}: ${partialAlpha} pixel(s) com alfa parcial em camada ${kind}`);
    if (holes > 0) problems.push(`${name}: camada ${kind} com ${holes} pixel(s) transparente(s)`);
  } else if (kind === 'cutout') {
    if (partialAlpha > 0) problems.push(`${name}: ${partialAlpha} pixel(s) com alfa parcial em camada cutout`);
    if (holes === 0) problems.push(`${name}: camada cutout sem nenhum pixel transparente (use opaque)`);
    if (visible === 0) problems.push(`${name}: camada cutout toda transparente`);
  } else if (partialAlpha === 0) {
    problems.push(`${name}: camada translucent sem alfa parcial (use opaque ou cutout)`);
  }
  if (options.material === 'continuo') {
    const windows = countCheckerWindows(image);
    if (windows > (MAX_CHECKER_WINDOWS * size * size) / 256) {
      problems.push(`${name}: ${windows} janelas 2×2 em xadrez (dithering) num material contínuo`);
    }
  }
  return problems;
}

/** Janelas 2×2 (com wrap) no padrão de xadrez: diagonais iguais e cores diferentes entre elas. */
export function countCheckerWindows(image: RgbaImage): number {
  const { width: w, height: h, data: d } = image;
  const at = (x: number, y: number): number => {
    const i = (((y + h) % h) * w + ((x + w) % w)) * 4;
    return d[i + 3] === 0 ? -1 : (d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!;
  };
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = at(x, y);
      const b = at(x + 1, y);
      const c = at(x, y + 1);
      const dd = at(x + 1, y + 1);
      if (a === dd && b === c && a !== b) count++;
    }
  }
  return count;
}
