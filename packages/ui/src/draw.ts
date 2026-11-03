import { pushShape, type DrawList } from './draw-list.ts';
import { drawText } from './font.ts';
import type { LayoutResult } from './layout.ts';
import { BUTTON, CHAMFER, COLORS, withAlpha } from './tokens.ts';
import type { ButtonNode, Rect, TextNode, UiNode } from './tree.ts';

/** Largura da faixa zebrada em px de referência. */
const STRIPE_WIDTH = 10;
/** Quanto o chanfro cresce por px de distância para continuar paralelo ao de dentro (2 − √2). */
const CHAMFER_GROWTH = 2 - Math.SQRT2;

interface ButtonLook {
  fill: number;
  text: number;
  border: number;
  stripes: number;
}

const look: ButtonLook = { fill: 0, text: 0, border: 0, stripes: 0 };

function buttonLook(node: ButtonNode, focused: boolean): ButtonLook {
  look.border = 0;
  look.stripes = 0;
  if (node.disabled) {
    look.fill = COLORS.chapa;
    look.text = COLORS.textoBaixo;
    look.border = COLORS.linha;
    return look;
  }
  switch (node.variant ?? 'secondary') {
    case 'primary':
      look.fill = focused ? COLORS.acao : COLORS.acaoForte;
      look.text = COLORS.textoSobreAcao;
      break;
    case 'danger':
      look.fill = focused ? COLORS.chapaAlta : COLORS.chapa;
      look.text = COLORS.texto;
      look.border = COLORS.perigo;
      look.stripes = withAlpha(COLORS.perigo, focused ? 0.28 : 0.16);
      break;
    case 'secondary':
      // O foco é só o contorno externo (um sinal, não dois): a borda própria continua neutra.
      look.fill = focused ? COLORS.chapaAlta : COLORS.chapa;
      look.text = COLORS.texto;
      look.border = COLORS.linhaForte;
      break;
  }
  return look;
}

function drawButton(layout: LayoutResult, node: ButtonNode, r: Rect, focused: boolean, out: DrawList): void {
  const s = layout.scale;
  const chamfer = Math.round(CHAMFER.button * s);
  const stroke = Math.max(1, Math.round(BUTTON.stroke * s));
  const l = buttonLook(node, focused);
  pushShape(out, r.x, r.y, r.w, r.h, l.fill, chamfer);
  if (l.stripes !== 0) pushShape(out, r.x, r.y, r.w, r.h, l.stripes, chamfer, 0, Math.max(3, STRIPE_WIDTH * s));
  if (l.border !== 0) pushShape(out, r.x, r.y, r.w, r.h, l.border, chamfer, stroke);
  if (focused) {
    // Contorno de foco por fora (arte-ux.md §6.1): 2 px no mínimo, paralelo ao chanfro.
    const ring = Math.max(2, Math.round(BUTTON.focusStroke * s));
    const d = Math.max(2, Math.round(BUTTON.focusGap * s)) + ring;
    pushShape(out, r.x - d, r.y - d, r.w + d * 2, r.h + d * 2, COLORS.acao, chamfer + d * CHAMFER_GROWTH, ring);
  }
  const text = layout.texts.get(node);
  const font = text ? layout.fonts?.[text.font] : undefined;
  if (!text || !font) return;
  const capH = (font.capHeight * text.px) / font.size;
  drawText(out, font, text.text, r.x + (r.w - text.width) / 2, r.y + (r.h - capH) / 2, text.px, l.text, text.tracking);
}

function drawTextNode(layout: LayoutResult, node: TextNode, r: Rect, out: DrawList): void {
  const text = layout.texts.get(node);
  const font = text ? layout.fonts?.[text.font] : undefined;
  if (!text || !font) return;
  const pad = (node.padding ?? 0) * layout.scale;
  const inner = r.w - pad * 2;
  const align = node.textAlign ?? 'left';
  const x = r.x + pad + (align === 'center' ? (inner - text.width) / 2 : align === 'right' ? inner - text.width : 0);
  drawText(out, font, text.text, x, r.y + pad, text.px, node.color ?? COLORS.texto, text.tracking);
}

function drawNode(layout: LayoutResult, node: UiNode, focusedId: string | null, out: DrawList): void {
  const r = layout.rects.get(node);
  if (!r) return;
  switch (node.kind) {
    case 'box': {
      const s = layout.scale;
      const chamfer = node.chamfer ? Math.round(CHAMFER.card * s) : 0;
      if (node.color !== undefined) {
        pushShape(out, r.x, r.y, r.w, r.h, node.color, chamfer, 0, node.stripes ? Math.max(3, STRIPE_WIDTH * s) : 0);
      }
      if (node.borderColor !== undefined) {
        const stroke = Math.max(1, Math.round((node.border ?? 1) * s));
        pushShape(out, r.x, r.y, r.w, r.h, node.borderColor, chamfer, stroke);
      }
      return;
    }
    case 'text':
      drawTextNode(layout, node, r, out);
      return;
    case 'button':
      drawButton(layout, node, r, node.id !== undefined && node.id === focusedId, out);
      return;
    case 'sprite':
    case 'row':
    case 'column':
      // Sprites chegam com o atlas de sprites (M1+); linhas e colunas só posicionam.
      return;
  }
}

/** Desenha a árvore já com layout na `DrawList` (o foco ganha o token `acao`). Sem alocação: pode rodar por frame. */
export function drawTree(layout: LayoutResult, focusedId: string | null, out: DrawList): void {
  const order = layout.order;
  for (let i = 0; i < order.length; i++) drawNode(layout, order[i] as UiNode, focusedId, out);
}
