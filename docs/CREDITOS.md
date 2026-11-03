# BoboForces: créditos e licenças

> **Status:** atualizado na integração do M0 (02/11/2026): three, fflate, nx.js e o gerador MSDF instalados com versão exata (ver `docs/DEPENDENCIAS.md`); a Barlow Condensed entrou como fonte **provisória** da UI; Trystero e áudio continuam planejados.
> - Cada entrada é conferida na versão fixada no M0: versão exata, sem `^`, registrada também em `docs/DEPENDENCIAS.md`.
> - Uma dependência só entra se o build do Switch passar no `portcheck` (regra de ouro 22, [`GDD.md`](GDD.md) §6.12).
> - O `licencas.txt` com os textos de licença exigidos (MIT e OFL pedem o aviso junto das cópias) é servido em `/boboforces/licencas.txt`. No M0 quem gera é o build da web (`apps/web/vite.config.ts`, plugin `licenseNotices`): cada pacote npm que entrou no bundle, com o LICENSE dele, mais a OFL da fonte; pacote sem arquivo de licença reprova o build.
> - No M2, o `tools/credits` assume: reprova o CI se uma dependência de produção ou um asset externo não tiver entrada aqui, embute o `licencas.txt` no romfs do Switch e a tela Ajustes › Sobre › Créditos passa a lê-lo.

## 1. O projeto

**BoboForces © EriLab (Erick). Todos os direitos reservados.**

- **Decisão #41:** repositório público, **sem licença aberta**. O código, os textos, as texturas, os modelos, as skins, os mapas, o logo e os sons sintetizados próprios têm todos os direitos reservados. Ver o código no GitHub não dá permissão para copiar, modificar ou redistribuir. Não existe arquivo `LICENSE` concedendo uso.
- **Assets gerados pelo Claude:** blocos, texturas pixel-art, modelos de caixas, skins e mapas são gerados por script pelo Claude (Anthropic) a pedido do Erick (decisão #13). Fazem parte do projeto e têm os mesmos direitos.
- O projeto é desenvolvido com ajuda do Claude (Anthropic).
- O jogo é gratuito e não comercial.

## 2. Bibliotecas que vão no jogo

| Item | Licença | Onde | Uso | Versão | Link |
|---|---|---|---|---|---|
| three.js | MIT | web e Switch | render, só `WebGLRenderer` (pacote `render`) | 0.187.0 | https://github.com/mrdoob/three.js |
| nx.js (runtime e pacotes de build) | MIT | só Switch | runtime JavaScript do Switch e geração de NRO/NSP | 1.0.0-beta.7 (fixada no M0; revisar no Teste Zero) | https://github.com/TooTallNate/nx.js |
| Dependências indiretas do nx.js usadas pelos scripts locais do Switch: `@nx.js/patch-nacp`, `@tootallnate/{hacbrewpack,nacp,romfs,nro,nca,aes-xts}`, `jimp` | MIT | só na máquina do Erick | empacotar e conferir NRO/NSP, ícone | versões do `package-lock.json` (ver `docs/DEPENDENCIAS.md`) | via `@nx.js/nro` e `@nx.js/nsp` |
| Trystero | MIT | só web | sinalização P2P por relays Nostr (online, M5) | a fixar no M5 | https://github.com/dmotz/trystero |
| fflate | MIT | web, Switch e ferramentas | deflate/inflate de mapas, códigos, backups e PNG | 0.8.3 | https://github.com/101arrowz/fflate |

## 3. Fontes (a escolher por print)

Duas fontes **SIL Open Font License 1.1** (OFL): uma display pesada para títulos e uma condensada para o HUD, até 120 KB no total. O jogo leva só o atlas MSDF gerado no build, com o aviso de copyright e a licença no `licencas.txt`.

| Papel | Candidatas | Licença | Escolhida |
|---|---|---|---|
| Display (títulos) | Russo One · Chakra Petch Bold | OFL 1.1 | a escolher |
| HUD (números, condensada) | Saira Condensed · Barlow Condensed SemiBold | OFL 1.1 | a escolher |

Ao escolher, registrar aqui: nome, versão, autor, link e cópia do `OFL.txt` da fonte. Nada de fontes da Microsoft (regra do novelo).

**Em uso no M0 (provisória, PLANO_M0):**

| Fonte | Versão | Papel | Autor | Licença | Link | Origem no repo |
|---|---|---|---|---|---|---|
| Barlow Condensed ExtraBold (800) | 1.408 | `display`: títulos e botões (só caixa alta no atlas) | © 2017 The Barlow Project Authors | OFL 1.1, sem Reserved Font Name | https://github.com/jpt/barlow | `assets-src/fonts/BarlowCondensed-ExtraBold.woff2` |
| Barlow Condensed SemiBold (600) | 1.408 | `hud`: leitura, rótulos e números do HUD | © 2017 The Barlow Project Authors | OFL 1.1, sem Reserved Font Name | https://github.com/jpt/barlow | `assets-src/fonts/BarlowCondensed-SemiBold.woff2` |

- O texto completo da licença está em `assets-src/fonts/OFL.txt`; origem, SHA-256 e cobertura em `assets-src/fonts/README.md`.
- O jogo leva só o atlas MSDF gerado (`ui-fonts.generated.png/json`, 134 KB + 7 KB comprimido), nunca os arquivos da
  fonte. O aviso e a OFL vão no `licencas.txt` do site desde o M0.

## 4. Áudio

| Item | Origem | Licença | Observação |
|---|---|---|---|
| Efeitos sonoros | Kenney (https://kenney.nl) e outros pacotes CC0 a escolher | CC0 1.0 | Crédito dado mesmo sem ser exigido (decisão #39). Registrar pacote, autor, link e arquivos usados. |
| Efeitos sintetizados em código | próprios | todos os direitos reservados | Gerados em JS no boot ou no build. |
| Música provisória | CC0 a escolher | CC0 1.0 | Provisória, trocada depois (decisão #38). Registrar faixa, autor e link. |

## 5. Ferramentas de desenvolvimento (não vão no jogo)

| Item | Licença |
|---|---|
| TypeScript | Apache-2.0 |
| Vite | MIT |
| esbuild | MIT |
| Vitest | MIT |
| playwright-core | Apache-2.0 |
| ESLint | MIT |
| Prettier | MIT |
| vite-plugin-pwa / Workbox | MIT |
| msdf-bmfont-xml 2.8.0 (gerador do atlas MSDF do `tools/fontbake`) | MIT |

Licenças a conferir na versão fixada.

## 6. Serviços externos (só web)

Não são código distribuído, mas ficam registrados aqui e no aviso de privacidade do online (M5).

| Serviço | Uso | Quando |
|---|---|---|
| GitHub Pages | Hospedagem em `erereck.github.io/boboforces` (decisão #40) | desde o M0 |
| Relays Nostr públicos | Só sinalização do P2P, via Trystero; a lista fica em `public/net.json` | M5 |
| STUN da Cloudflare (`stun.cloudflare.com`) | Atravessar NAT no P2P | M5 (protótipo) |
| TURN | A decidir antes de abrir o online: Cloudflare com Worker (exige conta do Erick) ou Open Relay de reserva | antes do M5 |

O jogo não coleta nenhum dado (decisão #42).

## 7. Referências e marcas

- **Inspirações de estilo e de jogo**, sem nenhum asset copiado: Block Strike, Pixel Gun 3D, Minecraft, Garry's Mod, Call of Duty Zombies, Counter-Strike, Big Paintball (Roblox), Crossy Road, Splatoon, Krunker.io, Left 4 Dead (o "AI Director"). As marcas pertencem aos seus donos.
- **Armas** sem marcas ou nomes comerciais reais (decisão #10). Nenhum asset com marca, bandeira ou exército real (decisão #19).
- **Glifos de botão genéricos**, sem logos de Nintendo, Xbox ou PlayStation.
- **Nintendo Switch** é marca da Nintendo. O build do Switch é homebrew para uso pessoal, não é publicado (decisão #33) e não tem afiliação com a Nintendo.

## 8. Como adicionar um item

1. Conferir a licença na versão exata que vai ser usada.
2. Adicionar a linha na tabela certa: nome, versão, licença, autor, link e onde é usado (web, Switch ou só ferramenta).
3. Se for dependência, registrar também em `docs/DEPENDENCIAS.md` e passar no `portcheck`.
4. Se a licença exigir aviso (MIT, OFL, Apache-2.0), conferir se o `tools/credits` incluiu o texto no `licencas.txt`.
