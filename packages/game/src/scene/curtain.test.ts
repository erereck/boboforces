import { describe, expect, it } from 'vitest';
import { createCurtain, CURTAIN } from './curtain.ts';

describe('M12 (fase 5): a cortina da entrada da partida', () => {
  it('pré-rodada de 20 quadros no preto, depois sai em 0,3 s e fica `done`', () => {
    const c = createCurtain();
    for (let k = 0; k < CURTAIN.prerollFrames; k++) {
      expect(c.prerolling).toBe(true);
      expect(c.done).toBe(false);
      expect(c.frame(1 / 60, false)).toBe(1);
    }
    expect(c.prerolling).toBe(false);
    const alphas: number[] = [];
    for (let k = 0; k < 30; k++) alphas.push(c.frame(1 / 60, false));
    expect(alphas[0]).toBeLessThan(1);
    expect(alphas[0]).toBeGreaterThan(0.9);
    for (let k = 1; k < alphas.length; k++) expect(alphas[k]!).toBeLessThanOrEqual(alphas[k - 1]!);
    // 0,3 s a 60 Hz: 18 quadros.
    expect(alphas[17]).toBe(0);
    expect(alphas[16]).toBeGreaterThan(0);
    expect(c.done).toBe(true);
  });

  it('teto em tempo: o 1º quadro (o fim do loading) conta no máximo 0,25 s; a 2 fps são 2 quadros', () => {
    const fast = createCurtain();
    // O 1º quadro com dt enorme não acaba a pré-rodada sozinho.
    fast.frame(3, false);
    expect(fast.prerolling).toBe(true);
    const slow = createCurtain();
    expect(slow.frame(0.5, false)).toBe(1);
    expect(slow.frame(0.5, false)).toBe(1);
    expect(slow.prerolling).toBe(false);
  });

  it('"Reduzir efeitos": instantânea depois da pré-rodada', () => {
    const c = createCurtain(2);
    expect(c.frame(1 / 60, true)).toBe(1);
    expect(c.frame(1 / 60, true)).toBe(1);
    expect(c.frame(1 / 60, true)).toBe(0);
    expect(c.done).toBe(true);
    expect(createCurtain(0).frame(0, false)).toBe(1);
  });
});
