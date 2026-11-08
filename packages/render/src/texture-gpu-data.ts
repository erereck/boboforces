// Dados das texturas da GPU SEM three (testável em Node): cadeia de mips com cobertura de alfa, atlas com padding do
// plano B (tecnico.md §6.1, item 4 do Teste Zero) e a conta de memória. Quem sobe para a GPU é `texture-gpu.ts`.
import type { TextureArrayData } from './types.ts';

/** Limiar do alpha test (programa 2 e camada externa das skins): alfa ≥ 128 conta como coberto (alfa < 0,5 descarta). */
export const ALPHA_CUTOFF = 128;

/** Filtro de minificação dos 2 arrays: o `MipFilterMode` do contrato (`RenderDebug.mipFilter`). */
export type { MipFilterMode as MinFilterMode } from './types.ts';

/** Níveis da cadeia completa de uma camada quadrada (16 → 5, 64 → 7). */
export function fullMipLevels(size: number): number {
  return Math.round(Math.log2(Math.max(1, size))) + 1;
}

/** Bytes de um nível (todas as camadas) de um array RGBA8. */
export function levelBytes(size: number, level: number, layers: number): number {
  const side = Math.max(1, size >> level);
  return side * side * 4 * layers;
}

/** Fração dos texels de uma camada cobertos (alfa × `scale` ≥ `ALPHA_CUTOFF`). */
export function alphaCoverage(rgba: Uint8Array, offset: number, texels: number, scale = 1): number {
  let covered = 0;
  for (let i = 0; i < texels; i++) if (rgba[offset + i * 4 + 3]! * scale >= ALPHA_CUTOFF) covered++;
  return texels > 0 ? covered / texels : 0;
}

/**
 * Reduz uma camada (lado `size` → `size / 2`) com caixa 2×2: cor média PONDERADA pelo alfa (a folhagem não ganha
 * franja escura do fundo transparente) e alfa médio. Camada opaca dá a média simples.
 */
export function downsampleLayer(
  src: Uint8Array,
  srcOffset: number,
  size: number,
  dst: Uint8Array,
  dstOffset: number,
): void {
  const half = Math.max(1, size >> 1);
  const step = size > 1 ? 2 : 1;
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < half; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let pr = 0;
      let pg = 0;
      let pb = 0;
      let n = 0;
      for (let dy = 0; dy < step; dy++) {
        for (let dx = 0; dx < step; dx++) {
          const o = srcOffset + ((y * step + dy) * size + (x * step + dx)) * 4;
          const alpha = src[o + 3]!;
          r += src[o]!;
          g += src[o + 1]!;
          b += src[o + 2]!;
          pr += src[o]! * alpha;
          pg += src[o + 1]! * alpha;
          pb += src[o + 2]! * alpha;
          a += alpha;
          n++;
        }
      }
      const d = dstOffset + (y * half + x) * 4;
      if (a > 0) {
        dst[d] = Math.round(pr / a);
        dst[d + 1] = Math.round(pg / a);
        dst[d + 2] = Math.round(pb / a);
      } else {
        dst[d] = Math.round(r / n);
        dst[d + 1] = Math.round(g / n);
        dst[d + 2] = Math.round(b / n);
      }
      dst[d + 3] = Math.round(a / n);
    }
  }
}

// Rascunhos da cobertura de alfa (regra 11: nada se aloca por chamada): histograma do alfa e "quantos têm alfa ≥ a".
const alphaHistogram = new Uint32Array(256);
const alphaAtLeast = new Uint32Array(257);

/**
 * Cobertura com o alfa escalado por `scale`, lida da tabela `alphaAtLeast`: a MESMA conta de `alphaCoverage` (o texel
 * conta se `alfa × scale ≥ ALPHA_CUTOFF`, comparação em float idêntica), só que por limiar e não por texel. A
 * comparação é monótona no alfa, então os cobertos são exatamente os de alfa ≥ t.
 */
function scaledCoverage(scale: number, texels: number): number {
  let t = Math.min(256, Math.max(1, Math.ceil(ALPHA_CUTOFF / scale)));
  while (t > 1 && (t - 1) * scale >= ALPHA_CUTOFF) t--;
  while (t < 256 && t * scale < ALPHA_CUTOFF) t++;
  return alphaAtLeast[t]! / texels;
}

/**
 * Escala o alfa de uma camada até a cobertura chegar em `target` (Castaño, "alpha test coverage"): sem isso a cerca e a
 * folhagem afinam e somem nos mips. Busca binária no fator de escala; camada sem nenhum alfa fica como está. A busca
 * lê um histograma do alfa (2 passadas na camada em vez de 16; o resultado é byte a byte o da busca texel a texel).
 */
export function preserveAlphaCoverage(rgba: Uint8Array, offset: number, texels: number, target: number): void {
  if (target <= 0 || texels <= 0) return;
  alphaHistogram.fill(0);
  for (let i = 0; i < texels; i++) alphaHistogram[rgba[offset + i * 4 + 3]!]!++;
  alphaAtLeast[256] = 0;
  for (let a = 255; a >= 0; a--) alphaAtLeast[a] = alphaAtLeast[a + 1]! + alphaHistogram[a]!;
  if (scaledCoverage(1, texels) === target) return;
  let lo = 0;
  let hi = 16;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (scaledCoverage(mid, texels) < target) lo = mid;
    else hi = mid;
  }
  // `hi` é o menor fator que alcança a cobertura (ou passa um pouco, nunca fica abaixo).
  for (let i = 0; i < texels; i++) {
    const o = offset + i * 4 + 3;
    rgba[o] = Math.min(255, Math.round(rgba[o]! * hi));
  }
}

/**
 * Gera os níveis `fromLevel..levels.length − 1` de UMA camada a partir do nível `fromLevel − 1` já escrito (padrão: do
 * nível 0, na skin sem nível 1 pronto ou no nível que faltou na tira; `fromLevel` 2 quando o nível 1 veio pronto, a
 * skin 64 reempacotada da decisão #51). `cutout` preserva a cobertura do alfa do nível de partida.
 */
export function writeLayerMips(
  levels: readonly Uint8Array[],
  size: number,
  layer: number,
  cutout: boolean,
  fromLevel = 1,
): void {
  const baseLevel = fromLevel - 1;
  const base = levels[baseLevel];
  if (!base || baseLevel < 0) return;
  const baseSide = Math.max(1, size >> baseLevel);
  const coverage = cutout ? alphaCoverage(base, layer * baseSide * baseSide * 4, baseSide * baseSide) : 0;
  for (let k = fromLevel; k < levels.length; k++) {
    const src = levels[k - 1]!;
    const dst = levels[k]!;
    const srcSide = Math.max(1, size >> (k - 1));
    const dstSide = Math.max(1, size >> k);
    const dstOffset = layer * dstSide * dstSide * 4;
    downsampleLayer(src, layer * srcSide * srcSide * 4, srcSide, dst, dstOffset);
    if (cutout) preserveAlphaCoverage(dst, dstOffset, dstSide * dstSide, coverage);
  }
}

/**
 * Quantas camadas `size`×`size` RGBA8 cabem em `rgbaBytes` (k ≥ 1, sem sobra), conferindo o nível 1 opcional
 * (k × (size/2)² × 4 bytes). É a validação do `writeModelLayer` (k camadas seguidas, decisão #51); erro diz o esperado.
 */
export function modelLayerCount(size: number, rgbaBytes: number, level1Bytes?: number): number {
  const layerBytes = size * size * 4;
  const count = rgbaBytes / layerBytes;
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`render: skin com ${rgbaBytes} bytes, esperado k × ${layerBytes} (camadas de ${size}×${size})`);
  }
  if (level1Bytes !== undefined) {
    const half = Math.max(1, size >> 1);
    const expected = count * half * half * 4;
    if (level1Bytes !== expected) {
      throw new Error(`render: nível 1 com ${level1Bytes} bytes, esperado ${expected} (${count} × ${half}×${half})`);
    }
  }
  return count;
}

/**
 * Lado da CPU do `writeModelLayer`: grava k camadas seguidas a partir de `firstLayer` na cadeia `levels` (nível 0 de
 * `rgba`; nível 1 de `level1` quando vier, senão reduzido do nível 0) e gera os níveis seguintes com cobertura de alfa
 * (as camadas reservadas são cutout: a camada externa da skin). Devolve k. Quem confere a faixa reservada é o chamador.
 */
export function writeLayerRange(
  levels: readonly Uint8Array[],
  size: number,
  firstLayer: number,
  rgba: Uint8Array,
  level1?: Uint8Array,
): number {
  const count = modelLayerCount(size, rgba.length, level1?.length);
  levels[0]!.set(rgba, firstLayer * size * size * 4);
  const given = level1 !== undefined && levels.length > 1;
  if (given) {
    const half = Math.max(1, size >> 1);
    levels[1]!.set(level1, firstLayer * half * half * 4);
  }
  for (let i = 0; i < count; i++) writeLayerMips(levels, size, firstLayer + i, true, given ? 2 : 1);
  return count;
}

/**
 * Cadeia de mips de um array com `levels` níveis: os níveis que a tira trouxe são usados como estão (mesma referência:
 * quem escreve no nível 0 da CPU escreve no da GPU) e os que faltam são gerados camada por camada (`cutout(layer)`
 * diz quais preservam a cobertura do alfa).
 */
export function completeMipChain(
  data: TextureArrayData,
  levels: number,
  cutout: (layer: number) => boolean,
): Uint8Array[] {
  const size = data.width;
  const out: Uint8Array[] = [];
  for (let k = 0; k < levels; k++) {
    const given = data.levels[k];
    out.push(given ?? new Uint8Array(levelBytes(size, k, data.layers)));
  }
  const first = Math.max(1, data.levels.length);
  if (first >= levels) return out;
  for (let layer = 0; layer < data.layers; layer++) {
    const coverage = cutout(layer) ? alphaCoverage(out[0]!, layer * size * size * 4, size * size) : 0;
    for (let k = first; k < levels; k++) {
      const srcSide = Math.max(1, size >> (k - 1));
      const dstSide = Math.max(1, size >> k);
      const dstOffset = layer * dstSide * dstSide * 4;
      downsampleLayer(out[k - 1]!, layer * srcSide * srcSide * 4, srcSide, out[k]!, dstOffset);
      if (coverage > 0) preserveAlphaCoverage(out[k]!, dstOffset, dstSide * dstSide, coverage);
    }
  }
  return out;
}

// --- Atlas com padding (plano B do Teste Zero: `#define ATLAS`, tecnico.md §6.1) ---

/**
 * Disposição do atlas: camada `i` na coluna `i % cols`, linha `floor(i / cols)`, cada uma numa célula de
 * `tile + 2·padding` px com o conteúdo a partir de (padding, padding). É a conta de `bfAtlasCorner` (glsl-common.ts):
 * o uniform `u*Atlas` = (cols, rows, tile, padding) e `u*AtlasSize` = (width, height), sempre do nível 0.
 */
export interface AtlasLayout {
  readonly layers: number;
  readonly cols: number;
  readonly rows: number;
  readonly tile: number;
  readonly padding: number;
  readonly cell: number;
  readonly width: number;
  readonly height: number;
  /** Níveis do atlas (≤ `ATLAS_MAX_MIP_LEVELS`; o padding e a célula precisam dividir por 2 a cada nível). */
  readonly levels: number;
}

/** Como o padding é preenchido: `repeat` (blocos: casa com o `fract` da UV) ou `clamp` (modelos: borda repetida). */
export type AtlasWrap = 'repeat' | 'clamp';

export function atlasLayout(layers: number, tile: number, padding: number, maxLevels: number): AtlasLayout {
  const cols = Math.max(1, Math.ceil(Math.sqrt(layers)));
  const rows = Math.max(1, Math.ceil(layers / cols));
  const cell = tile + 2 * padding;
  let levels = 1;
  while (levels < maxLevels && (padding >> (levels - 1)) % 2 === 0 && padding >> levels > 0 && tile >> levels > 0) {
    levels++;
  }
  return { layers, cols, rows, tile, padding, cell, width: cols * cell, height: rows * cell, levels };
}

/** Retângulo da célula (com padding) de uma camada num nível do atlas, em px desse nível. */
export function atlasCellRect(
  layout: AtlasLayout,
  layer: number,
  level: number,
): { x: number; y: number; size: number } {
  const cell = layout.cell >> level;
  return { x: (layer % layout.cols) * cell, y: Math.floor(layer / layout.cols) * cell, size: cell };
}

function wrapIndex(i: number, n: number, wrap: AtlasWrap): number {
  if (wrap === 'repeat') return ((i % n) + n) % n;
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}

function copyTexel(src: Uint8Array, s: number, dst: Uint8Array, d: number): void {
  dst[d] = src[s]!;
  dst[d + 1] = src[s + 1]!;
  dst[d + 2] = src[s + 2]!;
  dst[d + 3] = src[s + 3]!;
}

/**
 * Escreve a célula de UMA camada (conteúdo + padding) de um nível do atlas em `dst`, que tem `dstWidth` px por linha,
 * começando no px (`dstX`, `dstY`). `src` é o nível `level` do array (camadas contíguas). O miolo de cada linha vai numa
 * cópia nativa (sem JIT, como no Switch, o laço por texel custava ~4× mais); só o padding vai texel a texel.
 */
export function writeAtlasCell(
  layout: AtlasLayout,
  layer: number,
  level: number,
  src: Uint8Array,
  wrap: AtlasWrap,
  dst: Uint8Array,
  dstWidth: number,
  dstX: number,
  dstY: number,
): void {
  const tile = Math.max(1, layout.tile >> level);
  const pad = layout.padding >> level;
  const cell = tile + 2 * pad;
  const base = layer * tile * tile * 4;
  for (let y = 0; y < cell; y++) {
    const srcRow = base + wrapIndex(y - pad, tile, wrap) * tile * 4;
    const dstRow = ((dstY + y) * dstWidth + dstX) * 4;
    dst.set(src.subarray(srcRow, srcRow + tile * 4), dstRow + pad * 4);
    for (let x = 0; x < pad; x++) {
      copyTexel(src, srcRow + wrapIndex(x - pad, tile, wrap) * 4, dst, dstRow + x * 4);
      copyTexel(src, srcRow + wrapIndex(tile + x, tile, wrap) * 4, dst, dstRow + (pad + tile + x) * 4);
    }
  }
}

/** Monta os níveis do atlas a partir dos níveis do array (o nível k do atlas vem do nível k de cada camada). */
export function buildAtlasLevels(layout: AtlasLayout, levels: readonly Uint8Array[], wrap: AtlasWrap): Uint8Array[] {
  if (levels.length < layout.levels)
    throw new Error(`atlas: ${levels.length} níveis no array, precisa de ${layout.levels}`);
  const out: Uint8Array[] = [];
  for (let k = 0; k < layout.levels; k++) {
    const width = layout.width >> k;
    const height = layout.height >> k;
    const dst = new Uint8Array(width * height * 4);
    for (let layer = 0; layer < layout.layers; layer++) {
      const r = atlasCellRect(layout, layer, k);
      writeAtlasCell(layout, layer, k, levels[k]!, wrap, dst, width, r.x, r.y);
    }
    out.push(dst);
  }
  return out;
}

/** Bytes de um atlas com todos os níveis. */
export function atlasBytes(layout: AtlasLayout): number {
  let bytes = 0;
  for (let k = 0; k < layout.levels; k++) bytes += (layout.width >> k) * (layout.height >> k) * 4;
  return bytes;
}

/** Bytes de um array RGBA8 com `levels` níveis. */
export function arrayBytes(size: number, layers: number, levels: number): number {
  let bytes = 0;
  for (let k = 0; k < levels; k++) bytes += levelBytes(size, k, layers);
  return bytes;
}
