# Regras de ouro de portabilidade

> Fonte: `docs/design/tecnico.md` §21. `docs/DECISOES.md` manda sobre este texto.
> Valem para **todo o código compartilhado** (`packages/*`). As cascas (`apps/web`, `apps/switch`) são a única
> fronteira com o navegador e o nx.js. O Switch é o alvo mais restrito e tudo é projetado para ele desde o dia 1
> (decisão #1).

## Como as regras são garantidas

| Mecanismo | O que pega | Onde |
|---|---|---|
| `tsconfig.src.json` dos pacotes puros (`shared`, `format`, `platform-api`, `input`, `world`, `nav`, `sim`, `ai`, `ui`) e do `game` com `"lib": ["ES2023"]` e `"types": []` | `window`, `document`, `localStorage`, `fetch`, `HTMLElement`, `console`, APIs do Node: viram erro de tipo (o `game` vê o render só por `@boboforces/render/data`, sem DOM) | `npm run typecheck` |
| `tools/guard` (script próprio, sem ESLint) | globais e imports proibidos por pacote: three fora de `render`, `net` fora de `apps/web`, `@boboforces/render` no `game` (só `/data`), relógio e acaso em sim/ai/nav/format/world (lista branca: de `Math` só as funções puras por acesso direto; `Date`, `performance` e `crypto` nunca), `eval`/`new Function`/`.constructor(…)`/`setTimeout` com texto, `Worker`, `RTCPeerConnection`/`WebSocket`, `Intl`/`toLocale*`, `getExtension`, globais do navegador que o nx.js não tem (`addEventListener`, `location`, `screen`, `devicePixelRatio`, `URL`, `Blob`, `FontFace`…), `import.meta` fora das cascas, `import()` não literal, float/half-float e textura comprimida do three. Enxerga colchete (`obj['nome']`), cast (`(globalThis as any).x`), alias, desestruturação e `Reflect.get` da raiz global, com escopo por bloco | `npm run guard` |
| `packages/render/src/render.test.ts` | todos os shaders exportados (sem lista fixa): nenhum vertex shader lê textura (`texture*`, `texelFetch*`, `sampler`), nenhum shader usa `#extension`/`#version`, e os materiais só usam shaders desses módulos | `npm test` |
| `tools/portcheck` | build do `apps/switch`, varredura do bundle (rede, inclusive `fetch`; `RTCPeerConnection`, `trystero`, `WebSocket`, threads, `localStorage`, `eval`; também pela raiz global e por texto entre colchetes) e boot do `game` em `node:vm` com globais falsos do nx.js e `NullRenderer` | `npm run portcheck` |
| `npm run smoke:web` (também no CI) | build de verdade no Edge headless, em 1280×720 e 667×375: splash, título, cena, pausa, programas ≤ 7, zero erros no console | CI |
| Revisão | o que as ferramentas não enxergam (alocação no laço quente, fluxo só com D-pad, MSAA no framebuffer do Switch, timer query) | checklist de entrega |

## Plataforma

1. **Sem DOM:** nada de `document`, `window.*`, `HTMLElement`, `HTMLCanvasElement`, CSS, `innerHTML`, `DOMParser` ou
   `new Image()` direto. Os pacotes puros nem compilam se isso aparecer.
2. **Sem armazenamento direto:** nada de `localStorage`, `sessionStorage` ou `indexedDB`. Tudo passa por
   `platform.storage`.
3. **Sem `fetch` nem URLs:** assets são pedidos por caminho lógico (`maps/construto.bfmap`) via `platform.assets`.
4. **Sem rede fora de `net`:** nada de `RTCPeerConnection`, `WebSocket` ou Trystero. `sim`, `game` e `ui` nunca
   importam `net`.
5. **Sem threads:** nada de `Worker`, `SharedArrayBuffer`, `Atomics` ou WASM com threads.

## Gráficos e áudio

6. **WebGL2 puro:**
   - sem `getExtension` (exceto o diagnóstico da casca web);
   - sem WebGL1;
   - sem MSAA no framebuffer padrão do Switch;
   - sem render target float ou half-float;
   - sem EffectComposer;
   - sem texturas comprimidas (KTX2/Basis);
   - sem anisotropia;
   - sem timer query;
   - sem leitura de textura no vertex shader;
   - só `WebGLRenderer`.
   - `TEXTURE_2D_ARRAY` e atributos inteiros são núcleo do WebGL2 e permitidos, com o atlas de plano B pronto atrás de
     um `#define`.
7. **three.js só em `render`.** Nada de `TextureLoader`, `ImageLoader`, `FontLoader`, `CSS2D`/`CSS3DRenderer`,
   `OrbitControls` ou qualquer coisa que leia eventos do DOM.
8. **No máximo 7 programas de shader.**
9. **Áudio só pelo mixer:** nada de `PannerNode`, `OscillatorNode`, `AudioWorklet`, `HTMLAudioElement` ou
   `MediaElementSource`.

## Simulação e memória

10. **Tempo e acaso:** sem `Math.random`, `Date.now` ou `performance.now` em `sim`, `ai`, `nav` e `format` (e `world`,
    pela convenção do M0). Usar o tick e o RNG com semente (`createRng` do `shared`, um fluxo por domínio com `fork`).
11. **Sem alocação no laço quente:** nada de vetores, arrays ou closures novos por frame. Usar pools (`Pool`,
    `IndexAllocator`, `RingBuffer`) e objetos de rascunho.

## Entrada, texto e tela

12. **Input só por ações.**
    - Eventos de teclado, ponteiro e toque só nos adaptadores de `apps/*`.
    - Todo fluxo tem que ser jogável só com D-pad + A/B.
    - Nada pode exigir hover, mouse, toque ou giroscópio.
13. **Texto:**
    - sempre pela tabela de textos pt-BR (`packages/ui/src/strings.pt-BR.ts`) + MSDF;
    - sem fonte de sistema;
    - sem `toLocaleString`/`Intl`: a formatação de números é própria (`formatInt`, `formatDecimal`).
14. **Entrada de texto** só por `platform.textInput`, com o teclado próprio de reserva.
15. **Sem `eval` nem `new Function`.** `import()` dinâmico só em `apps/web`.
16. **Sair e pausar:** `+` pausa; sair só por `platform.exit()`. Nunca depender de Esc, Home ou do voltar do navegador.
17. **Nunca assumir proporção, DPR ou resolução.**
    - UI por âncoras e safe area.
    - Testar em 640×360 (um viewport de 4 jogadores), 1280×720 e 667×375.

## Modos, dados e dependências

18. **Todo modo roda com `platform.online === null`** e com zero humanos remotos.
19. **Toda receita e todo perfil passam pelo validador** e respeitam o teto da plataforma.
20. **IDs de conteúdo nunca mudam.** Aposentar um ID exige substituto no registro (`packages/format/src/content-ids.ts`).
21. **Caches com limite** e `dispose()` total ao trocar de mapa.
22. **Dependência nova** só se passar no `portcheck` e estiver em `DEPENDENCIAS.md` e `CREDITOS.md` com versão exata.
23. **Formatos de asset:** só PNG, MP3 e binários próprios com RLE + deflate.
