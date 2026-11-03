import { COLORS } from '../tokens.ts';
import type { Screen, UiNode } from '../tree.ts';

/**
 * Tela de título do M0 (arte-ux.md §6.3, versão mínima): logotipo, JOGAR, Ajustes e o rodapé com crédito e versão.
 * Composição à esquerda, como um painel de comando: a direita fica livre para o fundo vitrine do M1 (arte-ux.md §5.6).
 */

export interface TitleState {
  /** `version.json` → `version` (o `game` lê pelo `format`). */
  readonly version: string;
  readonly codename: string;
  /** A plataforma sabe sair (Switch): mostra "Sair". Na web não existe sair (regra 16). */
  readonly canExit?: boolean;
}

/** Ações devolvidas por `navigateMenu` nesta tela. */
export const TITLE_ACTION = { play: 'play', settings: 'settings', quit: 'quit' } as const;

const spacer = (height: number): UiNode => ({ kind: 'box', height });

export const titleScreen: Screen<TitleState> = {
  id: 'title',
  build(state) {
    return {
      kind: 'box',
      id: 'root',
      color: COLORS.bunker,
      children: [
        {
          kind: 'column',
          id: 'main',
          anchor: 'left',
          y: -12,
          children: [
            { kind: 'text', id: 'logo', text: { key: 'title.logo' }, style: 'logo', color: COLORS.texto },
            spacer(18),
            { kind: 'box', id: 'logoBar', width: 176, height: 10, color: COLORS.acao, chamfer: true },
            spacer(56),
            {
              kind: 'column',
              id: 'buttons',
              gap: 14,
              align: 'stretch',
              width: 380,
              children: [
                {
                  kind: 'button',
                  id: 'play',
                  text: { key: 'menu.play' },
                  action: TITLE_ACTION.play,
                  variant: 'primary',
                  autofocus: true,
                },
                {
                  kind: 'button',
                  id: 'settings',
                  text: { key: 'menu.settings' },
                  action: TITLE_ACTION.settings,
                  variant: 'secondary',
                },
                ...(state.canExit === true
                  ? [
                      {
                        kind: 'button',
                        id: 'quit',
                        text: { key: 'menu.quit' },
                        action: TITLE_ACTION.quit,
                        variant: 'secondary',
                      } as const,
                    ]
                  : []),
              ],
            },
          ],
        },
        {
          kind: 'text',
          id: 'credit',
          anchor: 'bottomLeft',
          text: { key: 'title.credit' },
          style: 'caption',
          color: COLORS.textoBaixo,
        },
        {
          kind: 'text',
          id: 'version',
          anchor: 'bottomRight',
          text: { key: 'title.version', params: { version: state.version, codename: state.codename } },
          style: 'caption',
          color: COLORS.textoBaixo,
        },
      ],
    };
  },
};
