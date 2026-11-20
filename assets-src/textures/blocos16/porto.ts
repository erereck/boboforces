/**
 * M10 (fase 0): as camadas do Porto de Contêineres (PLANO_M10 fase 1). No fim da tira: as de antes não mudam de lugar.
 *
 * - `container_<cor>`: chapa corrugada do contêiner (nervuras verticais a cada 8 px, emenda de 1 px embaixo:
 *   a grade de 0,5 m aparece de propósito, como nos outros modulares). Quatro cores apagadas da paleta:
 *   vermelho-óxido (o pé da rampa `tijolo`, bem mais escuro que o vermelho vivo do time), azul-aço (`aco`),
 *   verde-oliva (`metal`) e bege (`areia`); nada de laranja (é do time A).
 * - `container_<cor>_door`: a porta da ponta (corrugado fino, a fresta na esquerda e a barra de trava galvanizada com
 *   as presilhas). Uma barra por bloco: a porta de 2,5 m mostra 5.
 * - `asphalt` (contínuo, 3 variantes) e `asphalt_line` (a faixa pintada e desbotada em ocre-areia, bloco inteiro: uma
 *   fileira deles é a faixa, em X ou em Z, como a `test_floor_stripe`).
 * - `crane_lattice` (cutout): a treliça do guindaste em ocre escuro (banzos de 3 px em cima e à esquerda + a diagonal;
 *   em tira, vira o mastro e a lança). `crane_cable` (cutout): o cabo de aço no meio da camada (vai no painel fino: a
 *   borda do painel mostra o mesmo cabo de lado).
 */
import type { LayerRecipe, Paint } from '../../../tools/texgen/src/paint.ts';
import type { RampName } from '../../../tools/texgen/src/palette.ts';

/**
 * Cores dos contêineres: rampa e o tom base (o claro é +1, o escuro −1). O vermelho é o vermelho-óxido do pé da rampa
 * (`tijolo[0]`, luma média ~0,2), com a sombra fria em `terra[0]`: bem mais escuro que o vermelho vivo do time
 * Vermelho (luma 0,32), que some num vermelho médio em cinza.
 */
export const CONTAINER_COLORS = [
  { key: 'red', ramp: 'tijolo', base: 0 },
  { key: 'blue', ramp: 'aco', base: 2 },
  { key: 'green', ramp: 'metal', base: 3 },
  { key: 'tan', ramp: 'areia', base: 2 },
] as const satisfies readonly { key: string; ramp: RampName; base: number }[];

export type ContainerColor = (typeof CONTAINER_COLORS)[number]['key'];

interface Tones {
  readonly light: number;
  readonly base: number;
  readonly dark: number;
}

/** Tons da chapa; no pé da rampa (base 0) a sombra desce para o `terra[0]` (frio, quase preto, sem ser preto). */
function tones(p: Paint, ramp: RampName, base: number): Tones {
  const dark = base > 0 ? p.tone(ramp, base - 1) : p.tone('terra', 0);
  return { light: p.tone(ramp, base + 1), base: p.tone(ramp, base), dark };
}

/**
 * Emenda do módulo: −1 tom na linha de baixo, só nas faces que pegam luz (o fundo da nervura já é escuro). A grade de
 * 0,5 m do brinquedo aparece de leve, sem virar listra.
 */
function seam(p: Paint, t: Tones): void {
  for (let x = 0; x < 16; x++) {
    const c = p.get(x, 15);
    if (c === t.base || c === t.light) p.px(x, 15, t.dark);
  }
}

/** Chapa corrugada: nervura trapezoidal de 8 px (lado claro, face, lado escuro, fundo), amassado e um escorrido. */
function paintCorrugated(p: Paint, t: Tones): void {
  const pattern = [t.light, t.base, t.base, t.base, t.dark, t.dark, t.dark, t.base];
  for (let x = 0; x < 16; x++) p.vline(x, 0, 16, pattern[x % 8]!);
  // Amassado: 2 px escuros na face da nervura.
  const dent = p.rng.int(0, 2) * 8 + 1 + p.rng.int(0, 2);
  p.hline(dent, p.rng.int(3, 12), 2, t.dark);
  // Escorrido de ferrugem curto (terra), sempre na face clara.
  const rust = p.rng.int(0, 2) * 8 + 2;
  p.vline(rust, p.rng.int(2, 9), 3, p.tone('terra', 2));
  seam(p, t);
}

/** Porta do contêiner: corrugado fino de 4 px, fresta da folha, barra de trava galvanizada e duas presilhas. */
function paintContainerDoor(p: Paint, t: Tones): void {
  const pattern = [t.light, t.base, t.base, t.dark];
  for (let x = 0; x < 16; x++) p.vline(x, 0, 16, pattern[x % 4]!);
  const c = p.ramp('concreto');
  // Fresta entre as folhas (o tom mais escuro do metal da porta) e o friso claro do lado.
  p.vline(0, 0, 16, p.tone('concreto', 0));
  p.vline(1, 0, 16, t.light);
  // Barra de trava: luz à esquerda, sombra à direita (na chapa).
  p.vline(9, 0, 16, c[4]!);
  p.vline(10, 0, 16, c[3]!);
  p.vline(11, 0, 16, t.dark);
  for (const y of [3, 11]) {
    p.hline(8, y, 4, c[3]!);
    p.hline(8, y + 1, 4, c[2]!);
  }
  seam(p, t);
}

const CONTAINERS: readonly LayerRecipe[] = CONTAINER_COLORS.flatMap(({ key, ramp, base }) => [
  {
    name: `container_${key}`,
    kind: 'opaque',
    material: 'modular',
    draw: (p: Paint) => paintCorrugated(p, tones(p, ramp, base)),
  },
  {
    name: `container_${key}_door`,
    kind: 'opaque',
    material: 'modular',
    draw: (p: Paint) => paintContainerDoor(p, tones(p, ramp, base)),
  },
]);

/** Asfalto: base escura, manchas ±1 tom e brita clara em pares de 2 px. Variante b: trinca; c: mancha de óleo. */
export function paintAsphalt(p: Paint, variant: number): void {
  const c = p.ramp('concreto');
  p.fill(c[1]!);
  p.blotches(5, c[0]!);
  p.blotches(3, c[2]!, 2, 2);
  for (let i = 0; i < 4; i++) p.hline(p.rng.int(0, 16), p.rng.int(0, 16), 2, c[2]!);
  if (variant === 1) {
    // Trinca em escada ligada pelos lados (diagonal de 1 px vira xadrez).
    let x = p.rng.int(0, 16);
    let y = p.rng.int(0, 16);
    for (let i = 0; i < 6; i++) {
      p.px(x, y, c[0]!);
      if (p.rng.chance(0.5)) p.px(x, ++y, c[0]!);
      x += 1;
    }
  } else if (variant === 2) {
    const x = p.rng.int(0, 16);
    const y = p.rng.int(0, 16);
    p.rect(x, y, 4, 3, c[0]!);
    p.rect(x + 1, y + 3, 3, 1, c[0]!);
  }
}

const asphalt: LayerRecipe = {
  name: 'asphalt',
  kind: 'opaque',
  material: 'continuo',
  variants: 3,
  draw: paintAsphalt,
};

/**
 * Faixa pintada no asfalto (o bloco inteiro), desbotada em ocre-areia (não no amarelo vivo do time) e gasta: o asfalto
 * aparece em manchas.
 */
const asphaltLine: LayerRecipe = {
  name: 'asphalt_line',
  kind: 'opaque',
  material: 'sinal',
  draw(p) {
    const y = p.ramp('areia');
    const c = p.ramp('concreto');
    p.fill(y[2]!);
    p.blotches(3, y[1]!, 2, 2);
    p.blotches(2, c[1]!, 2, 2);
    p.hline(p.rng.int(0, 16), p.rng.int(0, 16), 2, c[2]!);
  },
};

/**
 * Treliça do guindaste (cutout): banzos de 3 px em cima e à esquerda (em tira, um a cada 0,5 m) e a diagonal, em ocre
 * escuro (`amarelo[0]`): o amarelo fica só no fio de luz de 1 px e a sombra puxa para o grafite (sol quente, sombra
 * fria), longe do amarelo vivo do time.
 */
const craneLattice: LayerRecipe = {
  name: 'crane_lattice',
  kind: 'cutout',
  material: 'modular',
  draw(p) {
    const y = [p.tone('concreto', 1), p.tone('amarelo', 0), p.tone('amarelo', 1)] as const;
    for (let x = 0; x < 16; x++) {
      p.px(x, 0, y[2]);
      p.px(x, 1, y[1]);
      if (x >= 2) p.px(x, 2, y[0]);
    }
    for (let k = 1; k < 16; k++) {
      p.px(0, k, y[2]);
      p.px(1, k, y[1]);
      if (k >= 3) p.px(2, k, y[0]);
    }
    // Diagonal de baixo/esquerda para cima/direita, 3 px: lado de cima claro, de baixo escuro.
    for (let x = 3; x < 16; x++) {
      for (const [d, c] of [
        [-1, y[2]],
        [0, y[1]],
        [1, y[0]],
      ] as const) {
        const yy = 16 - x + d;
        if (yy >= 3 && yy < 16) p.px(x, yy, c);
      }
    }
  },
};

/** Cabo de aço (cutout): 2 px no meio da camada, com a torção marcada a cada 3 linhas. */
const craneCable: LayerRecipe = {
  name: 'crane_cable',
  kind: 'cutout',
  material: 'modular',
  draw(p) {
    const a = p.ramp('aco');
    p.vline(7, 0, 16, a[2]!);
    p.vline(8, 0, 16, a[0]!);
    for (let y = 1; y < 16; y += 3) p.px(7, y, a[1]!);
  },
};

export const PORT_TEXTURES: readonly LayerRecipe[] = [...CONTAINERS, asphalt, asphaltLine, craneLattice, craneCable];
