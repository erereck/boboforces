import {
  LAYER_MANIFEST_FORMAT,
  mipChainOffsets,
  parseLayerManifest,
  TEXTURE_ARRAYS,
  type LayerManifest,
  type TextureArrayName,
} from '@boboforces/format';
import { buildMipChain } from './mips.ts';
import {
  frameLayerName,
  renderRecipe,
  variantLayerName,
  type LayerRecipe,
  type MaterialClass,
  type TextureKind,
} from './paint.ts';
import type { RgbaImage } from './png.ts';
import { validateTexture } from './validate.ts';

/** Uma camada FÍSICA da tira (cada variante e cada quadro é uma). */
export interface GeneratedLayer {
  /** Nome no manifesto: `grass`, `grass_b`, `water#1`… */
  readonly name: string;
  /** Nome da receita (a camada base do grupo). */
  readonly base: string;
  readonly variant: number;
  readonly frame: number;
  readonly kind: TextureKind;
  readonly material: MaterialClass;
  /** Quadros do grupo (o manifesto repete no quadro 0; os seguintes levam 1). */
  readonly frames: number;
  readonly image: RgbaImage;
}

/** Grupo de camadas de uma receita: o que um `BlockDef` aponta pela face (`base` + variantes × quadros). */
export interface LayerGroup {
  readonly base: string;
  /** Índice da primeira camada física na tira. */
  readonly start: number;
  readonly variants: number;
  readonly frames: number;
  readonly kind: TextureKind;
  readonly material: MaterialClass;
}

/** Uma tira de texture array gerada pelo texgen (`<base>.png`, `.mips.png`, `.json`). */
export interface StripSpec {
  readonly array: TextureArrayName;
  /** Caminho sem extensão, relativo a `assets-src/textures/generated/` (ex.: `blocos16`). */
  readonly file: string;
  readonly recipes: readonly LayerRecipe[];
}

const NAME_RE = /^[a-z][a-z0-9_]*$/;

/** Expande as receitas em camadas físicas, na ordem: receita → variante → quadro. */
export function generateLayers(recipes: readonly LayerRecipe[], size: number): GeneratedLayer[] {
  const names = new Set<string>();
  const out: GeneratedLayer[] = [];
  for (const recipe of recipes) {
    if (!NAME_RE.test(recipe.name)) throw new Error(`texgen: nome de camada inválido "${recipe.name}"`);
    const variants = recipe.variants ?? 1;
    const frames = recipe.frames ?? 1;
    if (!Number.isInteger(variants) || variants < 1 || variants > 16) {
      throw new Error(`texgen: "${recipe.name}" com variants fora de 1..16`);
    }
    if (!Number.isInteger(frames) || frames < 1 || frames > 16) {
      throw new Error(`texgen: "${recipe.name}" com frames fora de 1..16`);
    }
    for (let v = 0; v < variants; v++) {
      const variantName = variantLayerName(recipe.name, v);
      for (let f = 0; f < frames; f++) {
        const name = frameLayerName(variantName, f);
        if (names.has(name)) throw new Error(`texgen: camada repetida "${name}"`);
        names.add(name);
        out.push({
          name,
          base: recipe.name,
          variant: v,
          frame: f,
          kind: recipe.kind,
          material: recipe.material,
          frames,
          image: renderRecipe(recipe, size, v, f),
        });
      }
    }
  }
  return out;
}

/** Grupos por nome base (para validar os blocos e montar a folha de contato). */
export function layerGroups(layers: readonly GeneratedLayer[]): Map<string, LayerGroup> {
  const groups = new Map<string, LayerGroup>();
  layers.forEach((l, i) => {
    const g = groups.get(l.base);
    if (!g) {
      groups.set(l.base, { base: l.base, start: i, variants: 1, frames: l.frames, kind: l.kind, material: l.material });
    } else if (l.variant + 1 > g.variants) {
      groups.set(l.base, { ...g, variants: l.variant + 1 });
    }
  });
  return groups;
}

/** Problemas de todas as camadas de uma tira (vazio = ok). */
export function validateLayers(layers: readonly GeneratedLayer[], array: TextureArrayName): string[] {
  const spec = TEXTURE_ARRAYS[array];
  const problems = layers.flatMap((l) =>
    validateTexture(l.name, l.image, { size: spec.layerSize, kind: l.kind, material: l.material }),
  );
  if (layers.length > spec.maxLayers) problems.push(`${array}: ${layers.length} camadas (teto ${spec.maxLayers})`);
  return problems;
}

/** Tira vertical do nível 0: camada i nas linhas [i·H, (i+1)·H). */
export function buildStrip(layers: readonly GeneratedLayer[], size: number): RgbaImage {
  const data = new Uint8Array(size * size * 4 * layers.length);
  layers.forEach((l, i) => data.set(l.image.data, i * size * size * 4));
  return { width: size, height: size * layers.length, data };
}

/** Mips de cada camada (níveis 1..n−1), na ordem da tira. */
export function buildLayerMips(layers: readonly GeneratedLayer[], mipLevels: number): RgbaImage[][] {
  return layers.map((l) => buildMipChain(l.image, l.kind, mipLevels));
}

/**
 * `.mips.png` do contrato `layers@1` (format/src/layers.ts): largura W/2; cada camada ocupa um bloco de H linhas e o
 * nível k fica onde `mipChainOffsets` manda (sobra a última linha do bloco, transparente).
 */
export function buildMipsStrip(mips: readonly (readonly RgbaImage[])[], size: number, mipLevels: number): RgbaImage {
  const width = size / 2;
  const data = new Uint8Array(width * size * 4 * mips.length);
  const rects = mipChainOffsets(size, mipLevels);
  mips.forEach((chain, i) => {
    rects.forEach((r, k) => {
      const img = chain[k]!;
      for (let row = 0; row < r.height; row++) {
        const dst = ((i * size + r.y + row) * width + r.x) * 4;
        data.set(img.data.subarray(row * r.width * 4, (row + 1) * r.width * 4), dst);
      }
    });
  });
  return { width, height: size * mips.length, data };
}

/** Manifesto `layers@1` da tira (validado pelo `parseLayerManifest` do contrato antes de sair). */
export function buildManifest(layers: readonly GeneratedLayer[], array: TextureArrayName): LayerManifest {
  const spec = TEXTURE_ARRAYS[array];
  const manifest: LayerManifest = {
    format: LAYER_MANIFEST_FORMAT,
    array,
    source: 'texgen',
    layerWidth: spec.layerSize,
    layerHeight: spec.layerSize,
    mipLevels: spec.mipLevels,
    layers: layers.map((l) => ({
      name: l.name,
      kind: l.kind,
      frames: l.frame === 0 ? l.frames : 1,
      cutout: l.kind === 'cutout',
    })),
  };
  return parseLayerManifest(manifest);
}

/** Tudo de uma tira já pronto (camadas, mips e manifesto), depois do validador. */
export interface BuiltStrip {
  readonly spec: StripSpec;
  readonly layers: readonly GeneratedLayer[];
  readonly mips: readonly (readonly RgbaImage[])[];
  readonly manifest: LayerManifest;
  readonly level0: RgbaImage;
  readonly mipsImage: RgbaImage;
}

export function buildStripAssets(spec: StripSpec): BuiltStrip {
  const arraySpec = TEXTURE_ARRAYS[spec.array];
  const layers = generateLayers(spec.recipes, arraySpec.layerSize);
  const problems = validateLayers(layers, spec.array);
  if (problems.length > 0) throw new Error(`texgen: validação reprovou (${spec.file}):\n- ${problems.join('\n- ')}`);
  const mips = buildLayerMips(layers, arraySpec.mipLevels);
  return {
    spec,
    layers,
    mips,
    manifest: buildManifest(layers, spec.array),
    level0: buildStrip(layers, arraySpec.layerSize),
    mipsImage: buildMipsStrip(mips, arraySpec.layerSize, arraySpec.mipLevels),
  };
}
