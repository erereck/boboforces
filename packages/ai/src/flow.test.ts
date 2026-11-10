import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { buildNavGrid } from '@boboforces/nav';
import { quantizeAxis } from '@boboforces/input';
import { yawToU16 } from '@boboforces/shared';
import { BOBO_NAV_METRICS, entityIndex, SIM_HZ, ZOMBIE_CONTROLLER_BASE, type SimMap } from '@boboforces/sim';
import { cellCenter, createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { createHeadlessMatch } from './headless.ts';

/** M3 (fase 3c): os zumbis pelo flow field compartilhado, na navegação de verdade do `nav`. */

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);

/**
 * Duas salas separadas por um muro de 3 m em z = 20 m, com passagem só no lado leste (x = 16..20 m). O humano fica ao
 * sul (z = 30 m); os zumbis nascem ao norte (z = 10 m) e precisam dar a volta.
 */
function twoRooms(): SimMap {
  const grid = createWorldGrid(40, 12, 80);
  fillBox(grid, 0, 0, 0, 39, 0, 79, concrete);
  fillBox(grid, 0, 1, 40, 31, 6, 40, concrete);
  return {
    grid,
    blocks,
    spawns: [
      { x: cellCenter(8), y: 0.5, z: 30, yaw: Math.PI, team: 0 },
      { x: cellCenter(8), y: 0.5, z: 10, yaw: Math.PI, team: -1 },
    ],
    nav: buildNavGrid({ grid, blocks }, BOBO_NAV_METRICS),
  };
}

const RECIPE: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'warfare.tdm',
  map: 'test',
  seed: 9,
  teams: [{ humans: 1, bots: [] }],
};

describe('zumbis pelo flow field (M3, fase 3c)', () => {
  it('dão a volta no muro pelo campo, sem pedir A*, e matam no corpo a corpo', () => {
    let zombieKill = false;
    let melees = 0;
    const match = createHeadlessMatch({
      recipe: RECIPE,
      map: twoRooms(),
      humans: 1,
      zombies: 3,
      onEvents: (events) => {
        for (const ev of events) {
          if (ev.type === 'melee') melees++;
          if (ev.type === 'kill' && entityIndex(ev.killer) >= 1) zombieKill = true;
        }
      },
    });
    const z0 = match.sim.controllerEntity(ZOMBIE_CONTROLLER_BASE);
    expect(match.sim.view().position[entityIndex(z0) * 3 + 2]).toBe(10);
    // Até o primeiro campo ficar pronto, o zumbi pede A* (uma vez cada, no máximo).
    match.run(2);
    const early = match.director.stats().pathsServed;
    for (let t = 0; t < 30 * SIM_HZ && !zombieKill; t++) match.step();
    const s = match.director.stats();
    // O humano não sai do lugar: o campo é feito uma vez e não precisa ser refeito (zumbis sempre cobertos).
    expect(s.flowBuilds).toBeGreaterThanOrEqual(1);
    expect(s.flowBuilds).toBeLessThanOrEqual(2);
    expect(s.pathsServed - early).toBeLessThanOrEqual(3);
    expect(melees).toBeGreaterThan(3);
    expect(zombieKill).toBe(true);
    match.dispose();
  });

  it('o campo é refeito quando o bobo anda (e só então)', () => {
    const match = createHeadlessMatch({
      recipe: RECIPE,
      map: twoRooms(),
      humans: 1,
      zombies: 3,
      // O humano vai e volta no sul (2 s para cada lado, a ~4 m/s).
      writeHumans: (f, sim) => {
        const t = sim.view().tick;
        f[0]!.yaw = yawToU16(Math.floor(t / (2 * SIM_HZ)) % 2 === 0 ? Math.PI : 0);
        f[0]!.moveY = t < 6 * SIM_HZ ? quantizeAxis(1) : 0;
      },
    });
    match.run(6 * SIM_HZ);
    const moving = match.director.stats().flowBuilds;
    // ~4 m/s e refaz a cada 2 m andados (conferindo a cada 0,5 s): um campo por conferência, quase sempre.
    expect(moving).toBeGreaterThan(6);
    match.run(4 * SIM_HZ);
    // Parado: no máximo mais um (o do último passo) e os zumbis que nascem longe.
    expect(match.director.stats().flowBuilds - moving).toBeLessThanOrEqual(2);
    match.dispose();
  });

  it('mesma receita: mesmo hash (o campo é determinístico)', () => {
    const hash = (): number => {
      const match = createHeadlessMatch({ recipe: RECIPE, map: twoRooms(), humans: 1, zombies: 6 });
      match.run(900);
      const h = match.sim.stateHash();
      match.dispose();
      return h;
    };
    expect(hash()).toBe(hash());
  });
});
