// Refino R3a (#79): nos testes, a tabela de textos da cena já registrada (no jogo, a cena registra ao carregar).
import { registerStrings } from './text.ts';
import { STRINGS_EXTRA_PT_BR } from './strings-extra.pt-BR.ts';
import { STRINGS_SWITCH_PT_BR } from './strings-switch.pt-BR.ts';

registerStrings(STRINGS_EXTRA_PT_BR);
// M9 (fase 0): e a do Switch (os itens e a tela de teste; no jogo, a casca do Switch registra no boot).
registerStrings(STRINGS_SWITCH_PT_BR);
