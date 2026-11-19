# Roteiro do teste com amigos do M5: o Online (19/11/2026)

> Para o Erick seguir com os amigos (a fase 8 do `PLANO_M5.md`). São os critérios 2 e 3 do plano: 4 humanos e bots
> entre 4G e wi-fi, sem dessincronizar nem cair, e o host no celular com 8 bots a 30 fps.
>
> O que já foi medido sem vocês está no `PERF.md` §1i:
>
> - a rede de mentira com 80 ms e 5% de perda;
> - duas abas do Edge pela WebRTC de verdade;
> - o host no PC com 40 bots, a 0,44 ms de rede por quadro.
>
> Anote ao lado de cada item: **ok**, **estranho** (com uma frase) ou **quebrou**. No fim, **cada um** manda o
> relatório (Ajustes › Sobre › Copiar relatório). Ele tem uma linha `[rede]` a cada 30 s de partida, com fps, sim,
> IA, rede, banda e atraso.

## 0. Antes: como os amigos entram

O Online está no ar, aberto a todos (decisão #80): o botão aparece no título de
`https://erereck.github.io/boboforces/`. Você cria a sala e manda o link pelo **Copiar link**; quem abre o link cai
direto no Entrar com o código já posto. Quem já tinha o jogo aberto pega a versão nova ao voltar ao título (o service
worker).

**Ainda sem TURN (O3):** parte do 4G (NAT simétrico) pode não conectar. Se alguém no 4G ficar 20 s em "Procurando a
sala" e cair em "Ninguém respondeu nesse código", anote a operadora e se estava no 4G ou no wi-fi. É exatamente o caso
que o TURN resolve, e é o que decide a O3.

Anote também, de cada um: o aparelho (modelo do celular ou PC), o navegador, e se estava no wi-fi ou no 4G.

## 1. Host no PC, 3 amigos (um no 4G, se der)

| # | O que fazer | O que esperar |
|---|---|---|
| 1 | Você: Online › o aviso (1ª vez) › seu nome › Criar sala › **Copiar link** e mandar no grupo | A sala com o código grande; "Link copiado" |
| 2 | Cada amigo abre o link | O aviso de privacidade na 1ª vez, depois o Entrar com o código já posto; ele aparece na sua lista |
| 3 | Cada um escolhe o time; você tranca e destranca | Os times aparecem para todos; trancada, ninguém novo entra |
| 4 | Escolher partida › **Times** › Começar; jogar os 5 min | Todos na partida em poucos segundos; o boneco de cada um anda na hora (sem "elástico"); os tiros acertam o que se vê |
| 5 | No meio, **F2** no PC (o seu e o de quem estiver no PC) | A linha "Rede (host)" ou "Rede (amigo)": anote o fps, a rede em ms, o atraso em ticks e as predições erradas |
| 6 | Ping (botão do meio do mouse ou N; no controle, direcional para cima) e emote (B; direcional para baixo) | O losango para o próprio time; o balão em cima do bobo para todos |
| 7 | Escolher partida › **Todos contra todos**; depois **X1** (só 2); depois **Surpreenda-me** | Cada uma abre para todos; no X1 com 2, um contra o outro, sem bot |
| 8 | Escolher partida › **Bobo Zombies**, todos juntos | A Base Abandonada; ondas, pontos, portas, a caixa e levantar o colega funcionam para todos |
| 9 | Um amigo **desliga o wi-fi (ou o 4G) por 5 s** no meio da partida e liga de novo | Ele vê "A conexão caiu: voltando à sala" e volta ao boneco dele (um bot segurou a vaga) |
| 10 | Um amigo **fica parado 60 s** (ou troca de aba) | Um bot assume o boneco; ao mexer, a vaga volta para ele |
| 11 | Você **troca de aba por 15 s** numa partida de Times | Os amigos veem "O host saiu do jogo por um instante" e, em 10 s, o resultado |
| 12 | O mesmo no **Bobo Zombies** | A faixa aparece e a partida espera você voltar |
| 13 | Você tira um amigo (Tirar) | Ele vê "O host tirou você"; se tentar voltar pelo link, não entra |
| 14 | Você sai da sala | Todos veem "O host saiu: a sala acabou" |

## 2. Host no celular (critério 3)

| # | O que fazer | O que esperar |
|---|---|---|
| 1 | No seu celular: o site › Online › Criar sala | O aviso "Você é o host: não troque de app durante a partida" |
| 2 | 3 amigos entram; Escolher partida › **Personalizada** com o máximo de bots | O celular deixa no máximo 8 bots ("a partida vai com até 8 bots" se pedir mais) |
| 3 | Jogar 5 min de Times | Fluido para todos; no fim, **Copiar relatório** no celular: as linhas `[rede] host` dizem fps (meta: 30), sim, IA e rede em ms (orçamento: 2,5 / 1,0 / 2,0) |
| 4 | **Bobo Zombies** com o celular de host | A horda de até 16 zumbis; fluido |
| 5 | Trocar de app por 15 s no meio (de propósito, uma vez) | Times: os amigos veem o resultado em 10 s; Zombies: a partida espera |
| 6 | Um amigo no celular com você no PC de host | Com um celular na sala, até 12 bots (o aviso aparece no PC se a partida tiver mais) |

No celular não há F2: os números vão nas linhas `[rede]` do relatório.

## 3. O que mandar

- O relatório de **cada aparelho** (Ajustes › Sobre › Copiar relatório), colado num arquivo ou mensagem.
- As anotações de cada item (ok, estranho, quebrou), com quem estava no 4G e quem estava no wi-fi.
- Se algo quebrou: o que estava na tela (uma foto serve) e o relatório de quem viu.

## 4. Riscos conhecidos

- **TURN (O3):** sem ele, parte do 4G não conecta. O teste mostra se a sua turma esbarra nisso.
- **iPhone:** o Safari suspende a aba de trás sem avisar. Com um iPhone de host, a faixa "o host saiu" aparece depois
  de 3 s sem notícia.
- **O aviso de privacidade** ainda é o meu texto (O5). Ele precisa da sua revisão antes de abrir o Online ao público.
- **Abrir ao público** é outra decisão (O6), depois deste teste.
