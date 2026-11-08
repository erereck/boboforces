import { pushRect, type DrawList } from './draw-list.ts';
import { drawCodes, drawText, measureCodes, measureText, type MsdfFont } from './font.ts';
import { NUMBER_CODES_MAX, numberToCodes } from './text.ts';

/**
 * Pincéis das telas desenhadas direto na DrawList (HUD, F2, loading, testes, folha das fontes): texto e números
 * alinhados pelo topo das maiúsculas, sem alocação por frame. Sem fonte (`null`), medem por estimativa de condensada
 * (meio em por letra, como o layout) e não desenham texto: as formas continuam aparecendo (testes, NullRenderer).
 */

/** Alinhamento horizontal: 0 esquerda, 0,5 centro, 1 direita (a âncora `x` é o ponto de referência). */
export type HAlign = 0 | 0.5 | 1;

const NUMBER_CODES = new Uint16Array(NUMBER_CODES_MAX);

/** Altura das maiúsculas em px (estimativa de 0,7 em sem fonte). */
export function capHeightPx(font: MsdfFont | null | undefined, px: number): number {
  return font ? (font.capHeight * px) / font.size : px * 0.7;
}

/** Largura do texto em px (estimativa sem fonte). */
export function textWidth(font: MsdfFont | null | undefined, text: string, px: number, tracking = 0): number {
  return font ? measureText(font, text, px, tracking) : text.length * px * (0.5 + tracking);
}

/**
 * Tamanho (px) que faz o texto caber em `maxW`, sem passar de `px` nem descer de `minPx` (piso de leitura: abaixo
 * dele o texto pode passar de `maxW`). Sem alocação.
 */
export function fitTextPx(
  font: MsdfFont | null | undefined,
  text: string,
  px: number,
  tracking: number,
  maxW: number,
  minPx = 0,
): number {
  const w = textWidth(font, text, px, tracking);
  const fitted = w > maxW && w > 0 ? (px * Math.max(0, maxW)) / w : px;
  return Math.max(fitted, Math.min(minPx, px));
}

/**
 * Desenha texto com o topo das maiúsculas em `capTop`, alinhado em `x`. Devolve a largura (medida ou estimada)
 * arredondada para cima: quem avança a caneta segue em px inteiros (texto já sai no pixel; e no V8 número inteiro
 * pequeno não vira objeto no heap ao voltar da função).
 */
export function paintText(
  out: DrawList,
  font: MsdfFont | null | undefined,
  text: string,
  x: number,
  capTop: number,
  px: number,
  color: number,
  tracking = 0,
  align: HAlign = 0,
): number {
  const w = align === 0 && font ? 0 : textWidth(font, text, px, tracking);
  if (!font) return Math.ceil(w);
  return Math.ceil(drawText(out, font, text, x - w * align, capTop, px, color, tracking));
}

/** Largura de um número no formato pt-BR (`numberToCodes`). */
export function numberWidth(
  font: MsdfFont | null | undefined,
  value: number,
  places: number,
  px: number,
  minIntDigits = 1,
  tracking = 0,
): number {
  const n = numberToCodes(value, places, NUMBER_CODES, minIntDigits);
  return font ? measureCodes(font, NUMBER_CODES, n, px, tracking) : n * px * (0.5 + tracking);
}

/** Desenha um número sem criar string. Devolve a largura (medida ou estimada), arredondada para cima. */
export function paintNumber(
  out: DrawList,
  font: MsdfFont | null | undefined,
  value: number,
  places: number,
  x: number,
  capTop: number,
  px: number,
  color: number,
  align: HAlign = 0,
  minIntDigits = 1,
  tracking = 0,
): number {
  const n = numberToCodes(value, places, NUMBER_CODES, minIntDigits);
  if (!font) return Math.ceil(n * px * (0.5 + tracking));
  const w = align === 0 ? 0 : measureCodes(font, NUMBER_CODES, n, px, tracking);
  return Math.ceil(drawCodes(out, font, NUMBER_CODES, n, x - w * align, capTop, px, color, tracking));
}

/** Formas dos ícones de time e de jogador (sempre junto da cor: daltonismo). */
export const ICON_SHAPE = { triangle: 0, circle: 1, square: 2, diamond: 3 } as const;
export type IconShape = (typeof ICON_SHAPE)[keyof typeof ICON_SHAPE];

/**
 * Ícones em "pixel" de 7×7 (a mesma linguagem blocada do jogo), como faixas horizontais: [linha inicial, linhas,
 * coluna inicial, colunas]. ▲ ● ■ ◆ = times A–D e jogadores P1–P4 (arte-ux.md §6.2).
 */
const ICON_SPANS: readonly (readonly number[])[] = [
  [0, 2, 3, 1, 2, 2, 2, 3, 4, 2, 1, 5, 6, 1, 0, 7],
  [0, 1, 2, 3, 1, 1, 1, 5, 2, 3, 0, 7, 5, 1, 1, 5, 6, 1, 2, 3],
  // O quadrado cheio pesa mais que os outros: 6×6 centrado equilibra.
  [0.5, 6, 0.5, 6],
  [0, 1, 3, 1, 1, 1, 2, 3, 2, 1, 1, 5, 3, 1, 0, 7, 4, 1, 1, 5, 5, 1, 2, 3, 6, 1, 3, 1],
];

/** Desenha o ícone `shape` (0..3) num quadrado de lado `size` com canto em (x, y). Bordas no pixel. */
export function paintIcon(out: DrawList, shape: number, x: number, y: number, size: number, color: number): void {
  const spans = ICON_SPANS[((shape % 4) + 4) % 4] as readonly number[];
  const u = size / 7;
  for (let i = 0; i < spans.length; i += 4) {
    const y0 = Math.round(y + (spans[i] as number) * u);
    const y1 = Math.round(y + ((spans[i] as number) + (spans[i + 1] as number)) * u);
    const x0 = Math.round(x + (spans[i + 2] as number) * u);
    const x1 = Math.round(x + ((spans[i + 2] as number) + (spans[i + 3] as number)) * u);
    if (x1 > x0 && y1 > y0) pushRect(out, x0, y0, x1 - x0, y1 - y0, color);
  }
}

/** Barra de progresso: trilho e preenchimento (0..1), bordas no pixel. */
export function paintBar(
  out: DrawList,
  x: number,
  y: number,
  w: number,
  h: number,
  fraction: number,
  track: number,
  fill: number,
): void {
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  const ww = Math.max(0, Math.round(x + w) - x0);
  const hh = Math.max(1, Math.round(y + h) - y0);
  pushRect(out, x0, y0, ww, hh, track);
  const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  const fw = Math.round(ww * f);
  if (fw > 0) pushRect(out, x0, y0, fw, hh, fill);
}
