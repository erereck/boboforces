import type { StringKey } from '../strings.pt-BR.ts';
import type { Screen } from '../tree.ts';
import { buildTabbed, TABBED_LAYOUT, TABBED_ROW_PREFIX, TABBED_TAB_PREFIX } from './tabbed.ts';

/**
 * M2 (fase 4e): Partida personalizada (gameplay.md §10.1 e §10.3; arte-ux.md §6.3), no esqueleto de abas com linhas
 * (`tabbed.ts`): as abas (Partida, Jogadores, Armas, Bots, Modificadores, Tela), as regras da aba em linhas de opção,
 * o resumo (ou o aviso de preset salvo) embaixo do título e, no canto, Voltar, Salvar preset e COMEÇAR (fixo, com o
 * foco). Os textos de valor vêm do `game`.
 */
export const CUSTOM_ACTION = { start: 'start', save: 'save', back: 'back' } as const;
/** Ação de uma aba (`tab:<índice>`) e de uma linha (`row:<id>`). */
export const CUSTOM_TAB_PREFIX = TABBED_TAB_PREFIX;
export const CUSTOM_ROW_PREFIX = TABBED_ROW_PREFIX;

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
export const CUSTOM_LAYOUT = TABBED_LAYOUT;

export const customMatchScreen: Screen<CustomMatchState> = {
  id: 'customMatch',
  build(state) {
    return buildTabbed({
      titleKey: 'custom.title',
      tabs: state.tabs,
      tab: state.tab,
      rows: state.rows.map((r) => ({ kind: 'option', id: r.id, labelKey: r.labelKey, value: r.value })),
      summary: state.summary,
      note: state.note,
      buttons: [
        { id: CUSTOM_ACTION.back, labelKey: 'menu.back', variant: 'secondary' },
        { id: CUSTOM_ACTION.save, labelKey: 'custom.save', variant: 'secondary' },
        { id: CUSTOM_ACTION.start, labelKey: 'quick.start', variant: 'primary', autofocus: true },
      ],
    });
  },
};
