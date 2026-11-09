# Plano do M2: MVP web solo (08/11/2026)

> Fonte: `docs/GDD.md` §3, §4 e §7; `docs/design/gameplay.md` §2–§10; `docs/design/tecnico.md` §16 e §24;
> `docs/design/arte-ux.md`. `docs/DECISOES.md` manda sobre este plano. A #60 fechou o M1; as escolhas do Erick para o
> M2 são as #61 (nomes), #62 (kit do Meu Bobo), #63 (áudio) e #64 (partida primeiro).

## Objetivo

O **primeiro lançamento jogável na web**: abrir o site, apertar JOGAR e jogar uma partida de verdade contra bots com
nome e jeito, no PC e no celular. Entram Bobo Warfare TDM e FFA, Bobo Training, Surpreenda-me simples, o Laboratório
com núcleo forte (#29), o Construto e mais uma arena pequena (Ringue) e as 8 armas. Tudo liberado desde o início (#16),
sem progressão.

O M1 deixou pronta a base: mundo, Construto, boneco do FutBobo com a farda (#56–#59), fuzil, bots N0, 1 a 4 vistas, HUD
mínimo, F2, bench e o NRO rodando no console. O M2 transforma essa cena em jogo.

## Critério de pronto (GDD §7)

1. Tudo da seção "O que entra" é jogável no site publicado, no PC e no celular.
2. **Orçamentos de download e tempo** (tecnico.md §16.4): menu ≤ 350 KB e em até 2 s no PC e 4 s no celular; primeira
   partida ≤ 1 MB acumulado e em até 5 s no PC e 10 s no celular. O CI reprova se estourar.
3. **Golden e balance no CI**, com os 5 níveis em ordem (Pela vibe < De boa < Normal < Suado < Tryhard).
4. **PC de referência a 60 fps com 40 bots**; Android de entrada a 30 fps com 12 bots (#49; o A04s já serviu de
   reserva no M1).
5. Checklist manual no celular.
6. **Checkpoint no Switch:** o MVP num NRO/NSP, 1 a 2 h de jogo solo no console.
7. **Prints aprovados pelo Erick** nas partes visuais novas: armas, Ringue, menus, resultado e Meu Bobo.

E, como nos marcos anteriores: `npm run check`, builds, `portcheck --strict`, `smoke:web` e golden verdes.

## O que entra

| Área | Entrega |
|---|---|
| Armas (`sim`, `render`, `modelgen`) | As 8 do GDD §4.3.2 (pistola, SMG, fuzil, escopeta, sniper, lança-foguetes, faca e granada); loadout de primária + pistola + faca + 2 granadas; troca em 0,4 s; ADS em todas; recoil com padrão fixo; pente + reserva; foguete e granada como projéteis (cozinhar a granada); explosão com área e autodano; modelos e viewmodel das armas novas; VFX de explosão e de tracer |
| Partida (`sim`, `game`) | TDM e FFA completos: meta, tempo, morte súbita, spawns pontuados, regeneração, caixinha de munição, proteção de spawn, plano de morte e limites; contagem de 3 s; câmera de morte de 1,5 s com o menu radial da primária; resultado (MVP, Nêmesis, Freguês, 3 números, prêmios bobos); pausa com Ajustar desafio e Destravar; anti-frustração (GDD §3.8); kill feed, placar, marcadores e indicador de dano |
| IA (`ai`) | Inteligência N1–N4 cumulativa; as 10 personalidades; habilidade e regras como dados; os 5 níveis rápidos; bots de fábrica; LOD de IA (A e B); a IA sabe quando usar cada arma; assistência de mira para controle e toque |
| Menus (`ui`, `game`) | Título (JOGAR · Surpreenda-me · Mudar), menu principal, Partida Rápida, Modos, Partida personalizada (abas Partida, Jogadores, Armas, Bots, Modificadores e Tela), resultado com De novo, Mais fácil, Mais difícil, Mudar regras e Salvar preset; Novidades; Ajustes |
| Dados (`format`, `platform`) | `preset@1` (5 últimos e 6 favoritos), `bot@1`, `settings@1`, `stats@1` e `backup@1`, versionados e com migração; save local com backup em arquivo; Copiar relatório |
| Laboratório | Editor de um bot nos 4 eixos + visual, rolar nome, Testar no Bobo Training em até 2 s, Oficina local (listar, duplicar, apagar, favoritar; até 500 bots), salvar o Nêmesis do resultado |
| Bobo Training + Ringue | Arena pequena com alvos fixos e móveis, bots do Laboratório em loop, precisão, TTK e % de cabeça; estação Calibrar mira; o Ringue também serve ao X1 |
| Jogador | Perfis de movimento Tático e Personalizado (o Bobo já existe); 3ª pessoa de ombro; FOV, sensibilidade e remapeamento; toque completo no celular; onboarding opcional (calibrar a mira, dicas de 1 linha, fantasma dos dedos) |
| Meu Bobo | Customização do jogador salva para sempre (#58): a farda (#59) como base, com tom de pele, rosto, cabelo, chapéu ou capacete, cor e camuflado, mais fantasias bobas como skins prontas extras (#62); bots com visual genérico, que sai do hash do nome |
| Áudio (`audio`) | ~40 SFX CC0 da Kenney e uma faixa de menu CC0 baixada, com crédito (#63); mixer completo (distância, oclusão barata, prioridade de vozes); indicador visual de som |
| Web | Qualidade escolhida na primeira abertura; service worker que só aplica atualização no menu; tela de Novidades |

## Fases

Uma de cada vez, nesta ordem. Cada fase termina verde (typecheck, testes, smoke). Quando há algo visual, termina com
prints para o Erick.

1. **Combate:** as 8 armas na sim, loadout, ADS, recoil, projéteis e explosões, modelos e viewmodel, e o robô de
   balanceamento calibrando o TTK.
2. **Partida:** regras completas de TDM e FFA, câmera de morte, menu radial, resultado, pausa e anti-frustração.
3. **IA:** N1–N4, personalidades, os 5 níveis, bots de fábrica, LOD e assistência de mira. O balance no CI passa a
   conferir a ordem dos 5 níveis.
4. **Menus e dados:** título, menu principal, Partida Rápida, Partida personalizada, presets, Ajustes, save, backup,
   estatísticas, Novidades e onboarding.
5. **Laboratório, Oficina, Bobo Training e Ringue**, com a faixa listrada no limite da área jogável (o Construto,
   fechado por paredes, não precisou).
6. **Meu Bobo, 3ª pessoa, perfis de movimento e toque completo.**
7. **Áudio:** SFX, música de menu e mixer.
8. **Fechamento:** prints, celular, checkpoint no Switch e publicação (com o OK do Erick).

## Fase 1 em detalhe: combate

Números da `gameplay.md` §4.3 (dano, cadência, pente, recarga, queda, tiros para matar). Passos:

- **1a. Sim: tabela e loadout.**
  - Cada arma ganha um **código numérico estável** (o fuzil é 0, como o slot 0 do M1). A `WeaponDef` ganha o tipo de
    disparo (bala, chumbos, projétil, golpe ou arremesso), os chumbos, a recarga por cartucho, o tempo de ADS e o zoom.
  - O estado passa a ser **por slot** (`loadout`, `slotClip`, `slotReserve`, 4 por bobo); `weapon` vira o código da
    arma na mão e `slot` o slot ativo.
  - A primária vem de `InputFrame.primary` e vale no próximo spawn (o menu radial da fase 2 escreve ali). No 1º spawn
    vem de `SimConfig.primaries`.
  - A escopeta soma os 8 chumbos por alvo, num dano por alvo e por tiro. A faca golpeia a 2 m (100 pelas costas). A
    sniper sem zoom tem dispersão enorme. O ADS tem tempo de entrada.
  - Testes: tiros para matar e TTK da tabela, cadência, recarga por slot e por cartucho, troca.
- **1b. Sim: projéteis e explosões.**
  - Um pool fixo de projéteis no estado (entra no snapshot e no hash).
  - O foguete voa reto a 35 m/s e explode no contato. A granada tem gravidade, quica e explode no pavio; segurar o
    gatilho a "cozinha".
  - A explosão cai em linha reta até a borda, passa pela linha de visão do centro até o corpo e aplica 50% de
    autodano. Eventos `projectile` e `explosion` para o render e o áudio.
- **1c. Render e arte.** Modelos e viewmodel das armas novas (`modelgen`), foguete e granada em voo, explosão (clarão
  e cubinhos), zoom da sniper. As armas novas usam a empunhadura mais parecida das 3 do boneco (pistola, fuzil,
  sniper).
- **1d. IA.** Alcance preferido por arma, troca para a pistola com a primária vazia, faca quando colado, foguete no pé.
  As granadas da IA chegam com o N2 (fase 3). Cada bot tem uma primária.
- **1e. Jogo e HUD.** "Rattler · Fuzil", munição do slot, granadas, mira por arma, teclas 1–4 e a roda do mouse.
  A primária do humano usa um padrão (o menu radial é da fase 2).
- **1f. Prints para o Erick:** as 8 armas em linha, o viewmodel de cada uma e a explosão. Rodada 5 aprovada no
  padrão (#65).

## Fase 2 em detalhe: partida

O M1 já tem placar por time, relógio, meta, plano de morte, área jogável, proteção de spawn (1,5 s ou até atirar),
regeneração e respawn de 3 s. A fase 2 completa as regras (`gameplay.md` §2.2, §5 e §11; GDD §3.8) e põe a partida
na tela. Passos:

- **2a. Sim: regras.** Pronta em 08/11 (`ARCHITECTURE.md` §12.7).
  - **Contagem de 3 s** na fase `warmup`: dá para olhar em volta, mas não andar, atirar nem trocar de arma, e o
    relógio não corre. O padrão da sim é 0 s (golden e balance não mudam); o `game` passa 3 s nas partidas de verdade.
  - **Morte súbita:** empate no fim do tempo abre 60 s (fase `suddenDeath`); o primeiro abate que desempata encerra.
    Se o empate continuar, a partida acaba empatada.
  - **Vencedor do FFA:** `winnerEntity` (no FFA todo mundo está no time 0).
  - **Assistências:** cada bobo guarda os 4 últimos agressores, com o dano somado e o tick. Conta como assistência
    quem fez 25 ou mais nos últimos 10 s; o `KillEvent` leva o maior assistente.
  - **Crédito do plano de morte:** se alguém feriu a vítima nos últimos 5 s, o abate é dele; senão é acidente.
  - **Spawn pontuado:** no FFA, ponto sem linha de visão de inimigo e a mais de 20 m dele, com sorteio entre os 3
    melhores; no TDM, o ponto do time com menos inimigos à vista. A linha de visão só é testada nos candidatos melhores,
    em ordem, até achar 3.
- **2b. Caixinha de munição e Destravar (sim, IA, render).** Pronta em 08/11 (`ARCHITECTURE.md` §12.8).
  - **Caixinha:** quem morre no Bobo Warfare deixa uma caixinha que cai até o chão e some em 20 s. Quem passa por
    cima ganha 1 pente da primária e da pistola e 1 granada (até 2), se tiver espaço. É um pool fixo no estado, como os
    projéteis, com modelo próprio.
  - **Destravar:** bit novo `BUTTON.unstuck`. A sim leva o bobo ao nó de navegação mais próximo a pelo menos 2 m dali.
    No bot, escolhe um nó fora da vista dos humanos quando der.
  - **Bot parado:** a IA aperta o mesmo botão depois de 8 s sem progresso na rota. Na 3ª vez na mesma vida, a sim
    manda o bot para um spawn. O evento `unstuck` vai para o F2, com o ponto onde ele estava.
- **2c. Morte e respawn (`game`).** Pronta em 08/11 (`ARCHITECTURE.md` §12.9).
  - Câmera de morte de 1,5 s olhando quem matou, com "nome · arma · HP".
  - Menu radial da primária, que escreve `InputFrame.primary`, e a contagem para renascer.
  - A linha "Tá puxado? Pausa → Ajustar desafio" (derrota feia, 1 vez por partida).
- **2d. HUD da partida.** Pronta em 09/11 (`ARCHITECTURE.md` §12.10); a faixa listrada foi para a fase 5.
  - A contagem inicial com os nomes dos inimigos ("Hoje: 6 Jorges").
  - Kill feed, placar no Tab (ou Select), o aviso de morte súbita e o indicador direcional de dano.
  - Marcadores dos aliados, a caixinha no chão e a faixa listrada no limite do mapa.
- **2e. Pausa e resultado.** Pronta em 09/11 (`ARCHITECTURE.md` §12.11).
  - **Pausa:** Continuar · Ajustar desafio (muda o nível rápido dos bots no meio da partida) · Ajustes · Destravar ·
    Sair. Na web, pede confirmação antes de fechar a aba no meio da partida.
  - **Resultado:** vencedor e placar, MVP, Nêmesis, Freguês, os 3 números (abates, precisão e maior sequência) e até 3
    prêmios bobos. As contas saem dos eventos, num módulo puro com testes.
  - **Botões do resultado:** De novo, Mais fácil, Mais difícil e Sair. Mudar regras, Salvar preset e "Salvar na
    Oficina" aparecem desligados até as fases 4 e 5.
- **2f. Prints para o Erick:** contagem, câmera de morte com o menu radial, kill feed, placar, pausa e resultado.
  Rodada 6 aprovada no padrão (#66), o que fecha a fase 2.

## Fase 3 em detalhe: IA

Base do M1: soldado N0 (alvo visível, rota pelo A*, as armas da fase 1d), LOD A/B, os 5 níveis rápidos (só
habilidade) e o robô de balanceamento com a ordem dos níveis. A fase 3 dá os outros eixos do bot (gameplay.md §6):

- **3a. Dados do bot.** Pronta em 09/11 (`ARCHITECTURE.md` §12.12). `bot@1` no `format`: habilidade, inteligência (nível e comportamentos), personalidade e
  regras; validador com faixas; os 12 bots de fábrica (`BUILTIN_BOTS`, ids `bot:*`, nomes na tabela de textos);
  `embeddedBots` validados na receita; `resolveBot`. A IA passa a ler o bot pelo documento; os bots de nível sorteiam
  a personalidade da mistura (50/20/15/15) num fluxo próprio. Golden igual.
- **3b. Regras por bot na sim.** Pronta em 09/11 (`ARCHITECTURE.md` §12.13). Vida, multiplicador de dano, velocidade, arma fixa ou lista, munição infinita,
  imune a tiro de cabeça e explodir ao morrer. Tamanho fica para depois (hitbox e navegação).
- **3c. N1.** Pronta em 09/11 (`ARCHITECTURE.md` §12.14). Audição (tiro 50 m, passo correndo 15 m, andando 6 m), cobertura ao tomar dano, recarregar
  protegido, investigar som, patrulha.
- **3d. N2.** Pronta em 09/11 (`ARCHITECTURE.md` §12.15). Flanquear (outra rota quando a direta tem inimigo), segurar ângulo, recuar com vida baixa e granadas.
- **3e. N3.** Pronta em 09/11 (`ARCHITECTURE.md` §12.16). O que um vê, o time sabe (com ícone de ping para os humanos aliados), andar em dupla ou trio, cerco.
- **3f. N4.** Pronta em 09/11 (`ARCHITECTURE.md` §12.16). Mapa de calor de 4 m que decai em 2 min (onde você fica e de onde mata): pré-mira, granada, evitar a rota
  onde morreu, fingir recuar.
- **3g. Personalidades.** Pronta em 09/11 (`ARCHITECTURE.md` §12.17). As 10 do §6.4 com comportamento visível, e os bots de fábrica jogando (Jorge, Carl,
  Ninja, Sam, Hank, Buddy, Gus).
- **3h. Assistência de mira e balanço.** Pronta em 09/11 (`ARCHITECTURE.md` §12.18). Rodada 7 de prints aprovada no padrão (#67), o que fecha a fase 3. Assistência para controle e toque; o robô confere os 5 níveis em ordem e o
  golden fecha.

## Fase 4 em detalhe: menus e dados

Fontes: arte-ux.md §6.3, §6.4, §6.12 e §8; gameplay.md §2.5, §4.5, §10 e §11; tecnico.md §14. Tudo navegável só com
D-pad + confirmar/voltar, alvos de toque ≥ 44 px, nada de botão "em breve" (cada item aparece quando o marco dele
chega) e o menu dentro de 350 KB (o `size-check` confere a cada subfase).

- **4a. Peças de UI que faltam.** Pronta em 09/11 (`ARCHITECTURE.md` §12.20).
  - seletor de valor ("‹ Normal ›": esquerda e direita no D-pad, setas no toque e no mouse);
  - alternador (sim/não) e passo numérico (vida, tempo, bots);
  - abas (LB/RB, Q/E, toque);
  - lista com rolagem que segue o foco (presets, e depois a Oficina);
  - card com título, linha de texto e botão.
  Testes de layout e de navegação só com o D-pad.
- **4b. Dados e save.** Pronta em 09/11 (`ARCHITECTURE.md` §12.21).
  - `settings@1` (controles por dispositivo, vídeo, acessibilidade) e `stats@1` (partidas, vitórias, abates,
    recordes);
  - a lista de presets: os 5 últimos (o último é o do JOGAR), até 200 salvos (50 no Switch) e 6 favoritos;
  - `backup@1` com tudo junto, versionados e com migração;
  - um `SaveStore` no `game` sobre `platform.storage`, que grava com debounce e lê com validação e migração;
  - exportar e importar o backup em arquivo (`platform.files`).
- **4c. Título, menu principal e partida de estreia.** Pronta em 09/11 (`ARCHITECTURE.md` §12.22).
  - **JOGAR** usa o último preset. Na primeira vez, a partida de estreia: TDM 4v4 no Construto, você com 3 aliados,
    todos no De boa, 5 min ou 30 abates (#21).
  - **Surpreenda-me:** card com o sorteio (modo, nível, bots), "Rolar de novo" e "Jogar".
  - **Mudar** leva ao menu principal: Partida Rápida, Modos, Ajustes e Novidades. O Laboratório e o Meu Bobo entram
    nas fases 5 e 6.
- **4d. Partida Rápida e Modos.** Pronta em 09/11 (`ARCHITECTURE.md` §12.23).
  - Rápido: modo, mapa, nível, bots e duração, com COMEÇAR fixo; os 6 favoritos e os 5 últimos como atalhos;
  - Modos: grade de cards (Warfare TDM e FFA; o Training entra na fase 5) → configurar → COMEÇAR;
  - os presets de fábrica cujo modo já existe (Vibe, Tryhard, Imortais).
- **4e. Partida personalizada.** Pronta em 09/11 (`ARCHITECTURE.md` §12.24 e §12.25).
  - abas Partida, Jogadores, Armas, Bots, Modificadores e Tela (gameplay.md §10.3);
  - os modificadores de arma do M2 que a sim ainda não tem (§4.5): só headshot, um tiro mata, ADS, recoil, spread,
    fogo amigo, autodano, sniper mata no corpo; e a gravidade;
  - Salvar preset (nome do gerador, sem digitar) e o corte aos tetos da plataforma, com aviso do que mudou;
  - no resultado, "Mudar regras" e "Salvar preset" ligados;
  - `?bots=fabrica` e `?nivel=` saem da web (a aba Bots faz o mesmo).
- **4f. Ajustes.** Pronta em 09/11 (`ARCHITECTURE.md` §12.26 e §12.27).
  - Controles: sensibilidade por dispositivo, multiplicador no ADS, Y invertido, assistência (Desligada, Leve, Média,
    Forte), alternar ou segurar, zonas mortas e remapeamento do teclado e do controle;
  - Vídeo: qualidade, escala da UI, FOV;
  - Acessibilidade: reduzir tremor, cores de time para daltônico, dicas on/off, tamanho do HUD;
  - Dados: exportar e importar o backup, com o aviso de que limpar o navegador apaga bots e presets;
  - Sobre: Copiar relatório (#42), créditos e versão;
  - os volumes chegam com o áudio (fase 7).
- **4g. Estatísticas e Novidades.** Pronta em 09/11 (`ARCHITECTURE.md` §12.28).
  - `stats@1` gravado no fim de cada partida, com "Recorde!" no resultado;
  - a tela de Novidades (codinome e até 5 itens), que aparece uma vez depois de atualizar e avisa as migrações.
- **4h. Onboarding opcional.** Pronta em 09/11 (`ARCHITECTURE.md` §12.29).
  - dicas de 1 linha nas 2 primeiras partidas, com os glifos do dispositivo ativo;
  - a troca de glifos ao mudar de dispositivo;
  - "Gire o celular" em retrato;
  - a calibração da sensibilidade (3 alvos) e o card "Conheça o Laboratório" entram com o Bobo Training e o
    Laboratório (fase 5).
- **4i. Prints para o Erick.** Publicada em 09/11 (rodada 8, versão 9 da página das rodadas; perguntas D1–D8): título, menu principal, Partida Rápida, Partida personalizada, Ajustes, Novidades e o
  resultado com Salvar preset.

## Fase 5 em detalhe: Laboratório, Oficina, Bobo Training e Ringue

Escrito em 09/11/2026, com a fase 4 fechada e a rodada 8 publicada. Ordem: primeiro os dados e as telas dos bots
(sem mapa novo), depois o Ringue e o modo de treino, e por fim as pontes entre eles.

- **5a. Oficina.** Pronta em 09/11 (`ARCHITECTURE.md` §12.31).
  - a biblioteca dos bots: os 12 de fábrica e os seus;
  - o card do bot, com toda regra ativa à vista (§6.5);
  - duplicar, apagar e favoritar;
  - o save ganha as operações dos bots, com o teto de 500 na web e 100 no Switch;
  - o menu principal ganha "Laboratório", que abre na Oficina.
- **5b. Laboratório.** Pronta em 09/11 (`ARCHITECTURE.md` §12.32 e §12.33).
  - edita um bot por vez, partindo de um da biblioteca;
  - abas: Nível (os 5 níveis preenchem tudo), Habilidade, Inteligência (com o modo avançado), Personalidade, Regras e
    Nome ("rolar nome", com o gerador de nomes bobos em inglês);
  - salvar na Oficina;
  - a aba Bots da Partida personalizada lista os seus bots, que vão embutidos no preset (`embedded:<id>`).
- **5c. Ringue.** Pronta em 09/11 (`ARCHITECTURE.md` §12.34).
  - arena pequena, de 30×30 a 40×40 m, com alvos e estandes;
  - a faixa listrada no limite da área jogável;
  - entra nos seletores de mapa (Partida Rápida e personalizada).
- **5d. Bobo Training.** Pronta em 09/11 (`ARCHITECTURE.md` §12.35).
  - o modo na sim, sem placar;
  - bots do Laboratório em loop, de 1 a N;
  - alvos fixos e móveis (bonecos de caixas com a skin de treino);
  - a HUD mostra a precisão, o TTK médio e a % de cabeça.
- **5e. Pontes.** Pronta em 09/11 (`ARCHITECTURE.md` §12.36).
  - **Testar:** do Laboratório para o Bobo Training em até 2 s; na volta, a precisão do bot, o seu K/D e o TTK médio;
  - **Nêmesis:** "Salvar na Oficina" no resultado;
  - **Conheça o Laboratório:** o card no fim da 1ª partida;
  - **Tryhard:** no nível mais alto, "Mais difícil" vira "Abrir Laboratório".
- **5f. Calibrar mira.** Pronta em 09/11 no Bobo Training e nos Ajustes (`ARCHITECTURE.md` §12.37); a da 1ª
  partida ficou para depois.
  - a estação do Bobo Training: 3 alvos, "Ajustei sua mira" com Desfazer;
  - a contagem estendida da 1ª partida (gameplay.md §2.5), com Pular.
- **5g. Prints para o Erick.** A rodada 9 saiu em 09/11, antes da 5f (versão 10 da página, junto com a 8; perguntas
  E1–E6); a calibração entra na rodada seguinte: Oficina, Laboratório, Ringue, Bobo Training, Testar e calibração.
  Respondidas em 09/11 (#68, #69).

## Fase 6 em detalhe: Meu Bobo, 3ª pessoa, perfis de movimento e toque

Escrito em 09/11/2026, com as rodadas 8 e 9 respondidas. Ordem: primeiro o que é só número e regra (perfis), depois a
câmera, depois o Meu Bobo (o maior pedaço) e por fim o toque, que precisa de tudo o resto para mapear os botões.

- **6a. Perfis de movimento** (gameplay.md §3.3–§3.6). Pronta em 09/11 (`ARCHITECTURE.md` §12.39).
  - Tático na sim, com os números da tabela; o Arcade continua fora (M6+);
  - Personalizado: velocidade 0,5–2×, pulo 0,5–3×, mais a gravidade e o dano de queda que já existem;
  - a aba Jogadores da Partida personalizada ganha o perfil;
  - a navegação e os bots leem a altura de pulo e de escalada do perfil da partida.
- **6b. 3ª pessoa** (gameplay.md §3.5; tecnico.md §9). Pronta em 09/11 (`ARCHITECTURE.md` §12.40).
  - câmera de ombro, com troca de ombro e colisão contra o cenário;
  - o tiro sai do olho, mirando no ponto que o raio da câmera acerta;
  - o próprio bobo aparece inteiro, com a arma na mão e sem viewmodel;
  - nos Ajustes: 1ª ou 3ª pessoa e o ombro; na receita: a regra "Câmera permitida" (1ª e 3ª, ou só 1ª).
- **6c. Meu Bobo** (#17, #58, #62; GDD §4.7.2; arte-ux.md §2.4). Pronta em 09/11 (`ARCHITECTURE.md` §12.41).
  - o look do jogador salvo para sempre num documento versionado;
  - o editor numa cena própria: o bobo girando num pedestal, com as abas ao lado;
  - abas: Pronto (os looks da farda e as fantasias), Rosto, Cabelo, Chapéu e Roupa, mais "Aleatório";
  - o jogador 1 entra na partida com o seu look (com o colete do time por cima).
- **6d. Fantasias** (#62). Pronta em 09/11 (`ARCHITECTURE.md` §12.42): Astronauta, Pijama, Robô de papelão e
  Mergulhador, esperando o print. As skins prontas extras, com a lista final por print (proposta: astronauta, pijama e robô de
  papelão, mais as do banco de ideias que couberem).
- **6e. Toque completo** (arte-ux.md §7.3). Pronta em 09/11 (`ARCHITECTURE.md` §12.43); tocar no ícone da arma
  ficou para depois.
  - trocar de arma tocando no ícone dela;
  - atirar sozinho, layout canhoto e o limitador de 30/60 FPS nos Ajustes;
  - o "fantasma dos dedos" nas primeiras partidas no celular;
  - os botões que faltam (faca, 3ª pessoa).
- **6f. Prints para o Erick.** Rodada 10: a calibração (5f) e a fase 6 (perfis, 3ª pessoa, Meu Bobo, fantasias e
  toque). Publicada em 09/11 como versão 11 da página das rodadas (perguntas F1–F7, `local/m2/montar-pagina-r10.mjs`).

## Fase 7 em detalhe: áudio

Escrito em 09/11/2026, com o OK do Erick para baixar os 3 pacotes da Kenney (Impact Sounds 1.0, 0,76 MB; Sci-Fi
Sounds 1.0, 5,60 MB, os dois com o mesmo hash do M1; Interface Sounds 1.0, 0,80 MB, novo). Base: arte-ux.md §10.4–§10.6,
GDD §5.10 e tecnico.md §12. O mixer do M1 (24 vozes, canais, distância e pan, ouvinte mais próximo, mono) já existe.

- **7a. Banco de sons.** Pronta em 09/11 (`ARCHITECTURE.md` §12.44): 52 sons: os tiros das 5 armas de fogo (a LMG de reserva usa o do fuzil) **sintetizados em código** (perto e longe, que
  troca além de 30 m), faca, foguete, bipes e o "PLOC" do headshot também sintetizados (0 KB de download); impactos e
  passos por família de material (o `stepSound` dos blocos), recarga, troca, sem munição, granada, explosão, acertos,
  morte, caixinha e UI vindos da Kenney. Todos os MP3 contam nos sons essenciais da primeira partida (≤ 150 KB) e
  carregam depois do menu, em segundo plano.
- **7b. Sons da partida.** Pronta em 09/11 (`ARCHITECTURE.md` §12.45). Eventos da sim → mixer, com a prioridade de arte-ux §10.4 (sua arma > dano em você >
  inimigos perto > aliados > ambiente), cooldown por som, só os passos dos 4 bots mais próximos de cada ouvinte, −6 dB
  atrás de parede (raio na grade), hitmarker "plic", headshot "PLOC", kill, dano, vida baixa e a contagem.
- **7c. Interface e Ajustes.** Pronta em 09/11 (`ARCHITECTURE.md` §12.46). Sons de navegar, confirmar, voltar e trocar valor nos menus; aba Áudio nos Ajustes
  (Geral, Efeitos, Música, Interface, saída mono, música na partida e indicador visual de som); o indicador como anel
  em volta da retícula (tiros e passos até 20 m).
- **7d. Música do menu.** Pronta em 09/11 (`ARCHITECTURE.md` §12.47 e §12.48): "Toy Soldiers", de Zane Little Music
  (CC0), baixada com o OK do Erick no chat (a G6 da rodada 11). Tocador em loop com fade e a música 6 dB mais baixa nas explosões; carrega depois do menu
  (`assets/music/`, sob demanda). A faixa CC0 espera o OK do Erick (nome, origem e tamanho).
- **7e. Rodada 11.** Página para ouvir os sons, mais os prints da aba Áudio e do indicador. Publicada em 09/11 como
  versão 12 da página das rodadas, junto com a rodada 10 ainda sem resposta (perguntas G1–G6;
  `local/m2/montar-pagina-r11.mjs`). A G6 é o OK do download da música do menu.

## Fase 8 em detalhe: fechamento

Escrito em 09/11/2026, depois de conferir o "O que entra" contra o código. Três entregas do M2 ainda faltavam: o visual
dos bots pelo nome, a qualidade na primeira abertura (tecnico.md §17.2; o `video.quality` existia no save sem efeito) e
o service worker (tecnico.md §19.1). Entram antes do portão final.

- **8a. Visual dos bots pelo nome.** Pronta em 09/11 (`ARCHITECTURE.md` §12.50). O look da rotação sai do hash do nome do bot, não do índice do controlador: o mesmo
  bot veste o mesmo look em qualquer partida.
- **8b. Qualidade.** Pronta em 09/11 (`ARCHITECTURE.md` §12.51). Linha "Qualidade" na aba Vídeo (Automática, Leve, Média, Alta), aplicada na escala de resolução,
  nos detritos e, no Leve, na visão. A Automática lê o aparelho (GPU, núcleos, memória, tela) e a lista de GPUs fracas,
  e escolhe uma vez; a escolha fica no save e não volta a rodar depois que o jogador mexe.
- **8c. Service worker** pronto em 09/11 (`ARCHITECTURE.md` §12.52), escrito à mão (sem dependência nova): escopo próprio, precache da casca e cache-first nos
  arquivos com hash. A versão nova só é aplicada no menu; depois de atualizar, aparece a tela de Novidades.
- **8d. Portão e medições:** `npm run check`, builds, `size-check`, `portcheck --strict`, `smoke:web`, balance e o bench
  do PC com 40 bots, tudo registrado no `PERF.md`.
- **8e. Roteiros:** o checklist do celular e o checkpoint do Switch (1 a 2 h de jogo) para o Erick seguir.
- **8f. Rodada 12 e publicação:** prints do que a 8a–8c mudaram e, com o OK do Erick, push e deploy.

## Escolhas do Claude neste plano (revisáveis)

- **Partida antes dos menus:** o combate e as regras são o que dá para jogar e medir; os menus vêm quando os dados da
  partida (`preset@1`, regras) já existem, para não serem refeitos.
- **Trabalho econômico** (pedido do Erick): fase por fase, direto na sessão, sem workflows de muitas frentes; subagente
  só para tarefa mecânica ou revisão de escopo fechado.
- **Kaboomer entra**; se o explosivo atrasar, a LMG entra no lugar (GDD §4.3.2).
- **Bots de fábrica com visual genérico** (#58): farda na cor do time e rosto e cabelo pelo hash do nome.
- **A Partida personalizada cobre 2 times** (até 4 times é do Bobo Sandbox, M6+).
- **Sem rodada de otimização no meio do M2** (#60): os orçamentos do critério continuam valendo, mas a pré-malha e o
  aquecimento ficam para a rodada combinada.

## O que precisa do Erick

- ~~As escolhas do início do M2~~ **Respondidas em 08/11/2026** (#61–#64).
- O OK para cada download (pacotes da Kenney e a faixa de menu), com nome, origem e tamanho, quando a fase 7 chegar.
- Aprovar os prints ao fim das fases visuais, inclusive a lista final das fantasias (#62).
- No fechamento: celular, Switch e o OK para commit, push e deploy.

## Fora do M2

Tela dividida local, lobby "aperte A" e Bobo Zombies (M3); port completo do Switch (M4); online (M5); modos de festa,
Diretor de Partida, Aquário, códigos `BF1-`/`BFP1-` e esquadrões (M6+); a rodada de otimização (#60, quando o Erick
quiser).
