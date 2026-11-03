import { describe, expect, it } from 'vitest';
import { edgeAcceleration, radialDeadzone, responseCurve, shapeStick } from './stick.ts';

describe('analógico', () => {
  it('zona morta radial interna 0,15 e externa 0,95', () => {
    expect(radialDeadzone(0.1, 0.15, 0.95)).toBe(0);
    expect(radialDeadzone(0.15, 0.15, 0.95)).toBe(0);
    expect(radialDeadzone(0.55, 0.15, 0.95)).toBeCloseTo(0.5, 9);
    expect(radialDeadzone(0.97, 0.15, 0.95)).toBe(1);
  });

  it('curva preserva as pontas', () => {
    expect(responseCurve(0, 2)).toBe(0);
    expect(responseCurve(1, 2)).toBe(1);
    expect(responseCurve(0.5, 2)).toBeCloseTo(0.25, 9);
    expect(responseCurve(0.5, 1)).toBe(0.5);
  });

  it('shapeStick é radial: a diagonal não gruda nos eixos e o módulo não passa de 1', () => {
    const out = [0, 0];
    const mag = shapeStick(1, 1, 0.15, 0.95, 2, out);
    expect(mag).toBe(1);
    expect(out[0]).toBeCloseTo(Math.SQRT1_2, 9);
    expect(out[1]).toBeCloseTo(Math.SQRT1_2, 9);
    // Um eixo pequeno com o outro grande não é cortado (zona morta por eixo cortaria).
    shapeStick(0.1, 0.9, 0.15, 0.95, 1, out);
    expect(out[0]).toBeGreaterThan(0);
    expect(shapeStick(0.05, -0.05, 0.15, 0.95, 2, out)).toBe(0);
    expect(out).toEqual([0, 0]);
  });

  it('aceleração na borda espera, sobe em rampa e para no teto', () => {
    expect(edgeAcceleration(0.2, 0.3, 0.25, 1.6)).toBe(1);
    expect(edgeAcceleration(0.425, 0.3, 0.25, 1.6)).toBeCloseTo(1.3, 9);
    expect(edgeAcceleration(2, 0.3, 0.25, 1.6)).toBe(1.6);
    expect(edgeAcceleration(2, 0.3, 0, 1.6)).toBe(1.6);
  });
});
