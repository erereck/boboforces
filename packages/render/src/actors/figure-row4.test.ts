import { describe, expect, it } from 'vitest';
import { figureRow4Expression, writeFigureRow4 } from './figure-row4.ts';

const f32 = Math.fround;
/** O que o vertex shader faz em float32: expr = floor(w·0,5 + 0,001); clarão = w − 2·expr. */
function decodeOnGpu(w: number): { expression: number; flash: number } {
  const expression = Math.floor(f32(f32(f32(w) * 0.5) + f32(0.001)));
  return { expression, flash: f32(f32(w) - f32(2 * expression)) };
}

// Clarões de teste: as pontas, valores comuns, o maior float32 abaixo de 1 e os que o clamp corta.
const FLASHES = [0, 1e-7, 0.001, 0.25, 0.5, 0.75, 0.999, f32(1 - 2 ** -24), 1, 1.5, -0.3, Number.NaN];
const clamp01 = (x: number): number => (x > 0 ? (x < 1 ? x : 1) : 0);

describe('4ª linha do boneco (writeFigureRow4 / figureRow4Expression)', () => {
  it('ida e volta: expressão 0..7 e clarão em [0, 1] (com 1,0) no float32 que a GPU vê', () => {
    const m = new Float32Array(32);
    for (let e = 0; e < 8; e++) {
      for (const flash of FLASHES) {
        writeFigureRow4(m, 16, 0.25, 0.5, 0.75, e, flash);
        const w = m[16 + 15]!;
        expect(w).toBe(f32(w));
        // Gêmeo da CPU (double) e o shader em float32 dão a mesma expressão.
        expect(figureRow4Expression(w)).toBe(e);
        const gpu = decodeOnGpu(w);
        expect(gpu.expression).toBe(e);
        // O clarão volta com o erro do float32 em [2e, 2e + 1] (ulp ≤ 2^−20 com e ≤ 7).
        expect(Math.abs(gpu.flash - clamp01(flash))).toBeLessThanOrEqual(1e-6);
        expect(gpu.flash).toBeGreaterThanOrEqual(0);
        expect(gpu.flash).toBeLessThanOrEqual(1);
      }
    }
  });

  it('clarão 1,0 exato: w ímpar (2e + 1) e a expressão não sobe para e + 1', () => {
    const m = new Float32Array(16);
    for (let e = 0; e < 8; e++) {
      writeFigureRow4(m, 0, 1, 1, 0, e, 1);
      expect(m[15]).toBe(2 * e + 1);
      expect(figureRow4Expression(m[15]!)).toBe(e);
      expect(decodeOnGpu(m[15]!)).toEqual({ expression: e, flash: 1 });
    }
  });

  it('escreve só a 4ª linha (m[o+3], m[o+7], m[o+11], m[o+15]); a afim do FK fica intocada', () => {
    const m = new Float32Array(48).fill(-7);
    writeFigureRow4(m, 16, 0.1, 0.2, 0.3, 5, 0.5);
    expect(m[16 + 3]).toBe(f32(0.1));
    expect(m[16 + 7]).toBe(f32(0.2));
    expect(m[16 + 11]).toBe(f32(0.3));
    expect(m[16 + 15]).toBe(10.5);
    const row4 = new Set([19, 23, 27, 31]);
    for (let k = 0; k < m.length; k++) if (!row4.has(k)) expect(m[k]).toBe(-7);
  });
});
