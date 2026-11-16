import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, quantizeAxis } from '@boboforces/input';
import { pitchToI16, yawToU16 } from '@boboforces/shared';
import { BLOCK_FLAG, createBlockRegistry, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { METRICS } from './config/metrics.ts';
import type { SimEvent } from './events.ts';
import { createInputFrames } from './loop.ts';
import { simMapFromMarkers } from './map.ts';
import { createSim, type Sim } from './sim.ts';

const SOLID = BLOCK_FLAG.solid | BLOCK_FLAG.blocksBullets | BLOCK_FLAG.blocksSight | BLOCK_FLAG.walkable;
const blocks = createBlockRegistry([
  { key: 'concrete', shape: 'cube', faces: [1, 1, 1, 1, 1, 1], flags: SOLID, frames: 1, stepSound: 'concrete' },
]);

/** Chão liso de 20 × 30 m: o atirador no norte olhando para o sul, o alvo 12 m à frente. */
function flatMap(): ReturnType<typeof simMapFromMarkers> {
  const grid = createWorldGrid(40, 16, 60);
  fillBox(grid, 0, 0, 0, 39, 0, 59, makeCell(blocks.byKey('concrete')!.id));
  return simMapFromMarkers({
    grid,
    blocks,
    markers: {
      spawns: [
        { x: 10, y: 0.5, z: 8, yaw: Math.PI, team: 0 },
        { x: 10, y: 0.5, z: 20, yaw: 0, team: 1 },
      ],
      playArea: { minX: 0, minZ: 0, maxX: 20, maxZ: 30, killPlaneY: -10 },
    },
  });
}

const recipe: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'warfare.tdm',
  map: 'test',
  seed: 1,
  teams: [
    { humans: 1, bots: [] },
    { humans: 1, bots: [] },
  ],
  weapons: { spread: false, recoil: false },
};

/**
 * O alvo (controlador 1) anda de lado; no tick 40 o atirador (0) mira onde o alvo estava 10 ticks antes e atira uma
 * vez, com o tiro voltando `back` ticks. Devolve se acertou.
 */
function shootAtPast(back: number): { hit: boolean; rewound: number } {
  const sim: Sim = createSim({ recipe, map: flatMap(), humans: 2 });
  if (back > 0) sim.rewind.enable();
  const f = createInputFrames();
  const v = sim.view();
  const me = sim.controllerEntity(0) & 0xffff;
  const target = sim.controllerEntity(1) & 0xffff;
  const past: number[][] = [];
  const events: SimEvent[] = [];
  let hit = false;
  for (let t = 0; t < 60; t++) {
    f[1]!.moveX = quantizeAxis(1);
    f[1]!.yaw = yawToU16(0);
    f[0]!.buttons = 0;
    past.push([v.position[target * 3]!, v.position[target * 3 + 1]!, v.position[target * 3 + 2]!]);
    if (t === 40) {
      const [tx, ty, tz] = past[t - 10]!;
      const ex = v.position[me * 3]!;
      const ey = v.position[me * 3 + 1]! + METRICS.eyeHeight;
      const ez = v.position[me * 3 + 2]!;
      const dx = tx! - ex;
      const dz = tz! - ez;
      const dy = ty! + 1.1 - ey;
      f[0]!.yaw = yawToU16(Math.atan2(-dx, -dz));
      f[0]!.pitch = pitchToI16(Math.atan2(dy, Math.hypot(dx, dz)));
      f[0]!.buttons = BUTTON.fire;
      sim.rewind.set(0, back);
    }
    sim.step(f);
    events.length = 0;
    sim.drainEvents(events);
    for (const ev of events) if (ev.type === 'hit' && ev.target === sim.controllerEntity(1)) hit = true;
  }
  const rewound = sim.rewind.rewound;
  sim.dispose();
  return { hit, rewound };
}

describe('tiro no que eu vi (M5 fase 2d)', () => {
  it('mirando onde o alvo estava 10 ticks atrás: acerta voltando 10 ticks, erra no presente', () => {
    const now = shootAtPast(0);
    const back = shootAtPast(10);
    expect(now).toEqual({ hit: false, rewound: 0 });
    expect(back).toEqual({ hit: true, rewound: 1 });
  });

  it('o rewind é limitado a 350 ms e desligado não muda nada', () => {
    const sim = createSim({ recipe, map: flatMap(), humans: 2 });
    expect(sim.rewind.maxTicks).toBe(21);
    sim.rewind.set(0, 30);
    expect(sim.rewind.rewound).toBe(0);
    sim.dispose();
  });
});
