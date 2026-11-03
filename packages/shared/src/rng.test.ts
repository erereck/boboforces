import { describe, expect, it } from 'vitest';
import { hashToHex } from './hash.ts';
import { createRng, RNG_STATE_WORDS, seedToKey } from './rng.ts';

describe('createRng (sfc32)', () => {
  it('é determinístico e estável (golden: mudar estes valores quebra replays e o golden da sim)', () => {
    const r = createRng(42);
    const out = [r.nextU32(), r.nextU32(), r.nextU32(), r.nextU32()].map(hashToHex);
    expect(out).toEqual(['e40a2ba3', '6e5a68e7', '5272dc7e', '3511402b']);
    const m = createRng(42).fork('match');
    expect([m.nextU32(), m.nextU32()].map(hashToHex)).toEqual(['6d165632', '367fb38d']);
  });

  it('aceita semente em texto (FNV-1a UTF-8)', () => {
    expect(seedToKey('boboforces')).toBe(0xb59fb689);
    expect(createRng('boboforces').nextU32()).toBe(createRng(0xb59fb689).nextU32());
  });

  it('fork não depende do quanto o pai foi consumido', () => {
    const a = createRng(7);
    const b = createRng(7);
    for (let i = 0; i < 100; i++) b.next();
    expect(a.fork('loot').nextU32()).toBe(b.fork('loot').nextU32());
  });

  it('fork por nome e por índice gera fluxos diferentes', () => {
    const root = createRng(1);
    const seen = new Set<number>();
    for (const name of ['match', 'loot', 'bot']) {
      for (let i = 0; i < 4; i++) seen.add(root.fork(name, i).nextU32());
    }
    expect(seen.size).toBe(12);
    expect(root.fork('bot', 3).fork('aim').key).toBe(createRng(1).fork('bot', 3).fork('aim').key);
  });

  it('next() fica em [0, 1) e int() respeita os limites', () => {
    const r = createRng(123);
    let sum = 0;
    for (let i = 0; i < 10_000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      sum += x;
      const n = r.int(-3, 4);
      expect(n).toBeGreaterThanOrEqual(-3);
      expect(n).toBeLessThan(4);
      expect(Number.isInteger(n)).toBe(true);
    }
    expect(sum / 10_000).toBeCloseTo(0.5, 1);
  });

  it('gaussian() tem média ~0 e desvio ~1', () => {
    const r = createRng(99);
    let sum = 0;
    let sumSq = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      const g = r.gaussian();
      sum += g;
      sumSq += g * g;
    }
    const mean = sum / n;
    expect(mean).toBeCloseTo(0, 1);
    expect(Math.sqrt(sumSq / n - mean * mean)).toBeCloseTo(1, 1);
  });

  it('saveState/loadState reproduz a sequência', () => {
    const r = createRng(5);
    r.next();
    const state = new Uint32Array(RNG_STATE_WORDS);
    r.saveState(state);
    const expected = [r.nextU32(), r.nextU32(), r.nextU32()];
    const other = createRng(999);
    other.loadState(state);
    expect([other.nextU32(), other.nextU32(), other.nextU32()]).toEqual(expected);
  });

  it('pick e shuffle usam só o RNG', () => {
    const a = createRng(3).shuffle([1, 2, 3, 4, 5, 6]);
    const b = createRng(3).shuffle([1, 2, 3, 4, 5, 6]);
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(() => createRng(1).pick([])).toThrow();
  });
});
