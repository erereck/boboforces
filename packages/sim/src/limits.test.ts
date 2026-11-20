import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { describe, expect, it } from 'vitest';
import { SIM_HZ } from './constants.ts';
import { matchLimits } from './recipe.ts';
import { createSim } from './sim.ts';
import { buildSyntheticConstruto } from './testing/index.ts';

/**
 * M9 (fase 3): os limites efetivos da receita (`matchLimits`): a mesma conta do `createSim`, que o HUD e a dica da
 * derrota feia leem (não os crus da receita).
 */

const bots = [{ ref: builtinBotRef('normal'), count: 1 }];
const base: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'warfare.tdm',
  map: 'construto',
  seed: 3,
  teams: [{ bots }, { bots }],
};
const with_ = (extra: Partial<MatchRecipe>): MatchRecipe => ({ ...base, ...extra });

describe('os limites efetivos da partida (M9, fase 3)', () => {
  it('fora do Sandbox, os da receita (ausente = sem); nas rodadas e no Royale, nenhum', () => {
    expect(matchLimits(base)).toEqual({ timeLimitS: 0, scoreLimit: 0 });
    expect(matchLimits(with_({ match: { timeLimitS: 300, scoreLimit: 30 } }))).toEqual({
      timeLimitS: 300,
      scoreLimit: 30,
    });
    expect(matchLimits(with_({ mode: 'strike', match: { timeLimitS: 300, scoreLimit: 30 } }))).toEqual({
      timeLimitS: 0,
      scoreLimit: 0,
    });
    expect(
      matchLimits(with_({ mode: 'juggernaut', juggernaut: { variant: 'fixed' }, match: { timeLimitS: 300 } })),
    ).toEqual({ timeLimitS: 0, scoreLimit: 0 });
  });

  it('no Sandbox: os padrões; a eliminação sem meta e sempre com tempo; o "nenhum" sem os dois', () => {
    const sandbox = (extra: Partial<MatchRecipe>): MatchRecipe => with_({ mode: 'sandbox', ...extra });
    expect(matchLimits(sandbox({}))).toEqual({ timeLimitS: 600, scoreLimit: 75 });
    expect(matchLimits(sandbox({ match: { timeLimitS: 0, scoreLimit: 20 } }))).toEqual({
      timeLimitS: 0,
      scoreLimit: 20,
    });
    const elimination = { sandbox: { objective: 'elimination' as const } };
    expect(matchLimits(sandbox({ ...elimination, match: { timeLimitS: 300, scoreLimit: 20 } }))).toEqual({
      timeLimitS: 300,
      scoreLimit: 0,
    });
    expect(matchLimits(sandbox({ ...elimination, match: { timeLimitS: 0 } }))).toEqual({
      timeLimitS: 600,
      scoreLimit: 0,
    });
    expect(matchLimits(sandbox({ sandbox: { objective: 'none' }, match: { timeLimitS: 300 } }))).toEqual({
      timeLimitS: 0,
      scoreLimit: 0,
    });
  });

  it('a sim joga os mesmos limites', () => {
    const { map } = buildSyntheticConstruto();
    for (const r of [
      base,
      with_({ mode: 'sandbox' }),
      with_({ mode: 'sandbox', sandbox: { objective: 'elimination' }, match: { timeLimitS: 0 } }),
      with_({ mode: 'sandbox', sandbox: { objective: 'none' }, match: { timeLimitS: 180 } }),
    ]) {
      const { timeLimitS } = matchLimits(r);
      const ticks = createSim({ recipe: r, map, humans: 0 }).view().match.ticksLeft;
      expect(ticks, JSON.stringify(r.sandbox ?? r.mode)).toBe(timeLimitS > 0 ? timeLimitS * SIM_HZ : -1);
    }
  });
});
