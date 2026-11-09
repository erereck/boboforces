import type { StringKey } from '../strings.pt-BR.ts';
import { COLORS } from '../tokens.ts';
import type { ButtonVariant, UiNode } from '../tree.ts';

/**
 * M2 (fases 4e e 4f): o esqueleto das telas de abas com linhas (Partida personalizada, Ajustes): o título, uma linha
 * de resumo (ou o aviso, que toma o lugar dela), as abas em botões compactos (`tab:<i>`; também LB/RB e Q/E), as
 * linhas da aba numa coluna com rolagem e a fileira de botões no canto de baixo à direita. Cada linha é:
 * - `option`: linha de opção ("RÓTULO ◀ valor ▶"; ação `row:<id>`);
 * - `value`: o rótulo e um valor só para ler, sem setas (um botão remapeável; confirmar abre a captura);
 * - `action`: botão de largura inteira (ação `row:<id>`), com o rótulo literal ou pela tabela;
 * - `text`: uma linha de texto (`Sobre`, avisos), sem foco.
 */
export const TABBED_TAB_PREFIX = 'tab:';
export const TABBED_ROW_PREFIX = 'row:';

export type TabbedRow =
  | { readonly kind: 'option'; readonly id: string; readonly labelKey: StringKey; readonly value: string }
  | { readonly kind: 'value'; readonly id: string; readonly labelKey: StringKey; readonly value: string }
  | {
      readonly kind: 'action';
      readonly id: string;
      readonly label: { readonly key: StringKey } | { readonly literal: string };
      readonly variant?: ButtonVariant;
    }
  | { readonly kind: 'text'; readonly id: string; readonly text: string; readonly dim?: boolean };

export interface TabbedButton {
  readonly id: string;
  readonly labelKey: StringKey;
  readonly variant: ButtonVariant;
  readonly autofocus?: boolean;
}

export interface TabbedState {
  readonly titleKey: StringKey;
  readonly tabs: readonly StringKey[];
  readonly tab: number;
  readonly rows: readonly TabbedRow[];
  /** A linha embaixo do título; `''` = nenhuma. */
  readonly summary: string;
  /** Aviso de uma linha, em âmbar, no lugar do resumo; `''` = nenhum. */
  readonly note: string;
  readonly buttons: readonly TabbedButton[];
}

/** Medidas (px de referência): a coluna das linhas e a altura da janela dela. */
export const TABBED_LAYOUT = { rowsWidth: 800, rowsHeight: 348 } as const;

function rowNode(row: TabbedRow): UiNode {
  switch (row.kind) {
    case 'option':
    case 'value':
      return {
        kind: 'button',
        id: `${TABBED_ROW_PREFIX}${row.id}`,
        text: { key: row.labelKey },
        action: `${TABBED_ROW_PREFIX}${row.id}`,
        value: { literal: row.value },
        ...(row.kind === 'value' ? { valueOnly: true } : {}),
        variant: 'secondary',
        width: TABBED_LAYOUT.rowsWidth,
      };
    case 'action':
      return {
        kind: 'button',
        id: `${TABBED_ROW_PREFIX}${row.id}`,
        text: row.label,
        action: `${TABBED_ROW_PREFIX}${row.id}`,
        variant: row.variant ?? 'secondary',
        width: TABBED_LAYOUT.rowsWidth,
      };
    case 'text':
      return {
        kind: 'text',
        id: `text:${row.id}`,
        text: { literal: row.text },
        style: 'body',
        color: row.dim ? COLORS.textoBaixo : COLORS.texto,
      };
  }
}

export function buildTabbed(state: TabbedState): UiNode {
  const tabs: UiNode[] = state.tabs.map((key, i) => ({
    kind: 'button',
    id: `${TABBED_TAB_PREFIX}${i}`,
    text: { key },
    action: `${TABBED_TAB_PREFIX}${i}`,
    variant: 'tab',
    compact: true,
    selected: i === state.tab,
  }));
  const line = state.note !== '' ? state.note : state.summary;
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
          { kind: 'text', id: 'heading', text: { key: state.titleKey }, style: 'heading', color: COLORS.texto },
          { kind: 'box', height: 4 },
          // O resumo embaixo do título; o aviso toma o lugar dele enquanto vale.
          {
            kind: 'text',
            id: state.note !== '' ? 'note' : 'summary',
            text: { literal: line },
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
            width: TABBED_LAYOUT.rowsWidth,
            height: TABBED_LAYOUT.rowsHeight,
            children: state.rows.map(rowNode),
          },
        ],
      },
      {
        kind: 'row',
        id: 'buttons',
        anchor: 'bottomRight',
        gap: 14,
        children: state.buttons.map((b) => ({
          kind: 'button',
          id: b.id,
          text: { key: b.labelKey },
          action: b.id,
          variant: b.variant,
          ...(b.autofocus ? { autofocus: true } : {}),
        })),
      },
    ],
  };
}
