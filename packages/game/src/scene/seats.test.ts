import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { expandRecipe } from '@boboforces/sim';
import { describe, expect, it } from 'vitest';
import { onlineRecipe } from '../online-api.ts';
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

describe('M9 (fase 3): o sofá e a sala com até 4 times (o Bobo Sandbox)', () => {
  const sandbox: MatchRecipe = {
    ...tdm,
    mode: 'sandbox',
    teams: [
      { bots: [{ ref, count: 3 }] },
      { bots: [{ ref, count: 3 }] },
      { humans: 'all', bots: [{ ref, count: 2 }] },
      { bots: [{ ref, count: 3 }] },
    ],
  };
  const seat = (index: number, side: number): LocalSeat => ({ device: { kind: 'gamepad', index }, side });

  it('sofá: o P1 no time dos humanos da receita (o Verde); os outros contam a partir dele, dando a volta', () => {
    const r = seatRecipe(sandbox, [seat(0, 0), seat(1, 1), seat(2, 2), seat(3, 0)]);
    // P1 e P4 no Verde (2), P2 no Roxo (3), P3 no Laranja (0, dando a volta); cada time do mesmo tamanho.
    expect(r.recipe.teams.map((tm) => tm.humans)).toEqual([1, 0, 2, 1]);
    expect(teamSizes(r.recipe, 4)).toEqual([3, 3, 3, 3]);
    // Os controladores seguem a ordem da sim: o Laranja (P3), o Verde (P1 e P4), o Roxo (P2).
    expect(r.controllers).toEqual([1, 3, 0, 2]);
    const slots = expandRecipe(r.recipe, 4);
    expect(r.controllers.map((c) => slots.find((s) => s.controller === c)!.team)).toEqual([2, 3, 0, 2]);
  });

  it('sala: cada um no time que escolheu (0 a 3); "tanto faz" vai para o time com menos gente (no empate, o de casa)', () => {
    const r = onlineRecipe(sandbox, [3, -1, 1, -1]);
    expect(r.recipe.teams.map((tm) => tm.humans)).toEqual([1, 1, 1, 1]);
    expect(teamSizes(r.recipe, 4)).toEqual([3, 3, 3, 3]);
    const slots = expandRecipe(r.recipe, 4);
    // M9 (fase 3, revisão): no empate, o "tanto faz" cai primeiro no time de casa da receita (o Verde, 2).
    expect(r.controllers.map((c) => slots.find((s) => s.controller === c)!.team)).toEqual([3, 2, 1, 0]);
    // Um time que a receita não tem (o 3 num Sandbox de 3) vale como "tanto faz".
    const three = { ...sandbox, teams: sandbox.teams.slice(0, 3) };
    const t3 = onlineRecipe(three, [3, 2]);
    expect(t3.recipe.teams.map((tm) => tm.humans)).toEqual([1, 0, 1]);
  });
});
