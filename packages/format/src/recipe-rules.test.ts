import { describe, expect, it } from 'vitest';
import { MATCH_RECIPE_FORMAT, validateMatchRecipe } from './match-recipe.ts';
import { ISSUE_CODES, type RecipeLimits } from './validation.ts';

/** M2, fase 4e: os blocos de regras da receita (players ampliado, weapons e hud). */

const LIMITS: RecipeLimits = { maxBots: 40, maxLocalHumans: 4, maxViewDistanceM: 140 };

function recipe(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'construto',
    seed: 1,
    teams: [{ humans: 'all', bots: [] }, { bots: [{ ref: 'builtin:normal-bob', count: 2 }] }],
    ...extra,
  };
}

describe('regras da receita (fase 4e)', () => {
  it('valores válidos passam limpos', () => {
    const r = validateMatchRecipe(
      recipe({
        players: { hp: 150, regen: 'fast', spawnProtectionS: 2, gravity: 0.5, fallDamage: false },
        weapons: {
          damageMul: 2,
          headshotOnly: true,
          oneShot: false,
          ammo: 'infiniteClip',
          ads: false,
          recoil: false,
          spread: false,
          friendlyFire: 0.5,
          selfDamage: false,
          sniperBodyKill: true,
          allowed: ['shotgun', 'knife'],
          aimAssist: false,
        },
        hud: { killFeed: false, hitmarker: true, allyMarkers: false },
      }),
      LIMITS,
    );
    expect(r.ok && r.warnings).toEqual([]);
    expect(r.ok && r.value.weapons?.allowed).toEqual(['shotgun', 'knife']);
    expect(r.ok && r.value.players?.gravity).toBe(0.5);
    expect(r.ok && r.value.hud).toEqual({ killFeed: false, hitmarker: true, allyMarkers: false });
  });

  it('fora da faixa é limitado; tipo errado, fogo amigo fora da lista e arma desconhecida saem com aviso', () => {
    const r = validateMatchRecipe(
      recipe({
        players: { gravity: 9, spawnProtectionS: -1, regen: 'turbo', fallDamage: 'sim' },
        weapons: { damageMul: 0.01, friendlyFire: 0.3, allowed: ['shotgun', 'laser', 7], ads: 1 },
        hud: 'nada',
      }),
      LIMITS,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.players).toEqual({ gravity: 2, spawnProtectionS: 0 });
    expect(r.value.weapons).toEqual({ damageMul: 0.25, allowed: ['shotgun'] });
    expect(r.value.hud).toBeUndefined();
    const codes = r.warnings.map((w) => w.code);
    expect(codes).toContain('recipe.valueClamped');
    expect(codes).toContain('recipe.invalidField');
    expect(codes).toContain('content.missingWeapon');
    for (const c of codes) expect(ISSUE_CODES as readonly string[]).toContain(c);
  });

  it('M2 (fase 6a): perfil de movimento e os multiplicadores do Personalizado, limitados às faixas', () => {
    const ok = validateMatchRecipe(recipe({ players: { movement: 'custom', speed: 1.5, jump: 2 } }), LIMITS);
    expect(ok.ok && ok.warnings).toEqual([]);
    expect(ok.ok && ok.value.players).toEqual({ movement: 'custom', speed: 1.5, jump: 2 });
    const clamped = validateMatchRecipe(recipe({ players: { movement: 'tactical', speed: 9, jump: 0.1 } }), LIMITS);
    expect(clamped.ok && clamped.value.players).toEqual({ movement: 'tactical', speed: 2, jump: 0.5 });
  });

  it('M2 (fase 6b): a câmera permitida; valor fora da lista sai com aviso', () => {
    const ok = validateMatchRecipe(recipe({ players: { camera: 'first' } }), LIMITS);
    expect(ok.ok && ok.value.players).toEqual({ camera: 'first' });
    const bad = validateMatchRecipe(recipe({ players: { camera: 'drone' } }), LIMITS);
    expect(bad.ok && bad.value.players).toEqual({});
    expect(bad.ok && bad.warnings.map((w) => w.code)).toContain('recipe.invalidField');
  });
});
