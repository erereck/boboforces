import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { AIM_ASSIST_LEVELS } from '@boboforces/input';
import { DEG_TO_RAD } from '@boboforces/shared';
import { createSim, eyeHeightFor, type SimMap } from '@boboforces/sim';
import { createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { AIM_ASSIST, createAimAssistState, findAimAssist, pullAim } from './aim-assist.ts';

/** M2, fase 3h: a assistência de mira (fricção, ímã e trava) do controle e do toque. */

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);

/** O humano em z = 30 olhando para −z; o bot 15 m à frente. `wall` levanta uma parede no meio. */
function setup(wall: boolean, botTeam: number) {
  const grid = createWorldGrid(40, 12, 80);
  fillBox(grid, 0, 0, 0, 39, 0, 79, concrete);
  if (wall) fillBox(grid, 10, 1, 44, 30, 8, 45, concrete);
  const map: SimMap = {
    grid,
    blocks,
    spawns: [
      { x: 10, y: 0.5, z: 30, yaw: 0, team: 0 },
      { x: 10, y: 0.5, z: 15, yaw: Math.PI, team: botTeam },
    ],
  };
  const recipe: MatchRecipe = {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'test',
    seed: 1,
    teams:
      botTeam === 0
        ? [{ humans: 1, bots: [{ ref: builtinBotRef('normal'), count: 1 }] }, { bots: [] }]
        : [{ humans: 1, bots: [] }, { bots: [{ ref: builtinBotRef('normal'), count: 1 }] }],
  };
  const sim = createSim({ recipe, map, humans: 1 });
  const v = sim.view();
  const e = sim.controllerEntity(0) & 0xffff;
  const eye = {
    x: v.position[e * 3]!,
    y: v.position[e * 3 + 1]! + eyeHeightFor(v.flags[e]!),
    z: v.position[e * 3 + 2]!,
  };
  // Pitch exato até o meio do tronco do bot.
  const pitch = Math.atan2(0.5 + AIM_ASSIST.chestM - eye.y, 15);
  return { sim, v, e, eye, pitch };
}

describe('assistência de mira', () => {
  it('fricção: no centro do alvo a sensibilidade cai o nível inteiro; fora do cone, nada', () => {
    const { v, e, eye, pitch } = setup(false, 1);
    const s = createAimAssistState();
    const level = AIM_ASSIST_LEVELS.medium;
    findAimAssist(v, e, false, eye.x, eye.y, eye.z, 0, pitch, level, 1, 100, s);
    expect(s.target).toBeGreaterThanOrEqual(0);
    expect(s.scale).toBeCloseTo(1 - level, 6);
    // Na metade do cone, metade da fricção.
    const cone = Math.atan(AIM_ASSIST.radiusM / Math.hypot(15, 0.5 + AIM_ASSIST.chestM - eye.y));
    findAimAssist(v, e, false, eye.x, eye.y, eye.z, cone / 2, pitch, level, 1, 100, s);
    expect(s.scale).toBeCloseTo(1 - level / 2, 2);
    findAimAssist(v, e, false, eye.x, eye.y, eye.z, 15 * DEG_TO_RAD, pitch, level, 1, 100, s);
    expect(s.target).toBe(-1);
    expect(s.scale).toBe(1);
    // Desligada (mouse), fora do alcance de visão: nada.
    findAimAssist(v, e, false, eye.x, eye.y, eye.z, 0, pitch, 0, 1, 100, s);
    expect(s.target).toBe(-1);
    findAimAssist(v, e, false, eye.x, eye.y, eye.z, 0, pitch, level, 1, 10, s);
    expect(s.target).toBe(-1);
  });

  it('aliado e alvo atrás da parede não puxam; no FFA o mesmo bobo vira alvo', () => {
    const ally = setup(false, 0);
    const s = createAimAssistState();
    findAimAssist(ally.v, ally.e, false, ally.eye.x, ally.eye.y, ally.eye.z, 0, ally.pitch, 0.4, 1, 100, s);
    expect(s.target).toBe(-1);
    findAimAssist(ally.v, ally.e, true, ally.eye.x, ally.eye.y, ally.eye.z, 0, ally.pitch, 0.4, 1, 100, s);
    expect(s.target).toBeGreaterThanOrEqual(0);
    const walled = setup(true, 1);
    findAimAssist(walled.v, walled.e, false, walled.eye.x, walled.eye.y, walled.eye.z, 0, walled.pitch, 0.4, 1, 100, s);
    expect(s.target).toBe(-1);
  });

  it('ímã: mexendo a mira, puxa uma fração do erro por segundo; parado, não puxa', () => {
    const s = createAimAssistState();
    s.target = 3;
    s.targetYaw = 0.05;
    s.targetPitch = -0.02;
    const out = new Float64Array(2);
    pullAim(s, 0.4, 1 / 60, true, 0, 0, out);
    const f = 0.4 * AIM_ASSIST.pullPerS * (1 / 60);
    expect(out[0]).toBeCloseTo(0.05 * f, 9);
    expect(out[1]).toBeCloseTo(-0.02 * f, 9);
    pullAim(s, 0.4, 1 / 60, false, 0, 0, out);
    expect([out[0], out[1]]).toEqual([0, 0]);
    // Um quadro enorme não passa do alvo.
    pullAim(s, 0.6, 5, true, 0, 0, out);
    expect(out[0]).toBeCloseTo(0.05, 9);
    s.target = -1;
    pullAim(s, 0.4, 1 / 60, true, 0.3, 0.1, out);
    expect([out[0], out[1]]).toEqual([0.3, 0.1]);
  });
});
