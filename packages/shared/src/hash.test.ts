import { describe, expect, it } from 'vitest';
import { fnv1a32, fnv1a32String, hashCombine, hashToHex, mix32, StateHasher } from './hash.ts';

describe('FNV-1a 32', () => {
  it('bate com os vetores conhecidos', () => {
    expect(fnv1a32String('')).toBe(0x811c9dc5);
    expect(fnv1a32String('a')).toBe(0xe40c292c);
    expect(fnv1a32String('foobar')).toBe(0xbf9cf968);
    expect(fnv1a32(new Uint8Array([0x66, 0x6f, 0x6f, 0x62, 0x61, 0x72]))).toBe(0xbf9cf968);
  });

  it('strings usam UTF-8 (igual ao Buffer do Node)', () => {
    expect(fnv1a32String('ação')).toBe(0x0b2cde09);
    const emoji = String.fromCodePoint(0x1f60a);
    expect(fnv1a32String(emoji)).toBe(fnv1a32(new Uint8Array([0xf0, 0x9f, 0x98, 0x8a])));
  });

  it('encadeia pelo seed', () => {
    expect(fnv1a32String('bar', fnv1a32String('foo'))).toBe(fnv1a32String('foobar'));
  });
});

describe('StateHasher', () => {
  it('é estável (golden) e sensível à ordem', () => {
    expect(hashToHex(new StateHasher().u32(1).f64(0.5).string('x').digest())).toBe('cb7f2de3');
    const a = new StateHasher().u8(1).u8(2).digest();
    const b = new StateHasher().u8(2).u8(1).digest();
    expect(a).not.toBe(b);
  });

  it('hashear typed arrays = hashear os bytes', () => {
    const f = new Float64Array([1.25, -3, 1e9]);
    const viaBytes = new StateHasher().bytes(f).digest();
    const viaF64 = new StateHasher().f64(1.25).f64(-3).f64(1e9).digest();
    expect(viaBytes).toBe(viaF64);
    const u16 = new Uint16Array([0x1234, 0xabcd]);
    expect(new StateHasher().bytes(u16).digest()).toBe(new StateHasher().u16(0x1234).u16(0xabcd).digest());
  });

  it('reset volta ao estado inicial', () => {
    const h = new StateHasher().u32(99);
    expect(h.reset().u8(1).digest()).toBe(new StateHasher().u8(1).digest());
  });
});

describe('mix32 e hashCombine', () => {
  it('produzem u32 e dependem da ordem', () => {
    expect(mix32(0)).toBe(0);
    expect(mix32(1)).toBeGreaterThan(0);
    expect(hashCombine(1, 2)).not.toBe(hashCombine(2, 1));
  });
});
