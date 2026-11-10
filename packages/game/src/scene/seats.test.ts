import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { expandRecipe } from '@boboforces/sim';
import { describe, expect, it } from 'vitest';
import { seatRecipe, type LocalSeat } from './seats.ts';

const ref = 'builtin:normal-bob';
const pad = (index: number, side: 0 | 1 = 0): LocalSeat => ({ device: { kind: 'gamepad', index }, side });

/** O JOGAR padrão: 6 × 6 com o humano no time 0. */
const tdm: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'warfare.tdm',
  map: 'construto',
  seed: 1,
  teams: [{ humans: 'all', bots: [{ ref, count: 5 }] }, { bots: [{ ref, count: 6 }] }],
};

function teamSizes(r: MatchRecipe, humans: number): number[] {
  const sizes = r.teams.map(() => 0);
  for (const s of expandRecipe(r, humans)) sizes[s.team]!++;
  return sizes;
}

describe('assentos do sofá (M3, fase 1a)', () => {
  it('1 jogador: a receita fica como está', () => {
    const r = seatRecipe(tdm, [pad(0)]);
    expect(r.recipe).toBe(tdm);
    expect(r.controllers).toEqual([0]);
  });

  it('coop: os humanos entram no time do P1 no lugar de bots aliados; os times mantêm o tamanho', () => {
    const r = seatRecipe(tdm, [pad(0), pad(1), pad(2)]);
    expect(r.controllers).toEqual([0, 1, 2]);
    expect(r.recipe.teams[0]!.humans).toBe(3);
    expect(teamSizes(r.recipe, 3)).toEqual([6, 6]);
    const slots = expandRecipe(r.recipe, 3);
    expect(slots.filter((s) => s.bot === null).map((s) => s.team)).toEqual([0, 0, 0]);
  });

  it('versus: quem escolhe "contra" vai para o time 1, depois dos humanos do time do P1', () => {
    // P2 contra, P3 com o P1, P4 contra.
    const seats = [pad(0), pad(1, 1), pad(2, 0), pad(3, 1)];
    const r = seatRecipe(tdm, seats);
    expect(r.controllers).toEqual([0, 2, 1, 3]);
    expect(teamSizes(r.recipe, 4)).toEqual([6, 6]);
    const slots = expandRecipe(r.recipe, 4);
    const teamOf = (c: number): number => slots.find((s) => s.controller === c)!.team;
    expect(r.controllers.map(teamOf)).toEqual([0, 1, 0, 1]);
  });

  it('o lado do P1 não conta; no FFA todos ficam no time único e os bots diminuem', () => {
    const ffa: MatchRecipe = { ...tdm, mode: 'warfare.ffa', teams: [{ humans: 'all', bots: [{ ref, count: 7 }] }] };
    const r = seatRecipe(ffa, [pad(0, 1), pad(1, 1)]);
    expect(r.controllers).toEqual([0, 1]);
    expect(r.recipe.teams[0]!.humans).toBe(2);
    expect(teamSizes(r.recipe, 2)).toEqual([8]);
  });

  it('no treino os alvos ficam', () => {
    const training: MatchRecipe = {
      ...tdm,
      mode: 'training',
      teams: [{ humans: 'all', bots: [{ ref, count: 4 }] }],
    };
    const r = seatRecipe(training, [pad(0), pad(1)]);
    expect(r.recipe.teams[0]!.bots).toEqual([{ ref, count: 4 }]);
    expect(r.recipe.teams[0]!.humans).toBe(2);
  });

  it('corta bots do fim da lista e nunca abaixo de zero', () => {
    const mixed: MatchRecipe = {
      ...tdm,
      teams: [
        {
          humans: 'all',
          bots: [
            { ref, count: 1 },
            { ref: 'builtin:chill-bob', count: 1 },
          ],
        },
        { bots: [{ ref, count: 1 }] },
      ],
    };
    const r = seatRecipe(mixed, [pad(0), pad(1), pad(2, 1), pad(3, 1)]);
    expect(r.recipe.teams[0]!.bots).toEqual([{ ref, count: 1 }]);
    expect(r.recipe.teams[1]!.bots).toEqual([]);
    expect(teamSizes(r.recipe, 4)).toEqual([3, 2]);
  });
});
