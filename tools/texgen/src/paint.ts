import type { LayerKind } from '@boboforces/format';
import { createRng, type Rng } from '@boboforces/shared';
import { forEachTextPixel } from './font.ts';
import { ramp, type RampName } from './palette.ts';
import type { RgbaImage } from './png.ts';

/**
 * Tipo da camada (o mesmo `LayerKind` do manifesto `layers@1`): opaca e emissiva têm alfa sempre 255; cutout só 0 ou
 * 255 (o shader faz `discard` abaixo de 0,5); translúcida tem alfa livre (vidro e água da bancada).
 */
export type TextureKind = LayerKind;

/**
 * Família de material (arte-ux.md §1.3). Muda o que o validador e os testes cobram:
 * - `continuo` (concreto, grama, terra, água): seamless, sem borda pintada, manchas de 2–3 px, sem xadrez;
 * - `modular` (placa, painel, tijolo, tábua, caixote): bevel pintado de 1 px, a grade de 0,5 m aparece de propósito;
 * - `sinal` (placas, letreiros, emissivos): pictograma ou palavra curta genérica em pt-BR;
 * - `vegetacao` (cruz e folhas): cutout com mips de cobertura preservada;
 * - `debug` (o xadrez do `missing`): pode usar cor de time e preto puro.
 */
export type MaterialClass = 'continuo' | 'modular' | 'sinal' | 'vegetacao' | 'debug';

/** Pincel de pixel-art sobre uma imagem RGBA8 quadrada. Coordenadas dão a volta (wrap): materiais contínuos ficam seamless. */
export interface Paint {
  readonly size: number;
  /** RNG próprio desta camada (semente fixa pelo nome): a mesma receita sempre gera os mesmos pixels. */
  readonly rng: Rng;
  /** Cores de uma rampa da paleta mestra, do escuro para o claro. */
  ramp(name: RampName): readonly number[];
  /** Um tom de uma rampa (lança se o tom não existir: erro de receita, não de dado). */
  tone(name: RampName, index: number): number;
  fill(rgb: number): void;
  px(x: number, y: number, rgb: number): void;
  /** Pixel com alfa (só em camadas translúcidas; alfa 255 = opaco). */
  pxa(x: number, y: number, rgb: number, alpha: number): void;
  /** Pixel transparente (cutout e translúcido). */
  clear(x: number, y: number): void;
  /** Cor 0xRRGGBB do pixel (alfa ignorado). */
  get(x: number, y: number): number;
  alpha(x: number, y: number): number;
  rect(x: number, y: number, w: number, h: number, rgb: number): void;
  hline(x: number, y: number, w: number, rgb: number): void;
  vline(x: number, y: number, h: number, rgb: number): void;
  /**
   * Manchas de 2 a 3 px (arte-ux.md §1.3: nada de xadrez de dithering, que vira moiré em 640×360). Cada mancha é um
   * bloquinho de `w × h` (2..3) com um canto às vezes arredondado, com wrap.
   */
  blotches(count: number, rgb: number, minSize?: number, maxSize?: number): void;
  /** Bevel de 1 px de material modular: +1 tom em cima/esquerda e −1 tom embaixo/direita, dentro do retângulo. */
  bevel(x: number, y: number, w: number, h: number, light: number, dark: number): void;
  /**
   * Pixel-art em texto (arte-ux.md §12): cada caractere de `rows` é uma chave de `colors`; `.` e espaço não pintam e
   * `null` limpa o pixel. Canto de cima à esquerda em (x, y).
   */
  grid(x: number, y: number, rows: readonly string[], colors: Readonly<Record<string, number | null>>): void;
  /** Texto na fonte 3×5 do texgen. */
  text(x: number, y: number, text: string, rgb: number): void;
}

export interface LayerRecipe {
  /** Nome estável da camada base (variante a, quadro 0). Camada publicada nunca muda de nome. */
  readonly name: string;
  readonly kind: TextureKind;
  readonly material: MaterialClass;
  /**
   * Variantes sorteadas no shader por célula (`BlockDef.variants`; 1 = sem variante). Viram camadas seguidas na tira:
   * `<nome>`, `<nome>_b`, `<nome>_c`…
   */
  readonly variants?: number;
  /** Quadros de animação (`BlockDef.frames`, 4 qps): `<nome>`, `<nome>#1`, `<nome>#2`… dentro de cada variante. */
  readonly frames?: number;
  /**
   * Desenha uma camada física. `variant` e `frame` começam em 0. A semente do RNG é o nome da variante (os quadros de
   * uma variante dividem as mesmas manchas; o que anda entre quadros vem de `frame`).
   */
  draw(p: Paint, variant: number, frame: number): void;
}

/** @deprecated Nome do M0; use `LayerRecipe`. */
export type TextureRecipe = LayerRecipe;

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
  const pxa = (x: number, y: number, rgb: number, alpha: number): void => {
    const i = at(x, y);
    d[i] = (rgb >> 16) & 0xff;
    d[i + 1] = (rgb >> 8) & 0xff;
    d[i + 2] = rgb & 0xff;
    d[i + 3] = alpha;
  };
  const px = (x: number, y: number, rgb: number): void => pxa(x, y, rgb, 255);
  const rect = (x: number, y: number, w: number, h: number, rgb: number): void => {
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) px(x + xx, y + yy, rgb);
  };
  return {
    size,
    rng,
    ramp,
    tone(name, index) {
      const c = ramp(name)[index];
      if (c === undefined) throw new Error(`texgen: a rampa "${name}" não tem o tom ${index}`);
      return c;
    },
    fill: (rgb) => rect(0, 0, size, size, rgb),
    px,
    pxa,
    clear(x, y) {
      d.fill(0, at(x, y), at(x, y) + 4);
    },
    get(x, y) {
      const i = at(x, y);
      return (d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!;
    },
    alpha: (x, y) => d[at(x, y) + 3]!,
    rect,
    hline: (x, y, w, rgb) => rect(x, y, w, 1, rgb),
    vline: (x, y, h, rgb) => rect(x, y, 1, h, rgb),
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
    grid(x, y, rows, colors) {
      rows.forEach((row, gy) => {
        for (let gx = 0; gx < row.length; gx++) {
          const ch = row[gx]!;
          if (ch === '.' || ch === ' ') continue;
          const c = colors[ch];
          if (c === undefined) throw new Error(`texgen: caractere "${ch}" sem cor no grid`);
          if (c === null) d.fill(0, at(x + gx, y + gy), at(x + gx, y + gy) + 4);
          else px(x + gx, y + gy, c);
        }
      });
    },
    text(x, y, text, rgb) {
      forEachTextPixel(text, x, y, (tx, ty) => px(tx, ty, rgb));
    },
  };
}

/** Nome da camada física de uma variante (`grass`, `grass_b`, `grass_c`…). */
export function variantLayerName(base: string, variant: number): string {
  return variant === 0 ? base : `${base}_${String.fromCharCode(97 + variant)}`;
}

/** Nome da camada física de um quadro (`water`, `water#1`…), como no manifesto `layers@1`. */
export function frameLayerName(variantName: string, frame: number): string {
  return frame === 0 ? variantName : `${variantName}#${frame}`;
}

/** Roda uma receita numa imagem nova (uma camada física). */
export function renderRecipe(recipe: LayerRecipe, size: number, variant = 0, frame = 0): RgbaImage {
  const image = createImage(size);
  recipe.draw(createPaint(image, variantLayerName(recipe.name, variant)), variant, frame);
  return image;
}
