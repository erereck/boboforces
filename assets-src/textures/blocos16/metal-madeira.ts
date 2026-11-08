/**
 * Metal, madeira e lona (arte-ux.md §5.1): painel verde-oliva, chapa xadrez, telhado de chapa ondulada, corrimão
 * zebrado, cerca de arame e grade de passarela (cutout), caixote militar, lona, tábuas, cerca de madeira e tronco.
 */
import type { LayerRecipe } from '../../../tools/texgen/src/paint.ts';

/** Painel de metal pintado (verde-oliva): bevel, rebites nos cantos, junta no meio e desgaste. */
const metal: LayerRecipe = {
  name: 'metal',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    const m = p.ramp('metal');
    p.fill(m[3]!);
    p.blotches(4, m[2]!, 2, 2);
    p.bevel(0, 0, 16, 16, m[4]!, m[1]!);
    p.hline(1, 7, 14, m[2]!);
    p.hline(1, 8, 14, m[4]!);
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

/** Chapa xadrez de aço (topo do painel de metal): ressaltos de 3 px em diagonais alternadas, sombra embaixo. */
const checkerPlate: LayerRecipe = {
  name: 'checker_plate',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    const a = p.ramp('aco');
    p.fill(a[2]!);
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        const x = i * 4 + 1;
        const y = j * 4 + 1;
        const down = (i + j) % 2 === 0;
        for (let k = 0; k < 2; k++) {
          const lx = down ? x + k : x + 1 - k;
          p.px(lx, y + k, a[3]!);
          p.px(lx, y + k + 1, a[1]!);
        }
      }
    }
    p.bevel(0, 0, 16, 16, a[3]!, a[1]!);
  },
};

/** Telhado de chapa ondulada: nervuras a cada 4 px descendo a rampa (a tangente é sempre horizontal) e escorridos. */
const metalRoof: LayerRecipe = {
  name: 'metal_roof',
  kind: 'opaque',
  material: 'continuo',
  draw(p) {
    const a = p.ramp('aco');
    for (let x = 0; x < 16; x++) {
      const col = x % 4;
      p.vline(x, 0, 16, col === 0 ? a[3]! : col === 3 ? a[1]! : a[2]!);
    }
    for (let i = 0; i < 3; i++) {
      const x = p.rng.int(0, 4) * 4 + 1 + p.rng.int(0, 2);
      p.vline(x, p.rng.int(0, 16), p.rng.int(3, 6), a[1]!);
    }
  },
};

/** Corrimão e guarda-corpo: aço pintado com zebrado amarelo e grafite em diagonal (período de 8 px). */
const railing: LayerRecipe = {
  name: 'railing',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    const y = p.ramp('amarelo');
    const dark = p.tone('concreto', 1);
    for (let py = 0; py < 16; py++) {
      for (let px = 0; px < 16; px++) {
        const band = (px + py) % 8;
        p.px(px, py, band < 4 ? (band === 0 ? y[2]! : y[1]!) : dark);
      }
    }
  },
};

/**
 * Cerca de arame (cutout): losangos de 8 px em fio galvanizado (um sentido pega luz, o outro não) com nó escuro no
 * cruzamento; deixa passar bala e visão (GDD §4.6.1).
 */
const fenceWire: LayerRecipe = {
  name: 'fence_wire',
  kind: 'cutout',
  material: 'modular',
  draw(p) {
    const a = p.ramp('aco');
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const rising = (x + y) % 8 === 0;
        const falling = (x - y + 16) % 8 === 0;
        if (rising && falling) p.px(x, y, a[1]!);
        else if (rising) p.px(x, y, a[3]!);
        else if (falling) p.px(x, y, a[2]!);
      }
    }
  },
};

/** Grade de passarela (cutout): barras portantes a cada 4 px (topo claro, face escura) e travessas a cada 8 px. */
const grate: LayerRecipe = {
  name: 'grate',
  kind: 'cutout',
  material: 'modular',
  draw(p) {
    const a = p.ramp('aco');
    for (let y = 0; y < 16; y += 4) {
      p.hline(0, y, 16, a[3]!);
      p.hline(0, y + 1, 16, a[1]!);
    }
    for (const x of [3, 11]) {
      for (let y = 0; y < 16; y++) if (y % 4 >= 2) p.px(x, y, a[2]!);
    }
  },
};

/** Caixote militar (laterais): moldura de 2 px, tábuas e travessa diagonal, em verde-oliva. */
const crate: LayerRecipe = {
  name: 'crate',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    const m = p.ramp('metal');
    p.fill(m[2]!);
    p.hline(2, 6, 12, m[1]!);
    p.hline(2, 10, 12, m[1]!);
    // Travessa diagonal de 2 px (luz em cima, sombra embaixo).
    for (let i = 0; i < 12; i++) {
      const x = 2 + i;
      const y = 13 - i;
      p.px(x, y, m[3]!);
      p.px(x, y - 1, m[4]!);
      p.px(x, y + 1, m[1]!);
    }
    // Moldura.
    p.rect(0, 0, 16, 2, m[3]!);
    p.rect(0, 14, 16, 2, m[3]!);
    p.rect(0, 0, 2, 16, m[3]!);
    p.rect(14, 0, 2, 16, m[3]!);
    p.bevel(0, 0, 16, 16, m[4]!, m[0]!);
    p.hline(2, 2, 12, m[1]!);
    p.vline(2, 2, 12, m[1]!);
    for (const [x, y] of [
      [1, 1],
      [14, 1],
      [1, 14],
      [14, 14],
    ] as const)
      p.px(x, y, m[1]!);
  },
};

/** Tampa do caixote: moldura e tábuas ao longo de X, pregos nas pontas. */
const crateTop: LayerRecipe = {
  name: 'crate_top',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    const m = p.ramp('metal');
    p.fill(m[2]!);
    p.blotches(2, m[3]!, 2, 2);
    for (const y of [5, 10]) {
      p.hline(2, y, 12, m[1]!);
      p.hline(2, y + 1, 12, m[3]!);
    }
    p.rect(0, 0, 16, 2, m[3]!);
    p.rect(0, 14, 16, 2, m[3]!);
    p.rect(0, 0, 2, 16, m[3]!);
    p.rect(14, 0, 2, 16, m[3]!);
    p.bevel(0, 0, 16, 16, m[4]!, m[0]!);
    p.hline(2, 2, 12, m[1]!);
    p.vline(2, 2, 12, m[1]!);
    for (const y of [3, 8, 12]) {
      p.px(3, y, m[1]!);
      p.px(12, y, m[1]!);
    }
  },
};

/** Lona verde-oliva: dobras em manchas compridas (luz em cima, sombra embaixo) e uma costura pespontada. */
const canvas: LayerRecipe = {
  name: 'canvas',
  kind: 'opaque',
  material: 'continuo',
  draw(p) {
    const l = p.ramp('lona');
    p.fill(l[2]!);
    p.blotches(3, l[1]!, 2, 3);
    for (let i = 0; i < 4; i++) {
      const x = p.rng.int(0, 16);
      const y = p.rng.int(0, 16);
      const len = p.rng.int(3, 6);
      p.hline(x, y, len, l[3]!);
      p.hline(x + 1, y + 1, len, l[1]!);
    }
    for (let x = 0; x < 16; x++) if (x % 3 !== 2) p.px(x, 13, l[1]!);
    p.hline(0, 12, 16, l[2]!);
  },
};

/** Tábuas horizontais de 4 px com veio, emenda e bevel por tábua (o `plank` e a laje de madeira). */
const wood: LayerRecipe = {
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
      for (let g = 0; g < 2; g++) p.hline(p.rng.int(0, 16), y + 1 + p.rng.int(0, 2), p.rng.int(2, 5), w[base - 1]!);
      p.hline(0, y, 16, w[base + 1]!);
      p.hline(0, y + 3, 16, w[base - 1]!);
      // Emenda da tábua (fresta: o tom mais escuro da rampa).
      const joint = p.rng.int(2, 14);
      p.vline(joint, y + 1, 2, w[0]!);
      p.px(joint + 1, y + 1, w[base + 1]!);
    }
  },
};

/** Cerca de madeira fechada (painel fino): tábuas verticais de 4 px e duas travessas pregadas. Bloqueia tudo. */
const fenceWood: LayerRecipe = {
  name: 'fence_wood',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    const w = p.ramp('madeira');
    for (let k = 0; k < 4; k++) {
      const x = k * 4;
      const base = k % 2 === 0 ? 2 : 3;
      p.rect(x, 0, 4, 16, w[base]!);
      p.vline(x, 0, 16, w[base + 1]!);
      p.vline(x + 3, 0, 16, w[1]!);
      p.vline(x + 1 + p.rng.int(0, 2), p.rng.int(0, 10), p.rng.int(3, 6), w[base - 1]!);
    }
    for (const y of [3, 11]) {
      p.hline(0, y, 16, w[3]!);
      p.hline(0, y + 1, 16, w[2]!);
      p.hline(0, y + 2, 16, w[1]!);
      for (let k = 0; k < 4; k++) p.px(k * 4 + 1, y + 1, w[0]!);
    }
  },
};

/** Casca do tronco: base escura com sulcos verticais e lascas claras (contínua em Y). */
const log: LayerRecipe = {
  name: 'log',
  kind: 'opaque',
  material: 'continuo',
  draw(p) {
    const w = p.ramp('madeira');
    p.fill(w[1]!);
    for (let i = 0; i < 6; i++) {
      const x = p.rng.int(0, 16);
      const y = p.rng.int(0, 16);
      const len = p.rng.int(3, 7);
      p.vline(x, y, len, w[0]!);
      p.vline(x + 1, y + 1, len - 1, w[2]!);
    }
    p.blotches(2, w[2]!, 2, 2);
  },
};

/** Topo do tronco: anéis quadrados (estilo bloco) com casca de 1 px. */
const logTop: LayerRecipe = {
  name: 'log_top',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    const w = p.ramp('madeira');
    p.fill(w[3]!);
    const ring = (inset: number, rgb: number): void => {
      const s = 16 - inset * 2;
      p.hline(inset + 1, inset, s - 2, rgb);
      p.hline(inset + 1, inset + s - 1, s - 2, rgb);
      p.vline(inset, inset + 1, s - 2, rgb);
      p.vline(inset + s - 1, inset + 1, s - 2, rgb);
    };
    p.rect(0, 0, 16, 16, w[1]!);
    p.rect(1, 1, 14, 14, w[3]!);
    ring(3, w[2]!);
    ring(5, w[4]!);
    p.rect(7, 7, 2, 2, w[2]!);
    p.px(0, 0, w[0]!);
    p.px(15, 0, w[0]!);
    p.px(0, 15, w[0]!);
    p.px(15, 15, w[0]!);
  },
};

export const METAL_WOOD_TEXTURES: readonly LayerRecipe[] = [
  metal,
  checkerPlate,
  metalRoof,
  railing,
  fenceWire,
  grate,
  crate,
  crateTop,
  canvas,
  wood,
  fenceWood,
  log,
  logTop,
];
