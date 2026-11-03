# BoboForces no Switch (uso pessoal)

Casca do Switch homebrew do BoboForces, sobre o [nx.js](https://nxjs.n8.io) 1.0.0-beta.7. É **só para uso
pessoal** (decisão #33): NRO e NSP são gerados na máquina do Erick e **nunca** são publicados nem saem do CI.

- Título **BoboForces**, autor **EriLab**, title ID **`01E1AB0B0B0F0000`** (prefixo EriLab do MMM), versão do
  `version.json` da raiz. Os campos ficam no `nacp` do `package.json` desta pasta.
- 100% offline (decisão #1): o bundle não tem nenhum código de rede, e o `portcheck` garante isso.
- No M0, com GPU o jogo sobe até a tela de título (Sair fecha o app) e a cena de teste; sem GPU (aberto como applet)
  aparece o aviso de abrir em modo aplicativo. O Teste Zero (M1) é o primeiro teste de verdade no console.

## Requisitos

- Node.js 24 ou mais novo e `npm ci` feito na raiz do monorepo.
- Switch desbloqueado com Atmosphère (ou o emulador Eden) para rodar.
- Para o NSP: o seu `prod.keys`, **fora do repositório**. As chaves só são lidas do caminho que você passar; nunca
  são copiadas, impressas nem guardadas.

## Comandos

Da raiz (`-w @boboforces/switch`) ou de dentro de `apps/switch` (sem o `-w`):

| Comando | O que faz |
|---|---|
| `npm run build:switch` (raiz) | esbuild de `src/main.ts` → `romfs/main.js` + sourcemap + `manifest.json` (sha256 e commit) |
| `npm run portcheck` (raiz) | build numa pasta própria, varredura do bundle e boot em `node:vm` com nx.js falso |
| `npm run nro -w @boboforces/switch` | build + NRO autocontido em `apps/switch/build/BoboForces-<versão>.nro` |
| `npm run verify:nro -w @boboforces/switch` | confere NACP, ícone e cada arquivo do RomFS dentro do NRO |
| `npm run nsp -w @boboforces/switch -- -k "C:\caminho\prod.keys"` | build + NSP instalável em `apps/switch/build/BoboForces-<versão>.nsp` |
| `npm run verify:nsp -w @boboforces/switch -- -k "C:\caminho\prod.keys"` | abre o NSP e confere NCAs, hashes, runtime, RomFS, NACP e ícone |
| `npm run icon -w @boboforces/switch -- <png quadrado>` | gera `icon.jpg` (JPEG 256×256) para o HOME e o homebrew menu |
| `npm run eden -w @boboforces/switch` | cria `local/eden/eden-test.ini` (config de teste do Eden, sem tocar na sua) |

`apps/switch/romfs/` e `apps/switch/build/` são gerados e ficam fora do git, assim como `*.nro`, `*.nsp` e
`prod.keys`. Sem `icon.jpg` o pacote usa o ícone padrão do nx.js (o logotipo em blocos entra depois).

Os assets gerados em `build/assets/` (e a variante `build/assets-switch/`, que vence) vão para `romfs/assets/`.
O jogo pede assets por caminho lógico (`maps/construto.bfmap`), que vira `romfs:/assets/maps/construto.bfmap`.

## Instalar e abrir

- **NRO:** copie para `sdmc:/switch/boboforces/BoboForces.nro` e abra pelo homebrew menu **segurando R ao abrir um
  jogo** (application mode). Pelo álbum (applet) não há WebGL2 nem memória suficiente: o jogo mostra "Abra segurando R
  ou instale o NSP" e o `+` fecha.
- **NSP:** instale com o instalador de homebrew de sua preferência. Já abre em application mode pelo HOME, com ícone.
- **Eden:** abra o NRO; para testar com o teclado, use a config gerada por `npm run eden`. Para mirar e andar, um
  controle de verdade é melhor.

## No console

- Controle completo por jogador: par de Joy-Con, portátil ou Pro Controller (Joy-Con sozinho não é suportado).
- `+` pausa. O jogo cancela a saída do `+` (o nx.js fecharia o app); sair é só pelo menu.
- Dock ↔ portátil, controle desconectado e volta do HOME/sleep pausam o jogo e gravam o save.
- Arquivos em `sdmc:/switch/boboforces/`:
  - `save.json` e `save.backup.json` (o backup é o save anterior; um save corrompido abre pelo backup);
  - `runtime.log` e `runtime.old.log` (rotação em 1 MB): boot, erros e eventos do ciclo de vida. É o que mandar
    quando algo der errado;
  - `exportar/`: relatórios e backups exportados pelo jogo (pasta própria, para um export nunca sobrescrever o save
    nem o log);
  - `importar/`: para importar um backup, coloque o arquivo aqui; o jogo importa o mais recente.

## Para quem mexe no código

- `src/platform/` implementa a `Platform` sobre o nx.js. Os globais do nx.js passam por interfaces locais
  (`src/platform/nx.ts`), porque o `.d.ts` do `@nx.js/runtime` conflita com o lib DOM de que render e game precisam.
- `src/main.ts` sobe a casca, mostra o aviso sem GPU e chama `startGame`. Em `globalThis.BOBOFORCES_SWITCH` fica
  `{ shell, game, bootError }` para depuração (nxlink) e para o portcheck.
- **Contrato com o game:** no primeiro frame do menu, o game grava `[boot] menu-ready` com
  `platform.diagnostics.appendLog(...)`. O portcheck espera por essa linha no `runtime.log` falso, e no console ela
  mede o tempo do boot ao menu (meta: até 4 s).
- `scripts/` roda no Node com `.ts` direto: `bundle.ts` (build compartilhado com o portcheck), `stage.ts` (monta o
  package.json do NACP), `nro.ts`, `package-nsp.ts` (com o contorno do `buffer.slice` do MMM), `verify-*.ts`,
  `prepare-icon.ts` e `prepare-eden.ts`.
