/**
 * Armas da cena-vitrine (M1): pistola, fuzil e sniper (arte-ux.md §3; GDD §5.5). Fonte da verdade em texto: o
 * `tools/modelgen` roda estas receitas, valida (`validateModel`) e grava `generated/modelos.bfmodel` + a tira
 * `modelos64-modelos`. Regenerar: `npm run modelgen`.
 *
 * Regras: caixas texturizadas a 32 px/m (1 texel = 3,125 cm), 6 a 20 caixas, ≤ 600 triângulos, uma camada 64×64 por
 * arma, peças separadas para animar (`body`, `bolt` = ferrolho/manivela, `mag` = pente, `scope` = luneta), soquetes
 * `hand_r`, `hand_l`, `muzzle`, `mag` e `sight`. Nomes e formas genéricos, sem marca nem cópia de arma real (#10).
 * Cada classe tem silhueta própria e uma faixa de destaque: pistola laranja, fuzil amarela, sniper laranja na coronha
 * com madeira clara. Contorno interno de 1 px só onde uma peça termina (janela de ejeção, serrilha, vão do gatilho).
 *
 * Eixos: Y para cima, cano para −Z; origem no topo da empunhadura (onde a mão direita fecha). Medidas em texels.
 */
import type { TexelVec3 } from '@boboforces/format';
import {
  ModelBuilder,
  shaded,
  type BoxPaint,
  type BuiltModel,
  type FaceName,
  type Painter,
} from '../../tools/modelgen/src/builder.ts';
import { tone } from '../../tools/skingen/src/palette.ts';

const GUNMETAL = tone('aco', 1);
const GUNMETAL_DARK = tone('aco', 0);
const POLYMER = tone('concreto', 1);
const POLYMER_DARK = tone('concreto', 0);
const OLIVE = tone('metal', 3);
const TAN = tone('areia', 1);

const FORWARD: TexelVec3 = [0, 0, -1];
const DOWN: TexelVec3 = [0, -1, 0];

/** Faces laterais (onde vão serrilhas, janelas e faixas). */
const SIDE = (f: FaceName): boolean => f === 'right' || f === 'left';

/** Linhas horizontais escuras alternadas (textura de empunhadura), sem xadrez. */
function grooves(dark: number): BoxPaint {
  return (face, p) => {
    if (!SIDE(face) && face !== 'back' && face !== 'front') return;
    for (let y = 1; y < p.h; y += 2) for (let x = 0; x < p.w; x++) p.px(x, y, dark);
  };
}

function stripeRow(row: number, color: number): BoxPaint {
  return (face, p) => {
    if (face === 'top' || face === 'bottom') return;
    for (let x = 0; x < p.w; x++) p.px(x, Math.min(p.h - 1, row), color);
  };
}

function combine(...paints: BoxPaint[]): BoxPaint {
  return (face, p) => paints.forEach((paint) => paint(face, p));
}

/** Lente vista de frente/de trás: aro escuro, vidro claro e um brilho. */
function lens(p: Painter): void {
  p.fill(GUNMETAL_DARK);
  p.rect(1, 1, p.w - 2, p.h - 2, tone('aco', 2));
  p.px(1, 1, tone('placa', 2));
}

// ---------------------------------------------------------------------------------------------------------------

export function pistol(): BuiltModel {
  const m = new ModelBuilder('pistol', 'weapon', { flags: 0, debrisColor: GUNMETAL, blocksNav: false });
  const L = m.layer('mdl_pistol', 'opaque', GUNMETAL_DARK);
  const body = m.part('body');
  const slide = m.part('bolt', body.index);
  const mag = m.part('mag', body.index, [0, -5, 0.5]);

  // Ferrolho: serrilha atrás, janela de ejeção à direita e topo claro.
  slide.box([-1, 2, -9], [2, 3, 10], L, (face, p) => {
    shaded(GUNMETAL)(face, p);
    if (face === 'right') {
      for (const x of [0, 2]) for (let y = 0; y < p.h; y++) p.px(x, y, GUNMETAL_DARK);
      p.rect(4, 0, 3, 1, GUNMETAL_DARK);
    } else if (face === 'left') {
      for (const x of [p.w - 1, p.w - 3]) for (let y = 0; y < p.h; y++) p.px(x, y, GUNMETAL_DARK);
    } else if (face === 'front') {
      p.px(0, p.h - 1, GUNMETAL_DARK);
      p.px(1, p.h - 1, GUNMETAL_DARK);
    }
  });
  slide.box(
    [-0.5, 5, -8],
    [1, 1, 1],
    L,
    shaded(GUNMETAL_DARK, (_f, p) => p.px(0, 0, tone('laranja', 3))),
  );
  slide.box([-1, 5, 0], [2, 1, 1], L, shaded(GUNMETAL_DARK));

  // Armação de polímero com a faixa laranja de destaque, empunhadura com sulcos, guarda e gatilho.
  body.box([-1, 0, -8], [2, 2, 8], L, combine(shaded(POLYMER), stripeRow(1, tone('laranja', 2))));
  body.box([-1, -5, -1], [2, 5, 3], L, combine(shaded(POLYMER), grooves(POLYMER_DARK)));
  body.box([-1, -2, -5], [2, 1, 4], L, shaded(POLYMER_DARK));
  body.box([-1, -1, -5], [2, 1, 1], L, shaded(POLYMER_DARK));
  body.box([-0.5, -1, -3], [1, 1, 1], L, shaded(GUNMETAL));
  body.box(
    [-0.5, 3, -10],
    [1, 1, 1],
    L,
    shaded(GUNMETAL_DARK, (face, p) => face === 'front' && p.px(0, 0, POLYMER_DARK)),
  );

  // Pente: corpo escondido na empunhadura e a base laranja aparecendo embaixo.
  mag.box([-0.5, 0, -1.5], [1, 5, 2], L, shaded(GUNMETAL));
  mag.box([-1, -1, -1.5], [2, 1, 3], L, shaded(tone('laranja', 2)));

  m.socket('hand_r', body.index, [0, -2.5, 0.5], FORWARD);
  m.socket('hand_l', body.index, [-1, -3.5, 0.5], FORWARD);
  m.socket('muzzle', body.index, [0, 3.5, -10], FORWARD);
  m.socket('mag', body.index, [0, -5, 0.5], DOWN);
  m.socket('sight', slide.index, [0, 6, 0.5], FORWARD);
  return m.build();
}

// ---------------------------------------------------------------------------------------------------------------

export function rifle(): BuiltModel {
  const m = new ModelBuilder('rifle', 'weapon', { flags: 0, debrisColor: OLIVE, blocksNav: false });
  const L = m.layer('mdl_rifle', 'opaque', POLYMER_DARK);
  const body = m.part('body');
  const bolt = m.part('bolt', body.index);
  const mag = m.part('mag', body.index, [0, 0, -3.5]);
  const yellow = tone('amarelo', 1);

  // Caixas grandes primeiro (empacota melhor a camada).
  body.box([-1.5, 0, -6], [3, 4, 11], L, (face, p) => {
    shaded(POLYMER)(face, p);
    if (face === 'right') p.rect(4, 1, 3, 1, POLYMER_DARK); // janela de ejeção
    if (SIDE(face)) for (let x = 0; x < p.w; x++) p.px(x, p.h - 1, POLYMER_DARK);
  });
  body.box([-1.5, -1, 5], [3, 5, 9], L, (face, p) => {
    shaded(OLIVE)(face, p);
    if (face === 'back') p.fill(tone('metal', 1));
    if (SIDE(face)) p.rect(face === 'right' ? 4 : 3, 2, 2, 1, tone('metal', 1)); // passador da bandoleira
  });
  // Guarda-mão oliva com respiros e a faixa amarela na ponta.
  body.box([-1.5, 0.5, -15], [3, 3, 9], L, (face, p) => {
    shaded(OLIVE)(face, p);
    if (SIDE(face)) {
      for (let x = 1; x < p.w - 1; x += 2) p.px(x, 1, tone('metal', 1));
      const tip = face === 'right' ? p.w - 1 : 0;
      for (let y = 0; y < p.h; y++) p.px(tip, y, yellow);
    }
    if (face === 'top' || face === 'bottom') for (let x = 0; x < p.w; x++) p.px(x, p.h - 1, yellow);
    if (face === 'front') p.fill(yellow);
  });
  body.box([-1, 4, -6], [2, 1, 10], L, (face, p) => {
    shaded(GUNMETAL_DARK)(face, p);
    if (face === 'top') for (let y = 0; y < p.h; y += 2) for (let x = 0; x < p.w; x++) p.px(x, y, GUNMETAL);
  });
  body.box([-1, 1, -21], [2, 2, 6], L, shaded(GUNMETAL_DARK));
  body.box([-1.5, 0.5, -24], [3, 3, 3], L, (face, p) => {
    shaded(GUNMETAL_DARK)(face, p);
    if (SIDE(face)) p.px(1, 1, POLYMER_DARK);
    if (face === 'front') p.px(1, 1, tone('neutro', 0));
  });
  body.box([-1, -5, 2], [2, 5, 3], L, combine(shaded(POLYMER), grooves(POLYMER_DARK)));
  body.box([-1, -2, -1], [2, 1, 3], L, shaded(POLYMER_DARK));
  body.box([-0.5, -1, 0], [1, 1, 1], L, shaded(GUNMETAL));
  body.box([-0.5, 3.5, -16], [1, 2, 1], L, shaded(GUNMETAL_DARK));
  body.box(
    [-1, 5, 1],
    [2, 1, 2],
    L,
    shaded(GUNMETAL_DARK, (face, p) => face === 'back' && p.px(0, 0, GUNMETAL)),
  );

  bolt.box([1.5, 2.5, -1], [1, 1, 3], L, shaded(GUNMETAL));

  // Pente curvo: duas caixas, a de baixo deslocada para a frente, com a faixa amarela na base.
  mag.box([-1, -4, -1.5], [2, 4, 3], L, combine(shaded(GUNMETAL), stripeRow(0, tone('aco', 2))));
  mag.box([-1, -7, -2.5], [2, 3, 3], L, combine(shaded(GUNMETAL), stripeRow(2, yellow)));

  m.socket('hand_r', body.index, [0, -2.5, 3.5], FORWARD);
  m.socket('hand_l', body.index, [0, 0.5, -11], FORWARD);
  m.socket('muzzle', body.index, [0, 2, -24], FORWARD);
  m.socket('mag', body.index, [0, 0, -3.5], DOWN);
  m.socket('sight', body.index, [0, 6, 2], FORWARD);
  return m.build();
}

// ---------------------------------------------------------------------------------------------------------------

export function sniper(): BuiltModel {
  const m = new ModelBuilder('sniper', 'weapon', { flags: 0, debrisColor: TAN, blocksNav: false });
  const L = m.layer('mdl_sniper', 'opaque', GUNMETAL_DARK);
  const body = m.part('body');
  const bolt = m.part('bolt', body.index);
  const mag = m.part('mag', body.index, [0, 0, -3]);
  const scope = m.part('scope', body.index, [0, 3, -1]);
  const tanDark = tone('areia', 0);
  const orange = tone('laranja', 2);

  body.box([-1, 1, -31], [2, 2, 14], L, shaded(GUNMETAL_DARK));
  body.box([-1.5, -2, 4], [3, 5, 12], L, (face, p) => {
    shaded(TAN)(face, p);
    if (SIDE(face)) {
      // Faixa laranja perto da soleira e o vão da empunhadura em tom escuro.
      const x = face === 'right' ? 1 : p.w - 2;
      for (let y = 0; y < p.h; y++) p.px(x, y, orange);
      for (let y = 0; y < p.h; y++) p.px(face === 'right' ? 0 : p.w - 1, y, tanDark);
    }
  });
  body.box([-1.5, -1, -17], [3, 3, 11], L, (face, p) => {
    shaded(TAN)(face, p);
    if (SIDE(face)) for (let x = 2; x < p.w - 2; x += 3) p.px(x, 1, tanDark);
  });
  body.box([-1.5, 0, -6], [3, 3, 10], L, (face, p) => {
    shaded(GUNMETAL)(face, p);
    if (face === 'right') p.rect(3, 0, 3, 1, GUNMETAL_DARK);
  });
  body.box([-1.5, 0.5, -34], [3, 3, 3], L, (face, p) => {
    shaded(GUNMETAL_DARK)(face, p);
    if (SIDE(face)) for (let x = 0; x < p.w; x += 2) p.px(x, 1, POLYMER_DARK);
  });
  body.box([-1.5, 3, 8], [3, 1, 6], L, shaded(TAN));
  body.box([-1, -5, 3], [2, 3, 3], L, combine(shaded(tanDark), grooves(tone('terra', 1))));
  body.box([-1, -3, 0], [2, 1, 3], L, shaded(GUNMETAL_DARK));
  body.box([-0.5, -2, 1], [1, 1, 1], L, shaded(GUNMETAL));
  body.box([-1.5, -2, 16], [3, 5, 1], L, shaded(POLYMER_DARK));

  bolt.box([1.5, 1, 1], [2, 1, 1], L, shaded(GUNMETAL));
  bolt.box([3.5, 0, 1], [1, 2, 1], L, shaded(GUNMETAL_DARK));

  mag.box([-1, -3, -1.5], [2, 3, 3], L, combine(shaded(GUNMETAL), stripeRow(2, orange)));

  // Luneta: tubo, campânulas com lente, anéis e torre.
  scope.box([-1.5, 1, -6], [3, 3, 12], L, (face, p) => {
    shaded(GUNMETAL_DARK)(face, p);
    if (SIDE(face)) for (let y = 0; y < p.h; y++) p.px(Math.floor(p.w / 2), y, GUNMETAL);
  });
  scope.box([-2, 0.5, -9], [4, 4, 3], L, (face, p) => (face === 'front' ? lens(p) : shaded(GUNMETAL_DARK)(face, p)));
  scope.box([-2, 0.5, 6], [4, 4, 2], L, (face, p) => (face === 'back' ? lens(p) : shaded(GUNMETAL_DARK)(face, p)));
  const ring = scope.box([-1, 0, -4], [2, 1, 1], L, shaded(GUNMETAL));
  scope.boxLike([-1, 0, 2], ring);
  scope.box(
    [-0.5, 4, -1],
    [1, 1, 2],
    L,
    shaded(GUNMETAL, (face, p) => face === 'top' && p.px(0, 0, orange)),
  );

  m.socket('hand_r', body.index, [0, -3.5, 4.5], FORWARD);
  m.socket('hand_l', body.index, [0, -1, -12], FORWARD);
  m.socket('muzzle', body.index, [0, 2, -34], FORWARD);
  m.socket('mag', body.index, [0, 0, -3], DOWN);
  m.socket('sight', scope.index, [0, 2.5, 8], FORWARD);
  return m.build();
}

/** Ordem do pacote = ordem do registro de conteúdo. */
export const WEAPON_RECIPES: readonly (() => BuiltModel)[] = [pistol, rifle, sniper];
