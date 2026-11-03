import { describe, expect, it } from 'vitest';
import {
  ENGINE_MAX_BOTS,
  PLATFORM_PROFILE_IDS,
  PLATFORM_PROFILES,
  recipeLimitsFor,
  selectPlatformProfile,
} from './platform-profiles.ts';

describe('perfis de plataforma (tecnico.md §16.1)', () => {
  it('valores iniciais da tabela', () => {
    const row = (id: keyof typeof PLATFORM_PROFILES) => {
      const p = PLATFORM_PROFILES[id];
      return [p.maxBots, p.maxZombies, p.maxViewDistanceM, p.maxDebris, p.antialias, p.targetFps];
    };
    expect(row('pc')).toEqual([40, 60, 140, 500, true, 60]);
    expect(row('pcSplit')).toEqual([24, 40, 140, 500, true, 60]);
    expect(row('mobile')).toEqual([12, 24, 90, 200, false, 30]);
    expect(row('switch1p')).toEqual([24, 30, 90, 200, false, 30]);
    expect(row('switch2p')).toEqual([16, 24, 70, 200, false, 30]);
    expect(row('switch34p')).toEqual([12, 24, 50, 120, false, 30]);
    expect(PLATFORM_PROFILES.mobile.hostMaxBots).toBe(8);
    expect(PLATFORM_PROFILES.mobile.hostMaxZombies).toBe(16);
  });

  it('coerentes: id igual à chave, dentro da capacidade do motor, Switch em 720p sem AA', () => {
    for (const id of PLATFORM_PROFILE_IDS) {
      const p = PLATFORM_PROFILES[id];
      expect(p.id).toBe(id);
      expect(p.maxBots).toBeLessThanOrEqual(ENGINE_MAX_BOTS);
      expect(p.hostMaxBots).toBeLessThanOrEqual(p.maxBots);
      expect(p.minViewports).toBeLessThanOrEqual(p.maxViewports);
      if (p.family === 'switch') {
        expect(p.fixedHeight).toBe(720);
        expect(p.antialias).toBe(false);
      }
    }
  });

  it('escolhe o perfil pela família e pelos jogadores na tela', () => {
    expect(selectPlatformProfile('pc', 1).id).toBe('pc');
    expect(selectPlatformProfile('pc', 2).id).toBe('pc');
    expect(selectPlatformProfile('pc', 3).id).toBe('pcSplit');
    expect(selectPlatformProfile('mobile', 1).id).toBe('mobile');
    expect(selectPlatformProfile('switch', 1).id).toBe('switch1p');
    expect(selectPlatformProfile('switch', 2).id).toBe('switch2p');
    expect(selectPlatformProfile('switch', 4).id).toBe('switch34p');
    expect(selectPlatformProfile('switch', 0).id).toBe('switch1p');
    expect(selectPlatformProfile('switch', 9).id).toBe('switch34p');
  });

  it('tetos da receita por perfil (host no celular tem teto menor)', () => {
    expect(recipeLimitsFor(PLATFORM_PROFILES.pc)).toEqual({ maxBots: 40, maxLocalHumans: 4, maxViewDistanceM: 140 });
    expect(recipeLimitsFor(PLATFORM_PROFILES.mobile)).toEqual({ maxBots: 12, maxLocalHumans: 1, maxViewDistanceM: 90 });
    expect(recipeLimitsFor(PLATFORM_PROFILES.mobile, { onlineHost: true }).maxBots).toBe(8);
    expect(recipeLimitsFor(PLATFORM_PROFILES.switch34p).maxBots).toBe(12);
  });
});
