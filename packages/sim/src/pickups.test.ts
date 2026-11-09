import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, WEAPON_SLOT_COUNT, type InputFrame } from '@boboforces/input';
import { buildNavGrid } from '@boboforces/nav';
import { BitReader, BitWriter, pitchToI16, yawToU16 } from '@boboforces/shared';
import { cellCenter, createTestBlocks, createWorldGrid, fillBox, makeCell, type MapSpawn } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { METRICS } from './config/metrics.ts';
import { BOBO_NAV_METRICS } from './config/nav-metrics.ts';
import { MATCH_DEFAULTS } from './config/rules.ts';
import { WEAPON_PISTOL, WEAPON_RIFLE, WEAPON_SLOT } from './config/weapons.ts';
import { BOT_CONTROLLER_BASE, SIM_HZ } from './constants.ts';
import { entityIndex } from './entity.ts';
import type { PickupEvent, SimEvent, UnstuckEvent } from './events.ts';
import { aimPointWorld, type AimPoint } from './hitbox.ts';
import { createInputFrames } from './loop.ts';
import { createSim, type Sim, type SimMap } from './sim.ts';

/**
 * M2, fase 2b: a caixinha de munição de quem morre (gameplay.md §4.1) e o Destravar (GDD §3.8): cair, ser pega, ficar
 * com munição cheia, sumir, não cair no vazio, entrar no snapshot; levar o bobo preso ao nó livre mais perto, o bot
 * fora da vista do humano, e o bot renascer na 3ª vez.
 */

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);
const FLOOR = 0.5;
const PAST_PROTECTION = Math.round(1.6 * SIM_HZ);

type Grid = ReturnType<typeof createWorldGrid>;

/** Chão de 20 × 40 m (ou só até `floorZ` m, com o vazio depois). */
function flatMap(spawns: MapSpawn[], floorZ = 40, build?: (grid: Grid) => void): SimMap {
  const grid = createWorldGrid(40, 16, 80);
  fillBox(grid, 0, 0, 0, 39, 0, floorZ * 2 - 1, concrete);
  build?.(grid);
  return { grid, blocks, spawns };
}

const DUEL: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'warfare.tdm',
  map: 'test',
  seed: 23,
  teams: [
    { humans: 1, bots: [] },
    { humans: 1, bots: [] },
  ],
};

function spawn(x: number, z: number, team: number): MapSpawn {
  return { x, y: FLOOR, z, yaw: 0, team };
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

function aimAt(sim: Sim, f: InputFrame, c: number, p: AimPoint): void {
  const v = sim.view();
  const e = entity(sim, c);
  const dx = p.x - v.position[e * 3]!;
  const dy = p.y - (v.position[e * 3 + 1]! + METRICS.eyeHeight);
  const dz = p.z - v.position[e * 3 + 2]!;
  f.yaw = yawToU16(Math.atan2(-dx, -dz));
  f.pitch = pitchToI16(Math.atan2(dy, Math.hypot(dx, dz)));
}

/** O 0 mata o 1 com o fuzil (no máximo 5 s). */
function kill(sim: Sim, f: InputFrame[]): void {
  const p: AimPoint = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 5 * SIM_HZ && sim.view().health[entity(sim, 1)]! > 0; i++) {
    aimPointWorld(sim.view(), entity(sim, 1), false, p);
    aimAt(sim, f[0]!, 0, p);
    f[0]!.buttons = BUTTON.fire | BUTTON.ads;
    run(sim, f, 1);
  }
  f[0]!.buttons = 0;
  f[0]!.pitch = 0;
}

function pickups(events: PickupEvent[]): (list: SimEvent[]) => void {
  return (list) => {
    for (const ev of list) if (ev.type === 'pickup') events.push({ ...ev });
  };
}

/** O 0 em z = 25 m e o 1 em z = 15 m; o 0 mata o 1, que deixa a caixinha. */
function boxDropped(): { sim: Sim; f: InputFrame[]; drops: PickupEvent[] } {
  const sim = createSim({ recipe: DUEL, map: flatMap([spawn(10.25, 25, 0), spawn(10.25, 15, 1)]), humans: 2 });
  const f = createInputFrames();
  run(sim, f, PAST_PROTECTION);
  const drops: PickupEvent[] = [];
  const collect = pickups(drops);
  const p: AimPoint = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 5 * SIM_HZ && drops.length === 0; i++) {
    aimPointWorld(sim.view(), entity(sim, 1), false, p);
    aimAt(sim, f[0]!, 0, p);
    f[0]!.buttons = BUTTON.fire | BUTTON.ads;
    run(sim, f, 1, collect);
  }
  f[0]!.buttons = 0;
  f[0]!.pitch = 0;
  f[0]!.yaw = 0;
  return { sim, f, drops };
}

/** O 0 anda para −Z (até a caixinha em z = 15 m) por até 4 s, juntando os eventos de pickup. */
function walkToBox(sim: Sim, f: InputFrame[]): PickupEvent[] {
  const out: PickupEvent[] = [];
  f[0]!.moveY = 127;
  run(sim, f, 4 * SIM_HZ, pickups(out));
  f[0]!.moveY = 0;
  return out;
}

describe('caixinha de munição', () => {
  it('quem morre deixa uma, que cai até o chão', () => {
    const { sim, f, drops } = boxDropped();
    expect(drops.map((d) => [d.action, d.entity])).toEqual([['drop', sim.controllerEntity(1)]]);
    const pv = sim.view().pickups;
    expect(pv.count).toBe(1);
    expect(pv.position[1]).toBeGreaterThan(FLOOR);
    run(sim, f, SIM_HZ / 2);
    expect(pv.position[1]).toBeCloseTo(FLOOR, 6);
    expect(pv.position[2]).toBeCloseTo(15, 1);
  });

  it('quem passa por cima pega 1 pente da primária e 1 granada; a pistola cheia fica igual', () => {
    const { sim, f } = boxDropped();
    const v = sim.view();
    const k = entity(sim, 0) * WEAPON_SLOT_COUNT;
    v.slotReserve[k + WEAPON_SLOT.primary] = 0;
    v.slotClip[k + WEAPON_SLOT.throwable] = 0;
    const taken = walkToBox(sim, f);
    expect(taken.map((t) => [t.action, t.entity])).toEqual([['take', sim.controllerEntity(0)]]);
    expect(v.slotReserve[k + WEAPON_SLOT.primary]).toBe(WEAPON_RIFLE.clipSize);
    expect(v.slotReserve[k + WEAPON_SLOT.secondary]).toBe(WEAPON_PISTOL.reserve);
    expect(v.slotClip[k + WEAPON_SLOT.throwable]).toBe(1);
    expect(v.pickups.count).toBe(0);
  });

  it('com tudo cheio, a caixinha fica; some sozinha depois de 20 s', () => {
    const { sim, f } = boxDropped();
    expect(walkToBox(sim, f)).toEqual([]);
    expect(sim.view().pickups.count).toBe(1);
    run(sim, f, MATCH_DEFAULTS.ammoBoxLifeS * SIM_HZ);
    expect(sim.view().pickups.count).toBe(0);
  });

  it('quem cai no vazio não deixa caixinha', () => {
    const sim = createSim({ recipe: DUEL, map: flatMap([spawn(10.25, 8, 0), spawn(10.25, 18.5, 1)], 20), humans: 2 });
    const f = createInputFrames();
    f[1]!.yaw = yawToU16(Math.PI);
    f[1]!.moveY = 127;
    const drops: PickupEvent[] = [];
    let kills = 0;
    run(sim, f, 4 * SIM_HZ, (list) => {
      pickups(drops)(list);
      for (const ev of list) if (ev.type === 'kill') kills++;
    });
    expect([kills, drops.length]).toEqual([1, 0]);
  });

  it('entra no snapshot: ler e seguir dá o mesmo hash', () => {
    const { sim, f } = boxDropped();
    const w = new BitWriter(1 << 20);
    sim.writeSnapshot(w);
    run(sim, f, 30);
    const expected = sim.stateHash();
    const other = createSim({ recipe: DUEL, map: flatMap([spawn(10.25, 25, 0), spawn(10.25, 15, 1)]), humans: 2 });
    other.readSnapshot(new BitReader(w.bytes()));
    expect(other.view().pickups.count).toBe(1);
    run(other, f, 30);
    expect(other.stateHash()).toBe(expected);
  });
});

describe('Destravar', () => {
  /**
   * Um cercado de 1 × 1 m (paredes de 4 m) em x 10–11 m, z 20–21 m: o bobo preso nasce dentro, num nó de navegação
   * ilhado. Os nós livres mais perto ficam a 2 m, um de cada lado.
   */
  function pen(spawns: MapSpawn[]): SimMap {
    const map = flatMap(spawns, 40, (grid) => {
      fillBox(grid, 19, 1, 39, 22, 8, 39, concrete);
      fillBox(grid, 19, 1, 42, 22, 8, 42, concrete);
      fillBox(grid, 19, 1, 39, 19, 8, 42, concrete);
      fillBox(grid, 22, 1, 39, 22, 8, 42, concrete);
    });
    return { ...map, nav: buildNavGrid({ grid: map.grid, blocks }, BOBO_NAV_METRICS) };
  }

  function press(sim: Sim, f: InputFrame[], c: number): UnstuckEvent[] {
    const out: UnstuckEvent[] = [];
    const collect = (list: SimEvent[]): void => {
      for (const ev of list) if (ev.type === 'unstuck') out.push({ ...ev });
    };
    f[c]!.buttons = BUTTON.unstuck;
    run(sim, f, 1, collect);
    f[c]!.buttons = 0;
    run(sim, f, 1, collect);
    return out;
  }

  const inPen = (x: number, z: number): boolean => x > 9.5 && x < 11.5 && z > 19.5 && z < 21.5;

  it('o humano preso vai para o nó livre mais perto, a 2 m, fora do cercado', () => {
    const sim = createSim({
      recipe: { ...DUEL, teams: [{ humans: 1, bots: [] }] },
      map: pen([spawn(10.5, 20.5, 0)]),
      humans: 1,
    });
    const f = createInputFrames();
    run(sim, f, 10);
    const [ev, ...rest] = press(sim, f, 0);
    expect(rest).toEqual([]);
    expect([ev!.respawned, ev!.fromX, ev!.fromZ]).toEqual([false, 10.5, 20.5]);
    expect(Math.hypot(ev!.x - 10.5, ev!.z - 20.5)).toBeCloseTo(2, 3);
    expect(inPen(ev!.x, ev!.z)).toBe(false);
    const v = sim.view();
    const e = entity(sim, 0);
    expect([v.position[e * 3], v.position[e * 3 + 2]]).toEqual([ev!.x, ev!.z]);
    expect(v.health[e]).toBe(100);
  });

  it('o bot vai para um nó fora da vista do humano; na 3ª vez, renasce num spawn', () => {
    // Humano em z = 30,5 m, olhando o cercado de frente: os nós ao sul, a leste e a oeste estão à vista; o do norte
    // fica escondido atrás do próprio cercado.
    const recipe: MatchRecipe = {
      ...DUEL,
      teams: [{ humans: 1, bots: [] }, { bots: [{ ref: 'builtin:normal-bob', count: 1 }] }],
    };
    const sim = createSim({ recipe, map: pen([spawn(10.5, 30.5, 0), spawn(10.5, 20.5, 1)]), humans: 1 });
    const f = createInputFrames();
    const bot = BOT_CONTROLLER_BASE;
    run(sim, f, 10);
    const first = press(sim, f, bot)[0]!;
    expect(first.respawned).toBe(false);
    expect(first.z).toBeLessThan(19.5);
    expect(Math.abs(first.x - 10.5)).toBeLessThan(0.01);
    expect(press(sim, f, bot)[0]!.respawned).toBe(false);
    const third = press(sim, f, bot)[0]!;
    expect(third.respawned).toBe(true);
    expect([third.x, third.z]).toEqual([10.5, 20.5]);
    // A vida nova zera a conta.
    expect(press(sim, f, bot)[0]!.respawned).toBe(false);
  });
});
