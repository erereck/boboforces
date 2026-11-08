import {
  FIGURE_BONE,
  FIGURE_PART_CATEGORY,
  MATCH_RECIPE_FORMAT,
  builtinBotRef,
  type MapMarkers,
  type MatchRecipe,
} from '@boboforces/format';
import { BUTTON, quantizeAxis, type InputFrame } from '@boboforces/input';
import { pitchToI16, yawToU16 } from '@boboforces/shared';
import {
  BLOCK_FLAG,
  buildTestArena,
  cellCenter,
  createAabb,
  createBlockRegistry,
  createSweepResult,
  createWorldGrid,
  FACE,
  fillBox,
  makeCell,
  sweepAabb,
  type BlockDefInput,
  type WorldGrid,
} from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { METRICS } from './config/metrics.ts';
import { WEAPON_RIFLE } from './config/weapons.ts';
import { ZOMBIE_RULES } from './config/zombie.ts';
import { MAX_CONTROLLERS_WITH_ZOMBIES, SIM_HZ, ZOMBIE_CONTROLLER_BASE } from './constants.ts';
import { WEAPON_NONE } from './context.ts';
import { ENTITY_FLAG, ENTITY_KIND, entityIndex, NO_TEAM, type EntityId } from './entity.ts';
import type { HitEvent, KillEvent, SimEvent } from './events.ts';
import { aimPointWorld, type AimPoint } from './hitbox.ts';
import { createInputFrames } from './loop.ts';
import { simMapFromMarkers, spawnPointsFromMarkers } from './map.ts';
import { createSim, type Sim, type SimMap, type SpawnPoint } from './sim.ts';

/**
 * M1 (Construto): zumbis, eventos de acerto/morte com parte e direção, impacto com face, área jogável, plano de morte
 * do mapa, spawns dos marcadores, capacidade (4 humanos + 64 bots + 64 zumbis) e movimento sobre as formas.
 */

const SOLID = BLOCK_FLAG.solid | BLOCK_FLAG.blocksBullets | BLOCK_FLAG.blocksSight | BLOCK_FLAG.walkable;
const SHAPE_DEFS: readonly BlockDefInput[] = [
  { key: 'concrete', shape: 'cube', faces: [1, 1, 1, 1, 1, 1], flags: SOLID, frames: 1, stepSound: 'concrete' },
  { key: 'concrete-slab', shape: 'slab', faces: [1, 1, 1, 1, 1, 1], flags: SOLID, frames: 1, stepSound: 'concrete' },
  {
    key: 'concrete-ramp-half-low',
    shape: 'rampHalfLow',
    faces: [1, 1, 1, 1, 1, 1],
    flags: SOLID,
    frames: 1,
    stepSound: 'concrete',
  },
  {
    key: 'concrete-ramp-half-high',
    shape: 'rampHalfHigh',
    faces: [1, 1, 1, 1, 1, 1],
    flags: SOLID,
    frames: 1,
    stepSound: 'concrete',
  },
];
const blocks = createBlockRegistry(SHAPE_DEFS);
const concrete = makeCell(blocks.byKey('concrete')!.id);
const slab = makeCell(blocks.byKey('concrete-slab')!.id);
const rampLow = makeCell(blocks.byKey('concrete-ramp-half-low')!.id);
const rampHigh = makeCell(blocks.byKey('concrete-ramp-half-high')!.id);

const FLOOR = 0.5;

function flat(spawns: SpawnPoint[], build?: (g: WorldGrid) => void, extra: Partial<SimMap> = {}): SimMap {
  const grid = createWorldGrid(40, 16, 60);
  fillBox(grid, 0, 0, 0, 39, 0, 59, concrete);
  build?.(grid);
  return { grid, blocks, spawns, ...extra };
}

function recipe(teams: MatchRecipe['teams'], overrides: Partial<MatchRecipe> = {}): MatchRecipe {
  return { format: MATCH_RECIPE_FORMAT, mode: 'warfare.tdm', map: 'test', seed: 11, teams, ...overrides };
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

function posOf(sim: Sim, id: EntityId): [number, number, number] {
  const e = entityIndex(id);
  const p = sim.view().position;
  return [p[e * 3]!, p[e * 3 + 1]!, p[e * 3 + 2]!];
}

/** O world já colide com as formas do catálogo (frente mundo)? Laje: o pé fica em 0,25 m dentro da célula. */
function worldHasShapes(): boolean {
  const grid = createWorldGrid(4, 4, 4);
  grid.set(1, 0, 1, slab);
  const box = createAabb();
  box.minX = 0.55;
  box.maxX = 0.95;
  box.minZ = 0.55;
  box.maxZ = 0.95;
  box.minY = 1;
  box.maxY = 2.5;
  const out = createSweepResult();
  try {
    sweepAabb(grid, blocks, box, 0, -2, 0, 0, out);
  } catch {
    return false;
  }
  return Math.abs(box.minY - 0.25) < 1e-6;
}
const SHAPES = worldHasShapes();

describe('zumbis (estresse do M1)', () => {
  const human: SpawnPoint = { x: cellCenter(20), y: FLOOR, z: 20, yaw: 0, team: 0 };

  it('nascem nos controladores 68.., sem time e sem arma, longe dos bobos', () => {
    const far: SpawnPoint = { x: cellCenter(20), y: FLOOR, z: 5, yaw: Math.PI, team: -1 };
    const near: SpawnPoint = { x: cellCenter(20), y: FLOOR, z: 22, yaw: 0, team: -1 };
    const sim = createSim({
      recipe: recipe([{ humans: 1, bots: [] }]),
      map: flat([human, near, far]),
      humans: 1,
      zombies: 3,
    });
    expect(sim.controllerCount).toBe(ZOMBIE_CONTROLLER_BASE + 3);
    const v = sim.view();
    for (let i = 0; i < 3; i++) {
      const id = sim.controllerEntity(ZOMBIE_CONTROLLER_BASE + i);
      const e = entityIndex(id);
      expect(v.kind[e]).toBe(ENTITY_KIND.zombie);
      expect(v.team[e]).toBe(NO_TEAM);
      expect(v.weapon[e]).toBe(WEAPON_NONE);
      expect(v.health[e]).toBe(ZOMBIE_RULES.hp);
      expect(v.flags[e]! & ENTITY_FLAG.spawnProtected).toBe(0);
    }
    // Metade mais longe dos 3 pontos = os 2 mais longe do humano, em rodízio.
    expect(posOf(sim, sim.controllerEntity(ZOMBIE_CONTROLLER_BASE))[2]).toBe(5);
    expect(sim.controllerEntity(MAX_CONTROLLERS_WITH_ZOMBIES)).toBe(0);
  });

  it('o zumbi bate de perto: golpe com direção, 4 golpes derrubam, abate fora do placar', () => {
    const zspawn: SpawnPoint = { x: human.x, y: FLOOR, z: human.z - 1, yaw: Math.PI, team: -1 };
    const sim = createSim({
      recipe: recipe([{ humans: 1, bots: [] }]),
      map: flat([human, zspawn]),
      humans: 1,
      zombies: 1,
    });
    const f = createInputFrames();
    const zf = f[ZOMBIE_CONTROLLER_BASE]!;
    zf.yaw = yawToU16(Math.PI); // olha para +Z (o humano)
    zf.buttons = BUTTON.melee;
    const me = sim.controllerEntity(0);
    const zombie = sim.controllerEntity(ZOMBIE_CONTROLLER_BASE);
    let melees = 0;
    let damageHits = 0;
    let kill: KillEvent | null = null;
    run(sim, f, 6 * SIM_HZ, (events) => {
      for (const ev of events) {
        if (ev.type === 'melee' && ev.attacker === zombie) {
          melees++;
          expect(ev.target).toBe(me);
        }
        if (ev.type === 'hit' && ev.shooter === zombie && ev.damage > 0) {
          damageHits++;
          expect(ev.damage).toBe(ZOMBIE_RULES.meleeDamage);
          expect(ev.bodyPart).toBe(FIGURE_BONE.torso);
          expect(ev.dirZ).toBeCloseTo(1, 6);
        }
        if (ev.type === 'kill' && ev.victim === me && kill === null) kill = { ...ev };
      }
    });
    // 1,5 s de proteção de spawn (golpes sem dano) e depois 4 golpes de 25.
    expect(melees).toBeGreaterThanOrEqual(5);
    expect(damageHits).toBe(4);
    expect(kill).not.toBeNull();
    const k = kill as unknown as KillEvent;
    expect(k.killer).toBe(zombie);
    expect(k.weapon).toBe(WEAPON_NONE);
    expect(k.force).toBe(ZOMBIE_RULES.meleeForce);
    expect(k.dirZ).toBeCloseTo(1, 6);
    expect(Array.from(sim.view().match.teamScore)).toEqual([0, 0, 0, 0]);
  });

  it('zumbi de costas ou longe erra (golpe sem alvo)', () => {
    const zspawn: SpawnPoint = { x: human.x, y: FLOOR, z: human.z - 1, yaw: 0, team: -1 };
    const sim = createSim({
      recipe: recipe([{ humans: 1, bots: [] }]),
      map: flat([human, zspawn]),
      humans: 1,
      zombies: 1,
    });
    const f = createInputFrames();
    const zf = f[ZOMBIE_CONTROLLER_BASE]!;
    zf.yaw = yawToU16(0); // de costas para o humano
    zf.buttons = BUTTON.melee;
    const targets: number[] = [];
    run(sim, f, 2 * SIM_HZ, (events) => {
      for (const ev of events) if (ev.type === 'melee') targets.push(ev.target);
    });
    expect(targets.length).toBe(2);
    expect(targets.every((t) => t === 0)).toBe(true);
  });

  it('bobo mata zumbi a tiro: acerto com parte e direção, abate conta para o bobo e o zumbi volta', () => {
    const zspawn: SpawnPoint = { x: human.x, y: FLOOR, z: human.z - 10, yaw: Math.PI, team: -1 };
    const sim = createSim({
      recipe: recipe([{ humans: 1, bots: [] }]),
      map: flat([human, zspawn]),
      humans: 1,
      zombies: 1,
    });
    const f = createInputFrames();
    const me = sim.controllerEntity(0);
    const zombie = sim.controllerEntity(ZOMBIE_CONTROLLER_BASE);
    // Mira no centro do tronco do zumbi (postura de zumbi, braços à frente), a 10 m.
    const torso: AimPoint = { x: 0, y: 0, z: 0 };
    aimPointWorld(sim.view(), entityIndex(zombie), false, torso);
    const pitch = Math.atan2(torso.y - FLOOR - METRICS.eyeHeight, human.z - torso.z);
    f[0]!.yaw = yawToU16(0);
    f[0]!.pitch = pitchToI16(pitch);
    f[0]!.buttons = BUTTON.fire | BUTTON.ads;
    const hits: HitEvent[] = [];
    let kill: KillEvent | null = null;
    let respawnTick = -1;
    run(sim, f, 2 * SIM_HZ, (events) => {
      for (const ev of events) {
        if (ev.type === 'hit' && ev.target === zombie) hits.push({ ...ev });
        if (ev.type === 'kill' && ev.victim === zombie && kill === null) {
          kill = { ...ev };
          f[0]!.buttons = 0;
        }
      }
    });
    expect(kill).not.toBeNull();
    const k = kill as unknown as KillEvent;
    expect(k.killer).toBe(me);
    expect(k.weapon).toBe(0);
    expect(k.force).toBe(WEAPON_RIFLE.killForce);
    expect(k.dirZ).toBeLessThan(-0.99);
    expect(hits.length).toBeGreaterThanOrEqual(4);
    for (const h of hits) {
      // Tronco ou braço (os braços do zumbi vão à frente do peito).
      expect([1, 2]).toContain(FIGURE_PART_CATEGORY[h.bodyPart]);
      expect(Math.hypot(h.dirX, h.dirY, h.dirZ)).toBeCloseTo(1, 6);
      expect(h.dirY).toBeLessThan(0);
    }
    expect(sim.view().kills[entityIndex(me)]).toBe(1);
    expect(Array.from(sim.view().match.teamScore)).toEqual([0, 0, 0, 0]);
    run(sim, f, ZOMBIE_RULES.respawnS * SIM_HZ + 2, (events) => {
      for (const ev of events) if (ev.type === 'spawn' && ev.entity === zombie) respawnTick = ev.tick;
    });
    expect(respawnTick).toBe(k.tick + ZOMBIE_RULES.respawnS * SIM_HZ);
  });
});

describe('eventos de acerto e impacto (M1)', () => {
  const south: SpawnPoint = { x: cellCenter(20), y: FLOOR, z: 25, yaw: 0, team: 0 };
  const north: SpawnPoint = { x: cellCenter(20), y: FLOOR, z: 15, yaw: Math.PI, team: 1 };

  it('tiro na cabeça diz cabeça; o abate leva a direção do tiro e a força da arma', () => {
    const sim = createSim({
      recipe: recipe([
        { humans: 1, bots: [] },
        { humans: 1, bots: [] },
      ]),
      map: flat([south, north]),
      humans: 2,
    });
    const f = createInputFrames();
    run(sim, f, SIM_HZ * 2); // passa a proteção de spawn
    const head: AimPoint = { x: 0, y: 0, z: 0 };
    aimPointWorld(sim.view(), entityIndex(sim.controllerEntity(1)), true, head);
    const pitch = Math.atan2(head.y - FLOOR - METRICS.eyeHeight, south.z - head.z);
    f[0]!.yaw = yawToU16(0);
    f[0]!.pitch = pitchToI16(pitch);
    f[0]!.buttons = BUTTON.fire | BUTTON.ads;
    const victim = sim.controllerEntity(1);
    const parts: number[] = [];
    let kill: KillEvent | null = null;
    run(sim, f, SIM_HZ, (events) => {
      for (const ev of events) {
        if (ev.type === 'hit' && ev.target === victim) parts.push(ev.bodyPart);
        if (ev.type === 'kill' && ev.victim === victim && kill === null) kill = { ...ev };
      }
    });
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.filter((p) => p === FIGURE_BONE.head).length).toBeGreaterThan(parts.length / 2);
    const k = kill as unknown as KillEvent;
    expect(k.headshot).toBe(true);
    expect(k.bodyPart).toBe(FIGURE_BONE.head);
    expect(k.dirZ).toBeLessThan(-0.99);
    expect(k.force).toBe(WEAPON_RIFLE.killForce);
  });

  it('impacto no cenário traz a face da tabela de normais e prop -1', () => {
    // Parede ao norte do atirador (z = 10..10,5 m): a bala viaja para -Z e bate na face +Z da parede.
    const map = flat([south, north], (g) => fillBox(g, 0, 1, 20, 39, 6, 20, concrete));
    const sim = createSim({
      recipe: recipe([
        { humans: 1, bots: [] },
        { humans: 1, bots: [] },
      ]),
      map: {
        ...map,
        spawns: [
          { ...south, z: 25 },
          { ...north, z: 2 },
        ],
      },
      humans: 2,
    });
    const f = createInputFrames();
    f[0]!.yaw = yawToU16(0);
    f[0]!.buttons = BUTTON.fire;
    let impact: SimEvent | null = null;
    run(sim, f, 10, (events) => {
      for (const ev of events) if (ev.type === 'impact' && impact === null) impact = { ...ev };
    });
    const im = impact as unknown as Extract<SimEvent, { type: 'impact' }>;
    expect(im).not.toBeNull();
    expect(im.face).toBe(FACE.pz);
    expect(im.normalZ).toBe(1);
    expect(im.z).toBeCloseTo(10.5, 6);
    expect(im.prop).toBe(-1);
    expect(im.block).toBe(blocks.byKey('concrete')!.id);
  });
});

describe('mapa do M1: marcadores, área jogável e plano de morte', () => {
  const markers: Pick<MapMarkers, 'spawns' | 'playArea'> = {
    spawns: [
      { x: 10.25, y: 0.5, z: 10.25, yaw: 0, team: 0 },
      { x: 12.25, y: 0.5, z: 20.25, yaw: Math.PI, team: 1 },
      { x: 5.25, y: 0.5, z: 5.25, yaw: 1, team: -1 },
    ],
    playArea: { minX: 4, minZ: 4, maxX: 16, maxZ: 26, killPlaneY: -3 },
  };

  it('spawns e área jogável saem dos marcadores', () => {
    const grid = createWorldGrid(40, 16, 60);
    const map = simMapFromMarkers({ grid, blocks, markers });
    expect(map.spawns).toEqual(spawnPointsFromMarkers(markers));
    expect(map.spawns[2]).toEqual({ x: 5.25, y: 0.5, z: 5.25, yaw: 1, team: -1 });
    expect(map.playArea).toEqual({ minX: 4, minZ: 4, maxX: 16, maxZ: 26 });
    expect(map.killPlaneY).toBe(-3);
    expect(map.colliders).toBeUndefined();
    expect(() => simMapFromMarkers({ grid, blocks, markers: { ...markers, spawns: [] } })).toThrow();
    expect(() => spawnPointsFromMarkers({ spawns: [{ x: 1, y: 1, z: Number.NaN, yaw: 0, team: 0 }] })).toThrow();
  });

  it('a borda da área jogável é parede invisível em X e Z', () => {
    const grid = createWorldGrid(40, 16, 60);
    fillBox(grid, 0, 0, 0, 39, 0, 59, concrete);
    const map = simMapFromMarkers({ grid, blocks, markers });
    const sim = createSim({ recipe: recipe([{ humans: 1, bots: [] }]), map, humans: 1 });
    const f = createInputFrames();
    f[0]!.yaw = yawToU16(Math.PI / 2); // olha para -X
    f[0]!.moveY = quantizeAxis(1);
    run(sim, f, 3 * SIM_HZ);
    const me = sim.controllerEntity(0);
    expect(posOf(sim, me)[0]).toBeCloseTo(4 + METRICS.aabbWidth / 2, 9);
    expect(sim.view().velocity[entityIndex(me) * 3]).toBe(0);
    f[0]!.yaw = yawToU16(0); // agora para -Z
    run(sim, f, 3 * SIM_HZ);
    expect(posOf(sim, me)[2]).toBeCloseTo(4 + METRICS.aabbWidth / 2, 9);
  });

  it('o plano de morte do mapa vale no lugar do padrão', () => {
    const grid = createWorldGrid(40, 16, 60);
    fillBox(grid, 0, 8, 0, 9, 8, 9, concrete); // só um bloco alto (topo em 4,5 m); o spawn fica no vazio, longe dele
    const sim = createSim({
      recipe: recipe([{ humans: 1, bots: [] }]),
      map: { grid, blocks, spawns: [{ x: 15, y: 2, z: 20, yaw: 0, team: 0 }], killPlaneY: 1 },
      humans: 1,
    });
    let killTick = -1;
    run(sim, createInputFrames(), SIM_HZ, (events) => {
      for (const ev of events) if (ev.type === 'kill' && killTick < 0) killTick = ev.tick;
    });
    // Cai de 2 m até passar de 1 m: ~0,32 s com g = 20 (o padrão seria 10 m abaixo do bloco mais baixo: 4 m).
    expect(killTick).toBeGreaterThan(0);
    expect(killTick).toBeLessThan(SIM_HZ / 2);
  });
});

describe('capacidade: 4 humanos + 64 bots + 64 zumbis', () => {
  it('cria, roda e mantém o hash determinístico', () => {
    const hashOnce = (): number => {
      const sim = createSim({
        recipe: recipe([
          { humans: 2, bots: [{ ref: builtinBotRef('normal'), count: 32 }] },
          { humans: 2, bots: [{ ref: builtinBotRef('normal'), count: 32 }] },
        ]),
        map: buildTestArena(),
        humans: 4,
        zombies: 64,
      });
      expect(sim.controllerCount).toBe(MAX_CONTROLLERS_WITH_ZOMBIES);
      const f = createInputFrames();
      for (let i = 0; i < 64; i++) f[ZOMBIE_CONTROLLER_BASE + i]!.buttons = BUTTON.melee;
      run(sim, f, 300);
      let bodies = 0;
      const v = sim.view();
      for (let e = 0; e < v.count; e++) if (v.alive[e] === 1) bodies++;
      expect(bodies).toBe(4 + 64 + 64);
      return sim.stateHash();
    };
    expect(hashOnce()).toBe(hashOnce());
  });
});

describe.runIf(SHAPES)('movimento sobre as formas (com o world do M1)', () => {
  const spawn: SpawnPoint = { x: cellCenter(20), y: FLOOR, z: 25, yaw: 0, team: 0 };

  it('anda em cima da laje (0,25 m) e levanta do agachado em cima dela', () => {
    const map = flat([spawn], (g) => fillBox(g, 0, 1, 30, 39, 1, 59, slab));
    const sim = createSim({
      recipe: recipe([{ humans: 1, bots: [] }]),
      map: { ...map, spawns: [{ ...spawn, y: 1 }] },
      humans: 1,
    });
    const f = createInputFrames();
    run(sim, f, 30);
    const me = sim.controllerEntity(0);
    expect(posOf(sim, me)[1]).toBeCloseTo(FLOOR + 0.25, 6);
    f[0]!.buttons = BUTTON.crouch;
    run(sim, f, 5);
    f[0]!.buttons = 0;
    run(sim, f, 2);
    expect(sim.view().flags[entityIndex(me)]! & ENTITY_FLAG.crouching).toBe(0);
  });

  it('sobe a rampa 1:2 lisa (sem evento de degrau) e desce grudado no chão', () => {
    // Rampa 1:2 de 0,5 m subindo para -Z (forma canônica): baixa na célula z = 20 (10..10,5 m), alta na 19 e platô
    // de 1,0 m nas células z ≤ 18. O bobo nasce em z = 13 m e anda para -Z.
    const map = flat([{ ...spawn, z: 13 }], (g) => {
      fillBox(g, 0, 1, 20, 39, 1, 20, rampLow);
      fillBox(g, 0, 1, 19, 39, 1, 19, rampHigh);
      fillBox(g, 0, 1, 0, 39, 1, 18, concrete);
    });
    const sim = createSim({ recipe: recipe([{ humans: 1, bots: [] }]), map, humans: 1 });
    const f = createInputFrames();
    f[0]!.moveY = quantizeAxis(1);
    let steps = 0;
    let lands = 0;
    run(sim, f, 2 * SIM_HZ, (events) => {
      for (const ev of events) {
        if (ev.type === 'move' && ev.move === 'step') steps++;
        if (ev.type === 'move' && ev.move === 'land') lands++;
      }
    });
    const me = sim.controllerEntity(0);
    expect(posOf(sim, me)[1]).toBeCloseTo(1.0, 6);
    expect(steps).toBe(0);
    expect(lands).toBe(0);
    // Meia-volta: desce a rampa sem sair do chão.
    f[0]!.yaw = yawToU16(Math.PI);
    run(sim, f, 2 * SIM_HZ, (events) => {
      for (const ev of events) if (ev.type === 'move' && ev.move === 'land') lands++;
    });
    expect(posOf(sim, me)[1]).toBeCloseTo(FLOOR, 6);
    expect(lands).toBe(0);
  });
});
