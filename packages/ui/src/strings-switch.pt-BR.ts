/**
 * M9 (fase 0): os textos que só o Switch mostra (os avisos da casca e as telas de teste do Teste Zero), fora da tabela do
 * menu da web. A casca do Switch registra (`registerStrings`) no boot, antes de tudo. Os rótulos dos itens de teste do
 * título (`test.item.*`) ficam na tabela do menu: a prévia do título do Switch na web (`?titulo=switch`) também os mostra.
 * As mesmas regras da `strings.pt-BR.ts`.
 */
export const STRINGS_SWITCH_PT_BR = {
  // A tela de teste (`test-screen.ts`): os selos de status e as linhas da tela de controles.
  'test.status.ok': 'OK',
  'test.status.fail': 'Falha',
  'test.status.info': 'Info',
  'test.status.wait': 'Aguarda',
  'test.controllers.hint': 'A entra · X vibra · B volta',
  'test.controllers.pressA': 'Aperte A',
  'test.controllers.ready': 'Pronto',
  'test.controllers.incomplete': 'Controle incompleto: junte o par',
  'test.keyboard.hint': 'A abre o teclado · B volta',
  'test.audio.hint':
    'A tiro · X impacto · Y passo · Cima clique · L sintetizados · R 24 vozes · Esq. e Dir. pan · B volta',
  /**
   * Telas de teste do Switch (pedidos da frente switch-audio, integração do M1). Os itens do título usam as chaves
   * curtas `test.item.*` (#54); as descrições longas dos benches saíram junto (nada mais as lia).
   */
  'test.controllers': 'Teste de controles',
  'test.keyboard': 'Teste de teclado',
  'test.audio': 'Teste de áudio',
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
  // Os avisos da casca fora da UI do jogo (sem GPU, ou falha no boot).
  'switch.needApplicationMode': 'Abra segurando R ou instale o NSP',
  'switch.pressPlusToExit': 'O BoboForces precisa do modo aplicativo. Aperte + para sair.',
  'switch.bootFailed': 'Falha ao iniciar o BoboForces',
  'switch.bootFailedHint': 'Detalhes em sdmc:/switch/boboforces/runtime.log. Aperte + para sair.',
  // O rótulo de contorno das chaves pedidas que faltarem (`apps/switch/src/t0/strings.ts`).
  'test.sceneTitle': 'Cena de teste',
} as const satisfies Readonly<Record<string, string>>;

export type SwitchStringKey = keyof typeof STRINGS_SWITCH_PT_BR;
