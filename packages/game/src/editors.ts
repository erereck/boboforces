/**
 * M3: as telas de edição (Partida personalizada, Laboratório e Oficina) num módulo à parte, fora do chunk do menu na
 * web (tecnico.md §16.4: menu ≤ 350 KB). Regra 15: o `import()` fica no `apps/web`; o Switch e os testes ligam direto.
 * O `game` recebe este módulo por `GameDeps.loadEditors` e o pede logo depois do menu pronto.
 */
export { CUSTOM_TAB_LABELS, CUSTOM_TABS, customRows, presetName, stepCustom } from './custom-match.ts';
export { cleanBotName, LAB_TAB_LABELS, LAB_TABS, labRows, labSummary, rollBotName, stepLab } from './lab.ts';
export { customMatchScreen, labScreen, workshopScreen } from '@boboforces/ui';
