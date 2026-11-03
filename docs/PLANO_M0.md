# Plano do M0: Fundação (02/11/2026)

> Fonte: `docs/design/tecnico.md` §3, §4, §9, §10, §14, §19–§21 e §23; `docs/GDD.md` §7.
> `docs/DECISOES.md` manda sobre este plano.

## Objetivo

Deixar pronta a base em que todo o resto do jogo é construído, já com as regras do Switch valendo desde o primeiro
commit. O M0 **não é jogável**: entrega uma sim headless que roda, uma cena de teste na web e o esqueleto do Switch.

## Critério de pronto (GDD §7)

1. CI verde (typecheck, testes, formatação, guardas, build web, build do Switch, portcheck).
2. A URL publicada (`erereck.github.io/boboforces`) abre o splash em menos de 1 s.
3. A sim roda 3.600 ticks headless com hash estável (teste golden).
4. O bundle do Switch passa no `portcheck` (varredura + boot em `node:vm` com globais falsos do nx.js).

## Stack fixada no M0 (versões exatas, sem `^`)

| Pacote | Versão | Uso |
|---|---|---|
| typescript | 7.0.2 | typecheck (igual ao VNbobo) |
| three | 0.187.0 | só em `packages/render` |
| vite | 8.3.5 | `apps/web` |
| vitest | 5.1.0 | testes por pacote |
| esbuild | 0.28.2 | `apps/switch` e tools |
| fflate | 0.8.3 | formatos RLE + deflate |
| prettier | 3.9.10 | printWidth 120, aspas simples |
| @nx.js/runtime, @nx.js/nro, @nx.js/nsp | 1.0.0-beta.7 | só `apps/switch` |
| msdf-bmfont-xml | 2.8.0 | `tools/fontbake` (só ferramenta) |

As guardas de portabilidade são um script próprio (`tools/guard`) em vez de ESLint: menos dependências e nada
preso à compatibilidade com o TypeScript 7.

## Entregas por área

| Área | Entrega no M0 |
|---|---|
| Raiz | npm workspaces (`packages/*`, `apps/*`, `tools/*`), `tsconfig.base.json` no padrão do VNbobo, `version.json` (versão, codinome, formatos), `CHANGELOG.md`, `CLAUDE.md`, `.prettierrc.json`, `vitest.config.ts`, `.gitignore`, `local/` fora do git |
| docs | `ARCHITECTURE.md`, `PORTABILIDADE.md` (as 23 regras), `PERF.md` (vazio, com modelo), `DEPENDENCIAS.md`, `PROMPTS.md`, `CREDITOS.md` atualizado |
| `shared` | math (vec3 em arrays), RNG com semente (sfc32/mulberry32, um fluxo por domínio), pools, ring buffer, BitWriter/BitReader, hash de estado |
| `format` | `MatchRecipe@1` mínima, validador, migrações vazias, registro de IDs de conteúdo, `version.json` lido como constantes |
| `platform-api` | só tipos: `Platform`, `Storage`, `Assets`, `Files`, `TextInput`, `Lifecycle`, `Diagnostics`, `OnlineService` (opcional, `null` no Switch) |
| `world` | grade de blocos de 0,5 m, chunk 32³, RLE, DDA, colisão AABB varrida com degrau de 0,5 m (rampas e formas completas ficam no M1) |
| `sim` | ECS-lite em typed arrays, passo fixo de 60 Hz com acumulador, `InputFrame`, perfil de movimento Bobo (tabela de métricas §7.1), fuzil hitscan, dano, morte e respawn, eventos |
| `ai` | bot mínimo para o golden e o robô de balanceamento: anda até o alvo e atira com o modelo de mira (sem navegação ainda) |
| `input` | ações, `InputFrame`, perfis de teclado/mouse, gamepad e toque → ações; os adaptadores de eventos ficam em `apps/web` |
| `render` | único pacote com three: recebe canvas + contexto WebGL2 da plataforma (a costura do shim do nx.js), 1 chunk texturizado com `TEXTURE_2D_ARRAY`, câmera FPS, 1 a 4 viewports por scissor |
| `ui` | árvore de UI → `DrawList`, layout por âncoras, foco espacial, texto MSDF, tokens escuros, tabela `strings.pt-BR.ts`, 1 tela |
| `game` | boot → tela de título de teste → cena de teste (1 chunk, câmera livre, bot andando), `LocalDriver` |
| `apps/web` | Vite com `base: './'`, splash inline (SVG + CSS), `platform-web`, adaptadores de input, aviso de navegador sem WebGL2 |
| `apps/switch` | esbuild → `romfs/main.js` com `__ONLINE__: false`, `platform-switch` stub, NACP com title ID fixado, scripts NRO/NSP herdados do MMM (só locais) |
| tools | `texgen` (paleta mestra + validador, gera as primeiras texturas 16×16), `fontbake` (atlas MSDF), `balance` (duelos de fuzil), `guard`, `portcheck`, `size-check` |
| CI | `.github/workflows/ci.yml` (todo push/PR) e `deploy.yml` (Pages na `main`) |

**Fontes no M0:** Barlow Condensed (OFL, já usada no futbobo) como provisória para HUD e títulos. A escolha final é
por print (GDD §9.1 #4).

## Como vai ser feito

1. **Esqueleto:** raiz, todos os `package.json`/`tsconfig` dos pacotes, contratos de tipo (`platform-api`,
   `InputFrame`, `SimView`, `MatchRecipe`) e `npm install` único. Os contratos vêm primeiro para as frentes
   trabalharem em paralelo sem pisar uma na outra.
2. **Frentes em paralelo, cada uma dona das suas pastas:** (a) `shared` + `format`; (b) `world` + `sim` + `ai` +
   golden + `balance`; (c) `input` + adaptadores web; (d) `render` + `texgen`; (e) `ui` + `fontbake`;
   (f) `apps/switch` + `portcheck` + `guard` + CI.
3. **Integração:** `game` + `apps/web`, todos os comandos rodando juntos.
4. **Verificação independente** dos 4 critérios de pronto e das 23 regras de portabilidade.

## O que precisa do Erick

- **Publicar:** o `gh` não está logado nesta máquina. Para o critério 2 (URL publicada) é preciso criar o
  repositório público `erereck/boboforces` e fazer o push. Isso só acontece com o seu OK, e o login no GitHub
  (`gh auth login`) é você quem faz.
- **Commits:** nada de commit ou push sem pedido seu (regra do VNbobo). O `git init` entra no M0; o primeiro commit
  fica esperando o seu OK.
- **Title ID do Switch:** proposta `01E1AB0B0B0F0000` (prefixo EriLab do MMM). Só muda se você preferir outro.

## Fora do M0

Mundo completo (formas, AO, luz, mesher otimizado), skins, modelos e mapa do Construto (M1); jogabilidade real,
armas além do fuzil, menus completos e Laboratório (M2); tela dividida jogável e Zombies (M3); rede (M5).
