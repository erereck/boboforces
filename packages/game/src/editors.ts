/**
 * M3: as telas de edição (Partida personalizada, Laboratório e Oficina) num módulo à parte, fora do chunk do menu na
 * web (tecnico.md §16.4: menu ≤ 350 KB). Regra 15: o `import()` fica no `apps/web`; o Switch e os testes ligam direto.
 * O `game` recebe este módulo por `GameDeps.loadEditors` e o pede logo depois do menu pronto.
 */
import { registerStrings, STRINGS_EXTRA_PT_BR } from '@boboforces/ui';

export {
  CUSTOM_TAB_LABELS,
  CUSTOM_TABS,
  customHelp,
  customRows,
  customTabs,
  presetName,
  stepCustom,
} from './custom-match.ts';
export { cleanBotName, LAB_TAB_LABELS, LAB_TABS, labRows, labSummary, rollBotName, stepLab } from './lab.ts';
export { customMatchScreen, labScreen, workshopScreen } from '@boboforces/ui';

// Refino R3a (#79): a tabela de textos da cena também vale aqui (o Laboratório e a Oficina podem abrir antes dela).
registerStrings(STRINGS_EXTRA_PT_BR);
// M4 (fase 2c): o importador da pasta `oficina/` (só o Switch usa; fora do menu da web).
export { importWorkshopFiles } from './workshop-files.ts';
