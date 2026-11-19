import { TABBED_ROW_PREFIX, TABBED_TAB_PREFIX } from './tabbed.ts';

/**
 * M6 (fase 2): as ações das telas de edição (a Partida personalizada, o Laboratório e a Oficina) num módulo só delas.
 * O menu da web (o `game.ts`) só precisa destes nomes; as telas em si moram no pedaço dos editores, e com as ações no
 * mesmo arquivo da tela o empacotador levava a tela inteira para o menu (que está no teto de 350 KB).
 */
export const CUSTOM_ACTION = { start: 'start', save: 'save', back: 'back', watch: 'watch' } as const;
/** Ação de uma aba (`tab:<índice>`) e de uma linha (`row:<id>`). */
export const CUSTOM_TAB_PREFIX = TABBED_TAB_PREFIX;
export const CUSTOM_ROW_PREFIX = TABBED_ROW_PREFIX;
/** M8 (fase 1): o id da linha Compartilhar da Partida personalizada (a ação é `row:share`). */
export const CUSTOM_SHARE_ROW = 'share';

export const LAB_ACTION = { back: 'back', test: 'test', save: 'save' } as const;

export const WORKSHOP_ACTION = {
  edit: 'edit',
  duplicate: 'duplicate',
  favorite: 'favorite',
  delete: 'delete',
  back: 'back',
  share: 'share',
} as const;

/** Ação de um bot da lista: `bot:<grupo>:<id>` (o mesmo bot pode estar nos favoritos e no grupo dele). */
export const WORKSHOP_BOT_PREFIX = 'bot:';
