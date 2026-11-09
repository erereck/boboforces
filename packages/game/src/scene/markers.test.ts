import { describe, expect, it } from 'vitest';
import { projectToView } from './markers.ts';

/** M2, fase 2d: a projeção dos marcadores segue a convenção da câmera (yaw 0 olha para −Z, positivo à esquerda). */

const rect = { x: 0, y: 0, width: 1280, height: 720 };
const fovY = Math.PI / 3;

describe('projeção na vista', () => {
  it('na frente fica no centro; à direita, acima e atrás como devem', () => {
    const cam = { x: 0, y: 1.5, z: 0, yaw: 0, pitch: 0, fovY };
    const out = new Float64Array(3);
    expect(projectToView(cam, rect, 0, 1.5, -10, out)).toBe(true);
    expect(out[0]).toBeCloseTo(640, 6);
    expect(out[1]).toBeCloseTo(360, 6);
    expect(out[2]).toBeCloseTo(10, 6);
    projectToView(cam, rect, 2, 2.5, -10, out);
    expect(out[0]).toBeGreaterThan(640);
    expect(out[1]).toBeLessThan(360);
    expect(projectToView(cam, rect, 0, 1.5, 10, out)).toBe(false);
  });

  it('girando 90° para a esquerda, o que estava em −X vai para o centro; olhando para cima, ele desce na tela', () => {
    const out = new Float64Array(3);
    const left = { x: 0, y: 1.5, z: 0, yaw: Math.PI / 2, pitch: 0, fovY };
    projectToView(left, rect, -10, 1.5, 0, out);
    expect(out[0]).toBeCloseTo(640, 6);
    const up = { ...left, pitch: 0.2 };
    projectToView(up, rect, -10, 1.5, 0, out);
    expect(out[1]).toBeGreaterThan(360);
    // No alto da tela: o ponto tan(fov/2) acima do eixo, a 10 m.
    projectToView(left, rect, -10, 1.5 + Math.tan(fovY / 2) * 10, 0, out);
    expect(out[1]).toBeCloseTo(0, 4);
  });
});
