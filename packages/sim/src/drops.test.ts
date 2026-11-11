import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, quantizeAxis, WEAPON_SLOT_COUNT } from '@boboforces/input';
import { BLOCK_FLAG, createBlockRegistry, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { weaponDef } from './config/weapons.ts';
import { ZOMBIE_DROPS, ZOMBIES_MODE } from './config/zombie.ts';
import { SIM_HZ } from './constants.ts';
import type { PickupEvent, SimEvent } from './events.ts';
import { createInputFrames } from './loop.ts';
import { createSim, type SimMap } from './sim.ts';
import { PICKUP_KIND } from './view.ts';

/**
 * M3 (fase 4d): os drops. O zumbi nasce parado a 2,5 m na frente do humano (o único ponto sem time); com a chance em
 * 100% (`SimConfig.dropChance`), cada abate deixa um drop nos pés dele, e o humano anda até lá para pegar.
 */
const SOLID = BLOCK_FLAG.solid | BLOCK_FLAG.blocksBullets | BLOCK_FLAG.blocksSight | BLOCK_FLAG.walkable;
const blocks = createBlockRegistry([
  { key: 'concrete', shape: 'cube', faces: [1, 1, 1, 1, 1, 1], flags: SOLID, frames: 1, stepSound: 'concrete' },
]);
const concrete = makeCell(blocks.byKey('concrete')!.id);
const FLOOR = 0.5;

function map(): SimMap {
  const grid = createWorldGrid(40, 16, 60);
  fillBox(grid, 0, 0, 0, 39, 0, 59, concrete);
  return {
    grid,
    blocks,
    spawns: [
      { x: 10, y: FLOOR, z: 12.5, yaw: 0, team: 0 },
      { x: 10, y: FLOOR, z: 10, yaw: 0, team: -1 },
    ],
  };
}

const recipe: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'zombies',
  map: 'test',
  seed: 4,
  teams: [{ humans: 'all', bots: [] }],
};

describe('Bobo Zombies: drops (M3, fase 4d)', () => {
  it('cada abate deixa um drop (chance 100%), até 4 por onda; pegar aplica o efeito do tipo', () => {
    const sim = createSim({ recipe, map: map(), humans: 1, zombies: 1, dropChance: 1 });
    const v = sim.view();
    const h = sim.controllerEntity(0) & 0xffff;
    const f = createInputFrames();
    const events: SimEvent[] = [];
    const drops: PickupEvent[] = [];
    const takes: PickupEvent[] = [];
    let kills = 0;
    // Atira (toques de pistola) no zumbi parado até 6 abates; os drops ficam no chão (o humano não anda).
    for (let t = 0; t < (ZOMBIES_MODE.firstWaveS + 40) * SIM_HZ && kills < 6; t++) {
      f[0]!.buttons = t % 4 === 0 ? BUTTON.fire : t % 120 === 60 ? BUTTON.reload : 0;
      events.length = 0;
      sim.step(f);
      sim.drainEvents(events);
      for (const ev of events) {
        if (ev.type === 'kill') kills++;
        if (ev.type === 'pickup' && ev.action === 'drop') drops.push({ ...ev });
      }
    }
    expect(kills).toBe(6);
    expect(drops).toHaveLength(ZOMBIE_DROPS.perWave);
    for (const d of drops) expect(d.kind).toBeGreaterThanOrEqual(PICKUP_KIND.maxAmmo);
    // Anda até os drops e pega todos.
    const before = v.points[h]!;
    f[0]!.buttons = 0;
    f[0]!.moveY = quantizeAxis(1);
    for (let t = 0; t < 2 * SIM_HZ && takes.length < drops.length; t++) {
      events.length = 0;
      sim.step(f);
      sim.drainEvents(events);
      for (const ev of events) if (ev.type === 'pickup' && ev.action === 'take') takes.push({ ...ev });
    }
    expect(takes.map((e) => e.kind).sort()).toEqual(drops.map((e) => e.kind).sort());
    const kinds = new Set(takes.map((e) => e.kind));
    let expected = before;
    if (kinds.has(PICKUP_KIND.nuke)) expected += ZOMBIE_DROPS.nukePoints * takes.filter((e) => e.kind === 2).length;
    if (kinds.has(PICKUP_KIND.carpenter)) {
      expected += ZOMBIE_DROPS.carpenterPoints * takes.filter((e) => e.kind === PICKUP_KIND.carpenter).length;
    }
    expect(v.points[h]).toBe(expected);
    if (kinds.has(PICKUP_KIND.doublePoints)) expect(v.match.doublePointsTicks).toBeGreaterThan(0);
    if (kinds.has(PICKUP_KIND.instaKill)) expect(v.match.instaKillTicks).toBeGreaterThan(0);
    if (kinds.has(PICKUP_KIND.maxAmmo)) {
      const k = h * WEAPON_SLOT_COUNT + 1;
      expect(v.slotReserve[k]).toBe(weaponDef(v.loadout[k]!)!.reserve);
    }
  }, 60_000);
});
