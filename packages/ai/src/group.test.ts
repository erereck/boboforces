import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { angleDelta, yawToU16 } from '@boboforces/shared';
import { BOBO_NAV_METRICS, ENTITY_FLAG, ENTITY_KIND, SIM_HZ, type SimMap } from '@boboforces/sim';
import { buildTestNav, TEST_NAV_PATHS } from '@boboforces/sim/testing';
import { createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { AI_GROUP, zombieRingAngle } from './group.ts';
import { createHeadlessMatch } from './headless.ts';

/** M12 (fase 7b): os zumbis cercam (o anel de vagas em volta do alvo). */

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);

describe('o cerco dos zumbis (M12, fase 7b)', () => {
  it('as 5 vagas do anel: ±0,9 rad em volta do ângulo de chegada, pelo índice', () => {
    const offsets = [0, 1, 2, 3, 4, 5].map((i) => zombieRingAngle(1, i) - 1);
    expect(offsets.map((o) => +o.toFixed(6))).toEqual([-0.9, -0.45, 0, 0.45, 0.9, -0.9]);
    expect(AI_GROUP.zombieRingM).toBe(0.9);
  });

  it('revisão: o zumbi alcança e golpeia quem recua em linha reta (não freia atrás da vaga)', () => {
    // Campo de 40 × 200 m; o humano (que não morre) recua para o sul olhando para os zumbis; golpes de 6 a 20 s.
    const grid = createWorldGrid(80, 8, 400);
    fillBox(grid, 0, 0, 0, 79, 0, 399, concrete);
    const nav = buildTestNav({ grid, blocks }, BOBO_NAV_METRICS);
    const hits = (moveY: number, zombies: number): number => {
      const map: SimMap = {
        grid,
        blocks,
        spawns: [
          { x: 20.25, y: 0.5, z: 20, yaw: Math.PI, team: 0 },
          { x: 20.25, y: 0.5, z: 14, yaw: Math.PI, team: -1 },
        ],
        nav,
      };
      const recipe: MatchRecipe = {
        format: MATCH_RECIPE_FORMAT,
        mode: 'warfare.tdm',
        map: 'test',
        seed: 3,
        players: { hp: 1_000_000 },
        match: { timeLimitS: 0 },
        teams: [{ humans: 1, bots: [] }],
      };
      let t = 0;
      let n = 0;
      const m = createHeadlessMatch({
        recipe,
        map,
        humans: 1,
        zombies,
        paths: TEST_NAV_PATHS,
        writeHumans: (f) => {
          f[0]!.moveY = moveY;
          f[0]!.yaw = yawToU16(Math.PI);
        },
        onEvents: (events, sim) => {
          const h = sim.controllerEntity(0);
          for (const ev of events) if (ev.type === 'hit' && ev.target === h && t >= 6 * SIM_HZ) n++;
        },
      });
      for (; t < 20 * SIM_HZ; t++) m.step();
      m.dispose();
      return n;
    };
    // 1 zumbi atrás de quem recua a ~2,7 m/s: 12 golpes (indo reto ao centro, como antes do cerco, 12; freando perto
    // da vaga, como na 1ª versão, 0). 3 zumbis a ~2,5 m/s: 38 (reto 27; freando 14).
    expect(hits(72, 1)).toBeGreaterThanOrEqual(8);
    expect(hits(66, 3)).toBeGreaterThanOrEqual(30);
  }, 60_000);

  it('5 zumbis atrás de um humano que anda se abrem dos lados dele (não fazem fila)', () => {
    // Campo de 40 × 40 m; o humano (que não morre) anda devagar para o sul (+Z); os zumbis nascem 8 m atrás, juntos.
    const grid = createWorldGrid(80, 8, 80);
    fillBox(grid, 0, 0, 0, 79, 0, 79, concrete);
    const map: SimMap = {
      grid,
      blocks,
      spawns: [
        { x: 20.25, y: 0.5, z: 30, yaw: Math.PI, team: 0 },
        { x: 20.25, y: 0.5, z: 22, yaw: Math.PI, team: -1 },
      ],
      nav: buildTestNav({ grid, blocks }, BOBO_NAV_METRICS),
    };
    const recipe: MatchRecipe = {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.tdm',
      map: 'test',
      seed: 3,
      players: { hp: 100_000 },
      teams: [{ humans: 1, bots: [] }],
    };
    const match = createHeadlessMatch({
      recipe,
      map,
      humans: 1,
      zombies: 5,
      paths: TEST_NAV_PATHS,
      writeHumans: (f) => {
        f[0]!.moveY = 50;
      },
    });
    const h = match.sim.controllerEntity(0) & 0xffff;
    const v = match.sim.view();
    // De 5 a 10 s: a soma do afastamento para os lados (X) dos zumbis a até 3 m do humano, por tick.
    let side = 0;
    let samples = 0;
    for (let t = 0; t < 10 * SIM_HZ; t++) {
      match.step();
      if (t < 5 * SIM_HZ) continue;
      samples++;
      for (let e = 0; e < v.count; e++) {
        if (v.kind[e] !== ENTITY_KIND.zombie) continue;
        const dx = v.position[e * 3]! - v.position[h * 3]!;
        const dz = v.position[e * 3 + 2]! - v.position[h * 3 + 2]!;
        if (Math.hypot(dx, dz) <= 3) side += Math.abs(dx);
      }
    }
    const angles: number[] = [];
    for (let e = 0; e < v.count; e++) {
      if (v.kind[e] !== ENTITY_KIND.zombie || v.alive[e] !== 1 || (v.flags[e]! & ENTITY_FLAG.dead) !== 0) continue;
      const dx = v.position[e * 3]! - v.position[h * 3]!;
      const dz = v.position[e * 3 + 2]! - v.position[h * 3 + 2]!;
      if (Math.hypot(dx, dz) < 2.5) angles.push(Math.atan2(dx, dz));
    }
    match.dispose();
    let spread = 0;
    for (const a of angles) for (const b of angles) spread = Math.max(spread, Math.abs(angleDelta(a, b)));
    // Nesta semente: 3,39 m por tick para os lados e 127° entre os das pontas; indo reto ao centro (antes), 2,29 m e
    // 95° (a fila atrás de quem anda).
    expect(angles.length).toBe(5);
    expect(side / samples).toBeGreaterThan(2.8);
    expect(spread).toBeGreaterThan(1.9);
  }, 30_000);
});
