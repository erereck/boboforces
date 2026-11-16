# Plano do M4: Port do Switch (16/11/2026)

> Fonte: `docs/GDD.md` §3.6, §4.1.3, §4.8 e §7; `docs/design/tecnico.md` §9, §11, §14 e §21; `docs/TESTE_ZERO.md` §8c;
> `docs/ROTEIRO_M3.md`; `docs/PORTABILIDADE.md`. `docs/DECISOES.md` manda sobre este plano: a ordem dos marcos é a #28
> (MVP web, Local, **Switch**, Online) e o refino pedido antes do M4 (#79, `docs/PLANO_REFINO.md`) está feito. O M3
> fechou em 16/11/2026 (#78): o Erick jogou no console emprestado ("tudo rodou 100% de boa"), mas sem os logs, que
> voltam quando o console voltar.

## Objetivo

**O BoboForces como um jogo de Switch de verdade**, a LOCAL EDITION: abre direto no lobby "aperte A", joga tudo o que
existe até o M3 (TDM, FFA, Training, Surpreenda-me, Bobo Zombies), sozinho ou com até 4 no sofá, 100% offline, com o
save no SD, sem nenhum arquivo de terceiros no repositório (#33: uso pessoal; `prod.keys`, `.nro` e `.nsp` nunca entram
no git nem no CI). O M0 a M3 já deixaram a casca, o save, o ciclo de vida e o NRO de pé; o M4 **acaba o que falta,
mede o jogo inteiro no console e empacota o NSP**.

## Critério de pronto (GDD §7)

1. **4 jogadores em Bobo Zombies a 30 fps por 20 min**, na dock e no portátil, sem crash e **com o heap estável**
   (definição na P8).
2. **NSP instalado no console do Erick**, abrindo pelo HOME com ícone, nome e title ID próprios, sem segurar R.
3. A **LOCAL EDITION** como o GDD §3.6 descreve (lobby direto, só o P1 nos menus globais, `+` pausa, sair só por "Sair
   do jogo", dock/portátil, desconexão e HOME reabrem o "aperte A").
4. **Teste Zero 2 com o jogo inteiro** (todos os modos e telas no console, roteiro `docs/ROTEIRO_M4.md`) e o item 13
   (loading) e o 15 (travadas iniciais) do Teste Zero sem reprovar, ou com a razão registrada.
5. Como nos marcos anteriores: `npm run check`, builds, `portcheck --strict`, `smoke:web`, golden, balance e
   `size-check` verdes; **o menu da web continua ≤ 350 KB** (hoje 347,3 KB, sobram 2,7 KB: mexer nele pede abrir espaço
   antes).

## O que já existe (levantado em 16/11/2026)

Tudo isto está em `apps/switch/` e nos pacotes, e **não precisa ser refeito**, só conferido no console:

| Item do GDD (linha M4) | Estado hoje | Onde |
|---|---|---|
| `platform-switch` | Feito no M0/M1: gráficos (720p, sem AA), áudio (mixer sobre Web Audio do nx.js), entrada (4 controles, teclado USB com mira nas setas, #73), arquivos, diagnóstico, quadros, `textInput` | `apps/switch/src/platform/*` |
| Save no SD com backup | Feito: `save.json` + `save.backup.json` (cópia antes de cada escrita; save corrompido abre pelo backup) + `save.previous.json` (backup por chave); escrita com debounce de 250 ms, `flush` ao pausar e ao sair | `platform/storage.ts` |
| Importar e exportar | Feito, mas em pastas **diferentes do GDD**: `importar/` (pega o arquivo mais recente) e `exportar/`; o GDD §4.8 e o `tecnico.md` §9 dizem `oficina/` | `platform/files.ts` |
| `runtime.log` | Feito: rotação em 1 MB (`runtime.old.log`), boot, erros, ciclo de vida, `[bench]` | `platform/diagnostics.ts`, `t0/log.ts` |
| Ciclo de vida | Feito por amostragem (o nx.js não tem evento de HOME): vão > 1 s = HOME/sleep; troca de `operationMode` (dock e portátil) e controle perdido pausam; o relógio do áudio desempata "JS ocupado" de suspensão. **Falta conferir no console o item 20 numa partida real** (HOME e sleep) | `platform/lifecycle.ts` |
| Teclado na tela | `platform.textInput` pelo swkbd (`navigator.virtualKeyboard` do nx.js); sem ele, `available` é falso e a UI esconde a digitação. Provado no Eden/console nos itens de teste do M1 | `platform/text-input.ts`, `t0/runners/keyboard.ts` |
| NACP, title ID, NRO e NSP | `package.json` da casca tem título BoboForces, autor EriLab, ID `01E1AB0B0B0F0000` (prefixo EriLab do MMM), `startupUserAccount 0`, `userAccountSaveDataSize 0`; `npm run nro` e `nsp` e os `verify:*` existem. **Falta o `icon.jpg`** (hoje sai o ícone padrão do nx.js) e **nenhum NSP foi instalado ainda** | `apps/switch/package.json`, `scripts/*` |
| Teste do sofá e lobby | O lobby "Jogar no sofá" (M3) já roda no Switch com a mesma tela da web; o título ainda existe e o JOGAR do título é solo | `game/src/game.ts`, ARCHITECTURE §13.2–13.3 |
| Bench no console | `bench.json` no SD abre direto no bench (`dock`, `solo`, `zombies` com 4 vistas); o relatório vai para o `runtime.log` | `t0/auto-bench.ts`, `docs/TESTE_ZERO.md` §6 |
| V8 no console | `romfs:/nxjs.ini` com `[v8] flags = --no-sparkplug` (issue #424 do nx.js; sem isso o boot cai no modo aplicativo); JIT com Maglev e TurboFan | `scripts/stage.ts` |
| Orçamento medido (M1) | Dock, 4 vistas, 12 bots: 59,57 fps, p99 18 ms; portátil 1P, 24 bots: 57,55 fps; heap máx 43,7 MB de 537; 24 zumbis a 58,84 fps | `PERF.md` §4 |

## O que falta (mapa da linha do GDD)

| Linha do GDD §7 | Falta |
|---|---|
| LOCAL EDITION com tudo até o M3 | Abrir **direto no lobby**, sem título; mostrar a última partida e os atalhos; "Sair do jogo"; B tira o jogador; reabrir o "aperte A" depois de dock/portátil, desconexão e HOME (hoje só pausa) |
| `platform-switch` completo | Conferir no console o que o M1 deixou sem rodar: item 17 (4 controles), tela de áudio, item 20 numa partida; bateria só é **sondada**, não aparece na UI |
| Save no SD com backup | Backup datado e à vista do jogador; tratamento de SD cheio ou só leitura; conferir a migração do `save.json` do M3 |
| Bots e presets por arquivo no SD | Ler `oficina/*.json` (`bot@1`, `preset@1`) no boot e na tela da Oficina; hoje só o "importar o arquivo mais recente" do backup |
| NACP, ícone, title ID | Gerar o `icon.jpg`; confirmar o title ID no console; NSP gerado, verificado e instalado |
| Glifos genéricos | Os prompts de botão ("A confirma") por tipo de controle, sem desenho de marca; hoje a UI usa texto e os símbolos do jogador (P1 ▲, P2 ●, P3 ■, P4 ◆). Não achei no código uma folha de glifos de botão (a confirmar na fase 4) |
| Teclado na tela | O swkbd só funciona onde o nx.js o expõe; falta o **teclado próprio no canvas** (D-pad + confirmar/voltar, regra "todo fluxo só com D-pad") como reserva, para nome de jogador, bot e preset |
| Ciclo de vida (bateria) | Aviso de bateria baixa; reconexão de controle sem perder o assento |
| Teste Zero 2 | Roteiro com o jogo inteiro; 4P Zombies por 20 min; amostras de heap no `runtime.log` |
| Pendências do Teste Zero (#60) | Loading da 1ª cena ~5 s (item 13); travadas iniciais (item 15); a queda do "plano B" (atlas + float) com causa desconhecida; o reinício do console (17:29, não repetido) |

## Fases

Uma de cada vez, nesta ordem; cada fase termina verde e commitada (sem push; só com pedido do Erick). **Tudo o que
dá para conferir no PC, na web e no Eden vem primeiro; o que só o console responde fica junto num único checkpoint
(fase 8), como no M3.** O Eden vale para boot, menu e "não cai"; **nunca para tempo de quadro** (#48).

1. **LOCAL EDITION:** o lobby como porta de entrada, "Sair do jogo", reabrir o "aperte A". (Feita em 16/11/2026,
   ARCHITECTURE §15.1; a 1e foi para a fase 3.)
2. **Save e arquivos no SD:** backup, `oficina/` para bots e presets, SD ruim. (Feita em 16/11/2026, ARCHITECTURE
   §15.2: a cópia do dia e a `oficina/`; o aviso na tela de SD ruim e o botão Restaurar ficaram de fora, com a razão.)
3. **Ciclo de vida:** dock/portátil com as vistas, HOME/sleep, reconexão, bateria. (Feita em 16/11/2026,
   ARCHITECTURE §15.6: a página Jogadores da pausa no lugar de voltar ao lobby, e a bateria na pausa; HOME e sleep
   esperam o console.)
4. **Glifos genéricos e teclado na tela.** (Feita em 16/11/2026, ARCHITECTURE §15.7: o teclado do jogo no
   Laboratório e o glifo do botão de face nas dicas; a opção nos Ajustes ficou de fora pelo teto do menu.)
5. **Desempenho:** pré-malha e navegação no `.bfmap`, aquecimento completo, o plano B. (A 5a espera o console:
   ARCHITECTURE §15.4. A 5b e a 5c feitas em 16/11/2026, §15.8: o frame do aquecimento desenha cada efeito e
   boneco uma vez, e o Switch ficou só com array + inteiro.)
6. **NACP, ícone, title ID e NSP.** (O ícone, 6a, feito em 16/11/2026: ARCHITECTURE §15.3.)
7. **Teste Zero 2, preparação:** roteiro, amostras de heap, bench de 20 min, rodada de prints no Eden. (7a e 7c
   feitas em 16/11/2026: ARCHITECTURE §15.5 e `docs/ROTEIRO_M4.md`; a 7b também, §15.8: o "Bench 20 min".)
8. **Checkpoint do console** (o Erick; lote único).
9. **Fechamento.**

## Fase 1 em detalhe: LOCAL EDITION

- **1a. A edição como dado, não como `if` espalhado** (decisão menor revisável): hoje o `game` já decide por
  `platform.id === 'switch'` (tamanho de texto, convenção de confirmar, perfil de controle, `libraryCapsFor`). A edição
  local vira **uma função só** (`isLocalEdition(platform)`) em `packages/game`, para uma tela ou um teste não repetir a
  condição. Para ensaiar na web, o `apps/web` ganha `?edicao=local` (só na versão de desenvolvimento; some do menu
  público). Se isso pedir campo novo no contrato da `Platform`, vai para "Pedidos de contrato" do `ARCHITECTURE.md` §8 e
  sigo com o contorno `platform.id`.
- **1b. Entrar direto no lobby:** no Switch o boot pula o título e a tela de carregamento do menu e abre a tela
  "aperte A" (a do M3, §13.2), com os 4 cartões, a **última partida** em uma linha ("Bobo Zombies · Base Abandonada ·
  Noite · Suado", o `presetSummary` que o JOGAR já usa) e os atalhos **COMEÇAR**, **Modos** e **Surpreenda-me**. Com
  save novo, a partida de estreia (`DEBUT_PRESET`).
- **1c. Só o P1 navega** nos menus globais (já é assim com sofá; passa a valer o tempo todo); **B** tira o jogador do
  slot; com 1 jogador só (ou com o teclado USB) o COMEÇAR é solo, igual ao JOGAR de hoje.
- **1d. Sair do jogo:** item no fim do lobby/Modos que chama `platform.exit()` (regra 16: é a única saída; o `+` só
  pausa). Pergunta de confirmação de um passo (P6).
- **1e. Reabrir o "aperte A":** trocar dock/portátil, controle desconectado e voltar do HOME **pausam** (feito) e a
  pausa ganha o botão "Refazer os jogadores" que volta ao lobby mantendo a partida pausada por trás; confirmar sem
  mudar nada continua a partida. O assento de quem desconectou fica reservado (M3, §13.3).
- **Como se verifica:** testes do `game` com `Platform` falsa (boot cai no lobby, B tira slot, `+` pausa, sair chama
  `exit`); `smoke:web` com `?edicao=local`; **Eden**: o NRO abre no lobby e o Sair fecha o app.
- **Risco:** o menu da web está a 2,7 KB do teto. O código da edição local entra no que o Switch já carrega
  (bundle único no esbuild); na web, a tela nova vai para o chunk da cena ou para `editors`, não para o menu.

## Fase 2 em detalhe: save e arquivos no SD

- **2a. Conferir o que existe:** testes novos de `storage.ts` para save corrompido (abre pelo backup e avisa),
  arquivo vazio, SD cheio e SD só de leitura (o jogo segue sem salvar e **mostra um aviso**, em vez de falhar calado), e
  `settings@1`/`stats@1`/`preset@1` de um save do M3 migrando para o código do M4.
- **2b. Backup à vista:** além do `save.backup.json` (um save atrás), a cada abertura do jogo o save válido vira
  `backup/save-AAAA-MM-DD.json` (os 3 mais recentes, o resto é apagado; decisão menor revisável). Em Ajustes → Dados, a
  aba diz quando foi o último backup e tem **Restaurar o último backup** (que pede confirmação).
- **2c. `oficina/` por arquivo:** no boot e ao abrir a Oficina, o jogo lista `sdmc:/switch/boboforces/oficina/*.json`
  (o que foi feito no PC chega pelo cartão SD, GDD §4.8): cada arquivo passa pelo validador de `format` (`bot@1`,
  `preset@1`, `backup@1`), respeita os limites (arquivo ≤ 64 KB, até 16 bots embutidos, 50 presets no Switch, nomes até
  16/24 caracteres) e entra na biblioteca; o inválido é ignorado **com a razão numa linha do `runtime.log`**. Arquivo
  importado não é apagado nem reimportado em duplicata (chave pelo hash do conteúdo). Exportar grava na mesma pasta.
  `importar/` e `exportar/` continuam para backups e relatórios (P2).
- **2d. Do PC para o Switch:** teste de ida e volta, com o JSON exportado da web (Ajustes → Dados → Exportar backup) lido pelo `platform`
  do Switch em memória, e as fixtures de `oficina/` sintéticas (regra 4 do CLAUDE.md).
- **Como se verifica:** testes de `apps/switch` (nx falso) e do `game`; Eden com uma pasta `oficina/` montada; o
  console só confere o cartão real (fase 8).
- **Risco:** o nx.js não expõe `rename` atômico garantido: a escrita segue "backup antes, depois o principal", que já
  é o desenho do M1.

## Fase 3 em detalhe: ciclo de vida

- **3a. Dock ↔ portátil com as vistas:** o `switch34p` e o `switch1p` já existem como perfis. Na troca, o jogo
  **não muda de resolução** (720p fixo nos dois, #1) mas pausa, mostra a tela "aperte A" e a partida refaz as vistas
  conforme quem está presente (no portátil, 1 jogador = 1 vista).
- **3b. HOME e sleep:** o vão de 1 s por amostragem é o que temos (`lifecycle.ts`). Falta o teste no console de que o
  jogo **pausa, grava o save e volta com o áudio** (o relógio do áudio para com o app suspenso: é hipótese do M1,
  marcada `[T0: confirmar no console]`). Se não valer, o limiar vira ajuste e o caso entra no roteiro.
- **3c. Reconexão:** controle que volta ao mesmo assento (pelo índice do nx.js; Joy-Con trocando de par pode mudar o
  índice, por isso o lobby deixa **reatribuir** com A, sem perder a partida).
- **3d. Bateria:** `navigator.getBattery` já é sondado nas trocas de modo (`probeBattery`). Se o console devolver nível
  e carregamento de verdade, a pausa mostra o nível e a partida avisa **uma vez** abaixo de 20%, fora da dock (P5). Se
  não devolver, o item sai do M4 e fica registrado.
- **3e. Pausa em tudo:** nenhuma tela do Switch aceita "sair" que perca a partida sem confirmação (hoje "Sair da
  partida" já pede; confere nas telas novas).
- **Como se verifica:** testes de `lifecycle.ts` (já existe `shell.test.ts`) com relógio falso para vão, troca de modo,
  desconexão e volta; Eden para o "não cai"; **console** para o que for do sistema real.
- **Risco:** o vão por amostragem pode confundir um loading longo com HOME (o contorno do áudio já cobre); medir no
  console com a partida de 20 min.

## Fase 4 em detalhe: glifos genéricos e teclado na tela

- **4a. Glifos por tipo de controle:** os prompts (confirmar, voltar, trocar, pausar) trocam o texto "A"/"B" por um
  glifo **genérico**, escolhido por `GamepadKind` (`standard`, `switchPro`, `joyConPair`, `handheld`; web: teclado e
  toque). Nada de desenho de marca nem de nome de marca na UI (já é regra no contrato da `Platform`): círculo, quadrado
  e losango com a letra, na cor do tema, em tira de sprites gerada pelo `texgen` (arte própria, sintética, sem
  download). Vão para o atlas de sprites da UI, sem programa de shader novo (limite de 7).
- **4b. Convenção de confirmar:** no Switch a confirmação já segue o botão da direita (`confirmConventionFor`); o glifo
  acompanha essa convenção e o remapeamento do jogador (Ajustes).
- **4c. Teclado na tela, o do sistema:** o swkbd do nx.js continua sendo a primeira escolha (já funciona nos itens de
  teste). A UI só cuida de abrir e de mostrar o que veio.
- **4d. Teclado na tela, o próprio (reserva):** um teclado no canvas (4 linhas de letras e números, espaço, apagar,
  OK), com **D-pad/stick + confirmar/voltar**, alvos grandes (≥ 44 px), só os caracteres que a fonte do jogo tem e o
  limite de cada campo (nome do jogador 16; bot e preset 24). Usado quando `platform.textInput.available` é falso, e
  numa opção "Teclado do jogo" nos Ajustes (decisão menor revisável: dá para digitar sem depender do swkbd, que tem o
  defeito do `geometrychange` sem evento de cancelar). Filtro de nome da §4.8 (pt-BR e inglês) vale nos dois.
- **Como se verifica:** testes de UI (estouro de largura no 640×360 e no 1280×720, só com D-pad, todos os campos), prints
  das telas com os glifos nos 4 tipos de controle, `size-check` do menu.
- **Risco:** peso no menu da web (2,7 KB de folga): o teclado próprio e os glifos vão para a tabela extra e para o chunk
  que a cena registra, como as frases da pausa (R4a).

## Fase 5 em detalhe: desempenho (o que o Teste Zero deixou)

A #60 deixou isso "para uma rodada de otimização mais adiante". Como a LOCAL EDITION abre **sempre pela 1ª cena a
frio**, a rodada cabe no M4 (P1) e quase tudo é conferível no PC.

- **5a. Pré-malha e navegação no `.bfmap`:** o `mapc` grava no arquivo a malha dos chunks e a grade de navegação já
  prontas (hoje o jogo as calcula no loading: navegação 1,4 s, malha 0,9 s, luz 0,7 s na 1ª cena). Meta do
  `TESTE_ZERO.md` §8c: tirar ~3 s e deixar a 1ª cena perto de 2 s. Formato novo do `.bfmap` com **versão e migração**
  (o leitor aceita o antigo) e o golden do mapa igual ao calculado em tempo de execução (teste que compara os dois).
  O orçamento de download da web cresce com isso: medir o `size-check`.
- **5b. Aquecimento completo (item 15):** no loading, desenhar uma vez fora da tela cada combinação de programa e estado
  que a partida usa (não só o que o aquecimento de hoje cobre), para o 1º frame jogável não compilar shader (146–306 ms
  de CPU no 1º frame, 4–6 frames ≥ 100 ms nos 120 primeiros). Medir no PC contando compilações e, no console,
  pelos `frames_lentos` do bench.
- **5c. O "plano B" (atlas + float):** a queda ~1 s depois do 3º frame nunca foi explicada (as hipóteses (a) JIT
  grande e (b) rota que a GPU de verdade recusa estão no `TESTE_ZERO.md` §8c). Como o array + inteiro funciona em tudo,
  o padrão (P4) é **a casca do Switch não oferecer o plano B** (nunca recria o renderer com a outra rota): some a
  rota que derrubou o console e sobra menos código. Se o Erick trouxer o relatório de `crash_reports` (nomes
  `0179415*` e `0179416*`), a causa entra no registro.
- **5d. Mapas do Zombies a frio:** o Zombies carrega a Base Abandonada (maior que o Construto): medir o loading e a
  memória dela no Eden (relativo) e na fase 8 (absoluto).
- **5e. O decodificador de MP3 do nx.js** atrasa nas emendas da música (risco conhecido do roteiro M3): as camadas do
  Zombies já foram medidas só no Edge. Fica para o console; se atrasar, a música em camadas vira camada única no
  Switch (registrar como decisão menor).
- **Como se verifica:** `npm run assets`, golden e balance (a malha pré-feita não pode mudar nenhum hash), bench no
  Edge com **CPU limitada** como termômetro relativo do loading (não como valor absoluto), portcheck e o Eden só
  para "carrega e não cai".
- **Risco:** o JIT frio é o que domina; o ganho real só aparece no console (fase 8).

## Fase 6 em detalhe: NACP, ícone, title ID e NSP

- **6a. Ícone:** o `icon.jpg` (JPEG 256×256) sai de uma arte **própria e sintética** do jogo (o logotipo em blocos que
  a casca já cita, feito no `texgen`; nada baixado) por `npm run icon`. Entra em `apps/switch/` e o `verify:nro` passa a
  exigir o ícone (P3).
- **6b. NACP e title ID:** `ID 01E1AB0B0B0F0000`, título BoboForces, autor EriLab, versão do `version.json`. O que
  falta é conferir no console que o título não colide com o MMM nem com outro NSP já instalado (**não consegui
  confirmar pelo código** se o ID cai no intervalo que o instalador aceita; o `verify:nsp` confere a estrutura, não o
  console). `userAccountSaveDataSize 0`: o save é só no SD (já é o desenho).
- **6c. NSP local:** `npm run nsp -w @boboforces/switch -- -k "<caminho do prod.keys>"` e `verify:nsp` com a mesma
  chave. A chave **só é lida do caminho que o Erick passar; nunca é copiada, impressa nem guardada** (CLAUDE.md,
  regra 3). Quem roda é o Erick ou eu com o caminho que ele disser no chat (P7). O NSP fica em `apps/switch/build/`, fora
  do git; **não há download novo** (`@nx.js/nsp` já é dependência fixada).
- **6d. Sem hbmenu:** o NSP já abre em modo aplicativo, então o `nxjs.ini` com o `--no-sparkplug` e o RomFS precisam
  ir **dentro do NSP** (o `verify:nsp` já confere o runtime e o RomFS; conferir o `nxjs.ini` também).
- **Como se verifica:** `verify:nro` e `verify:nsp` verdes; testes do `stage.ts` com o ícone; no console, instalar e
  abrir pelo HOME (fase 8).
- **Risco:** erro de instalação do NSP (assinatura ou chaves) só aparece no console; manter o NRO como plano B.

## Fase 7 em detalhe: Teste Zero 2, preparação

- **7a. Amostras de heap na partida real:** hoje o heap sai só no relatório do bench. Uma linha `[mem] t=… heap=…
  max=…` a cada 60 s no `runtime.log`, de qualquer partida (`Switch.memoryUsage()`, que no nx.js devolve o
  `HeapStatistics` do V8), para provar "heap estável" com o jogo de verdade (P8).
- **7b. Bench de 20 min:** presets novos do `bench.json` (`zombies4p-dock`, `zombies4p-handheld`, 1200 s, Base
  Abandonada, 4 vistas, horda no teto do `switch34p`), registrados em `TESTE_ZERO.md` §6, com `heap_tendencia`
  (inclinação do heap entre os minutos 5 e 20) e `frames_lentos` no relatório. Roda no Eden só para "não cai" e na
  fase 8 para valer.
- **7c. `docs/ROTEIRO_M4.md`**, no molde do `ROTEIRO_M3.md`: tabela "o que fazer / o que esperar", "ok / estranho /
  quebrou", e o que mandar de volta (`runtime.log`, `runtime.old.log`, `crash_reports`, `nxjs-debug.log`, as três
  anotações: travou/piscou, som e vibração, esquentou).
- **7d. Rodada 18 de prints** (Eden, no PC): lobby da LOCAL EDITION, glifos por controle, teclado próprio, Oficina
  com arquivo do cartão, aviso de bateria, ícone. Página das rodadas no mesmo padrão (v22; a v20 levou as P1–P9 e a v21 o lobby, junto da rodada 17), com perguntas Q1–Qn e o
  padrão de cada uma.
- **7e. Portão:** `npm run check`, builds, `portcheck --strict` (varredura do bundle do Switch: nada de rede, `eval`,
  `localStorage`), `smoke:web`, golden, balance e `size-check`.

## Fase 8: checkpoint do console (o Erick, lote único)

Itens agrupados para uma ida só ao console (o Switch está emprestado; vale o mesmo roteiro quando voltar):

| # | O que fazer | O que esperar |
|---|---|---|
| 1 | NSP instalado; abrir pelo HOME | Ícone e nome certos; abre direto no lobby "aperte A", sem segurar R |
| 2 | 4 controles: Sofá Zombies, 20 min, **na dock** | 30 fps ou mais, sem crash; o `[mem]` do `runtime.log` sem tendência de alta |
| 3 | O mesmo **no portátil** (1 a 2 jogadores) e depois tirando da dock no meio | Pausa, "aperte A", vistas refeitas, partida continua |
| 4 | HOME e voltar; dormir e acordar; desconectar e reconectar um controle | Pausa, save gravado, áudio volta, assento reservado |
| 5 | Teclado do sistema (nome do jogador, nome de bot, nome de preset) e depois o do jogo | Os dois digitam; nada trava |
| 6 | Pôr bot e preset do PC em `oficina/` e abrir a Oficina | Aparecem na biblioteca; o inválido some com a razão no log |
| 7 | Bateria baixa (ou o nível no menu de pausa) | O número aparece, ou o item é retirado |
| 8 | Abrir o jogo a frio três vezes e anotar quando o menu aparece | Loading da 1ª cena perto de 2 s (meta 4 s) |
| 9 | O roteiro do M3 que ficou pendente (controles de verdade, Sofá Zombies com 4) | Tudo ok |
| 10 | Mandar o `runtime.log`, o `runtime.old.log` e, se algo caiu, o `crash_reports` | Boot, `[mem]`, `[bench]`, erros |

O console fecha o jogo **só** pelo "Sair do jogo". O `bench.json` continua valendo (lido uma vez).

## Fase 9: fechamento

`CHANGELOG.md` (a seção do M4 e a versão do `version.json`, se o Erick quiser subir), `ARCHITECTURE.md` §15 (uma
seção por fase, como os §13 e §14), `PERF.md` §4 (as linhas do console: 4P Zombies 20 min na dock e no portátil, loading
da 1ª cena, heap) e `TESTE_ZERO.md` (Teste Zero 2). Propostas de linhas para o `DECISOES.md` (a tabela só muda com
resposta do Erick). **O M4 não publica nada**: o Switch é só uso pessoal (#33); a web só sobe com pedido (push e Pages).

## Perguntas para o Erick (sigo no padrão enquanto ele não responde)

| # | Pergunta | Padrão |
|---|---|---|
| P1 | **Otimização do loading no M4** (a #60 deixou "mais adiante"): fazer a pré-malha, o aquecimento e conferir a 1ª cena agora, na fase 5? | Sim: a LOCAL EDITION abre sempre pela 1ª cena a frio, e quase tudo se mede no PC |
| P2 | **Pasta dos arquivos**: `oficina/` (GDD §4.8 e `tecnico.md` §9) para bots e presets, e `importar/` e `exportar/` só para backups e relatórios? | Sim, as duas (a casca já usa `importar/` e `exportar/`) |
| P3 | **Ícone** do HOME: arte do jogo feita aqui (logotipo em blocos) ou um PNG seu? | Arte própria gerada no `texgen`; se você mandar um PNG quadrado, troco |
| P4 | **Plano B (atlas + float)** no Switch: tirar da casca, já que derrubou o console uma vez e o array + inteiro funciona em tudo? | Tirar (só array + inteiro no Switch); a web continua com as rotas |
| P5 | **Bateria**: aviso de uma vez só abaixo de 20% fora da dock? | Sim, se o console devolver o nível; senão o item sai e fica registrado |
| P6 | **Sair do jogo** com confirmação de 1 passo? | Sim |
| P7 | **NSP**: quem roda o `npm run nsp` com o `prod.keys`? | Você roda e me conta o resultado do `verify:nsp` (eu nunca leio a chave); se preferir, passe o caminho no chat |
| P8 | **"Heap estável"** (critério 1): como medir? | O heap dos minutos 15–20 não passa de 10% acima do dos minutos 5–10, e sem nenhum aviso de falta de memória no log |
| P9 | **nx.js**: GDD pendência 9 (migrar para a 1.0 estável se existir). | Ficar na 1.0.0-beta.7 fixada (não consegui confirmar se há versão estável); só trocar com seu OK, com o Teste Zero repetido e o download dito (nome, origem, tamanho) |

## Escolhas do Claude neste plano (revisáveis)

- **Plano baseado no que o código já tem:** M4 é mais "acabar e medir" do que "construir"; as fases 1, 4 e 6 trazem as
  entregas novas e a 5 as pendências do Teste Zero.
- **Console por último:** o Switch está emprestado; o que só o console responde vira o lote da fase 8.
- **Eden para boot e "não cai", nunca para quadros:** o instanciamento do Eden pode sair truncado (o contorno só liga
  no Eden; o console decide).
- **Teclado próprio no canvas** como reserva e opção, para não depender só do swkbd do nx.js.
- **Sem dependência nova prevista.** Se algum passo pedir uma (NSP, ícone, MP3), entra em `DEPENDENCIAS.md` e
  `CREDITOS.md` com o `portcheck` verde e **o download pede o seu OK** (nome, origem, tamanho).
- **Trabalho econômico:** fase por fase, direto na sessão; um revisor só para o escopo fechado (a fase 5 e o formato do
  `.bfmap`); testes visuais pelo OuterSpace.

## O que precisa do Erick

- As perguntas P1–P9 (sigo no padrão).
- O console de volta para a fase 8, e os **logs** do teste do M3 quando chegarem.
- Rodar o NSP (ou dizer o caminho do `prod.keys` no chat) e o instalar no console.
- Aprovar os prints da rodada 18.
- OK para qualquer download; para push e deploy, só se você pedir.

## Fora do M4

Online P2P (M5); BoboStrike, Paintball, Domination, Juggernaut, Armed Horde, Fortress e os modos de festa (M6+); mouse
USB no Switch (o nx.js não lê, #73); publicar NRO ou NSP (#33); a rodada geral de otimização além do loading e do
aquecimento da fase 5.
