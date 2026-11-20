/**
 * M10 (fase 0): as camadas da Fazenda à noite (PLANO_M10 fase 5). No fim da tira: as de antes não mudam de lugar. As
 * janelas com barricada e as portas pagas do Zombies são entidades de sempre; a cerca fechada é a `fence-wood`, a de
 * travessas usa a `wood`; a terra e a grama são as de sempre.
 *
 * - `barn_wood`: tábuas verticais do celeiro em vermelho-escuro (os tons de baixo do `tijolo`), com as frestas, os
 *   pregos e a tinta gasta.
 * - `barn_door_a` (diagonal "\") e `barn_door_b` ("/"): o celeiro com a mão-francesa branca; em xadrez A/B, cada 2×2
 *   blocos formam o X da porta de celeiro (as faces cruzam como as do PERIGO para o X ler certo dos dois lados).
 * - `wood_trim`: tábua pintada de branco (batentes de janela, cantos e a moldura da porta).
 * - `siding`: o lambri creme da casa (tábuas sobrepostas de 4 px).
 * - `hay_bale` / `hay_bale_top`: o fardo de feno (palha em traços e os dois barbantes).
 * - `farmland`: a terra arada (sulcos de 4 px ao longo de X) com brotinhos.
 * - `crops` (cutout, 2 variantes, vai na cruz): o milharal (talos contínuos de cima a baixo e nas mesmas colunas nas
 *   duas variantes, para empilhar; a b com a espiga).
 */
import type { LayerRecipe, Paint } from '../../../tools/texgen/src/paint.ts';

/**
 * Tábuas verticais de 4 px nos tons de baixo do `tijolo` (vermelho-escuro de celeiro, longe do vermelho vivo do
 * time): o `tijolo[2]` só no fio de luz da borda esquerda, fresta na direita, veio, desgaste, pregos e a madeira
 * aparecendo.
 */
function paintBarnWood(p: Paint): void {
  const t = p.ramp('tijolo');
  for (let k = 0; k < 4; k++) {
    const x = k * 4;
    p.rect(x, 0, 4, 16, t[1]!);
    p.vline(x, 0, 16, t[2]!);
    p.vline(x + 3, 0, 16, t[0]!);
    p.vline(x + 1 + p.rng.int(0, 2), p.rng.int(0, 10), p.rng.int(3, 6), t[0]!);
    // Desgaste: um trecho da tábua um tom abaixo (as tábuas não ficam todas iguais).
    if (p.rng.chance(0.5)) p.rect(x + 1, p.rng.int(0, 12), 2, 3, t[0]!);
    p.px(x + 1, 2, p.tone('aco', 1));
    p.px(x + 1, 13, p.tone('aco', 1));
  }
  // Tinta gasta: a madeira crua aparece numa mancha.
  const x = p.rng.int(0, 4) * 4 + 1;
  p.rect(x, p.rng.int(4, 11), 2, 2, p.tone('madeira', 2));
}

const barnWood: LayerRecipe = {
  name: 'barn_wood',
  kind: 'opaque',
  material: 'modular',
  draw: paintBarnWood,
};

/** A mão-francesa branca de 3 px sobre o celeiro: `down` = "\" (de cima/esquerda para baixo/direita), senão "/". */
function barnDoor(name: string, down: boolean): LayerRecipe {
  return {
    name,
    kind: 'opaque',
    material: 'modular',
    draw(p) {
      paintBarnWood(p);
      const w = p.ramp('placa');
      for (let i = 0; i < 16; i++) {
        for (const [d, c] of [
          [-1, w[3]!],
          [0, w[2]!],
          [1, w[1]!],
        ] as const) {
          // d < 0 fica do lado de cima da diagonal (luz), d > 0 do de baixo (sombra).
          const y = (down ? i : 15 - i) + d;
          if (y >= 0 && y < 16) p.px(i, y, c);
        }
      }
    },
  };
}

/** Tábua branca: duas tábuas verticais de 8 px com bevel, veio e um descascado. */
const woodTrim: LayerRecipe = {
  name: 'wood_trim',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    const w = p.ramp('placa');
    for (const x of [0, 8]) {
      p.rect(x, 0, 8, 16, w[2]!);
      p.vline(x, 0, 16, w[3]!);
      p.vline(x + 7, 0, 16, w[1]!);
      p.vline(x + 2 + p.rng.int(0, 4), p.rng.int(0, 10), 3, w[1]!);
    }
    p.rect(p.rng.int(1, 6), p.rng.int(2, 13), 2, 2, p.tone('madeira', 3));
  },
};

/** Lambri creme: tábuas de 4 px sobrepostas (a sombra da sobreposição em cima, a borda clara embaixo). */
const siding: LayerRecipe = {
  name: 'siding',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    const a = p.ramp('areia');
    for (let b = 0; b < 4; b++) {
      const y = b * 4;
      p.hline(0, y, 16, a[0]!);
      p.rect(0, y + 1, 16, 2, a[2]!);
      p.hline(0, y + 3, 16, a[3]!);
      p.hline(p.rng.int(0, 16), y + 1 + p.rng.int(0, 2), p.rng.int(2, 4), a[1]!);
    }
  },
};

/** Palha: base, traços horizontais claros e escuros, fios amarelos e os dois barbantes (colunas 4 e 11). */
function paintStraw(p: Paint, vertical: boolean): void {
  const a = p.ramp('areia');
  p.fill(a[2]!);
  const stroke = (rgb: number): void => {
    const x = p.rng.int(0, 16);
    const y = p.rng.int(0, 16);
    const len = p.rng.int(2, 5);
    if (vertical && p.rng.chance(0.5)) p.vline(x, y, len, rgb);
    else p.hline(x, y, len, rgb);
  };
  for (let i = 0; i < 12; i++) stroke(a[3]!);
  for (let i = 0; i < 7; i++) stroke(a[1]!);
  for (let i = 0; i < 3; i++) stroke(p.tone('amarelo', 2));
  p.vline(4, 0, 16, p.tone('terra', 3));
  p.vline(11, 0, 16, p.tone('terra', 3));
}

const hayBale: LayerRecipe = {
  name: 'hay_bale',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    paintStraw(p, false);
    const a = p.ramp('areia');
    p.hline(0, 0, 16, a[3]!);
    p.hline(0, 15, 16, a[1]!);
  },
};

const hayBaleTop: LayerRecipe = {
  name: 'hay_bale_top',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    paintStraw(p, true);
  },
};

/** Terra arada: sulcos de 4 px ao longo de X (crista clara, fundo escuro), torrões e brotinhos nas cristas. */
const farmland: LayerRecipe = {
  name: 'farmland',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    const t = p.ramp('terra');
    const rows = [t[3]!, t[2]!, t[2]!, t[1]!];
    for (let y = 0; y < 16; y++) p.hline(0, y, 16, rows[y % 4]!);
    for (let i = 0; i < 4; i++) p.hline(p.rng.int(0, 16), p.rng.int(0, 4) * 4 + 2, 2, t[1]!);
    const g = p.ramp('grama');
    for (let i = 0; i < 3; i++) {
      const x = p.rng.int(0, 16);
      const y = p.rng.int(0, 4) * 4 + 1;
      p.px(x, y, g[3]!);
      p.px(x + 1, y, g[4]!);
    }
  },
};

/**
 * Milho (cutout): talos de 2 px de cima a baixo com folhas para os lados; a variante b leva a espiga. Os talos ficam
 * nas MESMAS colunas nas duas variantes: empilhado, o talo não quebra a cada 0,5 m (só as folhas e a espiga mudam).
 */
const CROP_STALKS = [3, 11] as const;

const crops: LayerRecipe = {
  name: 'crops',
  kind: 'cutout',
  material: 'vegetacao',
  variants: 2,
  draw(p, variant) {
    const g = p.ramp('grama');
    for (const x of CROP_STALKS) {
      p.vline(x, 0, 16, g[2]!);
      p.vline(x + 1, 0, 16, g[1]!);
      // Folha para a direita e para a esquerda, em alturas sorteadas (arco de 4 px).
      const yr = p.rng.int(3, 8);
      p.px(x + 2, yr, g[3]!);
      p.px(x + 3, yr - 1, g[3]!);
      p.px(x + 4, yr - 1, g[4]!);
      p.px(x + 5, yr, g[3]!);
      const yl = p.rng.int(9, 14);
      p.px(x - 1, yl, g[3]!);
      p.px(x - 2, yl - 1, g[3]!);
      p.px(x - 3, yl - 1, g[4]!);
      p.px(x - 4, yl, g[3]!);
    }
    if (variant === 1) {
      const a = p.ramp('amarelo');
      p.rect(9, 5, 2, 4, a[2]!);
      p.px(9, 9, a[1]!);
      p.px(10, 9, a[1]!);
      p.px(9, 4, g[3]!);
    }
  },
};

export const FARM_TEXTURES: readonly LayerRecipe[] = [
  barnWood,
  barnDoor('barn_door_a', true),
  barnDoor('barn_door_b', false),
  woodTrim,
  siding,
  hayBale,
  hayBaleTop,
  farmland,
  crops,
];
