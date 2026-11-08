import { describe, expect, it } from 'vitest';
import { formatReport, killDeath, runDuels } from './duel.ts';

describe('robô de balanceamento', () => {
  it('Tryhard atropela Pela vibe', () => {
    const r = runDuels({ roundsPerPair: 30, seed: 1, levels: ['vibe', 'tryhard'] });
    const pair = r.pairs[0]!;
    expect(pair.highWins).toBeGreaterThan(pair.lowWins * 4);
    expect(r.ok).toBe(true);
  });

  it('versão curta da checagem do CI: os 5 níveis em ordem estritamente crescente', () => {
    const r = runDuels({ roundsPerPair: 40, seed: 42 });
    expect(r.rounds).toBe(400);
    expect(r.problems).toEqual([]);
    for (let i = 1; i < r.levels.length; i++) {
      expect(killDeath(r.levels[i]!)).toBeGreaterThan(killDeath(r.levels[i - 1]!));
    }
    expect(formatReport(r)).toContain('OK');
  }, 60_000);
});
