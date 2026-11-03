import { describe, expect, it } from 'vitest';
import { IndexAllocator, Pool } from './pool.ts';
import { RingBuffer } from './ring-buffer.ts';

describe('Pool', () => {
  it('reaproveita itens e reseta ao devolver', () => {
    let created = 0;
    const pool = new Pool(
      () => ({ id: created++, value: 0 }),
      (item) => {
        item.value = 0;
      },
      2,
    );
    expect(pool.available).toBe(2);
    const a = pool.acquire();
    a.value = 5;
    pool.release(a);
    const again = pool.acquire();
    expect(again).toBe(a);
    expect(again.value).toBe(0);
    expect(pool.misses).toBe(0);
  });

  it('cresce quando esgota e conta o miss', () => {
    const pool = new Pool(
      () => ({}),
      () => {},
      1,
    );
    pool.acquire();
    pool.acquire();
    expect(pool.misses).toBe(1);
    expect(pool.size).toBe(2);
  });
});

describe('IndexAllocator', () => {
  it('entrega índices baixos primeiro, recicla e avisa quando enche', () => {
    const alloc = new IndexAllocator(3);
    expect([alloc.alloc(), alloc.alloc(), alloc.alloc()]).toEqual([0, 1, 2]);
    expect(alloc.alloc()).toBe(-1);
    alloc.free(1);
    expect(alloc.isUsed(1)).toBe(false);
    expect(alloc.alloc()).toBe(1);
    expect(alloc.used).toBe(3);
    expect(() => alloc.free(5)).toThrow();
    alloc.clear();
    expect(alloc.alloc()).toBe(0);
  });
});

describe('RingBuffer', () => {
  it('sobrescreve o mais antigo e devolve quem saiu', () => {
    const rb = new RingBuffer<number>(3);
    expect(rb.push(1)).toBeUndefined();
    rb.push(2);
    rb.push(3);
    expect(rb.full).toBe(true);
    expect(rb.push(4)).toBe(1);
    expect(rb.toArray()).toEqual([2, 3, 4]);
    expect(rb.get(0)).toBe(2);
    expect(rb.latest()).toBe(4);
    expect(rb.oldest()).toBe(2);
  });

  it('shift, clear e limites', () => {
    const rb = new RingBuffer<string>(2);
    rb.push('a');
    rb.push('b');
    expect(rb.shift()).toBe('a');
    expect(rb.length).toBe(1);
    expect(() => rb.get(1)).toThrow();
    rb.clear();
    expect(rb.length).toBe(0);
    expect(rb.latest()).toBeUndefined();
    expect(rb.shift()).toBeUndefined();
  });
});
