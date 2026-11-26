import { MATCH_RECIPE_FORMAT, type MatchRecipe, type ModifierId } from '@boboforces/format';
import { BUTTON } from '@boboforces/input';
import { cellCenter, createTestBlocks, createWorldGrid, fillBox, makeCell, type MapSpawn } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { SIM_HZ } from './constants.ts';
import { entityIndex } from './entity.ts';
import { createInputFrames } from './loop.ts';
import { createSim, type Sim, type SimMap } from './sim.ts';
import { CHAOS_MODS, mapGravityLevels, MOD } from './systems/chaos.ts';

/**
 * M10 (fase 4): a gravidade de série do mapa (`SimMap.gravity`, a Estação Lunar com a da Lua em todo modo, pergunta
 * AK3). Dois humanos num chão plano (o mesmo arranjo do `chaos.test.ts`) e, para a queda, uma torre de 8 m.
 */
const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);

function flatMap(gravity?: number): SimMap {
  const grid = createWorldGrid(40, 16, 80);
  fillBox(grid, 0, 0, 0, 39, 0, 79, concrete);
  const spawns: MapSpawn[] = [
    { x: cellCenter(20), y: 0.5, z: cellCenter(40), yaw: 0, team: 0 },
    { x: cellCenter(20), y: 0.5, z: cellCenter(24), yaw: Math.PI, team: 1 },
  ];
  return { grid, blocks, spawns, ...(gravity !== undefined ? { gravity } : {}) };
}

/** Torre de 8 m (16 células) na metade z ≥ 40; o humano 0 nasce na beirada, olhando para o vão (-Z). */
function towerMap(gravity?: number): SimMap {
  const grid = createWorldGrid(40, 24, 80);
  fillBox(grid, 0, 0, 0, 39, 0, 79, concrete);
  fillBox(grid, 0, 1, 40, 39, 16, 79, concrete);
  const spawns: MapSpawn[] = [
    { x: cellCenter(20), y: 8.5, z: cellCenter(41), yaw: 0, team: 0 },
    { x: cellCenter(20), y: 0.5, z: cellCenter(10), yaw: Math.PI, team: 1 },
  ];
  return { grid, blocks, spawns, ...(gravity !== undefined ? { gravity } : {}) };
}

function recipe(extra: Partial<MatchRecipe> = {}): MatchRecipe {
  return {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'test',
    seed: 9,
    match: { timeLimitS: 0, scoreLimit: 0 },
    teams: [
      { humans: 1, bots: [] },
      { humans: 1, bots: [] },
    ],
    ...extra,
  };
}

const LUNAR = CHAOS_MODS.lowGravity;
const entity = (sim: Sim, c: number): number => entityIndex(sim.controllerEntity(c));

/** Pula parado e devolve a altura máxima dos pés acima do chão (m) e os ticks no ar. */
function jumpPeak(sim: Sim): { peak: number; air: number } {
  const f = createInputFrames();
  const e = entity(sim, 0);
  sim.step(f);
  const y0 = sim.view().position[e * 3 + 1]!;
  let peak = 0;
  let air = 0;
  f[0]!.buttons = BUTTON.jump;
  for (let i = 0; i < 4 * SIM_HZ; i++) {
    sim.step(f);
    f[0]!.buttons = 0;
    const h = sim.view().position[e * 3 + 1]! - y0;
    peak = Math.max(peak, h);
    if (h > 0.01) air++;
  }
  return { peak, air };
}

function peakOn(map: SimMap, extra: Partial<MatchRecipe> = {}): { peak: number; air: number } {
  const sim = createSim({ recipe: recipe(extra), map, humans: 2 });
  const out = jumpPeak(sim);
  sim.dispose();
  return out;
}

/** Anda para fora da torre de 8 m e devolve a menor vida até 4 s depois (antes da regeneração). */
function hpAfterDrop(map: SimMap): number {
  const sim = createSim({ recipe: recipe(), map, humans: 2 });
  const f = createInputFrames();
  const e = entity(sim, 0);
  f[0]!.moveY = 127;
  let hp = Infinity;
  for (let i = 0; i < 4 * SIM_HZ; i++) {
    sim.step(f);
    if (i > SIM_HZ / 2) f[0]!.moveY = 0;
    hp = Math.min(hp, sim.view().health[e]!);
  }
  expect(sim.view().position[e * 3 + 1]!, 'caiu da torre').toBeLessThan(1);
  sim.dispose();
  return hp;
}

describe('a gravidade de série do mapa (M10, fase 4)', () => {
  it('na Lua o pulo sobe ~2,9 m e demora mais no ar; sem o campo (ou com 1) nada muda', () => {
    const normal = peakOn(flatMap());
    const one = peakOn(flatMap(1));
    const moon = peakOn(flatMap(LUNAR));
    expect(one).toEqual(normal);
    expect(normal.peak).toBeGreaterThan(0.95);
    expect(normal.peak).toBeLessThan(1.05);
    // A velocidade do pulo é a mesma: a altura divide pela gravidade (1,0 / 0,35 = 2,86 m).
    expect(moon.peak).toBeGreaterThan(2.75);
    expect(moon.peak).toBeLessThan(2.95);
    expect(moon.air).toBeGreaterThan(normal.air * 2.5);
  });

  it('na Lua a queda de 8 m não machuca; fora dela, machuca', () => {
    const hurt = hpAfterDrop(towerMap());
    const moon = hpAfterDrop(towerMap(LUNAR));
    expect(hurt).toBeLessThan(100);
    expect(moon).toBe(100);
  });

  it('os modificadores partem do mapa: a Lua não muda nada lá, a pesada multiplica (0,35 × 1,8)', () => {
    expect(mapGravityLevels(1)).toEqual([1, CHAOS_MODS.lowGravity, CHAOS_MODS.heavyGravity]);
    expect(mapGravityLevels(LUNAR)).toEqual([LUNAR, LUNAR, LUNAR * CHAOS_MODS.heavyGravity]);
    const mods = (...ids: ModifierId[]): Partial<MatchRecipe> => ({ modifiers: ids });
    const moon = peakOn(flatMap(LUNAR));
    const moonLow = peakOn(flatMap(LUNAR), mods('lowGravity'));
    const moonHeavy = peakOn(flatMap(LUNAR), mods('heavyGravity'));
    expect(moonLow).toEqual(moon);
    // 1,0 / 0,63 = 1,59 m: mais baixo que a Lua, mais alto que a Terra.
    expect(moonHeavy.peak).toBeGreaterThan(1.5);
    expect(moonHeavy.peak).toBeLessThan(1.68);
    // Num mapa de sempre, a Lua do modificador é a mesma do mapa lunar.
    expect(peakOn(flatMap(), mods('lowGravity'))).toEqual(moon);
  });

  it('a Roleta nunca sorteia a Lua num mapa lunar (e sorteia nos outros)', () => {
    let moonLow = 0;
    let earthLow = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const g of [LUNAR, undefined]) {
        const sim = createSim({ recipe: recipe({ seed, chaos: { count: 3 } }), map: flatMap(g), humans: 2 });
        sim.step(createInputFrames());
        const mask = sim.view().chaos!.masks[0]!;
        if ((mask & MOD.lowGravity) !== 0) {
          if (g === undefined) earthLow++;
          else moonLow++;
        }
        sim.dispose();
      }
    }
    expect(moonLow).toBe(0);
    expect(earthLow).toBeGreaterThan(0);
  });

  it('com 1 (ou sem o campo) a partida é a mesma, Roleta inclusa: hash igual tick a tick', () => {
    const r = recipe({ chaos: { everyS: 10 } });
    const a = createSim({ recipe: r, map: flatMap(), humans: 2 });
    const b = createSim({ recipe: r, map: flatMap(1), humans: 2 });
    const f = createInputFrames();
    for (let i = 0; i < 30 * SIM_HZ; i++) {
      f[0]!.buttons = i % 70 === 0 ? BUTTON.jump : 0;
      f[0]!.moveY = i % 400 < 200 ? 127 : -127;
      a.step(f);
      b.step(f);
    }
    expect(b.stateHash()).toEqual(a.stateHash());
    a.dispose();
    b.dispose();
  });

  it('revisão: num mapa lunar o Arcade não vale (nem o perfil nem o modificador) e a gravidade total não passa de 0,25', () => {
    const moon = peakOn(flatMap(LUNAR));
    // O Arcade daria 1,3 / 0,35 = 3,7 m (e o pulo duplo, 6,7 m): fica o pulo lunar do Bobo.
    expect(peakOn(flatMap(LUNAR), { modifiers: ['arcade'] })).toEqual(moon);
    expect(peakOn(flatMap(LUNAR), { players: { movement: 'arcade' } })).toEqual(moon);
    const sim = createSim({ recipe: recipe({ modifiers: ['arcade', 'vampire'] }), map: flatMap(LUNAR), humans: 2 });
    expect(sim.view().chaos!.masks[0]).toBe(MOD.vampire);
    sim.dispose();
    // Fora da Lua o Arcade continua (o pulo de 1,3 m).
    const arcade = peakOn(flatMap(), { modifiers: ['arcade'] });
    expect(arcade.peak).toBeGreaterThan(1.25);
    expect(arcade.peak).toBeLessThan(1.4);
    // A regra de 0,25 na Lua daria 0,0875 (pulo de 11,4 m): o piso deixa 0,25 (pulo de 4 m), com a Roleta também.
    for (const extra of [{}, { chaos: { count: 3 } }]) {
      const low = peakOn(flatMap(LUNAR), { players: { gravity: 0.25 }, ...extra });
      expect(low.peak).toBeGreaterThan(3.85);
      expect(low.peak).toBeLessThan(4.1);
    }
    // Nos mapas de sempre, sem piso (as contas de antes).
    expect(peakOn(flatMap(), { players: { gravity: 0.5 }, modifiers: ['lowGravity'] }).peak).toBeGreaterThan(5.5);
  });

  it('recusa gravidade fora da faixa', () => {
    expect(() => createSim({ recipe: recipe(), map: flatMap(0), humans: 2 })).toThrow();
    expect(() => createSim({ recipe: recipe(), map: flatMap(5), humans: 2 })).toThrow();
  });
});
