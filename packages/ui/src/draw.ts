import { popClip, pushClip, pushRect, pushShape, type DrawList } from './draw-list.ts';
import { optionArrows } from './focus.ts';
import { drawText } from './font.ts';
import { paintIcon } from './paint.ts';
import type { LayoutResult, ScrollInfo } from './layout.ts';
import { BUTTON, CHAMFER, COLORS, OPTION, withAlpha } from './tokens.ts';
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
    case 'tab':
      // M2 (fase 4a): aba sem placa; a selecionada tem o texto claro e o sublinhado âmbar.
      look.fill = focused ? COLORS.chapaAlta : 0;
      look.text = node.selected || focused ? COLORS.texto : COLORS.textoBaixo;
      break;
  }
  return look;
}

const arrowX = new Float64Array(3);

/** Seta em degraus de pixel-art (`OPTION.arrowSteps` colunas), com a ponta para `dir` (-1 esquerda, +1 direita). */
function drawArrow(out: DrawList, cx: number, cy: number, size: number, dir: number, color: number): void {
  const steps = OPTION.arrowSteps;
  const u = Math.max(1, Math.round(size / (steps * 2)));
  const x0 = Math.round(cx - (steps * u) / 2);
  for (let i = 0; i < steps; i++) {
    const h = (2 * i + 1) * u;
    const x = dir < 0 ? x0 + i * u : x0 + (steps - 1 - i) * u;
    pushRect(out, x, Math.round(cy - h / 2), u, h, color);
  }
}

function drawButton(layout: LayoutResult, node: ButtonNode, r: Rect, focused: boolean, out: DrawList): void {
  const s = layout.scale;
  const chamfer = Math.round(CHAMFER.button * s);
  const stroke = Math.max(1, Math.round(BUTTON.stroke * s));
  const l = buttonLook(node, focused);
  if (l.fill !== 0) pushShape(out, r.x, r.y, r.w, r.h, l.fill, chamfer);
  if (node.variant === 'tab' && node.selected) {
    const bar = Math.max(2, Math.round(4 * s));
    pushRect(out, r.x + chamfer / 2, r.y + r.h - bar, r.w - chamfer, bar, COLORS.acao);
  }
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
  if (node.value === undefined) {
    drawText(
      out,
      font,
      text.text,
      r.x + (r.w - text.width) / 2,
      r.y + (r.h - capH) / 2,
      text.px,
      l.text,
      text.tracking,
    );
    return;
  }
  // M2 (fase 4a): linha de opção: rótulo à esquerda; valor centrado entre as setas, na área da direita.
  drawText(out, font, text.text, r.x + BUTTON.padX * s, r.y + (r.h - capH) / 2, text.px, l.text, text.tracking);
  optionArrows(layout, node, r, arrowX);
  if (!node.valueOnly) {
    const arrowColor = node.disabled ? COLORS.linha : focused ? COLORS.acao : COLORS.textoBaixo;
    const glyph = Math.round(r.h * 0.42);
    drawArrow(out, arrowX[0]! + arrowX[2]! / 2, r.y + r.h / 2, glyph, -1, arrowColor);
    drawArrow(out, arrowX[1]! + arrowX[2]! / 2, r.y + r.h / 2, glyph, 1, arrowColor);
  }
  const value = layout.values.get(node);
  const vfont = value ? layout.fonts?.[value.font] : undefined;
  if (!value || !vfont) return;
  // Só leitura: o valor ocupa a área inteira (sem as setas).
  const left = node.valueOnly ? arrowX[0]! : arrowX[0]! + arrowX[2]!;
  const right = node.valueOnly ? arrowX[1]! + arrowX[2]! : arrowX[1]!;
  const vcap = (vfont.capHeight * value.px) / vfont.size;
  // M2 (fase 6c): o quadradinho da cor vai antes do valor, e os dois juntos ficam centrados.
  const sw = node.swatch !== undefined ? Math.round(r.h * 0.4) : 0;
  const gap = sw > 0 ? Math.round(OPTION.swatchGap * s) : 0;
  const vx = left + (right - left - value.width - sw - gap) / 2 + sw + gap;
  if (sw > 0) {
    const sx = Math.round(vx - gap - sw);
    const sy = Math.round(r.y + (r.h - sw) / 2);
    const edge = Math.max(1, Math.round(s));
    pushRect(out, sx - edge, sy - edge, sw + edge * 2, sw + edge * 2, COLORS.linhaForte);
    pushRect(out, sx, sy, sw, sw, ((node.swatch! << 8) | 0xff) >>> 0);
  }
  drawText(out, vfont, value.text, vx, r.y + (r.h - vcap) / 2, value.px, l.text, value.tracking);
}

/** M2 (fase 4a): barrinha de uma coluna com rolagem (só quando o conteúdo passa da janela), à direita dela. */
function drawScrollBar(layout: LayoutResult, sc: ScrollInfo, out: DrawList): void {
  if (sc.total <= sc.view) return;
  const s = layout.scale;
  const w = Math.max(2, Math.round(OPTION.scrollBar * s));
  const x = sc.rect.x + sc.rect.w + Math.round(OPTION.scrollBarGap * s);
  pushRect(out, x, sc.rect.y, w, sc.view, COLORS.linha);
  const thumb = Math.max(w * 4, Math.round((sc.view * sc.view) / sc.total));
  const y = sc.rect.y + Math.round(((sc.view - thumb) * sc.offset) / Math.max(1, sc.total - sc.view));
  pushRect(out, x, y, w, thumb, COLORS.textoBaixo);
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
      if (node.icon !== undefined) {
        const size = Math.min(r.w, r.h);
        paintIcon(out, node.icon, r.x + (r.w - size) / 2, r.y + (r.h - size) / 2, size, node.iconColor ?? COLORS.texto);
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

/**
 * Desenha a árvore já com layout na `DrawList` (o foco ganha o token `acao`). Sem alocação: pode rodar por frame. Os
 * filhos de uma coluna com rolagem saem recortados pela janela dela (M2, fase 4a).
 */
export function drawTree(layout: LayoutResult, focusedId: string | null, out: DrawList): void {
  const order = layout.order;
  let clip: Rect | null = null;
  for (let i = 0; i < order.length; i++) {
    const node = order[i] as UiNode;
    const c = layout.clips.get(node) ?? null;
    if (c !== clip) {
      if (clip !== null) popClip(out);
      if (c !== null) pushClip(out, c.x, c.y, c.w, c.h);
      clip = c;
    }
    drawNode(layout, node, focusedId, out);
  }
  if (clip !== null) popClip(out);
  for (let i = 0; i < layout.scrolls.length; i++) drawScrollBar(layout, layout.scrolls[i]!, out);
}
