import { CHAOS_SQUEEZE, METRICS } from '@boboforces/sim';
import { describe, expect, it } from 'vitest';
import { approachScale, BODY_SCALE_FOLLOW, cameraInsideBody } from './body-scale.ts';

describe('o tamanho desenhado (M9, fase 1b)', () => {
  it('anda até a escala da sim: encolhe e cresce em ~0,2 s; sem desenho antes, ou com a Roleta, vai direto', () => {
    expect(approachScale(0, 3, 1 / 60)).toBe(3);
    expect(approachScale(1, 1, 1 / 60)).toBe(1);
    // O gigante entrando debaixo da laje (3 → 1,2): 10 por segundo, chega em 0,18 s.
    expect(approachScale(3, 1.2, 0.1)).toBeCloseTo(3 - BODY_SCALE_FOLLOW.shrinkPerS * 0.1, 12);
    expect(approachScale(3, 1.2, 0.2)).toBe(1.2);
    // Saindo (1,2 → 3): 8 por segundo, chega em 0,23 s (a hitbox já está no triplo: o boneco não fica muito atrás).
    expect(approachScale(1.2, 3, 0.1)).toBeCloseTo(1.2 + BODY_SCALE_FOLLOW.growPerS * 0.1, 12);
    expect(approachScale(1.2, 3, 0.25)).toBe(3);
    // A Roleta (a escala da máscara mudou): direto, nos dois sentidos.
    expect(approachScale(1, 3, 1 / 60, true)).toBe(3);
    expect(approachScale(3, 1, 1 / 60, true)).toBe(1);
    // Pausado (dt 0): fica.
    expect(approachScale(2, 3, 0)).toBe(2);
    let k = 3;
    for (let f = 0; f < 12; f++) k = approachScale(k, 1.2, 1 / 60);
    expect(k).toBe(1.2);
    k = 1.2;
    for (let f = 0; f < 15; f++) k = approachScale(k, 3, 1 / 60);
    expect(k).toBe(3);
  });

  it('a câmera dentro do corpo: o cilindro do tronco em escala, dos pés ao topo do desenho', () => {
    const r3 = (METRICS.aabbWidth / 2) * 3 + 0.1;
    // O gigante encostado (os eixos a 0,6 m) com o olho do jogador a 1,55 m: dentro.
    expect(cameraInsideBody(0.6, 1.55, 0, 0, 0, 0, 3)).toBe(true);
    expect(cameraInsideBody(r3 - 0.01, 1.55, 0, 0, 0, 0, 3)).toBe(true);
    expect(cameraInsideBody(r3 + 0.01, 1.55, 0, 0, 0, 0, 3)).toBe(false);
    // O normal encostado não esconde (a 0,6 m, fora do raio de 0,4 m).
    expect(cameraInsideBody(0.6, 1.55, 0, 0, 0, 0, 1)).toBe(false);
    // Acima da cabeça do gigante, ou abaixo dos pés: fora.
    expect(cameraInsideBody(0.2, CHAOS_SQUEEZE.topM * 3 + 0.2, 0, 0, 0, 0, 3)).toBe(false);
    expect(cameraInsideBody(0.2, -0.5, 0, 0, 0, 0, 3)).toBe(false);
    // Embaixo dos pés dele (o gigante em cima da cabeça do jogador): a câmera a 0,05 m da sola ainda conta.
    expect(cameraInsideBody(0.2, 1.7, 0, 0, 1.75, 0, 3)).toBe(true);
  });
});
