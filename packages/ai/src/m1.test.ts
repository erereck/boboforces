import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, type InputFrame } from '@boboforces/input';
import { yawToU16 } from '@boboforces/shared';
import {
  BOBO_NAV_METRICS,
  BOT_CONTROLLER_BASE,
  createInputFrames,
  createSim,
  ENTITY_KIND,
  entityIndex,
  SIM_HZ,
  ZOMBIE_CONTROLLER_BASE,
  type SimEvent,
  type SimMap,
} from '@boboforces/sim';
import { buildSyntheticConstruto, buildTestNav, TEST_NAV_PATHS } from '@boboforces/sim/testing';
import { cellCenter, createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { AI_BUDGET, AI_LOD, AI_SOLDIER } from './config.ts';
import { AiContext } from './context.ts';
import { createBotDirectorWithPaths } from './director.ts';
import { createHeadlessMatch } from './headless.ts';
import { PathFollower, PathService } from './paths.ts';

/** IA do M1: rota pelo A* com orçamento, audição, zumbis, LOD e orçamentos por tick. */

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);

/**
 * Duas salas separadas por um muro de 3 m em z = 20 m, com passagem de 4 m só no lado leste (x = 16..20 m). O humano
 * fica ao sul (z = 30 m), o bot ao norte (z = 10 m): sem linha de visão, o bot precisa ouvir e dar a volta.
 */
function twoRooms(withNav: boolean): SimMap {
  const grid = createWorldGrid(40, 12, 80);
  fillBox(grid, 0, 0, 0, 39, 0, 79, concrete);
  fillBox(grid, 0, 1, 40, 31, 6, 40, concrete);
  const map: SimMap = {
    grid,
    blocks,
    spawns: [
      { x: cellCenter(8), y: 0.5, z: 30, yaw: Math.PI, team: 0 },
      { x: cellCenter(8), y: 0.5, z: 10, yaw: Math.PI, team: 1 },
    ],
  };
  return withNav ? { ...map, nav: buildTestNav({ grid, blocks }, BOBO_NAV_METRICS) } : map;
}

function recipe(teams: MatchRecipe['teams'], seed = 9): MatchRecipe {
  return { format: MATCH_RECIPE_FORMAT, mode: 'warfare.tdm', map: 'test', seed, teams };
}

describe('soldado N0 com navegação', () => {
  it('ouve o tiro atrás do muro, dá a volta pela rota do A* e mata', () => {
    const r = recipe([{ humans: 1, bots: [] }, { bots: [{ ref: builtinBotRef('normal'), count: 1 }] }]);
    let killer = 0;
    let killTick = -1;
    const match = createHeadlessMatch({
      recipe: r,
      map: twoRooms(true),
      humans: 1,
      paths: TEST_NAV_PATHS,
      // O humano atira sem parar na parede do sul (faz barulho, não acerta ninguém).
      writeHumans: (f: InputFrame[]) => {
        f[0]!.yaw = yawToU16(Math.PI);
        f[0]!.buttons = BUTTON.fire;
      },
      onEvents: (events: readonly SimEvent[]) => {
        for (const ev of events) {
          if (ev.type === 'kill' && killer === 0) {
            killer = ev.killer;
            killTick = ev.tick;
          }
        }
      },
    });
    for (let t = 0; t < 25 * SIM_HZ && killer === 0; t++) match.step();
    expect(killer).toBe(match.sim.controllerEntity(BOT_CONTROLLER_BASE));
    expect(killTick).toBeLessThan(25 * SIM_HZ);
    expect(match.director.stats().pathsServed).toBeGreaterThan(0);
    match.dispose();
  }, 30_000);

  it('Construto sintético com 4 humanos, 48 bots e 24 zumbis: orçamento de raios, de A* e de mira em todo tick', () => {
    const { map } = buildSyntheticConstruto({ nav: true });
    const r = recipe(
      [
        { humans: 2, bots: [{ ref: builtinBotRef('normal'), count: 24 }] },
        { humans: 2, bots: [{ ref: builtinBotRef('sweaty'), count: 24 }] },
      ],
      3,
    );
    const match = createHeadlessMatch({ recipe: r, map, humans: 4, zombies: 24, paths: TEST_NAV_PATHS });
    let prev = match.director.stats();
    let maxRays = 0;
    let maxCalls = 0;
    let maxAims = 0;
    let kills = 0;
    for (let t = 0; t < 15 * SIM_HZ; t++) {
      match.step();
      const s = match.director.stats();
      maxRays = Math.max(maxRays, s.rays - prev.rays);
      maxCalls = Math.max(maxCalls, s.pathCalls - prev.pathCalls);
      maxAims = Math.max(maxAims, s.visibleAims - prev.visibleAims);
      prev = s;
    }
    const v = match.sim.view();
    let zombieDeaths = 0;
    for (let e = 0; e < v.count; e++) if (v.kind[e] === ENTITY_KIND.bobo) kills += v.kills[e]!;
    for (let e = 0; e < v.count; e++) if (v.kind[e] === ENTITY_KIND.zombie) zombieDeaths += v.deaths[e]!;
    expect(maxRays).toBeLessThanOrEqual(AI_BUDGET.raysPerTick);
    expect(maxCalls).toBeLessThanOrEqual(Math.ceil(AI_BUDGET.pathNodesPerTick / AI_BUDGET.pathSlice));
    // Mira visível (~0,25 ms cada no interpretador): nunca passa do teto por tick, e o teto chega a ser usado.
    expect(maxAims).toBe(AI_SOLDIER.visibleAimPerTick);
    expect(prev.pathsServed).toBeGreaterThan(48);
    // Teve tiroteio, e os bots também atiram nos zumbis (48 fuzis seguram a horda antes do corpo a corpo).
    expect(kills).toBeGreaterThan(5);
    expect(zombieDeaths).toBeGreaterThan(5);
    match.dispose();
  }, 60_000);
});

describe('zumbis', () => {
  it('perseguem pela rota (contornando o muro) e matam no corpo a corpo', () => {
    const map = twoRooms(true);
    const r = recipe([{ humans: 1, bots: [] }]);
    const zmap: SimMap = {
      ...map,
      // Humano ao sul; os zumbis nascem ao norte (o ponto de qualquer time mais longe dele).
      spawns: [map.spawns[0]!, { ...map.spawns[1]!, team: -1 }],
    };
    let zombieKill = false;
    let melees = 0;
    const match = createHeadlessMatch({
      recipe: r,
      map: zmap,
      humans: 1,
      zombies: 3,
      paths: TEST_NAV_PATHS,
      onEvents: (events) => {
        for (const ev of events) {
          if (ev.type === 'melee') melees++;
          if (ev.type === 'kill' && entityIndex(ev.killer) >= 1) zombieKill = true;
        }
      },
    });
    const z0 = match.sim.controllerEntity(ZOMBIE_CONTROLLER_BASE);
    expect(match.sim.view().position[entityIndex(z0) * 3 + 2]).toBe(10);
    for (let t = 0; t < 30 * SIM_HZ && !zombieKill; t++) match.step();
    expect(melees).toBeGreaterThan(3);
    expect(zombieKill).toBe(true);
    match.dispose();
  });

  it('mesma receita e mesmos zumbis: mesmo hash (determinístico)', () => {
    const hash = (): number => {
      const match = createHeadlessMatch({
        recipe: recipe([
          { humans: 1, bots: [{ ref: builtinBotRef('chill'), count: 2 }] },
          { bots: [{ ref: builtinBotRef('normal'), count: 2 }] },
        ]),
        map: twoRooms(true),
        humans: 1,
        zombies: 6,
        paths: TEST_NAV_PATHS,
      });
      match.run(900);
      const h = match.sim.stateHash();
      match.dispose();
      return h;
    };
    expect(hash()).toBe(hash());
  });
});

describe('LOD e fila de caminhos', () => {
  it('LOD A perto de um humano (ou sem humanos), B longe', () => {
    const map = twoRooms(false);
    const r = recipe([{ humans: 1, bots: [] }, { bots: [{ ref: builtinBotRef('normal'), count: 1 }] }]);
    const sim = createSim({ recipe: r, map, humans: 1 });
    const ctx = new AiContext(SIM_HZ, false, 100, new PathService(TEST_NAV_PATHS, []));
    ctx.begin(sim.view());
    expect(ctx.observerCount).toBe(1);
    const [hx, hz] = [map.spawns[0]!.x, map.spawns[0]!.z];
    expect(ctx.nearObserver(hx + AI_LOD.nearM - 1, hz)).toBe(true);
    expect(ctx.nearObserver(hx, hz + AI_LOD.nearM + 1)).toBe(false);
    const solo = createSim({
      recipe: recipe([{ bots: [{ ref: builtinBotRef('normal'), count: 2 }] }]),
      map,
      humans: 0,
    });
    ctx.begin(solo.view());
    expect(ctx.observerCount).toBe(0);
    expect(ctx.nearObserver(1000, 1000)).toBe(true);
  });

  it('o A* fatiado continua entre ticks e a rota é copiada para o agente; sem caminho marca falha', () => {
    const map = twoRooms(true);
    const nav = map.nav!;
    const followers = [new PathFollower(0), new PathFollower(1)];
    const paths = new PathService(TEST_NAV_PATHS, followers);
    paths.bind(nav);
    const [a, b] = followers as [PathFollower, PathFollower];
    // De um canto do norte até o sul, contornando o muro.
    paths.want(a, 1.5, 0.5, 5, 2, 0.5, 35, 0, 0);
    expect(a.queued).toBe(true);
    // Objetivo fora do mapa navegável (no alto do muro não há nó): falha na hora, sem A*.
    paths.want(b, 1.5, 0.5, 5, 1000, 0.5, 1000, 0, 0);
    expect(b.failed).toBe(true);
    expect(b.queued).toBe(false);
    let ticks = 0;
    while (!a.hasRoute && ticks < 50) {
      paths.service();
      ticks++;
    }
    expect(a.hasRoute).toBe(true);
    expect(a.count).toBeGreaterThan(2);
    // A rota passa pela passagem do leste (x ≥ 16 m) perto do muro (z = 20 m).
    let throughGap = false;
    for (let i = 0; i < a.count; i++) {
      const x = a.points[i * 3]!;
      const z = a.points[i * 3 + 2]!;
      if (x >= 15.5 && z > 17 && z < 23) throughGap = true;
    }
    expect(throughGap).toBe(true);
    expect(createBotDirectorWithPaths).toBeTypeOf('function');
  });
});

describe('frames e controladores', () => {
  it('o diretor escreve os frames dos zumbis nos controladores 68.. e exige frames suficientes', () => {
    const r = recipe([{ humans: 1, bots: [] }]);
    const map = twoRooms(true);
    const sim = createSim({ recipe: r, map, humans: 1, zombies: 2 });
    const dir = createBotDirectorWithPaths({ recipe: r, humans: 1, zombies: 2 }, TEST_NAV_PATHS);
    const frames = createInputFrames();
    for (let t = 0; t < 30; t++) {
      dir.think(sim.view(), frames);
      sim.step(frames);
    }
    expect(frames[ZOMBIE_CONTROLLER_BASE]!.seq).toBeGreaterThan(0);
    expect(frames[ZOMBIE_CONTROLLER_BASE + 1]!.seq).toBeGreaterThan(0);
    expect(frames[ZOMBIE_CONTROLLER_BASE + 2]!.seq).toBe(0);
    expect(dir.botCount).toBe(0);
    expect(() => dir.think(sim.view(), frames.slice(0, ZOMBIE_CONTROLLER_BASE + 1))).toThrow();
  });
});
