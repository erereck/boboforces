import { BLOCK_TEXTURES } from '../../../assets-src/textures/blocks16.ts';
import { renderRecipe, type TextureKind, type TextureRecipe } from './paint.ts';
import { encodePng, type RgbaImage } from './png.ts';
import { BLOCK_LAYER_SIZE, MAX_BLOCK_LAYERS, validateTexture } from './validate.ts';

export interface GeneratedLayer {
  readonly name: string;
  readonly kind: TextureKind;
  readonly image: RgbaImage;
}

/** Manifesto do texture array: camada (índice) → nome. É o que o jogo lê para montar o `BlockRegistry`. */
export interface TextureArrayManifest {
  readonly name: string;
  readonly layerWidth: number;
  readonly layerHeight: number;
  readonly layers: readonly { readonly name: string; readonly kind: TextureKind }[];
}

export const BLOCK_ARRAY_NAME = 'blocos16';

export function generateLayers(recipes: readonly TextureRecipe[] = BLOCK_TEXTURES): GeneratedLayer[] {
  const names = new Set<string>();
  return recipes.map((recipe) => {
    if (names.has(recipe.name)) throw new Error(`texgen: camada repetida "${recipe.name}"`);
    if (!/^[a-z][a-z0-9_]*$/.test(recipe.name)) throw new Error(`texgen: nome de camada inválido "${recipe.name}"`);
    names.add(recipe.name);
    return { name: recipe.name, kind: recipe.kind, image: renderRecipe(recipe, BLOCK_LAYER_SIZE) };
  });
}

export function validateLayers(layers: readonly GeneratedLayer[]): string[] {
  const problems = layers.flatMap((l) => validateTexture(l.name, l.image, { size: BLOCK_LAYER_SIZE, kind: l.kind }));
  if (layers.length > MAX_BLOCK_LAYERS)
    problems.push(`${BLOCK_ARRAY_NAME}: ${layers.length} camadas (teto ${MAX_BLOCK_LAYERS})`);
  return problems;
}

/** Tira vertical: camada i nas linhas [i·16, (i+1)·16). É o formato que o render sobe como `TEXTURE_2D_ARRAY`. */
export function buildStrip(layers: readonly GeneratedLayer[]): RgbaImage {
  const s = BLOCK_LAYER_SIZE;
  const data = new Uint8Array(s * s * 4 * layers.length);
  layers.forEach((l, i) => data.set(l.image.data, i * s * s * 4));
  return { width: s, height: s * layers.length, data };
}

/** Folha de aprovação: cada camada repetida 3×3 (mostra a emenda) e ampliada 4×, lado a lado. Não vai para o jogo. */
export function buildPreview(layers: readonly GeneratedLayer[], scale = 4, gap = 8): RgbaImage {
  const s = BLOCK_LAYER_SIZE;
  const tile = s * 3 * scale;
  const cols = Math.min(4, layers.length);
  const rows = Math.ceil(layers.length / cols);
  const width = cols * tile + (cols + 1) * gap;
  const height = rows * tile + (rows + 1) * gap;
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([0x0a, 0x0d, 0x0b, 0xff], i * 4);
  layers.forEach((l, n) => {
    const ox = gap + (n % cols) * (tile + gap);
    const oy = gap + Math.floor(n / cols) * (tile + gap);
    for (let y = 0; y < tile; y++) {
      for (let x = 0; x < tile; x++) {
        const src = ((Math.floor(y / scale) % s) * s + (Math.floor(x / scale) % s)) * 4;
        data.set(l.image.data.subarray(src, src + 4), ((oy + y) * width + ox + x) * 4);
      }
    }
  });
  return { width, height, data };
}

export function buildManifest(layers: readonly GeneratedLayer[]): TextureArrayManifest {
  return {
    name: BLOCK_ARRAY_NAME,
    layerWidth: BLOCK_LAYER_SIZE,
    layerHeight: BLOCK_LAYER_SIZE,
    layers: layers.map((l) => ({ name: l.name, kind: l.kind })),
  };
}

/**
 * Tudo o que o texgen grava, por caminho relativo a `assets-src/textures/generated/`:
 * - `blocks/<nome>.png`: cada camada 16×16 (para revisar e para o diff no git);
 * - `blocos16.png` + `blocos16.json`: a tira vertical e o manifesto que o jogo carrega;
 * - `preview/blocos16.png`: folha de aprovação por print (não vai para o jogo).
 * Falha se alguma camada reprovar no validador.
 */
export function buildOutputs(recipes: readonly TextureRecipe[] = BLOCK_TEXTURES): Map<string, Uint8Array> {
  const layers = generateLayers(recipes);
  const problems = validateLayers(layers);
  if (problems.length > 0) throw new Error(`texgen: validação reprovou:\n- ${problems.join('\n- ')}`);
  const files = new Map<string, Uint8Array>();
  for (const l of layers) files.set(`blocks/${l.name}.png`, encodePng(l.image));
  files.set(`${BLOCK_ARRAY_NAME}.png`, encodePng(buildStrip(layers)));
  files.set(
    `${BLOCK_ARRAY_NAME}.json`,
    new TextEncoder().encode(JSON.stringify(buildManifest(layers), null, 2) + '\n'),
  );
  files.set(`preview/${BLOCK_ARRAY_NAME}.png`, encodePng(buildPreview(layers)));
  return files;
}
