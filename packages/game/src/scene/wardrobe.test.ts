import { describe, expect, it } from 'vitest';
import { createWardrobePuppet, WARDROBE } from './wardrobe.ts';

describe('M12 (fase 5): o Meu Bobo vivo', () => {
  it('entidade própria, fora da 0 dos manequins congelados', () => {
    expect(WARDROBE.entity).not.toBe(0);
  });

  it('cada troca liga o nascer por 0,4 s; troca no meio desliga 1 quadro antes (borda nova)', () => {
    const p = createWardrobePuppet();
    const dt = 1 / 60;
    expect(p.take(dt)).toBe(false);
    p.restart();
    let on = 0;
    for (let k = 0; k < 60; k++) if (p.take(dt)) on++;
    // 0,4 s a 60 Hz (24 quadros; o último pode passar por arredondamento).
    expect(on).toBeGreaterThanOrEqual(24);
    expect(on).toBeLessThanOrEqual(25);
    p.restart();
    for (let k = 0; k < 5; k++) expect(p.take(dt)).toBe(true);
    // Outra peça no meio do nascer: o bit cai 1 quadro e volta.
    p.restart();
    expect(p.take(dt)).toBe(false);
    expect(p.take(dt)).toBe(true);
  });
});
