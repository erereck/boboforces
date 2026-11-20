import { createRng } from '@boboforces/shared';
import { describe, expect, it } from 'vitest';
import { rollBotName } from './bot-names.ts';

/** M9 (fase 5b, revisão): o gerador de nomes bobos (a Oficina e a reserva do dono). */
describe('rollBotName', () => {
  it('fora dos usados, e no limite o número também fica fora dos usados', () => {
    // Todos os 180 nomes de posto + coisa já usados: sobra o "Private Pickles N", com um N livre.
    const all = new Set<string>();
    const rng = createRng(3);
    for (let i = 0; i < 4000 && all.size < 180; i++) all.add(rollBotName(rng, all));
    expect(all.size).toBe(180);
    const first = rollBotName(createRng(9), all);
    expect(first).toMatch(/^Private Pickles \d+$/);
    // O mesmo sorteio com esse N e o seguinte já usados: sobe até um livre.
    const n = Number(first.split(' ')[2]);
    const taken = new Set([...all, first, `Private Pickles ${n + 1}`]);
    expect(rollBotName(createRng(9), taken)).toBe(`Private Pickles ${n + 2}`);
  });
});
