import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, type InputFrame } from '@boboforces/input';
import { buildNavGrid, createNavPath, findPath, type NavGrid } from '@boboforces/nav';
import { yawToU16 } from '@boboforces/shared';
import { BOBO_NAV_METRICS, ENTITY_FLAG, ENTITY_KIND, SIM_HZ, type Sim, type SimMap } from '@boboforces/sim';
import { createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { AI_PATH } from './config.ts';
import { createHeadlessMatch } from './headless.ts';
import { createSteer, NAV_PATH_API, PathFollower, PathService } from './paths.ts';

/**
 * M10 (fase 1c): o seguidor de rota num lance RETO de escada mais alto que `AI_PATH.fellM`. O suavizador junta o lance
 * num segmento só (pé → topo); o seguidor achava que o bot tinha caído (pés bem abaixo do ponto de chegada) assim que
 * ele chegava no pé, largava a rota e pedia a mesma de novo, para sempre (a torre de 5 m do Construto).
 */

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);

/** Uma rota escrita à mão: pontos (x, y, z) dos pés. */
function routeOf(f: PathFollower, points: readonly (readonly [number, number, number])[]): void {
  points.forEach(([x, y, z], i) => {
    f.points[i * 3] = x;
    f.points[i * 3 + 1] = y;
    f.points[i * 3 + 2] = z;
    f.links[i] = 0;
  });
  f.count = points.length;
  f.index = 1;
  f.hasRoute = true;
}

describe('seguidor de rota: "caiu" é abaixo da ponta mais baixa do segmento', () => {
  it('no pé de um lance reto de 5 m, segue para o topo; abaixo de um segmento plano lá em cima, larga a rota', () => {
    const f = new PathFollower(0);
    const service = new PathService(NAV_PATH_API, [f]);
    const steer = createSteer();
    // Térreo (1 m) → pé do lance → topo a 6 m, 5 m adiante em z → plano no topo.
    const route = [
      [2.5, 1, 2.5],
      [2.5, 1, 6.5],
      [2.5, 6, 11.5],
      [8.5, 6, 11.5],
    ] as const;
    routeOf(f, route);
    // No pé do lance (o ponto 1 fica para trás): segue para o topo, sem largar a rota.
    expect(service.steer(f, 2.5, 1, 6.5, true, steer)).toBe(true);
    expect(f.index).toBe(2);
    expect(f.hasRoute).toBe(true);
    expect(steer.z).toBeCloseTo(1, 5);
    // No meio do lance, também.
    expect(service.steer(f, 2.5, 3.5, 9, true, steer)).toBe(true);
    // No topo, andando no plano: cair de lá para o térreo larga a rota (o bot pede outra).
    routeOf(f, route);
    f.index = 3;
    expect(service.steer(f, 5, 6, 11.5, true, steer)).toBe(true);
    expect(service.steer(f, 5, 6 - AI_PATH.fellM - 0.1, 11.5, false, steer)).toBe(false);
    expect(f.hasRoute).toBe(false);
  });
});

/**
 * Térreo de concreto (piso a 0,5 m) e um lance reto de degraus de cubo (0,5 m por 0,5 m, como a escada do `mapc`)
 * subindo `riseM` em +Z até um deque de 9 × 6 m. O deque só se alcança pela escada (as laterais têm `riseM` de parede).
 */
function stairsMap(riseM: number): { map: SimMap; deckY: number; deckZ: number } {
  const steps = Math.round(riseM / 0.5);
  const grid = createWorldGrid(48, 24, 64);
  fillBox(grid, 0, 0, 0, 47, 0, 63, concrete);
  const z0 = 20;
  for (let t = 0; t < steps; t++) fillBox(grid, 20, 1, z0 + t, 25, 1 + t, z0 + t, concrete);
  fillBox(grid, 14, 1, z0 + steps, 31, steps, z0 + steps + 11, concrete);
  const map: SimMap = {
    grid,
    blocks,
    spawns: [
      { x: 11.5, y: 0.5, z: 3.5, yaw: Math.PI, team: 0 },
      { x: 20.5, y: 0.5, z: 3.5, yaw: Math.PI, team: 1 },
    ],
    nav: buildNavGrid({ grid, blocks }, BOBO_NAV_METRICS),
  };
  return { map, deckY: 0.5 + riseM, deckZ: (z0 + steps + 6) * 0.5 };
}

/** Maior subida entre dois pontos seguidos da rota suavizada de (a) a (b). */
function maxSegmentRise(nav: NavGrid, a: readonly number[], b: readonly number[]): number {
  const path = createNavPath(nav, 256);
  const from = nav.nearestNode(a[0]!, a[1]!, a[2]!);
  const to = nav.nearestNode(b[0]!, b[1]!, b[2]!);
  let status = findPath(nav, from, to, path, 100_000);
  while (status === 'pending') status = findPath(nav, from, to, path, 100_000);
  expect(status).toBe('found');
  let rise = 0;
  for (let i = 1; i < path.pointCount; i++) rise = Math.max(rise, path.points[i * 3 + 1]! - path.points[i * 3 - 2]!);
  return rise;
}

/** Um humano guiado pelo `PathService` de verdade até (gx, gy, gz): quando chegou (s) e quantas vezes largou a rota. */
function follow(map: SimMap, gx: number, gy: number, gz: number, maxS: number) {
  const f = new PathFollower(0);
  const service = new PathService(NAV_PATH_API, [f]);
  service.bind(map.nav ?? null);
  const steer = createSteer();
  const recipe: MatchRecipe = {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'test',
    seed: 1,
    match: { timeLimitS: 0 },
    teams: [{ humans: 1, bots: [] }, { bots: [] }],
  };
  let tick = 0;
  let me = -1;
  let reachedS = Infinity;
  let drops = 0;
  const match = createHeadlessMatch({
    recipe,
    map,
    humans: 1,
    writeHumans: (frames: InputFrame[], sim: Sim) => {
      const v = sim.view();
      if (me < 0) for (let e = 0; e < v.count; e++) if (v.kind[e] === ENTITY_KIND.bobo) me = e;
      const x = v.position[me * 3]!;
      const y = v.position[me * 3 + 1]!;
      const z = v.position[me * 3 + 2]!;
      if (reachedS === Infinity && Math.hypot(x - gx, z - gz) < 1.5 && Math.abs(y - gy) < 0.3) reachedS = tick / SIM_HZ;
      service.want(f, x, y, z, gx, gy, gz, tick, 30);
      service.service();
      const frame = frames[0]!;
      frame.moveX = 0;
      frame.moveY = 0;
      frame.buttons = 0;
      const before = f.hasRoute;
      const ok = service.steer(f, x, y, z, (v.flags[me]! & ENTITY_FLAG.onGround) !== 0, steer);
      if (before && !ok && !f.arrived) drops++;
      if (ok) {
        frame.yaw = yawToU16(Math.atan2(-steer.x, -steer.z));
        frame.moveY = 127;
        if (steer.jump) frame.buttons |= BUTTON.jump;
      }
      tick++;
    },
  });
  for (let t = 0; t < maxS * SIM_HZ && reachedS === Infinity; t++) match.step();
  match.dispose();
  return { reachedS, drops };
}

describe('bot sobe lance reto de escada', () => {
  it.each([3, 4, 5])(
    'lance de %d m: a rota tem o lance num segmento só e o seguidor chega no topo sem largar',
    (rise) => {
      const { map, deckY, deckZ } = stairsMap(rise);
      // O caso do bug: um segmento da rota sobe mais que `fellM`.
      expect(maxSegmentRise(map.nav!, [11.5, 0.5, 3.5], [11.5, deckY, deckZ])).toBeGreaterThan(AI_PATH.fellM);
      const r = follow(map, 11.5, deckY, deckZ, 20);
      expect(r.drops).toBe(0);
      expect(r.reachedS).toBeLessThan(12);
    },
  );
});
