import { levelBot } from '@boboforces/format';
import { createRng } from '@boboforces/shared';
import { BOT_CONTROLLER_BASE, SIM_HZ, WEAPON_CODE, weaponDef, type SimView } from '@boboforces/sim';
import { describe, expect, it } from 'vitest';
import { burstAllows, burstLength, stepAimError, trackTarget } from './aim-feel.ts';
import { AI_FEEL } from './config.ts';
import { PathFollower } from './paths.ts';
import { SoldierBrain, SoldierTiming } from './soldier.ts';

/** M12 (fase 7a): a mira com cara de gente (`aim-feel.ts`): o erro que deriva, o atraso e as rajadas. */

const TIMING = new SoldierTiming(SIM_HZ);

function brain(seed = 7): SoldierBrain {
  return new SoldierBrain(
    0,
    BOT_CONTROLLER_BASE,
    'normal',
    createRng(seed),
    TIMING,
    new PathFollower(0),
    levelBot('normal'),
  );
}

describe('o erro que deriva (Ornstein-Uhlenbeck)', () => {
  it('mantém a variância 1 e correlaciona 0,7 por passo de 0,1 s', () => {
    const b = brain();
    const n = 20_000;
    let sum = 0;
    let sum2 = 0;
    let lag = 0;
    let prev = 0;
    let tick = 0;
    for (let i = 0; i < n; i++) {
      stepAimError(b, tick, TIMING);
      const z = b.errZYaw;
      sum += z;
      sum2 += z * z;
      if (i > 0) lag += z * prev;
      prev = z;
      tick = b.errNextTick;
    }
    const mean = sum / n;
    const variance = sum2 / n - mean * mean;
    expect(Math.abs(mean)).toBeLessThan(0.1);
    expect(variance).toBeGreaterThan(0.9);
    expect(variance).toBeLessThan(1.1);
    expect(lag / (n - 1) / variance).toBeCloseTo(AI_FEEL.errorRho, 1);
    expect(TIMING.errorResample).toBe(Math.round(AI_FEEL.errorStepS * SIM_HZ));
  });

  it('só anda no passo: entre dois passos o erro fica', () => {
    const b = brain();
    stepAimError(b, 100, TIMING);
    const z = b.errZYaw;
    stepAimError(b, 101, TIMING);
    expect(b.errZYaw).toBe(z);
    expect(b.errNextTick).toBe(100 + TIMING.errorResample);
  });
});

describe('a mira que atrasa', () => {
  it('a velocidade estimada segue a real com τ = 0,3·reação', () => {
    const b = brain();
    b.target = 0;
    const velocity = new Float64Array([4, 0, 0]);
    const view = { velocity } as unknown as SimView;
    // τ = 0,3 × 27 ticks (0,45 s) ≈ 8 ticks: depois de τ, ~63% do caminho; depois de 5τ, quase tudo.
    expect(b.lagTicks).toBeCloseTo(0.3 * b.reactionTicks, 6);
    for (let i = 0; i < Math.round(b.lagTicks); i++) trackTarget(view, b);
    expect(b.estVx).toBeGreaterThan(4 * 0.55);
    expect(b.estVx).toBeLessThan(4 * 0.72);
    for (let i = 0; i < Math.round(4 * b.lagTicks); i++) trackTarget(view, b);
    expect(b.estVx).toBeGreaterThan(4 * 0.97);
  });
});

describe('rajadas (`triggerHold`)', () => {
  it('3 + 10·triggerHold tiros: Pela vibe 10, Normal 8, Tryhard 6', () => {
    expect(burstLength(0.7)).toBe(10);
    expect(burstLength(0.5)).toBe(8);
    expect(burstLength(0.3)).toBe(6);
    expect(brain().burstLen).toBe(8);
  });

  it('automática de longe solta o gatilho depois da rajada; de perto (≤ 12 m) ou semiautomática, nunca', () => {
    const b = brain();
    const lastShotTick = new Int32Array([-1_000_000]);
    const view = { lastShotTick } as unknown as SimView;
    const rifle = weaponDef(WEAPON_CODE.rifle)!;
    expect(rifle.automatic).toBe(true);
    let tick = 0;
    let shots = 0;
    // Atira um tiro a cada 6 ticks enquanto pode.
    while (shots < b.burstLen) {
      expect(burstAllows(view, b, 0, rifle, 20, tick, TIMING)).toBe(true);
      lastShotTick[0] = tick;
      shots++;
      tick += 6;
    }
    expect(burstAllows(view, b, 0, rifle, 20, tick, TIMING)).toBe(false);
    const pauseEnd = b.burstPauseUntil;
    expect(pauseEnd - tick).toBeGreaterThanOrEqual(TIMING.burstPauseMin);
    expect(pauseEnd - tick).toBeLessThanOrEqual(TIMING.burstPauseMax);
    expect(burstAllows(view, b, 0, rifle, 20, pauseEnd - 1, TIMING)).toBe(false);
    expect(burstAllows(view, b, 0, rifle, 20, pauseEnd, TIMING)).toBe(true);
    // De perto: segura o gatilho.
    const c = brain();
    for (let i = 0; i < 30; i++) {
      lastShotTick[0] = i * 6;
      expect(burstAllows(view, c, 0, rifle, 8, i * 6 + 1, TIMING)).toBe(true);
    }
    // Semiautomática: o próprio soldado já solta entre os tiros.
    const pistol = weaponDef(WEAPON_CODE.pistol)!;
    for (let i = 0; i < 30; i++) {
      lastShotTick[0] = 200 + i * 6;
      expect(burstAllows(view, c, 0, pistol, 30, 201 + i * 6, TIMING)).toBe(true);
    }
  });
});
