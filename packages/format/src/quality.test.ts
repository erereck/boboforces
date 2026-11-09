import { describe, expect, it } from 'vitest';
import { PLATFORM_PROFILES } from './platform-profiles.ts';
import {
  effectiveQuality,
  guessQuality,
  isWeakGpu,
  lowerQuality,
  qualityKnobs,
  shouldLowerQuality,
  type DeviceSample,
} from './quality.ts';
import { DEFAULT_SETTINGS, validateSettings } from './settings.ts';

const pc = (gpu: string, cores = 8, memoryGb = 8): DeviceSample => ({ family: 'pc', gpu, cores, memoryGb });
const phone = (gpu: string, cores = 8, memoryGb = 6): DeviceSample => ({ family: 'mobile', gpu, cores, memoryGb });

describe('qualidade (fase 8b)', () => {
  it('a tabela nunca passa do perfil e não mexe na resolução do Switch', () => {
    expect(qualityKnobs(PLATFORM_PROFILES.pc, 'high')).toEqual({ maxPixelRatio: 2, renderScale: 1, maxDebris: 500 });
    expect(qualityKnobs(PLATFORM_PROFILES.pc, 'medium')).toEqual({
      maxPixelRatio: 1.5,
      renderScale: 1,
      maxDebris: 200,
    });
    expect(qualityKnobs(PLATFORM_PROFILES.mobile, 'low')).toEqual({
      maxPixelRatio: 1,
      renderScale: 0.85,
      maxDebris: 200,
    });
    const sw = qualityKnobs(PLATFORM_PROFILES.switch34p, 'low');
    expect(sw.maxPixelRatio).toBe(1);
    expect(sw.renderScale).toBe(1);
    expect(sw.maxDebris).toBe(120);
  });

  it('GPUs fracas da lista caem no Leve', () => {
    expect(isWeakGpu('ANGLE (ARM, Mali-G52 MC2, OpenGL ES 3.2)')).toBe(true);
    expect(isWeakGpu('Adreno (TM) 610')).toBe(true);
    expect(isWeakGpu('Adreno (TM) 618')).toBe(false);
    expect(isWeakGpu('ANGLE (Intel, Intel(R) HD Graphics 620 Direct3D11 vs_5_0 ps_5_0)')).toBe(true);
    expect(isWeakGpu('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0)')).toBe(false);
    expect(isWeakGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))')).toBe(true);
    expect(guessQuality(phone('Mali-G57 MC2'))).toBe('low');
  });

  it('escolha pela leitura do aparelho', () => {
    expect(guessQuality(pc('ANGLE (NVIDIA, NVIDIA GeForce RTX 2050 Direct3D11)'))).toBe('high');
    expect(guessQuality(pc('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)'))).toBe('medium');
    expect(guessQuality(pc('ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11)'))).toBe('high');
    expect(guessQuality(pc('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11)'))).toBe('medium');
    expect(guessQuality(pc('desconhecida', 2, 8))).toBe('low');
    // Celular: GPU escondida (Brave) decide pela memória e pelos núcleos.
    expect(guessQuality(phone('desconhecida', 8, 4))).toBe('low');
    expect(guessQuality(phone('desconhecida', 8, 8))).toBe('medium');
    expect(guessQuality(phone('desconhecida', 0, 0))).toBe('medium');
    expect(guessQuality({ family: 'switch', gpu: 'NV120', cores: 0, memoryGb: 0 })).toBe('high');
  });

  it('o escolhido pelo jogador vence o automático; sem escolha, o padrão da família', () => {
    const v = DEFAULT_SETTINGS.video;
    expect(effectiveQuality(v, 'pc')).toBe('high');
    expect(effectiveQuality(v, 'mobile')).toBe('medium');
    expect(effectiveQuality({ ...v, autoQuality: 'low' }, 'pc')).toBe('low');
    expect(effectiveQuality({ ...v, quality: 'high', autoQuality: 'low' }, 'mobile')).toBe('high');
    expect(lowerQuality('high')).toBe('medium');
    expect(lowerQuality('low')).toBe('low');
  });

  it('a 1ª partida baixa um nível com mais de 10% de quadros lentos', () => {
    expect(shouldLowerQuality(600, 60)).toBe(false);
    expect(shouldLowerQuality(600, 61)).toBe(true);
    expect(shouldLowerQuality(0, 0)).toBe(false);
  });

  it('o save antigo sem `autoQuality` abre sem aviso; valor estranho volta ao padrão', () => {
    const old = { ...DEFAULT_SETTINGS, video: { quality: 'auto', uiScale: 1 } };
    const r = validateSettings(old);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.video.autoQuality).toBe('none');
      expect(r.warnings).toEqual([]);
    }
    const bad = validateSettings({ ...DEFAULT_SETTINGS, video: { ...DEFAULT_SETTINGS.video, autoQuality: 'ultra' } });
    expect(bad.ok && bad.value.video.autoQuality).toBe('none');
  });
});
