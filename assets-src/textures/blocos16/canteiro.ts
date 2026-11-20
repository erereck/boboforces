/**
 * M10 (fase 0): as camadas do Canteiro de Obras (PLANO_M10 fase 2). No fim da tira: as de antes não mudam de lugar.
 *
 * - `scaffold_pipe`: tubo galvanizado do andaime, desenhado para o poste + travessa (`postRail`): o poste cai nas
 *   colunas 6–9 e as travessas nas linhas 2–4 e 9–11 (a UV é a posição de mundo). Empilhado, vira o quadro em escada
 *   do andaime tubular; as plataformas são a `grate-slab` ou a `plank-slab`.
 * - `steel_beam` / `steel_column` / `steel_plate`: a viga I em primer (os tons de baixo do `tijolo`): a viga deitada mostra
 *   as abas em cima e embaixo; a coluna, nas laterais; a chapa é o topo da aba.
 * - `rebar` (cutout, vai na cruz): os ferros de espera saindo do concreto, com o arame de amarrar.
 * - `gravel` (contínuo, 3 variantes): brita e terra.
 * - `barrier_stripe`: o zebrado laranja e branco das barreiras (genérico, sem marca), no poste + travessa ou no bloco.
 * - `cement_bags` / `cement_bags_top`: sacos de cimento sobre o palete (o palete fica nas 4 linhas de baixo: empilhado,
 *   mostra palete, sacos, palete, sacos), com a faixa cinza impressa (sem texto).
 */
import type { LayerRecipe, Paint } from '../../../tools/texgen/src/paint.ts';

/** Tubo galvanizado: travessas (linhas 2–4 e 9–11) e poste (colunas 6–9) com luz em cima/esquerda, e as braçadeiras. */
const scaffoldPipe: LayerRecipe = {
  name: 'scaffold_pipe',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    const a = p.ramp('aco');
    p.fill(a[2]!);
    // As travessas do `postRail` ocupam as subcélulas y 4..7 e 11..14: as linhas 9–11 e 2–4 da camada (v = 16 − y).
    for (const top of [2, 9]) {
      p.hline(0, top, 16, a[3]!);
      p.hline(0, top + 2, 16, a[1]!);
    }
    p.vline(6, 0, 16, a[3]!);
    p.vline(9, 0, 16, a[1]!);
    // Braçadeiras onde a travessa cruza o poste (um tom abaixo, com o parafuso claro).
    for (const top of [2, 9]) {
      p.rect(5, top, 6, 3, a[1]!);
      p.hline(5, top, 6, a[2]!);
      p.px(7, top + 1, a[3]!);
    }
    // Zinco manchado (manchas de 2 px, sem xadrez).
    p.blotches(2, a[3]!, 2, 2);
  },
};

/**
 * Tons do aço em primer: os de baixo do `tijolo` (vermelho-escuro, longe do vermelho vivo do time), o `tijolo[2]` só
 * no fio de luz de 1 px e a sombra funda em terra escura.
 */
function steelTones(p: Paint): { lit: number; base: number; recess: number; deep: number } {
  return {
    lit: p.tone('tijolo', 2),
    base: p.tone('tijolo', 1),
    recess: p.tone('tijolo', 0),
    deep: p.tone('terra', 1),
  };
}

/** Viga I deitada: aba de cima (fio de luz), sombra embaixo dela, alma recuada e aba de baixo. */
const steelBeam: LayerRecipe = {
  name: 'steel_beam',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    const t = steelTones(p);
    p.fill(t.recess);
    p.hline(0, 0, 16, t.lit);
    p.rect(0, 1, 16, 2, t.base);
    p.hline(0, 3, 16, t.deep);
    p.hline(0, 12, 16, t.lit);
    p.rect(0, 13, 16, 2, t.base);
    p.hline(0, 15, 16, t.recess);
    // Alma: manchas de oxidação e um furo de parafuso com a luz embaixo.
    for (let i = 0; i < 2; i++) p.rect(p.rng.int(0, 15), p.rng.int(5, 10), 2, 2, t.deep);
    const x = p.rng.int(2, 13);
    p.px(x, 7, t.deep);
    p.px(x, 8, t.base);
  },
};

/** Coluna I de pé: abas nas laterais (a da esquerda pega luz) e a alma recuada no meio. */
const steelColumn: LayerRecipe = {
  name: 'steel_column',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    const t = steelTones(p);
    p.fill(t.recess);
    p.vline(0, 0, 16, t.lit);
    p.rect(1, 0, 2, 16, t.base);
    p.vline(3, 0, 16, t.deep);
    p.vline(12, 0, 16, t.lit);
    p.rect(13, 0, 2, 16, t.base);
    p.vline(15, 0, 16, t.recess);
    for (let i = 0; i < 2; i++) p.rect(p.rng.int(5, 10), p.rng.int(0, 15), 2, 2, t.deep);
    const y = p.rng.int(2, 13);
    p.px(7, y, t.deep);
    p.px(8, y, t.base);
  },
};

/** Chapa da aba (topo da viga e da coluna): bevel e quatro parafusos. */
const steelPlate: LayerRecipe = {
  name: 'steel_plate',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    const t = steelTones(p);
    p.fill(t.base);
    p.blotches(2, t.recess, 2, 2);
    p.bevel(0, 0, 16, 16, t.lit, t.recess);
    for (const [x, y] of [
      [4, 4],
      [11, 4],
      [4, 11],
      [11, 11],
    ] as const) {
      p.px(x, y, t.lit);
      p.px(x + 1, y + 1, t.deep);
    }
  },
};

/** Ferros de espera (cutout, para a cruz): 3 barras nervuradas, uma com o gancho, e o arame de amarrar. */
const rebar: LayerRecipe = {
  name: 'rebar',
  kind: 'cutout',
  material: 'modular',
  draw(p) {
    const t = p.ramp('terra');
    for (const x of [2, 7, 12]) {
      p.vline(x, x === 7 ? 0 : 2, x === 7 ? 16 : 14, t[3]!);
      for (let y = x % 3; y < 16; y += 3) if (y >= 2 || x === 7) p.px(x + 1, y, t[2]!);
    }
    // Gancho dobrado na ponta da barra do meio.
    p.hline(8, 0, 2, t[3]!);
    p.px(9, 1, t[2]!);
    // Arame de amarrar.
    p.hline(2, 10, 11, p.tone('aco', 2));
  },
};

/** Brita: terra e concreto, pedrinhas de 2×2 com luz em cima e sombra embaixo. */
function paintGravel(p: Paint, variant: number): void {
  const c = p.ramp('concreto');
  const t = p.ramp('terra');
  p.fill(c[2]!);
  p.blotches(variant === 1 ? 6 : 3, t[2]!);
  p.blotches(3, c[1]!, 2, 2);
  const stones = variant === 2 ? 7 : 5;
  for (let i = 0; i < stones; i++) {
    const x = p.rng.int(0, 16);
    const y = p.rng.int(0, 16);
    p.px(x, y, c[4]!);
    p.px(x + 1, y, c[3]!);
    p.px(x, y + 1, c[3]!);
    p.px(x + 1, y + 1, c[3]!);
    p.hline(x, y + 2, 2, c[1]!);
  }
}

const gravel: LayerRecipe = {
  name: 'gravel',
  kind: 'opaque',
  material: 'continuo',
  variants: 3,
  draw: paintGravel,
};

/** Zebrado laranja e branco em diagonal (período de 8 px, como o do corrimão), sem marca nem texto. */
const barrierStripe: LayerRecipe = {
  name: 'barrier_stripe',
  kind: 'opaque',
  material: 'sinal',
  draw(p) {
    const o = p.ramp('laranja');
    const w = p.ramp('placa');
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const band = (x + y) % 8;
        p.px(x, y, band < 4 ? (band === 0 ? o[3]! : o[2]!) : band === 4 ? w[3]! : w[2]!);
      }
    }
    p.hline(0, 15, 16, o[1]!);
  },
};

/** Sacos de cimento em 3 fiadas desencontradas (8 × 4 px cada) sobre o palete (linhas 12–15). */
const cementBags: LayerRecipe = {
  name: 'cement_bags',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    const pl = p.ramp('placa');
    const band = p.tone('concreto', 3);
    for (let row = 0; row < 3; row++) {
      const y = row * 4;
      const offset = row % 2 === 0 ? 0 : 4;
      for (let col = 0; col < 2; col++) {
        const x = offset + col * 8;
        p.rect(x, y, 8, 4, pl[1]!);
        p.hline(x + 1, y, 6, pl[2]!);
        p.hline(x, y + 3, 8, pl[0]!);
        p.vline(x, y, 3, pl[0]!);
        p.hline(x + 3, y + 1, 3, band);
      }
    }
    const m = p.ramp('madeira');
    p.hline(0, 12, 16, m[3]!);
    p.rect(0, 13, 16, 2, m[2]!);
    // Vãos do palete (por onde entra o garfo) e a tábua de baixo.
    p.rect(4, 13, 3, 2, m[0]!);
    p.rect(11, 13, 3, 2, m[0]!);
    p.hline(0, 15, 16, m[1]!);
  },
};

/** Topo dos sacos: dois sacos deitados (16 × 8) com a costura escura e a faixa impressa. */
const cementBagsTop: LayerRecipe = {
  name: 'cement_bags_top',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    const pl = p.ramp('placa');
    const band = p.tone('concreto', 3);
    for (const y of [0, 8]) {
      p.rect(0, y, 16, 8, pl[1]!);
      p.hline(1, y + 1, 13, pl[2]!);
      p.hline(0, y + 7, 16, pl[0]!);
      p.vline(15, y, 8, pl[0]!);
      p.rect(6, y + 3, 4, 2, band);
    }
  },
};

export const CONSTRUCTION_TEXTURES: readonly LayerRecipe[] = [
  scaffoldPipe,
  steelBeam,
  steelColumn,
  steelPlate,
  rebar,
  gravel,
  barrierStripe,
  cementBags,
  cementBagsTop,
];
