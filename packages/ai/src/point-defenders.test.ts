import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { createRng } from '@boboforces/shared';
import { BOT_CONTROLLER_BASE, expandRecipe, SIM_HZ } from '@boboforces/sim';
import { describe, expect, it } from 'vitest';
import { PathFollower } from './paths.ts';
import { markPointDefenders, SoldierBrain, SoldierTiming } from './soldier.ts';

/**
 * M10 (a vantagem do time 0 no Domination): os defensores de ponto saem da ordem do bot DENTRO do time. Antes saíam do
 * controlador global (`controller % 3 === 0`, com os bots a partir de `BOT_CONTROLLER_BASE`): no 5 contra 5 só de bots,
 * 1 defensor no time 0 e 2 no time 1, e o time 1 vencia 290 de 504 partidas decididas no Porto espelhado.
 */
function defenders(teams: MatchRecipe['teams'], humans: number, rule: 'team' | 'controller' = 'team'): number[] {
  const recipe: MatchRecipe = {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.domination',
    map: 'construto',
    seed: 1,
    teams,
  };
  // Como o diretor: um cérebro por bot da receita, na ordem de expansão, com o time de cada um.
  const slots = expandRecipe(recipe, humans).filter((s) => s.bot !== null);
  const timing = new SoldierTiming(SIM_HZ);
  const brains = slots.map(
    (s, i) => new SoldierBrain(s.botIndex, s.controller, 'normal', createRng(i), timing, new PathFollower(i)),
  );
  markPointDefenders(
    brains,
    slots.map((s) => s.team),
  );
  const out = teams.map(() => 0);
  brains.forEach((b, i) => {
    const old = b.controller % 3 === 0;
    if (rule === 'team' ? b.pointDefender : old) out[slots[i]!.team]!++;
  });
  return out;
}

const bots = (count: number): MatchRecipe['teams'][number] => ({ bots: [{ ref: builtinBotRef('normal'), count }] });

describe('M10: os defensores do Domination, o terço de cada time', () => {
  it('a regra antiga (pelo controlador global) dava defensores diferentes a times iguais', () => {
    expect(BOT_CONTROLLER_BASE).toBe(4);
    expect(defenders([bots(5), bots(5)], 0, 'controller')).toEqual([1, 2]);
    expect(defenders([bots(2), bots(2)], 0, 'controller')).toEqual([0, 1]);
  });

  it('times com os mesmos bots têm os mesmos defensores, seja qual for o índice do time', () => {
    expect(defenders([bots(1), bots(1)], 0)).toEqual([0, 0]);
    expect(defenders([bots(2), bots(2)], 0)).toEqual([1, 1]);
    expect(defenders([bots(4), bots(4)], 0)).toEqual([1, 1]);
    expect(defenders([bots(5), bots(5)], 0)).toEqual([2, 2]);
    expect(defenders([bots(6), bots(6)], 0)).toEqual([2, 2]);
    expect(defenders([bots(8), bots(8)], 0)).toEqual([3, 3]);
    // Conta só os bots: o humano no time 0 (4 bots dele contra 5) não muda o terço de ninguém.
    expect(defenders([{ humans: 'all', ...bots(4) }, bots(5)], 1)).toEqual([1, 2]);
    // A ordem dos times não muda nada: o tamanho decide.
    expect(defenders([bots(3), bots(7)], 0)).toEqual([1, 2]);
    expect(defenders([bots(7), bots(3)], 0)).toEqual([2, 1]);
  });
});
