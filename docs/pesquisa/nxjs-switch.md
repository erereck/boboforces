**Resumo.** Dá para fazer 3D com WebGL2 no nx.js oficial (v1.0.0-beta.7). O suporte entrou em junho de 2026, então tem uns 5 meses. Não encontrei nenhum exemplo oficial com three.js. O fork Brewser diz rodar demos de three.js, mas os números são dele mesmo. Não achei nenhum exemplo de tela dividida.

## CONFIRMADO

**Versão e maturidade**
- A versão atual é **v1.0.0-beta.7**, de 13 de outubro (provavelmente 2026). A linha 1.0 ainda está em pré-release. No beta.0 o motor trocou QuickJS por V8 com libuv. https://github.com/TooTallNate/nx.js/releases
- O WebGL2 entrou no PR #390, mesclado em 13/06/2026, e saiu no beta.4. https://github.com/TooTallNate/nx.js/pull/390
  - Funciona via EGL + Mesa/nouveau, e o driver se identifica como "OpenGL ES 3.2 Mesa".
  - São cerca de 200 bindings, com VAO, instancing, UBO, transform feedback, queries e sync.
  - Desenha direto no framebuffer padrão e o vsync é `eglSwapInterval(1)`.
  - Testes publicados: só um cubo a 60fps e 35 asserções de conformidade comparadas com o Chrome.

**Como obter o contexto**
- O contexto vem de `screen.getContext('webgl2')`. https://nxjs.n8.io/runtime/rendering
- Só funciona em **application mode** (cerca de 3 GiB): hbmenu aberto segurando R ao iniciar um jogo, ou NSP instalado.
- Pelo Álbum (applet mode, cerca de 380 MiB) a chamada retorna `null`. https://nxjs.n8.io/runtime/configuration

**Limitações do WebGL2** (fonte: rendering, PR #390 e https://nxjs.n8.io/runtime/api/classes/WebGL2RenderingContext)
- Não existe contexto `webgl` (WebGL1).
- `getExtension()` retorna `null` e `getSupportedExtensions()` retorna `[]`.
- Consultas do tipo `getParameter(CURRENT_PROGRAM)` retornam `null`.
- Não há MSAA no framebuffer padrão.
- `isContextLost()` sempre retorna false.
- Cada canvas aceita só um tipo de contexto: ou 2D ou WebGL2.
- `texImage2D` aceita ImageData, Image, ImageBitmap e canvas.

**Sem DOM**
- O índice da API não tem `document` nem `HTMLCanvasElement`. https://nxjs.n8.io/runtime/api
- Tem `window`, `requestAnimationFrame`, `performance`, `OffscreenCanvas` e `createImageBitmap`.
- Worker e SharedArrayBuffer não aparecem na documentação.

**three.js**
- O exemplo oficial `apps/webgl-cube` usa WebGL puro e não depende de three.js. https://github.com/TooTallNate/nx.js/tree/main/apps
- O Brewser, um fork estendido do nx.js, declara no v0.1.114 (17/08) que "full curated Three.js demo suite" roda no aparelho. https://github.com/natureglass/Brewser/releases/
  - Ele mostra um GLTF loader a 60fps.
  - Diz ter cerca de 84% de cobertura de DOM.
  - No v0.1.131 (15/09) cada canvas WebGL ganhou framebuffer próprio.
  - Ele mesmo admite que "some WebGL extensions are still missing".
  - Exige Atmosphère 1.10+, mais o R ao abrir ou um forwarder NSP com sigpatches. https://github.com/natureglass/Brewser
- Um PoC de Phaser na versão antiga do nx.js só conseguia desenhar cenas primitivas. https://github.com/lulzsun/nxjs-phaser-poc

**Controles** (https://nxjs.n8.io/runtime/concepts/controllers)
- `navigator.getGamepads()` sempre devolve 8 posições. O índice 0 é o controle principal ou o modo portátil.
- Os eventos de conectar e desconectar funcionam desde o beta.4.
- O botão **+ fecha o app por padrão**. Para impedir, use `preventDefault()` em `beforeunload`.
- Vibração existe de duas formas:
  - `Gamepad.vibrationActuator`, com `playEffect('dual-rumble')`, `reset` e `pulse`. https://nxjs.n8.io/runtime/api/classes/GamepadHapticActuator
  - `navigator.vibrate({duration, lowAmp, lowFreq, highAmp, highFreq})`, no exemplo `apps/vibrate`.
- Giroscópio: o README fala em "motion controls", mas a API não tem Gyroscope, Accelerometer nem DeviceMotion. Só aparece AmbientLightSensor.
- Joy-Con em par ou separado e o botão HOME não são documentados.

**Áudio** (https://nxjs.n8.io/runtime/concepts/audio)
- Nós disponíveis: AudioContext, OfflineAudioContext, AudioBufferSource, Gain e **StereoPanner**.
- Não aparecem PannerNode (áudio 3D) nem Oscillator.
- O áudio roda numa thread nativa de tempo real e decodifica via FFmpeg (MP3, OGG, Opus, WAV, FLAC, AAC).

**Save e arquivos**
- `localStorage` é gravado no save data da Switch, separado por perfil e por app. https://nxjs.n8.io/runtime/concepts/save-data
- Arquivos embutidos são lidos com `romfs:/`. https://nxjs.n8.io/runtime
- O cartão SD é acessado com `Switch.file`, `readFile` e `writeFileSync` (`sdmc:/`). https://nxjs.n8.io/runtime/concepts/file-system

**Fontes**
- Existem `system-ui`, `system-icons` e `FontFace` via `fonts.add()` (FreeType), mas só para Canvas 2D. https://nxjs.n8.io/runtime/concepts/fonts

**WASM e memória** (https://nxjs.n8.io/runtime/configuration)
- WASM funciona sem configuração em application mode, porque lá o JIT está ligado.
- `[memory] heap_limit` controla o heap do V8.
- O cache de GPU do Skia é de 512 MiB por padrão em application mode.
- O threadpool tem 4 workers.

**Desempenho**
- Os únicos números publicados são o cubo a 60fps e o GLTF do Brewser a 60fps.
- O README do deko3d diz que o nouveau não usa Zcull, tiled cache nem render targets comprimidos, e que OpenGL tem custo de CPU bem maior. https://github.com/devkitPro/deko3d

**Tela dividida**
- Não encontrei nenhum exemplo, nem oficial nem da comunidade.

## INFERIDO / OPINIÃO

**Inicializar three.js no nx.js oficial**
- O caminho provável é `new WebGLRenderer({ canvas: screen, context: gl })`, mais um shim mínimo para `style`, `clientWidth` e `getContextAttributes`.
- `TextureLoader` usa `document.createElementNS` e deve quebrar. A saída seria `ImageBitmapLoader` (com `createImageBitmap` lendo de `romfs:/`) ou DataTexture.
- O three.js usa `OffscreenCanvas` quando ele existe.

**O que pode quebrar sem extensões**
- `EXT_color_buffer_float` e `EXT_color_buffer_half_float` "não existem". Isso pode quebrar render targets HalfFloat: EffectComposer, PMREM/IBL, bloom e HDR.
- Porém o GLES 3.2 já tem buffer de cor float no núcleo, então pode funcionar por acaso. É preciso testar.
- Sem `OES_texture_float_linear` não há filtragem linear em texturas float.
- Sem `EXT_texture_filter_anisotropic` não há filtragem anisotrópica.
- Sem `EXT_disjoint_timer_query` não dá para medir tempo de GPU.
- Sem `KHR_parallel_shader_compile` a compilação de shaders trava o frame.
- Sombras básicas (depth texture faz parte do núcleo) devem funcionar, mas o custo é por luz e por viewport.

**Tela dividida**
- `setViewport` + `setScissor` + `setScissorTest` usam `viewport`/`scissor`, que são núcleo do WebGL2. Deve funcionar, mas são 4 passes de cena por frame.

**Física em WASM**
- Rapier (build compat) e Jolt (build single-thread) devem rodar. Sem Workers não há física em paralelo, e o suporte a SIMD precisa ser testado.

**Controles**
- HOME é reservado pelo sistema e o app não deve recebê-lo.
- Joy-Con sozinho na horizontal provavelmente exige configuração de HID ou do applet de controles, que o nx.js não documenta.
- Giroscópio provavelmente exigiria um fork.

**Resolução**
- Provavelmente 1280x720 mesmo na dock. Não confirmado, é preciso medir `drawingBufferWidth`.

## RISCOS (FPS voxel, 4 jogadores em tela dividida, 20–30 bots)

1. **Gargalo de CPU numa thread só.** JS (V8), IA de 30 bots, física, montagem de malha voxel e 4× os draw calls do three.js disputam um núcleo do A57, com overhead do Mesa/nouveau em cima. Esse é o maior risco.
2. **Draw calls × 4 viewports.** Malhas voxel em chunks precisam de merge agressivo ou instancing; sem frustum culling bom, a conta estoura.
3. **Fill rate e overdraw.** Sem Zcull no nouveau, a ordenação front-to-back passa a ser obrigatória.
4. **Sombras e pós-processamento.** Shadow map por viewport e render targets float podem não funcionar ou sair caros.
5. **Sem MSAA no framebuffer padrão e sem anisotropia.** O voxel vai ficar serrilhado e borrado à distância.
6. **Joy-Con em par vs separado.** Quatro jogadores normalmente significam pares de Joy-Con separados. O mapeamento não está documentado e não há giroscópio para mira.
7. **Botão +** fecha o app se o `beforeunload` não for tratado. HOME não pode ser interceptado.
8. **Áudio sem PannerNode.** Não há áudio posicional 3D nativo, só pan estéreo, e são 4 ouvintes.
9. **Plataforma imatura.** WebGL2 tem cerca de 5 meses, a versão é beta e só há um exemplo oficial. Dependências podem quebrar entre betas.
10. **Distribuição.** Exige application mode (R ao abrir ou NSP). Pelo Álbum o jogo não abre.
11. **Pausas de GC do V8** quando a montagem de malha aloca memória a cada frame.
12. **HUD e texto.** É 2D ou WebGL, nunca os dois no mesmo canvas. O texto precisa ser desenhado num OffscreenCanvas e enviado como textura.

## "Teste Zero": o que medir no hardware real

- `getContext('webgl2')` funciona em application mode e retorna `null` pelo Álbum.
- Valores de `drawingBufferWidth` e `drawingBufferHeight` na dock e no modo portátil.
- three.js r17x inicializando com o shim mínimo, mais quais `console.warn` de extensões aparecem.
- Se um framebuffer RGBA16F fica completo (`checkFramebufferStatus`) e se PMREM e sombras funcionam.
- Cena voxel fixa (por exemplo 64×64×32 chunks) com 1 viewport e com 4 viewports por scissor.
- Tempo de frame, separando JS e GPU:
  - CPU com `performance.now()` em volta de `render()`.
  - GPU por inferência, já que não há timer query: forçar `gl.finish()` em modo diagnóstico.
- Draw calls e triângulos por viewport (`renderer.info`).
- 30 bots com IA e raycast, mais física Rapier compat: custo de `step()` por frame.
- Montagem de malha de um chunk: tempo e alocações. Pausas de GC via `performance.now()` acompanhado por vários minutos.
- Uso de memória ao longo de uma sessão de 20 minutos (heap do V8 e memória nativa).
- 4 controles: Pro Controllers e pares de Joy-Con separados, verificando `styleSet` e `deviceType`, a ordem dos índices, rumble por controle e + bloqueado.
- Compilação de shaders: travada no primeiro frame e ao trocar de material.
- Temperatura e clock: frame time estável depois de 10 minutos, na dock e no modo portátil.