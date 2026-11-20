/**
 * Os prefixos das ações das telas de abas (`tab:<índice>` e `row:<id>`). M9 (fase 0): num módulo só deles, como o
 * `editor-actions.ts`: o menu da web (o `game.ts` e o `menu.ts`) só precisa dos nomes, e com eles no `tabbed.ts` o
 * empacotador levava o esqueleto das telas de abas inteiro para o menu (que está no teto de 350 KB).
 */
export const TABBED_TAB_PREFIX = 'tab:';
export const TABBED_ROW_PREFIX = 'row:';
