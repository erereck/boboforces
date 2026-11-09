import type { StringKey } from '../strings.pt-BR.ts';
import { COLORS } from '../tokens.ts';
import type { Screen, UiNode } from '../tree.ts';

/**
 * M2 (fase 4e): Partida personalizada (gameplay.md §10.1 e §10.3; arte-ux.md §6.3): as abas (Partida, Jogadores, Armas,
 * Bots, Modificadores, Tela) em botões compactos, trocadas também com LB/RB e Q/E; as regras da aba em linhas de opção
 * numa coluna com rolagem; embaixo do título, o resumo (ou o aviso de preset salvo); no canto, Voltar, Salvar preset e
 * COMEÇAR (fixo, com o foco). Os textos de valor vêm do `game`.
 */
export const CUSTOM_ACTION = { start: 'start', save: 'save', back: 'back' } as const;
/** Ação de uma aba (`tab:<índice>`) e de uma linha (`row:<id>`). */
export const CUSTOM_TAB_PREFIX = 'tab:';
export const CUSTOM_ROW_PREFIX = 'row:';

export interface CustomRowView {
  readonly id: string;
  readonly labelKey: StringKey;
  readonly value: string;
}

export interface CustomMatchState {
  readonly tabs: readonly StringKey[];
  readonly tab: number;
  readonly rows: readonly CustomRowView[];
  /** O preset em uma linha ("Times · De boa · 4 contra 4 · Construto"). */
  readonly summary: string;
  /** Aviso de uma linha ("Salvo como Times De boa 4×4"); `''` = nenhum. */
  readonly note: string;
}

/** Medidas (px de referência): a coluna das linhas e a altura da janela dela. */
export const CUSTOM_LAYOUT = { rowsWidth: 800, rowsHeight: 348 } as const;

export const customMatchScreen: Screen<CustomMatchState> = {
  id: 'customMatch',
  build(state) {
    const tabs: UiNode[] = state.tabs.map((key, i) => ({
      kind: 'button',
      id: `${CUSTOM_TAB_PREFIX}${i}`,
      text: { key },
      action: `${CUSTOM_TAB_PREFIX}${i}`,
      variant: 'tab',
      compact: true,
      selected: i === state.tab,
    }));
    const rows: UiNode[] = state.rows.map((row) => ({
      kind: 'button',
      id: `${CUSTOM_ROW_PREFIX}${row.id}`,
      text: { key: row.labelKey },
      action: `${CUSTOM_ROW_PREFIX}${row.id}`,
      value: { literal: row.value },
      variant: 'secondary',
      width: CUSTOM_LAYOUT.rowsWidth,
    }));
    return {
      kind: 'box',
      id: 'root',
      color: COLORS.bunker,
      children: [
        {
          kind: 'column',
          id: 'main',
          anchor: 'topLeft',
          children: [
            { kind: 'text', id: 'heading', text: { key: 'custom.title' }, style: 'heading', color: COLORS.texto },
            { kind: 'box', height: 4 },
            // O resumo embaixo do título; o aviso ("Salvo como…") toma o lugar dele enquanto vale.
            {
              kind: 'text',
              id: state.note !== '' ? 'note' : 'summary',
              text: { literal: state.note !== '' ? state.note : state.summary },
              style: 'caption',
              color: state.note !== '' ? COLORS.acao : COLORS.textoBaixo,
            },
            { kind: 'box', height: 10 },
            { kind: 'row', id: 'tabs', gap: 8, children: tabs },
            { kind: 'box', height: 16 },
            {
              kind: 'column',
              id: 'rows',
              scroll: true,
              gap: 12,
              width: CUSTOM_LAYOUT.rowsWidth,
              height: CUSTOM_LAYOUT.rowsHeight,
              children: rows,
            },
          ],
        },
        {
          kind: 'row',
          id: 'buttons',
          anchor: 'bottomRight',
          gap: 14,
          children: [
            {
              kind: 'button',
              id: 'back',
              text: { key: 'menu.back' },
              action: CUSTOM_ACTION.back,
              variant: 'secondary',
            },
            {
              kind: 'button',
              id: 'save',
              text: { key: 'custom.save' },
              action: CUSTOM_ACTION.save,
              variant: 'secondary',
            },
            {
              kind: 'button',
              id: 'start',
              text: { key: 'quick.start' },
              action: CUSTOM_ACTION.start,
              variant: 'primary',
              autofocus: true,
            },
          ],
        },
      ],
    };
  },
};
