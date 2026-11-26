import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import {
  ARSENAL,
  createInputFrames,
  createSim,
  entityIndex,
  isPrimaryWeapon,
  WEAPON_CODE,
  WEAPON_SLOT,
  type SimEvent,
  type SimMap,
} from '@boboforces/sim';
import { createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { switchedSlot } from './switch-slot.ts';

/**
 * M11 (fase 4, revisão): o slot do mapeador depois do evento `weapon`/`switch`. O humano passa por cima de cada primária
 * do arsenal no chão (as armas no mapa); o "mapeador" deste teste faz o que a cena faz com o evento (`switchedSlot`) e
 * escreve o slot no `InputFrame`. Antes, o código da arma ia direto ao mapeador e a mão ia para a faca ou a granada.
 */
const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);

function flatMap(weapon: string): SimMap {
  const grid = createWorldGrid(80, 8, 80);
  fillBox(grid, 0, 0, 0, 79, 0, 79, concrete);
  return {
    grid,
    blocks,
    spawns: [
      { x: 4.25, y: 0.5, z: 4.25, yaw: 0, team: 0 },
      { x: 34.25, y: 0.5, z: 34.25, yaw: 0, team: 1 },
    ],
    playArea: { minX: 0, minZ: 0, maxX: 40, maxZ: 40 },
    weaponSpots: [{ x: 20, y: 0.5, z: 20, weapon }],
  };
}

const recipe: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'warfare.tdm',
  map: 'test',
  seed: 3,
  match: { timeLimitS: 0, scoreLimit: 0 },
  weapons: { pickups: true },
  teams: [
    { humans: 1, bots: [] },
    { humans: 1, bots: [] },
  ],
};

describe('o slot do mapeador depois da troca da sim (M11 fase 4, revisão)', () => {
  it('pegou cada primária do mapa: o slot fica no 0 e a mão, na arma pega (não vai para a faca nem a granada)', () => {
    const primaries = ARSENAL.filter((w) => isPrimaryWeapon(w.code));
    expect(primaries.length).toBe(10);
    for (const w of primaries) {
      const sim = createSim({ recipe, map: flatMap(w.id), humans: 2 });
      const v = sim.view();
      const f = createInputFrames();
      const e = entityIndex(sim.controllerEntity(0));
      // O mapeador começa no slot da mão (a pistola: ninguém nasce com a primária).
      expect(v.slot[e]).toBe(WEAPON_SLOT.secondary);
      f[0]!.weapon = v.slot[e]!;
      const events: SimEvent[] = [];
      let switches = 0;
      for (let t = 0; t < 90; t++) {
        if (t === 5) {
          v.position[e * 3] = 20;
          v.position[e * 3 + 1] = 0.5;
          v.position[e * 3 + 2] = 20;
        }
        sim.step(f);
        events.length = 0;
        sim.drainEvents(events);
        for (const ev of events) {
          if (ev.type !== 'weapon' || ev.action !== 'switch' || entityIndex(ev.entity) !== e) continue;
          switches++;
          f[0]!.weapon = switchedSlot(ev.weapon, v.slot[e]!);
        }
      }
      expect(switches, w.id).toBeGreaterThan(0);
      expect(v.slot[e], w.id).toBe(WEAPON_SLOT.primary);
      expect(v.weapon[e], w.id).toBe(w.code);
      sim.dispose();
    }
  });

  it('o slot é o da arma do evento (o código não é slot); sem arma conhecida, o da view', () => {
    expect(switchedSlot(WEAPON_CODE.smg, 9)).toBe(WEAPON_SLOT.primary);
    expect(switchedSlot(WEAPON_CODE.grenadeLauncher, 9)).toBe(WEAPON_SLOT.primary);
    expect(switchedSlot(WEAPON_CODE.revolver, 9)).toBe(WEAPON_SLOT.secondary);
    expect(switchedSlot(WEAPON_CODE.knife, 9)).toBe(WEAPON_SLOT.melee);
    expect(switchedSlot(WEAPON_CODE.grenade, 9)).toBe(WEAPON_SLOT.throwable);
    expect(switchedSlot(254, 2)).toBe(2);
  });
});
