# Dependências

> Versões **exatas**, sem `^` (`.npmrc` com `save-exact=true`). Instaladas no M0 (02/11/2026) com Node 26.7 / npm 11.19
> (o mínimo do projeto é Node 24). Toda dependência nova entra aqui e em `docs/CREDITOS.md`, e só é aceita com o
> `portcheck` verde (regra 22). Atualizar versão fixada só em mudança dedicada (three: rodando o bench e a cena do
> Teste Zero; tecnico.md §2.3).

## Vão no jogo

| Dependência | Versão | Licença | Motivo | Onde roda | Pacote |
|---|---|---|---|---|---|
| three | 0.187.0 | MIT | Render (só `WebGLRenderer`, WebGL2 puro); decisão #2 | web e Switch | `packages/render` |
| fflate | 0.8.3 | MIT | Inflate/deflate de mapas, códigos, backups e do decodificador PNG próprio | web, Switch e tools | `packages/format`, `packages/world` |

## Só ferramentas e build (não vão no jogo)

| Dependência | Versão | Licença | Motivo | Onde roda | Pacote |
|---|---|---|---|---|---|
| typescript | 7.0.2 | Apache-2.0 | Typecheck (o mesmo do VNbobo) | dev, CI | raiz |
| vitest | 5.1.0 | MIT | Testes por pacote (projetos) | dev, CI | raiz |
| prettier | 3.9.10 | MIT | Formatação (printWidth 120, aspas simples) | dev, CI | raiz |
| esbuild | 0.28.2 | MIT | Bundle do Switch (`romfs/main.js`) e do portcheck | dev, CI | raiz |
| @types/node | 26.6.6 | MIT | Tipos do Node para scripts, tools e testes | dev, CI | raiz |
| playwright-core | 1.64.1 | Apache-2.0 | E2E no Edge instalado (sem baixar navegador): `npm run smoke:web` | dev, CI | raiz |
| @types/three | 0.187.0 | MIT | Tipos do three | dev, CI | `packages/render` |
| vite | 8.3.5 | MIT | Dev server e build da web (`base: './'`) | dev, CI | `apps/web` |
| @nx.js/runtime | 1.0.0-beta.7 | MIT | Runtime do Switch (empacotado no NRO/NSP; tipos de referência) | Switch (local) | `apps/switch` |
| @nx.js/nro | 1.0.0-beta.7 | MIT | Gera o NRO (`nxjs-nro --fat`) | só na máquina do Erick | `apps/switch` |
| @nx.js/nsp | 1.0.0-beta.7 | MIT | Gera o NSP | só na máquina do Erick | `apps/switch` |
| msdf-bmfont-xml | 2.8.0 | MIT | Gera o atlas MSDF das fontes OFL | dev (build de assets) | `tools/fontbake` |

## Observações do `npm install` do M0

- **`npm audit`: 33 avisos "high", todos em ferramentas.** Vêm do `zod@3.25.76` puxado pelo `jimp`, que é dependência
  de `msdf-bmfont-xml` e de `@nx.js/nro`/`@nx.js/nsp`. Nada disso vai no bundle do jogo nem roda com entrada de
  terceiros (só fontes e ícones nossos). Não foi rodado `npm audit fix --force` (mudaria versões fixadas).
- **`esbuild@0.28.2` tem `postinstall` ainda não aprovado** no `allowScripts` do npm 11. O binário da plataforma vem
  pelas `optionalDependencies` (`@esbuild/win32-x64`) e o esbuild funciona sem o script (conferido com
  `esbuild --version` e uma transformação). Se um dia faltar, aprovar com `npm install-scripts approve esbuild`.
- **Dependências indiretas usadas de propósito pelos scripts locais do Switch** (`apps/switch/scripts`): `@nx.js/patch-nacp`
  2.0.0, `@tootallnate/hacbrewpack` 0.0.1, `@tootallnate/nacp` 0.2.1, `@tootallnate/romfs` 0.1.1, `@tootallnate/nro`
  0.1.3, `@tootallnate/nca` 0.0.1, `@tootallnate/aes-xts` 0.0.1 e `jimp` 1.6.1, todas MIT. Chegam pelo `@nx.js/nro` e
  pelo `@nx.js/nsp` (versões travadas no `package-lock.json`) e rodam só na máquina do Erick, nunca no jogo nem no CI.
  Se o nx.js deixar de trazê-las, declarar no `apps/switch/package.json` com a versão exata.
- As dependências de workspace (`@boboforces/*`) usam versão `0.0.0` exata; a versão do jogo fica no `version.json`.
- **Integração do M0:** nenhuma dependência externa nova. Declaradas as que já eram usadas pelo link do workspace:
  `fflate` no `world` (antes vinha da raiz), `@boboforces/ui` e `@boboforces/format` no `tools/fontbake`,
  `@boboforces/ui` no `apps/switch`. O `npm install` não mudou nenhuma versão fixada.
