/**
 * Borda do Construto (arte-ux.md §5.1): grama, lateral da grama e terra (contínuos, 3 variantes cada, sorteadas no
 * shader por célula), folhas de árvore de bloco e a vegetação em cruz (mato alto, flores, arbusto).
 *
 * A cruz recebe a camada de `px` com a UV de mundo (`uv = dot(p, T) × 2`): a diagonal da célula mede 1,41 camada, então
 * a textura da cruz precisa ser seamless na horizontal (repete em 1,41) e alinhada em baixo (linha 15 = chão).
 */
import type { LayerRecipe, Paint } from '../../../tools/texgen/src/paint.ts';

/** Terra: base, manchas ±1 tom e pedrinhas de 2 px com sombra. */
function paintDirt(p: Paint): void {
  const t = p.ramp('terra');
  const c = p.ramp('concreto');
  p.fill(t[2]!);
  p.blotches(6, t[1]!);
  p.blotches(6, t[3]!);
  for (let i = 0; i < 3; i++) {
    const x = p.rng.int(0, 16);
    const y = p.rng.int(0, 16);
    p.px(x, y, c[4]!);
    p.px(x + 1, y, c[3]!);
    p.px(x, y + 1, t[1]!);
    p.px(x + 1, y + 1, t[1]!);
  }
}

const grass: LayerRecipe = {
  name: 'grass',
  kind: 'opaque',
  material: 'continuo',
  variants: 3,
  draw(p, variant) {
    const g = p.ramp('grama');
    p.fill(g[2]!);
    p.blotches(5, g[1]!);
    p.blotches(4, g[3]!);
    p.blotches(1, g[4]!, 2, 2);
    if (variant === 1) p.blotches(3, g[1]!, 2, 2);
    if (variant === 2) p.blotches(2, g[3]!, 3, 3);
  },
};

/** Lateral do bloco de grama: terra embaixo e franja de grama de 3 a 5 px em cima, irregular por coluna. */
const grassSide: LayerRecipe = {
  name: 'grass_side',
  kind: 'opaque',
  material: 'continuo',
  variants: 3,
  draw(p) {
    paintDirt(p);
    const g = p.ramp('grama');
    for (let x = 0; x < 16; x++) {
      const depth = p.rng.int(3, 6);
      for (let y = 0; y < depth; y++) p.px(x, y, y === 0 ? g[3]! : y === depth - 1 ? g[1]! : g[2]!);
    }
    // Brilho de folha só dentro da franja (linha 1), nunca na terra.
    for (let i = 0; i < 3; i++) p.hline(p.rng.int(0, 16), 1, 2, g[3]!);
  },
};

const dirt: LayerRecipe = {
  name: 'dirt',
  kind: 'opaque',
  material: 'continuo',
  variants: 3,
  draw(p, variant) {
    paintDirt(p);
    if (variant === 2) {
      // Raiz fina.
      const t = p.ramp('terra');
      const x = p.rng.int(0, 16);
      const y = p.rng.int(0, 16);
      p.hline(x, y, 3, t[0]!);
      p.hline(x + 3, y + 1, 2, t[0]!);
    }
  },
};

/** Folhas do bloco de árvore (cutout): massa verde com sombra, brilho e furinhos. */
const leaves: LayerRecipe = {
  name: 'leaves',
  kind: 'cutout',
  material: 'vegetacao',
  variants: 2,
  draw(p) {
    const g = p.ramp('grama');
    p.fill(g[2]!);
    p.blotches(6, g[1]!);
    p.blotches(5, g[3]!);
    p.blotches(2, g[4]!, 2, 2);
    for (let i = 0; i < 9; i++) {
      const x = p.rng.int(0, 16);
      const y = p.rng.int(0, 16);
      p.clear(x, y);
      if (p.rng.chance(0.5)) p.clear(x + 1, y);
      if (p.alpha(x, y + 1) > 0) p.px(x, y + 1, g[0]!);
    }
  },
};

/** Lâminas de mato a partir do chão (linha 15), com base escura e ponta clara. */
function paintBlades(p: Paint, count: number, minHeight: number, maxHeight: number): void {
  const g = p.ramp('grama');
  for (let i = 0; i < count; i++) {
    const x0 = p.rng.int(0, 16);
    const h = p.rng.int(minHeight, maxHeight + 1);
    const lean = p.rng.int(-1, 2);
    for (let k = 0; k < h; k++) {
      const x = x0 + Math.trunc((lean * k * 3) / h);
      const y = 15 - k;
      const c = k === h - 1 ? g[4]! : k < h * 0.35 ? g[1]! : k < h * 0.7 ? g[2]! : g[3]!;
      p.px(x, y, c);
      if (k < 2) p.px(x + 1, y, g[0]!);
    }
  }
}

const tallGrass: LayerRecipe = {
  name: 'tall_grass',
  kind: 'cutout',
  material: 'vegetacao',
  variants: 3,
  draw(p) {
    paintBlades(p, 11, 6, 15);
  },
};

/** Flores do mato (cutout): lâminas baixas e duas ou três flores de 3×3 em cores apagadas. */
const flowers: LayerRecipe = {
  name: 'flowers',
  kind: 'cutout',
  material: 'vegetacao',
  variants: 3,
  draw(p, variant) {
    paintBlades(p, 7, 3, 7);
    const g = p.ramp('grama');
    const petals = [p.tone('amarelo', 2), p.tone('placa', 3), p.tone('laranja', 3)][variant]!;
    const center = variant === 0 ? p.tone('laranja', 2) : p.tone('amarelo', 2);
    const heads = 2 + (variant === 1 ? 1 : 0);
    for (let i = 0; i < heads; i++) {
      const x = Math.floor((i * 16) / heads) + p.rng.int(1, 4);
      const y = p.rng.int(3, 8);
      p.vline(x, y + 2, 15 - y - 1, g[2]!);
      p.px(x, y + 1, center);
      p.px(x - 1, y + 1, petals);
      p.px(x + 1, y + 1, petals);
      p.px(x, y, petals);
      p.px(x, y + 2, petals);
    }
  },
};

/** Arbusto (cutout): faixa de folhagem seamless na horizontal com borda de cima recortada e base escura. */
const bush: LayerRecipe = {
  name: 'bush',
  kind: 'cutout',
  material: 'vegetacao',
  variants: 2,
  draw(p) {
    const g = p.ramp('grama');
    for (let x = 0; x < 16; x++) {
      const top = 3 + p.rng.int(0, 4) + (x % 5 === 0 ? 1 : 0);
      for (let y = top; y < 16; y++) {
        const depth = y - top;
        p.px(x, y, depth === 0 ? g[3]! : y > 12 ? g[0]! : y > 9 ? g[1]! : g[2]!);
      }
    }
    for (let i = 0; i < 4; i++) {
      const x = p.rng.int(0, 16);
      const y = p.rng.int(6, 11);
      if (p.alpha(x, y) > 0) p.hline(x, y, 2, g[3]!);
    }
    for (let i = 0; i < 4; i++) {
      const x = p.rng.int(0, 16);
      const y = p.rng.int(7, 13);
      if (p.alpha(x, y - 1) > 0) p.clear(x, y);
    }
  },
};

export const NATURE_TEXTURES: readonly LayerRecipe[] = [grass, grassSide, dirt, leaves, tallGrass, flowers, bush];
