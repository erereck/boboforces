import type { MenuAction } from '@boboforces/input';
import type { LayoutResult } from './layout.ts';
import type { ButtonNode, Rect } from './tree.ts';

/**
 * Foco espacial (tecnico.md §9, regra 12): o vizinho mais próximo na direção, com preferência para quem está "no
 * feixe" (sobreposto no eixo cruzado), como no FocusFinder do Android. Exceções vêm de `focusOverride`. Sem wrap:
 * na borda o foco fica onde está. Mouse e toque usam `hitTest`.
 */

type Direction = 'up' | 'down' | 'left' | 'right';

function isDirection(action: MenuAction): action is Direction {
  return action === 'up' || action === 'down' || action === 'left' || action === 'right';
}

/** Foco inicial: o primeiro `autofocus`, senão o primeiro focável. */
export function defaultFocus(layout: LayoutResult): string | null {
  for (const b of layout.focusable) if (b.autofocus) return b.id as string;
  return layout.focusable[0]?.id ?? null;
}

function findFocusable(layout: LayoutResult, id: string): ButtonNode | null {
  for (const b of layout.focusable) if (b.id === id) return b;
  return null;
}

/** Candidato está estritamente na direção? (comparando bordas, com folga de 1 px para arredondamento) */
function inDirection(dir: Direction, from: Rect, to: Rect): boolean {
  switch (dir) {
    case 'right':
      return to.x + to.w / 2 > from.x + from.w / 2 + 1 && to.x + to.w > from.x + from.w;
    case 'left':
      return to.x + to.w / 2 < from.x + from.w / 2 - 1 && to.x < from.x;
    case 'down':
      return to.y + to.h / 2 > from.y + from.h / 2 + 1 && to.y + to.h > from.y + from.h;
    case 'up':
      return to.y + to.h / 2 < from.y + from.h / 2 - 1 && to.y < from.y;
  }
}

function overlapsCross(dir: Direction, a: Rect, b: Rect): boolean {
  if (dir === 'left' || dir === 'right') return a.y < b.y + b.h && b.y < a.y + a.h;
  return a.x < b.x + b.w && b.x < a.x + a.w;
}

function score(dir: Direction, from: Rect, to: Rect): number {
  let major: number;
  let minor: number;
  if (dir === 'right' || dir === 'left') {
    major = dir === 'right' ? to.x - (from.x + from.w) : from.x - (to.x + to.w);
    minor = to.y + to.h / 2 - (from.y + from.h / 2);
  } else {
    major = dir === 'down' ? to.y - (from.y + from.h) : from.y - (to.y + to.h);
    minor = to.x + to.w / 2 - (from.x + from.w / 2);
  }
  major = Math.max(0, major);
  return 13 * major * major + minor * minor;
}

/**
 * Próximo foco a partir de `currentId` numa direção do menu; `null` se não houver vizinho naquela direção.
 * Sem foco atual (ou foco que sumiu da tela), devolve o foco inicial. Ações que não são direção devolvem o atual.
 */
export function moveFocus(layout: LayoutResult, currentId: string | null, action: MenuAction): string | null {
  const current = currentId === null ? null : findFocusable(layout, currentId);
  if (!current) return defaultFocus(layout);
  if (!isDirection(action)) return currentId;

  const override = current.focusOverride?.[action];
  if (override !== undefined && findFocusable(layout, override)) return override;

  const from = layout.rects.get(current) as Rect;
  let best: ButtonNode | null = null;
  let bestInBeam = false;
  let bestScore = Infinity;
  for (const candidate of layout.focusable) {
    if (candidate === current) continue;
    const to = layout.rects.get(candidate) as Rect;
    if (!inDirection(action, from, to)) continue;
    const inBeam = overlapsCross(action, from, to);
    const sc = score(action, from, to);
    if ((inBeam && !bestInBeam) || (inBeam === bestInBeam && sc < bestScore)) {
      best = candidate;
      bestInBeam = inBeam;
      bestScore = sc;
    }
  }
  return best?.id ?? null;
}

/** Botão focável sob o ponto (px reais do alvo), ou `null`. O último desenhado ganha. */
export function hitTest(layout: LayoutResult, x: number, y: number): string | null {
  for (let i = layout.focusable.length - 1; i >= 0; i--) {
    const b = layout.focusable[i] as ButtonNode;
    const r = layout.rects.get(b) as Rect;
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return b.id as string;
  }
  return null;
}

/** Resultado de uma ação de menu (objeto reaproveitável: sem alocação por toque). */
export interface MenuNavigation {
  focusedId: string | null;
  /** Ação do botão confirmado (`ButtonNode.action`), ou `null`. */
  activated: string | null;
  /** `back` foi pedido (a tela decide para onde voltar). */
  back: boolean;
}

export function createMenuNavigation(): MenuNavigation {
  return { focusedId: null, activated: null, back: false };
}

/** Aplica uma ação de menu: move o foco, confirma o botão focado ou pede para voltar. Preenche e devolve `out`. */
export function navigateMenu(
  layout: LayoutResult,
  focusedId: string | null,
  action: MenuAction,
  out: MenuNavigation = createMenuNavigation(),
): MenuNavigation {
  out.activated = null;
  out.back = false;
  const current = focusedId === null ? null : findFocusable(layout, focusedId);
  if (!current) {
    out.focusedId = defaultFocus(layout);
    if (action === 'back') out.back = true;
    return out;
  }
  out.focusedId = focusedId;
  if (isDirection(action)) out.focusedId = moveFocus(layout, focusedId, action) ?? focusedId;
  else if (action === 'confirm') out.activated = current.action;
  else if (action === 'back') out.back = true;
  return out;
}
