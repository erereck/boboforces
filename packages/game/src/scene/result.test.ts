import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { createInputFrames, createSim, NULL_ENTITY, type SimEvent } from '@boboforces/sim';
import { createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { challengeLevel, stepLevel } from '../pause.ts';
import {
  accuracyPct,
  createMatchStats,
  PRIZE_RULES,
  recordMatchEvent,
  summarizeMatch,
  trainingNumbers,
} from './result.ts';

/** M2, fase 2e: as contas do resultado (tiros e acertos por tick, sequência, Nêmesis, Freguês, prêmios). */

const ev = (e: Record<string, unknown>): SimEvent => e as unknown as SimEvent;
const id = (index: number): number => (1 << 16) | index;

describe('estatísticas pelos eventos', () => {
  it('um tiro por tick (os 8 chumbos da escopeta e o foguete contam um) e um acerto por tick', () => {
    const st = createMatchStats(8);
    for (let p = 0; p < 8; p++) recordMatchEvent(st, ev({ type: 'shot', tick: 10, shooter: id(1) }), NULL_ENTITY);
    recordMatchEvent(st, ev({ type: 'projectile', action: 'launch', tick: 20, owner: id(1) }), NULL_ENTITY);
    recordMatchEvent(st, ev({ type: 'projectile', action: 'bounce', tick: 21, owner: id(1) }), NULL_ENTITY);
    recordMatchEvent(st, ev({ type: 'hit', tick: 10, shooter: id(1), target: id(2) }), NULL_ENTITY);
    recordMatchEvent(st, ev({ type: 'hit', tick: 10, shooter: id(1), target: id(3) }), NULL_ENTITY);
    // Dano em si mesmo (o próprio foguete) não é acerto.
    recordMatchEvent(st, ev({ type: 'hit', tick: 20, shooter: id(1), target: id(1) }), NULL_ENTITY);
    expect([st.shots[1], st.hits[1], accuracyPct(st, 1)]).toEqual([2, 1, 50]);
    expect(accuracyPct(st, 2)).toBe(-1);
    // M2 (fase 4g): cabeça conta uma por tick, mesmo quando o primeiro chumbo do tick pegou no tronco.
    recordMatchEvent(st, ev({ type: 'hit', tick: 30, shooter: id(1), target: id(2), part: 'torso' }), NULL_ENTITY);
    recordMatchEvent(st, ev({ type: 'hit', tick: 30, shooter: id(1), target: id(2), part: 'head' }), NULL_ENTITY);
    recordMatchEvent(st, ev({ type: 'hit', tick: 30, shooter: id(1), target: id(2), part: 'head' }), NULL_ENTITY);
    expect([st.hits[1], st.heads[1]]).toEqual([2, 1]);
  });

  it('sequência sem morrer, quedas e quem mata o humano / quem o humano mata', () => {
    const st = createMatchStats(8);
    const human = id(0);
    const kill = (killer: number, victim: number): void =>
      recordMatchEvent(st, ev({ type: 'kill', tick: 1, killer, victim }), human);
    kill(human, id(3));
    kill(human, id(3));
    kill(human, id(4));
    kill(id(5), human);
    kill(human, id(3));
    kill(NULL_ENTITY, id(4));
    kill(id(4), id(4));
    expect([st.bestStreak[0], st.streak[0]]).toEqual([3, 1]);
    expect([st.killedByHuman[3], st.killedByHuman[4], st.killedHuman[5]]).toEqual([3, 1, 1]);
    expect(st.mishaps[4]).toBe(2);
  });
});

describe('Bobo Training (M2, fase 5d)', () => {
  it('TTK médio: do 1º acerto do humano ao abate dele; abate de outro zera a contagem daquele alvo', () => {
    const st = createMatchStats(8);
    const human = id(0);
    const hit = (tick: number, target: number, part = 'torso'): void =>
      recordMatchEvent(st, ev({ type: 'hit', tick, shooter: human, target: id(target), part }), human);
    const kill = (tick: number, killer: number, victim: number): void =>
      recordMatchEvent(
        st,
        ev({ type: 'kill', tick, killer: killer < 0 ? NULL_ENTITY : id(killer), victim: id(victim) }),
        human,
      );
    hit(100, 1);
    hit(120, 1, 'head');
    kill(130, 0, 1); // 30 ticks
    hit(200, 2);
    kill(260, 3, 2); // outro matou: não conta
    hit(300, 2);
    kill(390, 0, 2); // 90 ticks
    expect([st.ttk[0], st.ttk[1]]).toEqual([120, 2]);
    const view = { kills: new Uint16Array([2, 0, 0, 0, 0, 0, 0, 0]) } as never;
    const out = { accuracy: 0, headPct: 0, ttkS: 0, kills: 0 };
    trainingNumbers(st, view, 0, 60, out);
    expect(out.ttkS).toBeCloseTo(1, 9);
    expect(out.kills).toBe(2);
    expect(out.headPct).toBe(25);
  });
});

describe('resumo do fim', () => {
  function duel() {
    const grid = createWorldGrid(40, 12, 80);
    const blocks = createTestBlocks();
    fillBox(grid, 0, 0, 0, 39, 0, 79, makeCell(blocks.byKey('concrete')!.id));
    const recipe: MatchRecipe = {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.tdm',
      map: 'test',
      seed: 1,
      teams: [
        { humans: 1, bots: [{ ref: builtinBotRef('normal'), count: 1 }] },
        { bots: [{ ref: builtinBotRef('normal'), count: 2 }] },
      ],
    };
    const spawns = [
      { x: 10, y: 0.5, z: 30, yaw: 0, team: 0 },
      { x: 10, y: 0.5, z: 10, yaw: 0, team: 1 },
    ];
    const sim = createSim({ recipe, map: { grid, blocks, spawns }, humans: 1 });
    sim.step(createInputFrames());
    return sim;
  }

  it('derrota feia, MVP, Nêmesis, Freguês, os 3 números e até 3 prêmios', () => {
    const sim = duel();
    const v = sim.view();
    const m = v.match as unknown as { winnerTeam: number; teamScore: Int32Array };
    m.teamScore[0] = 10;
    m.teamScore[1] = 25;
    m.winnerTeam = 1;
    // Entidades: 0 = você, 1 = aliado, 2 e 3 = adversários.
    const kills = v.kills as Uint16Array;
    const deaths = v.deaths as Uint16Array;
    const assists = v.assists as Uint16Array;
    kills.set([4, 6, 15, 10]);
    deaths.set([9, 7, 3, 8]);
    assists.set([1, 4, 0, 2]);
    const st = createMatchStats(v.capacity);
    st.killedHuman[2] = 5;
    st.killedHuman[3] = 4;
    st.killedByHuman[3] = 3;
    st.bestStreak[0] = 2;
    st.shots[0] = 40;
    st.hits[0] = 10;
    st.shots[1] = PRIZE_RULES.crookedAimMinShots;
    st.hits[1] = 1;
    st.shots[2] = 90;
    st.hits[2] = 60;
    st.shots[3] = 3;
    st.mishaps[3] = 2;
    const sum = summarizeMatch(st, v, 0, false);
    expect([sum.outcome, sum.ownScore, sum.otherScore, sum.uglyLoss]).toEqual(['loss', 10, 25, true]);
    expect([sum.mvp, sum.nemesis, sum.nemesisKills, sum.victim, sum.victimKills]).toEqual([2, 2, 5, 3, 3]);
    expect([sum.kills, sum.accuracy, sum.bestStreak]).toEqual([4, 25, 2]);
    // M2 (fase 4g): o resto dos números do jogador (para o `stats@1`).
    expect([sum.deaths, sum.assists, sum.shots, sum.hits, sum.headshots]).toEqual([9, 1, 40, 10, 0]);
    expect(sum.prizes.map((p) => [p.prize, p.entity])).toEqual([
      ['crookedAim', 1],
      ['kamikaze', 3],
      // Um prêmio por bobo: o 3 já é o Kamikaze, então o covarde é quem menos atirou entre os outros.
      ['coward', 0],
    ]);
    m.winnerTeam = 0;
    m.teamScore[0] = 25;
    expect(summarizeMatch(st, v, 0, false).outcome).toBe('win');
    m.winnerTeam = -1;
    expect(summarizeMatch(st, v, 0, false).outcome).toBe('draw');
  });
});

describe('nível rápido', () => {
  it('um passo para cada lado sem passar das pontas; a ação do "Ajustar desafio" vira nível', () => {
    expect([stepLevel('normal', -1), stepLevel('normal', 1)]).toEqual(['chill', 'sweaty']);
    expect([stepLevel('vibe', -1), stepLevel('tryhard', 1)]).toEqual(['vibe', 'tryhard']);
    expect([challengeLevel('level:sweaty'), challengeLevel('level:xx'), challengeLevel('back')]).toEqual([
      'sweaty',
      null,
      null,
    ]);
  });
});
