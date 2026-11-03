import { describe, expect, it } from 'vitest';
import { createDrawList, DRAW_FLOATS_PER_COMMAND, DRAW_OP, pushGlyph, pushRect, resetDrawList } from './draw-list.ts';
import { STRINGS_PT_BR } from './strings.pt-BR.ts';
import { formatDecimal, formatInt, pad2, t } from './text.ts';
import { COLORS, rgba, uiScale } from './tokens.ts';

describe('textos', () => {
  it('t() busca a chave e troca parâmetros com números pt-BR', () => {
    expect(t('menu.play')).toBe('Jogar');
    expect(t('hud.ammo', { clip: 30, reserve: 1200 })).toBe('30 / 1.200');
    expect(t('hud.timeLeft', { minutes: 9, seconds: pad2(5) })).toBe('9:05');
  });

  it('nenhum valor vazio na tabela', () => {
    for (const value of Object.values(STRINGS_PT_BR)) expect(value.trim().length).toBeGreaterThan(0);
  });

  it('formatação própria (sem Intl)', () => {
    expect(formatInt(0)).toBe('0');
    expect(formatInt(999)).toBe('999');
    expect(formatInt(1234567)).toBe('1.234.567');
    expect(formatInt(-1000)).toBe('-1.000');
    expect(formatDecimal(1.5, 1)).toBe('1,5');
    expect(formatDecimal(-0.04, 1)).toBe('0,0');
    expect(formatDecimal(1234.567, 2)).toBe('1.234,57');
  });
});

describe('tema', () => {
  it('cores em 0xRRGGBBAA', () => {
    expect(rgba(0xf2b233)).toBe(0xf2b233ff);
    expect(COLORS.hudFundo & 0xff).toBe(Math.round(0.7 * 255));
    expect(uiScale(640, 360)).toBe(0.5);
  });
});

describe('DrawList', () => {
  it('empilha comandos em typed arrays e conta o estouro', () => {
    const dl = createDrawList(2);
    resetDrawList(dl, 1280, 720);
    pushRect(dl, 10, 20, 30, 40, COLORS.acao);
    pushGlyph(dl, 0, 0, 8, 8, 0.1, 0.2, 0.3, 0.4, COLORS.texto, 1);
    pushRect(dl, 0, 0, 1, 1, 0);
    expect(dl.count).toBe(2);
    expect(dl.overflow).toBe(1);
    expect(dl.ops[0]).toBe(DRAW_OP.rect);
    expect(Array.from(dl.geom.subarray(0, 4))).toEqual([10, 20, 30, 40]);
    expect(dl.colors[0]).toBe(COLORS.acao);
    expect(dl.textures[1]).toBe(1);
    expect(dl.geom[DRAW_FLOATS_PER_COMMAND + 4]).toBeCloseTo(0.1);
    resetDrawList(dl, 640, 360);
    expect(dl.count).toBe(0);
    expect(dl.overflow).toBe(0);
  });
});
