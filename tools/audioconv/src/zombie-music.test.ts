import { fnv1a32 } from '@boboforces/shared';
import { describe, expect, it } from 'vitest';
import { loopLength, renderCalm, renderHorde, ZOMBIE_MUSIC } from './zombie-music.ts';

/** M3, fase 6e: a música do Bobo Zombies composta em código (2 camadas do mesmo tamanho). */

const hash = (pcm: Float32Array): string => {
  const q = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) q[i] = Math.round(pcm[i]! * 32767);
  return fnv1a32(new Uint8Array(q.buffer)).toString(16);
};

describe('música do Bobo Zombies', () => {
  // Taxa baixa no teste (a composição não depende dela): 8 compassos a 100 BPM = 19,2 s.
  const rate = 8000;

  it('as 2 camadas têm o tamanho do loop, sem NaN e com o pico da tabela', () => {
    for (const render of [renderCalm, renderHorde]) {
      const pcm = render(rate);
      expect(pcm.length).toBe(loopLength(rate));
      expect(pcm.length / rate).toBeCloseTo(19.2, 3);
      let peak = 0;
      for (const x of pcm) {
        expect(Number.isFinite(x)).toBe(true);
        peak = Math.max(peak, Math.abs(x));
      }
      expect(peak).toBeCloseTo(ZOMBIE_MUSIC.peak, 6);
    }
  });

  it('a emenda do loop não pula (o fim encosta no começo) e a receita é determinística', () => {
    for (const render of [renderCalm, renderHorde]) {
      const pcm = render(rate);
      expect(Math.abs(pcm[pcm.length - 1]! - pcm[0]!)).toBeLessThan(0.15);
      expect(hash(render(rate))).toBe(hash(pcm));
    }
  });
});
