import { describe, expect, it } from 'vitest';
import { calibrationFactor, calibrationTarget, createCalibration, stepCalibration } from './calibration.ts';

/** M2, fase 5f: a calibração da mira (passou do alvo, não chegou, ou no ponto). */

const DT = 1 / 60;
const DEG = Math.PI / 180;

/**
 * Faz a mira ir até cada alvo do jeito pedido: `overshoot` passa 8° e volta; `undershoot` para na metade por 0,3 s e
 * termina; `clean` vai direto. Atira no alvo. Devolve o fator sugerido.
 */
function run(style: 'overshoot' | 'undershoot' | 'clean'): number {
  let yaw = 0.3;
  let pitch = 0;
  const st = createCalibration(yaw, pitch);
  const target = new Float64Array(2);
  const moveTo = (ty: number, tp: number, seconds: number): void => {
    const y0 = yaw;
    const p0 = pitch;
    const n = Math.max(1, Math.round(seconds / DT));
    for (let k = 1; k <= n; k++) {
      // Movimento suave (começa e termina devagar).
      const f = 0.5 - 0.5 * Math.cos((Math.PI * k) / n);
      yaw = y0 + (ty - y0) * f;
      pitch = p0 + (tp - p0) * f;
      stepCalibration(st, yaw, pitch, false, DT);
    }
  };
  const hold = (seconds: number): void => {
    for (let t = 0; t < seconds; t += DT) stepCalibration(st, yaw, pitch, false, DT);
  };
  for (let i = 0; i < 3; i++) {
    calibrationTarget(st, i, target);
    const ty = target[0]!;
    const tp = target[1]!;
    const dir = Math.sign(ty - yaw);
    hold(0.2);
    if (style === 'overshoot') {
      moveTo(ty + dir * 8 * DEG, tp, 0.35);
      moveTo(ty, tp, 0.25);
    } else if (style === 'undershoot') {
      moveTo(yaw + (ty - yaw) * 0.5, pitch + (tp - pitch) * 0.5, 0.3);
      hold(0.3);
      moveTo(ty, tp, 0.3);
    } else moveTo(ty, tp, 0.4);
    stepCalibration(st, yaw, pitch, true, DT);
  }
  expect(st.index).toBe(3);
  return calibrationFactor(st);
}

describe('calibrar mira', () => {
  it('passar do alvo pede menos sensibilidade; parar antes pede mais; direto fica', () => {
    expect(run('overshoot')).toBe(0.85);
    expect(run('undershoot')).toBe(1.2);
    expect(run('clean')).toBe(1);
  });

  it('atirar longe do alvo não conta', () => {
    const st = createCalibration(0, 0);
    expect(stepCalibration(st, 0, 0, true, DT)).toBe(false);
    expect(st.index).toBe(0);
  });
});
