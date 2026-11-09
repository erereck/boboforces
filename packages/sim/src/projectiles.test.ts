import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, WEAPON_SLOT_COUNT, type InputFrame } from '@boboforces/input';
import { BitReader, BitWriter, pitchToI16, yawToU16 } from '@boboforces/shared';
import { cellCenter, createTestBlocks, createWorldGrid, fillBox, makeCell, type MapSpawn } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { BASE_HP, METRICS } from './config/metrics.ts';
import { WEAPON_CODE, WEAPON_GRENADE, WEAPON_ROCKET, WEAPON_SLOT } from './config/weapons.ts';
import { SIM_HZ } from './constants.ts';
import { entityIndex } from './entity.ts';
import type { SimEvent } from './events.ts';
import { aimPointWorld, type AimPoint } from './hitbox.ts';
import { createInputFrames } from './loop.ts';
import { createSim, type Sim, type SimMap } from './sim.ts';

/**
 * M2, fase 1b: projéteis e explosões (gameplay.md §4.3). Foguete com acerto direto e área, linha de visão da
 * explosão, autodano de 50%, granada com pavio, cozinhar na mão, troca automática depois da última granada e o
 * snapshot com um projétil em voo.
 */

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);
const FLOOR = 0.5;

type Build = (grid: ReturnType<typeof createWorldGrid>) => void;

function flatMap(spawns: MapSpawn[], build?: Build): SimMap {
  const grid = createWorldGrid(40, 16, 80);
  fillBox(grid, 0, 0, 0, 39, 0, 79, concrete);
  build?.(grid);
  return { grid, blocks, spawns };
}

function duelRecipe(): MatchRecipe {
  return {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'test',
    seed: 23,
    teams: [
      { humans: 1, bots: [] },
      { humans: 1, bots: [] },
    ],
  };
}

/** O 0 em `z0` olhando para -Z (primária `primary`) e o 1 em `z1` olhando para +Z. */
function duel(z0: number, z1: number, primary: number, build?: Build): { sim: Sim; f: InputFrame[] } {
  const a: MapSpawn = { x: cellCenter(20), y: FLOOR, z: z0, yaw: 0, team: 0 };
  const b: MapSpawn = { x: cellCenter(20), y: FLOOR, z: z1, yaw: Math.PI, team: 1 };
  const sim = createSim({ recipe: duelRecipe(), map: flatMap([a, b], build), humans: 2, primaries: [primary] });
  return { sim, f: createInputFrames() };
}

function run(sim: Sim, f: InputFrame[], ticks: number, onEvents?: (events: SimEvent[]) => void): void {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step(f);
    events.length = 0;
    sim.drainEvents(events);
    onEvents?.(events);
  }
}

function entity(sim: Sim, c: number): number {
  return entityIndex(sim.controllerEntity(c));
}

function aimAt(sim: Sim, f: InputFrame, c: number, x: number, y: number, z: number): void {
  const v = sim.view();
  const e = entity(sim, c);
  const dx = x - v.position[e * 3]!;
  const dy = y - (v.position[e * 3 + 1]! + METRICS.eyeHeight);
  const dz = z - v.position[e * 3 + 2]!;
  f.yaw = yawToU16(Math.atan2(-dx, -dz));
  f.pitch = pitchToI16(Math.atan2(dy, Math.hypot(dx, dz)));
}

function torsoOf(sim: Sim, c: number): AimPoint {
  const p: AimPoint = { x: 0, y: 0, z: 0 };
  aimPointWorld(sim.view(), entity(sim, c), false, p);
  return p;
}

const PAST_PROTECTION = Math.round(1.6 * SIM_HZ);

interface Tally {
  hits: { target: number; damage: number }[];
  explosions: { tick: number; x: number; y: number; z: number }[];
  launches: number;
  kills: number;
}

function tally(): Tally {
  return { hits: [], explosions: [], launches: 0, kills: 0 };
}

function collect(t: Tally): (events: SimEvent[]) => void {
  return (events) => {
    for (const ev of events) {
      if (ev.type === 'hit') t.hits.push({ target: ev.target, damage: ev.damage });
      if (ev.type === 'explosion') t.explosions.push({ tick: ev.tick, x: ev.x, y: ev.y, z: ev.z });
      if (ev.type === 'projectile' && ev.action === 'launch') t.launches++;
      if (ev.type === 'kill') t.kills++;
    }
  };
}

describe('foguete', () => {
  it('acerto direto a 10 m mata com 120, explode e some do pool', () => {
    const { sim, f } = duel(25, 15, WEAPON_CODE.rocket);
    run(sim, f, PAST_PROTECTION);
    const p = torsoOf(sim, 1);
    aimAt(sim, f[0]!, 0, p.x, p.y, p.z);
    f[0]!.buttons = BUTTON.fire | BUTTON.ads;
    const t = tally();
    run(sim, f, 1, collect(t));
    f[0]!.buttons = BUTTON.ads;
    expect(t.launches).toBe(1);
    expect(sim.view().projectiles.count).toBe(1);
    run(sim, f, SIM_HZ, collect(t));
    const direct = t.hits.find((h) => h.target === sim.controllerEntity(1));
    expect(direct?.damage).toBe(WEAPON_ROCKET.damage);
    expect(t.explosions.length).toBe(1);
    expect(t.kills).toBe(1);
    expect(sim.view().projectiles.count).toBe(0);
  });

  it('no chão perto do pé: área com queda linear; atrás de uma parede não passa', () => {
    // Explosão a ~1,5 m do alvo, no chão à frente dele.
    const { sim, f } = duel(25, 15, WEAPON_CODE.rocket);
    run(sim, f, PAST_PROTECTION);
    const b = entity(sim, 1);
    const bz = sim.view().position[b * 3 + 2]!;
    aimAt(sim, f[0]!, 0, cellCenter(20), FLOOR, bz + 1.5);
    f[0]!.buttons = BUTTON.fire | BUTTON.ads;
    const t = tally();
    run(sim, f, SIM_HZ, collect(t));
    const splash = t.hits.find((h) => h.target === sim.controllerEntity(1));
    expect(splash).toBeDefined();
    expect(splash!.damage).toBeGreaterThan(0);
    expect(splash!.damage).toBeLessThan(WEAPON_ROCKET.blastDamage);

    // Mesma coisa com uma parede de 2,5 m entre o ponto da explosão e o alvo: nada.
    const walled = duel(25, 15, WEAPON_CODE.rocket, (grid) => fillBox(grid, 0, 1, 33, 39, 5, 33, concrete));
    run(walled.sim, walled.f, PAST_PROTECTION);
    aimAt(walled.sim, walled.f[0]!, 0, cellCenter(20), FLOOR + 0.6, 16.6);
    walled.f[0]!.buttons = BUTTON.fire | BUTTON.ads;
    const w = tally();
    run(walled.sim, walled.f, SIM_HZ, collect(w));
    expect(w.explosions.length).toBe(1);
    expect(w.hits.filter((h) => h.target === walled.sim.controllerEntity(1))).toEqual([]);
  });

  it('autodano: o foguete no próprio pé tira metade', () => {
    const { sim, f } = duel(25, 5, WEAPON_CODE.rocket);
    run(sim, f, PAST_PROTECTION);
    const a = entity(sim, 0);
    const az = sim.view().position[a * 3 + 2]!;
    aimAt(sim, f[0]!, 0, cellCenter(20), FLOOR, az - 0.8);
    f[0]!.buttons = BUTTON.fire;
    const t = tally();
    run(sim, f, 10, collect(t));
    const self = t.hits.find((h) => h.target === sim.controllerEntity(0));
    expect(self).toBeDefined();
    expect(self!.damage).toBeGreaterThan(0);
    expect(self!.damage).toBeLessThanOrEqual(WEAPON_ROCKET.blastDamage * WEAPON_ROCKET.selfDamageMul);
    expect(sim.view().health[a]).toBeLessThan(BASE_HP);
  });
});

describe('granada', () => {
  function withGrenade(): { sim: Sim; f: InputFrame[] } {
    const d = duel(25, 5, WEAPON_CODE.rifle);
    d.f[0]!.weapon = WEAPON_SLOT.throwable;
    run(d.sim, d.f, PAST_PROTECTION);
    return d;
  }

  it('jogada sem cozinhar explode no pavio de 2,5 s, longe de quem jogou', () => {
    const { sim, f } = withGrenade();
    const a = entity(sim, 0);
    f[0]!.pitch = pitchToI16(0.3);
    f[0]!.buttons = BUTTON.fire;
    const t = tally();
    const start = sim.tick;
    run(sim, f, 1, collect(t));
    f[0]!.buttons = 0;
    run(sim, f, 4 * SIM_HZ, collect(t));
    expect(t.launches).toBe(1);
    expect(t.explosions.length).toBe(1);
    const fuse = t.explosions[0]!.tick - start;
    expect(Math.abs(fuse - WEAPON_GRENADE.fuseS * SIM_HZ)).toBeLessThanOrEqual(2);
    // Caiu a mais de 5 m (fora do raio): sem autodano.
    const v = sim.view();
    const dz = v.position[a * 3 + 2]! - t.explosions[0]!.z;
    expect(Math.abs(dz)).toBeGreaterThan(WEAPON_GRENADE.blastRadiusM);
    expect(t.hits.filter((h) => h.target === sim.controllerEntity(0))).toEqual([]);
  });

  it('cozinhar 2 s e soltar explode ~0,5 s depois; segurar o pavio inteiro explode na mão', () => {
    const { sim, f } = withGrenade();
    f[0]!.pitch = pitchToI16(0.3);
    f[0]!.buttons = BUTTON.fire;
    const t = tally();
    run(sim, f, 2 * SIM_HZ, collect(t));
    expect(t.launches).toBe(0);
    f[0]!.buttons = 0;
    const released = sim.tick;
    run(sim, f, SIM_HZ, collect(t));
    expect(t.launches).toBe(1);
    expect(t.explosions.length).toBe(1);
    expect(t.explosions[0]!.tick - released).toBeLessThanOrEqual(0.5 * SIM_HZ + 2);

    // Segunda granada: segura até acabar o pavio. Explode na mão e tira 55 (110 × 50%) de quem segurava.
    run(sim, f, SIM_HZ);
    f[0]!.buttons = BUTTON.fire;
    const u = tally();
    run(sim, f, 3 * SIM_HZ, collect(u));
    expect(u.launches).toBe(0);
    expect(u.explosions.length).toBe(1);
    const self = u.hits.find((h) => h.target === sim.controllerEntity(0));
    expect(self?.damage).toBeCloseTo(WEAPON_GRENADE.blastDamage * WEAPON_GRENADE.selfDamageMul, 5);
  });

  it('depois da última granada volta sozinho para a primária', () => {
    const { sim, f } = withGrenade();
    const a = entity(sim, 0);
    f[0]!.pitch = pitchToI16(0.4);
    for (let i = 0; i < 2; i++) {
      f[0]!.buttons = BUTTON.fire;
      run(sim, f, 1);
      f[0]!.buttons = 0;
      run(sim, f, Math.round(1.2 * SIM_HZ));
    }
    const v = sim.view();
    expect(v.slotClip[a * WEAPON_SLOT_COUNT + WEAPON_SLOT.throwable]).toBe(0);
    expect(v.slot[a]).toBe(WEAPON_SLOT.primary);
    expect(v.weapon[a]).toBe(WEAPON_CODE.rifle);
  });
});

describe('determinismo com projéteis', () => {
  it('snapshot com um foguete em voo, lido numa sim nova, segue com o mesmo hash', () => {
    const { sim, f } = duel(60, 5, WEAPON_CODE.rocket);
    run(sim, f, PAST_PROTECTION);
    f[0]!.buttons = BUTTON.fire;
    run(sim, f, 3);
    f[0]!.buttons = 0;
    expect(sim.view().projectiles.count).toBeGreaterThan(0);
    const w = new BitWriter(1 << 16);
    sim.writeSnapshot(w);
    const copy = duel(60, 5, WEAPON_CODE.rocket);
    copy.sim.readSnapshot(new BitReader(w.bytes()));
    expect(copy.sim.stateHash()).toBe(sim.stateHash());
    run(sim, f, 2 * SIM_HZ);
    run(copy.sim, f, 2 * SIM_HZ);
    expect(copy.sim.stateHash()).toBe(sim.stateHash());
    expect(sim.view().projectiles.count).toBe(0);
  });
});
