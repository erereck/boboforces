import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, quantizeAxis, WEAPON_SLOT_COUNT } from '@boboforces/input';
import { yawToU16 } from '@boboforces/shared';
import { BLOCK_FLAG, createBlockRegistry, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { WEAPON_CODE, weaponDef } from './config/weapons.ts';
import { ZOMBIE_POINTS, ZOMBIE_SHOP } from './config/zombie.ts';
import { SIM_HZ } from './constants.ts';
import type { PurchaseEvent, SimEvent } from './events.ts';
import { createInputFrames } from './loop.ts';
import { simMapFromMarkers } from './map.ts';
import { createSim, type Sim, type SimMap } from './sim.ts';

/**
 * M3 (fase 4a): armas na parede. Muro em z = 15..15,5 m; a arma (Buzzer, 1000) fica na face sul (z = 15, olhando para
 * -Z) em x = 10; o humano nasce a 1 m dela, de frente.
 */
const SOLID = BLOCK_FLAG.solid | BLOCK_FLAG.blocksBullets | BLOCK_FLAG.blocksSight | BLOCK_FLAG.walkable;
const blocks = createBlockRegistry([
  { key: 'concrete', shape: 'cube', faces: [1, 1, 1, 1, 1, 1], flags: SOLID, frames: 1, stepSound: 'concrete' },
]);
const concrete = makeCell(blocks.byKey('concrete')!.id);
const FLOOR = 0.5;

function shopMap(): SimMap {
  const grid = createWorldGrid(40, 16, 60);
  fillBox(grid, 0, 0, 0, 39, 0, 59, concrete);
  fillBox(grid, 0, 1, 30, 39, 6, 30, concrete);
  return simMapFromMarkers({
    grid,
    blocks,
    markers: {
      spawns: [
        { x: 10, y: FLOOR, z: 14, yaw: 0, team: 0 },
        { x: 10, y: FLOOR, z: 4, yaw: 0, team: -1 },
      ],
      playArea: { minX: 0, minZ: 0, maxX: 20, maxZ: 30, killPlaneY: -10 },
      wallBuys: [{ x: 10, y: FLOOR, z: 15, facing: 3, weapon: 'smg', cost: 1000 }],
    },
  });
}

const recipe: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'zombies',
  map: 'test',
  seed: 7,
  teams: [{ humans: 'all', bots: [] }],
};

function press(sim: Sim, f: ReturnType<typeof createInputFrames>, out: SimEvent[]): PurchaseEvent | undefined {
  f[0]!.buttons = 0;
  sim.step(f);
  f[0]!.buttons = BUTTON.use;
  out.length = 0;
  sim.step(f);
  sim.drainEvents(out);
  f[0]!.buttons = 0;
  return out.find((e): e is PurchaseEvent => e.type === 'purchase');
}

describe('Bobo Zombies: armas na parede (M3, fase 4a)', () => {
  it('o humano nasce de pistola; sem pontos nega; com pontos leva a arma para a mão; de novo, só munição pela metade', () => {
    const sim = createSim({ recipe, map: shopMap(), humans: 1, zombies: 1 });
    const v = sim.view();
    const h = sim.controllerEntity(0) & 0xffff;
    const k = h * WEAPON_SLOT_COUNT;
    expect(v.loadout[k]).toBe(255);
    expect(v.weapon[h]).toBe(WEAPON_CODE.pistol);
    expect(v.mapObjects!.wallBuys).toBe(1);
    const f = createInputFrames();
    const events: SimEvent[] = [];
    // 500 de 1000: negado.
    const denied = press(sim, f, events);
    expect(denied?.action).toBe('denied');
    expect(denied?.kind).toBe('weapon');
    expect(v.points[h]).toBe(ZOMBIE_POINTS.start);
    // 1500 (teste): leva a Buzzer, na mão, com pente e reserva cheios.
    (v.points as Int32Array)[h] = 1500;
    const bought = press(sim, f, events);
    expect(bought?.action).toBe('ok');
    expect(bought?.item).toBe(WEAPON_CODE.smg);
    expect(v.points[h]).toBe(500);
    expect(v.loadout[k]).toBe(WEAPON_CODE.smg);
    expect(v.weapon[h]).toBe(WEAPON_CODE.smg);
    const smg = weaponDef(WEAPON_CODE.smg)!;
    expect(v.slotClip[k]).toBe(smg.clipSize);
    // Cheia: apertar de novo não cobra nada.
    expect(press(sim, f, events)).toBeUndefined();
    // Gasta um pouco (atira 1 s) e compra munição pela metade.
    f[0]!.yaw = yawToU16(Math.PI);
    for (let t = 0; t < SIM_HZ; t++) {
      f[0]!.buttons = BUTTON.fire;
      sim.step(f);
    }
    expect(v.slotClip[k]).toBeLessThan(smg.clipSize);
    f[0]!.yaw = 0;
    const ammo = press(sim, f, events);
    expect(ammo?.kind).toBe('ammo');
    expect(ammo?.cost).toBe(1000 * ZOMBIE_SHOP.ammoCostFrac);
    expect(v.points[h]).toBe(0);
    expect(v.slotClip[k]).toBe(smg.clipSize);
    expect(v.slotReserve[k]).toBe(smg.reserve);
  });

  it('longe da parede (mais de 1,5 m) não compra', () => {
    const sim = createSim({ recipe, map: shopMap(), humans: 1, zombies: 1 });
    const f = createInputFrames();
    const events: SimEvent[] = [];
    f[0]!.yaw = 0;
    f[0]!.moveY = quantizeAxis(1);
    for (let t = 0; t < SIM_HZ; t++) sim.step(f);
    f[0]!.moveY = 0;
    expect(sim.view().position[(sim.controllerEntity(0) & 0xffff) * 3 + 2]).toBeLessThan(13);
    expect(press(sim, f, events)).toBeUndefined();
  });
});
