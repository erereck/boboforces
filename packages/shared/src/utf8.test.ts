import { describe, expect, it } from 'vitest';
import { decodeUtf8 } from './utf8.ts';

/** M2, fase 4f: UTF-8 sem TextDecoder (o backup importado). */

function encode(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) bytes.push(cp);
    else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return new Uint8Array(bytes);
}

describe('decodeUtf8', () => {
  it('ASCII, acentos, ×, emoji e o BOM do começo', () => {
    const text = '{"nome": "Sexta do Jorge · ×2 · ação 🎯"}';
    expect(decodeUtf8(encode(text))).toBe(text);
    expect(decodeUtf8(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe('a');
    const long = 'é'.repeat(10_000);
    expect(decodeUtf8(encode(long))).toBe(long);
  });

  it('sequência inválida vira U+FFFD e a leitura segue', () => {
    expect(decodeUtf8(new Uint8Array([0x61, 0xff, 0x62]))).toBe('a\uFFFDb');
    expect(decodeUtf8(new Uint8Array([0xc3]))).toBe('\uFFFD');
    expect(decodeUtf8(new Uint8Array([0xe0, 0x80, 0x80]))).toBe('\uFFFD\uFFFD\uFFFD');
  });
});
