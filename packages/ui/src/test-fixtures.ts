import { DRAW_FLOATS_PER_COMMAND, DRAW_OP, type DrawList } from './draw-list.ts';
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
  for (const c of 'ÁÂÃÇÉÊÍÓÔÕÚáâãçéêíóôõú·…—') codes.push(c.charCodeAt(0));
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

/** Um comando da DrawList em forma legível (testes de layout das telas desenhadas direto na lista). */
export interface DrawnCommand {
  readonly index: number;
  readonly op: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
  readonly color: number;
  readonly texture: number;
}

export function drawnCommands(list: DrawList): DrawnCommand[] {
  const out: DrawnCommand[] = [];
  for (let i = 0; i < list.count; i++) {
    const g = i * DRAW_FLOATS_PER_COMMAND;
    out.push({
      index: i,
      op: list.ops[i] as number,
      x: list.geom[g] as number,
      y: list.geom[g + 1] as number,
      w: list.geom[g + 2] as number,
      h: list.geom[g + 3] as number,
      u0: list.geom[g + 4] as number,
      v0: list.geom[g + 5] as number,
      u1: list.geom[g + 6] as number,
      v1: list.geom[g + 7] as number,
      color: list.colors[i] as number,
      texture: list.textures[i] as number,
    });
  }
  return out;
}

/**
 * Lê de volta o texto desenhado com a fonte sintética (pela posição do glifo no atlas de mentira), na ordem da
 * lista, sem espaços. Serve para conferir O QUE a tela escreveu, não só onde.
 */
export function syntheticGlyphText(list: DrawList, atlasWidth = 512, atlasHeight = 256): string {
  const codes = defaultCodes();
  const byCell = new Map<number, number>();
  codes.forEach((code, i) => byCell.set((i % 32) * 14 * 10000 + Math.floor(i / 32) * 24, code));
  let text = '';
  for (const c of drawnCommands(list)) {
    if (c.op !== DRAW_OP.glyph) continue;
    const gx = Math.round(c.u0 * atlasWidth);
    const gy = Math.round(c.v0 * atlasHeight);
    const code = byCell.get(gx * 10000 + gy);
    text += code === undefined ? '�' : String.fromCharCode(code);
  }
  return text;
}
