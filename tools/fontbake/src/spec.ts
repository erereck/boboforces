import type { FontRole } from '@boboforces/ui';

/**
 * Parâmetros do atlas da UI (decisão #54; desenho medido em local/desenho-escolhas/fontes). Mudou algo aqui? Rode
 * `npm run fontbake` e confira o total (PNG + JSON em gzip -4) contra o teto de 120 KB que o relatório imprime.
 */

/** Todas as camadas têm o mesmo tamanho (exigência do texture array). */
export const ATLAS = { width: 512, height: 256 } as const;

/** Teto de download das fontes (DECISOES, tabela técnica; lido como PNG + JSON em gzip, como o size-check). */
export const FONT_BUDGET_BYTES = 120_000;

/**
 * Nível do gzip que mede o JSON contra o teto: o mesmo `FONT_TEXT_GZIP_LEVEL` do size-check (tools/size-check/src/
 * budgets.ts). O gzip -9 do Node dá MENOS do que o GitHub Pages serve (+4,8% no JSON das fontes do M0); o nível 4 é um
 * limite de cima do que ele serve.
 */
export const FONT_JSON_GZIP_LEVEL = 4;

/**
 * Casas decimais das métricas do gerador. Sem essa opção o msdf-bmfont-xml 2.8.0 arredonda avanço e kerning para px
 * inteiros sem avisar (`undefined !== null` no `roundAllValue`) e metade dos pares de kerning some.
 */
export const ROUND_DECIMAL = 3;

/** Distância entre glifos no atlas, em px (além da margem do campo). */
export const TEXTURE_PADDING = 2;

export interface FontSpec {
  readonly role: FontRole;
  /** Caminho base em `assets-src/fonts/` (tenta `.ttf`, `.otf` e `.woff2`, nessa ordem); o OFL.txt fica na mesma pasta. */
  readonly file: string;
  /**
   * Nome do derivado gravado no JSON: sem o Reserved Font Name da fonte de origem (OFL 1.1, cláusula 3). Um nome só,
   * fixo; o fontbake reprova se ele contiver o RFN.
   */
  readonly name: string;
  /** Tamanho (em) de geração em px do atlas. */
  readonly size: number;
  /**
   * Faixa de distância em px. Nunca abaixo de 4 nem ímpar com este gerador: a margem do glifo é `faixa >> 1` e a caixa
   * é arredondada duas vezes (faixa 2 cortou de 22 a 36 glifos na borda).
   */
  readonly distanceRange: number;
  /** Bits por canal gravados no PNG (padrão 8). */
  readonly quantizeBits?: number;
  /**
   * Reserved Font Names declarados à mão, unidos aos que o fontbake lê do name ID 0 e do OFL.txt. Só é preciso quando
   * a família declara o RFN num formato que ele não lê (sem aspas): aí a guarda reprova até o nome vir aqui.
   */
  readonly reservedNames?: readonly string[];
}

/**
 * Fontes em uso (decisão #54), na ordem das camadas: Russo One (só caixa alta) na display, Saira Condensed SemiBold
 * no HUD, com a camada do HUD em 7 bits por canal. Reserva se o teto apertar: HUD em 6 bits (−5,9 KB medidos).
 */
export const FONTS: readonly FontSpec[] = [
  { role: 'display', file: 'russo-one/RussoOne-Regular', name: 'BoboForces Display', size: 22, distanceRange: 4 },
  {
    role: 'hud',
    file: 'saira-condensed/SairaCondensed-SemiBold',
    name: 'BoboForces HUD',
    size: 20,
    distanceRange: 4,
    quantizeBits: 7,
  },
];

/** Opções do msdf-bmfont-xml para uma fonte (uma página do tamanho de uma camada). */
export function generatorOptions(spec: FontSpec, charset: string): Record<string, unknown> {
  return {
    outputType: 'json',
    filename: spec.role,
    charset,
    fontSize: spec.size,
    distanceRange: spec.distanceRange,
    fieldType: 'msdf',
    textureSize: [ATLAS.width, ATLAS.height],
    texturePadding: TEXTURE_PADDING,
    smartSize: false,
    pot: true,
    roundDecimal: ROUND_DECIMAL,
  };
}
