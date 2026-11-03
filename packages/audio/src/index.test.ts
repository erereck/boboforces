import { describe, expect, it } from 'vitest';
import { createMixer } from './index.ts';

// Stub do M0: o teste existe para o projeto do Vitest nunca ficar vazio (a raiz não aceita projeto sem teste).
describe('audio (stub do M0)', () => {
  it('o mixer ainda não existe e diz em que marco entra', () => {
    expect(() => createMixer(null)).toThrow('M2');
  });
});
