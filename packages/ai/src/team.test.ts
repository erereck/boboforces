import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { createInputFrames, createSim, SIM_HZ, type SimMap } from '@boboforces/sim';
import { createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { AI_TEAM } from './config.ts';
import { createHeadlessMatch } from './headless.ts';
import { TeamBoard } from './team.ts';

/** M2, fases 3e e 3f: o quadro do time (avisos do N3, calor e perigo do N4). */

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);

function arena(): SimMap {
  const grid = createWorldGrid(40, 12, 80);
  fillBox(grid, 0, 0, 0, 39, 0, 79, concrete);
  return {
    grid,
    blocks,
    spawns: [
      { x: 10, y: 0.5, z: 30, yaw: 0, team: 0 },
      { x: 10, y: 0.5, z: 15, yaw: Math.PI, team: 1 },
    ],
  };
}

function duel(level: 'normal' | 'sweaty' | 'tryhard'): MatchRecipe {
  return {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'test',
    seed: 2,
    teams: [{ humans: 1, bots: [] }, { bots: [{ ref: builtinBotRef(level), count: 1 }] }],
  };
}

describe('quadro do time', () => {
  it('avisos: o mais novo do time, dentro da idade e da distância; os outros times não veem', () => {
    const board = new TeamBoard(40, 80, SIM_HZ, false);
    board.post(1, 5, 0.5, 5, 100);
    board.post(1, 6, 0.5, 6, 130);
    board.post(0, 7, 0.5, 7, 140);
    expect(board.pingX[board.freshest(1, 0, 0, 140, 60, 50)]).toBe(6);
    expect(board.freshest(1, 0, 0, 300, 60, 50)).toBe(-1);
    expect(board.freshest(1, 100, 100, 140, 60, 50)).toBe(-1);
    expect(board.pingX[board.freshest(0, 0, 0, 140, 60, 50)]).toBe(7);
  });

  it('calor: onde o humano fica e de onde ele mata, para o time inimigo; decai; perigo onde o time morre', () => {
    const recipe = duel('normal');
    const sim = createSim({ recipe, map: arena(), humans: 1 });
    const frames = createInputFrames();
    const board = new TeamBoard(40, 80, sim.hz, false);
    for (let i = 0; i < 5 * SIM_HZ; i++) {
      board.update(sim.view(), sim.tick);
      sim.step(frames);
    }
    const humanCell = board.cell(10, 30);
    const cells = board.cellsX * board.cellsZ;
    expect(board.heat[1 * cells + humanCell]).toBeGreaterThan(AI_TEAM.minHeat);
    expect(board.heat[0 * cells + humanCell]).toBe(0);
    expect(board.hottest(1, 10, 15, 5, 40, AI_TEAM.minHeat)).toBe(humanCell);
    // Sem humano por perto (só decaindo), o calor cai.
    const before = board.heat[1 * cells + humanCell]!;
    const empty = new TeamBoard(40, 80, sim.hz, false);
    empty.heat.set(board.heat);
    const view = sim.view();
    const savedTeam = view.team[0];
    // Tira o humano da conta trocando o controlador dele por um de bot (só neste rascunho do teste).
    (view.controller as Int16Array)[0] = 99;
    for (let i = 0; i < 60; i++) empty.update(view, i * SIM_HZ);
    (view.controller as Int16Array)[0] = 0;
    expect(empty.heat[1 * cells + humanCell]!).toBeLessThan(before * 0.6);
    expect(savedTeam).toBe(0);
    // Morte de um bobo do time 1 na célula dele vira perigo para o time 1.
    (view.deaths as Uint16Array)[1] = 1;
    board.update(view, sim.tick);
    expect(board.dangerAt(1, 10, 15)).toBeGreaterThan(0);
  });

  it('o bot N3 que vê o humano avisa o time; o N2 não avisa', () => {
    const run = (level: 'normal' | 'sweaty'): number => {
      const match = createHeadlessMatch({ recipe: duel(level), map: arena(), humans: 1 });
      match.run(3 * SIM_HZ);
      const out = new Float64Array(24);
      const n = match.director.pings(1, 3 * SIM_HZ, out);
      if (n > 0) expect(Math.hypot(out[0]! - 10, out[2]! - 30)).toBeLessThan(2);
      match.dispose();
      return n;
    };
    expect(run('sweaty')).toBeGreaterThan(0);
    expect(run('normal')).toBe(0);
  });
});
