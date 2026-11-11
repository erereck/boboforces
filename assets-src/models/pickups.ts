/**
 * Pickups (M2, fase 2b): a caixinha de munição que cai de quem morre no Bobo Warfare (gameplay.md §4.1). Mesmas regras
 * das armas (`weapons.ts`): caixas a 32 px/m, tamanhos inteiros em texels, uma camada 64×64. O render desenha no
 * conjunto instanciado do modelo (programa 4, sem programa novo). Origem no centro do fundo (os pés da caixinha na sim).
 */
import { ModelBuilder, shaded, type BuiltModel, type Painter } from '../../tools/modelgen/src/builder.ts';
import { tone } from '../../tools/skingen/src/palette.ts';

const OLIVE = tone('metal', 3);
const OLIVE_DARK = tone('metal', 2);
const STEEL = tone('aco', 1);
const YELLOW = tone('amarelo', 2);

/** Lata de munição oliva (44 × 28 × 25 cm), com faixa amarela, cartucho desenhado dos dois lados e alça de aço. */
export function ammoBox(): BuiltModel {
  const m = new ModelBuilder('ammo-box', 'pickup', { flags: 0, debrisColor: OLIVE, blocksNav: false });
  const L = m.layer('mdl_ammo_box', 'opaque', OLIVE);
  const body = m.part('body');

  body.box([-7, 0, -4], [14, 7, 8], L, (face, p) => {
    shaded(OLIVE)(face, p);
    if (face === 'top' || face === 'bottom') return;
    for (let x = 0; x < p.w; x++) p.px(x, p.h - 3, YELLOW);
    if (face === 'front' || face === 'back') {
      // Cartucho: ponta de cobre e estojo amarelo, de pé à esquerda do fecho.
      const cx = 3;
      p.rect(cx, p.h - 6, 2, 1, tone('tijolo', 2));
      p.rect(cx, p.h - 5, 2, 3, YELLOW);
    }
  });
  body.box([-7.5, 7, -4.5], [15, 1, 9], L, shaded(OLIVE_DARK));
  body.box([-3, 8, -0.5], [1, 1, 1], L, shaded(STEEL));
  body.box([2, 8, -0.5], [1, 1, 1], L, shaded(STEEL));
  body.box([-3, 9, -0.5], [6, 1, 1], L, shaded(STEEL));
  body.box([-1, 3, -5], [2, 2, 1], L, shaded(STEEL));
  return m.build();
}

/**
 * M3 (fase 3d): a tábua da barricada (1,06 × 0,19 × 0,06 m), origem no centro, comprida em X. O render desenha 6 por
 * janela, uma em cima da outra, com uma inclinação alternada (cartoon), e tira a de cima quando o zumbi arranca.
 */
export function zombiePlank(): BuiltModel {
  const m = new ModelBuilder('zombie-plank', 'pickup', { flags: 0, debrisColor: tone('madeira', 3), blocksNav: false });
  const L = m.layer('mdl_zombie_plank', 'opaque', tone('madeira', 3));
  const face = m.tile(L, 34, 6, (p) => {
    p.fill(tone('madeira', 3));
    for (let x = 0; x < p.w; x++) {
      p.px(x, 0, tone('madeira', 4));
      p.px(x, p.h - 1, tone('madeira', 2));
    }
    // Veio da madeira em traços soltos e um prego em cada ponta.
    for (const [x, y, w] of [
      [3, 2, 7],
      [14, 3, 9],
      [24, 2, 6],
      [8, 4, 5],
    ] as const) {
      for (let k = 0; k < w; k++) p.px(x + k, y, tone('madeira', 2));
    }
    p.px(1, 2, tone('aco', 1));
    p.px(p.w - 2, 3, tone('aco', 1));
  });
  const edge = m.tile(L, 34, 2, (p) => {
    p.fill(tone('madeira', 2));
  });
  const end = m.tile(L, 2, 6, (p) => {
    p.fill(tone('madeira', 1));
  });
  m.part('body').tiledBox([-17, -3, -1], [17, 3, 1], {
    front: face,
    back: face,
    top: edge,
    bottom: edge,
    left: end,
    right: end,
  });
  return m.build();
}

/**
 * M3 (fase 3d): a porta paga (1,0 × 2,0 × 0,19 m), origem no centro do pé, larga em X: tábuas verticais com duas faixas
 * de aço e um cadeado (fechada até alguém pagar). Porta mais larga = mais de uma lado a lado.
 */
export function zombieDoor(): BuiltModel {
  const m = new ModelBuilder('zombie-door', 'pickup', { flags: 0, debrisColor: tone('madeira', 2), blocksNav: false });
  const L = m.layer('mdl_zombie_door', 'opaque', tone('madeira', 2));
  const panel = m.tile(L, 32, 32, (p) => {
    p.fill(tone('madeira', 2));
    for (let x = 0; x < p.w; x += 8) for (let y = 0; y < p.h; y++) p.px(x, y, tone('madeira', 1));
    p.blotches(4, tone('madeira', 3), 1, 2);
    // Faixa de aço com rebites no meio do ladrilho (repete a cada 1 m: duas faixas na porta).
    for (let x = 0; x < p.w; x++) {
      p.px(x, 14, tone('aco', 2));
      p.px(x, 15, tone('aco', 1));
      p.px(x, 16, tone('aco', 1));
      p.px(x, 17, tone('aco', 0));
    }
    for (const x of [2, 10, 18, 26]) p.px(x, 15, tone('aco', 3));
  });
  const edge = m.tile(L, 6, 32, (p) => {
    p.fill(tone('madeira', 1));
  });
  const top = m.tile(L, 32, 6, (p) => {
    p.fill(tone('madeira', 1));
  });
  const lock = m.tile(L, 4, 4, (p) => {
    p.fill(tone('amarelo', 2));
    p.px(1, 1, tone('aco', 0));
    p.px(1, 2, tone('aco', 0));
  });
  const body = m.part('body');
  body.tiledBox([-16, 0, -3], [16, 64, 3], { front: panel, back: panel, left: edge, right: edge, top, bottom: top });
  // Cadeado dos dois lados, na altura da mão.
  body.tiledBox([-2, 30, -4], [2, 34, 4], lock);
  return m.build();
}

/**
 * M3 (fase 4b): a Caixa Misteriosa (1,0 × 0,56 × 0,56 m), origem no centro do pé, comprida em X: baú de madeira escura
 * com cantos de aço e um "?" amarelo em cada face (a arma sorteada aparece flutuando em cima, desenhada à parte).
 */
export function mysteryBox(): BuiltModel {
  const m = new ModelBuilder('mystery-box', 'pickup', { flags: 0, debrisColor: tone('madeira', 1), blocksNav: false });
  const L = m.layer('mdl_mystery_box', 'opaque', tone('madeira', 1));
  const question = (p: Painter, x0: number, y0: number): void => {
    const Y = tone('amarelo', 2);
    // "?" de 5 × 8 texels.
    for (const [x, y] of [
      [1, 0],
      [2, 0],
      [3, 0],
      [0, 1],
      [4, 1],
      [4, 2],
      [3, 3],
      [2, 4],
      [2, 5],
      [2, 7],
    ] as const) {
      p.px(x0 + x, y0 + y, Y);
    }
  };
  const side = m.tile(L, 32, 18, (p) => {
    p.fill(tone('madeira', 1));
    for (let x = 0; x < p.w; x += 8) for (let y = 0; y < p.h; y++) p.px(x, y, tone('madeira', 0));
    for (let x = 0; x < p.w; x++) {
      p.px(x, 0, tone('aco', 1));
      p.px(x, p.h - 1, tone('aco', 1));
    }
    question(p, 6, 5);
    question(p, 21, 5);
  });
  const end = m.tile(L, 18, 18, (p) => {
    p.fill(tone('madeira', 1));
    for (let y = 0; y < p.h; y++) {
      p.px(0, y, tone('aco', 1));
      p.px(p.w - 1, y, tone('aco', 1));
    }
    question(p, 7, 5);
  });
  const lid = m.tile(L, 32, 18, (p) => {
    p.fill(tone('madeira', 2));
    for (let x = 0; x < p.w; x++) p.px(x, 9, tone('aco', 1));
    question(p, 14, 1);
  });
  m.part('body').tiledBox([-16, 0, -9], [16, 18, 9], {
    front: side,
    back: side,
    left: end,
    right: end,
    top: lid,
    bottom: lid,
  });
  return m.build();
}

/** Ordem do pacote = ordem do registro de conteúdo (só acrescentar no fim; regra 20). */
export const PICKUP_RECIPES: readonly (() => BuiltModel)[] = [ammoBox, zombiePlank, zombieDoor, mysteryBox];
