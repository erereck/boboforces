# Teste Zero: passo a passo (M1)

> Para o Erick. Fonte: `docs/design/tecnico.md` §24 (checklist de 21 itens e critério), decisões #23, #47 e #48.
> Ordem combinada: **primeiro no Eden deste PC** (referência), **depois no console** pelo NRO no hbmenu, aberto
> segurando R num jogo (modo aplicativo, sem chaves). O jogo grava tudo no `runtime.log`; você só precisa abrir,
> apertar o que está aqui e me mandar o arquivo.

## 1. O que o Teste Zero responde

"O Switch aguenta?" Antes de produzir conteúdo, a cena-vitrine (o Construto com bobos e bots) roda no Switch e mede
FPS, memória, loading e o que o nx.js tem ou não tem. Aprovação (tecnico.md §24.3):

- **Dock, 4 vistas, 12 bots armados, visão de 50 m: 30 fps estáveis por 10 min** (p99 do frame até 40 ms);
- 1 jogador com 24 bots e visão de 90 m a 30 fps;
- heap abaixo de 200 MB; loading do Construto em até 4 s;
- three.js funcionando com o shim; texture array funcionando **ou** o atlas de plano B validado.

## 2. Preparar (no PC, uma vez por build)

Na raiz do repositório:

```powershell
npm run assets                      # texturas, skins, modelos e o Construto (gera os arquivos do jogo)
npm run nro -w @boboforces/switch   # build + NRO em apps\switch\build\BoboForces-0.0.1.nro (~60 MB)
npm run verify:nro -w @boboforces/switch
```

Os sons do teste de áudio já estão prontos (`assets-src/audio/generated/`, MP3 dos sons CC0 da Kenney). Se um dia
mudar a lista em `assets-src/audio/sounds.json`, rode `npm run audioconv` (usa o Edge instalado).

## 3. Parte 1: Eden

### 3.1 Jeito automático (o que eu já rodei)

```powershell
npm run eden:run -w @boboforces/switch
```

Copia o NRO para o SD virtual do Eden (`%APPDATA%\eden\sdmc\switch\boboforces\BoboForces.nro`), abre com
`eden.exe -g`, espera as sondas aparecerem no `runtime.log`, fecha o Eden e guarda a parte nova do log em
`local\eden\runtime-<data>.log`. No terminal aparecem as linhas `[t0]`. O `eden.exe` é achado sozinho em
`3D Objects\Emuladores\Eden-*`; se mudar de lugar, grave o caminho em `local\eden\eden-path.txt` (ou defina
`EDEN_EXE`).

Bench direto, sem controle: `npm run eden:run -w @boboforces/switch -- --bench dock` (espera até 15 min pela linha
`[bench] fim`). Os nomes dos presets estão na seção 6. No Eden o bench anda ~3× mais devagar que o relógio (cada frame
conta no máximo 0,1 s): o `dock` de 10 min leva ~30 min, então passe `--seconds 2400` ou use uma versão curta, como
`--bench-params "views=4&bots=12&view=50&duration=60&warmup=10"` (seção 11).

### 3.2 Jeito manual (para os testes com controle)

1. `npm run eden -w @boboforces/switch` (copia o NRO e cria `local\eden\eden-test.ini`, cópia da sua config com o
   teclado ligado; a sua config normal nunca é editada).
2. Abra o Eden e carregue `%APPDATA%\eden\sdmc\switch\boboforces\BoboForces.nro` (Arquivo › Carregar arquivo).
3. No título, use os itens de teste (seção 5). Para o teste de 4 controles, configure os 4 jogadores no Eden antes.

No Eden não há bateria (o item 20 acusa falha do serviço `psm`: é do emulador) e o desempenho é o do PC, não o do
Switch: os números valem como referência de que tudo funciona, não como aprovação.

## 4. Parte 2: console

1. Copie `apps\switch\build\BoboForces-0.0.1.nro` para o cartão: `sdmc:/switch/boboforces/BoboForces.nro`.
2. **Primeiro abra pelo álbum, sem segurar R** (modo applet): deve aparecer "Abra segurando R ou instale o NSP".
   Aperte + para sair. Isso já grava o item 1 no applet.
3. Agora **segure R ao abrir um jogo qualquer** até aparecer o hbmenu (modo aplicativo) e abra o BoboForces. As
   sondas da casca rodam sozinhas no boot (seção 7). Espere o título aparecer e uns 5 s (sondas tardias e o áudio em
   silêncio).
4. **Na dock:** rode, pelo título, o bench "dock" (10 min + 10 s de aquecimento). Não mexa em nada até o relatório
   sair: a cena continua (os bots seguem lutando) com "Relatório gravado no runtime.log · B volta" na tela; aperte
   **B** para voltar ao título. Durante o bench a tela mostra "B interrompe o bench." (interromper grava o relatório
   do que já foi medido). Depois o "plano B" e o "GPU".
   **Capturas:** no "dock" e no "plano B", com o Construto na tela, aperte o botão de captura (o quadrado do Joy-Con
   esquerdo) uma vez e me mande as 2 capturas do álbum. É assim que os itens 4 e 5 se confirmam no console (textura e
   malha iguais às do PC): o log só diz qual rota rodou, não se a imagem saiu certa.
5. **No portátil:** rode o bench "1 jogador" (5 min, que também dá o item 16 no portátil) e um dos estresses. Se der
   tempo, o "dock" de 10 min também no portátil.
6. Testes com você (título): **Controles** com 4 controles completos (pares de Joy-Con e Pro), mais um Joy-Con
   avulso para ver a recusa; **Teclado**; **Áudio** (fone ou TV com estéreo).
7. **Ciclo de vida:** numa partida **JOGAR** pelo título (ela pausa de verdade), nunca durante os benches de medição:
   tire da dock e ponha de volta; aperte HOME, espere uns segundos e volte; ponha para dormir e acorde. O jogo deve
   pausar e o log ganha as linhas do item 20 (e 19, o `resume` do áudio). O bench não pausa (os jogadores são bots);
   se um vão de mais de 1 s acontecer no meio de um bench, ele fica fora das estatísticas e aparece como `vaos_1s=` no
   relatório.

Para repetir as sondas de GL do boot no mesmo build e modo, apague `sdmc:/switch/boboforces/t0-sondas.txt` (elas
custam ~0,8 s no boot e por isso rodam uma vez por build e por modo, dock ou portátil).

Bench sem passar pelo menu: grave `sdmc:/switch/boboforces/bench.json` com `{"preset": "dock"}` (ou
`{"params": {"views": "1", "bots": "24", "view": "90"}}`, os mesmos nomes do `/bench` da web). Vale para UMA
abertura: o arquivo vira `bench.usado.json`. Nesse caminho as sondas tardias (8, 19, 20, 21) só rodam depois do
relatório, para não pesarem no loading.

**Bissecção dos picos** (só se o console mostrar picos e eu pedir): o mesmo `bench.json` aceita chaves que desligam
uma parte do desenho por rodada, com a sim e a IA iguais: `"hud": "0"` (HUD das vistas e o texto do bench), `"vm": "0"`
(arma na mão), `"fx": "0"` (tiros, impactos, detritos e mortes) e `"actors": "0"` (bobos, manequins e sombras). Uma
rodada curta por chave, por exemplo `{"params": {"duration": "60", "actors": "0"}}`; a linha `cena=` do relatório diz
quais estavam ligadas (`hud=1 vm=1 fx=1 atores=1`).

## 5. Itens de teste no título

No título, com mais de 4 itens, eles ficam numa grade de 2 colunas embaixo à direita, acima da versão; os rótulos são
as chaves curtas `test.item.*` (#54).

| Item | O que faz | Botões |
|---|---|---|
| Bench 4P (`dock`) | 4 vistas, 12 bots armados, 50 m, 10 min | — (espera; **B** interrompe) |
| Bench 1P (`solo`) | 1 vista, 24 bots, 90 m, 5 min | — (B interrompe) |
| Bench zumbis (`zombies`) | dock + 24 zumbis, 2 min | — (B interrompe) |
| Bench 48 bots (`bots48`) | 4 vistas, 48 bots, 2 min | — (B interrompe) |
| Bench plano B (`planB`) | atlas com padding + atributos em float, dock, 2 min | — (B interrompe) |
| Bench GPU (`gpu`) | dock com `gl.finish()` por frame, 1 min (o FPS cai de propósito: só mede a GPU) | — (B interrompe) |
| Controles (teste de controles) | lista cada controle (índice, tipo, `styleSet`, `deviceType`, vibração) | A entra (até 4 jogadores) · X vibra · + (não pode fechar o jogo) · B volta |
| Teclado (teste de teclado) | abre o teclado do sistema | A reabre · B volta |
| Áudio (teste de áudio) | 4 MP3 do romfs, 2 sons sintetizados, 24 vozes | A tiro · X impacto · Y passo · Cima clique · L sintetizados · R rajada de 30 sons · Esq./Dir. pan · analógico esq. muda o pan do A/X/Y · B volta |

O relatório de cada bench vai para o `runtime.log` com `[bench] ` na frente (de `BoboForces bench 2` até `fim`).
No relatório, `erros=` conta só os erros do three (`console.error`: compilação ou link de shader); os outros erros
de console do Switch vão para o `runtime.log` como `[console.error]`. A linha `cena=` diz também os bots de verdade
(`bots_efetivos=`; o motor limita vistas + bots a 64), os manequins estáticos desenhados (`manequins=`, os 6 da
vitrine) e o teto de detritos do perfil (`detritos=`; 120 no `switch34p`, 200 no `switch1p`).

## 6. Presets do bench (nomes para `--bench` e `bench.json`)

| Preset | Vistas | Bots | Zumbis | Visão | Duração | Rota |
|---|---|---|---|---|---|---|
| `dock` | 4 | 12 | 0 | 50 m | 600 s | — |
| `solo` | 1 | 24 | 0 | 90 m | 300 s | — |
| `zombies` | 4 | 12 | 24 | 50 m | 120 s | — |
| `bots48` | 4 | 48 | 0 | 50 m | 120 s | — |
| `planB` | 4 | 12 | 0 | 50 m | 120 s | atlas + float |
| `gpu` | 4 | 12 | 0 | 50 m | 60 s | `gl.finish()` |

Todos com aquecimento de 10 s, armados, Dia, semente 1 e 60 Hz.

## 7. Os 21 itens: o que cada linha mede

Toda medição é uma linha `[t0] item=N nome=<slug> status=ok|falha|info|pulado chave=valor…`. `falha` não quer
dizer que o Teste Zero reprovou: quer dizer que vale o plano B daquele item (tecnico.md §24.2). `pulado` quer dizer
que não deu para medir (`motivo=sem_amostras`: bench interrompido antes de medir; `motivo=curto`: menos de 180 s
medidos; `motivo=heap_desconhecido`). Bench interrompido acrescenta `interrompido=1 segundos_medidos=N`.

Quem grava: **boot** = a casca, sozinha, ao abrir (`fonte=casca`: as sondas mínimas de GL antes do three, uma vez
por build e por modo); **tardia** = a casca, ~3 s depois do título; **tela** = a tela de teste do título; **ciclo** =
quando acontece; **bench** = o jogo, no fim de cada bench (só os itens 10–16). Os itens 4, 5 e 9 saem só no boot: no
bench, a linha `sistema=` do relatório e o item 11 dizem qual rota rodou (`textura=array|atlas`,
`atributos=int|float`), e a captura de tela do passo 4 da seção 4 confirma a imagem.

| # | Item | Quem grava | O que olhar |
|---|---|---|---|
| 1 | `webgl2` no modo aplicativo e no applet | boot | `status=ok` no aplicativo; `info webgl2=0` no applet (esperado) |
| 2 | `drawing-buffer` na dock e no portátil | boot + ciclo | `buffer=1280x720` nos dois modos |
| 3 | `three-shim`: three sobe com o shim e os avisos | boot | `status=ok`, `avisos_three` e as linhas `[console.warn]` |
| 4 | `texture-array` 16×16×256 e 64×64×128 com mips, REPEAT, `texSubImage3D` | boot | `repeat_na_camada=ok`, tempos de upload; no bench, `textura=` e a captura |
| 5 | `int-attributes` (`vertexAttribIPointer`, u16) | boot | `u16_para_uvec2=ok`; no bench, `atributos=` e a captura |
| 6 | `vertex-texture` (`MAX_VERTEX_TEXTURE_IMAGE_UNITS`) | boot | informativo |
| 7 | `offscreen-canvas` 2D → `texImage2D` | boot | `leitura=255_128_0_255` |
| 8 | `fontface` + texto em OffscreenCanvas | tardia | informativo (o texto do jogo é MSDF) |
| 9 | `msaa-blit` (FBO multisample 2× + blit em 720p) | boot | `clear_blit_ms` (custo do AA; o Switch roda sem AA) |
| 10 | `frame-time` CPU e GPU (`gl.finish`) | bench | `p99` contra o `alvo` (×1,2), `frame_ms`, `frames_lentos`, `cpu_ms`, `gpu_ms`; `vaos_1s` (HOME/sleep fora das contas) |
| 11 | `render-info` por vista (draw calls, triângulos, programas ≤ 7) | bench | `draw_max_vista`/`tri_max_vista` contra `meta_draw`/`meta_tri` (3–4P: 45 e 120 mil; 1–2P: 60 e 200 mil) e `programas=` |
| 12 | `sim-ai-cost` com 12 armados, 24 zumbis, 24 e 48 bots | bench | `sim_media`, `sim_p99`, `sim_max`, `ia_*` e o custo por tick (`sim_por_tick`, `ia_por_tick`; linha `sim_ia_ms` do relatório) |
| 13 | `loading` do Construto | bench | `loading_ms total=` (meta ≤ 4.000) |
| 14 | `gc-memory` ao longo do bench | bench | `memoria_mb heap_max=` (meta < 200), `gc_pausas=` |
| 15 | `shader-stalls` | bench | os primeiros 120 frames da partida (aquecimento incluído): `primeiro_frame_ms`, `max_inicio_ms`, `travadas_inicio` (frames ≥ 100 ms; é isso que decide o status). `travadas_100ms` (picos da medição) é só informação. Também `loading_ms shaders=` |
| 16 | `thermal`: frame depois de 10 min | bench | `p50_inicio` (1º minuto) × `p50_fim` (últimos 60 s, por tempo): o `dock` de 10 min na dock; no portátil, o `solo` de 5 min (abaixo de 180 s medidos sai `pulado`) |
| 17 | `controllers`: 4 controles, `styleSet`, `deviceType`, ordem, vibração, + bloqueado, avulso | tela | `evento=entrou jogador=1..4`, `vibra`, `mais_bloqueado`, `recusado` |
| 18 | `keyboard`: teclado do sistema | tela | `evento=confirmou tamanho=N` (o texto em si nunca vai para o log) |
| 19 | `audio`: MP3 do romfs, `createBuffer`, 24 vozes, latência, pan, `resume` | tardia + tela + ciclo | `evento=sonda_boot vozes_pico=24`; na tela: `pan`, `rajada`, `tiro play_us_medio`, `relogio passo_ms`, `resume` |
| 20 | `lifecycle`: dock ↔ portátil, HOME, sleep, bateria | ciclo + tardia | `evento=modo`, `volta_home_ou_sleep`, `nivel=` da bateria |
| 21 | `intl-decompression` | tardia | informativo (o jogo não usa nenhum dos dois) |

Detalhe do item 20: um vão de mais de 1 s sem frame com o **relógio do áudio andando** é gravado como
`evento=js_ocupado` (trabalho pesado fora do frame, não pausa); com o relógio parado é `volta_home_ou_sleep` (pausa).
No console, confira que o HOME e o sleep saem como `volta_home_ou_sleep` com `audio_ms` perto de 0.

## 8. Onde fica o log e o que me mandar

- **Console:** `sdmc:/switch/boboforces/runtime.log` (e `runtime.old.log`, se o log passou de 1 MB).
- **Eden:** `%APPDATA%\eden\sdmc\switch\boboforces\runtime.log`; o `eden:run` também guarda cada rodada em
  `local\eden\`.

Mande de volta:

1. o `runtime.log` (e o `runtime.old.log`, se existir) do Eden e do console;
2. três anotações suas: se a imagem travou ou piscou em algum momento (e quando); se a vibração e o som saíram
   certos (esquerda/direita no teste de áudio, os 4 controles vibrando); se o console esquentou ou a ventoinha
   disparou no bench de 10 min;
3. se alguma coisa fechou o jogo sozinha ou travou: o que você estava fazendo.

O log não tem nada pessoal: sem nomes, sem o texto digitado, sem o número de série dos controles.

## 9. Já medido no Eden deste PC (03/11/2026, build 0.0.1 local, frente switch-audio)

Eden `master-faaf1bac64` no i5-12450H + RTX 2050, modo portátil, NRO de 60 MB (RomFS do jogo 3,5 MB). Ainda sem os
itens de teste no título e sem o bench (dependem da integração do M1), então só as sondas da casca:

| Item | Resultado |
|---|---|
| 1 | ok: WebGL 2.0 (OpenGL ES 3.2 Mesa 20.1.0-rc3), GPU `NV120`, nouveau |
| 2 | `1280x720` no portátil |
| 3 | ok: three r187 subiu em 159–290 ms, 0 avisos |
| 4 | ok: `MAX_ARRAY_TEXTURE_LAYERS` 2048, upload 16×16×256 em 31–72 ms, 64×64×128 em 6–16 ms, `texSubImage3D` 1 ms, REPEAT na camada certo; compilar o shader de teste 320–480 ms |
| 5 | ok: `vertexAttribIPointer` com u16 chega certo no `uvec2` |
| 6 | 32 unidades de textura no vertex shader |
| 7 | ok: OffscreenCanvas 2D → `texImage2D` (120–173 ms, quase tudo para criar o canvas) |
| 8 | `FontFace` e `fonts.add` existem; `fonts.check` não implementado; texto em `system-ui` desenha |
| 9 | ok: 2× MSAA, até 8 amostras; clear + blit de 720p em 1,7–3,3 ms |
| 19 | ok: 4 MP3 decodificados em 209–359 ms (total), 2 sintetizados com `createBuffer`, 24 vozes, 6 roubos na rajada de 30, 48 kHz |
| 20 | bateria: falha (serviço `psm` não existe no Eden); vão de 1,2–1,3 s no boot classificado como `js_ocupado` (o relógio do áudio andou junto) |
| 21 | `Intl` **não existe** no nx.js; `DecompressionStream` ok em gzip, deflate e deflate-raw |
| boot | do primeiro log ao título: 2,9 s com as sondas de GL, 2,5 s sem |

## 10. Integração do M1 no Eden (03/11/2026)

O NRO da integração abre o Construto pelo `bench.json` (`npm run eden:run -w @boboforces/switch -- --bench-params
"views=4&bots=12&view=50&duration=30&warmup=5"`) e o relatório sai no `runtime.log` com `[bench]`, mais as sondas
`[t0]` do jogo (itens 10–16).

- **Corrigido:** o app fechava sozinho logo depois do primeiro frame da partida. Três construções de GLSL que o
  recompilador de shader do Eden não aguenta: multiplicação inteira (`IMUL` com registrador, no hash de célula),
  `return` no meio do `main` (programas instanciado e de partículas) e índice dinâmico em array de uniform. Foram
  trocadas por conta de float, if/else e seleção com índice constante (regra 6 do `PORTABILIDADE.md`).
- **Medido:** loading do Construto 5,8 s (assets 1,4 s, texturas 0,3, luz 0,8, malha 1,0, nav 0,8, skins 0,2,
  shaders 0,7): passa da meta de 4 s. 4 vistas e 12 bots: mediana de 25 ms por frame, mas com picos de 200–550 ms
  dentro do `renderViews` (CPU esperando o GL) em boa parte dos frames, mesmo sem atores. 1 vista e 12 bots: mediana
  24 ms. Heap 42,5 MB.
- **No console, anotar primeiro:** se os picos do `[bench] pico …` aparecem e o `loading_ms`. Desde a verificação
  do M1, pico é frame (ou CPU) acima de 1,5× o alvo do perfil (50 ms no Switch a 30 fps), e sai no máximo UMA linha
  por janela (a duração dividida em 20), com o pior frame dela: `t=` (segundo da medição), `frame_ms`, `cpu_ms` e
  quanto foi sim, IA, render, UI e o resto. A linha `frames_lentos` do relatório conta todos (40–60, 60–100,
  100–250 e acima de 250 ms). Os 3 primeiros frames da partida deixam um rastro `[cena] frame N: …` no log (com
  `cpu_ms` e `intervalo_ms` no fim de cada um): se o app cair, a última linha diz a etapa.

## 11. Medições do M1 no Eden e no PC (03/11/2026)

Build 0.0.1 local com a correção do hash do céu (o shader mudou; o NRO novo compila e roda no Eden). Comandos usados:

```powershell
npm run nro -w @boboforces/switch
npm run eden:run -w @boboforces/switch -- --bench-params "views=4&bots=12&view=50&duration=60&warmup=10"
npm run eden:run -w @boboforces/switch -- --bench-params "views=1&bots=24&view=90&duration=60&warmup=10"
npm run eden:run -w @boboforces/switch -- --bench-params "views=4&bots=12&view=50&duration=60&warmup=10&atlas=1&float=1"
```

| Rodada (Eden, portátil) | Loading | Frame p50 / p90 / p99 / máx | Frames ≥ 100 ms | Draws / triângulos | Heap |
|---|---|---|---|---|---|
| 4 vistas, 12 bots, 50 m (array + int) | 6,0 s | 22 / 513 / 620 / 780 ms | 513 de 1.137 | 138 / 258 mil | 43,3 MB |
| 1 vista, 24 bots, 90 m | 6,3 s | 22 / 511 / 589 / 778 ms | 540 de 1.154 | 33 / 64 mil | 44,1 MB |
| 4 vistas, 12 bots, plano B (atlas + float) | 6,3 s | 26 / 512 / 607 / 779 ms | 518 de 1.113 | 138 / 258 mil | 44,0 MB |

- **Roda tudo:** as 4 combinações de rota (array/atlas × int/float) e 1 ou 4 vistas, 7 programas, `erros=0`, nada
  fechou sozinho. (Nestas rodadas o `erros=` ainda não recebia nada; desde a verificação do M1 ele conta os erros do
  three. Os avisos do three já entravam em `avisos=`, que deu 0, então o resultado vale.) No Eden, 60 s de bench levam ~3 min de relógio (cada frame conta no máximo 0,1 s).
- **Picos:** iguais nas três rodadas, sempre no `render`, em degraus de ~250 ms (170–270 e 480–570 ms). Não dependem
  do número de vistas, da rota de textura nem do formato do vértice; sim e IA ficam em 0–15 ms. Parece espera com prazo
  fixo dentro do GL do emulador. **No console**, o `[bench] pico …` diz se eles existem lá.
- **Loading:** 6,0–6,3 s (meta 4 s), mas esse número tem 0,2–0,5 s das sondas tardias, que rodavam no meio do
  loading no caminho do `bench.json` (corrigido na verificação do M1: agora rodam depois do relatório). O loading
  limpo no Eden é ~5,8 s (rodadas sem a sonda por cima), e o decode dos MP3 que vale é o de 209–359 ms da seção 9.
  Luz + malha + navegação somam 2,6 s; se o console também passar de 4 s, entram a pré-malha e a navegação no
  `.bfmap` (e talvez mais: sem elas ainda sobram ~2,9 s no Eden).
- **No PC** (Edge com a RTX 2050), o preset da dock rodou os 10 min inteiros sem nenhum frame acima de 20 ms (p99
  18,8 ms, heap 44 MB). Detalhes no `docs/PERF.md` §2.

**Verificação do M1 (mesmo dia, ~10h30 UTC, NRO novo):** com o build corrigido, o bench curto da dock no Eden
(`views=4&bots=12&view=50&duration=30&warmup=5`) rodou a **58,5 fps, p99 46 ms e nenhum frame ≥ 100 ms**: os picos
de 250/500 ms sumiram, e 30 s de bench levaram ~30 s de relógio. Três rodadas A/B (cada uma com uma mudança desfeita:
o índice dinâmico do `uEmissiveLayers`, as sondas tardias no meio do bench, a sombra-blob antiga) deram o mesmo
resultado, então a causa dos picos antigos não está isolada. Loading 5,3–5,5 s (6,2 s com as sondas por cima). No
console, o `dock` de 10 min continua sendo o número que decide.

**Depois da verificação (mesmo dia, ~20h30 UTC, NRO novo):** os picos de ~500–780 ms VOLTARAM no Eden com o mesmo
código de render (6 fps nas rodadas curtas de 1 e 4 vistas): no Eden eles dependem do estado da máquina, não do jogo.
O que mudou no NRO para o console:

- **O bench abre a cena depois de um frame do título**, como JOGAR no menu. Antes, o loading do bench pagava o
  primeiro desenho da UI; na mesma build, o loading no Eden caiu de 5,3–5,5 para 5,0–5,2 s (ainda acima de 4 s).
- **A linha `[cena] loading …`** agora abre os assets: `assets N (chegada X, decodificação Y, 18 arquivos em F
  frames)`. No Eden: chegada ~0,55 s em 2 frames (ler os 18 arquivos do RomFS leva menos de 10 ms; o resto é UM frame
  longo fora do código do jogo) e decodificação ~0,65 s.
- **As linhas `[bench] pico …`** terminam com `heap_mb=` (heap no frame do pico) e `heap_1s_mb=` (última amostra de
  1 s). Heap caindo muito entre os dois = coleta de memória do V8 (o nx.js 1.0.0-beta.7 roda V8, não QuickJS) fora
  do frame; heap subindo = espera fora do JS (GL). No Eden, 18 das 20 eram espera de GL. O heap sobe até ~5 MB por
  segundo durante o bench no Eden: se no console aparecerem quedas grandes junto dos picos, é isso que vou atacar.

**O que você anota no console** (o resto, inclusive dock ou portátil, o `runtime.log` já traz): se a imagem travou ou
piscou e quando; se o console esquentou ou a ventoinha disparou no `dock` de 10 min; se o som e a vibração saíram
certos; e se algo fechou o jogo sozinho (o que você estava fazendo).

## 12. Celulares (critério 5 do PLANO_M1)

Só vale **depois do push e do deploy** (que esperam o seu OK): o site no ar ainda é o do M0. Com o M1 publicado:

1. No **Redmi Note 13** (o Android de entrada do critério), no Chrome, abra:
   `https://erereck.github.io/boboforces/?bench&views=1&bots=12&view=90&duration=120`
   (1 vista, 12 bots, visão de 90 m, 2 min de medição depois de 10 s de aquecimento; sem os parâmetros o bench é o
   da dock, com 4 vistas e 10 min, que não é o do celular).
2. Antes: carregador ligado, brilho no meio, outros apps fechados, celular **deitado (paisagem)** e a tela sem
   apagar sozinha durante os ~3 min. Não toque na tela até aparecer "Relatório pronto".
3. No fim, **toque na tela**: o relatório vai para a área de transferência. Cole numa mensagem para você mesmo e me
   mande o texto inteiro (de `BoboForces bench 2` até `fim`). O jogo já tenta copiar sozinho quando o
   relatório fica pronto; se o navegador recusar a cópia, o toque baixa um `relatorio-bench-….txt`: mande o arquivo.
4. Repita no **Galaxy A36** (referência, mesmo link). Se sobrar tempo, rode também com `bots=24` no lugar de
   `bots=12` nos dois.

Meta do critério: o Redmi a 30 fps estáveis (no relatório, `frame_ms p99=` até ~40 ms); o A36 só registra o número.
