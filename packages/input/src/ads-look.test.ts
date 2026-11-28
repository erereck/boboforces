import { describe, expect, it } from 'vitest';
import { adsLookScale } from './ads-look.ts';

describe('M12 (fase 6): a sensibilidade do ADS pelo zoom', () => {
  it('fora do ADS é 1; dentro, tan(fovADS/2)/tan(fovQuadril/2) vezes o ajuste do jogador', () => {
    expect(adsLookScale(1, 0, 4)).toBe(1);
    expect(adsLookScale(0.5, 0, 4)).toBe(1);
    // A sniper (4×): a mira gira 1/4 do quadril, e anda na tela na mesma velocidade.
    expect(adsLookScale(1, 1, 4)).toBeCloseTo(0.25, 12);
    const hip = (70 * Math.PI) / 180;
    const ads = 2 * Math.atan(Math.tan(hip / 2) / 4);
    expect(adsLookScale(1, 1, 4)).toBeCloseTo(Math.tan(ads / 2) / Math.tan(hip / 2), 12);
    // O ajuste do jogador multiplica (×1,5 = 50% mais rápido na tela que no quadril).
    expect(adsLookScale(1.5, 1, 1.25)).toBeCloseTo(1.5 / 1.25, 12);
    // Arma sem zoom (1×): só o ajuste.
    expect(adsLookScale(0.75, 1, 1)).toBeCloseTo(0.75, 12);
  });

  it('segue o quanto o ADS já entrou (o mesmo blend do FOV), sem salto no aperto', () => {
    const half = adsLookScale(1, 0.5, 4);
    // Zoom de 2,5× na metade do caminho.
    expect(half).toBeCloseTo(1 / 2.5, 12);
    let prev = 1;
    for (let b = 0; b <= 1.0001; b += 0.1) {
      const s = adsLookScale(1, b, 4);
      expect(s).toBeLessThanOrEqual(prev + 1e-12);
      prev = s;
    }
    // Fora da faixa, limita.
    expect(adsLookScale(1, 2, 4)).toBeCloseTo(0.25, 12);
    expect(adsLookScale(1, -1, 4)).toBe(1);
  });
});
