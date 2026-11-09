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

net (M5, só web): importa sim, format e platform-api; só apps/web importa net.
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
| Jogo | `packages/game/src/index.ts`, `scene-api.ts`, `scene/index.ts` | `startGame({ platform, createRenderer, hooks?, loadScene?, bench?, benchWarnings?, testItems? }): GameHandle`, `MatchDriver`, `createLocalDriver`, `createNullRenderer()`; M1: `@boboforces/game/scene` (`SCENE_MODULE`) |

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
  - `exportBackup`, `readBackup` e `applyBackup`: juntar soma os presets salvos e os bots (renomeando os repetidos)
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
  - `factoryPresets`: Vibe, Tryhard e Sexta do Jorge (6 Jorges), com o nome da tabela (`preset.name.*`).
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
  - `statsLines` (aba Dados) e `playTimeText`;
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
