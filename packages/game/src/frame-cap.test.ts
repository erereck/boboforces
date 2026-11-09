import { describe, expect, it } from 'vitest';
import { skipCappedFrame } from './frame-cap.ts';

/** M2, fase 6e: o limitador de 30 FPS desenha 1 de cada 2 quadros a 60 Hz e 1 de cada 4 a 120 Hz. */

function drawn(cap: number, hz: number, frames: number): number {
  let last = -1;
  let n = 0;
  for (let i = 0; i < frames; i++) {
    const now = (i * 1000) / hz;
    if (skipCappedFrame(cap, last, now)) continue;
    last = now;
    n++;
  }
  return n;
}

describe('limitador de quadros', () => {
  it('60 não limita; 30 desenha metade a 60 Hz e um quarto a 120 Hz', () => {
    expect(drawn(60, 60, 120)).toBe(120);
    expect(drawn(30, 60, 120)).toBe(60);
    expect(drawn(30, 120, 240)).toBe(60);
    // O primeiro quadro sempre sai.
    expect(skipCappedFrame(30, -1, 0)).toBe(false);
  });
});
