import type { StringKey } from '../strings.pt-BR.ts';
import { COLORS } from '../tokens.ts';
import type { Screen, UiNode } from '../tree.ts';

/**
 * M2 (fase 4d): Modos (arte-ux.md §6.3: "grade de cards, ícone + até 7 palavras → configurar → COMEÇAR"): um card por
 * modo que já existe (o Bobo Training entra na fase 5), com o nome e uma frase. Escolher abre a Partida Rápida com o
 * modo marcado. Refino R3b (#79): é o lugar de escolher o que jogar: os modos, o Surpreenda-me e a Partida
 * personalizada (6 cards em 3 linhas mais compactas).
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
  /** M5 (fase 6a): o título (padrão "Modos"; a sala do Online usa os mesmos cards para a "Partida da sala"). */
  readonly titleKey?: StringKey;
  /** M7 (fase 8): sempre 2 colunas de cards largos (a Partida da sala, com nomes longos como "Todos contra todos"). */
  readonly wide?: boolean;
  /** M7 (fase 9): um botão a mais na linha do título (o Aquário da página Mais modos). */
  readonly headingExtra?: UiNode;
}

/** Largura de cada card (px de referência). */
export const MODES_CARD_WIDTH = 500;
/** M6 (fase 6): com mais de 6 cards (a página Mais modos), 3 colunas de cards mais estreitos. */
export const MODES_CARD_WIDTH_DENSE = 370;

export const modesScreen: Screen<ModesState> = {
  id: 'modes',
  build(state) {
    const dense = state.modes.length > 6 && state.wide !== true;
    // M7 (fase 0): com mais de 9 cards (4 linhas), tudo mais junto para caber no celular (750 px de altura).
    const tight = state.modes.length > 9 || (state.wide === true && state.modes.length > 6);
    const perRow = dense ? 3 : 2;
    const cardWidth = dense ? MODES_CARD_WIDTH_DENSE : MODES_CARD_WIDTH;
    const cards: UiNode[] = state.modes.map((m, i) => ({
      kind: 'box',
      id: `card:${m.id}`,
      color: COLORS.chapa,
      chamfer: true,
      padding: tight ? 6 : 10,
      width: cardWidth,
      children: [
        {
          kind: 'column',
          gap: tight ? 4 : 8,
          children: [
            {
              kind: 'button',
              id: `${MODES_PREFIX}${m.id}`,
              text: { key: m.nameKey },
              action: `${MODES_PREFIX}${m.id}`,
              variant: i === 0 ? 'primary' : 'secondary',
              width: cardWidth - (tight ? 12 : 20),
              ...(i === 0 ? { autofocus: true } : {}),
            },
            { kind: 'text', text: { key: m.descKey }, style: 'body', color: COLORS.textoBaixo },
          ],
        },
      ],
    }));
    const back: UiNode = {
      kind: 'button',
      id: 'back',
      text: { key: 'menu.back' },
      action: MODES_ACTION.back,
      variant: 'secondary',
    };
    // M7 (fase 0): apertado, o Voltar entra na última linha quando ela tem lugar (uma linha a menos de altura).
    const rowCount = Math.ceil(cards.length / perRow);
    const backInRow = tight && cards.length % perRow !== 0;
    // M7 (fase 8): com a última linha cheia (12 cards), o Voltar sobe para a linha do título (a mesma altura).
    const backInHeading = tight && !backInRow;
    const rows: UiNode[] = Array.from({ length: rowCount }, (_, r) => ({
      kind: 'row',
      id: `cards${r}`,
      gap: dense ? 14 : 20,
      children: [...cards.slice(r * perRow, r * perRow + perRow), ...(backInRow && r === rowCount - 1 ? [back] : [])],
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
            {
              kind: 'row',
              id: 'headingRow',
              gap: 24,
              children: [
                {
                  kind: 'text',
                  id: 'heading',
                  text: { key: state.titleKey ?? 'modes.title' },
                  style: tight ? 'heading' : 'title',
                  color: COLORS.texto,
                },
                ...(backInHeading ? [back] : []),
                ...(state.headingExtra ? [state.headingExtra] : []),
              ],
            },
            { kind: 'box', height: tight ? 6 : 12 },
            { kind: 'box', id: 'headingBar', width: 120, height: tight ? 6 : 8, color: COLORS.acao, chamfer: true },
            { kind: 'box', height: tight ? 8 : 14 },
            // M2 (fase 5d): em grade de 2 colunas (o Bobo Training é o 3º card); M6: 3 com mais de 6 cards.
            {
              kind: 'column',
              id: 'cards',
              gap: tight ? 6 : 10,
              children: rows,
            },
            ...(backInRow || backInHeading ? [] : ([{ kind: 'box', height: tight ? 6 : 12 }, back] as UiNode[])),
          ],
        },
      ],
    };
  },
};
