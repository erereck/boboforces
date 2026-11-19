import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { builtinBot } from './bot.ts';
import { deflateLite, encodeUtf8Lite } from './deflate-lite.ts';

describe('M8 (fase 1): o deflate pequeno dos códigos', () => {
  it('o inflate de sempre abre (vazio, curto, repetido, binário, maior que a janela)', () => {
    const cases: Uint8Array[] = [
      new Uint8Array(0),
      strToU8('a'),
      strToU8('abcabcabcabcabcabcabc'),
      strToU8('x'.repeat(1000)),
      Uint8Array.from({ length: 5000 }, (_, i) => (i * 7919) & 255),
      strToU8(JSON.stringify(Array.from({ length: 900 }, (_, i) => ({ id: `bot-${i % 37}`, n: i })))),
    ];
    for (const data of cases) expect(inflateSync(deflateLite(data))).toEqual(data);
  });

  it('o JSON de um bot fica perto do nível 9 do fflate (o Huffman fixo não encurta as letras; o LZ77 sim)', () => {
    const json = strToU8(JSON.stringify(builtinBot('jorge-the-immortal')));
    const lite = deflateLite(json).length;
    const full = deflateSync(json, { level: 9 }).length;
    expect(lite).toBeLessThan(json.length * 0.8);
    expect(lite).toBeLessThan(full * 1.35);
  });

  it('o UTF-8 próprio é igual ao do TextEncoder (acentos, emoji, ×)', () => {
    for (const text of ['', 'Jorge', 'ação × 3', 'bobo 🙂 ok', 'Ω≈ç√∫']) {
      expect(encodeUtf8Lite(text)).toEqual(strToU8(text));
      expect(strFromU8(encodeUtf8Lite(text))).toBe(text);
    }
  });
});
