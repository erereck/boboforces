import { DEBUT_PRESET, presetLevel, validateMatchRecipe, withPresetLevel, type MatchRecipe } from '@boboforces/format';
import { createRng } from '@boboforces/shared';
import { describe, expect, it } from 'vitest';
import { presetLines, presetSummary, rollSurprise } from './presets-ui.ts';

/** M2, fase 4c: o preset em texto e o sorteio do Surpreenda-me. */

describe('preset em texto', () => {
  it('a partida de estreia: TDM 4v4 De boa no Construto, 5 min ou 30 abates', () => {
    expect(presetSummary(DEBUT_PRESET)).toBe('Times · De boa · 4 contra 4 · Construto');
    expect(presetLines(DEBUT_PRESET)).toEqual([
      'Bobo Warfare: Times',
      'Construto',
      'De boa',
      '4 contra 4',
      '5 min ou 30 abates',
    ]);
  });

  it('FFA conta todo mundo; sem bot de nível, o nível some da linha', () => {
    const ffa: MatchRecipe = {
      ...DEBUT_PRESET,
      mode: 'warfare.ffa',
      match: { timeLimitS: 600 },
      teams: [{ humans: 'all', bots: [{ ref: 'builtin:knife-ninja', count: 7 }] }],
    };
    expect(presetSummary(ffa)).toBe('Todos contra todos · 8 bobos · Construto');
    expect(presetLines(ffa).at(-1)).toBe('10 min');
  });
});

describe('nível do preset', () => {
  it('o do lado adversário; trocar o nível troca só os bots de nível', () => {
    expect(presetLevel(DEBUT_PRESET)).toBe('chill');
    const mixed: MatchRecipe = {
      ...DEBUT_PRESET,
      teams: [
        { humans: 'all', bots: [{ ref: 'builtin:buddy', count: 1 }] },
        {
          bots: [
            { ref: 'builtin:jorge-the-immortal', count: 1 },
            { ref: 'builtin:normal-bob', count: 3 },
          ],
        },
      ],
    };
    expect(presetLevel(mixed)).toBe('normal');
    const harder = withPresetLevel(mixed, 'tryhard');
    expect(harder.teams[1]!.bots.map((b) => b.ref)).toEqual(['builtin:jorge-the-immortal', 'builtin:tryhard-bob']);
    expect(harder.teams[0]!.bots[0]!.ref).toBe('builtin:buddy');
  });
});

describe('Surpreenda-me', () => {
  it('todo sorteio é uma receita válida no teto do celular, e saem os dois modos e os 5 níveis', () => {
    const rng = createRng(7);
    const modes = new Set<string>();
    const levels = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const r = rollSurprise(rng);
      const checked = validateMatchRecipe(r, { maxBots: 12, maxLocalHumans: 1, maxViewDistanceM: 90 });
      expect(checked.ok && checked.warnings).toEqual([]);
      modes.add(r.mode);
      levels.add(presetLevel(r)!);
    }
    expect([...modes].sort()).toEqual(['warfare.ffa', 'warfare.tdm']);
    expect(levels.size).toBe(5);
  });
});
