# Arquitetura do BoboForces

> Estado: M0 integrado (02/11/2026); contratos do M1 fixados (03/11/2026, §9); **M1 integrado (03/11/2026, §8 "M1" e
> §10)**; **boneco do FutBobo integrado (07/11/2026, §8 "Port do boneco" e §11)**: onde um trecho abaixo fala do bobo
> de caixas (A, 1,625 m), ele é histórico e a marca "[port]" diz onde está o contrato novo. Fonte: `docs/design/tecnico.md` §1,
> §3, §4, §9, §10, §21. `docs/DECISOES.md` manda sobre este texto. Regras de portabilidade completas em
> `docs/PORTABILIDADE.md`.

## 1. Ideia geral

Um código só, com duas cascas. Todo o jogo vive em pacotes TypeScript (`packages/*`) que não sabem que existem DOM,
rede ou Switch. `apps/web` (Vite) e `apps/switch` (esbuild → nx.js) só implementam a interface `Platform` e injetam o
renderer. A simulação é separada da renderização: a sim só emite eventos e expõe uma `SimView`; render, UI e áudio só
leem.

## 2. Grafo de dependências

```
shared
├── format ── world ── nav ──┐
├── input ───────────────────┴── sim ── ai ──────────┐
│   ├── platform-api (só tipos)                      │
│   └── ui                                           ├── game ── apps/web, apps/switch
├── audio  (+ platform-api)                          │
└── render (+ platform-api, world, ui, three) ───────┘  (o game importa só os TIPOS do render)

net (M5, só web): importa shared, format, input e sim (platform-api na fase 3); só apps/web importa net.
```

Em lista (cada pacote só importa os da esquerda que aparecem na sua linha):

| Pacote | Importa | lib | Responsabilidade |
|---|---|---|---|
| `shared` | — | ES2023 (puro) | math sem alocação, RNG sfc32 com fluxos, Pool/IndexAllocator, RingBuffer, BitWriter/BitReader, hash de estado FNV-1a, assert, log |
| `format` | shared, fflate | ES2023 (puro) | `version.json` como constantes, ids `boboforces/<tipo>@<n>`, registro de IDs de conteúdo, MatchRecipe@1, validadores, migrações, decodificador PNG |
| `input` | shared | ES2023 (puro) | teclas, estado bruto padronizado, ações, InputFrame (quantização e bits), perfis, mapeador |
| `platform-api` | input (tipos), shared (tipos) | ES2023 (puro) | só tipos: `Platform` e as peças dela |
| `world` | shared, format, fflate | ES2023 (puro) | grade 0,5 m, célula u16, chunks 32³, BlockRegistry, DDA, AABB varrida, mesher (só arrays) |
| `nav` | shared, world | ES2023 (puro) | grafo 2,5D, A*, flow field (M1+) |
| `sim` | shared, format, world, nav, input | ES2023 (puro) | ECS-lite em typed arrays, passo fixo, métricas canônicas, perfil de movimento, armas, dano, eventos, snapshot, hash |
| `ai` | shared, format, world, nav, sim, input | ES2023 (puro) | bots que escrevem InputFrames (decisão, execução, mira) |
| `ui` | shared, input | ES2023 (puro) | árvore de UI, layout, foco, DrawList, tema escuro, `strings.pt-BR.ts`, números sem Intl |
| `audio` | shared, platform-api | ES2023 (puro desde o M1) | mixer sobre o subconjunto comum de Web Audio (`AudioContextLike`) |
| `render` | shared, platform-api, world, ui, three | ES2023 + DOM | ÚNICO com three: chunks, texture arrays, instâncias, viewports, DrawList |
| `game` | todos acima (do render, só o subcaminho sem three e sem DOM `@boboforces/render/data`) | ES2023 (puro) | fluxo de telas, cola, LocalDriver, NullRenderer; a cena do Construto em `@boboforces/game/scene` (M1) |
| `net` | shared, format, input, sim | ES2023 (puro) | online P2P (M5, só web): protocolo, snapshot com delta, entradas, transporte, `HostDriver` e `ClientDriver` (§16) |
| `apps/web` | game, render, platform-api, input, shared | DOM + vite/client | casca web: splash, platform-web, adaptadores de input |
| `apps/switch` | game, render, ui, platform-api, input, shared | DOM (ver §6) | casca nx.js: platform-switch, build esbuild, NRO/NSP locais |

**Mudança em relação ao grafo do tecnico.md §3** (`… sim → ai → {input, ui, audio, render} …`): `input` desceu para
logo acima de `shared`. Motivo: o `InputFrame` é a entrada da `sim` (`step(inputs)`), então a sim precisa importar o
tipo dele; com `input` acima da sim haveria ciclo. Consequência: `input` não importa `sim` (a assistência de mira
recebe os alvos por parâmetro) e `ui` não importa `sim` (o `game` monta o estado das telas e do HUD).

## 3. Convenções que todos compartilham

- **Unidades:** metros, segundos, radianos. Dados de jogo em unidades por segundo; a sim converte para ticks
  (`secondsToTicks`), para o Switch poder rodar a 30 Hz sem rebalancear.
- **Eixos:** Y para cima. Yaw gira em torno de +Y; **yaw 0 olha para -Z** (igual à câmera do three) e yaw positivo vira
  para a esquerda (anti-horário visto de cima). Pitch positivo olha para cima. Frente plana = `(-sin yaw, 0, -cos yaw)`,
  direita = `(cos yaw, 0, -sin yaw)` (`forwardFromYawPitch`, `flatForwardFromYaw`, `flatRightFromYaw` no `shared`).
  No three: `camera.rotation.order = 'YXZ'`, `rotation.y = yaw`, `rotation.x = pitch`.
- **Posição de entidade:** centro da base da AABB (os pés). Olho = pés + `METRICS.eyeHeight`.
- **Grade:** célula inteira (x, y, z) ocupa `[x·0,5, (x+1)·0,5)` m. `worldToCell(m) = floor(m · 2)`.
  Célula u16 = blockId (10 bits) | giro Y (2) << 10 | inversão (1) << 12. Índice no chunk:
  `lx | lz << 5 | ly << 10` (x mais rápido, depois z, depois y). Ordem dos chunks: x, depois z, depois y.
- **InputFrame:** `moveX` + = direita, `moveY` + = frente (i8). `yaw` u16 e `pitch` i16 **absolutos**. `weapon` é o
  slot desejado, absoluto: a sim age quando o valor muda. Bits de `BUTTON` nunca são reordenados.
- **Controladores:** índice em `sim.step(inputs)`: 0..3 humanos, 4..67 bots (`BOT_CONTROLLER_BASE`), na ordem de
  expansão da receita (times em ordem, cada `bots[]` em ordem, `count` vezes). A IA roda antes do `step` e escreve os
  frames dos bots.
- **EntityId:** u32 = geração (16 bits altos, começa em 1) | índice (16 bits baixos). `NULL_ENTITY = 0`.
- **Eventos da sim:** objetos de pool, válidos só até o próximo `step()`.
- **RNG:** `createRng(recipe.seed)` é a raiz; cada domínio usa `fork(nome, índice)` (`match`, `bot`/i, `loot`,
  `aim`…). O fork depende só da chave do pai e do nome, nunca do consumo.
- **Cores:** `0xRRGGBBAA` em u32 (`rgba()` do `ui`).
- **DrawList / viewports:** px do alvo, origem no canto **superior** esquerdo, y para baixo (o render converte para o GL).
- **Texto:** sempre por chave de `STRINGS_PT_BR` (`t(key, params)`); `literal` só para dado do jogador.
- **Stubs do M0:** funções de outra frente lançam `Error('M0: frente X (…)')`. Procure por `M0: frente` para achar o que
  falta.

## 4. Contratos (congelados para as frentes do M0)

| Contrato | Arquivo | Assinatura principal |
|---|---|---|
| Plataforma | `packages/platform-api/src/index.ts` | `Platform { id, features, graphics, storage, assets, files, textInput, lifecycle, diagnostics, input, audio, online, now(), requestFrame(), cancelFrame(), exit() }`; `graphics.safeArea` (px reais) |
| Input bruto | `packages/input/src/raw.ts`, `keys.ts` | `RawInputState`, `createRawInputState()`, `keyIndex(code)`, `PAD_BUTTON`, `PAD_AXIS`, `MOUSE_BUTTON` |
| Ações e frame | `packages/input/src/actions.ts`, `frame.ts` | `BUTTON`, `GameAction`, `MenuAction`, `InputFrame`, `writeInputFrame`/`readInputFrame` (88 bits) |
| Mapeador | `packages/input/src/mapper.ts` | `createInputMapper(device, profile): InputMapper` |
| Mundo | `packages/world/src/{constants,cell,blocks,chunk,grid}.ts` | `BLOCK_SIZE`, `CHUNK_SIZE`, `Cell`, `BlockDef`, `createBlockRegistry`, `ChunkData`, `createWorldGrid` |
| Consultas | `packages/world/src/query.ts` | `raycastGrid(...)`, `sweepAabb(...)` |
| Mesher | `packages/world/src/mesh/index.ts` | M1: `buildRegionMesh` (§9.2); o `buildChunkMesh` do M0 saiu na integração do M1 |
| Sim | `packages/sim/src/{sim,view,events,entity,constants}.ts` | `createSim(config): Sim`, `SimView`, `SimEvent`, `EntityId`, `SIM_HZ` |
| Métricas | `packages/sim/src/config/metrics.ts`, `movement.ts` | `METRICS`, `HitPart`, `HEADSHOT_MULTIPLIER`, `MOVEMENT_BOBO` |
| Passo fixo | `packages/sim/src/fixed-step.ts` | `new FixedStep().advance(s) → passos`, `.alpha` |
| IA | `packages/ai/src/index.ts` | `createBotDirector(config): BotDirector` (`think(view, frames)`) |
| Receita | `packages/format/src/match-recipe.ts` | `MatchRecipe` (`format: 'boboforces/preset@1'`), `validateMatchRecipe(input, limits)` |
| Formatos | `packages/format/src/{format-id,content-ids,migrations,png}.ts` | `formatId`, `parseFormatId`, `CONTENT_IDS`, `migrateDocument`, `decodePng` |
| UI | `packages/ui/src/{tree,draw-list,theme,strings.pt-BR,text}.ts` | `UiNode`, `Screen<S>`, `layoutTree`, `moveFocus`, `drawTree`, `DrawList`, `COLORS`, `t()` |
| Render | `packages/render/src/types.ts`, `renderer.ts`, `data.ts`, `menu.ts` | `createRenderer(surface, opts, createUiPass?): Renderer` (com `setUiAtlas`); `@boboforces/render/data` = parte sem three; M1: `@boboforces/render/menu` = renderer só de UI |
| Jogo | `packages/game/src/index.ts`, `scene-api.ts`, `scene/index.ts` | `startGame({ platform, createRenderer, nullRenderer?, hooks?, loadScene?, bench?, benchWarnings?, testItems? }): GameHandle` (M9: com `createRenderer: null`, o `nullRenderer` é obrigatório; falta = erro na largada), `MatchDriver`, `createLocalDriver`, `createNullRenderer()`; M1: `@boboforces/game/scene` (`SCENE_MODULE`) |

**Mudar um contrato:** não edite o arquivo de contrato de outra frente. Anote o pedido na seção 8 deste documento
(com o motivo e o contorno que você usou) e siga. A integração aplica e avisa as frentes.

## 5. Quem é dono do quê (frentes do M0)

| Frente | Pastas |
|---|---|
| (a) shared + format | `packages/shared` (já implementado no esqueleto), `packages/format` |
| (b) world + sim + ai + golden + balance | `packages/world`, `packages/nav`, `packages/sim`, `packages/ai`, `tools/balance` |
| (c) input + adaptadores web | `packages/input`, `apps/web/src/input` |
| (d) render + texgen | `packages/render`, `tools/texgen` |
| (e) ui + fontbake | `packages/ui`, `tools/fontbake` |
| (f) Switch + portcheck + guard + CI | `apps/switch`, `tools/portcheck`, `tools/guard`, `tools/size-check`, `.github/workflows` |
| Integração | `packages/game`, `packages/audio`, `apps/web` (menos `src/input`), configs da raiz, `docs/` |

Cada frente roda só o seu: `node scripts/typecheck.ts packages/sim` e `npx vitest run --project sim`.

## 6. Escolhas do esqueleto que as frentes precisam saber

- **Duas configs por pacote:** `tsconfig.json` (src + testes, tipos do Node, para o editor) e `tsconfig.src.json` (só
  `src`, sem `*.test.ts`, `types: []`). É a segunda que prova "sem DOM e sem Node" nos pacotes puros.
- **Testes ao lado do código** (`src/**/*.test.ts`), um projeto do Vitest por pasta (`packages/*`, `apps/*`, `tools/*`).
  Todo projeto tem pelo menos 1 teste (os stubs do M0 também) e a raiz não usa `passWithNoTests`:
  `tools/guard/src/workspaces.test.ts` reprova se o include de um projeto deixar de casar com os testes dele.
- **`platform-api` importa tipos de `input`** (`RawInputState`) e de `shared` (`Unsubscribe`). Nada de DOM: canvas,
  contexto GL e AudioContext são `unknown`.
- **Acréscimos à `Platform`** além da lista do plano: `features` (perfil sugerido, toque, reduzir efeitos, pode sair),
  `audio: AudioSurface | null`, `requestFrame`/`cancelFrame` (o `game` não pode usar `requestAnimationFrame` global) e
  `lifecycle.setInMatch()` (confirmação ao fechar a aba e Wake Lock só na partida).
- **MatchRecipe@1 usa `format: "boboforces/preset@1"`:** a receita é o subconjunto mínimo do preset (o preset é a
  receita com `name`), assim o `version.json` continua com os 5 formatos. Nível de bot vai na ref
  (`builtinBotRef('normal')` → `builtin:normal-bob`).
- **NullRenderer mora em `game`**, que do `render` importa só `@boboforces/render/data` (contrato, presets e
  texture arrays, sem three e sem DOM): sem GPU, o three nem é carregado, e o `game` compila sem a lib DOM como os
  pacotes puros (o guard recusa `@boboforces/render` puro no `game`, até como `import type`).
- **Mesher devolve `ChunkMesh`** com 3 `MeshArrays` (opaco, cutout, translúcido) e vértice em 2 buffers
  (`positions` u16×3 + `attributes` u8×4), porque o three não mistura tipos num buffer intercalado.
- **`apps/switch` checa com lib DOM**, não com `types: ["@nx.js/runtime"]`: o `.d.ts` do nx.js é um lib global próprio
  (`no-default-lib`) que conflita com o DOM de que render/game precisam. A platform-switch acessa os globais do nx.js
  por interfaces locais mínimas.
- **`world` também segue a regra 10** (sem relógio nem `Math.random`), além de sim, ai, nav e format.
- **Pacotes do workspace têm versão `0.0.0`** e se referenciam com `"0.0.0"` exato; a versão do jogo mora no
  `version.json`.

- **Assets em tempo de execução:** `assets-src/runtime-assets.json` liga o caminho LÓGICO (`fonts/ui-fonts.png`) ao
  arquivo gerado. A web serve em `<base>/assets/<lógico>` (plugin do `vite.config.ts`, com `<link rel=preload>` para
  os do menu, que assim contam na carga inicial do size-check) e o Switch copia para `romfs:/assets/<lógico>`
  (`apps/switch/scripts/bundle.ts`). O `game` só conhece os lógicos (`game/src/assets.ts`).
- **Construto (M1):** o `game` carrega o `.bfmap` de verdade (`game/src/scene/`); a arena de teste do `world` ficou só
  para os testes de sim, IA e LocalDriver.
- **Boot da web depois do primeiro pixel:** o `main.ts` espera um frame antes de criar o contexto WebGL2; com o
  navegador frio, criar o contexto segurava o splash por ~2 s.

## 7. Fluxo de um frame (M1, `packages/game/src/game.ts` e `game/src/scene/`)

1. `platform.requestFrame` → `game` mede o frame pela diferença dos timestamps do rAF (limitado a 0,1 s).
2. `platform.input.poll(raw)` → `MenuInput.update` (qualquer teclado/controle navega; guarda o último dispositivo).
3. Título, Ajustes e telas de teste (Switch): `MenuController` → `DrawList` → `renderer.renderViews([])` →
   `renderer.drawUi(list)`. JOGAR, Cena-vitrine (web), um bench do título (Switch) ou `GameDeps.bench` pedem a cena.
4. Cena pedida: `GameDeps.loadScene()` (web: `import()` do chunk da cena e o renderer completo; Switch: o módulo
   direto). Na primeira cena da web o `game` troca o renderer do menu pelo completo (mesmo contexto GL); um bench com
   outra rota de criação (atlas, float) recria o renderer. Enquanto o código chega, a tela de loading.
5. Loading do Construto DENTRO dos frames (`scene/load.ts`, fatias de até ~90 ms com a tela `drawLoadingScreen`):
   assets → texturas (`assembleTextureArray`, `setTextures`, `setModels`) → luz (grade, registro, colisores das props
   do jogo, `isPlayableProp`: todas desde a #52; `createLightJob` fatiado) → malha (`buildRegionMesh` região a região,
   buffers próprios; `setMap`) → navegação (`buildNavGrid` só com as props `blocksNav`; `simMapFromMarkers`) → skins
   (`buildSceneSkins`: por aparência, `composeSkin` na pintura 64×64 → `expandSkin` nas 4 camadas + nível 1 →
   `writeModelLayer(primeira, rgba, nível1)`, pelo `createSkinLayerCache`) → shaders (`warmup`). Cada etapa
   cronometrada. **[port]** Hoje: figuras (`createFigureGameTable` 1 vez, plano das skins, `createFigureTemplateSet`) →
   skins (`createFigureSkinCache({ paint: paintFigureSkin, release: disposeFigurePaint })`, 2 camadas por skin, pintura
   direta no rascunho de 32 + 8 KB) → `renderer.setFigures(templates, table)` e `setFigureLod(perfil.figureNearM,
   perfil.figureHalfRate)`; a etapa "figuras" aparece dentro de "skins" na tela de loading e é cronometrada à parte
   (`loading_ms … figuras=`).
6. Partida (`scene/match.ts`): F2 (borda) → entrada (mapeador do humano no JOGAR/vitrine; no bench, "voltar" encerra)
   → `LocalDriver.update(dt)` (IA com a navegação real e o orçamento do perfil; eventos → `FxQueue`, flash, marcas da
   HUD) → `ActorBuffer` (interpolado, luz da grade de 2 m amostrada no meio do corpo, `bodyHeight/2`; primeira camada
   da skin, arma; [port] gabarito `figure`, `posture` (`figurePostureOf`, a mesma função da sim), `expression` e
   `velocity` interpolada, no lugar de `face`/`faceLayer`/`walkPhase`/`walkAmount`; manequins do mapa, os de print só
   com a câmera deles) → `setActors`,
   `setEnvironment` (relógio anda só sem pausa/congelamento), `submitFx` → câmeras (humano, bot seguido, rota ou câmera
   nomeada) e viewmodel → HUD de cada vista na `ViewDesc.hud` → `renderViews(vistas)` → placar compartilhado, toque,
   estado do bench, pausa e F2 na `DrawList` → `drawUi`.
7. Pausa: `lifecycle.onPause` (pointer lock perdido, aba oculta, HOME), `pause` do mapeador (P/Esc, Start/+, botão
   de toque). Pausado, a sim não anda e a mira não gira; "Sair da partida" volta ao título e libera mapa, modelos e
   texturas da GPU (regra 21).
8. Primeiro frame do título (ou da cena, no bench direto): `[boot] menu-ready <ms>` no log da plataforma e
   `hooks.onMenuReady` (a web troca o splash pela canvas).

## 8. Pedidos de contrato

Formato: `- [frente] arquivo: o que mudar — motivo — contorno usado`. Resolvidos na integração do M0 (02/11/2026):

**Aplicados**

- [d, e] `render/types.ts`: `Renderer.setUiAtlas(atlas | null)` (NullRenderer ignora; `UiPass.setAtlas?` opcional).
- [integração] `render/package.json`: subcaminho `@boboforces/render/data` (contrato, limites, céu, texture arrays,
  viewports) — o `game` precisa de `createActorBuffer`, `ACTOR_POSE`, `SKY_PRESETS` e `textureArrayFromStrip` como
  valor sem carregar o three. O guard libera só esse subcaminho (`RENDER_DATA_SPECS`) e `render/src/data.test.ts`
  garante que nada nesse fecho importa three.
- [e] `platform-api`: `GraphicsSurface.safeArea` (px reais). Web: sonda com `env(safe-area-inset-*)`; Switch: zeros.
- [e] `ui`: `layoutTree(..., options)` com fontes, safe area, alvo mínimo e piso de texto; `LayoutResult` ampliado;
  `pushShape`; `TitleState.canExit` + `TITLE_ACTION.quit` (o Switch precisa de "Sair": o `+` não fecha com GPU).
- [b] `sim`: `SimView` ganhou `recoilPitch`, `recoilYaw` e `blocks`; `AimSkill` ganhou `acquireS`, `recoilControl`,
  `intelligence` e `combatMove`; perfil Bobo calibrado (friction 10 → 16). `MAX_HUMANS/BOTS/TEAMS` agora vêm dos
  `ENGINE_MAX_*` do `format` (mesmos valores; golden inalterado).
- [c] `input`: `RawInputState` ganhou `pixelRatio`, `pointerX/Y`, `pointerInside`; `ControlProfile` com campos novos;
  `InputMapper` com `setWeapon`, `setDevice`, `moveX/moveY`, `connected`; `lastWeapon` no fim das ações locais.
- [integração] `game`: `GameDeps.hooks` (`onProgress`, `onMenuReady`, `onError`, `requestPointerLock`,
  `releasePointerLock`); `GameHandle` com `screen`, `paused`, `wantsPointerLock`, `frames`, `match`, `scene`.
  `MatchDriver.update` devolve os ticks rodados.
- [web] `WebPlatform.webInput` (o `WebInputSource` com o pointer lock, para o `main.ts` pedir o lock no clique).
- [a/d] `format/src/png.ts` reexporta `png/`; `encodePng` ganhou `dropOpaqueAlpha` (RGB quando tudo é opaco).
- [d] `world`: as faces de `TEST_BLOCK_DEFS` continuam provisórias para a sim (ela só usa flags); o `game` monta o
  registro do mesher pelo NOME da camada do `blocos16.json` (`game/src/world.ts`).

**Aplicados na revisão do M0 (02/11/2026)**

- [integração] `game`: importa do render só `@boboforces/render/data` (até os tipos) e compila sem a lib DOM, como os
  pacotes puros. O guard recusa `@boboforces/render` no `game` (regra `import-render`).
- [b] `sim`: `SimConfig.hz?` (padrão `SIM_HZ`) e `Sim.hz`; o `createSimLoop` usa o hz da sim. `ai`:
  `BotDirectorConfig.hz?`. `game`: `LocalDriverConfig.hz?`. Estado: `fireCooldownTicks` (i16) virou `fireCooldownS`
  (f64, segundos, com o resto do tick passando para o tiro seguinte); snapshot na versão 2.
- [web/switch] `platform-api`: `Storage.getBackup(key)` entrou no contrato, POR CHAVE nas duas plataformas (o valor
  antes da última gravação que mudou a chave). Web: `<chave>~bak`. Switch: `save.previous.json` (o
  `save.backup.json` segue sendo o save inteiro anterior, para recuperar um `save.json` corrompido). Teste único:
  `checkStorageContract` em `@boboforces/platform-api/testing`, rodado pelas duas cascas.
- [switch] `FrameSchedulerOptions.afterFrame` e `SwitchLifecycle.frameEnd`: o vão do HOME/sleep conta do FIM do
  frame anterior. `Files.save` grava em `sdmc:/switch/boboforces/exportar/`.

**Decididos sem mudar o contrato**

- [web] `requestPersistence()`: sem consumidor no M0. Fica só na `persistence` da casca até a tela de backup (M2).
  (`Storage.getBackup` já entrou no contrato: ver "Aplicados na revisão do M0".)
- [web] `GraphicsSurface.onContextLost/Restored`: a perda já vira pausa (`lifecycle.requestPause`) e o three refaz
  os objetos de GPU sozinho no restore (texturas e buffers continuam na memória). Revisitar se o Teste Zero mostrar
  perda de contexto no celular.
- [d/web] Tamanho do drawing buffer: a plataforma é dona de `canvas.width/height` (CSS × DPR limitado) e o `main.ts`
  passa o MESMO teto de DPR e o mesmo antialias ao `createRenderer`, então o render nunca encolhe o buffer de novo.

**M1: resolvidos na integração (03/11/2026)** — pedidos das frentes (relatórios da parte 1) e o que a integração
mudou nos contratos (antes → depois), com o motivo.

- [render-mundo] `RenderDebug.mipFilter`: `'nearest' | 'linear'` → `MipFilterMode = 'off' | 'nearest' | 'linear'`
  (`render/types.ts`); `GameDebugApi.setMipFilter(MipFilterMode)`. O print 5 sai em 3 versões (NEAREST sem mip,
  NEAREST_MIPMAP_LINEAR padrão, LINEAR_MIPMAP_LINEAR). O `MinFilterMode` da render-mundo virou apelido do contrato.
- [arte-ux, mapa-nav, skins-modelos] (Saiu nas escolhas dos prints, #51: ver abaixo.) Skin de teste de densidade dobrada do print 2: `RenderDebug.skinDensityTest` e
  `densitySkinLayer(models)` (render), `GameDebugApi.setSkinDensityTest(on)`, `format/src/model/density.ts`
  (`DENSITY_SKIN_LAYERS` = 4, `DENSITY_SKIN_RECTS`, `buildDensitySkin`: Scale2x face a face + grão de ±5% por texel de
  1/32 m). O `skingen` grava `skins/densidade32.png` (4 camadas 64×64: cabeça, tronco, braços, pernas, interna e
  externa); o `game` sobe nas 4 ÚLTIMAS camadas da reserva do `modelos64` (o cache de skins compostas fica com 28) e o
  manequim `densidade` veste quando a chave liga. No programa instanciado são só 2 uniforms (`uDensityLayer`,
  `uDensityMap[12]`): a UV da cruz vira `(px − origem) · 2 + destino` na camada certa. **Nenhum programa novo**: 7 em
  todos os modos (smoke, bench de 4 vistas e os 43 prints).
- [switch-audio] `platform-api` `AudioBufferSourceNodeLike.onended`: `(() => void) | null` →
  `((ev: never) => unknown) | null`: o `AudioContext` do DOM cabe sem cast (teste de tipo em
  `apps/web/src/platform/m1-pieces.test.ts`); o contexto falso do `audio` chama o handler com cast.
- [ui-fontes, web-bench] (Virou `showFontSpecimen(on)` nas escolhas dos prints, #54.) `GameDebugApi.showFontCompare(on)` → `showFontCompare(on, combo?)` (índice de `FONT_COMBOS`;
  sem ele, todas lado a lado); `GameDeps.benchWarnings?` (os avisos da URL ou do `bench.json` entram em
  `BenchReport.warnings`). Com a comparação aberta o renderer usa o atlas das candidatas e volta ao da UI ao fechar.
- [sim-ia] `ai`: `BotDirectorConfig.budget?: AiBudget` (`raysPerTick`, `pathNodesPerTick`, `pathSlice`; ausente =
  `AI_BUDGET`). `format`: `PlatformProfile.aiRaysPerTick` e `aiPathNodesPerTick` [PROPOSTA: PC 16/800, celular e
  Switch 12/600, até o Teste Zero]. `game`: `aiBudgetFor(profile)`. Golden e robô de balanceamento seguem no padrão.
- [sim-ia] `sim`: `SimView.playArea` (o `SimMap` já tinha; barato). O soldado N0 não escolhe passeio fora dela.
  `Sim.relocate` (teleporte anti-frustração) fica para o M2.
- [render-atores] `actors/link.ts` fica (ponte interna do render). `FxQueue` impactProp, campo 6: "caixa de prop em
  `StaticColliders`" → "prop atingida, índice em `RenderMap.props` (= ordem do `.bfmap`)": o `game` resolve
  `ImpactEvent.prop` → `StaticColliders.owner` e o `FxPass` lê a `debrisColor` direto, sem procurar a prop mais perto.
- [render-atores] Acessórios 3D no `ActorBuffer` (chapéu, costas): M2 (não há modelos deles no M1).
- [render-mundo, render-atores] Mips de camada: fica o `writeLayerMips` (`texture-gpu-data.ts`, o que o
  `writeModelLayer` usa e divide código com o `completeMipChain`); o `buildLayerMips` (`actors/skin-mips.ts`) saiu e o
  teste dele passou a cobrir o `writeLayerMips`.
- [render-atores] `@boboforces/render/data` exporta `createSkinLayerCache`, `SKIN_LAYER_BYTES`, `viewmodelAimOffset` e
  `VIEWMODEL_POSE` (sem three; o `data.test.ts` agora segue o fecho com os caminhos relativos certos).
- [mapa-nav] Pré-malha e navegação pré-calculada no `.bfmap`: não entram agora. Loading medido no PC (Edge): 0,5 s; no
  Switch só o Teste Zero diz (o nx.js 1.0.0-beta.7 roda V8; se tem JIT no console, também é o Teste Zero que diz).
  Se passar de 4 s no console, entram (tecnico.md §6.2).
- [integração] Membros do M0 removidos: `Renderer.setWorld`, `RenderWorld`, `RenderChunk`, `SkyParams`,
  `SKY_PRESETS`, as caixas do M0 (`m0-scene.ts`, `actor-instances.ts`, `shaders.ts`, `sky.ts`),
  `textureArrayFromStrip`/`textureArrayFromLayers`; no `world`, `buildChunkMesh` (`greedy.ts`) e o vértice de 2 buffers
  (`MeshArrays`, `ChunkMesh`, `MeshPass`…); no `game`, a cena de teste (`test-scene.ts`, `world.ts`). O
  `Renderer.setActors` cria os passes. A arena de teste do `world` fica (testes de sim, IA e LocalDriver).
- [integração] `render`: subcaminho novo `@boboforces/render/menu` (`createMenuRenderer` + `createMsdfUiPass`): renderer
  só de UI para o menu da web.
- [integração] `game`: `GameDeps.createRenderer(surface)` → `(surface, routes?: RendererRoutes)`; `GameDeps.loadScene?`
  (`SceneBundle`); `GameHandle.renderer` passa a getter (pode trocar); `GameHandle.scene`: `TestScene` → `Scene`
  (`scene-api.ts`); `GameHandle.debug` não nulo com o Construto carregado; `GameScreen` ganhou `test`;
  `BenchReport.loadingMs.textures` (linha `loading_ms … texturas=…`); subcaminho `@boboforces/game/scene`.
- [integração] `assets-src/runtime-assets.json` ganhou a seção `local` (só na máquina do Erick; a web e o NRO levam se
  existir; ficou vazia, `{}`, nas escolhas dos prints). `size-check`: código preguiçoso conta na primeira partida, menos `ON_DEMAND_CODE` (casca do bench, `net`).

**M1: resolvidos na verificação (03/11/2026)** — o corretor do M1, a partir dos achados dos revisores (antes → depois).

- [verificação] `render`: `Renderer.setDebrisBudget(maxDebris)` (novo; no-op no menu e no NullRenderer). O
  `PlatformProfile.maxDebris` nunca chegava ao render (todas as cascas criavam com o padrão 200); o perfil só existe na
  cena, depois do renderer, então o `game` passa ao criar a partida. Recriar o renderer só pelo teto (pela
  `RendererRoutes`) custaria shaders de novo no Switch.
- [verificação] `render`: `ViewDesc.flash` (novo, 0..1): o clarão de tiro é da VISTA que vê o evento a até 30 m
  (arte-ux.md §1.8); o `renderViews` escreve `uFlash` = `env.flash + view.flash` dentro do laço das vistas. O `game`
  deixou de usar o `EnvironmentState.flash` (fica para efeito de tela inteira).
- [verificação] (Saiu com o contorno nas escolhas dos prints, #50.) `render`: `RenderDebug.outlinePx` (novo; 0 = automático, 1 px ou 2 px com 3–4 vistas) e
  `GameDebugApi.setOutline(on)` → `setOutline(on, px?)`: o print de leitura (640×360 = a vista do 3–4P) sai com o
  contorno de 2 px mesmo com 1 vista. Só uniform, nenhum programa novo.
- [verificação] `render/shared/glsl-common.ts`: piso de 1 nível de céu no `bfSceneLight` (`BF_SKY_FLOOR` = 1/15):
  interior fechado fica escuro, nunca preto puro (arte-ux.md §1.3). Vale para os 7 programas (é a luz comum).
- [verificação] `format`: `REQUIRED_MANNEQUINS` com `leitura:5m-a` … `leitura:50m-b` → `leitura:a` e `leitura:b` (UM
  par; as 4 câmeras `print:leitura-*` olham o mesmo par de 5, 15, 30 e 50 m). Com um par por distância na mesma
  visada, o de 5 m tapava os de 30 e 50 m em todos os prints.
- [verificação] `game`: `BenchConfig` ganhou `hud`, `viewmodel`, `fx` e `actors` (bissecção dos picos; padrão
  ligado; `BENCH_PARAMS`: `hud`, `vm`, `fx`, `actors`; apelidos da web `atores` e `arma`). `BenchReport` versão 1 → 2
  (`BENCH_REPORT_VERSION`): `effectiveBots`, `mannequins`, `maxDebris`, `slowFrames`, `startupMs`, `simAiMs`; linhas
  novas `frames_lentos`, `inicio_ms` e `sim_ia_ms`, e a linha `cena=` com `hud= vm= fx= atores= bots_efetivos=
  manequins= detritos=`. `erros=` passa a receber os `error:` do three (antes ficava sempre 0).
- [verificação] `ui`: `LOADING_STEPS` `… textures, mesh, light …` → `… textures, light, mesh …` (a ordem do loader;
  a tela mostrava "Malha · Na fila" acima da luz em andamento). Pesos e textos são por nome.

**M1: resolvidos depois da verificação (03/11/2026)** — integração, antes do Teste Zero no console.

- [integração] arte-8: `block:sector-marker` (4 variantes sorteadas pela célula) → `block:sector-marker-1` … `-9`,
  um por setor, com as camadas `sector_marker_1` … `_9` no `blocos16` (62 → 67 de 256 camadas). O `construto.ts`
  escolhe pelo setor 3×3 (1 = noroeste, 9 = sudeste, linha a linha). O ID antigo nunca saiu num commit nem numa
  versão publicada, então saiu da lista travada em vez de ir para `RETIRED_CONTENT_IDS`. Golden igual (`b452f553`):
  os 9 blocos têm as mesmas flags do antigo.
- [integração] `game`: o bench (`GameDeps.bench`) abre a cena depois de UM frame do título, como JOGAR no menu.
  Antes começava no boot e o `loading_ms` pagava o primeiro desenho da UI (−0,25 s no Eden, na mesma build).
- [integração] `game`: `ConstrutoLoader.assetsDetail` (chegada dos arquivos, decodificação, arquivos e frames) entra
  na linha `[cena] loading …` do log. As linhas `[bench] pico` ganharam `heap_mb` (no frame do pico) e `heap_1s_mb`
  (última amostra de 1 s): uma queda grande entre os dois aponta coleta do V8 fora do frame.

**M1: escolhas dos prints (decisões #50–#54, 03/11/2026)** — o passo 2 do plano (`local/desenho-escolhas/PLANO.md`;
contratos pela integração, em série, depois da #52 sozinha), o que as frentes do passo 3 acrescentaram e a integração
do passo 4 (antes → depois). **[port]** Tudo o que este bloco diz do bobo A (`bobo.ts` com `BOBO_BOXES`, `skinGpuRect`,
`BOBO_CROUCH_POSE`, `expandSkin`, skin de 4 camadas, `skinparts@2`, rig e caixas do render, hitbox agachada orientada)
é histórico: saiu no port do boneco do FutBobo (abaixo e §11). Ficam as partes de mapa, fontes, props e mips.

- [#52] `format/map/types.ts`: entram `PLAYABLE_PROP_DOSE` (= `PROP_DOSE.double`), `isPlayableProp(prop)` e
  `PLAYABLE_PROP_DOSE_VIEW` (= `'double'`). `PROP_DOSE` passa a ser a marca de autoria do print 3; `PropDoseView` e
  `RenderDebug.propDose` viram chave SÓ VISUAL (abaixo da dose do jogo o render esconde props que continuam colidindo;
  serve para o A/B de custo no bench). Os filtros de colisão, bala, visão, navegação e luz (`mapc/compile.ts`,
  `game/scene/world.ts`) trocam `dose ≤ 1` por `isPlayableProp`. `createRenderDebug().propDose`: `'proposal'` →
  `PLAYABLE_PROP_DOSE_VIEW`. Render: o teto de grupos de props corta por `propSurfaceDistance` (`max(0, dist − raio)`).
- [#53] `format/model/bobo.ts`: pernas 4×7×4 → 4×8×4, tronco 8×9×5 → 8×10×5, braços 3×8×3 → 3×9×3 (pivôs 0,4375 / 1,0
  → 0,5 / 1,125); UVs por quadrante de 32×32 (cabeça (0,0)/(0,16), tronco (32,0)/(32,15), braços (32|44,32)/(32|44,44),
  pernas (0|16,32)/(0|16,44)). Sai `SKIN_RESERVED_ROWS`. Entram `SKIN_SCALE` (2), `SKIN_TEXELS_PER_METER` (32),
  `SKIN_GPU_LAYERS` (4), `SKIN_QUADRANT_SIZE`, `SKIN_PART_QUADRANT`, `skinQuadrantOrigin`, `skinGpuRect(part, outer)` →
  `{layer, u, v}`, `BOBO_BOX_NAMES`; e o agachar: `BoboCrouchPose`, `BOBO_CROUCH_POSE`, `PartBounds`,
  `crouchedPartBounds(pose?, inflatePx?)` (frente em −Z como no modelo; a sim troca o sinal). `SKIN_PIXELS_PER_METER`
  continua 16 (px de pintura). `sim/config/metrics.ts`: bodyHeight 1,5 → 1,625, eyeHeight 1,3 → 1,425, aabbHeight
  1,5 → 1,625. `format/map`: `PRINT_CAMERAS` + `print:altura`; `REQUIRED_MANNEQUINS` + `altura:em-pe` (pose `stand`) e
  `altura:agachado` (pose `crouch`). Sim: a tabela CROUCHED são as caixas internas POSADAS, como caixas orientadas, e a
  fase larga tem raio e topo por pose. Render: o rig usa a mesma pose (`rootZ` depois do yaw, sem o −0,05 extra do
  tronco); `BOBO_HEIGHT_M` e `BOBO_CENTER_Y_M` saem das caixas (luz e "poof" do desmonte).
- [#51] `format/layers.ts`: `SKIN_LAYER_RESERVE` 32 → 64 (16 skins × 4 camadas). `format-id.ts`: `skinparts` 1 → 2
  (ladrilhos 32×32 só dos quadrantes usados; canal de tinta no alfa; o `@1` é recusado com "rode npm run assets").
  `format/model`: entram `expandSkin(skin, out, level1?)`, `createSkinExpander`, `SKIN_EXPAND_RECTS`,
  `SKIN_EXPAND_BYTES`, `SKIN_EXPAND_LEVEL1_BYTES` e `packSkinParts`; sai o `density.ts` (`DENSITY_SKIN_*`,
  `buildDensitySkin`), depois de um teste de regressão contra ele (10 de 10 skins do M1, byte a byte).
- [#51, #50] `render/types.ts`: `writeModelLayer(layer, rgba 16 KB)` → `writeModelLayer(firstLayer, rgba k × 16 KB,
  level1?: k × 4 KB)` (subida em laço com profundidade 1; níveis 2..6 do nível 1 com cobertura de alfa; a cadeia
  inteira na cópia da CPU). Saem `RenderDebug.outline`, `outlinePx`, `skinDensityTest` e `densitySkinLayer`.
  `ActorBuffer.skin` = PRIMEIRA das 4 camadas da skin. Internos do render: `ATLAS_MAX_MIP_LEVELS` número →
  `{ blocos16: 2, modelos64: 3 }`; `SharedTextures.assets.*.data.levels` com a cadeia completa; `skin-cache`:
  `slots`, `compose(recipe, out, level1)`, `write(firstLayer, rgba, level1)`, `acquire` → primeira camada,
  `release(firstLayer)`, `SKIN_BYTES` (64 KB) e `SKIN_LEVEL1_BYTES` (16 KB; `SKIN_LAYER_BYTES` fica 16 KB, uma camada),
  reexportados em `@boboforces/render/data`; `skinLayerTag(k)` (`aVert.x = −1 − k`); saem `buildHullGeometry`,
  `VERTEX_FLAG.hull` (o bit 4 ficou livre), o `inward` de `TexturedBox`/`quad`, `ENEMY_OUTLINE_COLOR` e os uniforms
  `uViewTeam`, `uViewportPx`, `uOutlinePx`, `uTeamColors`, `uEnemyColor`, `uDensityLayer`, `uDensityMap`.
- [#50, #51, #54] `game/bench/types.ts`: saem `setOutline` e `setSkinDensityTest`; `showFontCompare(on, combo?)` →
  `showFontSpecimen(on)`; o doc de `setPropDose` diz que a chave é só visual. `game/assets-m1.ts`: saem
  `GAME_ASSETS_M1.densitySkin` e `GAME_ASSETS_LOCAL`. `runtime-assets.json`: sai `skins/densidade32.png`; `local: {}`.
- [#54] `ui`: `drawFontSpecimen(out, fonts: UiFonts | null, w, h)` no lugar de `drawFontCompare` (sai `font-compare.ts`
  com `FONT_CANDIDATES`, `FONT_COMBOS`, `createFontCandidatesAtlas` e o formato `font-candidates@1`); `FontFile`
  ganha `license?` e `source?`, `MsdfFont` ganha `version`, `license` e `source`; chaves `fontSpecimen.*` no lugar de
  `fontCompare.*` e `test.item.benchPlanB`; `TITLE_TESTS`: coluna de 330 px até 4 itens, grade de 2 colunas acima;
  `fitTextPx` (nome do mapa no loading). Saem as chaves longas `test.bench.{dock,solo,zombies,bots48,planB,gpu}`
  (integração, pedido da switch-audio: ninguém lia). Web: `?titulo=switch` (prévia do título do Switch na casca, sem
  DOM no pacote), `scripts/prints.ts --saida`, roteiro 43 → 26 PNGs, o `licencas.txt` lê
  `assets-src/fonts/generated/ui-fonts.licencas.txt`, sub-orçamento "Fontes ≤ 120 KB" no `size-check`. Switch:
  `licencas.txt` no romfs (`apps/switch/scripts/licenses.ts`), rótulos curtos `test.item.*`.
- [integração, passo 4] `game/scene/match.ts`: `buildSceneSkins` = `composeSkin` num rascunho de 16 KB → `expandSkin`
  nas 4 camadas + nível 1 → `writeModelLayer(primeira, rgba, nível1)`; `MANNEQUIN_KIND.height` para os manequins
  `altura:*`, desenhados só com a câmera `print:altura` (como os de leitura e o de densidade); a luz de atores e
  manequins é amostrada em `METRICS.bodyHeight / 2` (antes `y + 0,75`). `NullRenderer.writeModelLayer(firstLayer,
  rgba, level1?)`. `game.test.ts`: etapa skins (10 aparências em 40 camadas seguidas, 16 skins na reserva, 0
  estouro, as 4 camadas e o nível 1 preenchidos), folha das fontes liga e desliga, régua só com a câmera dela, e os
  textos do game com o atlas real (pausa em 6 alvos, texto do bench e rótulos de toque). Golden final `cf65a778`
  (na correção da revisão, `372dcaea`: a régua mudou de plano, fora da área).
- **Decisões menores (revisáveis):** `ViewDesc.team` e `ActorBuffer.team` ficam no contrato, embora nenhum shader os
  leia mais (o layout da instância fica estável e a cor de time pode voltar por uniform num modo daltônico). A hitbox
  agachada é a caixa ORIENTADA pela pose, não a envolvente (a envolvente acertava ar em 7,9% e trocava a categoria
  em 22,9% dos tiros; custa 0,120 contra 0,108 µs). O teto de 120 KB das fontes é lido como bytes baixados (PNG + JSON
  em gzip, o JSON no nível 4: limite de cima do que o GitHub Pages serve). As fontes que saíram (Barlow, Chakra Petch) ficaram guardadas em `local/fontes-saidas/` em vez de
  apagadas de vez (a Barlow também segue no commit do M0).

- **Correção da revisão (03/11/2026), contratos antes → depois:** `format/map`: `PRINT_CAMERAS` + `print:setores-norte`,
  `print:setores-sul` e `print:setores-4-5` (print 9, números de setor no chão; o Construto tem as três). Fora de
  contrato: o rig do render põe quem não é entidade da sim (`entity` 0: manequins e zumbi de vitrine) direto na pose,
  sem a transição de agachar (com a cena congelada o `dt` é 0 e a chave é o índice no buffer); a régua foi para o
  plano z = 78,5 com a face de fora da cabeça no plano, fundo liso e cobertura de parede de teste (régua no plano);
  `bfAtlasCorner` sem `mod` e com +0,5 na divisão (erro de linha visto na Intel UHD com 7 e 13 colunas); marcadores
  de setor 6 e 9 com sublinhado; size-check e fontbake medem o JSON das fontes no gzip nível 4 (limite de cima do
  GitHub Pages) e o kerning começa em 0,25 px; guarda do RFN com aspas simples e falha fechada
  (`FontSpec.reservedNames`); `licencas.txt` do Switch com o runtime do nx.js e a Geist Mono.

**Port do boneco do FutBobo (decisões #55 e #56; 04–07/11/2026)** — plano e relatórios em `local/futbobo-port/` (privado);
contratos pela integração no passo 2 (aditivos), congelados depois. Antes → depois:

- [format] `model/figure.ts`: `FIGURE_PX_M` = 7/128 (1 px = 5,47 cm; 32 px = 1,75 m; cabeça de 8 px = 0,4375 m, 4 cabeças),
  `FIGURE_BONE` (12 ossos, osso = parte de acerto = caixa primária; `FigurePart` 0..11), `FIGURE_POSE` (34 chaves: as 31
  do FutBobo + `neckSink`, `torsoSink`, `neckSlide`), poses de repouso, P4f (agachado), deslize e zumbi,
  `figurePosture(stance, grip, mode, zombie)` (22 posturas; zumbi = 21), `FIGURE_AIM` (a cabeça presa ao olho; agachado e
  deslizando a cabeça só levanta: `headPitchMinCrouch` 0), `FIGURE_MAX_TOP_M` 1,81, `FIGURE_CROUCH_TOP_M` 0,97,
  `figureRoot` e `figureFk` (FK afim 3×4 em forma fechada, a ÚNICA cinemática: serve à sim, ao render, ao desmonte e
  aos testes; não lê nem escreve a 4ª linha das 4×4). Substitui `bobo.ts` (ficam só `boxCrossRects`, `SKIN_FACE_AXES`,
  `FACE_EXPRESSION(S)`, `ZOMBIE_KINDS`, `ZOMBIE_SCALE`).
- [format] `figure-layout.ts` (`FIGURE_LAYOUT`, `FIGURE_SWATCH`: paleta de 16 amostras, `FIGURE_SKIN_LAYERS` = 2,
  `FIGURE_SKIN_BYTES` 32 KB + nível 1 de 8 KB), `figure-look.ts` e `figure-presets.ts` (`FigureLook`,
  `normalizeFigureLook` só com clamp, `figureOutfitFor` com o colete de time, o ícone e a trava de cor (#58; era
  `figureKitFor`), `figureSkinKey` (`fig2`, com o índice do time), 12 presets, `FIGURE_BOT_ROTATION`), `figure-paint*.ts`
  (`paintFigureSkin` puro, farda em pixel art 16×24 em `figure-paint-outfit.ts`, as 8 expressões;
  `disposeFigurePaint` solta os rascunhos do módulo, regra 21), `figure-hair.ts` e `figure-template.ts` (`figureHairBoxes`:
  34 cortes, 0 a 28 caixas; `createFigureTemplateSet`, no máximo 255 gabaritos, `FIGURE_MAX_BOXES` = 44), `figure-ik.ts` e
  `figure-grips.ts` (IK do braço e empunhaduras, só na montagem da tabela).
- [format] `figure-table.ts`: `FigureGameTable` = `poses`, `boxes` (12 hitboxes por postura × 5 pitches, frame da sim),
  `broad`, **`slack`** (folga entre amostras: `figureHitBoxes` soma `slack·4f(1 − f)` às meias medidas; fecha o arco da
  cabeça), `grip`, `reload` e **`bulge`** (opcional: a "barriga" do intervalo, centro e eixos andam no arco e não na
  corda); `slack` e `bulge` vão além do desenho original. API: `createFigureGameTable()` (pura, ~166 KB, montada UMA vez
  no loading), `figureGamePose`, `figureHitBoxes`, `figureAimPoint`, `figureBodyPartAtHeight`, `figureGripMatrix`.
- [format] `platform-profiles.ts` (validador, regra 19): `figureNearM`, `figureHalfRate`, `figureBotLooks`. `content-ids`:
  8 `skin:*` descritivos (só acréscimo; `skinparts` foi para `RETIRED_FORMAT_KINDS`, o nome não volta). `map/types.ts`:
  `MapMannequin.pose` + `'slide'`, `MANNEQUIN_KIND.line`, marcadores opcionais `linha:1..8`, `close:1|5` e
  `altura:deslizando`, câmeras `print:linha-*`, `print:close-1m` e `print:altura-45`. `.bfmap` continua
  `boboforces/map@1`, versão 1; a pose `slide` é aditiva (o decodificador de antes a recusa).
- [sim] `METRICS`: `bodyHeight` 1,75, `eyeHeight` 1,55, `aabbHeight` 1,75, `headSize` 0,4375 (agachado e coberturas
  ficam). `SimConfig.figureTable?` (ausente = o `createSim` monta na criação), `WeaponDef.grip`, `figurePostureOf(flags,
  grip, kind)` e `weaponGrip` (uma função só, o `game` usa a mesma para `ActorBuffer.posture`), `rayVsBobo`,
  `aimPointLocal`, `bodyPartAtHeight`, `HITBOX_COUNT` = 12, `ARM_HIT_CUT_M` = 0,75. `HitEvent.bodyPart` e
  `KillEvent.bodyPart` = `FigurePart` 0..11 (u8). Saem `aimPointHeight`, `HITBOXES` e `crouchedPitch`; a IA usa
  `figureAimPoint` (`BotDirectorStats.visibleAims` é novo, com teto de 2 miras visíveis por tick).
- [render, público] `ActorBuffer` + `figure` (gabarito; 255 = não desenha), `posture`, `expression` (0..7) e `velocity`
  (3 por ator, m/s); saem `face`, `faceLayer`, `walkPhase` e `walkAmount`; `skin` = a 1ª das 2 camadas.
  `Renderer.setFigures(templates, table)` (no loading, depois das skins; a tabela é o MESMO objeto da sim) e
  `setFigureLod(nearM, halfRate)`. `ViewStats.actorDraws`, `RenderStats.figureL0..L2`. `FxDeath.figure` (obrigatório;
  índice 12 da fila) e sem `face`/`faceLayer`.
- [render, interno] `shared/passes.ts`: `FrameViews` (`count`, `eye`, `planes`, `owner`; até `FRAME_VIEWS_MAX` = 4),
  `FrameContext.views` (o `renderer-core` monta câmera e frustum de todas as vistas ANTES de `actors.update`),
  `ActorPass.setFigures`/`setFigureLod`/`lastViewActorDraws`/`figureLod`, `FxPass.setFigures`. `actors/anim/types.ts`:
  `FigureRig` (`setTable`, `setLod`, `begin`, `pose(actors, i, out, o, force)`, `expression`, `hairCeilingY`,
  `weapon`, `end`, `stats`; `createFigureRig(capacity)`; estado por entidade = `EntityTable(256, 48)`).
  `actors/figure-row4.ts`: `writeFigureRow4` e `figureRow4Expression` (a 4ª linha da matriz leva céu, sol, emissivo e
  `2e + flash`). `NO_FIGURE` = 255.
- [render, programa 4] Nenhum programa, atributo ou uniform novo (7 programas; 12/16 atributos). O VS ganhou o ramo da
  instância de caixa: 1 `InstancedMesh` "bobos" (capacidade 72 × 44) com `boundingSphere` fixa; 1 draw por vista para
  todos os bonecos, zumbis e manequins. Saem as 7 `InstancedMesh` do bobo A, a folha de rostos e o `iPart` do desmonte.
  Detalhes e números em `tecnico.md` §6.6 e §16.3 e no `PERF.md`.
- [tools] `tools/skingen` virou a prévia do pintor (`npm run skingen:figuras`, grava em `local/skins/`, 14 folhas); o gerador
  antigo saiu. `npm run assets` = texgen → modelgen → mapc. `tools/guard`: a regra 11 cobra alocação nas regiões
  `// quente:` … `// fim-quente` e exige essas regiões em `figureFk`, `figureHitBoxes`, `figureGamePose`,
  `paintFigureSkin`, `rayVsBobo`, `anim/rig.ts` e `figure-instances.ts` (`tools/guard/src/rules.ts`).
- **Pedidos de contrato:** **fecham** "Hitbox × mira", "Rosto 16×16" e "lona de 1,5 m" (marcados acima). **Seguem abertos:**
  (1) emote no `ActorBuffer` (as 42 comemorações, os 7 tiques e o motor de camadas do FutBobo; M2: no M1 todo bobo vivo
  está armado e os manequins ficam parados); (2) escala do zumbi na hitbox (M3).

**M1 (abertos)** — as frentes anotam aqui, no mesmo formato, com o nome da frente entre colchetes.

- [sim-ia] `Sim.relocate(controller)` para o teleporte anti-frustração (M2).
- [render-atores] Acessórios 3D no `ActorBuffer` (M2).
- [mapa-nav] Seção `NAV ` e pré-malha no `.bfmap`, se o Teste Zero passar de 4 s de loading. No Eden (03/11, bench
  depois do título): 5,0–5,2 s, com luz 0,74 + malha 0,71 + nav 0,73 s = 2,2 s que a pré-malha (com a luz embutida
  nos vértices e a grade de luz de 2 m) e a navegação pré-calculada tirariam. Sobram assets 1,2 (decodificação 0,65),
  texturas 0,3, skins 0,2 e shaders 0,8 s. A malha pré-calculada tem ~2,5 MB crus (166 mil vértices de 12 bytes +
  índices): no Switch vale ler sem deflate; na web o mesher com JIT leva ~0,1 s.
- [render-mundo, web-bench] Bissecção dos picos no console: se ela apontar a UI, juntar a HUD de todas as vistas num
  upload por frame (hoje são 1 + N `bufferSubData` no mesmo buffer); um preset `diag` no NRO (rodadas curtas com cada
  chave desligada) se o Erick preferir o menu ao `bench.json`. No Eden, 18 das 20 linhas de pico de 03/11 tinham
  `cpu_ms` ≤ 53 e o heap SUBINDO desde a amostra de 1 s, ou seja, espera fora do JS (GL do emulador), não coleta.
- [sim-ia, render-atores; #53] **FECHADO no port do boneco (07/11/2026): Hitbox × mira.** A hitbox sai da mesma pose
  da tabela de jogo (12 caixas por postura × pitch, a cabeça presa ao olho), então o que se vê é o que se acerta, com
  as exceções medidas em "Port do boneco" (acima). Texto antigo: **Hitbox × mira em pé:** em pé, a hitbox dos braços é a pose parada e sem arma (ao lado
  do tronco); com a arma apontada o braço visual sai dela (a pose de mira não entra na sim; o mesmo vale para os braços
  agachados, que a hitbox põe ao longo do tronco). Junto: o `handReach` (7,5/16) e o `armLength` do viewmodel (0,5)
  continuam fixos; a arma em 3ª pessoa fica 1,5 px acima da ponta do braço e, no viewmodel, a ponta passa 1 px do
  soquete. Rever no M2 com print em 3ª e 1ª pessoa.
- [arte, M3; #53] **Chonker acima da porta:** o zumbi de escala 1,3x sobre o bobo de 1,625 m fica com 2,11 m visuais
  (antes 1,95), acima da porta de 2,0 m. Rever a escala (1,2x dá 1,95 m) ou a porta dos mapas de Zombies; a AABB da
  sim não escala. **[port] Segue ABERTO (M3), junto com a escala do zumbi na hitbox:** o boneco novo tem 1,75 m, a escala
  uniforme já sai na raiz do render e da tabela (conta: 1,3x dá 2,28 m), mas a hitbox do Chonker/Mega ainda não escala.
- [Erick, M2; #51] **FECHADO no port do boneco: Rosto 16×16** (o rosto é a cruz 16×16 da cabeça, com as 8 expressões
  pintadas na camada 0 da skin; a folha 8×8 e as camadas `faces`/`faces_zombie` saíram). Texto antigo: o rosto continua na folha 8×8 (16 px/m, olhos e boca com o pixel 2× o da skin
  nova), como no print 2 aprovado. A alternativa é redesenhar a folha a 16×16 (4 camadas por folha, +6 no total,
  camada e célula em float no vertex shader). Pergunta para o M2.
- [sim-ia] [port] Sem objeto: `crouchedPartPitch` (opcional). `crouchedPitch`, `BOBO_CROUCH_POSE` e as caixas do bobo A
  saíram, e o agachado é uma postura da tabela de jogo.
- [sim-ia, mapa-nav] Sortear o passeio dos bots numa lista de nós JOGÁVEIS montada no loading: decoração fora da área
  (como a régua) deixaria de mexer no golden. Muda o golden; fica para a próxima mudança que já mexa nele.
- [mapa-nav, Erick] **FECHADO no port do boneco: lona de 1,5 m.** As 5 aberturas do Construto (3 seteiras da cabine, a
  janela da guarita e a do 1º andar do prédio 1) subiram de 1,5 para 2,0 m, e o aviso "visto sem ver" caiu de 25 para
  10 nós com a faixa nova (olho 1,55 até 1,81 m). Texto antigo: a lona de ~1,5 m do setor norte, em (49,5; 22,5), é um
  "muro de 1,5 m onde se luta" (6 nós do aviso "visto sem ver"). Mexer muda a jogabilidade e o golden.
- [web-bench, mapa-nav] [port] Feito: a vista a 45° da régua é a câmera opcional `print:altura-45`
  (`format/src/map/types.ts`, prefixo `print:altura-` reservado; x 45,669, y 2,0, z 76,25, pitch 0, FOV 74°, yaw 3π/4).
- [passo 5] [port] Sem objeto (o bobo A e as cópias dos prints saíram). Antes: as cópias descartáveis dos prints de altura precisam trocar a pose agachada junto com as caixas: B
  (1,75 m) pescoço de 4 px, `rootZ` 0,226, `legPivotY` 0,255; "antes" (1,5 m) pescoço de 2 px, `rootZ` 0,195,
  `legPivotY` 0,228 (contas do protótipo, sem passar pelos testes).
- [web-bench, ui] No `local/m1/smoke/f2.png`, o painel F2 cobre a plaquinha ABATES/MORTES do HUD (alto à esquerda).
  É ferramenta de depuração; mover o painel ou aceitar.
- [Erick; #53] [port] **Sem objeto: braços do agachado** (a P4f do boneco novo põe os braços em `ARM_REST`, #55; armado, o
  rig aponta os braços para a mira). Texto antigo: com `BOBO_CROUCH_POSE.armX` = 0 o braço corre ao longo do tronco inclinado e
  cai para trás (a pose se lê como "sentado escorregando"). Print de comparação com `armX` = −`torsoX` (+0,6435 rad,
  braços na vertical, mão a 0,04 m do chão, ao lado das pernas) em `local/m1/prints/0.0.1-altura-bracos/`. Só muda o
  manequim sem arma e a hitbox dos braços agachados (armado, o rig aponta os braços para a mira); o "sentado" vem também
  das pernas retas a 1,35 rad, que não mudam. Se aprovar: mudar só o `armX` no format e rodar `npm run balance` (os
  bots Suado e Tryhard agacham no `strafeDodge`); o golden não muda (os Normal não agacham).
- [Erick] **Sublinhado do 6 e do 9** nos marcadores de setor (print 9): proposta do corretor para o número não virar
  outro quando lido do lado oposto. Aprovar ou trocar por um traço de base em todos os 9 números.
- [web-bench] Depois do deploy do M1: `curl -sI -H 'Accept-Encoding: gzip, br' …/assets/fonts/ui-fonts.json` e anotar
  no PERF o `Content-Length` servido e o total do atlas contra 120.000 B.
- [switch-audio, M2] `tools/credits`: os avisos das bibliotecas que o runtime do nx.js embute (pacotes npm do runtime
  JS e nativas como mbedtls, zlib, libpng, freetype, harfbuzz, libjpeg) não vêm no pacote npm dele; o cabeçalho do
  `licencas.txt` do Switch diz que faltam.
- [Erick] O splash do `apps/web/index.html` (desde o M0) usa `system-ui` como fonte do texto, o que esbarra na regra
  "fontes só OFL, nunca de sistema". O jogo não leva fonte de sistema; é o texto HTML da casca antes do WebGL.

## 9. M1: contratos e frentes (etapa de contratos, 03/11/2026)

O M1 (docs/PLANO_M1.md) roda em 10 frentes paralelas e depois uma integração. Esta seção é o contrato entre elas. Os
arquivos marcados CONTRATO só mudam por "Pedidos de contrato" (§8); stubs lançam `Error('M1: frente <nome> (…)')`
(procure por `M1: frente`). Membros do M0 que o M1 substitui ficam com a marca "M0" e saem na integração.

### 9.1 Grafo (o que mudou)

```
shared
├── format ── world ── nav ──┐
├── input ───────────────────┴── sim ── ai ──────────────┐
│   ├── platform-api (só tipos; + audio.ts)              │
│   └── ui                                               ├── game ── apps/web, apps/switch
├── audio  (+ platform-api)                              │
└── render (+ format, platform-api, world, ui, three) ───┘  (o game importa só @boboforces/render/data)

tools: texgen, skingen, modelgen (format) · mapc (format, world, nav, sim) · audioconv (lamejs; Edge via playwright-core)
  [port] o skingen virou só a prévia do pintor (`skingen:figuras`) e saiu do `npm run assets`
```

- `render` passou a importar `format` (tipos de `model@1`, manifesto de camadas, `TimeOfDay`, `PropDoseView`).
- `world` usa o `MapGrid` do `format` (conversão `gridFromMapGrid`/`mapGridFromGrid`); o `format` continua sem
  importar o `world`.
- Ordem das ferramentas: `npm run assets` = texgen → skingen → modelgen → mapc (o mapc lê blocos e modelos; [port] hoje
  texgen → modelgen → mapc, sem o skingen). O
  `audioconv` roda à parte (precisa do Edge e dos OGG baixados).

### 9.2 Contratos novos

| Contrato | Arquivo | Assinatura principal | Implementa |
|---|---|---|---|
| Célula u16 | `world/src/cell.ts` | bits 0–9 blockId, 10–11 giro Y, 12 inversão, 13–15 reservados (0); `cellOrientation` = giro \| inv << 2 | pronto |
| Formas | `world/src/shapes.ts` | `SHAPE_ID` (12), `shapeCollisionBoxes`, `shapeVisualBoxes`, `shapeFloorHeight`, `shapeCoveredFaces`, `orientFace`, `shapeFaceSource` | pronto (dados e conta) |
| Blocos | `world/src/blocks.ts`, `block-source.ts` | `BlockDef` (+`emissive` 0–15, `variants`), `BLOCK_FLAG` (+`randomUv`, `climbable`), registro com `shapes`/`emissive`; `parseBlockDefs` (`blocks@1`, faces por NOME), `resolveBlockDefs`, `createMapBlockRegistry` | pronto |
| Luz | `world/src/light.ts` | `LightField`, `createLightJob` (fatiado), `computeLight`, `LightGrid` 2 m, `buildLightGrid`, `sampleLightGrid(grid, x, y, z, out, offset)` | mundo |
| Colisores de props | `world/src/colliders.ts` | `createStaticColliders(input)`, `StaticColliders.query(...)`; `raycastGrid`/`sweepAabb` ganham `colliders?` no fim; `RayHit.face`/`.prop` | mundo |
| Mesher por região | `world/src/mesh/region.ts`, `vertex.ts` | `buildRegionMesh(grid, registry, light, rx, ry, rz, opts?)` → `RegionMesh` (3 × `RegionMeshArrays`), `packRegionVertex`/`unpackRegionVertex`, `NORMAL_TABLE` (26) + `TANGENT_TABLE`/`BITANGENT_TABLE` | mundo |
| Camadas dos arrays | `format/src/layers.ts` | `layers@1`: `LayerManifest`, `parseLayerManifest`, `mipChainOffsets`, `TEXTURE_ARRAYS`, `SKIN_LAYER_RESERVE` | pronto |
| `map@1` | `format/src/map/` | `MapDocument` (meta, blocks, grid, props, markers, light), `encodeMap`, `decodeMap`, `validateMap`, `PRINT_CAMERAS`, `BENCH_ROUTES`, `REQUIRED_MANNEQUINS`, `PROP_DOSE`; desde a #52 `PLAYABLE_PROP_DOSE`, `isPlayableProp`, `PLAYABLE_PROP_DOSE_VIEW` | mapa-nav |
| `model@1`, bobo, skins | `format/src/model/` | [port: o bobo A e a `skinparts@2` saíram; os contratos de hoje são os `figure*.ts`, §8 "Port do boneco"] `ModelDocument`/`ModelPack`, `encodeModelPack`, `decodeModelPack`, `validateModel`; `BOBO_PART`, `BOBO_BOXES`, `boxCrossRects`, `SKIN_FACE_AXES`, `FACE_SHEET`; `SkinRecipe`, `BoboLook`, `composeSkin`; desde as escolhas dos prints `skinGpuRect`, `SKIN_GPU_LAYERS`, `BOBO_CROUCH_POSE`, `crouchedPartBounds`, `expandSkin`, `skinparts@2` (§8) | skins-modelos |
| IDs de conteúdo | `format/src/content-ids.ts` | tipo novo `model`; 41 `block:*` do M1 (+3 do M0), 14 `model:*`, 4 `skin:*` (travados em `LOCKED_IDS` no teste; só acréscimos, regra 20) | pronto |
| Navegação | `nav/src/index.ts` | `buildNavGrid(world, metrics)`, `createNavPath(nav)`, `findPath(nav, from, to, out, budget)` → `PathStatus`, `isReachable` | mapa-nav |
| Sim | `sim/src/{events,sim,view,entity,constants}.ts` | `HitEvent.bodyPart`/`dir*`, `KillEvent.dir*`/`force`/`bodyPart`, `ImpactEvent.face`/`prop`, `MeleeEvent`; `ENTITY_KIND.zombie`; `SimConfig.zombies`; `SimMap.colliders`/`nav`/`killPlaneY`/`playArea`; `SimView.colliders`/`nav`; `ZOMBIE_CONTROLLER_BASE` = 68; `BOBO_NAV_METRICS` | sim-ia |
| IA | `ai/src/director.ts` | `BotDirectorConfig.zombies` | sim-ia |
| Render (público) | `render/src/types.ts`, `environment.ts`, `fx-queue.ts`, `texture-assets.ts` | `Renderer` + `setTextures`, `writeModelLayer`, `setModels`, `setMap`, `setEnvironment`, `submitFx`, `setDebug`, `warmup`, `memory`, `info`; `RendererOptions.textureMode`/`vertexAttributes`/`maxDebris`; `ActorBuffer` M1; `ViewDesc.team`/`viewmodel`/`hud`; `RenderStats.views`/`gpuMs`; `assembleTextureArray` (pronto); `FxQueue` + `push*` (pronto) | render-mundo |
| Render (interno) | `render/src/shared/passes.ts` (CONGELADO) | `PassContext`, `SharedUniforms`, `SharedTextures`, `FrameContext`, `ViewContext`, `ActorPass`, `FxPass` | — |
| GLSL comum | `render/src/shared/glsl-common.ts` (CONGELADO) | uniforms comuns, tabelas de normal, `bfUnpackBlockVertex`, luz, fog, LUT, cinza, vento, `bfSampleRepeat`/`bfSampleClamp` (array ou `ATLAS`) | pronto |
| Plataforma | `platform-api/src/{index,audio}.ts` | `AudioContextLike` (+ BufferSource, Gain, StereoPanner, `createBuffer`, `decodeAudioData`); `ControllerInfo` + `RawInputSource.describeControllers?`; `Diagnostics.memoryUsage?`/`recentLog?` | cascas |
| UI | `ui/src/screens/{hud,debug-panel,test-screen,font-specimen}.ts`, `title.ts` | `HudModel` + `drawHud`, `DebugPanelModel` + `drawDebugPanel`, `TestScreenModel` + `drawTestScreen`, `drawFontSpecimen` (era `drawFontCompare` até a #54), `TitleState.extraItems` (grade de 2 colunas acima de 4 itens) | ui-fontes |
| Game (tipos) | `game/src/bench/`, `assets-m1.ts`, `game.ts` | `BenchConfig`, `parseBenchParams` (pronto), `formatBenchReport` (pronto), `formatT0Line` (pronto), `GameDebugApi`, `TestItem`/`TestRunner`; `GameDeps.bench?`/`testItems?`; `GameHooks.onBenchReport?`; `GameHandle.debug` (`null` até a integração); `GAME_ASSETS_M1`, `TEXTURE_ARRAY_BASES` | integração |

### 9.3 Quem é dono do quê (frentes do M1)

| Frente | Pastas |
|---|---|
| 1. mundo | `packages/world/**` |
| 2. texturas | `tools/texgen/**`, `assets-src/textures/**`, `assets-src/blocks/**` (definições dos blocos, IDs estáveis) |
| 3. skins-modelos | `tools/skingen/**`, `tools/modelgen/**`, `assets-src/skins/**` ([port] a pasta saiu), `assets-src/models/**`, `packages/format/src/model/**` |
| 4. mapa-nav | `tools/mapc/**`, `assets-src/maps/**`, `packages/nav/**`, `packages/format/src/map/**` |
| 5. sim-ia | `packages/sim/**`, `packages/ai/**`, `tools/balance/**` |
| 6. render-mundo | `packages/render/**` EXCETO `src/actors/**`, `src/fx/**`, `src/ui/**` e `src/shared/**` (dona do `renderer.ts` e do laço por vista) |
| 7. render-atores | `packages/render/src/actors/**`, `packages/render/src/fx/**` |
| 8. ui-fontes | `packages/ui/**`, `packages/render/src/ui/**`, `tools/fontbake/**`, `assets-src/fonts/**`, `.interface-design/**` |
| 9. switch-audio | `apps/switch/**`, `packages/audio/**`, `apps/web/src/platform/audio.ts`, `assets-src/audio/**`, `tools/portcheck/**`, `tools/audioconv/**`, `docs/TESTE_ZERO.md` |
| 10. web-bench | `apps/web/**` (EXCETO `src/input/**` e `src/platform/audio.ts`), `scripts/prints.ts`, `scripts/bench.ts`, `scripts/smoke-web.ts`, `tools/size-check/**`, `tools/guard/**` |
| Integração | `packages/game/**`, `packages/platform-api/**` (implementação), `packages/render/src/shared/**`, `packages/format/src/*.ts` (raiz do format), `assets-src/runtime-assets.json`, configs da raiz, `docs/` (gerais), CHANGELOG |

Ninguém edita `packages/render/src/shared/**` nem os arquivos da raiz do `format` durante as frentes (pedido de
contrato). `apps/web/src/input/**` não muda no M1.

### 9.4 Escolhas que as frentes precisam saber

- **Orientação das formas:** forma canônica com o "alto" em -Z (para onde o yaw 0 olha); giro = quartos de volta
  anti-horários vistos de cima ((x, z) → (z, 16 − x) em subcélulas: -Z vira -X); a inversão espelha em Y ANTES do
  giro. Rampas invertidas colidem como cubo cheio no M1. Faces inclinadas usam a textura de `py` (`ny` invertidas); a
  cruz usa `px`. Tabela completa no topo de `shapes.ts`.
- **Vértice compacto de 12 bytes, UM buffer** (`Uint16Array`, 6 palavras): x, y, z (u16, 1/16 de célula a partir da
  região) · byte 6 normal (5 bits) + AO (2) + variação (1) · byte 7 camada base · byte 8 céu + sol · byte 9 emissivo +
  flags (`REGION_VERTEX_FLAG`) · byte 10 variantes − 1 + quadros − 1 · byte 11 reservado. No GL: `aPos` palavras 0–2 e
  `aData` palavras 3–5, stride 12; inteiro (`uvec3`) ou float (`VERTEX_FLOAT`). Camada final no shader =
  `base + variante · quadros + quadro` (4 qps); a tira guarda as variantes em sequência e os quadros dentro de cada uma.
- **Texture arrays:** cada ferramenta grava a SUA tira (`<base>.png`, `<base>.mips.png`, `<base>.json` com
  `layers@1`); o runtime concatena na ordem de `arrays` do `runtime-assets.json` (`blocos16`: texgen; `modelos64`:
  texgen `modelos64-materiais` → skingen `modelos64-rostos` → modelgen `modelos64-modelos`) e reserva camadas no fim
  do `modelos64` para as skins compostas: 32 até a #51, 64 depois (16 skins × 4 camadas; o array fica com 90 de 128). Toda tira de um array declara a cadeia completa de mips (5 e 7 níveis);
  camadas por NOME, sempre. Folhas de rosto: camadas `faces` e `faces_zombie` (skingen). **[port]** A tira
  `modelos64-rostos` saiu (os nomes `faces`/`faces_zombie` nunca são reusados): o array fica com 88 de 128 camadas (9 + 15
  + reserva de 64), e a reserva de 64 passa a caber 32 skins de 2 camadas.
- **Arquivos provisórios:** todos os caminhos novos do `runtime-assets.json` já existem como provisórios (JSON com
  `"placeholder": true`, PNG 1×1, binários com versão 0, MP3 de silêncio) para os builds seguirem; cada ferramenta
  sobrescreve os seus. O runtime recusa provisório com "rode npm run assets".
- **Dose de props (print 3):** `PROP_DOSE` 0 sempre, 1 proposta, 2 só no dobro. Desde a #52 o jogo usa TODAS
  (`isPlayableProp`) na colisão, bala, visão, navegação e luz; o `RenderDebug.propDose` (padrão `'double'`) só esconde
  no render, para o A/B de custo.
- **Prints e bench (nomes fixos do mapa):** câmeras `print:dia`, `print:densidade-1m`, `print:densidade-3m`,
  `print:doses`, `print:leitura-5m`/`15m`/`30m`/`50m`, `print:mip` e `print:altura` (#53); rotas `bench:volta`
  (obrigatória) e `bench:alto`; manequins `vitrine:1..6`, `leitura:a`/`leitura:b` (um par só; as 4 câmeras de leitura
  ficam na mesma reta, a 5, 15, 30 e 50 m dele), `densidade` (atualizado na verificação do M1) e `altura:em-pe` /
  `altura:agachado` (a régua, em `HEIGHT_RULER`: x 40–48,5, z 76–80, fora da área jogável).
- **Sim:** eventos novos já saem com valor definido (parte do corpo pela categoria, direção 0, `face` pela normal de
  eixo, `prop` -1) até a frente sim-ia passar os de verdade; golden do M0 inalterado. Zumbis nos controladores 68..131
  (depois dos bots, para os índices dos bots e o golden não mudarem).
- **Render:** fluxo do frame e orçamento de programas no topo de `shared/passes.ts` (mundo 4, atores 2, UI 1). Chaves
  de criação (`textureMode`, `vertexAttributes`) mudam programa; chaves de depuração (`RenderDebug`) são só uniforms e
  `visible`. `writeModelLayer` também escreve na cópia da CPU (desde a #51 a cadeia inteira; a cor do cubinho no acerto em bobo lê o
  nível 1 da camada `skin + k`; [port] agora pela caixa atingida: `HitEvent.bodyPart` dá o osso e o texel sai de
  `(camada, u0, v0, w, h, d)` da caixa). A fila de VFX diz
  só o que aconteceu e onde; a cor dos cubinhos o render resolve (texel do bloco, da skin, ou `debrisColor` do modelo).
- **ViewDesc:** campos novos obrigatórios; crie com `createViewDesc()` (a cena de teste do M0 ganhou os campos).
- **Bench na web:** `?bench&views=4&bots=12&view=50&duration=600` (nomes em `BENCH_PARAMS`; `atlas=1`, `float=1`,
  `gpu=1`, `hz=30`, `route=bench:volta`). Padrão = critério do Switch na dock. Relatório em linhas `chave=valor`
  (`formatBenchReport`); no Switch cada linha vai para o `runtime.log` com `[bench] `.
- **Linhas `[t0]`:** `[t0] item=N nome=<slug> status=ok|falha|info|pulado chave=valor…` (`formatT0Line`, slugs em
  `T0_ITEMS`). A casca grava os itens 1–9 (os de GL com `fonte=casca`) e 17–21; o game, só os itens 10–16, no fim
  de cada bench (sem amostra, `pulado`; verificação do M1).
- **Gancho dos prints:** `GameHandle.debug: GameDebugApi` (câmera nomeada, hora do dia, dose, cinza, filtro de mip,
  HUD, viewmodel, congelar, folha das fontes em uso, `readyForPrint`, `whenReady`; o contorno e a skin de densidade
  saíram nas escolhas dos prints); a web pendura em `window.__bfDebug.print`.
- **Itens de teste do Switch no título:** a casca passa `GameDeps.testItems` (Bench com `BenchConfig`; Controles,
  Teclado e Áudio com `start()` → `TestRunner`), o game desenha a `TestScreenModel` com a UI do jogo, sem DOM.
- **Platform-api:** os membros novos das cascas são opcionais (`describeControllers?`, `memoryUsage?`, `recentLog?`)
  para cada casca implementar na sua frente sem quebrar a outra; o `AudioSurface.context` continua `unknown` e o
  `audio` faz o cast para `AudioContextLike`.

## 10. M1: integração (03/11/2026)

A integração montou o Construto no `game` e ligou as peças das 10 frentes. Decisões (revisáveis) e o que ela mexeu
fora das próprias pastas, com o motivo:

- **A cena num subcaminho, carregada sob demanda.** `@boboforces/game` (menus, fluxo, bench, `scene-api.ts`) e
  `@boboforces/game/scene` (loading, partida, mundo, IA). A web passa `GameDeps.loadScene` com `import()` (regra 15:
  `import()` só em `apps/web`) e entrega junto o renderer completo; o menu desenha com o renderer só de UI
  (`@boboforces/render/menu`). Motivo: o menu tinha 364,9 KB de 350 KB (tecnico.md §16.4); agora tem 315,9 KB. O Switch
  empacota tudo (esbuild) e devolve o módulo direto. O `vite.config.ts` perdeu o grupo `core` (ele puxaria a cena para
  a carga inicial) e o `size-check` passou a contar o código preguiçoso na primeira partida.
- **Loading dentro dos frames** (`scene/load.ts`): fatias de até ~90 ms com a tela de loading (fatia curta pagava um frame de vsync a cada fatia); regiões com buffers
  próprios (sem `reuse`: o render guarda as malhas depois do `setMap`), uma por vez (o mesher não é reentrante);
  `setEnvironment` em todo frame com o relógio andando; `warmup` depois de texturas, modelos e mapa.
- **Mundo sem render num lugar só** (`scene/world.ts`): `buildMapWorld` → `buildMapNav` → `buildSimMap`, o mesmo
  caminho do `mapc` (colisores pelo `propCollidersToWorld`, as props do jogo: `isPlayableProp`, todas desde a #52;
  navegação só com `blocksNav`). O golden usa ele.
- **JOGAR** = Construto em TDM 6 × 6 (o jogador + 11 bots N0 dentro do teto do perfil, sem limite de tempo).
  **Cena-vitrine** (só no título da web) = FFA só com o jogador. **Bench** = TDM só de bots: os jogadores locais são
  bots (`views + bots` bobos), cada vista segue um, espalhadas pelos dois times; com `route`, a vista 0 segue a rota;
  `scene=vitrine` põe a vista 0 na câmera `print:dia`. O bench mede além do perfil (limites do motor e visão do PC).
- **Skins:** rodízio `recruit`/`mechanic`/`pilot` pelo controlador, colete do time (FFA sem colete), zumbi `common`;
  as aparências são compostas no loading (nunca por frame) pelo `createSkinLayerCache`. Desde a #51: compor + ampliar +
  nível 1, 4 camadas por skin; o M1 usa 10 das 16 skins da reserva. **[port]** Hoje: `FIGURE_BOT_ROTATION` (as
  `figureBotLooks` primeiras do perfil: 3 no Switch e no celular, 6 no PC) × {sem time, A, B} + zumbi, pintadas por
  `paintFigureSkin` (2 camadas, 32 vagas na reserva de 64); Switch 10 skins, PC 19 (31 com a fila dos prints). Estouro:
  o excedente veste o look padrão do PRÓPRIO time e o relatório traz um aviso (nunca troca de time).
- **Viewmodel:** escala 0,8 em 1–2 vistas e 0,6 em 3–4 [PROPOSTA]: com 1,0 a arma passava de 40% da tela. [port] Os
  braços são manga + antebraço + mão do boneco do FutBobo (`armLength` 10,9 px = 0,596 m, era 0,5 m).
- **Pausas de GC no relatório:** frame acima de 2× a média recente sem CPU do jogo que explique (média exponencial).
- **Sondas `[t0]` do jogo** (itens 10–16) saem no fim de cada bench, em todas as plataformas.
- **Fontes candidatas fora do build publicado:** seção `local` do `runtime-assets.json` (Vite e build do Switch levam
  se o arquivo existir) e `.gitignore` do atlas gerado. Saiu tudo com a #54: `local: {}`, sem regra no `.gitignore`.
- **Eden:** três construções de GLSL derrubavam o app no recompilador do emulador (multiplicação inteira no hash de
  célula, `return` antecipado nos programas 4 e 5, índice dinâmico em array de uniform). Saíram, e o `render.test.ts`
  confere (regra 6 do `PORTABILIDADE.md`). O hash de célula do shader e o do JS dos detritos (`fx/colors.ts`) são o
  mesmo hash de float (conta a conta em float32 no JS). **Medições do M1:** o `bfHash` (bits, para estrelas, nuvens,
  crateras e giro da UV) passou a montar os 24 bits com o byte ALTO de 3 `bfHashF` de sementes diferentes, e o
  `bfHash01` usa o `bfHashF` direto: o `uint(bfHashF · 2^24)` deixava os bits baixos quase sempre em zero (o fract de
  um produto na casa dos milhares só tem ~10 bits bons) e o céu do Entardecer e da Noite virava chiado nos prints. Sem
  multiplicação inteira (só `|` e `<<`), então segue valendo no Eden; teste em `render/src/shared/hash-bits.test.ts`.
- **Medição crua no bench:** `Scene.frame` recebe o intervalo cru do frame (`frameMs`, sem o limite de 0,1 s do
  `dt`); o bench grava `[bench] pico …` (desde a verificação: o pior frame acima de 1,5× o alvo em cada janela de
  duração/20, com `frame_ms` e a quebra por fase) e a cena deixa o
  rastro `[cena] frame N: …` dos 3 primeiros frames no log (no Switch, gravado na hora).

Arquivos de outras frentes que a integração mexeu (além dos contratos do §8):

- render-mundo: `renderer-core.ts` (sem o caminho do M0; `setActors` cria os passes; `skinDensityTest`),
  `texture-gpu-data.ts` (o tipo do filtro vem do contrato), `render.test.ts`, `data.test.ts`; arquivos novos
  `menu-renderer.ts` e `menu.ts`. render-atores: `actors/shader.ts`, `three-objects.ts`, `actor-pass.ts` (uniforms da
  skin de densidade), `fx/fx-pass.ts` (cor da prop pelo índice), `actors/index.ts`, `props-skin.test.ts`.
- world: `mesh/index.ts`, `mesh/vertex.ts` e `mesh/region.ts` (sem o mesher do M0). ai: `config.ts`, `context.ts`,
  `paths.ts`, `director.ts` (orçamento), `soldier.ts` (área jogável); o golden sintético (`golden.test.ts`) saiu. sim:
  `view.ts` e `sim.ts` (`playArea`). format/model: `density.ts` (novo) e `index.ts`. audio: `testing.ts`.
- ui: `strings.pt-BR.ts` (`title.vitrine`, `bench.webDone` e as chaves do Switch pedidas pela switch-audio),
  `screens-m1.test.ts`. skingen: `generate.ts` e `paths.ts` (skin de densidade; [port] o gerador saiu). texgen: `package.json`.
- web: `main.ts`, `scene.ts` (novo), `vite.config.ts`, `scripts/edge.ts`, `scripts/prints-plan*.ts`,
  `scripts/prints-fake.ts`, `platform/audio.ts` (comentário), `platform/m1-pieces.test.ts`; `scripts/prints.ts`.
  switch: `src/main.ts`, `scripts/bundle.ts`. size-check: `budgets.ts`, `measure.ts`, `measure.test.ts`. guard:
  `assets.ts`. `.github/workflows/ci.yml`, `package.json` da raiz (`assets:check`, `bench:sim`, `bench:nav`).

Etapa de medições do M1 (03/11/2026), mínimo para medir e para os prints saírem certos:

- render (shared, da integração): `glsl-common.ts` (`bfHash` e `bfHash01`, ver o item "Eden" acima) e o teste novo
  `shared/hash-bits.test.ts`.
- web-bench: `scripts/bench.ts` ganhou `--gpu-alto` (`--force_high_performance_gpu`: sem ela o Edge fica na Intel UHD
  deste notebook mesmo com `powerPreference: 'high-performance'`) e `--sem-vsync` (`--disable-gpu-vsync
  --disable-frame-rate-limit`: o Edge com janela fica preso em 56 fps / 17,8 ms até numa página vazia); o `launchEdge`
  de `apps/web/scripts/edge.ts` aceita `args`.

Verificação do M1 (03/11/2026), o corretor a partir dos achados dos revisores (contratos no §8, "resolvidos na
verificação"):

- mapa-nav: `assets-src/maps/construto.ts`. Pista de leitura com UM par no fim da estrada e as 4 câmeras na mesma reta
  (o par de 5 m tapava os de 30 e 50 m), sebe de folhas de 1,5 m no limite norte da grade (o lado esquerdo do print era
  o fim do mundo) e fecho de parede de teste a 24 m atrás do par; contraforte de tijolo no plano da frente da cabeça do
  manequim `densidade` e câmeras a 1 m e 3 m desse plano (antes o muro ficava 1,25 m atrás e o print exagerava a
  diferença do pixel); o zumbi da vitrine em pé e o agachado no mecânico; o painel da fachada embutido acima do portão
  (sobrava 0,5 m para fora); painéis baixos embutidos nas paredes do galpão e uma faixa luminosa no piso do corredor do
  meio [PROPOSTA] (o fundo do galpão ficava em luz 0). Todos trocam bloco por bloco no mesmo lugar, menos o
  contraforte e o fecho (colisão nova). `npm run assets`; golden `a15e05de` → `b452f553`.
- render-atores: `fx/shader.ts` (a sombra-blob tinha `fadeStart = 2,0`, borda invertida no `smoothstep`: alfa 0 e
  discard; agora 0,99) e o teste em `actors/shaders.test.ts`; `actor-pass.ts` (`outlinePx`).
- render-mundo: `world-shaders.ts` (`uEmissiveLayers` com índice constante, o último índice dinâmico em uniform) e
  `render.test.ts` (o teste vale para QUALQUER `uAlgo[`); `renderer-core.ts` (`uFlash` por vista,
  `setDebrisBudget`, `outlinePx`); `menu-renderer.ts`.
- ui: `screens/loading.ts` (ordem das etapas), `strings.pt-BR.ts` (`test.bench.done` = "… · B volta"),
  `screens-m1.test.ts`.
- switch-audio: `t0/runners/controllers.ts` e `audio.ts` (os botões são por POSIÇÃO: o X é o `faceUp` e o Y o
  `faceLeft`; vibrar e tocar estavam trocados em relação à dica da tela), `runners.test.ts`, `t0/log.ts` (comentário),
  `src/main.ts` (com o `bench.json`, as sondas tardias rodam depois do relatório, não no meio do loading).
- web-bench: `scripts/prints.ts`, `apps/web/scripts/prints-plan.ts`, `prints-fake.ts`, `edge.ts` (contorno de 2 px na
  leitura), `src/bench/url.ts` (apelidos `atores` e `arma`), `scripts/smoke-web.ts` (relatório versão 2).
- game: `scene/match.ts` (manequins de print só com a câmera deles e calculados uma vez; clarão por vista; teto de
  detritos; sondas `[t0]` sem `ok` com zeros; item 15 pelo começo da partida; item 16 pelos últimos 60 s por tempo;
  sim e IA com média, p99, máximo e custo por tick; picos distribuídos; vãos de mais de 1 s fora das estatísticas;
  `erros=` com os erros do three; as alocações por frame que restavam: `trace`, chave do layout, `for…of` do `decay`
  e o quadro do overlay de toque), `bench/*` e os testes novos em `game.test.ts`.

Escolhas dos prints do M1 (decisões #50–#54, 03/11/2026), passo 4 da integração (contratos antes → depois no §8):

- game: `scene/match.ts` (`buildSceneSkins` com `expandSkin` e nível 1, `MANNEQUIN_KIND.height`, luz em
  `bodyHeight/2`), `scene/load.ts` e `scene-api.ts` (comentários), `null-renderer.ts`, `game.test.ts` (etapa skins,
  folha das fontes, régua, textos com o atlas real), `scene/golden.test.ts` (`cf65a778`; na revisão, `372dcaea`).
- ui: `strings.pt-BR.ts` (saem as chaves longas `test.bench.{dock,solo,zombies,bots48,planB,gpu}`, pedido da
  switch-audio). modelgen: `preview.ts` (rótulo do bobo de escala: 1,625 m; [port] 1,75 m e o gabarito do pintor novo). switch: `src/t0/gl-probes.ts`
  (comentário da sonda de skin, pedido da render-mundo).
- `assets-src/fonts/`: a Barlow (WOFF2 + `OFL.txt` da raiz) e a pasta `chakra-petch/` saíram DEPOIS de conferir que o
  `vite.config.ts` e o `apps/switch/scripts/licenses.ts` leem o `generated/ui-fonts.licencas.txt`; ficaram em
  `local/fontes-saidas/`. `README.md` de lá atualizado. `.gitignore`: sai a regra das candidatas.
- [port: números do M1 antes do boneco novo; os de hoje estão no §11] `npm run assets` combinado: 7.165 nós (4.599 jogáveis), 25 componentes, 28 spawns com caminho, travessia TDM
  10,1–10,4 s, maior linha de visão 47,75 m, aviso "visto sem ver" em 25 nós; `.bfmap` 9.863 B.

## 11. Port do boneco do FutBobo: integração (04–07/11/2026)

O bobo passou a ser o boneco do FutBobo (decisão #56) com 1,75 m (#55); o bobo A, a `skinparts@2` e o skingen antigo
saíram. Contratos no §8 ("Port do boneco"). Escolhas da integração (menores e revisáveis; o texto de jogo está no
`gameplay.md` §3.1 e o de arte no `arte-ux.md` §2):

- **Ordem em 3 degraus:** altura B sozinha (golden CP1 `079f5850`), contratos aditivos, sete frentes disjuntas e a troca
  (golden CP2 `cb50303f`, motivo no CHANGELOG). Os símbolos velhos só saíram depois do jogo religado.
- **Braço fora da AABB:** as hitboxes de braço (`upperArm` e `forearm`, D e E) são cortadas a 0,75 m do eixo da entidade
  no plano horizontal (`ARM_HIT_CUT_M`, um quadrado alinhado ao mundo = a AABB crescida de 0,45 m). O visual não muda: a
  arma pode aparecer do outro lado de um muro fino, mas não leva tiro por lá. O corte vale também para o zumbi.
- **Cabeça agachada só levanta:** o pitch da cabeça agachada ou deslizando fica em [0; +0,1] (o lado que não sobe a quina
  de trás). Com isso o E.3 (agachado atrás de cobertura de 1,0 m não leva tiro além de 7 m) vale em todo pitch.
- **Arma pela moldura da mira:** a matriz da arma de 3ª pessoa tem a orientação da moldura da mira (yaw da raiz + pitch,
  com o clamp da postura) e a origem na palma D do FK; o cano fica na mira em todo pitch sem mexer na tabela.
- **Recarga dentro do envelope:** `reloadNeckX` 0,35 → 0,17, e a respiração some durante a recarga (só o 0,17 dava 1,27 px
  em regime; o alvo é ≤ 1 px).
- **Câmera `print:altura-45`** entra no contrato como câmera opcional (prefixo `print:altura-` reservado) e no Construto.
- **Etapa "figuras"** não tem linha própria na tela de loading (`LOADING_STEPS` do ui não a conhece; aparece em "skins").
- **Manequim com mira ≠ 0 e boneco do clipe** (prints): entidades sintéticas `0xFFFD|m` e `0xFFFC…`, tratadas como
  manequim pelo render (o rig zera o pitch da entidade 0).
- **Eden (instanciamento adiado):** o emulador adia as instâncias N−1 de um draw instanciado e as desenha com o estado do
  draw seguinte; nenhuma opção da config corrige. Contorno "F" (`applyInstancingFix` em `apps/switch/src/t0/gl-probes.ts`,
  ligado em `apps/switch/src/main.ts`): logo depois de cada draw instanciado de 2 ou mais instâncias, o mesmo draw sem
  instâncias com 1 primitiva. Liga SÓ por detecção a cada boot (no console a detecção deve dar "normal", ainda não
  testado). O caminho antigo (as 7 `InstancedMesh`) também saía quebrado no Eden.
- **Aceitos como estão:** zumbi a 6,84 px do eixo do olho (não tem câmera); E.1 por osso a 99,2% (a caixa única de antebraço
  + mão); Tryhard com 59,4% de headshot; mira visível da IA com teto de 2 por tick; empunhadura da pistola correndo (a
  pistola não existe na sim do M1).
- **Roupa militar (#58, 07–08/11/2026):** o uniforme de futebol saiu. `FigureKit`/`figureKitFor` viraram
  `FigureOutfit`/`figureOutfitFor` no `FigureLook` (mudança de contrato feita pela integração; os ids `skin:*` dos presets
  não mudaram). A chave da skin passou a `fig2` e inclui o índice do time, porque o ícone ▲ ● ■ ◆ do colete depende dele.
  Com time, o colete grande, o cinto do equipamento, a braçadeira, as luvas e as joelheiras vão na cor do time: **38,1–39,0%**
  da frente no teste de cobertura (meta 35%); na projeção com o cabelo, a barba longa e o afro ficam em 32,8–34,0%. Sem
  time, o colete é uma placa menor, para o camuflado aparecer. A tropa sem time dos prints fica em 8 bonecos (a reserva fica
  com 31 de 32 skins). O formato do look é o que o editor "Meu Bobo" (M2, GDD §4.7.2) vai salvar.
- **Medições (`PERF.md`):** loading, draws, envio ao GL, rig, hitbox, balance e Eden com data e método.
- **Removido:** 23 arquivos (`skin*.ts` do format, `rig.ts`, `bobo-geometry.ts` e `fx/dismember.ts` do render, o skingen
  antigo, `assets-src/skins/`, `partes64.*` e `modelos64-rostos`). `HITBOXES` saiu da sim (virou comentário do `HitPart`).
  `skinparts` está em `RETIRED_FORMAT_KINDS`. `REQUIRE_ACTOR_DRAWS` (smoke) e `RETIRED_ASSETS_FAIL` (size-check) ligados.
- **Arquivos de outras frentes que a integração mexeu:** `packages/render/src/shared/passes.ts` e `renderer-core.ts` (vistas,
  estatísticas), `fx-queue.ts`, `packages/format/src/model/index.ts`, `format-id.ts`, `platform-profiles.ts`,
  `content-ids.ts`, `apps/web/scripts/{edge,prints-plan}.ts`, `scripts/{smoke-web,bench}.ts`, `apps/switch/src/main.ts`,
  `package.json` (`assets`, `assets:check`, `skingen:figuras`).
- **Pendências:** o tempo da tabela no Eden (250 ms; o plano pedia ≤ 75, plano B = tabela gerada no build), as skins no
  Eden (226 ms; meta 180) e o console (detecção do instanciamento, tabela, fps); emote (M2) e escala do zumbi na hitbox
  (M3); 15 nós de cerca de tábua que o boneco ainda atravessa (cabeça em pé 0,409 m, tronco agachado 0,392 m e coxas
  0,355 m saem da AABB) e o parapeito de 1,75 m (x 26–32, z 49,5–50), decisões de mapa do Erick.

## 12. M2: MVP web solo (a partir de 08/11/2026)

Plano em `docs/PLANO_M2.md` (#61–#64). Sem frentes em paralelo: o Claude faz fase por fase, como integração, e as
mudanças de contrato ficam registradas aqui.

### 12.1 Fase 1a: as 8 armas na sim (08/11/2026)

- **Arma = código estável.** `WEAPONS` (`packages/sim/src/config/weapons.ts`) é indexado por `WEAPON_CODE` (fuzil 0,
  pistola 1, SMG 2, escopeta 3, sniper 4, foguete 5, faca 6, granada 7, LMG 8). Código nunca muda nem é reaproveitado.
  `WEAPON_SLOTS` saiu; quem precisava dele usa `weaponDef(code)` ou `WEAPONS`.
- **`SimView` (mudança de contrato):**
  - `weapon` passou a ser o **código** da arma na mão (antes era o slot);
  - entraram `slot` (o slot ativo), `loadout`, `slotClip` e `slotReserve` (4 por entidade, passo `WEAPON_SLOT_COUNT`)
    e `adsAmount` (0..1);
  - `ammoClip` e `ammoReserve` saíram; a munição da arma na mão é `heldClip(view, e)` e `heldReserve(view, e)`.
  - Nos eventos (`shot`, `hit`, `kill`, `weapon`) e na fila de dano, `weapon` também é o código.
- **`InputFrame.primary` (mudança de contrato do input):** a primária do próximo spawn, código + 1 (0 = manter). O frame
  passou de 88 para 96 bits. `InputMapper.setPrimary` escreve nele (o menu radial da fase 2 vai chamar).
- **`SimConfig.primaries`:** a primária de cada controlador no 1º spawn (a IA da fase 1d e o game passam).
- **Disparo por tipo** (`WEAPON_FIRE`): bala; chumbos, com dano somado por alvo (1 item por alvo e por tiro); golpe
  (faca a 2 m, 100 pelas costas); projétil e arremesso ficam para a fase 1b. ADS com tempo de entrada (`adsInS`), zoom
  por arma (`adsZoom`), recarga por cartucho (escopeta, interrompível pelo gatilho) e padrão horizontal fixo de recuo
  (`recoilPatternDeg`) contado pela rajada (`burstShots`).
- **Slots:** `InputFrame.weapon` segue sendo o slot desejado (absoluto). A sim só troca para um slot usável (a granada
  sem nenhuma não é) e volta para a primária quando o da mão esvazia.
- **Snapshot versão 4.** **Golden `81150d3b`** (21 abates, 304 tiros, placar 7×14; antes `cb50303f`): o estado ganhou os
  campos por slot e o fuzil ganhou o padrão de recuo, então a mira dos bots muda.

### 12.2 Fase 1b: projéteis e explosões (08/11/2026)

- **Pool de projéteis** no estado (`SimState.proj*`, `MAX_PROJECTILES` = 512, separado das entidades, com `projCount`)
  e na `SimView` como `projectiles` (`count`, `alive`, `weapon`, `owner`, `position`, `prevPosition`, `velocity`).
  Entra no snapshot (versão 5) e no hash. O passo 4 da ordem fixa (`projectileSystem`) agora existe, entre armas e dano.
- **Foguete:** reto a 35 m/s; o segmento de cada tick passa pela grade e pelas hitboxes dos inimigos. O acerto direto
  dá 120 no alvo, e a área (100 → 0 em 4 m) vale para os outros; sem contato, explode no fim do alcance. Quem lançou
  nunca é atingido pelo próprio foguete, só pela explosão.
- **Granada:** apertar puxa o pino e o pavio (2,5 s) corre na mão; soltar joga a 16 m/s com a mira 0,15 rad acima e
  metade da velocidade de quem joga. Ela quica nos blocos, atravessa corpos e explode no pavio. Se o pavio acabar na
  mão, explode ali; quem morre cozinhando deixa a granada cair. Cozinhando não troca de slot. A última granada jogada
  devolve a primária.
- **Explosão:** a distância é medida até o ponto mais perto da AABB, com queda linear e linha de visão do centro até
  esse ponto (blocos que param bala). Quem lançou leva 50% (autodano); aliados não levam nada (fogo amigo desligado).
- **Eventos novos:** `projectile` (`launch`, `bounce`) e `explosion`; a ação `cook` no `weapon`.
- **Golden `28969b8b`**, com o mesmo combate (21 abates, 304 tiros, 7×14): só o estado mudou.

### 12.3 Fase 1c: armas na tela (08/11/2026)

- **Modelos** (`assets-src/models/weapons.ts`): SMG, escopeta, lança-foguetes, faca, granada, LMG e o foguete em voo
  (`rocket-shell`), registrados como `model:*` no fim do registro de conteúdo. O pacote do modelgen agora segue a ordem
  do registro, então os índices das props do M1 não mudaram. São 22 camadas no `modelos64` (teto do M1: 32). Nas peças
  com pivô, as caixas são relativas ao pivô. A folha de contato mostra as armas em linhas de 3.
- **`Renderer.setProjectiles(ProjectileBuffer | null)`** (mudança de contrato do render): modelo, posição, yaw, pitch,
  roll e luz por projétil. Desenha nos conjuntos instanciados das armas (programa 4): nenhum programa e nenhuma malha
  novos. O foguete em voo é um modelo `kind: 'weapon'` só para usar esse caminho.
- **Fila de VFX:** `FX_KIND.explosion` (`pushExplosion`: clarão, bola de fogo, línguas de fogo, faíscas, fumaça e 14
  cubinhos) e `FX_KIND.trail` (`pushTrail`: fumacinha e chama do foguete), nos anéis e no pool de detritos que já
  existiam.
- **`game`:**
  - os projéteis da `SimView` vão para o render (o foguete aponta para a velocidade, a granada rola) com o rastro;
  - a explosão dá clarão nas vistas próximas e tremor de câmera (até 14 m);
  - o lança-foguetes tem coice e clarão no lançamento;
  - o zoom e o tempo do ADS são os da arma na mão (`adsZoom`, `adsInS`). Na luneta da sniper (4x) o viewmodel some; a
    moldura da luneta é da fase 1e;
  - o viewmodel do lança-foguetes, da LMG e da sniper ganhou ajuste de escala e posição fora do ADS.
- **Bench:** `weapons=` (`rifle` padrão, `smg`, `shotgun`, `sniper`, `rocket`, `lmg` ou `mix` em rodízio) dá a
  primária dos bots no 1º spawn (`LocalDriverConfig.primaries`). O relatório ganhou `armas=` no fim da linha `cena=`.
- **Conferido no navegador** (`npm run dev`, painel do app; `.claude/launch.json` com a configuração `web-dev`): o
  viewmodel do lança-foguetes, os foguetes em voo, as explosões e a fumaça, a LMG e a sniper com 4 vistas e 24 bots.
  Console sem erros.

### 12.4 Fase 1d: a IA usa as armas (08/11/2026)

- **Primária dos bots** (`packages/ai/src/weapons.ts`): `botPrimary(seed, controller)` sorteia pela semente da receita
  e pelo controlador, com pesos (fuzil 30, SMG 20, escopeta 15, LMG 13, sniper 12, foguete 10). `botPrimaries(recipe,
  humans)` monta o `SimConfig.primaries`: humanos com a padrão, bots com o sorteio.
- **Quem chama:** o `LocalDriver` e o `createHeadlessMatch` usam `botPrimaries` quando não recebem `primaries` (a
  partida headless é a mesma do jogo). O bench sempre passa a do `weapons=`, que fica no fuzil por padrão, para
  continuar comparável com o M1. O robô de balanceamento (`tools/balance/src/duel.ts`) fixa o fuzil, porque calibra o
  duelo de fuzil.
- **Uso por categoria** (`AI_WEAPON_USE` no `ai/src/config.ts`): distância preferida (chegar perto, recuar ou
  segurar), ADS por arma, a sniper só atira com o ADS completo, e o foguete mira no pé com antecipação pelo tempo de
  voo.
- **Troca de slot** (`chooseSlot`): faca com o alvo a menos de 1,6 m (exceto com a escopeta na mão), volta acima de
  3 m. A pistola entra com a primária vazia ou com o alvo perto demais para o foguete (5 m) e a sniper (6 m), e volta
  com 2 m de folga. Fora de combate, volta para a primária.
- **Semiautomáticas** (pistola, escopeta, sniper, foguete): o gatilho solta um tick entre dois tiros, porque a sim só
  atira na borda.
- **Granadas da IA:** só com o N2 (fase 3).
- **Golden `b66afdf7`** (24 abates, 204 tiros, placar 9×15; antes `28969b8b`). O balance continua com os 5 níveis em
  ordem; o par mais apertado é Tryhard × Suado, com 84,0%.

### 12.5 Fase 1e: HUD das armas (08/11/2026)

- **`HudModel` (mudança de contrato do ui):** entraram `weaponName` e `weaponCategory`, `ammoMode` (`HUD_AMMO`:
  nenhuma, só o pente ou pente / reserva), `grenades` (-1 = não mostra), `crosshair` (`HUD_CROSSHAIR`: cruz ou ponto)
  e `scope`. O `game` resolve os nomes uma vez na tabela pt-BR e só guarda as referências, sem string por frame
  (regra 13).
- **Textos:** `weapon.<id>` com os nomes do #61, `weapon.category.<categoria>` (Pistola, SMG, Fuzil, Escopeta, Sniper,
  Lança-foguetes, Faca, Granada, Metralhadora) e `hud.weaponSeparator` (" · ").
- **Desenho** (`ui/src/screens/hud.ts`):
  - "Rattler · Fuzil" fica em cima da munição, e as granadas (ícone em pixels e o número) à esquerda dela, só no 1–2P;
    no 3–4P continua só o pente;
  - a faca não mostra munição, e a granada na mão mostra só quantas sobram;
  - faca, granada e sniper fora da luneta usam um ponto como mira; as outras usam a cruz, que abre com a dispersão da
    arma no quadril (chumbos inclusive) e fecha no ADS;
  - a luneta (zoom ≥ 3x, ADS quase todo dentro) escurece fora de um círculo blocado, com retícula fina que engrossa na
    borda e ponto vermelho no centro. Ela é desenhada antes de tudo, então as plaquinhas ficam por cima.
- **`game`:**
  - o mapeador do humano segue a troca automática da sim (por exemplo, depois da última granada);
  - o projétil a menos de 1,5 m do olho de quem lançou não é desenhado (o fundo do foguete tapava a câmera);
  - a sniper no quadril e o clarão da explosão ficaram menores.
- **Conferido** no Edge headless (1280×720, DPR 1) com `local/m2/capturar-hud.ts` sobre o `npm run dev`: a HUD da
  sniper, da pistola e do lança-foguetes, a luneta e o foguete saindo. O painel do navegador do app corta a parte de
  baixo da página com DPR 1,25 e roda devagar escondido; para conferir a HUD, use o script.
- **A primária do humano** continua sendo a padrão (o fuzil). O menu radial da tela de morte, que escreve
  `InputFrame.primary`, é da fase 2.

### 12.6 Fase 1f: prints das armas, rodada 5 (08/11/2026)

- **Roteiro** (`apps/web/scripts/prints-plan.ts`): a rodada `rodada5` tem três conjuntos.
  - `arsenal`: as 9 armas na mão dos manequins, na fila de frente, a 3/4 e mirando.
  - `empunhadura`: SMG + escopeta, foguete + LMG e faca + granada, a 1 m.
  - `na-mao`: a vista do jogador (`camera: null`) com HUD e viewmodel, uma página do bench por primária
    (`weapons=<id>`, 2 bots).
  - Perguntas A1–A4 e notas em `ROUND5_QUESTIONS` e `ROUND5_NOTES`.
- **`GameDebugApi.setViewmodelVisible` (mudança de contrato do bench):** liga e desliga a arma na mão pelo
  `hideViewmodel` do debug. O roteiro desliga em toda cena fora do `na-mao`.
- **`VIEWMODEL_TWEAK` em `scene/match.ts`:** escala e deslocamento por arma, só fora do ADS. Vale para o lança-foguetes
  (0,62), a LMG (0,9) e a sniper (0,75); na escala normal o tubo do foguete tomava metade da tela.
- **Explosão e luneta** não param numa cena congelada. Vão para a página como capturas ao vivo (`local/m2/`, Edge
  headless 1280×720) e servem de exemplo, não de régua.

### 12.7 Fase 2a: regras da partida (08/11/2026)

- **Fases (`MatchPhase`, mudança de contrato da sim):** entrou `suddenDeath`, no fim da lista (o snapshot guarda o
  índice). `isLivePhase` diz se a partida está valendo (jogando ou morte súbita); armas e golpe usam ela.
- **Contagem:** `SimConfig.countdownS` (padrão 0). Na `warmup`, a sim aplica só a mira e a primária da entrada;
  botões, movimento e troca de arma ficam de fora, e o relógio não corre. `MatchView.countdownTicks` diz quanto falta.
  O `game` ainda não liga a contagem: ela entra com a HUD dela, na 2d.
- **Fim:** empate no fim do tempo ou da meta abre a morte súbita (`MATCH_DEFAULTS.suddenDeathS` = 60 s, em
  `ticksLeft`). Nela, o primeiro abate que desempata encerra; o fim do relógio dela encerra empatado. No FFA,
  `MatchView.winnerEntity` diz quem venceu (`winnerTeam` é 0, o time único).
- **Agressores recentes** (`SimState.recentFrom`, `recentDamage` e `recentTick`, 4 por bobo): guardam o dano de
  inimigos na vida atual e são limpos no respawn.
  - **Assistência:** quem fez 25 ou mais nos 10 s antes da morte, fora o matador. Entra em `SimView.assists`, e o
    `KillEvent.assister` leva o maior assistente.
  - **Plano de morte:** usa `WEAPON_KILL_PLANE` (254) no lugar de `WEAPON_NONE`. O abate vai para quem feriu a
    vítima nos 5 s antes (ponto e abate contam); sem ninguém, é acidente.
- **Spawn pontuado** (`pickSpawn`, sem alocar: rascunho `spawnScore` e `spawnMark` por ponto, feito na criação):
  - FFA: em ordem de distância, aceita o ponto a mais de 20 m de todo inimigo e sem linha de visão de nenhum
    (`blocksSight`, olho no olho, até 100 m); para em 3. Sem ponto seguro, cai na regra antiga.
  - TDM: cada inimigo que enxerga o ponto (conta até 3) pesa mais que qualquer distância; o sorteio fica entre os 3
    melhores com tão poucos inimigos à vista quanto o melhor.
- **Snapshot 6.** Golden `b26c3ec1` com o mesmo combate (§PERF).

### 12.8 Fase 2b: caixinha de munição e Destravar (08/11/2026)

- **Pickups (mudança de contrato da sim):** pool fixo no estado (`MAX_PICKUPS` = 256; `pickAlive`, `pickKind`,
  `pickPosition`, `pickPrevPosition`, `pickVelY`, `pickTicks`), no snapshot e no hash como os projéteis.
  `SimView.pickups` (`PickupView`) e `PICKUP_KIND.ammoBox`.
  - O `kill` solta a caixinha (`dropAmmoBox`) no Bobo Warfare, menos no plano de morte. Ela nasce 25 cm acima dos
    pés e cai com a gravidade do bobo até o chão (raio para baixo contra blocos sólidos e props).
  - O `pickupSystem` roda depois dos projéteis: tempo (20 s), queda e coleta. Pega a até 1 m no plano, de 0,6 m
    abaixo a 1,8 m acima dos pés. `refill` dá 1 pente de reserva a cada slot com reserva e +1 na granada; sem
    espaço, a caixinha fica.
  - Evento `pickup` (`drop` e `take`).
- **Destravar:**
  - `BUTTON.unstuck` (bit 11), em `MENU_ONLY_FRAME_BUTTONS`: sem atalho, porque vem da pausa (2e).
  - O `unstuckSystem` roda logo depois da entrada, na borda do botão, com a partida valendo. Procura em ordem de
    distância 3D os nós em pé do componente principal da navegação (`navMainComponent`, o com mais nós, calculado
    na criação), a pelo menos 2 m.
  - O humano fica com o primeiro nó. O bot testa até 8 e fica com o primeiro que nenhum humano vivo enxerga; se todos
    estiverem à vista, fica com o mais perto.
  - `SimState.unstuckCount` conta os usos na vida. Na 3ª vez, o bot renasce num spawn (`respawn` + `pickSpawn`,
    sem contar morte). Sem navegação no mapa, o bobo renasce num spawn.
  - Evento `unstuck`, com a origem e o destino. O `game` loga como aviso (escopo `partida`), no anel de recentes
    do relatório do F2.
- **IA:** `AI_PATH.unstuckS` (8 s), `unstuckProgressM` (1 m) e `unstuckMoveM` (2 m). Fora de combate, o soldado
  aperta `BUTTON.unstuck` se não andou 2 m no plano nem chegou 1 m mais perto do objetivo nesse tempo. Trocar de
  objetivo não zera a conta: o bot numa ilha da navegação troca sem sair do lugar. Os bots "Camper" da fase 3 vão
  precisar zerar a conta enquanto acampam.
- **Render:** os modelos `pickup` ganham conjunto instanciado como as armas. O `game` põe as caixinhas no
  `ProjectileBuffer` depois dos projéteis (`MAX_DRAWN_PROJECTILES` 64 → 128): elas giram a 1,2 rad/s e piscam nos
  últimos 3 s. Nenhum programa de shader novo.
- **Snapshot 7.** Golden `d0ba0eca` (§PERF).

### 12.9 Fase 2c: tela de morte (08/11/2026)

- **sim:** `SimView.respawnTicks` (o array que já existia), para a contagem. Sem mudança de estado nem de golden.
- **`HudModel` (mudança de contrato do ui):**
  - Faixa: `deathLabel`, `deathName`, `deathWeapon` e `deathHp` (strings resolvidas pelo `game`, por
    referência).
  - Menu: `primaryNames`, `primaryCategories` e `primarySelected`; `hardTimeHint`.
  - `primaryHit` é a SAÍDA do desenho: o formato (`PRIMARY_LAYOUT`) e os retângulos das opções, que o `game` usa no
    quadro seguinte (`hitPrimaryOption` para o toque). Textos novos `death.*`, `bot.levelName.*` e `zombie.name`; a
    fonte não tem "→", então a dica usa "»".
- **Desenho** (`ui/src/screens/hud.ts`, ramo do morto):
  - O formato sai do espaço (`ringRadius`): o anel cabe se o raio (até 22% do lado menor) deixa embaixo a faixa com
    a dica e em cima o rótulo e o placar, sem as opções dos lados encostarem na contagem. No anel, a contagem vai em
    letra de rótulo.
  - Sem anel, a fileira de nomes; se ela não cabe na largura, ou no 3–4P, a linha "« arma »".
  - A faixa vai embaixo do anel ou da fileira, ou no alto. Morto, a HUD esconde a munição e o nome da arma.
  - Testado nas 4 resoluções com 1 vista e a 720p+ com 2: nada sai da vista e nada encosta. A 640×180 por vista
    (2 vistas a 640×360) não é caso real.
- **`game/src/scene/death.ts`** (puro, testado): `PRIMARY_ORDER` (fuzil, SMG, escopeta, sniper, foguete e LMG), a
  câmera (`deathCamAngles`: sobe 0,45 m, vira em 0,5 s para o peito de quem matou, com `killerLift` de 25% da meia
  altura para ele não ficar atrás da contagem), o cursor (`moveRadialCursor` + `radialIndex` no anel; `stepCursor`
  na fileira e na linha), `losingBadly`, `controllerNames` e `fillDeathBanner`.
- **`scene/match.ts`:**
  - O `kill` abre a morte da vista que seguia a vítima; o `spawn` fecha.
  - Para o humano: zera a mira do mapeador na morte. O giro de cada quadro vira o cursor e a mira volta a zero; a
    câmera de morte não usa a do mapeador, e o `spawn` devolve a mira do ponto.
  - A roda e `nextWeapon`/`prevWeapon` passam a opção; o toque usa os retângulos. A escolha vai para
    `InputMapper.setPrimary`.
- **Conferido** no Edge headless sobre o `npm run dev` (`local/m2/capturar-morte.ts`: JOGAR, esperar os bots
  matarem, girar a roda): anel a 1280×720 e a 667×375, quem matou entre a 1ª opção e a contagem.

### 12.10 Fase 2d: HUD da partida (09/11/2026)

- **JOGAR:** a receita usa `PLAY_SCORE_LIMIT` (75) e `PLAY_TIME_LIMIT_S` (600). `LocalDriverConfig.countdownS`
  repassa `MATCH_DEFAULTS.countdownS` à sim só nessa cena; bench, vitrine e prints começam jogando. Até o resultado
  (2e), a partida que acaba fica parada.
- **`ui/src/screens/match-hud.ts`** (novo; desenhado uma vez por quadro, em px da superfície):
  - `KillFeedModel` + `pushKillFeed`/`ageKillFeed`/`drawKillFeed`: 5 linhas, 6 s, a última apagando.
  - `ScoreboardModel` + `drawScoreboard`: até 40 linhas, uma tabela por time (lado a lado se couber), colunas da
    largura do maior título.
  - `drawMatchCountdown`.
  - Strings por referência e números pintados (sem texto por quadro).
- **`HudSharedModel.suddenDeath`** e **`HudModel.markers`/`markerCount`/`markerColor`** (mudanças de contrato
  do ui). O chevron é desenhado por baixo das plaquinhas, só vivo e fora da luneta. Textos `hud.suddenDeath`,
  `scoreboard.*` e `countdown.*`.
- **`game`:**
  - `scene/markers.ts` (`projectToView`, puro, com a convenção da câmera) projeta os aliados com a câmera de cada
    vista.
  - `countdownLine` (em `death.ts`) agrupa os bots do outro time.
  - O placar ordena por abates e depois por menos mortes (inserção num `Int16Array`) e só é preenchido com o Tab
    apertado.
  - O feed usa os nomes e as cores do time (no FFA, a sua cor de jogador).
- **Conferido** no Edge headless (`local/m2/capturar-partida.ts`): contagem, relógio 10:00 → 9:38, feed,
  marcadores e o placar no Tab.

### 12.11 Fase 2e: pausa e resultado (09/11/2026)

- **Sinais da cena (mudança de contrato do `game`):** `SceneSignal` ganhou `again`, `easier` e `harder`.
  `SceneRequest.level` (opcional, padrão `normal`) é o nível rápido dos bots do JOGAR, e `Scene.level` é o de
  agora. O núcleo (`game.ts`) guarda `playLevel`, dá `stepLevel` (−1 / +1, sem passar das pontas) e recarrega o
  JOGAR com semente nova; a cena carrega o Construto de novo. Recomeçar sem recarregar fica para a rodada de
  otimização.
- **IA (mudança de contrato do ai):** `BotDirector.setLevel(level, team)` (team -1 = todos) e
  `SoldierBrain.setLevel` recalculam habilidade, reação, giro e erro de mira no meio da partida. O "Ajustar
  desafio" muda o time adversário (o 1 no TDM; todos no FFA) e deixa os aliados como estão (escolha revisável).
- **Pausa** (`game/src/pause.ts`): `pauseScreen` com 5 botões e `challengeScreen` (os 5 níveis, o atual em foco);
  "Ajustes" reaproveita o `settingsScreen`. "Destravar" liga `BUTTON.unstuck` no frame do humano por um tick
  (`writeHumanFrame`) e continua. Ao continuar, a pausa volta à página principal.
- **Resultado:**
  - `scene/result.ts`, puro: `MatchStats` sai dos eventos (um tiro e um acerto por tick por bobo, para a escopeta e
    o foguete contarem um; sequência; quedas; abates no humano e do humano). `summarizeMatch` calcula o resultado,
    o MVP (abates + ½ assistência; empate: menos mortes), o Nêmesis, o Freguês, os 3 números, até 3 prêmios (um por
    bobo, na ordem de `PRIZES`) e `uglyLoss`.
  - `game/src/result-screen.ts`: a árvore de menu, navegável no D-pad, com toque e mouse.
  - O `match.ts` mostra o resultado 2,5 s depois do evento `matchPhase: ended`. Enquanto ele está na tela, a HUD
    sai, o jogador não anda, a pausa não abre e o pointer lock é solto.
- **Gancho dos prints:** `GameDebugApi.showResult()` abre o resultado com os números do momento. Serve para os
  prints e para conferir sem esperar 10 min.
- **Conferido** no Edge headless (`local/m2/capturar-pausa.ts`): pausa, desafio e resultado a 1280×720 e a 667×375.
- **Pendência:** o teste do mapc "fila e close do boneco" falhou 2 vezes em 6 rodadas do portão inteiro, com
  `r.errors` não vazio, e passa sozinho. A mensagem da falha não foi guardada. Hipótese: falta de CPU no laço do A*
  dirigido. Investigar na próxima falha (o log do portão fica em `local/m2/check-*.log`).

### 12.12 Fase 3a: o `bot@1` (09/11/2026)

- **`format/src/bot.ts`** (novo; contrato do format):
  - `BotDocument` com `skill` (§6.2, mais `triggerHold` e `targetSwitchS`), `intelligence` (nível e os 8
    comportamentos do "modo avançado"), `personality` (preset e pesos) e `rules` (§6.5: vida, dano, velocidade,
    munição, armas, imunidade a tiro de cabeça, explodir ao morrer, visão, audição e conhecimento). O `look` passa
    como veio.
  - `LEVEL_SKILLS`, `intelligenceForLevel` (cumulativo), `PERSONALITY_PRESETS`, `LEVEL_PERSONALITY_MIX` com
    `personalityForRoll`, `BUILTIN_BOTS` (os 12) e `resolveBot` (de fábrica, embutido, ou o Normal Bob).
  - `validateBot` só recusa o que não é bot; limita e avisa (`bot.valueClamped`, `bot.invalidField`, com texto
    `issue.bot.*`).
  - Para não haver ciclo na inicialização, `bot.ts` só importa TIPOS da receita (`LEVEL_ORDER` repete
    `BOT_LEVELS`, e o teste confere).
- **Receita:** `MatchRecipe.embeddedBots` (validados; os que não são bot caem com `content.missingBot`). Ids novos
  `bot:jorge-the-immortal`, `camper-carl`, `knife-ninja`, `scaredy-sam`, `hunter-hank`, `buddy` e
  `goofy-gus` (só acrescentados).
- **IA:**
  - O diretor resolve cada ref (`resolveBot`), e o `SoldierBrain` recebe o documento: `intelligence`,
    `personality`, `rules` e a habilidade convertida (`aimSkillFromBot`).
  - Os bots de nível sorteiam a personalidade num fluxo próprio (`fork('personality', i)`), sem mexer no RNG do
    cérebro: o golden não mudou.
  - `setLevel` troca a habilidade e a inteligência do nível e mantém a personalidade e as regras.
  - `levelSkillsMatch` confere que a tabela do format e a `BOT_SKILLS` são iguais.
- **`game`:** os nomes dos bots de fábrica saem de `bot.name.<id>`; os embutidos usam o nome do documento.

### 12.13 Fase 3b: regras por bot na sim (09/11/2026)

- **`SimContext.rules` (`EntityRules`, contrato interno da sim):** `maxHp`, `damageMult`, `speed`, `ammo`
  (`AMMO_RULE`), `weaponMask` (bit = código da arma; 0 = todas) e `flags` (`RULE_FLAG`: imune a tiro de cabeça,
  explode ao morrer), uma por índice de entidade.
  - O `createSim` monta as tabelas a partir de `resolveBot`. Como saem da receita, ficam fora do snapshot e do hash.
  - A vida do bot só troca a da partida quando a regra muda o padrão (100).
- **Onde cada regra age:**
  - `damageSystem` multiplica pelo `damageMult` de quem atacou.
  - `respawn` usa a `maxHp`, filtra o loadout pela máscara (a primária vira a 1ª permitida) e põe a mão no 1º slot
    que sobrou.
  - A regeneração vai até a `maxHp`.
  - `kill` faz a explosão do foguete no peito quando a regra pede (fora do plano de morte).
  - `weaponSystem` cai no 1º slot usável e enche o pente ou a reserva a cada tick, conforme a regra.
  - `rayDamage` dá o dano do tronco na cabeça de quem é imune.
  - `movementSystem` multiplica a velocidade-alvo.
- **Fica para depois:**
  - O tamanho (pede hitbox e navegação).
  - O colete, a regeneração por bot, as vidas e o "chefão".
  - Visão, audição e conhecimento são da IA (3c em diante).
  - A IA ainda não sabe lidar com loadout restrito (o Knife Ninja só tem faca): é da 3g.

### 12.14 Fase 3c: N1 da IA (09/11/2026)

- **sim:** `SimView.lastAttacker` (o array que já existia): quem causou o último dano. Sem mudança de estado.
- **`ai/src/tactics.ts`** (novo):
  - `onDamaged` vira para de onde veio o dano, em qualquer nível. Com `useCover`, tira a chance pela
    personalidade: `AI_COVER.baseChance + cautionWeight·cautela − aggressionWeight·agressividade`, mais um bônus
    com a vida baixa.
  - `seekCover` amostra até 8 nós da navegação a 3–9 m, para o lado oposto da ameaça (±75°), alcançáveis, e de onde
    o olho da ameaça não vê o olho do bot agachado. Usa `AiContext.clearLine`, um raio do orçamento por tentativa.
  - `updateCover` passa de "indo" a "segurando" ao chegar, por 1,2 s mais até 2,5 s pela paciência, e desiste em 5 s.
    Depois, 4 s de espera até a próxima.
- **Soldado:**
  - Indo para a cobertura, o `travel` usa ela como objetivo, e o bot só troca tiro se o alvo estiver a menos de 5 m.
  - Segurando com alvo à vista, atira agachado e sem strafe. Sem alvo, fica agachado, olha para a ameaça e recarrega
    (`holdCover`).
  - Com o pente vazio e reserva no meio do tiroteio, procura cobertura do alvo.
  - Patrulha (N1+): sem pista do inimigo, olha ±40° de tempos em tempos (`AI_PATROL`).
- O "investigar sons" já existia desde o M1 (a audição leva até de onde veio o barulho).

### 12.15 Fase 3d: N2 da IA (09/11/2026)

- **`ai/src/tactics2.ts`** (novo):
  - `onTargetLost` roda quando o alvo some de vista. Sorteia segurar o ângulo (`AI_HOLD`, pela paciência e pela
    agressividade) e o flanco (`AI_FLANK`: um nó 4 m atrás da última posição do inimigo e 10 m para um lado,
    alcançável; desiste em 8 s).
  - `holdAngle`: parado mirando o peito de onde o alvo sumiu, agachado se for cauteloso.
  - `maybeStartGrenade` e `stepGrenade` (`AI_GRENADE`): com granada no slot e o inimigo sumido há até 4 s a
    7–25 m, sorteia pelo `skill.grenadeUse`, no máximo a cada 1,5 s. O arremesso troca de arma, mira o arco baixo
    (`throwPitch`, com a velocidade, a gravidade e o `GRENADE_THROW.lift` da sim), cozinha o pavio menos o voo e
    0,4 s (até 1,2 s), solta e volta para a primária. O bot fica parado. Espera 8 s para a próxima.
  - `retreatBelow`: limite da vida para recuar (`AI_RETREAT`).
- **Cobertura (`tactics.ts`):** `seekCover(…, retreat)` usa 8–16 m no recuo. O `updateCover` sai do recuo quando
  a vida volta a 80%, ou em 8 s.
- **sim:** `GRENADE_THROW` (`lift` e `inherit`) saiu do sistema de armas para a config, para a IA usar o mesmo.
- **Ordem no soldado:** granada em andamento → indo para a cobertura → combate (recuo com a vida baixa, cobertura
  para recarregar) → segurando a cobertura → segurando o ângulo → decide a granada → caça e passeio (com o flanco antes
  da última posição).
- O `SoldierBrain.grenadeUse` vem do bot e do `setLevel`.
- O golden passou a contar as granadas dos bots.

### 12.16 Fases 3e e 3f: N3 e N4 da IA (09/11/2026)

- **`ai/src/team.ts`** (novo): `TeamBoard`, criado pelo diretor no 1º tick com o tamanho do mapa e atualizado antes
  dos cérebros. Lê só a `SimView`.
  - **Avisos:** anel de 16 (posição, tick, time). Funções `post` e `freshest`.
  - **Objetivos de passeio:** um por entidade.
  - **Calor, por time em células de 4 m** (`AI_TEAM`):
    - os humanos inimigos somam 1 por segundo onde estão e 5 por abate onde estavam ao matar (`kills` que sobem);
    - o perigo soma 3 onde um bobo do time morreu (`deaths` que sobem);
    - meia-vida de 60 s (a memória cai a ~¼ em 2 min);
    - funções `hottest` (a célula mais quente numa faixa de distância) e `dangerAt`.
- **N3** (`intelligence.callouts`):
  - Avisa o time a cada 1 s enquanto vê um inimigo.
  - Sem pista, vai atrás do aviso mais novo, com até 3 s e a até 60 m (cada aviso uma vez).
  - O passeio segue o objetivo do líder: o aliado de controlador menor mais perto, a até 25 m, com objetivo de até
    10 s, com ±3 m de folga.
  - No cerco, o flanco ganha +0,3 de chance, e o lado sai da paridade do índice do bot.
- **N4** (`intelligence.learn`):
  - O passeio vai para a célula mais quente a 12–60 m (metade das vezes) e evita nó com perigo ≥ 2,5.
  - Pré-mira a célula mais quente a 8–40 m no lugar do olhar em volta, se estiver a menos de 90° do caminho.
  - Sem pista, joga granada na célula quente a 7–25 m (metade da chance de granada).
  - Com mais de 70% de vida ao trocar tiro, tem 15% de chance (a cada 10 s) de ir para a cobertura sem precisar,
    para fingir recuar e emboscar.
- **Diretor (mudança de contrato do ai):** `BotDirector.pings(team, maxAgeTicks, out)` entrega os avisos.
  `HudModel.pings` e `pingCount` (mudança de contrato do ui) desenham o losango âmbar na vista do humano, por 2,5 s.
- **Fica para depois:** a emboscada em pontos marcados do mapa (o Construto não tem marcadores de emboscada; entra
  com os mapas novos).

### 12.17 Fase 3g: personalidades e bots de fábrica (09/11/2026)

- **`ai/src/persona.ts`** (novo): o comportamento visível das 10 personalidades (§6.4), com os números em
  `AI_PERSONA`. Os pesos (agressividade, cautela, paciência) já mexiam nas chances do N1 e do N2. Ganchos no soldado:
  - `personaTick`: abates novos, o foco e a guarda do Suporte;
  - `personaOnDamaged`: para a dancinha, tira o Camper do ponto, acorda ou começa o "fingir de morto";
  - `personaOverride`: fingir de morto e dancinha tomam o tick;
  - `personaApproach` e `personaRetreat`: as distâncias do combate;
  - `personaCombat`: o jeito de trocar tiro;
  - `personaGoal`: o objetivo de passeio;
  - `personaHold`: parado por escolha;
  - `personaTravel`: pulinhos e Lunático andando.
- **Cada personalidade:**
  - **Rusher:** corre (sem atirar) até 6 m além da distância dele, depois atira andando e pula a cada 0,7–1,6 s.
  - **Lunático:** troca de intenção a cada 2–5 s (avança pulando, roda pulando, recua, atira 65° pro alto por 0,8 s).
    Cada troca sorteia a distância dele (2–35 m).
  - **Covarde:**
    - recua abaixo de 17,5 m;
    - o recuo do N2 começa com 60% de vida e manda um aviso do time na posição dele (o losango da HUD; os aliados N3
      vão ajudar);
    - abaixo de 40% de vida, uma vez por vida e com 35% de chance, finge de morto por 4 s (agachado, parado, olhando o
      chão) até tomar dano de novo.
  - **Camper:**
    - escolhe o nó mais alto entre 10 sorteados a 8–50 m (o N4 desconta o perigo) e fica lá por 20 s + 40 s ×
      paciência;
    - fica agachado, olhando para a célula mais quente dos humanos (ou o meio da área) com uma varredura de ±35°, e
      vira para o que ouviu;
    - sai depois de 2 abates, ao tomar dano ou no fim do tempo, e tenta outro ponto 5 s depois;
    - no ponto, troca tiro sem sair dele.
  - **Estrategista** (N2+): +0,35 na chance de flanquear e anda com o líder como a dupla do N3.
  - **Kamikaze:**
    - nunca recua e chega a 0 m;
    - persegue o humano mais perto;
    - com granada, a 3 m do alvo troca para ela e segura o gatilho até estourar na mão (a sim só cozinha na borda do
      gatilho, então ele solta um tick antes).
  - **Caçador:**
    - a presa é o humano com mais abates (refeita a cada 10 s);
    - a percepção procura a presa antes dos outros e troca de alvo assim que a vê;
    - sem pista, vai até ela.
  - **Suporte:**
    - segue o humano aliado mais perto (para 3 m atrás dele) e, a até 6 m, fica vigiando as costas dele;
    - quando o humano toma dano, vai atrás de quem atirou.
  - **Palhaço:** dancinha de 2 s depois do abate (gira a 540°/s, agacha, pula), que só o dano interrompe.
  - **Todos:** pulinhos andando, com chance de bobeira × 0,4 por segundo.
- **Perseguição com conhecimento:** a do Kamikaze e a do Caçador sabe onde a presa está, com erro de ±6 m refeito a
  cada 4 s. É o comportamento declarado no card ("persegue pelo mapa"), não uma regra escondida.
- **Distância preferida:** é relativa à do Equilibrado (20 m), que usa a de cada arma (fase 1d), e só encurta. O
  Rusher chega a 30% dela, o Caçador, o Suporte e o Palhaço a 75%. Alongar para o Camper (×2) e o Estrategista
  (×1,25) esfriava o combate. Média de 8 sementes do golden, por minuto:

  | Variante | Abates | Tiros |
  |---|---|---|
  | Alongando | 13,6 | 225 |
  | Só encurtando (a escolhida) | 14,8 | 238 |
  | Sem personalidade | 15,4 | 256 |

- **Loadout restrito (soldado):**
  - `chooseSlot` só troca para a faca se ela existe; sem pistola nem faca, fica na primária;
  - `canFire` deixa a sniper atirar de perto quando não há outra arma (o Carl);
  - o foguete continua sem atirar colado, menos no Kamikaze.
- **Bots de fábrica no JOGAR (mudança de contrato do game):**
  - `SceneRequest.squad` e `GameDeps.playSquad` (`PlaySquad`: `levels` | `factory`);
  - o `factory` põe Jorge, Carl, Ninja, Sam, Hank e Gus contra o jogador e o Buddy no time dele (o resto, nível
    rápido);
  - a web liga com `?bots=fabrica` (`apps/web/src/play-squad.ts`), até a Partida personalizada da fase 4.
- **Golden:** `5ee925a0`. A semente 42 sorteou um minuto mais parado (11 abates e 87 tiros), então o piso de tiros
  do teste caiu de 100 para 60.
- **Teste do clarão por vista** (`game.test`): roda até o primeiro tiro de um dos bots das vistas (até 60 s), em vez
  de 15 s fixos, porque o momento do tiro depende do sorteio das personalidades.
- **Fica para depois:**
  - o Suporte reviver e dividir munição (o caído é do M3);
  - o Estrategista priorizar o objetivo (os modos com objetivo são do M3);
  - o Covarde fingir de morto deitado (não há pose deitada).

### 12.18 Fase 3h: assistência de mira (09/11/2026)

- **`game/src/scene/aim-assist.ts`** (novo, sem alocação). Calculada no cliente, sobre o estado interpolado, antes
  do `InputFrame` (tecnico.md §10):
  - `findAimAssist` escolhe o alvo: o inimigo vivo mais perto do centro da tela, dentro do cone, até o alcance de
    visão e com a linha de visão livre;
  - o cone é `atan(1,1 m / distância)`, entre 2° e 10°, em volta do meio do tronco (1,15 m; agachado, 0,8 m);
  - no máximo 3 raios DDA por quadro, dos candidatos mais centrais;
  - a fricção é `1 − nível × (1 − erro/cone)`;
  - `pullAim` é o ímã: `nível × 2,5 × dt` do erro por quadro, só com o jogador mexendo a mira ou andando.
- **Na cena** (`match.ts`, só o humano 0):
  - `aimAssistBefore` dá a fricção como `aimScale` do `InputMapper.update` (o contrato do input já tinha o
    parâmetro);
  - `aimAssistAfter` puxa a mira com `setAngles`; no Forte (nível ≥ 0,6), o ADS apertado trava no alvo;
  - o nível vem do perfil do dispositivo (`ControlProfile.aimAssist`): mouse 0, controle e toque Médio (0,4).
- **Determinismo:** o `InputFrame` grava os ângulos já assistidos, então replay e sim não mudam. O golden não tem
  humanos: `5ee925a0` igual. O balance segue em ordem.
- **Fica para a fase 4 (menus e dados):**
  - escolher o nível (Desligada, Leve, Média, Forte) nos Ajustes (`settings@1`);
  - a regra da partida que desliga a assistência (`preset@1`, bloco de armas).

### 12.19 Fecho da fase 3: regras à vista, avisos e `?nivel=` (09/11/2026)

- **Regras ativas à vista** (GDD §6.5: "toda regra ativa aparece no card do bot, no placar e na tela de morte"):
  - `game/src/scene/death.ts`: `rulesText(BotRules)` e `controllerRules(recipe, humans)` montam o texto uma vez
    por partida ("500 de vida · só escopeta"; textos `rule.*`, categoria da arma em minúscula, menos siglas);
  - só as regras que a sim aplica (vida, dano, velocidade, armas, munição, imune a tiro na cabeça, explode ao morrer);
    visão, audição e conhecimento ainda não agem e não aparecem;
  - **mudanças de contrato do ui:**
    - `HudModel.deathRules`: uma linha baixa na faixa de morte, embaixo de quem matou;
    - `ScoreboardModel.ruleLines`, `ruleTeam` e `ruleCount`: um bot diferente por linha, numa placa embaixo da
      tabela do time dele;
  - numa tela pequena com o placar cheio (640×360 com 6 por time), as linhas que não cabem saem, e a tela de morte
    continua mostrando as regras de quem matou;
  - o card do bot fica para a Oficina (fase 4).
- **Avisos do time na HUD:** avisos a menos de 4% da altura da vista um do outro viram um losango só
  (`PING_MERGE_FRAC`). Nos prints, 3 bots avisando o mesmo inimigo empilhavam 3 losangos.
- **`?nivel=`** (`apps/web/src/play-squad.ts`, `GameDeps.playLevel`): o nível do primeiro JOGAR, pelo nome da
  interface ou pelo id (`pela-vibe`, `de-boa`, `normal`, `suado`, `tryhard`), até os menus da fase 4. Os prints
  do aviso do time usam `?nivel=suado` (aliados N3).

### 12.20 Fase 4a: peças de UI dos menus (09/11/2026)

- **Mudanças de contrato do ui (árvore, layout e navegação):**
  - `ButtonNode.value` (e `valueWidth`) faz a linha de opção: rótulo à esquerda, valor entre setas de pixel-art
    à direita (`OPTION` nos tokens);
  - `ButtonVariant 'tab'` com `selected`;
  - `StackNode.scroll` faz a coluna com rolagem (com `height` e `id`).
- **`MenuNavigation`:**
  - `delta`: -1 ou +1 numa linha de opção, por esquerda e direita ou pelas setas no toque e no mouse
    (`hitOptionArrow`); 0 no confirmar comum (a tela decide se inverte ou avança);
  - `tab`: -1 ou +1, de `tabPrev` e `tabNext`.
- **Rolagem:**
  - `LayoutOptions.focusedId` e `scrollState` (por id): o layout mexe a janela o mínimo para o foco ficar à vista,
    com a folga do anel;
  - os filhos ganham o recorte da janela (`LayoutResult.clips`); o `drawTree` emite `pushClip`/`popClip`, e o
    `hitTest` ignora o que está fora;
  - `LayoutResult.scrolls` alimenta a barrinha.
- **Controlador de menus (`game/menu.ts`):**
  - trata `tabPrev` e `tabNext`;
  - guarda o `scrollState` entre telas;
  - refaz o layout quando o foco muda numa tela com rolagem.
- **Tamanho:** o menu passou para 305,3 KB (meta 300 KB, teto 350 KB). As telas da fase 4 precisam ser enxutas.

### 12.21 Fase 4b: dados e save (09/11/2026)

- **`format`** (puro, sem relógio):
  - `doc-read.ts`: o `DocReader`, a leitura tolerante dos documentos do jogador (falta → padrão; tipo errado →
    padrão com `save.invalidField`; fora da faixa → limite com `save.valueClamped`);
  - `settings.ts`: `settings@1` com os controles por `ControlDevice` (sensibilidade e ADS como multiplicadores,
    Y invertido, assistência por nome, alternâncias, zonas mortas e as trocas de botão em texto, como
    `"key:KeyQ"`), o vídeo (qualidade, escala da UI, FOV, em que `0` é o padrão) e a acessibilidade;
  - `stats.ts`: `stats@1` com os totais, os recordes (mais abates, maior sequência) e o onboarding (dicas vistas,
    última Novidades vista);
  - `backup.ts`: a `PresetLibrary` e o `backup@1`. O backup traz `createdAt`, que o `game` passa. Cada parte
    vale sozinha: o que não passa sai com `save.droppedEntry`.
  - Os 3 códigos novos estão em `ISSUE_CODES`, com textos `issue.save.*`.
- **`game/save-store.ts`** (`SaveStore`):
  - uma chave por parte: `settings`, `stats`, `presets`, `bots`;
  - lê na criação, com validação, migração e os avisos em `loadWarnings` (vão para o log);
  - escreve pelo `Storage`, que tem debounce e guarda a versão anterior;
  - `pushRecent` não repete o mesmo jeito de partida (ignora nome e semente);
  - `savePreset` substitui pelo nome e respeita o teto da plataforma (`libraryCapsFor`: 200/500 na web, 50/100 no
    Switch); `setFavorite` aceita até 6;
  - `exportBackup`, `readBackup` e `applyBackup` (M9: em `game/save-backup.ts`, no pedaço dos editores): juntar soma os presets salvos e os bots (renomeando os repetidos)
    e mantém os ajustes daqui; substituir troca tudo.
  - Os presets guardados são validados com os tetos do motor; o corte ao aparelho é na hora de jogar.
- **Mudança de contrato do game:** `GameHandle.save`.
- **Tamanho:** o menu foi a 308,9 KB (+3,6 KB: os validadores e o save entram na carga do menu).

### 12.22 Fase 4c: título, menu principal e partida de estreia (09/11/2026)

- **`format/presets.ts`:**
  - `DEBUT_PRESET`: TDM 4v4 De boa, 300 s ou 30 abates;
  - `presetLevel`: o nível dos bots de nível do lado adversário;
  - `withPresetLevel`: troca todos os bots de nível; especiais e embutidos ficam;
  - `presetBotCounts`.
- **Mudanças de contrato:**
  - `SceneRequest.recipe` (game): a cena joga o preset com a semente do pedido, cortado ao aparelho pelo validador;
    `level` e `squad` só valem sem ele;
  - `TITLE_ACTION` (ui): `settings` saiu; entraram `surprise` e `change`. `TitleState.playSummary` é a linha
    embaixo do JOGAR;
  - `MenuController.focus` (game).
- **Telas novas (ui):**
  - `mainMenuScreen`: a lista de itens vem do `game` (por enquanto, Ajustes; `quickMatch`, `modes` e `news` já
    têm ação);
  - `surpriseScreen`: as linhas do sorteio, Jogar, Rolar de novo e Voltar.
- **`game/presets-ui.ts`:**
  - `presetSummary` e `presetLines`, pela tabela (`mode.short.*`, `map.*`, `summary.*`);
  - `rollSurprise`: TDM 70% (3 a 6 por lado) ou FFA (5 a 9 bots), um dos 5 níveis, 5 ou 10 min com a meta de abates
    do modo, sempre no teto do celular.
- **`game.ts`:**
  - telas `main` e `surprise`;
  - `play()` usa o último preset, ou a estreia; `playPreset` grava o preset nos últimos (sem a semente);
  - os sinais do resultado aplicam `withPresetLevel`;
  - os Ajustes voltam para o menu principal;
  - de volta da partida, o foco vai para o JOGAR;
  - com `?bots=fabrica` ou `?nivel=`, o JOGAR monta a partida do jeito antigo até a 4e.
- **Tamanho:** o menu foi a 311,6 KB (+2,7 KB).

### 12.23 Fase 4d: Partida Rápida e Modos (09/11/2026)

- **`game/quick-match.ts`** (puro):
  - `QuickSettings`: modo, mapa, nível, tamanho e minutos;
  - `quickFromPreset` e `quickToPreset`: TDM com o tamanho por lado (você conta no seu) e FFA com o número de bots;
  - `stepQuick`: modo, mapa e duração dão a volta; nível e tamanho param nas pontas; o tamanho para no teto
    (`sizeRange`); trocar o modo mantém a quantidade de bobos;
  - `scoreFor`: a meta de abates por duração (TDM 3/5/10/15/20 min = 20/30/75/100/125; FFA 10/15/25/30/40; sem
    limite, a de 10 min);
  - `factoryPresets`: Vibe, Tryhard e Imortais (6 Jorges; era "Sexta do Jorge" até a rodada 8, D2), com o nome da tabela (`preset.name.*`).
- **`game/presets-ui.ts`:** `presetShortcut` (rótulo curto, "4×4 De boa" ou o nome, e a linha "Times · 5 min ou 30
  abates"; o mapa entra na linha quando houver mais de um).
- **Telas novas (ui):**
  - `quickMatchScreen`: `QUICK_ROWS` em linhas de opção; COMEÇAR e Voltar fixos embaixo à direita (arte-ux.md §6.3);
    os atalhos numa coluna com rolagem, com ação `preset:<grupo>:<índice>`;
  - `modesScreen`: cards com ação `mode:<id>`.
- **`game.ts`:** telas `quick` e `modes`; o teto de bots é o do perfil com 1 jogador
  (`selectPlatformProfile(profileHint, 1)`); a Partida Rápida abre com o foco no COMEÇAR.
- **Mudanças de contrato (ui):**
  - `OPTION.valueWidth` foi de 260 para 320;
  - o `layout` arredonda para cima a largura do botão medido pelo texto.
- **Teste de estouro com o atlas real (`fonts-in-use.test`):** entende a linha de opção (rótulo e valor em áreas
  separadas) e os itens recortados da coluna com rolagem, e cobre o menu principal, a Partida Rápida, os Modos e o
  Surpreenda-me nos 6 alvos e no Switch.
- **Tamanho:** o menu foi a 313,6 KB (+2,0 KB).

### 12.24 Fase 4e, parte 1: regras da partida no preset e na sim (09/11/2026)

- **`preset@1` (format):**
  - `PlayerRules` ganha `regen` (`REGEN_RULES`), `spawnProtectionS` (0 a 5), `gravity` (0,25 a 2) e
    `fallDamage`;
  - `WeaponRules`: `damageMul` (0,25 a 5), `headshotOnly`, `oneShot`, `ammo` (`AMMO_MODES`), `ads`, `recoil`,
    `spread`, `friendlyFire` (0, 0,5 ou 1), `selfDamage`, `sniperBodyKill`, `allowed` (ids de arma conhecidos;
    o desconhecido sai com `content.missingWeapon`) e `aimAssist`;
  - `HudRules`: `killFeed`, `hitmarker`, `allyMarkers`;
  - tudo validado no padrão do `players` (limite com `recipe.valueClamped`, tipo errado com
    `recipe.invalidField`).
- **sim:**
  - `MatchMods` no contexto e na vista (`SimView.mods`), com `DEFAULT_MATCH_MODS`, fora do estado e do hash;
  - `canHurt` (inimigo, ou aliado com fogo amigo) nos filtros de alvo da bala, da faca e da explosão; o
    `damageSystem` aplica `damageMul`, o fogo amigo e o "um tiro mata"; o abate só conta com `hostile`;
  - "só cabeça" e "sniper mata no corpo" ficam no `rayDamage`; sem ADS, `adsAmount` não sobe; sem espalhamento,
    `aimSpread` é 0; sem recuo, nada de `kickRecoil`; sem autodano, a própria explosão não fere;
  - a regeneração multiplica a padrão (0, ½, 1, 2); a proteção de spawn vem da receita;
  - o perfil de movimento escala a gravidade e divide a altura do pulo pelo mesmo fator (a velocidade do pulo fica);
  - munição e armas permitidas da partida valem para todos (com a regra do bot, a munição mais generosa e a
    interseção das armas).
- **ai:** a sniper não espera a mira cheia se a partida não tem ADS (`view.mods.ads`).
- **game (cena):** `hud.*` desliga o kill feed, o hitmarker e os marcadores dos aliados; `weapons.aimAssist` falso
  zera a assistência.

### 12.25 Fase 4e, parte 2: a tela da Partida personalizada (09/11/2026)

- **ui:**
  - `ButtonNode.compact`, com `TYPE.buttonCompact` e `BUTTON_COMPACT` (48 de altura, respiro 16, sem largura
    mínima): as 6 abas cabem numa fileira;
  - `customMatchScreen`: abas `tab:<i>`, linhas `row:<id>` numa coluna com rolagem (800 × 348), o resumo ou o
    aviso embaixo do título, e Voltar, Salvar preset e COMEÇAR embaixo à direita;
  - `moveFocus`: um item recortado fora da janela só é vizinho de quem está na mesma lista (no 640×360 com toque, o
    Voltar ficava inalcançável);
  - a Partida Rápida ganha "Mais regras" (`QUICK_ACTION.custom`) e as opções numa coluna com rolagem (348);
  - `result.presetSaved`.
- **`game/custom-match.ts`** (puro):
  - `CUSTOM_TABS` e `customRows(tab, recipe)`: cada linha tem o valor em texto e um passo;
  - `stepCustom`;
  - `CUSTOM_BOTS`: os 5 níveis e os 7 especiais, um bot por time, com a quantidade limitada ao teto do aparelho;
  - TDM ↔ FFA mantém a quantidade de bots;
  - a visão para no teto do perfil;
  - `presetName`: nome do gerador; se já existe, " 2", " 3"…
- **game:**
  - tela `custom`: `openCustom(recipe, back)` e `saveCustomPreset`;
  - `SceneSignal` ganha `rules` (Mudar regras abre a personalizada com o preset da partida) e `save` (o `game`
    salva; a cena troca o botão por "Preset salvo");
  - os sinais do resultado sempre partem de um preset.
- **Saem os parâmetros de desenvolvimento:** `GameDeps.playSquad` e `playLevel`, `SceneRequest.squad`,
  `PlaySquad`, o esquadrão de fábrica da cena e o `apps/web/src/play-squad.ts`.
- **Teste de estouro (`fonts-in-use`):** a Partida personalizada nos 6 alvos e no Switch; a fileira do canto não pode
  encostar nas listas; o alcance pelo D-pad (`reachableScrolling`) refaz o layout a cada foco, com a rolagem.
- **Tamanho:** o menu foi a 317,4 KB (+3,8 KB).

### 12.26 Fase 4f, parte 1: Ajustes (09/11/2026)

- **ui:**
  - `tabbed.ts`: o molde das telas com abas (`buildTabbed`, `TabbedRow` de opção, ação ou texto, `tab:<i>` e
    `row:<id>`, coluna 800 × 348); a Partida personalizada e os Ajustes usam o mesmo;
  - `settingsScreen` recebe o estado (abas, aba, linhas, aviso), em vez de montar uma tela fixa;
  - as strings `settings.*`.
- **`game/settings-menu.ts`** (puro):
  - `SETTINGS_TABS` (5) e `PAUSE_SETTINGS_TABS` (Controles, Vídeo e Acessibilidade);
  - `settingsRows(tab, doc, device)` e `stepSettings`; os controles valem por dispositivo;
  - `applyControls(perfil, controles)`: as sensibilidades multiplicam a do perfil, a assistência vem de
    `AIM_ASSIST_LEVELS`, as zonas mortas só valem no controle.
- **game:**
  - tela `settings` (pelo menu principal), com Dados (exportar e importar o `backup@1`, juntar ou substituir) e Sobre
    (Copiar relatório, #42);
  - `followTab`: trocar de aba leva o foco de uma aba ou linha para a aba nova (antes caía na primeira aba);
  - o tamanho dos menus sai de `settings.video.uiScale`.
- **Contrato (integração):**
  - `SceneHost.settings` (`SceneSettings`: o documento atual e `save`): a cena monta os perfis com os controles
    salvos, usa o campo de visão e o tremor reduzido, e a pausa grava e aplica na hora;
  - `Platform.clipboard?` (opcional; a web usa `navigator.clipboard`; sem ele, "Copiar relatório" avisa que falhou);
  - `decodeUtf8` no `shared` (o Switch não tem `TextDecoder`), para ler o backup importado.
- **Ficam para depois:**
  - qualidade gráfica: o render fixa o `maxPixelRatio` ao nascer; entra com o item Web;
  - cores de time para daltônico e tamanho do HUD (fase 6);
  - volumes (fase 7);
  - remapeamento do teclado e do controle (parte 2).
- **Teste de estouro:** as 5 abas nos 6 alvos e no Switch, com alcance pelo D-pad.
- **Tamanho:** o menu foi a 320,6 KB (+3,2 KB; teto 350).

### 12.27 Fase 4f, parte 2: remapeamento (09/11/2026)

- **`input/remap.ts`** (puro):
  - texto de cada fonte no `settings@1`: `key:<code>`, `mouse:<botão>`, `wheel:up|down`, `pad:<posição>[:hold]`,
    `axis:<eixo>:+|-`, `touch:<controle>`; `encodeBinding` e `decodeBinding` (texto estranho vira `null`);
  - `REMAP_ACTIONS` por dispositivo; a pausa, o Destravar e os menus ficam de fora (regras 12 e 16);
  - `applyBindings(perfil, bindings)`: cada ação salva troca a lista inteira; fonte de outro dispositivo é ignorada;
  - `rebind`: a ação fica só com a fonte nova; quem a usava perde ela e, se ficar sem nada, recebe as antigas (troca);
    o save guarda só o que difere do padrão;
  - `isReservedSource`: a fonte é da pausa (recusada);
  - `createBindingCapture`: a próxima tecla, botão do mouse, roda ou botão do controle. O que estava apertado no
    começo só vale depois de solto; Esc ou + cancelam; depois do resultado, segue ativa até tudo ser solto (o menu não
    recebe a mesma tecla). Sem alocação por frame.
- **ui:**
  - `ButtonNode.valueOnly`: linha com valor só para ler (sem setas; esquerda e direita movem o foco);
  - `TabbedRow` `value`;
  - as strings `bind.*` (ações, teclas, mouse, controle por posição) e `settings.bind.*`; o "´" do ABNT2 virou "Tecla
    do acento" (o atlas está a 0,4 KB do teto de 120 KB).
- **game:**
  - aba `buttons` nos Ajustes e na pausa (`settingsRows`, `bindRowAction`, `bindingLabel`, `bindingsText`,
    `rebindSettings` com os avisos de troca, de ação sem botão, do Ctrl e da pausa);
  - `applyControls` aplica os botões salvos; na pausa, vale na hora (`applySettings`);
  - enquanto a captura está ativa, o menu (e a tecla de pausa) não anda.
- **Teste de estouro:** a aba Botões com todas as ações e todos os nomes nos 6 alvos e no Switch.
- **Tamanho:** o menu foi a 324,0 KB (+3,4 KB). Sobram 26 KB até o teto de 350; se a fase 4 apertar, as telas de
  Ajustes e da Partida personalizada podem ir para um chunk carregado sob demanda.

### 12.28 Fase 4g: estatísticas e Novidades (09/11/2026)

- **Contrato (integração):** `SceneHost.stats` (`SceneStats.record(MatchRecord) → RecordBreaks`). A cena entrega os números
  do jogador 1 quando o resultado abre no fim de verdade (`showResult(true)`); o gancho dos prints
  (`GameDebugApi.showResult`) e o bench não gravam.
- **Escolha (revisável):** em tela dividida, só o jogador 1 conta (o `stats@1` é do aparelho, não do jogador).
- **`game/stats.ts`** (puro):
  - `addMatch`: soma os totais com teto de 2 × 10⁹; recorde só depois da primeira partida e só acima de zero;
  - `statsLines` (aba Dados; M9: em `game/stats-lines.ts`) e `playTimeText`;
  - `newsOnBoot`: `show` quando já jogou (ou viu outra versão) e ainda não viu esta; `silent` na instalação nova (só
    marca); `markNewsSeen`;
  - `migratedCount`: os avisos `format.migrated` do carregamento do save.
- **`scene/result.ts`:** conta os ticks com acerto na cabeça (`heads`, um por tick, mesmo quando o primeiro chumbo do tick
  pegou no tronco); `MatchSummary` ganha mortes, assistências, tiros, acertos e cabeças.
- **ui:**
  - `newsScreen` e `NEWS_ITEMS` (os itens da versão atual na tabela, `news.item.1` a `news.item.5`);
  - o menu principal ganha Novidades. O respiro embaixo do título caiu de 40 para 28, porque com 4 itens passava 1,5 px
    no toque 640×360. Com o Laboratório e o Meu Bobo (fases 5 e 6), o menu vai precisar de outro arranjo (2 colunas ou
    rolagem).
- **Resultado:** `ResultScreenData.record` troca o título dos números (sem linha nova: a tela já está cheia no
  640×360).
- **Tamanho:** o menu foi a 325,4 KB (+1,4 KB).

### 12.29 Fase 4h: onboarding opcional (09/11/2026)

- **`scene/tips.ts`** (puro, sem alocação por frame):
  - `TIPS` com a ação de cada dica (`reload`, `ads`, `slide`, `sprint`) e `TIP_RULES`;
  - `createTips(ligadas, vistas)`, `stepTips(estado, sinais, dt, temTecla)` (devolve a dica que começou) e `tipAlpha`;
  - uma por vez; 4 s na tela (o último meio segundo some) e 3 s de folga;
  - prioridade: pente vazio, inimigo longe, correr, andar.
- **Escolha (revisável):** o design pede "correr perto de cobertura" para a dica do agachar; por ora basta correr 1,5 s.
  O "inimigo longe" usa o cone da assistência no nível 1 (só enquanto a dica do ADS espera).
- **Contrato (integração):** `SceneStats` ganha `current` (o `stats@1` atual) e `tipSeen(id)` (`markTipSeen`, com o teto de
  32 da lista).
- **Cena:** dicas só na partida de verdade, com 1 jogador, com "Dicas" ligado e com menos de 2 partidas terminadas no
  aparelho. O nome da tecla sai do perfil do dispositivo ativo (`bindingLabel`), refeito só quando a dica ou o
  dispositivo mudam.
- **ui:**
  - `HudModel.tipKey`, `tipText` e `tipAlpha`: plaquinha a 66% da altura da vista, com a tecla num contorno âmbar;
  - `rotateScreen` ("Gire o celular", um celular deitado feito de caixas);
  - no toque, o nome do botão é o do controle da tela ("Recarga").
- **game:**
  - celular (`profileHint` `mobile`) em retrato: o aviso cobre tudo, a cena pausa e nenhuma tela anda;
  - `checkMenuReady` sai do fim do frame para valer também por baixo do aviso. Sem isso, quem abria em retrato ficava
    no splash para sempre: o `onMenuReady` nunca vinha.
- **Fica para a fase 5:** a calibração da sensibilidade e o card do Laboratório.
- **Tamanho:** o menu foi a 325,7 KB (+0,3 KB).

### 12.30 Fase 4i: rodada 8 de prints (09/11/2026)

- `GameDebugApi.showResult(previewRecord?)`: nos prints, o título de recorde aparece sem gravar estatística (a prévia
  não passa pelo `SceneHost.stats`).
- As capturas saem dos scripts locais de `local/m2/` (`capturar-*.ts`, Edge headless sobre o `npm run dev`); a página é
  montada por `local/m2/montar-pagina-r8.mjs`.

### 12.31 Fase 5a: Oficina (09/11/2026)

- **format:** `PresetLibrary.botFavorites`: ids dos bots favoritos (de fábrica ou salvos), até 6.
  - **Escolha (revisável):** os favoritos ficam na biblioteca do jogador (a chave `presets` e o `backup@1`), e não no
    `bot@1`, que é compartilhável;
  - o id que sumiu só deixa de aparecer.
- **SaveStore:** `saveBot` (o mesmo id substitui; teto da plataforma), `deleteBot` (tira o favorito) e
  `setBotFavorite`.
- **`game/bot-card.ts`** (puro, no pedaço do menu):
  - `WEAPON_CATEGORY` (id da arma → categoria, conferido com a tabela da sim no teste, para não puxar a sim para o
    menu);
  - `rulesText` e `ruleTags`: saíram da tela de morte, que agora importa daqui;
  - `botDisplayName`, `isBuiltinBot`, `botLevelOf` e `botCardLines` (as regras em linhas de até 40 caracteres, porque o
    texto não quebra linha);
  - `newBotId` (6 dígitos hex) e `copyName`.
- **ui:**
  - `workshopScreen`: a lista (botões compactos, o escolhido em âmbar) e o card (coluna com rolagem, para o toque 640×360);
  - as ações em duas fileiras compactas;
  - `focusOverride`: da lista, a direita entra pela primeira ação; das ações da ponta, a esquerda volta ao escolhido;
  - o menu principal ganha `lab` e `MAIN_MENU_ITEMS_HEIGHT` (a coluna rola).
- **Achado:** o nome do card em caixa baixa na display virava "?" (o atlas da display só tem maiúsculas). Agora sai na
  fonte do HUD, e o teste de estouro confere todo texto desenhado contra a fonte usada.
- **Tamanho:** o menu foi a 328,2 KB (+2,5 KB; teto 350). O Laboratório (5b) deve levar o menu perto de 335: se passar,
  as telas de Ajustes, Partida personalizada e Laboratório vão para um pedaço sob demanda.

### 12.32 Fase 5b, parte 1: Laboratório (09/11/2026)

- **`game/lab.ts`** (puro):
  - `LAB_TABS` (5: Habilidade, Inteligência, Personalidade, Regras, Nome; com 6 abas a última passava 12 px no
    640×360, então o nível rápido virou a 1ª linha da Habilidade);
  - `labRows` e `stepLab` (listas dentro de `BOT_RANGES`);
  - `labSummary`, `rollBotName` (patente + comida, em inglês, como os de fábrica) e `cleanBotName` (só o que o atlas
    do HUD desenha).
- **ui:**
  - `labScreen` (o molde de abas com Voltar e Salvar);
  - `buildTabbed`: as abas têm `focusOverride.down` para a primeira linha.
- **game:**
  - tela `lab`;
  - a digitação do nome usa `platform.textInput`, e o menu não anda enquanto ela está aberta. Depois, espera soltar
    tudo (`anyInputHeld`), senão o Enter reabriria a digitação;
  - Editar um de fábrica cria uma cópia (`newBotId` e `copyName`); Salvar usa `saveBot`.
- **`bot-card`:** `ruleTags` ganha visão, alcance, audição e conhecimento (§6.5: toda regra ativa à vista).
- **Tamanho:** o menu foi a 331,7 KB (+3,5 KB). Sobram 18,3 KB até o teto de 350; o Meu Bobo (fase 6) deve pedir o
  pedaço sob demanda das telas de edição.

### 12.33 Fase 5b, parte 2: os bots da Oficina na Partida personalizada (09/11/2026)

- `CustomLimits.savedBots` (o `game` passa um getter: a Oficina muda enquanto a tela está aberta).
- A escolha do bot de cada time anda por: os de fábrica, os da Oficina e o embutido que já está no preset (mesmo que
  tenha saído da Oficina).
- `syncEmbedded`: o escolhido entra em `embeddedBots` e os que nenhum time usa saem (sem bloco vazio no preset).
- O nome do embutido aparece pelo documento, na linha e na partida (`controllerNames` já lia assim).

### 12.34 Fase 5c: Ringue (09/11/2026)

- **`assets-src/maps/ringue.ts`:**
  - grade de 48×20×48 m, área jogável de 6 a 42 m (36×36);
  - `meta.modes` = `warfare.tdm` e `training`;
  - 6 nascimentos por time e 16 sem time (para o treino);
  - câmeras `print:ringue` (de cima) e `print:baias`;
  - `.bfmap` de 2,4 KB (o do Construto tem 10,2 KB).
- **Escolhas (revisáveis):**
  - FFA fica fora: com 16 nascimentos numa arena de 36 m, a regra "nenhum nascimento vê outro" do `mapc` não fecha
    (o GDD §8.5 lista X1, Bobo Training e Testar);
  - teto de 7 bots (8 bobos);
  - a travessia de TDM é de 5,4 s, abaixo dos 12–18 s do GDD §4.6.3: fica só o aviso do `mapc`, porque é arena de
    duelo.
- **mapc:**
  - `MAP_IDS` ganha `ringue`;
  - os marcadores obrigatórios dos prints (câmeras, manequins, rota do bench) valem só para o Construto
    (`requirePrintMarkers: id === 'construto'`), que é o contrato do M1.
- **format:** `map:ringue` registrado e travado.
- **game:**
  - `MAP_ASSETS`;
  - o loader recebe o id do mapa (o nome "Construto" ficou do M1; ele carrega qualquer `map@1`);
  - `maps.ts`: `MAP_MODES`, conferido no teste com o `.bfmap` compilado, `mapsForMode`, `mapForMode`, `mapBotCap`
    e `mapName`;
  - a Partida Rápida e a personalizada usam esse módulo (`fitMap` corta os bots no teto do mapa).
- **Tamanho:** o menu foi a 332,2 KB (+0,5 KB).

### 12.35 Fase 5d: Bobo Training (09/11/2026)

- **format:**
  - personalidade `dummy` (Alvo), no fim de `PERSONALITIES` (os ids só crescem);
  - bots de fábrica `training-dummy` e `training-runner` (paciência 0), registrados e travados.
- **ai:** `personaOverride` do Alvo: não atira nem procura ninguém. Paciência ≥ 0,5 fica parado; abaixo disso, anda de
  lado e troca a cada `AI_PERSONA.dummyStrideS` (1,4 s).
- **sim:**
  - `isWarfareMode('training')` (regeneração e caixinha);
  - `SimContext.training`;
  - no treino, os bots fora do time 0 nascem nos pontos sem time, no começo (`initialSpawn`) e no respawn
    (`pickSpawn`, longe de qualquer bobo, para não empilhar);
  - tempo e meta zerados: a partida não termina.
- **Escolha (revisável):** o jogador nasce atrás do abrigo oeste do Ringue (os nascimentos do time 0) e sai para
  treinar.
- **game:**
  - `training.ts` (`trainingPreset`: Ringue, 2 alvos parados e 2 andando, respawn de 1 s, e os bots extras do
    Testar);
  - `playTraining` não vira o último preset (o JOGAR continua sendo a última partida);
  - `MatchStats.humanFirstHit` e `ttk`, e `trainingNumbers`;
  - a cena refaz `HudSharedModel.trainingLine` só quando os números mudam (`refreshTrainingLine`).
- **ui:**
  - `HudSharedModel.trainingLine`: a plaquinha do topo no lugar do placar;
  - o Modos em grade de 2 colunas.
- **Fica para depois:** a skin de treino dos alvos (bonecos de caixas, gameplay.md §7) e a estação "Calibrar mira"
  (5f).
- **Tamanho:** o menu foi a 332,6 KB (+0,4 KB).

### 12.36 Fase 5e: pontes do Laboratório (09/11/2026)

- **Contrato (integração):**
  - `SceneSignal` ganha `nemesis` (Salvar na Oficina) e `lab` (Abrir Laboratório);
  - `Scene.trainingReport()` devolve um `TrainingReport`: a precisão dos bots que não são Alvo, seus abates e mortes,
    e o TTK médio;
  - `Scene.nemesisBot()` devolve o `bot@1` de quem mais te matou, achado pelo controlador na receita.
- **Resultado:** `ResultScreenData.nemesisSaved` e `openLab` (no Tryhard o "Mais difícil" vira `RESULT_ACTION.lab`).
- **game:**
  - o Testar usa `labTesting`: o `leaveScene` lê o relatório antes do `dispose` e volta ao editor com o aviso;
  - `saveNemesis` grava uma cópia com id novo, com o nome dele ou "… 2";
  - `maybeLabIntro` só roda pelo Sair (De novo e as outras emendam outra partida). Ele marca `labCard` em
    `tipsSeen` ao abrir.
- **ui:** `labIntroScreen`; o Laboratório tem Voltar · Testar · Salvar.
- **Fica para depois:** no Pela vibe, o "Mais fácil" oferecendo "alvos maiores" e +1 aliado (gameplay.md §6.6).
- **Tamanho:** o menu foi a 333,2 KB (+0,6 KB).

### 12.37 Fase 5f: Calibrar mira (09/11/2026)

- **`scene/calibration.ts`** (puro, sem alocação por frame):
  - 3 alvos em direções fixas em relação ao olhar inicial (`CALIBRATION.targets`: [40°, 4°], [−55°, −6°], [85°, 8°]);
  - o acerto é o gatilho a menos de 2,5° do alvo;
  - **passou**: o erro ao longo da direção inicial fica negativo além de 2°;
  - **não chegou**: a 1ª parada (giro abaixo de 12°/s, depois de 0,15 s) acontece com mais de 25% do caminho ainda
    por fazer;
  - `calibrationFactor`: ×0,85 com 2 ou mais "passou"; ×1,2 com 2 ou mais "não chegou"; senão 1.
- **Escolhas (revisáveis):** os limites acima e os fatores ×0,85 e ×1,2. O ajuste multiplica a sensibilidade do
  dispositivo em uso, arredondado a 0,01 dentro de `SETTINGS_RANGES.sensitivity`.
- **Cena:**
  - no treino, `PauseState.calibrate` e `calibrating`;
  - os alvos são desenhados como losangos (o mesmo dos avisos do time), projetados a 10 m;
  - a linha do topo mostra "alvo N de 3";
  - no fim, a pausa abre `calibratedScreen` (OK e Desfazer);
  - `SceneRequest.calibrate` (o "Calibrar mira" dos Ajustes) começa a calibração quando a contagem termina.
- **Correção:** a pausa nascia com `pauseScreen.build(null)` (o estado padrão). Agora usa o estado da partida e é
  refeita ao abrir.
- **Fica para depois:** a calibração na contagem estendida da 1ª partida (§2.5); os prints dela entram na rodada 10.
- **Tamanho:** o menu foi a 333,6 KB.

### 12.38 Respostas das rodadas 8 e 9 (09/11/2026, decisões #68 e #69)

- **D2:** o preset pronto "Sexta do Jorge" virou **Imortais** (chave `preset.name.immortals`). O nome é escolha minha
  (revisável): curto como Vibe e Tryhard, e diz o que vem pela frente (6 Jorge the Immortal). O preset não tem id
  gravado (os prontos se refazem a cada boot), então nada migra.
- **D5:** em tela dividida, o `stats@1` soma **todos os jogadores locais** (`scene/result.ts`, `localMatchRecord`;
  os humanos são os controladores 0..humans−1). **Escolhas (revisáveis):**
  - abates, mortes, assistências, tiros, acertos e tiros na cabeça somam;
  - a partida conta 1 vez, com o tempo de jogo dela;
  - o resultado é o melhor dos locais (nos times é o mesmo para todos; no FFA, vitória se algum local venceu);
  - os **recordes são do melhor jogador**: `MatchRecord.bestKills` (o maior número de abates de um local) e
    `bestStreak`. Somar os abates de 2 jogadores num recorde de "abates numa partida" inflaria o número.

### 12.39 Fase 6a: perfis de movimento (09/11/2026)

- **`sim/config/movement.ts`:**
  - `MOVEMENT_TACTICAL` com os números da tabela (gameplay.md §3.3): andar 4,0, correr 5,5, agachado 2,0 m/s, pulo de
    0,8 m, escalada até 1,0 m, sem deslizar;
  - campos novos do perfil: `moveSpreadMul` (a "penalidade de precisão em movimento": multiplica a dispersão andando e
    no ar) e `landingKeep` (a fração da velocidade que sobra no pouso: "aterrissar freia");
  - `resolveMovementProfile(players)` troca o `matchProfile` da sim: Tático ou Bobo como base (o Arcade, do M6+, joga
    como Bobo); o Personalizado é o Bobo com `speed` (andar, correr, agachar, aceleração e deslize) e `jump`
    multiplicados; a gravidade e o dano de queda (fase 4e) valem para todos os perfis;
  - `MIN_JUMP_HEIGHT` = 0,55 m: com a borda de 0,5 m no ar, todo perfil alcança 1,0 m (§3.6), mesmo o Tático com
    gravidade 2×.
- **Escolhas (revisáveis):** no Tático, aceleração 45 m/s², controle no ar 0,2, voltar a atirar depois de correr em
  0,2 s, pouso com 60% da velocidade e dispersão em movimento ×1,4. As faixas do Personalizado são as do §3.4
  (velocidade 0,5–2×, pulo 0,5–3×).
- **Correção na escalada (vale para o Bobo):** "pulo + borda = altura de escalada" exato nunca subia, porque o ápice da
  parábola quase nunca cai num tick. O Bobo não subia os 1,5 m do design e o Tático não subia 1,0 m. A borda no ar
  ganhou 5 cm de folga (`MANTLE_SLACK`). O golden não mudou.
- **Formato:** `players.speed` e `players.jump` no `preset@1` (campos novos e opcionais, sem migração), limitados às
  faixas. Só valem com `movement: 'custom'`.
- **Partida personalizada:** a aba Jogadores começa com Movimento (Bobo, Tático, Personalizado); no Personalizado
  aparecem Velocidade e Pulo logo abaixo.
- **Correção:** o `t` arredonda número quebrado a 1 casa, e a Gravidade e o Dano mostravam ×0,25 como "×0,3". O `mult`
  da Partida personalizada agora escreve até 2 casas.
- **Bots:** a navegação liga saltos de até 1,0 m (`BOBO_NAV_METRICS`), que todo perfil alcança; os bots usam o mesmo
  perfil da partida (a sim aplica) e, no Tático, não deslizam.

### 12.40 Fase 6b: 3ª pessoa (09/11/2026)

- **`scene/third-person.ts`** (puro, sem alocação por frame):
  - `placeShoulderCamera`: a câmera fica 2,6 m atrás do olho, 0,7 m para o lado do ombro e 0,4 m acima;
  - o braço encurta na hora quando acerta parede (DDA na grade e nas props, com 0,25 m de folga) e volta a esticar a
    6 m/s;
  - `aimFromCamera`: o raio da câmera começa no plano do olho e para no cenário que segura bala ou na caixa de um bobo
    vivo. O tiro vai do olho até esse ponto. Com o ponto a menos de 1,5 m, segue o olhar da câmera.
- **A sim não muda.** A cena troca o yaw/pitch do quadro do humano (`writeHumanFrame`) pelos do olho até o ponto
  mirado. A câmera usa o ângulo do mapeador. Com o caminho do olho tapado, a bala acerta o que tapa (gameplay.md §3.5).
- **Vista:** o render já tinha `ViewDesc.thirdPerson` (mostra o corpo e esconde o viewmodel). Na cena:
  - na luneta (zoom ≥ 3×) volta a 1ª pessoa;
  - com o braço abaixo de 0,9 m (de costas para a parede), a câmera entraria na cabeça do bobo, então o frame sai em
    1ª pessoa;
  - o clarão do tiro do dono em 3ª pessoa sai da arma do boneco (`viewOfEntity` pula a vista).
- **Ajustes:** `video.view` (`first`, `third`) e `video.shoulder` (`right`, `left`) no `settings@1`, campos novos com
  padrão e sem migração. As linhas Câmera e Ombro ficam na aba Vídeo.
- **Na partida:** as ações locais novas `camera` e `shoulder` (no fim da lista) trocam a câmera e o ombro, e a troca é
  gravada nos Ajustes. Teclas padrão: T e X no teclado, direcional direita e esquerda no controle; dá para remapear.
- **Receita:** `players.camera` (`any`, `first`), a regra "Câmera permitida", na aba Jogadores (Livre, Só primeira
  pessoa).
- **Escolhas (revisáveis):** as medidas da câmera e o ombro direito como padrão.
- **Fica para depois:** a assistência de mira continua medindo do olho (a diferença para a câmera é pequena); o botão
  da 3ª pessoa no toque entra na 6e.

### 12.41 Fase 6c: Meu Bobo (09/11/2026)

- **`bobo@1`** (`format/bobo.ts`, tipo novo em `FORMAT_KINDS`): o look inteiro (`FigureLook`, o mesmo formato que pinta
  a skin) e o visual pronto de onde ele saiu.
  - O padrão é o Recruta (o look que o jogador 1 já usava).
  - O validador normaliza o look e nunca deixa zumbi; look estragado volta ao Recruta.
  - O `backup@1` ganhou a parte `bobo` (backup antigo sem ela usa o padrão). O SaveStore lê e grava a chave `bobo`.
- **Na partida:** `SceneHost.bobo`. O plano das skins ganhou o look `jogador`, logo depois do zumbi (nunca fica sem
  vaga), no time do jogador 1 (−1 no FFA). `resolveEntityFigure` veste o controlador 0 com ele.
- **O editor é uma cena** (`SceneKind` `wardrobe`, `scene/wardrobe.ts`), porque o bobo em 3D só existe no pacote da
  cena:
  - o Ringue sem ninguém, com um manequim no meio do tablado e uma câmera fixa (`wardrobeMap` acrescenta os dois ao
    documento do mapa);
  - o bobo fica no terço esquerdo, gira 20°/s sozinho e aparece sem arma;
  - cada mudança vale na hora e é gravada. `SceneFigures.restyle` refaz o gabarito no mesmo índice e solta a skin
    sob demanda do look editado (os gabaritos não crescem a cada mudança);
  - a cena pede só 1 look da rotação dos bots, para sobrar vaga para as skins sob demanda. Sob demanda vale também no
    Switch, só nesta cena;
  - `MannequinOverride.lookData` leva o look inteiro.
- **O modelo do editor** (`game/bobo-editor.ts`, puro; só a cena importa, fora do menu):
  - abas Pronto (visual pronto, prévia sem time/time 1/time 2, sortear), Rosto (pele, rosto, sobrancelha, barba,
    marca, olhos), Cabelo (corte, cor), Acessórios (na cabeça, óculos, brincos, cor) e Roupa (estampa, jaqueta, calça,
    colete, botas, luvas);
  - nomes e cores de rosto e cabelo do FutBobo, nas mesmas listas dos índices;
  - pele com 10 tons e as 4 cores fantasia do GDD; roupa com uma paleta militar de 12 cores; colete e luvas têm
    "nenhum";
  - "editado" quando o look sai do visual pronto; Aleatório sorteia um bobo inteiro (RNG com semente).
- **UI:**
  - `buildTabbed({ panel: true })`: sem o fundo cheio, com a coluna num cartão à direita e as linhas em 640 px, área
    do valor de 300;
  - `ButtonNode.swatch` desenha o quadradinho da cor antes do valor;
  - o menu principal ganhou "Meu Bobo" entre o Laboratório e os Ajustes (GDD §2.2); o Voltar do editor leva ao menu
    principal.
- **Escolhas (revisáveis):** a câmera e o giro do editor, as paletas de pele fantasia e de roupa, gravar a cada
  mudança (como os Ajustes, sem botão Salvar) e o Recruta como padrão.
- **Fica para depois:**
  - os acessórios 3D (chapéu de aba, capacete com viseira, mochila, rádio);
  - as fantasias (6d);
  - o visual dos bots pelo hash do nome (#58; hoje a rotação de 11 looks).

### 12.42 Fase 6d: fantasias (09/11/2026)

- **#62:** as fantasias bobas entram como visuais prontos extras do Meu Bobo; a lista final sai por print (rodada 10).
  Proposta implementada: **Astronauta, Pijama, Robô de papelão e Mergulhador** (ids `skin:astronaut`,
  `skin:pajamas`, `skin:cardboard`, `skin:diver`, só acrescentados; regra 20).
- **Tecidos novos** (`FIGURE_FABRIC` 6–8, `FIGURE_FABRICS` = 9), feitos pelo mesmo pintor de máscaras de tons:
  - listrado: listras verticais de 2 px do boneco, escuras;
  - papelão: fita clara numa faixa e numa costura, pintas e manchas;
  - traje espacial: costuras cinza em painéis e uma sombra leve.
  Os 12 looks de antes não mudam (hashes travados iguais); os 4 novos têm hash travado.
- **Sem acessório 3D:** o capacete de astronauta, a cauda do robô e os pés de pato ficam para a arte (os acessórios
  3D do GDD §4.7.2). A fantasia sai do tecido, das cores, do rosto (a pele cinza e o visor do robô) e dos óculos (a
  máscara do mergulhador cobre o nariz; o teste do nariz pula a máscara).
- **Os bots continuam com a farda** (#58): as fantasias não entram em `FIGURE_BOT_ROTATION`.
- A prévia do skingen (`npm run skingen:figuras`) mostra os 16 looks.

### 12.43 Fase 6e: toque completo (09/11/2026)

- **Botões novos:** `TOUCH_CONTROLS` ganhou `melee` e `camera` no fim (os índices de antes não mudam).
  - **Faca** à esquerda da troca de arma, na fileira de baixo, fora da área livre de mirar no alto à direita;
  - **Vista** (1ª/3ª pessoa) ao lado da pausa, pequena como ela;
  - o teste do layout confere: todos na metade direita, a 24 px da borda e a 12 px dos outros, em 667×375.
- **Correr no toque** (`TOUCH_SPRINT`): o joystick a 92% do raio ou mais, com 70% ou mais para a frente (não há
  botão de correr).
- **Ajustes:**
  - no toque, `autoFire` (Atirar sozinho) e `leftHanded` (Canhoto, que espelha botões e joystick pelo
    `TouchLayout.leftHanded` que já existia);
  - em Vídeo, `fpsCap` (60 ou 30).
  Todos são campos novos com padrão, sem migração.
- **Atirar sozinho** (`crosshairTarget` em `scene/third-person.ts`):
  - o raio da câmera (o olho em 1ª pessoa; em 3ª, a partir do plano do olho) acha o bobo mais perto antes do cenário
    que segura bala, até 80 m;
  - sendo inimigo, o quadro do humano aperta o gatilho.
- **Limite de 30 FPS** (`frame-cap.ts`): o laço do `game` pula o quadro que chega antes de 33,3 ms (menos 4 ms de
  folga). A sim anda pelo tempo real, então nada fica lento. O bench não limita.
- **Fantasma dos dedos** (gameplay.md §2.5): nas 2 primeiras partidas no toque, depois da contagem:
  - um dedo dá voltas num anel na metade do joystick ("Arraste para andar") e outro varre a da mira ("Arraste para
    mirar");
  - some quando o jogador anda 0,6 s e mexe a mira, ou depois de 10 s;
  - respeita o canhoto.
- **Escolhas (revisáveis):** as posições da Faca e da Vista, os limiares do correr, o alcance do atirar sozinho, e a
  troca de arma continua no botão Arma. Tocar no ícone da arma da HUD ficou para depois: no celular os botões já
  ocupam aquele canto.

### 12.44 Fase 7a: banco de sons (09/11/2026)

- **Síntese** (`audio/src/synth-game.ts`, `GAME_SYNTH_SOUNDS`): PCM mono a 44,1 kHz feito de ruído com semente e
  seno, sem nó de Web Audio além do `createBuffer` (regra 9).
  - Tiro em 4 camadas: estalo, corpo num passa-baixa que escurece, soco grave que cai de tom e cauda escura.
  - A amostra de longe (GDD §5.10) tira o estalo, amolece o ataque, passa tudo por um passa-baixa de 900 Hz e
    alonga a cauda.
  - As receitas ficam em `GUNSHOTS`; saturação leve (`tanh`) e pico normalizado.
- **Banco** (`game/src/sound-bank.ts`): cada som é `file` (`audio/<id>.mp3`, gerado pelo audioconv a −1 dBFS) ou
  `synth`.
  - Guarda o canal, o volume relativo (a mixagem mora aqui, não no MP3), a prioridade base (`SOUND_RANK`) e o
    cooldown por som.
  - `loadSoundFiles` decodifica, 4 por vez, só os MP3 que o mixer ainda não tem. Erro num som não para o resto.
  - O banco fica no chunk do menu; a síntese só roda na cena, para o `synth-game` não pesar no menu.
- **Assets:** os 3 pacotes da Kenney foram baixados de novo (o Interface Sounds 1.0 é novo). Os originais usados e o
  `License.txt` ficam em `assets-src/audio/source/`; os 33 MP3 somam 83 KB.
- **Escolhas (revisáveis):**
  - qual arquivo da Kenney faz cada som;
  - os volumes relativos;
  - os parâmetros dos tiros, só por medida: não dá para ouvir aqui. A rodada 11 leva os sons para o Erick ouvir.

### 12.45 Fase 7b: sons da partida (09/11/2026)

- **Um mixer só** (`game.ts`): nasce no boot com `platform.audio` (mudo sem áudio). Os MP3 do banco começam a carregar
  no primeiro frame do título (`startSoundFiles`). A cena recebe `SceneHost.audio` (o mixer e a promessa dos arquivos).
- **Loading** (`scene/load.ts`): espera os MP3 e sintetiza os sons `synth` com `createSynthJob`.
  - É um som por vez, no que sobra do orçamento de cada passo; enquanto os arquivos não chegam, um por frame.
  - O mixer guarda o que fez, então a 2ª partida não refaz.
- **`scene/sound.ts`** (`createMatchSound`): `event()` dentro do laço do `onEvents`; `frame()` 1x por frame, depois das
  câmeras. Cada vista ouve da própria câmera.
  - **Prioridade** pelo parentesco com os locais (`SOUND_RANK`). O som do próprio jogador toca "na cabeça", sem
    posição e sem cooldown; com 3–4 locais a própria arma perde 3 dB.
  - **Tiros e explosões:** a amostra de longe além de 30 m. Atrás de parede, −6 dB: `raycastGrid` do ouvinte mais
    perto até o som, com `blocksSight`.
  - **Cooldown por som**, global (`lastPlayed` por índice do banco).
  - **Passos:**
    - compasso pela velocidade no chão, com passada de 1,7 m andando e 2,3 m correndo;
    - só os 4 bobos mais perto de cada ouvinte, até 25 m;
    - família pelo `stepSound` do bloco sob os pés; agachado a 35%; tom ±7% por hash.
  - **Retorno:** plic e PLOC (a regra sem hitmarker cala os dois), abate, dano, morte, coração abaixo de 30 de vida,
    a contagem 3-2-1 + "vai" e a vinheta de vitória ou derrota do jogador 1.
  - **Foley** (troca, recarga, pino, clique) dos outros só até 12 m.
  - A pausa e o fim cortam tudo (`stopAll`).
- **Sem alocação por som:** as opções do `mixer.play` são dois objetos reaproveitados (regra 11).
- **Depuração:** o F2 ganhou "Vozes agora / pico". `GameHandle.audio` e `__bfDebug.audio` dão os contadores do mixer
  e o estado do contexto.
- **Escolhas (revisáveis):**
  - os números de `MATCH_SOUND`;
  - impacto em prop soa como madeira;
  - a granada arremessada usa o sopro da faca, mais grave;
  - a vinheta só pelo jogador 1;
  - o pan de 50% com 3–4 jogadores fica para o M3 (sofá).

### 12.46 Fase 7c: interface, Ajustes e indicador de som (09/11/2026)

- **`settings@1` ganhou `audio`:**
  - volumes `master`, `sfx`, `music` e `ui` em passos inteiros de 0 a 10 (padrão 9, 10, 7 e 8);
  - `mono`, `musicInMatch` (desligada, GDD §5.10) e `soundIndicator` (desligado).
  Campo novo com padrão, sem migração: save antigo entra sem aviso.
- **Volume → ganho:** o quadrado do passo (`volumeGain`), que soa mais por igual que a reta. O `game` aplica no mixer
  sempre que a referência de `save.settings` muda (`applyAudioSettings` no começo do `step`). Assim vale na hora,
  venha a mudança do menu, da pausa ou de um backup importado.
- **Aba Áudio** nos Ajustes e na pausa, depois de Vídeo: os 4 volumes em %, Música na partida, Saída mono e Indicador
  de som. Nenhum glifo novo no atlas.
- **Sons dos menus:** saem do `MenuController` (`setMenuSoundSink`), para toda tela que usa o controlador (título,
  menus, pausa, resultado):
  - foco que andou: `ui-mover`;
  - confirmar: `ui-confirmar`;
  - voltar: `ui-voltar`;
  - trocar valor ou aba: `ui-trocar`.
  Sem ligação (testes), fica mudo.
- **Indicador visual de som** (arte-ux §6.7):
  - `createMatchSound` guarda até 8 marcas por vista: tiros e explosões dos outros, força 1; passos, 0,55 × o volume
    do passo. Só até 20 m do ouvinte, e cada marca dura 0,8 s;
  - `fillIndicator` escreve no `HudModel` (`soundCount`, `soundAngle`, `soundAlpha`) o ângulo relativo à mira;
  - o HUD desenha cada marca como 3 pontos claros com contorno escuro num anel de 36 px em volta da retícula. Sem o
    contorno, os pontos sumiam contra o céu e o concreto (visto no Edge).
- **Escolhas (revisáveis):** os volumes padrão, a curva do quadrado, o raio e o desenho do anel, e o hover do mouse
  tocar "mover".

### 12.47 Fase 7d: tocador de música (09/11/2026)

- **No mixer** (`playMusic`, `stopMusic`, `music`, `duckMusic`): a música fica em 2 vozes próprias, fora das 24.
  - Grafo: `BufferSource` em loop → ganho de fade da voz → ganho de "duck" comum → canal `music`.
  - Trocar de faixa faz crossfade (0,8 s por padrão); a mesma faixa não recomeça.
  - A voz que saiu é solta pelo relógio do contexto, na próxima chamada ao mixer. O pacote não usa `setTimeout`.
  - O "duck" desce em 50 ms e volta no tempo pedido: a partida pede −6 dB e 0,8 s em cada explosão audível
    (arte-ux §10.4).
- **No jogo:** `MENU_MUSIC` (`sound-bank.ts`) é o caminho lógico da faixa do menu. É **`null` até o Erick aprovar o
  download** da faixa CC0 (#63); aí vira `music/menu.mp3`, sob demanda no size-check (`assets/music/`).
  - Carrega depois dos efeitos.
  - O `step` liga e desliga pela regra `wantsMusic`: toca nos menus e no resultado (`Scene.wantsMusic`); na
    partida, só com "Música na partida" (GDD §5.10).
- **Escolhas (revisáveis):** o fade de 0,8 s e a música voltando no resultado com a mesma faixa do menu. As vinhetas
  de vitória e derrota tocam no canal da música.

### 12.48 Fase 7d: a música do menu (09/11/2026)

- **Faixa:** "Toy Soldiers", de Zane Little Music (CC0), baixada com o OK do Erick. O original (6,2 MB) fica em
  `local/audio-originais/`, fora do git, por ser provisório (#38); o SHA-256 na tabela confere o arquivo.
- **Loop:** `tools/audioconv --musica` (`assets-src/audio/music.json`).
  - Trecho: 48 compassos a 135 BPM (o compasso tem exatamente 78.400 amostras a 44,1 kHz) a partir de uma cabeça de
    compasso. O trecho saiu de `local/m2/achar-loop.ts`: a emenda de 48 compassos com a música mais parecida dos dois
    lados (0,885 depois e 0,716 antes, em energia por faixa).
  - Emenda: o começo do loop é misturado, em 0,1 s de crossfade **linear**, com o que vinha depois do fim no original.
    A curva de potência igual somava até +3 dB, porque os dois lados são o mesmo trecho; o teste pegou.
  - Codificação: MP3 estéreo a 96 kbps (1,0 MB, sob demanda) com **folga circular** de 4 quadros de cada lado (o fim
    do loop antes, o começo depois). Sem ela, o MP3 borrava os primeiros e os últimos milissegundos e a volta dava um
    salto de 0,44 (o passo médio da onda é 0,02); com ela, o salto fica no nível da própria música.
- **Manifesto `loop@1`** (`format/audio-loop.ts`, `music/menu.json`): `loopStartS` (o atraso do decodificador mais a
  folga, medido decodificando o próprio MP3 no Edge: 0,139 s) e `loopS` (85,333 s). O jogo lê o manifesto, decodifica
  o MP3 e o mixer recorta (`Mixer.crop`, um buffer novo pelo `createBuffer`).
- **Mono:** com a saída mono ligada, a música troca em crossfade para uma versão mono, feita na hora e solta quando o
  mono desliga.
- **Memória:** 85 s estéreo a 48 kHz decodificados dão ~33 MB (tecnico.md §12 previa ~35 MB).
- **Medido no Edge:** a música começa 0,2–0,5 s depois do primeiro gesto no título e para na partida.
- **Risco:** o atraso foi medido no decodificador do Edge. Outro decodificador (o FFmpeg do nx.js) pode errar a emenda
  por alguns milissegundos; isso se confere no Switch, na fase 8.

### 12.49 Teste do sofá no Switch (09/11/2026, antes do M3)

Pedido do Erick, para jogar com amigos no console antes do M3. Fica atrás do `platform.id === 'switch'`; o M3 troca
pela tela "aperte A" (`input/local-players.ts`, que segue sem uso).

- **Quem joga:** no `requestScene` do JOGAR, `sofaPads()` lê o `describeControllers` e pega os controles completos
  (par de Joy-Con, Pro ou portátil), em ordem de índice, até 4. O índice do nx.js é o número do controle (o 0 junta o
  jogador 1 e o portátil). Com 2 ou mais, o jogador 1 fica no menor índice e os outros vão em
  `SceneRequest.localPads`. O Bobo Training e a calibração ficam de fora.
- **Cena:** `views` e `humans` passam a ser `1 + localPads.length`. O perfil sai pelo número de vistas
  (`switch34p` com 3–4); a receita segue com `humans: 'all'` (TDM: todos no time 0; FFA: cada um por si).
- **Partida:** um `InputMapper` por jogador extra, preso ao controle dele, com perfil de controle e assistência de mira
  próprios (`aimAssistBefore`/`aimAssistAfter` agora recebem mapeador, controlador e estado). Com extras, o jogador 1
  não segue mais o último dispositivo usado. A câmera e o ADS de cada vista leem o mapeador do controlador dela
  (`mapperOf`). Qualquer `+` pausa e retoma; qualquer um abre o placar.
- **Fica só no jogador 1:** a 3ª pessoa, o radial da arma na morte (os outros renascem com a primária padrão), a
  calibração, as dicas, o fantasma do toque, a vibração e as estatísticas da partida.
- **Conferido:** no Edge, com 3 controles falsos (`local/m2/capturar-sofa.ts`, liberando a web de propósito numa
  edição temporária), aparecem 3 vistas mais o quadrante do placar; o jogador 2 anda, o 3 gira, o Start do 3 pausa e
  retoma. No Eden, o NRO sobe até o menu (1,5 s), carrega os sons e a música, e um bench de 3 vistas com 12 bots roda
  sem erro (`switch34p`). O caminho dos 3 controles de verdade só se confere no console.

### 12.50 Fase 8a: o visual dos bots pelo nome (09/11/2026)

- `botLookIndices(names, looks)` (`game/scene/figures.ts`): o look de cada controlador na rotação dos bots é
  `(fnv1a32String(nome) + k) % looks`, com `k` = quantas vezes o mesmo nome já apareceu antes na partida. Um bot da
  Oficina com nome próprio veste sempre o mesmo look; os bots de fábrica repetidos andam na rotação a partir do look
  do nome deles.
- O humano 0 continua com o Meu Bobo. No teste do sofá, os jogadores 2–4 vestem o look de "Jogador N".
- Só cosmético: o golden e o balance não mudam.

### 12.51 Fase 8b: a qualidade na primeira abertura (09/11/2026)

- **`format/quality.ts`:** `QUALITY_TABLE` (arte-ux.md §1.12 sem a escala dinâmica, que fica para a rodada de
  otimização da #60):

  | Nível | Teto do DPR | Escala | Detritos |
  |---|---|---|---|
  | Alta | o do perfil | 1 | 500 |
  | Média | 1,5 | 1 | 200 |
  | Leve | 1 | 0,85 | 200 |

  - `qualityKnobs(perfil, nível)` nunca passa do perfil; no Switch a resolução não muda (720p fixo).
  - `guessQuality`: software ou GPU da `WEAK_GPU_PATTERNS` (versão 1: Mali G31–G68, Adreno até a 612, PowerVR, Intel
    HD/GMA) dá Leve. Poucos núcleos ou pouca memória (celular ≤ 4, PC ≤ 2) também dá Leve. No celular, o resto fica
    Média. No PC, a integrada (Intel sem Arc, Radeon Graphics, Vega) fica Média e a dedicada fica Alta.
  - `effectiveQuality`: o escolhido pelo jogador; senão o automático; senão o padrão da família.
- **`settings@1`** ganhou `video.autoQuality` (`none`, `low`, `medium` ou `high`). O campo é aditivo: save sem
  ele abre como `none` e sem aviso, então não precisou de migração.
- **Contrato:** `GraphicsSurface.setResolution?(maxPixelRatio, renderScale)` (opcional). A web refaz o drawing
  buffer e avisa o `onResize`; o Switch não implementa.
- **`game`:**
  - `pickAutoQuality` roda no 1º frame do menu se ainda não houve escolha, lendo o `collectReport` (GPU, `cores`,
    `deviceMemoryGb`).
  - `applyQuality` aplica a resolução sempre que o save muda. O bench fica fora: mede com a resolução que pediu.
- **Partida:**
  - Os detritos vêm de `qualityKnobs`; o bench continua no teto do perfil.
  - A sonda (`QUALITY_PROBE`) conta os quadros dos primeiros 10 s depois da contagem. Quadro lento é acima de 1,5×
    o alvo do perfil (ou do limite de 30 quadros). Com mais de 10% lentos, baixa `autoQuality` um nível.
  - A sonda roda em toda partida da Automática fora do Switch (tecnico.md §17.3).
- **Medido no Edge headless (Intel UHD):** a Automática deu Média; o Leve levou o buffer de 1280×720 para 1088×612;
  numa partida, 0 de 601 quadros lentos, então a Média se manteve (`local/m2/capturar-qualidade.ts` e
  `conferir-sonda-qualidade.ts`).

### 12.52 Fase 8c: o service worker (09/11/2026)

Escrito à mão, sem o vite-plugin-pwa do tecnico.md §19.1 (seria dependência nova, regra 22).

- **Build:** o plugin `boboforces:service-worker` (`vite.config.ts`, `enforce: 'post'`, só no build) grava `sw.js`
  na raiz do `dist` (`scripts/service-worker.ts`).
  - A versão é o sha256 do código do worker mais o nome e o conteúdo de cada arquivo do build. Mudou um byte, o
    `sw.js` muda e o navegador instala a versão nova.
  - O precache (`precacheList`) leva o `./` (o index) e todo o `dist`, menos a música (1 MB, sob demanda: entra no
    cache quando toca), o `/bench/`, o próprio `sw.js` e os `.map`. Hoje são 59 arquivos.
- **Worker:**
  - Um cache por versão, `boboforces-<versão>`. Na ativação, apaga só os caches `boboforces-` antigos, porque a
    origem é dividida com o gamebobo (tecnico.md §15).
  - Tudo do escopo é servido do cache primeiro (cache-first). A navegação para o index, com ou sem query, responde com
    o `./`; o resto busca pelo próprio pedido, com `ignoreVary`.
  - O `ignoreVary` é necessário porque o import dinâmico do chunk da cena manda `Origin` e um `Vary: Origin` do
    servidor fazia o cache errar: o `vite preview` reprovou o "sem rede" assim.
  - No install, os arquivos com hash vêm do cache HTTP; os sem hash (`assets/<lógico>`, o index) revalidam
    (`no-cache`), para a versão nova nunca guardar um arquivo velho.
  - A versão nova fica em espera até receber `boboforces:apply-update`.
- **Contrato:** `Platform.updates?: UpdateService` (`ready` e `apply()`), opcional. Ausente no Switch, no
  `npm run dev`, no `?bench` e na prévia do título do Switch. O `main.ts` liga com `import.meta.env.PROD`.
- **Página** (`platform/updates.ts`):
  - Registra 4 s depois do `load`, para o precache não disputar a banda do menu, e procura versão nova a cada 30 min.
  - Só conta como atualização se a página já tinha controlador; na 1ª visita é a instalação.
  - O `apply` manda a mensagem. No `controllerchange`, grava o save (`storage.flush`) e recarrega.
- **Jogo:** no `step`, com a tela no título e `updates.ready`, chama `apply()`. A tela de Novidades (fase 4g) aparece
  no boot seguinte se a versão do `version.json` mudou.
- **Conferido** (`local/m2/conferir-sw.ts`, `vite preview` + Edge):
  - 1ª visita instala 59 arquivos; a 2ª é controlada.
  - Sem rede, o título abre e a partida começa.
  - Com um `sw.js` novo no disco, a versão nova espera durante a partida; ao sair para o título, a página recarrega
    nela e sobra 1 cache.
  - `smoke:web` ok. Menu em 345,7 de 350 KB (fases 8a–8c e o teste do sofá somam 1,7 KB).

### 12.53 Teclado no Switch e mira pelas setas (#73, 09/11/2026)

Pedido do Erick: mouse e teclado no Switch. **Mouse não dá:** o runtime do nx.js 1.0.0-beta.7 só liga do HID o teclado,
a tela de toque e a vibração (`hidGetKeyboardStates`, `hidGetTouchScreenStates`); não há leitura de mouse em nenhuma
versão publicada nem no código do repositório. O teclado USB já chegava ao jogo pelo `keydown`/`keyup` (casca do M0).

- **Contrato (input):** `ControlProfile.lookKeys` (direções `LOOK_DIRECTIONS`: left, right, up, down) e
  `keyLookRate` (rad/s, padrão 2,4). O mapeador gira a mira pelas teclas como um stick digital: começa em 35% e chega
  ao máximo em 0,3 s segurando (`KEY_LOOK_RAMP`), com a sensibilidade, o Y invertido, o ADS e a fricção da assistência
  valendo igual. A sensibilidade dos Ajustes multiplica o `keyLookRate` também.
- **Perfil do teclado:** as **setas miram** em todo lugar (no PC é acessibilidade; nada do jogo usava as setas).
  `createKeyboardMouseProfile({ mouse: false })` é o teclado sem mouse (`keyboard.noMouse`): atira no **Ctrl
  direito** ou no **F**, mira (ADS) no **Shift direito** ou no **Z**, corre no Shift esquerdo, aviso no N e troca de arma
  no ponto e na vírgula. Ali não há navegador para o Ctrl+W fechar a aba.
- **Jogo:** sem `platform.features.keyboardMouse` (o Switch), a partida usa o perfil sem mouse com a **assistência de
  mira do controle** (o nível salvo do controle); a aba Botões dos Ajustes mostra esses botões e não avisa do Ctrl
  (`settingsRows`/`rebindSettings` com `mouse = false`). O dispositivo segue o último usado, como no PC: apertou
  uma tecla, o jogador 1 passa para o teclado; mexeu no controle, volta.
- **Fora:** no teste do sofá o teclado não vira jogador (a tela "aperte A" do M3 resolve, com o teclado contando como 1
  slot, como na tabela do DECISOES).
- **Conferido:** testes do mapeador e da aba Botões; na web, as setas giram a mira na partida
  (`local/m2/conferir-setas.ts`). No Eden não dá: o teclado USB emulado está desligado na config do Erick (não
  mexemos nela); o console decide.

## 13. M3: Sofá e Bobo Zombies (a partir de 09/11/2026)

Plano em `docs/PLANO_M3.md`. As escolhas abaixo são decisões menores revisáveis.

### 13.1 Fase 1a: assentos na partida (09/11/2026)

- **Contrato:** `SceneRequest.seats?: readonly LocalSeat[]` (`game/src/scene/seats.ts`) no lugar do `localPads` do
  teste do sofá. `LocalSeat` = dispositivo (`DeviceBinding`: controle ou teclado) e lado (0 = com o P1, 1 = contra).
  Com 2 ou mais assentos, cada jogador fica preso ao seu dispositivo, o P1 também.
- **O P1 é sempre o controlador 0 e joga no time 0**, porque o resultado, as estatísticas e o Nêmesis falam
  com ele. Quem escolhe "contra" vai para o time 1. Assim a sim não muda: `expandRecipe` já põe os humanos do time 0
  primeiro, e `seatRecipe` devolve o controlador de cada assento (`SceneRecipe.seatControllers`).
- **Os times mantêm o tamanho:** os presets são feitos para 1 humano no time com `humans: 'all'`; cada humano a mais
  toma o lugar de um bot do próprio time, cortado do fim da lista (no FFA, de qualquer bot). No treino os alvos ficam.
- **Partida:** um mapeador por assento (`localMappers`, o 0 é o P1) e `seatOfController` para achar o mapeador de um
  controlador; a vista `k` segue o controlador do assento `k`.
- **Switch:** continua automático (um assento por controle completo, todos com o P1) até a tela "Jogar no sofá" (1b).
- **Conferido:** `seats.test.ts`; no Edge, 3 controles falsos com o P2 contra (portão da web aberto só durante o
  teste): o P2 joga no time azul, os outros dois no laranja, e o Start do P3 pausa.

### 13.2 Fase 1b: a tela "Jogar no sofá" (09/11/2026)

- **Onde:** no menu principal, depois de Modos (o JOGAR do título continua solo: quem pega outro controle não vira P2
  sem querer). No Switch o teste do sofá automático saiu; o caminho é o mesmo (Mudar → Jogar no sofá).
- **Quem é o P1:** o dispositivo que abriu a tela (`menuInput.lastDevice`). Ele passa a ser o **dono dos menus**
  (`MenuInput.setOwner`): só ele navega até o sofá acabar. Os outros entram pelo `LocalPlayers` do M0 (A, botão da
  direita ou Start no controle; Enter ou Espaço no teclado), trocam o próprio lado com esquerda e direita e saem com o
  voltar, lidos por dispositivo (`MenuInput.pressedBy`).
- **Lado:** só nos presets de times (TDM): "Com o P1" ou "Contra o P1" (a 1a põe o "contra" no time 1).
- **Partida:** o P1 escolhe entre o último preset (o do JOGAR) e os de fábrica; Começar (ou o Start dele) joga com os
  assentos. Sair da partida volta para a tela do sofá com os mesmos jogadores; Voltar fecha o sofá. Mudar regras e
  Abrir Laboratório também fecham o sofá (as telas de edição são do P1 sozinho).
- **UI:** `couchScreen` (`ui/screens/couch.ts`), 4 cartões com o símbolo e a cor do jogador. `BoxNode.icon`
  desenha o símbolo do HUD (▲ ● ■ ◆) numa caixa, sem glifo novo no atlas (que está cheio).
- **Tamanho:** o menu foi a 348,3 de 350 KB (+2,6 KB). A próxima tela de menu pede antes o chunk preguiçoso das telas de
  edição (pendência do M2).
- **Conferido:** `menu-input.test`, `couch.test`, o teste do fluxo no `game.test` (entra, lado, sai, Começar, volta
  da partida) e no Edge (`local/m3/capturar-sofa-tela.ts`): teclado como P1, o controle 2 contra e o 3 com o P1, e a
  partida em 3 vistas com o P2 no time azul.

### 13.3 Fase 1c: entrar no meio, sair e controle desconectado (09/11/2026)

- **Só nas partidas da tela do sofá** (mesmo com 1 jogador): lá o P1 fica preso ao dispositivo dele. Na partida solo do
  JOGAR, apertar um controle passa esse controle para o P1 (como desde o M0), então segurar A nele não pode significar
  "entrar".
- **Entrar no meio:** segurar o confirmar (A) por 1 s num controle livre, ou o Enter com o teclado livre. O jogador
  assume um bot do time com menos humanos locais (no FFA, o primeiro bot livre) e ganha uma vista; o layout da HUD é
  refeito. Pega o menor número de jogador livre (P2 a P4). A sim não muda: o controlador continua sendo de bot, e o
  driver escreve o quadro do jogador nele antes da IA.
- **Contrato (ai):** `BotDirector.setHumanControlled(controller, human)`: enquanto um jogador pilota, o cérebro não
  pensa. `BotDirectorConfig.standby`: os humanos 2–4 do sofá ganham um cérebro de reserva (Normal Bob do time,
  `fork('standby', c)`, fora do `botCount`), que começa pilotado. **Sair = devolver o controlador**: o bot assumido
  volta para a IA dele, e o humano do sofá passa para a reserva. Os bots da receita, o golden e o balance não mudam.
- **Contrato (game):** `LocalDriver.setHumanControlled` (avisa o diretor e escreve o quadro do bot assumido com os
  humanos, antes da IA).
- **Pausa de quem apertou:** o + do P2–P4 pausa e passa os menus para o dispositivo dele (`MenuInput.setOwner`): a
  pausa mostra o jogador e só Continuar e **Sair do sofá**. Sair: um bot assume, a vista some e os outros mantêm a cor e
  o símbolo (`ViewSlot.seat`). Ao continuar, os menus voltam para o P1.
- **Controle desconectado:** pausa, avisa "Controle do P2 desconectado" na pausa e guarda o assento. Voltou no mesmo
  índice: segue; voltou em outro índice (mesmo id): o mapeador passa a ler o índice novo.
- **Fora (para depois):** quem entra no meio aparece no placar e no kill feed com o nome do bot; o resultado e as
  estatísticas contam os humanos do começo da partida.
- **Conferido:** teste da reserva no `director.test`; no `game.test`, o controle 3 entra no meio, pausa, sai, e o do
  P2 cai e volta; no Edge (`local/m3/capturar-entrar-meio.ts`): o P1 sozinho, o controle entra como P2 no time azul
  (o sem humanos), pausa com a pausa dele e sai.

### 13.4 Fase 1d: as vistas do sofá (09/11/2026)

- **Identificação:** a borda e o símbolo na cor do jogador em cada vista já existiam (M1). O **anel no chão** virou um
  **marcador em cima da cabeça**: nas vistas dos colegas de time, o jogador local aparece com o símbolo dele (▲ ● ■ ◆)
  na cor dele, a qualquer distância, no lugar do chevron do time (`HudModel.markerSeat`). Escolha minha: o anel pedia
  um caminho novo de desenho no render (teto de 7 programas); o marcador usa a HUD. No versus, o adversário local não
  ganha marcador (como os bots inimigos).
- **Radial da arma para todos:** a tela de morte de cada vista local mostra o radial e lê o mapeador daquele jogador; a
  escolha fica por jogador (`seatPrimary`, pelo número do jogador) e vai no `InputFrame.primary` dele.
- **2 jogadores lado a lado:** `settings.video.split2` (`stacked` padrão, `sideBySide`), linha "Sofá com 2" em
  Ajustes → Vídeo; a HUD já sabia (`HudScreenOptions.vertical`). A troca no meio da partida refaz o layout. A arma na
  mão usa a escala do 3–4P na vista estreita.
- **Fica para depois:** o minimapa no 4º quadrante (com 3 jogadores, hoje o placar e o relógio); entra com a Base
  Abandonada (fase 5), onde a planta do mapa faz mais diferença.
- **Conferido:** teste da HUD (marcador do jogador) e do `settings@1`; no Edge (`local/m3/capturar-lado-a-lado.ts`):
  Ajustes → Vídeo → Lado a lado e a partida de 2 dividida ao meio.

### 13.5 As telas de edição fora do menu (09/11/2026)

- **Por quê:** o menu estava em 348,6 de 350 KB e o M3 ainda tem telas pela frente.
- **Como:** `@boboforces/game/editors` (`editors.ts`) junta a Partida personalizada, o Laboratório e a Oficina (as
  linhas, os passos e as três telas da UI). O jogo recebe o módulo por `GameDeps.loadEditors` (regra 15: o `import()`
  fica no `apps/web`; o Switch e os testes ligam direto) e o pede logo depois do menu pronto, junto com os sons. Abrir
  uma dessas telas antes de ele chegar guarda o pedido e abre no primeiro frame depois (`withEditors`). Salvar o preset
  pelo resultado também espera o módulo (o nome do preset é dele).
- **Resultado:** menu em 344,3 KB (−4,3 KB); o chunk `editors-*.js` chega depois do menu e entra no precache do service
  worker como os outros. Conferido no `vite preview` (`local/m3/conferir-editors.ts`): o chunk chega depois do título e
  as duas telas abrem.

### 13.6 Fase 1e: por jogador (09/11/2026)

- **Ajuste do P2 ao P4:** `settings.couch.p2..p4` (sensibilidade 0,3–3× em passos de 0,1 e Y invertido), mudado na
  tela do sofá pelo controle de cada um (ombros: mira; botão de cima: inverte o Y) e mostrado no cartão ("Mira 1,2× ·
  Y invertido"). Fica guardado por número de jogador. Na partida, o perfil do jogador é o do dispositivo com a mira e o
  Y dele (`seatProfile`); o P1 continua com os Controles dos Ajustes. Nome e cor seguem fixos por número (P2 ●
  ciano…); o visual próprio de cada jogador fica para quando o Meu Bobo tiver perfis.
- **Vibração:** `settings.accessibility.vibration` (ligada por padrão; Ajustes → Acessibilidade). Vibra o controle do
  jogador ao levar dano (força pelo dano, 120 ms, no máximo 1 a cada 120 ms), ao morrer (320 ms) e com explosão perto
  (pela distância, 220 ms), por `platform.input.vibrate`, só em controle. Era previsto desde o GDD e não existia.
- **Som:** "os meus sons" (prioridade, sem cooldown) passam a ser os de todos os assentos, inclusive quem entrou no meio
  (`MatchSoundDeps.humans` vira um getter). O ouvinte local mais perto já era da fase 7b do M2.
- **Fica para depois:** o volume "meus sons" por jogador (hoje, com 3 ou mais, os seus tocam a 70%, como no M2).
- **Conferido:** `save-docs.test` (padrão, limite e tipo errado), o `game.test` do sofá (o ombro sobe a mira e o botão
  de cima inverte o Y) e no Edge (`local/m3/conferir-vibracao.ts`): o cartão do P2 e 3 vibrações (2 de dano e a da
  morte) em 41 s com o P2 parado no meio dos bots.

### 13.7 Fase 2a: o Bobo Zombies na sim, modo e ondas (10/11/2026)

- **Receita (format):** `MatchRecipe.zombies` (`ZombiesRules`): `waves` só 5, 10 ou 0 (sem fim), `quantity` 0,5–3,
  `hpMul` 0,25–5, `specials`, `bosses`, `economy` 0,5–3 e `selfRevives` −1–9; ausente = `ZOMBIES_DEFAULTS`
  (Curta, 10 ondas). O id `mode:zombies` já estava registrado desde a fase 1.
- **Sim:** `mode: 'zombies'` liga `SimContext.zombiesMode`. O `SimConfig.zombies` vira o **pool** (o `game` passa o
  teto do aparelho; sem ele, 24): os zumbis começam fora de jogo (mortos, sem contagem de renascer). O **diretor de
  ondas** (`systems/zombies.ts`) ocupa o passo 8 da ordem fixa, que estava vago:
  - intervalo de 5 s antes da 1ª onda e de 10 s entre ondas; ao abrir a onda, os bobos mortos voltam;
  - um zumbi a cada 0,6 s enquanto a onda tem zumbis por soltar e o pool tem lugar; total, vida e quem corre pelas
    fórmulas do GDD (`zombiesInWave`, `zombieWaveHp`, `runnerChance`); o que corre usa
    `MOVEMENT_ZOMBIE_RUNNER` (5,2 m/s, mais que o andar do bobo, `SimState.zombieType`);
  - o zumbi nasce num ponto sem time do mapa, sorteado entre os que ficam a 12 m ou mais de todo bobo vivo (senão o
    mais longe); o `pickSpawn` do M1 não serve: sorteia entre os 3 mais longe, o que pode cair em cima dos bobos;
  - o último zumbi da onda corre e fica marcado (`MatchView.lastZombie`);
  - todos os bobos mortos = derrota; passar da última onda = vitória (`phase: 'ended'`, `winnerTeam` 0 ou −1).
  Os bobos regeneram como no Warfare; quem morre espera a próxima onda (o caído e o reviver são da 2c).
- **Vista e eventos:** `MatchView.zombieWave`, `zombiesLeft`, `zombieRestTicks` (−1 no meio da onda) e `lastZombie`;
  `SimView.zombieType`; evento `wave` (`start`/`clear`).
- **Snapshot 8:** o diretor, o `rng` dos zumbis (`fork('zombies')`) e o `zombieType` entram no snapshot e no hash
  **só no Bobo Zombies** (`SimState.zombieFields`): o golden dos outros modos não mudou.
- **Conferido:** `zombies.test` (as fórmulas; o pool fora de jogo e a 1ª onda; vitória em 5 ondas com zumbis que
  caem no vazio; derrota com os zumbis dirigidos à mão, porque a sim não tem a IA; o último zumbi corre e é marcado;
  o snapshot vai e volta) e o bloco no `match-recipe.test`.

### 13.8 Fase 2b: os pontos do Bobo Zombies (10/11/2026)

- `SimState.points` (só no Bobo Zombies, junto do `zombieType` no snapshot e no hash) e `SimView.points`. Cada bobo
  começa com 500 (escolha minha: o GDD não diz), ganha 10 por acerto que tira vida de um zumbi e o bônus do abate: 60,
  100 na cabeça, 130 de faca (`ZOMBIE_POINTS`). Tudo × a `economy` da receita, arredondado. O conserto de tábua, os
  pontos em dobro e as compras chegam com as barricadas e a economia (fases 3 e 4).
- Conferido no `zombies.test`: a soma bate com os acertos e os abates do humano, e a economia 2× dobra o que se ganhou.

### 13.9 Fase 2c: caído e reviver (10/11/2026)

- **Cair:** no Bobo Zombies, o golpe que mataria um bobo derruba (`ENTITY_FLAG.downed`, `knockDown`): rasteja a 1 m/s
  (`MOVEMENT_DOWNED`, sem pulo nem escalada, sempre agachado), só com a pistola (o slot 1; só atirar, mirar e recarregar)
  e não toma dano. O vazio continua matando na hora.
- **Levantar:** o colega de pé do mesmo time mais perto, a até 1,5 m, segurando o usar enche o reviver em 3 s
  (trocar de quem levanta recomeça; enquanto alguém levanta, o sangramento para). Volta com metade da vida (escolha
  minha). Sem ninguém de pé para ajudar na hora da queda, gasta um "levanta sozinho" (`ZombiesRules.selfRevives`,
  3 por padrão, −1 sem limite) e volta em 4 s (escolha minha). Senão sangra 30 s e morre: o golpe final sai pela fila de
  dano com a arma `WEAPON_BLEED_OUT` (253), sem matador, e o bobo espera a próxima onda.
- **Derrota:** ninguém de pé e nenhum "levanta sozinho" a caminho.
- **Estado (só no Bobo Zombies):** `downTicks`, `selfUp`, `reviveTicks`, `reviver` e `WaveState.selfRevivesLeft`;
  vista: os mesmos campos, `MatchView.selfRevivesLeft`; evento `down` (`down`, `revive`, `selfRevive`).
- **Para a fase 3:** a IA dos zumbis ainda bate no caído (ele não toma dano, mas o zumbi perde tempo); os zumbis vão
  passar a ignorar quem está no chão.
- **Conferido** (`zombies.test`, com os zumbis dirigidos pelo teste): sozinho, o humano gasta os 3 "levanta sozinho" e
  perde na 4ª queda; com um colega a 1 m segurando o usar, levanta em 3 s com 50 de vida.

### 13.10 Fase 2d: o Bobo Zombies no jogo (10/11/2026)

- **Onde:** um card nos Modos (o 4º, "Bobo Zombies"), que joga a Curta (10 ondas) no Construto, só os humanos contra
  as ondas. O Construto ganhou `zombies` nos modos do `.bfmap` e do `MAP_MODES` até a Base Abandonada chegar (fase 5).
  Pelo sofá também funciona: o preset tem um time só, então ninguém escolhe lado.
- **Pool:** o teto de zumbis do aparelho (`PlatformProfile.maxZombies`: 60 no PC, 40 no PC dividido, 24 no celular,
  30/24 no Switch), passado ao driver como `zombies`. A IA dos zumbis é a do M1 (persegue pela navegação e bate).
- **HUD:** a linha do Bobo Training no lugar do placar vira "Onda 3 · 12 zumbis", "Onda 4 em 7 s" ou "Onda 3 · o
  último!"; a plaquinha do alto mostra PONTOS (em âmbar) e ABATES; caído, uma plaquinha abaixo da retícula mostra
  CAÍDO e os segundos (vermelho), LEVANTANDO e a porcentagem, ou LEVANTANDO SOZINHO (verde); morto, "Volta na próxima
  onda" no lugar do "Renascendo".
- **Resultado:** vitória ou derrota (sem empate), "Sobreviveram às 10 ondas!" ou "Caíram na onda 7", e "Onda N" no
  lugar do placar. Os botões do Warfare continuam (nível dos bots, Mudar regras); Mudar regras leva aos Modos, porque a
  Partida personalizada ainda não sabe o Zombies (fase 6).
- **Conferido** no Edge (`local/m3/capturar-zombies.ts`): o card abre a partida, a onda 1 solta 10 zumbis, o jogador
  parado cai, gasta os 3 "levanta sozinho" e perde ("Caíram na onda 1").

### 13.11 Fase 2e: o golden do Bobo Zombies e o robô das ondas (10/11/2026)

- **Golden do modo** (`golden.test.ts`): 4 bots Normal de apoio, sem humanos, no Construto real, pool de 24, semente
  42, até 7.200 ticks: `eea4c1c8` (os bots caem na onda 3, com 32 abates e 7 quedas). O golden do Warfare não mudou.
- **Robô das ondas** (`local/m3/robo-ondas.ts`, fora do CI): partidas sem tela do modo em várias sementes. Antes da IA
  de apoio (reviver e fugir das ondas, fase 3): 4 bots Normal chegam em média à **onda 3,7** (3 a 5, sementes 1–6;
  36 a 80 abates); 1 bot chega à **onda 2** (sementes 1–4). Cada partida leva 0,1–0,5 s sem tela. É a régua para a
  fase 3: com os zumbis ignorando os caídos e os bots revivendo e recuando, a média tem que subir.

### 13.12 Fase 3a: caídos e bots de apoio (10/11/2026)

- **Zumbi:** quem está caído não é presa (`nearestPrey` e a validade do alvo pulam `ENTITY_FLAG.downed`): ele vai
  atrás de quem está de pé. Antes, o zumbi perdia tempo batendo em quem estava caído e imune, o que protegia o time sem
  querer.
- **Bot de apoio** (`AiContext.zombiesMode`): sem zumbi à vista a menos de 4 m, vai até o colega caído mais perto
  (até 30 m, que não esteja levantando sozinho) e, a 1,1 m, olha para ele e segura o usar (`AI_SUPPORT`); com zumbi a
  menos de 6 m, recua atirando, sem correr. Nada disso vale fora do Bobo Zombies (o golden do Warfare não mudou).
- **Medido** (`local/m3/robo-ondas.ts`, 4 bots Normal, sementes 1–6): a onda média foi de 3,7 (fase 2e) para **4,3**
  (3 a 5). Só ignorar os caídos derrubava para 3,3; recuar atirando é o que mais pesa (0 a 3 colegas levantados por
  partida). Golden do modo: `5a793de3`.

### 13.13 Fase 3b: especiais e o chefão (10/11/2026)

- **Tipos** (`ZOMBIE_TYPE`, `ZOMBIE_KINDS`): além do que anda e do que corre, o **Sprinter** (6,4 m/s, metade da vida,
  golpe 20), o **Chonker** (1,3×, 2,7 m/s, 1,6× a vida, golpe 30; ao morrer explode em gosma: 40 de dano em 3 m, que
  não sai no vazio), o **Spitter** (cospe um projétil de 12 m/s, 20 de dano, a cada 3 s, de 4 a 15 m) e o **Mega Bobo**
  (1,8×, 2,7 m/s, 3000 × humanos de vida, golpe 60 com 1,8 m de alcance). Os números dos especiais são escolhas minhas.
- **Quando:** o Sprinter da onda 3 (8% por zumbi), o Chonker da 4 (7%), o Spitter da 6 (7%) e o chefão uma vez a cada
  5 ondas, o primeiro a sair, a mais no total; os liga/desliga `specials` e `bosses` da receita valem.
- **Escala do corpo** (`SimState.bodyScale`, só no snapshot e no hash do Bobo Zombies): a hitbox cresce em volta dos
  pés sem montar caixas novas (`FigureHitCache.testEntity` leva o raio para o espaço do corpo em tamanho 1; o `t` do
  acerto continua o do mundo) e o render desenha na mesma escala (`ActorBuffer.scale`, previsto desde o M1).
- **As "armas" dos zumbis** (`WEAPON_GOO` 9 e `WEAPON_SPIT` 10) ficam fora de `WEAPONS` (não são do jogador: sem nome,
  modelo nem loadout); o `weaponDef` devolve as duas, e o sistema de projéteis serve o cuspe como serve o foguete. O
  cuspe usa o modelo da granada até a arte dos zumbis (fase 5).
- **IA:** o Spitter mira e cospe quando o alvo está de 4 a 15 m (anda mais devagar enquanto isso); os outros
  perseguem como o zumbi do M1, cada um no seu perfil de movimento.
- **Medido:** robô das ondas com 4 bots Normal: onda média **4,0** (4 nas 6 sementes; o Sprinter da onda 3 pesa).
  Golden do modo: `9ee60f97`. Conferido no Edge (com o chefão e os Chonkers forçados na onda 1, numa edição
  temporária): o chefão aparece 1,8× maior e o cuspe voa até o jogador.

### 13.14 Fase 3c: flow field dos zumbis (10/11/2026)

- **No `nav`** (`flow.ts`, `createFlowField`): Dijkstra de várias fontes sobre as ligações ao contrário (CSR invertido
  montado uma vez), com o mesmo custo das ligações do A*. Para cada nó: o próximo nó até a fonte mais perto, a ligação
  (para pular ou agachar) e o custo. Fatiado (`run(budget)` fecha até `budget` nós), buffer duplo (o campo pronto vale
  até o novo terminar) e sem alocação depois de criado. **Alvos** (`addTarget`, os nós dos zumbis): o cálculo para
  quando o último alvo fecha e o custo passa dele mais `FLOW_TARGET_MARGIN` (8 m); os nós que ficaram na fila guardam um
  próximo nó válido. Contrato novo do `nav` (só acrescenta; nada mudou no A*).
- **Na IA** (`ai/flow.ts`, `ZombieFlow`): um campo por diretor (só com zumbis), conferido a cada 0,5 s e refeito só
  quando um bobo de pé andou mais de 2 m desde o último, caiu, levantou ou morreu, ou quando um zumbi ficou fora do
  campo; orçamento por tick = o de nós do A* do perfil (`aiPathNodesPerTick`, 600 a 800; o tecnico.md §8.3 permite até
  3.000 células). O zumbi lê o próximo nó a partir do nó onde está; perto do alvo (4 m, mesma altura) continua indo
  direto, e sem campo pronto, fora da navegação ou sem caminho, volta ao A* do M1. A `NavPathApi` ganhou o
  `createFlowField` opcional: a navegação de teste da sim não tem e os testes antigos seguem no A*.
- **Destravar do zumbi** (`unstuckSystem`): a IA aperta depois de 8 s sem andar 2 m perseguindo (sem bater nem
  cuspir), e a sim leva o zumbi a um ponto de nascer de zumbi com a vida e o tipo que tinha. Achado pelo robô das ondas:
  um Sprinter enroscado na quina de uma cerca, no ar e sem chão para pular, segurava a onda para sempre.
- **Medido** (`local/m3/estresse-flow.ts`, Construto, 4 bots e a horda cheia renascendo, i5-12450H; ver PERF.md §1h):
  com 24 zumbis o flow empata com o A* por zumbi no JIT e ganha um pouco no `--jitless`; com 60, gasta a metade (JIT)
  ou um terço (`--jitless`). Robô das ondas: média **4,0** (igual; os pedidos de A* caíram de ~950 para ~210 por
  partida, os que sobram são dos bots). Golden do modo: `4f85c2b3`.

### 13.15 Fase 3d, parte 1: janelas com barricada e portas pagas na sim, na navegação e na IA (10/11/2026)

- **Entidades com estado** (`sim/map-objects.ts`, `SimMap.barricades` e `SimMap.doors`; até 32 janelas e 16 portas):
  janela = vão no chão (centro nos pés, lado de fora em ±X/±Z, largura; altura padrão 2 m) com 6 tábuas; porta = caixa
  e preço. Tábuas, conserto em andamento, porta aberta e os pontos de conserto da onda vão no snapshot (versão 9) e no
  hash; mapa sem janela nem porta não muda nada (o golden do Warfare é o mesmo).
- **Colisão em dois conjuntos**, montados na criação a partir das props (mesmos índices: o `ImpactEvent.prop` continua
  valendo): o dos bobos (`SimContext.colliders`, também tiros e visão) com as portas fechadas e as janelas (bobo não
  atravessa; tiro e visão passam), e o dos zumbis (`zombieColliders`) com as portas e as tábuas (a janela fecha
  enquanto sobra tábua). Mudar o estado só troca os bits `solid`; o movimento escolhe o conjunto pelo tipo.
- **Navegação:** portões no `nav` (`NavGrid.assignGates` e `setGateBlock`, contrato novo; a navegação de teste da
  sim ignora): a ligação que atravessa a caixa de uma janela ou porta fica presa a ela. Janela: fechada para os bobos (o
  A* dos bots); porta fechada: para todos (o flow field dos zumbis também); comprada: aberta.
- **Regras** (`systems/barricades.ts`, dentro do diretor de ondas; `ZOMBIE_BARRICADES`): o zumbi colado do lado de
  fora arranca 1 tábua a cada 1,5 s (o chefão, todas de uma vez); o bobo de pé do lado de dentro segurando o usar repõe
  1 por segundo, com 10 pontos até 50 por onda; o usar (na borda) a até 1,5 m de uma porta fechada compra, se o bobo tem
  os pontos (senão, o evento `door` `denied`). Eventos novos: `barricade` (`tear`, `break`, `repair`) e
  `door` (`open`, `denied`). O tempo do conserto, os alcances e a caixa (0,2 m de espessura) são escolhas minhas.
- **IA:** o zumbi colado na janela com tábua bate nelas, virado para dentro (não conta como preso); o flow field passa
  pela janela. O bot de apoio, sem colega caído e sem alvo à vista, vai até 0,8 m para dentro da janela com tábua
  faltando mais perto (até 20 m) e segura o usar; aparecendo um zumbi, atira primeiro.
- **Falta (parte 2):** marcadores no `.bfmap` e no `mapc`, desenho das tábuas e das portas, avisos no HUD
  ("Segure para consertar", "Porta: 750") e um mapa de teste com janelas e portas até a Base Abandonada.

### 13.16 Fase 3d, parte 2: o Posto Avançado, o desenho e o aviso no HUD (10/11/2026)

- **Formato** (`map@1`, sem subir a versão): `MapMarkers.barricades` e `paidDoors`, opcionais no JSON da seção MARK
  (um mapa sem nenhuma tem os mesmos bytes: o Construto e o Ringue não mudaram); o validador confere lado de fora, vão
  (0,5 a 4 m), caixa e preço, e os tetos da sim (32 e 16). O `mapc` ganhou `barricade()` e `paidDoor()`, e o
  `simMapFromMarkers` passa os dois para o `SimMap`.
- **Mapa** `posto` (`assets-src/maps/posto.ts`, conteúdo novo `map:posto`; nome provisório "Posto Avançado"): um
  cercado de muro de bloco de 3 m, sem teto, de 20×16 m, com duas salas, 3 janelas de 1 m em cada e uma porta paga de
  750 pontos entre elas; os bobos nascem na sala 1 e os zumbis em 8 pontos fora. Só Bobo Zombies; o card dos Modos
  agora abre nele (o Construto continua nos recentes). 1,9 KB, 2030 nós de navegação, linha de visão de 39,7 m. Os
  vãos de 1 m começam em metro inteiro (o `mapc` recusa corredor desalinhado da grade de navegação).
- **Desenho:** os modelos `zombie-plank` (tábua de 1,06 m) e `zombie-door` (porta de 1×2 m com faixas de aço e
  cadeado), conteúdo novo, no buffer instanciado dos projéteis e das caixinhas (programa 4, sem programa novo; o buffer
  foi de 128 para 384). Uma tábua por fileira de 1 m de vão, de baixo para cima, com a inclinação alternada; a de cima
  some quando o zumbi arranca. A porta some quando é comprada.
- **HUD:** embaixo da mira, "Segure Interagir para consertar" (do lado de dentro, com tábua faltando) ou "Interagir:
  abrir por 750" (perto da porta fechada; o preço em vermelho sem pontos), pelas mesmas regras do `barricadesSystem`.
- **Conferido no Edge** (`local/m3/capturar-zombies.ts`): a porta e as tábuas aparecem; parado na sala 1, os zumbis
  arrancam as tábuas, entram e derrubam o jogador aos 30 s. O aviso do HUD não foi visto (precisa andar até a janela).

### 13.17 Fase 3e: medição e golden da IA do Zombies (10/11/2026)

- **Robô das ondas** (`local/m3/robo-ondas.ts`, agora com `MAPA=posto` e a contagem de tábuas), 4 bots Normal,
  sementes 1–6: no Construto, onda média **4,0** (igual à 3b e à 3c); no Posto Avançado, **4,0** também, com 36 a 63
  tábuas arrancadas e 15 a 33 repostas pelos bots por partida, e partidas mais curtas (128–149 s contra 154–204 s no
  Construto: sala pequena, menos espaço para recuar atirando).
- **Goldens do modo:** Construto `deecab03` (fase 3d) e o novo do Posto, `9e25b203` (onda 3, 38 abates, 5 quedas,
  51 tábuas arrancadas e 33 repostas em 2 min). O do Warfare continua `5ee925a0`.
- **Fecha a fase 3** (a IA do Zombies). O balanço das ondas (os bots param na onda 4) fica para a fase 4, com a
  economia: armas na parede, Caixa Misteriosa e vantagens mudam a conta.

### 13.18 Fase 4a: equipamento do Zombies e armas na parede (10/11/2026)

- **Equipamento:** no Bobo Zombies o humano nasce com a pistola, a faca e 2 granadas, sem a primária (vem da parede
  ou, na 4b, da caixa); os bots de apoio continuam com a primária do loadout (são ajudantes, sem economia). Escolha minha
  (revisável): o GDD lista as compras, mas não o equipamento do começo.
- **Armas na parede** (`systems/shop.ts`, `ZOMBIE_SHOP`; `SimMap.wallBuys`, até 16; estáticas, fora do snapshot):
  ponto na face da parede na altura do chão, lado para onde ela olha, arma e preço. O usar (na borda) a até 1,5 m da
  parede e 0,9 m do centro compra: arma nova vai para o slot da primária, cheia, e direto para a mão; a que o bobo já
  tem recarrega pente e reserva pela metade do preço (só se falta munição). Evento novo `purchase` (`weapon` ou
  `ammo`, `ok` ou `denied`).
- **Mapa:** marcador `wallBuys` no `map@1` (opcional, como as janelas; o validador confere a arma no registro) e
  `wallBuy()` no `mapc`. No Posto: Buzzer (1000) e Door Knocker (900) na sala 1; Rattler (1200) e Lawnmower (1500)
  na sala 2, atrás da porta.
- **Jogo:** o modelo da arma deitado na face da parede a 1,3 m do chão (buffer instanciado); aviso
  "Interagir: Buzzer por 1.000" (ou "munição por 500"), com o preço em vermelho sem pontos. Conferido no Edge.

### 13.19 Fase 4b: a Caixa Misteriosa (10/11/2026)

- **Regras** (`mysteryBoxSystem` em `systems/shop.ts`, `ZOMBIE_BOX`; `SimMap.boxSpots`, até 3, a 1ª é onde ela
  começa): parada, o bobo de pé na frente dela aperta o usar e paga 950 (sem pontos, `denied`); ela gira 4 s e
  sorteia uma primária que ele não tem; oferece por 10 s e só quem pagou pega (vai para a primária, cheia, e para a
  mão); ninguém pegou, fecha. Depois de 4 a 8 usos sorteados (no 1º giro de cada posição), sai o ursinho: devolve os
  950 e a caixa vai para outra posição. O sorteio usa o RNG dos zumbis; o estado (`boxState`, `boxUser`) vai no
  snapshot e no hash. Evento novo `box` (`open`, `denied`, `offer`, `take`, `expire`, `move`). Tempos,
  alcance e a conta do ursinho são escolhas minhas; a arma maravilha entra no sorteio na 4e.
- **Mapa:** marcador `boxSpots` no `map@1` (opcional) e `boxSpot()` no `mapc`. No Posto: começa na sala 1,
  encostada no muro sul; as outras duas ficam na sala 2.
- **Jogo:** modelo novo `mystery-box` (baú escuro com "?" amarelos); girando, as primárias passam em cima dela
  (troca a cada 0,12 s, só desenho) e sobem; oferecendo, a sorteada flutua no alto, mais clara. Avisos
  "Interagir: Caixa Misteriosa por 950" e, para quem pagou, "Interagir: pegar Lawnmower". Sem colisão por enquanto (a
  caixa muda de lugar; o colisor dinâmico fica para a arte da fase 5). Golden do Posto: `9524ad53` (só o hash).

### 13.20 Fase 4c: as vantagens (10/11/2026)

- **Efeitos** (`PERK`, `ZOMBIE_PERKS`; `SimState.perks`, bits por bobo, no snapshot e no hash do Bobo Zombies):
  Chonky Cola, vida máxima ×1,5 (`maxHpOf`: regeneração, levantar e o HUD usam ela; comprar já soma os 50);
  Speedy Soda, recarga na metade do tempo; Buddy Brew, quem levanta o colega leva a metade dos 3 s. Cair ou morrer
  perde todas. Preços no Posto: Buddy 1500, Chonky 2500, Speedy 3000 (dentro dos 1500–3000 do GDD; escolhas minhas).
- **Máquinas** (`perkSystem` em `systems/shop.ts`; `SimMap.perkMachines`, até 8): o meio da frente no chão, o
  lado da frente, a vantagem e o preço; o usar (na borda) na frente dela compra (já tem, nada; sem pontos, `purchase`
  `perk` `denied`). A máquina é uma caixa de 1 × 2 × 0,8 m atrás da frente: entra nos dois conjuntos de colisão
  (para tiro e visão também) e é um portão da navegação sempre fechado (os nós que ela ocupa saem do caminho).
- **Mapa:** marcador `perkMachines` no `map@1` (opcional; o validador confere a vantagem) e `perkMachine()` no
  `mapc`. No Posto: Buddy Brew na sala 1; Chonky Cola e Speedy Soda na sala 2.
- **Jogo:** modelos `perk-chonky` (vermelha), `perk-speedy` (verde) e `perk-buddy` (azul), geladeiras de 1 × 2 m
  com a garrafa no painel, um pouco mais claras que a luz do lugar; aviso "Interagir: Chonky Cola por 2.500"; as
  vantagens do jogador em plaquinhas com a inicial (C, S, B) em cima da vida, que vai a 150 com a Chonky Cola.
- **Goldens:** Construto `e8669653` (só o hash); Posto `0e0d586b` (as máquinas ocupam espaço nas salas e a partida
  mudou: onda 3, 31 abates, 8 quedas, derrota antes dos 2 min).

### 13.21 Fase 4d: os drops (10/11/2026)

- **Regras** (`ZOMBIE_DROPS`; tipos novos de pickup em `PICKUP_KIND`, de `maxAmmo` a `carpenter`): o zumbi abatido
  por um bobo (não no vazio nem pela bomba) deixa um drop com chance de 2% (`SimConfig.dropChance`, para testes e
  robô), até 4 por onda; o sorteio (chance e tipo) usa o RNG dos zumbis. O drop cai nos pés do zumbi, fica 30 s (pisca
  nos 3 últimos) e qualquer bobo de pé pega passando por cima. Munição cheia: todo bobo com pente e reserva cheios.
  Bomba: todo zumbi em jogo morre pela fila de dano (`WEAPON_NUKE`, sem dono: sem pontos por abate nem drop) e quem
  pegou ganha 400. Pontos em dobro e insta-kill: 30 s (`WaveState.doubleTicks`/`instaTicks`, no snapshot); o
  insta-kill faz qualquer dano de bobo matar o zumbi, menos o chefão. Carpinteiro: todas as janelas cheias e 200 para
  quem pegou. O evento `pickup` ganhou o `kind`.
- **Jogo:** os drops usam modelos que já existiam (a caixinha, a granada, a faca, a tábua) e um novo, `drop-double`
  (moeda amarela "x2"); flutuam, giram mais rápido e brilham. A linha das ondas do HUD mostra o anúncio do drop pego
  por 2,5 s ("Bomba! · Onda 3 · 12 zumbis") e os tempos ("Pontos em dobro 25 s · Insta-kill 12 s"), refeita só quando
  um número muda. Não conferido no Edge (o drop é raro numa captura; o caminho de desenho é o da caixinha).
- **Goldens:** Construto `8feb69fb` (onda 3, 38 abates, 1 queda) e Posto `088bc2cc` (onda 3, 36 abates, 7 quedas):
  o sorteio dos drops muda as partidas.

### 13.22 Fase 4e: o Desmontador e a medição da economia (10/11/2026)

- **A arma maravilha** (`WEAPON_DESMONTADOR` = 11, `DESMONTADOR`; nome provisório, pergunta I1): fora de
  `WEAPONS`, como a gosma e o cuspe, para só sair da Caixa Misteriosa (não entra em menu, loadout, regra de bot nem
  no registro `weapon:` do Laboratório). Projétil de energia de 45 m/s, 400 de dano direto e na explosão de 2,5 m (mata
  o zumbi até a onda 7 de uma vez), sem dano em quem atira, 6 no pente e 24 de reserva. Na caixa pesa 0,35 contra 1 de
  cada primária (~5% por giro, `ZOMBIE_WONDER_WEIGHT`); o sorteio da caixa passou a ser com peso.
- **Jogo:** modelos `desmontador` (pistola de raio de metal com o tubo de energia verde, os anéis do bocal e as
  aletas; segura como fuzil) e `desmontador-bolt` (o raio em voo, verde-claro); nome e categoria no HUD; o som do
  lançamento é o do foguete bem mais agudo. Não conferido no Edge (sai da caixa só com pontos de sobra).
- **Medido** (robô das ondas, 4 bots Normal, sementes 1–6): Construto **3,8** e Posto **4,0**. Os bots não compram
  nada (a economia é dos humanos; os bots de apoio já nascem com a primária), então só os drops mexem no número. O
  balanço com humanos comprando fica para os testes do Erick e a fase 6.
- **Fecha a fase 4** (a economia do Zombies).

### 13.23 Fase 5a: a Base Abandonada (10/11/2026)

- **Mapa** `base` (`assets-src/maps/base.ts`, conteúdo novo `map:base`; nome provisório, pergunta I1), à noite:
  QG (onde se nasce; 3 janelas, Buzzer e Door Knocker, a caixa começa aqui), Refeitório ao norte (porta de 750; mesas,
  4 janelas, Rattler, Buddy Brew), Pátio a leste (porta de 1000; torre de rádio, caixa d'água, 4 janelas, Peekaboo,
  Speedy Soda), Garagem ao sul (escombros de 1250; jipe, 3 janelas, Lawnmower, Chonky Cola) e uma 2ª porta de 750
  entre o Refeitório e o Pátio (dá a volta). Muros de bloco de 3 m sem teto, lâmpadas no alto dos muros, cerca de
  arame com holofotes nos cantos, galpões de chapa no anel de fora. Os zumbis nascem em 10 pontos fora dos muros.
  3,6 KB, 1936 nós jogáveis, linha de visão de 49,4 m. O card do Bobo Zombies nos Modos agora abre nela.
- **Linha de visão:** o `mapc` exige até 50 m em todo mapa (Switch 3–4P). Com a cerca a 56 m, as diagonais do anel
  de fora passavam de 55 m por mais galpões que eu pusesse; a cerca ficou em x 12..58 e z 10..58 (o anel de 4 a 6 m
  de largura), e duas janelas alinhadas da Garagem saíram (as retas atravessavam a sala de janela a janela).
- **Janela de mão única** (`NavGrid.assignGates(boxes, count, oneWay)`, `linkOutward`): o robô das ondas achou
  zumbis presos dentro de salas fechadas. O flow field usava a sala como atalho (entra por uma janela, sai pela outra),
  mas as tábuas da outra janela só saem por fora. Agora a ligação que sai por uma janela fica fechada para os zumbis:
  sala fechada não é mais caminho. Isso mudou também o golden do Posto (`dcc24861`).
- **Medido:** robô das ondas na Base, 4 bots Normal: onda média **4,0**, partidas de 143 a 166 s (antes da mão única:
  320 a 600 s, com Destravar em ciclo).

### 13.24 Fase 5b: os zumbis por tipo (10/11/2026)

- **Looks** (`FIGURE_PRESETS`, conteúdo novo `skin:zombie-sprinter|chonker|spitter|mega`): a mesma pele verde do comum
  e o pintor de zumbi de sempre (desbota e rasga a roupa; a barriga de gosma é do tipo `chonker`), cada um com a roupa
  e o traço de rosto dele (arte-ux.md §2.8). Sprinter: agasalho vinho, faixa clara na testa, tênis claro, olho caído.
  Chonker: macacão telha, colete amarelo de segurança, boné amarelo (no lugar do capacete de obra: o boneco não tem
  acessório 3D ainda), língua de fora. Spitter: capa de chuva oliva, mullet, boca em "uuuh". Mega Bobo: camuflado
  noturno de oficial, colete marrom, boné escuro, boca costurada (a placa de "chefe" fica para quando houver acessório
  3D). Hashes das skins travados no teste do pintor; prévias em `local/skins/figura-zombie-*.png`
  (`npm run skingen:figuras`).
- **No jogo** (`SceneFiguresInput.zombieKinds`, só no Bobo Zombies): as 4 skins entram logo depois da do comum na
  prioridade do plano de skins; `SceneFigures.zombieFigureOf/zombieSkinOf(type)` dão a do `ZOMBIE_TYPE` (o que anda
  e o que corre são o comum). O zumbi do pool troca de tipo a cada entrada, e o `spawn` resolve o boneco de novo.

### 13.25 Fase 5c: leitura à noite (10/11/2026)

- **Contorno de giz** (modelo novo `chalk-outline`, moldura de 1,25 × 0,5 m com traço de 1 texel): atrás de cada arma
  na parede, encostado nela, um pouco mais claro que a luz do lugar (`luz × 1,3 + 0,3`), como o giz dos jogos do
  gênero. A Caixa Misteriosa ganhou o mesmo tipo de brilho próprio (os "?" leem no escuro).
- **A gosma do Chonker:** a explosão de `WEAPON_GOO` não tem mais bola de fogo: são 4 rajadas de cubinhos verdes
  (`pushDebris`, as cores da gosma da paleta). O raio do Desmontador solta faíscas verdes e claras além da explosão.
- **Orçamento de camadas:** com o giz, os modelos passavam de 32 camadas (o orçamento do M1 para `modelos64`). Os
  modelos pequenos do Bobo Zombies (tábua, moeda x2, raio do Desmontador e giz) passaram a dividir uma camada
  (`createPickupLayers`, criada a cada geração como a de brilho das props): 30 camadas.
- **Conferido no Edge** (Base, nascimento temporário no QG): o giz em volta da Buzzer e a caixa clara no escuro.

### 13.26 Fase 6a: resultado e recordes do Bobo Zombies (10/11/2026)

- **Tela própria** (`zombiesResultScreen` em `game/src/result-screen.ts`): o título com a onda, a configuração
  ("Base Abandonada · 10 ondas · 2 jogadores", mais "regras próprias" quando alguma regra do modo sai do padrão), a
  linha do recorde e uma tabela com os bobos do time 0 (humanos primeiro, na cor do jogador; depois os bots de apoio;
  até 8 linhas): pontos, abates, na cabeça, caídas e quantos levantou. Botões De novo · Mudar regras · Salvar preset ·
  Sair. Sem Nêmesis, prêmios, nível nem "Mais fácil/difícil" (não existe bot adversário no modo).
- **As contas** (`scene/result.ts`): o `MatchStats` ganha `headKills`, `downs` e `revives` (do `kill` com
  `headshot` e do evento `down`: `down` conta para quem caiu, `revive` para quem levantou; levantar sozinho não
  conta); `zombiesRows` monta a tabela.
- **Recorde de onda** (gameplay.md §9: "por mapa e configuração"): `stats@1` ganha `records.zombieWaves` (lista de
  `{ key, wave }`, até 64, do mais antigo ao mais recente; aditivo, sem migração). A chave sai de `zombieRecordKey`
  (format): mapa, duração, quantidade, vida, velocidade, especiais/chefões, economia, "levanta sozinho" e os
  **jogadores locais** (escolha minha, revisável: 4 no sofá não apaga o recorde solo), com os padrões preenchidos.
  Como nos outros recordes, a primeira partida numa configuração só marca a base ("Primeira partida nesta
  configuração"); depois, "Novo recorde! Antes: onda N" em âmbar ou "Recorde nesta configuração: onda N".
- **O Zombies fora dos recordes do Warfare:** a partida do Zombies soma nos totais (partidas, abates, tempo), mas não
  mexe no recorde de abates nem no de sequência (uma onda de zumbis passaria de qualquer partida). Antes desta fase ela
  mexia.
- **Aba Dados:** a linha "Melhor onda no Bobo Zombies: N (mapa)", a maior de todas as configurações.
- **Receita:** `zombies.speed` (0,5–2×; padrão 1) entra no formato agora para a chave do recorde já nascer com ela;
  a sim passa a usar na 6b.

### 13.27 Fase 6b: a Partida personalizada do Bobo Zombies (11/11/2026)

- **A linha Modo** virou um ciclo de 3 (Times → Todos contra todos → Zombies; para trás, o inverso). Entrar no Zombies
  leva para a Base Abandonada (o Posto continua na lista; o Construto também, como mapa de teste), sem tempo nem meta,
  com um time só: os aliados que já tinha viram bots de apoio (até 3). Sair do Zombies para os Times tira o bloco
  `zombies`, vai a um mapa do Warfare e cria 4 adversários do mesmo bot (10 min, 75 abates, como o JOGAR).
- **As abas do Zombies** (`customTabs`/`ZOMBIES_TABS`): Partida (modo, mapa, duração Relâmpago/Curta/Sem fim,
  quantidade, velocidade, vida dos zumbis, especiais, chefão, pontos, "levanta sozinho" e visão), Jogadores (bots de
  apoio 0–3 e qual bot, movimento, dano de queda, câmera), Armas (dano, mira, assistência, recuo, dispersão) e Tela.
  Bots e Modificadores saem (não há bot adversário). A vida, o renascer e a regeneração ficam com o modo (o caído e
  a Chonky Cola).
- **"Mudar regras"** no resultado do Zombies abre esta tela (antes ia aos Modos).
- **`zombies.speed` na sim:** multiplica o andar e o correr de todos os perfis de zumbi (comum, corredor, Sprinter e
  os lentos); em 1× é o mesmo perfil, e os goldens não mudam.
- **Resultado:** no solo, "Caiu na onda N" e "Sobreviveu às N ondas!"; a linha do recorde só fica grande quando o
  recorde cai. Conferido no Edge (`local/m3/capturar-resultado-zombies.ts`, na porta 5174 porque a 5173 era de outro
  projeto aberto).

### 13.28 Fase 6c: presets de fábrica do Bobo Zombies (11/11/2026)

- **Sofá Zombies** (gameplay.md §10.4): Base Abandonada, Curta (10 ondas), 3 bots de apoio Normal Bob. Quem entra pela
  tela do sofá toma o lugar de um bot (`seatRecipe` mantém o tamanho do time), então com 4 humanos não sobra bot.
- **Zombies Relâmpago:** Base Abandonada, 5 ondas, sem bots.
- **Onde aparecem:** nos "Prontos" da Partida Rápida (a lista rola; os 5 cards cabem), na troca de partida da tela do
  sofá e no Surpreenda-me não (ele sorteia só o Warfare).
- **Atalho do Zombies:** o card sem nome mostra o mapa ("Base Abandonada") e a linha "Zombies · 10 ondas" (antes saía
  "0 bots", porque o atalho contava o tamanho do time).

### 13.29 Fase 6d: os sons do Bobo Zombies (11/11/2026)

- **De onde vêm:** 8 arquivos dos mesmos 3 pacotes CC0 da Kenney do M2 (os zips de 09/11, com o mesmo SHA-256: nenhum
  download novo): tábua arrancada e reposta, porta paga, tampa da caixa, sino do começo da onda, "sem pontos", drop
  caindo e a gosma do Chonker. Mais 12 sintetizados em `audio/src/synth-game.ts`: 3 gemidos de zumbi e o rugido do
  Mega Bobo (tabela de onda de 1024 pontos com formantes de "uuuh", tom que cai, tremor e ronco: barato no Switch),
  o cuspe do Spitter, a compra (chiado e dois sininhos), a caixa de música do giro (4 s, freando no fim como roleta),
  o ursinho (corneta que desce), a vantagem (três goles e um arpejo), o drop pego, o fim da onda e o "levantou".
- **Na partida** (`scene/sound.ts`): cada evento do modo toca no lugar dele (janela, porta, caixa, quem comprou);
  quem comprou ou levantou sendo local ouve "na cabeça"; "sem pontos" só para quem tentou; o drop pego e as ondas são
  para todos. O Chonker estoura em gosma no lugar do estrondo. Os gemidos: cada zumbi a cada 3–8 s (sorteio por hash,
  sem `Math.random`), só até 22 m de um ouvinte e no máximo um a cada 0,45 s na partida; o Sprinter mais agudo, o
  Chonker mais grave; o chefão ruge ao chegar e a cada 6–11 s.
- **Medido no Edge** (`local/m3/capturar-som-zombies.ts`, 60 s na Base): 41 MP3 prontos, 230 sons tocados, pico de 10
  vozes (de 24), nenhum roubado, nenhum desconhecido. MP3 do jogo: 142 KB no total (o sino cortado em 1,1 s).
- **Testes:** o banco aceita até 80 sons e 150 KB de MP3 (era 60 e 120 KB de folga); a caixa de música é o único som
  sintetizado acima de 1,6 s.

### 13.30 Fase 6e: a música do Bobo Zombies em 2 camadas (11/11/2026)

- **A regra** (GDD §5.10): música desligada por padrão durante a partida, mas tocando entre as ondas e no resultado;
  o Zombies em 2 camadas pela intensidade. Então: a **calma** toca sempre no intervalo (e na contagem antes da 1ª
  onda); durante a onda, só com "Música na partida", e aí a **horda** entra por cima pelos zumbis a até 15 m dos
  jogadores locais (6 = cheia; piso de 30%; o chefão vivo enche); no resultado volta a música do menu.
- **Mixer** (`setMusicLayer`, no contrato do `audio`): uma 3ª voz de música, a camada, que entra no mesmo ponto do
  loop da faixa tocando (`(agora − início da faixa) mod duração` no `start(0, offset)`) e só muda o ganho depois.
  Trocar ou parar a faixa solta a camada. +1 nó de ganho no grafo.
- **A cena manda na música** (`Scene.ownsMusic`): `scene/zombie-music.ts` (chunk da cena) carrega as 2 faixas
  sob demanda no começo da partida e decide o que toca; o `updateMusic` do núcleo sai cedo enquanto a cena mandar.
- **A trilha provisória** (#38) é minha, composta em código (`tools/audioconv/src/zombie-music.ts`): ré menor,
  100 BPM, 8 compassos (19,2 s). Calma: bordão grave, caixinha de música assombrada, baixo pinçado e um "coração" no
  1 e no 3. Horda: marcha de brinquedo (caixa clara no 2 e no 4, notas fantasma, rufo nos compassos 4 e 8, surdo no
  1) e um ostinato de baixo em colcheias. Gravada por `npm run audioconv -- --zumbis`: mono, 22,05 kHz, 48 kbps,
  115 KB por camada, com a folga circular e o atraso do MP3 medido no Edge (correlação 0,9994 e 1,0000), como a do
  menu. As notas que passam do fim do loop voltam somadas no começo, e o bordão fecha um número inteiro de ciclos:
  a emenda não estala. Fica até o Erick escolher uma CC0 (I3).
- **Conferido no Edge** (`local/m3/capturar-som-zombies.ts`, amostras a cada 2 s): a calma na contagem, nada
  durante a onda com o Ajuste desligado (o padrão), a do menu no resultado. A horda com o Ajuste ligado ficou só nos
  testes.

### 13.31 Fase 6f: medição e rodada 15 (11/11/2026)

- **Rodada 15** (v17 da página das rodadas, `local/m2/montar-pagina-r15.mjs`): seções 66 (resultado), 67 (Partida
  personalizada) e 68 (presets), e os sons e a música do Zombies no topo da seção 54; perguntas L1–L6. Capturas por
  `local/m3/capturar-r15.ts` (duas partidas de verdade até o fim: a primeira marca o recorde, a segunda mostra o
  recorde) e `capturar-personalizada-zombies.ts`; os sons sintetizados por `local/m2/render-sinteticos.ts` e a música
  somada e a emenda por `local/m3/render-musica-zumbis.ts`.
- **Medido:** `npm run check` verde (1.711 testes); menu em 347,7 de 350 KB (era 344,3 no começo da fase 5; os textos
  do Zombies, o banco de sons e a camada do mixer); MP3 do jogo 142 KB; a música do Zombies 2 × 115 KB, sob demanda.
  NRO de 60,2 MB (zip de 24,0 MB) abriu no Eden até o menu em 2.007 ms.

### 13.32 Fase 7a: o minimapa do quadrante livre (11/11/2026)

- **Onde:** na tela dividida de 3, o 4º quadrante (antes só o placar em dobro, e vazio no Zombies) mostra o minimapa;
  o placar e o relógio, quando há, sobem para o alto do quadrante no tamanho normal (`HudSharedModel.spareMap`,
  `hudSpareTopBand`).
- **Como** (`scene/minimap.ts`, só retângulos da UI: nenhum caminho novo no render nem programa de shader): a
  planta sai da grade na 1ª vez que o quadrante aparece: o chão do mapa é a altura mais comum do topo das colunas
  (amostra 1 a cada 4×4), parede é bloco que tapa a vista entre 1 e 1,5 m acima dele, e as paredes se juntam em
  retângulos pelo guloso do mesher (corrida na linha, crescendo para baixo); as props de colisão do mapa com 0,9 m ou
  mais entram por cima (janelas e portas, sem dono, ficam de fora). Teto de 420 retângulos. Base: 40 paredes e 10
  props em 8,4 ms; Construto: 114 e 20 em 15,1 ms (no Edge, uma vez).
- **A cada quadro:** o chão da área de jogo, a planta, as portas pagas fechadas (âmbar), a posição ativa da caixa
  (branco), os zumbis (verde, só no Zombies), os aliados do time dos locais (no FFA e no versus do sofá, ninguém) e
  os jogadores locais na cor de cada um, com contorno e um risquinho para onde olham. Norte para cima, fixo. Sem
  alocar.
- **Conferido no Edge** (`local/m3/capturar-minimapa.ts`, teclado e 2 controles falsos pela tela do sofá): o Sofá
  Zombies na Base e os Times no Construto.

### 13.33 Fase 7b: o bench com 4 vistas e o Bobo Zombies (11/11/2026)

- **Cena nova do bench** (`scene=zombies`, `BenchScene`; a web pela URL e o Switch pelo `bench.json`): o Bobo
  Zombies na Base Abandonada, sem fim, com a luz do mapa (noite; o `timeOfDay` do bench não vale aqui). As vistas
  são bots de apoio Normal com 1000 de vida (a horda se acumula sem derrubar o time; o `bots=` não vale nesta cena) e
  os zumbis vêm 3× mais numerosos e com 5× a vida, para o pool (`zombies=` ou o teto do perfil, 40 no `pcSplit`)
  encher.
- **Relatório:** a linha `zumbis_vivos media= max= pool= onda=` (só no Zombies), contada a cada frame medido.
- **Medido** (PERF §2): na RTX 2050 (Edge headless com `--gpu-alto`), 4 vistas com o pool cheio (40 vivos no pico)
  a 60,01 fps, p99 17,1 ms; e 4 vistas com 24 bots no Construto também a 60,01, p99 17,1. Com isso o critério 1 do
  M3 está cumprido no PC de referência (as vistas do bench são bots; 4 controles de verdade só mudam a leitura da
  entrada). Na integrada, a Base dá 57,7 fps (o Construto com 24 bots, 36,6).

### 13.34 Fase 7c: as 10 ondas do começo ao fim (11/11/2026)

- **O robô** (`local/m3/robo-10-ondas.ts`): partidas headless na Base com bots de apoio até a vitória ou a derrota
  (até 30 min de jogo), contando por onda a duração, os especiais e o chefão que nasceram, e marcando onda travada (2
  min sem nenhum zumbi a menos). Variáveis `NIVEL`, `ONDAS`, `VIDA` (zumbis) e `HP` (bots).
- **Achado: os bots de apoio ficavam sem munição.** Eles não compram nada; o fuzil e a escopeta secavam na onda 5, a
  pistola na 7, e da onda 8 em diante os 4 bots estavam só na faca (mesmo com 1000 de vida, a partida caía na onda 8).
  **Correção:** no Bobo Zombies o bot de apoio não gasta a reserva (`freeReserve` em `sim/systems/weapons.ts`:
  controlador de bot; ele ainda recarrega o pente). O humano continua comprando na parede. Mudou os goldens do modo:
  Construto `dd27cd5e` (onda 3, 37 abates, 3 quedas) e Posto `62251b7e` (onda 4, 47 abates, 5 quedas).
- **Do começo ao fim:** com regras leves (zumbis com 1/4 da vida, bots com 1000), 4 bots Tryhard vencem as 10 ondas
  nas 3 sementes, em 399–429 s de jogo, sem onda travada. Nascem os 4 especiais (Sprinter 15–24, Chonker 15–18,
  Spitter 10–14) e o chefão nas ondas 5 e 10. As ondas duram 18–53 s.
- **Com as regras padrão** (só bots, que não compram arma, não abrem porta nem usam caixa ou vantagem): Tryhard chega
  às ondas 5–6 (média 5,3) e Normal às 4–5 (média 4,3); o paredão é o primeiro Mega Bobo, na onda 5. É um piso: o
  balanço com gente (compras, portas, caixa, vantagens) é do teste do Erick (roteiro do M3).

### 13.35 Fase 7d: o portão do marco e o roteiro (11/11/2026)

- **Portão** (commit `9c83761`): `npm run check` (1.715 testes), `build` e `build:switch` (`main.js` de 2.927 KB, 68
  assets), `portcheck --strict`, `size-check` (menu 347,7 de 350 KB; a primeira partida no Construto 794,6 KB de
  1 MB), `smoke:web` (0 erro e 0 aviso de console) e `balance` (os 5 níveis em ordem, 6,0 s). Os goldens estão no
  `check`: Warfare `5ee925a0`, Zombies no Construto `dd27cd5e` e no Posto `62251b7e`.
- **`docs/ROTEIRO_M3.md`:** o que só o Erick testa: o PC com controles de verdade (sofá do Zombies 2–4, entrar no
  meio, desconectar, o resultado, Mudar regras, a música na partida, as 10 ondas solo) e o checkpoint do Switch com 4
  controles, o bench do Zombies pelo `bench.json` e o `runtime.log`.

### 13.36 Fase 7e: rodada 16 e o NRO do M3 (11/11/2026)

- **Rodada 16** (v18 da página das rodadas, `local/m2/montar-pagina-r16.mjs`): seções 69 (o Zombies no sofá com 2,
  3 e 4) e 70 (o minimapa); perguntas M1–M4 (minimapa, a munição dos bots de apoio, o primeiro Mega Bobo e fechar e
  publicar o M3). Capturas por `local/m3/capturar-minimapa.ts` com `PADS=1..3` controles falsos.
- **NRO do M3:** 60,2 MB (zip de 24,1 MB); no Eden, menu em 1.401 ms e a sonda de áudio ok. Os 4 controles e o
  Zombies a 30 fps no console são o checkpoint do Erick (`docs/ROTEIRO_M3.md` §2).

## 14. Refino antes do M4 (a partir de 16/11/2026)

Pedido do Erick (#79); plano em `docs/PLANO_REFINO.md`.

### 14.1 Fase R1: atirar andando, arcade (16/11/2026)

- **O que estava esquisito:** no perfil Bobo a mira abria 1,5× andando e 2,5× no ar; correndo, o gatilho não fazia
  nada, e ao parar de correr o tiro ainda esperava 0,15 s; no controle, correr era "segurar o L3"; e a retícula da
  HUD abria até 60% pela velocidade, pulsando a cada passo mesmo sem atirar.
- **Agora (perfil Bobo; o Tático, estilo CS, continua como estava):** o gatilho corta a corrida (a sim não deixa
  correr com o gatilho apertado) e o tiro sai 0,05 s depois; a mira abre ×1,05 andando e ×1,75 no ar
  (`moveSpreadMul` 0,7 no Bobo); mirando (ADS) anda a 75% (era 60%).
- **Controle:** correr **alterna** com o L3 por padrão (instalação nova; quem já tem o save fica com o que tinha, e
  troca em Ajustes → Controles), e a corrida alternada **solta** quando o jogador para de ir para a frente (mapeador,
  qualquer dispositivo com a alternância ligada).
- **Retícula:** abre pelo que a sim abre de verdade (o multiplicador do perfil, andando ou no ar, some no ADS), não
  pela velocidade.
- **Goldens** (a partida dos bots muda): Warfare `34edbf41`, Zombies no Construto `b4b81b30` e no Posto
  `d7ff9e30`. O balance continua em ordem.

### 14.2 Fase R2: a granada (16/11/2026)

- **O defeito:** o G (teclado), o RB (controle) e o botão do toque mandavam o botão `grenade` do `InputFrame`, mas
  a sim não lia esse bit: para jogar granada era preciso trocar para o slot 4, segurar o gatilho e soltar.
- **Arremesso rápido** (`sim/systems/weapons.ts`): o botão granada, de qualquer arma, começa a cozinhar a granada do
  slot de arremesso (cancela a recarga; não troca de arma); soltar joga; cozinhar o pavio inteiro explode na mão;
  enquanto cozinha, a arma da mão não atira. Morrer cozinhando deixa a granada cair (a do slot de arremesso). O botão
  também corta a corrida. Estado novo `SimState.quickNade` (no snapshot, versão 10, e no hash) e, na vista,
  `cookTicks` e `quickNade`. O jeito antigo (slot 4 e gatilho) continua valendo.
- **O arco** (`predictThrow` em `sim/systems/projectiles.ts`, exportado): a mesma conta do `projectileSystem`
  (gravidade, quique com perda, parada no chão), pura e sem alocação, a partir do olho com a mira e a herança da
  velocidade; o jogo prevê por quadro (`cookTicks + 1` ticks: a granada já anda no tick do lançamento), projeta e a
  HUD pinta pontinhos que somem com a distância e um quadrado âmbar onde ela vai estar quando o pavio acabar. O teste
  confere que o ponto previsto cai a menos de 2 cm da explosão de verdade.
- **O pavio** na tela (uma barrinha embaixo da mira, âmbar e vermelha no fim) e **a granada na mão** (o viewmodel
  troca para ela enquanto cozinha no arremesso rápido).
- **Aviso de granada perto:** as granadas vivas dos outros a até 7 m (o raio da explosão é 5) aparecem como um círculo
  vermelho com contorno num anel em volta da mira, na direção delas, mais forte quanto mais perto.
- **Dica de 1 linha nova** (`tip.grenade`, "segura e solta: granada"): nas 2 primeiras partidas, depois de 25 s vivo
  com granada e sem ter jogado nenhuma.
- **Goldens:** o campo novo entra no hash (a partida é a mesma): Warfare `b36eb8e1`, Zombies `edc93590` e
  `6c4eaf90`. Conferido no Edge (`local/refino/capturar-granada.ts`): segurando o G aparecem a granada na mão, o
  pavio e o arco; soltando, ela sai e o contador vai de 2 para 1.

### 14.3 Fase R3a: os textos da partida fora do menu (16/11/2026)

- **Por quê:** o menu estava em 347,8 de 350 KB e a tabela de textos era o maior módulo dele (35,4 KB crus no
  `index.js`), inclusive com os textos que só a partida e as telas de edição usam.
- **Como:** `ui/src/strings-extra.pt-BR.ts` (`STRINGS_EXTRA_PT_BR`) leva os prefixos que nenhum módulo do chunk do
  menu usa (conferido pelo sourcemap do build, `local/refino/peso-menu.mjs`): `bobo.`, `debug.`, `death.`,
  `scoreboard.`, `drop.`, `perk.`, `prize.`, `fontSpecimen.` e `tip.` (238 entradas). `registerStrings`
  (`ui/src/text.ts`) a registra: a cena (`scene/index.ts`) e as telas de edição (`editors.ts`) chamam ao carregar;
  o `t()` procura nas duas e, sem achar, devolve a própria chave. `StringKey` é a união das chaves (só tipo). Nos
  testes da UI e do jogo, o setup do Vitest (`ui/src/test-strings.ts`) registra.
- **Medido:** `index.js` de 272,6 para 266,0 KB crus; o menu (medido comprimido, com o atlas das fontes) de 347,8
  para 345,4 KB.

### 14.4 Fase R3b: o título como centro e os Modos (16/11/2026)

- **Antes:** o título tinha JOGAR, Surpreenda-me e "Mudar"; tudo o mais (Partida Rápida, Modos, Sofá, Laboratório,
  Meu Bobo, Ajustes, Novidades) ficava atrás do "Mudar", num menu principal que nem cabia na tela (o Voltar rolava
  para fora). A Partida Rápida e os Modos eram duas portas para a mesma coisa.
- **Agora, o título:** JOGAR (largo, com a última partida embaixo) e uma grade de 2 colunas: Modos | Sofá,
  Meu Bobo | Laboratório, Ajustes | Testes (só com itens de teste: a Cena-vitrine na web, os do Teste Zero no
  Switch) e Sair (Switch). O menu principal (`main-menu.ts`) saiu.
- **Os Modos** são o lugar de escolher o que jogar: Times, Todos contra todos, Bobo Zombies, Bobo Training,
  Surpreenda-me e Partida personalizada (6 cards em 3 linhas mais compactas). Times e Todos contra todos abrem a
  Partida Rápida (a configuração rápida e os atalhos), que volta aos Modos; o Surpreenda-me também volta aos Modos; a
  Personalizada abre com a última partida.
- **Os itens de teste** saíram do título para a tela Testes (`testListScreen`): no Switch a grade de 9 encostava na
  grade nova. O teste da casca volta para ela.
- **A Novidades** foi para Ajustes → Sobre (ainda aparece sozinha uma vez depois de atualizar).
- **Testes:** os 15 do jogo que passavam pelo "Mudar" usam o ajudante `titleTo`; os do título e dos itens de teste
  foram reescritos para a grade e a tela Testes.

### 14.5 Fase R3c: os Ajustes (16/11/2026)

- **A Tela (ex-Vídeo):** a aba `video` (o id fica) se chama Tela e junta o que se vê, na ordem de quem procura: Câmera,
  Ombro, Campo de visão, Sofá com 2, e depois Qualidade, Limite de quadros e Tamanho dos menus. O Indicador de som
  saiu do Áudio para a Acessibilidade (é um aviso na tela), e as Dicas ficam no fim dela.
- **A frase de ajuda:** embaixo das linhas, uma frase curta diz o que a linha com o foco faz (e, com o foco numa aba, o
  que a aba tem). `settingsHelp` (`game/src/settings-menu.ts`) acha a frase pelo foco; cada opção tem `helpKey`
  (`settings.help.*`, 46 frases); as linhas de botão dividem uma frase só (a da captura). O `game` e a pausa refazem
  a tela quando o foco muda (`settingsHelpFocus`/`pauseHelpFocus`). No `tabbed.ts`, `help` é opcional: a
  Partida personalizada não tem.
- **Uma aba Jogo foi tentada e saiu:** com 8 abas a fileira passava da borda no celular de 640×360. Juntar Dados e
  Sobre para abrir espaço deixaria a Sobre misturada (estatísticas, backup, créditos).
- **Achado:** a fileira de 7 abas já passava da borda no 640×360 desde o Áudio (fase 7c, 634 de 608 px): o teste de
  estouro tinha só 6 abas. Agora a fixture tem as 7 e a frase mais longa, e as abas ficaram mais justas
  (`BUTTON_COMPACT.padX` 16 → 13, folga 8 → 6): 599 de 608 px no 640×360, 1054 de 1216 no 1280×720.
- **Medido:** o menu de 345,4 para 347,1 KB (as frases); sobram 2,9 KB até o teto.

### 14.6 Fase R4a: a pausa e a arma na tela (16/11/2026)

- **A pausa:** "Ajustar desafio" virou **Dificuldade** e "Destravar" virou **Estou preso** (os ids e as ações ficam). Embaixo
  dos botões, a frase do item com o foco (`pauseHelp` em `game/src/pause.ts`; as frases `pause.help.*` moram na
  tabela extra, que a cena registra: não pesam no menu). A frase pode passar da largura da coluna (centrada, dentro da
  tela: o teste da pausa confere com a mais longa).
- **A arma na 1ª pessoa:** com 1–2 jogadores a escala foi de 0,8 para 0,68 (`VIEWMODEL_SCALE_1P` no `match.ts`): o
  fuzil tampava perto de um terço da tela e escondia quem vinha pela direita. O alvo do ADS agora leva a escala em
  conta (a arma encolhe em torno da mão; alvo = −(mão + escala · (mira − mão))): antes, quanto menor a escala, mais a
  mira do ADS saía do centro. Conferido em captura: a alça da mira no centro.
- **A Partida personalizada (R4c):** ganhou a mesma frase de ajuda dos Ajustes, para cada linha e cada aba nos 3
  modos (`customHelp` em `game/src/custom-match.ts`, frases `custom.help.*` na tabela extra: a tela mora no pedaço
  das telas de edição, que registra a tabela, e não pesa no menu).
- **O MVP (R4b):** sem ninguém com abate ou assistência, o resultado diz "MVP: ninguém pontuou" (era o 1º da lista,
  com 0, e saía "MVP: P1" num empate de 0 × 0).

## 15. M4: o porte do Switch

Plano em `docs/PLANO_M4.md` (16/11/2026); perguntas P1–P9 no padrão (v20 da página das rodadas).

### 15.1 Fase 1: a LOCAL EDITION (16/11/2026)

- **A edição como dado:** `GameDeps.localEdition` (o Switch passa sempre; a web só no servidor de desenvolvimento,
  com `?edicao=local`, para ensaiar). Sem campo novo na `Platform`.
- **O lobby é a casa:** sem título; antes do `switch` de telas, `screen === 'title'` vira `enterLobby` no mesmo
  quadro, então toda volta "ao título" (Modos, Ajustes, Laboratório, Testes, a partida) cai no lobby, com os mesmos
  jogadores e a última partida na frente (`refreshCouchPresets`). O `closeCouch` não desfaz os assentos na edição
  local (Mudar regras e Abrir Laboratório saíam do sofá). O menu fica pronto (`checkMenuReady`) com o lobby na tela.
- **O 1º A é o P1:** no boot ninguém apertou nada; o lobby abre sem ninguém sentado e o 1º dispositivo que aperta A
  (ou Enter) vira o P1 e o dono dos menus. Esse aperto não começa a partida (o quadro em que o P1 entra não passa
  pelo menu). Assim, um controle que não seja o 0 também abre o jogo.
- **A tela** (`couchScreen` com `home`): o nome do jogo, os 4 cartões, a PARTIDA (a última e as de fábrica),
  COMEÇAR | Modos | Surpreenda-me e, embaixo, compactos, Meu Bobo, Laboratório, Ajustes, Testes (com itens da
  casca) e Sair. Sem Voltar (o voltar do P1 não faz nada; o dos outros tira o jogador, como no M3).
- **Sair do jogo (P6):** o 1º aperto arma (a linha embaixo do nome fica vermelha: "Aperte Sair de novo para fechar o
  jogo."), mover o foco ou apertar outra coisa desarma, o 2º chama `platform.exit()`. O rótulo é "Sair", curto: no
  4:3 com o piso de texto da TV, "Sair do jogo" passava da borda.
- **A 1e (reabrir o "aperte A" na troca de dock/portátil e no HOME)** fica para a fase 3: o M3 já pausa, guarda o
  assento de quem desconectou e deixa entrar no meio segurando A.
- **Medido:** menu da web 347,7 de 350 KB; NRO no Eden com o menu pronto em 1,47 s (só possível com o lobby na tela).

### 15.2 Fase 2: o save e os arquivos no SD (16/11/2026)

- **O que já estava (2a):** `save.json` com `save.backup.json` antes de cada escrita, `save.previous.json` por
  chave, save corrompido abrindo pelo backup e falha de escrita virando linha no `runtime.log` sem lançar (testes de
  `storage.ts`). O aviso **na tela** para SD cheio ou só leitura ficou de fora: pede um campo novo no contrato do
  `Storage` para algo que ninguém viu acontecer; o registro basta até o console mostrar o contrário.
- **A cópia do dia (2b):** na 1ª abertura de cada dia, o save que abriu bem (do principal, não do backup) vira
  `sdmc:/switch/boboforces/backup/save-AAAA-MM-DD.json`; ficam as 3 mais recentes (`DAILY_BACKUPS_KEPT`). O dia
  vem da casca (`today` no `createSdStorage`, pelo relógio do console; sem relógio válido, nada). Restaurar é
  copiar o arquivo do dia por cima do `save.json` (no PC ou num gerenciador de arquivos); um botão "Restaurar" nos
  Ajustes pediria listar arquivos pela `Platform` e fica para quando fizer falta.
- **A pasta `oficina/` (2c, P2):** `sdmc:/switch/boboforces/oficina/*.json` traz bots (`bot@1`) e presets
  (`preset@1`) feitos no PC. A casca lista e lê (`readWorkshopFiles` em `apps/switch/src/platform/files.ts`: só
  `.json`, até 200 arquivos, maior que 64 KB nem é lido) e passa ao jogo por `GameDeps.workshopFiles`;
  `importWorkshopFiles` (`game/src/workshop-files.ts`) valida pelo `format` e importa **sem passar por cima** do
  que existe (bot pelo id, preset pelo nome; preset sem nome usa o do arquivo), então ler a pasta a cada abertura não
  duplica nada nem desfaz o que o jogador mudou no Switch. O que não entra vira `[save] oficina: <arquivo> ignorado
  (<razão>)` no registro. `importar/` e `exportar/` continuam para o backup inteiro e os relatórios.
- **O backup da web também serve:** a web não exporta um bot sozinho; o caminho do PC para o Switch é o backup de
  Ajustes → Dados (`backup@1`, até 1 MB) posto na `oficina/`: entram só os bots e os presets salvos dele, pelas
  mesmas regras (os ajustes, as estatísticas e o Meu Bobo do Switch ficam como estão).
- **Onde mora o importador:** no pedaço das telas de edição (`editors.ts` exporta `importWorkshopFiles`); o jogo
  importa quando ele chega (o Switch carrega no boot). No menu da web ele pesava 0,6 KB sem nunca rodar. Menu: 347,9
  de 350 KB.

### 15.3 Fase 6a: o ícone do HOME (16/11/2026)

- **A arte (P3):** própria e sintética, sem nada baixado: `apps/switch/scripts/icon-art.ts` pinta numa grade de 32×32
  blocos a cabeça de um bobo de capacete (a pele padrão do boneco `0xe5aa84`, o verde da farda, o fundo do menu) e
  a barrinha âmbar do título. `npm run icon` sem argumento grava o `icon.jpg` (JPEG 256×256, 2,8 KB) a partir
  dela; com um PNG quadrado, usa o PNG (o caminho que o M1 deixou).
- **Gerado, não versionado:** o `npm run nro` e o `npm run nsp` rodam o `prepare-icon` antes de empacotar, e o
  `icon.jpg` está no `.gitignore` (a regra 23 fala de PNG e MP3; o JPEG é só entrada do NACP, sempre igual à arte).
  O `verify:nro` confere que o ícone embutido é o `icon.jpg`.

### 15.4 A fase 5a fica para depois do console

A malha e a navegação prontas no `.bfmap` foram medidas antes de começar: só a `NavGrid` do Construto tem ~7 mil nós
e dezenas de milhares de ligações (arrays por nó e por ligação), centenas de KB crus por mapa, e a "primeira partida no
Construto" está em 796,5 KB de 1 MB na web. O ganho (1,4 s de navegação e 0,9 s de malha com o JIT frio) só se mede no
console. Fica para quando o Switch voltar e a P1 tiver resposta: o caminho mais barato é gravar só a navegação, com
os arrays em deflate e o teste "a gravada é igual à calculada".

### 15.5 Fase 7, parte 1: o heap no registro e o roteiro (16/11/2026)

- **`[mem]` por minuto (7a, P8):** no Switch, toda partida grava `[mem] t=<n>min heap_mb=… max_mb=… limite_mb=…` no
  `runtime.log` a cada 60 s (`MEMORY_LOG_EVERY_S`, dentro do `sampleMemory` que já lia o heap 1 vez por segundo;
  o texto só é montado uma vez por minuto). É a prova do "heap estável" da partida de 20 min com o jogo de verdade.
- **`docs/ROTEIRO_M4.md` (7c):** o lote do console para quando o Switch voltar (lobby, 20 min com 4 no Zombies na
  dock e no portátil, HOME/sleep/controle, a `oficina/`, o loading a frio, o Sair), já com o que o roteiro do M3
  deixou sem log.
- O bench de 20 min (7b) e a rodada 18 (7d) ficam para depois das fases 3 e 4.

### 15.6 Fase 3: o ciclo de vida (16/11/2026)

- **A página Jogadores da pausa (3a, 3c e a 1e que veio da fase 1):** em vez de voltar ao lobby com a partida
  guardada por trás (o desenho do plano), a pausa ganhou uma página com os 4 assentos ("P2: controle 2",
  "P3: desconectado", "P4: livre") e o que fazer embaixo. Decisão menor revisável: é o mesmo efeito (refazer os
  jogadores sem perder a partida) com bem menos estado, e a partida pausada nunca sai da tela.
  - **Abre sozinha** quando um controle do sofá cai (em qualquer edição) e, na LOCAL EDITION, em toda pausa do sistema
    (dock↔portátil, HOME, sleep: `Scene.pause()` da casca vira `systemPause` na partida). Na LOCAL EDITION a
    pausa principal tem o item Jogadores; na web ele não aparece (a coluna da pausa não cabe com 6 botões de toque).
  - **A num controle livre:** fica no lugar de quem caiu (o Joy-Con que encaixou no console e voltou como outro
    controle) ou, sem ninguém caído, entra na hora (sem segurar 1 s, como no meio da partida). **B no controle do
    P2–P4:** sai do sofá. O menu continua do P1; o frame em que alguém sentou não lê o menu (o A não vira Continuar).
  - O que já existia continua: o assento de quem caiu espera, e o controle que volta no mesmo índice (ou com o mesmo
    id em outro) senta sozinho. No portátil, 1 jogador = 1 vista já valia (as vistas são os assentos).
- **A bateria (3d, P5):** os logs do console no M1 mostram que o `getBattery` do nx.js devolve o nível (88–93%,
  carregando), então o item ficou: a casca guarda a leitura (`apps/switch/src/platform/battery.ts`, uma a cada 30 s)
  e passa por `GameDeps.battery` (sem mudar o contrato da `Platform`). A pausa mostra "Bateria 64%" (ou
  "carregando") e a partida avisa **uma vez** abaixo de 20% sem carregar, na plaquinha da dica da vista do P1.
- **Achado no Eden:** lá o `getBattery()` resolve, mas ler o `level` lança (não há o serviço `psm`); o erro saía do
  `then` como promessa rejeitada sem tratamento e o nx.js parava o boot. A leitura agora fica num `try` e a falha
  vira uma linha no `runtime.log` (`bateria: sem leitura (…)`); menu-ready no Eden em 1.472 ms.
- **3b (HOME e sleep)** continua sendo o vão por amostragem do M1: só o console confirma (roteiro, item 4).

### 15.7 Fase 4: o glifo do botão e o teclado do jogo (16/11/2026)

- **O teclado do jogo (4d):** `packages/game/src/onscreen-keyboard.ts`, no chunk dos editores (fora do menu da web).
  Duas páginas (letras e números; acentos e pontuação, só o que o nome do bot aceita), Maiúsc. de uma letra (como no
  celular; apagar tudo volta a maiúscula), Espaço, Apagar e OK, com **L apaga, R maiúsculas, B cancela**. Teclas de
  60 px de referência em linhas de 10 e a linha de controle em duas (a 640×360, o piso do texto não deixa 5 botões
  numa linha). O nome digitado vai na fonte de leitura, porque a dos títulos só tem maiúsculas, e a linha do
  contador avisa quando a próxima letra sai maiúscula.
  - **Quando abre (decisão menor revisável):** no Laboratório (o único campo de texto hoje: o nome do bot), quando
    não há teclado do sistema (`textInput.available` falso), quando ele não abre (o swkbd do Switch que devolve
    `null`), e na web quando quem confirmou foi o controle (para não largar o controle atrás do teclado do PC). No
    Switch, o swkbd continua sendo a primeira escolha.
  - **O que ficou de fora:** a opção "Teclado do jogo" nos Ajustes (o menu da web está a 1,7 KB do teto, e o
    automático acima cobre os casos). O "Sem teclado: role um nome" do Laboratório saiu: sempre dá para digitar.
  - Cancelar volta o nome e também o "tem mudança" de antes (o Voltar não pede confirmação à toa).
- **O glifo genérico do botão (4a e 4b):** na plaquinha das dicas da partida, um botão de face aparece como 4
  quadradinhos em cruz com o da vez cheio, no lugar de "Botão da esquerda". É a posição, não a letra nem a marca, então
  vale em qualquer controle e acompanha o remapeamento (o glifo sai do botão ligado à ação). É desenhado com os
  retângulos da UI (sem atlas novo nem programa de shader). Os textos dos menus ("Aperte A") continuam em texto: o A é
  o mesmo botão no Switch e nos controles padrão da web.
- **Prints (rodada 18, parte):** `local/m4/capturar-fase4.ts` (Edge headless com um controle falso pela Gamepad API):
  o teclado aberto, digitando, os acentos com a maiúscula e a página Jogadores.

### 15.8 Fases 5b, 5c e 7b: o aquecimento, sem plano B e o bench de 20 min (16/11/2026)

- **Medição antes de mexer (5b):** a partida agora registra os programas de shader do fim do aquecimento contra os de
  120 frames depois (`[partida] programas: 7 no aquecimento, 7 em 120 frames`; com diferença, a linha diz "compilou
  depois do aquecimento"). No Eden, com o Bobo Zombies de 4 vistas, são 7 e 7: as travadas do item 15 no console não
  são programa novo do three.
- **O desenho do aquecimento (5b):** o `warmup` dos passes de efeitos e de bonecos só compilava e escondia as malhas
  antes do frame fora da tela, então o 1º desenho de verdade de cada programa com cada estado (mistura aditiva,
  alfa, decalque, viewmodel) acontecia no 1º tiro, e é aí que o driver do console costuma terminar o trabalho. Agora
  `ScenePass.warmDraw()` deixa toda malha instanciada visível, sem corte por frustum e com 1 instância (os dados
  zerados desenham um ponto degenerado) e desenha a cena do viewmodel, tudo no pixel do canto, e desfaz. No Eden a
  etapa "shaders" passou de 693 para 791 ms (+0,1 s de loading), sem erro de GL e com os mesmos 7 programas. Se as
  travadas do item 15 somem ou não, só o console diz (`frames_lentos` e `inicio_ms` do bench).
- **Sem plano B no Switch (5c, P4):** o preset `planB` saiu da tela Testes e o `createSwitchRenderer` usa sempre
  array + atributo inteiro, mesmo com um `bench.json` que peça a outra rota (fica uma linha `[render]` no log). A web
  continua com as duas rotas. A sonda de boot das figuras (item 4 do T0) ainda desenha as duas rotas fora da tela: é
  pequena e passou em todos os boots do console.
- **O bench de 20 min (7b):** no lugar do plano B, o "Bench 20 min" (`zombies20`: Bobo Zombies na Base, 4 vistas,
  1200 s; o mesmo preset na dock e no portátil, quem muda é o console). O heap de cada minuto fica guardado na partida, e
  o relatório do bench ganha `heap_5a10`, `heap_15a20` e a `tendencia` (a P8: até +10%) na linha `memoria_mb`.

## 16. M5: online P2P (a partir de 16/11/2026)

Plano em `docs/PLANO_M5.md`. O pacote `packages/net` nasce aqui (só web; `apps/web` é o único que importa, regra 4).

### 16.1 Fase 1: o protocolo, sem rede (16/11/2026)

- **Pacote `net`:** importa `shared`, `format`, `input` e `sim` (o `platform-api` entra com o `OnlineService` na fase
  3); `ai` só nos testes (devDependency: o host do teste tem bots). Puro e sem relógio: quem chama passa o tempo do
  frame, e o loopback tem o relógio dele.
- **Contrato novo na sim, `Sim.remote` (decisão menor revisável):** o cliente não roda a sim, ele mostra o estado do
  host. `remote.begin()` copia o estado para os `prev*`; o `net` escreve os arrays da view (o único que escreve neles
  fora da sim); `remote.commit(state)` aplica os escalares (`SimRemoteState`: tick, contagens, partida, ondas), refaz a
  tabela controlador → entidade, devolve tábuas e portas à colisão e sincroniza a view. Assim o cliente usa a mesma
  `Sim` (mapa, colisão, view), e a predição da fase 2 roda o mesmo código. Snapshot e hash da sim não mudaram (o golden
  é o mesmo).
- **O que viaja (`net/src/schema.ts`):** só os campos da `SimView`, em inteiros: posição em 1 cm (20 bits; a diferença
  para a base em 10 bits quando cabe), mira nos mesmos 16 bits do InputFrame (a dos humanos e bots volta exata),
  velocidade em 5 cm/s, vida em 0,1, ADS em 1/255, recuo em 0,1 mrad; o resto é inteiro como está. As entidades têm 11
  grupos com um bit de "mudou" cada (4 quentes: posição, mira, velocidade e estado; 7 frios atrás de um bit), e dentro
  do grupo um bit por componente. Projéteis, pickups e os escalares da partida (placar, ondas, tábuas, portas, a Caixa)
  vão do mesmo jeito. Campo novo entra no fim do grupo e sobe o `PROTOCOL_VERSION`.
- **Snapshot (`net/src/snapshot.ts`):** delta contra o último snapshot completo que o cliente confirmou (o host guarda
  32, ~1 s a 30 Hz; ack mais velho ou nenhum = completo), dividido em partes de até 1.100 B. Ordem dos itens: os
  escalares, a entidade do próprio jogador, as outras pela distância até ela, projéteis e pickups. Cada parte se lê
  sozinha, e o snapshot só vale (é aplicado e vira base) com todas as partes. O cliente guarda 64 completos e monta até 4
  ao mesmo tempo. Host e cliente guardam os mesmos inteiros (o teste confere, inteiro a inteiro).
- **Entradas (`net/src/inputs.ts`):** uma mensagem por tick com o frame novo e os 3 anteriores, e o ack. No host, uma
  fila por cliente consome um frame por tick em ordem. Um frame perdido de vez é pulado. Sem frame novo, repete o último
  (o gatilho segue apertado). Com mais de 3 esperando, pula para perto do mais novo, somando os botões do que pulou (um
  toque de pulo não se perde). O snapshot leva o último `seq` usado, para a reconciliação da fase 2.
- **Drivers:** o `net` não importa o `game`, então o `MatchDriver` é repetido pela forma (`NetMatchDriver`).
  `createHostDriver(net, inner)` embrulha o `LocalDriver`: lê a rede antes dos ticks e manda o snapshot depois. O
  `writeHumanFrame` do driver de dentro chama `net.writeRemoteFrame` nos slots remotos. `createClientDriver` manda a
  entrada a cada tick e aplica o snapshot completo mais novo. O `alpha` anda do snapshot anterior ao novo ao longo do
  intervalo entre eles. O handshake (`hello` → `welcome` ou `reject`) leva o `PROTOCOL_VERSION`, a versão do jogo e o
  hash das tabelas que mexem na sim (`SIM_CONTENT_TABLES`). Quem está na versão mais antiga vê "atualize".
- **`createLoopback`:** a rede de mentira em memória, com latência, variação, perda e duplicação no canal não
  confiável, e com o confiável sempre em ordem. É determinística pela semente.
- **Critério 1 do plano:** host e 3 clientes, a 80 ms com 25 ms de variação e 5% de perda, jogam uma TDM de 40 s com 8
  bots até o fim. Nos 4, o resultado é igual: vencedor, placar, abates e mortes de cada entidade. O último snapshot de
  cada cliente é, inteiro a inteiro, o que o host guardou (`net/src/match.test.ts`). Números no `PERF.md` §1i.
- **De passagem, no `shared`:** o `checkBits` do BitWriter/BitReader montava a mensagem de erro em toda escrita. Agora
  só monta quando falha (a rede escreve milhares de campos por snapshot).
- **Desvio do plano:** os eventos da sim (tiro, acerto, morte, som) ainda não viajam. O cliente mostra o estado, sem
  efeitos e sem som. Eles entram na fase 2, pelo canal confiável, antes da sala (fase 4).

### 16.2 Fase 2a: os eventos pelo canal confiável (16/11/2026)

- **`net/src/events.ts`:** os 19 tipos de `SimEvent` com os campos na ordem em que viajam (`EVENT_SCHEMA`; tipo novo
  no fim, campo novo no fim do tipo). Ids em 32 bits, enums pelo índice, reais em f32 (o render usa o ponto e a direção
  exatos). Uma mensagem leva os eventos de até 255 ticks a partir do primeiro, com até 1.100 B.
- **Host:** `NetHost.recordEvents(events)` (o `onEvents` do `LocalDriver` chama a cada tick) escreve na hora. A
  mensagem aberta fecha na hora do snapshot, ou antes, quando enche, e vai a todos os clientes pelo canal confiável.
- **Cliente:** `EventQueue` lê para objetos de pool (um por tipo, no formato do evento da sim) e solta os eventos no
  `onEvents` do `ClientDriver` quando o snapshot aplicado chega no tick deles: o efeito e o som saem junto com o
  boneco. Como na sim, o objeto só vale durante a chamada.
- **Teste:** uma amostra de cada tipo (o TypeScript exige todos os campos, então campo que faltar no schema não volta
  igual) e os eventos de 20 s de partida com bots e granadas voltam iguais. Na partida pelo loopback, os abates chegam a
  cada cliente na mesma ordem do host, e nenhum evento sai antes do tick mostrado.
- **Banda:** os eventos somam ~2,6 KB/s por cliente (host → cliente 8,4 KB/s com 8 bots). Os reais em f32 são a maior
  parte: quantizar o ponto e a direção fica para a medição da fase 7.

### 16.3 Fases 2b e 2c: a predição do próprio boneco e os outros 100 ms atrás (16/11/2026)

- **Contrato novo na sim, `Sim.predict` (decisão menor revisável):** `save`/`load` do estado de movimento de uma
  entidade (`PREDICT_STATE_SIZE` = 16: posição, velocidade, flags, botões, coiote, pulo guardado, deslize e a recarga
  dele, direção do deslize, pico do ar e o atraso do tiro depois de correr) e `step(e, frame)`, um tick do movimento
  de uma entidade só com o mesmo código do `step`. Para isso, o `movementSystem` virou um laço sobre
  `moveBody(ctx, e)` (com `moveOne` para uma entidade) e o passo de entrada virou `applyInput(e, f)`, sem mudar
  nenhuma conta: o golden é o mesmo. Teste da sim: carregar o estado e repetir as entradas dá a mesma posição do `step`,
  bit a bit, por 600 ticks com pulo e deslize.
- **O bloco privado:** a 1ª parte do snapshot de cada cliente leva o estado de movimento do boneco dele (posição e
  velocidade em f32; o resto em 16 bits; ~50 B), além do último `seq` de entrada que o host usou.
- **Predição (2b):** o cliente move o próprio boneco a cada tick local (`Sim.predict.step`). A cada snapshot novo,
  carrega o estado do host e refaz as entradas guardadas depois daquele `seq` (até 64). O que não é movimento (vida,
  arma, munição, placar, caído) vem do snapshot mais novo. Nas flags, os bits de movimento (no chão, agachado,
  correndo, deslizando, mirando) ficam os previstos.
- **Os outros (2c):** ficam `INTERP_DELAY_S` (100 ms) atrás do host. O "tick mostrado" anda com o relógio do cliente
  e puxa devagar para "o snapshot mais novo + o tempo desde que chegou − 100 ms". A posição, a mira e a velocidade vêm
  da interpolação entre os dois snapshots em volta dele, e o resto do snapshot de antes. Os eventos saem nesse mesmo
  tick. Teleporte (mais de 3 m entre os dois) não desliza. Os outros ficam com `prev` igual ao atual, e o `alpha`
  do driver é o do passo fixo local (o do próprio boneco).
- **Medido no loopback** (80 ms ± 25 ms, 5% de perda; `net/src/match.test.ts`):
  - **predição:** erro médio de 0,02 a 0,06 cm por reconciliação; 1 a 3 das ~1.130 passaram de 10 cm (o host repetiu
    ou pulou uma entrada); os teleportes do respawn ficam fora da conta;
  - **interpolação:** a 0,37 cm do host em média e 2 cm no p99;
  - **banda:** o bloco privado sobe o host → cliente para 9,8 KB/s.
- **Revisão da fase 1 (um revisor independente):** o codec, os zeros e as partes passaram em 9.000 idas e voltas
  aleatórias. Corrigido:
  1. **A fila de entradas do host era funda de menos.** Ela pulava com 3 esperando e ficava com 1, então passava fome
     e pulava frames com a variação normal. Agora pula acima de 3 e fica com 2. Na simulação do revisor, os ticks com
     fome caíram de 77 para 2.
  2. **A fome não tinha limite.** Depois de 8 ticks sem entrada nova, o boneco para e solta o gatilho, e a mira fica
     onde estava.
  3. **Mensagem estragada.** Uma parte truncada completava um snapshot errado e a exceção escapava do laço. Agora a
     parte é lida antes de ser marcada, o snapshot dela é descartado, e o host e o cliente ignoram mensagens estragadas
     (`stats.bad`).
  4. **Despejo das partes pendentes.** A base é procurada antes de ocupar um slot, e a parte de um snapshot mais velho
     não despeja a de um mais novo.
  5. **Slot de projétil reaproveitado.** O dono entra na identidade do slot, então o projétil novo não desliza a partir
     do velho.
- **Pendente:** a predição do próprio tiro (o clarão, o som e o recuo saem já na tela do cliente, sem esperar o host)
  e a suavização da correção da reconciliação ficam para quando o online estiver na tela (fases 4 e 6). Antes delas,
  não dá para sentir.

### 16.4 Fase 2d: o tiro no que eu vi (16/11/2026)

- **Contrato novo na sim, `Sim.rewind` (decisão menor revisável):** `enable()` liga o histórico (`sim/src/rewind.ts`:
  24 ticks de posição, mira e flags de cada corpo, gravados no fim de cada `step`; ~1 MB, só no host online).
  `set(controller, ticks)` diz quanto o tiro hitscan daquele controlador volta no tempo. No `castRay`, voltando, cada
  alvo é posto onde estava (posição, mira e a postura daquele tick), testado com o tick antigo como chave do cache das
  caixas do boneco, e devolvido ao presente. Vivo e morto são os do presente. Foguete, granada e faca não voltam. O
  golden e o Switch não mudam: sem `enable`, nada é gravado.
- **A rede:** cada entrada do cliente leva o tick que ele mostrava dos outros (16 bits). O host, ao usar a entrada,
  põe na sim `tick atual − tick mostrado` para aquele controlador (`NetHostConfig.lagCompensation`, padrão ligado).
- **Desvio do tecnico.md §13.3 (o teto):** o plano dizia "rewind limitado a 200 ms". Medido no loopback a 80 ms de
  ida, o tiro precisa voltar **300 ms** (18 ticks): a ida do snapshot, os 100 ms da interpolação, a ida da entrada e a
  fila do host. Com o teto em 200 ms, o cliente acertava 7 de 25 tiros. O teto agora é `REWIND_MAX_S` = 350 ms:
  200 ms de rede (o ida e volta que o §13.3 queria cobrir), mais os 100 ms da interpolação, mais ~50 ms da fila. Acima
  disso, o jogador com rede ruim precisa mirar à frente.
- **Teste:** na sim, mirar onde o alvo estava 10 ticks antes acerta voltando 10 ticks e erra no presente. Pela rede
  (`net/src/lagcomp.test.ts`), o host anda de lado e o cliente mira no que vê, a 80 ms com 5% de perda: **25 de 25**
  acertos com a compensação, **1 de 25** sem.

### 16.5 Fase 3: o transporte de verdade (16/11/2026)

- **Dependências** (com o OK do Erick, O2): `@trystero-p2p/core` 0.26.0 e `@noble/secp256k1` 3.2.0, as do FutBobo
  (`docs/DEPENDENCIAS.md`). O `net` ganhou a lib DOM nos tsconfigs (os tipos do WebRTC e do WebSocket, como o
  `render`); o guard continua barrando os globais do navegador nele (regra 1), e a rede só existe nele (regra 4).
- **A sinalização Nostr** (`net/src/rtc/nostr-strategy.ts`) é a do FutBobo, sem mudar uma linha de código. Ela traz as
  correções que ele mediu no celular: o relógio errado (`since` = agora − 15 min e o desvio pelo `Date` do
  `net.json`), as ofertas velhas que os relays repetem e a vida dos sockets. O `appId` "boboforces" separa as salas
  dos dois jogos.
- **A sala** (`net/src/rtc/room.ts`, `joinNetRoom`) é o `NetEndpoint` sobre o Trystero:
  - **confiável:** a action `bf`;
  - **não confiável:** um `RTCDataChannel` negociado (`bf-u`, id 300, sem ordem e sem reenvio) na mesma
    `RTCPeerConnection`, sem sinalização nova;
  - **reserva:** se o não confiável não abre em 4 s, as mensagens dele vão pelo confiável (o reserva do §13.2);
  - **fila cheia:** com mais de 64 KB esperando no não confiável, a mensagem é descartada;
  - **numeração:** os amigos ganham números locais na ordem em que entram.
- **A sinalização local** (`createLocalJoinRoom`): as mesmas ofertas por um canal entre abas, que a casca passa (o
  `BroadcastChannel`). Serve para testar o WebRTC sem relay nenhum.
- **O teste de verdade** (`npm run rtc:web`, `apps/web/scripts/rtc-web.ts`): duas abas do Edge se acham pela
  sinalização local, conectam por WebRTC (os candidatos do próprio aparelho) e jogam uma TDM de 20 s com 6 bots.
  Medido:
  - conectaram em ~1 s, e o não confiável abriu nas duas;
  - foram 654 snapshots por ele (~30 Hz) e 985 eventos pelo confiável, sem nada pelo reserva;
  - a partida acabou com o mesmo placar e os mesmos abates e mortes nas duas abas;
  - a predição errou 0 vezes em 654 reconciliações.
- **A configuração:** `apps/web/public/net.json` (os 11 relays que o FutBobo mediu em 01/11 e o STUN da Cloudflare) é
  igual à cópia embutida (`DEFAULT_NET_CONFIG`), e o teste confere. Ela fica fora do service worker: nem precache, nem
  cache no fetch, porque o `Date` dela acerta o relógio.
- **O carregador** (`apps/web/src/online.ts`, `loadOnline`) baixa o chunk do `net`, o `net.json` (prazo de 2,5
  s; sem ele vale a cópia embutida) e acerta o relógio. Ainda não é chamado: a tela Online é da fase 4. Por isso o
  `net` ainda não está no bundle e o menu continua em 348,3 KB.
- **Pendente:** jogar pelos relays de verdade, entre aparelhos e redes diferentes. Isso é a sala (fase 4), o checkpoint
  com amigos (fase 8) e o TURN (O3). Os testes daqui não publicam nada em relay público.

### 16.6 Fase 4a: o protocolo do lobby (16/11/2026)

- **O código da sala** (`net/src/room-code.ts`): 5 caracteres de `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (sem 0/O/1/I). O que
  se digita vira maiúsculas, sem espaço nem traço. O link é `#sala=XXXXX` (o hash não vai a servidor nenhum).
- **O repartidor** (`net/src/mux.ts`, `createEndpointMux`): o lobby (o handshake e os tipos 7 a 11) e a partida
  (snapshot, entradas e eventos) usam o mesmo canal. O que é do outro lado fica guardado até o `poll` dele.
- **O lobby** (`net/src/lobby.ts`): mensagens JSON pelo canal confiável, poucas e raras. O host manda o estado inteiro
  a todos a cada mudança: o código, se está travada, o resumo da partida e os jogadores, cada um com slot, nome, time,
  Meu Bobo (o `bobo@1` como texto, até 4 KB) e pronto.
  - **Handshake:** o oi passou para o lobby, que responde com o welcome, sala cheia, sala travada (também depois de
    começar) ou versão diferente.
  - **O Trystero liga todo mundo com todo mundo:** o cliente manda o oi a cada amigo que aparece, e só o host
    responde.
  - **Saídas:** o host trava e expulsa. A saída do host fecha a sala ("host saiu = fim").
  - **O começo** leva a receita (o `game` valida), a semente e o controlador de cada um. A partida começa com o cliente
    já aceito: `NetHost.addClient(peer, slot, true)` e `ClientDriver` com o `welcome` do lobby.
  - **O que vem de um amigo é validado:** nome limpo de até 16 caracteres, time de −1 a 3, e mensagem estragada não
    derruba o frame.
- **Teste por loopback** (40 ms com 5% de perda):
  - entram 3 (os oi chegam fora de ordem) e o 4º ouve "cheia";
  - a versão nova ouve "seu amigo precisa atualizar";
  - o host trava, expulsa um, e quem chega depois ouve "travada";
  - o começo chega igual aos que ficaram;
  - do lobby à partida no mesmo canal, o cliente entra jogando sem handshake, e a saída dele chega ao lobby do host
    durante a partida.

### 16.7 Fase 4b: a partida com amigos na cena (16/11/2026)

- **O contrato do online fica no `game`** (`game/src/online-api.ts`; decisão menor revisável, como no plano). Ele fala
  de `Sim`, `SimEvent` e `InputFrame`, que o `platform-api` não enxerga.
  - **`OnlineSession`:** o papel, os humanos, o meu controlador, os dos amigos e se a sala fechou, mais
    `attachHost(sim)` e `attachClient(sim, …)`;
  - **quem implementa:** a casca web, com o `net` (`apps/web/src/online-session.ts`), entregando à cena pelo
    `SceneRequest.online`. No Switch ele não existe, e o `platform.online` segue nulo (regra 18).
- **A receita da sala** (`onlineRecipe`): cada um no time que escolheu, no lugar de bots do mesmo time; quem disse
  "tanto faz" vai para o lado com menos gente. O miolo do `seatRecipe` do sofá virou `placeHumans(recipe, sides)`, e o
  sofá não mudou (o P1 segue no time 0). Na cena, a receita online vale inteira, com só os limites do motor nos bots:
  o cliente num celular não corta o que o host montou (a sim mudaria). A distância de visão corta pelo aparelho, porque
  a sim usa a dela.
- **O driver da cena** (`scene/scene-driver.ts`, `createSceneDriver`):
  - **solo e sofá:** o `LocalDriver` de sempre;
  - **host:** o mesmo, com os controladores dos amigos lendo da rede, os eventos e o snapshot indo ao link, e quem sai
    virando bot pelo cérebro de reserva do sofá (M3);
  - **cliente:** a sim criada igual à do host (`createMatchSim`, tirado do `LocalDriver`) e conduzida pelo link, sem
    diretor;
  - a cena fala só com o `SceneDriver`. Diretor opcional (sem "Ajustar desafio" nem pings de bot no cliente), a sim
    não pausa no online e a sala fechada volta ao menu.
- **O "eu" da cena:** a cena supunha em 18 lugares que o jogador local é o controlador 0. Agora é `me = seatCtrl[0]`,
  o mesmo 0 no solo e no sofá; no online, o que o lobby deu.
- **Testes:**
  - a receita com times escolhidos e com "tanto faz";
  - o celular não corta os bots;
  - o driver do host e o do cliente com um online de mentira;
  - de ponta a ponta em Node (`apps/web/src/online-session.test.ts`): o lobby do `net` pelo loopback, o começo, as duas
    sessões e os dois drivers da cena. O amigo anda no host e o cliente vê o mesmo mundo;
  - o golden, o jogo e o `smoke:web` seguem verdes, o menu em 348,3 KB e o Switch com +4 KB.

### 16.8 Fase 4c: as telas do Online (16/11/2026)

- **O caminho:** título → Online (O4: ao lado de Modos; só aparece com `GameDeps.loadOnline`, que só a web passa) → o
  aviso de privacidade na 1ª vez → a casa (o nome, Criar sala, Entrar com código, Privacidade) → a sala → a partida (a
  cena de sempre, com a `OnlineSession`) → de volta à sala.
- **Onde mora:**
  - as árvores das telas em `ui/src/screens/online.ts` e os textos numa terceira tabela (`strings-online.pt-BR.ts`),
    registrada pelo fluxo ao carregar (o menu só ganhou a chave `menu.online`);
  - o fluxo em `game/src/online-screens.ts` (`@boboforces/game/online`). O `game.ts` só tem o botão, a tela `online`
    que delega ao fluxo, o "Usar na sala" da Partida personalizada e a volta da cena;
  - a sala de verdade em `apps/web/src/online-rooms.ts`: o contrato `OnlineRooms`/`OnlineRoom` do `online-api.ts`
    (decisão menor revisável, como o da 4b) feito com o lobby, o repartidor e o transporte do `net`.
- **Os pedaços do build (decisão menor revisável):**
  - o fluxo, as telas, a sala e o núcleo do `net` vão no pedaço da cena; só a rede de verdade
    (`@boboforces/net/rtc`: o Trystero, o noble, as sinalizações e a sala WebRTC) fica num pedaço próprio, de 28,5 KB
    com gzip, pedido junto ao abrir o Online;
  - **motivo:** com o `net` inteiro num pedaço próprio, a `sim` (que o núcleo dele usa) vira um pedaço comum com a cena
    e o empacotador (Rolldown) tira o núcleo do `format` do menu para pedaços à parte; o menu foi a 351,2 KB. Medido
    nas 4 montagens: com o `net` sozinho, 351,2; pedido do `main.ts` direto, 350,0; com o grupo "core" no
    `vite.config`, a `sim` entra na carga inicial; só o `rtc` à parte, 349,2 (o menu volta a ser um arquivo só);
  - **o custo:** quem joga solo baixa o núcleo do `net` e as telas do Online com a cena (~25 KB com gzip); a primeira
    partida fica em 831,9 KB de 1 MB. O teclado do jogo chega pelo pedaço dos editores (`createKeyboard`) pelo mesmo
    motivo (importado direto, ele vira pedaço comum e arrasta o `menu.ts`).
- **O perfil `online@1`** (`format/src/online-profile.ts`, chave `online` do storage, fora do backup): o nome (16
  caracteres, com o filtro do atlas) e a versão do aviso já lido (`ONLINE_PRIVACY_VERSION`; quando sobe, o aviso volta).
- **O aviso de privacidade (O5):** o texto é meu e espera a revisão do Erick antes de publicar. Diz que a conexão é
  direta (quem está na sala pode ver o IP), que os servidores públicos (Nostr e STUN) veem o código e o IP e nunca a
  partida, que não há conta, chat nem servidor do jogo, e pede para jogar só com quem se conhece (menor de 18 combina
  antes com quem cuida dele).
- **A sala:**
  - o código grande, os 4 lugares (nome, time, "host", "você" ou "no resultado"), o "Seu time" (laranja, azul ou tanto
    faz; some quando a partida não tem times), Copiar link e Sair da sala. O host tem também Começar, Escolher partida
    (a Partida personalizada de sempre, com "Usar na sala"), Trancar e Tirar;
  - Voltar não sai da sala (o host a fecharia para todos): leva o foco ao Sair da sala;
  - o lobby ganhou `playing` e `teams` no estado e o `reopen()` do host: no fim da partida a sala volta ao lobby, os
    amigos voltam a `in` e reenviam a escolha, e dá para começar outra;
  - o amigo valida a receita do host (regra 19) antes de entrar; se não passar, a sala acaba com o aviso;
  - os nomes que chegam de outro aparelho passam pelo filtro do atlas (o mesmo do nome de bot, agora em
    `game/src/names.ts`);
  - o código digitado aceita o link inteiro colado (sai do `#sala=`); sem ninguém responder em 20 s, "ninguém respondeu
    nesse código".
- **Na partida:** os humanos com o nome da sala (placar, kill feed e resultado); o amigo sem "Ajustar desafio"; o Sair
  da pausa do amigo sai da sala (um bot assume o lugar dele) e o do host leva todo mundo de volta à sala; o resultado
  online só tem "Voltar à sala"; a sala que fecha não tira ninguém do resultado.
- **O título no celular:** com o Online, a 4ª fileira de botões de toque não cabia (o logo saía da tela). No celular a
  Cena-vitrine sai do título; no PC, fica.
- **Testes:**
  - as telas cabem nos 6 alvos da web e no Switch, com o nome mais largo, e tudo anda no D-pad;
  - o lobby volta da partida e começa outra (`net`); o perfil `online@1` (`format`);
  - a sala da web por uma internet de mentira (`online-rooms.test.ts`): entrar, escolher time, começar, quem chega no
    meio é recusado, quem sai vira bot, a volta ao lobby, outra partida, o host sair, expulsar, sala cheia e o prazo;
  - o jogo inteiro com uma sala de mentira (`game.test.ts`): o aviso na 1ª vez, Criar sala, Começar, a partida do host
    e a volta à sala; o amigo pelo link colado, a sala, a partida, a volta e o Sair da pausa; a receita torta; o Switch
    sem o botão;
  - 1.795 testes; `smoke:web` e `rtc:web` verdes; menu 349,2 KB; Switch 2.996 KB.
- **Revisão (Opus), 5 correções:**
  - **o Começar espera quem está no resultado** ("Esperando Bia voltar do resultado."), e o lado "partida" do
    repartidor é esvaziado a cada começo (no host e no amigo): uma entrada velha de seq alta faria o host recusar as
    novas do amigo pela partida inteira, e um evento velho de tick alto travaria a fila dos novos;
  - **quem sai no meio vira bot pela diferença do estado do lobby**, e não pelo aviso do transporte: o "saí" do amigo
    costuma chegar antes do aviso do Trystero, e aí o peer já não tinha lugar (o teste agora entrega o aviso atrasado);
  - **o nome aparece enquanto é digitado** pelo teclado do sistema, com a dica "Digite e aperte Enter"; no controle,
    sem o teclado do jogo (o pedaço dos editores ainda não chegou), o do sistema não abre (sem Enter nem Esc, o
    jogador ficaria preso);
  - **o pedaço dos editores que chega atrasado** não abre a Partida personalizada da sala por cima de uma partida já
    começada;
  - **um começo torto** acaba a sala para o amigo em vez de derrubar o jogo; os nomes reserva ("Host", "Amigo 2") vêm
    da tabela; o resumo do host passa por um filtro do atlas do HUD (`cleanHudText`).
- **Visto no navegador:** o aviso, a casa e a sala com o código, no servidor de desenvolvimento. Essa sala, sem
  `?sinal=local`, anunciou o código pelos relays públicos (só a sinalização efêmera, como o jogo faz) e foi fechada em
  seguida.

### 16.9 Fases 4d e 4e: o link da sala e a prova pelo jogo de verdade (16/11/2026)

- **O link (4d):**
  - quem abre o jogo por `…#sala=XXXXX` cai no Entrar com o código já posto, depois do aviso de privacidade se for a 1ª
    vez; um aperto entra. Um link sem código válido abre a casa do Online;
  - a casca só repassa o hash (`GameDeps.onlineLink`); quem lê e valida o código é o pedaço do Online
    (`OnlineRooms.codeFromLink`), então o menu não ganha nada do `net` (+0,2 KB, 349,4 no total);
  - o hash não vai a servidor nenhum, e a casca o tira da barra assim que o lê (`history.replaceState`): quem
    recarrega, ou o jogo ao aplicar uma versão nova no título, não cai de novo na mesma sala.
- **A prova (4e, `npm run online:web`):** o build servido pelo `vite preview` e duas abas no Edge headless, pelo
  teclado, como um jogador:
  - o host vai do título ao Online, lê o aviso e cria a sala; o amigo abre o link e entra; o host começa; os dois jogam
    10 s pela rede (WebRTC de verdade entre as abas); o host sai pela pausa e os dois voltam à sala; o host sai da sala
    e o amigo vê "o host saiu";
  - o gancho `window.__bfDebug.online` dá o código, o papel, o estado e quantos estão na sala;
  - a aba de trás roda devagar (o navegador segura os quadros dela): o roteiro traz para a frente a aba que recebe a
    tecla e segura a tecla por 3 quadros do jogo;
  - **sinalização local** (`?sinal=local`, padrão): o amigo entrou em 1,9 s; depois de 10 s o amigo estava 7 ticks
    atrás do host (os 100 ms da interpolação);
  - **relays de verdade** (`--relays`, uma rodada só, como o jogo faz: eventos efêmeros de sinalização nos relays da
    `net.json` e o STUN da Cloudflare): o amigo entrou em 4,4 s; 8 ticks atrás do host; a volta à sala e o fim, iguais.
- **Os prints (4f):** `npm run online:web -- --prints` guarda em `local/m5/prints/` as 21 telas do caminho (título, aviso,
  casa, link, procurando, as salas do host e do amigo, Escolher partida, as duas partidas e pausas, o resultado online, a
  volta e o "host saiu") e o host num celular de 667×375 com toque. A aba que vai para trás volta pausada (o jogo pausa
  quando ela some; no online a partida não para): o roteiro só aperta Esc quando ela não está.


### 16.10 Fase 5a: as ausências (16/11/2026)

- **O host em segundo plano:** quando a aba some (`platform.lifecycle.onVisibility`), o driver do host avisa os amigos
  pelo canal confiável (`MSG.hostAway`, do lado "partida" do repartidor); os amigos também contam 3 s sem snapshot novo
  (`HOST_SILENT_S`) como host ausente. Ausente, o cliente não prediz nem manda entradas, e a cena mostra a faixa na
  plaquinha da dica:
  - **coop (Bobo Zombies):** "O host saiu do jogo por um instante." e a partida espera (`waitsForHost`);
  - **PvP:** "O host saiu do jogo: acaba em N s." e, aos 10 s (`HOST_AWAY_END_S`), o resultado do último snapshot. O
    host que volta depois de 10 s encerra a dele com o placar daquela hora (`Sim.finish()`, novo: a partida acaba com
    quem está na frente, ou empatada).
- **O amigo AFK ou com a aba escondida:** o host conta as entradas de verdade que chegam de cada amigo
  (`RemoteInputBuffer.activeReceived`: algo apertado, andando ou a mira mexendo). 60 s sem nenhuma (`AFK_S`) e um bot
  assume a vaga (o cérebro de reserva do sofá); a próxima devolve. Com o bot no lugar, a entrada do amigo não é lida (o
  tiro do bot não volta no tempo pelo que o amigo via). Medir pelo que chega, e não pela fila consumida, evita o vaivém
  da volta: a fila atrasada ainda tinha entradas paradas e o bot voltava logo depois de sair.
- **Testes:** o aviso e o silêncio de 3 s no `net` (a predição para e volta); o AFK de ponta a ponta pela sessão da web
  (61 s parado, o bot assume; um passo devolve); o driver da cena (o PvP acaba com o host fora por 10,5 s; não com 9 s
  nem no coop); a faixa e o resultado no jogo inteiro. 1.804 testes; menu em 349,4 KB.
- **No Edge headless** a aba de trás não fica "escondida" (o `online:web` não vê o aviso); o aviso fica coberto pelos
  testes do `net` e da cena.

### 16.11 Fase 5b: a queda e a volta (16/11/2026)

- **O id do aparelho:** 16 dígitos hexadecimais, sorteados na 1ª vez e guardados no perfil `online@1` (campo `id`). Vai
  no hello, que ganhou 64 bits no fim: o **protocolo passou a 2** (quem estiver no 1 ouve "atualize"; o `net.json`
  publicado acompanha). A recusa do host continua levando só o hello sem id.
- **O host lembra:**
  - quem sai durante a partida (por queda, pelo Sair ou pelo aviso do transporte) fica guardado pelo id; se o mesmo
    aparelho voltar com a partida rodando, entra mesmo com a sala trancada, no lugar antigo se estiver livre, e recebe
    o começo com o lugar novo. A sessão do host devolve a ele o controlador (que estava com um bot): o cliente antigo
    sai do `NetHost`, o novo entra, e o primeiro snapshot vai completo;
  - quem ele tirou fica barrado por id (`REJECT_REASON.kicked`: "O host tirou você da sala"), mesmo com a sala aberta;
  - de volta ao lobby, a lista de quem caiu se apaga (quem voltar entra como qualquer um).
- **O amigo que perde o host:**
  - se o host fechou a sala de propósito, ele avisa antes (`MSG.close`; a conexão só fecha 300 ms depois): "O host
    saiu: a sala acabou";
  - sem o aviso, a conexão caiu (a do amigo ou a do host): o amigo sai da sala do Trystero, entra de novo no mesmo
    código e manda o hello com o mesmo id, por até 20 s (`RECONNECT_TIMEOUT_MS`), com a tela "A conexão caiu: voltando à
    sala XXXXX…". No meio de uma partida, a cena fecha e abre de novo quando o começo chega (decisão menor revisável:
    trocar a conexão por baixo da cena seria mais trabalho para um caso raro).
- **Testes:** o lobby e o hello com o id; na sala da web, a queda no meio da partida (a internet de mentira derruba a
  conexão sem aviso): o amigo volta jogando, com o mesmo controlador, e o link do host entrega a volta; quem foi tirado
  é barrado ao tentar de novo e outro aparelho entra; o host que fecha não faz ninguém tentar voltar; sem o host,
  desiste em 20 s; no jogo, "voltando à sala" e de volta à partida. `online:web`, `rtc:web` e o smoke verdes; menu em
  349,4 KB.
- **De passagem:** os testes de áudio que sintetizam e renderizam (o `synth-game` e a música do Bobo Zombies) ganharam
  30 s de prazo: sozinhos levam ~2 s, mas passavam dos 5 s com a suíte inteira em paralelo.

### 16.12 Fase 5c: versões diferentes (16/11/2026)

- **Quem está na versão antiga** (a sala acabou com `update-self`): a tela diz "Seu jogo está desatualizado: falta a
  versão nova", o jogo pede ao service worker que procure agora (`UpdateService.check()`, novo e opcional: a web chama
  o `registration.update()`) e o botão Atualizar acende quando ela chega ("A versão nova chegou: aperte Atualizar.",
  com o foco nele); apertar aplica e recarrega (`apply()`, o mesmo do título). Sem service worker (o servidor de
  desenvolvimento), a linha diz para recarregar a página.
- **O host** fica sabendo de quem a versão recusou (`LobbyHost.onVersionReject`, com o veredito do lado dele, e
  `OnlineRoom.takeVersionNotice()`): "Um amigo tentou entrar com o jogo desatualizado: ele precisa recarregar a
  página." ou, quando é o host que está atrás, "Um amigo tem uma versão mais nova: atualize o jogo antes da próxima
  partida." (e a procura começa).
- **Quem está na mais nova** continua ouvindo "O jogo do host está desatualizado: ele precisa recarregar a página."
  (desde a 4a).
- **De passagem:** dois testes do `mapc` que montam o mundo e compilam o Construto ganharam prazo (6,4 s e 32,9 s com a
  suíte inteira em paralelo).

### 16.13 Fase 5d: ping e emotes (16/11/2026)

- **Pela sim, como os outros botões** (vale no sofá e no online; o evento vai aos amigos como os outros): os botões de
  aviso e de emote já existiam no `InputFrame` e no mapeador (aviso: botão do meio do mouse, N no outro perfil do
  teclado, direcional para cima; emote: B, direcional para baixo), mas nada os usava. O `signalSystem` (novo, depois do
  corpo a corpo) lê o aperto (`inButtons & ~prevButtons`) e solta o evento `signal`:
  - **kind 0, o ping:** o ponto onde a mira bate no que tapa a vista, até 80 m (sem bater, no fim do alcance);
  - **kind 1..4, os emotes:** um dos 4 balões fixos ("Boa!", "Valeu!", "Bora!", "Ops!"), e cada aperto passa para o
    próximo;
  - um aviso por bobo a cada 0,75 s, e segurar não repete. Os contadores ficam no `SimContext` (`signals`), fora do
    hash e do snapshot: o golden não mudou.
- **Na tela:** o ping aparece para o time de quem mandou (no FFA, só para ele) como o losango âmbar dos avisos dos bots,
  por 2,5 s; o emote vira um balão na plaquinha do HUD, em âmbar, em cima da cabeça do bobo, para todos, por 2,5 s (um
  balão por bobo: o novo troca o anterior).
- **Decisão menor revisável:** balões de texto no lugar das 4 poses do `arte-ux` (o contrato de emote do
  `ActorBuffer` ainda não existe). As 4 frases são da tabela (`emote.1..4`).
- **Testes:** a sim (o ping no chão olhando para baixo e no fim do alcance olhando para o céu, segurar não repete, o
  intervalo, o emote de 1 a 4 e de volta ao 1), o formato do evento pela rede, o balão no HUD (dentro da vista; fora
  dela, nada) e, no Edge, o balão e o ping numa partida em 3ª pessoa. Switch +6 KB.

### 16.14 A revisão da fase 5 (16/11/2026)

Um revisor (Opus) leu as 4 partes e achou 5 problemas e 3 menores, todos corrigidos:

- **AFK e depois saiu de vez:** a saída zerava a atividade (-1), o que parecia "voltou", e o bot soltava a vaga sem
  ninguém no lugar. Agora sem cliente não há o que medir, e o código da mudança separa "voltou do AFK" de "caiu e
  voltou" (`ONLINE_CONTROL`: `away`, `back`, `rejoined`, em `controlador * 4 + código`); só a volta depois de cair
  devolve o controlador à rede.
- **A volta antes de o host ver a queda** (o celular trocou de rede: o lado do amigo cai na hora, o do host só depois
  do prazo do ICE): o hello novo com o mesmo id ouvia "sala trancada" e a sala acabava. Agora o host tira a conexão
  antiga e trata a nova como volta; e o amigo que ouvir "trancada" ou "cheia" enquanto volta tenta de novo a cada
  1,5 s até o prazo de 20 s.
- **A queda e a volta na mesma leitura do lobby** (a aba do host parada): a diferença do estado não via a saída e a
  sessão não trocava o peer. Agora a volta põe a saída antes dela.
- **"Host ausente" falso no começo:** um amigo cuja cena carregava 3 s antes da do host (o celular demora) via a faixa e
  parava. Agora antes do 1º snapshot não é ausência (só o aviso do host conta).
- **O PvP acabando pela minha queda:** 10 s de silêncio também podem ser a conexão do amigo caindo, e aí a sala já
  tenta voltar. Agora só o aviso do host (`hostAwayNotified`) conta os 10 s; o silêncio mostra só a faixa.
- **Menores:** o id do aparelho sai do sorteio forte do navegador (`OnlineRooms.newDeviceId`, com o `crypto`; antes
  vinha de um RNG semeado pelo relógio do boot); `takeLeftSlots` e `takeRejoined` devolvem a mesma lista vazia em vez de
  alocar a cada quadro; o evento `signal` foi para o fim do esquema (os índices dos outros eventos não mudam).
- **Testes novos:** a queda só do lado do amigo (a volta pega o boneco e o aviso atrasado da conexão antiga não a
  tira), o AFK seguido da saída, o 1º snapshot demorado e o silêncio sem fim no PvP. O teste de capacidade da sim
  ganhou prazo (passava dos 5 s com a suíte em paralelo).

### 16.15 Fase 6a: a partida da sala (17/11/2026)

- **Os cards da sala** (`onlineMatchScreen`, no pedaço do Online): o mesmo desenho dos Modos (`modesScreen`, que
  ganhou o `titleKey`), com Times, Todos contra todos, X1, Bobo Zombies, Surpreenda-me e Personalizada. O Escolher
  partida do host abre os cards com o foco no último escolhido; Voltar volta à sala.
- **As receitas** (`game/src/online-presets.ts`, puro): feitas para 1 humano no time 0, como os presets do sofá, e o
  `onlineRecipe` põe os amigos no lugar de bots. Times: 4 contra 4 no Construto; Todos contra todos: 8 bobos; X1: TDM de
  1 por lado no Ringue, que não tem FFA (com 4 jogadores vira 2 contra 2); Bobo Zombies: o Sofá Zombies (Base
  Abandonada, 10 ondas, 3 bots de apoio). Todas com 5 min (o Zombies, sem tempo). O Surpreenda-me é o sorteio de
  sempre (`rollSurprise`, por `OnlineFlowDeps.surprise`); a Personalizada é a de sempre, e o Voltar dela volta aos
  cards sem mudar a partida.
- **Decisão menor revisável:** o X1 é um TDM e não um FFA, porque a arena pequena (o Ringue) não tem FFA. Com 2
  jogadores dá no mesmo; os presets "X1 Sniper" e "X1 livre" do GDD continuam para quando o FFA tiver arena pequena.
- **Teste** (`apps/web/src/online-modes.test.ts`): FFA (3 humanos e 5 bots), X1 (só os 2) e Bobo Zombies (2 humanos e
  1 bot de apoio, 1 onda, pool de 16) pela rede de mentira (60 ms, variação e 3% de perda), com os mapas de verdade. O
  amigo termina com o mesmo fim, placar, mortes, pontos, onda e portas que o host. FFA: 6,0 KB/s do host para cada
  amigo; X1: 3,0 KB/s; Zombies: 5,3 KB/s. Os 3 rodam em 12 s.
- **A tela dos Modos:** o teste de layout só montava 3 cards. Com os 6 de verdade, "PARTIDA PERSONALIZADA" passava do
  botão em 1280×720 (440 px em 416) e, no celular de 1334×750, o título entrava na margem de cima. O card agora diz
  "Personalizada" (`mode.name.custom`; o título da tela continua "Partida personalizada") e os cards ficaram mais
  justos (respiros menores). O teste monta os 6 cards nos dois lugares.

### 16.16 Fase 6b: o host no celular (17/11/2026)

- **O teto da sala** (`roomLimits` e `capRoomRecipe`, em `game/src/online-presets.ts`): o do aparelho do host como
  host (`hostMaxBots`/`hostMaxZombies` dos perfis: 8 e 16 no celular, 40 e 60 no PC). **Decisão menor revisável:**
  com um celular entre os amigos, vale também o teto do celular (12 bots, 24 zumbis, 90 m de visão), pela regra do GDD
  §2 ("no online vale o menor teto entre os participantes"), para o amigo no celular não desenhar 40 bots. A escolha de
  cada um leva `mobile` (`LobbyChoice.mobile`, só quando é `true`: um jogo de antes manda sem, e o protocolo não
  muda). O corte tira bots do lado com mais bobos, um de cada vez, do fim da lista (empate: o adversário do host), e
  baixa o `viewDistanceM`; dentro do teto, a receita fica a mesma (o mesmo objeto). O resumo que os amigos veem é o
  da partida cortada e muda quando um celular entra ou sai; o host vê "Com celular na sala, a partida vai com até N
  bots".
- **O pool de zumbis** (`LobbyStart.zombies`, 0..64): o host manda o dele (o `maxZombies` da sala) no começo, e a
  cena do amigo cria a sim com o mesmo número (`OnlineSession.zombiePool`). Antes, um amigo no celular (24) com host no
  PC (60) tinha uma sim de outro tamanho que a do host.
- **Os snapshots a 20 Hz:** `OnlineRooms.create(choice, snapshotHz)`; o flow pede 20 no celular e 30 no PC
  (`hostSnapshotHz`). O welcome leva o ritmo ao amigo, e a sessão do cliente usa o do welcome. A interpolação continua
  em 100 ms: a 20 Hz o p99 sobe de 2 para 5 cm (PERF §1i), invisível num bobo, e não vale somar 25 ms de atraso a
  todos os amigos de um host no celular.
- **O aviso:** na sala, o host no celular vê "Você é o host: não troque de app durante a partida" (`hints` da
  `onlineRoomScreen`, no lugar onde o amigo vê "Esperando o host começar"). O Wake Lock da partida já existia
  (`platform/lifecycle.ts`).
- **Testes:** os tetos e o corte (`online-presets.test.ts`); a escolha com `mobile` e o pool no começo
  (`lobby.test.ts`); a sala da web com celulares e o pool chegando à sessão do amigo (`online-rooms.test.ts`); o host
  no celular e o host no PC com um amigo no celular pelo jogo (`game.test.ts`); a partida do `match.test` também a
  20 Hz; e Times nos mapas de verdade a 20 e a 30 Hz (`online-modes.test.ts`). O layout da sala com as duas linhas
  novas cabe nos 6 alvos.

### 16.17 Fase 6c: a prova dos modos (17/11/2026)

- **`npm run online:web`** passa pelos cards: o host escolhe o X1 antes de o amigo chegar, os dois jogam 10 s no
  Ringue pela rede (WebRTC de verdade entre as abas), voltam à sala, o host escolhe o Bobo Zombies e os dois jogam na
  Base Abandonada (com o pool do host), voltam e o host fecha a sala. O roteiro confere pelo log do host que cada
  partida começou com o modo certo. Com `--prints`, as capturas novas: `partida-da-sala`, `sala-amigo-zombies` e
  `zombies-amigo`; a sala do host no celular já mostra o aviso.
- **O texto dentro do card** (`expectCardsFit` no `fonts-in-use.test.ts`): o `expectNoOverflow` só conferia a tela, e
  as capturas mostraram as descrições do X1 e do Surpreenda-me passando por baixo do card vizinho. Com a checagem nova
  nos 8 alvos, apareceram também as do Bobo Zombies (3 px) e do Training (12 px) nos Modos do Switch 4:3. Todas
  ficaram mais curtas; o respiro entre o botão e a descrição voltou a 8 (o contorno do foco encostava no texto).

### 16.18 A revisão da fase 6 (18/11/2026)

Um revisor (Opus) leu as 3 partes. Nada grave; 2 problemas e 6 menores, todos corrigidos:

- **O resumo era o da partida escolhida, não o da jogada:** no X1 com 4, os amigos liam "1 contra 1" e jogavam 2
  contra 2, sem bot (e sem o "Normal"). Agora o resumo sai da receita com os jogadores de agora nos times
  (`playedRecipe`: o teto e o `onlineRecipe`, o mesmo que o Começar monta) e muda quando alguém troca de time.
- **O aviso "até N bots" com bot nenhum cortado:** o `capRoomRecipe` devolve outra receita também quando só baixa a
  visão. O aviso agora compara o total de bots (`botsCut`).
- **Menores:** o foco do Escolher partida voltava no card da sala anterior (o `lastCard` volta ao Times numa sala
  nova); o comentário de um teste do corte dizia 7 bots onde são 8; a checagem do card confere também a borda de
  baixo, e o comentário do `expectNoOverflow` voltou para cima dele.
- **Testes que faltavam:** a cena do amigo cria a sim com o pool que veio na sessão (`game.test.ts`: 2 humanos e 5
  zumbis, e não os 60 do PC); o resumo cortado quando um celular entra e o inteiro quando ele sai ("10 contra 10" →
  "7 contra 6" → "10 contra 10"); o começo que volta para quem caiu leva o pool; e o teste dos modos cria cada sim com o
  pool da própria sessão, como a cena faz. Os mapas de verdade no Node ficaram num ajudante só
  (`apps/web/scripts/real-maps.ts`), que o bench de rede também usa.

### 16.19 Fase 7a: a rede à vista (18/11/2026)

- **Os números** (`OnlineNetStats` no `online-api`, `stats` nos dois links): bytes mandados e recebidos pela partida,
  amigos ligados, snapshots (montados no host, aplicados no amigo), o atraso do que o amigo mostra (ticks atrás do
  snapshot mais novo) e as reconciliações e predições erradas. A casca web conta os bytes num repassador do lado
  "partida" do repartidor (`countingEndpoint`, sem alocar por quadro: o `poll` passa sempre o mesmo repassador); o
  resto vem do `NetHost` e do `ClientDriver`. O `SceneDriver` expõe `net` e `lastNetMs` (o host mede o `receive`
  e o `afterTicks` com o `now` da cena).
- **O F2** (`DebugPanelModel.net*`): uma linha a mais só no online, "Rede (host)" ou "Rede (amigo)", com as taxas de
  cada segundo. Os textos ficam na tabela extra (o menu não paga).
- **A linha `[rede]`** a cada 30 s de partida online, com as médias da janela: no host, a rede, a sim e a IA por
  quadro, o fps, o que sobe e desce por amigo e os snapshots por segundo; no amigo, o que desce e sobe, os snapshots,
  o atraso, as predições erradas, o host ausente e o fps. As janelas usam o relógio da plataforma (KB/s de verdade): o
  `dt` da cena tem teto de 0,1 s, e a aba de trás contaria o tempo devagar. A 1ª amostra é a base (a carga e o 1º
  snapshot completo não entram).
- **O bench de rede** (`npm run bench:rede`, `apps/web/scripts/bench-rede.ts`, no Node): o host com os mapas de verdade
  (`real-maps.ts`), a IA e 3 amigos pela rede de mentira, nos casos do celular (8 bots, 20 Hz), do PC (40 bots, 30 Hz)
  e do Bobo Zombies (pool de 16 e de 60, com a horda no máximo). O relógio da rede envolve o `receive` e o
  `afterTicks` do link; o trabalho dos amigos de mentira fica à parte. Números no PERF §1i.
- **`online:web`:** `--partida N` deixa o X1 rodar N segundos (com 40, sai uma linha `[rede]` de cada lado, que o
  relatório guarda em `steps.rede`); com `--prints`, o F2 do host e do amigo.

### 16.20 Fase 7b: o roteiro e o Online escondido (19/11/2026)

- **O roteiro** (`docs/ROTEIRO_M5.md`): o teste com amigos da fase 8, com os critérios 2 e 3 do plano. O host no PC
  com 3 amigos (cada modo, ping e emote, as quedas, o AFK, o host ausente, Tirar e sair) e o host no celular (8 bots, o
  Bobo Zombies, trocar de app). O que mandar no fim: o relatório de cada aparelho, com as linhas `[rede]`.
- **Decisão menor revisável: o Online escondido no site** (`ONLINE_OPEN` em `apps/web/src/main.ts`). Para o teste
  com amigos precisar só do "pode publicar" (e não de abrir o Online ao público, O6), o título só oferece o Online:
  - no `npm run dev`;
  - com `?online` no endereço (o aparelho lembra, na chave `boboforces:online-teste`);
  - para quem abre o link de uma sala (`#sala=`);
  - no teste das abas (`?sinal=local`).

  Sem isso, o `loadOnline` não vai ao `startGame` e o título fica como antes do M5. Abrir ao público é
  `ONLINE_OPEN = true`. O `online:web -- --relays` abre o host com `?online`. O menu continuou em 349,5 KB.
- **No celular não há F2:** os números do host no celular (o critério 3) vêm das linhas `[rede]` do "Copiar relatório",
  que trazem o fps, a sim, a IA e a rede (fase 7a).

### 16.21 Fase 7c: a rodada 20 de prints (19/11/2026)

- **As capturas novas** (`npm run online:web -- --prints`): os Modos no PC e no celular (do título: baixo e
  confirmar, e o roteiro recarrega a página para o foco voltar ao Jogar), e a faixa do host ausente no Bobo Zombies. Para
  ela, o roteiro para o JavaScript da aba do host pelo depurador do Edge (`Debugger.pause` numa sessão CDP), como o
  celular que suspende a aba sem avisar; o amigo vê a faixa depois de 3 s e a partida espera. O
  `Page.setWebLifecycleState` (congelar) não pegou no headless.
- **A página** (`local/m2/montar-pagina-r20.mjs`, por cima do montador gerado da rodada 19): seções 88–94 e as
  perguntas T1–T5; as imagens da rodada 19 saem das cópias dela (`pagina-r19/`), porque o `local/m5/prints` foi
  recapturado com outras partidas. Publicada como versão 24 da página das rodadas.

### 16.22 A revisão da fase 7 (19/11/2026)

Um revisor (Opus) leu as 3 partes e achou 5 problemas e 3 menores, todos corrigidos:

- **Os snapshots por segundo do host saíam divididos pelos amigos:** o contador do `NetHost` é um por snapshot (para
  todos), não um por amigo. Com 3 amigos a 20 Hz, o F2 mostrava 7. Agora só os bytes são por amigo.
- **O Online escondido sumia para quem veio pelo link e recarregou:** o hash sai da barra no boot, e o Atualizar (versão
  antiga) ou a aba que o Android descarta recarregam sem ele. O link agora também fica lembrado no aparelho.
- **A aba de trás diluía a média de 30 s:** o `sampleNet` só roda com quadros, e a janela seguinte dividia pelo tempo
  parado (2 min no WhatsApp viravam "fps 7"). Uma amostra que chega depois de 2,5 s recomeça a janela.
- **O "por amigo" usava os amigos do fim da janela:** agora soma amigos × segundos a cada amostra.
- **A base:** a 1ª janela começa quando a partida anda (o host mandou o 1º snapshot; o amigo já mostra um), sem a carga
  de cada lado nem o 1º snapshot completo.
- **Menores:** o roteiro das abas solta o JS do host num `finally` (uma captura que falha não deixa a aba parada); o
  repassador dos bytes devolve o handler de antes; o PERF diz que os KB/s são da carga útil (sem o envelope da WebRTC).
- **Testes novos:** a linha do host com 3 amigos (10 snapshots/s, 10 KB/s por amigo) e 2 min de aba atrás que não diluem
  a linha seguinte do amigo.

### 16.23 O Online no ar (19/11/2026)

- **Decisão #80:** o Erick pediu para publicar e deixar o Online aberto. `ONLINE_OPEN = true`; o push `153bcce..2980ed8`
  levou o refino, o M4 sem o console e o M5 até a fase 7 (46 commits). CI e deploy no Pages verdes.
- **No site publicado:** o `smoke:web -- --url` passou (na 1ª rodada o splash levou 1,13 s, com a CDN fria logo depois
  do deploy; na seguinte, dentro do 1 s). O `online:web -- --relays --url https://erereck.github.io/boboforces/` (a
  opção nova `--url` roda o roteiro das abas contra o site, sem o servidor local) jogou o X1 e o Bobo Zombies entre duas
  abas pelos relays de verdade: o amigo entrou em 5,0 s, e a sala acabou para ele quando o host saiu.
- **O que fica para o Erick** (fases 8 e 9 do plano): o teste com amigos (`docs/ROTEIRO_M5.md`), o TURN (O3) e a revisão
  do aviso de privacidade (O5), que foi ao ar com o texto do Claude.

## 17. M6: modos de festa (plano em `docs/PLANO_M6.md`)

### 17.1 Fase 0: a página Mais modos (19/11/2026)

- **O card:** nos Modos, o Bobo Training deu lugar a "Mais modos" (os 6 cards já ocupavam as 3 fileiras que cabem no
  celular). A página (`screen: 'more'`) usa o desenho dos Modos (`modesScreen` com `titleKey`); os cards e as receitas
  (`MORE_MODE_CARDS`, `moreModePreset`, em `game/src/more-modes.ts`) e os textos (a tabela extra) moram no pedaço dos
  editores, fora do menu da web (349,7 de 350 KB). Cada card começa direto, como o Bobo Zombies dos Modos.
- **Decisão menor revisável:** o Training foi para a página nova, como 1º card (fica a 2 cliques). A pergunta vai à
  próxima rodada de prints.
- **Achado:** a chamada `registerStrings(STRINGS_EXTRA_PT_BR)` solta no topo do `editors.ts` sumia do build da web (o
  pacote é `sideEffects: false`): antes da 1ª partida, os textos da tabela extra (a frase de ajuda da Partida
  personalizada e a página nova) ficavam crus. Agora o `editors.ts` exporta a tabela (`EXTRA_STRINGS`) e o `game` a
  registra ao receber o módulo; no build, a tabela foi para um pedaço que os editores e a cena dividem.

### 17.2 Fase 1: Domination (19/11/2026)

- **A sim** (`sim/src/systems/domination.ts`, passo entre o dano e as regras): os pontos vêm do mapa
  (`markers.domination` → `SimMap.controlPoints`), só com `mode: 'warfare.domination'`. O progresso vai de -1 (do time
  1) a +1 (do time 0): o ponto do outro time primeiro volta a neutro. Captura em 5 s com 1, 3,75 s com 2 e 2,5 s com 3+;
  com os dois times em cima, nada anda; vazio, volta devagar ao estado do dono. Cada ponto dominado soma 1 por segundo
  ao time (`scoreTicks`); os abates não contam no placar do time. O estado entra no hash e no snapshot da sim só nesse
  modo (`SNAPSHOT_VERSION` 11; os goldens do Warfare e do Zombies não mudaram). Evento novo: `point` (`captured` ou
  `neutralized`).
- **A IA** (`pickPointGoal` no `soldier.ts`): no Domination, o objetivo de passeio é um ponto. Um ponto do time sendo
  tomado vem primeiro; quem ataca vai ao ponto que não é do time (o mais perto, às vezes outro); 1 em cada 3 defende.
  Golden: 4 contra 4 bots Normal no Construto, `97f2f078` (capturas 2/3, o time 1 fecha 200 a 101).
- **O HUD:** embaixo do placar, A, B e C na cor do dono, com a barra da captura na cor de quem ganha o ponto
  (`HudSharedModel.points`); em cima de cada anel, a letra (`HudModel.pointMarks`); no kill feed, "Laranja capturou
  Ponto B". O anel do chão do Construto ainda não muda de cor.
- **A rede:** o dono e o progresso (em milésimos) de cada ponto entram nos globais do snapshot, só nesse modo, e o evento
  `point` no fim do esquema: `PROTOCOL_VERSION` 3. Pela rede de mentira, com o Construto de verdade, o host, 1 amigo e
  6 bots terminam com os mesmos pontos e o mesmo placar (5,2 KB/s do host para o amigo).
- **Os menus:** o Domination entra no ciclo de modos da Partida personalizada (Times → Todos contra todos →
  Domination → Zombies; com os times do TDM e a meta 200), e por ela na sala do Online; o Construto lista o modo no
  `.bfmap`.

### 17.3 Fase 2: Gun Game e Infection (19/11/2026)

- **A receita:** os dois são regra sobre o Warfare, sem modo novo (e sem nome novo no menu, que está no teto). O Gun
  Game é `weapons.ladder` (ids de arma, 2 a 12, na ordem) sobre o FFA; o Infection é o bloco `infection` (`speed`, a
  velocidade dos infectados, padrão 1,2) sobre os Times. O validador conhece os dois.
- **A sim** (`sim/src/systems/party.ts`, `ctx.party`):
  - **Gun Game:** o nível mora nos pontos (`SimState.points`, que o snapshot e a rede já levam; o protocolo não muda). O
    loadout do spawn vira só a arma do nível (`partyLoadout`); o abate sobe um nível e troca a arma na hora
    (`partyKill`); morrer pela faca desce um; quem abate com a última arma vence (`winnerEntity`); no fim do tempo,
    vence o nível mais alto (o `leader` do FFA olha os pontos).
  - **Infection:** time 0 sobrevivente, time 1 infectado. Na largada, sem infectado, um sobrevivente sorteado
    (`rngParty`) vira infectado na hora; quem morre vira infectado ao renascer (a faca e a velocidade pelas regras do
    bobo, `rules.speed`). O `partySystem` põe no placar quantos há de cada lado e decide: ninguém sobrou, os
    infectados; o último tick do tempo, os sobreviventes. O `rulesSystem` encerra com o que o modo decidiu.
  - O estado (o sorteio, quem venceu) entra no hash e no snapshot da sim só nesses modos (`SNAPSHOT_VERSION` 12).
- **Goldens** (8 bots Normal no Construto, semente 42): Gun Game `6595bdd9` (um bot fecha a escada em 3.707 ticks);
  Infection `ffb3e5cb` (os 8 infectados em 7.648 ticks). Os do Warfare, do Zombies e do Domination não mudaram.
- **O jogo:** os cards Gun Game e Infection na página Mais modos (`moreModePreset`). No Gun Game, o HUD mostra "NÍVEL n"
  no lugar dos abates (`HudModel.pointsIsLevel`); nos dois, a tela de morte não oferece a escolha da arma. O infectado
  tem a cara do bobo-zumbi comum (a figura troca quando o time muda, inclusive o 1º infectado, que muda vivo).
- **Espaço no menu:** as ações das telas de edição (Partida personalizada, Laboratório e Oficina) foram para um módulo só
  delas (`ui/src/screens/editor-actions.ts`). Com as ações no mesmo arquivo da tela, o `game.ts` (o menu) puxava a tela
  inteira para o pedaço do menu; agora as telas vão com os editores, e o menu caiu de 349,8 para 349,1 KB.
- **O infectado pela rede:** a velocidade dele (1,2x) mora nas regras do bobo, que não viajam no snapshot; a predição do
  amigo infectado andava como sobrevivente e era puxada de volta a cada snapshot. Agora o `Sim.remote.commit` acerta a
  velocidade pelo time (que viaja). Teste: o amigo infectado desde o começo, 0,4% de predições erradas (21 em 5.308).

### 17.4 Fase 3: Juggernaut (19/11/2026)

- **A receita:** `mode: 'juggernaut'` (o id de conteúdo já existia), com os caçadores no time 0 e o time 1 vazio; o
  card é a variante Rodízio (`moreModePreset('juggernaut')`: Construto, 8 bobos, 150 pontos ou 10 min). O modo joga
  com as regras do Warfare (`isWarfareMode`: regeneração, respawn, caixinha de munição). A variante Fixo (rodadas de
  3 min com rodízio) fica para quando houver rodadas (BoboStrike, M7).
- **A sim** (`sim/src/systems/party.ts`, `PartyState.jugg`):
  - O Jugg é o único bobo do time 1. Na largada (e sempre que falta um), um caçador vivo sorteado (`rngParty`) vira o
    Jugg; quem dá o golpe final no Jugg vira o próximo na hora (o time, a vida cheia de Jugg, só a Big Brrt na mão), e o
    caído volta a caçar (renasce com o loadout e a vida de sempre).
  - **As regras do Jugg** (vida de `300 × caçadores`, mínimo 1000; 0,75x; `headshotImmune`; reserva infinita) vão nas
    regras do bobo (`ctx.rules`, fora do estado). As de antes ficam guardadas em `PartyState.jugg` e voltam quando ele
    cai. Como as regras saem do time (que o estado leva), o `syncJuggRules` as acerta a cada tick no host, ao ler um
    snapshot e no `Sim.remote.commit` do amigo (a predição do amigo Jugg anda a 0,75x como no host).
  - **Os pontos:** cada segundo vivo como Jugg vale 1 ponto (`SimState.points`; o relógio do segundo é
    `PartyState.juggTicks`). A meta (`scoreLimit`) dá a vitória a ele (`winnerEntity`); no fim do tempo, o `leader`
    olha os pontos de cada um, como no FFA (o Juggernaut é de cada um, mesmo com os caçadores no mesmo time). O placar
    dos times não anda.
  - **Os spawns:** todos começam espalhados (o sorteado não nasce no meio dos caçadores) e os caçadores renascem em
    qualquer ponto (longe do Jugg), não numa base.
  - O estado (o sorteio, o vencedor, `juggTicks`) entra no hash e no snapshot só no modo (`SNAPSHOT_VERSION` 13).
- **A Big Brrt** (`WEAPON_BIG_BRRT` = 12, fora de `WEAPONS` como o Desmontador): 15 de dano, 1200/min. O pente é o
  calor: 120 tiros são os 6 s de fogo contínuo; parada por 0,3 s, ela esfria 60 tiros por segundo; no zero, a recarga
  (2,5 s) é o superaquecimento. O modelo (`model:big-brrt`, 15 caixas, 180 triângulos: o feixe de 4 canos, a caixa de
  munição amarela, a alça) usa a 31ª das 32 camadas do `modelos64`; o tiro é o da SMG uma quarta abaixo, 20% mais
  baixo.
- **A IA:** no Juggernaut, o passeio do caçador é um nó a até 5 m do Jugg (o grupo cerca, em vez de fazer fila) e o do
  Jugg é o caçador vivo mais perto (`pickJuggGoal`).
- **O jogo:** o HUD mostra os PONTOS de Jugg e, para o Jugg, a vida dele (a mesma conta da sim); a plaquinha JUGG fica
  sempre na tela de quem caça (`projectToEdge`: fora da vista ou atrás, vai para a borda na direção dele); o kill feed
  avisa "Fulano virou o Jugg"; o placar do alto mostra só o relógio; o resultado é de cada um (o vencedor e os pontos).
- **A rede:** nada novo no protocolo (o time, a vida e os pontos já viajam); a Big Brrt, o Jugg e os pontos do
  Domination entraram no hash de conteúdo (quem está com o jogo velho vê "Atualize a página").
- **Golden** (8 bots Normal no Construto, semente 42, 3 min): `f7c0ff3a`, com 4 Juggs e o melhor com 71 pontos. Os
  outros goldens não mudaram.
- **A revisão (Opus)** achou 7 coisas, corrigidas antes do commit:
  - **(alta)** quem a sala ou o sofá punha no time 1 começava Jugg com 100 de vida (ou dois Juggs). Agora todos nascem
    caçando (o `createSim` põe o time 0 no Juggernaut), o `juggernautSystem` rebaixa qualquer Jugg a mais, e a sala e
    o sofá não oferecem a escolha de time no modo;
  - a Big Brrt não recarrega no botão (o R do bot no passeio a travava 2,5 s): só o superaquecimento trava;
  - o som do fim é o de cada um (`soloWinner`), como o resultado;
  - a predição do amigo acerta as regras do Jugg pelo time mais novo (`SimPredict.load`), e a barra de vida do Jugg
    não passa do cheio enquanto os times atrasados chegam;
  - o Destravar que manda o Jugg para um spawn não o cura nem dá proteção;
  - o placar do Tab é de cada um (pelos pontos de Jugg) e o Ajustar desafio mexe em todos os bots;
  - o P1 que vira o Jugg continua com o Meu Bobo.
- **O smoke da web** (`scripts/smoke-web.ts`): o mesmo build deu de 0,4 a 3,1 s de splash no runner do CI (a 1ª aba de
  um navegador recém-aberto paga a partida do processo da GPU), e o CI do 72a34e5 caiu por isso. Acima do limite, o
  splash é medido de novo em até 2 abas novas e vale a menor (`splashTriesMs` no relatório). Decisão minha, revisável.
- **Online:** o amigo caçando numa sala de 90 s (a meta não chega): o Jugg troca de mãos igual nos dois lados, o mesmo fim e os mesmos pontos, 0,33% de predições erradas (9 em 2.694).

### 17.5 Fase 4a: os modificadores e o Bobo Chaos (19/11/2026)

- **A receita** (`format`): `modifiers` (lista de ids de `MODIFIERS`, em qualquer modo; o índice na lista é o bit da
  máscara da sim, então a lista só cresce no fim) e `chaos` (a Roleta: `count`, padrão 3; `everyS`, padrão 60). O
  validador tira repetidos, desconhecidos e os que conflitam (`MODIFIER_CONFLICTS`: a Lua e a gravidade pesada).
- **A sim** (`sim/src/systems/chaos.ts`, `ctx.chaos`):
  - O estado são 3 números (`masks`): a máscara ligada, a da próxima troca (igual fora do aviso) e os ticks até ela.
    Entram no hash e no snapshot (`SNAPSHOT_VERSION` 14), com o `rngChaos`.
  - O `chaosSystem` roda antes do movimento (a gravidade nova vale no mesmo tick): na largada sorteia `count` do que
    não está ligado e não conflita; 5 s antes da troca, um da Roleta (nunca um fixo) sai e outro entra; na troca, a
    próxima vira a ligada.
  - O `applyChaos` (quando a máscara muda) troca o perfil de movimento da partida (`ctx.profile`, agora mutável: um dos
    6 feitos na criação, gravidade × velocidade, sem alocar; o `ProfileTicks` do movimento recalcula pela identidade
    do perfil) e liga só na cabeça e um tiro mata na cópia das regras de arma (`ctx.mods`). Os outros olham a máscara
    na hora (`modOn`): munição infinita (`weaponSystem`, como o pente infinito), Vampiro (`damageSystem`: quem fere um
    inimigo ganha o que tirou, até a vida máxima), Tudo explode (`kill`: a explosão `CHAOS_BLAST`, código 13, de quem
    morreu) e a troca por abate (`kill`: uma primária sorteada, fora dos modos de festa).
- **A rede:** os 3 números vão como globais (`chaosActive`, `chaosNext`, `chaosLeft`) só nas partidas com
  modificador; o `Sim.remote.commit` aplica a máscara que chegou (a predição do amigo anda com a gravidade e a
  velocidade do host). `PROTOCOL_VERSION` 4.
- **O jogo:** o card Bobo Chaos (Times 4 contra 4, 50 abates ou 10 min); a linha dos ligados embaixo do placar
  (`HudSharedModel.modsLine`, refeita só quando a máscara muda) e, no aviso, "ROLETA: SAI X, ENTRA Y" em destaque; a
  aba Modificadores da Personalizada com Pressa, Vampiro, Tudo explode, troca por abate e a Roleta (a gravidade, só na
  cabeça e um tiro mata já estavam lá).
- **Golden** (Bobo Chaos, 8 bots Normal, semente 42, 3 min): `9c9aabae` (a largada e 2 trocas; 24 × 21). Os outros
  não mudaram. **Online:** a Roleta a cada 20 s numa sala de 90 s, a máscara igual nos dois lados e 0,45% de predições
  erradas (12 em 2.685).
- **A revisão (Opus)** achou 12 coisas (7 médias, 5 baixas; nenhuma de determinismo), corrigidas antes do commit:
  - a predição do amigo usava a máscara do snapshot atrasado (um puxão a cada troca de gravidade ou de velocidade):
    agora o `reconcile` passa a do snapshot mais novo (`SimPredict.modifiers`, `ChaosState.predictMask`), e a view
    continua com a do atrasado;
  - a **gravidade pesada** não baixa mais o pulo (a 0,44 m, nem o Tático nem o Bobo alcançavam as ligações de pulo de
    1 m da navegação, e os bots travavam): ela só faz cair mais rápido. A **Lua** não tem dano de queda (o pulo dela
    passa da queda segura de 5 m);
  - o Vampiro só cura bobo (no zumbi, o teto era a vida de bobo e cortava a do zumbi);
  - o Tudo explode não roda no Infection e no Juggernaut (o time de quem morre troca antes de a explosão ferir); no Gun
    Game, quem já morreu não sobe de nível pelo abate da própria explosão;
  - a munição infinita não vale para a granada (saíam 8 por segundo) nem para a Big Brrt (o pente dela é o calor);
  - a troca por abate respeita as armas permitidas, não dá primária a quem não tem (só faca), não roda no Bobo Zombies
    e troca de verdade (o tempo de troca, o evento e o som);
  - a Roleta não põe "um tiro mata" com "tudo explode" (a corrente matava todo mundo em volta), e os bots miram na
    cabeça quando só a cabeça fere;
  - a linha dos modificadores aparece também com a linha da onda e no quadrante livre do 3P, e quebra em duas quando
    não cabe;
  - a Personalizada mostra e desliga os 9 (Lua e gravidade pesada ganharam linha; "só na cabeça", "um tiro mata" e a
    munição mostram e desligam também o modificador).
- **O menu:** 349,5 de 350 KB (o validador mora no menu). Ver os riscos do PLANO_M6.

### 17.6 Fase 4b: Cabeção, Invisíveis e Festa (19/11/2026)

- **Os ids** `bigHead`, `invisible` e `confetti` entram no fim de `MODIFIERS` (bits 9 a 11: os presets da 4a não
  mudam). Novo conflito: Invisíveis com um tiro mata (o exemplo do GDD §4.5.3).
- **Cabeção:**
  - Na sim, o `FigureHitCache` (`setHeadScale`, chamado pelo `applyChaos`) cresce a caixa da cabeça 2x a partir do
    pescoço: as meias medidas dobram e o centro sobe meia altura pelo eixo de cima da caixa. A fase larga ganha 0,55 m
    no topo e 0,2 m no raio (a caixa da cabeça tem 0,44 m de altura: em dobro, o topo sobe 0,48 m com a cabeça
    inclinada).
  - No render, o `ActorBuffer.headScale` escala o osso da cabeça (a origem é o pescoço), e o cabelo e o chapéu, que
    copiam o osso, vão junto (sem o recorte no teto, que é para a cabeça normal). Só as poses recalculadas são
    escaladas (a "shifted" soma o deslocamento ao quadro anterior, já escalado); quando a escala muda, todo boneco
    recalcula, inclusive os manequins. A esfera do LOD da animação cresce junto.
  - Teste: tiros de sniper 25 e 50 cm acima do centro da cabeça erram normalmente e acertam a cabeça com o Cabeção.
  - A IA ainda mira e enxerga pelo centro da cabeça normal (que fica dentro da grande: os tiros dela acertam), e a lag
    compensation usa a escala do tick atual (na troca da Roleta, por até 350 ms o tiro do amigo vê o outro tamanho).
- **Invisíveis:**
  - Na cena, os bobos que não atiraram (nem golpearam, nem lançaram foguete ou granada) no último segundo não entram
    nos atores (o corpo, o cabelo e a sombra somem), não puxam a mira assistida (`hiddenNow`) e não mostram o balão
    de emote. O próprio corpo dos jogadores da tela fica (em 3ª pessoa e no sofá). Quem morre invisível solta só o
    "poof", no lugar certo (sem pose recente para desmontar).
  - Na IA, o `canSee` não vê quem não atirou no último segundo (`SimView.lastShotTick`, o tick do último tiro da sim),
    a não ser a menos de 2 m.
- **Festa:** a cena solta 2 punhados de 4 cubinhos de confete (as cores do "poof" da morte) em cada acerto e em cada
  impacto, no máximo 4 pedidos por quadro (a Big Brrt são 20 tiros por segundo).
- **Os conflitos e a regra de arma:** o "um tiro mata" da regra de arma (`weapons.oneShot`) conta como o modificador:
  o validador tira os modificadores que conflitam com ele, a Roleta não os sorteia (`ChaosState.baseBits`) e a
  Personalizada desliga um quando liga o outro. Passar para o Bobo Zombies na Personalizada tira os modificadores e a
  Roleta (o modo não tem a aba).
- **A revisão (Opus)** achou 15 coisas (1 alta: a fase larga cortava o topo da cabeça grande; 6 médias), corrigidas
  antes do commit, menos duas baixas que ficam anotadas acima (a mira da IA e a lag compensation na troca).
- **Golden** do Bobo Chaos com os 12 modificadores: `c1b4cd36` (Lua, Pressa e Cabeção; sai a Lua e entra a Festa; sai o
  Cabeção e entram os Invisíveis; 25 × 31). Os outros não mudaram.
- **Ficam para depois:** Mini e Bots gigantes (a sim escala as hitboxes de um corpo com o `bodyScale`, mas a caixa de
  colisão, a câmera e a navegação não), Arcade e Ricochete.

- **Espaço no menu (antes do Paintball):** os 166 textos da Partida personalizada, do Laboratório e da Oficina
  (`custom.*`, `lab.*`, `labIntro.*` e `workshop.*`, menos os 3 que as Configurações usam) foram para a tabela extra,
  que chega com os editores logo depois do 1º quadro do título (as telas deles já moravam lá). O menu caiu de 349,5
  para 347,8 KB.

### 17.7 Fase 5: Bobo Paintball (19/11/2026)

- **A receita:** `mode: 'paintball'` com o bloco `paintball` (`hits`, 1 a 3, padrão 1). O card (`moreModePreset`):
  Times 4 contra 4 no Construto, 50 abates ou 5 min, `respawnS` 1 e a reserva infinita. O modo joga com as regras do
  Warfare (`isWarfareMode`), menos a regeneração e a caixinha de munição.
- **As armas de tinta** (`WEAPON_PAINT_*`, códigos 14 a 17, fora de `WEAPONS` como a Big Brrt):
  - O Marcador (automático, 45 m/s), o Pump (65 m/s) e a Sniper de tinta (110 m/s) atiram uma bola: um projétil de
    contato com queda (o ramo do foguete, com `projectileGravity` e raio 0: só o acerto direto).
  - O Balde é uma granada que espirra em 3 m.
  - Números meus, revisáveis.
- **A sim** (`sim/src/systems/paintball.ts`, `ctx.paintHits`): todo dano de tinta (a bola ou o respingo) vira um acerto
  inteiro (`ceil(vida máxima ÷ hits)`). O `paintLoadout` (no `respawn`) troca a primária escolhida pela de tinta
  dela (sniper → a de tinta, escopeta → o pump, o resto → o marcador), põe o balde no slot de arremesso e tira a
  pistola e a faca.
- **A IA:** os projéteis que não são de área (a bola) são mirados no ponto de sempre, adiantados pelo tempo de voo e
  mais altos pela queda (½·g·t²).
- **A cena e o render:**
  - A bola em voo é um ponto de FX na cor do time (`FX_KIND.paintBall`), não um modelo. O balde voa com o modelo da
    granada; as armas de tinta usam os modelos do arsenal (o pacote de modelos está com 31 das 32 camadas).
  - O estouro vira a mancha (`FX_KIND.paint`, a partícula `paint` do mesmo programa de shader: o respingo irregular na
    cor) e um respingo de cubinhos. A normal da superfície sai da grade (o bloco sólido vizinho mais perto do ponto,
    o chão primeiro), sem mudar o protocolo; sem bloco por perto (num bobo ou numa prop), só o respingo.
  - O anel das manchas dá a volta no teto da plataforma (`ParticleRing.limit`, que vem em cada pedido): 96 no PC, 48 no
    celular e 32 no Switch (U6).
  - O som: o tiro da arma parecida mais agudo (um "pop") e o estouro da gosma.
- **Golden** (8 bots Normal no Construto, semente 42): `855196e7` (43 × 35 em 3 min). **Online:** uma sala de 90 s com
  um amigo em cada time, o mesmo fim (18 × 17) e 0,64% de predições erradas (17 em 2.671).
- **A revisão (Opus)** achou 18 coisas (6 médias, 12 baixas; nenhuma de determinismo), corrigidas antes do commit, menos
  as que ficam anotadas abaixo:
  - a própria bola tapava a mira (agora fica escondida até 1,5 m do olho, como o foguete); a luz da mancha era a do
    efeito anterior (agora a do lugar dela); no amigo, a bola que trocava de lugar no pool riscava o mapa (agora um
    salto de mais de 12 m não é interpolado); as bolas ganharam um anel delas (empurravam a fumaça do anel alfa);
  - os bots não jogavam o balde (agora qualquer arma de arremesso serve) e, no Paintball, não recuam para regenerar
    (a vida não volta: `AiContext.noRegen`);
  - o acerto de tinta vem antes do fogo amigo e do "um tiro mata" (o fogo amigo pela metade dá meio acerto; os
    multiplicadores de dano não mudam o acerto);
  - só o arsenal (`WEAPONS`) serve de primária escolhida (`isPrimaryWeapon`): um amigo online não pede arma de modo;
  - o loadout de tinta respeita a lista de armas do bot (o só de faca fica sem primária e sem balde) e não passa por
    cima dos modos de festa; a troca por abate não roda no Paintball;
  - fora da grade não há mancha; o balde conta no HUD e no aviso como a granada; a sniper de tinta usa o ajuste do
    viewmodel da sniper; o tiro de tinta marca o indicador de som e o estouro não.
  - **Ficam anotados:** a bola acerta sempre o tronco (o "só na cabeça" não vale para ela, como para o foguete); a
    normal da mancha é a do bloco inteiro (numa rampa ela deita); a mancha nova fica por baixo das velhas depois que o
    anel dá a volta; a tela de morte ainda oferece as 6 primárias (fuzil, SMG, LMG e foguete viram o Marcador).

### 17.8 Fase 6a: Bobo Zombies Fortress (19/11/2026)

- **A receita:** `zombies.variant` (`classic`, `armed` ou `fortress`; `ZOMBIES_VARIANTS`). O card Fortaleza
  (`moreModePreset('zombiesFortress')`) é o Bobo Zombies no Posto Avançado com `variant: 'fortress'`.
- **A sim** (`sim/src/systems/fortress.ts`, `ctx.fortress`):
  - O gerador é estado (a vida, `FortressState.hp`: hash, snapshot v15 e rede), não cenário. O lugar sai do mapa: o
    ponto de spawn humano mais perto do centro deles, 1,5 m para um lado livre com chão (sem marcador novo). Não tem
    colisão.
  - O `fortressSystem` (no diretor de ondas): cada zumbi colado (1,8 m) tira 20/s (o chefão, 4x); o humano de pé
    segurando o usar a até 2,2 m conserta 60/s; o gerador no zero perde a partida.
- **A rede:** a vida inteira no global `fortressHp`, só no modo. `PROTOCOL_VERSION` 5.
- **A IA:** metade dos zumbis (pelo índice e pela onda: o chefão, sempre o primeiro, vai em metade das ondas) vai no
  gerador, a não ser com um bobo a menos de 5 m ou sendo o último da onda (que corre atrás dos bobos). O caminho é um
  segundo flow field, com o gerador de fonte fixa (`ZombieFlow` com `fixed`, calculado uma vez): ele atravessa as
  janelas com tábua, como o dos bobos (a rota A* direto no gerador tratava a janela como fechada e o zumbi parava do
  lado de fora, travando a onda). Colados no mesmo andar, batem; presos no caminho, Destravar.
- **O jogo:** o modelo de prop `generator` no buffer dinâmico (o das tábuas e portas); a vida em % na linha da onda; a
  plaquinha GERADOR sempre na tela (a do Jugg, com `HudModel.juggMarkLabel`).
- **A página Mais modos:** com mais de 6 cards, a tela dos Modos usa 3 colunas de cards de 370 px; as frases da página
  ficaram curtas para caber (o teste de caber no card passou a montar a página inteira).
- **Golden** (Fortress no Posto, 4 bots Normal de apoio, semente 42, 7.200 ticks): `cfb8db3d` (onda 3, o gerador cai
  para 2.541 e a partida acaba). **Online:** 1 onda com 2 amigos parados: o mesmo fim e a mesma vida do gerador nos dois lados.
- **A revisão (Opus)** achou 7 coisas (1 alta: o zumbi do gerador parava do lado de fora da parede e travava a onda),
  corrigidas antes do commit: o campo até o gerador, a linha da onda no quadrante livre do 3P, o chefão em metade das
  ondas, o golpe só no mesmo andar e a variante `armed` fora do validador até a 6b. O bot de apoio também conserta o
  gerador (de pé, segurando o usar). **Fica anotado:** numa simulação de 30.000 ticks no Posto (semente 7), o último
  zumbi ficou 103 s do lado de fora de uma janela que os bots consertavam sem parar (ele arranca, eles repõem, ninguém
  atira): é um laço da IA do Bobo Zombies (as janelas), não do Fortress; e há uma prop de gerador no Posto e na Base a
  6 a 9 m do objetivo (só a plaquinha separa os dois).

### 17.9 Fase 6b: Bobo Zombies Armed Horde (19/11/2026)

- **A receita:** `zombies.variant: 'armed'` (`ZOMBIES_VARIANTS` volta a ter as três). O card Horda Armada
  (`moreModePreset('zombiesArmed')`) é o Bobo Zombies na Base Abandonada com o time 1 só de bots (6 Chill + 6 Normal) e
  2 bots Normal de apoio no time 0.
- **A sim** (`ctx.zombieArmed`; `HORDE`, `hordeInWave`, `hordeMaxAlive`, `hordeHpMul` em `config/zombie.ts`):
  - A horda são os bobos do time 1 (`isHorde` no `context.ts`: o zumbi ou, na Horda armada, o bobo do time 1). Eles
    começam mortos e sem contagem (fora de jogo), sem pontos, e o pool de zumbis fica vazio. Humano é sempre do time 0.
  - O diretor de ondas conta os soldados como os zumbis da onda; o lado dos humanos é só o time 0. O `spawnHorde`
    solta o soldado morto de índice menor no ponto dos zumbis (a horda reusa os primeiros: os Chill), com uma primária
    sorteada entre as liberadas (2 na 1ª onda, mais uma a cada 2) e a vida da onda (o `maxHpOf` do soldado cresce 10%
    por onda, derivado da onda: nada novo no snapshot). Total da onda: metade da dos zumbis (mínimo 2); em jogo ao mesmo
    tempo: 2 + 0,5 por onda + 2 por humano a mais (até o tamanho da horda); um a cada 1,5 s; sem chefão; a granada só
    da 3ª onda em diante.
  - O soldado da horda morre (não cai), dá os pontos do acerto e do abate, pode deixar drop (o Carpinteiro vira Munição
    Máxima), morre na bomba e no insta-kill, não pega drop nem recebe a Munição Máxima.
  - **As janelas abertas** (`MapObjects.openWindows`): 0 tábua, o colisor dos bobos e o portão da navegação abertos
    (todo mundo passa pelo vão); o `barricadesSystem` não roda e o HUD não oferece o conserto.
- **A IA:** `AiContext.hordeArmed`. O passeio do soldado do time 1 é caçar o bobo de pé do time 0 mais perto (a até
  3 m dele, para chegar por janelas diferentes); o do bot de apoio é ficar a até 3 m do humano mais perto (com as
  janelas abertas, o passeio do Warfare o levaria para fora). O apoio não conserta janela. O resto é a IA do Warfare.
- **O jogo:** o pool 0 (o mesmo nos dois lados do online), a linha "Onda 2 · 7 soldados", o placar do Tab sem a horda;
  o Bobo Zombies (todas as variantes) passou a não ter escolha de time no sofá e no online (`placeHumans` põe todo
  humano no time 0).
- **Golden** (Base Abandonada, 4 bots Normal de apoio contra 12 Normal, semente 42, 7.200 ticks): `0bc0e8ca` (o apoio
  derruba 4 dos 5 soldados da 1ª onda em 2 min; sem humano, ele passeia como no Warfare). **Online:** 1 onda com 2 amigos parados (um pediu o time 1): os dois no time 0, nenhum zumbi e o
  mesmo fim nos dois lados.
- **A revisão (Opus) achou 9 coisas, corrigidas antes do commit:**
  - As portas pagas continuam valendo com as janelas abertas (o `barricadesSystem` pula só as janelas).
  - Quem entra no meio da partida no sofá só assume bot de apoio (no Bobo Zombies, o time 0).
  - No Bobo Zombies a IA não mira em caído (o dano nele não pega).
  - O recorde de onda tem a variante na chave (`|armed`, `|fortress`; a clássica continua igual).
  - Sem bot no time 1, a onda passa.
  - O abate não soma no placar dos times no Bobo Zombies.
  - O humano que a receita pôs no time 1 nasce com o time 0.
  - A música e o minimapa contam os soldados.
  - O apoio levanta o caído só sem soldado perto.
  - O soldado destravado no ponto continua com a vida que tinha.
- **Limitações conhecidas:** a horda nasce nos pontos dos zumbis (fora da base) e entra pelas janelas; a dificuldade
  (o tamanho da onda, o teto em jogo e os níveis dos bots do card) é um palpite e fica para a rodada de testes com o
  Erick.

### 17.10 Fechamento do M6 (19/11/2026)

- **Os modos:** a página Mais modos tem 9 cards (o Bobo Training, Domination, Gun Game, Infection, Juggernaut, Bobo
  Chaos, Bobo Paintball, Fortaleza e Horda Armada); os modificadores valem em qualquer modo pela Partida personalizada
  (a aba Modificadores) e pela Roleta do Bobo Chaos. Todos rodam sozinhos com bots, no sofá, no online e no Switch.
- **As versões:** snapshot 15 e `PROTOCOL_VERSION` 5 (cada modo pôs o estado dele no fim do esquema); as tabelas de
  conteúdo novas entram no hash de conteúdo da sala (`SIM_CONTENT_TABLES`).
- **Os goldens do M6** (`game/src/scene/golden.test.ts`): Domination `97f2f078`, Gun Game `6595bdd9`, Infection
  `ffb3e5cb`, Juggernaut `f7c0ff3a`, Bobo Chaos `c1b4cd36`, Bobo Paintball `855196e7`, Fortaleza `cfb8db3d` e Horda
  Armada `0bc0e8ca`; os de antes do M6 (TDM `b36eb8e1`, Zombies `edc93590`, Posto `6c4eaf90`) não mudaram no fechamento.
- **O custo:** `PERF.md` §1j (sim + IA de cada card, headless).
- **Fica para depois do M6:** os modificadores Mini, Bots gigantes, Arcade e Ricochete; a arte própria das armas de
  tinta (o pacote de modelos está com 31 das 32 camadas); o laço do zumbi na janela em conserto e a mira da IA no
  centro da cabeça normal com o Cabeção (§17.5 a §17.8); e o ajuste da dificuldade da Horda Armada.

## 18. M7: BoboStrike e Bobo Royale Mini

Plano em `docs/PLANO_M7.md` (decisão #81).

### 18.1 Fase 0: as rodadas e o Juggernaut Fixo (19/11/2026)

- **O motor** (`sim/src/systems/rounds.ts`, `ctx.rounds`): `RoundRules` (os ticks da compra, da rodada e da pausa,
  `winRounds`, `totalRounds`, `swapAfter` e se há respawn na rodada) e o estado num `Int32Array` (`ROUND`: a rodada,
  a fase, os ticks na fase, as vitórias dos times 0 e 1, os lados trocados e o vencedor da rodada), que vai no hash, no
  snapshot (v16) e na rede (7 globais; `PROTOCOL_VERSION` 6).
  - A rodada: compra (ninguém anda nem atira: `roundFrozen` no `applyInput`, também na predição do amigo) → valendo
    (o modo decide o vencedor; no fim do tempo, o vencedor do tempo do modo) → fim (a pausa, congelada) → a próxima
    rodada ou o `finishMatch` (quem está na frente). As vitórias também vão para o `teamScore`.
  - Na largada, todo mundo renasce com a vida cheia, cada um num ponto diferente (`roundSpawn`: os do time; no Jugg,
    qualquer ponto, girando a cada rodada). Sem respawn na rodada (o BoboStrike), o `spawnSystem` deixa quem morreu
    esperando.
  - Roda depois do `partySystem` e antes do `rulesSystem`.
- **O Jugg Fixo** (`recipe.juggernaut.variant: 'fixed'`, `JUGG_FIXED`): tantas rodadas quanto participantes (até 8),
  de 3 min, com 3 s de largada e 4 s de pausa. Antes do spawn, todo mundo volta a caçar (`juggRoundReset`); depois, o da
  vez pela ordem das entidades (os humanos primeiro) vira o Jugg (`juggRoundStart`). Derrubar o Jugg acaba a rodada (a
  coroa não passa); o tempo acabando dá a rodada ao Jugg. Os pontos de Jugg só contam com a rodada valendo.
- **O jogo:** o card `juggernautFixed`, a linha da rodada no lugar do relógio ("Rodada 2 de 4 · 2:31", "começa em 3",
  "O Jugg caiu!"). A página Mais modos com mais de 9 cards fica apertada (o título menor, os cards mais juntos e o
  Voltar na última linha quando ela tem lugar), para caber 4 linhas no celular.
- **Golden** (Construto, 4 bots Normal, semente 42, a partida inteira): `9074d33b` (cada bot é o Jugg uma vez; pontos
  105, 180, 180 e 109; 36.227 ticks). **Online:** o Jugg Fixo com 2 amigos, 2 rodadas: as rodadas e os pontos iguais nos
  dois lados, 15 predições erradas em 10.948.
- **A revisão (Opus) achou 4 coisas, corrigidas antes do commit:**
  - O fim do Jugg Fixo empatava quase sempre (quem aguenta a rodada faz 180 pontos): agora desempata pelos abates e depois
    por menos mortes (escolha minha, revisável).
  - Nas rodadas, o tempo e a meta da receita não valem (`timeLimitS` e `scoreLimit` vindos da Partida personalizada
    acabavam a partida na rodada 1 ou abriam a morte súbita congelada).
  - A predição do amigo usava a fase da rodada atrasada: agora o `SimPredict.round` leva a fase e os ticks do snapshot
    mais novo, e cada entrada refeita conta um tick do host (a compra vira valendo na hora certa).
  - O 1º tick valendo, antes da rodada 1, não congelava (um tiro segurado na contagem saía do lugar antigo).
- **O que fica para o BoboStrike:** os lados que trocam (`swapped` já existe, os spawns por lado não), a câmera de quem
  morre e o vencedor por eliminação (já no motor, sem modo que use ainda).

### 18.2 Fase 1: a Base Bobo (19/11/2026)

- **O mapa** (`assets-src/maps/airbase.ts`, `map:airbase`, "Base Bobo"): grade de 72 × 24 × 72 m, área jogável de 64 ×
  64 m, de dia; modos `strike` e `warfare.tdm`. O hangar (site A) no noroeste, o pátio de carga (site B) no nordeste,
  a pista (spawn dos atacantes, o time 0 na largada) no sul e o pátio dos defensores (o time 1) no norte, atrás de um QG
  com as saídas pelos lados (da pista não se vê o pátio). Três rotas (oeste, meio, leste) separadas por barracões;
  corredores curtos do meio aos dois sites; 6 spawns por time.
  - O `mapc`: maior linha de visão medida 49 m (o teto é 50 m: quebra-vistas em zigue-zague nas rotas e na pista);
    travessia TDM de ~8 s correndo (o GDD pede 12–18 s: aviso, o mapa é de 64 m); 2.683 nós jogáveis.
- **O marcador `bombSites`** (`MapMarkers.bombSites`, opcional como as janelas: os mapas sem ele saem com os mesmos
  bytes): letra, centro e raio. O validador pede 2 sites com `strike` nos modos, com nome único e dentro da área; o
  `mapc` ganhou `bombSite` e desenha os sites na vista de cima; o `SimMap` aceita os sites (a sim usa na fase 2).
- **O jogo:** a Base Bobo na lista de mapas (Partida rápida e personalizada, só TDM até o BoboStrike existir) e a cena
  de bench `scene=airbase` (o TDM nela), que serve aos prints das câmeras `print:airbase`, `print:siteA`,
  `print:siteB` e `print:meio` (`local/m7/capturar-mapa.ts`).
- **Golden** (TDM 4 contra 4, semente 42, 2 min): `e3158452` (17 × 18).
- **A revisão (Opus) achou 4 coisas, corrigidas antes do commit:** um beco sem saída de 3 m entre os barracões do
  oeste (escondido pelo telhado: agora os blocos se encostam); a Base Bobo sem teto de bots no menu (20 contra 20 no PC
  em 6 spawns por time: agora 9 bots, 5 contra 5 com o humano); as saídas do pátio dos defensores de 1,5 m (agora 2 m;
  no TDM o pátio ainda é fácil de segurar, travessia de ~8 s: fica para a rodada de prints); e um caixote que entrava no
  QG.

### 18.3 Fase 2: o BoboStrike na sim (19/11/2026)

- **O modo** (`mode: 'strike'`, `sim/src/systems/strike.ts`, `ctx.strike`): as rodadas do motor da fase 0 com as regras
  `STRIKE` (15 s de compra, 1:45 de rodada, 5 s de pausa, MR12: troca na 6ª, vence quem fizer 7; sem respawn; o tempo e
  a meta da receita não valem). Sem regeneração, sem caixinha de munição e sem proteção de spawn.
  - **Os lados:** o time 0 ataca no 1º tempo; depois da troca, o 1. Os pontos de spawn são do lado (os do time 0 do mapa
    são os de ataque): trocados, cada time nasce nos do outro (`roundSpawn` pelo lado). Na volta do intervalo o
    dinheiro volta a 800, as derrotas seguidas zeram e todo mundo volta só de pistola.
  - **A Boom Box** (`StrikeState.data` pelos índices de `STRIKE_DATA`, a posição em `pos`): na largada, um atacante
    sorteado (`rngStrike`) leva. O portador que cai larga a bomba onde estava; um atacante vivo a 1,2 m pega. Plantar:
    o portador dentro do site (o raio do marcador), no chão, segurando o usar por 3 s; soltar ou sair recomeça. Plantada,
    o relógio da rodada vira o da bomba (40 s; a rodada não acaba mais no tempo). Desarmar: o defensor vivo mais perto, a
    até 1,5 m, no chão, segurando o usar por 7 s (5 s com o kit); trocar de quem desarma recomeça. A explosão
    (`BOOM_BOX`, código 18, sem dono) faz 500 no centro, caindo até 0 em 20 m (mata a até 10 m mesmo de colete).
  - **Quem vence a rodada:** a explosão (atacantes), o desarme (defensores), os defensores eliminados (atacantes, mesmo
    com a bomba plantada), os atacantes eliminados sem a bomba plantada ou o tempo sem a bomba plantada (defensores).
  - **A economia** (`points` é o dinheiro, até 16.000): 800 na largada; vitória 3.000; derrota 1.900 mais 500 por
    derrota seguida do time (até 3.400); abate 300; plantar 300.
  - **A compra** (`STRIKE_SHOP`, só na compra): o `InputFrame.primary` de `STRIKE_BUY_BASE` (200) + o item vira um
    pedido (`buyRequest`), que a sim consome. Comprar o que já tem não faz nada (a entrada repetida da rede não compra
    duas vezes). A arma comprada vai para a mão.
  - **Quem sobrevive** guarda o loadout (as armas, os pentes e a reserva), o colete e o kit; quem morreu volta com a
    pistola e a faca.
  - **O colete** (`armor`, 0..100): absorve metade do dano fora da cabeça, até o que sobra dele.
- **Estado, snapshot e rede:** `strike.data`, `strike.pos`, o RNG e os campos dos bobos (`strikeFields`: o dinheiro, o
  colete, o kit e o pedido) só no modo (snapshot v17); na rede, 10 globais da bomba, a posição dela e o grupo `strike`
  (o colete e o kit) por bobo. `PROTOCOL_VERSION` 7.
- **A revisão (Opus) achou 10 coisas, corrigidas antes do commit (as regras novas são escolhas minhas, revisáveis):**
  - Nas rodadas, os abates não somam no placar dos times (uma granada na pausa da última rodada desempatava a partida).
  - A compra é na borda do `primary` (`lastPrimary`, no estado): o valor persiste no quadro, e a compra negada numa
    rodada saía sozinha na seguinte.
  - A bomba largada cai até o chão embaixo do portador; no vazio, passa a um atacante vivo sorteado.
  - O colete entra antes do "um tiro mata" e não segura a queda, o vazio nem o sangrar.
  - Quem já está desarmando continua (outro defensor chegando mais perto zerava o progresso).
  - A arma comprada e a da largada ficam na mão (o `inWeapon` acompanha).
  - O kit é só de quem defende.
  - Os dois lados zerados no mesmo tick, sem a bomba plantada: a defesa leva.
  - Ficam como estão: a explosão respeita parede (um caixote salva), e o dano dela entra no tick seguinte.
  - Para a IA (fase 3): o bot portador planta; não há como largar a bomba de propósito.
- **Testes:** a sim (`strike.test.ts`: comprar, plantar, desarmar, explodir, o dinheiro, o colete guardado, a troca de
  lado e o fim em 7) e a rede (o BoboStrike na Base Bobo por 3 min: a rodada, a bomba e o dinheiro iguais no amigo; 35
  predições erradas em 5.247). Ainda sem a IA do modo: os bots brigam como no Times.

### 18.4 Fase 3: a IA do BoboStrike (19/11/2026)

- **O módulo** (`ai/src/strike.ts`): o `soldier.ts` pergunta o objetivo, o passeio e a compra.
  - **O site da rodada:** na largada de cada rodada, o diretor sorteia o site do ataque (`strikeRng`, o mesmo para o
    time todo; `AiContext.strikeSite`).
  - **O objetivo** (`strikeObjective` → `STRIKE_ACT`): o portador vai ao site e, a meio raio do centro, para,
    agacha e segura o usar até plantar; com a bomba no chão, o atacante vivo mais perto vai buscar; com ela plantada, o
    defensor vivo mais perto vai até ela e segura o usar. Com inimigo à vista de perto, briga antes (`closeFight`).
  - **O passeio** (`strikeWander`): os atacantes, um nó perto do site da rodada; os defensores, um dos sites pelo
    controlador (metade em cada); com a bomba no chão ou plantada, todos em volta dela.
  - **A compra** (`strikeBuy`, uma por tick na compra, pela borda do `primary`): o fuzil se sobram 650 para o
    colete; a SMG só com folga para o colete e a granada (2.600); abaixo disso, sem arma, é rodada de economia (só a
    granada); com arma, o colete de 100 (com o fuzil) ou o de 50, o kit (defesa) e a granada. Fora da compra, o
    `primary` dos bots é 0 (zera a borda para a rodada seguinte).
- **A revisão (Opus) achou 7 coisas, corrigidas antes do commit:** o Destravar não valia andando até o objetivo (agora
  só parado segurando o usar não conta como preso; a rota que falha larga o objetivo por um passeio); o "mais perto"
  contava humanos (um humano perto da bomba deixava os bots sem desarmar); indo ao objetivo o bot não revidava de
  longe (agora briga com quem estiver à vista, e só chegando ignora quem está longe); o desarme trocava de dono (quem já
  desarma continua, e há uma folga de 1,5 m para trocar); não havia economia; os defensores iam à bomba largada (o
  marcador dela é só do ataque); o passeio demorava a ir à bomba plantada (agora refaz quando ela muda de estado).
- **Medido** (`local/m7/medir-strike.ts`, 5 contra 5 de bots Normal, 3 sementes): 7,4–8,5 min por partida, 10–12
  rodadas, 4 plantas por partida, 0–2 desarmes, 16–28 fuzis comprados. A meta dos 30 s (os atacantes vão direto ao
  site) já é o comportamento de sempre: eles passeiam pelo site da rodada desde a largada.
- **Golden** (5 contra 5, semente 42, a partida inteira): `9bf9f851` (12 rodadas, 6 × 6, 6 plantas). Os goldens dos
  outros modos não mudaram (o `primary` dos bots já era 0).

### 18.5 Fase 4: o BoboStrike no jogo (19/11/2026)

- **O card** `strike` (`moreModePreset('strike')`): 5 contra 5 na Base Bobo (o humano e 4 bots contra 5). A página
  Mais modos tem 11 cards (4 linhas, o Voltar na última).
- **O HUD** (`ui/src/screens/hud.ts`, campos novos e genéricos do `HudModel`): `pointsLabel` (o "$" do dinheiro no
  lugar de PONTOS), `waitText` (quem morreu: "Volta na próxima rodada"), `centerLabel`/`centerValue` (a plaquinha do
  meio: PLANTANDO e DESARMANDO com os segundos que faltam), `HUD_INTERACT.text` (o aviso de plantar ou desarmar em
  `interactName`) e `buyTitle` (o anel da compra vivo: as opções do radial da primária com os preços; o título é o
  "COMPRAR · $800"). No alto, o placar das rodadas (o `teamScore`) com o relógio da rodada (o da bomba depois de
  plantada) e, na linha de baixo (`modsLine`), o estado: "Rodada 3 · Compra", "Rodada 3", "Boom Box no A!" (em
  destaque) ou "Vitória do ataque/da defesa" (com "Troca de lado" na 6ª).
- **A compra** (`updateBuys`): na compra (com a rodada já valendo: a contagem antes da 1ª também é a fase 0), o
  giro de mira do humano move o cursor do anel a partir da mira da abertura (a câmera fica nela), a troca de arma e o
  D-pad andam pelas opções, e o tiro ou o usar compra a apontada; no toque, só o toque curto que começa e termina na
  mesma opção. O pedido vai no `primary` (`STRIKE_BUY_BASE` + item) e volta a 0 fora da compra (a sim compra na
  borda e avisa a troca de arma: a mão do mapeador segue a arma comprada).
- **A Boom Box** (o modelo `boom-box`, na camada compartilhada dos modelos pequenos: o pacote continua com 31 das 32
  camadas): desenhada no chão largada ou plantada (`fillBomb`, no buffer dinâmico do gerador), com a plaquinha BOOM
  BOX através das paredes (a do Jugg): a largada só para o ataque, a plantada para todos.
- **Quem morre** vê a câmera de morte e, depois de 3 s, assiste o primeiro aliado vivo em 3ª pessoa (a câmera de ombro,
  centrada, que encurta na parede) até a próxima rodada; sem o radial da primária (a arma se compra).
- **A revisão (Opus) achou 8 coisas, corrigidas antes do commit:** a compra travava a mira no ângulo 0 do mundo e o
  cursor pulava no 1º quadro (agora parte da mira da abertura); no toque, arrastar o dedo comprava (agora só o toque
  curto); a câmera de quem assiste atravessava parede; o anel não andava pelo D-pad; o anel abria na contagem inicial;
  a arma comprada no último tick da compra saía da mão (a sim avisa a troca); o título da compra era um cache só para
  todas as vistas; a Boom Box sumia ao ser desarmada.
- **Fica para depois:** os sons do modo (o bipe da bomba, plantar e desarmar), largar a bomba de propósito, a escolha
  de quem assistir (hoje é o primeiro aliado vivo) e o modelo da Boom Box nas costas de quem carrega.

### 18.6 Fase 5: a Ilha Tropical (19/11/2026)

- **O mapa** (`assets-src/maps/island.ts`, `map:island`, "Ilha Tropical", nome provisório): grade de 200 × 32 × 200 m
  (400 × 64 × 400 células), área jogável de 184 × 184 m (a água rasa em volta entra), de dia; modo só `royale.mini`
  (aberta demais para os outros: o FFA pediria largadas que não se enxergam). Gerado por código: o relevo é um ruído de
  valor da semente do mapa, em degraus de meio bloco, com a borda da ilha ondulada. O morro com o farol (só de enfeite)
  e a casinha do faroleiro ao norte; a vila (praça e 10 casas de 3 m com porta, janela e luminária) ao sul do centro; o
  píer de tábua e 3 barracas na praia; estradas de terra; 140 árvores, mato e arbustos na grama.
  - **54 pontos de loot** (2 em cada casa, o píer, as barracas e caixotes soltos no campo, só em chão plano) e **32
    largadas sem time** (um anel pela ilha e 4 na praça; o Royale sorteia). As árvores evitam as largadas, os
    declives e umas às outras; o mato e os caixotes evitam os troncos; as barracas ganham um chão aplainado.
  - O `mapc`: 39.668 nós (33.068 jogáveis), maior linha de visão 189 m (declarada 190); 2 avisos que ficam (a
    cobertura do campo aberto, até 14,8 m, e a grade de 10,7 MB, PERF §1k). `.bfmap` de 28 KB.
- **O marcador `lootSpots`** (`MapMarkers.lootSpots`, opcional como os sites: os mapas sem ele saem com os mesmos
  bytes): id, o chão onde o item aparece e um raio. O validador pede 24 ou mais com `royale.mini` nos modos, com nome
  único e dentro da área; o `mapc` ganhou `lootSpot` e desenha os pontos na vista de cima.
- **O formato:** `MAX_DECLARED_SIGHT_LINE_M` foi de 140 para 200 m (o mapa do Royale; a distância de visão da partida
  continua limitando o que se vê). O `MapScript` ganhou `analysis.sightLimitM` (o teto da análise de linhas de visão
  do `mapc`; padrão 50 m).
- **O bloco `sand`** (`block:sand`, 3 variações, passo de terra) com as texturas `sand`, `sand_b` e `sand_c`
  (`ISLAND_TEXTURES`).
- **O jogo:** a ilha na lista de mapas só para o `royale.mini` (some da Partida rápida e da personalizada até o modo
  existir) e a cena de bench `scene=island` (o FFA com as vistas e os bots, para medir a memória, o loading e o quadro
  no mapa grande), que serve aos prints das câmeras `print:island`, `print:vila`, `print:farol` e `print:praia`.
- **A revisão (Opus) achou 4 coisas no mapa, corrigidas antes do commit:** o loot das barracas dentro da lona (agora na
  frente da porta); a casinha do faroleiro na encosta com grama dentro e um vão sob a laje (as casas ganharam alicerce e
  o interior limpo); árvores no meio da estrada oeste e mato na terra das estradas e dentro das barracas (a vegetação
  só nasce onde o topo é grama); arbustos flutuando ou afundados (encaixados na célula antes de medir a altura, e
  cruzados como o mato). Também: os caixotes longe das largadas, a base do farol meio bloco abaixo, o `mapc` confere
  os pontos de loot como as largadas (fora de bloco, perto de um nó da navegação principal) e o validador exporta
  `MIN_ROYALE_LOOT_SPOTS` (24) e o teto `MAX_LOOT_SPOTS` (96, o pool da sim; 64 depois da revisão da fase 6).
- **Fica para a fase 6:** o `SimMap` com os pontos de loot (a sim do Royale).

### 18.7 Fase 6: o Bobo Royale na sim (19/11/2026)

- **A receita:** o bloco `royale` (`RoyaleRules`: `squad` = `solo` (padrão), `duo` ou `quad`; `royaleSquadSize`). O
  Royale usa um time só na receita (como o FFA); a sim reparte os participantes em esquadrões na ordem (os humanos
  primeiro: no sofá e na sala, os humanos caem no mesmo esquadrão) e o `team` de cada bobo é o esquadrão (até 24).
  Sem tempo nem meta (quem acaba é o último esquadrão).
- **O sistema** (`sim/src/systems/royale.ts`, `ROYALE` com as minhas escolhas marcadas):
  - **A largada:** cada esquadrão num ponto sem time, o 1º sorteado e depois sempre o mais longe dos escolhidos; só a
    pistola (com 2 pentes de reserva), a faca e a granada vazia; sem colete nem kit; sem regeneração nem respawn.
  - **O loot** (`spawnRoyaleLoot`, no tick 0, pelo `rngRoyale`): um item por ponto de loot do mapa (35% com um 2º):
    arma 45% (SMG, escopeta, fuzil ou sniper; comum 60%, rara 30%, épica 10%), colete 20% (o de 100 é um terço), kit
    de cura 20% e caixinha de munição 15%. Os itens são pickups com tipos novos (`PICKUP_KIND.armor50`, `armor100`,
    `heal` e `weaponBase` + código da arma) que não somem: o `pickTicks` deles guarda a munição da arma
    (`ROYALE_AMMO_BASE` + pente + reserva × 1000), para a troca não encher o pente de graça.
  - **As raridades** (`ROYALE_RARITY`, `ROYALE_WEAPONS`): a rara e a épica são códigos de arma novos (19 a 26) com o
    pente e a reserva × 1,25 e × 1,5 e o recuo × 0,8 e × 0,6; o dano é o da comum (`royaleWeaponCode`,
    `weaponRarity`, `weaponBase`).
  - **Pegar:** passando por cima, o colete se for melhor, o kit até 3 e a arma com a primária vazia; com a primária
    ocupada, apertar o usar perto da arma troca (a de agora cai no lugar, com a munição dela), como a troca do sistema
    de armas (o tempo de troca; nunca com a granada cozinhando). **Curar:** segurar o usar longe de aliado caído, 3 s,
    cura 60 (o tiro cancela; o aperto perto de uma arma é a troca).
  - **A zona** (`royaleZoneSystem`, antes do dano): começa cobrindo a área; 5 fases de espera e encolher
    (90+60, 70+50, 55+40, 40+35, 30+30 s: 8,3 min) até 80, 50, 28, 12 e 0 m (nunca maior que o círculo de agora); o
    centro de cada fase é um ponto de loot sorteado que caiba dentro do círculo de agora. Fora dele, o dano da fase (2 /
    5 / 10 / 20 / 40 HP/s), sem dono, que o colete não segura (`WEAPON_ZONE`), em pulsos de 0,5 s (um acerto por pulso:
    um por tick eram 60 eventos por segundo por bobo na rede). O dano entra na fila antes do passo de dano do mesmo tick:
    a fila não vai no snapshot, e o dano que sobrasse para o tick seguinte fazia a cópia divergir.
  - **O caído** (duplas e quartetos): com alguém do esquadrão de pé, quem zera cai (o caído do Bobo Zombies, sem
    "levanta sozinho") com 100 de vida de caído, que o tiro e a zona tiram; o aliado levanta segurando o usar 3 s. O
    esquadrão que só tem caídos sai na hora e sangra inteiro no tick seguinte. O reviver e o sangrar rodam com a zona,
    antes do dano (o golpe vale no mesmo tick, pelo mesmo motivo).
  - **O fim** (`royaleSystem`, depois do dano): o esquadrão sem ninguém de pé ganha a colocação (`place`, empate entre
    os que caem no mesmo tick); com um só, ele vence (no solo, o `winnerEntity` é o bobo); nenhum, empate. O fim
    forçado (o host que volta do segundo plano) dá a vitória ao esquadrão com mais gente de pé. Quem morre deixa a
    primária (com a munição), o colete e os kits no chão.
- **O estado e a rede:** `RoyaleState` (`data` pelos índices de `ZONE`, `circle` pelos de `CIRCLE`, `place`), os
  campos `heals` e `healTicks` (com o colete e os do caído no hash e no snapshot do Royale); `SNAPSHOT_VERSION` 18. Na
  rede, o grupo `royale` das entidades, os globais da zona (o círculo em centímetros) e da colocação, o tipo do pickup
  com 8 bits e o tempo dele com 32; `PROTOCOL_VERSION` 8 (`net.json`). Os campos cabem com até 68 participantes e
  240 Hz (o card terá 24). A IA usa o calor e o perigo num quadro só no Royale (os esquadrões passam do teto de times
  do quadro); os pings continuam por esquadrão.
- **A Ilha Tropical:** as largadas viraram uma grade de 18 m sobre a terra (41 pontos; com 24 participantes no solo,
  a largada fica a 18 m ou mais do vizinho; nas duplas, 32 m; nos quartetos, 51 m). O loot ficou com 52 pontos.
- **Medidas** (`local/m7/medir-royale.ts`, 24 bots Normal com a IA do FFA, que ainda não looteia nem foge da zona):
  solo, duplas e quartetos acabam em 1 a 4 min com um vencedor, a 0,03–0,07 ms por passo (p99 0,2–0,5 ms).
- **Testes:** `sim/src/royale.test.ts` (a receita, as raridades, o solo inteiro com o snapshot no meio, as duplas com o
  caído e o reviver, a zona até fechar e o empate, o determinismo) e o Royale em duplas pela rede de mentira
  (`apps/web/src/online-modes.test.ts`). Os 14 goldens não mudaram.
- **A revisão (Opus) achou 4 coisas, corrigidas antes do commit:** o caído que sangrava depois do dano deixava o golpe
  na fila e a cópia do estado (snapshot) divergia; a zona soltava um acerto por tick por bobo (60 eventos por segundo
  na rede: agora em pulsos de 0,5 s); pegar uma arma com a granada cozinhando travava a mão até morrer; e o quadro único
  da IA juntava os pings de todos os esquadrões. Também: o teto de pontos de loot caiu para 64 (cabe no pool com as
  quedas), os campos da rede alargados, o caído não pega munição e o fim forçado.
- **Fica para a fase 8** (o jogo ainda não abre o Royale): o modelo e o nome das armas raras (`weaponModel` tem o
  tamanho de `WEAPONS`), os modelos dos itens no chão (hoje o anúncio e o desenho são os dos drops do Zombies), a
  morte pela zona no kill feed (hoje sai como queda) e o retorno de dano da zona.

### 18.8 Fase 7: a IA do Royale e o LOD C (19/11/2026)

- **O objetivo** (`ai/src/royale.ts`, `AI_ROYALE` com as minhas escolhas): o soldado pergunta `royaleObjective` (como
  no BoboStrike) e ganha um `ROYALE_ACT`: **zona** (fora do círculo de agora, ou fora do próximo com ele encolhendo ou
  a menos de 20 s de encolher: vai ao ponto de loot dentro do próximo círculo mais perto, que já está na navegação),
  **cura** (abaixo de 65% da vida, com kit, sem inimigo à vista a menos de 35 m e sem arma no pé: parado, agachado,
  segurando o usar), **loot** (o item que mais vale pela nota valor ÷ (1 + distância/14 m), até 45 m: a arma melhor —
  fuzil, SMG, escopeta e sniper, com a raridade —, o colete melhor, o kit até 3, a munição quando falta) ou **troca**
  (a arma melhor com a primária ocupada: colado nela, o usar alternado, porque a sim troca na borda do botão).
- **Sem amontoar:** quem mira cada item fica em `RoyaleClaims`; ninguém corre atrás do item que outro bobo mais perto
  já mira, do item com um bobo de outro esquadrão a menos de 6 m e mais perto, nem do item com o inimigo à vista mais
  perto dele (sem isso, as brigas pelo mesmo item acabavam a partida em 30–60 s).
- **Brigar ou não** (`royaleEngage`, `royaleChase`): na 1ª espera da zona, só de muito perto (5 m) ou ferido (a até
  40 m); depois, só de pistola a até 8 m, armado a até 30 m (45 m da 3ª fase em diante). O inimigo fora disso fica para
  depois (o bot segue o objetivo), e a perseguição de onde o inimigo foi visto ou ouvido (a 3ª parte da luta alheia)
  só vale armado e com a zona já fechando.
- **O resto:** sem regeneração (`noRegen`: quem recua não espera a vida voltar); em grupo, o colega caído é levantado
  como no Bobo Zombies; o passeio é um ponto de loot dentro do próximo círculo.
- **O LOD C** (`AI_LOD.farM` 60 m, só no Royale e só com humano na partida): o bot a mais de 60 m de todo humano
  percebe a 1 Hz e replaneja a cada 4 s. Decisão minha (revisável): a luta entre bots longe continua sendo a da sim
  (hitscan determinístico, barato: o passo inteiro com 24 bobos custa < 0,1 ms no PC), sem a "luta por probabilidade" do
  tecnico.md §8.3, que pediria uma regra nova na sim só para economizar o que já não pesa. Medido (`local/m7/
  medir-lodc.ts`, 1 humano parado e 23 bots, 60 s): 0,079 → 0,074 ms por passo (p99 0,36 → 0,35).
- **A rede:** o Royale em duplas pela rede de mentira gasta 4,2 KB/s por amigo (24 bobos, 30 Hz); o "snapshot manda as
  entidades longe a 5–10 Hz" ficou de fora (pediria uma base por amigo no lugar da base comum da história de quadros).
- **Medidas** (`local/m7/medir-royale.ts`, 24 bots Normal): solo 143 s, duplas 167 s, quartetos 63 s; 21 a 24 bots
  acabam armados; as brigas são de perto (a ilha tem ~150 m de terra para 24). Com 6 e 12 bots, 77 a 107 s (pergunta Y7
  do plano).
- **Testes e golden:** `ai/src/royale.test.ts` (o valor dos itens; ir até a arma e pegar; trocar pela melhor no usar;
  entrar na zona; curar com o kit) e o golden do Royale solo com 24 bots na Ilha Tropical (semente 42): `38d57bd4`
  (100 s, 22 com primária). Os 14 goldens de antes não mudaram.
- **A revisão (Opus) achou 4 coisas, corrigidas antes do commit:** na última fase da zona (raio 0) o bot ficava parado
  no ponto sem objetivo, o Destravar o renascia longe e ele morria na zona (agora "segurar posição", `ROYALE_ACT.hold`);
  o colega caído nunca era levantado (o caído rastejava para longe e o reviver soltava o usar: agora o caído fica
  parado com um colega de pé perto, e o reviver segura o usar até ~1,4 m); o bot oscilava entre o loot e a zona na
  borda do círculo (o item fora do círculo fica de fora); e a troca pegava a arma mais perto em vez da que o bot queria
  (ele só aperta o usar em cima dela). Também: o claim guarda o tipo do item (o slot reaproveitado não herda), só é
  gravado quando o objetivo é adotado, a rota que falha bloqueia só o loot, o usar perto de um aliado caído não troca a
  arma (na sim) e a arma trocada cai na altura certa. Sem JIT (como no nx.js), a IA do Royale custa 4,2 ms por tick com
  24 bots nos primeiros 10 s (1,0–1,4 ms no FFA na mesma ilha; já era assim antes desta fase): o bench do console da
  fase 8 diz se o LOD C precisa ir além.

### 18.9 Fase 8: o Bobo Royale no jogo (19/11/2026)

- **O card** `royale` (`moreModePreset('royale')`): o Royale solo na Ilha Tropical, você e 23 bots (o teto de bots do
  aparelho corta no celular e no Switch com 2 ou mais: pergunta Y5, no padrão). A página Mais modos tem 12 cards; com a
  última linha cheia, o Voltar sobe para a linha do título (a mesma altura de antes no celular). Na **partida da sala**
  (online), o card Bobo Royale em duplas (o host e o 1º amigo juntos); a tela da sala ficou em 2 colunas (`wide`), com
  o "Todos contra todos" inteiro.
- **O HUD:** no alto, o relógio da zona (a espera ou o encolher) e "12 VIVOS · ZONA 2 DE 5" ("A ZONA ESTÁ FECHANDO!" em
  destaque, e também com o jogador fora dela); o colete e os kits no lugar dos pontos ("COLETE 100 · KITS 2"); "USAR:
  TROCAR POR RATTLER ÉPICA" embaixo da mira com uma arma ao alcance; "CURANDO" com os segundos na plaquinha do meio; a
  marca ZONA na borda da tela com o jogador fora dela (ou fora do próximo círculo, com ela fechando); o caído do Bobo
  Zombies; morto, "FORA · 3º LUGAR" e, em grupo, assiste um colega vivo (o do BoboStrike). O resultado mostra a
  colocação do esquadrão ("3º de 24"); a morte pela zona aparece como "A zona" no kill feed e na faixa.
- **A parede da zona** (`Renderer.setZone`, `PARTICLE_KIND.wall`): 64 pedaços em pé em volta do círculo (do chão a
  60 m, faixas diagonais translúcidas que somem para o alto), no material aditivo do programa 5 (sem programa novo: os
  7 continuam 7). O render só reescreve o anel quando o círculo muda.
- **Os itens no chão:** a arma pelo modelo da base (a rara e a épica brilham azul e roxo); o colete (`armor-vest`) e o
  kit (`medkit`) são modelos novos na camada compartilhada dos pickups (o pacote continua com 31 de 32 camadas).
  Flutuam e giram como os drops do Zombies, sem o anúncio nem a fanfarra deles (só quem pega ouve).
- **As armas raras e épicas** (códigos 19 a 26): o modelo, o som do tiro e a categoria da base; o nome com a raridade
  ("Rattler épica").
- **O resto:** sem colete de time no Royale (o esquadrão vai até 24); os marcadores dos colegas numa cor só; o "Ajustar
  desafio" vale para todos os bots; sem o radial da arma na morte (ninguém volta).
- **O bench** `scene=island` agora é o Royale solo (as vistas e os bots); os prints usam o gancho novo `setZone` (fixa
  a zona num círculo, só para os prints: `local/m7/capturar-royale.ts`).
- **O bench no Eden** (PERF §4, pergunta Y5): o Royale com 24 participantes a 58 fps com 1 vista e a 57 fps com 2 vistas
  (sim 0,75 e IA 1,25 ms por tick; até 48 draws e 65 mil triângulos por vista; 7 programas; heap 45 MB). O console e
  o celular ainda confirmam o tempo de quadro; até lá vale o teto de bots de cada aparelho.
- **A revisão (Opus) achou 5 coisas, corrigidas antes do commit:** quem morria em dupla via "volta na próxima onda"
  (agora "assistindo o colega"); no solo, quem morria ficava preso até o último bot (agora o resultado sai 4 s depois,
  fora do online, e a partida segue por trás); o colete mostrava a faixa e não o que sobra (agora o valor); a sniper rara
  e a épica ficavam sem o ajuste do viewmodel; e o resultado podia mostrar "1º de 24" com o esquadrão vivo (agora só com
  a colocação). Também: as faixas da parede de fato diagonais, a parede que volta depois de trocar de mapa, o gancho
  `setZone` fora do online, o bench com 1.000 de vida (a partida dura o bench todo), o colete de 100 brilhando no chão e
  o aviso de troca só quando a sim troca. O resultado (e o registro) dá a vitória ou a derrota pela colocação.
- **Fica para depois:** a zona no minimapa (o minimapa só aparece no 4º quadrante de 3 jogadores), o modelo da arma nas
  costas e a escolha do formato (duplas e quartetos) no card.

### 18.10 Fase 9: o Aquário (19/11/2026)

- **Onde entra:** o botão "Aquário: desligado/ligado" na linha do título da página Mais modos (ligado, o card escolhido
  começa só com bots; o Bobo Training continua sendo jogado) e o "Assistir" da Partida personalizada (o TDM, o FFA e o
  Zombies com as regras dela). Decisão menor revisável: o GDD põe o Aquário no menu principal, mas o menu da web está
  a 1,6 KB do teto de 350 KB; os dois botões moram no pedaço dos editores (o menu cresceu 0,1 KB). Fora do online (a
  partida da sala é a do host) e sem virar o último preset do JOGAR; o "De novo" do resultado repete o Aquário.
- **A receita** (`spectateRecipe`, `SceneRequest.spectate`): o lugar do jogador vira um bot do mesmo time (o 1º bot
  daquele time, ou o do pedido), então os times ficam do mesmo tamanho e o Royale continua com 24; a cena começa com
  `humans = 0`. O teto de bots do aparelho corta depois, no validador, como sempre.
- **As câmeras** (o botão da câmera troca, na ordem): seguindo (a câmera de ombro atrás do bot, com a HUD dele), nos
  olhos (a 1ª pessoa do bot), livre (voa com o mapeador do P1: andar e olhar, pular sobe, agachar desce, correr 3×;
  presa na área jogável com 20 m de folga) e de cima (24 m sobre o bot, um pouco para trás, girando com a mira). A roda
  (ou o botão de trocar arma) passa para o próximo bobo vivo. Com o bobo seguido morto, a câmera de morte e, depois de
  3,5 s, quem matou (ou o próximo vivo).
- **A lista grande:** o botão do placar liga e desliga o placar do Tab (a linha do bobo seguido em destaque); também
  pelo item "Mostrar a lista" da pausa (o toque não tem o botão do placar).
- **A faixa** embaixo, no meio: "AQUÁRIO · 2× · SEGUINDO NORMAL BOB" e os botões do dispositivo, lidos do perfil ("T:
  câmera · Roda para baixo: outro bobo · E: assumir · Tab: lista · Esc: pausa"). Os textos só são refeitos quando a
  câmera, o bobo seguido, a velocidade ou o dispositivo mudam.
- **A pausa** assistindo: Continuar, a velocidade, "Assumir o bobo", a lista, os Ajustes e Sair (6 itens, o que cabe no
  celular; a Dificuldade fica para o bot assumido e para o "Mais fácil/Mais difícil" do resultado, e no Aquário ela vale
  para todos os bots).
- **A velocidade** (na pausa; cada aperto passa para a próxima): 0,25×, 0,5×, 1×, 2× e 4× no PC; até 2× no celular e
  no Switch (`aquariumMaxSpeed`, pela família do perfil). É só `driver.update(dt × velocidade)`: o passo fixo faz no
  máximo 4 ticks por frame (`MAX_STEPS_PER_FRAME`) e corta o frame em 0,1 s, então 4× a 60 fps e 2× a 30 fps cabem;
  abaixo disso, a aceleração fica no teto sem avisar (e a sim continua determinística: são os mesmos ticks). O resto da
  cena (a câmera de morte, o kill feed, o som) anda no relógio do render.
- **Assumir um bot** (o usar, ou o item da pausa): o bobo seguido vira o P1, com a posição, a vida e a arma dele; a IA
  para de pensar por ele (`setHumanControlled`, o mesmo do "entrar no meio" do sofá). Na cena, `humans` e `me`
  viraram `let`: 0 assistindo e 1 com o bot (`me` = o controlador dele, `seatCtrl = [ele]`); a receita, os nomes e as
  regras continuam os da criação. Com o bot, a partida anda a 1× e a pausa troca a velocidade por "Largar o bobo"
  (devolve à IA e volta a seguir ele). No Royale, morto e sem colega vivo, volta a assistir sozinho depois de 3,5 s (no
  BoboStrike o mesmo bot volta na próxima rodada). Assumir e largar zeram o mapeador do P1 (os apertos guardados
  enquanto se assistia não vão para o bot) e o usar que assumiu só vale depois de solto; o bot assumido continua com a
  cara dele (sem o Meu Bobo). A assistência de mira passou a ler o bobo do P1 (`me`) e não o do controlador 0: no online, o
  cliente que não era o 0 lia o bobo do host.
- **O resultado** assistindo: quem venceu ("Normal Bob venceu", "Vitória do time Azul"), o MVP e os prêmios, sem o
  Nêmesis, o Freguês e os seus números (`ResultScreenData.watching`); no FFA e no Royale, sem a linha do placar. O
  Aquário não grava estatística (nem com um bot assumido).
- **A IA:** os observadores do LOD são os controladores 0..3; no Aquário não há nenhum, então todos os bots pensam no
  ritmo cheio (o LOD C fica desligado, inclusive com um bot assumido). Ver o PERF §1m (o Royale a 2× no Switch).
- **Os testes:** a receita, as velocidades, as câmeras, a câmera livre e o próximo bobo vivo (`aquarium.test.ts`); o
  botão do Mais modos; o resultado sem os números pessoais; a pausa (assistindo e com o bot), o botão do Mais modos e o
  "Assistir" cabem nas 6 telas do teste de textos (web, celular e Switch). No Edge (`local/m7/capturar-aquario.ts`):
  o Domination e o Royale com as 4 câmeras, a lista, a pausa, a velocidade, assumir e largar, e o Royale a 4× até o
  resultado.
- **A revisão (Opus) achou 8 coisas, corrigidas antes do commit:** os apertos guardados enquanto se assistia (o clique
  que trava o mouse, pular e agachar da câmera livre, o próprio usar) iam todos para o bot no primeiro tick; acelerado,
  a sonda da qualidade contava os frames de 4 ticks e podia baixar a qualidade de vez (agora não conta acima de 1×); o
  "Ajustar desafio" mexia só no time 1; o bot assumido vestia o Meu Bobo de outro; a volta sozinha no BoboStrike a cada
  rodada perdida; o resultado do Zombies assistindo ("0 jogadores" e o recorde); os botões da faixa depois de trocar um
  botão nos Ajustes; e a troca de câmera do morto contava no relógio do render (agora no da partida). Também: a vista do
  P1 começava seguindo o controlador 0, e não o `me` (no online, o cliente que não é o 0 começava na vista do host).
- **Fica para depois:** o Aquário no sofá (cada controle assume um bot), a camada da IA (ícones de intenção, linha de
  visão e rota: gameplay.md §6.9), o "Entrar no time X" (um lugar novo), o Aquário pela sala online (a 1×) e a câmera
  do Aquário como observador do LOD da IA.

### 18.11 Fechamento do M7 (19/11/2026)

- **Os modos:** a página Mais modos tem 12 cards (os 9 do M6, o Jugg Fixo, o BoboStrike e o Bobo Royale) e o botão do
  Aquário; a Partida personalizada joga o TDM na Base Bobo e tem o "Assistir". O BoboStrike (5 contra 5 na Base Bobo,
  MR12) e o Royale (24 na Ilha Tropical; solo no card, duplas na sala online) rodam sozinhos com bots, no sofá, no
  online e no Switch; o Aquário assiste qualquer modo e assume um bot no meio.
- **Os mapas novos:** a Base Bobo (`airbase`, 144 × 48 × 144 células, de dia, 2 sites e 3 rotas) e a Ilha Tropical
  (`island`, 400 × 64 × 400 células, ~150 m de terra, a vila, o loot e as largadas do Royale).
- **As versões:** snapshot 18 e `PROTOCOL_VERSION` 8 (as rodadas, a bomba e o dinheiro, o Royale com a zona e o loot);
  as tabelas `ROYALE`, `ROYALE_RARITY` e `ROYALE_WEAPONS` entram no hash de conteúdo da sala.
- **Os goldens do M7** (`game/src/scene/golden.test.ts`): Jugg Fixo `9074d33b`, TDM na Base Bobo `e3158452`,
  BoboStrike `9bf9f851` e Royale solo com 24 `38d57bd4`. Os 11 de antes não mudaram no M7 (TDM `b36eb8e1`, Zombies
  `edc93590`, Posto `6c4eaf90` e os 8 do M6).
- **O custo:** `PERF.md` §1k (a ilha), §1l (o Royale e o LOD C), §1m (o Aquário) e §1n (sim + IA de cada card do M7).
  Nenhum modo do M7 pesa mais que o dobro do TDM no PC; no Eden, o Royale com 24 roda a 57–58 fps (§4).
- **O menu da web** fechou o M7 em 348,4 KB (o teto é 350 KB): os modos novos moram no pedaço dos editores e da cena.
- **Perguntas abertas** (no padrão até a resposta): Y5 e AB2 (24 no celular e no Switch com 2 ou mais, depois do
  bench no console), Y7 e AB3 (o Royale só com bots acaba em 1 a 3 min), Y8 e AC1 (o Aquário fora do menu principal),
  AB1 (a parede da zona), AB4 (o formato do card do Royale), AC2 (os bots com o mesmo nome) e AC3 (a velocidade só
  pela pausa).
- **Fica para depois do M7:** o Bobo Sandbox completo (Y6); a zona no minimapa, a arma nas costas e o seletor de duplas
  e quartetos no card do Royale; o Aquário no sofá, a camada da IA no Aquário, o "Entrar no time X", o Aquário pela sala
  online e a câmera do Aquário como observador do LOD da IA; e o bench do Royale no console (o Eden não mede o tempo
  de quadro).

## 19. M8: compartilhar, o Diretor e o Arcade

Plano em `docs/PLANO_M8.md` (P-004, no padrão do #81; pergunta Z1).

### 19.1 Fase 0: o código comum (19/11/2026)

- **Os códigos** (`format/src/share-code.ts`): `<prefixo>` + base64url(deflate nível 9 do JSON). O bot é `BF1-`, o
  preset `BFP1-`, o esquadrão `BFS1-` e a semente do Surpreenda-me `BFR1-` (o número é a versão do código; o JSON
  tem a dele). No máximo 4.000 caracteres (o prefixo incluso) e 64 KB descompactado: o inflate é em fatias e para no teto
  (um código pequeno que abriria em 1 MB volta `tooBig`). O base64url é próprio (sem `btoa`). Colado com espaços,
  quebras de linha, os invisíveis de alguns apps ou o prefixo em minúsculas, o código abre igual.
- **Os links:** `#bot=` e `#p=` com o código sem o prefixo (`shareLinkHash`, `shareCodeFromHash`); a casca da web lê
  o hash (fase 1) e o `format` só vê a string (regra 3).
- **A importação** (`share-import.ts`, `importShareCode`): abre o código, valida pelo tipo (`validateBot`,
  `validateMatchRecipe` com o teto do aparelho), recusa mais de 16 bots embutidos e id de bot com mais de 48
  caracteres, normaliza o `look` e passa o filtro nos nomes (o do bot, o do preset, os dos times e os dos embutidos: o
  barrado fica vazio, com o aviso `name.blocked`, e quem importa dá um nome do gerador). Os esquadrões e a semente
  abrem nas fases 2 e 3.
- **O filtro de nomes** (`name-filter.ts`, `isNameAllowed`): pt-BR e inglês, local. Sem `normalize`/`Intl` (o
  Switch pode não ter os dados de Unicode): os acentos saem por tabela; os invisíveis somem; números e `@ $ !` viram
  letra só na palavra que tem letra ("Bot 455" passa); as letras repetidas se juntam (3 ou mais viram 2, e também 1).
  As raízes longas casam dentro de cada palavra; as palavras curtas só sozinhas, com a vizinha ("vi ado") ou com as
  letras soltas ("p u t a"). Falsos positivos conhecidos (uma raiz dentro de um nome de verdade): Shitake, Scunthorpe,
  Penistone.
- **As armas das regras do bot** (`validateBot`): só os ids de arma conhecidos (a aposentada vira a substituta); o
  resto cai com `content.missingWeapon`. Antes, um texto qualquer passava e aparecia cru no card e no placar.
- **A revisão (Opus) achou:** o texto das armas acima; os falsos positivos de juntar as palavras ("Push It", "Bo
  Stark", "Dona Zica", "Bot 455", "Dick Vigarista", "Bob kkk") e os furos das letras triplicadas, dos invisíveis, da
  palavra partida e do 6 e 9; o teto dos embutidos também depois da validação; o `look` e o `id` sem teto; e a ordem
  do prefixo antes do tamanho. Tudo corrigido antes do commit.
- **O menu da web** não mudou (348,4 KB): nada do menu importa estes módulos (o `format` não tem efeito colateral);
  a fase 1 os usa só no pedaço dos editores.

### 19.2 Fase 1: a Oficina com códigos (19/11/2026)

- **Compartilhar** (`game/src/share.ts`, `ui/src/screens/share.ts`, no pedaço dos editores): o botão Compartilhar no
  card da Oficina (o bot) e a linha "Compartilhar (código e link)" no fim da aba Partida da Partida personalizada (o
  preset; fora da sala do Online). A tela mostra o tamanho do código e tem Copiar código, Copiar link e Colar um código.
- **Receber:** o código colado (o campo escondido da web; colado inteiro, abre sem o Enter) ou o link `#bot=` / `#p=`
  (a casca lê o hash uma vez, como o `#sala=`, e limpa a barra; quem abre é o pedaço dos editores) mostra o que veio
  e o resumo do que mudou (os avisos do validador e os nomes barrados). O bot vira um bot seu (id novo; o nome barrado
  ganha um do gerador; o repetido, "Jorge 2"); a partida joga ou vira um preset salvo.
- **Só na web:** no Switch os botões não aparecem (sem colar texto nem rede; os arquivos do SD continuam, pergunta Z2).
- **O deflate dos códigos** (`format/src/deflate-lite.ts`): um bloco com o Huffman fixo e o LZ77 guloso (janela de 32
  KB). O `deflateSync` do `fflate` punha o compressor inteiro no menu da web (o `fflate` é um módulo só, e o menu já
  leva o inflate dele para o atlas das fontes): +2,8 KB em gzip, acima do teto. O deflate pequeno mora só nos editores e
  a volta usa o inflate de sempre. Um bot vira ~750 caracteres (o `fflate` no nível 9 faria ~580) e um preset com 16
  bots embutidos ~1.900. O UTF-8 também é próprio (o `strToU8` do `fflate` traria o `TextEncoder` dele).
- **O menu da web** ficou em 348,9 KB (+0,4: a cola no `game.ts` e na casca).
- **A revisão (Opus) achou, corrigido antes do commit:** a tela de colar não saía sem teclado (agora o Voltar anda pelo
  mouse, pelo toque e pelo B do controle com o campo aberto); o link da carga podia tirar o jogador de uma partida (o
  pedaço dos editores chegava depois do JOGAR) ou se perder (agora espera o jogador no título); os nomes de fora agora
  só com o que a fonte desenha (sem controle, quebra de linha nem marca de direção); o link colado no lugar do código
  abre; a partida recebida salva uma vez só e o nome com o sufixo cabe no teto; o aviso do bot salvo na volta à Partida
  personalizada; o Bobo Training recebido não vira o último preset; e a linha Compartilhar só na aba Partida.
- **Limites conhecidos:** sem a área de transferência (o navegador recusou), o código não aparece em texto para copiar
  à mão; e um link aberto numa aba onde o jogo já está aberto não faz nada (o hash é lido só na carga, como o
  `#sala=`).

### 19.3 Fase 2: os esquadrões (19/11/2026)

- **O formato** `squad@1` (`format/src/squad.ts`): o nome (até 24), até 8 entradas (o bot e quantos, de 1 a 16) e, só no
  código, os bots da Oficina embutidos. No save, as entradas apontam para os bots de fábrica (`builtin:`) e para os da
  Oficina (`embedded:<id>`, resolvidos na hora de usar: o bot que sumiu vira o Normal Bob, como no preset). Até 100
  esquadrões na web e 30 no Switch; a chave `squads` do save; o `backup@1` leva os esquadrões (o backup antigo sem
  eles: nenhum). A leitura das listas do save (os bots e os esquadrões) virou uma função só (`readDocList`).
- **A Oficina** saiu do `game.ts` (o menu da web) para o pedaço dos editores (`game/src/workshop.ts`): a lista ganhou o
  grupo Esquadrões (com o "+ Novo esquadrão"), o card do esquadrão (as entradas e o total; sem o Favoritar), as ações
  (Editar, Duplicar, Apagar, Compartilhar) e o editor (o nome pelo teclado do sistema ou o do jogo, cada bot com
  quantos, "+ Adicionar bot"; o "–" no 1 tira o bot; Voltar com mudança pede confirmação). O compartilhar abre por cima
  da Oficina. O `game.ts` só abre, volta e leva ao Laboratório: o menu caiu de 349,4 para 349,0 KB com os esquadrões.
- **O código** `BFS1-` (sem link: o GDD só dá link ao bot e ao preset) leva os bots da Oficina do esquadrão. Quem
  recebe ganha os bots na Oficina (ids novos, nomes pelo filtro) e o esquadrão com as entradas apontando para eles; sem
  lugar para todos, nada entra.
- **Na Partida personalizada:** os esquadrões entram no fim das escolhas do bot de cada time (não no apoio do Zombies);
  o time recebe as entradas do esquadrão e a linha mostra o primeiro bot e quantos tipos a mais ("Jorge the Immortal
  +1"). Com várias entradas, a quantidade mexe na última (que sai a 0), e o corte do mapa respeita as entradas.
- **A revisão (Opus) achou 8 coisas, corrigidas antes do commit:** fechar o compartilhar aberto pela Oficina repetia o
  aperto na Oficina (o B voltava ao título; o A reabria o compartilhar): agora espera soltar e põe o foco no que chegou;
  o esquadrão de um bot só e a cópia de um esquadrão travavam a escolha na Partida personalizada (agora ficam de fora, e
  a linha mostra o nome do esquadrão); o bot que não existe (o de fábrica desconhecido, o da Oficina que sumiu) virava
  uma chave crua (agora o Normal Bob, com aviso); um código feito à mão podia deixar bots soltos na Oficina; o teste de
  id do esquadrão não pegava colisão; cancelar a digitação marcava mudança; o editor perdia o foco da lista; e um frame
  em branco ao abrir o compartilhar.

### 19.4 Fase 3: o Surpreenda-me completo (19/11/2026)

- **O sorteio** (`game/src/surprise.ts`, no pedaço dos editores): um dos 14 modos com card (com peso: os Times 6, o FFA
  3, os de festa 1 ou 2), o mapa (só os Times, o FFA e o Zombies clássico sorteiam: os outros dependem do mapa deles), a
  arma (35% das vezes uma arma só da escada do Gun Game) e de 0 a 3 modificadores sem conflito (só nos modos de regra
  livre: Times, FFA e Domination; o Confete fica de fora), o nível dos bots e de 0 a 2 bots estrela (Jorge the Immortal,
  Camper Carl, Knife Ninja, Scaredy Sam, Hunter Hank, Goofy Gus) no lugar de bots do time adversário (o time não
  cresce). A receita leva o nome "Surpreenda-me". A mesma semente dá o mesmo sorteio.
- **O cadeado:** cada linha (Modo, Mapa, Armas, Modificadores, Inimigos) trava com um aperto ("· travado"); o Rolar de
  novo muda só as outras. O mapa travado que não vale para o modo novo é sorteado de novo; tudo travado, o Rolar de novo
  solta tudo.
- **O código** `BFR1-` guarda o sorteio em si (com a versão da tabela, `v: 1`), não a semente: quem colar joga a mesma
  partida mesmo com o conteúdo mudando. O "Colar um código" da Oficina abre o sorteio (Jogar ou Salvar preset); o que
  não existe mais é recusado e o campo estragado cai no padrão. O Copiar código é uma linha no fim (4 botões embaixo
  não cabem no celular).
- **O menu da web:** o Surpreenda-me saiu dele (a tela antiga, o `rollSurprise` dela e o estado no `game.ts`); o menu
  caiu para 348,9 KB. O sorteio simples (Times ou FFA) continua só para a partida da sala do Online.
- **O card:** cada linha mostra o valor curto (o 1º modificador e quantos a mais; o nível e quantas estrelas): a área do
  valor tem ~23 letras. Embaixo do título, o que não cabe (o tamanho e o tempo dos Times e do FFA, os modificadores e as
  estrelas pelo nome); o cadeado vai no rótulo ("INIMIGOS · TRAVADO"); direita trava, esquerda solta, o confirmar
  alterna (segurar não pisca). O teste de textos confere o valor entre as setas nas 6 telas.
- **A revisão (Opus) achou, corrigido antes do commit:** o tamanho dos Times passava do teto do mapa (o Ringue com 6
  contra 6; agora o teto da Partida Rápida); a Infection mostrava estrelas que não entravam (o time dela é o dos
  infectados: sem estrela) e o Zombies, um nível que não vale; o nome "Surpreenda-me" apagava o do card (o Gun Game, a
  Fortaleza: agora o nome do modo fica); o mapa travado que não coube no modo novo ficava travado num mapa que o jogador
  não escolheu (agora o cadeado sai); o código colado não cortava no teto do aparelho (agora valida e avisa, com o
  "versão mais nova"); o "troca por abate" e a munição infinita da faca com uma arma só; e a tela abria mesmo com o
  jogador já em outra (o pedaço dos editores chega depois).

### 19.5 Fase 4: o Nêmesis com memória (19/11/2026)

- **A memória** (`stats@1`, o campo opcional `nemesis`, sem mudar a versão): o rival é guardado pelo id do documento
  do bot (o de fábrica, como `normal-bob`, ou o da Oficina: vários bots com o mesmo id contam juntos), com o nome,
  quantas vezes te pegou, quantas você o pegou e em quantas partidas. A cena grava pelo núcleo (`SceneStats.setNemesis`).
- **A regra** (`scene/nemesis.ts`, `updateNemesis`): numa partida em que o rival está do lado de lá (no FFA, qualquer
  um; o rival aliado, como o bot de apoio do Zombies, não conta), ele soma os abates dos dois lados e mais uma partida;
  o Nêmesis da partida (o que mais te pegou) vira o rival novo se te pegou mais que o de antes nesta partida. Sem abate
  no jogador, não há Nêmesis. Só nas partidas que gravam estatística (fora do Aquário e do bench).
- **O aviso:** na contagem do começo, uma 2ª linha em âmbar ("Seu Nêmesis voltou: Jorge the Immortal · te pegou 7,
  você 3") quando ele está do lado de lá; a linha mais comprida encolhe para caber em 640×360.
- **No resultado:** embaixo do Nêmesis, "Na rivalidade: te pegou 12, você 4 · 3 partidas" quando o Nêmesis da partida
  é o rival guardado.
- **A IA não muda** (pergunta Z3): um Nêmesis que "te persegue" mudaria a partida e os goldens.
- **A revisão (Opus) achou, corrigido antes do commit:** o jogador do sofá que entrou no meio contava como o bot que
  ele assumiu (agora o controlador que um jogador já assumiu fica de fora); o "lado de lá" errava na Infection (quem é
  infectado muda: agora todos contam) e no aviso do Royale (os esquadrões saem da largada: todos); o candidato vinha da
  entidade, e não da soma do id (5 Normal Bobs com 1 abate cada perdiam para um Jorge com 2); a rivalidade aparecia já
  na 1ª partida ("· 1 partidas": agora com 2 ou mais, e com o nome do rival); o id longo demais (não volta igual do
  save) fica de fora e o nome é cortado por letra; e o aviso usa o nome de agora (o bot da Oficina renomeado). Na Horda
  Armada, os soldados da horda são bots do time 1: eles também viram rival.

### 19.6 Fase 5: o Diretor de Partida (19/11/2026)

- **A receita** ganha o bloco opcional `director` (`{ goal?: 'relax' | 'balanced' | 'challenge' }`; sem o bloco,
  desligado; sem o objetivo, Equilibrado). O validador do `preset@1` lê o objetivo da lista (fora dela, aviso); a
  versão não muda (campo novo opcional). Vai junto nos presets salvos e nos códigos `BFP1-`.
- **A medida** (`ai/match-director.ts`, `MatchDirector`; números em `AI_DIRECTOR` no `ai/config.ts`): a cada 10 s de
  sim, soma os abates e as mortes das entidades de quem é humano agora (no sofá, o grupo) e guarda num anel de 19
  amostras; a cada 3 amostras (30 s) compara o K/D da janela de 3 min (no começo, desde a linha de base) com a faixa
  do objetivo (Relax 2–3, Equilibrado 1–1,5, Desafio 0,7–1). Acima, os bots melhoram 1/4 de nível; abaixo, pioram;
  dentro, nada. Precisa de 4 eventos na janela; o ajuste fica em ±1 nível (±4 quartos) e dentro da folga dos bots.
  Só lê a `SimView` nos ticks da sim: determinístico (o replay e o golden reproduzem).
- **Quem é humano agora:** os controladores `0..humans-1` no começo; o `setHumanControlled` (o jogador do sofá que
  assume um bot, o que sai e volta a ser o cérebro de reserva, o amigo online que cai) marca e desmarca. Quando muda,
  o conjunto de bots que mudam é refeito e a janela recomeça dos totais de agora (o placar de quem chegou não vira um
  salto no K/D).
- **O ajuste** (`ai/skill.ts`, `skillShift`): multiplica a reação, o erro de mira, a aquisição e o giro do bot. Cada
  campo anda na tabela dos 5 níveis a partir de onde o valor do bot está nela (o inverso da interpolação; fora da
  tabela, a ponta, na proporção): num bot de nível, a mira fica exatamente entre os dois níveis; num da Oficina, com a
  mira de um nível e o cérebro de outro, vale a mira. Inteligência, personalidade, regras, recuo e cabeça não mudam.
  Sem ajuste os multiplicadores são 1 exato: os goldens não mudam. O "Ajustar desafio" da pausa troca o nível; o
  ajuste continua valendo sobre o nível novo, dentro da folga nova.
- **A folga** (`skillRoom`): quanto a mira dos bots que mudam ainda pode melhorar e piorar na tabela (em quartos; o
  campo com mais folga, até ±1 nível). O ajuste não passa dela: com inimigos Tryhard o placar não mostra "+1" sem
  mudar nada, e a volta não espera ajustes vazios.
- **Quem muda:** só os bots da receita (os cérebros de reserva do sofá são dos humanos), fora os que um jogador pilota,
  dos times de agora sem humano (o `team` da `SimView`: no Royale, o esquadrão, então os colegas do humano ficam de
  fora); no FFA e na Infection (quem é infectado muda), todos; com humano em todo time (o sofá dividido), todos.
  Desligado no Bobo Zombies (a Partida personalizada tira o bloco ao passar para lá), no Aquário (sem humanos) e sem
  bots.
- **Na tela:** no placar do Tab, "Diretor: bots –½" em âmbar embaixo do título (`ScoreboardModel.note`; sem espaço, o
  placar cheio em 640×360, na ponta direita da linha do título); na pausa, "Diretor de Partida (Equilibrado): bots –½";
  na Partida personalizada, a linha "Diretor de Partida" na aba Bots (Desligado → Relax → Equilibrado → Desafio); no
  resumo da partida, "Diretor ligado". O sinal de menos é o travessão – e as frações ¼ ½ ¾ do Latin-1 (estão na fonte
  do HUD; o − matemático não está).
- **Online (pergunta Z4):** os bots rodam só no host, então só ele ajusta e só o placar dele mostra o ajuste; o resumo
  que o host publica no lobby leva o "Diretor ligado" para os clientes. Sem mudar o protocolo nem o snapshot.
- **A revisão (Opus) achou, corrigido antes do commit:** a frase de ajuda da aba Bots com 196 letras saía da tela
  (agora tem 74, e um teste com o atlas real mede a mais longa da Partida personalizada); o ajuste subia no placar nas
  pontas da tabela sem fazer nada (a folga); o bot da Oficina andava pela inteligência e não pela mira (de 6° para 15°
  com −1 nível); quem conta como humano e quais bots mudam eram fixos desde a criação (o sofá que entra no meio e o
  cérebro de reserva de quem saiu); e, no Royale em dupla ou quarteto, os colegas de esquadrão do humano também
  mudavam. O custo no pedaço do menu: ~114 B gzip (o validador e a pausa também estão nele); o menu ficou em 349,2 KB.
- **Fica para depois** (gameplay.md §6.8): o modo Personalizado do Diretor (sliders), a agressividade, o número de
  bots ativos e o ritmo e a distância de spawn, e o Zombies (ritmo da horda, especiais e drops); trocar o objetivo na
  pausa (a pausa só mostra).

### 19.7 Fase 6: as ordens aos bots aliados (19/11/2026)

- **No quadro** (`input/actions.ts`): a ordem vai nos bits 12 a 14 do campo de botões do `InputFrame`, fora da
  `BUTTON` (não tem tecla: sai da roda): `ORDER` (1 Vem comigo, 2 Segura aqui, 3 Ataca ali, 4 Me cobre), com
  `frameOrder`/`withOrder`. O tamanho do quadro não muda; o protocolo sobe para 9 (`PROTOCOL_VERSION` e o
  `net.json`), para um host e um cliente de versões diferentes não se misturarem. O `game` segura a ordem no quadro
  por 6 ticks (a rede pode perder um); a sim e a IA agem na borda (o valor mudou para uma ordem).
- **A roda** (`game/scene/match.ts`, `updateOrders`): a ação local `orders` é o aviso segurado (`holdSources`: o
  mouse do meio, o N sem mouse, o D-pad de cima), e o aviso desse botão passou a valer no toque curto (`tapSources`:
  ao soltar antes de 0,3 s, um pulso do mapeador), para abrir a roda não soltar um aviso antes; remapear o aviso leva
  os dois junto. No toque, um botão Ordens novo (ao lado da Vista). Segurando, a roda abre: o giro move o cursor e o
  quadro leva a mira da abertura enquanto a roda está aberta e a ordem sai (o boneco não treme para os outros, o tiro
  não sai torto e o Ataca ali cai onde a mira estava); soltando com uma ordem apontada, ela vai. No toque, o botão abre e fecha e tocar numa ordem manda. Desenhada pelo anel da compra
  do BoboStrike (`buyTitle`, `primaryNames`, `primarySelected` e o acerto do toque por `primaryHit`): no alto Vem
  comigo, à direita Segura aqui, embaixo Me cobre (no Zombies e no Royale em grupo, Me revive), à esquerda Ataca ali.
  Fechada fora dos times (FFA, Juggernaut), morto, na compra do BoboStrike e na pausa.
- **Na sim** (`systems/signals.ts`): na borda da ordem, um balão em cima de quem mandou (os tipos 5 a 8 do evento
  `signal`, sem mudar o formato) e, no Ataca ali, o ping onde a mira bate; a espera das ordens é à parte da do aviso
  (o aviso apertado ao segurar o botão não segura a ordem). O `game` mostra o balão da ordem só ao time de quem
  mandou.
- **Na IA** (`ai/orders.ts`, `director.ts`, `soldier.ts`): o diretor dos bots lê a ordem de cada humano de agora na
  borda e passa aos até 4 bots aliados mais perto (em 50 m) da receita que ninguém pilota; do N2 para cima, cada um
  sorteia pela lealdade (o fluxo `fork('orders')`, à parte dos cérebros). Obedecendo: Vem comigo e Me cobre andam até
  ficar atrás de quem mandou (3 m e 2 m; voltam passando de 6 m e 4 m); Segura aqui fica a 2,5 m do ponto; Ataca ali
  vai até o ponto (chegando, a ordem acaba e ele caça dali); no Zombies e no Royale em grupo, o Me cobre levanta quem
  mandou antes do caído mais perto. A ordem entra no passeio antes da caça (com inimigo à vista, o bot briga antes)
  e cai quando vence (60, 45, 40 e 60 s), quando o bot morre ou (Vem comigo, Me cobre) quando quem mandou morre.
  Parado pela ordem, o bot não pede rota nem conta como empacado (sem o Destravar). A resposta (quantos ouviram e
  quantos obedeceram) vai para a plaquinha da dica de quem mandou ("Vem comigo: 2 de 3 bots").
- **O aviso dos humanos** também vale para os bots: entra no quadro do time como o aviso de um bot N3 (quem ouve
  avisos vai conferir o ponto), marcado como do humano para não virar um segundo marcador na tela.
- **A lealdade** (`bot@1`, `personality.loyalty`, 0..1): o documento sem ela ganha a do preset (sem mudar a versão).
  Pergunta Z6: Suporte 100%, Estrategista 90%, Equilibrado, Covarde e Camper 70% (com os cortes do Covarde no Ataca
  ali, 50%, e do Camper no Vem comigo, 30%), Rusher, Kamikaze, Caçador e Palhaço 40%, Lunático 20%; o boneco de
  treino não obedece. O Laboratório ganhou a linha Lealdade.
- **Online:** o cliente manda a ordem no quadro dele; o host lê e os bots (que só rodam lá) obedecem. O balão e o
  ping vêm pelos eventos de sempre; a resposta "2 de 3 bots" é só de quem joga no host (o cliente, sem o diretor, vê
  "Vem comigo: ordem dada"). Pulando quadros atrasados, o host guarda a última ordem dos pulados (é um valor, não
  bandeiras: somar 2 e 4 daria 6).
- **A revisão (Opus) achou, corrigido antes do commit:** o ponto atrás de quem mandou caía do outro lado da parede
  (agora um raio para trás o prende do lado de cá, dentro do raio de parar, e "parado" exige o mesmo andar); o Ataca
  ali para o céu ou o vazio virava um laço de Destravar (agora o ponto cai no chão embaixo da mira, sem chão a ordem
  não vale e a tela pede para mirar no chão; sem rota, o Segura aqui e o Ataca ali caem e o Vem comigo espera);
  reenviar a ordem vencia a lealdade (quem recusou não sorteia de novo a mesma ordem do mesmo humano por 15 s, e quem
  já cumpre só renova); abrir a roda soltava um aviso; a mira do quadro mexia com a roda aberta; o Me revive mandado
  caído não mostrava balão (a sim agora deixa a ordem passar caído; a IA ignora o que a sim ignora: a contagem, fora
  da rodada valendo e o aviso de quem está caído); as ordens atravessavam as rodadas do BoboStrike (a rodada nova
  tira todas); e a rede somava ordens dos quadros pulados.
- **Fica para depois:** a resposta para o cliente online (uma mensagem curta do host) e o filtro do Me cobre pelos
  inimigos que atacam quem mandou (hoje ele só cola e levanta).

### 19.8 Fase 7: o perfil Arcade (20/11/2026)

- **O perfil** (`sim/config/movement.ts`, `MOVEMENT_ARCADE`): os números do GDD §4.2.2 (andar 5,5 e correr 8,0 m/s,
  pulo de 1,3 m, escalar até 2,0 m, sem dano de queda) e as escolhas da fase, revisáveis (`ARCADE_TUNING` e o
  perfil): aceleração 70 m/s², controle no ar 0,45, deslize de 0,9 s que começa em 9 m/s ou na velocidade que já
  tinha e termina em 3/4 dela, o pulo duplo com 0,9 da velocidade do pulo (e virando para onde o jogador aponta), a
  janela do bunny hop de 0,1 s no chão e o empurrão do wall jump de 5,5 m/s. Liga pela regra `players.movement:
  'arcade'` ou pelo modificador novo `arcade` (fixo na receita; fora da Roleta do Chaos, que troca no meio da
  partida); a Partida personalizada mostra os dois (a linha Movimento e a aba Modificadores), e o Surpreenda-me pode
  sortear o modificador.
- **O movimento** (`systems/movement.ts`): o pulo duplo (um por pulo); o bunny hop (pulando logo depois de pousar, a
  velocidade do pouso ou a de agora, a maior, +5%, até 12 m/s; no ar, o controle do Arcade vira sem frear, para o
  momento chegar ao pouso); o wall jump (no ar, encostado a até 0,15 m de uma parede em ±X ou ±Z, um degrau acima
  dos pés: sobe e é empurrado para longe dela; cada parede, pelo lado e pelo plano da face no contato, uma vez por
  voo, e no máximo duas por voo; senão o toque vira o pulo duplo); o deslize que mantém o momento; correr não corta o
  tiro e a dispersão correndo é a de "no ar" (`weapons.ts`, e a mira da HUD acompanha). O teto de 12 m/s (com a
  regra de velocidade do bobo) vale também no wall jump e no deslize. O bunny hop e o wall jump são só de quem joga,
  pela marca de quadro de jogador (`FRAME_HUMAN`, o bit 15 dos botões, que o mapeador liga e a IA nunca): quem
  pilota um bot faz, e o cérebro de reserva no lugar de quem saiu, não; os bots não fazem (gameplay.md §3.6), mas
  pulam duplo. Caindo com o chão ao alcance do pulo guardado, o toque é o pulo do pouso (o bunny hop), não o duplo. A escalada no ar continua no
  teto do degrau de 0,5 m (1,8 m com o pulo de 1,3 m); com o pulo duplo, os 2,0 m sobram.
- **O estado** (`state.ts`, `arcadeFields`: pulos no ar, ticks no chão desde o pouso, as velocidades do pouso e do
  deslize e as chaves das duas paredes do voo): zera no nascer e ao cair, e só entra no hash e no snapshot com o
  Arcade (`ctx.arcade`), como os campos do Zombies e do Royale: os goldens dos outros perfis não mudam. O snapshot da
  sim sobe para 19.
- **A predição do cliente online** leva os 6 campos (`PREDICT_STATE_SIZE` 16 → 22), e o estado privado do snapshot da
  rede também (os contadores em 16 bits; as velocidades e as chaves das paredes em f32: as chaves são inteiros abaixo
  de 2^24, exatas). `MOVEMENT_ARCADE` e `ARCADE_TUNING` entram no hash de conteúdo do handshake. O protocolo sobe
  para 10 (e o `net.json`); a marca de quadro de jogador não conta como atividade na rede.
- **Na tela:** com o modificador ligado, a linha Movimento mostra Arcade (mexer nela tira o modificador) e a linha
  Dano de queda mostra o padrão do perfil (desligado no Arcade).
- **A revisão (Opus) achou, corrigido antes do commit:** o wall jump guardava só a última parede (num corredor, A-B-A-B
  subia 40 m: agora duas paredes por voo, uma vez cada); o pulo duplo com o analógico pela metade freava (de 8 para
  2,4 m/s); quem é humano pelo índice do controlador errava nos dois sentidos (agora a marca do quadro); a sonda da
  parede pegava o meio-fio; o wall jump e o deslize passavam de 12 m/s; as tabelas do Arcade fora do hash de
  conteúdo; a tela mostrava dano de queda e o perfil errado com o modificador; o pulo duplo comia o pulo guardado do
  pouso; o estado do Arcade ficava no caído; o bunny hop ignorava a regra de velocidade (o Jugg); a janela do bunny
  hop dependia do Hz; e a chave da parede saía da ponta da sonda. Os testes agora cobrem a mesma parede de verdade,
  o corredor, o meio-fio, o bot, o analógico, os 30 Hz e a predição.

### 19.9 Fechamento do M8 (20/11/2026)

- **O que entrou:** os códigos e os links de compartilhar (o bot, o preset, o esquadrão e o Surpreenda-me), os
  esquadrões na Oficina e nos times, o Surpreenda-me completo (14 modos, o cadeado e o código), o Nêmesis com memória,
  o Diretor de Partida, as ordens aos bots aliados (com a lealdade) e o perfil Arcade (perfil e modificador). O Bobo
  Sandbox e os modificadores Mini, Bots gigantes e Ricochete ficam para o M9 (pergunta Z1).
- **As versões:** `PROTOCOL_VERSION` 10 (a ordem nos bits 12 a 14 do quadro, a marca de jogador no 15 e o estado do
  Arcade no privado do snapshot) e o `net.json` junto; snapshot da sim 19 (os campos do Arcade, só com ele); formatos
  novos `squad@1`; os campos opcionais `director` (receita) e `loyalty` (bot) sem mudar versão.
- **Os goldens:** os 15 de antes do M8 não mudaram (TDM `b36eb8e1`, Zombies `edc93590`, Posto `6c4eaf90`, os 8 do
  M6 e os 4 do M7): o Diretor só mede com humanos, as ordens só sorteiam no fluxo delas e o estado do Arcade só entra
  no hash com ele. O golden novo do M8: o TDM com o Arcade no Construto (`3e7df5b3`, 15 × 18). A partida pela rede de
  mentira (`net/src/match.test.ts`) roda também com o Arcade (os humanos pulando duplo): termina igual no host e nos
  3 amigos, com a predição abaixo de 1% de erro.
- **O custo:** `PERF.md` §1o (sim + IA por tick com o Arcade e com o Diretor: iguais à referência, no ruído). O menu
  da web ficou em 349,6 KB de 350: o que o M8 pôs nele (os textos curtos, o validador do `director`, a lealdade, as
  ordens no `input`) está no limite, e a próxima coisa do menu precisa tirar algo antes (pendência para o M9).
- **As revisões:** uma do Opus por fase, todas com achados corrigidos antes do commit (as listas nas §19.1 a §19.8).
- **Fica para depois:** a resposta das ordens para o cliente online, o Diretor no Zombies e nos spawns, o Personalizado
  do Diretor, trocar o objetivo do Diretor na pausa e o filtro do Me cobre pelos atacantes de quem mandou.

## 20. M9: o Bobo Sandbox e os modificadores de tamanho

Plano em `docs/PLANO_M9.md` (#82; pergunta AH1). As fases andam em pistas paralelas (agentes com worktree próprio) e
entram no `main` uma por vez, com o portão, a revisão e o commit de cada uma; a ordem dos commits é a de chegada.

### 20.1 Fase 2: o Sandbox na receita e na sim (20/11/2026)

- **A receita** (`format/src/match-recipe.ts`): no time, `hp` (1 a 1000, arredondado) e `weapons` (validadas como
  o `weapons.allowed`); o bloco `sandbox: { objective }` (`points`, `elimination` ou `none`; o padrão é
  `points`), que fora do modo `sandbox` cai com `recipe.invalidField`. Sem versão nova de formato. Para o menu
  não crescer, os leitores dos blocos do Juggernaut, do Royale e do Diretor viraram um só, e a checagem de lista de
  armas um ajudante.
- **O objetivo** (`sim/systems/sandbox.ts`, `SANDBOX_DEFAULTS` em `sim/config/rules.ts`): em `points` e
  `elimination`, o tempo e a meta que faltam na receita viram os do TDM (600 s e 75 abates); o 0 explícito continua
  "sem limite". A eliminação ignora a meta: ninguém renasce, vence o último time com alguém vivo (os últimos morrendo no
  mesmo tick dão empate) e só decide partidas que começaram com 2 times ou mais. No fim do tempo, vence o time com mais
  vivos; no empate, os abates entre os empatados; depois a morte súbita de 60 s; depois o empate. O `finish()` usa a
  mesma regra. `none` ignora os dois limites.
- **As regras por time:** só no modo `sandbox`, para humanos e bots. O HP próprio do bot (`bot@1`, quando não é
  o padrão de 100) e a lista de armas dele (quando não vazia) valem sobre as do time. As armas do time cruzam com o
  `weapons.allowed` da partida (sem nada em comum, fica a da partida) e são tudo o que o time carrega: `['shotgun']`
  tira a pistola, a faca e a granada. O renascer remonta o equipamento pela mesma máscara.
- **As casas dos times 2 e 3:** quem tem spawn no mapa fica com eles. Cada time sem spawn ganha uma casa no meio do
  maior vão de ângulo entre as bases que existem, na distância média delas ao centro da área de jogo (no Construto, o
  time 2 a oeste e o 3 a leste), com até 4 pontos em cruz a 2,5 m pela grade de navegação; os spawns "de qualquer time"
  mais perto de uma casa que de outra base viram daquele time. Sem navegação, os "de qualquer time" mais perto. Os
  outros modos usam os spawns do mapa como sempre.
- **A sim:** o Sandbox tem a regeneração, as caixas de munição e o placar por abate do TDM (`isWarfareMode`). Nada
  entra no estado, no hash ou no snapshot (a versão fica 19): as regras saem da receita, que o amigo também tem.
- **A IA:** na eliminação, o bot sem alvo anda até o inimigo vivo mais perto (com 6 m de desvio sorteado). A
  hostilidade já era `time !==` e o quadro do time já tinha 4 times.
- **O golden do Sandbox:** `35764306` (4 times de 3 bots Normais no Construto, cada time com HP e armas próprios,
  eliminação; 38 s, vence o time 2 com 1 de pé). Os 16 de antes não mudaram.
- **A revisão (Opus) achou:** a eliminação sem tempo podia não acabar (um time escondido onde a navegação não chega):
  agora ela sempre tem tempo (o 0 vira os 600 s do Sandbox), e a caça pula o inimigo que a navegação não alcança; o
  Destravar na eliminação curava (o renascer completo): agora fica com a vida e sem proteção, como o Jugg; o time que
  começa vazio ganhava casa e roubava o ponto sem time do vizinho; e os zumbis do teste de carga liam os spawns do mapa
  em vez dos da partida. Tudo corrigido antes do commit; o golden do Sandbox ficou `35764306` (38 s; o Verde vence
  com 1 de pé). Para a fase 3: o HUD ler o tempo e a meta de verdade (não os da receita), a tela de morte da eliminação
  sem contagem para renascer e o "entrar no meio" do sofá sem cair num bot morto.
- **O menu da web:** 349,7 KB (+0,1): o validador ficou do mesmo tamanho com a junção dos leitores de bloco.

### 20.2 Fase 0: a dieta do menu da web (20/11/2026)

- **O número:** o menu (HTML + JS + atlas MSDF, `size-check`) foi de 349,6 para **332,3 KB** (331,7 antes da revisão) (o `index-*.js` de
  96,1 para 78,9 KB); a primeira partida subiu de 900,1 para 902,3 KB (o código mudou de pedaço, não sumiu). A medida
  de antes, módulo por módulo, saiu de um build com sourcemap; o `three` (130 KB) continua no menu, e só desenhar o
  menu em WebGL2 cru chegaria na meta de 300 KB (fica como ideia, não como fase).
- **Os textos** (`ui/src/strings*.pt-BR.ts`): a tabela do menu ficou com as 127 chaves que o pedaço do menu lê de
  fato (achadas pelo build); 466 foram para a tabela extra (Configurações, nomes de botão, pausa, HUD, armas,
  resultado, cards de bot, mensagens do validador), que a cena e os editores registram; 35 só do Switch foram para
  `strings-switch.pt-BR.ts` (o Switch registra no começo do `t0/strings.ts` e do `main.ts`); 34 sem uso saíram. O
  `hasString()` responde "existe em alguma tabela"; um teste novo reprova chave repetida entre tabelas, e os testes
  de fonte e de largura olham as quatro.
- **As Configurações** viraram um fluxo do pedaço dos editores (`game/src/settings-flow.ts`), como a Oficina: abrem
  pelo `withEditors` (o pedaço já vem logo depois do título) e conferem que o jogador ainda está na tela de onde
  abriu. O backup foi para `game/src/save-backup.ts` e `format/src/backup-file.ts`; as linhas de estatística para
  `game/src/stats-lines.ts`; os prefixos das abas para `ui/src/screens/tabbed-ids.ts` (sem isso, o módulo das telas
  com abas puxava as Configurações de volta para o menu).
- **Os miúdos:** o `stepLevel` foi para `format/presets.ts` (a pausa inteira vinha junto por 3 linhas); o
  `RECRUIT_LOOK` em `figure-recruit.ts` (o boneco padrão puxava a tabela de looks inteira); o renderizador nulo saiu
  da web (`GameDeps.nullRenderer`, obrigatório quando `createRenderer` é `null`: o Switch e os testes passam o
  deles); o relatório de diagnóstico e a prévia do título do Switch (`?titulo=switch`) viraram `import()` na casca
  da web.
- **Já estava assim antes (não mexi):** quando as Novidades abrem no boot da web, o splash fica por cima delas até o
  jogador chegar ao título (a checagem de "menu pronto" só olha o título e o lobby).
- **A revisão (Opus) achou:** os Ajustes podiam "não responder" logo depois do título (o pedaço dos editores só era
  pedido no 1º frame do título, e nem isso com as Novidades no boot): agora ele é pedido no 1º frame de qualquer tela;
  e nada impedia o próximo `t()` no código do menu de cair numa chave das outras tabelas (crua na tela, só na web de
  produção, porque os testes registram todas): o `size-check` agora procura no JS da carga inicial as chaves que não
  moram na tabela do menu (`tools/size-check/src/strings-check.ts`, com as exceções desenhadas só depois do registro).
  Na primeira passada ele achou 34 que a dieta tinha tirado do menu cedo demais, entre elas o `mode.zombies` do resumo
  do JOGAR (com o último preset do Zombies, o título mostraria a chave): elas voltaram para a tabela do menu (+0,6 KB).
  Também: o contrato do `startGame` (o `nullRenderer`) e os lugares do backup e das linhas de estatística nesta
  ARCHITECTURE, e o teste de largura do Laboratório que não achava os rótulos. O menu fechou em **332,3 KB**.

### 20.3 Fase 1: Mini, Bots gigantes e Ricochete (20/11/2026)

- **Os ids** (`format/src/match-recipe.ts`): `mini`, `giantBots` e `ricochet` nos bits 13 a 15 de `MODIFIERS`
  (o código da máscara na rede é de 16 bits: a lista está cheia, e um 17º pede código mais largo e protocolo novo; um
  teste conta). Conflitos novos: Mini com Gigantes (as escalas ficam em 0,5, 1 e 3), Gigantes com Cabeção (uma cabeça
  de 2,6 m) e Ricochete com Um tiro mata (morrer de um tiro que quicou de onde não se vê).
- **O tamanho sem estado novo** (`sim/hitbox.ts`, `CHAOS_SCALE` e `chaosScale`): um multiplicador puro da máscara,
  do controlador e do tipo: o Mini dá 0,5 a todo corpo (zumbis também); os Gigantes dão 3 aos bobos de controlador de
  bot. O tamanho de verdade é o `bodyScale` (Chonker, chefão) vezes esse. Quem assume um lugar fica com o corpo do
  lugar: o humano que assume um bot (o sofá no meio da partida, o "assumir bot" do Aquário) vira gigante, e o bot que
  fica no lugar de um humano que saiu continua normal (decisão menor: um sinal de "humano" replicado pedia protocolo e
  snapshot novos).
- **O que acompanha o tamanho:** as hitboxes (o raio vai ao espaço do corpo em tamanho 1, como no Chonker; o corte do
  braço fica constante no mundo), a altura do olho (`simEyeHeight`: no Mini, a metade; no gigante, até 0,1 m abaixo
  do primeiro bloco em cima, para não atirar através do teto), os pontos de mira dos bots e da mira assistida (no
  gigante debaixo de teto, eles param no olho dele, que fica no corpo; na fase 1b, §20.7, o encolher substituiu isso),
  o desenho
  (a pose é refeita quando a Roleta muda o tamanho), os marcadores em cima da cabeça, o clarão e o traçado do tiro, e o
  efeito da morte (agora `bodyScale` × caos, então a morte do Chonker também sai do tamanho dele).
- **O que não acompanha (decisão menor):** a caixa de colisão e a navegação (os gigantes não entalam nas portas, e os
  mapas e os goldens não mudam); os gigantes só preferem caminhos com teto alto (`NavPath.headroomM`/`headroomCost`:
  custo 2 por nó com menos de 5,25 m livres; o cache da busca compara a altura pedida). Também ficam: a compensação
  de atraso usa o tamanho de agora (só uma janela de < 200 ms quando a Roleta troca), as explosões medem pela caixa
  de colisão e o spawn seguro olha do olho normal.
- **O Ricochete** (`sim/systems/weapons.ts`): a bala e cada chumbo que batem no cenário com uma normal (não de dentro
  de um bloco) refletem uma vez (r = d − 2(d·n)n), saem 5 cm da parede e andam o alcance que sobrou, com hitboxes e
  compensação de atraso; o dano é o da distância total, e a direção do acerto é a refletida. Quem atira não se acerta.
  Sem sorteio novo. Foguete, granada, tinta e cuspe não quicam. O evento novo `ricochet` (quem, arma, ponto,
  direção e comprimento) vai à rede (`PROTOCOL_VERSION` 11, com o `net.json`) e vira um traçado a partir do ponto do
  quique; o impacto na parede já soltava as faíscas (o som do quique fica para depois).
- **Os goldens:** os 15 que não usam a Roleta não mudaram; o do Bobo Chaos mudou porque a Roleta ganhou 3 opções
  (`c1b4cd36` → `ae3a48fd`; na corrida ela sorteia o Ricochete e depois os Gigantes).
- **A revisão (Opus) achou:** os gigantes debaixo de teto não se viam nem eram mirados (o olho parava no teto, mas os
  pontos de mira da cabeça e do tronco ficavam dentro da laje: 0 tiro em 40 s numa sala de 3 m; depois da correção, 102
  tiros e 9 abates, como sem teto); o cache de mira visível usava o corte do braço do tamanho 1; e o humano que assume
  um bot vira gigante (documentado acima). Corrigido antes do commit.

### 20.4 Fase 4: as Ferramentas do Dono na sim (20/11/2026)

- **A opção** (`SimConfig.owner?: { reserve }`, não um campo da receita): liga as ferramentas e separa a **reserva**,
  até 16 bots dormentes (e até 64 menos os bots da receita), Normal Bob, no time 0, nos controladores logo depois dos
  bots da receita (`ownerReserveSlots`, a mesma conta na sim e na IA). Dormente = morto com `respawnTicks = -1` (o
  renascer normal nunca traz de volta); `isOwnerDormant(view, e)` diz quem está fora (para as listas da fase 5). A
  mesma opção vai ao `BotDirectorConfig`, ao `HeadlessMatchConfig` (com `ownerScript`) e ao `LocalDriverConfig`.
  `ownerAllowed(recipe)` diz se o modo aceita: TDM, FFA, Domination, Paintball, Treino e Sandbox (os modos que
  trazem de volta ou contam cada jogador pelas regras deles, Zombies, BoboStrike, Royale e os de festa, recusam; o
  `createSim` usa a mesma conta).
- **Os comandos** (`sim/systems/owner.ts`, `OwnerCommand`, os tipos em `OWNER_COMMANDS`): `spawnBot { team, x, y,
  z, yaw }`, `remove { entity }`, `freeze { entity, on }`, `setTeam { entity, team }`, `giveWeapon { entity,
  weapon }` e `setModifier { modifier, on }`. O `sim.command(cmd)` põe na fila (32; devolve o número do comando, ou
  -1 sem as ferramentas ou com a fila cheia) e todos valem num ponto só, no começo do próximo `step()`, antes das
  entradas, na ordem de chegada. O evento `owner` (número, comando, entidade, ok e o motivo da recusa: `ended`,
  `entity`, `human`, `dormant`, `team`, `weapon`, `reserve`, `place`, `modifier`, `conflict`) fica no host
  (fora da tabela de eventos da rede).
- **As escolhas** (decisões menores): só bots são alvo (humano é recusado, também no time e na arma); o `spawnBot`
  usa a reserva primeiro e depois os bots da receita tirados da partida, no nó livre de navegação mais perto (até 8 m,
  os 16 mais perto, dentro da área de jogo; sem navegação, o spawn mais perto), virado para onde pediu (a entrada velha
  da IA não vale naquele tick); o `remove` tira sem morte, sem placar e sem crédito (os projéteis dele no ar somem,
  quem ele acertou esquece, e o `leader()` pula os dormentes); o `freeze` zera a entrada do bot na sim (a IA dele
  continua pensando, a sim ignora), passa pela morte e solta a granada que ele segurava sem jogar; o `giveWeapon` põe
  na mão, vira a escolha do próximo renascer e alarga a lista de armas do bot (no Paintball, a versão de tinta); o
  `setModifier` desliga o par que conflita, recusa o que conflita com uma regra fixa da receita (inclusive desligar
  o "só na cabeça" ou o "um tiro mata" que vêm das regras de arma) e não mexe no Arcade; com a Roleta, o primeiro
  sorteio parte da máscara de agora (o que o dono ligou antes fica).
- **No Sandbox:** o bot criado ou trocado de time pega o HP e as armas do time novo (as regras do próprio bot ainda
  ganham; `slotRules`, a mesma da criação). No `setTeam` de um bot vivo, o HP máximo novo vale na hora sem curar (a
  vida acima do teto é cortada), só as armas que o time novo não deixa são trocadas (a primária vira a primeira
  permitida, cheia), e o resto chega no próximo renascer.
- **O estado:** só com as ferramentas, as marcas de congelado e a lista de armas de cada bot entram no hash e no
  snapshot, e o estado dos modificadores existe desde o tick 0 (`SNAPSHOT_VERSION` 20; sem as ferramentas, o layout
  é o de antes). **Offline só, por enquanto:** o amigo online não sabe que a opção está ligada (o layout da rede ganha 3
  globais), então o `createNetHost` e o `createClientDriver` recusam uma sim com dono até a fase 5 mandar a opção no
  começo da partida.
- **A IA:** os cérebros da reserva existem desde o começo; o "Ajustar desafio" filtra pelo time de agora só com as
  ferramentas (sem elas, pelo time da receita, como antes); o Diretor de Partida recalcula quando um bot troca de time.
- **O replay:** `createOwnerScript([{ tick, cmd }]).feed(sim)` e o `OwnerLog` do `LocalDriver` (até 4.096
  comandos; cheio, o `command()` recusa, para o replay nunca perder um comando que valeu) dão o mesmo hash.
- **A revisão (Opus) achou:** o bot criado virava para onde mirava antes (a entrada velha); o "dar arma" no Paintball
  entregava arma de verdade; o modificador ligado pelo dono sumia no primeiro sorteio da Roleta; o "Ajustar desafio"
  mudava no Infection sem as ferramentas; desligar a regra de arma da receita dizia "ok" sem fazer nada; o bot tirado
  ainda podia pontuar; o ponto fora da área de jogo; o online desalinhado (acima); e as regras do time do Sandbox no
  bot criado ou trocado. Tudo corrigido antes do commit; nenhum golden mudou.

### 20.5 Fase 3: o Sandbox no jogo (20/11/2026)

- **A Partida personalizada** (`game/src/custom-match.ts`): o Sandbox é o último da linha Modo; entra a partir dos 2
  times de agora (o Diretor sai) e, ao sair, vira Times com o seu time contra todos os outros bots juntos. Na aba
  Partida, a linha **Objetivo** depois do mapa (Pontos, Eliminação, Nenhum): a eliminação esconde a meta e não tem
  "sem limite" no tempo; o Nenhum esconde os dois. A aba **Times** (no lugar da Bots): "Times" de 2 a 4 (o time novo
  copia o bot e a quantidade do último, cortado no teto do aparelho e do mapa), "Seu time" (com o quadradinho da cor)
  e, por time, o nome, o bot, quantos, a vida (1, 10, 25 … 1000) e as armas ("Todas" ou uma primária).
- **O nome do time** (`game/src/name-entry.ts`, a mesma lógica da Oficina): o confirmar abre o teclado do aparelho
  (o swkbd no Switch, o campo do navegador na web) ou o teclado do jogo (com o controle na web, ou sem teclado do
  sistema); até 15 caracteres (cabem ao lado do quadradinho); vazio volta ao nome da cor; cancelar devolve a receita
  de antes inteira.
- **O Cenário:** no Sandbox o botão é "Salvar Cenário" e o preset se chama "Cenário 3×3×2"; os resumos de 3 e 4 times
  são "3×3×2×2"; o resultado também diz "Salvar Cenário". Os mapas do Sandbox: Construto e Ringue (o `.bfmap` deles
  só ganhou o modo na lista). A Base Aérea fica de fora: 3 dos 4 pontos que a sim dá aos times 2 e 3 caem em cima dos
  muros de 2,5 m (no M10, fase 8, §21.1, ela entrou).
- **O que supunha 2 times:** o sofá (os jogadores 2 a 4 escolhem o time contando a partir do do P1; com 3 ou 4 times o
  card mostra o nome da cor); a sala online (o lobby manda quantos times há, um campo que o cliente antigo ignora, e a
  escolha vai do "Tanto faz" ao Roxo; no empate, o "Tanto faz" cai primeiro no time de casa da receita); o HUD (os 4
  placares); o placar do Tab (o nome de cada time depois do placar, em 2 colunas; a 640×360, uma lista com a faixa da
  cor; os modos de 2 times também ganharam o nome); o resultado ("{time} venceu · 12 × 20", com o placar de quem
  venceu), o feed do Domination e o resultado do Aquário com os nomes; o "Ajustar desafio" mexe em todo time que não é
  o seu; a linha "Hoje" da contagem e o máximo da barra de vida seguem o seu time.
- **Os limites de verdade** (`sim/recipe.ts`, `matchLimits(recipe)`): a mesma conta do `createSim` (a eliminação
  sempre com tempo), que o HUD e a dica da derrota feia leem no lugar da receita crua. Na eliminação, quem cai vê
  "Fora até o fim da partida" e, passada a câmera de morte, assiste um aliado vivo (como no BoboStrike); o sofá que
  entra no meio pega um bot vivo (na eliminação, nunca um morto).
- **Os textos:** os do Sandbox moram na tabela extra, menos os que o JS do menu cita (o Cenário, o teclado do nome, o
  `mode.short.sandbox` do resumo do JOGAR e os nomes de time do card do sofá), que foram para a do menu (o `size-check`
  conferiu). O menu ficou em **332,8 KB**.
- **A revisão (Opus) achou:** as chaves do menu acima (o `mode.short.sandbox` e os nomes de time do sofá apareceriam
  crus na web até o pedaço dos editores chegar); gravar o nome vazio não voltava à cor e cancelar cortava o nome
  importado (de até 24 caracteres); o resultado juntava o nome de quem venceu com o maior placar dos outros (na
  eliminação, nem sempre o dele); o "Tanto faz" do online ignorava o "Seu time"; a linha "Hoje" pegava o time do
  controlador 0 (no sofá, nem sempre o P1); e quem caía na eliminação ficava 10 min na câmera de morte. Corrigido antes
  do commit. Ficam: o placar do Tab numa lista só passa da tela de 640×360 a partir de 15 linhas (o TDM 2×8 já
  passava); os nomes de time vão ao amigo online sem o filtro de nomes (como os nomes dos jogadores hoje).

### 20.6 Fase 3b: o Sandbox pelos prints (20/11/2026)

- **Os prints da rodada 32** (`local/m9/capturar-sandbox-*.ts`) acharam: o menu "Arma da próxima vida" na tela de
  morte da eliminação (não há próxima vida) e oferecendo armas que o time não pode pegar (a sim trocava para a primeira
  permitida no renascer, sem avisar); o resultado com o placar de quem perdeu primeiro; e as setas na linha do nome do
  time (o confirmar abre o teclado; as setas não faziam nada).
- **O radial** (`scene/death.ts`, `primaryChoices(recipe, team)`): as opções são as primárias que a sim deixaria (as
  armas do time no Sandbox cruzadas com o `weapons.allowed`, a mesma conta das regras por entidade); com 0 ou 1
  opção, ou na eliminação do Sandbox, o radial não aparece. Vale também para a lista de armas da partida fora do
  Sandbox (que antes oferecia todas).
- **O resto:** o "{time} venceu · {o dele} × {o seu}"; a linha do nome do time é só para ler (`valueOnly`: sem setas,
  o confirmar abre o teclado); o teste dos mapas do Sandbox ganhou 30 s (a navegação do mapa real, com a suíte toda).
- **Ficam:** quem assiste o aliado na eliminação não vê o nome dele nem a vida dele no quadro de baixo; o placar do Tab
  é translúcido sobre o feed; com 4 times, os bots de mesmo preset têm o mesmo nome.

### 20.7 Fase 1b: os gigantes debaixo do teto (20/11/2026)

- **Os prints da rodada 32** (`local/m9/prints/gigantes-*.png`) mostraram os gigantes atravessando o teto dos
  abrigos de spawn (o tronco e a cabeça dentro da laje, um pedaço da arma flutuando embaixo), o gigante colado no
  jogador cobrindo a tela inteira (na câmera da morte, a perna dele), o clarão do tiro do tamanho de sempre num Mini e o
  traço do ricochete quase invisível (2,5 cm, 40 ms num quique curto).
- **O encolher** (`sim/hitbox.ts`, `CHAOS_SQUEEZE`; `sim/systems/chaos.ts`, `updateChaosScales`): o corpo com
  escala de máscara k > 1 fica com clamp((livre − 0,1) / topo, 1, k), onde livre é a altura dos pés até o primeiro
  bloco sólido, que para bala ou que tapa a vista (um raio na grade para cima, do olho normal, por gigante por tick) e
  topo é 2 m em qualquer postura (a altura desenhada com cabelo e chapéu; a hitbox em pé vai a 1,81 m; agachar nunca
  faz o gigante crescer). O Mini e os corpos normais nunca encolhem. O valor mora em `SimState.chaosScale` (fora do hash e do
  snapshot: sai do estado que já está neles), calculado na criação, no fim de cada `step`, no `readSnapshot` e no
  `remote.commit`, e também logo depois do movimento (a porta e o teletransporte valem no mesmo tick; o amigo online
  calcula com a grade e as posições dele); a compensação de atraso guarda o tamanho de cada tick junto da pose; as hitboxes, o olho da sim, a mira da faca e
  dos bots, a vista deles, a mira assistida e o desenho leem dele (`SimView.chaosScale`, `chaosScaleOf`); o
  `viewAimCeiling` saiu. O `chaosMaskScaleOf` (sem o encolher) decide se o bot prefere caminho de teto alto, para a
  escolha não piscar em cada porta. Dentro de um tick vale o valor do tick anterior (o mesmo que a IA viu); o limite do
  olho debaixo do teto fica como rede de segurança para esse tick.
- **No desenho** (`game/scene/body-scale.ts`, `approachScale`): o corpo anda até o valor da sim (encolhe a 10/s, cresce
  a 8/s), pula direto ao nascer e quando a Roleta muda o tamanho (a pose é refeita uma vez quando o tamanho assenta, não
  a cada quadro); o corpo, os marcadores, o clarão, a quebra da morte e a câmera da morte usam esse
  valor; as hitboxes usam o da sim, na hora.
- **A câmera:** a câmera da morte mira no peito × o tamanho de quem matou e recua na horizontal até o gigante caber
  (`DEATH_CAM.fitM`, até 6 m, parando 0,3 m antes de parede; `deathCamBackoff`); o gigante cujo corpo contém a câmera
  em 1ª pessoa some só naquela vista (o mesmo caminho que esconde o próprio corpo, sem programa novo; na tela dividida,
  só uma vista por vez).
- **O clarão e o traço:** `pushMuzzleFlash` recebe o tamanho (o desenhado de quem atira); `pushTracer` recebe um estilo
  (`render/src/fx/tracer.ts`): o do ricochete tem 5 cm, é mais claro e opaco, tem cauda de 4 m e vive de 0,12 a
  0,35 s; o traço normal não mudou (um teste prende os valores). No Mini, a arma na mão continua do tamanho normal (de
  propósito: um comentário diz).
- **O golden do Chaos:** `ae3a48fd` → `566e5be9` (as mesmas trocas da Roleta, 24 × 22); os outros não mudaram.
- **Ficam:** o encolher olha um raio só, no centro do corpo (meio debaixo da beira do teto, o ombro ainda pode
  atravessar).
- **A revisão (Opus) achou:** a compensação de atraso testava a pose antiga com o tamanho de agora (um tiro do teto
  acertava a cabeça acima da laje); agachado, o gigante debaixo do teto dobrava de tamanho, e no tick de levantar a
  cabeça passava a laje; no tick de cruzar a porta, a hitbox usava o tamanho de fora; o corpo desenhado crescia devagar
  (até 0,67 s de hitbox maior que o desenho); a pose refeita a cada quadro fora da tela; a mira dos bots com o desvio
  do tamanho velho; e o clarão do foguete fora do lugar. Corrigido antes de publicar (três testes repetem os cenários:
  a porta, o levantar e a compensação); nenhum golden mudou.

### 20.8 Fase 5: as Ferramentas do Dono no jogo (20/11/2026)

- **Quando ligam** (`game/src/owner-reserve.ts`): só no Sandbox (`ownerAllowed` e o modo), offline, no sofá (só o
  P1) e no online (só o host). A reserva é 8 (AH7), cortada no teto de bots do aparelho (ou da sala) menos os bots da
  receita; o host calcula e manda no começo da partida (`PROTOCOL_VERSION` 12, com o `net.json`), e os dois lados
  recusam começar se a reserva da sim não bater com a mandada. Os bots da reserva têm o mesmo nome e o mesmo visual
  no host e no amigo. O amigo monta a mesma sim, sem a página (`command()` devolve -1).
- **A página** (`game/src/scene/owner-tools.ts`, no pedaço da cena, pela `PauseState.items` como o Aquário): o botão
  compacto "Ferramentas do Dono" no canto de cima à direita da pausa do P1 (e do Aquário); no D-pad, para cima a
  partir do Continuar (um 7º item na coluna estourava o celular, medido). Sem rolagem (o toque não rola lista): Criar
  bot, Trocar de time e Dar arma são linhas com o valor nas setas (o time, a primária); Congelar/soltar e Tirar da
  partida lado a lado; Modificadores (os 15 que ligam ao vivo, todos menos o Arcade, em 3 colunas: aceso = ligado; a
  página se refaz quando a sim responde, então a recusa e o par que desliga aparecem); Câmera lenta (cada aperto
  passa por 1×, 0,5× e 0,25×; só offline e fora do Aquário, que já tem a velocidade dele).
- **A ferramenta armada:** escolher fecha a pausa com a ferramenta armada; uma faixa embaixo do centro mostra
  ("CRIAR BOT · LARANJA") e a dica do aparelho. Enquanto armada, o tiro e a mira saem do bobo: aplicar = clique
  esquerdo, gatilho direito ou o botão Tiro do toque; cancelar = clique direito, gatilho esquerdo ou o botão Mira (e
  a pausa cancela e reabre direto na página). Ela fica armada entre usos. O alvo é o bot na mira (`crosshairTarget`)
  ou o chão (o raio da câmera); nunca um jogador do sofá, o bot que você pilota no Aquário ou o que a câmera segue.
  Com o P1 morto, nada se aplica ("Só com o seu bobo em jogo"). A resposta da sim vira um aviso curto ("Bot criado:
  Sergeant Noodle", "Jorge congelado", ou a recusa: "Mire no chão", "Acabaram os bots da reserva").
- **A entrada:** o mapeador ganhou `release(action)`: armar, cancelar e pausar com a ferramenta soltam a mira
  alternada; depois de cancelar, a mira fica travada até soltar o botão, e a mira assistida não puxa; na web, o clique
  sem o mouse preso não aplica (é o clique de pegar o mouse de volta). No online, com a pausa do P1 aberta, o quadro
  dele vai sem botões e sem movimento (antes, os cliques da pausa atiravam no host, e o confirmar pulava).
- **Os dormentes** somem do placar, da lista do Aquário, do resultado e dos prêmios, e do "entrar no meio" do sofá (que
  também pula os congelados; assumir um bot congelado no Aquário o solta). O feed, o minimapa, os marcadores e os
  nomes já pulavam os mortos.
- **A câmera lenta** multiplica o dt antes do teto do passo fixo (o mesmo caminho da velocidade do Aquário), volta a
  1× em cada partida e fica fora da sonda de qualidade. O `LocalDriver` grava os comandos (até 4.096; cheio, o aviso
  diz "Esta partida chegou ao limite de comandos do dono").
- **A revisão (Opus) achou:** o bot congelado assumido por alguém ficava preso; com "Mirar: alternar", o cancelar
  falhava e o bobo ficava mirando; o aperto de cancelar vazava como mira; no online, os cliques da pausa do host
  chegavam à sim; a faixa da ferramenta cobria a do Aquário; o log cheio dava um aviso errado; a ferramenta valia pela
  câmera da morte; o clique de pegar o mouse aplicava; uma string por quadro; e a sonda de qualidade na câmera lenta.
  Corrigido antes do commit.
- **Fica para depois:** as ferramentas no amigo online (pedir ao host), o "criar bot" escolhendo o bot da Oficina (a
  reserva é de Normal Bob, com nomes do gerador) e a câmera lenta no online (a sim do host não para).

### 20.9 Fase 5b: as Ferramentas do Dono pelos prints (20/11/2026)

- **Os prints da rodada 33** (`local/m9/capturar-dono*.ts`) acharam: o botão Voltar das páginas do dono em cima do
  contador de abates; o bot criado nascendo longe da mira (4 a 5 m ao lado, no Aquário) ou fora da vista (mirando o
  alto de um muro); o congelado sem sinal nenhum depois do aviso; e todos os bots da reserva chamados "Normal Bob".
- **O lugar do bot** (`game/scene/owner-tools.ts`, `ownerSpawnSpot`): antes de mandar o `spawnBot`, o jogo escolhe o nó
  livre de navegação mais perto do ponto mirado (até 4 m) que a câmera vê (um raio da câmera até o nó, no peito ou no
  olho); na parede, recua 0,6 m pelo raio e desce ao chão; sem nada visível, recua para a câmera de 1 em 1 m (até 4
  vezes, pulando o recuo que anda menos de 0,5 m no chão), e se nada servir recusa ("Sem lugar livre perto da mira")
  sem mandar o comando. Tudo numa passada só pelos nós (os 12 mais perto de cada recuo, até 16 com o teste de vista);
  a câmera dentro de um bloco (a livre do Aquário) começa os raios no primeiro ponto livre (até 3 m). O filtro de nó
  livre é o mesmo da sim (`ownerSpotNode`, `ownerSpotNodes`, `ownerSpotTaken`, `navMainComponent`), e o jogo manda o
  centro do nó, então a sim escolhe o mesmo; o nó mandado e ainda sem resposta conta como ocupado (dois cliques no
  mesmo tick, fácil na câmera lenta). Medido nos mapas de verdade (4.000 miras cada): no Construto, os bots fora da
  vista foram de 588 a 0; no Ringue, de 60 a 0.
- **O congelado:** uma plaquinha azul-gelo "CONGELADO" em cima da cabeça, no HUD de cada vista (como os balões dos
  emotes; até 12 por vista, os mais perto), na posição desenhada do corpo; some com a pausa, a mais de 40 m, no bot
  invisível e no bot de cujos olhos a câmera vê. Vale para o amigo online (o congelado vem no snapshot).
- **Os nomes da reserva:** o gerador de nomes da Oficina (`game/src/bot-names.ts`) dá a cada bot da reserva um nome
  bobo, pela semente da partida e a ordem da reserva, sem repetir os nomes de antes (bots da receita e humanos) — o
  mesmo no host e no amigo, e o visual junto.
- **O HUD:** a vista do P1 esconde o HUD com a página das ferramentas ou dos modificadores aberta (volta na pausa
  simples e com a ferramenta armada).
- **A revisão (Opus) achou:** a câmera dentro de um bloco sempre recusava; o custo de um clique recusado (5 passadas
  pelos nós e 240 raios, um tranco no Switch); dois cliques no mesmo tick caindo no mesmo nó; a plaquinha por cima do
  HUD de cada vista e um passo à frente do corpo; e o nome da reserva igual ao de um humano. Corrigido antes do
  commit; nenhum golden mudou.

### 20.10 Fechamento do M9 (20/11/2026)

- **O que entrou:** a dieta do menu da web (349,6 → 332,9 KB, com o `size-check` reprovando texto que o menu
  desenharia cru), os modificadores Mini, Bots gigantes (o gigante encolhe debaixo do teto) e Ricochete, o Bobo
  Sandbox completo (até 4 times com nome, vida e armas; Pontos, Eliminação ou Nenhum; o Cenário; jogar ou assistir) e
  as Ferramentas do Dono (criar bot onde mira, congelar, trocar o time, dar arma, tirar da partida, os modificadores ao
  vivo e a câmera lenta offline; no online, só o host). Com isso, o "M6+" do roadmap está todo feito.
- **Como andou (#82):** as frentes independentes rodaram ao mesmo tempo, cada uma num agente com a própria cópia do
  repositório (worktree com `node_modules` próprio: sem ele, os `@boboforces/*` resolvem para o `main`); cada fase
  entrou no `main` por squash, com o portão inteiro, uma revisão do Opus e os achados corrigidos antes de publicar.
  Lição: o ramo de um agente que juntou o ramo de outro antes do squash dá conflito em massa; aplicar só a diferença da
  fase (`git diff --binary --full-index base fase | git apply -3 --index`) resolve.
- **As versões:** `PROTOCOL_VERSION` 12 (o evento `ricochet` no 11; a reserva do dono no começo da partida no 12) e o
  `net.json` junto; snapshot da sim 20 (os campos do dono, só com as ferramentas); os campos opcionais `hp`/`weapons`
  do time e o bloco `sandbox` sem mudar a versão da receita.
- **Os goldens:** dos 16 de antes do M9, 15 não mudaram; o do Bobo Chaos foi para `566e5be9` (a Roleta sorteia os 3
  modificadores novos); o do Sandbox é `35764306`.
- **O custo:** `PERF.md` §1q (sim + IA por tick com o Mini, os Gigantes, o Ricochete, o Sandbox de 4 times e a reserva
  do dono: no ruído da referência).
- **As revisões:** uma do Opus por fase (as listas nas §20.1 a §20.9), mais as duas rodadas de prints, que acharam o
  gigante atravessando o teto, a câmera engolida, o menu de arma na eliminação e as armas fora do time.
- **Fica para depois:** a Base Aérea no Sandbox (os pontos dos times 2 e 3 em cima dos muros), as cores de time
  escolhidas, o nome e a vida do aliado assistido na eliminação, o placar do Tab opaco, as ferramentas no amigo online,
  o "criar bot" com os bots da Oficina, o som do ricochete e o encolher pelo ombro (um raio só, no centro).

## 21. M10: mapas e armas novos

Plano em `docs/PLANO_M10.md` (#83; pergunta AK1). As fases andam em ondas paralelas, como no M9 (§20); a ordem dos
commits é a de chegada.

### 21.1 Fase 8: as pendências do M9 (20/11/2026)

- **A Base Aérea no Sandbox** (`sim/systems/sandbox.ts`, `SANDBOX_SPAWN`): cada ponto da casa dos times 2 e 3 prefere um
  nó "no chão" (piso a menos de 1 m do pé mais baixo dos spawns de time do mapa, até 8 m do ponto); sem nenhum, o mais
  perto, como antes. Na Base Aérea, os 8 pontos foram de cima dos muros (y 3,5) para o chão (y 1,0), a 36–37 m das
  bases; no Construto e no Ringue, os pontos são os mesmos de antes (o golden do Sandbox não mudou). A Base Aérea entrou
  no `MAP_MODES` do Sandbox e no `meta.modes` do mapa (só o `airbase.bfmap` foi refeito).
- **A cor do time** (AK6): `TEAM_PALETTE` (`ui/src/tokens.ts`) com 8 cores (Laranja, Azul, Verde e Roxo, as de sempre, e
  Vermelho #E8283C, Amarelo #FFD60A, Rosa #F03CBE e Ciano #2EE6F0), escolhidas pela distância de cor (ΔE CIELAB) às de
  sempre, entre si e ao cenário, simulando os três daltonismos (o par novo mais difícil é Rosa × Ciano na deuteranopia;
  o Azul × Roxo de sempre é pior); o ícone do time segue pela posição. Na receita, `TeamRecipe.color` (0 a 7, opcional,
  só no Sandbox, sem versão nova): o validador limita e, se dois times ficam com a mesma cor (contando a da posição de
  quem não escolheu), o de depois pega a primeira livre (`recipe.duplicateTeamColor`). Na Partida personalizada, a linha
  "{time}: cor" depois do nome (as setas pulam as cores dos outros; a cor da posição apaga o campo). Tudo lê a tabela da
  partida (`teamColorTable`, `game/src/team-colors.ts`): as skins, o placar de cima e o do Tab, o feed, os marcadores, a
  tinta, o card do sofá e os chips da sala online (o estado do lobby ganhou `teamColors`, opcional; o cliente antigo
  ignora). Sem nome digitado, o time leva o nome da cor. O Domination e o Jugg (nunca Sandbox) seguem pela posição.
- **O som do ricochete** (`audio/src/synth-game.ts`, `synthRicochet`): um assobio descendo, sintetizado (sem MP3; os sons
  essenciais seguem em 130,4 KB), no ponto do quique, com o tom variando ±12% e 0,06 s de intervalo (os chumbos da
  escopeta quicando juntos viram um som só).
- **A revisão (Opus) achou:** o validador acertava a cor também fora do Sandbox (agora só nele); a cor escolhida perdia
  para a cor da posição de outro time sem escolha (agora as escolhidas vêm primeiro); o seu ricochete podia ser
  engolido pelo cooldown de um bot longe (agora só os chumbos do mesmo tiro viram um som só, e o seu não espera); e o
  lobby aceitava mais cores que times. Corrigido antes do commit. Fica: a plaquinha do congelado (#A8E6FF) perto do
  Ciano, e o Amarelo e o Ciano perto das cores do P1 e do P2 (diferem pela forma dos marcadores).

### 21.2 Fase 0: o kit dos mapas novos (20/11/2026)

- **Os blocos** (`assets-src/blocks/blocks.ts`, `assets-src/textures/blocos16/*.ts`): 38 ids novos e 48 camadas novas
  no fim do `blocos16` (de 70 para 118 de 256; as 70 de antes, com os mips, ficaram iguais byte a byte, e um teste
  prende a ordem publicada). Porto: contêineres em 4 cores (corpo e porta), asfalto (3 variantes) e a faixa pintada, a
  treliça do guindaste (sólida, mas bala e vista passam, como a laje de grade), o cabo (painel fino, sem colisão) e o
  bloco de aviso; Canteiro: o tubo do andaime, a viga e o pilar de aço, o vergalhão (cruz, sem colisão), a brita (3
  variantes), a barreira e os sacos de cimento; Galpão: a grama sintética (3 variantes), a faixa e a rede (segura o
  movimento, deixa passar bala e vista, como a cerca de arame); Lua: o regolito (3 variantes, uma com cratera), o painel
  e o piso da estação, o neon (emissivo) e a porta da eclusa (as janelas são o vidro de sempre); Fazenda: a madeira do
  celeiro, a porta do celeiro (o X branco, lido certo dos dois lados), o acabamento, o lambri, o feno, a terra arada, o
  milho (cruz; segura a vista, bala passa; empilha sem emenda) e a cerca de ripas. Tudo na paleta mestra de 64 cores
  (que já estava cheia), sem texto e sem contorno preto.
- **As peças** (`assets-src/models/map-kit.ts`): o cabeço, o silo, o trator (6 caixas de colisão em degraus), o rolo de
  feno e os infláveis (o cilindro, o cubo, a cunha — `model:inflatable-wedge`, nunca o nome de uma marca — e a parede),
  em 2 camadas novas do `modelos64` (de 31 para 33). O teto do gerador de modelos subiu de 32 para 40 camadas (decisão
  menor revisável: as armas novas também usam; o teto real do array é 55).
- **Os ajudantes de montagem** (`assets-src/maps/kit.ts`, não é mapa): `container()` (põe o contêiner com as portas
  viradas certo e devolve a altura para empilhar), `towerCrane()` (o guindaste de treliça com lança, contrapeso, cabine
  e a carga pendurada; recusa parâmetro fora da lança), `barnDoor()` (o padrão das portas, em metros inteiros) e
  `harborWater()` (o mar do porto: o fundo a mais de 3 m abaixo do cais e a 1,5 m abaixo da água, para a navegação não
  descer no mar, e a altura do plano de morte entre os dois).
- **O contraste com as cores de time** (a pergunta AK6 pede que elas não se confundam com o cenário): os vermelhos
  (o contêiner vermelho, o celeiro, as vigas, o trator e o inflável) foram para o óxido escuro, os amarelos (o
  guindaste, a faixa e a cunha) para o ocre fosco, o painel da estação para o cinza médio e o neon para um branco
  quente, longe do Ciano (`local/m10/kit/contraste.png`: as 8 cores de time na frente de cada parede, em cor e em
  cinza). Ficam perto em cinza o celeiro e a viga do Vermelho (separados pela saturação) e a parede da estação de
  quase todas (8 cores de 0,32 a 0,82 de luma não deixam nenhum cinza a 0,25 de todas).
- **O custo:** a primeira partida foi de 919,2 para 941,1 KB (de 1 MB); as texturas de 64,4 para 80,1 KB (de 150).
- **A revisão (Opus) achou:** as cores do kit perto das cores de time novas (acima); o milho que escondia o jogador de
  quem joga mas não dos bots (agora segura a vista); as caixas de colisão da cunha e do trator maiores que a forma; os
  ajudantes sem checagem; o milho empilhado partido; o andaime com o friso fora do trilho; o nome de marca; e o mar do
  porto que deixaria os bots descerem nele. Corrigido antes do commit.

### 21.3 Fase 2: o Canteiro de Obras (20/11/2026)

- **O mapa** (`assets-src/maps/construction.ts`, `construction`, "Canteiro"): área de 72 × 80 m numa grade de
  80 × 24 × 88 m, espelhado norte-sul (o time B no norte, o A no sul), de dia. Térreo a 1 m, 1º andar a 4 m e 2º a 7 m
  (só o terço leste do prédio); o poço do elevador sobe a 11 m e o guindaste a 19 m. Três rotas: o pátio de materiais
  (oeste, com o escritório de contêiner de 2 andares), o prédio (o térreo em zigue-zague em volta do poço) e o pátio do
  guindaste (leste, com o depósito de contêiner e o guindaste; a carga fica pendurada sobre o prédio). Os andaimes
  levam ao 1º (oeste) e ao 2º (leste) andar com passarela coberta embaixo; 6 subidas para o 1º e 3 para o 2º, para
  nenhum alto se segurar sozinho. Modos: TDM, FFA e Sandbox (jogadores 2/12/16; 12 bots no Switch 3–4P).
- **As medidas do `mapc`:** a maior linha de visão 47,93 m (declarada 50); 6 + 6 spawns no TDM e 16 no FFA, nenhum
  visto de um inimigo; a travessia de spawn a spawn de 12,2 a 13,3 s; a cobertura a no máximo 5 m; 0 avisos;
  `construction.bfmap` com 9,2 KB. Um teste do `mapc` (`tools/mapc/src/construction.test.ts`) prende tudo isso, mais
  o "poleiro": nenhum topo sem navegação a até 3,7 m de um piso alcançável no máximo 0,5 m abaixo (o pulo correndo) nem
  a até 1,2 m de um piso no máximo 1,5 m abaixo (o mantle). A cena de bench `scene=construction`.
- **Os bots:** nas partidas da sim (TDM, FFA e Sandbox), ninguém travou e 3 a 10 bots chegam ao 1º andar; o 2º quase
  não é escolhido como destino pela IA (o passeio sorteia um nó qualquer com 15 s de prazo; a fase 1c mexe nisso). As
  escadas são em L e em U com lances de 1,5 m: a suavização da rota juntava um lance reto de 3 m num segmento só, e o
  seguidor de caminho largava a rota (o defeito é da IA e vale para todo mapa; a fase 1c corrige), e um palete de 1 m
  no deque do andaime quebra uma linha reta de subida até lá.
- **A revisão (Opus) achou:** um poleiro só de humano (do andaime leste para o telhado do depósito, com visada de
  52,2 m) e mais um do mesmo tipo; os dois avisos de "visto sem ver" nas escadas de dentro; a falta de um teste do
  `mapc` e da cena de bench; e a travessia mínima abaixo de 12 s. Corrigido antes do commit.

### 21.4 Fases 6 e 7: as armas novas (20/11/2026)

- **As cinco** (`sim/config/weapons.ts`; TTK sem errar, corpo/cabeça; medida pelo robô, Tryhard contra Tryhard):

  | Arma (id, código) | Dano | Cabeça | Cadência | Pente + reserva | Alcance | TTK | Medido |
  |---|---|---|---|---|---|---|---|
  | DMR "Pinpoint" (`rifle.dmr`, 27) | 46 | 2,0x | 300/min, semi | 10 + 30 | cheio até 50 m, 34 a 90 m; luneta 2,5x | 0,40 / 0,20 s | 0,33 s a 30 m |
  | Revólver "Hand Cannon" (`pistol.revolver`, 28, secundária) | 50 | 1,5x | 120/min | 6 + 18 | cheio até 22 m | 0,50 s | 0,54 s a 12 m |
  | Escopeta automática "Leafblower" (`shotgun.auto`, 29) | 8 × 9 | 1,25x | 180/min, auto | 8 + 24 | cheio até 6 m, zero a 16 m | 0,33 s | 0,44 s a 6 m |
  | Besta "Twang" (`sniper.crossbow`, 30) | 90, sem queda | 2,0x (a cabeça mata) | 1 virote por recarga | 1 + 12 | virote a 70 m/s, gravidade 5 m/s² | 1,50 s / 1 virote | 0,70 s a 25 m |
  | Lança-granadas "Bloop" (`rocket.grenade-launcher`, 31) | 85 direto; explosão 85 → 0 em 3,5 m | — | 90/min | 6 + 12 | 30 m/s em arco, 60 m | 0,67 s | 0,88 s a 16 m |

  A besta é um tipo de disparo novo (`WEAPON_FIRE.bolt`): no corpo, dano por parte como a bala; no bloco, o evento
  `stick` (o virote fica 5 s cravado, só no desenho, até 24 de uma vez; some na rodada nova, na troca de fase e na porta
  do Zombies que abre). Mira solta sem a mira (3,5°), custa $3.500 e os bots só atiram com a mira cheia; o "Sniper mata
  no corpo" não vale para ela (a categoria é outra). O lança-granadas explode no contato com o corpo ou o bloco, sem
  quicar (quicar pedia estado novo no hash), com 50% de dano em quem atira.
- **Os ids e os códigos:** ids com ponto, cujo prefixo é a categoria (o DMR é um fuzil para quem não o conhece); os
  códigos 27 a 31 depois das armas de modo e das raridades do Royale (um assert na carga impede que um dia se
  encontrem); a lista `ARSENAL` com as 14; os bits 9 a 13 da máscara (16 bits). Os validadores de lista de armas, de
  escada do Gun Game e das regras do bot passaram a aceitar o "cai na categoria" (`resolveWeaponId`): uma arma
  desconhecida vira a categoria dela com aviso, e uma lista que ficaria vazia vira a pistola, não "todas". Os builds já
  publicados descartam o id desconhecido (eles não têm isso).
- **O revólver é secundária** (AK5): a secundária é o revólver quando a lista de armas o nomeia, senão a pistola (o
  Laboratório, as regras da partida e do time, e o dono); sem restrição, nada muda. As armas da parede e da loja vão
  para o espaço delas (o revólver troca a pistola).
- **Onde aparecem:** no radial da morte (10 primárias: o anel largo a partir de 667 × 375, duas linhas a 640 × 360, uma
  linha no 3–4P; `MAX_PRIMARY_OPTIONS` 16), nas Ferramentas do Dono, nas regras de arma da partida e do time, no
  Laboratório, no card do bot, na loja do BoboStrike (13 itens; DMR $3.300, escopeta automática $2.000, besta $3.500,
  lança-granadas $3.800, revólver $700; em vista pequena, a loja cai para linhas ou uma linha só, nunca esconde item),
  nas escadas do Gun Game feitas à mão, nas armas da parede que um mapa puser e no Paintball (as versões de tinta).
  **De fora, de propósito (os goldens não mudam):** o sorteio da primária dos bots, a escada padrão do Gun Game, o loot
  do Royale, a troca do Chaos, a Caixa Misteriosa, o Surpreenda-me e as compras dos bots do BoboStrike: num jogo
  normal, os bots só carregam as novas quando uma regra dá.
- **A IA:** alcance e mira de cada uma, o arco e a antecipação da besta e do lança-granadas (os bots não atiram a
  granada à queima-roupa). **Os sons** são sintetizados (os sons essenciais seguem em 130,4 KB).
- **Os modelos** (`assets-src/models/weapons.ts`): um por arma (o id do modelo é o id da arma), o virote e a granada
  numa camada só; 6 camadas no fim do `modelos64` (39 de 55: o teto do gerador subiu de 40 para 55, o real do array).
  O DMR é arma de luneta (`hasScope`: com a mira cheia, a arma some e a moldura da luneta aparece, como na sniper); a
  besta e a SMG miram meio texel acima da mira (antes, o bloco da mira tapava o centro da tela).
- **O online:** `PROTOCOL_VERSION` 13 (a ação `stick` do evento de projétil), com o `net.json`.
- **O custo:** a primeira partida em 954,7 KB de 1 MB (o kit e os modelos); gerar os mips no carregamento liberaria uns
  34 KB, mas mexe no carregador, no Switch e no size-check (fica para quando precisar).
- **As revisões (Opus) acharam:** na sim, os builds antigos que viram "todas as armas" com uma lista só de armas novas,
  a loja do BoboStrike que escondia as novas no 3–4P, a besta forte demais pelo preço, o assert dos códigos, o cache do
  anel sem a fonte e o virote cravado que ficava depois da rodada; nos modelos, a mira da besta tapando o centro, a mira
  do DMR por cima da luneta, o virote atravessando painel fino, a mira solta da besta e o teto de camadas. Corrigido
  antes do commit.

### 21.5 Fase 1: o Porto de Contêineres (25/11/2026)

- **O mapa** (`assets-src/maps/port.ts`, `port`, "Porto"): área de 88 × 71,5 m numa grade de 96 × 28 × 96 m,
  espelhado em x = 48 (o time A a oeste, o B a leste), de dia. O cais a 4,5 m, o topo dos contêineres a 7 m (a
  plataforma B e a "trilha de cima") e o mezanino do armazém a 7,25 m. Três rotas: o cais (norte: a beira d'água com o
  navio; o ponto A num canal entre as pilhas), o pátio de contêineres (o meio: corredores entre pilhas de 2, a trilha de
  cima com pontes de grade, um túnel numa pilha e a praça com o guindaste e a plataforma B) e a rua com o armazém (sul:
  o ponto C dentro, mezanino e claraboias). Modos: TDM, FFA, Domination (A, B, C) e Sandbox (jogadores 2/12/16; 12
  bots no Switch 3–4P). A cena de bench `scene=port`.
- **As medidas:** a maior linha de visão 49,65 m (declarada 50); 8 + 8 spawns de time e 20 no FFA, nenhum visto de um
  inimigo; a travessia de 12,0 a 12,7 s; a cobertura mais longe a 5,7 m; `port.bfmap` com 7,7 KB; 8.851 nós de
  navegação (o Construto tem 7.161).
- **O mar** (`harborWater` do kit): o fundo a 4 m abaixo do cais (mais que a queda de 3 m da navegação) e o plano de
  morte entre a água e o fundo; a área de jogo para na face de dentro do muro do cais (z 14,5), que tem 0,5 m (a altura
  do degrau automático: antes, dava para cair no mar sem pular).
- **Os testes:** as partidas da sim em cada modo (TDM 6×6 terminando aos 141 s com 73 abates; FFA, Domination e
  Sandbox de 3 min), o seguidor de caminho dos bots subindo a trilha e a plataforma B, os pontos do Domination trocando
  de mão numa varredura de 4 sementes, e no `mapc` (`tools/mapc/src/port.test.ts`) o "poleiro": o que um humano alcança
  com o mantle (1,5 m) ou o pulo correndo (vão até 3,7 m, subida até 0,5 m) e a maior visada de lá.
- **Achado para a IA:** no Domination, o time 0 vence a maioria das sementes, e a vantagem segue o time 0 mesmo com os
  spawns trocados de lado (o mapa é espelhado célula a célula): é um viés da sim ou da IA, não do mapa (pendência).
- **A revisão (Opus) achou:** um poleiro só de humano (da trilha para o contêiner do caminhão, com visada de 57–60 m) e
  outro na caixa de 2 m; o muro do cais que deixava cair no mar (e a casa do time 3 do Sandbox em cima dele); a escada
  do mezanino que os bots não sobem (o defeito do seguidor de caminho; os testes desse trecho estão marcados para
  voltar com a fase 1c); o Domination com um time zerado em duas sementes; e a altura das grades. Corrigido antes do
  commit (os caminhões e a fileira da rua com 2 de altura, a caixa a 5 m da trilha).

### 21.6 Fase 4: a Estação Lunar (26/11/2026)

- **O mapa** (`assets-src/maps/moonbase.ts`, `moonbase`, "Estação Lunar"): área de 72 × 72 m numa grade de
  80 × 24 × 80 m, espelhado norte-sul, à noite (o céu escuro com estrelas faz o espaço). Três rotas: o regolito a oeste
  (a cratera de 1,5 m, rochas e o módulo de pouso), a estação no meio (24 × 28 m e 8 m de pé-direito, com eclusas,
  vestíbulos de portas desencontradas, o átrio com o reator, sacadas e passarelas a 4 m com 4 rampas, neon e janelas) e
  a antena a leste (o deque a 3 m com a sala do rádio embaixo, os painéis solares, o radiador, os tanques e a carga). A
  maior linha de visão 47,9 m (declarada 50; dos poleiros que só o pulo lunar alcança, no máximo 41 m); 8 spawns por
  time nos hangares (as saídas só pelos lados, com anteparo) e 17 no FFA; a travessia de 12,7 s; 7,6 KB. Modos: TDM, FFA
  e Sandbox, e o card do Bobo Chaos agora joga aqui (o GDD lista a Estação como o mapa do Chaos; decisão menor). A cena
  de bench `scene=moonbase`.
- **A gravidade do mapa** (AK3): o campo opcional `gravity` no META do mapa (`MapMeta`/`SimMap`, de 0,25 a 2; aqui
  0,35), lido pela sim com as contas do modificador Lua (o pulo sobe 2,9 m, sem dano de queda); sem o campo, nada muda
  (os outros mapas e os goldens). O amigo online monta a sim pelo mesmo mapa, então a predição usa a mesma gravidade
  (o Chaos online na Lua: 0,7% de predições erradas, no padrão). Com as regras: a Lua é absoluta (sem efeito num mapa
  lunar, e a Roleta não a sorteia aqui); a pesada multiplica (0,35 × 1,8 = 0,63); a gravidade total nunca fica abaixo
  de 0,25 (`mapGravityFloor`); o Arcade desliga em mapa de gravidade baixa (o perfil e o bit do modificador,
  `resolveMapMovementProfile`), e o Surpreenda-me não sorteia o Arcade nem a Lua aqui; a Pressa fica (a geometria
  segura os telhados com ela). A HUD mostra "LUA" fixo, e a Partida personalizada mostra a gravidade que vale ("×1
  (×0,35)"). Zumbis e granadas ficam com a gravidade de sempre (este mapa não tem Zombies).
- **A revisão (Opus) achou:** o holofote em cima da mureta como escada para o telhado do hangar (visada de 76 m); o topo
  dos tanques olhando para dentro do spawn inimigo; o Arcade, a Pressa e a regra de gravidade abrindo o mapa inteiro
  junto com a gravidade lunar; a travessia de 10,5 s; e os contratos sem registro. Corrigido antes do commit (os
  holofotes no chão, os tanques a 6,5 m, a pilha de carga a 2,5 m, o hangar fechado na frente). Fica: a regra de
  gravidade da Partida personalizada em 0,25 ainda alcança telhados (escolha de quem monta a partida); as rampas da
  estação esperam a correção do seguidor de caminho (fase 1c) para os bots subirem.

### 21.7 Fase 3: o Galpão de Paintball (26/11/2026)

- **O mapa** (`assets-src/maps/paint-hall.ts`, `paint-hall`, "Galpão"): um galpão coberto de 64 × 84 m (grade de
  72 × 16 × 108 m), espelhado no meio, de dia, para o Bobo Paintball (o card de Mais modos agora começa nele, e o
  Surpreenda-me segue o card), o TDM e o Sandbox. 8 spawns por time em 3 caixas atrás de cada parede de largada, cada
  uma com o seu portão e um anteparo em L. Três rotas: as passarelas de grade a 3,75 m a oeste (cobertas por uma
  grade, sem altura para ficar em cima do parapeito) até a casa do compressor no meio; a torre do juiz, a parede de
  madeira, os paletes e os contêineres no centro; o pátio de contêineres a leste. A ponte rolante passa a 2,5 m do chão.
  Os infláveis são de 2 modelos só (o cilindro e o cubo), arrumados em 8 grupos de 32 m (o teto de grupos do Switch
  3–4P; um teste prende). O teto tem frestas com vidro em pé: a luz passa, ninguém passa, e a navegação do teto fica em
  pedaços (um teto inteiro virava a maior área, que a sim usa para as casas do Sandbox e o Destravar).
- **As medidas:** a maior linha de visão do chão 49,98 m; nenhum poleiro alcançável (pelo pulo de até 1,5 m) passa de
  50 m; a travessia de 13,5 a 15,2 s; nada de fora de uma caixa vê os spawns dela (as paredes da largada, das caixas e
  do portão do meio vão do chão ao teto; um teste prende); `.bfmap` com cerca de 5,5 KB.
- **Os bots:** Paintball 32 × 34 (66 abates), TDM 17 × 22, Sandbox de 4 times, ninguém preso. As passarelas esperam a
  correção do seguidor de caminho (fase 1c); o piso de grade delas deixa a tinta passar de propósito.
- **A revisão (Opus) achou:** atirar para dentro das caixas de spawn de poleiros do lado de fora (com o renascer de 1 s,
  um laço de matar no spawn) e ver dentro das caixas laterais pelos portões; poleiros só de humano com visada de até
  74 m; os infláveis em 32 grupos (o Switch 3–4P desenha 8 e escondia cobertura que ainda segura a tinta); o teto
  alcançável com a gravidade baixa e o Arcade; e as passarelas que os bots não sobem. Corrigido antes do commit. Fica: a
  câmera de cima do Aquário (24 m) mostra o teto.
