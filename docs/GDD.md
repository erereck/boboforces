# BOBOFORCES: GDD (documento-mestre)

> **Status:** v1, fim da Fase 1 (estruturação), 02/11/2026. Próximo passo: **M0 Fundação**.
>
> **Como ler**
> - [`DECISOES.md`](DECISOES.md) (45 decisões do Erick + decisões menores do Claude) manda sobre qualquer outro texto, inclusive este.
> - Este GDD basta para entender o jogo inteiro. O detalhe fica nos documentos de design:
>   - [`design/gameplay.md`](design/gameplay.md): regras, números, bots, modos, mapas, presets.
>   - [`design/tecnico.md`](design/tecnico.md): arquitetura, render, rede, save, orçamentos, Teste Zero.
>   - [`design/arte-ux.md`](design/arte-ux.md): arte, UI, controles, áudio, marca.
> - Onde os documentos de design ainda divergem entre si, vale o valor escrito aqui até o alinhamento (lista em 9.2).
> - **[DECIDIDO #n]** = decisão do Erick (linha *n* de `DECISOES.md`). **[PADRÃO]** = decisão menor do Claude, revisável pelo Erick. **[T0]** = só se confirma no Teste Zero (M1). Sem marca = resumo dos documentos de design.
> - Unidades: metros e segundos. **1 bloco = 0,5 m.**

---

## 0. Resumo em uma página

**BoboForces** é um FPS de tiro contra bots da EriLab, com visual **blocado pixel-art na linha de Block Strike e Pixel Gun 3D** [DECIDIDO #5, #45]. Você monta a partida (modo, mapa, regras) e os inimigos (quantos, quão espertos, quão certeiros, com que personalidade e com que vantagens). Depois entra para jogar sozinho, com até 3 amigos no sofá ou com até 3 amigos por link. É o "mapa de bots do gmod" virando jogo: offline primeiro, sem estresse, com o desafio escolhido por você.

| | |
|---|---|
| **Fantasia** | "Eu sou o dono do servidor." Escolho o mapa, os inimigos, o jeito deles e as regras, e entro para dar tiro pela vibe ou suando. Ninguém me julga, e não tem ranking nem estranho xingando. |
| **Para quem** | Quem gosta de FPS mas não de competitivo ("estressa"). Quem jogava mapas de bots no gmod. Grupos de 2 a 4 no sofá (PC com controles ou Switch) e amigos por link. Público geral, inclusive crianças: o site é público, por isso a violência é cartunesca por padrão. |
| **Plataformas** | **Web** no PC (principal) e no celular (Android e PC primeiro; iPhone/iPad com limitações conhecidas), pelo GitHub Pages, sem instalar e sem APK. **Switch homebrew** (nx.js), 100% offline, solo e local até 4, só para uso pessoal. [DECIDIDO #1, #26, #33, #37, #40] |
| **Gênero e tom** | FPS arcade rápido, configurável. Brinquedo tático: militar cartunesco genérico, sem nacionalidade, humor "bobo, nunca maldoso". [DECIDIDO #8, #19] |
| **Modelo** | Gratuito e não comercial. Tudo liberado desde o início; sem progressão, loja, moedas, passe ou anúncio. Só estatísticas e recordes. [DECIDIDO #16] |
| **Primeiro lançamento (M2)** | Web solo: Bobo Warfare TDM e FFA, Bobo Training, Surpreenda-me simples, Laboratório com núcleo forte, Construto + 1 arena pequena, 8 armas. [DECIDIDO #27, #29] |

**O que o diferencia**
1. **Laboratório de bots.** Bot = inteligência + habilidade + personalidade + regras, mais o visual. Dá para criar o "gênio que não acerta nada", o "burro que nunca erra" ou o "covarde imortal" e salvar com nome.
2. **Tudo é regra de partida,** sempre com um bom padrão. Nenhuma vantagem escondida: o que um bot tem aparece no card dele.
3. **Estresse zero.** Sem ranking, sem estranhos, sem punição. O solo pausa de verdade e a revanche sai em 1 toque.
4. **Do clique ao tiro em segundos.** Abre no navegador; JOGAR é 1 interação; menu em até 2 s no PC e 4 s no celular; primeira partida em até 5 s no PC e 10 s no celular (`tecnico.md` 16.4).
5. **Sofá de verdade.** Tela dividida até 4, também no PC com controles, e o mesmo jogo no Switch. Humanos e bots no mesmo time: quem entra assume um bot, quem sai vira bot.
6. **Bots legíveis e mudos** [DECIDIDO #34]. O jeito aparece no movimento, nas escolhas, no rosto e em ícones.

**O que não é:** competitivo ranqueado; matchmaking ou sala pública; jogo de progressão ou desbloqueio; campanha com história; loja; simulador militar realista; jogo com editor de mapas para jogadores [DECIDIDO #36].

---

## 1. Pilares

| # | Pilar | Na prática | Teste para aceitar uma feature |
|---|---|---|---|
| 1 | **Você é o game designer da partida** | Toda regra de jogo é configurável, sempre com um bom padrão. | "Isso pode virar opção de partida personalizada?" Se é regra, tem que poder. |
| 2 | **Estresse zero por padrão** | Sem ranking nem punição por sair. O solo pausa de verdade. O Tryhard é escolha, nunca imposto. | "Isso pune o jogador relax?" Se pune, vira opção desligada por padrão. |
| 3 | **Do clique ao tiro em segundos** | JOGAR em 1 interação; partida nova em até 3; partidas de 5 a 10 min; nenhum tutorial obrigatório. | "Isso adiciona uma tela obrigatória?" Se adiciona, corta ou deixa opcional. |
| 4 | **Bots com nome e jeito** | IA divertida e legível antes de sofisticada. O bot erra de um jeito engraçado e ganha de um jeito justo. | "O jogador entende por que o bot fez isso, e toda vantagem dele aparece no card?" Se não, não entra. |
| 5 | **Junto no sofá ou pelo link** | Humanos e bots no mesmo time. Todo modo funciona solo, local e online quando faz sentido. | Passa no checklist da regra de ouro (4.1.4)? |
| 6 | **Brinquedo bonito que reage, legível antes de bonito** | Cada tiro, impacto, morte e explosão solta cubinhos, faíscas, confete e som. | "Numa vista de 640×360, dá para saber em menos de 0,5 s quem é aliado, quem é inimigo e o que está atirando em mim?" |
| 7 | **Switch desde o dia 1** | O código compartilhado é escrito para o alvo mais restrito; a web ganha extras por cima. | "Isso roda sem DOM, sem rede, em 720p, a 30 FPS com 4 telas?" Se não, fica atrás da interface de plataforma ou não entra. |

---

## 2. Plataformas e matriz de recursos

### 2.1 Perfis de plataforma

| | Web PC | Web celular | Switch (homebrew) |
|---|---|---|---|
| **Papel** | Plataforma principal; o MVP é pensado aqui. | Funciona desde o M2 e é refinado depois [DECIDIDO #26]. | Produzido no M4, projetado desde o M0 [DECIDIDO #1]. |
| **Entrada** | Teclado + mouse (pointer lock) e controles. | Toque (joystick que nasce onde o dedo toca); controle; giroscópio opcional e desligado. | Controle completo por jogador: par de Joy-Con ou Pro Controller. Joy-Con sozinho não é suportado [DECIDIDO #32]. |
| **Tela dividida** | Até 4, com controles; teclado+mouse = 1 slot [DECIDIDO #24]. | Não (1 vista) [PADRÃO]. | Até 4. |
| **Online** | P2P até 4 humanos (M5). | P2P até 4 humanos (M5); host com teto de bots menor. | Nunca: 100% offline, sem nenhum byte de rede no build. |
| **Teto de bots armados** [PADRÃO] | 40 (24 em tela dividida 3–4P) | 12 (8 se for host online) | solo (1P) 24 · 2P 16 · 3–4P 12 armados ou 24 zumbis |
| **Teto de visão** [PADRÃO] | 140 m | 90 m | 1P 90 m · 2P 70 m · 3–4P 50 m |
| **Resolução e AA** [PADRÃO] | DPR até 2, antialias nativo, escala dinâmica. | DPR 1–1,5, sem AA, escala dinâmica. | 720p fixo, sem AA, até o Teste Zero aprovar algo melhor. |
| **Meta de FPS** | 60 | 30 estável (limitador 30/60) | 30 mínimo com 4 jogadores |
| **Save** [PADRÃO] | `localStorage` + `storage.persist()` + backup em arquivo. | Igual; no iOS, dica de "Adicionar à Tela de Início". | JSON no SD (`sdmc:/switch/boboforces/`) com backup. |
| **Distribuição** | GitHub Pages, `erereck.github.io/boboforces` [DECIDIDO #40]. | Só navegador, sem APK [DECIDIDO #37]. | NRO/NSP gerados só na máquina do Erick; nada publicado [DECIDIDO #33]. |
| **Diagnóstico** [DECIDIDO #42] | Botão "Copiar relatório". | Botão "Copiar relatório". | `runtime.log` no SD. |

- **Capacidade do motor: 64 bots.** Os tetos começam conservadores e **sobem com as medições** do Teste Zero e dos marcos seguintes, registradas em `docs/PERF.md`.
- **Bobo Royale Mini = 24 participantes** em todas as plataformas [DECIDIDO #35]. Passa do teto do celular e do Switch 2P+; ver Pendências (9.1).
- **Zumbis simultâneos** [PADRÃO]: PC 60 (40 em 3–4P), celular 24 (16 se for host), Switch 1P 30, 2P 24, 3–4P 24. Zumbi é mais barato que soldado (N0, flow field compartilhado, sem cobertura).
- **Alcance de visão é regra da partida**, igual para humanos e bots; o perfil só define o teto. Mapas declaram a maior linha de visão. No online vale o menor teto entre os participantes [PADRÃO].
- **Navegador mínimo:** WebGL2 + ES2022; abaixo disso, página de aviso amigável [PADRÃO].

### 2.2 Formas de jogar (marco em que chegam)

| Forma de jogar | Web PC | Web celular | Switch |
|---|---|---|---|
| Solo contra bots | M2 | M2 | M4 |
| Local 2–4 em tela dividida | M3 | não | M4 |
| Online P2P (2–4 humanos + bots) | M5 | M5 | nunca |
| Assistir só bots e entrar no meio (Aquário) | M6+ | M6+ | M6+ |
| Online + jogadores locais no mesmo aparelho | depois da v1 do online | — | — |

---

## 3. Experiência do jogador

### 3.1 O primeiro minuto (onboarding opcional) [PADRÃO]
Nenhuma etapa é obrigatória: todas têm "Pular" ou somem sozinhas.

| Momento | O que acontece |
|---|---|
| Abrir pela 1ª vez | O **primeiro input** (mouse/teclado, toque ou controle) define layout de controles, glifos, assistência de mira (mouse: Desligada; controle e toque: Média) e o texto das dicas. Celular em retrato: aviso "Gire o celular". |
| JOGAR (1 interação) | **Partida de estreia:** Bobo Warfare TDM no Construto, 4v4 (você + 3 bots aliados contra 4 bots), todos em **De boa**, 5 min ou 30 kills. |
| Contagem da 1ª partida | **Calibrar a mira em ~10 s:** 3 alvos aparecem; o jogo mede se você passa do alvo ou não chega, sugere a sensibilidade e mostra "Ajustei sua mira" com "Desfazer". "Pular" sempre visível; dá para refazer em Ajustes e no Bobo Training. |
| Celular, 1ª vez | 3 s de "fantasma" dos dedos mostrando as zonas: metade esquerda move, metade direita mira, botão ATIRAR. |
| Primeiras 2 partidas | **Dicas de 1 linha** com o glifo do dispositivo ativo, no contexto, cada uma no máximo 1 vez e sem pausar: "Shift corre", "C agacha; correndo, desliza", "Botão direito mira com zoom", "R recarrega". Desligáveis em Ajustes. |
| Fim da 1ª partida | Resultado normal + card opcional **"Conheça o Laboratório"**: Jorge the Immortal com os 4 eixos e o botão **Testar**. "Agora não" fecha e não volta. |
| Troca de dispositivo | Glifos e dicas mudam na hora (ex.: controle conectado no meio). |
| Switch | O lobby "aperte A" já é a tela inicial; calibração e dicas são por slot; a 1ª partida mostra "Segure A para entrar no meio" para os controles livres. |

### 3.2 JOGAR, Partida Rápida e Partida personalizada
- **Tela de título:** [JOGAR] (mostra o último preset) · [Surpreenda-me] · [Mudar].
- **JOGAR** repete o último preset em 1 interação. Na primeira vez, é a partida de estreia (3.1).
- **Partida Rápida:** modo, mapa, nível (Pela vibe → Tryhard) e quantidade de bots, cada um já com padrão.
- **Partida personalizada:** abas Partida, Jogadores, Armas, Bots, Modificadores e Tela (catálogo em 4.5).
- **Laboratório:** um bot por vez, nos 4 eixos (4.4).
- O botão COMEÇAR fica fixo no canto em todas as camadas.

| Situação | Interações até o primeiro tiro |
|---|---|
| Web, quem volta | **1** (JOGAR = último preset) |
| Web, primeira vez | **1** (partida de estreia) |
| Web, outro modo | **até 3** (Mudar → card do modo → COMEÇAR) |
| Surpreenda-me | **2** (botão → Jogar) |
| Revanche | **1** (De novo) |
| Switch | **2** (A no lobby → + para começar) |

### 3.3 Surpreenda-me (M2 simples, cresce depois)
- **Sorteia:** um modo compatível com a plataforma e o número de humanos (no M2: TDM ou FFA), um mapa compatível, armas (livre, fixa ou aleatória), 0 a 1 modificador no M2 (até 3 depois) e os inimigos (um nível rápido mais 0 a 2 bots "estrela" com personalidade forte).
- **Card:** uma linha por item, com "Rolar de novo" (infinito) e **Jogar**. No M6+: cadeado por linha (trava e sorteia só o resto) e seed compartilhável como código.
- No local quem sorteia é o P1; no online, o host. Cada modo novo entra no sorteio quando é lançado.

### 3.4 Fluxo de menus (web)
```
Casca HTML (logo + barra de progresso) → TÍTULO
TÍTULO: [JOGAR] (último preset) · [Surpreenda-me] · [Mudar]
  ├─ JOGAR → Carregando → PARTIDA        (o clique destrava o áudio e pede o pointer lock)
  ├─ Surpreenda-me → card do sorteio (Rolar de novo · Jogar) → PARTIDA
  └─ Mudar → MENU PRINCIPAL
MENU PRINCIPAL: Partida Rápida · Modos · Laboratório · Meu Bobo · Ajustes · Novidades
                (+ Online no M5 · + Aquário no M6+)
  Partida Rápida → modo, mapa, nível, bots → COMEÇAR
  Modos → grade de cards (ícone + até 7 palavras) → Configurar partida (Rápido › Avançado › Bots) → COMEÇAR
  Laboratório → Oficina (biblioteca de bots) → editor (4 eixos + visual) → Testar (Bobo Training) · Salvar
  Meu Bobo → customização do personagem
  Ajustes → controles, vídeo, áudio, acessibilidade · Dados (exportar/importar backup) · Sobre (Copiar relatório, Créditos)
  Online (M5) → Criar sala | Entrar com código | Abrir link → LOBBY DA SALA
PARTIDA → Pausa: Continuar · Ajustar desafio · Ajustes · Destravar · Sair
        → RESULTADO: De novo · Mais fácil · Mais difícil · Mudar regras · Salvar preset · Sair
```
- Cada item só aparece quando o marco dele chega; nada de botão "em breve".
- Toda tela funciona com controle, mouse e toque. Nenhum campo de texto é obrigatório: nomes saem de um gerador.
- A **tela de Novidades** (como no futbobo) mostra o codinome da versão e até 5 itens de 1 linha, uma vez depois de atualizar. O service worker só aplica atualização no menu [PADRÃO].

### 3.5 Durante e depois da partida
- **Contagem de 3 s** com a câmera mostrando o mapa e os inimigos ("Hoje: 6 Jorges").
- **Pausa** (offline): Continuar · Ajustar desafio (muda o nível dos bots no meio) · Ajustes · Destravar · Sair. Solo e local pausam a simulação de verdade; no local, qualquer jogador pausa para todos. No online PvP não há pausa; no coop, só o host pausa e ajusta o desafio.
- **Morte:** câmera de 1,5 s em quem te matou, com nome, arma e HP restante ("Jorge the Immortal · Door Knocker · 340 HP"). O bobo se desmonta em cubinhos e confete. A primária do próximo spawn é escolhida num menu radial na tela de morte. Respawn padrão de 3 s.
- **Resultado** (lido em até 10 s): vencedor e placar; **MVP** (humano ou bot); **Nêmesis** (o bot que mais te matou, com "Salvar na Oficina"); **Freguês** (quem você mais matou); 3 números pessoais (kills, precisão, maior sequência); até 3 **prêmios bobos** ("Mais covarde", "Mira torta"), que no online zoam só bots.
- **Botões:** De novo (mesma configuração, nova seed; foco padrão) · Mais fácil / Mais difícil (anda 1 nível e já reinicia) · Mudar regras · Salvar preset · Sair. No Tryhard, "Mais difícil" vira "Abrir Laboratório"; no Pela vibe, "Mais fácil" oferece "alvos maiores" e +1 aliado.

### 3.6 Entrar no sofá (M3 na web, M4 no Switch; mesmo código)
- **Lobby "Aperte A para entrar"** (até 4). Teclado e mouse contam como 1 slot. Cada dispositivo vira um slot com perfil próprio (nome, cor, sensibilidade, assistência, inverter Y, botões).
- O **P1** escolhe o preset ou o modo; os outros escolhem time e perfil; Start/+ inicia. Mesmo time = coop contra bots; times opostos = versus.
- **Entrar no meio:** segurar A por 1 s num controle livre. O jogador entra no time com menos humanos, assume um bot e a tela se redivide.
- **Layouts:** 1 = tela cheia; 2 = horizontal, cima e baixo (vertical como opção); 3 = 2×2 com o 4º quadrante mostrando placar e minimapa; 4 = 2×2.
- **Identificação:** cada vista tem borda e anel no chão na cor do jogador (P1 ▲, P2 ●, P3 ■, P4 ◆).
- **Sair:** pausa → Sair; um bot assume o lugar. Controle desconectado pausa a partida e o slot fica reservado.
- **Áudio no sofá:** cada som usa o ouvinte local mais próximo; opção de saída mono; volume "meus sons" por jogador; indicador visual de som e vibração por controle.
- **Switch, "LOCAL EDITION":** abre direto no lobby, sem tela de título. Mostra a última partida ("Bobo Zombies · Base Abandonada · Noite · Suado") e os atalhos COMEÇAR, Modos e Surpreenda-me. Só o P1 navega nos menus globais; B tira o jogador do slot. **+** pausa todo mundo; sai-se só por "Sair do jogo". Trocar dock/portátil, desconectar controle ou voltar do HOME pausa e reabre a tela "aperte A" [PADRÃO].

### 3.7 Entrar online (M5, só web)
1. O host cria a sala e recebe um código de 5 caracteres e um link (`#sala=XXXXX`; o hash não chega a servidor nenhum).
2. Os convidados entram no lobby. Na primeira vez, aparece um aviso curto de privacidade: a conexão é direta e os amigos podem ver o IP.
3. O host configura; todos veem a configuração, inclusive câmera permitida, assistência de mira e alcance de visão.
4. Cada um escolhe time e loadout; o visual do bobo vai junto.
5. O host inicia.

**Controles do host** [PADRÃO]: expulsar (não volta naquela sala); travar a sala; mudar regras só entre partidas; pausar só no coop; definir bots (quantidade, nível, "bot assume quem sai"). **AFK:** 60 s sem input, um bot assume a vaga até o jogador voltar. **Comunicação:** só pings e emotes, sem chat de texto livre.

**Quedas:** convidado que cai vira bot e, se voltar, assume um bot do time. Host em segundo plano: o coop pausa para todos; o PvP encerra depois de 10 s, com o resultado parcial. Host saiu = fim da partida (sem migração de host na v1). Host no celular: teto de 8 bots e aviso "não troque de app durante a partida".

### 3.8 Anti-frustração [PADRÃO]
Toda partida tem saída para os travamentos comuns, sem precisar sair e voltar.

| Problema | Regra |
|---|---|
| Cair abaixo do mapa | Plano de morte 10 m abaixo do ponto mais baixo. Se alguém causou dano nos últimos 5 s, a kill é dele; senão é "acidente" e não conta para ninguém. Vale para bots e zumbis. |
| Sair do mapa | Parede invisível no limite, marcada com faixa listrada. |
| Preso no cenário | **Destravar** na pausa leva ao nó de navegação livre mais próximo. Se a colisão detectar o bobo dentro de um bloco, empurra para fora sozinha. |
| Bot ou zumbi parado | 8 s sem progresso na rota: teleporte ao nó mais próximo, fora da vista dos humanos; na 3ª vez, respawn. O F2 registra o ponto para corrigir o mapa. |
| Último zumbi | Quando sobra 1 (ou até 3 por mais de 30 s), eles correm até o humano mais próximo e ganham marcador através de paredes. |
| BoboStrike sem plantar | Rounds de 1:45; com 30 s restantes, bots atacantes vão direto ao site mais próximo; Boom Box largada ganha marcador. |
| Partida sem fim | Todo modo tem tempo limite padrão; Bobo Zombies Infinito só por escolha explícita. |
| Derrota feia (offline) | Depois de 5 mortes seguidas sem kill, ou perdendo por 50% ou mais na metade do tempo: 1 linha na tela de morte, "Tá puxado? Pausa → Ajustar desafio" (1 vez por partida, desligável). No resultado, o foco vai para **Mais fácil**. Não aparece no online. |
| Spawn kill | Proteção de 1,5 s (ou até atirar) e spawn pontuado. |
| Saída sem querer (web) | Pausa automática quando o pointer lock cai ou a aba some; confirmação antes de fechar a aba no meio da partida. |

---

## 4. Tudo o que o jogo vai ter

### 4.1 Modos

#### 4.1.1 Modo é dado, não código novo
**Modo = Objetivo + Times + Spawns + Economia + Loadout + Regras padrão + Requisitos de mapa + Suporte de IA.** Variantes e modos de festa são presets sobre esses blocos e ficam baratos depois que o Bobo Warfare existe. Todo modo declara `minHumans: 0`, ou seja, roda só com bots.

**Nomes** [DECIDIDO #15]: Bobo Warfare (TDM, FFA, Domination), BoboStrike, Bobo Royale, Bobo Paintball, Bobo Zombies, Bobo Sandbox, Bobo Juggernaut, Bobo Chaos, Bobo Training. Na UI em pt-BR: Surpreenda-me, Partida Rápida, Laboratório, Aquário.

#### 4.1.2 Catálogo de modos

| Modo (ID) | Regras resumidas | Humanos e bots | Marco |
|---|---|---|---|
| **Bobo Warfare TDM** (`warfare.tdm`) | 2 times; vence quem chegar a 75 kills ou tiver mais ao fim de 10 min; empate leva a 60 s de morte súbita. Respawn de 3 s; regeneração após 5 s; caixinha de munição de quem morre. | De 1v1 a 20v20, dentro do teto. Padrão: 6v6 no PC, 4v4 no celular, 4 humanos + 12 bots no Switch local. Até 4 humanos locais ou online; bots completam. Presets "4 vs 40" (coop online, host PC) e "2v2 + bots" (8 bots por time). | M2 |
| **Bobo Warfare FFA** (`warfare.ffa`) | Todos contra todos, 8 participantes; 30 kills ou mais kills em 8 min; spawn pontuado. Presets **X1 Sniper** (só Peekaboo, arena pequena, 15 kills) e **X1 livre**. | 1 a 4 humanos + bots | M2 |
| **Bobo Training** (`training`) | Arena pequena com alvos fixos e móveis e bots do Laboratório em loop (1 a N). Mostra precisão, TTK médio e % de cabeça; sem placar. Estação "Calibrar mira". É onde o **Testar** do Laboratório cai, em até 2 s. | 1 humano | M2 |
| **Surpreenda-me** | Sorteio de modo, mapa, armas, modificadores e inimigos (3.3). | conforme o modo sorteado | M2 (simples) |
| **Bobo Zombies** (`zombies`) | Estilo CoD Zombies [DECIDIDO #30]: ondas, pontos por acerto, armas na parede, portas que abrem áreas, Caixa Misteriosa, vantagens, barricadas, caído e reviver, chefões. Durações Relâmpago (5 ondas), **Curta (10, padrão, 12–15 min)** e Infinita. Detalhes em 4.1.5. | 1–4 humanos; bots Suporte completam até 4 | M3 |
| **Bobo Warfare Domination** (`warfare.domination`) | 3 pontos (A, B, C); captura em 5 s com 1 jogador, até 2,5 s com 3+; cada ponto rende 1 ponto/s; vence quem chegar a 200 ou ao fim de 10 min. O Construto já vem com os pontos marcados desde o M2. | times + bots | M6+ |
| **BoboStrike** (`strike`) | Bomba estilo CS: Atacantes e Defensores, 5v5, rounds de 1:45, **Boom Box** (explosivo de brinquedo) explode 40 s depois de plantada, desarme em 7 s (5 s com kit), 15 s de compra, **MR12** (troca no round 6, vence quem fizer 7), sem respawn no round. Economia simplificada em faixas fixas [PADRÃO]. Mapa com 2 sites e 3 rotas. | 5v5 com bots | M6+ |
| **Bobo Paintball** (`paintball`) | Times; 1 tiro mata (configurável 1–3); respawn de 1 s; 50 kills ou 5 min. Marcadores de tinta com projétil visível; manchas em decal, com teto; o cenário não muda [PADRÃO]. O modo mais "pra todo mundo". | times + bots | M6+ |
| **Bobo Juggernaut** (`juggernaut`) | O Jugg tem HP de 300 × oponentes (mínimo 1000), headshot sem multiplicador, minigun **Big Brrt**, velocidade 0,75x e aparece sempre no radar. Variante **Fixo** (rodadas de 3 min, rodízio, o "1 vs 3" do sofá) e **Rodízio** (quem dá o golpe final vira o Jugg; 150 pontos). | 1 contra N | M6+ |
| **Bobo Sandbox completo** (`sandbox`) | Até 4 times com nome, cor, bots, armas e HP; objetivo de eliminação, pontos ou nenhum ("brinquedo"); jogar ou assistir; salvar como Cenário. **Ferramentas do Dono** (estilo gmod): criar bot onde mira, congelar IA, trocar time, dar arma, mudar regra ao vivo, câmera lenta (só offline). No M2 a Partida personalizada já cobre 2 times com regras próprias. | qualquer; no online só o host usa as ferramentas | M6+ |
| **Bobo Chaos** (`chaos`) | Preset com 3 modificadores (lista em 4.5.3); a **Roleta** troca 1 deles a cada 60 s, com aviso 5 s antes. O sorteio evita combinações que quebram a partida. | qualquer | M6+ |
| **Bobo Royale Mini** (`royale.mini`) | **24 participantes** [DECIDIDO #35], mapa de ~200 × 200 m, 8–10 min. Loot no chão (3 raridades que melhoram recoil e pente, **sem aumentar dano**), coletes 50/100, kits; zona em 5 fases (2/5/10/20/40 HP/s); solo, duplas e quartetos (em grupo dá para reviver). | até 4 humanos + bots | M6+ |
| **Bobo Royale Grande** | Só PC, depois do Mini; alvo inicial de 48 participantes em ~400 m, só se o teto do PC subir. | até 4 humanos + bots | depois do Mini |
| **Gun Game** (preset) | Escada de armas; a última é a faca; morrer pela faca rebaixa 1 nível. Com o arsenal do M2, 7 níveis. | FFA | M6+ |
| **Infection** (preset) | 1 infectado no começo; quem morre vira bobo-zumbi; os sobreviventes vencem se aguentarem 3 min. | qualquer | M6+ |
| **Bobo Zombies: Armed Horde** | Ondas de bots soldados, com a IA do Bobo Warfare. | coop | M6+ |
| **Bobo Zombies: Fortress** | Defender um gerador ou base com HP (entidade, não cenário). | coop | M6+ |
| **Bobo War Sim** (backlog, sem compromisso; nome provisório [PADRÃO]) | 2 a 6 facções de bots (esquadrões da Oficina), cada uma com uma doutrina, disputando território num mapa grande. Você assiste ou entra. | assistir ou entrar | backlog |

#### 4.1.3 Matriz de disponibilidade
Cada célula diz **em que marco** a combinação passa a existir. "Local web" = tela dividida no PC com controles. M0 e M1 não têm modo para o jogador, só a cena do Construto com bots. No Switch, cada modo M6+ entra quando couber no orçamento.

| Modo | Solo web | Local web (2–4) | Online P2P (até 4) | Switch solo | Switch local (2–4) | Complexidade |
|---|---|---|---|---|---|---|
| Bobo Warfare TDM | M2 | M3 | M5 | M4 | M4 | P |
| Bobo Warfare FFA (inclui X1) | M2 | M3 | M5 | M4 | M4 | P |
| Bobo Training | M2 | não | não | M4 | não | P |
| Surpreenda-me | M2 (simples) | M3 | M5 (host sorteia) | M4 | M4 | P |
| Bobo Zombies (clássico) | M3 | M3 | M5 (coop) | M4 | M4 (modo principal) | G |
| Bobo Warfare Domination | M6+ | M6+ | M6+ | M6+ | M6+ | M |
| Bobo Juggernaut | M6+ | M6+ | M6+ | M6+ | M6+ | P |
| BoboStrike | M6+ | M6+ | M6+ | M6+ | M6+ | G |
| Bobo Paintball | M6+ | M6+ | M6+ | M6+ | M6+ | M |
| Bobo Chaos (Roleta) | M6+ | M6+ | M6+ | M6+ | M6+ | P |
| Gun Game e Infection (presets) | M6+ | M6+ | M6+ | M6+ | M6+ | P |
| Bobo Zombies: Armed Horde / Fortress | M6+ | M6+ | M6+ | M6+ | M6+ | P / M |
| Bobo Sandbox completo | M6+ | M6+ | M6+ (só o host usa as ferramentas) | M6+ | M6+ | M |
| Aquário (espectador) | M6+ | M6+ | M6+ (espectador, 1x) | M6+ | M6+ | M |
| Bobo Royale Mini (24) | M6+ | M6+ (até 2, a validar) | M6+ | M6+ (a validar) | a validar | GG |
| Bobo Royale Grande | depois do Mini, só PC | não | só com host PC | não | não | GG |

Complexidade: **P** = só regras e dados sobre sistemas que já existem; **M** = 1 sistema novo; **G** = vários sistemas + IA de objetivo nova; **GG** = mapa ou tecnologia nova + vários sistemas.

#### 4.1.4 Regra de ouro
> **Todo modo é jogável sozinho com bots, roda em tela dividida local e vai para o online quando faz sentido.**

Nenhum modo é lançado sem passar neste checklist:
1. Funciona com 1 humano, e **os bots jogam o objetivo** (plantam, capturam, revivem, consertam barricada), não só matam.
2. Declara `maxLocal` (até 4), e o HUD do modo cabe numa vista de 640×360.
3. Declara `p2p: sim / não / máx. N` (N ≤ 4). Se sim, o estado do objetivo é replicável e os bots rodam no host.
4. Declara limites por plataforma e cabe no orçamento do Switch (720p, 30 FPS com 4 jogadores), ou fica marcado `switch: não` com justificativa.
5. Humano que sai é substituído por um bot; humano que entra assume um bot.
6. Tem um preset padrão jogável em até 3 interações.
7. Tem saída para os travamentos da tabela 3.8.

#### 4.1.5 Bobo Zombies em detalhe (o modo-chave do sofá e do Switch)
- **Inimigos:** bobos-zumbi cartoon, curvados, esverdeados e engraçados [DECIDIDO #31]. Especiais (nomes provisórios): **Sprinter** (rápido, pouco HP), **Chonker** (explode em gosma verde de cubinhos, 40 de dano em 3 m), **Spitter** (projétil lento) e o chefão **Mega Bobo** a cada 5 ondas (3000 × humanos de HP, arranca barricadas inteiras).
- **Pontos:** acerto 10, kill 60, kill na cabeça 100, kill de faca 130, consertar tábua 10 (até 50 por onda).
- **Compras:** armas na parede (500–1500); portas e escombros que abrem áreas (750–1250); **Caixa Misteriosa** (950, arma aleatória, inclusive a arma maravilha, muda entre 3 posições); vantagens de 1500–3000: **Chonky Cola** (vida 150), **Speedy Soda** (recarga rápida), **Buddy Brew** (reviver rápido).
- **Ondas:** total = (6 + 4 × onda) × (1 + 0,5 × (humanos − 1)); simultâneos limitados pelo teto da plataforma; HP de 100 na onda 1, +60 por onda até a 10, depois ×1,1 por onda; andando até a onda 4, misto da 5 à 9, correndo da 10 em diante.
- **Barricadas:** janelas com 6 tábuas; o zumbi arranca 1 a cada 1,5 s; segurar o botão repõe. Tábuas e portas pagas são **entidades com estado**, não cenário.
- **Drops** (2% por kill, até 4 por onda): munição cheia, bomba, pontos em dobro (30 s), insta-kill (30 s), carpinteiro.
- **Caído e reviver:** 30 s no chão, rastejando a 1 m/s só com a pistola; reviver segurando 3 s; no solo, 3 "levanta sozinho" por partida (0 a infinito); o bot Suporte revive; todos caídos = derrota.
- **Configurável:** quantidade 0,5x–3x, velocidade, multiplicador de HP, especiais e chefões on/off, economia, "levanta sozinho".
- **Recorde:** onda máxima por mapa e configuração.

### 4.2 Corpo, movimento e combate

#### 4.2.1 Métricas do bobo (tabela única em config; manda sobre arte e técnica) [PADRÃO]

| Medida | Valor | Em blocos |
|---|---|---|
| Proporção | cabeçudo [DECIDIDO #18, #53] | — |
| Altura em pé | **1,75 m** (#55, o boneco do FutBobo, #56; era 1,625 m na #53 e 1,5 m antes) | 3½ (vão livre: 4) |
| Olho em pé | **1,55 m** (era 1,425 m e antes 1,3 m) | — |
| Agachado (altura / olho) | **0,95 m / 0,8 m** | ~2 |
| Cabeça | **~0,5 m** (cubo) | 1 |
| AABB de movimento | **0,6 × 1,75 × 0,6 m** (0,95 agachado) | — |
| Degrau automático | **0,5 m** | 1 |
| Pulo padrão (perfil Bobo) | **1,0 m** | 2 |
| Cobertura baixa (esconde agachado) | **1,0 m** | 2 |
| Cobertura alta (esconde em pé) | **≥ 1,75 m** (na prática 2,0 m na grade) | 4 |
| Porta | **1,0 × 2,0 m** | 2 × 4 |
| Corredor mínimo | 1,0 m (confortável 1,5–2,0 m) | 2 (3–4) |
| Pé-direito | mínimo 2,0 m; 3,0 m onde se espera pulo | 4; 6 |
| Queda sem dano | até 5 m | 10 |
| Skin | pixel-art pintada em **64×64 com camada externa** (chapéu, cabelo, roupa), na GPU a 32 px/m (#51) | — |

- **Hitboxes** = 12 caixas, uma por osso do boneco ("o que você vê é o que acerta"): cabeça 0,4375 m de lado com o multiplicador da arma; tronco 1,0x; braços e pernas 0,8x. O cabelo e os acessórios **não aumentam a hitbox**. Boneco do FutBobo de 1,75 m (4 cabeças: quadril 12 px + tronco 12 + cabeça 8, 1 px = 7/128 m); em pé, agachado e deslizando as hitboxes seguem a pose da tabela (`gameplay.md` 3.1).
- Escadas de blocos funcionam pelo degrau automático, com suavização de câmera; rampas de até 45° são andáveis.

#### 4.2.2 Movimentação: arcade configurável [DECIDIDO #8]
Um conjunto único de parâmetros; os perfis são presets e são **regra da partida**, iguais para todos (no online, o host escolhe).

| Parâmetro | Tático (estilo CS) | **Bobo (padrão)** | Arcade |
|---|---|---|---|
| Andar / correr | 4,0 / 5,5 m/s | 4,8 / 6,8 m/s | 5,5 / 8,0 m/s |
| Atira correndo | não | não (voltar a atirar leva 0,15 s) | sim, com spread de "no ar" |
| Pulo | 0,8 m | 1,0 m | 1,3 m + pulo duplo |
| Slide | não | sim (0,7 s, começa a 8 m/s, recarga de 1 s) | sim, mantém o momento |
| Bunny hop / wall jump | não | não | sim (+5% por pulo, teto 12 m/s) / sim |
| Escalar borda (mantle) | até 1,0 m | até 1,5 m | até 2,0 m |
| Dano de queda | sim | sim | não |

- Perfil **Personalizado:** velocidade 0,5–2x, gravidade 0,3–2x, pulo 0,5–3x, dano de queda on/off.
- **Marcos:** Bobo no M0 (a sim headless e o robô de balanceamento precisam dele), testado na cena do M1; Tático e Personalizado no M2; Arcade completo no M6+, junto com o Bobo Chaos [PADRÃO].
- **Todo mapa é 100% atravessável no perfil Tático;** atalhos de Bobo ou Arcade são bônus. A navegação dos bots lê os parâmetros do perfil ativo.
- **Spread por estado:** parado 1,0 · andando 1,5 · agachado 0,8 · no ar 2,5 · sprint não atira.

#### 4.2.3 Câmera e mira
- **1ª pessoa por padrão; 3ª pessoa opcional por jogador** [DECIDIDO #12]: câmera de ombro com troca de lado e colisão com o cenário. O tiro sai do olho do bobo, então a 3ª pessoa não atira por trás de parede. Regra "Câmera permitida": 1ª e 3ª (padrão) ou só 1ª. 1ª pessoa desde o M1; 3ª no M2 [PADRÃO].
- **ADS (zoom) em todas as armas** [DECIDIDO #11]: 0,2–0,35 s para entrar, movimento a 0,6x, spread 0,3x. A regra "ADS desligado" deixa tudo no quadril; a sniper perde o zoom.
- **FOV por jogador** [PADRÃO]: PC 70–110 (padrão 90); celular e Switch 70–100 (padrão 80).
- **Assistência de mira** (controle e toque): Desligada, Leve, Média ou Forte. É um sistema central, feito no M2 e reaproveitado no Switch, que não tem giroscópio. A regra da partida pode desligar; no online, o host decide e o lobby mostra.

#### 4.2.4 Vida, dano e respawn
- **HP 100.** Cabeça × multiplicador da arma; tronco 1,0x; membros 0,8x. Assistência conta com 25+ de dano nos últimos 10 s. Queda: 12 HP por metro acima de 5 m. Autodano de explosão 50%. Fogo amigo desligado por padrão.
- **Headshot** [PADRÃO]: padrão **1,5x**; sniper **2,0x**; escopeta **1,25x**. A cabeça do bobo é grande, por isso os multiplicadores são baixos. Calibrado pelo robô de balanceamento.

| | Bobo Warfare / Paintball | BoboStrike | Bobo Royale | Bobo Zombies |
|---|---|---|---|---|
| Regeneração | espera 5 s, depois 25 HP/s | não | não (kits) | espera 4 s, depois 20 HP/s |
| Colete | não | 50 ou 100, absorve 50% | 50/100 no chão | não |
| Respawn | 3 s (0–15 s) | não no round | não (em grupo: reviver) | caído → reviver; morto volta na onda seguinte |

- **Spawns:** TDM na zona do time, no ponto com menos inimigos à vista. FFA pontuado: sem linha de visão de inimigo e a mais de 20 m dele, escolhendo entre os 3 melhores.
- **Indicador direcional de dano sempre ligado;** nenhuma mecânica depende só de ouvir a direção.

### 4.3 Armas

#### 4.3.1 Princípios
- **Base real, nome e visual próprios** [DECIDIDO #10]: silhueta reconhecível, nenhuma marca ou nome comercial. Modelo de caixas com textura pixel-art [DECIDIDO #7].
- **Nomes em inglês bobo** [DECIDIDO #15]; a categoria aparece em pt-BR ("Rattler · Fuzil"). Os IDs internos nunca mudam.
- Cada arma tem 1 papel claro e 1 fraqueza clara. Humanos e bots usam as mesmas armas com os mesmos números. **Nenhuma arma entra sem o bot saber quando usá-la.**
- Balas são **hitscan** (DDA na grade + caixas das peças fora da grade + hitboxes); foguete, granada e tinta são projéteis. Recoil com padrão fixo aprendível + ruído pequeno.
- Troca de arma em 0,4 s. No Bobo Warfare você carrega primária, pistola, faca e 2 granadas. Munição: pente + 3 pentes de reserva.

#### 4.3.2 Arsenal do MVP (M2): 8 armas [PADRÃO]
Nomes provisórios para o Erick aprovar.

| Arma (ID) | Nome | Papel / fraqueza | Números-chave | Tiros p/ matar (corpo / cabeça) |
|---|---|---|---|---|
| Pistola (`pistol`) | **Pop Gun** | secundária confiável / dano baixo | 25 de dano, 1,5x, semi até 400/min, pente 12, 100% até 25 m | 4 / 3 |
| SMG (`smg`) | **Buzzer** | curta distância e mobilidade / perde dano longe | 20, 1,5x, 850/min, pente 30, 100% até 12 m | 5 / 4 |
| Fuzil (`rifle`) | **Rattler** | versátil, média distância / nada se destaca | 28, 1,5x, 600/min, pente 30, 100% até 35 m | 4 / 3 |
| Escopeta pump (`shotgun`) | **Door Knocker** | mata de perto / inútil a mais de 15 m | 8 chumbos × 14, 1,25x, 70/min, pente 6 | 1 de perto |
| Sniper de ferrolho (`sniper`) | **Peekaboo** | longa distância / lenta, fraca sem zoom | 95, 2,0x, 45/min, pente 5, zoom 4x, sem queda | 2 / 1 |
| Lança-foguetes (`rocket`) | **Kaboomer** | dano em área / lento, autodano | 120 direto, área 100 → 0 em 4 m, projétil a 35 m/s | 1 |
| Faca (`knife`) | **Butter Knife** | finalização / alcance de 2 m | 55 de frente, 100 pelas costas | 2 / 1 pelas costas |
| Granada (`grenade`) | **Pineapple** | tira da cobertura / 2 por vida | 110 no centro → 0 em 5 m, pavio 2,5 s, dá para cozinhar | — |
| LMG, reserva (`lmg`) | **Lawnmower** | supressão / lenta | 22, 1,5x, 700/min, pente 100 | 5 / 4 |

- **TTK sem errar no corpo:** fuzil 0,30 s (cabeça 0,20 s); SMG 0,28 s até 12 m; pistola 0,45 s. Meta das automáticas: 0,28–0,45 s.
- A sniper tira 95 no corpo de propósito, para não massacrar o jogador relax; a regra "Sniper mata no corpo" liga o contrário.
- Se o explosivo atrasar, a **LMG** entra no lugar e o lança-foguetes vai para o M6+.
- **Como o jogador consegue armas:** loadout livre por padrão (menu radial na tela de morte) [PADRÃO]; regras: fixo, aleatório por vida, pickups no mapa (M6+), escada (Gun Game, M6+).
- **Attachments** ficam fora do M2. Se entrarem, vêm como variantes simples, sem "gunsmith".

#### 4.3.3 Arsenal futuro (backlog M6+, sem compromisso)
- **Convencionais:** LMG (se não entrou no M2), DMR, revólver, escopeta automática.
- **Projéteis:** besta (o virote fica preso no bloco por alguns segundos) e lança-granadas.
- **Armas de modo:** minigun **Big Brrt** (Bobo Juggernaut: 15 de dano, 1200/min, pente infinito, superaquece após 6 s); marcadores de tinta automático, pump, sniper e granada-balde (Bobo Paintball); arma maravilha do Bobo Zombies (ex.: raio que desmonta o zumbi em cubinhos); arma de confete ou bolha (Bobo Chaos).
- **Corpo a corpo:** martelo e pá.
- **Equipamentos:** fumaça, flash, mina, torreta automática (Zombies), kit médico, escudo.

### 4.4 Laboratório de bots

#### 4.4.1 Quatro eixos independentes, mais o visual [DECIDIDO #29]
**Bot = Inteligência + Habilidade + Personalidade + Regras + Visual e nome.**

| Eixo | Pergunta | Conteúdo |
|---|---|---|
| Inteligência | o quanto ele pensa | níveis cumulativos N0–N4; no modo avançado, cada comportamento liga e desliga (cobertura, flanquear, recuar, granadas, comunicar, emboscar, aprender, jogar o objetivo) |
| Habilidade | o quanto ele acerta | reação (100–1200 ms), erro de mira (0,2°–10°), aquisição (0–1,5 s), giro (90–900 °/s), controle de recoil, preferência por cabeça, disciplina de tiro, movimento em combate, uso de granada, troca de alvo |
| Personalidade | o que ele prefere fazer | pesos de agressividade, cautela, paciência, lealdade, foco no alvo, mobilidade, distância preferida, apego ao objetivo e bobeira |
| Regras | que vantagem ou desvantagem ele tem | HP 1–1000, colete 0–200, dano 0,25x–5x, velocidade 0,5x–2x, tamanho 0,5x–3x, regeneração, munição, armas, visão (cone 60–360°; alcance acima do da partida é a vantagem explícita "Olho de águia"), audição 0–2x, conhecimento (normal / área aproximada / wallhack), vidas, imune a headshot, explode ao morrer, chefão |

- A personalidade só se expressa dentro do que a inteligência permite: um Estrategista no N0 é um bot burro que gosta de objetivo.
- **Toda regra ativa aparece** no card do bot, no placar e na tela de morte.
- **O erro é legível:** tracer e impacto mostram a bala passando perto, para o jogador entender que o bot é ruim e não que o jogo está bugado.

**Inteligência:**

| Nível | Nome | Faz |
|---|---|---|
| N0 | Zumbi | vai pela rota até o alvo mais próximo e atira quando vê; ignora cobertura |
| N1 | Básico | procura cobertura ao tomar dano, recarrega protegido, investiga sons, patrulha |
| N2 | Esperto | flanqueia, segura ângulos, recua com HP baixo, joga granada em cobertura, joga o objetivo |
| N3 | Time | compartilha o que viu (ícone de ping para humanos aliados), avança em dupla ou trio, embosca, faz cerco |
| N4 | Leitor | aprende seu padrão **na partida** (mapa de calor de onde você fica e de onde mata, memória de 2 min), evita rotas onde morreu, finge recuar |

**Personalidades:** Equilibrado (padrão) · Rusher (corre pro contato) · Lunático (troca de intenção a cada 2–5 s, atira pro alto) · Covarde (foge com HP < 60%, às vezes finge de morto) · Camper (escolhe um ponto e espera) · Estrategista (prioriza objetivo e flanco; precisa de N2+) · Kamikaze (menor caminho até você) · Caçador (persegue 1 alvo, por padrão o humano com mais kills) · Suporte (segue o humano aliado, cobre, revive, divide munição) · Palhaço (dancinha depois da kill).

**Percepção (padrão, alterável por Regras):** cone de 120°; alcance = alcance de visão da partida, o mesmo dos humanos; linha de visão 5–10 vezes por segundo, escalonada entre bots; vegetação alta corta pela metade a chance de detecção; audição de tiro a 50 m, passo correndo a 15 m, andando a 6 m, agachado 0. Sem uma Regra dizendo o contrário, o bot não vê através de parede.

#### 4.4.2 Dificuldade rápida: 5 níveis [DECIDIDO #21]

| Nível (ID) | Reação | Erro mín. | Giro | Recoil | Cabeça | Inteligência | Movimento em combate |
|---|---|---|---|---|---|---|---|
| **Pela vibe** (`vibe`) | 900 ms | 6° | 150°/s | 10% | 5% | N0 | parado |
| **De boa** (`chill`) | 650 ms | 3,5° | 220°/s | 30% | 10% | N1 | parado ou strafe leve |
| **Normal** (`normal`) | 450 ms | 2° | 320°/s | 50% | 20% | N2 | strafe |
| **Suado** (`sweaty`) | 300 ms | 1° | 500°/s | 75% | 40% | N3 | strafe + pulo/agacha |
| **Tryhard** (`tryhard`) | 180 ms | 0,4° | 800°/s | 95% | 65% | N4 | strafe + pulo/agacha |

- **Primeira partida em De boa**, em todas as plataformas.
- Nenhum nível tem vantagem de regra (HP, wallhack); quem quer mais que o Tryhard abre o Laboratório.
- Personalidade padrão dos níveis: mistura de 50% Equilibrado, 20% Rusher, 15% Camper, 15% Estrategista.
- O robô de balanceamento garante no CI a ordem Pela vibe < De boa < Normal < Suado < Tryhard.

#### 4.4.3 Laboratório, Oficina e bots de fábrica
- **Laboratório (M2):** os 5 níveis + sliders dos 4 eixos + salvar; edita um bot por vez. **Testar** abre o Bobo Training (1v1 ou 1vN) em até 2 s e, na volta, mostra precisão do bot, seu K/D e TTK médio.
- **Oficina (M2, local):** biblioteca de bots salvos (listar, duplicar, apagar, favoritar). Até 500 bots na web (teto técnico) e 100 no Switch. **Salvar o Nêmesis** direto do resultado.
- **Criar:** partir de um bot da biblioteca; nome por "rolar nome" (gerador em inglês bobo: "Private Pickles", "Sergeant Noodle") ou digitado; visual pelo mesmo sistema do bobo do jogador, mais arma favorita. Sem mexer no visual, a aparência sai do hash do nome ("Jorge the Immortal" é sempre o mesmo bigodudo).
- **Bots de fábrica** (nomes provisórios [PADRÃO]):

| Bot | Como é |
|---|---|
| Vibe Bob, Chill Bob, Normal Bob, Sweaty Bob, Tryhard Bob | os 5 níveis rápidos, prontos para usar e editar |
| Jorge the Immortal | 500 HP, Door Knocker, Kamikaze, N0, erro alto |
| Camper Carl | Peekaboo, Camper, N2 |
| Knife Ninja | só faca, velocidade 1,4x, Rusher |
| Scaredy Sam | Covarde, N2 |
| Hunter Hank | Caçador, N3 |
| Buddy | Suporte: segue, cobre e revive |
| Goofy Gus | Palhaço |

- **Oficina com códigos (M6+):** compartilhar bot por código `BF1-…` ou link `#bot=…` (4.8).
- **Esquadrões (M6+):** grupo nomeado de bots (ex.: "The Jorges", 6 bots), reaproveitável em presets; base do Bobo War Sim.
- **Nêmesis com memória entre partidas:** M6+.
- **Ordens para bots aliados (M6+):** roda com Vem comigo, Segura aqui, Ataca ali (ping) e Me cobre / Me revive. N0 e N1 ignoram; N2+ obedecem conforme a lealdade.

#### 4.4.4 Diretor de Partida (M6+)
Inspirado no "AI Director" do Left 4 Dead. **Desligado por padrão e sempre visível no placar quando ligado** [PADRÃO].
- **Objetivos:** Relax (K/D alvo dos humanos 2–3), Equilibrado (1–1,5), Desafio (0,7–1) ou Personalizado (precisão, inteligência tática, agressividade, 2 a 40 bots dentro do teto, faixa de ajuste).
- **Mede** numa janela de 3 min, amostrada a cada 10 s: K/D, tempo de vida, dano por encontro, sequências.
- **Ajusta só bots:** erro e reação, agressividade, bots ativos e ritmo de spawn, distância de spawn; no Zombies, ritmo da horda, especiais e drops.
- **Limites:** 1 ajuste a cada 30 s, de no máximo 1/4 de nível, dentro de ±1 nível do escolhido. Nunca mexe em inteligência, personalidade ou regras que o jogador definiu, e nunca dá wallhack. Ícone no placar: "Diretor: bots −½".

#### 4.4.5 Aquário (M6+)
- Qualquer modo começa com 0 humanos. Câmeras: livre, seguir bot, olhos do bot, visão tática de cima.
- Velocidade de 0,25x até 4x no PC e até 2x no celular e no Switch; no online, só 1x.
- Overlay de IA opcional: intenção em ícone ("flanqueando", "com medo"), linha de visão e rota.
- **Entrar:** assumir um bot (posição, HP e arma dele; o bot volta quando você sai) ou criar vaga num time. No local, cada controle assume um bot diferente.
- A câmera livre e o overlay existem desde o M1 como ferramenta de debug (F2). Replays são só ferramenta de debug [PADRÃO].

#### 4.4.6 LOD de IA e balanceamento
- **LOD:** A (engajado ou a até 25 m de um observador: decide a 10 Hz), B (25–60 m ou fora de vista: 4 Hz), C (acima de 60 m sem humano perto, no Royale: 1 Hz, combate bot × bot por probabilidade). Orçamento em unidades de trabalho por tick, nunca em ms, para manter o determinismo.
- **Robô de balanceamento** (como o `balance.mjs` do gamebobo): milhares de duelos bot × bot na sim headless, com seed fixa. Calibra TTK, multiplicadores de headshot e os níveis. Meta: "Normal" vence ~50% contra o bot "Humano de referência"; jogador médio com K/D entre 1,5 e 2 contra "De boa". Também mede mapa de calor de mortes, tempo até o contato e vantagem de spawn.

### 4.5 Regras de partida e modificadores

#### 4.5.1 Camadas
Da mais geral para a mais específica, cada uma sobrescreve a anterior: (1) padrão do modo → (2) preset → (3) time (ex.: time vermelho com 500 HP) → (4) bot individual → (5) Diretor (M6+, limitado, só bots). No fim, tudo passa pelo **clamp aos tetos da plataforma** (bots, visão), e a tela avisa o que foi cortado.

#### 4.5.2 Catálogo de regras (M2, salvo indicação)
- **Partida:** modo, mapa, tempo limite (off ou 3–30 min), meta (kills, pontos, ondas, rounds), número de times (2 no M2; até 4 no Bobo Sandbox), tamanho dos times, fogo amigo (off / 50% / 100%), morte súbita, **alcance de visão** (até o teto do perfil), variação de luz (Dia, Entardecer, Noite).
- **Jogadores:** HP (25–1000), regeneração, respawn (0–15 s ou nenhum), proteção de spawn, perfil de movimento, gravidade, dano de queda, "levanta sozinho", **câmera permitida** (1ª e 3ª / só 1ª), marcadores de inimigo (sempre / com visão / nunca).
- **Armas:** loadout (livre, fixo, aleatório), armas permitidas, munição (normal / reserva infinita / pente infinito), multiplicador de dano (0,25x–5x), só headshot conta, um tiro mata, ADS on/off, recoil on/off, spread on/off, autodano, hitmarker, "Sniper mata no corpo", assistência de mira permitida (padrão: sim, visível no lobby online).
- **Bots:** quantidade por time; nível rápido ou bots salvos; mistura por porcentagem (ex.: 70% Normal Bob e 30% Jorge); "bots completam times"; "bot assume quem sai"; Diretor no M6+.
- **Tela da partida:** radar, kill feed, nome sobre o inimigo, hitmarker.

#### 4.5.3 Modificadores
- **M2:** os modificadores de arma acima e a gravidade.
- **M6+:** Explosivos bobos (tudo que morre explode: 60 de dano em 3 m), velocidade de projétil 0,5x–2x e a lista do Bobo Chaos: gravidade lunar (0,35x) ou pesada (1,8x); Cabeção (cabeça e hitbox 2x); Mini (todos 0,5x); Tudo explode; troca de arma por kill; só headshot; um tiro mata; munição infinita sem recarga; velocidade 1,5x; Arcade (bhop, wall jump, pulo duplo); Vampiro (dano causado cura); Ricochete (1 vez); Invisíveis, exceto quando atiram; Bots gigantes (3x); Festa (confete em tudo).
- Todo modificador pode ser ligado em qualquer modo, não só no Bobo Chaos.

#### 4.5.4 Ajustes por jogador (não são regra da partida)
Sensibilidade separada para mouse, analógico, toque e giroscópio, com multiplicador no ADS; inverter Y; FOV; assistência de mira; atirar sozinho no toque; giroscópio no celular (desligado por padrão); segurar ou alternar para mirar, agachar e correr; **agachar no C** no teclado (nunca no Ctrl, por causa do Ctrl+W); tudo remapeável; câmera 1ª/3ª (se a regra permitir); **violência** cartunesca ou com sangue; mira (cor, forma, tamanho); tamanho e opacidade do HUD; vibração; modos daltônicos; reduzir tremor e efeitos; saída mono e indicador visual de som; esconder nomes alheios; dicas on/off. No local, cada jogador escolhe um perfil salvo com tudo isso.

### 4.6 Mapas

#### 4.6.1 Grade, peças e materiais [DECIDIDO #4, #5, #6, #7]
- **Grade de construção de 0,5 m.** Colisão (AABB + DDA) e navegação (grade 2,5D) usam a mesma grade.
- **Peças fora da grade** (rampas, cilindros, cercas, vegetação em cruz, props low-poly com textura pixel-art) entram quando forem mais leves ou mais bonitas. Cada peça declara colisão (caixa / rampa / nenhuma), se bloqueia bala, se bloqueia a visão dos bots (sim / parcial / não) e se é andável. A colisão usa sempre caixas e rampas simples, nunca a malha; cilindro vira caixa envolvente.
- **Materiais:** bloco sólido bloqueia tudo; cerca de arame bloqueia movimento mas deixa passar bala e visão; cerca de madeira fechada bloqueia tudo; vegetação baixa não bloqueia nada; vegetação alta (cruz) só atrapalha a detecção; escada de mão é escalável a 3 m/s. Sem penetração de bala no M2, e mapas do M2 não usam vidro nem água (a bancada de materiais da cena-vitrine fica fora da área jogável, 5.8).
- **Cenário estático:** nada é destruído. Tiros e explosões soltam cubinhos cosméticos e deixam marcas temporárias. As exceções são **entidades**, não cenário: tábuas das barricadas, portas pagas do Zombies e o gerador do Fortress.

#### 4.6.2 Classes de tamanho

| Classe | Área jogável | Em blocos | Participantes ideais | Uso |
|---|---|---|---|---|
| Arena pequena | 30×30 a 40×40 m | 60–80 | 2–6 | X1, 2v2, Bobo Training, Juggernaut 1v3 |
| Média | 60×60 a 90×90 m | 120–180 | 8–16 | TDM, FFA, Domination, Paintball, BoboStrike |
| Grande | 100×100 a 160×160 m | 200–320 | 16–40 | Bobo Zombies, TDM grande, Fortress |
| Royale Mini | ~200×200 m | ~400 | 24 | Bobo Royale Mini |
| Royale Grande | a medir (só PC) | — | alvo 48 | Bobo Royale Grande |

Até 3 níveis (chão, 1º andar, telhado), andares de 3 m, altura total de 10 a 16 m.

#### 4.6.3 Regras de layout (mapas médios)
- 3 rotas principais; cobertura a cada 8–12 m, misturando baixa (1,0 m) e alta (≥ 1,75 m); no máximo 1 ou 2 corredores longos para a sniper existir sem dominar.
- **Todo mapa declara a maior linha de visão.** Mapas que rodam no Switch 3–4P (todos os do M2 e do M3) ficam em até **50 m**; mapas só de PC podem ir até 140 m.
- Spawns: TDM com pelo menos 6 por time; FFA com pelo menos 16; nenhum spawn visível de um spawn inimigo. Travessia de spawn a spawn: 12–18 s correndo.
- Toda área tem escada ou rampa; mantle só cria atalho.
- Pontos de interesse (ponto de Domination, site, caixa misteriosa, arma na parede, barricada) levam emissivo e ícone, nunca só cor.
- O arquivo do mapa traz: spawns, objetivos, nós de IA (cobertura, sniper, emboscada, patrulha), navegação pré-calculada, plano de morte e limites, câmeras do Aquário, `modes`, `players { min, ideal, max }`, maior linha de visão e teto de bots por plataforma.

#### 4.6.4 Lista de mapas
Todos genéricos, sem nacionalidade e dentro da diretriz de conteúdo [DECIDIDO #19]. Nomes provisórios, exceto o Construto.

| Mapa | Classe | Modos | Marco |
|---|---|---|---|
| **Construto**: sala de teste gigante, homenagem ao gmod sem copiar o mapa. Área jogável de ~72×72 m e até 12 m de altura, numa grade de 80×80×24 m (com a borda); 3 níveis, chão de placas de teste com a grade pintada, paredes com réguas de medida, prédios de teste, galpão, torre de 8 m, passarelas de grade, borda de grama e mato, props militares genéricos. Maior linha de visão: 50 m. Pontos de Domination já marcados. | média | TDM, FFA (Domination no M6+); cena-vitrine e Teste Zero | M1 / M2 [DECIDIDO #20] |
| **Ringue**: arena pequena de treino com alvos e estandes, mesmo kit do Construto. | pequena | X1, Bobo Training, Testar | M2 [PADRÃO] |
| **Base Abandonada** (noite): base militar cartunesca com janelas para barricar e áreas que abrem por portas pagas; holofotes varrendo a cerca. | grande | Bobo Zombies | M3 [PADRÃO] |
| Base Bobo: base militar cartunesca diurna com hangar; 2 sites | média | BoboStrike, TDM | M6+ |
| Porto de Contêineres: verticalidade e corredores | média | TDM, FFA, Domination | M6+ |
| Galpão de Paintball: interior colorido com infláveis | média | Bobo Paintball | M6+ |
| Canteiro de Obras: andaimes, guindaste, vigas | média | TDM, FFA | M6+ |
| Estação Lunar: gravidade baixa de série, neon | média | Bobo Chaos | M6+ |
| Fazenda à noite | grande | Bobo Zombies, Fortress | M6+ |
| Ilha Tropical: praia, vila genérica, morro, farol | Royale Mini | Bobo Royale Mini | M6+ |

**Por marco:** M1 Construto · M2 + Ringue · M3 + Base Abandonada · M4 os 3 no Switch · M5 nenhum novo obrigatório · M6+ um mapa por modo novo + extras.

#### 4.6.5 Editor de mapas: só interno [DECIDIDO #13, #36]
O Claude gera blocos, texturas e peças por script; mapas são scripts TS com uma API de construção (`box`, `ramp`, `fence`, `prop`, `spawn`, `door`…) compilados para um formato próprio em RLE + deflate. Um visualizador/editor no navegador ajusta marcadores, nós de IA e câmeras, só em desenvolvimento. O Erick aprova por prints. Online, todos jogam com os mapas do próprio build; nunca se recebem mapas de outros jogadores.

#### 4.6.6 Diretriz de conteúdo sensível [PADRÃO]
Vale para mapas, armas, nomes, textos e skins.
- **Nada de:** lugares reais, escolas, hospitais, templos, prédios de governo reais; bandeiras, exércitos, uniformes ou insígnias reais; símbolos políticos, religiosos ou de ódio; marcas reais (inclusive de armas); o emblema da Cruz Vermelha; civis como alvo; drogas, álcool, conteúdo sexual; guerras e atentados reais.
- Times e facções usam só cor e ícone geométrico (▲ ● ■ ◆). No BoboStrike, Atacantes e Defensores sem identidade real; a bomba é a Boom Box de brinquedo.
- Violência cartunesca por padrão; sangue só por opção, em cubinhos, sem desmembramento além do "desmontar". Zumbis cartoon, sem horror gráfico.
- Texto "bobo, nunca maldoso": mensagens de morte curtas ("Jorge te bobou"); zoeira só com bots.
- Skins por catálogo fechado de peças; sem upload de imagem.

### 4.7 Personagens e customização

#### 4.7.1 O bobo
- **Cabeçudo, 1,75 m (#55), o boneco do FutBobo (#56): caixas rígidas com skin pixel-art pintada direto em 2 camadas 64×64** [DECIDIDO #7, #17, #18]. Doze ossos com uma caixa por osso (mais as mãos); cabelo, chapéu e acessórios são caixas extras na cabeça (antes, seis partes com camada externa meio pixel maior por lado).
- **Rosto e expressões:** o rosto é um quad instanciado de 8×8 px (a 7ª parte do bobo, fora da skin) lido de uma folha de rostos (8 estilos × 8 expressões: neutro, mirando, bravo, assustado, dor, comemorando, dormindo, morto). A expressão mostra a personalidade do bot sem texto: o covarde fica assustado ao recarregar, o camper aparece dormindo.
- **Animação procedural**, sem esqueleto: andar e correr por seno, deslizar, squash no pulo e no pouso, mirar girando tronco e braços, agachar (pose validada por print ao lado de uma cobertura de 1,0 m), recarregar com o pente saindo como peça, tranco e piscada ao levar dano, nascer com as partes caindo e se encaixando em 0,4 s, morrer se desmontando.

#### 4.7.2 Customização ("Meu Bobo"): tudo liberado [DECIDIDO #16, #17]

| Camada | Kit do MVP (proposta) |
|---|---|
| Skin pronta (atalho) | **Desde a #58 e a #62:** os 12 looks da farda (#59) mais algumas fantasias bobas como extras (ex.: astronauta, pijama, robô de papelão), com a lista final por print. A lista antiga (recruta, sargento, piloto, mecânico, socorrista sem cruz vermelha, cozinheiro de quartel, espião de terno, astronauta, apicultor, mergulhador, pijama, robô de papelão) fica como banco de ideias |
| Tom de pele | 8 tons + 4 cores fantasia (verde, azul, roxo, cinza-pedra) |
| Rosto | 8 estilos |
| Cabelo | 8 cortes, cor livre na rampa de cabelo |
| Chapéu | 8 de camada externa (boné, gorro, bandana, capacete justo…) + 4 acessórios 3D (capacete com viseira, chapéu de aba, boina alta, antena) |
| Roupa | 6 peças × padrão (liso, listras, xadrez, camuflado, bolinhas) × 2 cores |
| Costas (3D) | mochila, rádio, tanque de oxigênio, capa |

- **Time sempre legível:** em modos com time, o tronco ganha um **colete de time** (cor + ícone ▲ ● ■ ◆ no peito e nas costas), braçadeiras e faixa no chapéu; a customização nunca cobre essas zonas. Meta: a cor do time em pelo menos 35% da silhueta de frente. No FFA cada bobo usa as próprias cores e o marcador de inimigo resolve a leitura.
- **Legibilidade em tela pequena:** aliado com chevron e nome sempre visíveis; inimigo com chevron só com linha de visão (além de 35 m no 3–4P, vira um ponto de 6 px); plaquinha de humano (ícone de controle) ou bot (ícone de chip) com o ícone da personalidade.
- Bots usam o mesmo sistema. No online, cada jogador envia o próprio visual (IDs de peças e cor). Acessórios têm limite de volume para não esconder a cabeça.

#### 4.7.3 Bobos-zumbi [DECIDIDO #31]
Mesmo boneco, **curvados (tronco a 20°), braços à frente, esverdeados e engraçados**, nunca assustadores. Pele verde-acinzentada em rampa própria (fora das cores de time), roupas desbotadas com rasgos, **remendos e curativos coloridos** no lugar de feridas; rostos próprios (olho em espiral, língua de fora, boca de "uuuh"). Cinco tipos (comum + os 4 especiais de 4.1.5), com escala uniforme para o pixel continuar quadrado: comum, Sprinter (agasalho, curvado e rápido), Chonker (1,3x, capacete de obra), Spitter (skin e pose próprias, inclinado para trás ao cuspir), Mega Bobo (1,8x, plaquinha de "chefe").

### 4.8 Presets e códigos
- **Presets de fábrica** (~8, nomes provisórios): Vibe, Tryhard, X1 Sniper, 2v2 + bots, 4 vs 40, Sofá Zombies, Sexta do Jorge, Paintball Relâmpago. Cada um só aparece quando o modo dele existe.
- **Do jogador** [PADRÃO]: os **5 últimos** ficam salvos sozinhos (o último é o que o JOGAR usa); até **6 favoritos** viram atalhos no menu; até 200 presets salvos na web e 50 no Switch. Um preset guarda modo, mapa, variação de luz, regras, times e bots, condição de vitória e seed.
- **Formato** [PADRÃO]: JSON com chaves em inglês e textos em pt-BR, campo **`format: "boboforces/<tipo>@<n>"`** (`preset@1`, `bot@1`, `settings@1`, `stats@1`, `backup@1`, `replay@1`), validador e cadeia de migrações. Bots personalizados vão **embutidos** no preset, para quem recebe não precisar tê-los. Esquema único de `preset@1` e `bot@1` em `gameplay.md` 10.4 e 6.7: `viewDistanceM`, perfil de movimento `bobo`, refs `builtin:<id do bot de fábrica>` (ex.: `builtin:chill-bob`) ou `embedded:<id>`, e um `look` único `{ skin, skinTone, face, hair, hairColor, hat, hat3d, outfit, pattern, colors[2], back }` para bots e jogador.
- **Códigos e links (Oficina com códigos, M6+):** bot = código **`BF1-`** + base64url(deflate(JSON)) e link **`#bot=`**; preset = código **`BFP1-`** e link **`#p=`**. O hash do link não vai para servidor nenhum.
- **Antes dos códigos:** "Exportar/Importar backup" em arquivo na web (M2) e JSON na pasta do save no SD do Switch (M4, `sdmc:/switch/boboforces/oficina/`). O que foi criado no PC chega ao Switch pelo cartão SD.
- **Limites e moderação** [PADRÃO]: código até 4.000 caracteres; arquivo até 64 KB; até 16 bots embutidos por preset; nome de jogador até 16 caracteres, de bot e preset até 24; só os caracteres que a fonte do jogo tem; filtro simples local (pt-BR e inglês, sem acento, com troca de números por letras), e nome barrado vira nome do gerador; opção de esconder nomes alheios.
- **Compatibilidade** [PADRÃO]: campos desconhecidos são ignorados; versão maior é recusada com mensagem ("Atualize o jogo"); versão menor é migrada; conteúdo ausente cai em fallback (arma → padrão da categoria; acessório → padrão do slot; regra → ignorada com aviso; mapa ou modo ausente → preset recusado, oferecendo o Construto); **IDs de conteúdo nunca mudam** (`weapon:rifle`, `map:construto`, `mode:warfare.tdm`); o prefixo de tipo existe só no registro de IDs e nas mensagens, e o JSON guarda o ID sem prefixo (`"mode": "warfare.tdm"`). Todo import valida e faz clamp aos tetos da plataforma, e mostra um resumo do que caiu em fallback.

### 4.9 Estatísticas e recordes
Sem progressão: **nada libera nada** [DECIDIDO #16].
- Onda máxima no Bobo Zombies por mapa e configuração.
- Kills por arma, maior sequência, precisão média.
- Bot que mais te derrotou e bot que você mais derrotou.
- Melhor resultado em cada preset de fábrica do tipo desafio (ex.: "Sexta do Jorge").
- Horas jogadas.
- Fora, para sempre: moeda, loja, loot box, passe, XP, nível de perfil, anúncio.
- Ficam no save local (`stats@1`) e entram no backup.

---

## 5. Direção de arte e áudio (resumo)
Detalhe em [`design/arte-ux.md`](design/arte-ux.md).

### 5.1 Pilar visual
- **Blocado com pixel-art, na linha de Block Strike e Pixel Gun 3D** [DECIDIDO #5]: bonecos e armas de caixas com textura pixel-art, cenário de blocos texturizados, cores vivas, sol quente e AO suave. Tom de brinquedo tático. "Voxel" é referência de estilo, não limite: o Claude pode sair dele quando for mais otimizado ou mais bonito, registrando a escolha [DECIDIDO #45].
- **Pior caso que dimensiona tudo:** Switch na dock, 720p sem AA, 4 vistas de 640×360, 30 FPS, 12 bots armados ou 24 zumbis, visão de 50 m. PC e celular ganham mais detalhe pelo perfil de qualidade, nunca um visual diferente.
- **Regras:** primeiro legível, depois bonito; cenário até ~60% de saturação, com 75–100% reservados para times, inimigos, itens e VFX; o bobo com pelo menos 25% de diferença de luminância para o fundo; silhuetas grandes e simples; sol quente e sombra fria (hue shift nas rampas de cor); **sem pós-processamento**.

### 5.2 Grade, densidade e peças fora da grade [DECIDIDO #6, #7]

| Família | Densidade | Textura |
|---|---|---|
| Cenário (blocos e formas do catálogo) | **32 px/m** | **16×16 px por face** de bloco de 0,5 m, filtro nearest, UV em unidades de mundo (rampa e cerca têm o mesmo pixel do bloco) |
| Bobos e bobos-zumbi | **32 px/m** (#51) | pintura **64×64** a 16 px/m, ampliada no loading para 4 camadas 64×64 (Scale2x + grão), a mesma densidade do cenário; o rosto fica a 16 px/m até o M2 |
| Armas, acessórios 3D, props fora da grade e props dinâmicos | 32 px/m | camadas 64×64 do array de modelos |

- **Peça fora da grade entra** quando (a) custa menos triângulos ou draw calls que o equivalente em blocos, ou (b) tem silhueta claramente melhor onde o jogador olha de perto, **e** (c) a colisão vira caixas ou rampas que a navegação entende.
- **Regra única de render** [PADRÃO]:
  - **formas do catálogo** que cabem na célula e repetem muito (laje/meio-bloco, degrau, rampas 1:1 e 1:2, painel fino, poste + travessa para cercas e grades cutout, cruz para vegetação) vão **na malha do chunk**, com texturas 16×16 e custo zero de draw call;
  - **props** com silhueta própria, forma redonda ou tamanho grande (cilindros de 8 ou 12 lados, barris, caixas d'água, tendas e lonas, jipe, holofote, gerador, árvores low-poly; até 300 triângulos) vão no **programa instanciado**, com camadas 64×64 do array de modelos e até 15 draw calls por vista (8 no Switch 3–4P).
  - Cilindro não vai para o chunk porque estoura a tabela de 32 normais do vértice compacto (`tecnico.md` 6.2).
- **Bloco é a base:** pelo menos ~80% da superfície visível de um mapa é bloco.
- A densidade e a dose de peças fora da grade são **aprovadas pelo Erick por prints da cena-vitrine (M1)**. Se o print pedir, a primeira alavanca é a densidade dos bonecos, não a do cenário.

### 5.3 Regras de pixel-art
- **Paleta mestra de 64 cores** em rampas de 4 a 6 tons por material; o gerador falha o build com cor fora dela. Cores de time e de jogador local ficam fora das rampas do cenário. Preto puro só em pupilas e frestas.
- Sombreado pintado leve (±1 tom); o volume grosso vem da luz do motor.
- **Materiais contínuos** (grama, terra, concreto liso, água) são seamless, com pelo menos 3 variantes sorteadas no shader por célula. **Materiais modulares** (caixote, painel, tijolo, tábua) têm bevel pintado de 1 px: a grade de 0,5 m aparece de propósito.
- Sem contorno preto no cenário; skins e armas têm contorno interno de 1 px só onde uma peça termina. Sem dithering em xadrez (vira moiré em 640×360): manchas de 2 a 3 px.
- Nenhum texto de interface em textura; no cenário só pictogramas e palavras genéricas em pt-BR ("PERIGO", "SAÍDA").

### 5.4 Luz, céu e fog
- **AO por vértice** (fórmula da 0fps, com troca da diagonal) e **luz em canais separados**: sol (raycast na grade no loading), céu (flood fill 0–15, que escurece interiores) e emissivo (flood fill 0–15). Cor final = textura × (AO × (céu + sol × N·L) + emissivo), depois fog e LUT: o AO não escurece o emissivo (`tecnico.md` 6.4).
- **Dia, Entardecer e Noite são só uniforms** (cores de sol, céu, emissivo e fog) sobre a mesma malha. Noite é o padrão do mapa de Zombies.
- Ruído de cor (±3%) e variantes de textura **no shader, nunca no bake**, para não quebrar o greedy meshing.
- Bobos, props instanciados e objetos dinâmicos amostram uma grade de luz ambiente de 2 m: escurecem ao entrar num prédio, sem shadow map. Sombra própria em blob.
- Céu em gradiente com sol/lua, nuvens blocadas que deslizam, anel de silhueta no horizonte, **fog linear na cor do horizonte**, color grading por LUT 1D no próprio shader, bloom falso com sprite aditivo, clarão de tiro subindo a luz ambiente por 80 ms.
- **Filtro:** nearest na ampliação; `NEAREST_MIPMAP_LINEAR` na redução, para o chão não cintilar ao longe (A/B nos prints).

### 5.5 Armas e VFX
- **Armas:** 6 a 20 caixas (cano pode ser cilindro), até 600 triângulos (a maioria abaixo de 300), peças separadas para animar (corpo, pente, ferrolho, luneta), soquetes `hand_r`, `hand_l`, `muzzle`, `mag`, `sight`. O mesmo modelo serve na mão dos outros e no viewmodel. Luvas na cor do time. Animação por molas (sway, coice, recarga com o pente caindo, ADS). Cada classe com silhueta reconhecível em 1 s.
- **VFX:** clarão, traçante, impacto com **cubinhos da cor do texel atingido**, marcas de tiro em decal (somem em 20 s), explosão de cubinhos e fumaça de cubos, cápsulas como cubinhos dourados. Pools pré-alocados, sem alocação por frame; até 6 draw calls de VFX por vista.
- **Violência configurável** [DECIDIDO #9]: padrão cartunesco (cubinhos na cor da roupa; o bobo se desmonta, as 6 partes quicam com "poof" de confete e somem em 4 s); opção "Com sangue" nos ajustes (cubinhos vermelhos e mancha temporária). Nada de vísceras ou osso. É ajuste local de cada jogador, não regra da partida.
- **Headshot:** o chapéu voa como peça física, com confete.
- "Reduzir efeitos": sem tremor, no máximo 3 clarões por segundo, metade dos cubinhos.

### 5.6 UI: tudo escuro [DECIDIDO #3, #22]
- Toda a UI desenhada pelo jogo em WebGL, também na web. Linha do futbobo (editorial escuro, sério, militar), com tokens próprios em `.interface-design/system.md`. Direção: painel de comando de um quartel de brinquedo; o mundo é colorido, a interface é escura e contida.
- **Assinaturas:** chanfro de 45° no canto de cards e botões; faixa zebrada âmbar só em avisos e no botão de sair; rótulos em caixa alta condensada. O logo em blocos é o único elemento pixel-art da interface.
- **Tokens:** fundo `bunker #0A0D0B`, painel `chapa #121815`, ação `#F2B233`, perigo `#EF5B4C`, ok `#6FCF7A`. Times A/B/C/D = laranja ▲, azul ●, verde ■, roxo ◆, sempre com ícone. Jogadores locais P1–P4 com cores próprias e os mesmos ícones.
- **Tipografia:** duas fontes OFL (display pesada + condensada para o HUD), até 120 KB, escolhidas por print: **Russo One** nos títulos e **Saira Condensed** no HUD e nos textos de leitura (decisão #54).
- **Layout:** espaço lógico de 1280×720 com âncoras e safe area; HUD com referência de 640×360 por vista; alvos de toque de 44 px nos menus e 64–80 px nos controles da partida; texto mínimo de 22 px na TV e 16 px por vista no 3–4P.
- **HUD:** retícula e hitmarker no centro; vida embaixo à esquerda; munição embaixo à direita; kill feed em cima à direita; placar e tempo no topo; dano direcional nas bordas. No 3–4P, informação compartilhada (placar, onda, tempo) no cruzamento central.
- **Glifos de botão genéricos** desenhados pelo jogo (posição e cor), sem logos de Nintendo, Xbox ou PlayStation.
- **Movimento:** entradas secas de 120 a 180 ms; respeita "Reduzir efeitos".

### 5.7 Controles (resumo)
- **PC:** WASD + mouse; atirar/ADS nos botões esquerdo/direito; Espaço pula; **C agacha (correndo, desliza)**; Shift corre; R recarrega; 1–4 e Q trocam arma; G granada; E interage; V faca; Tab placar; F2 debug. O Esc solta o pointer lock, e a perda do lock abre a pausa.
- **Controle (web e Switch):** analógicos movem e miram; gatilhos atiram e miram; ombros para granada e faca; botões definidos por posição (baixo pula, direita agacha, esquerda recarrega/interage, cima troca arma); clique do analógico esquerdo corre; direcional para pings e emotes; − / + para placar e pausa.
- **Toque:** analógico que nasce onde o dedo toca na metade esquerda; arrastar na direita para mirar; botão ATIRAR de 80 px que também mira; botões de 64 px; margem morta de 24 px nas bordas; atirar sozinho opcional; layout canhoto.

### 5.8 Construto e cena-vitrine (M1)
- **Construto:** paleta neutra (cinza, laranja de segurança, verde-oliva) para que times e VFX dominem a saturação.
- **Cena-vitrine:** um canto de ~32×32 m do Construto com todas as famílias de arte de uma vez (blocos contínuos e modulares, rampa, cilindros, cerca cutout, mato em cruz, lona, jipe low-poly, vidro, emissivos, interior e exterior, 6 bobos com skins, colete de time e 1 bobo-zumbi, pistola, fuzil e sniper em viewmodel, tiro, impacto, detrito e morte). **É a mesma cena do Teste Zero.** O vidro e a água rasa ficam numa **bancada de materiais fora da área jogável** (só para prints e medição): o Construto jogável do M2 não tem vidro nem água (4.6.1).
- **Prints para o Erick aprovar** (câmera fixa): (1) Dia, Entardecer e Noite; (2) densidade de textura, com bobo e parede a 1 m e 3 m; (3) peças fora da grade em três doses (só blocos, proposta, dobro); (4) leitura de bobos a 5, 15, 30 e 50 m em 640×360, com e sem contorno, também em cinza; (5) filtro de mipmap no chão ao longe.

### 5.9 Marca
- **BOBOFORCES** no logo, **BoboForces** no texto, **boboforces** em URL e pastas [PADRÃO].
- **Logo só tipográfico em blocos** [DECIDIDO #43]: as letras BOBOFORCES feitas de blocos com textura pixel-art (placas de teste com faixa laranja), desenhadas pelo motor na tela de título com a luz do mundo. **Sem mascote. Sem slogan** [DECIDIDO #44]: título e imagem de compartilhamento levam só o nome e "um jogo bobo da EriLab". Favicon, ícones do PWA e o ícone de 256×256 do Switch saem do mesmo script.
- **EriLab:** rodapé "um jogo bobo da EriLab", painel "Outros jogos" na web, publisher no NACP do Switch.

### 5.10 Áudio
- **Mixer próprio** só com o subconjunto comum de Web Audio (Context, BufferSource, Gain, StereoPanner), porque o nx.js não tem PannerNode nem filtros. "3D" próprio: volume por distância + pan; duas amostras por arma (perto e longe, trocadas além de 30 m); −6 dB atrás de parede.
- **No sofá:** cada som usa o **ouvinte local mais próximo** [PADRÃO]; saída mono opcional; pan a 50% com 3–4 jogadores; volume "meus sons" por jogador; −3 dB na própria arma com 3–4 jogadores; tom diferente por slot ao entrar no lobby.
- **Mixagem:** canais Master, Música, Efeitos e UI; até 24 vozes por prioridade; cooldown por som; só os passos dos 4 bots mais próximos de cada ouvinte; música abaixa 6 dB nas explosões.
- **Efeitos** [DECIDIDO #39]: cerca de 40 no MVP, **CC0 (ex.: Kenney) com crédito + sons sintetizados em código**. Formato único: **MP3**, mono, até 1,5 MB no total.
- **Música** [DECIDIDO #38]: **CC0 provisória**, trocada depois. **Desligada por padrão durante a partida**; toca no menu, entre ondas e nos resultados. Tema de menu em loop de 60–90 s, Zombies em 2 camadas pela intensidade da onda, vinhetas de vitória e derrota. Clima: marcha de brinquedo, percussão militar leve.
- **Bots sem falas** [DECIDIDO #34]: sem voz, sem balão, sem sílabas inventadas.

### 5.11 Acessibilidade
Modos daltônicos (Protanopia, Deuteranopia, Tritanopia) sem custo de desempenho; cor de inimigo escolhível; times sempre com ícone e padrão no colete; contorno de time/inimigo on/off (saiu no M1, #50: a leitura é do colete e dos marcadores); mira assistida em 4 níveis; FOV, tremor e balanço ajustáveis; esconder viewmodel; sensibilidades separadas; tudo remapeável; segurar ou alternar; texto em 100/125/150%; HUD de alto contraste; **indicador visual de som** e **saída mono**; "Reduzir efeitos" (fotossensibilidade); violência configurável; pausa a qualquer momento no offline.

### 5.12 Produção dos assets [DECIDIDO #13]
**O Claude gera tudo por script; o Erick aprova por prints.** A fonte da verdade é texto versionado em `assets-src/`: pixel-art como grade de caracteres com índices da paleta, modelos como listas de caixas e mapas como scripts. As ferramentas geram as camadas PNG, os modelos e os mapas compilados; a malha e a luz dos mapas são montadas no loading, no cliente (pré-malha no build só se o Teste Zero pedir). O validador falha o build por cor fora da paleta, tamanho de camada errado, densidade de texel fora de ±5%, soquete de arma faltando, teto de triângulos ou ID de conteúdo sumido. Prints automáticos da cena-vitrine (Dia/Entardecer/Noite, 1280×720 e 640×360) são salvos por versão para comparar. O gosto final é do Erick.

---

## 6. Arquitetura técnica (resumo)
Detalhe em [`design/tecnico.md`](design/tecnico.md).

### 6.1 Visão geral
- **Um código só, com duas cascas.** Todo o jogo fica em pacotes TypeScript compartilhados que não sabem que existem DOM, rede ou Switch. `apps/web` e `apps/switch` só implementam a interface `Platform` (gráficos, assets, save, controles, áudio, texto, ciclo de vida, sair) [PADRÃO].
- **Stack** [DECIDIDO #2]: TypeScript strict (padrão VNbobo) + **three.js** só com `WebGLRenderer`, em WebGL2 puro e sem extensões, isolado no pacote `render`; **nx.js** no Switch. Plano B: renderer WebGL2 próprio, trocando só o `render`. Vite na web, esbuild no Switch, Vitest + playwright-core no Edge.
- **Simulação separada da renderização** (regra do novelo e do gamebobo): a sim nunca chama render, áudio ou UI; só emite eventos. Passo fixo, RNG com semente, entrada como ações gravadas, debug no F2, `dispose()` total, constantes em config, saves versionados com migração.
- **Dados antes de código:** armas, bots, modos, regras, perfis de movimento, blocos, modelos e perfis de desempenho são dados versionados e validados.
- **Orçamentos são medidos, não estimados:** painel F2, bench headless, size-check no CI e Teste Zero.

### 6.2 Monorepo [PADRÃO]
npm workspaces: `packages/*`, `apps/web`, `apps/switch`, `tools/*`, mais `assets-src/` e `local/` (privado, fora do git).
- **Pacotes:** `shared` (math, RNG, pools, bitpack) → `format` (schemas, validadores, migrações, decodificador PNG, IDs) → `world` (grade, formas, chunks, colisão, luz, mesher) → `nav` → `sim` → `ai` → `input`, `ui`, `audio`, `render` (único que importa three) → `game` (fluxo e `LocalDriver`) → `apps/*`. `platform-api` só tem tipos. `net` só existe na web.
- **Garantia, não só papel:** os pacotes puros compilam **sem a lib DOM**; ESLint proíbe globais do navegador e imports fora do lugar (three só em `render`, Trystero só em `net`, `net` só em `apps/web`); o `tools/portcheck` faz o build do Switch, procura identificadores proibidos e dá boot no jogo em `node:vm` com globais falsos do nx.js.
- **Convenções:** identificadores em inglês; textos, docs e comentários em pt-BR; Prettier com printWidth 120 e aspas simples; todo texto de UI numa tabela de chaves pt-BR desde o primeiro dia [DECIDIDO #14]; versões exatas, sem `^`, registradas em `DEPENDENCIAS.md` e `CREDITOS.md`; nada de commit ou push sem pedido do Erick.

### 6.3 Simulação
- **ECS-lite próprio** em typed arrays (SoA), sem GC no laço quente. Capacidades: 1.024 entidades, 4 humanos, **64 bots**, 512 projéteis, 256 pickups.
- **`SIM_HZ = 60`** [PADRÃO], com tudo em unidades por segundo e render interpolado; no Switch cai para 30 se o Teste Zero exigir. Acumulador de até 4 passos por frame, frame limitado a 0,1 s. Yaw e pitch aplicados a cada frame de render e enviados como ângulos absolutos, para a mira não ganhar latência.
- **Determinismo na medida certa:** dentro da mesma build, para testes golden, robô de balanceamento, Surpreenda-me por semente e replay de debug. Proibidos `Math.random`, `Date.now` e `performance.now` em `sim`, `ai`, `nav` e `format`.
- **A receita de partida (`MatchRecipe`) é a única entrada da sim:** menu, preset, Surpreenda-me, Partida Rápida e lobby online geram a mesma receita.
- **Cosméticos ficam fora da sim** (detritos, desmontar, partículas, decals), com RNG próprio e sem sincronização.

### 6.4 Mundo e render
- **Grade de 0,5 m;** célula `u16` (bloco + orientação); catálogo de formas dentro da célula (cubo, laje, degrau, rampas 1:1 e 1:2, painel fino, poste + travessa, cruz) na mesma malha do chunk; props fora da grade (cilindros, barris, veículos, árvores) pelo programa instanciado, com textura no array de modelos e até 15 draw calls por vista (8 no Switch 3–4P). É a mesma regra de 5.2. Chunks de 32³ células (16 m); regiões de render de 32×32×16 m.
- **Texturas em `TEXTURE_2D_ARRAY`** com índice de camada: um array de blocos (16×16) e um de modelos (64×64: skins, armas, props, folha de rostos). Wrap REPEAT dentro da camada, mips gerados no build preservando o alfa dos cutouts. Imagens em PNG decodificadas pelo próprio jogo (sem `Image`, `ImageBitmap` ou canvas). **Plano B:** atlas com padding e `textureGrad`, atrás de um `#define` [T0].
- **Greedy meshing por textura com repetição no shader:** funde faces com a mesma camada, o mesmo AO e a mesma luz; o UV sai da posição no shader, então quads fundidos e rampas não esticam a textura. **Vértice compacto de 12 bytes** (posição, normal, AO, camada, céu, sol, emissivo, flags). Malha montada no loading e **nunca refeita na partida** (cenário estático).
- **No máximo 7 programas de shader:** blocos opacos, cutout, translúcido, instanciado, partículas, céu e UI; compilados e aquecidos no loading. Proibidos: EffectComposer, render targets float, shadow map, texturas comprimidas, anisotropia, luzes do three, leitura de textura no vertex shader.
- **Personagens com um `InstancedMesh` só (R4c):** 1 draw para todos os bonecos de uma vista, uma instância por caixa (~17,75 caixas, ~213 triângulos por boneco); antes, 7 draws (6 partes + o quad do rosto) e ~150 triângulos. Skins pintadas em JS no loading, em 2 camadas do array, com o rosto 16×16 na própria skin; a expressão desloca a UV da face da frente no vertex shader, só com conta, sem ler textura no vertex shader e sem textura de ossos. Instâncias atualizadas uma vez por frame, não por vista.
- **Detritos:** cubinhos no programa instanciado, com cor sólida por instância lida pela CPU no texel atingido.
- **Contorno de time por casco invertido:** fora do orçamento base; decidido no M1 por print + medição.
- **Tela dividida:** um framebuffer, scissor por vista; por vista só culling, uniforms e draw; opacos de frente para trás (o nouveau não tem Zcull). Viewmodel desenhado por último em cada vista.
- **Visão:** plano distante e fim da fog em `min(regra, teto do perfil)`; é o principal regulador de custo.
- **Resolução:** PC com antialias nativo; celular sem AA e com escala dinâmica; **Switch 720p fixo sem AA** até o Teste Zero aprovar algo melhor (candidato: FBO multisample 2× com blit).

### 6.5 Física, navegação e IA
- **Colisão própria:** AABB varrido eixo a eixo contra a grade (estilo Minecraft), considerando formas e props; rampas com piso por plano; degrau de 0,5 m; coyote time. **Hitscan** por DDA na grade + raio contra hitboxes num hash espacial de 4 m. Projéteis com balística por tick. Explosão = esfera + raio de oclusão; não altera o cenário.
- **Colisores dinâmicos:** portas e barricadas do Zombies são entidades com estado; abrir uma porta só liga um link da navegação.
- **Navegação:** grade 2,5D sobre a grade de 0,5 m, nós de 1 × 1 m, ligações de degrau (0,5 m), pulo (1,0 m) e queda (até 3 m); **pré-calculada no build**; A* com orçamento de nós por tick; **flow field** multi-fonte compartilhado para hordas; pontos táticos (cobertura, emboscada, flanco, sniper) bakeados. Sem Rapier, sem WASM no caminho crítico.
- **IA:** cada bot é um `BotProfile` que gera o mesmo `InputFrame` de um humano. Decisão por utility AI (1–10 Hz pelo LOD), execução por máquina de estados + steering a cada tick, mira pelo modelo de habilidade. Blackboard por time. Orçamento no Switch 3–4P: até 3 decisões, 12 raios e 800 nós de A* por tick; meta de IA em até 3 ms por frame [T0].

### 6.6 UI e input
- **UI em WebGL** com texto **MSDF** (atlas gerado no build de fontes OFL, Latin-1 + Latin Extended-A; sem `FontFace`; Canvas 2D só como plano B [T0]). O pacote `ui` é puro: telas como funções estado → árvore, layout por âncoras, foco espacial automático, saída em `DrawList` (1–2 draw calls por vista). DOM só na casca web, em quatro usos (mesma lista em `tecnico.md` 9 e `arte-ux.md` 6.1): o splash, que também vira a página de aviso, e um `<input>` escondido para texto [DECIDIDO #3]; como exceção técnica da casca, fora da UI, um `<input type=file>` escondido para importar backup e um link de download (Blob) para exportar backup e relatório [PADRÃO, registrado no `DECISOES.md` como "DOM na web (exceção da #3)"].
- **Entrada de texto:** teclado próprio no canvas, `<input>` escondido na web, teclado do sistema no Switch se o nx.js expuser [T0].
- **Input abstrato:** dispositivo → adaptador da plataforma → perfil de controle → ações → `InputFrame` (~10 bytes: seq, botões, movimento, yaw e pitch absolutos). Ações de jogo e de menu separadas. Gamepads 0 a 7 com zona morta radial e curva configuráveis. Assistência de mira calculada no cliente antes do `InputFrame`. Até 4 jogadores locais.
- **Painel F2:** FPS e ms por fase, draw calls, triângulos e programas por vista, bots por LOD, heap e pausa de GC, RTT e perda, exportar replay, copiar relatório. No Switch, ZL+ZR+−.

### 6.7 Rede (só web, M5)
- **Estrela com host autoritativo, até 4 humanos** [DECIDIDO #25]; bots rodam só no host e viajam nos snapshots.
- **Trystero com relays Nostr** (como no futbobo) para sinalização; canal confiável para lobby e eventos, não confiável para inputs e snapshots. **Só STUN no protótipo**; **TURN decidido antes de abrir o online** (Cloudflare com Worker grátis, que exige conta do Erick; Open Relay como reserva). Acesso **só por código ou link**, sem salas públicas e **sem chat livre**.
- **Netcode:** snapshots com delta a 30 Hz (host PC) ou 20 Hz (host celular); cliente prediz só o próprio movimento e reconcilia por `seq`; interpolação de 100 ms; lag compensation com rewind de até 200 ms. Banda ≈ 16 KB/s por cliente com 44 entidades. Handshake com `protocolVersion` e hash do conteúdo; diferença pede para atualizar.
- **O Switch não tem rede:** `platform.online = null`, `__ONLINE__: false`, e o `portcheck` falha se o bundle tiver `RTCPeerConnection`, Trystero ou `WebSocket`. Na web, o chunk de rede só carrega ao abrir "Online".
- **Host em segundo plano e host no celular:** 3.7. Orçamento de CPU do host no celular (30 fps, 8 bots, 3 clientes) em `tecnico.md` 13.4.

### 6.8 Save e persistência
- **Web:** `localStorage` (preferências, presets, bots, estatísticas, com prefixo `boboforces:` porque a origem `erereck.github.io` é dividida com o gamebobo) e IndexedDB só para replays de debug. `navigator.storage.persist()` no primeiro "Salvar". Exportar/Importar backup em arquivo (`boboforces/backup@1`, com "Juntar" ou "Substituir"). Duas abas: só a primeira grava (lock + aviso "Usar aqui"). Escrita com debounce de 250 ms e flush ao pausar e ao sair.
- **Switch:** `save.json` + `save.backup.json` em `sdmc:/switch/boboforces/`, sem tela de escolha de perfil, como no MMM.
- O save guarda só configurações, presets, bots, estatísticas e recordes.

### 6.9 Pipeline e formatos de assets [PADRÃO]
- **Ferramentas:** `texgen` (texturas e mips), `skingen` (prévia do pintor de skins; as partes 64×64 do bobo A saíram no port), `modelgen` (modelos de caixas e primitivas low-poly), `mapc` (mapas em script → `.bfmap` com grade, props, marcadores, navegação e pontos táticos), `mapview` (editor interno), `fontbake` (atlas MSDF), `logo`, `assetcheck`, `credits`, `balance`, `bench`, `size-check`, `portcheck`.
- **Formatos:** binários próprios em **RLE + deflate (fflate)**, **PNG** para imagens, **MP3** para áudio. Brotli e gzip só como compressão de transporte.

### 6.10 Orçamentos (valores iniciais, confirmados no T0)

| Item | Meta |
|---|---|
| Download web | HTML + splash ≤ 15 KB; menu interativo ≤ 350 KB; primeira partida ≤ 1 MB acumulado; rede ≤ 80 KB sob demanda; jogo completo ≤ 15 MB em segundo plano |
| Tempo | menu em ≤ 2 s (PC) e ≤ 4 s (celular); primeira partida em ≤ 5 s (PC) e ≤ 10 s (celular); visita repetida com menu em ≤ 1 s; Switch do boot ao menu em ≤ 4 s |
| CPU, Switch dock 4P com 12 bots a 30 fps (33,3 ms) | input + UI 1,5 · sim 4,0 · IA 3,0 · animação e efeitos 1,5 · render CPU 14,0 · áudio 0,5 · margem 8,8 |
| Draw calls por vista | PC ≤ 150; celular ≤ 80; Switch 1–2P ≤ 60; Switch 3–4P ≤ 45 (total Switch ≤ 200) |
| Triângulos por vista | PC ≤ 400 mil; celular ≤ 150 mil; Switch 1–2P ≤ 200 mil; 3–4P ≤ 120 mil |
| Memória | texturas ≤ 8 MB; malhas do mapa ≤ 40 MB; GPU < 150 MB; heap JS < 200 MB; celular < 300 MB no total |
| GC | zero alocação nos laços quentes; pausa máxima de 5 ms em 20 min |
| Switch | romfs até 60 MB |

- **Qualidade na primeira abertura:** leitura do aparelho + micro-bench de ~3 s no loading → Alto, Médio ou Leve; lista de GPUs fracas; o jogador muda quando quiser. Limitador 30/60 FPS e modo de economia de bateria no celular.
- **Aparelhos de referência:** notebook com GPU integrada (Iris Xe / Vega 8); Android de entrada de 4 GB (classe Mali-G52/G57); celular médio (classe Galaxy A35/A55); celular do Erick; iPhone 12+ com iOS 17+ (limitações conhecidas); o Switch do Erick na dock e no portátil.

### 6.11 Diagnóstico, build, deploy e testes
- **Diagnóstico sem coleta** [DECIDIDO #42]: "Copiar relatório" (versão, codinome, GPU, perfil, desempenho, versões de formato, últimos 20 erros; nunca nomes, códigos, IP ou salas); `runtime.log` com rotação no SD do Switch; tela "Algo deu errado" com relatório e voltar ao menu.
- **Web:** Vite (`es2022`, `base: './'`), service worker com escopo `/boboforces/` e atualização só no menu, manifest em tela cheia e paisagem, deploy por GitHub Actions no GitHub Pages [DECIDIDO #40].
- **Switch:** esbuild → `romfs/main.js`, scripts NRO/NSP herdados do MMM, NACP "BoboForces" / "EriLab", title ID fixado no M0. **O CI compila e roda o `portcheck`, mas nunca gera NRO/NSP** (num repositório público, artefato seria download público) [DECIDIDO #33].
- **Testes:** Vitest por pacote; golden de determinismo (TDM com 8 bots, semente 42, 3.600 ticks); robô de balanceamento; bench headless com 12, 24, 40 e 64 bots; rede em loopback com latência, jitter e perda; e2e no Edge (boot, Partida Rápida, zero erros, ≤ 7 programas, 667×375 e 1280×720, backup, duas abas); portabilidade em `node:vm`; checklist manual por marco no celular do Erick, num Android de entrada e, do M1 em diante, no Switch real.

### 6.12 Regras de ouro de portabilidade
Proibido no código compartilhado. Vão para `docs/PORTABILIDADE.md` e para o `CLAUDE.md` no M0.

**Plataforma**
1. **Sem DOM:** nada de `document`, `window.*`, `HTMLElement`, `HTMLCanvasElement`, CSS, `innerHTML`, `DOMParser` ou `new Image()` direto. Os pacotes puros nem compilam se isso aparecer.
2. **Sem armazenamento direto:** nada de `localStorage`, `sessionStorage` ou `indexedDB`. Tudo passa por `platform.storage`.
3. **Sem `fetch` nem URLs:** assets são pedidos por caminho lógico (`maps/construto.bfmap`) via `platform.assets`.
4. **Sem rede fora de `net`:** nada de `RTCPeerConnection`, `WebSocket` ou Trystero. `sim`, `game` e `ui` nunca importam `net`.
5. **Sem threads:** nada de `Worker`, `SharedArrayBuffer`, `Atomics` ou WASM com threads.

**Gráficos e áudio**

6. **WebGL2 puro:** sem `getExtension` (exceto o diagnóstico da casca web); sem WebGL1; sem MSAA no framebuffer padrão do Switch; sem render target float ou half-float; sem EffectComposer; sem texturas comprimidas (KTX2/Basis); sem anisotropia; sem timer query; sem leitura de textura no vertex shader; só `WebGLRenderer`. `TEXTURE_2D_ARRAY` e atributos inteiros são núcleo do WebGL2 e permitidos, com o atlas de plano B pronto atrás de um `#define`.
7. **three.js só em `render`.** Nada de `TextureLoader`, `ImageLoader`, `FontLoader`, `CSS2D`/`CSS3DRenderer`, `OrbitControls` ou qualquer coisa que leia eventos do DOM.
8. **No máximo 7 programas de shader.**
9. **Áudio só pelo mixer:** nada de `PannerNode`, `OscillatorNode`, `AudioWorklet`, `HTMLAudioElement` ou `MediaElementSource`.

**Simulação e memória**

10. **Tempo e acaso:** sem `Math.random`, `Date.now` ou `performance.now` em `sim`, `ai`, `nav` e `format`. Usar o tick e o RNG com semente.
11. **Sem alocação no laço quente:** nada de vetores, arrays ou closures novos por frame. Usar pools e objetos de rascunho.

**Entrada, texto e tela**

12. **Input só por ações.** Eventos de teclado, ponteiro e toque só nos adaptadores de `apps/*`. Todo fluxo tem que ser jogável só com D-pad + A/B. Nada pode exigir hover, mouse, toque ou giroscópio.
13. **Texto:** sempre pela tabela de textos pt-BR + MSDF; sem fonte de sistema; sem `toLocaleString`/`Intl`: a formatação de números é própria.
14. **Entrada de texto** só por `platform.textInput`, com o teclado próprio de reserva.
15. **Sem `eval` nem `new Function`.** `import()` dinâmico só em `apps/web`.
16. **Sair e pausar:** `+` pausa; sair só por `platform.exit()`. Nunca depender de Esc, Home ou do voltar do navegador.
17. **Nunca assumir proporção, DPR ou resolução.** UI por âncoras e safe area. Testar em 640×360 (um viewport de 4 jogadores), 1280×720 e 667×375.

**Modos, dados e dependências**

18. **Todo modo roda com `platform.online === null`** e com zero humanos remotos.
19. **Toda receita e todo perfil passam pelo validador** e respeitam o teto da plataforma.
20. **IDs de conteúdo nunca mudam.** Aposentar um ID exige substituto no registro.
21. **Caches com limite** e `dispose()` total ao trocar de mapa.
22. **Dependência nova** só se passar no `portcheck` e estiver em `DEPENDENCIAS.md` e `CREDITOS.md` com versão exata.
23. **Formatos de asset:** só PNG, MP3 e binários próprios com RLE + deflate.

---

## 7. Roadmap
Ordem decidida [DECIDIDO #28]: **M0 Fundação → M1 Cena-vitrine + Teste Zero (mesma cena) → M2 MVP web solo → M3 Sofá → M4 Port do Switch → M5 Online P2P → M6+ Modos de festa e conteúdo.** A partir do M2, todo marco termina com um **checkpoint no Switch real** para o que for ao console.

| Marco | O que entra | Pronto quando |
|---|---|---|
| **M0 Fundação** (P) | Monorepo, tsconfig strict, guardas de lint e de lib, CI, `version.json`, CHANGELOG, `CLAUDE.md`, `DEPENDENCIAS.md`, `PORTABILIDADE.md`; `platform-api`; **sim headless** (passo fixo, RNG, ECS-lite, `InputFrame`, colisão AABB + DDA, perfil Bobo); **input abstrato** (teclado/mouse, gamepad, toque → ações); **render base** (three com shim, 1 chunk texturizado com texture array, câmera); **UI WebGL base** (MSDF, foco, 1 tela, tokens escuros); gerador de texturas com paleta e validador; robô de balanceamento rodando duelos de fuzil; **deploy** no Pages com splash; `apps/switch` stub com esbuild e boot em `node:vm`. | CI verde; a URL publicada abre o splash em menos de 1 s; a sim roda 3.600 ticks headless com hash estável; o bundle do Switch passa no `portcheck`. |
| **M1 Cena-vitrine + Teste Zero** (M) | `world` completo (formas, chunks, mesher por textura, AO, luz em canais); `texgen`, `skingen`, `modelgen`, `mapc`; o **Construto com bobos e bots** como cena-vitrine (blocos, peças fora da grade, props, bonecos do FutBobo com skins (no port, #56), armas, VFX, Dia/Entardecer/Noite); bots burros (N0, A* + fuzil hitscan), respawn e morte em cubinhos; 1 a 4 vistas; HUD MSDF mínimo; F2. A **mesma cena** vira `/bench` na web e NSP de teste no **Switch real com 4 telas e bots burros**, medindo FPS e memória. | **Prints aprovados pelo Erick** (densidade de textura, dose de peças fora da grade, luz, leitura, filtro). **Switch na dock com 4 vistas, 12 bots armados e visão de 50 m a 30 fps estáveis por 10 min** (p99 ≤ 40 ms); Switch 1P com 24 bots e 90 m a 30 fps; heap < 200 MB; loading do Construto ≤ 4 s; three com shim funcionando; texture array ou atlas validado; PC de referência a 60 fps com 4 vistas e 24 bots; Android de entrada a 30 fps com 12 bots. Resultados e tetos revistos em `docs/PERF.md`. |
| **M2 MVP web solo** (G) | **Bobo Warfare TDM e FFA, Bobo Training, Surpreenda-me simples, Laboratório núcleo forte** (5 níveis + sliders dos 4 eixos + salvar bots), **Construto + 1 arena pequena, 8 armas**. Também: JOGAR, Partida Rápida, Partida personalizada, presets locais, Mais fácil/Mais difícil, regras básicas, perfis Bobo/Tático/Personalizado, 1ª e 3ª pessoa, Oficina local, ~12 bots de fábrica, salvar Nêmesis, Meu Bobo com kit e 12 skins, onboarding, anti-frustração, LOD de IA, ~40 SFX e música de menu, Novidades, Copiar relatório, backup, qualidade na primeira abertura. PC e celular. | Orçamentos de download e tempo cumpridos; golden e balance no CI (5 níveis em ordem); PC de referência a 60 fps com 40 bots; Android de entrada a 30 fps com 12 bots; checklist manual no celular; **checkpoint Switch** com o MVP num NSP (1 a 2 h de jogo). |
| **M3 Sofá** (M/G) | **Tela dividida local na web com controles** (até 4; teclado+mouse = 1 slot), lobby "aperte A", entrar no meio, áudio no sofá, HUD 3–4P; **Bobo Zombies estilo CoD** (ondas, pontos, armas na parede, barricadas, portas, Caixa Misteriosa, vantagens, reviver, chefões, bobos-zumbi com variantes); flow field e colisores dinâmicos; **mapa de Zombies** (Base Abandonada); bots Suporte; música de Zombies em camadas. É o ensaio do Switch no PC. | 4 gamepads no PC dentro do orçamento; Zombies de 10 ondas jogável solo e com 4; **checkpoint Switch** com 4 controles reais e Zombies a 30 fps. |
| **M4 Port do Switch** (M) | **nx.js, 100% offline, uso pessoal:** LOCAL EDITION com tudo que existe até o M3; `platform-switch` completo; save no SD com backup; bots e presets por arquivo no SD; NACP, ícone e title ID; glifos genéricos; teclado na tela; ciclo de vida (dock/portátil, HOME/sleep, reconexão, bateria); `runtime.log`; Teste Zero 2 com o jogo inteiro. | **4 jogadores em Bobo Zombies a 30 fps por 20 min, na dock e no portátil, sem crash e com heap estável**; NSP instalado no console do Erick. |
| **M5 Online P2P** (G) | **Até 4 humanos**, host autoritativo, Trystero com relays Nostr; lobby por código e link; predição, reconciliação e lag compensation; `protocolVersion` e hash de conteúdo; host ausente; expulsar e travar sala; AFK; pings e emotes; **TURN decidido**; aviso de privacidade. Modos: TDM, FFA, X1, Surpreenda-me, Bobo Zombies coop. | Loopback no CI; teste real entre 4G e wi-fi com 4 humanos + bots; host no celular com 8 bots a 30 fps; aviso de privacidade revisado (inclusive ECA Digital). |
| **M6+ Modos de festa e conteúdo** (G) | **BoboStrike, Bobo Paintball, Domination, Bobo Juggernaut, Bobo Sandbox completo, Oficina com códigos** (`BF1-`/`BFP1-`, `#bot=`/`#p=`), **Diretor de Partida, Aquário, Bobo Chaos, Bobo Royale Mini 24**, mais mapas e armas. Também Gun Game e Infection, variantes do Zombies, perfil Arcade, ordens aos bots, esquadrões, Nêmesis com memória, cadeado e seed no Surpreenda-me. Ordem interna a decidir com o Erick. | Cada modo passa no checklist da regra de ouro (4.1.4), com golden e bench; o Royale Mini passa no bench do Switch 4P e do celular antes de lançar; checkpoint Switch para o que for ao console. |

**Por que o Teste Zero vem no M1, mesmo com o port no M4** [DECIDIDO #23]: uma reprovação muda decisões caras (renderer, texture array ou atlas, tamanho das regiões, `SIM_HZ`, tetos de bots). Custa cerca de uma semana, o Erick já tem o Switch desbloqueado e o pipeline NRO/NSP do MMM, e a mesma cena responde às duas perguntas: "está bonito?" (prints) e "o Switch aguenta?" (medição).

**Se o Teste Zero reprovar, tentar nesta ordem:** (1) ajustar o perfil do Switch (detritos, partículas, regiões, `SIM_HZ` 30); (2) trocar o texture array pelo atlas; (3) modo 3–4P de baixo custo (viewmodel simples, menos props, HUD mínimo), mantendo os 4 jogadores; (4) renderer WebGL2 próprio só no `render`; (5) avaliar o Brewser. Cortar visão ou tetos abaixo dos valores iniciais exige registro em `DECISOES.md`.

**Se o M2 atrasar (proposta, exige OK do Erick):** sem tocar no que o Erick decidiu, adiar primeiro o que é [PADRÃO]: 3ª pessoa, perfis Tático e Personalizado, qualidade automática (fica a escolha manual), kit de customização reduzido a skins prontas + cor, e trocar o lança-foguetes pela LMG.

---

## 8. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Escopo enorme para um projeto pessoal; nenhum calendário estimado | MVP nunca sai | Marcos com critério de pronto; MVP enxuto (M2); modos de festa só no M6+; plano de corte do M2 (seção 7); estimar o calendário depois do M1, com medição real. |
| three.js não sobe ou rende mal no nx.js (Mesa/nouveau, uma thread do A57) | Switch inviável ou feio | Teste Zero no M1; render isolado; plano B de renderer WebGL2 próprio. |
| `TEXTURE_2D_ARRAY` ou atributos inteiros falham no nx.js | Pipeline de textura muda | Itens 4 e 5 do T0; atlas com padding atrás de `#define`; decodificação em float. |
| CPU estoura com 4 vistas e bots no Switch | Menos de 30 fps no sofá | LOD de IA; teto de visão por perfil; `SIM_HZ` 30; tetos conservadores que só sobem com medição; zumbi mais barato que soldado. |
| GPU do portátil bem mais lenta que a da dock | Queda de FPS fora da dock | Medir nos dois modos; perfil portátil reduz detritos e partículas sem mexer nos tetos. |
| nx.js em beta muda a API | Port quebra | Versão fixa; build do Switch e `portcheck` no CI desde o M0; checkpoint a cada marco. |
| Controles do Switch (pares, índices e estilos sem documentação) | Slots trocados, controle não reconhecido | Item 17 do T0; tela "aperte A" para reatribuir; Joy-Con avulso recusado com mensagem. |
| Pixel-art gerada por script com cara genérica | Visual sem charme | Paleta mestra, regras de pixel-art, cena-vitrine como primeiro entregável de arte, prints comparativos por versão; o gosto final é do Erick. |
| Pixel do bobo 2× maior que o do cenário destoa | Estilo incoerente | Print de densidade no M1; a alavanca é a skin, não o cenário. |
| Legibilidade no 3–4P (bobos com 10 a 16 px) | Sofá confuso | Reserva de saturação, colete de time, marcadores, teto de visão de 50 m, contorno (a validar). |
| Agachado de 0,95 m com pernas rígidas | Pose feia ou hitbox estranha | Pose validada por print ao lado da cobertura de 1,0 m. |
| Alpha test (cutout, camada externa) pesa no Maxwell com nouveau | GPU do Switch no limite | Medir no T0; camada externa desligada a partir de 25 m. |
| Cabeça grande (0,5 m) deixa o headshot fácil demais | TTK desequilibrado, sniper dominante | Multiplicadores baixos (1,5x / 2,0x / 1,25x); sniper com 95 no corpo; robô de balanceamento. |
| iOS: sem tela cheia, áudio mudo ao voltar, página encerrada por memória, dados apagados em ~7 dias | Experiência ruim no iPhone | Menos de 300 MB; recriar recursos após perda de contexto; `resume` do áudio; dica de "Adicionar à Tela de Início" e backup. iPhone fica com limitações conhecidas [DECIDIDO #26]. |
| Pegadinhas do navegador (Ctrl+W, Esc com pointer lock, gesto de voltar, aba oculta) | Jogador sai da partida sem querer | Agachar no C; pausa pelo `pointerlockchange`; `pushState`/`popstate`; `beforeunload` só na partida; margem morta nas bordas do toque. |
| Host P2P congela em segundo plano | Todos caem | Coop pausa, PvP encerra em 10 s; detecção por silêncio de snapshot; aviso e Wake Lock no host celular. |
| NAT simétrico no 4G | Sala não conecta | TURN decidido antes de abrir o online. |
| Privacidade e público infantil (IP exposto no WebRTC, metadados nos relays, nomes digitados) | Problema legal ou de confiança | Sem contas e sem coleta; online só por código/link; sem chat livre; filtro de nomes; aviso de privacidade revisado com o ECA Digital (Lei 15.211/2025) antes do M5. |
| Dados novos da web chegam a um Switch antigo | Preset ou bot quebrado | IDs estáveis, recusa de versão maior, fallback de conteúdo com resumo. |
| Origem `erereck.github.io` dividida com o gamebobo | Saves misturados ou apagados | Prefixo `boboforces:` em tudo, service worker com escopo próprio, nunca `localStorage.clear()`. |
| Pausas de GC e travadas de compilação de shader | Engasgos | Typed arrays, pools, zero alocação no laço; no máximo 7 programas aquecidos no loading. |
| UI 100% WebGL | Leitor de tela quase não funciona; digitar é chato | `<input>` escondido na web, teclado na tela no Switch, nenhum campo obrigatório. |
| Áudio sem filtro e sem panner no Switch | Som "chapado" | Amostras de perto e de longe, oclusão barata, indicador visual de som. |
| Royale Mini (24) acima dos tetos do celular e do Switch 2P+ | Modo não roda em todo lugar | LOD C (combate bot × bot por probabilidade); bench antes de lançar; se não couber, menos participantes nesses perfis (exige registro). |

---

## 9. Pendências

### 9.1 Abertas de verdade

| # | Pendência | Quando fecha | Quem decide |
|---|---|---|---|
| 1 | **Prints da cena-vitrine:** densidade de textura (cenário 32 px/m, bobos 16 px/m), dose de peças fora da grade, filtro de mipmap, paleta mestra, três luzes, contorno de time (entra ou não; fora do orçamento base), forma final das caixas de tronco e membros (propostas em `gameplay.md` 3.1 e `arte-ux.md` 2.1), grade de luz de 2 m contra 1 m, pose agachada. **Respondido em 03/11/2026 (#50–#54):** luzes e `NEAREST_MIPMAP_LINEAR` aprovados, sem contorno, bobos a 32 px/m, dose dobro, bobos mais altos (1,625 m no código; o valor volta para o print de altura) e as fontes. (Depois: altura B, 1,75 m, #55, e o boneco do FutBobo, #56.) | M1 | Erick, por print |
| 2 | **Teste Zero no Switch real:** three com shim, `TEXTURE_2D_ARRAY`, atributos inteiros, custo do alpha test, AA por FBO multisample, `SIM_HZ` 60 ou 30, tetos de bots e zumbis, visão de 50 m no 3–4P, HUD em 640×360, 4 controles completos, teclado do sistema, áudio (MP3, `createBuffer`, StereoPanner), ciclo de vida. Checklist de 21 itens em `tecnico.md` 24.2. **Medido em 08/11/2026** (`TESTE_ZERO.md` §8c): passou, menos o loading da 1ª cena (5,0 s) e o item 15, aceitos pela #60 para uma rodada de otimização. | M1 | medição |
| 3 | **Calibração pelo robô de balanceamento:** headshot (1,5x / 2,0x / 1,25x), TTK, sniper com 95 no corpo, ordem dos 5 níveis. | M0–M2 | medição |
| 4 | **Fontes:** escolher as duas OFL por print. | M0–M1 | Erick |
| 5 | **Nomes provisórios:** armas, bots de fábrica, zumbis especiais, vantagens, presets de fábrica, o Bobo War Sim do backlog e mapas (Ringue, Base Abandonada e os do M6+). Os IDs internos não mudam. **Os do M2 (armas, bots de fábrica e Ringue) foram aprovados como estão em 08/11/2026 (#61).** | antes do M2 (mapas do M3 antes do M3) | Erick |
| 6 | **Online:** TURN (Cloudflare com Worker exige conta do Erick; Open Relay como reserva); confirmar se o Trystero na versão fixada expõe as `RTCPeerConnection`; texto do aviso de privacidade e obrigações do ECA Digital. | antes do M5 | Erick + pesquisa |
| 7 | **Bobo Royale Mini (24)** no celular (teto 12) e no Switch 2P+ (tetos 16 e 12). | M6+, com bench | medição; reduzir exige registro em `DECISOES.md` |
| 8 | **Aparelhos de referência:** modelos exatos do celular do Erick e do Android de entrada em `docs/PERF.md`. | M1 | Erick |
| 9 | **Versão do nx.js para o port:** migrar para a 1.0 estável se já existir. | M4 | técnica |
| 10 | **Calendário e dedicação:** nenhum prazo foi estimado. Estimar depois do M1, com o custo real da fundação e do Teste Zero. | fim do M1 | Erick |
| 11 | **Ordem interna do M6+** (qual modo de festa vem primeiro). | fim do M5 | Erick |
| 12 | ~~Propostas de redação para o `DECISOES.md`~~ **Feito em 02/11/2026:** exceção de DOM registrada como decisão menor "DOM na web (exceção da #3)"; #9, #23 e "Modos de festa" com a redação nova; aviso de pesquisa histórica no topo de `docs/pesquisa/render-voxel.md`. | — | — |

### 9.2 Alinhamentos entre os documentos de design
**Alinhamento feito em 02/11/2026.** Os valores da antiga coluna "Adotado" (partida de estreia, Testar, calibração, card do Laboratório, dicas, nomes de mapas e de zumbis, kill feed, contorno, caixas do bobo, zumbis por perfil, Destravar, mapa de calor, camadas do array, grade de luz, pool de cubinhos, FOV e favoritos) já estão escritos em `gameplay.md`, `tecnico.md` e `arte-ux.md`, e a tabela de divergências ficou vazia. Se surgir divergência nova, ela entra aqui com a coluna "Adotado", que vale até o alinhamento; os cabeçalhos dos três documentos remetem a esta seção.

**Escolhas desta rodada** (decisões do Claude com a liberdade da #45, revisáveis pelo Erick), já aplicadas nos quatro documentos:

| Tema | Adotado |
|---|---|
| Peças fora da grade | Formas do catálogo (laje, degrau, rampas, painel fino, poste + travessa, cruz) na malha do chunk com texturas 16×16; cilindros, barris e demais props no programa instanciado, com camadas 64×64 e até 15 draw calls por vista (8 no Switch 3–4P). Colisão só caixa ou rampa (5.2) |
| Draw calls no Switch 3–4P | ≤ 45 por vista no orçamento base; contorno fora dele, como extra condicionado ao M1 |
| Malha e luz do cenário | Montadas no loading, no cliente; pré-malha no build só se o Teste Zero pedir |
| Rosto do bobo | Face da frente do cubo da cabeça, 16×16 na camada 0 da skin (antes: quad instanciado próprio, 7ª parte, lendo a folha de rostos fora da skin) |
| Detritos | Programa instanciado, cor sólida por instância lida pela CPU no texel atingido |
| UV e bits do vértice do cenário | UV calculado no shader pela posição de mundo; céu, sol e emissivo com 4 bits, AO com 2 bits; o AO não escurece o emissivo (`tecnico.md` 6.3 e 6.4) |
| DOM na web | Quatro usos na casca: splash/aviso e input de texto [#3]; input de arquivo e link de download como exceção técnica [PADRÃO, registrado no `DECISOES.md`] |
| Construto | Área jogável de ~72×72 m e até 12 m de altura numa grade de 80×80×24 m |
| Corredor mínimo | 1,0 m (confortável 1,5–2,0 m); rota principal de 4–6 m é proposta da arte |
| Teto do PC em tela dividida 3–4P | 24 armados e 40 zumbis; a meta do PC de referência com 4 vistas usa 24 bots |
| Esquema de `preset@1` e `bot@1` | O da `gameplay.md` 10.4 e 6.7, com `look` único; IDs guardados sem prefixo de tipo |
| Vidro e água na cena-vitrine | Bancada de materiais fora da área jogável; o Construto jogável do M2 não tem vidro nem água |
| Mapas | Scripts TS compilados pelo `mapc`; o `mapview` só ajusta marcadores, nós de IA e câmeras |
| Perfil de movimento Bobo | No M0 (sim headless e robô de balanceamento) |

---

## 10. Glossário

| Termo | Significado |
|---|---|
| **ADS** | "Aim down sights": mirar com zoom. Existe em todas as armas; uma regra desliga. |
| **AO** | Oclusão ambiente: o escurecido nos cantos, calculado por vértice. |
| **Application mode** | Modo do Switch em que o homebrew tem acesso total (abrir segurando R ou instalar o NSP). O WebGL2 do nx.js só funciona nele. |
| **Aquário** | Assistir partidas só de bots e entrar no meio, assumindo um bot (M6+). |
| **Bobo** | O personagem: cabeçudo, 1,75 m, o boneco do FutBobo, feito de caixas com skin pixel-art. |
| **Bobo-zumbi** | Inimigo do Bobo Zombies: o mesmo bobo, curvado, esverdeado e engraçado. |
| **Boom Box** | A "bomba" de brinquedo do BoboStrike. |
| **Caixa Misteriosa** | Compra de arma aleatória no Bobo Zombies (950 pontos). |
| **Cena-vitrine** | Canto do Construto com todas as famílias de arte, usado para os prints de aprovação e para o Teste Zero. |
| **Chunk / região** | Pedaço da grade: chunk de 32³ células (16 m) para dados; região de 32×32×16 m para render. |
| **Construto** | Mapa 1: sala de teste gigante, homenagem ao gmod. |
| **Cubinhos / detritos** | Pequenos cubos cosméticos com a cor/textura do alvo, soltos em tiros e mortes. Não mudam o cenário. |
| **Cutout** | Textura com partes transparentes por alpha test (cercas, folhas, camada externa da skin). |
| **DDA** | Algoritmo que percorre a grade célula a célula; usado em colisão, tiro e linha de visão. |
| **Destravar** | Botão da pausa que leva o jogador preso ao ponto livre mais próximo. |
| **Diretor de Partida** | Sistema opcional que ajusta só os bots para manter a partida no nível escolhido (M6+). |
| **DrawList** | Lista de quads e textos que o pacote `ui` produz e o `render` desenha. |
| **ECA Digital** | Lei 15.211/2025, sobre serviços digitais acessados por crianças e adolescentes; revisar antes do M5. |
| **Eden** | Emulador de Switch usado como referência; não mede o desempenho real. |
| **F2** | Painel de debug, convenção EriLab. |
| **Flow field** | Campo de direções calculado uma vez e seguido por muitos bots (hordas de zumbis). |
| **Freguês** | Na tela de resultado, quem você mais matou. |
| **gmod** | Garry's Mod, origem da ideia (mapas de bots, sandbox). |
| **Greedy meshing** | Junta faces vizinhas iguais num quad só; aqui, por camada de textura, com a textura repetida no shader. |
| **Host autoritativo** | No online, o aparelho do host roda a simulação e os bots; os outros enviam inputs e recebem snapshots. |
| **InputFrame** | Pacote de ~10 bytes com as ações de um jogador num tick. Bots geram o mesmo pacote. |
| **InstancedMesh** | Desenho de muitas cópias de uma malha numa draw call; um por parte do bobo. |
| **Laboratório** | Editor de bots nos 4 eixos (inteligência, habilidade, personalidade, regras) + visual. |
| **LOCAL EDITION** | A versão do Switch: abre direto no lobby "aperte A". |
| **LOD de IA** | Níveis A, B e C: bots longe dos humanos decidem com menos frequência. |
| **MatchRecipe (receita)** | Descrição completa de uma partida; é a única entrada da sim. Um preset é uma receita com nome. |
| **MSDF** | Técnica de texto nítido em qualquer escala a partir de um atlas gerado no build. |
| **N0–N4** | Níveis de inteligência: Zumbi, Básico, Esperto, Time, Leitor. |
| **Nêmesis** | O bot que mais te matou na partida; dá para salvá-lo na Oficina. |
| **NRO / NSP** | Formatos de executável homebrew do Switch. |
| **nx.js** | Runtime JavaScript para Switch homebrew (V8 + WebGL2), usado no port do MMM. |
| **Oficina** | Biblioteca de bots salvos; com códigos para compartilhar no M6+. |
| **Partida Rápida** | Configurar uma partida em poucas escolhas: modo, mapa, nível, bots. |
| **Peça fora da grade** | Rampa, cilindro, cerca, vegetação em cruz ou prop low-poly que não é um bloco cheio. |
| **Perfil de movimento** | Bobo (padrão), Tático, Arcade ou Personalizado; regra da partida. |
| **Perfil de plataforma** | PC, celular, Switch 1P/2P/3–4P: define tetos de bots, visão, detritos e qualidade. |
| **portcheck** | Ferramenta que garante que o build do Switch não tem nada proibido e dá boot fora do navegador. |
| **Preset** | Partida salva com nome; os 5 últimos ficam salvos sozinhos. |
| **Regra de ouro** | Todo modo jogável solo com bots, em tela dividida e online quando faz sentido (checklist em 4.1.4). |
| **Robô de balanceamento** | Milhares de partidas bot × bot sem tela, com seed fixa, para calibrar armas e níveis. |
| **Sim headless** | A simulação rodando sem render, em Node, para testes e balanceamento. |
| **`SIM_HZ`** | Frequência da simulação: 60 Hz (30 no Switch se o Teste Zero exigir). |
| **Skin** | Textura 64×64 do bobo, com camada externa. |
| **STUN / TURN** | Servidores que ajudam o P2P a atravessar o NAT; o TURN repassa o tráfego quando a conexão direta falha. |
| **Surpreenda-me** | Botão que sorteia uma partida inteira. |
| **Teste Zero (T0)** | A cena-vitrine rodando no Switch real com 4 telas e bots, medindo FPS e memória, no M1. |
| **Teto** | Limite por perfil de plataforma (bots, visão). Começa conservador e sobe com medição. |
| **Texture array** | `TEXTURE_2D_ARRAY` do WebGL2: várias texturas do mesmo tamanho numa só, escolhidas por índice de camada. |
| **Trystero** | Biblioteca de P2P por WebRTC com sinalização em relays públicos (Nostr), usada no futbobo. |
| **TTK** | "Time to kill": tempo para matar sem errar. |
| **Viewmodel** | A arma e as mãos na tela em 1ª pessoa. |
| **X1** | Partida 1 contra 1 (preset do FFA). |
