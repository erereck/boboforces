import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { brotliCompressSync } from 'node:zlib';
import { COMPOSED_CHARS, parseFontPack, STRINGS_PT_BR } from '@boboforces/ui';
import { describe, expect, it } from 'vitest';
import { codepointsForRole, DISPLAY_CODEPOINTS, HUD_CODEPOINTS, isLowercaseLetter } from './charset.ts';
import {
  assertDerivedName,
  declaresReservedFontName,
  FONT_LICENSE,
  licenseFile,
  licenseSection,
  oflHeader,
  reservedFontNames,
  resolveReservedNames,
} from './license.ts';
import { buildFontPack, measuredDescent, MIN_KERNING, stringifyFontPack, toFontFile, type BmFontJson } from './pack.ts';
import { decodePngRgba, encodePngRgba, quantizeChannels, stackVertical } from './png.ts';
import { cmapCodepoints, fontName, fontVerticalMetrics } from './sfnt.ts';
import { BUDGETS, FONT_TEXT_GZIP_LEVEL } from '../../size-check/src/budgets.ts';
import { ATLAS, FONT_BUDGET_BYTES, FONT_JSON_GZIP_LEVEL, FONTS, generatorOptions, ROUND_DECIMAL } from './spec.ts';
import { buildSfnt, woff2ToSfnt } from './woff2.ts';

// Tudo aqui é SINTÉTICO: fontes de mentira montadas byte a byte e textos de licença inventados (nada de fonte de
// terceiros em fixture). Só o último bloco lê as fontes reais de assets-src/fonts/, para provar a guarda do RFN.

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

/** Tabela `name` com registros Windows/Unicode (3, 1, 0x409): id → texto. */
function nameTable(records: ReadonlyMap<number, string>): Uint8Array {
  const entries = [...records.entries()];
  const t = new Bytes().u16(0, entries.length, 6 + entries.length * 12);
  let offset = 0;
  for (const [id, text] of entries) {
    t.u16(3, 1, 0x409, id, text.length * 2, offset);
    offset += text.length * 2;
  }
  for (const [, text] of entries) for (const ch of text) t.u16(ch.charCodeAt(0));
  return t.bytes();
}

/** sfnt sintético com `head` (unitsPerEm), `OS/2` (versão, ascendente/descendente, altura-x e de maiúscula) e `name`. */
function syntheticMetricsFont(os2Version: number, names: ReadonlyMap<number, string>): Uint8Array {
  const head = new Uint8Array(54);
  new DataView(head.buffer).setUint16(18, 2000); // unitsPerEm
  const os2 = new Uint8Array(96);
  const v = new DataView(os2.buffer);
  v.setUint16(0, os2Version);
  v.setInt16(68, 1800); // sTypoAscender
  v.setInt16(70, -500); // sTypoDescender
  v.setInt16(86, 1040); // sxHeight
  v.setInt16(88, 1400); // sCapHeight
  return buildSfnt(
    0x00010000,
    new Map([
      ['head', head],
      ['OS/2', os2],
      ['name', nameTable(names)],
    ]),
  );
}

describe('métricas verticais (head e OS/2)', () => {
  it('lê unitsPerEm, ascendente/descendente tipográficos e as alturas de maiúscula e x em em (OS/2 v2+)', () => {
    const m = fontVerticalMetrics(syntheticMetricsFont(4, new Map()));
    expect(m).toEqual({ unitsPerEm: 2000, typoAscender: 0.9, typoDescender: -0.25, xHeight: 0.52, capHeight: 0.7 });
  });

  it('OS/2 antigo (v1) não tem altura de maiúscula nem x: o pack mede o atlas', () => {
    const m = fontVerticalMetrics(syntheticMetricsFont(1, new Map()));
    expect(m.capHeight).toBeNull();
    expect(m.xHeight).toBeNull();
  });
});

describe('licença (OFL 1.1) e guarda do Reserved Font Name', () => {
  it('lê o RFN do name ID 0 de uma fonte sintética em MINÚSCULAS e reprova o nome que o usa, sem diferenciar caixa', () => {
    const font = syntheticMetricsFont(
      4,
      new Map([
        [0, 'Copyright 2026 Autora Ficticia, with reserved font name "Plinto".'],
        [4, 'Plinto Bold'],
        [5, 'Version 2.010'],
      ]),
    );
    expect(fontName(font, 0)).toContain('reserved font name');
    const reserved = reservedFontNames(fontName(font, 0));
    expect(reserved).toEqual(['Plinto']);
    expect(() => assertDerivedName('BoboForces Display', reserved, 'plinto.ttf')).not.toThrow();
    expect(() => assertDerivedName('Plinto HUD', reserved, 'plinto.ttf')).toThrow(/Reserved Font Name "Plinto"/);
    expect(() => assertDerivedName('MEU PLINTO', reserved, 'plinto.ttf')).toThrow(/cláusula 3/);
  });

  it('aceita plural, aspas curvas e dois-pontos; ignora a definição do termo no corpo da licença', () => {
    expect(reservedFontNames('Copyright 2026 Fulano, with Reserved Font Names "Alfa" and "Beta Sans"')).toEqual([
      'Alfa',
      'Beta Sans',
    ]);
    expect(reservedFontNames('with Reserved Font Name: “Gama”')).toEqual(['Gama']);
    expect(reservedFontNames('"Reserved Font Name" refers to names declared above.\nDEFINITIONS')).toEqual([]);
    expect(reservedFontNames('Copyright 2026 Sem Nome Reservado')).toEqual([]);
  });

  it('aceita aspas simples (retas e curvas) com o par casado, e o apóstrofo dentro de aspas duplas não corta o nome', () => {
    const adobe = "Copyright 2026 Empresa Ficticia (http://exemplo.invalid/), with Reserved Font Name 'Source'.";
    expect(reservedFontNames(adobe)).toEqual(['Source']);
    expect(() => assertDerivedName('Source UI', resolveReservedNames(adobe), 'x.otf')).toThrow(/cláusula 3/);
    expect(reservedFontNames('with Reserved Font Name ‘Plinto’.')).toEqual(['Plinto']);
    expect(reservedFontNames('with Reserved Font Name "Bob\'s Sans".')).toEqual(["Bob's Sans"]);
  });

  it('falha fechada: declaração sem aspas lança, a menos que o RFN venha à mão; texto sem RFN passa', () => {
    const bare = 'Copyright 2026 Fulano, with Reserved Font Name Plinto.';
    expect(reservedFontNames(bare)).toEqual([]);
    expect(declaresReservedFontName(bare)).toBe(true);
    expect(() => resolveReservedNames(bare, [], 'plinto.ttf')).toThrow(/FontSpec\.reservedNames/);
    // Lista vazia (ou só espaço) explícita não cala a guarda.
    expect(() => resolveReservedNames(bare, [' '], 'plinto.ttf')).toThrow(/não lê/);
    const reserved = resolveReservedNames(bare, ['Plinto'], 'plinto.ttf');
    expect(reserved).toEqual(['Plinto']);
    expect(() => assertDerivedName('Plinto HUD', reserved, 'plinto.ttf')).toThrow(/cláusula 3/);
    // À mão soma aos extraídos, sem repetir.
    expect(resolveReservedNames('with Reserved Font Name "Delta"', ['delta', 'Eco'])).toEqual(['Delta', 'Eco']);
    // OFL.txt sem a frase "This Font Software is licensed" e sem RFN: a definição do termo e a cláusula 3 não contam.
    const licenseOnly =
      'Copyright 2026 Fulano.\n\nDEFINITIONS\n"Reserved Font Name" refers to any names specified as such after the ' +
      'copyright statement(s).\n3) No Modified Version of the Font Software may use the Reserved Font Name(s) unless ' +
      'explicit written permission is granted.\n';
    expect(oflHeader(licenseOnly)).toBe(licenseOnly);
    expect(declaresReservedFontName(licenseOnly)).toBe(false);
    expect(resolveReservedNames(licenseOnly)).toEqual([]);
  });

  it('o cabeçalho do OFL.txt para antes do texto da licença', () => {
    const ofl = 'Copyright 2026 Fulano, with Reserved Font Name "Delta".\n\nThis Font Software is licensed under X.\n';
    expect(oflHeader(ofl)).toBe('Copyright 2026 Fulano, with Reserved Font Name "Delta".\n\n');
    expect(reservedFontNames(oflHeader(ofl))).toEqual(['Delta']);
  });

  it('arquivo de licenças: uma seção por fonte em uso, com o nome derivado, a origem e o OFL.txt inteiro', () => {
    const a = licenseSection({
      derivedName: 'Derivada A',
      source: 'Plinto 2.010',
      oflText: 'Copyright A\r\nTexto A\r\n',
    });
    const b = licenseSection({ derivedName: 'Derivada B', source: 'Gama 1.0', oflText: 'Copyright B\nTexto B' });
    const file = licenseFile([a, b]);
    expect(file.match(/^== /gm)).toHaveLength(2);
    expect(file).toContain(
      '== Derivada A: atlas MSDF derivado de Plinto 2.010 (SIL OFL 1.1) ==\n\nCopyright A\nTexto A\n',
    );
    expect(file).toContain('== Derivada B: atlas MSDF derivado de Gama 1.0 (SIL OFL 1.1) ==\n\nCopyright B\nTexto B\n');
    expect(file).not.toContain('\r');
  });
});

describe('conjuntos de glifos (decisão #54)', () => {
  const symbols = [0xa2, 0xa3, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xac, 0xae, 0xaf, 0xb1, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6];

  it('HUD: ASCII + Latin-1 + pontuação, sem Latin Extended-A e sem controles (200 códigos)', () => {
    expect(HUD_CODEPOINTS.length).toBe(200);
    expect(new Set(HUD_CODEPOINTS).size).toBe(200);
    expect(HUD_CODEPOINTS).toContain(0xe3); // ã
    expect(HUD_CODEPOINTS).toContain(0xa9); // ©
    expect(HUD_CODEPOINTS).toContain(0x2026); // …
    expect(HUD_CODEPOINTS.some((c) => c >= 0x100 && c <= 0x17f)).toBe(false);
    expect(HUD_CODEPOINTS.some((c) => c < 0x20 || (c >= 0x7f && c < 0xa0))).toBe(false);
    expect(codepointsForRole('hud')).toBe(HUD_CODEPOINTS);
  });

  it('display: 118 códigos só em caixa alta, sem os símbolos de Latin-1, contidos no HUD', () => {
    expect(DISPLAY_CODEPOINTS.length).toBe(118);
    expect(new Set(DISPLAY_CODEPOINTS).size).toBe(118);
    expect(DISPLAY_CODEPOINTS.filter(isLowercaseLetter)).toEqual([]);
    for (const c of symbols) expect(DISPLAY_CODEPOINTS).not.toContain(c);
    // Ã Ç É Õ · º —
    for (const c of [0xc3, 0xc7, 0xc9, 0xd5, 0xb7, 0xba, 0x2014]) expect(DISPLAY_CODEPOINTS).toContain(c);
    for (const c of DISPLAY_CODEPOINTS) expect(HUD_CODEPOINTS).toContain(c);
    expect(codepointsForRole('display')).toBe(DISPLAY_CODEPOINTS);
  });

  it('a tabela pt-BR inteira cabe: todo caractere no HUD e a caixa alta de tudo na display', () => {
    const hud = new Set(HUD_CODEPOINTS);
    const display = new Set(DISPLAY_CODEPOINTS);
    const outHud = new Set<string>();
    const outDisplay = new Set<string>();
    for (const raw of Object.values(STRINGS_PT_BR)) {
      // O ™ fica fora do atlas: o drawText do ui o compõe com T e M (`COMPOSED_CHARS`).
      const text = raw.replace(/./gu, (ch) => COMPOSED_CHARS[ch] ?? ch);
      for (const ch of text) if (!hud.has(ch.charCodeAt(0))) outHud.add(ch);
      for (const ch of text.toUpperCase()) if (!display.has(ch.charCodeAt(0))) outDisplay.add(ch);
    }
    expect([...outHud]).toEqual([]);
    expect([...outDisplay]).toEqual([]);
  });
});

describe('parâmetros do atlas', () => {
  it('display Russo One 22 px e HUD Saira Condensed 20 px, faixa 4, camada 512×256, nomes derivados fixos', () => {
    expect(FONTS.map((f) => [f.role, f.file, f.size, f.distanceRange, f.name])).toEqual([
      ['display', 'russo-one/RussoOne-Regular', 22, 4, 'BoboForces Display'],
      ['hud', 'saira-condensed/SairaCondensed-SemiBold', 20, 4, 'BoboForces HUD'],
    ]);
    expect(ATLAS).toEqual({ width: 512, height: 256 });
  });

  it('só a camada do HUD é quantizada (7 bits); faixa par e ≥ 4; o gerador recebe roundDecimal 3', () => {
    expect(FONTS.map((f) => f.quantizeBits)).toEqual([undefined, 7]);
    for (const spec of FONTS) {
      expect(spec.distanceRange % 2).toBe(0);
      expect(spec.distanceRange).toBeGreaterThanOrEqual(4);
      const options = generatorOptions(spec, 'AB');
      expect(options).toMatchObject({ roundDecimal: 3, fieldType: 'msdf', textureSize: [512, 256], charset: 'AB' });
      expect(options['fontSize']).toBe(spec.size);
    }
    expect(ROUND_DECIMAL).toBe(3);
  });
});

describe('quantização dos canais', () => {
  const ramp = () => {
    const pixels = new Uint8Array(256 * 4);
    for (let v = 0; v < 256; v++) pixels.set([v, 255 - v, (v * 7) & 0xff, 200], v * 4);
    return { width: 256, height: 1, pixels };
  };

  it('7 bits: no máximo 128 níveis, erro ≤ 1, extremos preservados, alfa intacto; determinística e idempotente', () => {
    const img = ramp();
    const q = quantizeChannels(img, 7);
    const levels = new Set<number>();
    for (let v = 0; v < 256; v++) {
      const out = q.pixels[v * 4]!;
      levels.add(out);
      expect(Math.abs(out - v)).toBeLessThanOrEqual(1);
      expect(q.pixels[v * 4 + 3]).toBe(200);
    }
    expect(levels.size).toBe(128);
    expect(q.pixels[0]).toBe(0);
    expect(q.pixels[255 * 4]).toBe(255);
    expect(Array.from(quantizeChannels(img, 7).pixels)).toEqual(Array.from(q.pixels));
    expect(Array.from(quantizeChannels(q, 7).pixels)).toEqual(Array.from(q.pixels));
    // A imagem de entrada não muda (o fontbake quantiza a camada do HUD antes de empilhar).
    expect(Array.from(img.pixels)).toEqual(Array.from(ramp().pixels));
  });

  it('6 bits também é idempotente (reserva do teto); 8 bits devolve a mesma imagem; fora de 1..8 é erro', () => {
    const q6 = quantizeChannels(ramp(), 6);
    expect(Array.from(quantizeChannels(q6, 6).pixels)).toEqual(Array.from(q6.pixels));
    const img = ramp();
    expect(quantizeChannels(img, 8)).toBe(img);
    expect(() => quantizeChannels(img, 0)).toThrow(/bits/);
    expect(() => quantizeChannels(img, 9)).toThrow(/bits/);
  });
});

describe('pacote de métricas', () => {
  const bm: BmFontJson = {
    pages: ['x.png'],
    info: { face: 'Sintética', size: 30 },
    common: { lineHeight: 40, base: 30, scaleW: 512, scaleH: 256, pages: 1 },
    distanceField: { fieldType: 'msdf', distanceRange: 4 },
    chars: [
      { id: 0x48, x: 0, y: 0, width: 16, height: 25, xoffset: -2, yoffset: 7, xadvance: 14.123, page: 0 },
      { id: 0x41, x: 20, y: 0, width: 16, height: 25, xoffset: -2, yoffset: 7, xadvance: 13.5, page: 0 },
      { id: 0x78, x: 40, y: 0, width: 14, height: 18, xoffset: -2, yoffset: 14, xadvance: 11, page: 0 },
      // "g": caixa de 14 a 38 com margem de 2 → a tinta desce até 36, 6 px abaixo da base.
      { id: 0x67, x: 60, y: 0, width: 14, height: 24, xoffset: -2, yoffset: 14, xadvance: 11, page: 0 },
      { id: 0x20, x: 0, y: 0, width: 0, height: 0, xoffset: -2, yoffset: 60, xadvance: 6, page: 0 },
    ],
    kernings: [
      { first: 0x41, second: 0x48, amount: -1.234 },
      { first: 0x48, second: 0x41, amount: MIN_KERNING / 2 },
      { first: 0x41, second: 0x56, amount: -2 }, // "V" não está no atlas
    ],
  };

  it('o teto das fontes é medido no mesmo nível de gzip do size-check (limite de cima do GitHub Pages)', () => {
    expect(FONT_JSON_GZIP_LEVEL).toBe(FONT_TEXT_GZIP_LEVEL);
    expect(FONT_BUDGET_BYTES).toBe(BUDGETS.find((b) => b.id === 'fonts')!.limit);
  });

  it('números planos ordenados, avanço fracionário (roundDecimal) e kerning limpo', () => {
    const file = toFontFile(bm, { layer: 1, name: 'Sintética', version: '1.0', missing: [0x100] });
    expect(file.glyphs.length).toBe(5 * 8);
    expect(file.glyphs.slice(0, 8)).toEqual([0x20, 0, 0, 0, 0, -2, 60, 6]);
    expect(file.glyphs[8 * 2 + 7]).toBe(14.12);
    expect(file.kerning).toEqual([0x41, 0x48, -1.23]);
    expect(file.missing).toEqual([0x100]);
  });

  it('sem OS/2: mede maiúscula e altura-x no atlas; com OS/2: usa as alturas exatas em em', () => {
    // pad = 2: topo do H = 7 + 2 = 9 → maiúscula = 30 − 9 = 21; topo do x = 16 → altura-x 14.
    const measured = toFontFile(bm, { layer: 0, name: 'S', version: '1', missing: [] });
    expect(measured.capHeight).toBe(21);
    expect(measured.xHeight).toBe(14);
    const exact = toFontFile(bm, {
      layer: 0,
      name: 'S',
      version: '1',
      missing: [],
      capHeightEm: 0.688,
      xHeightEm: 0.51,
    });
    expect(exact.capHeight).toBe(20.64);
    expect(exact.xHeight).toBe(15.3);
  });

  it('linha = base + descida medida nos glifos entregues (não a do hhea/OS/2 do gerador)', () => {
    expect(measuredDescent(bm)).toBe(6);
    const file = toFontFile(bm, { layer: 0, name: 'S', version: '1', missing: [] });
    expect(file.base).toBe(30);
    expect(file.lineHeight).toBe(36);
    // Só maiúsculas sem descendente: a linha termina na base.
    const caps = { ...bm, chars: bm.chars.filter((c) => c.id === 0x48 || c.id === 0x41) };
    expect(toFontFile(caps, { layer: 0, name: 'S', version: '1', missing: [] }).lineHeight).toBe(30);
  });

  it('licença e origem vão no JSON (sem copyright) e o parseFontPack do ui lê o pacote', () => {
    const meta = { version: '1', missing: [], license: FONT_LICENSE, source: 'Plinto 2.010' };
    const fonts = {
      display: toFontFile(bm, { ...meta, layer: 0, name: 'Derivada D' }),
      hud: toFontFile(bm, { ...meta, layer: 1, name: 'Derivada H' }),
    };
    const json = stringifyFontPack(buildFontPack(fonts, { width: 512, height: 256, layers: 2, image: 'a.png' }));
    const raw = JSON.parse(json) as { fonts: Record<string, Record<string, unknown>> };
    expect(raw.fonts['hud']).toMatchObject({ name: 'Derivada H', license: 'OFL-1.1', source: 'Plinto 2.010' });
    expect(json).not.toMatch(/copyright/i);
    const pack = parseFontPack(raw);
    expect(pack.fonts.hud.layer).toBe(1);
    expect(pack.fonts.display.kerning(0x41, 0x48)).toBe(-1.23);
    expect(pack.fonts.display.glyphIndex(0x78)).toBeGreaterThanOrEqual(0);
  });

  it('mais de uma página é erro (o texture array espera uma camada por fonte)', () => {
    expect(() =>
      toFontFile({ ...bm, common: { ...bm.common, pages: 2 } }, { layer: 0, name: 'X', version: '', missing: [] }),
    ).toThrow(/páginas/);
  });
});

describe('fontes em uso (arquivos reais de assets-src/fonts)', () => {
  const ROOT = resolve(import.meta.dirname, '..', '..', '..');
  for (const spec of FONTS) {
    const path = join(ROOT, 'assets-src', 'fonts', `${spec.file}.ttf`);
    it.skipIf(!existsSync(path))(
      `${spec.role}: o nome derivado passa na guarda do RFN lido da fonte e do OFL.txt`,
      () => {
        const font = new Uint8Array(readFileSync(path));
        const ofl = readFileSync(join(path, '..', 'OFL.txt'), 'utf8');
        const reserved = resolveReservedNames(`${fontName(font, 0)}\n${oflHeader(ofl)}`, spec.reservedNames, spec.file);
        // As duas famílias declaram RFN (uma delas em minúsculas): a guarda não pode ficar vazia.
        expect(reserved.length).toBeGreaterThan(0);
        expect(() => assertDerivedName(spec.name, reserved, spec.file)).not.toThrow();
        expect(() => assertDerivedName(`${reserved[0]!.toUpperCase()} UI`, reserved, spec.file)).toThrow(/cláusula 3/);
        const metrics = fontVerticalMetrics(font);
        expect(metrics.capHeight).not.toBeNull();
        expect(metrics.xHeight).not.toBeNull();
      },
    );
  }
});
