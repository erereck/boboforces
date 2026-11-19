/**
 * M5 (fase 4c): os textos das telas do Online (o aviso de privacidade, Criar sala, Entrar com código e a sala). Chegam
 * com o pedaço do Online, que os registra (`registerStrings`) ao carregar: o menu da web não paga por eles (o teto é
 * 350 KB) e o Switch nunca os carrega (#1). As mesmas regras da `strings.pt-BR.ts`: chaves estáveis em inglês com
 * ponto, valores em pt-BR.
 */
export const STRINGS_ONLINE_PT_BR = {
  'online.title': 'Online',
  // O aviso de privacidade (O5: texto do Claude, revisão do Erick antes de publicar; ECA Digital). Volta a aparecer
  // quando a versão dele (`ONLINE_PRIVACY_VERSION`) sobe. O layout não quebra linha: o \n separa as linhas de um
  // parágrafo.
  'online.privacy.title': 'Antes de jogar online',
  'online.privacy.p2p':
    'A partida vai direto de um aparelho para o outro: quem está na sala pode ver\no endereço de internet (IP) do seu.',
  'online.privacy.relays':
    'Para os aparelhos se acharem, o jogo usa servidores públicos (Nostr e STUN).\nEles veem o código da sala e o IP, nunca a partida.',
  'online.privacy.data': 'Sem conta, sem chat e sem servidor do jogo: o seu nome só vai para quem está na sala.',
  'online.privacy.friends':
    'Jogue só com quem você conhece. Tem menos de 18 anos? Combine antes com quem cuida de você.',
  'online.privacy.ok': 'Entendi',
  'online.privacy.read': 'Privacidade',
  'online.name': 'Seu nome',
  'online.noName': 'Sem nome',
  'online.nameKeyboard': 'Seu nome na sala',
  'online.typing': 'Digite e aperte Enter (Esc desfaz).',
  'online.create': 'Criar sala',
  'online.join': 'Entrar com código',
  'online.home.help': 'Até 4 amigos, cada um no seu aparelho, com os bots de quem criou a sala.',
  'online.join.title': 'Entrar numa sala',
  'online.join.help': '5 letras e números, sem 0, O, 1 e I. Quem criou a sala vê o código na tela.',
  'online.join.type': 'Digitar código',
  'online.join.go': 'Entrar',
  'online.join.keyboard': 'Código da sala',
  'online.join.invalid': 'Código incompleto ou com letra que não existe (0, O, 1 e I ficam de fora).',
  'online.status.creating': 'Abrindo a sala…',
  'online.status.joining': 'Procurando a sala {code}…',
  'online.status.reconnecting': 'A conexão caiu: voltando à sala {code}…',
  'online.cancel': 'Cancelar',
  'online.ok': 'OK',
  // M5 (fase 5c): a versão nova (o service worker procura quando o Online acha uma versão diferente).
  'online.update': 'Atualizar',
  'online.update.searching': 'Procurando a versão nova…',
  'online.update.ready': 'A versão nova chegou: aperte Atualizar.',
  'online.update.reload': 'Recarregue a página para pegar a versão nova.',
  'online.room.friendOutdated': 'Um amigo tentou entrar com o jogo desatualizado: ele precisa recarregar a página.',
  'online.room.hostOutdated': 'Um amigo tem uma versão mais nova: atualize o jogo antes da próxima partida.',
  'online.end.full': 'A sala está cheia (4 jogadores).',
  'online.end.locked': 'A sala está trancada ou no meio de uma partida.',
  'online.end.updateSelf': 'Seu jogo está desatualizado: falta a versão nova.',
  'online.end.updateFriend': 'O jogo do host está desatualizado: ele precisa recarregar a página.',
  'online.end.mismatch': 'Os dois jogos estão em versões diferentes.',
  'online.end.kicked': 'O host tirou você da sala.',
  'online.end.hostLeft': 'O host saiu: a sala acabou.',
  'online.end.notFound': 'Ninguém respondeu nesse código. Confira com quem criou a sala.',
  'online.end.network': 'Não deu para abrir a conexão. Confira a internet e tente de novo.',
  'online.end.badRecipe': 'A partida da sala não abre neste jogo.',
  'online.end.left': 'Você saiu da sala.',
  'online.room.code': 'Sala {code}',
  'online.room.copy': 'Copiar link',
  'online.room.copied': 'Link copiado: mande para os amigos.',
  'online.room.copyFailed': 'Não deu para copiar: passe o código {code}.',
  'online.room.players': 'Jogadores · {n} de 4',
  'online.room.empty': 'Lugar vago',
  'online.room.you': 'você',
  'online.room.host': 'host',
  // Quem não escolheu nome.
  'online.room.hostName': 'Host',
  'online.room.friendName': 'Amigo {n}',
  'online.room.waitAway': 'Esperando {name} voltar do resultado.',
  'online.room.away': 'no resultado',
  'online.room.team': 'Seu time',
  'online.team.any': 'Tanto faz',
  'online.team.0': 'Laranja',
  'online.team.1': 'Azul',
  'online.team.solo': 'Cada um por si',
  'online.room.kick': 'Tirar',
  'online.room.lock': 'Trancar',
  'online.room.unlock': 'Destrancar',
  'online.room.locked': 'Sala trancada: ninguém novo entra.',
  'online.room.match': 'Escolher partida',
  'online.room.start': 'Começar',
  'online.room.leave': 'Sair da sala',
  'online.room.wait': 'Esperando o host começar.',
  'online.room.hostQuit': 'O host encerrou a partida.',
  // M5 (fase 6a): a "Partida da sala" (os cards dos Modos, com os modos do online).
  'online.match.title': 'Partida da sala',
  'online.mode.x1': 'X1',
  'online.mode.x1.desc': '1 contra 1 no Ringue; com 4, vira 2 contra 2.',
  'online.mode.zombies.desc': 'Juntos contra as ondas de zumbis.',
  'online.mode.royale': 'Bobo Royale',
  'online.mode.royale.desc': 'Em dupla na Ilha; o último de pé vence.',
  'online.mode.surprise.desc': 'Sorteia a partida; de novo, sorteia outra.',
  'online.mode.custom.desc': 'Todas as regras, como no jogo sozinho.',
  // M5 (fase 6b): o host no celular e o menor teto da sala (tecnico.md §13.4; GDD §2).
  'online.room.phoneHost': 'Você é o host: não troque de app durante a partida.',
  'online.room.capped': 'Com celular na sala, a partida vai com até {n} bots.',
} as const satisfies Readonly<Record<string, string>>;

export type OnlineStringKey = keyof typeof STRINGS_ONLINE_PT_BR;
