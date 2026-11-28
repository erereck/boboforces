import type { StringKey } from '../strings.pt-BR.ts';
import { BUTTON, COLORS } from '../tokens.ts';
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
  /**
   * M11 (fase 5): um 2º botão no card, compacto (o "Grande" no card do Bobo Royale, só no PC): a ação é
   * `mode:<extra.id>`. No card largo ele divide a linha do nome (o card fica da mesma altura); no estreito, a da
   * descrição.
   */
  readonly extra?: { readonly id: string; readonly textKey: StringKey };
}

/**
 * M11 (fase 5): a parte da linha que vai para o 2º botão do card (`ModeCard.extra`), compacto. No card largo, na linha
 * do nome: 0,32 deixa o "Bobo Royale" inteiro no principal e o "Grande" no piso de 13 px do 640×360. No estreito, na
 * linha da descrição: 0,42 cabe o "Grande" no 640×360 e a descrição do Bobo Royale no resto.
 */
const EXTRA_SHARE_NAME_LINE = 0.32;
const EXTRA_SHARE_DESC_LINE = 0.42;
const EXTRA_BUTTON_GAP = 6;

export interface ModesState {
  readonly modes: readonly ModeCard[];
  /** M5 (fase 6a): o título (padrão "Modos"; a sala do Online usa os mesmos cards para a "Partida da sala"). */
  readonly titleKey?: StringKey;
  /** M7 (fase 8): sempre 2 colunas de cards largos (a Partida da sala, com nomes longos como "Todos contra todos"). */
  readonly wide?: boolean;
  /** M7 (fase 9): um botão a mais na linha do título (o Aquário da página Mais modos). */
  readonly headingExtra?: UiNode;
  /** M12 (fase 3): o aviso em âmbar na linha do título ("Abrindo…" enquanto o pedaço dos editores chega). */
  readonly note?: string;
  /** M12 (fase 3): a linha de ajuda embaixo da grade (na Mais modos, o resumo do card com o foco). */
  readonly help?: string;
  /**
   * M12 (fase 3): os cards sem a descrição (a Mais modos no toque, onde os alvos de 44 px não deixam lugar para ela no
   * piso de 13 px): a linha de ajuda diz o que o card com o foco faz. O card com o 2º botão fica com ela.
   */
  readonly bare?: boolean;
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
    const cards: UiNode[] = state.modes.map((m, i) => {
      const lineWidth = cardWidth - (tight ? 12 : 20);
      // M11 (consertos dos prints): o 2º botão é compacto (texto menor). Antes, com 40% da linha do nome e o texto
      // grande, o nome centrado do principal passava por baixo dele ("BOBO ROYALEGRANDE" a 1280×720). No card largo ele
      // fica na linha do nome, da altura do principal; no estreito (a página Mais modos), o nome e o "Grande" não cabem
      // juntos no piso de 13 px do 640×360, e ele desce para a linha da descrição, à direita.
      const onNameLine = m.extra !== undefined && !dense;
      const extraWidth =
        m.extra === undefined
          ? 0
          : Math.round(lineWidth * (onNameLine ? EXTRA_SHARE_NAME_LINE : EXTRA_SHARE_DESC_LINE));
      const main: UiNode = {
        kind: 'button',
        id: `${MODES_PREFIX}${m.id}`,
        text: { key: m.nameKey },
        action: `${MODES_PREFIX}${m.id}`,
        variant: i === 0 ? 'primary' : 'secondary',
        width: onNameLine ? lineWidth - extraWidth - EXTRA_BUTTON_GAP : lineWidth,
        ...(i === 0 ? { autofocus: true } : {}),
      };
      const desc: UiNode = { kind: 'text', text: { key: m.descKey }, style: 'body', color: COLORS.textoBaixo };
      const extra: UiNode | null =
        m.extra === undefined
          ? null
          : {
              kind: 'button',
              id: `${MODES_PREFIX}${m.extra.id}`,
              text: { key: m.extra.textKey },
              action: `${MODES_PREFIX}${m.extra.id}`,
              variant: 'secondary',
              compact: true,
              width: extraWidth,
              ...(onNameLine ? { height: BUTTON.height } : {}),
            };
      const lines: UiNode[] =
        extra === null
          ? state.bare === true
            ? [main]
            : [main, desc]
          : onNameLine
            ? [{ kind: 'row', gap: EXTRA_BUTTON_GAP, children: [main, extra] }, desc]
            : [
                main,
                {
                  kind: 'row',
                  gap: EXTRA_BUTTON_GAP,
                  align: 'center',
                  children: [{ ...desc, width: lineWidth - extraWidth - EXTRA_BUTTON_GAP }, extra],
                },
              ];
      return {
        kind: 'box',
        id: `card:${m.id}`,
        color: COLORS.chapa,
        chamfer: true,
        padding: tight ? 6 : 10,
        width: cardWidth,
        // M12 (fase 3): o contorno do foco fica 7 px para fora do botão (`BUTTON.focusGap` + `focusStroke`) e o texto
        // começa ~2 px abaixo da caixa dele: o vão até a descrição deixa 4 a 6 px de folga (antes, 8 e 4 px: o contorno
        // encostava ou passava por cima do texto).
        children: [{ kind: 'column', gap: tight ? 12 : 11, children: lines }],
      };
    });
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
                ...(state.note
                  ? [
                      {
                        kind: 'text',
                        id: 'note',
                        text: { literal: state.note },
                        style: 'body',
                        color: COLORS.acao,
                      } as const,
                    ]
                  : []),
              ],
            },
            // M12 (fase 3, revisão): apertado, 2 px a menos em cada vão (a linha de ajuda cabe no toque a 640×360).
            { kind: 'box', height: tight ? 4 : 12 },
            { kind: 'box', id: 'headingBar', width: 120, height: tight ? 6 : 8, color: COLORS.acao, chamfer: true },
            { kind: 'box', height: tight ? 6 : 12 },
            // M2 (fase 5d): em grade de 2 colunas (o Bobo Training é o 3º card); M6: 3 com mais de 6 cards.
            {
              kind: 'column',
              id: 'cards',
              gap: tight ? 4 : 10,
              children: rows,
            },
            ...(state.help !== undefined
              ? ([
                  { kind: 'box', height: tight ? 2 : 8 },
                  { kind: 'text', id: 'help', text: { literal: state.help }, style: 'caption', color: COLORS.texto },
                ] as UiNode[])
              : []),
            ...(backInRow || backInHeading ? [] : ([{ kind: 'box', height: tight ? 6 : 12 }, back] as UiNode[])),
          ],
        },
      ],
    };
  },
};
