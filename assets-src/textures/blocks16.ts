/**
 * Receitas das camadas de `blocos16` (16×16 px por face de bloco de 0,5 m, decisão #6). Fonte da verdade em texto
 * (arte-ux.md §12): o `tools/texgen` roda estas receitas, valida contra a paleta mestra e grava os PNGs em
 * `generated/`. Regenerar: `npm run texgen`.
 *
 * A ORDEM desta lista é a ordem das camadas no texture array (`generated/blocos16.json`). Camada publicada nunca muda
 * de nome; camada nova entra no fim.
 *
 * Regras de pixel-art (arte-ux.md §1.3): materiais contínuos (concreto, grama, terra) são seamless e sem borda;
 * modulares (metal, madeira, tijolo, placa de teste) têm bevel de 1 px (+1 tom em cima/esquerda, −1 embaixo/direita);
 * manchas de 2–3 px, nada de xadrez; sombreado pintado de no máximo ±1 tom, porque o volume vem da luz do motor.
 */
import type { Paint, TextureRecipe } from '../../tools/texgen/src/paint.ts';

/** Concreto liso: base média, manchas ±1 tom e poros escuros esparsos. */
const concrete: TextureRecipe = {
  name: 'concrete',
  kind: 'opaque',
  material: 'continuo',
  draw(p) {
    const c = p.ramp('concreto');
    p.fill(c[3]!);
    p.blotches(5, c[2]!);
    p.blotches(4, c[4]!);
    for (let i = 0; i < 3; i++) p.px(p.rng.int(0, 16), p.rng.int(0, 16), c[2]!);
  },
};

/** Painel de metal pintado (verde-oliva): bevel, rebites nos cantos, junta no meio e desgaste. */
const metal: TextureRecipe = {
  name: 'metal',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    const m = p.ramp('metal');
    p.fill(m[3]!);
    p.blotches(4, m[2]!, 2, 2);
    p.bevel(0, 0, 16, 16, m[4]!, m[1]!);
    // Junta horizontal: sombra embaixo da linha clara.
    for (let x = 1; x < 15; x++) {
      p.px(x, 7, m[2]!);
      p.px(x, 8, m[4]!);
    }
    for (const [x, y] of [
      [2, 2],
      [13, 2],
      [2, 12],
      [13, 12],
    ] as const) {
      p.px(x, y, m[4]!);
      p.px(x + 1, y + 1, m[1]!);
    }
  },
};

/** Tábuas horizontais de 4 px com veio, emenda e bevel por tábua. */
const wood: TextureRecipe = {
  name: 'wood',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    const w = p.ramp('madeira');
    for (let plank = 0; plank < 4; plank++) {
      const y = plank * 4;
      const base = p.rng.chance(0.5) ? 3 : 2;
      p.rect(0, y, 16, 4, w[base]!);
      // Veio: riscos de 2 a 4 px um tom abaixo, nas linhas do meio.
      for (let g = 0; g < 2; g++) {
        const len = p.rng.int(2, 5);
        const gx = p.rng.int(0, 16);
        const gy = y + 1 + p.rng.int(0, 2);
        for (let i = 0; i < len; i++) p.px(gx + i, gy, w[base - 1]!);
      }
      for (let x = 0; x < 16; x++) {
        p.px(x, y, w[base + 1]!);
        p.px(x, y + 3, w[base - 1]!);
      }
      // Emenda da tábua em x aleatório (a grade de 0,5 m aparece de propósito, como no Block Strike).
      const joint = p.rng.int(2, 14);
      for (let i = 1; i < 3; i++) p.px(joint, y + i, w[1]!);
      p.px(joint + 1, y + 1, w[base + 1]!);
    }
  },
};

/** Grama vista de cima: base, manchas escuras e claras, tufos. */
const grass: TextureRecipe = {
  name: 'grass',
  kind: 'opaque',
  material: 'continuo',
  draw(p) {
    const g = p.ramp('grama');
    p.fill(g[3]!);
    p.blotches(7, g[2]!);
    p.blotches(5, g[4]!);
    p.blotches(2, g[5]!, 2, 2);
  },
};

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

const dirt: TextureRecipe = { name: 'dirt', kind: 'opaque', material: 'continuo', draw: paintDirt };

/** Lateral do bloco de grama: terra embaixo e franja de grama de 3 a 5 px em cima, irregular por coluna. */
const grassSide: TextureRecipe = {
  name: 'grass_side',
  kind: 'opaque',
  material: 'continuo',
  draw(p) {
    paintDirt(p);
    const g = p.ramp('grama');
    for (let x = 0; x < 16; x++) {
      const depth = p.rng.int(3, 6);
      for (let y = 0; y < depth; y++) p.px(x, y, y === 0 ? g[4]! : y === depth - 1 ? g[2]! : g[3]!);
    }
    // Brilho de folha só dentro da franja (linha 1), nunca na terra.
    for (let i = 0; i < 4; i++) p.px(p.rng.int(0, 16), 1, g[4]!);
  },
};

/** Tijolo: fiadas de 4 px (3 de tijolo + 1 de argamassa), tijolos de 8 px desencontrados. */
const brick: TextureRecipe = {
  name: 'brick',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    const b = p.ramp('tijolo');
    const mortar = p.ramp('concreto')[4]!;
    p.fill(mortar);
    for (let row = 0; row < 4; row++) {
      const y = row * 4;
      const offset = row % 2 === 0 ? 0 : 4;
      for (let col = 0; col < 2; col++) {
        const x = offset + col * 8;
        const tone = p.rng.chance(0.5) ? 2 : 3;
        p.rect(x, y, 7, 3, b[tone]!);
        for (let i = 0; i < 7; i++) p.px(x + i, y, b[tone + 1]!);
        p.px(x + 6, y + 2, b[tone - 1]!);
        p.px(x + 5, y + 2, b[tone - 1]!);
        if (p.rng.chance(0.6)) p.px(x + p.rng.int(1, 5), y + 1, b[tone - 1]!);
      }
    }
  },
};

/** Piso de teste do Construto: placa cinza-claro com a grade de 0,5 m pintada pelo bevel e marcas de uso. */
const testFloor: TextureRecipe = {
  name: 'test_floor',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    const pl = p.ramp('placa');
    const c = p.ramp('concreto');
    p.fill(pl[1]!);
    p.blotches(2, pl[0]!, 2, 2);
    p.bevel(0, 0, 16, 16, pl[2]!, c[4]!);
    // Cruz de centro discreta (ajuda a ler distância no chão).
    p.px(7, 7, pl[0]!);
    p.px(8, 7, pl[0]!);
    p.px(7, 8, pl[0]!);
    p.px(8, 8, pl[0]!);
  },
};

export const BLOCK_TEXTURES: readonly TextureRecipe[] = [
  concrete,
  metal,
  wood,
  grass,
  grassSide,
  dirt,
  brick,
  testFloor,
];
