# Regras para agentes (Claude e afins) no BoboForces

Leia na ordem antes de mexer em qualquer coisa: `docs/DECISOES.md` (manda sobre tudo) → `docs/PLANO_M0.md` (ou o
plano do marco atual) → `docs/ARCHITECTURE.md` → `docs/PORTABILIDADE.md` → as seções de `docs/design/tecnico.md` da
sua área (§1 princípios, §3 monorepo, §4 simulação e §21 portabilidade valem para todos).

## Inegociáveis

1. **`docs/DECISOES.md` só muda com resposta do Erick.** Escolha nova sua vai como decisão menor revisável, num doc de
   design ou no `ARCHITECTURE.md`, nunca na tabela dele.
2. **Nada de commit, push, `gh` ou repositório remoto** sem pedido explícito do Erick. O `git init` existe; o primeiro
   commit espera o OK dele.
3. **`local/` é privado** e fora do git: config do Eden, chaves, logs, capturas. `prod.keys`, `.nro` e `.nsp` nunca
   entram no repositório (decisão #33: o Switch é só uso pessoal).
4. **Fixtures de teste são sintéticas.** Nada de conteúdo de terceiros em `packages/` ou `tools/`.
5. **Fontes só OFL** (nunca fontes da Microsoft/Monotype nem fontes de sistema).
6. **Dependências:** versão exata, sem `^` (o `.npmrc` tem `save-exact=true`). Não mude versões fixadas. Dependência
   nova só com entrada em `docs/DEPENDENCIAS.md` e `docs/CREDITOS.md` e com o `portcheck` verde (regra 22).
7. **Edite só o que é seu** (matriz em `docs/ARCHITECTURE.md` §5). Contratos (§4 de lá) são da integração: precisou
   mudar? Escreva em "Pedidos de contrato" (§8) e siga com um contorno.
8. **Antes de terminar uma tarefa:** typecheck e testes do seu pacote verdes e Prettier só nos seus arquivos
   (`npx prettier --write <seus caminhos>`). O portão global (`npm run check`) é da integração.

## Convenções

- Identificadores em **inglês**; comentários, docs e textos de UI em **pt-BR**. Comentários com moderação, explicando o
  porquê. Prettier: printWidth 120, aspas simples.
- TypeScript strict no padrão do VNbobo (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `erasableSyntaxOnly`, `verbatimModuleSyntax`). ESM puro, imports relativos com extensão `.ts`, sem
  `enum`/`namespace`/parameter properties (use objetos `as const`). `import type` para tipos.
- Pacotes do workspace: `@boboforces/<nome>`, exportam `./src/index.ts` direto (sem build de pacote).
- Testes Vitest ao lado do código (`*.test.ts`), com dados sintéticos.
- Regras de arquitetura do Erick: simulação separada da renderização ("o 3D só lê o estado"); passo fixo; RNG com
  semente (`createRng` + `fork` por domínio); entrada como ações gravadas (InputFrame); constantes em config (a tabela
  de métricas em `packages/sim/src/config/metrics.ts` manda sobre arte e técnica); debug no F2; `dispose()` total;
  saves versionados com migração (`boboforces/<tipo>@<n>`).
- Stubs de outra frente lançam `Error('M0: frente X (…)')`.
- Mobile e controle: alvos de toque ≥ 44 px; todo fluxo jogável só com D-pad + confirmar/voltar.

## As 23 regras de portabilidade (resumo; texto completo em `docs/PORTABILIDADE.md`)

No código compartilhado (`packages/*`):

1. Sem DOM. 2. Sem `localStorage`/`indexedDB` (só `platform.storage`). 3. Sem `fetch`/URL (só `platform.assets` por
caminho lógico). 4. Sem rede fora de `net`. 5. Sem threads (`Worker`, `SharedArrayBuffer`, `Atomics`).
6. WebGL2 puro, sem extensões, sem render target float, sem EffectComposer, sem textura comprimida, sem leitura de
textura no vertex shader. 7. three só em `render` (nada de loaders do DOM). 8. No máximo 7 programas de shader.
9. Áudio só pelo mixer (Context, BufferSource, Gain, StereoPanner). 10. Sem `Math.random`/`Date.now`/`performance.now`
em sim, ai, nav, format e world. 11. Sem alocação no laço quente (pools e rascunhos). 12. Input só por ações (eventos
só nos adaptadores de `apps/*`). 13. Texto só pela tabela pt-BR + MSDF, sem `Intl`/`toLocaleString`. 14. Entrada de
texto só por `platform.textInput`. 15. Sem `eval`/`new Function`; `import()` dinâmico só em `apps/web`. 16. `+` pausa;
sair só por `platform.exit()`. 17. Nunca assumir proporção, DPR ou resolução. 18. Todo modo roda com
`platform.online === null`. 19. Receitas e perfis passam pelo validador e respeitam o teto da plataforma. 20. IDs de
conteúdo nunca mudam. 21. Caches com limite e `dispose()` total. 22. Dependência nova só com portcheck verde e
registro. 23. Assets só PNG, MP3 e binários próprios (RLE + deflate).

## Mapa do repositório

```
package.json · tsconfig.base.json · vitest.config.ts · version.json · CHANGELOG.md · CLAUDE.md
scripts/typecheck.ts        tsc de cada pacote/app/tool em paralelo
scripts/smoke-web.ts        teste de fumaça no Edge · prints.ts (prints do M1) · bench.ts (bench do PC)
docs/                       DECISOES (manda) · GDD · PLANO_M0 · ARCHITECTURE · PORTABILIDADE · PERF · DEPENDENCIAS ·
                            CREDITOS · PROMPTS · design/ (gameplay, tecnico, arte-ux) · pesquisa/
packages/shared             math, RNG, pools, ring buffer, bits, hash, assert, log (puro)
packages/format             version.json, ids de formato e de conteúdo, MatchRecipe, validadores, migrações, PNG (puro)
packages/input              teclas, estado bruto, ações, InputFrame, mapeador (puro)
packages/platform-api       só tipos da Platform (puro)
packages/world              grade, chunks, blocos, DDA/AABB, mesher (puro)
packages/nav                navegação 2,5D (puro, M1+)
packages/sim                sim headless, métricas, eventos, passo fixo (puro)
packages/ai                 bots (puro)
packages/ui                 árvore de UI, DrawList, tema, strings.pt-BR (puro)
packages/audio              mixer Web Audio (M2)
packages/render             único com three (`@boboforces/render/data` é a parte sem three que o game importa)
packages/game               fluxo, cola, LocalDriver, NullRenderer; a cena do Construto em ./scene (loading, partida,
                            bench, prints)
apps/web                    Vite, splash, platform-web, adaptadores de input (DOM só aqui)
apps/switch                 esbuild → romfs/main.js, platform-switch, NRO/NSP (só local)
tools/                      texgen · skingen · modelgen · mapc · audioconv · fontbake · balance · guard · portcheck ·
                            size-check
assets-src/                 fontes dos assets (textures, blocks, skins, models, maps, audio, fonts) e generated/;
                            runtime-assets.json = caminho lógico → arquivo gerado + ordem das tiras dos texture arrays
local/                      privado, fora do git
```

## Comandos

- Tudo: `npm run check` (typecheck + testes + Prettier + guard).
- Um pacote: `node scripts/typecheck.ts packages/sim` e `npx vitest run --project sim` (ou
  `npm run typecheck -w @boboforces/sim` e `npm test -w @boboforces/sim`).
- Builds: `npm run build` (web), `npm run build:switch`, `npm run portcheck`, `npm run size-check`, `npm run balance`.
- Assets (M1): `npm run assets` (texgen → modelgen → mapc; prévia das skins do boneco: `npm run skingen:figuras`),
  `npm run audioconv` (OGG → MP3), `npm run fontbake`. Prints e bench no Edge: `npm run build && npm run prints` /
  `npm run bench`.
- Navegador real: `npm run build && npm run smoke:web` (Edge headless; screenshots e relatório em `local/m0/`).

## Ao terminar uma tarefa, relate

O que foi feito, decisões tomadas (com motivo), números medidos (tempos, tamanhos, FPS, hashes), desvios de contrato e
pendências. Medições de desempenho vão para `docs/PERF.md`.
