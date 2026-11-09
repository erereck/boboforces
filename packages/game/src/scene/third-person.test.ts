import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { createInputFrames, createSim, METRICS, type SimView } from '@boboforces/sim';
import { createTestBlocks, createWorldGrid, fillBox, makeCell, type WorldGrid } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { aimFromCamera, createShoulderPose, placeShoulderCamera, THIRD_PERSON } from './third-person.ts';

/** M2, fase 6b: a câmera de ombro (braço que encurta na parede) e a mira pelo raio da câmera. */

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);
const EYE = METRICS.eyeHeight;

/** Você em (10, 0,5, 30) olhando para −Z; um adversário em (10, 0,5, 10). `build` acrescenta paredes. */
function scene(build?: (grid: WorldGrid) => void): SimView {
  const grid = createWorldGrid(40, 12, 80);
  fillBox(grid, 0, 0, 0, 39, 0, 79, concrete);
  build?.(grid);
  const recipe: MatchRecipe = {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'test',
    seed: 1,
    teams: [{ humans: 1, bots: [] }, { bots: [{ ref: builtinBotRef('normal'), count: 1 }] }],
  };
  const spawns = [
    { x: 10, y: 0.5, z: 30, yaw: 0, team: 0 },
    { x: 10, y: 0.5, z: 10, yaw: 0, team: 1 },
  ];
  const sim = createSim({ recipe, map: { grid, blocks, spawns }, humans: 1 });
  sim.step(createInputFrames());
  return sim.view();
}

describe('3ª pessoa (M2, fase 6b)', () => {
  it('campo aberto: atrás, à direita e acima do olho; o ombro esquerdo espelha', () => {
    const v = scene();
    const pose = createShoulderPose();
    placeShoulderCamera(v, 10, 0.5 + EYE, 30, 0, 0, 1, 1 / 60, pose);
    expect(pose.x).toBeCloseTo(10 + THIRD_PERSON.sideM, 6);
    expect(pose.y).toBeCloseTo(0.5 + EYE + THIRD_PERSON.upM, 6);
    expect(pose.z).toBeCloseTo(30 + THIRD_PERSON.backM, 6);
    const left = createShoulderPose();
    placeShoulderCamera(v, 10, 0.5 + EYE, 30, 0, 0, -1, 1 / 60, left);
    expect(left.x).toBeCloseTo(10 - THIRD_PERSON.sideM, 6);
  });

  it('parede atrás: o braço encurta na hora e volta a esticar devagar', () => {
    // Parede de z = 31,5 a 32 m (1,5 m atrás do olho), do chão até 5 m.
    const v = scene((grid) => fillBox(grid, 0, 1, 63, 39, 10, 63, concrete));
    const pose = createShoulderPose();
    placeShoulderCamera(v, 10, 0.5 + EYE, 30, 0, 0, 1, 1 / 60, pose);
    expect(pose.z).toBeLessThan(31.5 - THIRD_PERSON.wallMarginM * 0.5);
    expect(pose.arm).toBeLessThan(2);
    // Sem a parede (olhando para o outro lado), o braço cresce no máximo `armGrowPerS · dt`.
    const before = pose.arm;
    placeShoulderCamera(v, 10, 0.5 + EYE, 30, Math.PI, 0, 1, 1 / 60, pose);
    expect(pose.arm).toBeCloseTo(before + THIRD_PERSON.armGrowPerS / 60, 6);
  });

  it('a mira: o raio da câmera para no adversário e o tiro sai do olho até ele', () => {
    const v = scene();
    const eyeY = 0.5 + EYE;
    const pose = createShoulderPose();
    // A câmera mira no peito do adversário (10, ~1,6, 10) a partir do ombro.
    placeShoulderCamera(v, 10, eyeY, 30, 0, 0, 1, 1 / 60, pose);
    const tx = 10;
    const ty = 1.6;
    const tz = 10;
    const yaw = Math.atan2(-(tx - pose.x), -(tz - pose.z));
    const pitch = Math.atan2(ty - pose.y, Math.hypot(tx - pose.x, tz - pose.z));
    const out = new Float64Array(2);
    aimFromCamera(v, 0, 10, eyeY, 30, pose.x, pose.y, pose.z, yaw, pitch, out);
    // Do olho, o raio com os ângulos novos passa pela caixa do adversário (x 9,7–10,3) a 20 m.
    const d = 20;
    const x = 10 - Math.sin(out[0]!) * d;
    const y = eyeY + Math.tan(out[1]!) * d;
    expect(Math.abs(x - 10)).toBeLessThan(METRICS.aabbWidth / 2);
    expect(y).toBeGreaterThan(0.5);
    expect(y).toBeLessThan(0.5 + METRICS.aabbHeight);
    // Sem a correção (o ângulo da câmera), o tiro passaria ao lado.
    const raw = 10 - Math.sin(yaw) * d;
    expect(Math.abs(raw - 10)).toBeGreaterThan(Math.abs(x - 10));
  });

  it('ponto mirado colado no olho: o tiro segue o olhar da câmera', () => {
    // Parede a 0,5 m na frente do olho.
    const v = scene((grid) => fillBox(grid, 0, 1, 58, 39, 10, 58, concrete));
    const out = new Float64Array(2);
    const eyeY = 0.5 + EYE;
    aimFromCamera(v, 0, 10, eyeY, 30, 10.6, eyeY + 0.25, 32.3, 0.05, -0.02, out);
    expect([out[0], out[1]]).toEqual([0.05, -0.02]);
  });
});
