# BoboForces — sistema de interface

> Fonte da verdade dos tokens de UI (decisão #22; `docs/design/arte-ux.md` §6.2; `tecnico.md` §9). Os valores viram
> constantes em `packages/ui/src/tokens.ts`: mudou aqui, muda lá (e vice-versa). Status: M1 (HUD, F2, loading e telas
> de teste desenhados), com as escolhas dos prints do M1 (decisões #50–#54; fontes da #54). A base é o sistema do futbobo (editorial escuro, cor escassa, tipografia condensada), com identidade própria:
> militar cartunesco, de brinquedo.

## Direção

**Painel de comando de um quartel de brinquedo.** O mundo do jogo é colorido, ensolarado e blocado; a interface é
escura, contida e séria, para nunca competir com ele. A graça fica no conteúdo (nomes bobos, prêmios, bots), não no
cromo da UI.

- Pessoa: alguém no sofá com controle, no PC com mouse ou no celular deitado; muitas vezes 2 a 4 pessoas olhando a
  mesma TV.
- Verbo principal: escolher e entrar na partida rápido. Cada tela tem uma ação óbvia, sempre focada ao abrir.
- Sensação: placa de identificação de equipamento, estêncil, fita de segurança, caixa de munição de plástico.
- Tudo desenhado pelo jogo em WebGL, igual na web e no Switch (decisão #3). Todo fluxo funciona só com D-pad +
  confirmar/voltar; mouse e toque usam o mesmo foco (`hitTest`).
- Composição à esquerda no título e nos menus: a direita fica livre para o fundo vitrine 3D do M1 (arte-ux §5.6).

## Assinaturas

- **Chanfro de 45° no canto superior direito** de cards, botões e barras de destaque, como placa militar. Nunca cantos
  arredondados.
- **Faixa zebrada diagonal** (âmbar ou perigo sobre escuro) só em avisos e no botão de sair da partida (variante
  `danger`).
- **Barra âmbar sob o título** de cada tela (a "fita" da placa de teste do Construto).
- **Rótulos de seção em caixa alta condensada** com espaçamento largo (estilo `label`).
- O logotipo em blocos (M1+, `tools/logo`) é o único elemento pixel-art da interface. No M0 o título é texto MSDF.
- Ícones: pictogramas de traço reto, sem marcas (glifos de botão genéricos, arte-ux §6.11).

## Tokens

### Cor (0xRRGGBBAA no código; `rgba(hex, alfa)`)

| Token | Hex | Uso |
|---|---|---|
| `bunker` | `#0A0D0B` | fundo das telas (nível 0) |
| `chapa` | `#121815` | cards, painéis, botão secundário (nível 1) |
| `chapaAlta` | `#1A221D` | elevado, botão focado (nível 2) |
| `chapaTopo` | `#222C25` | modais e popovers (nível 3) |
| `linha` | `#2A352E` | bordas de 1 px, divisórias |
| `linhaForte` | `#3B4A40` | borda do botão secundário e de campos |
| `texto` | `#E8EDE6` | texto principal |
| `textoBaixo` | `#9DA89F` | texto secundário, rodapé |
| `textoSobreAcao` | `#14110A` | texto sobre âmbar |
| `acao` | `#F2B233` | ação principal focada, foco, seleção |
| `acaoForte` | `#D99A1E` | ação principal em repouso / pressionada |
| `perigo` | `#EF5B4C` | vida baixa, avisos, sair |
| `ok` | `#6FCF7A` | confirmação, pronto |
| `hudFundo` | `#0A0D0B` a 70% | plaquinhas do HUD |
| `veu` | `#050706` a 72% | véu atrás de modais e da pausa |
| Times A–D | `#FF7A1A` ▲ · `#2E8BFF` ● · `#3DDC97` ■ · `#A66BFF` ◆ | sempre com o ícone |
| P1–P4 | `#FFD23F` · `#3FE0FF` · `#FF6FB5` · `#B8F03C` | jogadores locais |

Cor é escassa: o âmbar diz "o que fazer agora"; verde, vermelho e as cores de time são semânticas. Profundidade só por
troca de superfície (níveis 0 a 3) e bordas de 1 px; sem sombra, brilho ou gradiente (custa fill rate no Switch e não
combina com a direção).

### Espaço e escala

- Espaço lógico de **1280×720 px de referência**; escala `min(w/1280, h/720) × tamanho escolhido`, por viewport.
- Unidade 4: `xs 4 · sm 8 · md 16 · lg 24 · xl 32 · xxl 48`.
- Margem da tela: 64 (lados) × 40 (topo e base), somada à safe area (vale a maior por lado). Cobre os 5% de TV.
- Alvo focável: altura de botão 60; no toque, mínimo de **44 px de layout** (× pixelRatio) por cima disso.
- Pisos de texto depois da escala (arte-ux §6.8), passados pelo `game` em `minTextPx`: celular 13 px de layout,
  TV/Switch na dock 22, Switch portátil 18, Switch 3–4 jogadores 16.
- Chanfro: card 12, botão 14. Contorno de foco: 3 de espessura a 4 da borda (mínimo de 2 px reais).

## Tipografia

- **Russo One** (OFL 1.1) como `display` (títulos e botões, só caixa alta) e **Saira Condensed SemiBold 600** como
  `hud` (leitura, rótulos e os números do HUD), escolhidas no print (decisão #54, fecha a #46). No atlas os nomes são
  derivados, sem o Reserved Font Name: "BoboForces Display" e "BoboForces HUD" (`assets-src/fonts/README.md`).
- Texto em **MSDF** gerado no build (`npm run fontbake`): um `TEXTURE_2D_ARRAY` com uma camada por fonte (512×256,
  faixa 4), kerning simples por pares. Glifos: display só em caixa alta (ASCII sem minúsculas, À–Þ, ¡ª«°·º»¿, NBSP e
  extras: 118); hud com Latin-1 + extras (200), camada em 7 bits por canal. O Latin Extended-A saiu (o atlas passava
  dos 120 KB). Altura de maiúscula e de x do OS/2; a linha = base + a descida medida nos glifos. Sem fonte de sistema,
  sem `FontFace`. Teto: 120 KB baixados (PNG + JSON em gzip; medido 119,5 KB).
- Caixa de texto = do **topo das maiúsculas** ao fim dos descendentes: alinha títulos e rótulos opticamente.
- Escala (px de referência; o piso de 22 vem da TV em 720p):

| Estilo | Fonte | Tamanho | Tracking | Caixa |
|---|---|---|---|---|
| `logo` | display | 136 | 0,01 em | alta |
| `title` | display | 64 | 0,02 em | alta |
| `heading` | display | 40 | 0,02 em | alta |
| `button` | display | 30 | 0,06 em | alta |
| `number` | hud | 44 | 0 | — |
| `body` | hud | 26 | 0 | — |
| `label` | hud | 22 | 0,14 em | alta |
| `caption` | hud | 22 | 0,02 em | — |

- Hierarquia por peso e cor antes de tamanho. Botão com até 3 palavras; título com até 7 (arte-ux §6.9).
- Todo texto sai de `packages/ui/src/strings.pt-BR.ts` (`t(chave, params)`); números sem `Intl` (`formatInt`).

## Movimento

- Entradas curtas e secas: 120 a 180 ms, ease-out, deslizando 8 px. Nada de mola.
- HUD sem animação além do pulso de dano. "Reduzir efeitos" desliga tudo que não é informação.
- M0: sem animação (o foco troca na hora).

## Componentes

- **Botão** — altura 60 (≥ alvo mínimo), largura mínima 240, padding horizontal 28, rótulo `button` centrado pela
  altura das maiúsculas, chanfro 14.
  - `primary`: fundo `acaoForte`, `acao` quando focado; texto `textoSobreAcao`. Um por tela.
  - `secondary`: fundo `chapa` (`chapaAlta` focado), borda 2 `linhaForte`, texto `texto`.
  - `danger`: fundo `chapa`, faixa zebrada `perigo` a 16% (28% focado), borda `perigo`.
  - desabilitado: `chapa`, borda `linha`, texto `textoBaixo`; não recebe foco.
  - **Foco**: um contorno externo âmbar paralelo ao chanfro. Um sinal só, nunca dois.
- **Barra de título** — 176×10 (título da tela de abertura) ou 120×8 (telas), `acao`, chanfro de card.
- **Card/painel** — `box` com `color: chapa`, `chamfer`, borda opcional `linha`.
- **Rodapé** — `caption` em `textoBaixo`: crédito "um jogo bobo da EriLab" à esquerda, versão e codinome à direita.

## Implementação (M0)

- `packages/ui`: árvore (`box`, `row`, `column`, `text`, `button`, `sprite`) → `layoutTree` (âncoras, linhas,
  colunas, safe area, alvos e pisos) → `drawTree` (DrawList, sem alocar por frame); foco com `moveFocus`,
  `navigateMenu` e `hitTest`.
- Forma dos retângulos (chanfro, contorno, faixa) vai na própria DrawList (`pushShape`) e é desenhada por SDF no
  programa de UI: retângulos, sprites e glifos num draw call por viewport (`packages/render/src/ui`).
- Telas do M0: título (BOBOFORCES, JOGAR, Ajustes, rodapé) e Ajustes (placeholder com Voltar).

## HUD (M1, `packages/ui/src/screens/hud.ts`)

- **Referência de 640×360 POR VISTA** (uma vista cheia em 1280×720 tem escala 2). Medidas em `HUD_METRICS`; texto no
  piso da vista (`minTextPx`: TV 22, 3–4P 16, portátil 18, celular 13) e números críticos no piso × 1,375 (22 no
  3–4P, 30 na TV).
- **Plaquinhas** `hudFundo` com o chanfro de 5 px de referência; nada de sombra. Números sempre na `hud` (condensada).
- Alto à esquerda: ícone + `P1–P4` na cor do jogador (2–4P), `ABATES n` e `MORTES n` (as mortes saem se a plaquinha
  passar de 36% da largura: o meio do alto é do placar). Embaixo à esquerda: `VIDA`, número e barra (`ok`; `perigo`
  em ≤ 35%). Embaixo à direita: pente `/` reserva (pente vazio em `perigo`).
- **3–4P compacto:** vida só com número e barra fina, munição só com o pente, sem mortes.
- **Retícula** de 4 braços com sombra de 1 px, que abre com o spread; **hitmarker em X de "pixels"** (branco no
  corpo, âmbar na cabeça). Morto: plaquinha "RENASCENDO…" com a contagem em âmbar.
- **Dano direcional:** barra `perigo` na borda da área útil, na direção do tiro (ângulo positivo = à esquerda).
- **2–4P:** borda de 3 px de referência na cor do jogador, por dentro da vista.
- **Placar e tempo** (`drawHudShared`): 1P no alto ao centro; 2P cima/baixo e 4P no cruzamento central (as vistas
  reservam folga na borda interna); 3P no 4º quadrante, em dobro sobre `bunker`. Times com ícone ▲ ● ■ ◆ e cor; o
  relógio `m:ss` vem da tabela e fica `perigo` nos últimos 10 s.
- **Ícones** ▲ ● ■ ◆ em "pixels" de 7×7 (`paintIcon`), a mesma linguagem blocada do jogo.

## Painel F2, loading e telas de teste (M1)

- **F2** (`drawDebugPanel`): canto superior esquerdo, `chapaTopo` a 92%, título âmbar, rótulos `textoBaixo`, valores
  `texto` (números sem `Intl`, desconhecido = "—"); programas acima de 7 em `perigo`. 16 px de referência, piso de
  12 px (é ferramenta).
- **Loading** (`drawLoadingScreen`): composição à esquerda como os menus: rótulo CARREGANDO, nome do mapa em `title`,
  barra total âmbar com a porcentagem e uma linha por etapa (concluída: ms em `ok`; em andamento: barra âmbar; na fila:
  `textoBaixo`). Dica de 1 linha no rodapé.
- **Testes do Switch** (`drawTestScreen`): título + fita âmbar; linhas com **selo de status** (OK `ok`, FALHA `perigo`,
  AGUARDA `acao`, INFO neutro com borda), vaga `P1–P4` opcional, rótulo e dado técnico em `textoBaixo`; em até 3
  colunas quando não cabem; dica no rodapé.
- **Título com testes** (`TITLE_TESTS`): até 4 itens, coluna única de 330 px à direita; com mais (o Switch tem 9),
  grade de 2 colunas de 330 px embaixo à direita, 44 px acima da versão, sem cruzar logo, botões nem rodapé. Botões
  secundários de 48 de altura com as chaves curtas `test.item.*`; JOGAR segue com o foco inicial e o D-pad alcança
  todos os itens.
- **Loading:** o nome do mapa encolhe para caber na largura útil (`fitTextPx`), sem descer do piso de leitura.

## Folha das fontes em uso (decisão #54)

- `drawFontSpecimen(out, fonts, w, h)` (gancho dos prints `showFontSpecimen`), no lugar da comparação das candidatas
  da #46: cabeçalho com a origem de cada fonte (chave `fontSpecimen.source`: "{name}: derivada de {source}
  ({license})"), logotipo em texto, um título com acentos, os botões, um HUD de amostra (1P), texto corrido e os
  algarismos. Usa o atlas `ui-fonts` de sempre; cabe de 640×360 a 1920×1080 (teste com o atlas real).
