import { DEBUT_PRESET, presetLevel, validateMatchRecipe, withPresetLevel, type MatchRecipe } from '@boboforces/format';
import { createRng } from '@boboforces/shared';
import { describe, expect, it } from 'vitest';
import { presetLines, presetShortcut, presetSummary, rollSurprise } from './presets-ui.ts';

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
    // M8 (fase 5): o Diretor ligado aparece no resumo (e no lobby online).
    expect(presetSummary({ ...ffa, director: { goal: 'relax' } })).toBe(
      'Todos contra todos · 8 bobos · Construto · Diretor ligado',
    );
    expect(presetLines(ffa).at(-1)).toBe('10 min');
  });

  it('M9 (fase 3): o Cenário do Sandbox com 3 e 4 times: "3×3×2×2", e a duração pelo objetivo', () => {
    const bots = (count: number) => [{ ref: 'builtin:normal-bob' as const, count }];
    const four: MatchRecipe = {
      ...DEBUT_PRESET,
      mode: 'sandbox',
      match: {},
      teams: [{ humans: 'all', bots: bots(2) }, { bots: bots(3) }, { bots: bots(2) }, { bots: bots(2) }],
    };
    expect(presetSummary(four)).toBe('Sandbox · Normal · 3×3×2×2 · Construto');
    expect(presetShortcut(four)).toEqual({ label: '3×3×2×2 Normal', caption: 'Sandbox · 10 min ou 75 abates' });
    expect(presetShortcut({ ...four, name: 'Cenário 3×3×2×2' }).label).toBe('Cenário 3×3×2×2');
    const three = { ...four, teams: four.teams.slice(0, 3) };
    expect(presetSummary(three)).toBe('Sandbox · Normal · 3×3×2 · Construto');
    // A eliminação sem meta (e sempre com tempo); o "nenhum", sem os dois.
    const elim = { ...three, sandbox: { objective: 'elimination' as const }, match: { timeLimitS: 0, scoreLimit: 30 } };
    expect(presetLines(elim)).toEqual(['Bobo Sandbox', 'Construto', 'Normal', '3×3×2', '10 min']);
    expect(presetShortcut({ ...three, sandbox: { objective: 'none' } }).caption).toBe('Sandbox');
    // Com 2 times, o de sempre.
    expect(presetSummary({ ...four, teams: four.teams.slice(0, 2) })).toBe('Sandbox · Normal · 3 contra 3 · Construto');
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
