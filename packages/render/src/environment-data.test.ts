import { describe, expect, it } from 'vitest';
import { TIME_OF_DAY_PRESETS } from './environment.ts';
import { GLSL_COMMON_VERTEX } from './shared/glsl-common.ts';
import { buildGradeLut, emissiveLayerBits, fogRange, GRADE_LUT_SIZE } from './environment-data.ts';

describe('LUT de grading', () => {
  it('cada preset dá uma curva crescente por canal, de ~0 a ~255, alfa cheio', () => {
    for (const [name, preset] of Object.entries(TIME_OF_DAY_PRESETS)) {
      const lut = buildGradeLut(preset, new Uint8Array(GRADE_LUT_SIZE * 4));
      for (let c = 0; c < 3; c++) {
        expect(lut[c], name).toBeLessThanOrEqual(4);
        expect(lut[(GRADE_LUT_SIZE - 1) * 4 + c], name).toBeGreaterThanOrEqual(250);
        for (let i = 1; i < GRADE_LUT_SIZE; i++) {
          expect(lut[i * 4 + c]!, `${name} canal ${c} em ${i}`).toBeGreaterThanOrEqual(lut[(i - 1) * 4 + c]! - 1);
        }
      }
      for (let i = 0; i < GRADE_LUT_SIZE; i++) expect(lut[i * 4 + 3]).toBe(255);
    }
  });

  it('a noite puxa as sombras para o azul e o entardecer as luzes para o quente', () => {
    const night = buildGradeLut(TIME_OF_DAY_PRESETS.night, new Uint8Array(GRADE_LUT_SIZE * 4));
    const dusk = buildGradeLut(TIME_OF_DAY_PRESETS.dusk, new Uint8Array(GRADE_LUT_SIZE * 4));
    const shadow = 64 * 4;
    const light = 200 * 4;
    expect(night[shadow + 2]).toBeGreaterThan(night[shadow]!);
    expect(dusk[light]).toBeGreaterThan(dusk[light + 2]!);
  });
});

describe('fog por vista', () => {
  it('termina no menor entre o plano distante e o alcance da partida', () => {
    const out = { near: 0, far: 0 };
    expect(fogRange(90, 50, 0.5, out)).toEqual({ near: 25, far: 50 });
    expect(fogRange(50, 140, 0.45, out).far).toBe(50);
    expect(fogRange(70, 0, 0.4, out).far).toBe(70);
  });
});

describe('camadas emissivas', () => {
  it('liga o bit de cada camada com kind emissive (256 bits em 8 palavras)', () => {
    const kinds = Array.from({ length: 200 }, (_, i) => ({
      kind: i === 3 || i === 37 || i === 160 ? 'emissive' : 'opaque',
    }));
    const bits = emissiveLayerBits(kinds, new Int32Array(8));
    expect(bits[0]).toBe(1 << 3);
    expect(bits[1]).toBe(1 << 5);
    expect(bits[5]).toBe(1);
    expect(bits[7]).toBe(0);
  });
});

describe('M12 (fase 5, revisão): o piso de luz só vale com o céu escuro', () => {
  // A mesma conta do `bfSceneLight` (glsl-common.ts): luminância do céu da hora × força.
  const dark = (p: (typeof TIME_OF_DAY_PRESETS)['day']): number => {
    const c = p.skyLightColor;
    const l = (0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255)) / 255;
    return Math.max(0, Math.min(1, (0.5 - l * p.skyStrength) * 5));
  };

  it('dia 0 (a conta de antes), entardecer no meio, noite inteiro', () => {
    expect(dark(TIME_OF_DAY_PRESETS.day)).toBe(0);
    expect(dark(TIME_OF_DAY_PRESETS.dusk)).toBeGreaterThan(0.3);
    expect(dark(TIME_OF_DAY_PRESETS.dusk)).toBeLessThan(0.9);
    expect(dark(TIME_OF_DAY_PRESETS.night)).toBe(1);
  });

  it('o shader tem a mesma conta (piso × AO × céu escuro)', () => {
    expect(GLSL_COMMON_VERTEX).toContain('vec3(0.299, 0.587, 0.114)) * uSkyStrength) * 5.0, 0.0, 1.0)');
    expect(GLSL_COMMON_VERTEX).toContain('lit = max(lit, vec3(BF_LIGHT_FLOOR * ao * dark));');
  });
});
