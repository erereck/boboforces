import { describe, expect, it } from 'vitest';
import { createDrawList, DRAW_OP } from './draw-list.ts';
import { drawTree } from './draw.ts';
import { createMenuNavigation, hitOptionArrow, hitTest, navigateMenu, optionArrows } from './focus.ts';
import { layoutTree } from './layout.ts';
import { drawnCommands, syntheticFontPack, syntheticGlyphText } from './test-fixtures.ts';
import { COLORS } from './tokens.ts';
import type { ButtonNode, Rect, UiNode } from './tree.ts';

/** M2, fase 4a: as peças de UI dos menus (linha de opção, abas, coluna com rolagem). */

const fonts = syntheticFontPack().fonts;
const viewport = { x: 0, y: 0, w: 1280, h: 720 };

const option = (id: string, value: string, extra: Partial<ButtonNode> = {}): ButtonNode => ({
  kind: 'button',
  id,
  text: { literal: id },
  action: `opt:${id}`,
  value: { literal: value },
  width: 760,
  ...extra,
});

const btn = (id: string, extra: Partial<ButtonNode> = {}): ButtonNode => ({
  kind: 'button',
  id,
  text: { literal: id },
  action: `act:${id}`,
  width: 300,
  ...extra,
});

describe('linha de opção', () => {
  const root: UiNode = {
    kind: 'column',
    gap: 16,
    children: [option('nivel', 'Normal'), option('bots', '6'), btn('ok')],
  };

  it('esquerda e direita mudam o valor (delta) sem mover o foco; cima e baixo andam; confirmar dá delta 0', () => {
    const l = layoutTree(root, viewport, 1, { fonts });
    const nav = createMenuNavigation();
    navigateMenu(l, 'nivel', 'right', nav);
    expect([nav.focusedId, nav.activated, nav.delta]).toEqual(['nivel', 'opt:nivel', 1]);
    navigateMenu(l, 'nivel', 'left', nav);
    expect([nav.focusedId, nav.activated, nav.delta]).toEqual(['nivel', 'opt:nivel', -1]);
    navigateMenu(l, 'nivel', 'down', nav);
    expect([nav.focusedId, nav.activated, nav.delta]).toEqual(['bots', null, 0]);
    navigateMenu(l, 'bots', 'confirm', nav);
    expect([nav.activated, nav.delta]).toEqual(['opt:bots', 0]);
    // Num botão comum, esquerda e direita continuam movendo o foco (aqui não há vizinho à esquerda: fica).
    navigateMenu(l, 'ok', 'left', nav);
    expect([nav.focusedId, nav.activated, nav.delta]).toEqual(['ok', null, 0]);
  });

  it('as setas recebem o toque (-1 e +1); o rótulo, não; ficam dentro do botão, com alvo de 44 px', () => {
    const l = layoutTree(root, viewport, 1, { fonts, minTarget: 44 });
    const node = l.byId.get('nivel') as ButtonNode;
    const r = l.rects.get(node) as Rect;
    const a = new Float64Array(3);
    optionArrows(l, node, r, a);
    expect(a[0]).toBeGreaterThan(r.x + r.w / 2);
    expect(a[1]! + a[2]!).toBeLessThanOrEqual(r.x + r.w);
    expect(a[2]).toBeGreaterThanOrEqual(44);
    expect(hitOptionArrow(l, 'nivel', a[0]! + 2)).toBe(-1);
    expect(hitOptionArrow(l, 'nivel', a[1]! + 2)).toBe(1);
    expect(hitOptionArrow(l, 'nivel', r.x + 10)).toBe(0);
    expect(hitOptionArrow(l, 'ok', r.x + 10)).toBe(0);
  });

  it('desenha o rótulo à esquerda, o valor entre as setas e as setas em âmbar só com o foco', () => {
    const l = layoutTree(root, viewport, 1, { fonts });
    const focused = createDrawList();
    drawTree(l, 'nivel', focused);
    expect(syntheticGlyphText(focused)).toContain('NIVELNormal');
    const ambar = drawnCommands(focused).filter((c) => c.op === DRAW_OP.rect && c.color === COLORS.acao);
    // Anel de foco + 2 setas de 5 degraus.
    expect(ambar.length).toBeGreaterThanOrEqual(11);
    const idle = createDrawList();
    drawTree(l, 'ok', idle);
    const nivelRect = l.rects.get(l.byId.get('nivel')!) as Rect;
    const inNivel = drawnCommands(idle).filter(
      (c) => c.op === DRAW_OP.rect && c.color === COLORS.acao && c.y >= nivelRect.y && c.y < nivelRect.y + nivelRect.h,
    );
    expect(inNivel).toHaveLength(0);
  });

  it('só leitura (M2, fase 4f): sem setas; esquerda e direita não mudam o valor; o toque não acerta seta', () => {
    const ro: UiNode = {
      kind: 'column',
      gap: 16,
      children: [option('pular', 'Espaço', { valueOnly: true }), btn('ok')],
    };
    const l = layoutTree(ro, viewport, 1, { fonts });
    const nav = createMenuNavigation();
    navigateMenu(l, 'pular', 'right', nav);
    expect([nav.activated, nav.delta]).toEqual([null, 0]);
    navigateMenu(l, 'pular', 'confirm', nav);
    expect([nav.activated, nav.delta]).toEqual(['opt:pular', 0]);
    const node = l.byId.get('pular') as ButtonNode;
    const r = l.rects.get(node) as Rect;
    expect(hitOptionArrow(l, 'pular', r.x + r.w - 10)).toBe(0);
    const out = createDrawList();
    drawTree(l, 'pular', out);
    expect(syntheticGlyphText(out)).toContain('PULAREspaço');
    // Só o anel de foco em âmbar (nada de setas).
    const ambar = drawnCommands(out).filter((c) => c.op === DRAW_OP.rect && c.color === COLORS.acao);
    expect(ambar.length).toBeLessThan(11);
  });
});

describe('abas', () => {
  it('tabPrev e tabNext pedem a troca de aba sem mexer no foco; a selecionada ganha o sublinhado âmbar', () => {
    const tabs: UiNode = {
      kind: 'row',
      gap: 8,
      children: [
        btn('partida', { variant: 'tab', selected: true, width: 200 }),
        btn('armas', { variant: 'tab', width: 200 }),
      ],
    };
    const root: UiNode = { kind: 'column', gap: 20, children: [tabs, btn('ok', { autofocus: true })] };
    const l = layoutTree(root, viewport, 1, { fonts });
    const nav = createMenuNavigation();
    navigateMenu(l, 'ok', 'tabNext', nav);
    expect([nav.focusedId, nav.tab, nav.activated]).toEqual(['ok', 1, null]);
    navigateMenu(l, 'ok', 'tabPrev', nav);
    expect(nav.tab).toBe(-1);
    const list = createDrawList();
    drawTree(l, 'ok', list);
    const sel = l.rects.get(l.byId.get('partida')!) as Rect;
    const other = l.rects.get(l.byId.get('armas')!) as Rect;
    const bars = drawnCommands(list).filter((c) => c.op === DRAW_OP.rect && c.color === COLORS.acao);
    expect(bars.some((c) => c.x >= sel.x && c.x < sel.x + sel.w && c.y + c.h === sel.y + sel.h)).toBe(true);
    expect(bars.some((c) => c.x >= other.x && c.x < other.x + other.w)).toBe(false);
  });
});

describe('coluna com rolagem', () => {
  const items = Array.from({ length: 20 }, (_, i) => btn(`i${i}`, { height: 60 }));
  const root: UiNode = { kind: 'column', id: 'lista', scroll: true, height: 400, gap: 10, children: items };

  it('a janela segue o foco com o menor deslocamento e guarda a posição por id', () => {
    const state = new Map<string, number>();
    const top = layoutTree(root, viewport, 1, { fonts, focusedId: 'i0', scrollState: state });
    expect(top.scrolls[0]!.offset).toBe(0);
    expect(top.scrolls[0]!.total).toBeGreaterThan(top.scrolls[0]!.view);
    // Descendo até o 10º: ele fica inteiro dentro da janela.
    const down = layoutTree(root, viewport, 1, { fonts, focusedId: 'i9', scrollState: state });
    const win = down.scrolls[0]!.rect;
    const r9 = down.rects.get(down.byId.get('i9')!) as Rect;
    expect(r9.y).toBeGreaterThanOrEqual(win.y);
    expect(r9.y + r9.h).toBeLessThanOrEqual(win.y + win.h);
    const offset = state.get('lista')!;
    expect(offset).toBeGreaterThan(0);
    // Voltando um item (que já está à vista), a janela não mexe.
    const back = layoutTree(root, viewport, 1, { fonts, focusedId: 'i8', scrollState: state });
    expect(back.scrolls[0]!.offset).toBe(offset);
    // O último: a janela para no fim do conteúdo.
    const end = layoutTree(root, viewport, 1, { fonts, focusedId: 'i19', scrollState: state });
    expect(end.scrolls[0]!.offset).toBe(end.scrolls[0]!.total - end.scrolls[0]!.view);
  });

  it('o que sai da janela é recortado e não recebe toque; a barrinha aparece à direita', () => {
    const state = new Map<string, number>();
    const l = layoutTree(root, viewport, 1, { fonts, focusedId: 'i0', scrollState: state });
    const win = l.scrolls[0]!.rect;
    const hidden = l.rects.get(l.byId.get('i15')!) as Rect;
    expect(hidden.y).toBeGreaterThan(win.y + win.h);
    expect(hitTest(l, hidden.x + 5, hidden.y + 5)).toBeNull();
    const shown = l.rects.get(l.byId.get('i1')!) as Rect;
    expect(hitTest(l, shown.x + 5, shown.y + 5)).toBe('i1');
    const list = createDrawList();
    drawTree(l, 'i0', list);
    const cs = drawnCommands(list);
    expect(cs.filter((c) => c.op === DRAW_OP.clipPush)).toHaveLength(1);
    expect(cs.filter((c) => c.op === DRAW_OP.clipPop)).toHaveLength(1);
    expect(cs.some((c) => c.op === DRAW_OP.rect && c.x > win.x + win.w && c.color === COLORS.textoBaixo)).toBe(true);
  });

  it('sem passar da janela, nada de barrinha nem deslocamento', () => {
    const short: UiNode = {
      kind: 'column',
      id: 'curta',
      scroll: true,
      height: 400,
      gap: 10,
      children: items.slice(0, 3),
    };
    const l = layoutTree(short, viewport, 1, { fonts, focusedId: 'i2', scrollState: new Map() });
    expect(l.scrolls[0]!.offset).toBe(0);
    const list = createDrawList();
    drawTree(l, 'i2', list);
    expect(drawnCommands(list).some((c) => c.op === DRAW_OP.rect && c.color === COLORS.textoBaixo)).toBe(false);
  });
});
