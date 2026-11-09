import { describe, expect, it } from 'vitest';
import { botLookIndices } from './figures.ts';

describe('botLookIndices (fase 8a: look do bot pelo nome)', () => {
  it('o mesmo nome dá o mesmo look em qualquer partida e posição', () => {
    const a = botLookIndices(['Jogador 1', 'Dona Mira', 'Cabo Tenso'], 11);
    const b = botLookIndices(['Cabo Tenso', 'Jogador 1', 'Dona Mira', 'Zé Granada'], 11);
    expect(b[2]).toBe(a[1]);
    expect(b[0]).toBe(a[2]);
  });

  it('nomes repetidos seguem a rotação e não saem iguais', () => {
    const looks = botLookIndices(['Bob Normal', 'Bob Normal', 'Bob Normal'], 11);
    expect(new Set(looks).size).toBe(3);
    expect(looks[1]).toBe((looks[0]! + 1) % 11);
  });

  it('fica dentro da rotação, mesmo com 1 look ou nome ausente', () => {
    expect([...botLookIndices(['a', undefined, 'b'], 1)]).toEqual([0, 0, 0]);
    for (const v of botLookIndices(['a', 'b', 'c', 'd'], 3)) expect(v).toBeLessThan(3);
  });
});
