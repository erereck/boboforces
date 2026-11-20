import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe, type ModifierId } from '@boboforces/format';
import { buildNavGrid } from '@boboforces/nav';
import {
  BOBO_NAV_METRICS,
  chaosScaleOf,
  entityIndex,
  GIANT_EYE_CEILING_GAP_M,
  viewAimPoint,
  viewEyeHeight,
  type AimPoint,
  type SimEvent,
  type SimMap,
} from '@boboforces/sim';
import { buildSyntheticConstruto, TEST_NAV_PATHS } from '@boboforces/sim/testing';
import {
  BLOCK_FLAG,
  cellCenter,
  createRayHit,
  createTestBlocks,
  createWorldGrid,
  fillBox,
  makeCell,
  raycastGrid,
} from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { createHeadlessMatch } from './headless.ts';

/**
 * M9 (fase 1): o Mini, os Bots gigantes e o Ricochete numa partida só de bots (4 contra 4 no Construto sintético, 40 s):
 * vai até o fim, os bots abatem uns aos outros com o tamanho novo e duas rodadas dão o mesmo hash.
 */
function run(id: ModifierId): { hash: number; kills: number; ricochets: number; scales: number[]; phase: string } {
  const { map } = buildSyntheticConstruto({ nav: true });
  const normal = builtinBotRef('normal');
  const recipe: MatchRecipe = {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'test',
    seed: 13,
    match: { timeLimitS: 40, scoreLimit: 0 },
    modifiers: [id],
    teams: [{ bots: [{ ref: normal, count: 4 }] }, { bots: [{ ref: builtinBotRef('sweaty'), count: 4 }] }],
  };
  let kills = 0;
  let ricochets = 0;
  const m = createHeadlessMatch({
    recipe,
    map,
    humans: 0,
    paths: TEST_NAV_PATHS,
    onEvents: (events: readonly SimEvent[]) => {
      for (const ev of events) {
        if (ev.type === 'kill') kills++;
        else if (ev.type === 'ricochet') ricochets++;
      }
    },
  });
  for (let t = 0; t < 45 * 60 && m.sim.view().match.phase !== 'ended'; t++) m.step();
  const v = m.sim.view();
  const scales: number[] = [];
  for (let c = 4; c < 12; c++) scales.push(chaosScaleOf(v, entityIndex(m.sim.controllerEntity(c))));
  const out = { hash: m.sim.stateHash(), kills, ricochets, scales, phase: v.match.phase };
  m.dispose();
  return out;
}

describe('Mini, Bots gigantes e Ricochete com bots (M9 fase 1)', () => {
  for (const [id, scale] of [
    ['mini', 0.5],
    ['giantBots', 3],
    ['ricochet', 1],
  ] as const) {
    it(`${id}: a partida vai até o fim, com abates, e repete o hash`, () => {
      const a = run(id);
      const b = run(id);
      expect(a.phase).toBe('ended');
      expect(a.kills, `${id}: ${a.kills} abates`).toBeGreaterThan(3);
      expect(a.scales).toEqual(Array.from({ length: 8 }, () => scale));
      if (id === 'ricochet') expect(a.ricochets).toBeGreaterThan(0);
      else expect(a.ricochets).toBe(0);
      expect(b.hash).toEqual(a.hash);
      expect(b.kills).toBe(a.kills);
    }, 120_000);
  }
});

/**
 * Revisão da fase 1: dois bots gigantes (1 Normal por time, a 15 m) num salão de teto a 3 m (a laje de 3,0 a 3,5 m
 * cobre o mapa todo), com a navegação de verdade. Antes, a cabeça (4,6 m) e o peito (2,95 m) em escala ficavam dentro
 * ou acima do teto: nenhum raio de visão passava e ninguém atirava em 40 s.
 */
function roomDuel(roof: boolean): { shots: number; hits: number; kills: number; capped: boolean[]; clear: boolean[] } {
  const blocks = createTestBlocks();
  const concrete = makeCell(blocks.byKey('concrete')!.id);
  const grid = createWorldGrid(40, 16, 80);
  fillBox(grid, 0, 0, 0, 39, 0, 79, concrete);
  if (roof) fillBox(grid, 0, 6, 0, 39, 6, 79, concrete);
  const map: SimMap = {
    grid,
    blocks,
    spawns: [
      { x: cellCenter(20), y: 0.5, z: cellCenter(25), yaw: 0, team: 0 },
      { x: cellCenter(20), y: 0.5, z: cellCenter(55), yaw: Math.PI, team: 1 },
    ],
    nav: buildNavGrid({ grid, blocks }, BOBO_NAV_METRICS),
  };
  const normal = builtinBotRef('normal');
  const recipe: MatchRecipe = {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'test',
    seed: 9,
    match: { timeLimitS: 0, scoreLimit: 0 },
    modifiers: ['giantBots'],
    teams: [{ bots: [{ ref: normal, count: 1 }] }, { bots: [{ ref: normal, count: 1 }] }],
  };
  let shots = 0;
  let hits = 0;
  let kills = 0;
  const m = createHeadlessMatch({
    recipe,
    map,
    humans: 0,
    onEvents: (events: readonly SimEvent[]) => {
      for (const ev of events) {
        if (ev.type === 'shot') shots++;
        else if (ev.type === 'hit') hits++;
        else if (ev.type === 'kill') kills++;
      }
    },
  });
  m.step();
  // Os pontos da cabeça e do peito do bot do time 1, e a visão do olho do bot do time 0 até eles.
  const v = m.sim.view();
  const a = entityIndex(m.sim.controllerEntity(4));
  const b = entityIndex(m.sim.controllerEntity(5));
  const p: AimPoint = { x: 0, y: 0, z: 0 };
  const hit = createRayHit();
  const ex = v.position[a * 3]!;
  const ey = v.position[a * 3 + 1]! + viewEyeHeight(v, a, v.flags[a]!);
  const ez = v.position[a * 3 + 2]!;
  const capped: boolean[] = [];
  const clear: boolean[] = [];
  for (const head of [true, false]) {
    capped.push(viewAimPoint(v, b, head, p));
    if (roof) expect(p.y).toBeCloseTo(3 - GIANT_EYE_CEILING_GAP_M, 9);
    const dx = p.x - ex;
    const dy = p.y - ey;
    const dz = p.z - ez;
    const d = Math.hypot(dx, dy, dz);
    clear.push(!raycastGrid(v.world, v.blocks, ex, ey, ez, dx / d, dy / d, dz / d, d, BLOCK_FLAG.blocksSight, hit));
  }
  for (let t = 0; t < 40 * 60; t++) m.step();
  m.dispose();
  return { shots, hits, kills, capped, clear };
}

describe('revisão da fase 1: os gigantes debaixo de teto', () => {
  it('embaixo da laje de 3 m os dois se veem, atiram e se acertam (o ponto de mira fica 10 cm abaixo do teto)', () => {
    const indoor = roomDuel(true);
    expect(indoor.capped).toEqual([true, true]);
    expect(indoor.clear).toEqual([true, true]);
    expect(indoor.shots, `${indoor.shots} tiros`).toBeGreaterThan(20);
    expect(indoor.hits).toBeGreaterThan(5);
    expect(indoor.kills).toBeGreaterThan(0);
    // A céu aberto, o ponto do gigante é o de sempre (em escala, sem corte).
    const outdoor = roomDuel(false);
    expect(outdoor.capped).toEqual([false, false]);
    expect(outdoor.clear).toEqual([true, true]);
    expect(outdoor.kills).toBeGreaterThan(0);
  }, 60_000);
});
