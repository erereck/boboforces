import { deflateSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { isNameAllowed } from './name-filter.ts';
import {
  decodeBase64Url,
  decodeShareCode,
  encodeBase64Url,
  encodeShareCode,
  SHARE_CODE_MAX_CHARS,
  shareCodeFromHash,
  shareKindOf,
  shareLinkHash,
} from './share-code.ts';

describe('M8 (fase 0): base64url', () => {
  it('vai e volta em todos os tamanhos (sem `=`, só o alfabeto de URL)', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97 + n * 31) & 255);
      const text = encodeBase64Url(bytes);
      expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(decodeBase64Url(text)).toEqual(bytes);
    }
    expect(encodeBase64Url(Uint8Array.from([251, 255]))).toBe('-_8');
  });

  it('recusa caractere fora do alfabeto e o tamanho impossível', () => {
    expect(decodeBase64Url('abc=')).toBeNull();
    expect(decodeBase64Url('ab+c')).toBeNull();
    expect(decodeBase64Url('abcde')).toBeNull();
    expect(decodeBase64Url('é')).toBeNull();
  });
});

describe('M8 (fase 0): os códigos de compartilhar', () => {
  const bot = { format: 'boboforces/bot@1', id: 'jorge', name: 'Jorge the Immortal', level: 'normal' };

  it('o documento vai e volta, com o prefixo do tipo', () => {
    const enc = encodeShareCode('bot', bot);
    expect(enc.ok).toBe(true);
    if (!enc.ok) return;
    expect(enc.code.startsWith('BF1-')).toBe(true);
    expect(decodeShareCode(enc.code)).toEqual({ ok: true, kind: 'bot', doc: bot });
    // Colado com espaços e quebras de linha no meio, e o prefixo em minúsculas.
    const payload = enc.code.slice(4);
    const messy = '  bf1-' + payload.slice(0, 6) + '\n' + payload.slice(6, 12) + ' ' + payload.slice(12) + ' ';
    expect(decodeShareCode(messy)).toEqual({ ok: true, kind: 'bot', doc: bot });
    expect(shareKindOf('bfp1-xyz')).toBe('preset');
    for (const kind of ['preset', 'squad', 'surprise'] as const) {
      const r = encodeShareCode(kind, { a: 1 });
      expect(r.ok && decodeShareCode(r.code)).toMatchObject({ ok: true, kind, doc: { a: 1 } });
    }
  });

  it('recusa o que não é código, o longo demais, o base64 e o deflate quebrados e o que não é JSON', () => {
    expect(decodeShareCode('olá')).toEqual({ ok: false, error: 'prefix' });
    expect(decodeShareCode('BF1-' + 'A'.repeat(SHARE_CODE_MAX_CHARS))).toEqual({ ok: false, error: 'tooLong' });
    expect(decodeShareCode('BF1-ab+c')).toEqual({ ok: false, error: 'base64' });
    expect(decodeShareCode('BF1-')).toEqual({ ok: false, error: 'base64' });
    expect(decodeShareCode('BF1-' + encodeBase64Url(Uint8Array.from([1, 2, 3, 4, 5])))).toEqual({
      ok: false,
      error: 'inflate',
    });
    const notJson = 'BF1-' + encodeBase64Url(deflateSync(strToU8('{isso não é json')));
    expect(decodeShareCode(notJson)).toEqual({ ok: false, error: 'json' });
  });

  it('a "bomba" de inflate para no teto de 64 KB (um código pequeno que abre em 1 MB)', () => {
    const bomb = 'BF1-' + encodeBase64Url(deflateSync(new Uint8Array(1 << 20).fill(32), { level: 9 }));
    expect(bomb.length).toBeLessThan(SHARE_CODE_MAX_CHARS);
    expect(decodeShareCode(bomb)).toEqual({ ok: false, error: 'tooBig' });
  });

  it('o documento grande demais não vira código (passa de 4.000 caracteres)', () => {
    // Texto sem repetição não comprime: ~6 KB de JSON viram mais de 4.000 caracteres.
    let noise = '';
    let x = 12345;
    for (let i = 0; i < 6000; i++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      noise += String.fromCharCode(33 + (x % 90));
    }
    const r = encodeShareCode('preset', { noise });
    expect(r).toMatchObject({ ok: false, error: 'tooLong' });
  });

  it('os links: #bot= e #p= (sem o prefixo), também no meio de outros parâmetros', () => {
    const enc = encodeShareCode('bot', bot);
    if (!enc.ok) throw new Error('código');
    const hash = shareLinkHash(enc.code)!;
    expect(hash.startsWith('#bot=')).toBe(true);
    expect(hash.includes('BF1-')).toBe(false);
    expect(shareCodeFromHash(hash)).toBe(enc.code);
    expect(shareCodeFromHash('#x=1&p=abc')).toBe('BFP1-abc');
    expect(shareCodeFromHash('#sala=ABCD')).toBeNull();
    expect(shareLinkHash('BFS1-abc')).toBeNull();
  });
});

describe('M8 (fase 0): o filtro de nomes', () => {
  it('barra os palavrões, com acento, números, letras repetidas e espaços no meio', () => {
    for (const bad of [
      'Porra',
      'pórra bob',
      'Fuuuuck',
      'f u c k',
      'p u t a',
      'PUTA',
      'Sh1t Bob',
      'Merda Bob',
      'c u',
      'B1tch',
      // Revisão: letras triplicadas, 6 e 9, a palavra partida, as letras soltas e os invisíveis no meio.
      'Porrrra',
      'Asss',
      'Ni66a',
      'vi ado',
      'm e r d a',
      'pútas',
      'put​as',
    ]) {
      expect(isNameAllowed(bad), bad).toBe(false);
    }
  });

  it('deixa os nomes de verdade (as palavras curtas só casam sozinhas)', () => {
    for (const ok of [
      'Normal Bob',
      'Jorge the Immortal',
      'Computador',
      'Disputa',
      'Desviado',
      'Knight Bob',
      'Fagundes',
      'Pica-Pau',
      'Cockpit',
      'Classe A',
      'Sexta-feira',
      'Assassino',
      // Revisão: números sozinhos não viram letra; as raízes casam dentro de cada palavra (não juntando as vizinhas).
      'Bot 455',
      'Robo 7175',
      'Dick Vigarista',
      'Moby Dick',
      'Bob kkk',
      'Push It',
      'Finish It',
      'Bo Stark',
      'Dona Zica',
      'Ignazio',
      'Nazir',
      'Assis',
      'Cassio',
      'Hancock',
      'Grape',
      '',
    ]) {
      expect(isNameAllowed(ok), ok).toBe(true);
    }
  });
});
