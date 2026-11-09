import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { buildNavGrid } from '@boboforces/nav';
import { AI_PATH } from './config.ts';
import { BOBO_NAV_METRICS, BOT_CONTROLLER_BASE, entityIndex, SIM_HZ, type SimMap } from '@boboforces/sim';
import { createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { createHeadlessMatch } from './headless.ts';

/**
 * M2, fase 2b: bot parado (GDD §3.8). Um bot nasce num cercado de 1 × 1 m com paredes de 4 m (uma ilha da
 * navegação): sem caminho para fora, ele empurra a parede e, depois de 8 s sem progresso, aperta Destravar.
 */

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);

function penMap(): SimMap {
  const grid = createWorldGrid(40, 16, 80);
  fillBox(grid, 0, 0, 0, 39, 0, 79, concrete);
  fillBox(grid, 19, 1, 39, 22, 8, 39, concrete);
  fillBox(grid, 19, 1, 42, 22, 8, 42, concrete);
  fillBox(grid, 19, 1, 39, 19, 8, 42, concrete);
  fillBox(grid, 22, 1, 39, 22, 8, 42, concrete);
  return {
    grid,
    blocks,
    spawns: [{ x: 10.5, y: 0.5, z: 20.5, yaw: 0, team: 0 }],
    nav: buildNavGrid({ grid, blocks }, BOBO_NAV_METRICS),
  };
}

describe('bot parado', () => {
  it('8 s sem progresso na rota: aperta Destravar e sai do cercado', () => {
    const recipe: MatchRecipe = {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.tdm',
      map: 'test',
      seed: 5,
      teams: [{ bots: [{ ref: builtinBotRef('normal'), count: 1 }] }],
    };
    const ticks: number[] = [];
    const match = createHeadlessMatch({
      recipe,
      map: penMap(),
      humans: 0,
      onEvents: (events, sim) => {
        for (const ev of events) if (ev.type === 'unstuck') ticks.push(sim.tick);
      },
    });
    match.run((AI_PATH.unstuckS + 1) * SIM_HZ);
    expect(ticks.length).toBe(1);
    expect(ticks[0]! / SIM_HZ).toBeGreaterThanOrEqual(AI_PATH.unstuckS);
    const v = match.sim.view();
    const e = entityIndex(match.sim.controllerEntity(BOT_CONTROLLER_BASE));
    const x = v.position[e * 3]!;
    const z = v.position[e * 3 + 2]!;
    expect(x > 9.5 && x < 11.5 && z > 19.5 && z < 21.5).toBe(false);
    match.dispose();
  });
});
