import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { hashToHex } from '@boboforces/shared';
import { SIM_HZ } from '@boboforces/sim';
import { buildSyntheticConstruto, TEST_NAV_PATHS } from '@boboforces/sim/testing';
import { describe, expect, it } from 'vitest';
import { createHeadlessMatch } from './headless.ts';

/**
 * M9 (fase 2): a IA no Bobo Sandbox com 4 times no Construto sintético (com navegação): na eliminação (sem respawn) os
 * bots caçam o inimigo vivo mais perto e a partida acaba bem antes do tempo; com 3 e 4 times, todo mundo briga com
 * todo mundo (a hostilidade é `team !==`).
 */
const { map } = buildSyntheticConstruto({ nav: true });

function recipe(teams: number, objective: 'elimination' | 'points'): MatchRecipe {
  return {
    format: MATCH_RECIPE_FORMAT,
    mode: 'sandbox',
    map: 'test',
    seed: 7,
    sandbox: { objective },
    match: { timeLimitS: 600, scoreLimit: 0 },
    teams: Array.from({ length: teams }, () => ({ bots: [{ ref: builtinBotRef('normal'), count: 2 }] })),
  };
}

function play(r: MatchRecipe, maxTicks: number): { hash: string; ticks: number; winner: number; killed: number[] } {
  /** Abates sofridos por time (a vítima é do time). */
  const killed = [0, 0, 0, 0];
  const match = createHeadlessMatch({
    recipe: r,
    map,
    humans: 0,
    paths: TEST_NAV_PATHS,
    onEvents: (events, sim) => {
      for (const ev of events) if (ev.type === 'kill') killed[sim.view().team[ev.victim & 0xffff]!]!++;
    },
  });
  let t = 0;
  for (; t < maxTicks && match.sim.view().match.phase !== 'ended'; t++) match.step();
  const out = {
    hash: hashToHex(match.sim.stateHash()),
    ticks: t,
    winner: match.sim.view().match.winnerTeam,
    killed,
  };
  match.dispose();
  return out;
}

describe('IA no Bobo Sandbox (M9, fase 3)', () => {
  it('eliminação com 4 times: os bots caçam e a partida acaba com um vencedor; determinística', () => {
    const a = play(recipe(4, 'elimination'), 600 * SIM_HZ);
    const b = play(recipe(4, 'elimination'), 600 * SIM_HZ);
    expect(b).toEqual(a);
    const msg = `${Math.round(a.ticks / SIM_HZ)} s, vencedor ${a.winner}, abatidos por time ${a.killed.join('/')}`;
    expect(a.ticks, msg).toBeLessThan(300 * SIM_HZ);
    expect(a.winner, msg).toBeGreaterThanOrEqual(0);
    // Ninguém volta: cada time perdeu no máximo os 2 que tinha, e só o vencedor ficou com alguém.
    for (let t = 0; t < 4; t++) expect(a.killed[t], msg).toBeLessThanOrEqual(2);
    expect(
      a.killed.reduce((s, k) => s + k, 0),
      msg,
    ).toBeGreaterThanOrEqual(6);
  }, 120_000);

  it('pontos com 3 times: todos os times abatem e são abatidos', () => {
    const a = play(recipe(3, 'points'), 90 * SIM_HZ);
    for (let t = 0; t < 3; t++) expect(a.killed[t], `abatidos por time ${a.killed.join('/')}`).toBeGreaterThan(0);
  }, 120_000);
});
