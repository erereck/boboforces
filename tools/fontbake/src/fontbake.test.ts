import { brotliCompressSync } from 'node:zlib';
import { parseFontPack } from '@boboforces/ui';
import { describe, expect, it } from 'vitest';
import { UI_CODEPOINTS } from './charset.ts';
import { buildFontPack, MIN_KERNING, stringifyFontPack, toFontFile, type BmFontJson } from './pack.ts';
import { decodePngRgba, encodePngRgba, stackVertical } from './png.ts';
import { cmapCodepoints, fontName } from './sfnt.ts';
import { buildSfnt, woff2ToSfnt } from './woff2.ts';

// Tudo aqui é SINTÉTICO: fontes de mentira montadas byte a byte (nada de fonte de terceiros em fixture).

class Bytes {
  readonly out: number[] = [];
  u8(...v: number[]): this {
    for (const x of v) this.out.push(x & 0xff);
    return this;
  }
  u16(...v: number[]): this {
    for (const x of v) this.u8(x >> 8, x);
    return this;
  }
  u32(...v: number[]): this {
    for (const x of v) this.u16(x >>> 16, x & 0xffff);
    return this;
  }
  bytes(): Uint8Array {
    return new Uint8Array(this.out);
  }
}

const u16 = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
const i16 = (b: Uint8Array, o: number) => (u16(b, o) << 16) >> 16;

function sfntTables(font: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const n = u16(font, 4);
  const view = new DataView(font.buffer, font.byteOffset);
  for (let i = 0; i < n; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(...font.subarray(rec, rec + 4));
    out.set(tag, font.subarray(view.getUint32(rec + 8), view.getUint32(rec + 8) + view.getUint32(rec + 12)));
  }
  return out;
}

/** Lê os pontos de um glifo simples do glyf padrão (o inverso do que o decodificador escreve). */
function readSimpleGlyph(g: Uint8Array): { points: [number, number, boolean][]; bbox: number[] } {
  const contours = i16(g, 0);
  const bbox = [i16(g, 2), i16(g, 4), i16(g, 6), i16(g, 8)];
  let o = 10;
  let total = 0;
  for (let c = 0; c < contours; c++, o += 2) total = u16(g, o) + 1;
  o += 2 + u16(g, o);
  const flags = Array.from(g.subarray(o, o + total));
  o += total;
  const xs: number[] = [];
  let x = 0;
  for (const f of flags) {
    if (f & 0x02) x += f & 0x10 ? g[o++]! : -g[o++]!;
    else if (!(f & 0x10)) ((x += i16(g, o)), (o += 2));
    xs.push(x);
  }
  const points: [number, number, boolean][] = [];
  let y = 0;
  flags.forEach((f, i) => {
    if (f & 0x04) y += f & 0x20 ? g[o++]! : -g[o++]!;
    else if (!(f & 0x20)) ((y += i16(g, o)), (o += 2));
    points.push([xs[i]!, y, (f & 1) === 1]);
  });
  return { points, bbox };
}

function syntheticWoff2(): Uint8Array {
  const head = new Uint8Array(54); // indexToLocFormat (offset 50) = 0: loca curta
  // glyf transformado: glifo 0 vazio, 1 = triângulo (1 contorno, 3 pontos), 2 = composto do 1 deslocado.
  const nContour = new Bytes().u16(0, 1, 0xffff).bytes();
  const nPoints = new Bytes().u8(3).bytes();
  const flagStream = new Bytes().u8(11, 0x80 | 1, 85).bytes(); // (+10,0) · (0,+100) fora da curva · (+50,−100)
  const glyphStream = new Bytes().u8(10, 100, 49, 99, 0).bytes(); // triplets + instructionLength 0
  const composite = new Bytes().u16(0x0003, 1, 5, 7).bytes(); // palavras, x/y, glifo 1, (5, 7)
  const bbox = new Bytes().u8(0x20, 0, 0, 0).u16(15, 7, 65, 107).bytes(); // bbox explícita só do glifo 2
  const streams = [nContour, nPoints, flagStream, glyphStream, composite, bbox, new Uint8Array(0)];
  const glyf = new Bytes().u16(0, 0, 3, 0);
  for (const s of streams) glyf.u32(s.length);
  for (const s of streams) glyf.u8(...s);
  const glyfBytes = glyf.bytes();
  const compressed = new Uint8Array(brotliCompressSync(Buffer.concat([head, glyfBytes])));
  const dir = new Bytes()
    .u8(1, 54) // head, sem transformação
    .u8(10, 100, glyfBytes.length) // glyf transformado (origLength, transformLength)
    .u8(11, 8, 0); // loca transformada (vazia)
  const dirBytes = dir.bytes();
  const total = 48 + dirBytes.length + compressed.length;
  const header = new Bytes().u8(0x77, 0x4f, 0x46, 0x32).u32(0x00010000, total).u16(3, 0).u32(200, compressed.length);
  header.u16(1, 0).u32(0, 0, 0, 0, 0);
  return new Uint8Array([...header.bytes(), ...dirBytes, ...compressed]);
}

describe('WOFF2 → sfnt', () => {
  const font = woff2ToSfnt(syntheticWoff2());
  const tables = sfntTables(font);

  it('reconstrói glyf e loca a partir dos fluxos transformados', () => {
    const loca = tables.get('loca') as Uint8Array;
    const glyf = tables.get('glyf') as Uint8Array;
    const offsets = [0, 1, 2, 3].map((i) => u16(loca, i * 2) * 2);
    expect(offsets[0]).toBe(0);
    expect(offsets[1]).toBe(0); // glifo 0 vazio
    expect(offsets[3]).toBe(glyf.length);
    const triangle = readSimpleGlyph(glyf.subarray(offsets[1], offsets[2]));
    expect(triangle.points).toEqual([
      [10, 0, true],
      [10, 100, false],
      [60, 0, true],
    ]);
    expect(triangle.bbox).toEqual([10, 0, 60, 100]); // calculada dos pontos
    const comp = glyf.subarray(offsets[2], offsets[3]);
    expect(i16(comp, 0)).toBe(-1);
    expect([i16(comp, 2), i16(comp, 4), i16(comp, 6), i16(comp, 8)]).toEqual([15, 7, 65, 107]);
    expect([u16(comp, 10), u16(comp, 12), i16(comp, 14), i16(comp, 16)]).toEqual([0x0003, 1, 5, 7]);
  });

  it('o sfnt sai com checksum total correto (head.checkSumAdjustment)', () => {
    const padded = new Uint8Array(Math.ceil(font.length / 4) * 4);
    padded.set(font);
    const view = new DataView(padded.buffer);
    let sum = 0;
    for (let i = 0; i < padded.length; i += 4) sum = (sum + view.getUint32(i)) >>> 0;
    expect(sum).toBe(0xb1b0afba);
  });

  it('recusa o que não é WOFF2', () => {
    expect(() => woff2ToSfnt(new Uint8Array([0, 1, 0, 0]))).toThrow(/wOF2/);
  });
});

describe('cmap e name', () => {
  // cmap formato 4 com 2 segmentos: A–C (delta) e o terminador 0xFFFF.
  const cmapSub = new Bytes()
    .u16(4, 32, 0, 4, 4, 1, 0)
    .u16(0x43, 0xffff, 0)
    .u16(0x41, 0xffff)
    .u16(-0x40 & 0xffff, 1);
  cmapSub.u16(0, 0);
  const cmap = new Bytes()
    .u16(0, 1)
    .u16(3, 1)
    .u32(12)
    .u8(...cmapSub.bytes())
    .bytes();
  const nameStr = 'Version 9.99';
  const name = new Bytes().u16(0, 1, 18).u16(3, 1, 0x409, 5, nameStr.length * 2, 0);
  for (const ch of nameStr) name.u16(ch.charCodeAt(0));
  const font = buildSfnt(
    0x00010000,
    new Map([
      ['cmap', cmap],
      ['name', name.bytes()],
    ]),
  );

  it('lista os códigos cobertos (formato 4)', () => {
    expect([...cmapCodepoints(font)].sort()).toEqual([0x41, 0x42, 0x43]);
  });

  it('lê o nome pela id', () => {
    expect(fontName(font, 5)).toBe(nameStr);
    expect(fontName(font, 4)).toBe('');
  });
});

describe('PNG do atlas', () => {
  it('ida e volta sem perda e empilhamento em tira vertical', () => {
    const a = { width: 3, height: 2, pixels: new Uint8Array(24).map((_, i) => (i * 37) & 0xff) };
    const b = { width: 3, height: 2, pixels: new Uint8Array(24).map((_, i) => 255 - i) };
    const strip = stackVertical([a, b]);
    expect(strip.height).toBe(4);
    const back = decodePngRgba(encodePngRgba(strip));
    expect(back.width).toBe(3);
    expect(back.height).toBe(4);
    expect(Array.from(back.pixels)).toEqual(Array.from(strip.pixels));
    expect(() => stackVertical([a, { ...b, width: 4 }])).toThrow(/tamanhos/);
  });
});

describe('pacote de métricas', () => {
  const bm: BmFontJson = {
    pages: ['x.png'],
    info: { face: 'Sintética', size: 30 },
    common: { lineHeight: 36, base: 30, scaleW: 512, scaleH: 256, pages: 1 },
    distanceField: { fieldType: 'msdf', distanceRange: 4 },
    chars: [
      { id: 0x48, x: 0, y: 0, width: 16, height: 25, xoffset: -2, yoffset: 7, xadvance: 14.123, page: 0 },
      { id: 0x41, x: 20, y: 0, width: 16, height: 25, xoffset: -2, yoffset: 7, xadvance: 13.5, page: 0 },
      { id: 0x78, x: 40, y: 0, width: 14, height: 18, xoffset: -2, yoffset: 14, xadvance: 11, page: 0 },
      { id: 0x20, x: 0, y: 0, width: 0, height: 0, xoffset: -2, yoffset: 28, xadvance: 6, page: 0 },
    ],
    kernings: [
      { first: 0x41, second: 0x48, amount: -1.234 },
      { first: 0x48, second: 0x41, amount: MIN_KERNING / 2 },
      { first: 0x41, second: 0x56, amount: -2 }, // "V" não está no atlas
    ],
  };

  it('converte para números planos ordenados, mede maiúscula e altura-x e limpa o kerning', () => {
    const file = toFontFile(bm, { layer: 1, name: 'Sintética', version: '1.0', missing: [0x100] });
    expect(file.glyphs.length).toBe(4 * 8);
    expect(file.glyphs.slice(0, 8)).toEqual([0x20, 0, 0, 0, 0, -2, 28, 6]);
    expect(file.glyphs[8 * 2 + 7]).toBe(14.12);
    // pad = 2: topo do H = 7 + 2 = 9 → maiúscula = 30 − 9 = 21; topo do x = 16 → altura-x 14.
    expect(file.capHeight).toBe(21);
    expect(file.xHeight).toBe(14);
    expect(file.kerning).toEqual([0x41, 0x48, -1.23]);
    expect(file.missing).toEqual([0x100]);
  });

  it('o JSON gerado é lido pelo parseFontPack do ui', () => {
    const fonts = {
      display: toFontFile(bm, { layer: 0, name: 'D', version: '1', missing: [] }),
      hud: toFontFile(bm, { layer: 1, name: 'H', version: '1', missing: [] }),
    };
    const json = stringifyFontPack(buildFontPack(fonts, { width: 512, height: 256, layers: 2, image: 'a.png' }));
    const pack = parseFontPack(JSON.parse(json));
    expect(pack.fonts.hud.layer).toBe(1);
    expect(pack.fonts.display.kerning(0x41, 0x48)).toBe(-1.23);
    expect(pack.fonts.display.glyphIndex(0x78)).toBeGreaterThanOrEqual(0);
  });

  it('mais de uma página é erro (o texture array espera uma camada por fonte)', () => {
    expect(() =>
      toFontFile({ ...bm, common: { ...bm.common, pages: 2 } }, { layer: 0, name: 'X', version: '', missing: [] }),
    ).toThrow(/páginas/);
  });

  it('conjunto de glifos: ASCII, Latin-1, Latin Extended-A e pontuação, sem controles', () => {
    expect(UI_CODEPOINTS).toContain(0xe3); // ã
    expect(UI_CODEPOINTS).toContain(0x17e); // ž
    expect(UI_CODEPOINTS).toContain(0x2026); // …
    expect(UI_CODEPOINTS.some((c) => c < 0x20 || (c >= 0x7f && c < 0xa0))).toBe(false);
    expect(new Set(UI_CODEPOINTS).size).toBe(UI_CODEPOINTS.length);
  });
});
