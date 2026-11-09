import { describe, expect, it } from 'vitest';
import { LOOP_FORMAT, parseLoopManifest } from './audio-loop.ts';

describe('loop@1 (M2, fase 7d)', () => {
  it('lê o manifesto que o audioconv escreve', () => {
    expect(parseLoopManifest({ format: 'boboforces/loop@1', loopStartS: 0.0346, loopS: 85.333333 })).toEqual({
      format: LOOP_FORMAT,
      loopStartS: 0.0346,
      loopS: 85.333333,
    });
  });

  it('recusa formato errado, versão nova e números fora da faixa', () => {
    expect(() => parseLoopManifest(null)).toThrow(/objeto/);
    expect(() => parseLoopManifest({ format: 'boboforces/layers@1', loopStartS: 0, loopS: 10 })).toThrow(/formato/);
    expect(() => parseLoopManifest({ format: 'boboforces/loop@2', loopStartS: 0, loopS: 10 })).toThrow(/versão/);
    expect(() => parseLoopManifest({ format: 'boboforces/loop@1', loopStartS: -1, loopS: 10 })).toThrow(/loopStartS/);
    expect(() => parseLoopManifest({ format: 'boboforces/loop@1', loopStartS: 0, loopS: 999 })).toThrow(/loopS/);
  });
});
