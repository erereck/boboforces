import { describe, expect, it } from 'vitest';
import { createDrawList, DRAW_OP } from './draw-list.ts';
import { drawText } from './font.ts';
import { numberWidth, paintBar, paintIcon, paintNumber, paintText, textWidth } from './paint.ts';
import { drawnCommands, syntheticFontPack, syntheticGlyphText } from './test-fixtures.ts';
import { formatDecimal, NUMBER_CODES_MAX, numberToCodes, templateParts } from './text.ts';

const fonts = syntheticFontPack().fonts;

function codesToString(value: number, places: number, minInt = 1): string {
  const codes = new Uint16Array(NUMBER_CODES_MAX);
  const n = numberToCodes(value, places, codes, minInt);
  return String.fromCharCode(...codes.subarray(0, n));
}

describe('números sem string (HUD e F2)', () => {
  it('numberToCodes escreve igual ao formatDecimal (milhar com ponto, decimal com vírgula)', () => {
    for (const v of [0, 7, 999, 1000, 1234567, -1000, 1.5, -0.04, 1234.567, 29.97, 0.005, -12.345]) {
      for (const places of [0, 1, 2, 3]) expect(codesToString(v, places)).toBe(formatDecimal(v, places));
    }
    expect(codesToString(5, 0, 2)).toBe('05');
    expect(codesToString(Number.NaN, 1)).toBe('—');
    expect(codesToString(Number.POSITIVE_INFINITY, 0)).toBe('—');
    expect(codesToString(-999999999999999, 0)).toBe('-999.999.999.999.999');
  });

  it('templateParts corta o modelo da tabela nos parâmetros', () => {
    expect(templateParts('hud.ammo', ['clip', 'reserve'])).toEqual(['', ' / ', '']);
    expect(templateParts('hud.timeLeft', ['minutes', 'seconds'])).toEqual(['', ':', '']);
    expect(templateParts('loading.ms', ['value'])).toEqual(['', ' ms']);
    expect(() => templateParts('menu.play', ['x'])).toThrow(/sem \{x\}/);
  });

  it('paintNumber desenha os mesmos glifos que drawText(formatDecimal) e alinha à direita e ao centro', () => {
    const a = createDrawList();
    const b = createDrawList();
    const w = paintNumber(a, fonts.hud, 1234.5, 1, 100, 50, 20, 0xffffffff);
    const w2 = drawText(b, fonts.hud, '1.234,5', 100, 50, 20, 0xffffffff);
    expect(w).toBe(Math.ceil(w2));
    expect(Array.from(a.geom.subarray(0, a.count * 8))).toEqual(Array.from(b.geom.subarray(0, b.count * 8)));
    expect(numberWidth(fonts.hud, 1234.5, 1, 20)).toBeCloseTo(w2);
    const right = createDrawList();
    paintNumber(right, fonts.hud, 42, 0, 300, 0, 20, 0xffffffff, 1);
    const last = drawnCommands(right).at(-1)!;
    expect(last.x + last.w).toBeLessThanOrEqual(300);
    expect(syntheticGlyphText(right)).toBe('42');
    const centered = createDrawList();
    paintText(centered, fonts.hud, 'AB', 200, 0, 20, 0xffffffff, 0, 0.5);
    expect(drawnCommands(centered)[0]!.x).toBeCloseTo(200 - textWidth(fonts.hud, 'AB', 20) / 2 + 1, 0);
  });

  it('sem fonte: estima a largura e não desenha', () => {
    const l = createDrawList();
    expect(paintText(l, null, 'ABCD', 0, 0, 20, 0xffffffff)).toBe(40);
    expect(paintNumber(l, null, 1000, 0, 0, 0, 20, 0xffffffff)).toBe(50);
    expect(l.count).toBe(0);
  });
});

describe('ícones e barras', () => {
  it('▲ ● ■ ◆ em faixas de pixel dentro do quadrado', () => {
    const counts = [0, 1, 2, 3].map((shape) => {
      const l = createDrawList();
      paintIcon(l, shape, 10, 20, 14, 0xff0000ff);
      for (const c of drawnCommands(l)) {
        expect(c.op).toBe(DRAW_OP.rect);
        expect(c.x).toBeGreaterThanOrEqual(10);
        expect(c.y).toBeGreaterThanOrEqual(20);
        expect(c.x + c.w).toBeLessThanOrEqual(24);
        expect(c.y + c.h).toBeLessThanOrEqual(34);
      }
      return l.count;
    });
    expect(counts).toEqual([4, 5, 1, 7]);
  });

  it('barra: trilho inteiro e preenchimento proporcional (limitado a 0..1)', () => {
    const l = createDrawList();
    paintBar(l, 0, 0, 200, 6, 0.25, 1, 2);
    paintBar(l, 0, 10, 200, 6, 3, 1, 2);
    paintBar(l, 0, 20, 200, 6, Number.NaN, 1, 2);
    const cmds = drawnCommands(l);
    expect(cmds.map((c) => c.w)).toEqual([200, 50, 200, 200, 200]);
  });
});
