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
