import { createHeadlessMatch } from '@boboforces/ai';
import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BOT_CONTROLLER_BASE, type OwnerCommand } from '@boboforces/sim';
import { buildTestArena } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { createLocalDriver } from './local-driver.ts';

/** M9 (fase 4): as Ferramentas do Dono pelo driver local (sem UI): o comando, o log e o replay dele. */
const recipe: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'warfare.tdm',
  map: 'test',
  seed: 3,
  match: { timeLimitS: 0, scoreLimit: 0 },
  teams: [
    { bots: [{ ref: builtinBotRef('normal'), count: 2 }] },
    { bots: [{ ref: builtinBotRef('normal'), count: 2 }] },
  ],
};
const owner = { reserve: 2 } as const;

describe('LocalDriver: as Ferramentas do Dono', () => {
  it('o comando vale no próximo tick, vai para o log e o log toca igual na partida headless', () => {
    const driver = createLocalDriver({ recipe, map: buildTestArena(), humans: 0, writeHumanFrame: () => {}, owner });
    const plan = new Map<number, OwnerCommand>([
      [100, { kind: 'spawnBot', team: 0, x: 16, y: 0.5, z: 16, yaw: 0 }],
      [200, { kind: 'freeze', entity: driver.sim.controllerEntity(BOT_CONTROLLER_BASE), on: true }],
      [300, { kind: 'setModifier', modifier: 'speed', on: true }],
    ]);
    for (let i = 0; i < 600; i++) {
      const cmd = plan.get(i);
      if (cmd !== undefined) expect(driver.command(cmd)).toBeGreaterThan(0);
      driver.update(1 / 60);
    }
    expect(driver.ownerLog.entries.map((e) => e.cmd.kind)).toEqual(['spawnBot', 'freeze', 'setModifier']);
    expect(driver.sim.view().owner!.frozen[driver.sim.controllerEntity(BOT_CONTROLLER_BASE) & 0xffff]).toBe(1);
    const headless = createHeadlessMatch({
      recipe,
      map: buildTestArena(),
      humans: 0,
      owner,
      ownerScript: driver.ownerLog.entries,
    });
    headless.run(driver.sim.tick);
    expect(headless.sim.stateHash()).toBe(driver.sim.stateHash());
    headless.dispose();
    driver.dispose();
    // Sem as ferramentas: -1 e nada no log.
    const plain = createLocalDriver({ recipe, map: buildTestArena(), humans: 0, writeHumanFrame: () => {} });
    expect(plain.command({ kind: 'setModifier', modifier: 'speed', on: true })).toBe(-1);
    expect(plain.ownerLog.entries).toHaveLength(0);
    plain.dispose();
  });
});
