// Tiras de texture array (`layers@1`) e mipmaps, compartilhadas pelo skingen e pelo modelgen (tecnico.md §6.1,
// arte-ux.md §1.6). Formato da tira e do `.mips.png` em `packages/format/src/layers.ts`.
import {
  LAYER_MANIFEST_FORMAT,
  mipChainOffsets,
  TEXTURE_ARRAYS,
  type LayerKind,
  type LayerSource,
  type RgbaImage,
  type TextureArrayName,
} from '@boboforces/format';
import { prettyJson } from './json.ts';
import { inPalette } from './palette.ts';

export interface StripLayer {
  readonly name: string;
  readonly kind: LayerKind;
  /** Mips com cobertura de alfa preservada (rosto, camada externa, folhas). */
  readonly cutout: boolean;
  readonly image: RgbaImage;
}

export function createImage(width: number, height: number = width): RgbaImage & { readonly data: Uint8Array } {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

/** Tira vertical: camada i nas linhas [i·S, (i+1)·S). */
export function buildStrip(layers: readonly StripLayer[], size: number): RgbaImage {
  const out = createImage(size, size * layers.length);
  layers.forEach((l, i) => {
    if (l.image.width !== size || l.image.height !== size) {
      throw new Error(`camada "${l.name}": ${l.image.width}×${l.image.height}, esperado ${size}×${size}`);
    }
    out.data.set(l.image.data, i * size * size * 4);
  });
  return out;
}

interface FloatImage {
  readonly size: number;
  /** RGB pré-multiplicado pelo alfa e alfa, em 0..1. */
  readonly data: Float64Array;
}

function toFloat(image: RgbaImage): FloatImage {
  const data = new Float64Array(image.width * image.height * 4);
  for (let i = 0; i < data.length; i += 4) {
    const a = image.data[i + 3]! / 255;
    data[i] = (image.data[i]! / 255) * a;
    data[i + 1] = (image.data[i + 1]! / 255) * a;
    data[i + 2] = (image.data[i + 2]! / 255) * a;
    data[i + 3] = a;
  }
  return { size: image.width, data };
}

/** Caixa 2×2 sobre o pré-multiplicado (o transparente não escurece a borda). */
function downsample(src: FloatImage): FloatImage {
  const size = Math.max(1, src.size >> 1);
  const data = new Float64Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const sx = Math.min(src.size - 1, x * 2 + dx);
            const sy = Math.min(src.size - 1, y * 2 + dy);
            sum += src.data[(sy * src.size + sx) * 4 + c]!;
          }
        }
        data[(y * size + x) * 4 + c] = sum / 4;
      }
    }
  }
  return { size, data };
}

function coverage(alpha: ArrayLike<number>, threshold: number, count: number): number {
  let n = 0;
  for (let i = 0; i < count; i++) if (alpha[i * 4 + 3]! >= threshold) n++;
  return n / count;
}

/**
 * Converte um nível para RGBA8. Em camada cutout, escolhe o limiar de alfa que mais aproxima a cobertura do nível 0
 * (o rosto e a camada externa não somem ao longe) e binariza (0 ou 255), como o `discard` do shader espera.
 */
function toRgba(level: FloatImage, cutout: boolean, targetCoverage: number): RgbaImage {
  const out = createImage(level.size);
  const n = level.size * level.size;
  let threshold = 0.5;
  if (cutout) {
    let best = Infinity;
    for (let t = 1; t <= 255; t++) {
      const err = Math.abs(coverage(level.data, t / 255, n) - targetCoverage);
      if (err < best - 1e-9) {
        best = err;
        threshold = t / 255;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const a = level.data[i * 4 + 3]!;
    const o = i * 4;
    const visible = cutout ? a >= threshold && a > 0 : true;
    if (a > 0) {
      out.data[o] = Math.round((level.data[o]! / a) * 255);
      out.data[o + 1] = Math.round((level.data[o + 1]! / a) * 255);
      out.data[o + 2] = Math.round((level.data[o + 2]! / a) * 255);
    }
    out.data[o + 3] = cutout ? (visible ? 255 : 0) : Math.round(a * 255);
  }
  return out;
}

/** Níveis 1..levels−1 de uma camada quadrada. */
export function mipLevels(image: RgbaImage, levels: number, cutout: boolean): RgbaImage[] {
  const n = image.width * image.height;
  let opaque = 0;
  for (let i = 0; i < n; i++) if (image.data[i * 4 + 3]! >= 128) opaque++;
  const target = opaque / n;
  const out: RgbaImage[] = [];
  let current = toFloat(image);
  for (let level = 1; level < levels; level++) {
    current = downsample(current);
    out.push(toRgba(current, cutout, target));
  }
  return out;
}

/** O `.mips.png`: largura S/2, um bloco de S linhas por camada, níveis pelo `mipChainOffsets`. */
export function buildMipStrip(layers: readonly StripLayer[], size: number, levels: number): RgbaImage {
  const width = size >> 1;
  const out = createImage(width, size * layers.length);
  const rects = mipChainOffsets(size, levels);
  layers.forEach((layer, i) => {
    const mips = mipLevels(layer.image, levels, layer.cutout);
    rects.forEach((rect, k) => {
      const mip = mips[k]!;
      for (let y = 0; y < rect.height; y++) {
        for (let x = 0; x < rect.width; x++) {
          const s = (y * mip.width + x) * 4;
          const d = ((i * size + rect.y + y) * width + rect.x + x) * 4;
          out.data.set(mip.data.subarray(s, s + 4), d);
        }
      }
    });
  });
  return out;
}

/** JSON `layers@1` da tira. */
export function layerManifestJson(array: TextureArrayName, source: LayerSource, layers: readonly StripLayer[]): string {
  const spec = TEXTURE_ARRAYS[array];
  const manifest = {
    format: LAYER_MANIFEST_FORMAT,
    array,
    source,
    layerWidth: spec.layerSize,
    layerHeight: spec.layerSize,
    mipLevels: spec.mipLevels,
    layers: layers.map((l) => ({ name: l.name, kind: l.kind, frames: 1, cutout: l.cutout })),
  };
  return prettyJson(manifest);
}

/**
 * Regras de uma camada da GPU (arte-ux.md §1.3 e §12): tamanho exato, toda cor visível na paleta mestra, alfa só 0 ou
 * 255, e camada opaca sem buraco. Devolve os problemas em pt-BR (vazio = ok).
 */
export function validateLayer(layer: StripLayer, size: number): string[] {
  const { image, name } = layer;
  if (image.width !== size || image.height !== size)
    return [`${name}: ${image.width}×${image.height}, esperado ${size}`];
  const off = new Set<number>();
  let partial = 0;
  let holes = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    const a = image.data[i + 3]!;
    if (a === 0) {
      if (layer.kind === 'opaque') holes++;
      continue;
    }
    if (a !== 255) partial++;
    const rgb = (image.data[i]! << 16) | (image.data[i + 1]! << 8) | image.data[i + 2]!;
    if (!inPalette(rgb)) off.add(rgb);
  }
  const problems: string[] = [];
  if (off.size > 0) {
    const list = [...off].slice(0, 6).map((c) => '#' + c.toString(16).padStart(6, '0'));
    problems.push(`${name}: ${off.size} cor(es) fora da paleta mestra (${list.join(', ')})`);
  }
  if (partial > 0) problems.push(`${name}: ${partial} pixel(s) com alfa parcial`);
  if (holes > 0) problems.push(`${name}: camada opaca com ${holes} pixel(s) transparente(s)`);
  return problems;
}
