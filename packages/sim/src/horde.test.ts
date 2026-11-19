import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON } from '@boboforces/input';
import { buildNavGrid, createNavPath, findPath } from '@boboforces/nav';
import { BitReader, BitWriter, pitchToI16, yawToU16 } from '@boboforces/shared';
import { BLOCK_FLAG, cellCenter, createBlockRegistry, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { METRICS } from './config/metrics.ts';
import { BOBO_NAV_METRICS } from './config/nav-metrics.ts';
import { HORDE, hordeInWave, hordeMaxAlive, ZOMBIE_POINTS } from './config/zombie.ts';
import { BOT_CONTROLLER_BASE, SIM_HZ } from './constants.ts';
import { ENTITY_FLAG, ENTITY_KIND } from './entity.ts';
import { aimPointWorld, type AimPoint } from './hitbox.ts';
import { createInputFrames } from './loop.ts';
import type { BarricadeDef } from './map-objects.ts';
import { createSim, type Sim, type SimMap, type SpawnPoint } from './sim.ts';

/**
 * M6 (fase 6b): a Horda armada na sim. O mapa das barricadas (muro de 3 m em z = 15..15,5 m com um vão de 1 m em
 * x = 10..11 m): o humano dentro, o ponto dos zumbis fora. A horda são os 4 bots do time 1 (sem a IA aqui).
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
const inside: SpawnPoint = { x: GAP_X, y: FLOOR, z: 10, yaw: Math.PI, team: 0 };
const outside: SpawnPoint = { x: cellCenter(20), y: FLOOR, z: 26, yaw: 0, team: -1 };
const POOL = 4;

function walledMap(): SimMap {
  const grid = createWorldGrid(40, 16, 60);
  fillBox(grid, 0, 0, 0, 39, 0, 59, concrete);
  fillBox(grid, 0, 1, 30, 19, 6, 30, concrete);
  fillBox(grid, 22, 1, 30, 39, 6, 30, concrete);
  return {
    grid,
    blocks,
    spawns: [inside, outside],
    nav: buildNavGrid({ grid, blocks }, BOBO_NAV_METRICS),
    barricades: [WINDOW],
  };
}

const recipe: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'zombies',
  map: 'test',
  seed: 7,
  zombies: { variant: 'armed' },
  teams: [{ humans: 'all', bots: [] }, { bots: [{ ref: 'builtin:normal-bob', count: POOL }] }],
};

const DEAD = ENTITY_FLAG.dead;
const hordeOf = (sim: Sim): number[] =>
  Array.from({ length: POOL }, (_, i) => sim.controllerEntity(BOT_CONTROLLER_BASE + i) & 0xffff);
const livingCount = (sim: Sim, horde: readonly number[]): number =>
  horde.filter((e) => (sim.view().flags[e]! & DEAD) === 0).length;

describe('Bobo Zombies: Horda armada na sim (M6 fase 6b)', () => {
  it('a horda são os soldados do time 1: fora de jogo no começo, entram pela onda e passam pela janela aberta', () => {
    const map = walledMap();
    const sim = createSim({ recipe, map, humans: 1 });
    const v = sim.view();
    const h = sim.controllerEntity(0) & 0xffff;
    const horde = hordeOf(sim);
    // Sem zumbi nenhum (o pool fica vazio); os soldados do time 1 começam mortos e sem pontos.
    let zombies = 0;
    for (let e = 0; e < v.count; e++) if (v.alive[e] === 1 && v.kind[e] === ENTITY_KIND.zombie) zombies++;
    expect(zombies).toBe(0);
    for (const e of horde) {
      expect(v.team[e]).toBe(1);
      expect(v.flags[e]! & DEAD).not.toBe(0);
      expect(v.points[e]).toBe(0);
    }
    expect(v.points[h]).toBe(ZOMBIE_POINTS.start);
    // A janela é um vão aberto: sem tábua, e a navegação dos bobos passa por ela.
    expect(v.mapObjects!.planks[0]).toBe(0);
    const nav = map.nav!;
    const path = findPath(
      nav,
      nav.nearestNode(GAP_X, FLOOR, 10),
      nav.nearestNode(GAP_X, FLOOR, 22),
      createNavPath(nav),
      1e6,
    );
    expect(path).not.toBe('unreachable');

    // A 1ª onda: o total e o teto em jogo da horda.
    const f = createInputFrames();
    for (let t = 0; t < 10 * SIM_HZ && v.match.zombieWave === 0; t++) sim.step(f);
    expect(v.match.zombieWave).toBe(1);
    expect(v.match.zombiesLeft).toBe(hordeInWave(1, 1, 1));
    let most = 0;
    for (let t = 0; t < 8 * SIM_HZ; t++) {
      sim.step(f);
      most = Math.max(most, livingCount(sim, horde));
    }
    expect(most).toBe(hordeMaxAlive(1, 1, POOL));
    const first = horde.find((e) => (v.flags[e]! & DEAD) === 0)!;
    const wave1Hp = v.health[first]!;
    expect(wave1Hp).toBeGreaterThan(0);
    // Todos com primária da horda liberada na onda 1 (as 2 primeiras).
    for (const e of horde) {
      if ((v.flags[e]! & DEAD) === 0) expect(HORDE.primaries.slice(0, 2)).toContain(v.weapon[e]);
    }

    // Um soldado atravessa a janela andando (o vão não segura bobo na Horda armada).
    const walker = first;
    const bf = f[BOT_CONTROLLER_BASE + horde.indexOf(walker)]!;
    for (let t = 0; t < 6 * SIM_HZ && v.position[walker * 3 + 2]! > WALL_Z - 1; t++) {
      const x = v.position[walker * 3]!;
      const z = v.position[walker * 3 + 2]!;
      bf.yaw = yawToU16(Math.atan2(-(GAP_X - x), -(WALL_Z - 2 - z)));
      bf.moveY = 127;
      sim.step(f);
    }
    bf.moveY = 0;
    expect(v.position[walker * 3 + 2]).toBeLessThan(WALL_Z - 1);

    // O humano derruba o soldado: pontos do acerto e do abate; ele morre (não cai como o bobo do time dos humanos).
    const points0 = v.points[h]!;
    const aim: AimPoint = { x: 0, y: 0, z: 0 };
    for (let t = 0; t < 6 * SIM_HZ && (v.flags[walker]! & DEAD) === 0; t++) {
      aimPointWorld(v, walker, false, aim);
      const dx = aim.x - v.position[h * 3]!;
      const dy = aim.y - (v.position[h * 3 + 1]! + METRICS.eyeHeight);
      const dz = aim.z - v.position[h * 3 + 2]!;
      f[0]!.yaw = yawToU16(Math.atan2(-dx, -dz));
      f[0]!.pitch = pitchToI16(Math.atan2(dy, Math.hypot(dx, dz)));
      f[0]!.buttons = t % 2 === 0 ? BUTTON.fire : 0;
      sim.step(f);
    }
    f[0]!.buttons = 0;
    expect(v.flags[walker]! & DEAD).not.toBe(0);
    expect(v.flags[walker]! & ENTITY_FLAG.downed).toBe(0);
    expect(v.points[h]!).toBeGreaterThanOrEqual(points0 + ZOMBIE_POINTS.hit + ZOMBIE_POINTS.kill);

    // Snapshot: os soldados fora de jogo e a onda vão juntos (e o hash).
    const copy = createSim({ recipe, map: walledMap(), humans: 1 });
    const w = new BitWriter(256 * 1024);
    sim.writeSnapshot(w);
    copy.readSnapshot(new BitReader(w.bytes()));
    expect(copy.stateHash()).toEqual(sim.stateHash());
    copy.dispose();

    // O resto da onda cai no vazio (o diretor segue soltando até o total); depois do intervalo, a 2ª onda é maior e
    // com mais vida.
    for (let t = 0; t < 60 * SIM_HZ && v.match.zombieWave < 2; t++) {
      for (const e of horde) if ((v.flags[e]! & DEAD) === 0) v.position[e * 3 + 1] = -100;
      sim.step(f);
    }
    expect(v.match.zombieWave).toBe(2);
    expect(v.match.zombiesLeft).toBe(hordeInWave(2, 1, 1));
    for (let t = 0; t < 4 * SIM_HZ && livingCount(sim, horde) === 0; t++) sim.step(f);
    const second = horde.find((e) => (v.flags[e]! & DEAD) === 0)!;
    expect(v.health[second]).toBe(Math.round(wave1Hp * 1.1));
    expect(v.match.phase).toBe('playing');
    sim.dispose();
  });
});

describe('Bobo Zombies: Horda armada, portas e sem horda (M6 fase 6b, revisão)', () => {
  it('a porta paga abre com as janelas abertas; sem bot no time 1 a onda passa', () => {
    // A porta fecha o vão do muro (sem janela): com pontos, o usar abre.
    const map: SimMap = {
      ...walledMap(),
      barricades: [],
      doors: [{ minX: 10, minY: FLOOR, minZ: 15, maxX: 11, maxY: FLOOR + 2.5, maxZ: 15.5, cost: 750 }],
    };
    const near: SpawnPoint = { ...inside, z: WALL_Z - 0.9 };
    const sim = createSim({ recipe, map: { ...map, spawns: [near, outside] }, humans: 1 });
    const v = sim.view();
    const h = sim.controllerEntity(0) & 0xffff;
    (v.points as Int32Array)[h] = 1000;
    const f = createInputFrames();
    f[0]!.yaw = yawToU16(Math.PI);
    f[0]!.buttons = BUTTON.use;
    sim.step(f);
    expect(v.mapObjects!.doorOpen[0]).toBe(1);
    expect(v.points[h]).toBe(250);
    sim.dispose();

    // A receita sem a horda (o time 1 vazio): a onda não trava em "N soldados".
    const lone: MatchRecipe = { ...recipe, teams: [{ humans: 'all', bots: [] }] };
    const solo = createSim({ recipe: lone, map: walledMap(), humans: 1 });
    const g = createInputFrames();
    const sv = solo.view();
    for (let t = 0; t < 30 * SIM_HZ && sv.match.zombieWave < 2; t++) solo.step(g);
    expect(sv.match.zombieWave).toBe(2);
    solo.dispose();
  });
});
