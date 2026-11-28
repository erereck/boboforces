import { WEAPON_CODE } from '@boboforces/sim';
import { describe, expect, it } from 'vitest';
import {
  cyclesAfterShot,
  foleyPitch,
  hash2,
  heartGain,
  heartInterval,
  hitStreakPitch,
  hurtPan,
  impactPitch,
  isLowHealth,
  killStreakPitch,
  lowMagPitch,
  shotGain,
  shotPitch,
  SOUND_FEEL,
  whizOut,
  whizPoint,
} from './sound-feel.ts';

/** M12 (fase 4): as contas pequenas do refino do som. */

describe('variação por hash (sem Math.random)', () => {
  it('o tom de cada tiro fica em 0,96–1,04 e o volume em −1–0 dB, e repete para o mesmo tick e atirador', () => {
    const pitches = new Set<string>();
    for (let t = 0; t < 200; t++) {
      const p = shotPitch(t, 65537);
      const g = shotGain(t, 65537);
      expect(p).toBeGreaterThanOrEqual(0.96);
      expect(p).toBeLessThanOrEqual(1.04);
      expect(g).toBeGreaterThanOrEqual(10 ** (-1 / 20) - 1e-12);
      expect(g).toBeLessThanOrEqual(1);
      pitches.add(p.toFixed(3));
    }
    expect(pitches.size).toBeGreaterThan(40);
    expect(shotPitch(77, 65538)).toBe(shotPitch(77, 65538));
  });

  it('o impacto ±8% pela célula, espalhado também com coordenadas grandes', () => {
    const seen = new Set<string>();
    for (let x = 0; x < 50; x++) {
      const r = impactPitch(600 + x, 30, 700, 0);
      expect(r).toBeGreaterThanOrEqual(0.92);
      expect(r).toBeLessThanOrEqual(1.08);
      seen.add(r.toFixed(3));
    }
    expect(seen.size).toBeGreaterThan(40);
  });

  it('o hash em 32 bits dá o mesmo de antes com números pequenos', () => {
    const old = (a: number, b: number): number => Math.imul((a * 0x9e3779b1) ^ (b * 0x85ebca6b), 0xc2b2ae35) >>> 0;
    for (const [a, b] of [
      [0, 0],
      [12, 7],
      [3600, 31],
      [216000, 4],
    ] as const)
      expect(hash2(a, b)).toBe(old(a, b));
  });
});

describe('vida baixa e o coração', () => {
  it('o limite é 30% da vida máxima (o mesmo da vinheta da HUD)', () => {
    expect(isLowHealth(30, 100)).toBe(true);
    expect(isLowHealth(31, 100)).toBe(false);
    expect(isLowHealth(0, 100)).toBe(false);
    expect(isLowHealth(90, 300)).toBe(true);
  });

  it('de 1 s em 30% a 0,55 s com 10% ou menos, e o volume de 0,6 ao cheio', () => {
    expect(heartInterval(30, 100)).toBeCloseTo(1, 9);
    expect(heartInterval(20, 100)).toBeCloseTo(0.775, 9);
    expect(heartInterval(10, 100)).toBeCloseTo(0.55, 9);
    expect(heartInterval(3, 100)).toBeCloseTo(0.55, 9);
    expect(heartGain(30, 100)).toBeCloseTo(0.6, 9);
    expect(heartGain(5, 100)).toBeCloseTo(1, 9);
  });
});

describe('o lado do dano', () => {
  it('pelo contrário da direção do tiro, em relação à mira, a 70%', () => {
    // O ouvinte olha para −z (yaw 0); o tiro vai para +x: veio da esquerda.
    expect(hurtPan(1, 0, 0)).toBeCloseTo(-SOUND_FEEL.hurtPanWidth, 9);
    expect(hurtPan(-1, 0, 0)).toBeCloseTo(SOUND_FEEL.hurtPanWidth, 9);
    // De frente (o tiro vem andando para +z, na direção do ouvinte): no meio.
    expect(hurtPan(0, 1, 0)).toBeCloseTo(0, 9);
    // Sem direção (a queda, a zona): no meio.
    expect(hurtPan(0, 0, 0)).toBe(0);
    // Virado 90° para a esquerda (yaw +π/2, olhando para −x): o tiro que vem de −x fica na frente.
    expect(hurtPan(1, 0, Math.PI / 2)).toBeCloseTo(0, 9);
  });
});

describe('as sequências', () => {
  it('o plic sobe 3% por acerto, até +15%; o abate 1; 1,06; 1,12; 1,19', () => {
    expect([0, 1, 2, 5, 9].map(hitStreakPitch)).toEqual([1, 1.03, 1.06, 1.15, 1.15]);
    expect([0, 1, 2, 3, 7].map(killStreakPitch)).toEqual([1, 1.06, 1.12, 1.19, 1.19]);
  });

  it('o tique nas 3 últimas balas (ou no último quarto do pente pequeno), o tom subindo', () => {
    expect([3, 2, 1, 0].map((c) => lowMagPitch(c, 30))).toEqual([0, 1, 1.12, 1.24]);
    // A sniper (5): só a última; a escopeta (6): as 2 últimas; armas de 1 ou 2 tiros, nunca.
    expect([1, 0].map((c) => lowMagPitch(c, 5))).toEqual([0, 1]);
    expect([2, 1, 0].map((c) => lowMagPitch(c, 6))).toEqual([0, 1, 1.12]);
    expect(lowMagPitch(0, 1)).toBe(0);
  });
});

describe('o foley por classe', () => {
  it('a pistola mais aguda, as pesadas mais graves; o pump e o ferrolho', () => {
    expect(foleyPitch(WEAPON_CODE.pistol)).toBe(1.15);
    expect(foleyPitch(WEAPON_CODE.lmg)).toBe(0.88);
    expect(foleyPitch(WEAPON_CODE.sniper)).toBe(0.88);
    expect(foleyPitch(WEAPON_CODE.shotgun)).toBe(0.88);
    expect(foleyPitch(WEAPON_CODE.rifle)).toBe(1);
    expect(cyclesAfterShot(WEAPON_CODE.shotgun)).toBe(true);
    expect(cyclesAfterShot(WEAPON_CODE.sniper)).toBe(true);
    expect(cyclesAfterShot(WEAPON_CODE.autoShotgun)).toBe(false);
    expect(cyclesAfterShot(WEAPON_CODE.rifle)).toBe(false);
  });
});

describe('o zunido', () => {
  it('a bala passa a menos de 1,5 m da cabeça, de 3 m do cano até 1 m antes do fim', () => {
    // Do (0; 0; 0) para +z; a cabeça em (1; 0; 10).
    expect(whizPoint(0, 0, 0, 0, 0, 1, 50, 1, 0, 10)).toBeCloseTo(1, 9);
    expect([whizOut.x, whizOut.y, whizOut.z]).toEqual([0, 0, 10]);
    expect(whizPoint(0, 0, 0, 0, 0, 1, 50, 2, 0, 10)).toBe(-1);
    // Perto do cano (2 m) e o raio que acaba em você (o acerto): sem zunido.
    expect(whizPoint(0, 0, 0, 0, 0, 1, 50, 1, 0, 2)).toBe(-1);
    expect(whizPoint(0, 0, 0, 0, 0, 1, 10.4, 1, 0, 10)).toBe(-1);
  });
});
