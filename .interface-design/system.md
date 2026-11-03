# BoboForces — sistema de interface

> Fonte da verdade dos tokens de UI (decisão #22; `docs/design/arte-ux.md` §6.2; `tecnico.md` §9). Os valores viram
> constantes em `packages/ui/src/tokens.ts`: mudou aqui, muda lá (e vice-versa). Status: M0, provisório até os prints
> do M1. A base é o sistema do futbobo (editorial escuro, cor escassa, Barlow Condensed), com identidade própria:
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

- **Barlow Condensed** (OFL, provisória até o print do M1): **ExtraBold 800** como `display` (títulos, botões,
  números grandes) e **SemiBold 600** como `hud` (leitura, rótulos, HUD). A escolha final entre as candidatas da
  arte-ux §6.2 é por print.
- Texto em **MSDF** gerado no build (`npm run fontbake`): um `TEXTURE_2D_ARRAY` com uma camada por fonte, Latin-1 +
  Latin Extended-A + pontuação tipográfica, kerning simples por pares. Sem fonte de sistema, sem `FontFace`.
- Caixa de texto = do **topo das maiúsculas** ao fim dos descendentes: alinha títulos e rótulos opticamente.
- Escala (px de referência; o piso de 22 vem da TV em 720p):

| Estilo | Fonte | Tamanho | Tracking | Caixa |
|---|---|---|---|---|
| `logo` | display | 136 | 0,01 em | alta |
| `title` | display | 64 | 0,02 em | alta |
| `heading` | display | 40 | 0,02 em | alta |
| `button` | display | 30 | 0,06 em | alta |
| `number` | display | 44 | 0 | — |
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
