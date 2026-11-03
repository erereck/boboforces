import { describe, expect, it } from 'vitest';
import { drawTree } from './draw.ts';
import { createDrawList, DRAW_FLOATS_PER_COMMAND, DRAW_OP, resetDrawList, type DrawList } from './draw-list.ts';
import { layoutTree } from './layout.ts';
import { titleScreen } from './screens/title.ts';
import { syntheticFontPack } from './test-fixtures.ts';
import { COLORS } from './tokens.ts';
import type { Rect, UiNode } from './tree.ts';

const fonts = syntheticFontPack().fonts;
const viewport = { x: 0, y: 0, w: 1280, h: 720 };
const layout = layoutTree(titleScreen.build({ version: '0.0.1', codename: 'Primeiro Bloco' }), viewport, 1, { fonts });

function commands(dl: DrawList, op: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < dl.count; i++) if (dl.ops[i] === op) out.push(i);
  return out;
}

function draw(focusedId: string | null): DrawList {
  const dl = createDrawList();
  resetDrawList(dl, viewport.w, viewport.h);
  drawTree(layout, focusedId, dl);
  return dl;
}

describe('drawTree', () => {
  it('fundo primeiro, cobrindo a viewport inteira', () => {
    const dl = draw('play');
    expect(dl.ops[0]).toBe(DRAW_OP.rect);
    expect(Array.from(dl.geom.subarray(0, 4))).toEqual([0, 0, 1280, 720]);
    expect(dl.colors[0]).toBe(COLORS.bunker);
    expect(dl.overflow).toBe(0);
  });

  it('um glifo por letra visível dos textos da tela', () => {
    const dl = draw('play');
    let visible = 0;
    for (const t of layout.texts.values()) visible += t.text.replace(/\s/g, '').length;
    expect(commands(dl, DRAW_OP.glyph).length).toBe(visible);
  });

  it('o contorno de foco (cor de ação, só contorno) segue o botão focado', () => {
    const ringOf = (dl: DrawList) =>
      commands(dl, DRAW_OP.rect).filter(
        (i) => dl.colors[i] === COLORS.acao && (dl.geom[i * DRAW_FLOATS_PER_COMMAND + 5] as number) > 0,
      );
    const play = layout.rects.get(layout.byId.get('play') as UiNode) as Rect;
    const settings = layout.rects.get(layout.byId.get('settings') as UiNode) as Rect;

    const onPlay = draw('play');
    const ringPlay = ringOf(onPlay);
    expect(ringPlay.length).toBe(1);
    const g = (ringPlay[0] as number) * DRAW_FLOATS_PER_COMMAND;
    expect(onPlay.geom[g]).toBeLessThan(play.x);
    expect((onPlay.geom[g + 1] as number) + (onPlay.geom[g + 3] as number)).toBeGreaterThan(play.y + play.h);
    expect(onPlay.geom[g + 4]).toBeGreaterThan(0); // chanfro

    // Em Ajustes (secundário): um contorno só, em volta de Ajustes.
    const onSettings = draw('settings');
    const rings = ringOf(onSettings);
    expect(rings.length).toBe(1);
    expect(onSettings.geom[(rings[0] as number) * DRAW_FLOATS_PER_COMMAND + 1]).toBeLessThan(settings.y);
  });

  it('sem fontes, desenha só as formas (NullRenderer e testes não quebram)', () => {
    const bare = layoutTree(titleScreen.build({ version: '1', codename: 'x' }), viewport);
    const dl = createDrawList();
    resetDrawList(dl, 1280, 720);
    drawTree(bare, 'play', dl);
    expect(commands(dl, DRAW_OP.glyph).length).toBe(0);
    expect(dl.count).toBeGreaterThan(3);
  });

  it('desenhar de novo dá exatamente a mesma lista (estável frame a frame)', () => {
    const a = draw('play');
    const b = draw('play');
    expect(b.count).toBe(a.count);
    expect(Array.from(b.geom.subarray(0, b.count * DRAW_FLOATS_PER_COMMAND))).toEqual(
      Array.from(a.geom.subarray(0, a.count * DRAW_FLOATS_PER_COMMAND)),
    );
  });
});
