import { COLORS } from '../tokens.ts';
import type { Screen, UiNode } from '../tree.ts';

/**
 * M2 (fase 4c): menu principal (arte-ux.md §6.3), aberto pelo "Mudar" do título. Cada item só aparece quando o marco
 * dele chega (nada de "em breve"): a Partida Rápida e os Modos entram na fase 4d, a Novidades na 4g, o Laboratório e o
 * Meu Bobo nas fases 5 e 6.
 */
export const MAIN_MENU_ACTION = {
  quickMatch: 'quickMatch',
  modes: 'modes',
  lab: 'lab',
  settings: 'settings',
  news: 'news',
  back: 'back',
} as const;

/** Altura da coluna dos itens (px de referência): cabem os 6 do M2 (com o Meu Bobo) e o Voltar. */
export const MAIN_MENU_ITEMS_HEIGHT = 520;

export interface MainMenuState {
  /** Itens que já existem, na ordem do menu (o `game` liga cada um quando a fase dele chega). */
  readonly items: readonly MainMenuItem[];
}

export type MainMenuItem = 'quickMatch' | 'modes' | 'lab' | 'settings' | 'news';

const LABEL = {
  quickMatch: 'menu.quickMatch',
  modes: 'menu.modes',
  lab: 'menu.lab',
  settings: 'menu.settings',
  news: 'menu.news',
} as const;

export const mainMenuScreen: Screen<MainMenuState> = {
  id: 'mainMenu',
  build(state) {
    const items: UiNode[] = state.items.map((item, i) => ({
      kind: 'button',
      id: item,
      text: { key: LABEL[item] },
      action: MAIN_MENU_ACTION[item],
      variant: i === 0 ? 'primary' : 'secondary',
      ...(i === 0 ? { autofocus: true } : {}),
    }));
    return {
      kind: 'box',
      id: 'root',
      color: COLORS.bunker,
      children: [
        {
          kind: 'column',
          id: 'main',
          anchor: 'left',
          children: [
            { kind: 'text', id: 'heading', text: { key: 'menu.main' }, style: 'title', color: COLORS.texto },
            { kind: 'box', height: 16 },
            { kind: 'box', id: 'headingBar', width: 120, height: 8, color: COLORS.acao, chamfer: true },
            { kind: 'box', height: 28 },
            {
              kind: 'column',
              id: 'items',
              // M2 (fase 5a): com 5 ou mais itens, a coluna rola nas telas pequenas (alvos de toque altos).
              scroll: true,
              height: MAIN_MENU_ITEMS_HEIGHT,
              gap: 14,
              align: 'stretch',
              width: 380,
              children: [
                ...items,
                { kind: 'box', height: 16 },
                {
                  kind: 'button',
                  id: 'back',
                  text: { key: 'menu.back' },
                  action: MAIN_MENU_ACTION.back,
                  variant: 'secondary',
                  ...(items.length === 0 ? { autofocus: true } : {}),
                },
              ],
            },
          ],
        },
      ],
    };
  },
};
