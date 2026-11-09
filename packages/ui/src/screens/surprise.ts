import { COLORS } from '../tokens.ts';
import type { Screen, UiNode } from '../tree.ts';

/**
 * M2 (fase 4c): o card do Surpreenda-me (arte-ux.md §6.3: "botão → confirmar o sorteio", 2 interações até o tiro): o
 * sorteio em linhas (modo, mapa, nível, times, duração), Jogar (foco), Rolar de novo e Voltar.
 */
export const SURPRISE_ACTION = { play: 'play', reroll: 'reroll', back: 'back' } as const;

export interface SurpriseState {
  /** Linhas do sorteio, já em texto (o `game` monta pela tabela): a primeira é o modo, em destaque. */
  readonly lines: readonly string[];
}

export const surpriseScreen: Screen<SurpriseState> = {
  id: 'surprise',
  build(state) {
    const lines: UiNode[] = state.lines.map((line, i) => ({
      kind: 'text',
      id: `line${i}`,
      text: { literal: line },
      style: i === 0 ? 'heading' : 'body',
      color: i === 0 ? COLORS.texto : COLORS.textoBaixo,
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
            { kind: 'text', id: 'heading', text: { key: 'surprise.title' }, style: 'title', color: COLORS.texto },
            { kind: 'box', height: 16 },
            { kind: 'box', id: 'headingBar', width: 120, height: 8, color: COLORS.acao, chamfer: true },
            { kind: 'box', height: 32 },
            {
              kind: 'box',
              id: 'card',
              color: COLORS.chapa,
              chamfer: true,
              padding: 28,
              width: 640,
              children: [{ kind: 'column', id: 'lines', gap: 12, children: lines }],
            },
            { kind: 'box', height: 32 },
            {
              kind: 'row',
              id: 'buttons',
              gap: 14,
              children: [
                {
                  kind: 'button',
                  id: 'play',
                  text: { key: 'menu.play' },
                  action: SURPRISE_ACTION.play,
                  variant: 'primary',
                  autofocus: true,
                },
                {
                  kind: 'button',
                  id: 'reroll',
                  text: { key: 'surprise.reroll' },
                  action: SURPRISE_ACTION.reroll,
                  variant: 'secondary',
                },
                {
                  kind: 'button',
                  id: 'back',
                  text: { key: 'menu.back' },
                  action: SURPRISE_ACTION.back,
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
