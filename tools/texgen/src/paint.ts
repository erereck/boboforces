import { createRng, type Rng } from '@boboforces/shared';
import { ramp, type RampName } from './palette.ts';
import type { RgbaImage } from './png.ts';

/** Tipo da camada: opaca (alfa sempre 255) ou cutout (alfa só 0 ou 255). Translúcido chega com o vidro (M1). */
export type TextureKind = 'opaque' | 'cutout';

/** Pincel de pixel-art sobre uma imagem RGBA8 quadrada. Coordenadas dão a volta (wrap): materiais contínuos ficam seamless. */
export interface Paint {
  readonly size: number;
  /** RNG próprio desta textura (semente fixa por nome): a mesma receita sempre gera os mesmos pixels. */
  readonly rng: Rng;
  /** Cores de uma rampa da paleta mestra, do escuro para o claro. */
  ramp(name: RampName): readonly number[];
  fill(rgb: number): void;
  px(x: number, y: number, rgb: number): void;
  /** Pixel transparente (só em camadas cutout). */
  clear(x: number, y: number): void;
  get(x: number, y: number): number;
  rect(x: number, y: number, w: number, h: number, rgb: number): void;
  /**
   * Manchas de 2 a 3 px (arte-ux.md §1.3: nada de xadrez de dithering, que vira moiré em 640×360). Cada mancha é um
   * bloquinho de `w × h` (2..3) com um canto às vezes arredondado, com wrap.
   */
  blotches(count: number, rgb: number, minSize?: number, maxSize?: number): void;
  /** Bevel de 1 px de material modular: +1 tom em cima/esquerda e −1 tom embaixo/direita, dentro do retângulo. */
  bevel(x: number, y: number, w: number, h: number, light: number, dark: number): void;
}

export interface TextureRecipe {
  /** Nome estável da camada (vira a chave do manifesto; nunca renomeie uma camada publicada). */
  readonly name: string;
  readonly kind: TextureKind;
  /** Material contínuo (seamless, sem borda pintada) ou modular (com bevel). Só documenta a intenção. */
  readonly material: 'continuo' | 'modular';
  draw(p: Paint): void;
}

export const TEXGEN_SEED = 'boboforces/texgen';

const mod = (a: number, n: number): number => ((a % n) + n) % n;

export function createImage(size: number): RgbaImage & { readonly data: Uint8Array } {
  return { width: size, height: size, data: new Uint8Array(size * size * 4) };
}

export function createPaint(image: RgbaImage, seedName: string): Paint {
  const size = image.width;
  const d = image.data;
  const rng = createRng(TEXGEN_SEED).fork(seedName);
  const at = (x: number, y: number): number => (mod(y, size) * size + mod(x, size)) * 4;
  const px = (x: number, y: number, rgb: number): void => {
    const i = at(x, y);
    d[i] = (rgb >> 16) & 0xff;
    d[i + 1] = (rgb >> 8) & 0xff;
    d[i + 2] = rgb & 0xff;
    d[i + 3] = 255;
  };
  const rect = (x: number, y: number, w: number, h: number, rgb: number): void => {
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) px(x + xx, y + yy, rgb);
  };
  return {
    size,
    rng,
    ramp,
    fill: (rgb) => rect(0, 0, size, size, rgb),
    px,
    clear(x, y) {
      d.fill(0, at(x, y), at(x, y) + 4);
    },
    get(x, y) {
      const i = at(x, y);
      return (d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!;
    },
    rect,
    blotches(count, rgb, minSize = 2, maxSize = 3) {
      for (let n = 0; n < count; n++) {
        const w = rng.int(minSize, maxSize + 1);
        const h = rng.int(minSize, maxSize + 1);
        const x = rng.int(0, size);
        const y = rng.int(0, size);
        // Bloquinhos de 3 perdem um canto (forma menos quadrada, sem virar ruído de 1 px).
        const skip = w === 3 && h === 3 ? rng.int(0, 4) : -1;
        for (let yy = 0; yy < h; yy++) {
          for (let xx = 0; xx < w; xx++) {
            const cornerIndex = (yy === 0 ? 0 : yy === h - 1 ? 2 : -10) + (xx === 0 ? 0 : xx === w - 1 ? 1 : -10);
            if (cornerIndex === skip) continue;
            px(x + xx, y + yy, rgb);
          }
        }
      }
    },
    bevel(x, y, w, h, light, dark) {
      for (let i = 0; i < w; i++) {
        px(x + i, y, light);
        px(x + i, y + h - 1, dark);
      }
      for (let i = 1; i < h - 1; i++) {
        px(x, y + i, light);
        px(x + w - 1, y + i, dark);
      }
      // Canto de baixo/esquerda e de cima/direita: meio-termo fica com o escuro (luz vem de cima).
      px(x, y + h - 1, dark);
    },
  };
}

/** Roda uma receita numa imagem nova. */
export function renderRecipe(recipe: TextureRecipe, size: number): RgbaImage {
  const image = createImage(size);
  recipe.draw(createPaint(image, recipe.name));
  return image;
}
