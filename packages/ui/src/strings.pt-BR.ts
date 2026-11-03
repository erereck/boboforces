/**
 * TABELA DE TEXTOS (decisão #14, regra 13). Todo texto de interface sai daqui, desde o primeiro dia.
 * Chaves estáveis em inglês com ponto (`area.item`); valores em pt-BR. Parâmetros entre chaves: `{name}`.
 * Nomes bobos de modos/armas/bots ficam em inglês (decisão #15); o resto da interface é pt-BR.
 */
export const STRINGS_PT_BR = {
  'app.name': 'BoboForces',

  'boot.loading': 'Carregando…',
  'boot.pressStart': 'Aperte A ou Enter para começar',
  'boot.noWebgl2': 'Seu navegador não tem WebGL2. Tente o Chrome, o Edge ou o Firefox atualizados.',

  /** Logotipo provisório em texto MSDF (o logo em blocos chega com o tools/logo). Grafia do logo: caixa alta. */
  'title.logo': 'BOBOFORCES',
  'title.credit': 'um jogo bobo da EriLab',
  'title.version': 'v{version} · {codename}',

  'settings.empty': 'Nada para ajustar por enquanto.',

  'menu.play': 'Jogar',
  'menu.quickMatch': 'Partida Rápida',
  'menu.settings': 'Ajustes',
  'menu.about': 'Sobre',
  'menu.quit': 'Sair',
  'menu.back': 'Voltar',
  'menu.confirm': 'Confirmar',

  'pause.title': 'Pausado',
  'pause.resume': 'Continuar',
  'pause.unstuck': 'Destravar',
  'pause.quitMatch': 'Sair da partida',

  'hud.health': 'Vida',
  'hud.ammo': '{clip} / {reserve}',
  'hud.timeLeft': '{minutes}:{seconds}',
  'hud.kills': 'Abates',
  'hud.respawning': 'Renascendo…',
  'hud.clickToAim': 'Clique para mirar com o mouse',

  /** Rótulos curtos dos botões de toque (cabem num botão de 64 px). */
  'touch.fire': 'Tiro',
  'touch.ads': 'Mira',
  'touch.jump': 'Pulo',
  'touch.crouch': 'Agacha',
  'touch.reload': 'Recarga',
  'touch.grenade': 'Granada',
  'touch.weapon': 'Arma',
  'touch.pause': 'II',

  'level.vibe': 'Pela vibe',
  'level.chill': 'De boa',
  'level.normal': 'Normal',
  'level.sweaty': 'Suado',
  'level.tryhard': 'Tryhard',

  'mode.warfare.tdm': 'Bobo Warfare: Times',
  'mode.warfare.ffa': 'Bobo Warfare: Todos contra todos',
  'mode.training': 'Bobo Training',

  'error.title': 'Algo deu errado',
  'error.copyReport': 'Copiar relatório',
  'error.saveReport': 'Salvar relatório',
  'error.backToMenu': 'Voltar ao menu',

  'device.rotatePhone': 'Gire o celular',
  'device.pressToJoin': 'Aperte A ou Enter para entrar',
  'device.controllerDisconnected': 'Controle desconectado',
  'switch.needApplicationMode': 'Abra segurando R ou instale o NSP',
  'switch.pressPlusToExit': 'O BoboForces precisa do modo aplicativo. Aperte + para sair.',
  'switch.bootFailed': 'Falha ao iniciar o BoboForces',
  'switch.bootFailedHint': 'Detalhes em sdmc:/switch/boboforces/runtime.log. Aperte + para sair.',

  'test.sceneTitle': 'Cena de teste',

  /** Controles: avisos de `profileWarnings` (input). */
  'binding.ctrlReserved': 'O Ctrl é do navegador (Ctrl+W fecha a aba). Escolha outra tecla.',

  /**
   * Problemas dos validadores do `format` (`ISSUE_CODES`): uma chave `issue.<código>` para cada código. O teste do
   * `game` confere que nenhum código fica sem texto.
   */
  'issue.doc.notObject': 'Este arquivo não é um documento do BoboForces.',
  'issue.format.missing': 'O arquivo não diz de que tipo é.',
  'issue.format.invalid': 'Formato de arquivo desconhecido.',
  'issue.format.wrongKind': 'Este arquivo é de outro tipo.',
  'issue.format.newerVersion': 'Feito numa versão mais nova do BoboForces. Atualize o jogo.',
  'issue.format.migrationMissing': 'Não dá para trazer este arquivo para esta versão.',
  'issue.format.migrationFailed': 'A conversão deste arquivo falhou.',
  'issue.format.migrated': 'Veio de uma versão antiga e foi atualizado.',
  'issue.content.missingMode': 'Modo de jogo desconhecido.',
  'issue.content.missingMap': 'Mapa desconhecido.',
  'issue.content.missingBot': 'Bot desconhecido: entrou um Normal no lugar.',
  'issue.content.missingMovement': 'Movimento desconhecido: voltou para o Bobo.',
  'issue.content.missingWeapon': 'Arma desconhecida: trocada por uma parecida.',
  'issue.content.missingBlock': 'Bloco desconhecido: trocado pelo bloco de teste.',
  'issue.content.missingLook': 'Visual desconhecido: voltou para o padrão.',
  'issue.content.retired': 'Item aposentado: trocado pelo substituto.',
  'issue.recipe.noTeams': 'A partida não tem nenhum time.',
  'issue.recipe.invalidField': 'Um campo veio com valor inválido e foi ignorado.',
  'issue.recipe.valueClamped': 'Um valor estava fora da faixa e foi ajustado.',
  'issue.recipe.seedMissing': 'Sem semente: a partida usou a semente 0.',
  'issue.recipe.tooManyTeams': 'Times demais: os extras ficaram de fora.',
  'issue.recipe.tooManyBotEntries': 'Linhas de bot demais num time: as extras ficaram de fora.',
  'issue.recipe.duplicateAllHumans': 'Só um time pode receber todos os jogadores.',
  'issue.recipe.botsOverPlatformCap': 'Bots demais para este aparelho: a partida foi reduzida.',
  'issue.recipe.humansOverPlatformCap': 'Jogadores demais para este aparelho.',
  'issue.recipe.viewDistanceOverPlatformCap': 'Alcance de visão limitado pelo aparelho.',
} as const satisfies Readonly<Record<string, string>>;

export type StringKey = keyof typeof STRINGS_PT_BR;
