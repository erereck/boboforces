// Montagem dos dados de texture array (sem three, testável em Node). As imagens chegam já decodificadas pelo PNG
// próprio do `format` (nunca `Image`/`ImageBitmap`/`TextureLoader`: tecnico.md §6.1 e §6.11).
import { MAX_BLOCK_LAYERS } from './limits.ts';
import type { TextureArrayData } from './types.ts';

/** Imagem RGBA8 (forma de `DecodedImage` do `format`, sem depender do pacote). */
export interface RgbaImageLike {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/**
 * Tira vertical (camada i nas linhas [i·h, (i+1)·h), formato do `tools/texgen`) → `TextureArrayData`. As camadas já
 * ficam contíguas na ordem certa, então o nível 0 é a própria `data` da imagem (sem cópia).
 */
export function textureArrayFromStrip(
  image: RgbaImageLike,
  layerWidth = image.width,
  layerHeight = layerWidth,
): TextureArrayData {
  if (image.width !== layerWidth) throw new Error(`render: tira com largura ${image.width}, esperado ${layerWidth}`);
  if (image.height % layerHeight !== 0)
    throw new Error(`render: altura ${image.height} não é múltipla de ${layerHeight}`);
  const data: TextureArrayData = {
    width: layerWidth,
    height: layerHeight,
    layers: image.height / layerHeight,
    levels: [image.data],
  };
  assertTextureArray(data);
  return data;
}

/** Camadas soltas do mesmo tamanho → `TextureArrayData` (copia para um buffer contíguo). */
export function textureArrayFromLayers(layers: readonly RgbaImageLike[]): TextureArrayData {
  if (layers.length === 0) throw new Error('render: texture array sem camadas');
  const { width, height } = layers[0]!;
  const layerBytes = width * height * 4;
  const level0 = new Uint8Array(layerBytes * layers.length);
  layers.forEach((l, i) => {
    if (l.width !== width || l.height !== height) {
      throw new Error(`render: camada ${i} com ${l.width}×${l.height}, esperado ${width}×${height}`);
    }
    level0.set(l.data, i * layerBytes);
  });
  const data: TextureArrayData = { width, height, layers: layers.length, levels: [level0] };
  assertTextureArray(data);
  return data;
}

/** Confere um `TextureArrayData` antes de ir para a GPU (lança com a mensagem do problema). */
export function assertTextureArray(data: TextureArrayData): void {
  const { width, height, layers, levels } = data;
  if (!isPowerOfTwo(width) || !isPowerOfTwo(height)) {
    // Sem potência de 2 o three não gera mipmap e o pixel-art cintila ao longe.
    throw new Error(`render: camada ${width}×${height} precisa ser potência de 2`);
  }
  if (layers < 1 || layers > MAX_BLOCK_LAYERS) throw new Error(`render: ${layers} camadas (1..${MAX_BLOCK_LAYERS})`);
  const level0 = levels[0];
  if (!level0) throw new Error('render: texture array sem o nível 0');
  if (level0.length !== width * height * 4 * layers) {
    throw new Error(`render: nível 0 com ${level0.length} bytes, esperado ${width * height * 4 * layers}`);
  }
}
