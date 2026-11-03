import { measureText, textBoxHeight, type UiFonts } from './font.ts';
import { t } from './text.ts';
import { BUTTON, SCREEN_MARGIN, TYPE, uiScale, type FontRole } from './tokens.ts';
import type { Anchor, ButtonNode, Insets, Rect, TextContent, TextNode, UiNode } from './tree.ts';

/**
 * Layout em duas passadas: mede de baixo para cima (tamanho intrínseco ou fixo) e posiciona de cima para baixo
 * (âncoras em `box`, fluxo em `row`/`column`). Tudo em px reais do alvo, arredondado ao pixel.
 *
 * Roda quando a tela, o estado ou o tamanho mudam, não a cada frame: aloca mapas e listas. O desenho (`drawTree`) é
 * que roda por frame, sem alocar.
 */

export interface LayoutOptions {
  /** Fontes MSDF; sem elas, o texto é estimado (testes e NullRenderer) e não é desenhado. */
  readonly fonts?: UiFonts | null;
  /** Safe area em px reais (recorte da tela, notch, margem de TV). Soma-se à margem da tela por lado (o maior vale). */
  readonly safeArea?: Insets;
  /** Lado mínimo de um alvo focável em px reais (toque: 44 × pixelRatio). */
  readonly minTarget?: number;
  /** Piso do tamanho de fonte em px reais (arte-ux.md §6.8; `MIN_TEXT`). */
  readonly minTextPx?: number;
}

/** Texto já resolvido (tabela + parâmetros + caixa alta) e medido. */
export interface ResolvedText {
  readonly text: string;
  readonly font: FontRole;
  /** Tamanho da fonte (em) em px reais. */
  readonly px: number;
  /** Espaçamento entre letras, em em. */
  readonly tracking: number;
  /** Largura medida e altura da caixa (topo das maiúsculas → descendentes), em px reais. */
  readonly width: number;
  readonly height: number;
}

/** Layout resolvido (retângulos em px reais do alvo) e a lista de focáveis em ordem. */
export interface LayoutResult {
  readonly rects: ReadonlyMap<UiNode, Rect>;
  /** Botões com `id` e não desabilitados, na ordem da árvore. */
  readonly focusable: readonly ButtonNode[];
  readonly viewport: Rect;
  /** Área útil: viewport menos safe area e margem da tela. */
  readonly content: Rect;
  /** Escala final (referência 1280×720 × tamanho escolhido). */
  readonly scale: number;
  readonly fonts: UiFonts | null;
  /** Nós em ordem de desenho (pai antes dos filhos). */
  readonly order: readonly UiNode[];
  readonly texts: ReadonlyMap<UiNode, ResolvedText>;
  readonly byId: ReadonlyMap<string, UiNode>;
}

interface Size {
  w: number;
  h: number;
}

interface Ctx {
  readonly scale: number;
  readonly fonts: UiFonts | null;
  readonly minTarget: number;
  readonly minTextPx: number;
  readonly sizes: Map<UiNode, Size>;
  readonly rects: Map<UiNode, Rect>;
  readonly texts: Map<UiNode, ResolvedText>;
  readonly order: UiNode[];
  readonly focusable: ButtonNode[];
  readonly byId: Map<string, UiNode>;
}

function resolveString(content: TextContent): string {
  return 'key' in content ? t(content.key, content.params) : content.literal;
}

function resolveText(
  ctx: Ctx,
  content: TextContent,
  font: FontRole,
  sizeRef: number,
  tracking: number,
  uppercase: boolean,
): ResolvedText {
  const raw = resolveString(content);
  const text = uppercase ? raw.toUpperCase() : raw;
  const px = Math.max(sizeRef * ctx.scale, ctx.minTextPx);
  const f = ctx.fonts?.[font];
  // Sem fonte: estimativa de condensada (meio em por letra), suficiente para testes e para o NullRenderer.
  const width = f ? measureText(f, text, px, tracking) : text.length * px * (0.5 + tracking);
  const height = f ? textBoxHeight(f, px) : px * 0.9;
  return { text, font, px, tracking, width, height };
}

function textNodeStyle(node: TextNode): { font: FontRole; size: number; tracking: number; uppercase: boolean } {
  const base = TYPE[node.style ?? 'body'];
  return {
    font: node.font ?? base.font,
    size: node.size ?? base.size,
    tracking: node.tracking ?? base.tracking,
    uppercase: node.uppercase ?? base.uppercase,
  };
}

function childrenOf(node: UiNode): readonly UiNode[] {
  if (node.kind === 'box') return node.children ?? [];
  if (node.kind === 'row' || node.kind === 'column') return node.children;
  return [];
}

function measure(node: UiNode, ctx: Ctx): Size {
  const s = ctx.scale;
  const pad = (node.padding ?? 0) * s;
  const gap = (node.gap ?? 0) * s;
  let w = 0;
  let h = 0;
  switch (node.kind) {
    case 'text': {
      const st = textNodeStyle(node);
      const resolved = resolveText(ctx, node.text, st.font, st.size, st.tracking, st.uppercase);
      ctx.texts.set(node, resolved);
      w = resolved.width + pad * 2;
      h = resolved.height + pad * 2;
      break;
    }
    case 'button': {
      const st = TYPE.button;
      const resolved = resolveText(ctx, node.text, st.font, st.size, st.tracking, st.uppercase);
      ctx.texts.set(node, resolved);
      w = Math.max(resolved.width + BUTTON.padX * s * 2, BUTTON.minWidth * s);
      h = BUTTON.height * s;
      break;
    }
    case 'sprite':
      break;
    case 'box': {
      for (const child of childrenOf(node)) {
        const c = measure(child, ctx);
        w = Math.max(w, c.w + Math.abs(child.x ?? 0) * s);
        h = Math.max(h, c.h + Math.abs(child.y ?? 0) * s);
      }
      w += pad * 2;
      h += pad * 2;
      break;
    }
    case 'row':
    case 'column': {
      const children = node.children;
      const row = node.kind === 'row';
      for (const child of children) {
        const c = measure(child, ctx);
        if (row) {
          w += c.w;
          h = Math.max(h, c.h);
        } else {
          h += c.h;
          w = Math.max(w, c.w);
        }
      }
      const gaps = Math.max(0, children.length - 1) * gap;
      if (row) w += gaps;
      else h += gaps;
      w += pad * 2;
      h += pad * 2;
      break;
    }
  }
  if (node.width !== undefined) w = node.width * s;
  if (node.height !== undefined) h = node.height * s;
  if (node.kind === 'button') {
    w = Math.max(w, ctx.minTarget);
    h = Math.max(h, ctx.minTarget);
  }
  const size = { w, h };
  ctx.sizes.set(node, size);
  return size;
}

function anchorFactors(anchor: Anchor): [number, number] {
  switch (anchor) {
    case 'topLeft':
      return [0, 0];
    case 'top':
      return [0.5, 0];
    case 'topRight':
      return [1, 0];
    case 'left':
      return [0, 0.5];
    case 'center':
      return [0.5, 0.5];
    case 'right':
      return [1, 0.5];
    case 'bottomLeft':
      return [0, 1];
    case 'bottom':
      return [0.5, 1];
    case 'bottomRight':
      return [1, 1];
  }
}

function place(node: UiNode, x: number, y: number, w: number, h: number, ctx: Ctx, content?: Rect): void {
  const rect: Rect = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  ctx.rects.set(node, rect);
  ctx.order.push(node);
  if (node.id !== undefined && !ctx.byId.has(node.id)) ctx.byId.set(node.id, node);
  if (node.kind === 'button' && node.id !== undefined && !node.disabled) ctx.focusable.push(node);

  const s = ctx.scale;
  const pad = (node.padding ?? 0) * s;
  const inner = content ?? { x: rect.x + pad, y: rect.y + pad, w: rect.w - pad * 2, h: rect.h - pad * 2 };

  if (node.kind === 'box') {
    for (const child of childrenOf(node)) {
      const size = ctx.sizes.get(child) as Size;
      const [fx, fy] = anchorFactors(child.anchor ?? 'topLeft');
      const cx = inner.x + (inner.w - size.w) * fx + (child.x ?? 0) * s;
      const cy = inner.y + (inner.h - size.h) * fy + (child.y ?? 0) * s;
      place(child, cx, cy, size.w, size.h, ctx);
    }
    return;
  }
  if (node.kind === 'row' || node.kind === 'column') {
    const row = node.kind === 'row';
    const gap = (node.gap ?? 0) * s;
    const align = node.align ?? 'start';
    let cursor = row ? inner.x : inner.y;
    for (const child of node.children) {
      const size = ctx.sizes.get(child) as Size;
      const crossSpace = row ? inner.h : inner.w;
      const explicitCross = row ? child.height !== undefined : child.width !== undefined;
      let cross = row ? size.h : size.w;
      if (align === 'stretch' && !explicitCross) cross = crossSpace;
      const factor = align === 'center' ? 0.5 : align === 'end' ? 1 : 0;
      const crossPos = (row ? inner.y : inner.x) + (crossSpace - cross) * factor;
      if (row) place(child, cursor, crossPos, size.w, cross, ctx);
      else place(child, crossPos, cursor, cross, size.h, ctx);
      cursor += (row ? size.w : size.h) + gap;
    }
  }
}

/**
 * Resolve o layout da árvore dentro do `viewport` (px reais), com escala `min(w/1280, h/720) × scale` e safe area.
 * A raiz ocupa a viewport inteira (o fundo dela cobre tudo); os filhos ficam na área útil (`content`).
 */
export function layoutTree(root: UiNode, viewport: Rect, scale = 1, options: LayoutOptions = {}): LayoutResult {
  const s = uiScale(viewport.w, viewport.h, scale);
  const ctx: Ctx = {
    scale: s,
    fonts: options.fonts ?? null,
    minTarget: options.minTarget ?? 0,
    minTextPx: options.minTextPx ?? 0,
    sizes: new Map(),
    rects: new Map(),
    texts: new Map(),
    order: [],
    focusable: [],
    byId: new Map(),
  };
  measure(root, ctx);
  const safe = options.safeArea ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const padX = root.padding ?? SCREEN_MARGIN.x;
  const padY = root.padding ?? SCREEN_MARGIN.y;
  const left = Math.round(Math.max(safe.left, padX * s));
  const right = Math.round(Math.max(safe.right, padX * s));
  const top = Math.round(Math.max(safe.top, padY * s));
  const bottom = Math.round(Math.max(safe.bottom, padY * s));
  const content: Rect = {
    x: viewport.x + left,
    y: viewport.y + top,
    w: Math.max(0, viewport.w - left - right),
    h: Math.max(0, viewport.h - top - bottom),
  };
  place(root, viewport.x, viewport.y, viewport.w, viewport.h, ctx, content);
  return {
    rects: ctx.rects,
    focusable: ctx.focusable,
    viewport: { ...viewport },
    content,
    scale: s,
    fonts: ctx.fonts,
    order: ctx.order,
    texts: ctx.texts,
    byId: ctx.byId,
  };
}
