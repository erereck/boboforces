import { pushRect, pushShape, type DrawList } from '../draw-list.ts';
import type { LayoutResult } from '../layout.ts';
import { rgba } from '../tokens.ts';
import type { Rect } from '../tree.ts';

/**
 * M12 (fase 3, decisão #43, pergunta AM8): o logotipo em blocos do título, o MESMO do splash da web
 * (`apps/web/index.html`, o SVG `bf-logo`), para a passagem do splash ao título não trocar de logo. As letras BOBOFORCES
 * numa grade de 5×7 blocos com 1 de vão; cada bloco é uma placa de teste do Construto (face, bisel claro em cima e à
 * esquerda, escuro embaixo e à direita, 1/8 do bloco, e 3 pintas) e a fileira de baixo é a faixa laranja de segurança
 * (com as listras diagonais). Por baixo, a espessura (1/4 de bloco para a direita e para baixo) e a sombra a 50%.
 * Feito de retângulos na DrawList, sem textura e sem glifo; a sombra e a espessura vão por trecho de linha.
 */

/** Cada letra: 7 linhas de 5 bits (o bit 4 é a coluna da esquerda). As mesmas do SVG do splash. */
const GLYPHS: Readonly<Record<string, readonly number[]>> = {
  B: [30, 17, 17, 30, 17, 17, 30],
  O: [14, 17, 17, 17, 17, 17, 14],
  F: [31, 16, 16, 30, 16, 16, 16],
  R: [30, 17, 17, 30, 20, 18, 17],
  C: [15, 16, 16, 16, 16, 16, 15],
  E: [31, 16, 16, 30, 16, 16, 31],
  S: [15, 16, 16, 14, 1, 1, 30],
};
const LOGO = 'BOBOFORCES';
const COLS = 5;
const ROWS = 7;

/** A caixa do logo em px de referência: 10 letras de 5 blocos com 1 de vão, 7 de altura, blocos de 12. */
export const BLOCK_LOGO_SIZE = { width: (LOGO.length * (COLS + 1) - 1) * 12, height: ROWS * 12 } as const;

/** As cores do SVG do splash: face, bisel claro, bisel escuro, espessura e pinta (placa) ou listra (faixa). */
const PLATE = [rgba(0xc4cac0), rgba(0xeef1eb), rgba(0x7f887c), rgba(0x4a524b), rgba(0xb0b7ac)] as const;
const STRIPE = [rgba(0xf5812a), rgba(0xffb36b), rgba(0x9c4a14), rgba(0x6e3511), rgba(0x20261f, 0.55)] as const;
const SHADOW = rgba(0x000000, 0.5);
/** As 3 pintas da placa (em 1/8 de bloco, como no SVG). */
const SPECKS = [2, 3, 5, 2, 4, 5] as const;

/** Passa por cada trecho de blocos seguidos de uma linha (x, y, largura, linha). Sem alocação: roda por frame. */
function eachRun(x0: number, y0: number, b: number, fn: (x: number, y: number, w: number, row: number) => void): void {
  for (let li = 0; li < LOGO.length; li++) {
    const rows = GLYPHS[LOGO[li]!]!;
    for (let row = 0; row < ROWS; row++) {
      const bits = rows[row]!;
      let start = -1;
      for (let col = 0; col <= COLS; col++) {
        const on = col < COLS && (bits & (1 << (COLS - 1 - col))) !== 0;
        if (on && start < 0) start = col;
        else if (!on && start >= 0) {
          fn(x0 + (li * (COLS + 1) + start) * b, y0 + row * b, (col - start) * b, row);
          start = -1;
        }
      }
    }
  }
}

let ctxOut: DrawList | null = null;
let ctxB = 0;
let ctxE = 0;
function shadowRun(x: number, y: number, w: number): void {
  pushRect(ctxOut!, x + Math.round(ctxB * 0.5), y + Math.round(ctxB * 0.6), w, ctxB, SHADOW);
}
function depthRun(x: number, y: number, w: number, row: number): void {
  const d = Math.max(1, Math.round(ctxB * 0.25));
  pushRect(ctxOut!, x + d, y + d, w, ctxB, (row === ROWS - 1 ? STRIPE : PLATE)[3]);
}
function blocksRun(x: number, y: number, w: number, row: number): void {
  const out = ctxOut!;
  const b = ctxB;
  const e = ctxE;
  const c = row === ROWS - 1 ? STRIPE : PLATE;
  for (let bx = x; bx < x + w; bx += b) {
    pushRect(out, bx, y, b, b, c[2]);
    pushRect(out, bx, y, b - e, b - e, c[1]);
    pushRect(out, bx + e, y + e, b - 2 * e, b - 2 * e, c[0]);
    if (c === STRIPE) pushShape(out, bx + e, y + e, b - 2 * e, b - 2 * e, c[4], 0, 0, b * 0.354);
    else if (b >= 10) {
      for (let k = 0; k < SPECKS.length; k += 2)
        pushRect(out, bx + (SPECKS[k]! * b) / 8, y + (SPECKS[k + 1]! * b) / 8, e, e, c[4]);
    }
  }
}

/** Desenha o logo em blocos no retângulo `r` (o bloco é a altura dividida por 7, inteiro; alinhado à esquerda). */
export function drawBlockLogo(out: DrawList, r: Rect): void {
  const b = Math.max(2, Math.floor(r.h / ROWS));
  const x0 = Math.round(r.x);
  const y0 = Math.round(r.y + (r.h - b * ROWS) / 2);
  ctxOut = out;
  ctxB = b;
  ctxE = Math.max(1, Math.round(b / 8));
  // Três passadas: a sombra de tudo, a espessura de tudo e os blocos (a espessura de uma letra não cobre a vizinha).
  eachRun(x0, y0, b, shadowRun);
  eachRun(x0, y0, b, depthRun);
  eachRun(x0, y0, b, blocksRun);
  ctxOut = null;
}

/** O logo na caixa `logo` da tela já com layout (o título); sem a caixa, nada. */
export function drawTitleLogo(out: DrawList, layout: LayoutResult): void {
  const node = layout.byId.get('logo');
  const r = node ? layout.rects.get(node) : undefined;
  if (r) drawBlockLogo(out, r);
}
