# Arquitetura do BoboForces

> Estado: M0 integrado (02/11/2026). Fonte: `docs/design/tecnico.md` §1, §3, §4, §9, §10, §21.
> `docs/DECISOES.md` manda sobre este texto. Regras de portabilidade completas em `docs/PORTABILIDADE.md`.

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
| `audio` | shared, platform-api | ES2023 + DOM | mixer sobre o subconjunto comum de Web Audio (M2) |
| `render` | shared, platform-api, world, ui, three | ES2023 + DOM | ÚNICO com three: chunks, texture arrays, instâncias, viewports, DrawList |
| `game` | todos acima (do render, só o subcaminho sem three e sem DOM `@boboforces/render/data`) | ES2023 (puro) | fluxo de telas, cola, LocalDriver, NullRenderer, cena de teste, HUD |
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
| Mesher | `packages/world/src/mesh/index.ts` | `buildChunkMesh(grid, registry, cx, cy, cz, opts?): ChunkMesh` (3 × `MeshArrays`) |
| Sim | `packages/sim/src/{sim,view,events,entity,constants}.ts` | `createSim(config): Sim`, `SimView`, `SimEvent`, `EntityId`, `SIM_HZ` |
| Métricas | `packages/sim/src/config/metrics.ts`, `movement.ts` | `METRICS`, `HITBOXES`, `HEADSHOT_MULTIPLIER`, `MOVEMENT_BOBO` |
| Passo fixo | `packages/sim/src/fixed-step.ts` | `new FixedStep().advance(s) → passos`, `.alpha` |
| IA | `packages/ai/src/index.ts` | `createBotDirector(config): BotDirector` (`think(view, frames)`) |
| Receita | `packages/format/src/match-recipe.ts` | `MatchRecipe` (`format: 'boboforces/preset@1'`), `validateMatchRecipe(input, limits)` |
| Formatos | `packages/format/src/{format-id,content-ids,migrations,png}.ts` | `formatId`, `parseFormatId`, `CONTENT_IDS`, `migrateDocument`, `decodePng` |
| UI | `packages/ui/src/{tree,draw-list,theme,strings.pt-BR,text}.ts` | `UiNode`, `Screen<S>`, `layoutTree`, `moveFocus`, `drawTree`, `DrawList`, `COLORS`, `t()` |
| Render | `packages/render/src/types.ts`, `renderer.ts`, `data.ts` | `createRenderer(surface, opts, createUiPass?): Renderer` (com `setUiAtlas`); `@boboforces/render/data` = parte sem three |
| Jogo | `packages/game/src/index.ts` | `startGame({ platform, createRenderer, hooks? }): GameHandle`, `MatchDriver`, `createLocalDriver`, `createNullRenderer()` |

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
- **Construto no M0:** a receita da cena de teste declara `map: 'construto'` (único mapa registrado, então passa no
  validador) e o `game` resolve todo mapa para a arena de teste do `world` até o Construto existir (M1).
- **Boot da web depois do primeiro pixel:** o `main.ts` espera um frame antes de criar o contexto WebGL2; com o
  navegador frio, criar o contexto segurava o splash por ~2 s.

## 7. Fluxo de um frame (M0, `packages/game/src/game.ts`)

1. `platform.requestFrame` → `game` mede o frame com `platform.now()` (limitado a 0,1 s).
2. `platform.input.poll(raw)` → `MenuInput.update` (qualquer teclado/controle navega; guarda o último dispositivo).
3. Título e Ajustes: `MenuController` (layout refeito só quando tamanho, safe area ou fontes mudam; ações + mouse sem
   lock + toque) → `DrawList` → `renderer.renderViews([])` (zera as estatísticas) → `renderer.drawUi(list)`.
4. Cena de teste (`test-scene.ts`): o mapeador do jogador segue o último dispositivo usado (`setDevice`/`setProfile`
   só na troca) e gira a mira já neste frame → `LocalDriver.update(dt)` = `createSimLoop`: para cada tick,
   `mapper.writeFrame(frames[0])`, `bots.think(view, frames)`, `sim.step(frames)`, eventos drenados (spawn reposiciona
   a mira, troca de arma sincroniza o mapeador, acerto acende flash e retícula).
5. A `SimView` é interpolada com `alpha` → `ActorBuffer` (caixas) e `ViewDesc` (câmera Hor+, ADS, recuo da sim) →
   `renderer.renderViews([view])` → HUD na `DrawList` (e o menu de pausa por cima) → `renderer.drawUi(list)`.
6. Pausa: `lifecycle.onPause` (pointer lock perdido, aba oculta, HOME), `pause` do mapeador (P/Esc, Start/+, botão
   de toque). Pausado, a sim não anda e a mira não gira; "Sair da partida" volta ao título e libera o mundo.
7. Primeiro frame do título: `[boot] menu-ready <ms>` no log da plataforma (portcheck, Teste Zero) e
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
