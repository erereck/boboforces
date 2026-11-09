import type { StringKey } from '../strings.pt-BR.ts';
import type { Screen } from '../tree.ts';
import { buildTabbed, TABBED_ROW_PREFIX, TABBED_TAB_PREFIX, type TabbedRow } from './tabbed.ts';

/**
 * M2 (fase 4f): Ajustes (gameplay.md §10.5; arte-ux.md §6.12 e §8), no esqueleto de abas com linhas (`tabbed.ts`):
 * Controles (por dispositivo), Vídeo, Acessibilidade, Dados (backup em arquivo) e Sobre (versão, créditos e Copiar
 * relatório). As linhas vêm montadas do `game`; o Voltar fica no canto.
 */
export const SETTINGS_ACTION = { back: 'back' } as const;
export const SETTINGS_TAB_PREFIX = TABBED_TAB_PREFIX;
export const SETTINGS_ROW_PREFIX = TABBED_ROW_PREFIX;

export interface SettingsScreenState {
  readonly tabs: readonly StringKey[];
  readonly tab: number;
  readonly rows: readonly TabbedRow[];
  /** Aviso de uma linha (backup exportado, relatório copiado); `''` = nenhum. */
  readonly note: string;
}

export const settingsScreen: Screen<SettingsScreenState> = {
  id: 'settings',
  build(state) {
    return buildTabbed({
      titleKey: 'menu.settings',
      tabs: state.tabs,
      tab: state.tab,
      rows: state.rows,
      summary: '',
      note: state.note,
      buttons: [{ id: SETTINGS_ACTION.back, labelKey: 'menu.back', variant: 'secondary' }],
    });
  },
};
