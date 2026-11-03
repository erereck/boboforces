# Changelog

Formato das versões lançadas (padrão gamebobo): `## X.Y.Z — Codinome — AAAA-MM-DD`. MAJOR = save ou conceito
incompatível; MINOR = sistema jogável novo; PATCH = correção. Versão, codinome e versões de formato ficam no
`version.json`. Pedidos de origem em `docs/PROMPTS.md`.

## [Não lançado] — 0.0.1 — Primeiro Bloco

### M0 Fundação (integrado; falta o primeiro commit e a publicação, P-002)

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
