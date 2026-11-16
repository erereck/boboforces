import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, quantizeAxis } from '@boboforces/input';
import { pitchToI16, yawToU16 } from '@boboforces/shared';
import { createInputFrames, createSim, createSimLoop, METRICS, simMapFromMarkers } from '@boboforces/sim';
import { BLOCK_FLAG, createBlockRegistry, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { createClientDriver } from './client.ts';
import { createHostDriver, createNetHost } from './host.ts';
import { createLoopback } from './transport.ts';

const SOLID = BLOCK_FLAG.solid | BLOCK_FLAG.blocksBullets | BLOCK_FLAG.blocksSight | BLOCK_FLAG.walkable;
const blocks = createBlockRegistry([
  { key: 'concrete', shape: 'cube', faces: [1, 1, 1, 1, 1, 1], flags: SOLID, frames: 1, stepSound: 'concrete' },
]);

/** Chão liso: o alvo (host) no norte, o atirador (cliente) 12 m ao sul. */
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
  seed: 4,
  teams: [
    { humans: 1, bots: [] },
    { humans: 1, bots: [] },
  ],
  players: { hp: 100_000 },
  weapons: { spread: false, recoil: false },
};

interface Duel {
  shots: number;
  hits: number;
  rewound: number;
  /** Quantos ticks o host voltou, em média, nos tiros do cliente. */
  back: number;
}

/**
 * O host anda de lado sem parar; o cliente mira, a cada tick, no peito do boneco do host como ele o vê na tela e
 * dá um tiro a cada 12 ticks (25 tiros). Devolve os tiros e os acertos que o host contou.
 */
function duel(lagCompensation: boolean): Duel {
  const map = flatMap();
  const net = createLoopback({ seed: 11, latencyMs: 80, jitterMs: 25, loss: 0.05 });
  const sim = createSim({ recipe, map, humans: 2 });
  let netHost: ReturnType<typeof createNetHost> | null = null;
  let shots = 0;
  let hits = 0;
  const backs: number[] = [];
  const loop = createSimLoop({
    sim,
    frames: createInputFrames(),
    beforeTick: (s, f) => {
      f[0]!.moveX = quantizeAxis(Math.floor(s.tick / 90) % 2 === 0 ? 1 : -1);
      netHost!.writeRemoteFrame(1, f[1]!);
      const view = netHost!.inputOf(1)!.lastView;
      if ((f[1]!.buttons & BUTTON.fire) !== 0 && view >= 0) backs.push((s.tick - view) & 0xffff);
    },
    afterTick: (s, events) => {
      const shooter = s.controllerEntity(1);
      for (const ev of events) {
        if (ev.type === 'shot' && ev.shooter === shooter) shots++;
        if (ev.type === 'hit' && ev.shooter === shooter && ev.target === s.controllerEntity(0)) hits++;
      }
      netHost!.recordEvents(events);
    },
  });
  netHost = createNetHost({ sim, endpoint: net.endpoint(0), snapshotHz: 30, lagCompensation });
  const host = createHostDriver(netHost, {
    update: (dt) => loop.frame(dt),
    get alpha() {
      return loop.alpha;
    },
    dispose: () => sim.dispose(),
  });
  netHost.addClient(1, 1);
  let taps = 0;
  const client = createClientDriver({
    sim: createSim({ recipe, map, humans: 2 }),
    endpoint: net.endpoint(1),
    host: 0,
    writeLocalFrame: (out, seq) => {
      out.buttons = 0;
      const v = client.sim.view();
      const me = client.ownEntity;
      const target = client.sim.controllerEntity(0) & 0xffff;
      if (me < 0 || client.renderTick < 120 || taps >= 25) return;
      const dx = v.position[target * 3]! - v.position[me * 3]!;
      const dy = v.position[target * 3 + 1]! + 1.1 - (v.position[me * 3 + 1]! + METRICS.eyeHeight);
      const dz = v.position[target * 3 + 2]! - v.position[me * 3 + 2]!;
      out.yaw = yawToU16(Math.atan2(-dx, -dz));
      out.pitch = pitchToI16(Math.atan2(dy, Math.hypot(dx, dz)));
      if (seq % 12 === 0) {
        out.buttons = BUTTON.fire;
        taps++;
      }
    },
  });
  for (let i = 0; i < 60 * 10; i++) {
    net.advance(1000 / 60);
    host.update(1 / 60);
    client.update(1 / 60);
  }
  const rewound = sim.rewind.rewound;
  host.dispose();
  client.dispose();
  return { shots, hits, rewound, back: backs.reduce((a, b) => a + b, 0) / backs.length };
}

describe('tiro no que eu vi pela rede (M5 fase 2d)', () => {
  it('a 80 ms, mirando no que vê, o cliente acerta quase tudo com a compensação e quase nada sem', () => {
    const off = duel(false);
    const on = duel(true);
    console.log(
      `[lagcomp] sem: ${off.hits}/${off.shots} · com: ${on.hits}/${on.shots} · o tiro voltou ${on.back.toFixed(1)} ticks`,
    );
    expect(on.shots).toBe(25);
    expect(off.shots).toBe(25);
    expect(on.rewound).toBe(25);
    // A 80 ms de ida: a ida do snapshot, os 100 ms da interpolação, a ida da entrada e a fila do host.
    expect(on.back).toBeGreaterThan(14);
    expect(on.back).toBeLessThanOrEqual(21);
    expect(on.hits).toBeGreaterThanOrEqual(23);
    expect(off.hits).toBeLessThanOrEqual(5);
  }, 60_000);
});
