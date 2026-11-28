// Tiras de texture array (`layers@1`), compartilhadas pelo skingen e pelo modelgen (tecnico.md §6.1, arte-ux.md §1.6).
// Formato da tira em `packages/format/src/layers.ts`. Os mipmaps (o filtro `premultiplied` que morava aqui) foram para
// `packages/format/src/layer-mips.ts` no M12 (§23.9): o jogo os gera no loading, sem `.mips.png`.
import {
  LAYER_MANIFEST_FORMAT,
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
