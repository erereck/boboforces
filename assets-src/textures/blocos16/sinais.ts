/**
 * Emissivos e sinalização (arte-ux.md §1.3 e §1.11): painel luminoso, luminária de grade, faixa de LED, placa de
 * SAÍDA como pictograma e o letreiro genérico "PERIGO". Só pictogramas e palavras curtas em pt-BR; nada de marca,
 * lugar real, bandeira ou insígnia.
 *
 * Camadas `emissive` são opacas (alfa 255); o brilho vem do bloco (`BlockDef.emissive` alimenta o flood fill e o canal
 * emissivo do vértice). As partes claras da textura são as que "acendem" mais.
 */
import type { LayerRecipe } from '../../../tools/texgen/src/paint.ts';
import { paintConcrete } from './construto.ts';

/** Painel luminoso de teto: moldura de aço e difusor branco-quente. */
const lightPanel: LayerRecipe = {
  name: 'light_panel',
  kind: 'emissive',
  material: 'sinal',
  draw(p) {
    const a = p.ramp('aco');
    const e = p.ramp('emissivo');
    p.fill(a[1]!);
    p.bevel(0, 0, 16, 16, a[2]!, a[0]!);
    p.rect(2, 2, 12, 12, p.tone('placa', 3));
    p.rect(3, 3, 10, 10, e[2]!);
    p.hline(3, 3, 10, p.tone('neutro', 1));
    p.vline(3, 4, 9, p.tone('neutro', 1));
  },
};

/** Luminária de grade: bulbo âmbar com miolo branco-quente atrás de uma grade de aço em cruz. */
const lamp: LayerRecipe = {
  name: 'lamp',
  kind: 'emissive',
  material: 'sinal',
  draw(p) {
    const a = p.ramp('aco');
    const e = p.ramp('emissivo');
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const dx = x - 7.5;
        const dy = y - 7.5;
        const r2 = dx * dx + dy * dy;
        p.px(x, y, r2 < 14 ? e[2]! : r2 < 40 ? e[1]! : p.tone('amarelo', 2));
      }
    }
    p.bevel(0, 0, 16, 16, a[2]!, a[1]!);
    p.vline(7, 1, 14, a[2]!);
    p.vline(8, 1, 14, a[1]!);
    p.hline(1, 7, 14, a[2]!);
    p.hline(1, 8, 14, a[1]!);
  },
};

/** Faixa de LED numa fiada de concreto: perfil de aço e luz fria contínua (amarra com paredes de concreto). */
const ledStrip: LayerRecipe = {
  name: 'led_strip',
  kind: 'emissive',
  material: 'sinal',
  draw(p) {
    paintConcrete(p, 0);
    const a = p.ramp('aco');
    p.hline(0, 6, 16, a[2]!);
    p.hline(0, 7, 16, p.tone('neutro', 1));
    p.hline(0, 8, 16, p.tone('emissivo', 0));
    p.hline(0, 9, 16, a[0]!);
    for (let x = 1; x < 16; x += 4) p.px(x, 6, a[3]!);
  },
};

/**
 * Placa de SAÍDA como pictograma (sem texto): bonequinho correndo para uma porta, branco sobre verde, moldura de aço.
 * F moldura, g verde, d verde-escuro (vão da porta), W branco.
 */
const EXIT_SIGN = [
  'FFFFFFFFFFFFFFFF',
  'FggggggggggggggF',
  'FggggggWWgWWWWgF',
  'FggggggWWgWddWgF',
  'FgggggggggWddWgF',
  'FggggWWWWgWddWgF',
  'FgggWgWWgWWddWgF',
  'FggggWWWggWddWgF',
  'FgggggWWggWddWgF',
  'FggggWWgWgWddWgF',
  'FgggWWgggWWddWgF',
  'FgggWggggWWddWgF',
  'FggWgggggWWddWgF',
  'FggggggggWWWWWgF',
  'FggggggggggggggF',
  'FFFFFFFFFFFFFFFF',
];

const exitSign: LayerRecipe = {
  name: 'exit_sign',
  kind: 'emissive',
  material: 'sinal',
  draw(p) {
    p.grid(0, 0, EXIT_SIGN, {
      F: p.tone('aco', 1),
      g: p.tone('grama', 3),
      d: p.tone('grama', 1),
      W: p.tone('placa', 3),
    });
    p.hline(1, 1, 14, p.tone('grama', 4));
  },
};

/**
 * Letreiro "PERIGO" em dois blocos (letras 4×7): `danger_sign_a` leva "PER" e `danger_sign_b` leva "IGO". As
 * definições de bloco cruzam as faces (`danger-sign-a`/`-b` em assets-src/blocks) para a palavra ler certo dos dois
 * lados quando A fica no menor x (ou z) e B no maior.
 */
const LETTERS: Readonly<Record<string, readonly string[]>> = {
  P: ['###.', '#..#', '#..#', '###.', '#...', '#...', '#...'],
  E: ['####', '#...', '#...', '###.', '#...', '#...', '####'],
  R: ['###.', '#..#', '#..#', '###.', '#.#.', '#..#', '#..#'],
  I: ['#', '#', '#', '#', '#', '#', '#'],
  G: ['.##.', '#..#', '#...', '#.##', '#..#', '#..#', '.##.'],
  O: ['.##.', '#..#', '#..#', '#..#', '#..#', '#..#', '.##.'],
};

function dangerHalf(name: string, letters: readonly [string, number][], border: 'left' | 'right'): LayerRecipe {
  return {
    name,
    kind: 'opaque',
    material: 'sinal',
    draw(p) {
      const y = p.ramp('amarelo');
      const ink = p.tone('concreto', 0);
      p.fill(y[2]!);
      p.hline(0, 1, 16, y[1]!);
      p.hline(0, 14, 16, y[1]!);
      p.hline(0, 0, 16, ink);
      p.hline(0, 15, 16, ink);
      p.vline(border === 'left' ? 0 : 15, 0, 16, ink);
      for (const [ch, x] of letters) p.grid(x, 4, LETTERS[ch]!, { '#': ink });
    },
  };
}

const dangerSignA = dangerHalf(
  'danger_sign_a',
  [
    ['P', 2],
    ['E', 7],
    ['R', 12],
  ],
  'left',
);
const dangerSignB = dangerHalf(
  'danger_sign_b',
  [
    ['I', 1],
    ['G', 3],
    ['O', 8],
  ],
  'right',
);

export const SIGN_TEXTURES: readonly LayerRecipe[] = [lightPanel, lamp, ledStrip, exitSign, dangerSignA, dangerSignB];
