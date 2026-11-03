import { COLORS } from '../tokens.ts';
import type { Screen } from '../tree.ts';

/** Ajustes do M0: só o lugar da tela e o caminho de volta (os ajustes de verdade chegam no M2). */
export const SETTINGS_ACTION = { back: 'back' } as const;

export const settingsScreen: Screen<null> = {
  id: 'settings',
  build() {
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
            { kind: 'text', id: 'heading', text: { key: 'menu.settings' }, style: 'title', color: COLORS.texto },
            { kind: 'box', height: 16 },
            { kind: 'box', id: 'headingBar', width: 120, height: 8, color: COLORS.acao, chamfer: true },
            { kind: 'box', height: 28 },
            { kind: 'text', id: 'empty', text: { key: 'settings.empty' }, style: 'body', color: COLORS.textoBaixo },
            { kind: 'box', height: 44 },
            {
              kind: 'button',
              id: 'back',
              text: { key: 'menu.back' },
              action: SETTINGS_ACTION.back,
              variant: 'secondary',
              autofocus: true,
              width: 380,
            },
          ],
        },
      ],
    };
  },
};
