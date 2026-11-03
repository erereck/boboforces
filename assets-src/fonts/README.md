# Fontes da UI (origem e licença)

Fontes OFL usadas pelo `tools/fontbake` para gerar o atlas MSDF da UI (`generated/`). O jogo leva só o atlas, nunca
estes arquivos. Fonte **provisória** do M0 (PLANO_M0): a escolha final é por print (GDD §9.1 #4).

| Arquivo | Fonte | Versão | Papel no jogo | SHA-256 |
|---|---|---|---|---|
| `BarlowCondensed-ExtraBold.woff2` | Barlow Condensed ExtraBold (800) | 1.408 | `display`: títulos, botões | `2515494e8cc2ca07c86ea78766cfa104b796aa6ed5d66821c01d51dbb0b52bce` |
| `BarlowCondensed-SemiBold.woff2` | Barlow Condensed SemiBold (600) | 1.408 | `hud`: leitura, rótulos, HUD | `215a93c696f442034a46fbb382958f753fda60e30490683aeea6b235fcbb2b66` |

- **Autoria e licença:** © 2017 The Barlow Project Authors (https://github.com/jpt/barlow), SIL Open Font License 1.1
  (`OFL.txt`, texto completo com o aviso de copyright). Sem Reserved Font Name.
- **De onde vieram (02/11/2026):** cópias dos WOFF2 que o futbobo já usa (`futbobo/public/fonts/`,
  `barlow-condensed-800.woff2` e `barlow-condensed-600.woff2`), só renomeadas. Os TTF oficiais do `google/fonts`
  (`ofl/barlowcondensed`) não foram baixados nesta etapa (download pede o OK do Erick).
- **Conversão WOFF2 → TTF:** feita em memória pelo próprio `tools/fontbake` (`src/woff2.ts`, só de build: Brotli do
  Node + reconstrução de `glyf`/`loca`). Nada convertido é versionado.
- **Cobertura:** estes WOFF2 são o subconjunto "latin" do Google Fonts: Latin-1 completo (todo o pt-BR), mas do
  Latin Extended-A só `ı Œ œ`. Os 125 códigos pedidos e ausentes ficam listados em `missing` no JSON gerado e caem no
  `?` na tela.

## Para fechar a cobertura do Latin Extended-A

1. Baixar `BarlowCondensed-ExtraBold.ttf` e `BarlowCondensed-SemiBold.ttf` de
   https://github.com/google/fonts/tree/main/ofl/barlowcondensed (com o OK do Erick).
2. Salvar aqui com esses nomes (o `fontbake` prefere `.ttf` a `.woff2` com o mesmo nome base) e atualizar a tabela.
3. Rodar `npm run fontbake` e conferir no relatório que `códigos ausentes` caiu para 0.

## Atlas gerado (integração do M0)

- **`display` só em caixa alta:** todos os estilos que usam a display (`logo`, `title`, `heading`, `button`) são
  caixa alta e o `number` só tem algarismos, então o `fontbake` pede a ela só os códigos sem minúscula
  (`codepointsForRole`). Minúscula na display cai no `?`; se um dia precisar, use a `hud` ou tire a display do filtro.
- **PNG em RGB:** MSDF não usa alfa, então o atlas sai como PNG RGB (o `decodePng` devolve RGBA com alfa 255).
- Resultado: 512×256×2, PNG de 134 KB (era 170 KB) e JSON de 35 KB cru / 7 KB comprimido. Com isso a carga inicial
  da web (HTML + JS + atlas) ficou em 338 KB, dentro dos 350 KB do tecnico.md §16.4.
