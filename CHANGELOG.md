# Changelog

Formato das versões lançadas (padrão gamebobo): `## X.Y.Z — Codinome — AAAA-MM-DD`. MAJOR = save ou conceito
incompatível; MINOR = sistema jogável novo; PATCH = correção. Versão, codinome e versões de formato ficam no
`version.json`. Pedidos de origem em `docs/PROMPTS.md`.

## [Não lançado] — 0.0.1 — Primeiro Bloco

### M1 Cena-vitrine + Teste Zero (em construção)

**Parte 1: contratos e frentes em paralelo**

- Contratos do M1 (`docs/ARCHITECTURE.md` §9): formas na célula, `map@1` (`.bfmap`), `model@1` (`.bfmodel`), skins,
  manifesto `layers@1` dos texture arrays, render do mundo, dos atores, dos VFX e das vistas, `nav`, bench e linhas
  `[t0]` do `runtime.log`.
- world: formas do catálogo na colisão e no raio (rampa lisa, degrau, laje andável, painel e poste que bloqueiam, cruz
  sem colisão), colisores de props, luz em canais (céu por flood fill, sol por varredura, emissivo) com grade de 2 m,
  mesher por região 2×2×1 com greedy por textura, AO 0fps com troca da diagonal e vértice de 12 bytes.
- texgen do M1: paleta mestra revista (64 cores, rampas de material de 4–6 tons), 38 texturas de bloco em 62 camadas com
  variantes e água animada, mips com cobertura de alfa, tira `modelos64-materiais` e 44 blocos `blocks@1`.
- skingen e modelgen geram skins, rostos, armas e props do Construto; `model@1` com codec e validador.
- Construto `map@1` compilado pelo mapc: codificador/decodificador e validador do `.bfmap`; navegação 2,5D com A*
  fatiado; maior linha de visão medida de 47,75 m; vista de cima para revisão.
- sim/ia M1: formas e props, zumbis de estresse, acerto com parte e direção, bots N0 com A* e orçamento.
- render-mundo do M1: texture arrays com mips e atlas de plano B, vértice de 12 bytes (inteiro ou float), céu
  procedural, hora do dia por uniforms, 1 a 4 vistas com culling e estatísticas por vista, aquecimento e memória.
- Bobos instanciados com skins compostas, armas, props por grupo de 32 m, viewmodel, desmonte e VFX.
- HUD por vista, painel F2, loading por etapas, telas de teste do Switch e comparação de fontes (Russo One, Chakra
  Petch, Saira Condensed).
- Teste Zero: sondas no runtime.log, telas de controles, teclado e áudio, mixer de 24 vozes, sons CC0 da Kenney, NRO
  rodando no Eden.
- web: bench por URL (`?bench`, `/bench/`, apelidos pt-BR), relatório para a área de transferência,
  `window.__bfDebug.print`; prints automáticos com folha de contato; smoke abre o Construto e o bench de 4 vistas;
  size-check por grupo; guard com `import-tooling` e `asset-format`.

**Parte 2: integração**

- O Construto de verdade no `game` (`@boboforces/game/scene`): loading por etapas dentro dos frames e cronometrado
  (assets → texturas → luz → malha → navegação → skins → shaders; ~0,5 s no Edge do PC de referência), partida local
  com bots N0 na navegação real e zumbis de estresse, 1 a 4 vistas (no bench, bots no lugar dos humanos), HUD por vista,
  viewmodel, atores interpolados com a luz da grade de 2 m, eventos da sim virando VFX (clarão, traçante, impacto em
  bloco, prop e bobo, desmonte), Dia/Entardecer/Noite por uniforms e fog pela visão do perfil.
- JOGAR abre o Construto em Bobo Warfare TDM (6 × 6 com bots N0); "Cena-vitrine" no título da web anda no Construto
  sem bots; no Switch, os itens de teste do título (6 presets do bench, Controles, Teclado, Áudio) funcionam.
- Painel F2 (frame CPU/GPU, p50/p99, fases, draw calls e triângulos por vista, programas, heap, bots, visão), bench com
  roteiro de câmera e relatório (`onBenchReport`; no Switch vai para o `runtime.log` com `[bench]`) e as sondas
  `[t0]` do jogo (itens 10–16). Gancho dos prints completo: 43 prints (mip em 3 versões, skin de densidade dobrada,
  comparação de fontes por combinação).
- Contratos: `mipFilter` com `off`, skin de teste de densidade dobrada (`skinDensityTest`, `skins/densidade32.png`),
  `showFontCompare(on, combo?)`, `benchWarnings`, orçamento da IA pelo perfil, `SimView.playArea`, `onended` do
  `AudioContextLike`, cor do acerto em prop pelo `ImpactEvent.prop`, renderer só de UI para o menu
  (`@boboforces/render/menu`) e `GameDeps.loadScene`. Membros do M0 removidos (`setWorld`, caixas, `buildChunkMesh`,
  cena de teste). Detalhes em `docs/ARCHITECTURE.md` §8.
- Menu da web de volta ao orçamento: 364,9 → **315,9 KB** de 350 KB (a cena e o renderer completo vêm por `import()` ao
  entrar no Construto); primeira partida 519,3 KB de 1 MB.
- IDs de conteúdo novos (só acrescentados): `block:concrete-stripe`, `block:cinder-block`, `block:canvas`,
  `block:led-strip`, `block:exit-sign`, `block:danger-sign-a`, `block:danger-sign-b` e `model:crate-large`.
- Fontes candidatas (decisão #46): TTF e `OFL.txt` no repositório; o atlas gerado fica fora do git e do build publicado
  (`npm run fontbake -- candidatas`, seção `local` do `runtime-assets.json`).
- **Golden** passa para o Construto real (`.bfmap` + `nav`): `bf9caca1` (Construto sintético) → **`a15e05de`**
  (8 bots, semente 42, 3.600 ticks: 26 abates, 208 tiros). Motivo: o golden agora prova o mapa, as props, a colisão e a
  navegação de verdade, pelo mesmo caminho do loading do jogo (`packages/game/src/scene/golden.test.ts`).
- CI: geradores de assets em dia (`npm run assets:check`) e o smoke do Construto; scripts `bench:sim` e `bench:nav`.
- Testes: 934 → 913 com a saída dos membros do M0 (o `mesh.test.ts` do mesher antigo, com 16 casos, o golden sintético
  da IA e os casos do céu e das caixas do M0); a verificação levou a 922.
- **Eden:** o Construto roda no NRO. Correções de shader achadas lá (o recompilador do Eden derrubava o app): hash de
  célula só com float (sem `IMUL`), sem `return` antecipado nos programas instanciado e de partículas, sem índice
  dinâmico em array de uniform; o `render.test.ts` confere. Loading no Eden 5,8 s (meta 4 s) e picos de 200–550 ms no
  `renderViews` ficam para o Teste Zero no console. O bench grava `[bench] pico …` e o rastro dos 3 primeiros frames.

**Parte 3: medições e documentos**

- **Céu corrigido:** o Entardecer e a Noite saíam com o céu em chiado nos prints (estrelas em ~99% das células e nuvens
  em ruído; de dia as nuvens sumiam). Causa: o hash só de float da parte 2 deixava os bits baixos do `bfHash` quase
  sempre em zero. Agora cada byte sai dos bits altos de um `bfHashF` de semente própria (sem multiplicação inteira:
  segue valendo no Eden, conferido no NRO); teste `render/src/shared/hash-bits.test.ts`. Os 43 prints foram refeitos.
- `npm run bench` ganhou `--gpu-alto` (GPU dedicada no notebook híbrido: sem ela o Edge fica na Intel UHD mesmo pedindo
  `high-performance`) e `--sem-vsync` (mede a folga acima do teto da tela); o nome do relatório diz as duas.
- **PC de referência** (i5-12450H + RTX 2050, Edge 156 com janela): 4 vistas e 24 bots sem perder nenhum vsync (p99
  18,9 ms; o Edge com janela fica em 56 fps até numa página vazia) e **485 fps sem vsync**: critério 5 ok na RTX. Na
  Intel UHD, que é o que o Edge usa sem configurar, 49,6 fps (p90 35 ms). Preset da dock por 10 min: p99 18,8 ms, máx
  19,9, heap 44 MB. 1 vista, 24 bots, 90 m: 1.112 fps sem vsync. As 4 rotas (array/atlas × int/float) custam o mesmo.
- **Eden** (NRO de 58 MB): 4 vistas/12 bots, 1 vista/24 bots e o plano B rodam sem erro, 7 programas, heap 43–44 MB;
  loading 6,0–6,3 s e os mesmos picos de `render` (degraus de ~250 ms, em ~45% dos frames), iguais nas 3 rodadas.
- Gerados conferidos: `npm run assets` sem mudança nenhuma, `assets:check` em dia, `audioconv` byte a byte igual,
  `fontbake -- candidatas` (atlas local de 571 KB). Golden `a15e05de` e `balance` mantidos.
- Docs: `PERF.md` (custos de cada frente, rodadas do PC e do Eden, tabela do Teste Zero item a item), `TESTE_ZERO.md`
  (rótulos reais do título, tempo do bench no Eden, seção 11), `CREDITOS.md` (versões, links e arquivos usados) e
  `DEPENDENCIAS.md` (lamejs só no `audioconv`, LGPL, fora do jogo).

**Parte 4: verificação (corretor do M1, a partir dos revisores de critérios, bugs, desempenho e arte)**

- **Print de leitura (critério 1, item 4):** os 4 pares de manequins estavam na mesma visada e o de 5 m tapava os de
  30 e 50 m em todos os prints. Agora é UM par (time A e time B) no fim da estrada do norte, com as 4 câmeras na mesma
  reta a 5, 15, 30 e 50 m dele; atrás do par, uma parede de teste a 24 m; à esquerda, uma sebe de 1,5 m no limite da
  grade (o terço esquerdo do quadro era o fim do mundo). O contorno sai com 2 px (o do 3–4P: a vista de 640×360) e o
  jogo só desenha os manequins de print com a câmera deles (bench e JOGAR ficam só com os 6 da vitrine).
- **Print de densidade:** um contraforte de tijolo no MESMO plano da frente da cabeça do manequim, com as câmeras a
  1 m e 3 m desse plano (antes o muro ficava 1,25 m atrás e o print exagerava o pixel do bobo).
- **Sombra-blob** aparece (a borda do `smoothstep` estava invertida e o fragmento sempre caía no discard).
- **Galpão:** o fundo saía preto puro no Dia. Painéis baixos embutidos nas paredes, uma faixa luminosa no piso do
  corredor do meio [PROPOSTA] e um piso de 1 nível de céu na luz comum dos shaders (nada fica preto puro).
- Vitrine: o zumbi em pé (o agachado passou para o mecânico); o painel da fachada embutido acima do portão.
- **Clarão de tiro por vista** (arte-ux §1.8): antes um tiro clareava as 4 vistas.
- **Teto de detritos do perfil** chega ao render (antes todo perfil usava 200; o `switch34p` pede 120 e o PC 500).
- **Switch, telas de teste:** X e Y estavam trocados no teste de controles e no de áudio (os botões são por posição);
  com o `bench.json`, as sondas tardias rodam depois do relatório (inflavam o loading do Eden em 0,2–0,5 s).
- **Bench, relatório versão 2:** `bots_efetivos`, `manequins`, `detritos`, `frames_lentos` (40–60, 60–100, 100–250,
  250+ ms e os vãos de mais de 1 s, fora das estatísticas), `inicio_ms` (os primeiros frames) e `sim_ia_ms` (média,
  p99, máximo e custo por tick: no nx.js o relógio é em ms inteiros e a mediana dava 0). `erros=` passa a contar os
  erros do three. Picos: o pior frame acima de 1,5× o alvo em cada janela (duração/20), com `frame_ms`. Chaves de
  bissecção `hud`, `vm`, `fx` e `actors`.
- **Sondas `[t0]` do jogo:** sem amostra saem `pulado` (antes `ok` com zeros); o item 11 confere a meta por vista; o 15
  mede os primeiros 120 frames da partida; o 16 compara o 1º minuto com os últimos 60 s POR TEMPO (antes, as últimas
  14.400 amostras); o 12 traz o total de bots de verdade.
- Tela de loading na ordem do loader (luz antes da malha); "Relatório gravado no runtime.log · B volta" e "B interrompe
  o bench." na tela do Switch; as alocações por frame que restavam no laço da partida saíram (regra 11).
- Shaders: o último índice dinâmico em array de uniform (`uEmissiveLayers`) saiu e o teste vale para qualquer uniform.
- **Golden** `a15e05de` → **`b452f553`** (18 abates, 228 tiros): o mapa mudou (sebe, estrada e fecho na borda,
  painéis do galpão, contraforte no pátio, painel da fachada).
- **PC** (RTX 2050, 4 vistas, 24 bots, 60 s): 60,0 fps, p99 17,2 ms, nenhum frame acima de 40 ms, loading 570 ms.
- **Eden** (NRO novo, dock encurtada em 30 s): 58,5 fps, p99 46 ms, nenhum frame ≥ 100 ms: os picos de 250/500 ms
  sumiram. A/B com o índice dinâmico, as sondas tardias e a sombra-blob antiga deram o mesmo: a causa não está isolada.
  Loading 5,3–5,5 s (6,2 s com as sondas por cima). O console decide.
- Docs: `TESTE_ZERO.md` (itens 4, 5 e 9 só no boot; capturas no console; ciclo de vida numa partida JOGAR, não no
  bench; o "B volta" no fim do bench; item 16 também no portátil; bissecção; seção 12 dos celulares), `PERF.md`
  (rodada nova, tetos por perfil no §6, loading limpo do Eden ~5,8 s) e `ARCHITECTURE.md` (§8 e §10).

**Parte 5: depois da verificação (antes do Teste Zero no console)**

- **Número de setor no chão (arte-8):** os marcadores mostravam um algarismo de 1 a 4 sorteado por célula. Agora são
  9 blocos (`sector-marker-1` … `-9`), um por setor da planta 3×3, de 1 (noroeste) a 9 (sudeste); `blocos16` com 67
  camadas. O ID `block:sector-marker` nunca saiu num commit, então foi trocado, não aposentado. Golden `b452f553`
  igual (mesmas flags). Os 43 prints são de antes: neles os números ainda são os sorteados.
- **Bench abre a cena depois de um frame do título** (como JOGAR no menu): o loading do bench deixou de pagar o
  primeiro desenho da UI. No Eden, na mesma build: 5,3–5,5 → 5,0–5,2 s.
- **Diagnóstico para o console:** a linha `[cena] loading` separa a chegada dos arquivos da decodificação; as linhas
  `[bench] pico` trazem o heap no pico e na amostra de 1 s (coleta do V8 × espera do GL). No Eden, ler os 18 arquivos
  do RomFS leva menos de 10 ms; a decodificação, ~0,65 s; e os picos voltaram (6 fps), quase todos espera de GL.
- Correção nos docs: o nx.js 1.0.0-beta.7 roda V8, não QuickJS (o `Switch.memoryUsage()` é o `HeapStatistics` do V8).

**Parte 6: escolhas dos prints (decisões #50–#54, 03/11/2026)**

O Erick viu os prints da cena-vitrine e escolheu; o plano (`local/desenho-escolhas/PLANO.md`) rodou em 4 passos: a #52
sozinha, os contratos, 8 frentes em paralelo e a integração.

- **Luzes, sem contorno e filtro (#50):** Dia, Entardecer e Noite aprovados como estão, chão ao longe em
  `NEAREST_MIPMAP_LINEAR`. O contorno de time saiu inteiro: casco, desvio do shader, uniforms só dele
  (`RenderDebug.outline`/`outlinePx`, `GameDebugApi.setOutline`). Os bobos caem de 13 para 7 `InstancedMesh` por
  conjunto e o programa 4 de 9 para 2 uniforms próprios.
- **Bobos a 32 px/m (#51):** a pintura continua 64×64 (`composeSkin`); no loading o `expandSkin` (Scale2x face a face +
  grão de ±5%, o visual do print 2, por menos da metade do custo da skin de teste) amplia para 4 camadas 64×64 por
  skin, com o nível 1 = a pintura sem filtro. Layout da pintura por quadrante de 32×32, `skinparts@2` em ladrilhos
  (o `@1` é recusado com "rode npm run assets"; `partes64.png` 8,6 → 4,7 KB e decodificação ~3× mais rápida),
  `writeModelLayer(primeira, k camadas, nível 1)` em laço com profundidade 1, reserva de 64 camadas = 16 skins, cor do
  cubinho no nível 1, atlas do plano B com 3 níveis no `modelos64`. Saiu a skin de teste (`density.ts`,
  `densidade32.png`, `setSkinDensityTest`). O rosto fica na folha 8×8 (pergunta do M2).
- **Dose dobro jogável (#52):** as 7 props do dobro colidem, param bala, tapam a visão dos bots, entram na navegação e
  acendem luz (`isPlayableProp`; a chave `propDose` ficou só visual, para A/B de custo no bench). O barril do dobro foi
  0,3 m para oeste (religa um nó ilhado). O teto de grupos de props corta pela distância à superfície do grupo.
  **Golden, ponto de controle 1 (intermediário): `00f01aac`** (20 abates, 275 tiros, 10×10; com o barril no lugar
  antigo daria `8578936f`).
- **Bobos mais altos (#53), variante A = 1,625 m:** tronco 8×10×5, braços 3×9×3, pernas 4×8×4 px de pintura (cabeça
  8×8×8); corpo e AABB 1,625 m, olho 1,425 m. Agachado com a pose do format (`BOBO_CROUCH_POSE`,
  `crouchedPartBounds`): topo em 0,95 m, cabeça afundada 3 px, tronco a 36,9°; o rig do render e a hitbox da sim usam a
  mesma pose, e a hitbox agachada são caixas ORIENTADAS (a envolvente acertava ar em 7,9% dos tiros). Régua de
  métricas `print:altura` no Construto (porta, muro de 1,5 m, cobertura de 1,0 m, manequins `altura:em-pe` e
  `altura:agachado`, desenhados só com essa câmera); EYE das câmeras do mapa vem do METRICS; o `mapc` conta o nó em pé
  com 4 células e avisa "visto sem ver" (25 nós). Luz do ator e centro do corpo nos VFX pelo `bodyHeight/2`. As
  variantes B (1,75 m) e "antes" (1,5 m) só existem como prints numa cópia descartável.
- **Fontes (#54):** Russo One (display, "BoboForces Display") e Saira Condensed SemiBold (HUD, "BoboForces HUD"),
  nomes derivados sem o Reserved Font Name, com a guarda no fontbake; atlas de 119,5 KB baixados (era 141,1 KB com a
  Barlow), teto de 120 KB lido como PNG + JSON em gzip (decisão menor revisável). `licencas.txt` com as fontes em uso
  na web e no romfs do Switch. A comparação das candidatas virou a folha das fontes em uso (`showFontSpecimen`); o
  título do Switch ganhou a grade de 2 colunas com rótulos curtos. Saíram a Barlow, a Chakra Petch, as candidatas e a
  seção `local` do `runtime-assets.json`.
- **Prints:** roteiro de 43 → 26 PNGs (saem doses, mip, contorno e candidatas; entram altura, folha das fontes, HUD
  visível, títulos da web e do Switch e uma leitura com o atlas).
- **Golden, ponto de controle 2 (FINAL): `cf65a778`** (22 abates, 359 tiros, 13×9; igual com `--jitless`). Duas
  causas: a #53 (corpo, AABB e olho novos mudam colisão, visão dos bots e hitbox em pé) leva `00f01aac` → `4346c24a` no
  mesmo mapa; a régua tira 9 nós de navegação fora da área (7.174 → 7.165) e o passeio dos bots sorteia pelo número de
  nós, o que leva a `cf65a778`. A hitbox agachada não muda o golden (os bots Normal não agacham).
- Docs: `ARCHITECTURE.md` (§7, §8 com os contratos antes → depois e as pendências, §9 e §10), `arte-ux.md` (§1.2,
  §1.5, §1.6, §2.1, §2.2, §2.6–§2.8, §5.2, §6.2, §13), `tecnico.md` (§6.1, §6.5, §6.6, §7.1, §7.2, §8, §9, §16.3,
  §16.4, §22), `gameplay.md` §3.1, `CREDITOS.md` §3, `PERF.md` §1d, `TESTE_ZERO.md` §5 e `.interface-design/system.md`.
- **Correção da revisão (03/11/2026):**
  - O manequim `altura:agachado` saía EM PÉ no print oficial da régua: com a cena congelada o `dt` do rig é 0 e a
    transição de agachar não andava. Quem não é entidade da sim (`entity` 0) entra direto na pose; testes novos no
    `rig.test.ts` (agachado com `dt` 0 e manequim de pé que herda o índice de um agachado).
  - Régua sem paralaxe: plano z = 78,5 com a face de fora da cabeça dos manequins no plano das paredes, câmera a
    2,25 m (32 px por 12,5 cm em 1280×720, conferido nos três prints: topo do boné em y = 224 / 192 / 160 para
    1,5 / 1,625 / 1,75 m), fundo de concreto liso e cobertura de parede de teste (as marcas de 12,5/25/50 cm no plano).
  - `bfAtlasCorner` sem `mod` e com +0,5 na divisão: a conta antiga errava a linha na Intel UHD (ANGLE) com 7 e 13
    colunas; teste em float32 com a divisão 1–2 ULP abaixo. Rota do atlas no Eden: 59,1 fps, 7 programas, 0 erros.
  - Marcadores de setor: o 6 e o 9 ganharam um sublinhado (girado 180°, o 6 era o 9); teste de giro no texgen e o
    conjunto de prints 9 (`print:setores-norte`, `-sul` e `-4-5`, novas no `PRINT_CAMERAS`).
  - Fontes: o GitHub Pages não serve gzip -9 (+4,8% no JSON das fontes do M0); size-check e fontbake medem o JSON no
    nível 4 e o kerning começa em 0,25 px (1.357 → 1.120 pares, PNG igual): 119.605 B, folga de 395 B. Guarda do RFN
    com aspas simples e par casado, e falha fechada quando a declaração existe sem nome legível
    (`FontSpec.reservedNames`). Teste do título com o alvo de toque de verdade (e um alvo 640×360 com toque).
  - `licencas.txt` do Switch com o runtime do nx.js (MIT) e a Geist Mono (OFL) do RomFS dele; o cabeçalho diz o que
    ainda falta (as bibliotecas que o runtime embute).
  - Numeração dos prints na arte-ux §5.2 igual à do roteiro (6 fontes, 7 altura, 8 título, 9 setores).
  - **Golden: `372dcaea`** (22 abates, 231 tiros, 8×14; igual com `--jitless`): a régua tirou 4 nós fora da área
    (7.165 → 7.161) e o passeio sorteia pelo número de nós.

**Parte 7: port do boneco do FutBobo (decisões #55 e #56, 04–07/11/2026)**

O bobo do jogo passou a ser o boneco do FutBobo, com 1,75 m (4 cabeças, 32 px, cabeça de 0,4375 m). O bobo A (6 partes,
7 draws) saiu do código e dos assets. Plano, relatórios das frentes e medições em `local/futbobo-port/` (privado);
números com data e método no `docs/PERF.md` §1e; contratos no `docs/ARCHITECTURE.md` §8 e §11.

- **Altura B (passo 1, ponto de controle CP1):** `bodyHeight` 1,75, `eyeHeight` 1,55, `aabbHeight` 1,75 e `headSize`
  0,4375; as 5 aberturas do Construto (3 seteiras da cabine, a janela da guarita e a do 1º andar do prédio 1) de 1,5 para
  2,0 m. O "visto sem ver" do mapc caiu de 25 para 10 nós (faixa 1,55–1,81 m) e a pendência da lona de 1,5 m fechou.
- **format:** `figure*.ts` (FK afim de 12 ossos, pose de 34 chaves, 22 posturas, tabela de jogo com `slack` e `bulge`,
  IK, empunhaduras, cabelo de 34 cortes, gabaritos, `FigureLook`, 12 presets, pintor de 2 camadas em pixel art).
  `platform-profiles` ganhou `figureNearM`, `figureHalfRate` e `figureBotLooks`; 8 `skin:*` novos; mapa com pose
  `slide`, fila `linha:1..8`, `close:1|5`, `altura:deslizando` e as câmeras `print:linha-*`, `print:close-1m` e
  `print:altura-45` (o `.bfmap` continua `map@1`, com 10.214 B).
- **sim e IA:** 12 hitboxes por osso, lidas da tabela de jogo por postura × pitch (raio com a pose em cache: 0,18–0,39 µs
  com JIT); cabeça presa ao olho; agachado P4f com teto de hitbox de 0,97 m (era 0,95); a cabeça agachada só levanta (o
  agachado atrás de cobertura de 1,0 m não leva tiro além de 7 m em todo pitch); braços cortados a 0,75 m do eixo (muro e
  lona); IA mira a parte visível da caixa (teto de 2 miras por tick). `HitEvent.bodyPart` = `FigurePart` 0..11.
- **render:** 1 draw de bonecos por vista (R4c: cubo instanciado no programa 4, uma instância por caixa, 4ª linha da
  matriz com expressão e flash, `boundingSphere` fixa), sem programa, atributo ou uniform novo (7 programas); motor de
  animação com envelope medido, molas, LOD L0/L1/L2 e arma pela moldura da mira; desmonte em 6 grupos de ossos; viewmodel
  com os braços do boneco; `FrameViews` com a vista do dono (`uHideSlot`). Skins de 2 camadas (32 vagas na reserva de 64;
  Switch 10 skins, PC 19).
- **game e web:** etapa "figuras" no loading, `ActorBuffer` com `figure`, `posture`, `expression` e `velocity`, ganchos dos
  prints (`setMannequins`, `setFigureClip`), relatório do bench com `bonecos=`, `figure_lod` e `figuras=`; roteiro `rodada3`
  com 99 prints e 16 perguntas; `smoke:web` e `size-check` com as travas ligadas (`REQUIRE_ACTOR_DRAWS`, `RETIRED_ASSETS_FAIL`).
- **guard:** regra de laço quente (regra 11): alocação proibida entre `// quente:` e `// fim-quente`, e as regiões são
  obrigatórias em `figureFk`, `figureHitBoxes`, `figureGamePose`, `paintFigureSkin`, `rayVsBobo`, `anim/rig.ts` e
  `figure-instances.ts`.
- **Eden:** o emulador adia as instâncias N−1 de um draw instanciado e as desenha com o estado do draw seguinte (bonecos
  truncados; o caminho antigo também saía quebrado). Nenhuma opção da config corrige; contorno "F" (o mesmo draw sem
  instâncias com 1 primitiva logo depois de cada draw instanciado de 2 ou mais), ligado só por detecção a cada boot
  (`applyInstancingFix`, `apps/switch/src/main.ts`): sondas das figuras 20/108 → 108/108, custo dentro do ruído. No console
  a detecção deve dar "normal" (falta testar).
- **Golden:** **CP1 `079f5850`** (só a altura B e as 5 aberturas; o mapa e as métricas mudam o passeio e os tiros) e
  **CP2 `cb50303f`** (22 abates, 334 tiros, placar 8×14; igual com e sem JIT), que muda por causa das hitboxes por osso e
  da tabela de jogo (`9324de80`), da mira da IA e das métricas B; o corte dos braços e a cabeça que só levanta não mexeram
  nele (os bots Normal do golden não agacham). Antes do port: `372dcaea`.
- **Balance** (semente 42, 3.000 duelos): precisão 3,4 / 7,9 / 16,9 / 31,0 / 37,5% → 3,2 / 7,2 / 15,6 / 28,6 / 35,5%;
  headshot 35,4 / 46,4 / 57,6 / 55,7 / 66,1% → 41,7 / 39,0 / 44,5 / 46,4 / 59,4%; TTK 1,60 / 2,13 / 1,21 / 0,52 / 0,29 s →
  2,72 / 2,31 / 1,57 / 0,66 / 0,35 s. Ordem dos 5 níveis ok; par mais apertado 84,4%. Os multiplicadores de headshot ficam.
- **Saíram:** `skins/partes64.{png,json}` e a tira `skins/modelos64-rostos` (as camadas `faces` e `faces_zombie` nunca
  são reusadas), `format/model/skin*.ts`, `render/actors/{rig,bobo-geometry}.ts`, `fx/dismember.ts`, o gerador antigo do
  `skingen` e `assets-src/skins/`; `HITBOXES`, `aimPointHeight` e `crouchedPitch` da sim; `ActorBuffer.face`,
  `faceLayer`, `walkPhase` e `walkAmount`; a `skinparts` foi para os formatos aposentados. `npm run assets` agora é
  texgen → modelgen → mapc; script novo `npm run skingen:figuras` (prévia do pintor em `local/skins/`).
- **Tamanho:** primeira partida 533,0 → 518,5 KB, build 554,1 → 539,5 KB, menu 294,7 KB (motor, pintor e tabela fora do
  chunk do menu).
- **Roupa militar (#58):** saiu o uniforme de futebol (camisa, estampas, número, escudo, meião e chuteira; `figure-glyphs`
  e `figure-paint-shirt` apagados): `FigureOutfit` (tecido liso, woodland, deserto, urbano, noturno ou com graxa;
  jaqueta, calça, colete, botas e luvas) no lugar do `FigureKit`, `figureOutfitFor` com o colete de time e o ícone ▲ ● ■
  ◆, braçadeira, luvas e joelheiras do time (38,1–39,0% da frente na cor do time); membros em colunas, bota de combate,
  12 looks de farda e o roteiro `rodada4` com as perguntas R1–R4. Rodada 4 aprovada como está (#59).
- **Crédito do menu (commits do Erick de 03/11, depois do M0):** "EriLab™ / Erick Luiz". As fontes do M1 não têm o ™: o
  `drawText` o compõe com T e M a 0,48 em sobrescrito, escrevendo direto na lista como os outros glifos (sem alocação).
  `COMPOSED_CHARS` diz aos testes de cobertura (ui e fontbake) que o ™ conta como "TM".
- **Pendente:** tabela de jogo no Eden (259 ms; meta ≤ 75, plano B = tabela gerada no build), skins no Eden (237 ms; meta
  180), console (Teste Zero), bench nos celulares, emote no `ActorBuffer` (M2) e escala do zumbi na hitbox (M3).

### M0 Fundação (publicado em erereck.github.io/boboforces, P-002)

**Etapa 1: esqueleto e contratos**

- Monorepo com npm workspaces (`packages/*`, `apps/*`, `tools/*`), Node 24+, TypeScript 7 strict no padrão do VNbobo,
  Vitest com um projeto por pacote, Prettier (120, aspas simples), `scripts/typecheck.ts` em paralelo.
- Pacotes: `shared`, `format`, `platform-api`, `input`, `world`, `nav`, `sim`, `ai`, `ui`, `audio`, `render`, `game`.
  Os puros compilam sem DOM e sem Node (`tsconfig.src.json`).
- Apps: `apps/web` (Vite, `base: './'`) e `apps/switch` (esbuild, NACP com title ID `01E1AB0B0B0F0000`).
- Tools (esqueleto): `texgen`, `fontbake`, `balance`, `guard`, `portcheck`, `size-check`.
- `shared` completo e testado: math sem alocação (vec3, ângulos, quantização u16/i16), RNG sfc32 com fluxos por
  domínio (`fork`), `Pool`, `IndexAllocator`, `RingBuffer`, `BitWriter`/`BitReader`, hash FNV-1a + `StateHasher`,
  `assert` e log com anel de erros recentes.
- Contratos: `Platform` e peças; `RawInputState`, ações, `InputFrame` (88 bits); grade/célula/chunk/registro de blocos,
  DDA, AABB e `buildChunkMesh`; `Sim`, `SimView`, `SimEvent`, `EntityId`, métricas canônicas e perfil Bobo, `FixedStep`;
  `MatchRecipe@1`, ids de formato e de conteúdo; `UiNode`, `DrawList`, tema escuro, `strings.pt-BR.ts`; `Renderer`;
  `startGame` com `NullRenderer`.
- Versões fixadas: three 0.187.0, fflate 0.8.3, vite 8.3.5, vitest 5.1.0, esbuild 0.28.2, prettier 3.9.10,
  typescript 7.0.2, @nx.js/* 1.0.0-beta.7, msdf-bmfont-xml 2.8.0, playwright-core 1.64.1.
- Docs: `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/PORTABILIDADE.md`, `docs/PERF.md`, `docs/DEPENDENCIAS.md`,
  `docs/PROMPTS.md`, `version.json`.

**Etapa 2: frentes em paralelo**

- `world`: DDA (`raycastGrid`), AABB varrida com degrau de 0,5 m, formato RLE + deflate, arena de teste e greedy
  meshing por textura (vértice de 12 bytes). `sim`: movimento do perfil Bobo, fuzil hitscan com recuo, dano por parte,
  morte, respawn, regras do Warfare, snapshot e hash. `ai`: bot mínimo (percepção, mira com erro e recuo, 5 níveis).
  Golden: 8 bots, semente 42, 3.600 ticks, hash `f991a92c`. `tools/balance`: 3.000 duelos, ordem dos 5 níveis.
- `format`: validador da `MatchRecipe@1` (tetos da plataforma, fallbacks, campos desconhecidos mantidos), migrações,
  perfis de plataforma, PNG próprio (decodificador e codificador). `input`: mapeador (zona morta radial, curva,
  aceleração na borda, toque), slots locais, menu por qualquer dispositivo; adaptadores web (teclado, pointer lock,
  Gamepad API, toque).
- `render`: three só aqui; blocos em `TEXTURE_2D_ARRAY`, atores instanciados, 1 a 4 viewports por scissor, céu por
  uniforms. `tools/texgen`: paleta mestra e as 8 primeiras texturas 16×16. `ui`: layout por âncoras, foco espacial,
  texto MSDF (Barlow Condensed provisória), título e Ajustes; `tools/fontbake`.
- `apps/switch`: platform-switch completa (save no SD com backup, `runtime.log`, aviso sem GPU), scripts NRO/NSP;
  `tools/guard`, `tools/portcheck`, `tools/size-check`, CI e deploy do Pages. `apps/web`: splash inline, avisos de
  navegador, platform-web.

**Etapa 3: integração**

- `game`: boot (assets pela `platform.assets`) → título WebGL → JOGAR → cena de teste (jogador em 1ª pessoa no
  teclado/mouse com pointer lock, controle ou toque, trocando pelo último dispositivo usado; 4 bots; atores em
  caixas; HUD com vida, abates, munição e retícula em MSDF) → pausa (pointer lock perdido, aba oculta, P/Esc, Start/+,
  botão de toque) → volta ao título. `LocalDriver` com passo fixo e interpolação; com o NullRenderer roda igual.
- Cascas: `apps/web/src/main.ts` (boot depois do primeiro pixel, pointer lock no clique, gancho `window.__bfDebug`) e
  `apps/switch/src/main.ts` (textos pela tabela pt-BR, "Sair" no título). Assets por caminho lógico
  (`assets-src/runtime-assets.json`): Vite serve/emite e faz preload; o build do Switch copia para o RomFS.
- Contratos: `Renderer.setUiAtlas`, `@boboforces/render/data` (sem three), `GraphicsSurface.safeArea`,
  `GameDeps.hooks` (ver `docs/ARCHITECTURE.md` §8). Textos para todos os `ISSUE_CODES` e `binding.ctrlReserved`.
- Atlas da UI 21% menor (display só caixa alta, PNG RGB): 170 → 134 KB, carga inicial 375 → 338 KB (orçamento 350).
- CI: portcheck `--strict` (boot até o menu) e `npm run balance`; teste do bundle REAL do Switch no portcheck.
  `npm run smoke:web`: build no Edge headless (splash, título, cena, pausa, programas ≤ 7, zero erros).
- Dependências de workspace declaradas: `fflate` no `world`, `@boboforces/ui` e `@boboforces/format` no
  `fontbake`, `@boboforces/ui` no `apps/switch`. Nenhuma dependência externa nova.

**Etapa 4: correções da revisão independente**

- Golden `f991a92c` → `e3f37a6e` (mudança intencional na sim e na IA, motivos abaixo). `npm run balance` segue com a
  ordem dos 5 níveis.
- `sim` independente do passo (o Switch pode cair para 30 Hz sem rebalancear): `createSim({ hz })` e `Sim.hz`; atrito
  exponencial exato (`friction` 16 → 18,5 para manter ~0,25 s até parar, agora ~0,26 m deslizando a 30 e a 60 Hz);
  deslocamento no plano integrado sem erro de passo; cadência das armas em segundos com o resto do tick passando para o
  tiro seguinte (antes 700/min virava 600/min a 30 Hz). A IA e o `LocalDriver` recebem o mesmo `hz`.
- Degrau para baixo: no chão, o bobo gruda para descer degraus de até 0,5 m (antes ficava ~0,4 s no ar numa escada de 3
  degraus, com dispersão de pulo, evento de pouso e a IA sem poder pular).
- Respawn: morto exatamente `respawnS` (180 ticks em vez de 179) e pelo menos 1 tick com `respawnS = 0` (antes morria e
  renascia no mesmo tick, sem a IA nem o render verem a morte).
- IA: o orçamento de 4 raios da percepção vai para os inimigos mais próximos no cone, não para os de índice menor.
- Passo fixo com folga de 2% de tick: frame igual ao tick (ou múltiplo) roda sempre 1 (ou 2) ticks, em vez de 0/1/2 com
  o jitter do relógio. O `game` mede o frame pelo timestamp do rAF.
- `game` compila sem a lib DOM (importa do render só `@boboforces/render/data`); câmera com o mesmo limite de pitch da
  sim (mira a 89° + recuo não vira mais a imagem).
- Guard: colchete, cast, alias, desestruturação e `Reflect.get` da raiz global; escopo por bloco nas declarações;
  regra 10 por lista branca (`Math` só com as funções puras); `toLocaleUpperCase/LowerCase`; `.constructor(…)` e
  `setTimeout` com texto; `import()` não literal até em `apps/web`; `import.meta` fora das cascas; mais globais do
  navegador; float/half-float e textura comprimida do three. Teste de workspaces: todo projeto do Vitest roda os
  seus testes (a raiz não usa mais `passWithNoTests`; `audio` e `nav` ganharam teste).
- Portcheck: `fetch` é rede no bundle do Switch; acha nomes proibidos pela raiz global e entre colchetes.
- `render`: atores sem faixa de upload e UI com faixa fixa (sem objeto novo por frame no `addUpdateRange` do three);
  teste de shaders cobre todos os exportados (UI incluída, `texelFetch`).
- Switch: aviso de falha no boot COM GPU sai pelo próprio WebGL2 (fonte bitmap 5×7 com scissor + clear), porque o
  canvas já é WebGL2 e não dá 2D; HOME/sleep detectado pelo vão a partir do FIM do frame (entrar na partida não pausa
  mais); exportar grava em `exportar/` (não sobrescreve `save.json` nem o log).
- `Storage.getBackup(key)` no contrato da Platform, por chave nas duas plataformas (Switch: `save.previous.json`),
  com um teste de contrato único rodado pelas duas cascas.
- Web: erro depois do menu também mostra a página "Não deu para carregar" (o splash volta por cima da canvas).
- CI: `smoke:web` no navegador (Edge headless; também em 667×375). Deploy do Pages só depois do CI passar
  (`workflow_run`), sem pular formatação, build do Switch, portcheck e balanceamento.

**Etapa 5: conferência final**

- UI: o menu aplicava a escala de referência duas vezes (`layoutTree` recebia a escala final no lugar do tamanho
  escolhido pelo jogador). Em 1280×720 não aparecia; em 667×375 os botões encolhiam e o texto passava por cima deles.
  `UiFrame` ganhou `userScale` (1 no M0).
- Web: os px exatos do aparelho (`device-pixel-content-box`) só valem se baterem com CSS × DPR. A emulação de DPR do
  Chromium headless informa o box sem escalar e o canvas saía em 1x num aparelho 2x.
- Antes da publicação (auditoria de segredos, licenças, CI e higiene): o build da web gera `licencas.txt` com o
  LICENSE de cada pacote npm que entrou no bundle (three, fflate) e a OFL da Barlow, linkado no `index.html`
  (`rel=license`); `.gitignore` ignora qualquer `*.keys`; README, README do Switch, PROMPTS, CREDITOS e DEPENDENCIAS
  atualizados (status do M0, Node 24+, dependências indiretas do nx.js usadas pelos scripts locais).
- Publicado: commit `b01de7b` em `erereck/boboforces` (público), CI verde no primeiro push (Edge do runner, sem
  fallback) e deploy do Pages ok. Splash na URL publicada em 432 ms (primeira visita): os 4 critérios de pronto do M0
  estão cumpridos. `smoke:web` ganhou `--url` para medir um site publicado.
