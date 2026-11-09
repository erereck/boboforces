import { describe, expect, it } from 'vitest';
import { layoutTree, type LayoutResult } from './layout.ts';
import { settingsScreen } from './screens/settings.ts';
import { titleScreen } from './screens/title.ts';
import { syntheticFontPack } from './test-fixtures.ts';
import { MIN_TEXT, MIN_TOUCH_TARGET } from './tokens.ts';
import type { Rect, UiNode } from './tree.ts';

const fonts = syntheticFontPack().fonts;

function rectOf(layout: LayoutResult, id: string): Rect {
  const node = layout.byId.get(id);
  if (!node) throw new Error(`nó ${id} ausente`);
  return layout.rects.get(node) as Rect;
}

function inside(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('layout por âncoras', () => {
  const box = (anchor: NonNullable<UiNode['anchor']>, x = 0, y = 0): UiNode => ({
    kind: 'box',
    id: anchor,
    anchor,
    x,
    y,
    width: 100,
    height: 50,
  });

  it('a raiz cobre a viewport e os filhos ficam na área útil (margem da tela)', () => {
    const root: UiNode = { kind: 'box', id: 'root', padding: 20, children: [box('topLeft'), box('bottomRight')] };
    const l = layoutTree(root, { x: 0, y: 0, w: 1280, h: 720 });
    expect(l.scale).toBe(1);
    expect(rectOf(l, 'root')).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
    expect(l.content).toEqual({ x: 20, y: 20, w: 1240, h: 680 });
    expect(rectOf(l, 'topLeft')).toEqual({ x: 20, y: 20, w: 100, h: 50 });
    expect(rectOf(l, 'bottomRight')).toEqual({ x: 1160, y: 650, w: 100, h: 50 });
  });

  it('escala pela referência 1280×720, com deslocamento e viewport fora da origem', () => {
    const root: UiNode = { kind: 'box', padding: 0, children: [box('center', 10, -20), box('top')] };
    // Quadrante inferior direito de uma tela 1280×720 dividida em 4.
    const l = layoutTree(root, { x: 640, y: 360, w: 640, h: 360 });
    expect(l.scale).toBe(0.5);
    expect(rectOf(l, 'center')).toEqual({ x: 640 + 320 - 25 + 5, y: 360 + 180 - 12.5 - 10 + 0.5, w: 50, h: 25 });
    expect(rectOf(l, 'top')).toEqual({ x: 935, y: 360, w: 50, h: 25 });
  });

  it('a safe area soma com a margem: vale a maior por lado', () => {
    const root: UiNode = { kind: 'box', padding: 10, children: [box('topLeft'), box('bottomRight')] };
    const l = layoutTree(root, { x: 0, y: 0, w: 1280, h: 720 }, 1, {
      safeArea: { top: 0, right: 48, bottom: 30, left: 0 },
    });
    expect(l.content).toEqual({ x: 10, y: 10, w: 1280 - 10 - 48, h: 720 - 10 - 30 });
    expect(rectOf(l, 'bottomRight')).toMatchObject({ x: 1280 - 48 - 100, y: 720 - 30 - 50 });
  });

  it('linha e coluna: gap, padding e alinhamento cruzado', () => {
    const root: UiNode = {
      kind: 'box',
      padding: 0,
      children: [
        {
          kind: 'column',
          id: 'col',
          padding: 8,
          gap: 10,
          align: 'center',
          children: [
            { kind: 'box', id: 'a', width: 200, height: 40 },
            { kind: 'box', id: 'b', width: 100, height: 40 },
          ],
        },
        {
          kind: 'row',
          id: 'row',
          anchor: 'bottomLeft',
          gap: 6,
          align: 'stretch',
          children: [
            { kind: 'box', id: 'c', width: 30, height: 60 },
            { kind: 'box', id: 'd', width: 30 },
          ],
        },
      ],
    };
    const l = layoutTree(root, { x: 0, y: 0, w: 1280, h: 720 });
    expect(rectOf(l, 'col')).toEqual({ x: 0, y: 0, w: 216, h: 106 });
    expect(rectOf(l, 'a')).toEqual({ x: 8, y: 8, w: 200, h: 40 });
    expect(rectOf(l, 'b')).toEqual({ x: 58, y: 58, w: 100, h: 40 });
    expect(rectOf(l, 'row')).toEqual({ x: 0, y: 660, w: 66, h: 60 });
    expect(rectOf(l, 'd')).toEqual({ x: 36, y: 660, w: 30, h: 60 });
  });

  it('texto mede pela fonte; o piso de texto e o alvo mínimo valem em px reais', () => {
    const root: UiNode = {
      kind: 'box',
      padding: 0,
      children: [
        { kind: 'text', id: 't', text: { literal: 'ABC' }, style: 'body' },
        { kind: 'button', id: 'b', anchor: 'bottomLeft', text: { literal: 'Ok' }, action: 'ok' },
      ],
    };
    const l = layoutTree(root, { x: 0, y: 0, w: 640, h: 360 }, 1, { fonts, minTextPx: 16, minTarget: 44 });
    const text = l.texts.get(l.byId.get('t') as UiNode);
    // body = 26 px de referência × 0,5 = 13, sobe para o piso 16.
    expect(text?.px).toBe(16);
    expect(text?.width).toBeCloseTo((3 * 12 * 16) / 20);
    expect(rectOf(l, 'b').h).toBe(44);
  });

  it('botão sem id não entra no foco; desabilitado também não', () => {
    const root: UiNode = {
      kind: 'column',
      children: [
        { kind: 'button', text: { literal: 'a' }, action: 'a' },
        { kind: 'button', id: 'b', text: { literal: 'b' }, action: 'b', disabled: true },
        { kind: 'button', id: 'c', text: { literal: 'c' }, action: 'c' },
      ],
    };
    const l = layoutTree(root, { x: 0, y: 0, w: 1280, h: 720 }, 1, { fonts });
    expect(l.focusable.map((b) => b.id)).toEqual(['c']);
  });
});

describe('telas nas resoluções de referência (regra 17)', () => {
  const cases = [
    { name: '640×360 (viewport de 4 jogadores)', w: 640, h: 360, opts: { minTextPx: MIN_TEXT.switchSplit } },
    {
      name: '667×375 (celular, toque)',
      w: 667,
      h: 375,
      opts: { minTextPx: MIN_TEXT.phone, minTarget: MIN_TOUCH_TARGET },
    },
    { name: '1280×720 (Switch/TV)', w: 1280, h: 720, opts: { minTextPx: MIN_TEXT.tv } },
    { name: '2340×1080 (celular largo, DPR 3)', w: 2340, h: 1080, opts: { minTarget: MIN_TOUCH_TARGET * 3 } },
  ];
  const screens = [
    { id: 'title', tree: titleScreen.build({ version: '0.0.1', codename: 'Primeiro Bloco' }) },
    { id: 'settings', tree: settingsScreen.build(null) },
  ];

  for (const c of cases) {
    for (const s of screens) {
      it(`${s.id} em ${c.name}: tudo dentro da área útil, sem sobreposição de focáveis`, () => {
        const l = layoutTree(s.tree, { x: 0, y: 0, w: c.w, h: c.h }, 1, { fonts, ...c.opts });
        for (const node of l.order) {
          if (node === s.tree) continue;
          const r = l.rects.get(node) as Rect;
          expect(
            inside(r, l.content),
            `${node.id ?? node.kind} ${JSON.stringify(r)} fora de ${JSON.stringify(l.content)}`,
          ).toBe(true);
        }
        for (let i = 0; i < l.focusable.length; i++) {
          for (let j = i + 1; j < l.focusable.length; j++) {
            expect(
              overlaps(l.rects.get(l.focusable[i] as UiNode) as Rect, l.rects.get(l.focusable[j] as UiNode) as Rect),
            ).toBe(false);
          }
        }
        if (c.opts.minTarget)
          for (const b of l.focusable) expect((l.rects.get(b) as Rect).h).toBeGreaterThanOrEqual(c.opts.minTarget);
        for (const t of l.texts.values()) if (c.opts.minTextPx) expect(t.px).toBeGreaterThanOrEqual(c.opts.minTextPx);
      });
    }
  }

  it('título: logo acima dos botões, JOGAR acima de Mudar, rodapé embaixo', () => {
    const l = layoutTree(screens[0]!.tree, { x: 0, y: 0, w: 1280, h: 720 }, 1, { fonts });
    const logo = rectOf(l, 'logo');
    const play = rectOf(l, 'play');
    const settings = rectOf(l, 'change');
    const version = rectOf(l, 'version');
    expect(logo.y + logo.h).toBeLessThan(play.y);
    expect(play.y + play.h).toBeLessThan(settings.y);
    expect(play.w).toBe(settings.w);
    expect(version.y + version.h).toBe(l.content.y + l.content.h);
    expect(version.x + version.w).toBe(l.content.x + l.content.w);
    expect(l.texts.get(l.byId.get('version') as UiNode)?.text).toBe('v0.0.1 · Primeiro Bloco');
    expect(l.texts.get(l.byId.get('play') as UiNode)?.text).toBe('JOGAR');
    expect(l.texts.get(l.byId.get('change') as UiNode)?.text).toBe('MUDAR');
  });
});
