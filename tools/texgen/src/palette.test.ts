import { describe, expect, it } from 'vitest';
import { hue, luma, PALETTE, RAMPS, ramp, saturation, TEAM_COLOR_SET } from './palette.ts';

/** Distância circular do matiz até o amarelo (60°). */
const toYellow = (rgb: number): number => {
  const d = Math.abs(hue(rgb) - 60) % 360;
  return d > 180 ? 360 - d : d;
};
const chroma = (c: number): number =>
  Math.max(c >> 16, (c >> 8) & 0xff, c & 0xff) - Math.min(c >> 16, (c >> 8) & 0xff, c & 0xff);

describe('paleta mestra', () => {
  it('tem 64 cores sem repetição', () => {
    expect(PALETTE.length).toBe(64);
    expect(new Set(PALETTE).size).toBe(64);
  });

  it('mantém os nomes de rampa do M0 (as outras frentes chamam ramp(nome))', () => {
    expect(RAMPS.map((r) => r.name)).toEqual([
      'concreto',
      'placa',
      'metal',
      'aco',
      'madeira',
      'lona',
      'terra',
      'grama',
      'areia',
      'tijolo',
      'laranja',
      'amarelo',
      'pele',
      'emissivo',
      'neutro',
      'time',
    ]);
  });

  it('rampas de material com 4 a 6 tons; acentos com 3 ou 4', () => {
    for (const r of RAMPS) {
      if (r.use === 'cenario' || r.use === 'bobo') {
        expect(r.colors.length, r.name).toBeGreaterThanOrEqual(4);
        expect(r.colors.length, r.name).toBeLessThanOrEqual(6);
      }
      if (r.use === 'acento') expect([3, 4]).toContain(r.colors.length);
    }
  });

  it('pele, emissivo, neutro e time não mudaram desde o M0 (skins e UI usam os mesmos hex)', () => {
    expect(ramp('pele')).toEqual([0x5b3b36, 0x8f5e4b, 0xc48a68, 0xe6b78f]);
    expect(ramp('emissivo')).toEqual([0x9ee8ff, 0xffd56b, 0xfff1b8]);
    expect(ramp('neutro')).toEqual([0x000000, 0xffffff]);
    expect(ramp('time')).toEqual([0xff7a1a, 0x2e8bff, 0x3ddc97, 0xa66bff]);
    expect([...TEAM_COLOR_SET]).toEqual([...ramp('time')]);
  });

  it('rampas vão do escuro para o claro', () => {
    for (const r of RAMPS) {
      if (r.use === 'time' || r.use === 'emissivo') continue;
      for (let i = 1; i < r.colors.length; i++)
        expect(luma(r.colors[i]!), r.name).toBeGreaterThan(luma(r.colors[i - 1]!));
    }
  });

  it('reserva de saturação: cenário até ~60%, acentos até ~70%, times acima de todo o cenário', () => {
    const sceneryMax = Math.max(...RAMPS.filter((r) => r.use === 'cenario').flatMap((r) => r.colors.map(chroma)));
    for (const r of RAMPS) {
      for (const c of r.colors) {
        if (r.use === 'cenario') expect(saturation(c), `${r.name} #${c.toString(16)}`).toBeLessThanOrEqual(0.62);
        if (r.use === 'acento') expect(saturation(c), `${r.name} #${c.toString(16)}`).toBeLessThanOrEqual(0.7);
        // O roxo D é vivo mas tem saturação HSV baixa: por isso o critério é o croma (max − min do RGB).
        if (r.use === 'time') expect(chroma(c), `${r.name} #${c.toString(16)}`).toBeGreaterThan(sceneryMax + 20);
      }
    }
  });

  it('Construto neutro: concreto, placa e aço quase cinza; laranja e oliva só como acento e material', () => {
    for (const name of ['concreto', 'placa', 'aco'] as const)
      for (const c of ramp(name)) expect(saturation(c), `${name} #${c.toString(16)}`).toBeLessThanOrEqual(0.33);
  });

  it('hue shift: o tom escuro fica mais longe do amarelo que o claro', () => {
    for (const r of RAMPS) {
      if (r.use !== 'cenario') continue;
      expect(toYellow(r.colors[0]!), r.name).toBeGreaterThanOrEqual(toYellow(r.colors[r.colors.length - 1]!));
    }
  });

  it('preto puro existe só na rampa neutra', () => {
    for (const r of RAMPS) if (r.name !== 'neutro') expect(r.colors).not.toContain(0x000000);
    expect(ramp('neutro')).toContain(0x000000);
  });
});
