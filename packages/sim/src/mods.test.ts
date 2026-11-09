import { MATCH_RECIPE_FORMAT, type MatchRecipe, type PlayerRules, type WeaponRules } from '@boboforces/format';
import { BUTTON, WEAPON_SLOT_COUNT, type InputFrame } from '@boboforces/input';
import { pitchToI16, yawToU16 } from '@boboforces/shared';
import { cellCenter, createTestBlocks, createWorldGrid, fillBox, makeCell, type MapSpawn } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { METRICS } from './config/metrics.ts';
import { WEAPON_CODE, WEAPON_SLOT } from './config/weapons.ts';
import { DEFAULT_MATCH_MODS } from './context.ts';
import { SIM_HZ } from './constants.ts';
import { ENTITY_FLAG } from './entity.ts';
import type { HitEvent, SimEvent } from './events.ts';
import { aimPointWorld, type AimPoint } from './hitbox.ts';
import { createInputFrames } from './loop.ts';
import { createSim, type Sim, type SimMap } from './sim.ts';

/** M2, fase 4e: os modificadores da partida (gameplay.md §4.5 e §10.3) na sim. */

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);
const FLOOR = 0.5;
const PAST_PROTECTION = Math.round(1.6 * SIM_HZ);

function flatMap(spawns: MapSpawn[]): SimMap {
  const grid = createWorldGrid(40, 16, 120);
  fillBox(grid, 0, 0, 0, 39, 0, 119, concrete);
  return { grid, blocks, spawns };
}

interface DuelOptions {
  readonly weapons?: WeaponRules;
  readonly players?: PlayerRules;
  /** Os dois no mesmo time (fogo amigo). */
  readonly allies?: boolean;
  readonly primaries?: number[];
}

/** O bobo 0 em z = 40 olhando para −Z e o 1 em z = 30 (10 m à frente dele). */
function duel(o: DuelOptions = {}): { sim: Sim; f: InputFrame[] } {
  const a: MapSpawn = { x: cellCenter(20), y: FLOOR, z: 40, yaw: 0, team: 0 };
  const b: MapSpawn = { x: cellCenter(20), y: FLOOR, z: 30, yaw: Math.PI, team: o.allies ? 0 : 1 };
  const recipe: MatchRecipe = {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'test',
    seed: 3,
    ...(o.weapons ? { weapons: o.weapons } : {}),
    ...(o.players ? { players: o.players } : {}),
    teams: o.allies
      ? [{ humans: 2, bots: [] }, { bots: [] }]
      : [
          { humans: 1, bots: [] },
          { humans: 1, bots: [] },
        ],
  };
  const sim = createSim({
    recipe,
    map: flatMap(o.allies ? [a, { ...b }] : [a, b]),
    humans: 2,
    ...(o.primaries ? { primaries: o.primaries } : {}),
  });
  return { sim, f: createInputFrames() };
}

const entity = (sim: Sim, c: number): number => sim.controllerEntity(c) & 0xffff;

function aimAt(sim: Sim, f: InputFrame, c: number, p: AimPoint): void {
  const v = sim.view();
  const e = entity(sim, c);
  const dx = p.x - v.position[e * 3]!;
  const dy = p.y - (v.position[e * 3 + 1]! + METRICS.eyeHeight);
  const dz = p.z - v.position[e * 3 + 2]!;
  f.yaw = yawToU16(Math.atan2(-dx, -dz));
  f.pitch = pitchToI16(Math.atan2(dy, Math.hypot(dx, dz)));
}

/** Espera a proteção de spawn, mira no 1 (cabeça ou tronco) e dá um tiro; devolve os acertos no 1. */
function shoot(sim: Sim, f: InputFrame[], head: boolean): HitEvent[] {
  const events: SimEvent[] = [];
  const hits: HitEvent[] = [];
  for (let i = 0; i < PAST_PROTECTION; i++) sim.step(f);
  sim.drainEvents(events);
  const p: AimPoint = { x: 0, y: 0, z: 0 };
  aimPointWorld(sim.view(), entity(sim, 1), head, p);
  aimAt(sim, f[0]!, 0, p);
  sim.step(f);
  f[0]!.buttons = BUTTON.fire;
  for (let i = 0; i < 3; i++) {
    sim.step(f);
    f[0]!.buttons = 0;
    events.length = 0;
    sim.drainEvents(events);
    for (const ev of events) if (ev.type === 'hit' && ev.target === sim.controllerEntity(1)) hits.push(ev);
  }
  return hits;
}

describe('modificadores da partida', () => {
  it('sem bloco de armas, os padrões de sempre', () => {
    expect(duel().sim.view().mods).toEqual(DEFAULT_MATCH_MODS);
  });

  it('dano ×2 dobra o tiro; só cabeça zera o tronco; um tiro mata', () => {
    const base = shoot(duel().sim, duel().f, false);
    const plain = duel();
    const torso = shoot(plain.sim, plain.f, false)[0]!.damage;
    expect(base.length).toBe(1);
    const doubled = duel({ weapons: { damageMul: 2 } });
    expect(shoot(doubled.sim, doubled.f, false)[0]!.damage).toBeCloseTo(torso * 2, 6);
    const heads = duel({ weapons: { headshotOnly: true } });
    expect(shoot(heads.sim, heads.f, false)[0]!.damage).toBe(0);
    const heads2 = duel({ weapons: { headshotOnly: true } });
    expect(shoot(heads2.sim, heads2.f, true)[0]!.damage).toBeGreaterThan(0);
    const one = duel({ weapons: { oneShot: true } });
    shoot(one.sim, one.f, false);
    expect(one.sim.view().flags[entity(one.sim, 1)]! & ENTITY_FLAG.dead).not.toBe(0);
  });

  it('sniper mata no corpo', () => {
    const d = duel({
      weapons: { sniperBodyKill: true, ads: false, spread: false },
      primaries: [WEAPON_CODE.sniper, 0],
    });
    shoot(d.sim, d.f, false);
    expect(d.sim.view().flags[entity(d.sim, 1)]! & ENTITY_FLAG.dead).not.toBe(0);
  });

  it('sem ADS, segurar a mira não entra no zoom', () => {
    const run = (ads: boolean): number => {
      const d = duel({ weapons: { ads } });
      d.f[0]!.buttons = BUTTON.ads;
      for (let i = 0; i < SIM_HZ; i++) d.sim.step(d.f);
      return d.sim.view().adsAmount[entity(d.sim, 0)]!;
    };
    expect(run(true)).toBe(1);
    expect(run(false)).toBe(0);
  });

  it('fogo amigo: desligado, a bala passa pelo aliado; pela metade, fere metade e o abate não conta', () => {
    const off = duel({ allies: true });
    expect(shoot(off.sim, off.f, false)).toEqual([]);
    const plain = duel();
    const torso = shoot(plain.sim, plain.f, false)[0]!.damage;
    const half = duel({ allies: true, weapons: { friendlyFire: 0.5 } });
    const hits = shoot(half.sim, half.f, false);
    expect(hits[0]!.damage).toBeCloseTo(torso / 2, 6);
    const kill = duel({ allies: true, weapons: { friendlyFire: 1, oneShot: true } });
    shoot(kill.sim, kill.f, false);
    const v = kill.sim.view();
    expect(v.flags[entity(kill.sim, 1)]! & ENTITY_FLAG.dead).not.toBe(0);
    expect([v.kills[entity(kill.sim, 0)], v.match.teamScore[0]]).toEqual([0, 0]);
  });

  it('pente infinito para todos; armas permitidas mudam o loadout dos humanos', () => {
    const d = duel({ weapons: { ammo: 'infiniteClip' } });
    shoot(d.sim, d.f, false);
    const v = d.sim.view();
    const k = entity(d.sim, 0) * WEAPON_SLOT_COUNT + WEAPON_SLOT.primary;
    expect(v.slotClip[k]).toBe(30);
    const only = duel({ weapons: { allowed: ['shotgun', 'knife'] } });
    const lo = only.sim.view();
    const base = entity(only.sim, 0) * WEAPON_SLOT_COUNT;
    expect([lo.loadout[base + WEAPON_SLOT.primary], lo.loadout[base + WEAPON_SLOT.melee]]).toEqual([
      WEAPON_CODE.shotgun,
      WEAPON_CODE.knife,
    ]);
    expect(lo.loadout[base + WEAPON_SLOT.secondary]).not.toBe(WEAPON_CODE.pistol);
  });

  it('gravidade pela metade: o pulo fica mais tempo no ar; regeneração desligada não cura', () => {
    const air = (gravity: number): number => {
      const d = duel({ players: { gravity } });
      d.f[0]!.buttons = BUTTON.jump;
      d.sim.step(d.f);
      d.f[0]!.buttons = 0;
      let ticks = 0;
      for (let i = 0; i < 5 * SIM_HZ; i++) {
        d.sim.step(d.f);
        if ((d.sim.view().flags[entity(d.sim, 0)]! & ENTITY_FLAG.onGround) === 0) ticks++;
      }
      return ticks;
    };
    const normal = air(1);
    expect(air(0.5)).toBeGreaterThan(normal * 1.8);
    const heal = (regen: 'off' | 'default'): number => {
      const d = duel({ players: { regen } });
      shoot(d.sim, d.f, false);
      const before = d.sim.view().health[entity(d.sim, 1)]!;
      for (let i = 0; i < 8 * SIM_HZ; i++) d.sim.step(d.f);
      return d.sim.view().health[entity(d.sim, 1)]! - before;
    };
    expect(heal('off')).toBe(0);
    expect(heal('default')).toBeGreaterThan(0);
  });
});
