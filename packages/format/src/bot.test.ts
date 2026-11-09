import { describe, expect, it } from 'vitest';
import {
  BOT_FORMAT,
  BUILTIN_BOTS,
  builtinBot,
  intelligenceForLevel,
  LEVEL_ORDER,
  LEVEL_PERSONALITY_MIX,
  personalityForRoll,
  PERSONALITIES,
  PERSONALITY_PRESETS,
  resolveBot,
  validateBot,
} from './bot.ts';
import { contentIdsOfKind } from './content-ids.ts';
import { BOT_LEVELS, MATCH_RECIPE_FORMAT, validateMatchRecipe, type MatchRecipe } from './match-recipe.ts';
import { PLATFORM_PROFILES, recipeLimitsFor } from './platform-profiles.ts';
import { ISSUE_CODES } from './validation.ts';

/** M2, fase 3a: o `bot@1` (gameplay.md §6.1–§6.7), os bots de fábrica e os embutidos na receita. */

describe('bot@1', () => {
  it('os níveis na ordem da inteligência e os comportamentos cumulativos (N0..N4)', () => {
    expect(LEVEL_ORDER).toEqual([...BOT_LEVELS]);
    expect(intelligenceForLevel(0)).toMatchObject({ useCover: false, flank: false, callouts: false, learn: false });
    expect(intelligenceForLevel(1)).toMatchObject({ useCover: true, flank: false });
    expect(intelligenceForLevel(2)).toMatchObject({ flank: true, retreat: true, grenades: true, callouts: false });
    expect(intelligenceForLevel(3)).toMatchObject({ callouts: true, ambush: true, learn: false });
    expect(intelligenceForLevel(9)).toMatchObject({ level: 4, learn: true });
  });

  it('bots de fábrica: os 12 ids registrados, cada um com o seu documento; os especiais com as regras do GDD', () => {
    expect(Object.keys(BUILTIN_BOTS).sort()).toEqual(contentIdsOfKind('bot').sort());
    for (const [id, bot] of Object.entries(BUILTIN_BOTS)) {
      expect([bot.format, bot.id]).toEqual([BOT_FORMAT, id]);
      expect(validateBot(bot)).toMatchObject({ ok: true, warnings: [] });
    }
    expect(builtinBot('jorge-the-immortal')).toMatchObject({
      rules: { hp: 500, weapons: ['shotgun'] },
      personality: { preset: 'kamikaze' },
      intelligence: { level: 0 },
    });
    expect(builtinBot('knife-ninja')?.rules).toMatchObject({ weapons: ['knife'], speed: 1.4 });
    expect(builtinBot('camper-carl')?.rules.weapons).toEqual(['sniper']);
    expect(builtinBot('nao-existe')).toBeNull();
  });

  it('a mistura dos níveis: 50% Equilibrado, 20% Rusher, 15% Camper, 15% Estrategista', () => {
    expect(LEVEL_PERSONALITY_MIX.reduce((a, m) => a + m.weight, 0)).toBe(100);
    expect([0, 0.49, 0.5, 0.69, 0.7, 0.84, 0.85, 0.999].map(personalityForRoll)).toEqual([
      'balanced',
      'balanced',
      'rusher',
      'rusher',
      'camper',
      'camper',
      'strategist',
      'strategist',
    ]);
    for (const p of PERSONALITIES) expect(PERSONALITY_PRESETS[p].preset).toBe(p);
  });

  it('valida: limita à faixa com aviso, ignora tipo errado, completa o que falta; recusa o que não é bot', () => {
    const r = validateBot({
      format: BOT_FORMAT,
      id: 'meu',
      name: '  Private Pickles  ',
      skill: { reactionMs: 20, aimErrorDeg: 'muito', combatMove: 'voando' },
      intelligence: { level: 3, learn: true },
      personality: { preset: 'rusher', aggression: 2 },
      rules: { hp: 5000, weapons: ['knife'], knowledge: 'wallhack' },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = r.value;
    expect(v.name).toBe('Private Pickles');
    expect([v.skill.reactionMs, v.skill.aimErrorDeg, v.skill.combatMove]).toEqual([100, 2, 'strafe']);
    expect([v.intelligence.level, v.intelligence.callouts, v.intelligence.learn]).toEqual([3, true, true]);
    expect([v.personality.preset, v.personality.aggression, v.personality.caution]).toEqual(['rusher', 1, 0.1]);
    expect([v.rules.hp, v.rules.weapons, v.rules.knowledge, v.rules.speed]).toEqual([1000, ['knife'], 'wallhack', 1]);
    expect(r.warnings.map((w) => `${w.path}:${w.code}`)).toEqual([
      'skill.reactionMs:bot.valueClamped',
      'skill.aimErrorDeg:bot.invalidField',
      'skill.combatMove:bot.invalidField',
      'personality.aggression:bot.valueClamped',
      'rules.hp:bot.valueClamped',
    ]);
    for (const w of r.warnings) expect(ISSUE_CODES as readonly string[]).toContain(w.code);
    expect(validateBot({ format: 'boboforces/preset@1' })).toMatchObject({ ok: false });
    expect(validateBot('bot')).toMatchObject({ ok: false });
  });

  it('a receita valida os embutidos; a ref acha o de fábrica, o embutido, ou cai no Normal Bob', () => {
    const doc = {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.tdm',
      map: 'construto',
      seed: 1,
      embeddedBots: [{ format: BOT_FORMAT, id: 'b1', name: 'Sergeant Noodle', rules: { hp: 9999 } }, { format: 'x' }],
      teams: [
        {
          humans: 'all',
          bots: [
            { ref: 'embedded:b1', count: 1 },
            { ref: 'builtin:hunter-hank', count: 1 },
          ],
        },
      ],
    };
    const r = validateMatchRecipe(doc, recipeLimitsFor(PLATFORM_PROFILES.pc));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const recipe: MatchRecipe = r.value;
    expect(recipe.embeddedBots?.map((b) => [b.id, b.name, b.rules.hp])).toEqual([['b1', 'Sergeant Noodle', 1000]]);
    expect(r.warnings.map((w) => `${w.path}:${w.code}`)).toEqual([
      'embeddedBots[0].rules.hp:bot.valueClamped',
      'embeddedBots[1]:content.missingBot',
    ]);
    expect(resolveBot(recipe, 'embedded:b1').name).toBe('Sergeant Noodle');
    expect(resolveBot(recipe, 'builtin:hunter-hank').personality.preset).toBe('hunter');
    expect(resolveBot(recipe, 'embedded:sumiu').id).toBe('normal-bob');
  });
});
