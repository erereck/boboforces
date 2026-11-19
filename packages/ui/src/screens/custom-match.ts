import type { StringKey } from '../strings.pt-BR.ts';
import type { Screen } from '../tree.ts';
import { buildTabbed, TABBED_LAYOUT } from './tabbed.ts';
// M6 (fase 2): as ações moram em `editor-actions.ts` (o menu da web não leva a tela por causa delas).
import { CUSTOM_ACTION, CUSTOM_ROW_PREFIX, CUSTOM_SHARE_ROW, CUSTOM_TAB_PREFIX } from './editor-actions.ts';
export { CUSTOM_ACTION, CUSTOM_ROW_PREFIX, CUSTOM_SHARE_ROW, CUSTOM_TAB_PREFIX };

/**
 * M2 (fase 4e): Partida personalizada (gameplay.md §10.1 e §10.3; arte-ux.md §6.3), no esqueleto de abas com linhas
 * (`tabbed.ts`): as abas (Partida, Jogadores, Armas, Bots, Modificadores, Tela), as regras da aba em linhas de opção,
 * o resumo (ou o aviso de preset salvo) embaixo do título e, no canto, Voltar, Salvar preset e COMEÇAR (fixo, com o
 * foco). Os textos de valor vêm do `game`.
 */

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
  /** Refino R4c (#79): o que a linha (ou a aba) com o foco faz, embaixo das linhas; ausente = sem a linha. */
  readonly help?: string;
  /** M5 (fase 4c): aberta pela sala do Online: o Começar vira "Usar na sala" (a partida volta para a sala). */
  readonly forRoom?: boolean;
  /** M8 (fase 1): a linha Compartilhar no fim da aba (código e link do preset; só na web). */
  readonly share?: boolean;
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
      rows: [
        ...state.rows.map((r) => ({ kind: 'option' as const, id: r.id, labelKey: r.labelKey, value: r.value })),
        ...(state.share === true
          ? [{ kind: 'action' as const, id: CUSTOM_SHARE_ROW, label: { key: 'custom.share' as const } }]
          : []),
      ],
      summary: state.summary,
      note: state.note,
      ...(state.help !== undefined ? { help: state.help } : {}),
      buttons: [
        { id: CUSTOM_ACTION.back, labelKey: 'menu.back', variant: 'secondary' },
        { id: CUSTOM_ACTION.save, labelKey: 'custom.save', variant: 'secondary' },
        // M7 (fase 9): o Aquário (a mesma partida só com bots, para assistir); da sala do Online, não.
        ...(state.forRoom === true
          ? []
          : [{ id: CUSTOM_ACTION.watch, labelKey: 'custom.watch' as const, variant: 'secondary' as const }]),
        {
          id: CUSTOM_ACTION.start,
          labelKey: state.forRoom === true ? 'custom.useInRoom' : 'quick.start',
          variant: 'primary',
          autofocus: true,
        },
      ],
    });
  },
};
