**Convenções dos projetos EriLab (gamebobo, futbobo, novelo/VNbobo)**

**1. Stack e linguagem**
- **gamebobo**: JavaScript/JSX, sem TypeScript. React 19.2.8, three 0.180.0 e Vite 6.4.3, versões fixas sem `^` (`gamebobo/package.json`). Pede Node 20+.
- **futbobo**: TypeScript 5.9.3 (strict). Next.js 16.2.11, React 19.2.6, three 0.186.1 e Capacitor 8 (Android). Pede Node >=22.13 (`futbobo/package.json`).
- **novelo (hoje VNbobo)**: TypeScript 7.0.2 com tsconfig muito estrito (`novelo/tsconfig.base.json`: `erasableSyntaxOnly`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). O Node 24+ roda os `.ts` direto. Monorepo com npm workspaces `packages/*` e `tools/*`.

**2. Bundler**
- gamebobo: Vite, com `base: '/gamebobo/'`, chunks manuais three/react e servidor em 127.0.0.1:5173. O vigia ignora `.claude/**` (`gamebobo/vite.config.js`).
- futbobo: Next com `output: "export"`, `trailingSlash` e imagens sem otimização. O `basePath` muda conforme `GITHUB_PAGES_CUSTOM_DOMAIN`, `ITCH_BUILD` e `CAPACITOR_BUILD` (`futbobo/next.config.ts`).
- VNbobo: Vite 8.3.4 com `base: './'` (`novelo/packages/player/vite.config.ts`).

**3. Framework de UI**
- gamebobo e futbobo usam React puro e CSS próprio (futbobo usa CSS Modules mais `globals.css`/`premium.css`).
- O editor do VNbobo usa React com Fluent UI 9 (`novelo/packages/editor/package.json`). O player do VNbobo desenha em DOM/SVG.

**4. Deploy**
- **gamebobo**: GitHub Pages pelo `.github/workflows/deploy-pages.yml` (push na `main`: `npm ci`, test, build, publica `dist`). O `ci.yml` roda nos PRs. URL: erereck.github.io/gamebobo.
- **futbobo**: GitHub Pages pelo `.github/workflows/deploy.yml` (Node 24), com domínio próprio `futbobo.top` (`public/CNAME`, `metadataBase` em `app/layout.tsx`). O APK sai pelo `release-android.yml` (tag `android-v<versão>`, arquivo `futbobo.apk` no GitHub Releases). Detalhes em `ANDROID.md`.
- **Cloudflare no futbobo**: só aparece como resto de template (`.wrangler/`, `.vinext/`, `examples/d1/`, `drizzle/`, `worker/` vazio) e como STUN em `app/bobonline/net/diagnostics.ts`. Não há deploy para Cloudflare.
- **VNbobo**: não tem `.github`. O pacote `@vnbobo/deploy` publica em GitHub Pages, Cloudflare Workers, Vercel, itch.io e .zip. DECISOES #2 prefere GitHub Pages, com export que funcione em qualquer host estático.

**5. Versionamento e changelog**
- **gamebobo**: `version.json` guarda `version`, `codename`, `saveSchema`, `releasedAt` e `promptIds`.
  - `npm run version -- patch|minor|major "desc"` (`scripts/bump-version.mjs`) atualiza package, `src/version.js` e o CHANGELOG.
  - `npm run prompt -- "resumo"` (`scripts/log-prompt.mjs`) registra o pedido como P-NNN em `docs/PROMPTS.md`.
  - Formato do CHANGELOG: `## X.Y.Z — Codinome — AAAA-MM-DD`. MAJOR = save ou conceito incompatível; MINOR = novo sistema jogável; PATCH = correção.
- **futbobo**: não tem CHANGELOG. Usa `package.json` 1.3.0 (para o APK) e `app/version.ts` (`"v96"`, `"NOVOS CAMINHOS"`). A tela "Novidades" in-app fica em `ShellUtilityScreens.tsx`, com o mote "Sem parede de patch note".
- **VNbobo**: `CHANGELOG.md` com `[Não lançado]` dividido em fases (F0–F8) e ondas (W7–W19). Formato `novelo/1`, `SAVE_FORMAT_VERSION` e `PROFILE_FORMAT_VERSION` têm versões próprias, sempre com migração.

**6. Testes**
- gamebobo: `node --test src/game/engine/*.test.js`, mais um robô de balanceamento (`scripts/balance.mjs`) com `mulberry32` de semente fixa.
- futbobo: `npm test` faz build e depois roda `node --test tests/*.test.mjs` (inclui validar o HTML exportado). Lint com ESLint `eslint-config-next`.
- VNbobo: Vitest 5 com projetos por pacote, happy-dom e e2e no Edge instalado (`playwright-core`, `channel: 'msedge'`). Tem `npm run gate -- <pacote>`, typecheck e Prettier (`.prettierrc.json`: printWidth 120, aspas simples).

**7. Idioma e i18n**
- Os três são só pt-BR, sem biblioteca de i18n (`lang="pt-BR"` em `gamebobo/index.html` e `futbobo/app/layout.tsx`; manifest `lang: 'pt-BR'`).
- No gamebobo, os títulos de jogos inventados são em inglês.
- No VNbobo, docs e comentários são em pt-BR e identificadores em inglês.

**8. Design system (`.interface-design/system.md`)**
É uma especificação de interface por projeto, com seções Direção, Assinaturas, Tokens, Tipografia, Movimento e Componentes.
- **gamebobo** ("diorama de brinquedo"): adesivos com contorno de 2,5 px e sombra dura.
  - Cores: tinta `#1d1a24`, papel `#fff8ec`, tomate `#ff5d3a`, sol `#ffd23f`, céu `#3fb8ff`, menta, uva, rosa.
  - Fontes: Bricolage Grotesque 800 e Martian Mono.
  - Entrada com mola `cubic-bezier(.34,1.56,.64,1)`.
  - Regras de texto: botão com até 3 palavras, título com até 7. Tokens em `src/styles/tokens.css`.
- **futbobo** ("Matchday editorial", escuro):
  - Cores: tunnel `#050b08`, pitch-ink `#07110d`, referee `#f4c430` (ação), grass `#67dd78`, broadcast `#58a9e8`, card-red `#ef6258`.
  - Fontes: Barlow Condensed e Manrope, locais em `public/fonts`.
  - Grade de 4 px, alvos de 44 px, ícones SVG próprios (`FutboboIcon`), respeita `prefers-reduced-motion`.
- **VNbobo**: não tem pasta `.interface-design`.

**9. Estrutura de pastas**
- gamebobo: `src/game/{data,engine}`, `src/three`, `src/features`, `src/ui`, `src/styles`, `src/app`. Regra de dependência: `data → engine → features → app`; o engine não importa React nem three; o 3D só lê o estado (`docs/ARCHITECTURE.md`).
- futbobo: tudo dentro de `app/`, com um modo por pasta (`career/`, `botao/`, `copa/`, `bobonline/`, `x1/`, `arena/`).
- VNbobo: `packages/` (format, runtime, render, player, editor, cli, deploy…), `tools/`, e `local/`, que é privado e fica fora do git.

**10. PWA e offline**
- gamebobo: `public/site.webmanifest` e ícone SVG, sem service worker.
- futbobo: `public/manifest.webmanifest`, sem service worker. O offline vem pelo APK Capacitor.
- VNbobo: `vite-plugin-pwa` com Workbox (`registerType: 'prompt'`, precache só da casca) e "baixar capítulo para jogar offline". Manifest em fullscreen e paisagem.

**11. Celular**
- gamebobo: breakpoint de 760 px, `viewport-fit=cover`, variáveis de safe-area, e o checklist do README manda conferir 375 px e desktop.
- futbobo: mobile-first, navegação inferior, `100dvh`, alvos de 44 px e mínimos tipográficos (`system.md`).
- VNbobo: Android/Chromium é o alvo (DECISOES #1), alvos de 44 px e "Gire o celular".

**12. Rede e multiplayer**
- Só o futbobo tem: Bobonline, P2P WebRTC via Trystero 0.26 com sinalização em relays Nostr (`app/bobonline/net/*`). A config fica em `public/bobonline/net.json` (relays, TURN, versão do protocolo).
- Tem salas com código, modo X1 e torneios de 4 e 8. O X1 também existe local (`app/x1`).

**13. Marca EriLab**
- Nome "*bobo" para todos os projetos (DECISOES #23 em `novelo/docs/DECISOES.md`). Usuário do GitHub: `erereck`.
- futbobo:
  - `app/layout.tsx` põe "EriLab" como author, creator e publisher, e como Organization no JSON-LD.
  - O painel "Outros jogos" tem cabeçalho "ERILAB" e liga gamebobo, pokebobo e mmmweb.vercel.app (`app/components/shell/FutboboShell.tsx`).
  - Slogan na home: "FAÇA SUA HISTÓRIA".
- VNbobo: licença MIT em nome de "Erick (EriLab)", e o README tem seção de créditos que cita o Claude.
- gamebobo não cita EriLab. O logo dele é um cartucho "GB" (`public/gamebobo-icon.svg`); o do futbobo é o `public/favicon.svg`, usado como `BrandMark`.
- Tom: pt-BR informal, "humor bobo, nunca maldoso", pouco texto ("Se precisa de parágrafo, a mecânica está mal desenhada", em `gamebobo/docs/VISION.md`). Projetos gratuitos e não comerciais (`docs/CONTENT_NOTICE.md`).

**14. Regras do autor**
Só o `novelo/CLAUDE.md` existe:
- Não instalar dependências (depois, DECISOES #21 liberou, com versão fixa e registro em `docs/DEPENDENCIAS.md`).
- Não fazer commit nem push sem o Erick pedir. Não alterar `docs/DECISOES.md`.
- Fixtures de teste sintéticas. Nada de fontes da Microsoft.
- Simulação separada da renderização; constantes em config; RNG com semente; entrada como ações gravadas; debug no F2; `dispose()` total; saves versionados com migração.
- Mobile-first com alvos de 44 px.
- Ao terminar, relatar o que foi feito, decisões, números e pendências.

Também valem como regra: o checklist "Antes de entregar uma mudança" do `gamebobo/README.md` (test, build, jogar, 375 px, balance) e a frase de `novelo/docs/DIRECAO.md`: "Quer quebrar uma regra? … peça ao Erick".