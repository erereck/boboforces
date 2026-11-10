import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, quantizeAxis, type InputFrame } from '@boboforces/input';
import { buildNavGrid, createNavPath, findPath } from '@boboforces/nav';
import { BitReader, BitWriter, yawToU16 } from '@boboforces/shared';
import { BLOCK_FLAG, cellCenter, createBlockRegistry, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { BOBO_NAV_METRICS } from './config/nav-metrics.ts';
import { ZOMBIE_BARRICADES, ZOMBIE_POINTS, ZOMBIE_TYPE, ZOMBIES_MODE } from './config/zombie.ts';
import { SIM_HZ, ZOMBIE_CONTROLLER_BASE } from './constants.ts';
import { ENTITY_FLAG, ENTITY_KIND } from './entity.ts';
import type { BarricadeEvent, DoorEvent, SimEvent } from './events.ts';
import { createInputFrames } from './loop.ts';
import type { DoorDef, BarricadeDef } from './map-objects.ts';
import { createSim, type Sim, type SimMap, type SpawnPoint } from './sim.ts';

/**
 * M3 (fase 3d): janelas com barricada e portas pagas. Mapa de 20 × 30 m com um muro de 3 m em z = 15..15,5 m e um vão
 * de 1 m em x = 10..11 m. Dentro (sul, z < 15) fica o humano; fora (norte) nascem os zumbis.
 */
const SOLID = BLOCK_FLAG.solid | BLOCK_FLAG.blocksBullets | BLOCK_FLAG.blocksSight | BLOCK_FLAG.walkable;
const blocks = createBlockRegistry([
  { key: 'concrete', shape: 'cube', faces: [1, 1, 1, 1, 1, 1], flags: SOLID, frames: 1, stepSound: 'concrete' },
]);
const concrete = makeCell(blocks.byKey('concrete')!.id);
const FLOOR = 0.5;
const GAP_X = 10.5;
const WALL_Z = 15.25;

const WINDOW: BarricadeDef = { x: GAP_X, y: FLOOR, z: WALL_Z, outside: 2, width: 1 };
const DOOR: DoorDef = { minX: 10, minY: FLOOR, minZ: 15, maxX: 11, maxY: FLOOR + 2.5, maxZ: 15.5, cost: 750 };

function walledMap(spawns: SpawnPoint[], objects: { barricades?: BarricadeDef[]; doors?: DoorDef[] }): SimMap {
  const grid = createWorldGrid(40, 16, 60);
  fillBox(grid, 0, 0, 0, 39, 0, 59, concrete);
  fillBox(grid, 0, 1, 30, 19, 6, 30, concrete);
  fillBox(grid, 22, 1, 30, 39, 6, 30, concrete);
  return { grid, blocks, spawns, nav: buildNavGrid({ grid, blocks }, BOBO_NAV_METRICS), ...objects };
}

const inside = (z = 10, x = GAP_X): SpawnPoint => ({ x, y: FLOOR, z, yaw: 0, team: 0 });
const outside: SpawnPoint = { x: cellCenter(20), y: FLOOR, z: 26, yaw: Math.PI, team: -1 };

function zombiesRecipe(): MatchRecipe {
  return { format: MATCH_RECIPE_FORMAT, mode: 'zombies', map: 'test', seed: 3, teams: [{ humans: 'all', bots: [] }] };
}

function step(sim: Sim, f: InputFrame[], out: SimEvent[]): void {
  sim.step(f);
  sim.drainEvents(out);
}

/** Cada zumbi em jogo anda até a janela e, passando dela, até o humano. */
function driveZombies(sim: Sim, f: InputFrame[], pool: number): void {
  const v = sim.view();
  const h = sim.controllerEntity(0) & 0xffff;
  for (let i = 0; i < pool; i++) {
    const e = sim.controllerEntity(ZOMBIE_CONTROLLER_BASE + i) & 0xffff;
    const x = v.position[e * 3]!;
    const z = v.position[e * 3 + 2]!;
    const [tx, tz] = z > WALL_Z + 0.3 ? [GAP_X, WALL_Z] : [v.position[h * 3]!, v.position[h * 3 + 2]!];
    const zf = f[ZOMBIE_CONTROLLER_BASE + i]!;
    zf.yaw = yawToU16(Math.atan2(-(tx - x), -(tz - z)));
    zf.moveY = quantizeAxis(1);
  }
}

describe('Bobo Zombies: janelas com barricada (M3, fase 3d)', () => {
  it('o zumbi para nas tábuas, arranca 1 a cada 1,5 s e só passa sem nenhuma', () => {
    const sim = createSim({
      recipe: zombiesRecipe(),
      map: walledMap([inside(), outside], { barricades: [WINDOW] }),
      humans: 1,
      zombies: 1,
    });
    const v = sim.view();
    const mo = v.mapObjects!;
    expect(mo.planks[0]).toBe(ZOMBIE_BARRICADES.planks);
    const f = createInputFrames();
    const events: SimEvent[] = [];
    const tears: number[] = [];
    let crossedAt = -1;
    const z = sim.controllerEntity(ZOMBIE_CONTROLLER_BASE) & 0xffff;
    for (let t = 0; t < 40 * SIM_HZ && crossedAt < 0; t++) {
      driveZombies(sim, f, 1);
      events.length = 0;
      step(sim, f, events);
      for (const ev of events) if (ev.type === 'barricade' && ev.action === 'tear') tears.push(ev.tick);
      const zz = v.position[z * 3 + 2]!;
      if ((v.flags[z]! & ENTITY_FLAG.dead) === 0 && v.kind[z] === ENTITY_KIND.zombie && zz < WALL_Z - 0.5) {
        crossedAt = v.tick;
      }
      // Com tábua, nunca passa do plano da janela.
      if (mo.planks[0]! > 0 && (v.flags[z]! & ENTITY_FLAG.dead) === 0) expect(zz).toBeGreaterThan(WALL_Z);
    }
    expect(tears).toHaveLength(6);
    for (let k = 1; k < 6; k++) expect(tears[k]! - tears[k - 1]!).toBe(1.5 * SIM_HZ);
    expect(mo.planks[0]).toBe(0);
    expect(crossedAt).toBeGreaterThan(tears[5]!);
  }, 30_000);

  it('o chefão arranca a barricada inteira de uma vez', () => {
    const sim = createSim({
      recipe: zombiesRecipe(),
      map: walledMap([inside(), outside], { barricades: [WINDOW] }),
      humans: 1,
      zombies: 1,
    });
    const v = sim.view();
    const f = createInputFrames();
    const events: SimEvent[] = [];
    const z = sim.controllerEntity(ZOMBIE_CONTROLLER_BASE) & 0xffff;
    let broke: BarricadeEvent | null = null;
    for (let t = 0; t < 30 * SIM_HZ && broke === null; t++) {
      // Teste: o zumbi que entrar vira o chefão.
      if ((v.flags[z]! & ENTITY_FLAG.dead) === 0) (v.zombieType as Uint8Array)[z] = ZOMBIE_TYPE.boss;
      driveZombies(sim, f, 1);
      events.length = 0;
      step(sim, f, events);
      for (const ev of events) if (ev.type === 'barricade') broke = ev;
    }
    expect(broke?.action).toBe('break');
    expect(broke?.planks).toBe(0);
    expect(v.mapObjects!.planks[0]).toBe(0);
  }, 30_000);

  it('o bobo de dentro segurando o usar repõe 1 por segundo, com 10 pontos até 50 por onda', () => {
    const sim = createSim({
      recipe: zombiesRecipe(),
      map: walledMap([inside(WALL_Z - 0.8), outside], { barricades: [WINDOW] }),
      humans: 1,
      zombies: 1,
    });
    const v = sim.view();
    const planks = v.mapObjects!.planks as Uint8Array;
    const h = sim.controllerEntity(0) & 0xffff;
    const f = createInputFrames();
    f[0]!.buttons = BUTTON.use;
    const events: SimEvent[] = [];
    const repairs: number[] = [];
    // Na 1ª onda (o teto é por onda); o zumbi fica parado lá fora, longe da janela.
    f[0]!.buttons = 0;
    while (v.match.zombieWave === 0) step(sim, f, events);
    f[0]!.buttons = BUTTON.use;
    planks[0] = 2;
    for (let t = 0; t < 4.5 * SIM_HZ; t++) {
      events.length = 0;
      step(sim, f, events);
      for (const ev of events) if (ev.type === 'barricade' && ev.action === 'repair') repairs.push(ev.planks);
    }
    expect(repairs).toEqual([3, 4, 5, 6]);
    expect(v.points[h]).toBe(ZOMBIE_POINTS.start + 40);
    // Cheia: segurar não faz nada. Vazia de novo: repõe as 6, mas só mais 10 pontos (teto de 50 na onda).
    planks[0] = 0;
    for (let t = 0; t < 6.5 * SIM_HZ; t++) step(sim, f, events);
    expect(planks[0]).toBe(ZOMBIE_BARRICADES.planks);
    expect(v.match.zombieWave).toBe(1);
    expect(v.points[h]).toBe(ZOMBIE_POINTS.start + 50);
  }, 30_000);
});

describe('Bobo Zombies: portas pagas (M3, fase 3d)', () => {
  it('fechada barra o bobo e o caminho; o usar sem pontos nega; com pontos abre colisão e navegação', () => {
    const map = walledMap([inside(WALL_Z - 0.9), outside], { doors: [DOOR] });
    const sim = createSim({ recipe: zombiesRecipe(), map, humans: 1, zombies: 1 });
    const v = sim.view();
    const h = sim.controllerEntity(0) & 0xffff;
    const nav = map.nav!;
    const path = (): string =>
      findPath(nav, nav.nearestNode(GAP_X, FLOOR, 10), nav.nearestNode(GAP_X, FLOOR, 22), createNavPath(nav), 1e6);
    expect(path()).toBe('unreachable');
    const f = createInputFrames();
    const events: SimEvent[] = [];
    // Anda para o norte 1 s: a porta segura.
    f[0]!.yaw = yawToU16(Math.PI);
    f[0]!.moveY = quantizeAxis(1);
    for (let t = 0; t < SIM_HZ; t++) step(sim, f, events);
    expect(v.position[h * 3 + 2]).toBeLessThan(15);
    // Usar com 500 de 750: negado.
    f[0]!.moveY = 0;
    f[0]!.buttons = BUTTON.use;
    events.length = 0;
    step(sim, f, events);
    const denied = events.find((e): e is DoorEvent => e.type === 'door');
    expect(denied?.action).toBe('denied');
    expect(v.mapObjects!.doorOpen[0]).toBe(0);
    // Com 1000 (teste), soltar e apertar de novo: abre e cobra.
    (v.points as Int32Array)[h] = 1000;
    f[0]!.buttons = 0;
    step(sim, f, events);
    f[0]!.buttons = BUTTON.use;
    events.length = 0;
    step(sim, f, events);
    expect(events.find((e): e is DoorEvent => e.type === 'door')?.action).toBe('open');
    expect(v.mapObjects!.doorOpen[0]).toBe(1);
    expect(v.points[h]).toBe(250);
    expect(path()).toBe('found');
    f[0]!.buttons = 0;
    f[0]!.moveY = quantizeAxis(1);
    for (let t = 0; t < 2 * SIM_HZ; t++) step(sim, f, events);
    expect(v.position[h * 3 + 2]).toBeGreaterThan(16);
  });
});

describe('Bobo Zombies: janelas e portas no snapshot (M3, fase 3d)', () => {
  it('tábuas e porta vão e voltam (hash, colisão e navegação)', () => {
    const make = (): { sim: Sim; map: SimMap } => {
      const map = walledMap([inside(), outside], { barricades: [WINDOW], doors: [{ ...DOOR, minX: 2, maxX: 3 }] });
      return { sim: createSim({ recipe: zombiesRecipe(), map, humans: 1, zombies: 2 }), map };
    };
    const a = make();
    const b = make();
    const f = createInputFrames();
    const events: SimEvent[] = [];
    for (let t = 0; t < (ZOMBIES_MODE.firstWaveS + 6) * SIM_HZ; t++) {
      driveZombies(a.sim, f, 2);
      step(a.sim, f, events);
    }
    const planks = a.sim.view().mapObjects!.planks[0]!;
    expect(planks).toBeLessThan(ZOMBIE_BARRICADES.planks);
    const w = new BitWriter(1 << 16);
    a.sim.writeSnapshot(w);
    b.sim.readSnapshot(new BitReader(w.bytes()));
    expect(b.sim.stateHash()).toBe(a.sim.stateHash());
    expect(b.sim.view().mapObjects!.planks[0]).toBe(planks);
    for (let t = 0; t < 3 * SIM_HZ; t++) {
      driveZombies(a.sim, f, 2);
      a.sim.step(f);
      driveZombies(b.sim, f, 2);
      b.sim.step(f);
    }
    expect(b.sim.stateHash()).toBe(a.sim.stateHash());
  }, 30_000);
});
