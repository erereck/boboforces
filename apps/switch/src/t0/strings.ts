// Chaves de texto das telas de teste do Switch (regra 13: texto de UI só pela tabela pt-BR). A tabela é da frente
// ui-fontes; as chaves abaixo foram PEDIDAS pela frente switch-audio (texto sugerido ao lado) e quase todas já estão
// nela. Contorno para a que ainda faltar: a chave só é usada se existir em `STRINGS_PT_BR`; senão o rótulo cai numa
// chave existente e as linhas mostram só o dado técnico (literal). Quando a chave entra, o texto aparece sozinho.
//
// Os rótulos dos itens do título usam as chaves CURTAS `test.item.*` (decisão #54: com a Russo One os rótulos longos
// estouravam o botão e a coluna de 9 itens cobria o logo). Só `test.item.benchPlanB` passa por aqui; as outras são
// usadas direto em `items.ts`, e o typecheck garante que existem.
import { STRINGS_PT_BR, type StringKey } from '@boboforces/ui';

/** Chaves pedidas → texto sugerido (pt-BR). */
export const SWITCH_TEST_STRINGS = {
  'test.item.benchPlanB': 'Bench plano B',
  'test.controllers': 'Teste de controles',
  'test.keyboard': 'Teste de teclado',
  'test.audio': 'Teste de áudio',
  'test.controllers.hint': 'A entra · X vibra · B volta',
  'test.keyboard.hint': 'A abre o teclado · B volta',
  'test.audio.hint':
    'A tiro · X impacto · Y passo · Cima clique · L sintetizados · R 24 vozes · Esq. e Dir. pan · B volta',
  'test.line.controller': 'Controle',
  'test.line.player': 'Jogador',
  'test.line.joyConSingle': 'Joy-Con avulso (não suportado)',
  'test.line.pressA': 'Aperte A em cada controle',
  'test.line.plusBlocked': '+ apertado: o jogo continuou aberto',
  'test.line.keyboardUnavailable': 'Teclado do sistema indisponível',
  'test.line.keyboardOpen': 'Teclado aberto',
  'test.line.typed': 'Digitado',
  'test.line.submitted': 'Confirmado',
  'test.line.cancelled': 'Cancelado',
  'test.line.noAudio': 'Sem áudio',
  'test.line.decode': 'MP3 do romfs',
  'test.line.synth': 'Som sintetizado',
  'test.line.voices': 'Vozes simultâneas',
  'test.line.latency': 'Latência de saída',
  'test.line.pan': 'Pan estéreo',
  'test.line.resume': 'Volta do HOME',
} as const;

export type SwitchTestStringKey = keyof typeof SWITCH_TEST_STRINGS;

/** Rótulo de item do título: a chave pedida se existir, senão `fallback` (sempre uma chave válida). */
export function labelKey(key: SwitchTestStringKey, fallback: StringKey = 'test.sceneTitle'): StringKey {
  return key in STRINGS_PT_BR ? (key as unknown as StringKey) : fallback;
}

/** Chave de linha/título/dica: a pedida se existir, senão `null` (a tela mostra só o literal). */
export function optionalKey(key: SwitchTestStringKey): StringKey | null {
  return key in STRINGS_PT_BR ? (key as unknown as StringKey) : null;
}
