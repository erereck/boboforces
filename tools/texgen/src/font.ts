/**
 * Fonte de pixel 3×5 do texgen: rótulos da folha de contato e, se uma receita precisar, números miúdos. Só caixa alta
 * (minúscula vira maiúscula); glifo desconhecido vira `?`. Os letreiros do cenário ("PERIGO", setores) têm glifos
 * maiores desenhados na própria receita (arte-ux.md §1.3: só pictogramas e palavras curtas de sinalização).
 */
export const FONT_WIDTH = 3;
export const FONT_HEIGHT = 5;
/** Avanço por caractere (glifo + 1 px de espaço). */
export const FONT_ADVANCE = FONT_WIDTH + 1;

const G: Readonly<Record<string, string>> = {
  A: '.#./#.#/###/#.#/#.#',
  B: '##./#.#/##./#.#/##.',
  C: '.##/#../#../#../.##',
  D: '##./#.#/#.#/#.#/##.',
  E: '###/#../##./#../###',
  F: '###/#../##./#../#..',
  G: '.##/#../#.#/#.#/.##',
  H: '#.#/#.#/###/#.#/#.#',
  I: '###/.#./.#./.#./###',
  J: '..#/..#/..#/#.#/.#.',
  K: '#.#/#.#/##./#.#/#.#',
  L: '#../#../#../#../###',
  M: '#.#/###/###/#.#/#.#',
  N: '##./#.#/#.#/#.#/#.#',
  O: '.#./#.#/#.#/#.#/.#.',
  P: '##./#.#/##./#../#..',
  Q: '.#./#.#/#.#/##./.##',
  R: '##./#.#/##./#.#/#.#',
  S: '.##/#../.#./..#/##.',
  T: '###/.#./.#./.#./.#.',
  U: '#.#/#.#/#.#/#.#/###',
  V: '#.#/#.#/#.#/#.#/.#.',
  W: '#.#/#.#/###/###/#.#',
  X: '#.#/#.#/.#./#.#/#.#',
  Y: '#.#/#.#/.#./.#./.#.',
  Z: '###/..#/.#./#../###',
  '0': '###/#.#/#.#/#.#/###',
  '1': '.#./##./.#./.#./###',
  '2': '##./..#/.#./#../###',
  '3': '##./..#/.#./..#/##.',
  '4': '#.#/#.#/###/..#/..#',
  '5': '###/#../##./..#/##.',
  '6': '.##/#../###/#.#/###',
  '7': '###/..#/.#./.#./.#.',
  '8': '###/#.#/###/#.#/###',
  '9': '###/#.#/###/..#/##.',
  _: '.../.../.../.../###',
  '-': '.../.../###/.../...',
  '+': '.../.#./###/.#./...',
  '#': '#.#/###/#.#/###/#.#',
  '.': '.../.../.../.../.#.',
  ':': '.../.#./.../.#./...',
  '/': '..#/..#/.#./#../#..',
  '×': '.../#.#/.#./#.#/...',
  '(': '.#./#../#../#../.#.',
  ')': '.#./..#/..#/..#/.#.',
  ' ': '.../.../.../.../...',
  '?': '##./..#/.#./.../.#.',
};

/** Linhas do glifo (`#` aceso), de cima para baixo. */
export function glyphRows(ch: string): readonly string[] {
  return (G[ch.toUpperCase()] ?? G['?']!).split('/');
}

/** Largura em px de um texto na fonte 3×5 (sem o espaço final). */
export function textWidth(text: string): number {
  return text.length === 0 ? 0 : text.length * FONT_ADVANCE - 1;
}

/** Chama `plot(x, y)` para cada pixel aceso do texto a partir de (x, y), canto de cima à esquerda. */
export function forEachTextPixel(text: string, x: number, y: number, plot: (px: number, py: number) => void): void {
  for (let i = 0; i < text.length; i++) {
    const rows = glyphRows(text[i]!);
    for (let gy = 0; gy < FONT_HEIGHT; gy++) {
      const row = rows[gy]!;
      for (let gx = 0; gx < FONT_WIDTH; gx++) if (row[gx] === '#') plot(x + i * FONT_ADVANCE + gx, y + gy);
    }
  }
}
