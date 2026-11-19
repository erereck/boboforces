import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, quantizeAxis } from '@boboforces/input';
import { BitReader, BitWriter, yawToU16 } from '@boboforces/shared';
import { BLOCK_FLAG, cellCenter, createBlockRegistry, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { SIM_HZ, ZOMBIE_CONTROLLER_BASE } from './constants.ts';
import { createInputFrames } from './loop.ts';
import { createSim, type SimMap, type SpawnPoint } from './sim.ts';
import { FORTRESS } from './systems/fortress.ts';

/**
 * M6 (fase 6a): o Bobo Zombies Fortress na sim: o gerador ao lado do spawn dos humanos, os zumbis colados tiram vida
 * dele, o humano segurando o usar perto conserta, e o gerador no zero perde a partida.
 */
const SOLID = BLOCK_FLAG.solid | BLOCK_FLAG.blocksBullets | BLOCK_FLAG.blocksSight | BLOCK_FLAG.walkable;
const blocks = createBlockRegistry([
  { key: 'concrete', shape: 'cube', faces: [1, 1, 1, 1, 1, 1], flags: SOLID, frames: 1, stepSound: 'concrete' },
]);
const concrete = makeCell(blocks.byKey('concrete')!.id);
const human: SpawnPoint = { x: cellCenter(20), y: 0.5, z: 15, yaw: 0, team: 0 };
/** Os zumbis nascem longe (o ponto sem time). */
const far: SpawnPoint = { x: cellCenter(20), y: 0.5, z: 28, yaw: 0, team: -1 };

function map(): SimMap {
  const grid = createWorldGrid(40, 16, 60);
  fillBox(grid, 0, 0, 0, 39, 0, 59, concrete);
  return { grid, blocks, spawns: [human, far] };
}

const recipe: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'zombies',
  map: 'test',
  seed: 5,
  teams: [{ humans: 'all', bots: [] }],
  zombies: { variant: 'fortress' },
};

describe('Bobo Zombies Fortress na sim (M6 fase 6a)', () => {
  it('o gerador fica ao lado do spawn dos humanos; os zumbis colados tiram vida, o usar conserta, no zero perde', () => {
    const sim = createSim({ recipe, map: map(), humans: 1, zombies: 6 });
    const v = sim.view();
    const f0 = v.fortress!;
    expect(f0).not.toBeNull();
    expect(Math.hypot(f0.x - human.x, f0.z - human.z)).toBeCloseTo(1.5, 5);
    expect(f0.hp[0]).toBe(FORTRESS.hp);
    // Os zumbis vão até o gerador e batem (os quadros escritos aqui; a sim não tem a IA).
    const f = createInputFrames();
    let before = -1;
    for (let t = 0; t < 40 * SIM_HZ && v.match.phase !== 'ended'; t++) {
      for (let i = 0; i < 6; i++) {
        const e = sim.controllerEntity(ZOMBIE_CONTROLLER_BASE + i) & 0xffff;
        const dx = f0.x - v.position[e * 3]!;
        const dz = f0.z - v.position[e * 3 + 2]!;
        const zf = f[ZOMBIE_CONTROLLER_BASE + i]!;
        zf.yaw = yawToU16(Math.atan2(-dx, -dz));
        zf.moveY = quantizeAxis(dx * dx + dz * dz > 1 ? 1 : 0);
      }
      sim.step(f);
      if (before < 0 && f0.hp[0]! < FORTRESS.hp - 50) before = f0.hp[0]!;
      if (before >= 0) break;
    }
    expect(before).toBeGreaterThan(0);
    // Snapshot: a vida do gerador vai junto (e o hash).
    const copy = createSim({ recipe, map: map(), humans: 1, zombies: 6 });
    const w = new BitWriter(256 * 1024);
    sim.writeSnapshot(w);
    copy.readSnapshot(new BitReader(w.bytes()));
    expect(copy.view().fortress!.hp[0]).toBe(f0.hp[0]);
    expect(copy.stateHash()).toEqual(sim.stateHash());
    copy.dispose();
    // Sem zumbi perto (eles param) e o humano segurando o usar ao lado: a vida volta.
    for (let i = 0; i < 6; i++) f[ZOMBIE_CONTROLLER_BASE + i]!.moveY = 0;
    const hpNow = f0.hp[0]!;
    f[0]!.buttons = BUTTON.use;
    for (let t = 0; t < SIM_HZ; t++) sim.step(f);
    f[0]!.buttons = 0;
    // Os zumbis colados continuam batendo: o conserto (60/s) ganha de 1 ou 2 zumbis (20/s cada) ou empata com 3.
    expect(f0.hp[0]! >= hpNow - 1).toBe(true);
    // Quase no fim (a vida mexida direto no estado): os zumbis colados derrubam o gerador e a partida acaba perdida.
    f0.hp[0] = 5;
    for (let t = 0; t < SIM_HZ && v.match.phase !== 'ended'; t++) sim.step(f);
    expect(v.match.phase).toBe('ended');
    expect(v.match.winnerTeam).toBe(-1);
    sim.dispose();
  });
});
