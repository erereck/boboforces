/**
 * Pickups (M2, fase 2b): a caixinha de munição que cai de quem morre no Bobo Warfare (gameplay.md §4.1). Mesmas regras
 * das armas (`weapons.ts`): caixas a 32 px/m, tamanhos inteiros em texels, uma camada 64×64. O render desenha no
 * conjunto instanciado do modelo (programa 4, sem programa novo). Origem no centro do fundo (os pés da caixinha na sim).
 */
import { ModelBuilder, shaded, type BuiltModel } from '../../tools/modelgen/src/builder.ts';
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

/** Ordem do pacote = ordem do registro de conteúdo (só acrescentar no fim; regra 20). */
export const PICKUP_RECIPES: readonly (() => BuiltModel)[] = [ammoBox];
