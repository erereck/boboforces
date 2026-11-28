import { describe, expect, it } from 'vitest';
import { createSlideDust, createViewFlashes, landDustStrength, VISUAL_FX } from './visual-fx.ts';

describe('M12 (fase 5): o clarão das vistas', () => {
  it('a explosão segura ~150 ms com ganho ~1 e depois cai em 80 ms; o tiro cai na hora', () => {
    const f = createViewFlashes(4);
    let v = f.bump(0, 0, VISUAL_FX.explosionFlashGain, VISUAL_FX.explosionFlashHoldS, 10, false);
    expect(v).toBe(1);
    const dt = 1 / 60;
    let t = 0;
    while (v >= 1 && t < 1) {
      v = f.decay(0, v, dt);
      t += dt;
    }
    expect(t).toBeGreaterThanOrEqual(0.15);
    expect(t).toBeLessThan(0.2);
    for (let k = 0; k < 6; k++) v = f.decay(0, v, dt);
    expect(v).toBe(0);
    let shot = f.bump(1, 0, VISUAL_FX.shotFlashGain, 0, 10, false);
    expect(shot).toBeCloseTo(0.35, 6);
    shot = f.decay(1, shot, dt);
    expect(shot).toBeLessThan(0.35);
  });

  it('o segurar é proporcional à contribuição: a explosão longe (0,2) segura ~30 ms', () => {
    const f = createViewFlashes(4);
    let v = f.bump(0, 0, 0.2, VISUAL_FX.explosionFlashHoldS, 10, false);
    const dt = 1 / 120;
    let held = 0;
    while (v >= 0.2 && held < 1) {
      v = f.decay(0, v, dt);
      held += dt;
    }
    expect(held).toBeGreaterThanOrEqual(0.03 - 1e-9);
    expect(held).toBeLessThan(0.05);
  });

  it('"Reduzir efeitos": no máximo 3 clarões por segundo em cada vista', () => {
    const f = createViewFlashes(4);
    let starts = 0;
    let v = 0;
    for (let k = 0; k < 60; k++) {
      // Rajada de 10 tiros por segundo durante 6 s.
      const before = v;
      v = f.bump(2, 0, VISUAL_FX.shotFlashGain, 0, k * 0.1, true);
      if (v > before) starts++;
      v = 0;
    }
    // Com tiros a cada 0,1 s passa um a cada 0,4 s (o seguinte depois do vão de 1/3 s).
    expect(starts).toBeLessThanOrEqual(3 * 6);
    expect(starts).toBeGreaterThanOrEqual(14);
    // Sem o ajuste, todos passam.
    const g = createViewFlashes(4);
    let all = 0;
    for (let k = 0; k < 60; k++) if (g.bump(2, 0, 0.35, 0, k * 0.1, false) > 0) all++;
    expect(all).toBe(60);
  });
});

describe('M12 (fase 5): o pó do chão', () => {
  it('o pouso só levanta pó acima de 6 m/s de queda, mais forte até 11', () => {
    expect(landDustStrength(4.5)).toBe(0);
    expect(landDustStrength(Number.NaN)).toBe(0);
    expect(landDustStrength(6)).toBeCloseTo(0.4, 6);
    expect(landDustStrength(20)).toBe(1);
  });

  it('o deslize solta um pó logo no começo e depois a cada 0,1 s', () => {
    const d = createSlideDust(2);
    const dt = 1 / 60;
    let count = 0;
    for (let k = 0; k < 60; k++) if (d.step(5, true, dt)) count++;
    // 1 s deslizando: o 1º na hora e mais ~9.
    expect(count).toBeGreaterThanOrEqual(9);
    expect(count).toBeLessThanOrEqual(11);
    expect(d.step(5, false, dt)).toBe(false);
    expect(d.step(5, true, dt)).toBe(true);
    // Parado (dt 0, pausa) não solta nada.
    expect(d.step(5, true, 0)).toBe(false);
  });

  it('"Reduzir efeitos": metade dos pós do deslize', () => {
    const d = createSlideDust(2);
    let count = 0;
    for (let k = 0; k < 60; k++) if (d.step(3, true, 1 / 60, true)) count++;
    expect(count).toBeGreaterThanOrEqual(5);
    expect(count).toBeLessThanOrEqual(6);
  });
});
