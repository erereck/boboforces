import { builtinBotRef, MATCH_RECIPE_FORMAT, PLATFORM_PROFILES, type MatchRecipe } from '@boboforces/format';
import { describe, expect, it } from 'vitest';
import { playableOn, soloViewMode } from './maps.ts';
import { roomPreset, roomRecipeFor } from './online-presets.ts';
import type { SceneRequest } from './scene-api.ts';
import { couchJoinAllowed, profileFor, sceneRecipe, sceneViews } from './scene/match.ts';

/**
 * M11 (fase 5, revisão): o Bobo Royale Grande nunca abre com mais de uma vista nem fora do PC. O menu pula ou recusa
 * antes da cena (o `game.test.ts` prova pelo jogo: o sofá no PC e o JOGAR no celular); aqui, as peças puras.
 */
const grande: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'royale.grande',
  map: 'archipelago',
  seed: 0,
  royale: { squad: 'solo' },
  teams: [{ humans: 'all', bots: [{ ref: builtinBotRef('normal'), count: 47 }] }],
};
const tdm: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'warfare.tdm',
  map: 'construto',
  seed: 0,
  teams: [{ humans: 'all', bots: [{ ref: builtinBotRef('normal'), count: 3 }] }, { bots: [] }],
};
const pad = (index: number, side = 0) => ({ device: { kind: 'gamepad' as const, index }, side });
const request = (recipe: MatchRecipe, seats: number): SceneRequest => ({
  kind: 'play',
  bench: null,
  benchWarnings: [],
  seed: 3,
  convention: undefined as unknown as SceneRequest['convention'],
  device: null,
  gamepad: 0,
  recipe,
  ...(seats > 0 ? { seats: Array.from({ length: seats }, (_, i) => pad(i, i % 2)) } : {}),
});

describe('o Royale Grande fora do PC e no sofá', () => {
  it('só o PC roda o Grande; os outros modos rodam em todo aparelho', () => {
    expect(playableOn(grande, 'pc')).toBe(true);
    expect(playableOn(grande, 'mobile')).toBe(false);
    expect(playableOn(grande, 'switch')).toBe(false);
    expect(playableOn(tdm, 'mobile')).toBe(true);
    expect(soloViewMode('royale.grande') && !soloViewMode('royale.mini')).toBe(true);
  });

  it('do sofá com 3 controles, a cena abre o Grande com 1 vista no perfil do PC (o pcSplit recusaria)', () => {
    const r = request(grande, 3);
    expect(sceneViews(r)).toBe(1);
    expect(sceneViews(request(tdm, 3))).toBe(3);
    const profile = profileFor('pc', sceneViews(r), null);
    expect(profile.id).toBe('pc');
    const s = sceneRecipe(r, profile);
    expect(s.humans).toBe(1);
    expect(s.recipe.teams[0]!.bots[0]!.count).toBe(47);
    // O que a revisão viu: com o perfil de 3 vistas, a receita é recusada (por isso as vistas vêm do modo).
    expect(() => sceneRecipe(r, PLATFORM_PROFILES.pcSplit)).toThrow(/modeNotOnPlatform/);
  });

  it('ninguém entra no meio do Grande pelo sofá (no TDM, sim)', () => {
    expect(couchJoinAllowed(request(grande, 1), grande, 1)).toBe(false);
    expect(couchJoinAllowed(request(tdm, 1), tdm, 1)).toBe(true);
    expect(couchJoinAllowed(request(tdm, 0), tdm, 1)).toBe(false);
  });

  it('a sala com host fora do PC troca o Grande pelo Times; com host no PC, joga', () => {
    const g = roomPreset('royaleGrande');
    expect(roomRecipeFor(g, 'pc')).toBe(g);
    expect(roomRecipeFor(g, 'mobile').mode).toBe('warfare.tdm');
    expect(roomRecipeFor(g, 'switch').mode).toBe('warfare.tdm');
    expect(roomRecipeFor(tdm, 'mobile')).toBe(tdm);
  });
});
