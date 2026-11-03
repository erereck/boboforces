Raiz: a pasta local `MMM Overdose` (fora deste repositório). Não há `node_modules`, `romfs/` nem `vendor/` em disco, então para rebuildar é preciso `npm ci`.

**Versões (`mmm-switch\package.json`, `package-lock.json`)**
- `@nx.js/runtime`, `@nx.js/nro` e `@nx.js/nsp` estão em `1.0.0-beta.6`. `@nx.js/constants` está em `0.4.1`, `esbuild` em `0.25.12`.
- Dependências transitivas: `@nx.js/patch-nacp 2.0.0`, `@tootallnate/{hacbrewpack,nacp,romfs,nro}` e `jimp 1.6.1`.
- O README pede Node 22 ou superior. Versão do app: 0.2.3, autor "EriLab".

**Build e empacotamento**
- `scripts\build.mjs`:
  - copia `assets/` da fonte web para `romfs/assets`;
  - **concatena 5 scripts clássicos** (`js/game/levels.js`, `secret-levels.js`, `challenge-levels.js`, `js/compat/spring-rotation.js`, `js/game.js`) em `vendor/core.js`, com o prefixo `const { window, document, location, localStorage, navigator, Audio, Image, requestAnimationFrame } = globalThis.MMM_PLATFORM;`, que sombreia os globais;
  - grava `romfs/source-manifest.json` com sha256 dos arquivos e o commit git da fonte;
  - roda o esbuild de `src/main.js` para `romfs/main.js` (esm, es2022, com sourcemap).
- Scripts npm:
  - `npm run nro`: build seguido de `nxjs-nro --fat`.
  - `npm run nsp -- -k prod.keys`: executa `scripts\package-nsp.mjs`, empacotador próprio. Ele usa `nxjs.nacp` e `exefs` do `@nx.js/nsp` e aplica o patch do NACP pelo campo `"nacp"` do package.json: título "MMM Overdose", id `01E1AB4D4D4D0000`, `startupUserAccount 0`, `userAccountSaveDataSize "0"`. Depois chama `buildNsp` do hacbrewpack.
  - Hack documentado: o NACP é passado com `buffer.slice` exato, porque o CLI do beta.6 corrompia o ícone com buffers compartilhados.
- Ícone: `scripts\prepare-icon.mjs` usa o jimp para converter `branding\mmmico.png` em `icon.jpg` (JPEG 256×256, exige imagem quadrada).
- Verificação: `scripts\verify-nro.mjs` e `verify-nsp.mjs` conferem ícone, ID, versão e cada byte da romfs (148 arquivos).
- Teste no emulador: `scripts\prepare-eden-test.mjs` gera uma config do Eden com mapeamento de teclado em `.private/`.

**Tamanhos**
- `MMM-Overdose-Switch-0.2.3.nro`: 62,9 MB. Pelo header, o segmento de código tem cerca de 55,6 MB (o runtime; as strings internas sugerem V8 embutido), a romfs 7,27 MB, o ícone 9 KB e o NACP 16 KB.
- `.nsp`: 38,3 MB.
- Assets: 6,2 MB, dos quais a música `MusicaMuitoMinimalista.mp3` ocupa 2,47 MB.
- Código: o núcleo tem cerca de 158 KB (`game.js` 68 KB, `levels.js` 60 KB) e o adaptador `src\` cerca de 28 KB.

**Compartilhamento web e Switch: cópia, sem pacote comum**
- `mmm-switch\source-web\` é um snapshot da web. O build usa, nesta ordem: a variável `MMM_WEB_SOURCE`, depois `source-web`, depois `..\mmm-overdose-web`.
- Os níveis são idênticos, mas o `game.js` já divergiu (cerca de 219 linhas, ignorando CRLF). A versão web tem o lock de teleporte, `spawnP2` do creator e `exclusiveInput`.
- A web usa scripts clássicos e IIFE de propósito, para funcionar em Smart TV (`mmm-overdose-web\README.md`).
- Ponto de extensão: `window.MMM_PARTY`, opcional em `js\game.js`. O Switch usa para multiplayer e o creator usa em `creator\play-input.mjs`.

**Polyfills e falta de DOM (`mmm-switch\src\`)**
- `dom.js`:
  - `Hub` faz o papel de EventTarget;
  - `Element` fake com classList, dataset e children, e `querySelector` por id;
  - um canvas `#game` lógico de 1920×1080. Um Proxy sobre `screen.getContext('2d')` reescala o `setTransform` para 1280×720.
- `menu.js`: redesenha no canvas os menus que eram HTML, a partir dos elementos fake. Chega a fazer parse de `innerHTML <small>`.
- `main.js`:
  - injeta `location.search='?selftest=1'`, que roda os 33 selftests no boot, e em seguida simula as teclas Escape, ↓, ↓, Enter para abrir o seletor de fases;
  - embrulha o `fetch` para tirar o `?v=` de URLs `romfs:`, `sdmc:` e `file:`;
  - faz `preventDefault` no `beforeunload` e só sai pelo botão "Sair do jogo", que chama `Switch.exit()`;
  - grava log em `sdmc:/switch/mmm/runtime.log`.
- O núcleo recebe `navigator.getGamepads` vazio. Todo o input chega como teclas sintéticas.

**Input**
- `controller.js` lê `navigator.getGamepads()` do nx.js usando `Button` e `HidNpadStyleTag` de `@nx.js/constants`:
  - `styleSet` detecta Joy-Con único na horizontal (direito usa os eixos 2/3);
  - `rawButtons` (BigInt) captura SL/SR;
  - deadzone de 0,25.
- `input.js` converte em `KeyboardEvent.code` (ArrowLeft, Space, KeyR, Escape, Enter), com repetição de menu de 350 ms e depois 130 ms. Q é bloqueado (fases secretas desativadas no Switch).
- `party.js`: até 8 jogadores, cores espaçadas por ângulo áureo e contorno do sprite tingido via `OffscreenCanvas` e `getImageData`, com cache.
- Teclado: `keydown`/`keyup` globais são repassados.
- **Touch no Switch: não existe.** Na web, o touch está em `js\input\mobile-touch.js` e o gamepad em `gamepad-router.js`.

**Render**
- Só Canvas 2D (`getContext("2d",{alpha:false})`), sem WebGL.
- Mundo de 960×540, escala 2, física com passo fixo de 1/120 s e `MAX_FRAME` de 0,05.
- LITE MODE: escala 1, render a 30 fps e `imageSmoothing` desligado.

**Áudio (`src\audio.js`)**
- Classe que imita `HTMLAudioElement` sobre Web Audio: `AudioContext`, `decodeAudioData` de MP3 lido da romfs, BufferSource com Gain a cada `play`, `loop`, `currentTime` e `cloneNode`, com cache por arquivo.

**Fontes**
- `fonts.add(new FontFace('Monocraft', Switch.readFileSync('romfs:/assets/Monocraft.ttf')))`, usada como `"Monocraft", monospace`.

**Save (`src\storage.js`)**
- Substitui `localStorage`. Grava em `sdmc:/switch/mmm/save.json` e `save.backup.json` com `Switch.readFileSync`, `writeFileSync` e `mkdirSync`.
- Só persiste chaves `mmm-best-*`, com debounce de 250 ms e flush ao sair. Preferências valem só durante a sessão.
- Não usa save data em NAND (`userAccountSaveDataSize 0`).

**Assets**
- Ficam em `romfs:/assets/...`. As imagens usam o `Image` global do nx.js com caminho relativo; o áudio é buscado com `fetch(new URL(src,'romfs:/'))`.

**Lições (`mmm-switch\README.md`)**
- Em hardware, rodar com a memória de uma aplicação completa.
- O NSP 0.2.1 foi confirmado funcionando no console em modo solo. Os Joy-Cons na horizontal ainda não foram testados fisicamente.
- O Rich Presence do Eden busca a capa no repositório `eden-emulator/boxart`, e o build faaf1bac64 tem um bug (issue 607).
- As chaves (`prod.keys`) nunca são copiadas para o projeto.
- Testes: `test\platform.test.mjs` roda o `core.js` em `node:vm` com contexto mock. `test\preview.html` serve para ver o renderer no navegador.
- Não achei TODO ou FIXME em nenhum dos projetos.
- O `ferramentas\docs\PERF_SPEC.md` mede desempenho da versão PowerPoint/VBA (custos de COM e DoEvents). Não se aplica ao Switch.

**Formato de fase e editores**
- Runtime: `mmm-overdose-web\js\game\levels.js` define `window.MMM_LEVELS=[{id, slide, background, player{idle,stepR,stepL}, coinSprite, portalSprite, spawn, platforms[], hazards[], coins[], springs[{force}], portal, interactive[{type,doorId,mode,initialOpen,target}]}]`. Os retângulos estão em pontos de PowerPoint.
- `mmm-level-creator\` (v0.7.1, estático):
  - editor em SVG 960×540 em `src\app.js`, com os exemplos Legacy em `src\examples.js`;
  - salva em `localStorage` (`mmm-level-creator-v2`);
  - exporta nos schemas `mmm-level-v1` e `mmm-level-project-v1`, com `left`, `top`, `width`, `height`, um bloco `ppt{Name,Text,...}` e `gameplay`;
  - o tipo vai codificado no nome da shape: `$` plataforma, `#@` morte, `#%` moeda, `#&` mola, `#!` gravidade, `-Porta1`/`#*` porta e botão, e sufixo de movimento como `#?'120.420.90`.
- Sucessor: `mmm-overdose-web\creator\`, na rota `/creator`:
  - ES modules, autosave em IndexedDB e schema `mmm-creator-project-v2`;
  - importa JSON do mmmlc e PPTX/PPTM, usando `vendor\fflate.mjs`;
  - exporta PPTX, PPTM e ZIP web;
  - o teste roda no `game.js` real (`play.mjs`).
- `ferramentas\sim\lvltool.py`: DSL `{"t":"plat",...}` com solver A* (`mmm_ext.cjs`) que prova cada fase a 64 e a 32 Hz. `ferramentas\builder\` gera slides OOXML para os decks VBA.