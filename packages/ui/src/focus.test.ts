import { describe, expect, it } from 'vitest';
import { createMenuNavigation, defaultFocus, hitTest, moveFocus, navigateMenu } from './focus.ts';
import { layoutTree } from './layout.ts';
import { titleScreen, TITLE_ACTION } from './screens/title.ts';
import type { ButtonNode, Rect, UiNode } from './tree.ts';

const btn = (id: string, extra: Partial<ButtonNode> = {}): ButtonNode => ({
  kind: 'button',
  id,
  text: { literal: id },
  action: `act:${id}`,
  width: 200,
  height: 60,
  ...extra,
});

const viewport = { x: 0, y: 0, w: 1280, h: 720 };

describe('foco espacial (D-pad)', () => {
  it('coluna: desce e sobe pela ordem visual; na borda não há vizinho', () => {
    const l = layoutTree({ kind: 'column', gap: 10, children: [btn('a'), btn('b'), btn('c')] }, viewport);
    expect(moveFocus(l, 'a', 'down')).toBe('b');
    expect(moveFocus(l, 'b', 'down')).toBe('c');
    expect(moveFocus(l, 'c', 'down')).toBeNull();
    expect(moveFocus(l, 'c', 'up')).toBe('b');
    expect(moveFocus(l, 'a', 'up')).toBeNull();
    expect(moveFocus(l, 'a', 'left')).toBeNull();
  });

  it('grade 2×2: direita e baixo vão para o vizinho alinhado, não para a diagonal', () => {
    const tree: UiNode = {
      kind: 'column',
      gap: 20,
      children: [
        { kind: 'row', gap: 20, children: [btn('tl'), btn('tr')] },
        { kind: 'row', gap: 20, children: [btn('bl'), btn('br')] },
      ],
    };
    const l = layoutTree(tree, viewport);
    expect(moveFocus(l, 'tl', 'right')).toBe('tr');
    expect(moveFocus(l, 'tl', 'down')).toBe('bl');
    expect(moveFocus(l, 'br', 'up')).toBe('tr');
    expect(moveFocus(l, 'br', 'left')).toBe('bl');
    expect(moveFocus(l, 'tr', 'right')).toBeNull();
  });

  it('prefere quem está no feixe, mesmo um pouco mais longe', () => {
    // "far" está bem abaixo e alinhado; "near" está mais perto mas deslocado para o lado (fora do feixe).
    const tree: UiNode = {
      kind: 'box',
      padding: 0,
      children: [btn('from', { x: 0, y: 0 }), btn('near', { x: 260, y: 80 }), btn('far', { x: 0, y: 200 })],
    };
    const l = layoutTree(tree, viewport);
    expect(moveFocus(l, 'from', 'down')).toBe('far');
  });

  it('exceção declarada ganha da geometria; desabilitado é pulado', () => {
    const tree: UiNode = {
      kind: 'column',
      children: [
        btn('a', { focusOverride: { down: 'c' } }),
        btn('b'),
        btn('c'),
        btn('d', { disabled: true }),
        btn('e'),
      ],
    };
    const l = layoutTree(tree, viewport);
    expect(moveFocus(l, 'a', 'down')).toBe('c');
    expect(moveFocus(l, 'c', 'down')).toBe('e');
  });

  it('sem foco (ou foco que sumiu): vai para o autofocus; ação que não é direção mantém o foco', () => {
    const l = layoutTree({ kind: 'column', children: [btn('a'), btn('b', { autofocus: true })] }, viewport);
    expect(defaultFocus(l)).toBe('b');
    expect(moveFocus(l, null, 'down')).toBe('b');
    expect(moveFocus(l, 'sumiu', 'up')).toBe('b');
    expect(moveFocus(l, 'a', 'confirm')).toBe('a');
  });
});

describe('navegação de menu e ponteiro', () => {
  const l = layoutTree(titleScreen.build({ version: '0.0.1', codename: 'Teste' }), viewport);

  it('tela de título: começa em JOGAR, desce para Ajustes e confirma a ação certa', () => {
    const nav = createMenuNavigation();
    const start = defaultFocus(l);
    expect(start).toBe('play');
    navigateMenu(l, start, 'down', nav);
    expect(nav.focusedId).toBe('settings');
    navigateMenu(l, nav.focusedId, 'down', nav);
    expect(nav.focusedId).toBe('settings'); // borda: fica onde está
    navigateMenu(l, nav.focusedId, 'confirm', nav);
    expect(nav.activated).toBe(TITLE_ACTION.settings);
    navigateMenu(l, nav.focusedId, 'up', nav);
    expect(nav).toEqual({ focusedId: 'play', activated: null, back: false, delta: 0, tab: 0 });
    navigateMenu(l, 'play', 'confirm', nav);
    expect(nav.activated).toBe(TITLE_ACTION.play);
    navigateMenu(l, 'play', 'back', nav);
    expect(nav.back).toBe(true);
    expect(nav.activated).toBeNull();
  });

  it('hitTest acha o botão sob o ponto (mouse e toque usam o mesmo caminho)', () => {
    const play = l.rects.get(l.byId.get('play') as UiNode) as Rect;
    expect(hitTest(l, play.x + 1, play.y + 1)).toBe('play');
    expect(hitTest(l, play.x + play.w, play.y)).not.toBe('play');
    expect(hitTest(l, 1, 1)).toBeNull();
  });
});
