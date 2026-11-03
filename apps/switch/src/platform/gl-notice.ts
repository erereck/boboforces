/**
 * Aviso de falha desenhado pelo próprio WebGL2, para quando o boot falha COM GPU. Nesse caso o `screen` já entregou o
 * contexto WebGL2, e no nx.js cada canvas aceita um tipo de contexto só (docs/pesquisa/nxjs-switch.md): o aviso em
 * Canvas 2D não sai e a tela ficaria preta. Sem shader, buffer nem textura (o que falhou pode ter sido justamente o
 * render): fundo de erro e texto numa fonte bitmap 5×7 desenhada com `scissor` + `clear`, só núcleo do WebGL2.
 *
 * A fonte é mínima: maiúsculas sem acento, dígitos e a pontuação dos avisos. O texto continua vindo da tabela pt-BR;
 * aqui ele só vira caixa alta e perde o acento (`ã` → `A`). Caractere sem desenho vira `?`.
 */

/** O pedaço do WebGL2 que o aviso usa (o contexto do nx.js, ou um falso nos testes). */
export interface NoticeGl {
  bindFramebuffer(target: number, framebuffer: null): void;
  viewport(x: number, y: number, width: number, height: number): void;
  colorMask(r: boolean, g: boolean, b: boolean, a: boolean): void;
  enable(cap: number): void;
  disable(cap: number): void;
  scissor(x: number, y: number, width: number, height: number): void;
  clearColor(r: number, g: number, b: number, a: number): void;
  clear(mask: number): void;
}

const GL_FRAMEBUFFER = 0x8d40;
const GL_SCISSOR_TEST = 0x0c11;
const GL_COLOR_BUFFER_BIT = 0x4000;

const GLYPH_W = 5;
const GLYPH_H = 7;

/** Fonte 5×7: uma linha por glyph, 7 linhas de 5 colunas (`#` aceso). */
const FONT_SOURCE: Readonly<Record<string, string>> = {
  A: '.###. #...# #...# ##### #...# #...# #...#',
  B: '####. #...# #...# ####. #...# #...# ####.',
  C: '.###. #...# #.... #.... #.... #...# .###.',
  D: '####. #...# #...# #...# #...# #...# ####.',
  E: '##### #.... #.... ####. #.... #.... #####',
  F: '##### #.... #.... ####. #.... #.... #....',
  G: '.###. #...# #.... #.### #...# #...# .####',
  H: '#...# #...# #...# ##### #...# #...# #...#',
  I: '.###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
  J: '..### ...#. ...#. ...#. ...#. #..#. .##..',
  K: '#...# #..#. #.#.. ##... #.#.. #..#. #...#',
  L: '#.... #.... #.... #.... #.... #.... #####',
  M: '#...# ##.## #.#.# #.#.# #...# #...# #...#',
  N: '#...# #...# ##..# #.#.# #..## #...# #...#',
  O: '.###. #...# #...# #...# #...# #...# .###.',
  P: '####. #...# #...# ####. #.... #.... #....',
  Q: '.###. #...# #...# #...# #.#.# #..#. .##.#',
  R: '####. #...# #...# ####. #.#.. #..#. #...#',
  S: '.#### #.... #.... .###. ....# ....# ####.',
  T: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  U: '#...# #...# #...# #...# #...# #...# .###.',
  V: '#...# #...# #...# #...# #...# .#.#. ..#..',
  W: '#...# #...# #...# #.#.# #.#.# #.#.# .#.#.',
  X: '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
  Y: '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
  Z: '##### ....# ...#. ..#.. .#... #.... #####',
  '0': '.###. #...# #..## #.#.# ##..# #...# .###.',
  '1': '..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.',
  '2': '.###. #...# ....# ...#. ..#.. .#... #####',
  '3': '##### ...#. ..#.. ...#. ....# #...# .###.',
  '4': '...#. ..##. .#.#. #..#. ##### ...#. ...#.',
  '5': '##### #.... ####. ....# ....# #...# .###.',
  '6': '..##. .#... #.... ####. #...# #...# .###.',
  '7': '##### ....# ...#. ..#.. .#... .#... .#...',
  '8': '.###. #...# #...# .###. #...# #...# .###.',
  '9': '.###. #...# #...# .#### ....# ...#. .##..',
  ' ': '..... ..... ..... ..... ..... ..... .....',
  '.': '..... ..... ..... ..... ..... .##.. .##..',
  ',': '..... ..... ..... ..... .##.. ..#.. .#...',
  ':': '..... .##.. .##.. ..... .##.. .##.. .....',
  '/': '....# ...#. ...#. ..#.. .#... .#... #....',
  '+': '..... ..#.. ..#.. ##### ..#.. ..#.. .....',
  '-': '..... ..... ..... ##### ..... ..... .....',
  _: '..... ..... ..... ..... ..... ..... #####',
  '!': '..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..',
  '?': '.###. #...# ....# ...#. ..#.. ..... ..#..',
  '(': '...#. ..#.. .#... .#... .#... ..#.. ...#.',
  ')': '.#... ..#.. ...#. ...#. ...#. ..#.. .#...',
  "'": '..#.. ..#.. .#... ..... ..... ..... .....',
};

/** Glyph → 7 linhas em bits (bit 4 = coluna da esquerda). Montado uma vez. */
const FONT = new Map<string, readonly number[]>(
  Object.entries(FONT_SOURCE).map(([ch, rows]) => [
    ch,
    rows.split(' ').map((row) => [...row].reduce((bits, c) => (bits << 1) | (c === '#' ? 1 : 0), 0)),
  ]),
);

/** Letras acentuadas do pt-BR (e vizinhas) → letra base. */
const BASE_LETTER: Readonly<Record<string, string>> = {
  Á: 'A',
  À: 'A',
  Â: 'A',
  Ã: 'A',
  Ä: 'A',
  É: 'E',
  È: 'E',
  Ê: 'E',
  Ë: 'E',
  Í: 'I',
  Ì: 'I',
  Î: 'I',
  Ï: 'I',
  Ó: 'O',
  Ò: 'O',
  Ô: 'O',
  Õ: 'O',
  Ö: 'O',
  Ú: 'U',
  Ù: 'U',
  Û: 'U',
  Ü: 'U',
  Ç: 'C',
  Ñ: 'N',
};

/** Texto como a fonte enxerga: caixa alta, sem acento, `?` no que não tem desenho. */
export function noticeText(text: string): string {
  let out = '';
  for (const raw of text.toUpperCase()) {
    const ch = BASE_LETTER[raw] ?? raw;
    out += FONT.has(ch) ? ch : '?';
  }
  return out;
}

/** Quebra em palavras para caber em `maxChars` por linha (palavra maior que a linha é cortada). */
export function wrapNotice(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (!word) continue;
    let w = word;
    while (w.length > maxChars) {
      if (line) out.push(line);
      line = '';
      out.push(w.slice(0, maxChars));
      w = w.slice(maxChars);
    }
    if (!line) line = w;
    else if (line.length + 1 + w.length <= maxChars) line += ` ${w}`;
    else {
      out.push(line);
      line = w;
    }
  }
  if (line) out.push(line);
  return out;
}

type Rgb = readonly [number, number, number];
const BACKGROUND: Rgb = [0x10 / 255, 0x13 / 255, 0x17 / 255];
const TITLE: Rgb = [0xf2 / 255, 0xf4 / 255, 0xf7 / 255];
const BODY: Rgb = [0x9a / 255, 0xa3 / 255, 0xad / 255];
/** Faixa de erro no topo (mesma família de cor da faixa de perigo da UI). */
const ALERT: Rgb = [0xd9 / 255, 0x4a / 255, 0x3d / 255];

/**
 * Desenha o aviso inteiro (fundo + linhas, a primeira maior, quebradas para caber). Origem do GL embaixo à esquerda.
 * Lança se o contexto estiver quebrado; quem chama decide o que fazer (log).
 */
export function drawGlNotice(gl: NoticeGl, width: number, height: number, lines: readonly string[]): void {
  gl.bindFramebuffer(GL_FRAMEBUFFER, null);
  gl.viewport(0, 0, width, height);
  gl.colorMask(true, true, true, true);
  gl.disable(GL_SCISSOR_TEST);
  gl.clearColor(BACKGROUND[0], BACKGROUND[1], BACKGROUND[2], 1);
  gl.clear(GL_COLOR_BUFFER_BIT);
  gl.enable(GL_SCISSOR_TEST);

  const fill = (x: number, yTop: number, w: number, h: number, c: Rgb): void => {
    gl.scissor(x, height - yTop - h, w, h);
    gl.clearColor(c[0], c[1], c[2], 1);
    gl.clear(GL_COLOR_BUFFER_BIT);
  };

  fill(0, 0, width, Math.max(4, Math.round(height / 90)), ALERT);

  // Escala do pixel da fonte: título 2x maior que o corpo, tudo proporcional à altura (720p → 6 e 3).
  const body = Math.max(1, Math.floor(height / 240));
  const margin = Math.round(width * 0.05);
  const rows: { text: string; scale: number; color: Rgb }[] = [];
  lines.forEach((line, i) => {
    const scale = i === 0 ? body * 2 : body;
    const maxChars = Math.max(1, Math.floor((width - 2 * margin) / ((GLYPH_W + 1) * scale)));
    for (const text of wrapNotice(noticeText(line), maxChars))
      rows.push({ text, scale, color: i === 0 ? TITLE : BODY });
  });
  const lineGap = (scale: number): number => (GLYPH_H + 4) * scale;
  const total = rows.reduce((sum, r) => sum + lineGap(r.scale), 0);
  let y = Math.round((height - total) / 2);
  for (const row of rows) {
    const s = row.scale;
    let x = Math.round((width - row.text.length * (GLYPH_W + 1) * s + s) / 2);
    for (const ch of row.text) {
      const glyph = FONT.get(ch);
      if (glyph) {
        for (let gy = 0; gy < GLYPH_H; gy++) {
          const bits = glyph[gy] as number;
          // Um clear por trecho aceso da linha do glyph (menos chamadas que um por pixel).
          for (let gx = 0; gx < GLYPH_W;) {
            if ((bits & (1 << (GLYPH_W - 1 - gx))) === 0) {
              gx++;
              continue;
            }
            const start = gx;
            while (gx < GLYPH_W && (bits & (1 << (GLYPH_W - 1 - gx))) !== 0) gx++;
            fill(x + start * s, y + gy * s, (gx - start) * s, s, row.color);
          }
        }
      }
      x += (GLYPH_W + 1) * s;
    }
    y += lineGap(s);
  }
  gl.disable(GL_SCISSOR_TEST);
}
