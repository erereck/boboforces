import type { StringKey } from '../strings.pt-BR.ts';
import { COLORS } from '../tokens.ts';
import type { Screen, UiNode } from '../tree.ts';

/**
 * M2 (fase 4d): Modos (arte-ux.md §6.3: "grade de cards, ícone + até 7 palavras → configurar → COMEÇAR"): um card por
 * modo que já existe (o Bobo Training entra na fase 5), com o nome e uma frase. Escolher abre a Partida Rápida com o
 * modo marcado.
 */
export const MODES_ACTION = { back: 'back' } as const;
/** Ação de um modo: `mode:<id>`. */
export const MODES_PREFIX = 'mode:';

export interface ModeCard {
  readonly id: string;
  readonly nameKey: StringKey;
  readonly descKey: StringKey;
}

export interface ModesState {
  readonly modes: readonly ModeCard[];
}

/** Largura de cada card (px de referência). */
export const MODES_CARD_WIDTH = 500;

export const modesScreen: Screen<ModesState> = {
  id: 'modes',
  build(state) {
    const cards: UiNode[] = state.modes.map((m, i) => ({
      kind: 'box',
      id: `card:${m.id}`,
      color: COLORS.chapa,
      chamfer: true,
      padding: 20,
      width: MODES_CARD_WIDTH,
      children: [
        {
          kind: 'column',
          gap: 14,
          children: [
            {
              kind: 'button',
              id: `${MODES_PREFIX}${m.id}`,
              text: { key: m.nameKey },
              action: `${MODES_PREFIX}${m.id}`,
              variant: i === 0 ? 'primary' : 'secondary',
              width: MODES_CARD_WIDTH - 40,
              ...(i === 0 ? { autofocus: true } : {}),
            },
            { kind: 'text', text: { key: m.descKey }, style: 'body', color: COLORS.textoBaixo },
          ],
        },
      ],
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
            { kind: 'text', id: 'heading', text: { key: 'modes.title' }, style: 'title', color: COLORS.texto },
            { kind: 'box', height: 16 },
            { kind: 'box', id: 'headingBar', width: 120, height: 8, color: COLORS.acao, chamfer: true },
            { kind: 'box', height: 36 },
            // M2 (fase 5d): em grade de 2 colunas (o Bobo Training é o 3º card).
            {
              kind: 'column',
              id: 'cards',
              gap: 24,
              children: Array.from({ length: Math.ceil(cards.length / 2) }, (_, r) => ({
                kind: 'row',
                id: `cards${r}`,
                gap: 24,
                children: cards.slice(r * 2, r * 2 + 2),
              })) as UiNode[],
            },
            { kind: 'box', height: 36 },
            {
              kind: 'button',
              id: 'back',
              text: { key: 'menu.back' },
              action: MODES_ACTION.back,
              variant: 'secondary',
            },
          ],
        },
      ],
    };
  },
};
