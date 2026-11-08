import { COLORS, type Screen } from '@boboforces/ui';

/** Ações da tela de pausa. */
export const PAUSE_ACTION = { resume: 'resume', quit: 'quit' } as const;

/** Pausa (arte-ux.md §6): véu sobre a partida congelada, Continuar e Sair da partida (faixa de perigo). */
export const pauseScreen: Screen<null> = {
  id: 'pause',
  build() {
    return {
      kind: 'box',
      id: 'root',
      color: COLORS.veu,
      children: [
        {
          kind: 'column',
          id: 'main',
          anchor: 'center',
          align: 'stretch',
          width: 380,
          gap: 14,
          children: [
            {
              kind: 'text',
              id: 'title',
              text: { key: 'pause.title' },
              style: 'title',
              color: COLORS.texto,
              textAlign: 'center',
            },
            { kind: 'box', height: 18 },
            {
              kind: 'button',
              id: 'resume',
              text: { key: 'pause.resume' },
              action: PAUSE_ACTION.resume,
              variant: 'primary',
              autofocus: true,
            },
            {
              kind: 'button',
              id: 'quit',
              text: { key: 'pause.quitMatch' },
              action: PAUSE_ACTION.quit,
              variant: 'danger',
            },
          ],
        },
      ],
    };
  },
};
