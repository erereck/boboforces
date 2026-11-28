import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { AIM_ASSIST_LEVELS } from '@boboforces/input';
import { DEG_TO_RAD } from '@boboforces/shared';
import { createSim, eyeHeightFor, type SimMap } from '@boboforces/sim';
import { createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { AIM_ASSIST, createAimAssistState, findAimAssist, steerAim } from './aim-assist.ts';

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

  it('M12 (fase 6): o segmento quadril–cabeça e a velocidade angular do alvo (o movimento dos dois)', () => {
    const { v, e, eye, pitch } = setup(false, 1);
    const s = createAimAssistState();
    findAimAssist(v, e, false, eye.x, eye.y, eye.z, 0, pitch, 0.4, 1, 100, s);
    const j = s.target;
    expect(j).toBeGreaterThanOrEqual(0);
    const feet = v.position[j * 3 + 1]!;
    expect(s.pitchLow).toBeCloseTo(Math.atan2(feet + AIM_ASSIST.hipM - eye.y, 15), 9);
    expect(s.pitchHigh).toBeCloseTo(Math.atan2(feet + AIM_ASSIST.headM - eye.y, 15), 9);
    expect(s.pitchLow).toBeLessThan(s.targetPitch);
    expect(s.pitchHigh).toBeGreaterThan(s.targetPitch);
    expect(s.yawRate).toBeCloseTo(0, 12);
    expect(s.pitchRate).toBeCloseTo(0, 12);
    // O alvo anda de lado para a direita (+x, olhando para −z) a 3 m/s: a 15 m, o yaw cai 3/15 rad/s.
    v.velocity[j * 3] = 3;
    findAimAssist(v, e, false, eye.x, eye.y, eye.z, 0, pitch, 0.4, 1, 100, s);
    expect(s.yawRate).toBeCloseTo(-3 / 15, 9);
    // O jogador andando junto, para o mesmo lado: nada a acompanhar.
    v.velocity[e * 3] = 3;
    findAimAssist(v, e, false, eye.x, eye.y, eye.z, 0, pitch, 0.4, 1, 100, s);
    expect(s.yawRate).toBeCloseTo(0, 9);
    v.velocity[e * 3] = 0;
    // Revisão: perto do polo (o olho 10 cm ao lado e 3 m acima do alvo) um passo de lado giraria o yaw a dezenas de
    // rad/s: o teto segura em `maxRateRadS`.
    v.velocity[j * 3 + 2] = 5;
    const tx = v.position[j * 3]!;
    const tz = v.position[j * 3 + 2]!;
    const top = feet + AIM_ASSIST.chestM + 3;
    // Mirando direto no alvo, lá embaixo (sem o teto, o yaw dele giraria a 0,1·5/0,1² = 50 rad/s).
    findAimAssist(v, e, false, tx + 0.1, top, tz, Math.PI / 2, Math.atan2(-3, 0.1), 0.4, 1, 100, s);
    expect(s.target).toBe(j);
    expect(Math.abs(s.yawRate)).toBe(AIM_ASSIST.maxRateRadS);
    expect(Math.abs(s.pitchRate)).toBeLessThanOrEqual(AIM_ASSIST.maxRateRadS);
    v.velocity[j * 3 + 2] = 0;
  });

  it('ímã: mexendo a mira ou andando, puxa uma fração do erro por segundo até o eixo e o segmento; parado, não', () => {
    const s = createAimAssistState();
    s.target = 3;
    s.targetYaw = 0.05;
    s.targetPitch = -0.02;
    s.pitchLow = -0.04;
    s.pitchHigh = 0.01;
    const out = new Float64Array(2);
    const f = 0.4 * AIM_ASSIST.pullPerS * (1 / 60);
    // Mirando abaixo do quadril (−0,1): o pitch sobe até o quadril (−0,04), não até o peito.
    steerAim(s, 0.4, 1 / 60, false, true, false, 0, -0.1, out);
    expect(out[0]).toBeCloseTo(0.05 * f, 9);
    expect(out[1]).toBeCloseTo(-0.1 + 0.06 * f, 9);
    // Mirando na cabeça (dentro do segmento): o pitch não é arrastado para baixo.
    steerAim(s, 0.4, 1 / 60, false, true, false, 0, 0.005, out);
    expect(out[1]).toBe(0.005);
    // Acima da cabeça: desce até ela.
    steerAim(s, 0.4, 1 / 60, false, true, false, 0, 0.05, out);
    expect(out[1]).toBeCloseTo(0.05 - 0.04 * f, 9);
    // Parado (sem mexer a mira nem andar): nada.
    steerAim(s, 0.4, 1 / 60, false, false, false, 0, 0, out);
    expect([out[0], out[1]]).toEqual([0, 0]);
    // Um quadro enorme não passa do alvo.
    steerAim(s, 0.6, 5, false, true, false, 0, 0, out);
    expect(out[0]).toBeCloseTo(0.05, 9);
    s.target = -1;
    steerAim(s, 0.4, 1 / 60, true, true, false, 0.3, 0.1, out);
    expect([out[0], out[1]]).toEqual([0.3, 0.1]);
  });

  it('acompanhar: mexendo a mira, segue nível · 0,5 da velocidade angular do alvo; sem mexer, não', () => {
    const s = createAimAssistState();
    s.target = 3;
    s.pitchLow = -1;
    s.pitchHigh = 1;
    s.yawRate = -0.2;
    s.pitchRate = 0.1;
    const out = new Float64Array(2);
    const dt = 1 / 60;
    // No eixo do alvo: o acompanhar anda e o ímã puxa uma fração de volta para o eixo (0).
    steerAim(s, 0.4, dt, true, false, false, 0, 0, out);
    const k = 0.4 * AIM_ASSIST.rotation * dt;
    const f = 0.4 * AIM_ASSIST.pullPerS * dt;
    expect(out[0]).toBeCloseTo(-0.2 * k * (1 - f), 12);
    expect(out[1]).toBeCloseTo(0.1 * k, 12);
    // Só andando (sem mexer a mira): o ímã, sem acompanhar.
    steerAim(s, 0.4, dt, false, true, false, 0, 0, out);
    expect([out[0], out[1]]).toEqual([0, 0]);
  });

  it('Forte: o ADS trava em 0,1 s, suave (uma fração por quadro), e chega no alvo; o Médio não trava', () => {
    const s = createAimAssistState();
    s.target = 3;
    s.targetYaw = 0.06;
    s.pitchLow = -0.05;
    s.pitchHigh = 0.02;
    const out = new Float64Array(2);
    const dt = 1 / 60;
    steerAim(s, AIM_ASSIST_LEVELS.medium, dt, false, false, true, 0, -0.1, out);
    expect(s.snapLeft).toBe(0);
    expect([out[0], out[1]]).toEqual([0, -0.1]);
    steerAim(s, AIM_ASSIST_LEVELS.strong, dt, false, false, true, 0, -0.1, out);
    // O primeiro quadro anda só dt/0,1 do caminho (antes ia de uma vez).
    expect(out[0]).toBeCloseTo(0.06 * (dt / AIM_ASSIST.snapS), 9);
    let frames = 1;
    while (s.snapLeft > 0 && frames < 20) {
      steerAim(s, AIM_ASSIST_LEVELS.strong, dt, false, false, false, out[0]!, out[1]!, out);
      frames++;
    }
    expect(frames).toBe(Math.round(AIM_ASSIST.snapS / dt));
    expect(out[0]).toBeCloseTo(0.06, 9);
    expect(out[1]).toBeCloseTo(-0.05, 9);
    // Perdeu o alvo no meio: a trava acaba.
    s.snapLeft = 0.05;
    s.target = -1;
    steerAim(s, AIM_ASSIST_LEVELS.strong, dt, false, false, false, 0, 0, out);
    expect(s.snapLeft).toBe(0);
  });
});
