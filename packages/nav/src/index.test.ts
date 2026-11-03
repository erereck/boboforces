import { createWorldGrid } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { buildNavGraph, NAV_NODE_CELLS, NO_NAV_NODE } from './index.ts';

// Stub do M0: o teste existe para o projeto do Vitest nunca ficar vazio (a raiz não aceita projeto sem teste).
describe('nav (stub do M0)', () => {
  it('contrato: nó de 1,0 m, "nenhum nó" é -1, e o grafo ainda não existe (M1)', () => {
    expect(NAV_NODE_CELLS).toBe(2);
    expect(NO_NAV_NODE).toBe(-1);
    expect(() => buildNavGraph(createWorldGrid(4, 4, 4))).toThrow('M1');
  });
});
