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

## Riscos

- **O menu da web está em 348,3 de 350 KB.** O item "Online" e a tela de código precisam caber: a tela da sala vai
  para o chunk de rede, e no menu fica só o botão (algumas dezenas de bytes). Se faltar, o primeiro passo da fase 4
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
