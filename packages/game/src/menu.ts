import { MAX_TOUCHES, MOUSE_BUTTON, type MenuAction, type MenuInput, type RawInputState } from '@boboforces/input';
import {
  createMenuNavigation,
  defaultFocus,
  drawTree,
  hitOptionArrow,
  hitTest,
  layoutTree,
  navigateMenu,
  TABBED_ROW_PREFIX,
  TABBED_TAB_PREFIX,
  type ButtonNode,
  type DrawList,
  type LayoutOptions,
  type LayoutResult,
  type MenuNavigation,
  type UiNode,
} from '@boboforces/ui';

/** Tamanho e opções de layout da UI neste frame (o `game` monta 1x por frame e divide entre menus e HUD). */
export interface UiFrame {
  /** Alvo em px reais (a superfície inteira). */
  readonly width: number;
  readonly height: number;
  /** Escala final da UI: referência 1280×720 × tamanho escolhido (`uiScale`). O HUD usa direto. */
  readonly scale: number;
  /** Só o tamanho escolhido pelo jogador (1 no M0). É o que o `layoutTree` recebe: ele mesmo aplica a referência. */
  readonly userScale: number;
  readonly options: LayoutOptions;
  /** Muda quando qualquer coisa acima muda (o menu refaz o layout só aí). */
  readonly revision: number;
}

/**
 * M2 (fase 4f): numa tela com abas, ao trocar de aba o foco que estava numa aba ou numa linha (que some com a aba
 * velha) vai para a aba nova; um botão de baixo (Voltar, Começar) fica onde está.
 */
export function followTab(menu: MenuController, tab: number): void {
  const id = menu.focusedId;
  if (id === null || id.startsWith(TABBED_TAB_PREFIX) || id.startsWith(TABBED_ROW_PREFIX)) {
    menu.focus(TABBED_TAB_PREFIX + String(tab));
  }
}

/** Ações de menu na ordem em que são tratadas num frame (a primeira que ativa ou volta encerra o frame). */
const MENU_ORDER: readonly MenuAction[] = ['up', 'down', 'left', 'right', 'confirm', 'back', 'tabPrev', 'tabNext'];

/**
 * Uma tela de menu viva: árvore → layout (refeito só quando a árvore ou o tamanho mudam) → foco → DrawList.
 * Navegação por AÇÕES de qualquer dispositivo (D-pad + confirmar/voltar bastam, regra 12) e, por cima, ponteiro:
 * mouse sem pointer lock (passar por cima foca, clique confirma) e toque (soltar no mesmo botão confirma).
 */
export interface MenuController {
  readonly layout: LayoutResult | null;
  readonly focusedId: string | null;
  /** Troca a árvore (tela nova ou estado novo). O foco continua se o id ainda existir; senão vai para o inicial. */
  setRoot(root: UiNode): void;
  /** M2 (fase 4c): põe o foco num id (vale no próximo `update`; id que não existe cai no foco inicial). */
  focus(id: string | null): void;
  /** 1x por frame. A navegação devolvida é reaproveitada (não guarde). */
  update(menu: MenuInput, raw: Readonly<RawInputState>, ui: UiFrame): MenuNavigation;
  /** Desenha (refaz o layout antes, se o tamanho mudou desde o último `update`). */
  draw(out: DrawList, ui: UiFrame): void;
}

export function createMenuController(): MenuController {
  let root: UiNode | null = null;
  let layout: LayoutResult | null = null;
  let revision = -1;
  let focusedId: string | null = null;
  /** M2 (fase 4a): deslocamento das colunas com rolagem por id, e o foco com que o layout foi feito. */
  const scrollState = new Map<string, number>();
  let layoutFocus: string | null = null;
  const nav = createMenuNavigation();
  // Ponteiro: o mouse confirma ao soltar no botão em que desceu; cada dedo idem.
  let mouseWasDown = false;
  let mousePressedId: string | null = null;
  let lastPointerX = Number.NaN;
  let lastPointerY = Number.NaN;
  const touchActive = new Uint8Array(MAX_TOUCHES);
  const touchIds = new Int32Array(MAX_TOUCHES);
  const touchX = new Float32Array(MAX_TOUCHES);
  const touchY = new Float32Array(MAX_TOUCHES);
  const touchPressed: (string | null)[] = new Array<string | null>(MAX_TOUCHES).fill(null);

  function relayout(ui: UiFrame): LayoutResult | null {
    if (root === null) return null;
    // Com coluna com rolagem, o foco novo pode pedir outra janela: refaz o layout (só quando o foco muda).
    const scrolled = layout !== null && layout.scrolls.length > 0 && layoutFocus !== focusedId;
    if (layout !== null && revision === ui.revision && !scrolled) return layout;
    layout = layoutTree(root, { x: 0, y: 0, w: ui.width, h: ui.height }, ui.userScale, {
      ...ui.options,
      focusedId,
      scrollState,
    });
    revision = ui.revision;
    if (focusedId === null || !layout.focusable.some((b) => b.id === focusedId)) {
      focusedId = defaultFocus(layout);
      if (layout.scrolls.length > 0) {
        layout = layoutTree(root, { x: 0, y: 0, w: ui.width, h: ui.height }, ui.userScale, {
          ...ui.options,
          focusedId,
          scrollState,
        });
      }
    }
    layoutFocus = focusedId;
    return layout;
  }

  function activate(l: LayoutResult, id: string, x: number): void {
    const node = l.byId.get(id) as ButtonNode | undefined;
    if (!node || node.kind !== 'button' || node.disabled) return;
    focusedId = id;
    nav.focusedId = id;
    nav.activated = node.action;
    // M2 (fase 4a): nas setas de uma linha de opção, o toque e o clique mudam o valor.
    nav.delta = hitOptionArrow(l, id, x);
  }

  function pointer(l: LayoutResult, raw: Readonly<RawInputState>): void {
    const mouseDown = (raw.mouseButtons & MOUSE_BUTTON.left) !== 0;
    if (!raw.pointerLocked && raw.pointerInside) {
      const moved = raw.pointerX !== lastPointerX || raw.pointerY !== lastPointerY;
      if (moved || (mouseDown && !mouseWasDown) || (!mouseDown && mouseWasDown)) {
        const id = hitTest(l, raw.pointerX, raw.pointerY);
        if (moved && id !== null) focusedId = id;
        if (mouseDown && !mouseWasDown) mousePressedId = id;
        else if (!mouseDown && mouseWasDown) {
          if (id !== null && id === mousePressedId) activate(l, id, raw.pointerX);
          mousePressedId = null;
        }
      }
    } else if (!mouseDown) mousePressedId = null;
    mouseWasDown = mouseDown;
    lastPointerX = raw.pointerX;
    lastPointerY = raw.pointerY;

    for (let i = 0; i < MAX_TOUCHES; i++) {
      const t = raw.touches[i];
      if (!t) continue;
      if (t.active) {
        if (touchActive[i] === 0 || touchIds[i] !== t.id) {
          touchPressed[i] = hitTest(l, t.x, t.y);
          if (touchPressed[i] !== null) focusedId = touchPressed[i]!;
        }
        touchActive[i] = 1;
        touchIds[i] = t.id;
        touchX[i] = t.x;
        touchY[i] = t.y;
      } else if (touchActive[i] === 1) {
        touchActive[i] = 0;
        const id = hitTest(l, touchX[i]!, touchY[i]!);
        if (id !== null && id === touchPressed[i] && nav.activated === null) activate(l, id, touchX[i]!);
        touchPressed[i] = null;
      }
    }
  }

  return {
    get layout(): LayoutResult | null {
      return layout;
    },
    get focusedId(): string | null {
      return focusedId;
    },
    focus(id: string | null): void {
      focusedId = id;
    },
    setRoot(next: UiNode): void {
      root = next;
      layout = null;
      revision = -1;
    },
    update(menu, raw, ui): MenuNavigation {
      nav.activated = null;
      nav.back = false;
      nav.delta = 0;
      nav.tab = 0;
      nav.focusedId = focusedId;
      const l = relayout(ui);
      if (l === null) return nav;
      for (let i = 0; i < MENU_ORDER.length; i++) {
        const action = MENU_ORDER[i]!;
        if (!menu.pressed(action)) continue;
        navigateMenu(l, focusedId, action, nav);
        focusedId = nav.focusedId;
        if (nav.activated !== null || nav.back || nav.tab !== 0) return nav;
      }
      pointer(l, raw);
      nav.focusedId = focusedId;
      return nav;
    },
    draw(out: DrawList, ui: UiFrame): void {
      const l = relayout(ui);
      if (l !== null) drawTree(l, focusedId, out);
    },
  };
}
