import { createRng } from '@boboforces/shared';
import { zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { crc32 } from './crc32.ts';
import { decodePng, PngError } from './decode.ts';
import { encodePng } from './encode.ts';
import { PNG_SIGNATURE } from './types.ts';

function ascii(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

function u32(v: number): number[] {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

/** Monta um PNG à mão (implementação independente do codificador, para testar o decodificador). */
function buildPng(chunks: readonly (readonly [string, Uint8Array])[]): Uint8Array {
  const parts: number[] = [...PNG_SIGNATURE];
  for (const [name, body] of chunks) {
    const typed = new Uint8Array(4 + body.length);
    typed.set(ascii(name), 0);
    typed.set(body, 4);
    parts.push(...u32(body.length), ...typed, ...u32(crc32(typed)));
  }
  return Uint8Array.from(parts);
}

function ihdr(width: number, height: number, depth: number, colorType: number, interlace = 0): Uint8Array {
  return Uint8Array.from([...u32(width), ...u32(height), depth, colorType, 0, 0, interlace]);
}

/** Filtra linhas já empacotadas com um tipo fixo (referência simples, byte a byte). */
function filterRows(rows: readonly Uint8Array[], bpp: number, type: number): Uint8Array {
  const out: number[] = [];
  rows.forEach((row, y) => {
    out.push(type);
    const prev = y > 0 ? rows[y - 1]! : null;
    for (let i = 0; i < row.length; i++) {
      const a = i >= bpp ? row[i - bpp]! : 0;
      const b = prev ? prev[i]! : 0;
      const c = prev && i >= bpp ? prev[i - bpp]! : 0;
      let pred = 0;
      if (type === 1) pred = a;
      else if (type === 2) pred = b;
      else if (type === 3) pred = (a + b) >> 1;
      else if (type === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out.push((row[i]! - pred) & 0xff);
    }
  });
  return zlibSync(Uint8Array.from(out));
}

function randomImage(width: number, height: number, seed: number): Uint8Array {
  const rng = createRng(seed);
  const data = new Uint8Array(width * height * 4);
  // Metade ruído, metade gradiente: força a heurística a escolher filtros diferentes.
  for (let i = 0; i < data.length; i++) data[i] = i < data.length / 2 ? rng.int(0, 256) : (i * 7) & 0xff;
  return data;
}

describe('crc32', () => {
  it('confere com o vetor padrão', () => {
    expect(crc32(ascii('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('encodePng/decodePng', () => {
  it('dropOpaqueAlpha grava RGB só quando tudo é opaco, e a volta é a mesma imagem', () => {
    const data = new Uint8Array(8 * 4 * 4);
    for (let i = 0; i < data.length; i++) data[i] = i % 4 === 3 ? 255 : (i * 37) & 0xff;
    const rgb = encodePng({ width: 8, height: 4, data }, { dropOpaqueAlpha: true });
    expect(rgb[25]).toBe(2); // IHDR: tipo de cor RGB
    expect(decodePng(rgb).data).toEqual(data);
    const rgba = encodePng({ width: 8, height: 4, data });
    expect(rgba[25]).toBe(6);
    const translucent = data.slice();
    translucent[3] = 128;
    const kept = encodePng({ width: 8, height: 4, data: translucent }, { dropOpaqueAlpha: true });
    expect(kept[25]).toBe(6);
    expect(decodePng(kept).data).toEqual(translucent);
  });

  it('ida e volta sem perda, em vários tamanhos', () => {
    for (const [w, h] of [
      [1, 1],
      [16, 16],
      [16, 128],
      [37, 5],
    ] as const) {
      const data = randomImage(w, h, w * 1000 + h);
      const png = encodePng({ width: w, height: h, data });
      const back = decodePng(png);
      expect(back.width).toBe(w);
      expect(back.height).toBe(h);
      expect(back.data).toEqual(data);
    }
  });

  it('é determinístico e começa com a assinatura', () => {
    const data = randomImage(16, 16, 7);
    const a = encodePng({ width: 16, height: 16, data });
    const b = encodePng({ width: 16, height: 16, data });
    expect(a).toEqual(b);
    expect([...a.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
  });

  it('recusa dados com tamanho errado', () => {
    expect(() => encodePng({ width: 2, height: 2, data: new Uint8Array(15) })).toThrow();
    expect(() => encodePng({ width: 0, height: 2, data: new Uint8Array(0) })).toThrow();
  });
});

describe('decodePng: tipos de cor e filtros', () => {
  it('RGBA8 com cada um dos 5 filtros', () => {
    const rows = [
      Uint8Array.from([10, 20, 30, 255, 200, 100, 50, 128]),
      Uint8Array.from([1, 2, 3, 4, 250, 251, 252, 253]),
    ];
    for (let type = 0; type <= 4; type++) {
      const png = buildPng([
        ['IHDR', ihdr(2, 2, 8, 6)],
        ['IDAT', filterRows(rows, 4, type)],
        ['IEND', new Uint8Array(0)],
      ]);
      expect([...decodePng(png).data]).toEqual([...rows[0]!, ...rows[1]!]);
    }
  });

  it('paleta de 2 bits com tRNS', () => {
    // 3 pixels por linha: índices 0, 1, 2 → 00 01 10 (+2 bits de enchimento).
    const plte = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255]);
    const trns = Uint8Array.from([0, 128]);
    const png = buildPng([
      ['IHDR', ihdr(3, 1, 2, 3)],
      ['PLTE', plte],
      ['tRNS', trns],
      ['IDAT', filterRows([Uint8Array.from([0b00011000])], 1, 0)],
      ['IEND', new Uint8Array(0)],
    ]);
    expect([...decodePng(png).data]).toEqual([255, 0, 0, 0, 0, 255, 0, 128, 0, 0, 255, 255]);
  });

  it('cinza de 16 bits, cinza+alfa e RGB com chave de transparência', () => {
    const gray16 = buildPng([
      ['IHDR', ihdr(2, 1, 16, 0)],
      ['IDAT', filterRows([Uint8Array.from([0xab, 0xcd, 0x12, 0x34])], 2, 1)],
      ['IEND', new Uint8Array(0)],
    ]);
    expect([...decodePng(gray16).data]).toEqual([0xab, 0xab, 0xab, 255, 0x12, 0x12, 0x12, 255]);

    const grayAlpha = buildPng([
      ['IHDR', ihdr(1, 1, 8, 4)],
      ['IDAT', filterRows([Uint8Array.from([77, 99])], 2, 0)],
      ['IEND', new Uint8Array(0)],
    ]);
    expect([...decodePng(grayAlpha).data]).toEqual([77, 77, 77, 99]);

    const rgbKey = buildPng([
      ['IHDR', ihdr(2, 1, 8, 2)],
      ['tRNS', Uint8Array.from([0, 1, 0, 2, 0, 3])],
      ['IDAT', filterRows([Uint8Array.from([1, 2, 3, 9, 9, 9])], 3, 4)],
      ['IEND', new Uint8Array(0)],
    ]);
    expect([...decodePng(rgbKey).data]).toEqual([1, 2, 3, 0, 9, 9, 9, 255]);
  });

  it('cinza de 1 bit expande para 0/255', () => {
    const png = buildPng([
      ['IHDR', ihdr(4, 1, 1, 0)],
      ['IDAT', filterRows([Uint8Array.from([0b1010_0000])], 1, 0)],
      ['IEND', new Uint8Array(0)],
    ]);
    const d = decodePng(png).data;
    expect([d[0], d[4], d[8], d[12]]).toEqual([255, 0, 255, 0]);
  });

  it('junta vários IDAT e ignora chunks auxiliares', () => {
    const rows = [Uint8Array.from([5, 6, 7, 8])];
    const z = filterRows(rows, 4, 0);
    const png = buildPng([
      ['IHDR', ihdr(1, 1, 8, 6)],
      ['tEXt', ascii('Comment\0teste')],
      ['IDAT', z.subarray(0, 3)],
      ['IDAT', z.subarray(3)],
      ['IEND', new Uint8Array(0)],
    ]);
    expect([...decodePng(png).data]).toEqual([5, 6, 7, 8]);
  });
});

describe('decodePng: erros', () => {
  const good = encodePng({ width: 2, height: 2, data: new Uint8Array(16).fill(200) });

  it('assinatura, CRC e truncamento', () => {
    const badSig = good.slice();
    badSig[1] = 0;
    expect(() => decodePng(badSig)).toThrow(PngError);
    const badCrc = good.slice();
    badCrc[20] = badCrc[20]! ^ 0xff; // dentro do IHDR
    expect(() => decodePng(badCrc)).toThrow(/CRC/);
    expect(() => decodePng(good.subarray(0, good.length - 6))).toThrow(PngError);
  });

  it('entrelaçado, tipo inválido e chunk crítico desconhecido', () => {
    const z = filterRows([Uint8Array.from([1, 2, 3, 4])], 4, 0);
    const interlaced = buildPng([
      ['IHDR', ihdr(1, 1, 8, 6, 1)],
      ['IDAT', z],
      ['IEND', new Uint8Array(0)],
    ]);
    expect(() => decodePng(interlaced)).toThrow(/entrelaçada/);
    const badType = buildPng([
      ['IHDR', ihdr(1, 1, 8, 5)],
      ['IDAT', z],
      ['IEND', new Uint8Array(0)],
    ]);
    expect(() => decodePng(badType)).toThrow(PngError);
    const critical = buildPng([
      ['IHDR', ihdr(1, 1, 8, 6)],
      ['ABCD', new Uint8Array(1)],
      ['IDAT', z],
      ['IEND', new Uint8Array(0)],
    ]);
    expect(() => decodePng(critical)).toThrow(/crítico/);
  });

  it('dados de imagem com tamanho errado', () => {
    const short = buildPng([
      ['IHDR', ihdr(2, 2, 8, 6)],
      ['IDAT', filterRows([Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])], 4, 0)],
      ['IEND', new Uint8Array(0)],
    ]);
    expect(() => decodePng(short)).toThrow(PngError);
  });
});
