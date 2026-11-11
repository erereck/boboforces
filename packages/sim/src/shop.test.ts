import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, quantizeAxis, WEAPON_SLOT_COUNT } from '@boboforces/input';
import { yawToU16 } from '@boboforces/shared';
import { BLOCK_FLAG, createBlockRegistry, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { WEAPON_CODE, weaponDef } from './config/weapons.ts';
import { BOX_PHASE, PERK, ZOMBIE_BOX, ZOMBIE_POINTS, ZOMBIE_SHOP } from './config/zombie.ts';
import { SIM_HZ } from './constants.ts';
import type { BoxEvent, PurchaseEvent, SimEvent } from './events.ts';
import { BOX } from './map-objects.ts';
import { ENTITY_FLAG } from './entity.ts';
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
      boxSpots: [
        { x: 4, y: FLOOR, z: 14.5, facing: 3 },
        { x: 16, y: FLOOR, z: 14.5, facing: 3 },
      ],
      perkMachines: [
        { x: 2, y: FLOOR, z: 15, facing: 3, perk: 'chonky', cost: 2500 },
        { x: 7, y: FLOOR, z: 15, facing: 3, perk: 'speedy', cost: 3000 },
        { x: 13, y: FLOOR, z: 15, facing: 3, perk: 'buddy', cost: 1500 },
      ],
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

describe('Bobo Zombies: Caixa Misteriosa (M3, fase 4b)', () => {
  /** O humano vai para a frente da caixa ativa (de lado, na mão: teste) e devolve os eventos da caixa. */
  function atBox(sim: Sim, spot: number): void {
    const v = sim.view();
    const h = sim.controllerEntity(0) & 0xffff;
    const mo = v.mapObjects!;
    (v.position as Float64Array)[h * 3] = mo.boxX[spot]!;
    (v.position as Float64Array)[h * 3 + 2] = mo.boxZ[spot]! - 1;
  }
  // Cópias: os eventos vêm de um pool que o próximo tick reaproveita.
  const boxEvents = (out: SimEvent[]): BoxEvent[] =>
    out.filter((e): e is BoxEvent => e.type === 'box').map((e) => ({ ...e }));

  it('paga 950, gira 4 s, oferece uma primária que ele não tem; só ele pega, e ela vai para a mão', () => {
    const sim = createSim({ recipe, map: shopMap(), humans: 1, zombies: 1 });
    const v = sim.view();
    const h = sim.controllerEntity(0) & 0xffff;
    const st = v.mapObjects!.boxState;
    const f = createInputFrames();
    const events: SimEvent[] = [];
    atBox(sim, 0);
    // 500 de 950: negado.
    press(sim, f, events);
    expect(boxEvents(events)[0]?.action).toBe('denied');
    (v.points as Int32Array)[h] = 2000;
    press(sim, f, events);
    expect(boxEvents(events)[0]?.action).toBe('open');
    expect(v.points[h]).toBe(2000 - ZOMBIE_BOX.cost);
    expect(st[BOX.phase]).toBe(BOX_PHASE.rolling);
    const offers: BoxEvent[] = [];
    for (let t = 0; t < ZOMBIE_BOX.rollS * SIM_HZ; t++) {
      events.length = 0;
      sim.step(f);
      sim.drainEvents(events);
      offers.push(...boxEvents(events));
    }
    expect(offers.map((e) => e.action)).toEqual(['offer']);
    const offered = offers[0]!.weapon;
    expect(weaponDef(offered)!.slot).toBe(0);
    expect(st[BOX.phase]).toBe(BOX_PHASE.offering);
    press(sim, f, events);
    expect(boxEvents(events)[0]?.action).toBe('take');
    expect(v.weapon[h]).toBe(offered);
    expect(v.loadout[h * WEAPON_SLOT_COUNT]).toBe(offered);
    expect(st[BOX.phase]).toBe(BOX_PHASE.idle);
  });

  it('ninguém pega em 10 s: fecha; no ursinho, devolve os pontos e muda de posição', () => {
    const sim = createSim({ recipe, map: shopMap(), humans: 1, zombies: 1 });
    const v = sim.view();
    const h = sim.controllerEntity(0) & 0xffff;
    const st = v.mapObjects!.boxState as Int32Array;
    const f = createInputFrames();
    const events: SimEvent[] = [];
    (v.points as Int32Array)[h] = 5000;
    atBox(sim, 0);
    press(sim, f, events);
    const all: BoxEvent[] = [];
    for (let t = 0; t < (ZOMBIE_BOX.rollS + ZOMBIE_BOX.offerS) * SIM_HZ + 2; t++) {
      events.length = 0;
      sim.step(f);
      sim.drainEvents(events);
      all.push(...boxEvents(events));
    }
    expect(all.map((e) => e.action)).toEqual(['offer', 'expire']);
    // Ursinho (teste: os usos já chegaram na conta).
    st[BOX.moveAt] = 1;
    const before = v.points[h]!;
    press(sim, f, events);
    expect(v.points[h]).toBe(before - ZOMBIE_BOX.cost);
    const moved: BoxEvent[] = [];
    for (let t = 0; t < ZOMBIE_BOX.rollS * SIM_HZ; t++) {
      events.length = 0;
      sim.step(f);
      sim.drainEvents(events);
      moved.push(...boxEvents(events));
    }
    expect(moved.map((e) => e.action)).toEqual(['move']);
    expect(moved[0]!.index).toBe(1);
    expect(st[BOX.active]).toBe(1);
    expect(v.points[h]).toBe(before);
    // Na posição velha não abre mais.
    press(sim, f, events);
    expect(boxEvents(events)).toEqual([]);
  });
});

describe('Bobo Zombies: vantagens (M3, fase 4c)', () => {
  /** Põe o humano `c` na frente da máquina `q` (teste: direto na posição). */
  function atMachine(sim: Sim, c: number, q: number): void {
    const v = sim.view();
    const e = sim.controllerEntity(c) & 0xffff;
    const mo = v.mapObjects!;
    (v.position as Float64Array)[e * 3] = mo.pmx[q]!;
    (v.position as Float64Array)[e * 3 + 2] = mo.pmz[q]! - 0.8;
  }

  it('Chonky Cola: vida 150 na hora; Speedy Soda: recarga na metade; a máquina é sólida', () => {
    const sim = createSim({ recipe, map: shopMap(), humans: 1, zombies: 1 });
    const v = sim.view();
    const h = sim.controllerEntity(0) & 0xffff;
    const f = createInputFrames();
    const events: SimEvent[] = [];
    (v.points as Int32Array)[h] = 10_000;
    atMachine(sim, 0, 0);
    press(sim, f, events);
    expect(v.perks[h]).toBe(PERK.chonky);
    expect(v.health[h]).toBe(150);
    expect(v.points[h]).toBe(10_000 - 2500);
    // Recarga da pistola sem e com a Speedy Soda: ticks entre o começo e o fim (pelos eventos).
    const me = sim.controllerEntity(0);
    const reloadTicks = (): number => {
      f[0]!.yaw = yawToU16(Math.PI);
      f[0]!.buttons = BUTTON.fire;
      sim.step(f);
      f[0]!.buttons = 0;
      sim.step(f);
      f[0]!.buttons = BUTTON.reload;
      let start = -1;
      for (let t = 0; t < 5 * SIM_HZ; t++) {
        events.length = 0;
        sim.step(f);
        f[0]!.buttons = 0;
        sim.drainEvents(events);
        for (const ev of events) {
          if (ev.type !== 'weapon' || ev.entity !== me) continue;
          if (ev.action === 'reloadStart') start = ev.tick;
          if (ev.action === 'reloadEnd' && start >= 0) return ev.tick - start;
        }
      }
      return -1;
    };
    const slow = reloadTicks();
    for (let t = 0; t < 4 * SIM_HZ; t++) sim.step(f);
    atMachine(sim, 0, 1);
    f[0]!.yaw = 0;
    press(sim, f, events);
    expect(v.perks[h]).toBe(PERK.chonky | PERK.speedy);
    const fast = reloadTicks();
    expect(slow).toBeGreaterThan(20);
    expect(Math.abs(fast - slow / 2)).toBeLessThanOrEqual(1);
    // A máquina é sólida: andar para ela não passa da frente.
    f[0]!.yaw = yawToU16(Math.PI);
    f[0]!.moveY = quantizeAxis(1);
    for (let t = 0; t < SIM_HZ; t++) sim.step(f);
    f[0]!.moveY = 0;
    expect(v.position[h * 3 + 2]).toBeLessThan(15 - 0.25);
  });

  it('Buddy Brew: levanta o colega caído na metade dos 3 s', () => {
    const r2: MatchRecipe = { ...recipe, teams: [{ humans: 'all', bots: [] }] };
    const sim = createSim({ recipe: r2, map: shopMap(), humans: 2, zombies: 1 });
    const v = sim.view();
    const a = sim.controllerEntity(0) & 0xffff;
    const b = sim.controllerEntity(1) & 0xffff;
    const f = createInputFrames();
    const events: SimEvent[] = [];
    (v.points as Int32Array)[a] = 5000;
    atMachine(sim, 0, 2);
    press(sim, f, events);
    expect(v.perks[a]).toBe(PERK.buddy);
    // Teste: o B cai do lado do A (o estado de caído, direto).
    const pos = v.position as Float64Array;
    pos[b * 3] = pos[a * 3]! + 0.8;
    pos[b * 3 + 2] = pos[a * 3 + 2]!;
    (v.flags as Uint32Array)[b] = v.flags[b]! | ENTITY_FLAG.downed;
    (v.downTicks as Int32Array)[b] = 20 * SIM_HZ;
    (v.health as Float32Array)[b] = 1;
    f[0]!.buttons = BUTTON.use;
    let up = -1;
    for (let t = 0; t < 4 * SIM_HZ && up < 0; t++) {
      events.length = 0;
      sim.step(f);
      sim.drainEvents(events);
      if (events.some((ev) => ev.type === 'down' && ev.action === 'revive')) up = t + 1;
    }
    expect(up).toBeGreaterThan(0);
    expect(up).toBeLessThanOrEqual(1.5 * SIM_HZ + 1);
  });
});
