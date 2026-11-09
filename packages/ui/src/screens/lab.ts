import type { StringKey } from '../strings.pt-BR.ts';
import type { Screen, UiNode } from '../tree.ts';
import { buildTabbed, type TabbedRow } from './tabbed.ts';

/**
 * M2 (fase 5b): o Laboratório (gameplay.md §6), o editor de um bot por vez, no molde das telas de abas: as abas Nível,
 * Habilidade, Inteligência, Personalidade, Regras e Nome; embaixo do título, o resumo do bot (ou o aviso); no canto,
 * Voltar e Salvar. As linhas vêm montadas do `game`.
 */
export const LAB_ACTION = { back: 'back', save: 'save' } as const;

export interface LabScreenState {
  readonly tabs: readonly StringKey[];
  readonly tab: number;
  readonly rows: readonly TabbedRow[];
  readonly summary: string;
  readonly note: string;
}

export const labScreen: Screen<LabScreenState> = {
  id: 'lab',
  build(state): UiNode {
    return buildTabbed({
      titleKey: 'menu.lab',
      tabs: state.tabs,
      tab: state.tab,
      rows: state.rows,
      summary: state.summary,
      note: state.note,
      buttons: [
        { id: LAB_ACTION.back, labelKey: 'menu.back', variant: 'secondary' },
        { id: LAB_ACTION.save, labelKey: 'lab.save', variant: 'primary' },
      ],
    });
  },
};
