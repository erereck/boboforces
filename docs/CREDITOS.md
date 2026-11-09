# BoboForces: créditos e licenças

> **Status:** atualizado na fase 7d do M2 (09/11/2026): a música do menu na §4 ("Toy Soldiers", de Zane Little Music, CC0). Antes, na fase 7a do M2 (09/11/2026): os sons do jogo na §4 (33 arquivos de 3 pacotes CC0 da Kenney, com o Interface Sounds novo) e os efeitos sintetizados, sem dependência nova. Antes, no port do boneco do FutBobo (07/11/2026): entrada nova na §1 (pose, cabelo e pintura do boneco), sem dependência nova. Antes, nas escolhas dos prints do M1 (03/11/2026): fontes em uso Russo One + Saira Condensed (decisão #54; saem a Barlow provisória e a candidata Chakra Petch) e o `licencas.txt` também no romfs do Switch. Antes, na integração e nas medições do M1: fontes candidatas da #46 (só local) e os sons CC0 da Kenney do Teste Zero. Antes, na integração do M0 (02/11/2026): three, fflate, nx.js e o gerador MSDF instalados com versão exata (ver `docs/DEPENDENCIAS.md`); a Barlow Condensed entrou como fonte **provisória** da UI; Trystero e áudio continuam planejados.
> - Cada entrada é conferida na versão fixada no M0: versão exata, sem `^`, registrada também em `docs/DEPENDENCIAS.md`.
> - Uma dependência só entra se o build do Switch passar no `portcheck` (regra de ouro 22, [`GDD.md`](GDD.md) §6.12).
> - O `licencas.txt` com os textos de licença exigidos (MIT e OFL pedem o aviso junto das cópias) é servido em `/boboforces/licencas.txt`. Quem gera hoje: na web, o build (`apps/web/vite.config.ts`, plugin `licenseNotices`); no Switch, desde 03/11/2026, o `apps/switch/scripts/licenses.ts` (embutido no romfs). Os dois levam cada pacote npm que entrou no bundle, com o LICENSE dele, mais o `assets-src/fonts/generated/ui-fonts.licencas.txt` do fontbake (as fontes em uso, ver §3); o do Switch leva também o runtime do nx.js (MIT, que o empacotador acrescenta ao NRO/NSP sem passar pelo bundle) e o aviso da Geist Mono 1.700 (OFL 1.1, © 2024 The Geist Project Authors) que vem no RomFS do runtime. Pacote sem arquivo de licença ou arquivo das fontes faltando reprova o build. Ainda falta (para o `tools/credits` do M2): os avisos das bibliotecas que o runtime do nx.js embute (pacotes npm do runtime JS, como web-streams-polyfill, kleur e color-rgba; nativas como mbedtls, zlib, libpng, freetype, harfbuzz e libjpeg), que não vêm no pacote npm dele; o cabeçalho do `licencas.txt` do Switch diz isso.
> - No M2, o `tools/credits` assume: reprova o CI se uma dependência de produção ou um asset externo não tiver entrada aqui, gera o `licencas.txt` das duas cascas e a tela Ajustes › Sobre › Créditos passa a lê-lo.

## 1. O projeto

**BoboForces © EriLab (Erick). Todos os direitos reservados.**

- **Decisão #41:** repositório público, **sem licença aberta**. O código, os textos, as texturas, os modelos, as skins, os mapas, o logo e os sons sintetizados próprios têm todos os direitos reservados. Ver o código no GitHub não dá permissão para copiar, modificar ou redistribuir. Não existe arquivo `LICENSE` concedendo uso.
- **Assets gerados pelo Claude:** blocos, texturas pixel-art, modelos de caixas, skins e mapas são gerados por script pelo Claude (Anthropic) a pedido do Erick (decisão #13). Fazem parte do projeto e têm os mesmos direitos.
- **Boneco do FutBobo (EriLab):** pose, cabelo e pintura do boneco portados do FutBobo (EriLab). O FutBobo é do próprio Erick, então não é conteúdo de terceiros (regra 4 do `CLAUDE.md`) e os mesmos direitos reservados valem para o boneco (decisão #56). O port não trouxe dependência nem asset externo: a aparência é pintada em código no loading, o `portcheck` não mudou.
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

## 3. Fontes (decisão #54)

Duas fontes **SIL Open Font License 1.1** (OFL), escolhidas pelo Erick no print do M1: **Russo One** nos títulos e
**Saira Condensed** no HUD e nos textos de leitura (fecha a #46). O jogo leva só o atlas MSDF gerado no build
(`fonts/ui-fonts.{png,json}`), nunca os arquivos da fonte.

| Papel | Fonte de origem | Versão | Autor (copyright) | Licença | Reserved Font Name | Nome do derivado (atlas) | Link | Origem no repo |
|---|---|---|---|---|---|---|---|---|
| `display`: títulos e botões, só caixa alta | Russo One (Regular) | 1.001 | © 2011-2012 Jovanny Lemonad (jovanny.ru) | OFL 1.1 | "Russo" | **BoboForces Display** | https://github.com/google/fonts/tree/main/ofl/russoone | `assets-src/fonts/russo-one/` (TTF + `OFL.txt`) |
| `hud`: leitura, rótulos e números do HUD | Saira Condensed SemiBold (600) | 0.072 | © 2016 The Saira Project Authors (omnibus.type@gmail.com) | OFL 1.1 | "Saira" | **BoboForces HUD** | https://github.com/google/fonts/tree/main/ofl/sairacondensed | `assets-src/fonts/saira-condensed/` (TTF + `OFL.txt`) |

- **O atlas é uma versão modificada** pela definição da OFL (subconjunto de glifos + campo de distância), então segue
  sob OFL 1.1 e **não usa o Reserved Font Name** no nome principal: "BoboForces Display" e "BoboForces HUD" são nomes
  fixos, e o `tools/fontbake` reprova a geração se o nome derivado contiver um RFN declarado no name ID 0 da fonte ou no
  cabeçalho do `OFL.txt` (sem diferenciar caixa; aspas retas ou curvas, duplas ou simples). Se a fonte declara RFN num
  formato que ele não lê (sem aspas), a guarda falha fechada até o nome vir à mão em `FontSpec.reservedNames`. O JSON do atlas leva só `license: "OFL-1.1"` e `source` ("Russo One
  1.001", "Saira Condensed SemiBold 0.072"); o copyright fica no arquivo de licenças.
- **Aviso e licença em cada cópia (cláusula 2):** o fontbake grava `assets-src/fonts/generated/ui-fonts.licencas.txt`
  (uma seção por fonte em uso: "== BoboForces Display: atlas MSDF derivado de Russo One 1.001 (SIL OFL 1.1) ==" + o
  `OFL.txt` da família na íntegra). A web (`apps/web/vite.config.ts`) e o Switch (`apps/switch/scripts/licenses.ts`)
  juntam esse arquivo no `licencas.txt`, com a exceção OFL de `fonts/ui-fonts.*` no cabeçalho; o build reprova se ele
  faltar.
- **Crédito (cláusula 4):** dizer de onde veio ("derivada de Russo One 1.001") só aqui, no `licencas.txt`, no campo
  `source` e na folha das fontes em uso (`drawFontSpecimen`, tela de depuração dos prints); nunca em divulgação.
- Fonte dos arquivos: google/fonts, commit `2fe1e8c6`; SHA-256 e bytes no `assets-src/fonts/README.md`. Os TTF ficam
  sem modificação (a OFL permite redistribuir junto da licença) e não vão no build.
- Tamanho baixado do atlas: PNG 111.895 B + JSON 7.710 B em gzip -4 = **119.605 B**, sob o teto de 120 KB (lido como
  bytes baixados, com o JSON medido pelo limite de cima do que o GitHub Pages serve; decisão menor revisável em
  `arte-ux.md` §6.2/§13 e `tecnico.md` §9/§16.4).
- Nada de fontes da Microsoft nem de sistema (regra do novelo).

**Saíram (03/11/2026):**

- **Barlow Condensed** ExtraBold e SemiBold 1.408 (© 2017 The Barlow Project Authors, OFL 1.1, sem RFN;
  https://github.com/jpt/barlow), a dupla **provisória** do M0 (atlas de 134 KB + 7 KB). Os WOFF2 e o `OFL.txt` da
  raiz de `assets-src/fonts/` saíram depois de o `licencas.txt` ler o arquivo novo; continuam no commit do M0.
- **Chakra Petch** Bold e SemiBold 1.000 (© 2018 The Chakra Petch Project Authors, OFL 1.1), candidata da #46 não
  escolhida, e o atlas local das candidatas (`fontes-candidatas.generated.*`, que nunca entrou no git nem no build).

## 4. Áudio

| Item | Origem | Licença | Observação |
|---|---|---|---|
| Efeitos sonoros | Kenney (https://kenney.nl) e outros pacotes CC0 a escolher | CC0 1.0 | Crédito dado mesmo sem ser exigido (decisão #39). Registrar pacote, autor, link e arquivos usados. |
| Sons do teste de áudio do Teste Zero (M1) | **Impact Sounds 1.0** (19/12/2019) e **Sci-Fi Sounds 1.0** (11/10/2020), criados e distribuídos por Kenney (www.kenney.nl) (decisão #47) | CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/) | Arquivos usados: `kenney-sci-fi-sounds/explosionCrunch_000.ogg` → `t0-tiro.mp3`; `kenney-impact-sounds/impactMetal_medium_000.ogg` → `t0-impacto.mp3`; `kenney-impact-sounds/footstep_concrete_000.ogg` → `t0-passo.mp3`; `kenney-impact-sounds/impactGeneric_light_000.ogg` → `t0-ui.mp3`. Originais e o `License.txt` de cada pacote em `assets-src/audio/source/`; convertidos para MP3 mono (44,1 kHz, 96 kbps, 14,7 KB no total) pelo `tools/audioconv` (tabela em `assets-src/audio/sounds.json`). Só o teste de áudio do Teste Zero usa (web e NRO). |
| Sons do jogo (M2, fase 7a) | **Impact Sounds 1.0** (19/12/2019), **Sci-Fi Sounds 1.0** (11/10/2020) e **Interface Sounds 1.0** (11/02/2020), criados e distribuídos por Kenney (www.kenney.nl); baixados de novo em 09/11/2026 com o OK do Erick (os dois primeiros com o mesmo SHA-256 do M1; o Interface Sounds, 834.536 bytes, SHA-256 `f2193d07…81232`) (decisões #39 e #63) | CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/) | Impact Sounds: `impactSoft_heavy_000.ogg` → `dano.mp3`; `impactPunch_heavy_000.ogg` → `morte.mp3`; `impactMetal_light_001.ogg` → `recarga-tira.mp3`; `impactMetal_medium_001.ogg` → `recarga-poe.mp3`; `impactTin_medium_000.ogg` → `granada-quica.mp3`; `impactPunch_medium_001.ogg` → `faca-acerto.mp3`; `impactGeneric_light_001.ogg` → `impacto-concreto.mp3`; `impactMetal_light_000.ogg` → `impacto-metal.mp3`; `impactWood_light_000.ogg` → `impacto-madeira.mp3`; `impactGlass_light_000.ogg` → `impacto-vidro.mp3`; `impactSoft_medium_000.ogg` → `impacto-macio.mp3`; `impactPunch_medium_000.ogg` → `impacto-bobo.mp3`; `footstep_concrete_000.ogg` → `passo-concreto-1.mp3`; `footstep_concrete_001.ogg` → `passo-concreto-2.mp3`; `impactPlate_light_000.ogg` → `passo-metal.mp3`; `footstep_wood_000.ogg` → `passo-madeira.mp3`; `footstep_grass_000.ogg` → `passo-grama.mp3`; `footstep_carpet_000.ogg` → `passo-tecido.mp3`; `footstep_carpet_001.ogg` → `pulo.mp3`; `impactSoft_medium_001.ogg` → `pouso.mp3`. Sci-Fi Sounds: `explosionCrunch_000.ogg` → `explosao.mp3`; `lowFrequency_explosion_001.ogg` → `explosao-longe.mp3`. Interface Sounds: `select_002.ogg` → `ui-mover.mp3`; `confirmation_001.ogg` → `ui-confirmar.mp3`; `back_002.ogg` → `ui-voltar.mp3`; `switch_002.ogg` → `ui-trocar.mp3`; `error_004.ogg` → `ui-erro.mp3`; `pluck_001.ogg` → `hitmarker.mp3`; `glass_002.ogg` → `abate.mp3`; `click_002.ogg` → `sem-municao.mp3`; `switch_005.ogg` → `troca-arma.mp3`; `toggle_004.ogg` → `granada-pino.mp3`; `maximize_009.ogg` → `municao.mp3`. Originais e o `License.txt` de cada pacote em `assets-src/audio/source/`; convertidos para MP3 mono (44,1 kHz, 96 kbps, 83 KB no total) pelo `tools/audioconv` (tabela em `assets-src/audio/sounds.json`). |
| Efeitos sintetizados em código | próprios | todos os direitos reservados | Gerados em JS no carregamento da partida (`packages/audio/src/synth-game.ts`, fase 7a do M2): os tiros das 5 armas de fogo (perto e longe), o foguete, a faca, o "PLOC" do headshot, os bipes da contagem, o coração da vida baixa, as vinhetas de vitória e derrota e o deslize. Também os 2 do Teste Zero (`synth.ts`). |
| Música do menu (provisória, #38) | **"Toy Soldiers"**, de **Zane Little Music** (OpenGameArt, 07/08/2023: https://opengameart.org/content/toy-soldiers); baixada em 09/11/2026 com o OK do Erick (`toy_soldiers_0.mp3`, 6.173.676 bytes, SHA-256 `34eb762b…22c79c4`) (decisões #38 e #63) | CC0 1.0 | Usado: 48 compassos a 135 BPM a partir de 40,042 s (até 125,376 s), com a emenda em crossfade linear de 0,1 s, em loop. Convertido para MP3 estéreo (44,1 kHz, 96 kbps, 1,0 MB) pelo `tools/audioconv --musica` (tabela em `assets-src/audio/music.json`), com o manifesto `loop@1` ao lado. O original fica fora do git (`local/audio-originais/`, 6,2 MB e provisório). Carrega só depois do menu. |

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
| @breezystack/lamejs 1.2.7 (codificador MP3 do `tools/audioconv`, fork ESM do lamejs, porte em JS do LAME; https://github.com/shijinyu/lamejs) | LGPL-3.0 (só ferramenta local; não vai no jogo) |

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
