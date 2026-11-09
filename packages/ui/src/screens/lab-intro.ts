import { COLORS } from '../tokens.ts';
import type { Screen, UiNode } from '../tree.ts';

/**
 * M2 (fase 5e): o card "Conheça o Laboratório" (gameplay.md §2.5), uma vez, depois da 1ª partida terminada: o Jorge
 * the Immortal com os 4 eixos e o Testar (o Bobo Training em até 2 s). "Agora não" fecha e não volta.
 */
export const LAB_INTRO_ACTION = { test: 'test', open: 'open', later: 'later' } as const;

export interface LabIntroState {
  readonly name: string;
  readonly lines: readonly string[];
}

export const labIntroScreen: Screen<LabIntroState> = {
  id: 'labIntro',
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
          gap: 10,
          children: [
            { kind: 'text', id: 'heading', text: { key: 'labIntro.title' }, style: 'heading', color: COLORS.texto },
            { kind: 'text', id: 'pitch', text: { key: 'labIntro.pitch' }, style: 'body', color: COLORS.textoBaixo },
            { kind: 'box', height: 6 },
            {
              kind: 'box',
              id: 'card',
              color: COLORS.chapa,
              chamfer: true,
              padding: 20,
              children: [
                {
                  kind: 'column',
                  gap: 6,
                  children: [
                    {
                      kind: 'text',
                      id: 'cardName',
                      text: { literal: state.name },
                      style: 'heading',
                      font: 'hud',
                      size: 40,
                      uppercase: false,
                      color: COLORS.texto,
                    },
                    ...state.lines.map(
                      (line, i) =>
                        ({
                          kind: 'text',
                          id: `line${i}`,
                          text: { literal: line },
                          style: 'body',
                          color: COLORS.texto,
                        }) as UiNode,
                    ),
                  ],
                },
              ],
            },
            { kind: 'box', height: 10 },
            {
              kind: 'row',
              id: 'actions',
              gap: 14,
              children: [
                {
                  kind: 'button',
                  id: 'test',
                  text: { key: 'lab.test' },
                  action: LAB_INTRO_ACTION.test,
                  variant: 'primary',
                  autofocus: true,
                },
                {
                  kind: 'button',
                  id: 'open',
                  text: { key: 'result.openLab' },
                  action: LAB_INTRO_ACTION.open,
                  variant: 'secondary',
                },
                {
                  kind: 'button',
                  id: 'later',
                  text: { key: 'labIntro.later' },
                  action: LAB_INTRO_ACTION.later,
                  variant: 'secondary',
                },
              ],
            },
          ],
        },
      ],
    };
  },
};
