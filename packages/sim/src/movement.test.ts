import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, quantizeAxis } from '@boboforces/input';
import { yawToU16 } from '@boboforces/shared';
import { createTestBlocks, createWorldGrid, fillBox, makeCell, type WorldGrid } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { MOVEMENT_BOBO } from './config/movement.ts';
import { SIM_HZ } from './constants.ts';
import { ENTITY_FLAG, entityIndex } from './entity.ts';
import type { SimEvent } from './events.ts';
import { createInputFrames } from './loop.ts';
import { createSim } from './sim.ts';

/**
 * Alvos de calibração do perfil Bobo (ver o comentário de `MOVEMENT_BOBO`). Se um número do perfil mudar, estes
 * testes dizem o que mudou na sensação.
 */
const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);

function setup(
  hz = SIM_HZ,
  build?: (grid: WorldGrid) => void,
  spawn = { x: 20, y: 0.5, z: 95, yaw: 0, team: 0 },
): {
  step: () => void;
  speed: () => number;
  y: () => number;
  z: () => number;
  onGround: () => boolean;
  events: SimEvent[];
  frame: ReturnType<typeof createInputFrames>[number];
} {
  const grid = createWorldGrid(80, 16, 200);
  fillBox(grid, 0, 0, 0, 79, 0, 199, concrete);
  build?.(grid);
  const recipe: MatchRecipe = {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'test',
    seed: 1,
    teams: [{ humans: 1, bots: [] }],
  };
  const sim = createSim({ recipe, map: { grid, blocks, spawns: [spawn] }, humans: 1, hz });
  const frames = createInputFrames();
  const e = entityIndex(sim.controllerEntity(0));
  const v = sim.view();
  const events: SimEvent[] = [];
  return {
    step: () => {
      sim.step(frames);
      sim.drainEvents(events);
    },
    speed: () => Math.hypot(v.velocity[e * 3]!, v.velocity[e * 3 + 2]!),
    y: () => v.position[e * 3 + 1]!,
    z: () => v.position[e * 3 + 2]!,
    onGround: () => (v.flags[e]! & ENTITY_FLAG.onGround) !== 0,
    events,
    frame: frames[0]!,
  };
}

function ticksUntil(step: () => void, done: () => boolean, max = 600): number {
  for (let t = 1; t <= max; t++) {
    step();
    if (done()) return t;
  }
  return Infinity;
}

describe('calibração do perfil Bobo', () => {
  it('parado → andar em ≤ 0,1 s e parado → correr em ≤ 0,15 s', () => {
    const a = setup();
    a.step();
    a.frame.moveY = quantizeAxis(1);
    expect(ticksUntil(a.step, () => a.speed() >= MOVEMENT_BOBO.walk - 1e-9) / SIM_HZ).toBeLessThanOrEqual(0.1);
    const b = setup();
    b.step();
    b.frame.moveY = quantizeAxis(1);
    b.frame.buttons = BUTTON.sprint;
    expect(ticksUntil(b.step, () => b.speed() >= MOVEMENT_BOBO.sprint - 1e-9) / SIM_HZ).toBeLessThanOrEqual(0.15);
  });

  it('andar → parado em 0,2–0,3 s', () => {
    const a = setup();
    a.frame.moveY = quantizeAxis(1);
    for (let i = 0; i < 30; i++) a.step();
    a.frame.moveY = 0;
    const s = ticksUntil(a.step, () => a.speed() === 0) / SIM_HZ;
    expect(s).toBeGreaterThanOrEqual(0.2);
    expect(s).toBeLessThanOrEqual(0.3);
  });

  it('soltar o direcional para igual a 30 e a 60 Hz (atrito exponencial exato)', () => {
    const out: { s: number; m: number }[] = [];
    for (const hz of [60, 30]) {
      const a = setup(hz);
      a.frame.moveY = quantizeAxis(1);
      for (let i = 0; i < hz / 2; i++) a.step();
      expect(a.speed()).toBeCloseTo(MOVEMENT_BOBO.walk, 9);
      const z0 = a.z();
      a.frame.moveY = 0;
      const s = ticksUntil(a.step, () => a.speed() === 0) / hz;
      out.push({ s, m: Math.abs(a.z() - z0) });
    }
    const [h60, h30] = out as [{ s: number; m: number }, { s: number; m: number }];
    for (const r of out) {
      expect(r.s).toBeGreaterThanOrEqual(0.2);
      expect(r.s).toBeLessThanOrEqual(0.3);
      // Até parar anda v/atrito (~0,26 m), menos a cauda abaixo da velocidade mínima.
      expect(r.m).toBeGreaterThan(0.24);
      expect(r.m).toBeLessThanOrEqual(MOVEMENT_BOBO.walk / MOVEMENT_BOBO.friction + 1e-9);
    }
    // A diferença que sobra é só o arredondamento para o tick (no máximo 1 tick a 30 Hz).
    expect(Math.abs(h60.s - h30.s)).toBeLessThanOrEqual(1 / 30 + 1e-9);
    expect(Math.abs(h60.m - h30.m)).toBeLessThan(0.01);
  });

  it('andar 1 s cobre a mesma distância a 30 e a 60 Hz', () => {
    const dist: number[] = [];
    for (const hz of [60, 30]) {
      const a = setup(hz);
      a.step();
      const z0 = a.z();
      a.frame.moveY = quantizeAxis(1);
      for (let i = 0; i < hz; i++) a.step();
      dist.push(Math.abs(a.z() - z0));
    }
    expect(Math.abs(dist[0]! - dist[1]!)).toBeLessThan(0.005);
  });

  it('desce escada de degraus de 0,5 m sem sair do chão (sem pouso nem dispersão de pulo)', () => {
    // Patamar com topo em 2,0 m e três degraus de 0,5 m (1 m de piso cada) descendo para +Z até o chão (0,5 m).
    const stairs = (grid: WorldGrid): void => {
      fillBox(grid, 0, 1, 0, 79, 3, 9, concrete);
      fillBox(grid, 0, 1, 10, 79, 2, 11, concrete);
      fillBox(grid, 0, 1, 12, 79, 1, 13, concrete);
    };
    for (const sprint of [false, true]) {
      for (const hz of [60, 30]) {
        const a = setup(hz, stairs, { x: 20, y: 2, z: 2.5, yaw: Math.PI, team: 0 });
        a.frame.yaw = yawToU16(Math.PI);
        a.step();
        a.frame.moveY = quantizeAxis(1);
        a.frame.buttons = sprint ? BUTTON.sprint : 0;
        let airTicks = 0;
        a.events.length = 0;
        for (let i = 0; i < hz * 1.5; i++) {
          a.step();
          if (!a.onGround()) airTicks++;
        }
        expect(a.y(), `hz ${hz}`).toBe(0.5);
        expect(a.z()).toBeGreaterThan(7.5);
        expect(airTicks, `hz ${hz}, sprint ${sprint}`).toBe(0);
        const moves = a.events.filter((ev) => ev.type === 'move');
        expect(moves.filter((ev) => ev.type === 'move' && ev.move === 'land')).toHaveLength(0);
        const downs = moves.filter((ev) => ev.type === 'move' && ev.move === 'step' && ev.speed < 0);
        expect(downs).toHaveLength(3);
      }
    }
  });

  it('beirada mais alta que um degrau continua sendo queda (não gruda)', () => {
    // Patamar de 1,5 m acima do chão (topo em 2,0 m) sem degraus: sai pelo ar e pousa.
    const a = setup(SIM_HZ, (grid) => fillBox(grid, 0, 1, 0, 79, 3, 9, concrete), {
      x: 20,
      y: 2,
      z: 2.5,
      yaw: Math.PI,
      team: 0,
    });
    a.frame.yaw = yawToU16(Math.PI);
    a.step();
    a.frame.moveY = quantizeAxis(1);
    let air = 0;
    for (let i = 0; i < 90; i++) {
      a.step();
      if (!a.onGround()) air++;
    }
    expect(air).toBeGreaterThan(5);
    expect(a.events.some((ev) => ev.type === 'move' && ev.move === 'land')).toBe(true);
    expect(a.y()).toBe(0.5);
  });

  it('pulo de 1,0 m fica 0,6–0,65 s no ar', () => {
    const a = setup();
    a.step();
    a.frame.buttons = BUTTON.jump;
    a.step();
    a.frame.buttons = 0;
    const air = ticksUntil(a.step, () => a.y() <= 0.5) + 1;
    expect(air / SIM_HZ).toBeGreaterThanOrEqual(0.6);
    expect(air / SIM_HZ).toBeLessThanOrEqual(0.65);
  });
});
