import { describe, expect, it } from 'vitest';
import { createDrawList, DRAW_FLOATS_PER_COMMAND, DRAW_OP, resetDrawList } from './draw-list.ts';
import { createUiAtlas, drawText, measureText, parseFontPack, textBoxHeight } from './font.ts';
import { syntheticFontPack, syntheticFontPackFile } from './test-fixtures.ts';

describe('pacote de fontes', () => {
  it('valida o formato e monta as duas fontes', () => {
    const pack = syntheticFontPack();
    expect(pack.atlas).toMatchObject({ width: 512, height: 256, layers: 2 });
    expect(pack.fonts.display.layer).toBe(0);
    expect(pack.fonts.hud.layer).toBe(1);
    expect(pack.fonts.display.glyphIndex(0x41)).toBeGreaterThanOrEqual(0);
    expect(pack.fonts.display.glyphIndex(0x4e00)).toBe(-1);
    expect(pack.fonts.display.kerning(0x41, 0x56)).toBe(-2);
    expect(pack.fonts.display.kerning(0x56, 0x41)).toBe(0);
  });

  it('recusa pacote quebrado com mensagem clara', () => {
    const file = syntheticFontPackFile();
    expect(() => parseFontPack({ ...file, format: 'boboforces/ui-fonts@9' })).toThrow(/formato/);
    expect(() => parseFontPack({ ...file, fonts: { display: file.fonts.display } })).toThrow(/hud/);
    const badGlyphs = { ...file.fonts.hud, glyphs: [1, 2, 3] };
    expect(() => parseFontPack({ ...file, fonts: { ...file.fonts, hud: badGlyphs } })).toThrow(/glyphs/);
    const badLayer = { ...file.fonts.hud, layer: 5 };
    expect(() => parseFontPack({ ...file, fonts: { ...file.fonts, hud: badLayer } })).toThrow(/camada/);
  });

  it('atlas da UI confere o tamanho dos pixels e as faixas MSDF', () => {
    const pack = syntheticFontPack();
    const atlas = createUiAtlas(pack, new Uint8Array(512 * 256 * 2 * 4));
    expect(atlas.msdfRanges).toEqual([4, 4]);
    expect(atlas.spriteBase).toBe(2);
    expect(() => createUiAtlas(pack, new Uint8Array(10))).toThrow(/bytes/);
  });
});

describe('medida e desenho de texto', () => {
  const { display } = syntheticFontPack().fonts;

  it('mede com escala, kerning e tracking', () => {
    // Em = 20 px no atlas; desenhar a 40 px dobra tudo.
    expect(measureText(display, 'AB', 20)).toBe(24);
    expect(measureText(display, 'AB', 40)).toBe(48);
    expect(measureText(display, 'AV', 20)).toBe(22);
    expect(measureText(display, 'W', 20)).toBe(18);
    expect(measureText(display, 'AB', 20, 0.1)).toBeCloseTo(26);
    expect(measureText(display, '', 20)).toBe(0);
    expect(textBoxHeight(display, 20)).toBe(14 + 24 - 18);
  });

  it('caractere ausente cai no "?" (mesmo avanço)', () => {
    expect(measureText(display, '中', 20)).toBe(measureText(display, '?', 20));
  });

  it('compõe ™ em duas letras pequenas em sobrescrito sem precisar refazer o atlas', () => {
    const dl = createDrawList(16);
    resetDrawList(dl, 1280, 720);
    const width = drawText(dl, display, 'EriLab™', 100, 50, 20, 0xffffffff);
    expect(width).toBeCloseTo(measureText(display, 'EriLab™', 20));
    expect(dl.count).toBe(8); // 6 letras normais + T e M para o ™
    const tmGlyph = 6 * DRAW_FLOATS_PER_COMMAND;
    expect(dl.geom[tmGlyph + 2]).toBeCloseTo(10 * 0.48);
    expect(dl.geom[tmGlyph + 3]).toBeCloseTo(20 * 0.48);
    expect(dl.geom[tmGlyph + 1]).toBeLessThan(dl.geom[1] as number); // símbolo junto ao topo da letra E
  });

  it('empilha um glifo por letra visível, com UV do atlas e topo das maiúsculas em capTop', () => {
    const dl = createDrawList(64);
    resetDrawList(dl, 1280, 720);
    const width = drawText(dl, display, 'A V', 100, 50, 40, 0xffffffff);
    expect(dl.count).toBe(2); // o espaço não desenha
    expect(width).toBeCloseTo(measureText(display, 'A V', 40));
    expect(dl.ops[0]).toBe(DRAW_OP.glyph);
    expect(dl.textures[0]).toBe(0);
    const g = dl.geom;
    // x = pen + xoffset·escala (1·2); linha começa em capTop − (base − capHeight)·escala = 50 − 8 = 42; y = 42 + 2·2.
    expect(g[0]).toBe(102);
    expect(g[1]).toBe(46);
    expect(g[2]).toBe(20);
    expect(g[3]).toBe(40);
    const gi = display.glyphIndex(0x41) * 8;
    expect(g[4]).toBeCloseTo((display.glyphData[gi + 1] as number) / 512);
    expect(g[7]).toBeCloseTo(((display.glyphData[gi + 2] as number) + 20) / 256);
    // O "V" vem depois de A + espaço (2 avanços de 12·2), sem kerning (o par é A-espaço, não A-V).
    expect(g[DRAW_FLOATS_PER_COMMAND]).toBe(100 + 48 + 2);
  });
});
