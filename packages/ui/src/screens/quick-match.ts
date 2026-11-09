import type { StringKey } from '../strings.pt-BR.ts';
import { COLORS } from '../tokens.ts';
import type { Screen, UiNode } from '../tree.ts';

/**
 * M2 (fase 4d): Partida Rápida (arte-ux.md §6.3 e §6.4): as 5 opções (modo, mapa, nível, bots, duração) em linhas de
 * opção, COMEÇAR com o foco (1 confirmar a partir daqui) e, à direita, os atalhos numa coluna com rolagem: os últimos,
 * os favoritos e os presets prontos. Todo texto de valor vem montado do `game`.
 */
export const QUICK_ROWS = ['mode', 'map', 'level', 'size', 'minutes'] as const;
export type QuickRow = (typeof QUICK_ROWS)[number];

export const QUICK_ACTION = { start: 'start', custom: 'custom', back: 'back' } as const;
/** Ação de um atalho: `preset:<grupo>:<índice>`. */
export const QUICK_SHORTCUT_PREFIX = 'preset:';

const ROW_LABEL: Readonly<Record<QuickRow, StringKey>> = {
  mode: 'quick.mode',
  map: 'quick.map',
  level: 'quick.level',
  size: 'quick.size',
  minutes: 'quick.minutes',
};

export interface QuickShortcut {
  /** Rótulo curto do botão (nome do preset, ou "4×4 De boa") e a linha de baixo ("Times · Construto · 5 min"). */
  readonly label: string;
  readonly caption: string;
}

export interface QuickShortcutGroup {
  readonly id: string;
  readonly titleKey: StringKey;
  readonly items: readonly QuickShortcut[];
}

export interface QuickMatchState {
  /** O valor de cada linha, em texto, na ordem de `QUICK_ROWS`. */
  readonly values: readonly string[];
  readonly groups: readonly QuickShortcutGroup[];
}

/** Medidas (px de referência): a coluna das opções e a dos atalhos. */
export const QUICK_LAYOUT = {
  optionsWidth: 660,
  optionsHeight: 348,
  shortcutsWidth: 420,
  shortcutsHeight: 470,
} as const;

function shortcuts(groups: readonly QuickShortcutGroup[]): UiNode[] {
  const nodes: UiNode[] = [];
  for (const g of groups) {
    if (g.items.length === 0) continue;
    nodes.push({
      kind: 'text',
      id: `group:${g.id}`,
      text: { key: g.titleKey },
      style: 'label',
      color: COLORS.textoBaixo,
    });
    g.items.forEach((item, i) => {
      const id = `${QUICK_SHORTCUT_PREFIX}${g.id}:${i}`;
      nodes.push({
        kind: 'button',
        id,
        text: { literal: item.label },
        action: id,
        variant: 'secondary',
        width: QUICK_LAYOUT.shortcutsWidth,
      });
      nodes.push({
        kind: 'text',
        id: `${id}:caption`,
        text: { literal: item.caption },
        style: 'caption',
        color: COLORS.textoBaixo,
      });
    });
  }
  return nodes;
}

export const quickMatchScreen: Screen<QuickMatchState> = {
  id: 'quickMatch',
  build(state) {
    const rows: UiNode[] = QUICK_ROWS.map((row, i) => ({
      kind: 'button',
      id: row,
      text: { key: ROW_LABEL[row] },
      action: row,
      value: { literal: state.values[i] ?? '' },
      variant: 'secondary',
      width: QUICK_LAYOUT.optionsWidth,
    }));
    const list = shortcuts(state.groups);
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
            { kind: 'text', id: 'heading', text: { key: 'quick.title' }, style: 'heading', color: COLORS.texto },
            { kind: 'box', height: 12 },
            { kind: 'box', id: 'headingBar', width: 120, height: 8, color: COLORS.acao, chamfer: true },
            { kind: 'box', height: 16 },
            // Em coluna com rolagem: nas telas pequenas (alvos de toque altos) ela rola em vez de invadir o canto.
            {
              kind: 'column',
              id: 'options',
              scroll: true,
              gap: 12,
              width: QUICK_LAYOUT.optionsWidth,
              height: QUICK_LAYOUT.optionsHeight,
              children: rows,
            },
          ],
        },
        // COMEÇAR fixo no canto (arte-ux.md §6.3), com o Voltar ao lado.
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
              action: QUICK_ACTION.back,
              variant: 'secondary',
            },
            {
              kind: 'button',
              id: 'custom',
              text: { key: 'menu.custom' },
              action: QUICK_ACTION.custom,
              variant: 'secondary',
            },
            {
              kind: 'button',
              id: 'start',
              text: { key: 'quick.start' },
              action: QUICK_ACTION.start,
              variant: 'primary',
              autofocus: true,
            },
          ],
        },
        ...(list.length > 0
          ? [
              {
                kind: 'column',
                id: 'shortcutsPanel',
                anchor: 'topRight',
                gap: 10,
                width: QUICK_LAYOUT.shortcutsWidth,
                children: [
                  {
                    kind: 'text',
                    id: 'shortcutsTitle',
                    text: { key: 'quick.shortcuts' },
                    style: 'heading',
                    color: COLORS.texto,
                  },
                  {
                    kind: 'column',
                    id: 'shortcuts',
                    scroll: true,
                    gap: 8,
                    height: QUICK_LAYOUT.shortcutsHeight,
                    width: QUICK_LAYOUT.shortcutsWidth,
                    children: list,
                  },
                ],
              } as const,
            ]
          : []),
      ],
    };
  },
};
