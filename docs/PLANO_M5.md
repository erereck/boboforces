# Plano do M5: Online P2P (16/11/2026)

> Fonte: `docs/GDD.md` §3.7 e §7 (linha do M5); `docs/design/tecnico.md` §13 (rede) e §21 (portabilidade);
> `docs/DECISOES.md` #1 (o Switch nunca tem rede), #25 (até 4 humanos), #28 (a ordem dos marcos) e as linhas "Online:
> acesso / limites / comunicação / TURN". `docs/DECISOES.md` manda sobre este plano. Escrito no padrão da Q5 da rodada
> 18, enquanto o M4 espera o console (fase 8 do `PLANO_M4.md`). **Este plano é só o documento: nenhuma dependência
> nova, nenhum download e nada de rede sem o OK do Erick.**

## Objetivo

**Até 4 amigos na mesma partida pela web**, cada um no seu aparelho, com os bots do host: TDM, FFA, X1, Surpreenda-me
e Bobo Zombies coop. Host autoritativo, conexão direta entre os aparelhos (P2P), sala por código ou link, sem servidor
de jogo e sem conta. O Switch continua 100% offline (#1): nenhum byte de rede no build dele, conferido pelo
`portcheck`.

## Critério de pronto (GDD §7)

1. **Loopback no CI:** host e clientes no mesmo processo, com latência e perda simuladas, jogam uma partida inteira e
   terminam com o mesmo resultado que o host calculou.
2. **Teste real com 4 humanos + bots,** entre 4G e wi-fi (o Erick e amigos), sem dessincronizar e sem cair.
3. **Host no celular com 8 bots a 30 fps** (o orçamento do `tecnico.md` §13.4).
4. **TURN decidido** e **aviso de privacidade revisado** (inclusive o ECA Digital) antes de abrir o online ao público.
5. Como nos marcos anteriores: o portão inteiro verde, **o menu da web continua ≤ 350 KB** (o chunk de rede só carrega
   quando o jogador abre "Online", fora do orçamento do menu) e o `portcheck` do Switch sem `RTCPeerConnection`,
   `trystero` nem `WebSocket`.

## O que já existe

| Peça | Estado | Onde |
|---|---|---|
| `OnlineService` (marcador) | Só o tipo, com `protocolVersion`; `platform.online` é `null` em todo lugar | `packages/platform-api` |
| `MatchDriver` e `LocalDriver` | A partida já passa por um driver (a sim, a IA e o diretor de bots atrás dele) | `packages/game/src/local-driver.ts` |
| Sim determinística | Passo fixo, RNG com semente, entrada como `InputFrame`, snapshot versionado (o golden) | `packages/sim` |
| Regra 18 | Todo modo roda com `platform.online === null` (testado) | `docs/PORTABILIDADE.md` |
| `portcheck` do Switch | Já falha com rede no bundle | `tools/portcheck` |
| Assentos e "entrar no meio" | Jogador que entra assume um bot do time; o bot volta quando ele sai (M3, `setHumanControlled`) | `packages/game/src/scene/match.ts` |

`packages/net` ainda não existe: o M5 cria o pacote.

## Fases

Uma de cada vez, nesta ordem; cada fase termina verde e commitada (sem push, só com pedido do Erick). **Tudo o que
não precisa de rede de verdade vem primeiro** (fases 1 e 2, testadas por loopback); a dependência nova (Trystero) só
entra na fase 3, com o OK do download.

1. **O protocolo, sem rede:** `packages/net` (puro, sem DOM), o formato das mensagens com versão (`protocolVersion`,
   versão do jogo e hash do conteúdo que mexe na sim), o snapshot com delta contra a última confirmada, quantização
   (1 cm, ângulos em 16 bits), a divisão em mensagens de até 1.100 bytes por prioridade de entidade, e as entradas do
   cliente com as 3 anteriores repetidas. Um transporte de mentira em memória (`createLoopback`, com latência, perda e
   reordenação por semente). `HostDriver` e `ClientDriver` atrás do `MatchDriver`.
   **Feita em 16/11** (ARCHITECTURE §16.1): a partida inteira pelo loopback (80 ms, 5% de perda) termina igual no host
   e nos 3 clientes; a sim ganhou o `Sim.remote` (o cliente escreve o estado do host na sim dele). Os eventos da sim
   ficaram para a fase 2 (2a, feita: ARCHITECTURE §16.2).
2. **Eventos, predição e compensação:** os eventos da sim (tiro, acerto, morte, som) vão do host pelo canal confiável
   (vieram da fase 1; 2a feita); o cliente prediz só o próprio movimento com o mesmo código da sim, reconcilia por
   `seq` e interpola o resto com 100 ms; o host guarda 200 ms de hitboxes para o rewind do tiro. Teste: loopback de
   4 jogadores com 80 ms e 5% de perda termina igual ao host; o "tiro no que eu vi" acerta dentro de 200 ms. **2b e 2c feitas em 16/11** (ARCHITECTURE §16.3): a predição erra mais
   de 10 cm em menos de 1% das reconciliações e os outros ficam a 2 cm do host no p99; 2d feita (§16.4): pela rede a 80 ms, mirando no que vê, o cliente acerta 25 de 25 tiros (1 de 25 sem a compensação); o
   teto da volta passou de 200 para 350 ms, porque a 80 ms de ida o tiro precisa voltar 300 ms.
3. **O transporte de verdade:** Trystero com relays Nostr (o mesmo caminho do FutBobo), só STUN
   (`stun.cloudflare.com`) no protótipo, `public/net.json` com relays, STUN/TURN e `protocolVersion`. Canal confiável
   (lobby, eventos, pings) e não confiável (`ordered:false, maxRetransmits:0`, entradas e snapshots), com o reserva
   "tudo no canal do Trystero a 20 Hz" se o não confiável não der. Chunk só na web, carregado ao abrir "Online".
   **Feita em 16/11** (ARCHITECTURE §16.5): com o OK do download, a estratégia Nostr do FutBobo e a sala sobre o
   Trystero; no Edge, duas abas conectam por WebRTC em ~1 s e jogam uma partida inteira com o mesmo resultado
   (`npm run rtc:web`, sem relay público).
4. **A sala:** Online → Criar sala / Entrar com código / Abrir link (`#sala=XXXXX`, 5 caracteres sem ambíguos; o hash
   não chega a servidor nenhum), o aviso de privacidade na 1ª vez, o lobby (o host configura e todos veem; cada um
   escolhe time e loadout; o Meu Bobo vai junto), o host inicia. Expulsar e travar a sala.
5. **Quando as coisas dão errado:** host em segundo plano (coop pausa; PvP encerra em 10 s com o resultado), cliente
   em segundo plano (60 s e um bot assume), queda e volta (id persistente `boboforces:net.peerId` e snapshot
   completo), "host saiu = fim", versões diferentes ("Atualize a página" / "Seu amigo precisa atualizar", com o
   service worker procurando a nova), AFK, pings e emotes.
6. **Os modos:** TDM, FFA, X1, Surpreenda-me (o host sorteia) e Bobo Zombies coop; host no celular com teto de 8 bots
   e snapshots a 20 Hz; o aviso "Você é o host: não troque de app".
7. **Medição e roteiro:** o bench de rede (banda por cliente, tempo de serialização no host, a CPU do host no celular
   contra a tabela do §13.4), o `docs/ROTEIRO_M5.md` para o teste real com amigos, e a rodada de prints.
8. **Checkpoint com gente de verdade** (o Erick e amigos, 4G e wi-fi).
9. **Fechamento:** TURN decidido, aviso de privacidade revisado, `CHANGELOG`, `ARCHITECTURE` §16, `PERF`. Publicar o
   online só com o pedido do Erick.

## Fase 4 em detalhe (16/11/2026)

A sala junta três coisas novas: o protocolo do lobby (puro, no `net`), a partida com amigos na cena (o host com
jogadores remotos e o cliente sem diretor de bots) e as telas. Cada parte termina verde e commitada.

- **4a, o protocolo do lobby (`net`):**
  - o código da sala: 5 caracteres de um alfabeto sem ambíguos (sem 0/O/1/I), o link `#sala=XXXXX`;
  - as mensagens do lobby pelo canal confiável: quem eu sou (nome, o Meu Bobo), o estado da sala que o host manda a
    todos (jogadores, times, travada, o resumo da partida), a escolha de cada um, começar (a receita, os assentos, a
    semente), expulsar e travar;
  - um repartidor do `NetEndpoint` (o lobby e a partida no mesmo canal sem um roubar a mensagem do outro);
  - o handshake vai para o lobby: a partida começa com os clientes já aceitos;
  - teste por loopback: 4 entram, escolhem time, o host trava, um 5º é recusado, um é expulso e o começo chega igual
    a todos.
  - **feita em 16/11** (ARCHITECTURE §16.6).
- **4b, a partida com amigos na cena (`game`):**
  - **decisão menor revisável:** o contrato do online fica no `game` (`game/src/online-api.ts`), porque ele precisa
    dos tipos da sim, que o `platform-api` não enxerga. A casca web o implementa com o `net` e injeta por
    `GameDeps.loadOnline`, como os editores; no Switch não existe, e o `platform.online` continua nulo (regra 18);
  - **o host:** a cena de sempre, mais os slots remotos (as entradas vêm da rede; quem cai vira bot pelo cérebro de
    reserva do sofá, M3), o snapshot depois dos ticks e sem pausar a sim (PvP);
  - **o cliente:** o `ClientDriver` no lugar do `LocalDriver`, sem diretor (sem "Ajustar desafio", sem pings de bot);
  - teste com o `NullRenderer` e o loopback, se a cena couber nele (não coube: a cena precisa de assets e render;
    o driver da cena foi testado à parte, de ponta a ponta com o lobby; **feita em 16/11**, ARCHITECTURE §16.7).
- **4c, as telas (chunk próprio, fora do menu):**
  - o botão "Online" no título (O4), que carrega o chunk;
  - o aviso de privacidade na 1ª vez (O5: eu escrevo, você revisa antes de publicar);
  - Criar sala e Entrar com código, com o teclado do jogo no controle;
  - o lobby: os 4 lugares, o time de cada um, o código grande, Copiar link, e Travar, Expulsar e Começar para o host;
  - o host escolhe a partida com a Partida personalizada de sempre.
  - **feita em 16/11** (ARCHITECTURE §16.8). A rede de verdade (`@boboforces/net/rtc`) ficou num pedaço só dela; o
    núcleo do `net` e as telas foram com o pedaço da cena (com o `net` inteiro à parte, o menu passava dos 350 KB).
- **4d, o link e a volta:** abrir o jogo por `#sala=XXXXX` cai direto no "Entrar". O hash não sai do navegador.
  **Feita em 16/11** (ARCHITECTURE §16.9); a casca tira o hash da barra depois de ler.
- **4e, a prova:** duas abas do Edge pela sinalização local, do título até o fim da partida (`rtc:web` estendido), e
  uma rodada pelos relays de verdade entre duas abas, só de leitura e escrita efêmera de sinalização, como o jogo faz.
  **Feita em 16/11** (`npm run online:web`, ARCHITECTURE §16.9): do título à sala, à partida pela rede e de volta, e o
  "host saiu"; o amigo entrou em 1,9 s pela sinalização local e em 4,4 s pelos relays de verdade.
- **4f, a rodada de prints** (as telas e o texto do aviso de privacidade). **Feita em 16/11:** `npm run online:web -- --prints` captura as 21 telas (o caminho inteiro em 1280×720 e o host num celular de 667×375); rodada 19 da página de prints (S1–S6, com O3 e O6 do plano).

## Fase 5 em detalhe (16/11/2026)

O que o GDD (§3.7, "Quedas") e o `tecnico.md` §13.4 e §13.5 pedem para quando as coisas dão errado, em 4 partes,
cada uma verde e commitada:

- **5a, as ausências:**
  - **host em segundo plano:** ele avisa os amigos pelo canal confiável na hora em que a aba some, e os amigos também
    contam 3 s sem snapshot como host ausente (o celular pode suspender antes do aviso). No coop, a faixa "O host saiu
    do jogo por um instante" e a partida espera; no PvP, a contagem de 10 s e, sem o host, o resultado do último
    snapshot. O host que volta depois de 10 s num PvP encerra a partida com o placar daquela hora;
  - **amigo em segundo plano ou parado (AFK):** 60 s sem entrada (aba escondida ou nada apertado) e um bot assume a
    vaga; a primeira entrada de verdade devolve o boneco a ele. Enquanto o host está ausente, o amigo não prediz
    nem manda entradas.
  - **feita em 16/11** (ARCHITECTURE §16.10).
- **5b, a queda e a volta:**
  - um id do aparelho, guardado no perfil do Online, vai na escolha do lobby;
  - o host que sai de propósito avisa ("a sala acabou"); a conexão que cai sem aviso faz o amigo tentar voltar por 20 s
    ("Reconectando…"), no mesmo código;
  - o host reconhece o id: quem caiu no meio da partida volta para o boneco dele (que estava com um bot), mesmo com a
    sala trancada ou jogando, e recebe o snapshot completo; quem foi tirado não volta naquela sala.
  - **feita em 16/11** (ARCHITECTURE §16.11; o protocolo passou a 2).
- **5c, versões diferentes:** "Atualize a página" com o botão Atualizar quando o service worker já baixou a versão
  nova, e "Seu amigo precisa atualizar" do outro lado (as mensagens já existem desde a 4a). **Feita em 16/11**
  (ARCHITECTURE §16.12; o host também fica sabendo de quem a versão recusou).
- **5d, ping e emotes** (sem chat de texto):
  - **ping:** o botão de aviso (botão do meio do mouse ou N, direcional para cima) marca o ponto onde a mira está, para
    o próprio time; passa pela sim como os outros botões, então vale no online e no sofá;
  - **emotes:** o botão de emote (B, direcional para baixo) mostra um dos 4 balões fixos em cima do bobo ("Boa!",
    "Valeu!", "Bora!", "Ops!"; cada aperto passa para o próximo), para todos. As 4 poses do `arte-ux` ficam para
    quando o contrato de emote do `ActorBuffer` existir (decisão menor revisável).
  - **feita em 16/11** (ARCHITECTURE §16.13).
- **Fica para a fase 6:** o aviso "Você é o host: não troque de app", o teto de 8 bots e os snapshots a 20 Hz com host
  no celular.

## Fase 6 em detalhe (17/11/2026)

Os modos da sala e o host no celular, em 3 partes, cada uma verde e commitada:

- **6a, a partida da sala:** o "Escolher partida" do host abre os cards da sala, no mesmo desenho dos Modos:
  - **Times:** 4 contra 4 no Construto, Normal, 5 min ou 30 abates;
  - **Todos contra todos:** 8 bobos no Construto, 5 min ou 15 abates;
  - **X1:** 1 contra 1 no Ringue, 5 min ou 15 abates; com mais gente, cada amigo toma o lugar de um bot;
  - **Bobo Zombies:** coop na Base Abandonada, 10 ondas, com 3 bots de apoio que os amigos substituem;
  - **Surpreenda-me:** o sorteio de sempre, feito no aparelho do host; escolher de novo sorteia outro;
  - **Partida personalizada:** a de sempre.

  Os humanos tomam o lugar de bots, como no sofá. Teste: cada modo pela rede de mentira, com os mapas de verdade,
  termina igual no host e no amigo. **Feita em 17/11** (ARCHITECTURE §16.15).
- **6b, o host no celular:**
  - **o teto:** 8 bots e 16 zumbis com host no celular;
  - **o menor teto entre os participantes** (GDD §2): com um celular na sala, 12 bots, 24 zumbis e 90 m de visão. A
    escolha de cada um diz se é celular. A sala corta os bots do lado maior, um de cada vez, e avisa o host;
  - **o pool de zumbis do host** vai no começo: o amigo cria a sim com o mesmo número;
  - **os snapshots a 20 Hz** com host no celular (o welcome leva o ritmo ao amigo);
  - **o aviso na sala:** "Você é o host: não troque de app durante a partida". O Wake Lock da partida já existe.
  - **feita em 17/11** (ARCHITECTURE §16.16).
- **6c, a prova:** as duas abas do Edge passam pelos cards da sala, e os testes das partes ficam no portão. Depois, a
  revisão. **Feita em 17/11** (ARCHITECTURE §16.17).

## Fase 7 em detalhe (18/11/2026)

O que dá para medir sem gente de verdade, e o que fica pronto para medir com ela (a fase 8), em 3 partes:

- **7a, a rede à vista:**
  - **o F2 com a rede.** No host: o tempo da rede por quadro (receber e montar os snapshots), o que sobe para cada
    amigo (KB/s), os snapshots por segundo e quantos amigos. No amigo: o que desce (KB/s), o atraso em ticks, o host
    ausente e as predições que erraram;
  - **o registro.** Uma linha `[rede]` a cada 30 s de partida online, com os mesmos números. Ela vai no "Copiar
    relatório" dos Ajustes: é por ali que os números do teste real chegam;
  - **o bench de rede** (`npm run bench:rede`, no Node). O host com os mapas de verdade, a IA e 3 amigos pela rede de
    mentira, em 3 casos: o host no celular (4 humanos e 8 bots a 20 Hz), o PC cheio (4 humanos e 40 bots a 30 Hz) e o
    Bobo Zombies (pool de 16 e de 60). Ele mede, por quadro, a sim, a IA e a rede do host, separadas do trabalho dos
    amigos de mentira, e a banda por amigo. Os números do PC vão para o `PERF.md`, ao lado da tabela do tecnico.md
    §13.4. A CPU do host no celular sai do F2 no teste real.
  - **feita em 18/11** (ARCHITECTURE §16.19).
- **7b, o roteiro:** o `docs/ROTEIRO_M5.md`, o passo a passo do teste real com amigos (fase 8). O host no PC e no
  celular, 4G e wi-fi, cada modo, as quedas, o "Copiar relatório" de cada um. Diz também o que anotar.
  **Feita em 19/11** (ARCHITECTURE §16.20), com o Online escondido no site até ser aberto ao público: ele aparece com
  `?online` ou para quem abre o link de uma sala.
- **7c, a rodada de prints:** as telas da fase 5 e da fase 6 que ainda não foram à página (os cards da sala, o aviso
  do host no celular, a faixa do host ausente, o "voltando à sala", o Atualizar). Ela vai à página das rodadas com as
  perguntas novas e as que seguem abertas. **Feita em 19/11** (ARCHITECTURE §16.21): rodada 20, versão 24 da página,
  perguntas T1–T5.

## Riscos

- **O menu da web está em 349,2 de 350 KB** (depois da 4c). O item "Online" e a tela de código precisam caber: a tela
  da sala vai para o chunk de rede, e no menu fica só o botão (algumas dezenas de bytes). Se faltar, o primeiro passo da fase 4
  é abrir espaço (mover para a tabela extra os textos que o menu não usa, como na R3a).
- **NAT simétrico (parte do 4G) não conecta só com STUN.** Por isso o TURN é critério de pronto, não detalhe.
- **Host no celular:** o iOS e alguns Android suspendem a aba em segundo plano sem avisar; os clientes detectam 3 s
  sem snapshot como "host ausente" (§13.4).
- **A sim precisa ser a mesma nos dois lados:** o hash do conteúdo no handshake recusa a partida com versões
  diferentes, e o loopback do CI pega divergência antes do teste real.

## Perguntas para o Erick (sigo no padrão enquanto ele não responde)

| # | Pergunta | Padrão |
|---|---|---|
| O1 | **Começar pelo protocolo sem rede** (fases 1 e 2, só loopback), deixando o Trystero para a fase 3? | Sim: dá para fazer e testar tudo sem dependência nova nem rede |
| O2 | **Trystero:** a mesma biblioteca do FutBobo, com relays Nostr (`tecnico.md` §13.2). O download pede o seu OK (nome, origem e tamanho; versão exata, sem `^`). | Pedir o OK na fase 3, com a versão que o FutBobo usa (se a pasta dele estiver acessível) |
| O3 | **TURN** (sem ele, parte do 4G não conecta): Cloudflare com credenciais geradas por um Worker grátis (precisa da sua conta) ou Open Relay como reserva? | Só STUN até a fase 7; a escolha antes de abrir o online |
| O4 | **Onde fica o "Online"** no título: um botão ao lado de Modos (o chunk de rede carrega ao abrir)? | Sim |
| O5 | **O aviso de privacidade** (a conexão é direta e os amigos podem ver o IP; revisão pelo ECA Digital): eu escrevo o texto e você revisa antes de publicar? | Sim |
| O6 | **Publicar o online:** só depois do teste real com amigos (fase 8) e do seu pedido? | Sim |

## Fora do M5

Salas públicas e matchmaking; chat de texto livre; migração de host; online com jogadores locais no mesmo aparelho (a
arquitetura aceita, a v1 não); online no Switch (nunca, #1); Bobo Royale e os modos de festa (M6+).
