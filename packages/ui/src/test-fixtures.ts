import { FONT_PACK_FORMAT, parseFontPack, type FontFile, type FontPack, type FontPackFile } from './font.ts';

/**
 * Fonte SINTÉTICA para testes (nada de fonte de terceiros em fixture): todo glifo é uma caixa de 10×20 px no atlas
 * com avanço de 12 px, em = 20 px; o `W` é mais largo (avanço 18) e o par "AV" tem kerning de −2 px.
 */
export function syntheticFontFile(layer: number, codes: readonly number[] = defaultCodes()): FontFile {
  const glyphs: number[] = [];
  codes.forEach((code, i) => {
    const space = code === 0x20;
    const wide = code === 0x57;
    glyphs.push(code, (i % 32) * 14, Math.floor(i / 32) * 24, space ? 0 : 10, space ? 0 : 20, 1, 2, wide ? 18 : 12);
  });
  return {
    layer,
    name: `Sintética ${layer}`,
    version: '1.0',
    size: 20,
    distanceRange: 4,
    lineHeight: 24,
    base: 18,
    capHeight: 14,
    xHeight: 10,
    glyphs,
    kerning: [0x41, 0x56, -2],
    missing: [],
  };
}

function defaultCodes(): number[] {
  const codes: number[] = [];
  for (let c = 0x20; c <= 0x7e; c++) codes.push(c);
  for (const c of 'ÁÂÃÇÉÊÍÓÔÕÚáâãçéêíóôõú·…') codes.push(c.charCodeAt(0));
  return codes;
}

export function syntheticFontPackFile(): FontPackFile {
  return {
    format: FONT_PACK_FORMAT,
    atlas: { width: 512, height: 256, layers: 2, image: 'sintetico.png' },
    fonts: { display: syntheticFontFile(0), hud: syntheticFontFile(1) },
  };
}

export function syntheticFontPack(): FontPack {
  return parseFontPack(JSON.parse(JSON.stringify(syntheticFontPackFile())));
}
