import { describe, expect, it } from 'vitest';
import { CONTENT_IDS, contentId, isKnownContentId, splitContentId } from './content-ids.ts';
import { CURRENT_FORMAT_VERSION, FORMAT_KINDS, formatId, parseFormatId, RETIRED_FORMAT_KINDS } from './format-id.ts';
import { BOT_LEVELS, botLevelFromRef, builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from './match-recipe.ts';
import { FORMAT_VERSIONS, GAME_CODENAME, GAME_VERSION } from './version.ts';

describe('version.json', () => {
  it('vira constantes', () => {
    expect(GAME_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(GAME_CODENAME.length).toBeGreaterThan(0);
    expect(FORMAT_VERSIONS.preset).toBe(1);
    expect(CURRENT_FORMAT_VERSION.settings).toBe(FORMAT_VERSIONS.save);
  });
});

describe('ids de formato', () => {
  it('monta e lê boboforces/<tipo>@<n>', () => {
    expect(formatId('bot')).toBe('boboforces/bot@1');
    expect(parseFormatId('boboforces/preset@3')).toEqual({ kind: 'preset', version: 3 });
    expect(parseFormatId('boboforces/nada@1')).toBeNull();
    expect(parseFormatId('novelo/1')).toBeNull();
    expect(parseFormatId(42)).toBeNull();
  });

  it('tipo aposentado não volta: fora dos tipos vivos e recusado na leitura (skinparts, #56)', () => {
    for (const kind of RETIRED_FORMAT_KINDS) {
      expect((FORMAT_KINDS as readonly string[]).includes(kind), kind).toBe(false);
      expect(parseFormatId(`boboforces/${kind}@2`), kind).toBeNull();
    }
  });
});

describe('ids de conteúdo', () => {
  it('registro sem duplicatas e com o tipo conhecido', () => {
    expect(new Set(CONTENT_IDS).size).toBe(CONTENT_IDS.length);
    for (const id of CONTENT_IDS) expect(splitContentId(id)).not.toBeNull();
    expect(contentId('weapon', 'rifle')).toBe('weapon:rifle');
    expect(isKnownContentId('map:construto')).toBe(true);
    expect(splitContentId('semtipo')).toBeNull();
  });

  it('cada nível rápido tem bot de fábrica registrado', () => {
    for (const level of BOT_LEVELS) {
      const ref = builtinBotRef(level);
      expect(botLevelFromRef(ref)).toBe(level);
      expect(isKnownContentId(`bot:${ref.slice('builtin:'.length)}`)).toBe(true);
    }
    expect(botLevelFromRef('embedded:abc')).toBeNull();
  });
});

describe('MatchRecipe@1', () => {
  it('a receita do golden cabe no contrato', () => {
    const recipe: MatchRecipe = {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.tdm',
      map: 'construto',
      seed: 42,
      teams: [
        { humans: 0, bots: [{ ref: builtinBotRef('normal'), count: 4 }] },
        { bots: [{ ref: builtinBotRef('normal'), count: 4 }] },
      ],
    };
    expect(recipe.format).toBe('boboforces/preset@1');
  });
});
