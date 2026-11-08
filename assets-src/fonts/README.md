# Fontes da UI (origem e licença)

Fontes OFL usadas pelo `tools/fontbake` para gerar o atlas MSDF da UI (`generated/`). O jogo leva só o atlas, nunca
estes arquivos. Escolha do Erick no print do M1: **decisão #54** (fecha a #46).

## Em uso (#54): `fonts/ui-fonts.{png,json}`, no preload do menu

| Arquivo | Fonte de origem | Versão | Papel no jogo | Nome do derivado (atlas) | Bytes | SHA-256 |
|---|---|---|---|---|---|---|
| `russo-one/RussoOne-Regular.ttf` | Russo One | 1.001 | `display`: títulos e botões, só caixa alta | **BoboForces Display** | 39.124 | `bc0abcc660bd8b7ad3000ecb2898a27c58a29a50f7ec81652fa12e75148d09df` |
| `russo-one/OFL.txt` | licença | — | — | — | 4.390 | `3ac1301549523d9861fedca12871f24e575fbd26d520632fc00ba849b471d275` |
| `saira-condensed/SairaCondensed-SemiBold.ttf` | Saira Condensed SemiBold (600) | 0.072 | `hud`: leitura, rótulos e números do HUD | **BoboForces HUD** | 96.028 | `30f8ed4d078211003a9715c80c51ce031bab5c9a17e8771182e4c4599205634b` |
| `saira-condensed/OFL.txt` | licença | — | — | — | 4.403 | `0e2ccc5da1dd979f08ba82bca2fb61592506a1e58d3cbfc26d904f0db71bd812` |

- **De onde vieram (03/11/2026):** repositório **github.com/google/fonts**, commit
  `2fe1e8c6b137fb13041a7cfca6fdcd8a910ea4dc`, pastas `ofl/russoone` e `ofl/sairacondensed`, pelo endereço
  `https://raw.githubusercontent.com/google/fonts/<commit>/ofl/<pasta>/<arquivo>`. Cada família fica numa subpasta
  com o `OFL.txt` dela (texto completo da licença, que já começa com o aviso de copyright).
- **Autoria e licença (SIL OFL 1.1):**
  - Russo One: © 2011-2012 Jovanny Lemonad (jovanny.ru), **com Reserved Font Name "Russo"**.
  - Saira Condensed: © 2016 The Saira Project Authors (omnibus.type@gmail.com), **com Reserved Font Name "Saira"**.

## O atlas é OFL e pode ir para o repositório e para o build

O atlas MSDF é uma **versão modificada** pela definição da OFL (subconjunto de glifos + campo de distância). O que a
licença pede e onde está:

- **Cláusula 2 (aviso e licença em cada cópia):** o fontbake grava `generated/ui-fonts.licencas.txt`, uma seção por
  fonte em uso ("== BoboForces Display: atlas MSDF derivado de Russo One 1.001 (SIL OFL 1.1) ==" + o `OFL.txt` da
  família na íntegra). A casca junta esse arquivo no `licencas.txt` do build (web) e no romfs (Switch).
- **Cláusula 3 (Reserved Font Name):** o nome principal do derivado não usa o RFN. O `name` do JSON é um nome fixo
  ("BoboForces Display" / "BoboForces HUD"), e o fontbake **reprova** a geração se ele contiver algum RFN declarado
  no name ID 0 da fonte ou no cabeçalho do `OFL.txt`, sem diferenciar caixa (a Saira escreve "reserved font name" em
  minúsculas). O RFN restringe o nome, não a distribuição.
- **Cláusula 4 (crédito):** dizer de onde veio ("derivada de Russo One 1.001") só nos créditos, no `licencas.txt` e
  no campo `source` do JSON; nunca em material de divulgação.
- **Cláusula 5:** o atlas continua sob OFL 1.1. O JSON leva só `license: "OFL-1.1"` e `source` (família e versão de
  origem); o copyright fica no arquivo de licenças.

## Parâmetros de geração (`tools/fontbake/src/spec.ts`)

- Camada de 512×256 por fonte (texture array de 2 camadas), faixa MSDF de 4 px nas duas (nunca abaixo de 4 nem ímpar
  com este gerador: a margem é `faixa >> 1` e a caixa é arredondada duas vezes).
- **Display:** Russo One a **22 px**, só caixa alta: ASCII sem minúsculas, À–Þ, `¡ ª « ° · º » ¿`, espaço sem quebra e
  a pontuação extra (`– — ‘ ’ “ ” • … €`): **118 glifos**. Símbolos como `© ® ± ² ¼` ficam só no HUD.
- **HUD:** Saira Condensed SemiBold a **20 px**, Latin-1 inteiro + a pontuação extra, sem Latin Extended-A: **200
  glifos**. Camada gravada em **7 bits por canal** (determinística, com replicação de bits; erro ≤ 1/255).
- `roundDecimal: 3` no gerador (sem ele o msdf-bmfont-xml arredonda avanço e kerning para px inteiros sem avisar).
- Altura de maiúscula e altura-x do **OS/2** (Russo 0,700/0,530 em; Saira 0,688/0,510 em); `lineHeight` = base +
  a descida medida nos glifos entregues (a Saira declara 0,439 em no hhea; os glifos Latin-1 descem 0,20 em).

## Medidas (`npm run fontbake`, 03/11/2026, cerca de 6 s)

| | Display | HUD | Atlas |
|---|---|---|---|
| Glifos / ausentes | 118 / 0 | 200 / 0 | |
| Pares de kerning (≥ 0,25 px) | 709 | 411 | 1.120 |
| Maiúscula / linha / base (px do atlas) | 15,4 / 25,372 / 20,372 | 13,76 / 26,7 / 22,7 | |
| Camada sozinha (PNG) | 50,4 KB | 61,6 KB | |
| PNG | | | 111.895 B |
| JSON (cru / gzip -4 / gzip -9) | | | 37.550 B / 7.710 B / 6.916 B |
| **Download (PNG + JSON gzip -4)** | | | **119.605 B = 119,6 KB** (teto 120 KB, folga 395 B) |

- SHA-256 nesta máquina: PNG `f601669b9781819b5d91133d5d879c3e4777bf477d9957dba70c4c4d37c3063a`, JSON
  `6e228b3458ceabf37efd02f07bfeead7e5a27ea80454663448521b2ac0eecd00` (duas gerações seguidas, mesmo SHA; o PNG não
  mudou com o limiar novo do kerning). O msdfgen é
  binário nativo: o SHA do PNG pode mudar em outra máquina.
- O teto de 120 KB (DECISOES, tabela técnica) é lido como **bytes baixados do atlas** (PNG cru + JSON em gzip, o
  critério do size-check); decisão menor revisável. O JSON é medido no gzip **nível 4**, um limite de cima do que o
  GitHub Pages serve: ele não usa gzip -9 (em 03/11/2026 serviu o JSON das fontes do M0 com 6.951 B, +4,8% sobre os
  6.635 B do nível 9; o nível 4 dá 7.308 B). Com o gzip -9 a folga parecia 511 B e no host ficaria entre −50 e +150 B;
  por isso o kerning passou a começar em 0,25 px (era 0,2: saem 237 pares do HUD abaixo de 1/80 de em, o PNG não
  muda) e a folga calibrada é de 395 B. Os TTF somam 135,2 KB, mas não vão no build. Reserva se apertar:
  HUD em 6 bits (−5,9 KB medidos no desenho).
- Glifos encostando na borda da caixa do atlas: 0 cortados; no limite, `º Î` na display e `{` no HUD.

## Saíram (integração, 03/11/2026)

`BarlowCondensed-ExtraBold.woff2`, `BarlowCondensed-SemiBold.woff2` e o `OFL.txt` da raiz (Barlow Condensed 1.408,
© 2017 The Barlow Project Authors, OFL 1.1, a combinação provisória do M0) e a pasta `chakra-petch/` (candidata da #46
não escolhida) saíram de `assets-src/fonts/` depois de o `licencas.txt` da web e o do romfs passarem a ler
`generated/ui-fonts.licencas.txt`. Ficaram guardadas em `local/fontes-saidas/` (privado, fora do git); a Barlow
continua no commit do M0. O atlas local das candidatas (`fontes-candidatas.generated.*`) também saiu.
