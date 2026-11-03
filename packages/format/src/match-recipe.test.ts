import { describe, expect, it } from 'vitest';
import { formatId } from './format-id.ts';
import {
  builtinBotRef,
  FALLBACK_BOT_REF,
  MATCH_RECIPE_FORMAT,
  recipeBotCount,
  validateMatchRecipe,
  type MatchRecipe,
} from './match-recipe.ts';
import { PLATFORM_PROFILES, recipeLimitsFor } from './platform-profiles.ts';
import { cloneJson, ISSUE_CODES, type RecipeLimits, type ValidationResult } from './validation.ts';

const PC: RecipeLimits = recipeLimitsFor(PLATFORM_PROFILES.pc);
const MOBILE: RecipeLimits = recipeLimitsFor(PLATFORM_PROFILES.mobile);

/** Receita mínima válida (sintética). */
function base(): Record<string, unknown> {
  return {
    format: 'boboforces/preset@1',
    mode: 'warfare.tdm',
    map: 'construto',
    seed: 42,
    teams: [
      { humans: 'all', bots: [{ ref: 'builtin:normal-bob', count: 3 }] },
      { bots: [{ ref: 'builtin:normal-bob', count: 4 }] },
    ],
  };
}

function ok(r: ValidationResult<MatchRecipe>): { value: MatchRecipe; codes: string[] } {
  if (!r.ok) throw new Error(`esperava ok, veio ${JSON.stringify(r.errors)}`);
  return { value: r.value, codes: r.warnings.map((w) => w.code) };
}

function errors(r: ValidationResult<MatchRecipe>): string[] {
  if (r.ok) throw new Error('esperava erro');
  return r.errors.map((e) => e.code);
}

describe('validateMatchRecipe: caminho feliz', () => {
  it('o formato da receita acompanha o version.json', () => {
    expect(MATCH_RECIPE_FORMAT).toBe(formatId('preset'));
  });

  it('receita válida passa sem avisos e igual', () => {
    const { value, codes } = ok(validateMatchRecipe(base(), PC));
    expect(codes).toEqual([]);
    expect(value).toEqual(base());
    expect(recipeBotCount(value)).toBe(7);
  });

  it('o preset de exemplo da gameplay.md §10.4 passa e mantém os blocos ainda desconhecidos', () => {
    const preset = {
      format: 'boboforces/preset@1',
      name: 'Sexta do Jorge',
      mode: 'warfare.tdm',
      map: 'construto',
      match: { timeLimitS: 600, scoreLimit: 75, viewDistanceM: 50 },
      players: { hp: 100, regen: 'default', respawnS: 3, movement: 'bobo', camera: 'any' },
      weapons: { loadout: 'free', ammo: 'normal', damageMul: 1, ads: true },
      teams: [
        { name: 'Humanos', humans: 'all', bots: [{ ref: 'builtin:normal-bob', count: 5 }] },
        { name: 'Jorges', bots: [{ ref: 'embedded:b7f3c2', count: 8 }] },
      ],
      embeddedBots: [{ format: 'boboforces/bot@1', id: 'b7f3c2', name: 'Jorge the Immortal' }],
      director: { enabled: false },
      modifiers: ['lowGravity'],
      seed: 48213,
    };
    const { value, codes } = ok(validateMatchRecipe(preset, PC));
    expect(codes).toEqual([]);
    expect(value).toEqual(preset);
    // Campos desconhecidos continuam lá para regravar (tecnico.md §14.5).
    const loose = value as unknown as Record<string, unknown>;
    expect(loose['weapons']).toEqual(preset.weapons);
    expect((value.players as unknown as Record<string, unknown>)['camera']).toBe('any');
  });

  it('é idempotente e determinístico, e não altera a entrada', () => {
    const input = base();
    (input['teams'] as unknown[]).push({ bots: [{ ref: 'builtin:sweaty-bob', count: 99 }] });
    const snapshot = cloneJson(input);
    const a = ok(validateMatchRecipe(input, MOBILE));
    const b = ok(validateMatchRecipe(input, MOBILE));
    expect(a).toEqual(b);
    expect(input).toEqual(snapshot);
    const again = ok(validateMatchRecipe(a.value, MOBILE));
    expect(again.codes).toEqual([]);
    expect(again.value).toEqual(a.value);
  });

  it('todo código emitido está na lista ISSUE_CODES (a UI traduz cada um)', () => {
    const messy = {
      format: 'boboforces/preset@1',
      name: 42,
      mode: 'warfare.tdm',
      map: 'construto',
      seed: -1.5,
      match: { timeLimitS: 5, scoreLimit: 'x', viewDistanceM: 999 },
      players: { hp: 1, respawnS: 99, movement: 'moon' },
      teams: [
        { humans: 9, bots: [{ ref: 'builtin:ghost-bob', count: 80 }, 'lixo', { ref: 'embedded:zz' }] },
        { humans: 'all' },
        { humans: 'all', bots: 'nada' },
        { bots: [] },
        { bots: [] },
      ],
    };
    const r = validateMatchRecipe(messy, MOBILE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const w of r.warnings) expect(ISSUE_CODES as readonly string[]).toContain(w.code);
  });
});

describe('validateMatchRecipe: recusas', () => {
  it('versão maior que a conhecida é recusada com mensagem própria', () => {
    expect(errors(validateMatchRecipe({ ...base(), format: 'boboforces/preset@99' }, PC))).toEqual([
      'format.newerVersion',
    ]);
  });

  it('documento de outro tipo, sem format ou que não é objeto', () => {
    expect(errors(validateMatchRecipe({ ...base(), format: 'boboforces/bot@1' }, PC))).toEqual(['format.wrongKind']);
    const { format: _drop, ...noFormat } = base();
    void _drop;
    expect(errors(validateMatchRecipe(noFormat, PC))).toEqual(['format.missing']);
    expect(errors(validateMatchRecipe('preset', PC))).toEqual(['doc.notObject']);
  });

  it('modo ou mapa ausentes recusam (fallback de conteúdo)', () => {
    expect(errors(validateMatchRecipe({ ...base(), mode: 'warfare.ctf' }, PC))).toEqual(['content.missingMode']);
    expect(errors(validateMatchRecipe({ ...base(), map: 'lua' }, PC))).toEqual(['content.missingMap']);
    expect(errors(validateMatchRecipe({ ...base(), mode: 7, map: null }, PC))).toEqual([
      'content.missingMode',
      'content.missingMap',
    ]);
  });

  it('sem times recusa', () => {
    expect(errors(validateMatchRecipe({ ...base(), teams: [] }, PC))).toEqual(['recipe.noTeams']);
    expect(errors(validateMatchRecipe({ ...base(), teams: undefined }, PC))).toEqual(['recipe.noTeams']);
  });
});

describe('validateMatchRecipe: tetos da plataforma (regra 19)', () => {
  it('"4 vs 40" no celular (teto 12) corta do time maior e avisa', () => {
    const recipe = {
      ...base(),
      teams: [
        { humans: 'all', bots: [{ ref: 'builtin:normal-bob', count: 3 }] },
        { bots: [{ ref: 'builtin:chill-bob', count: 40 }] },
      ],
    };
    const { value, codes } = ok(validateMatchRecipe(recipe, MOBILE));
    expect(codes).toEqual(['recipe.botsOverPlatformCap']);
    expect(value.teams.map((t) => t.bots[0]!.count)).toEqual([3, 9]);
    expect(recipeBotCount(value)).toBe(12);
  });

  it('times iguais ficam iguais e misturas continuam parecidas', () => {
    const recipe = {
      ...base(),
      teams: [
        { bots: [{ ref: 'builtin:normal-bob', count: 20 }] },
        {
          bots: [
            { ref: 'builtin:normal-bob', count: 14 },
            { ref: 'builtin:tryhard-bob', count: 6 },
          ],
        },
      ],
    };
    const { value } = ok(validateMatchRecipe(recipe, MOBILE));
    expect(value.teams[0]!.bots[0]!.count).toBe(6);
    expect(value.teams[1]!.bots.map((b) => b.count)).toEqual([4, 2]);
  });

  it('o teto nunca passa da capacidade do motor', () => {
    const recipe = { ...base(), teams: [{ bots: [{ ref: builtinBotRef('vibe'), count: 64 }] }, { bots: [] }] };
    const huge: RecipeLimits = { maxBots: 1000, maxLocalHumans: 99, maxViewDistanceM: 500 };
    const { value, codes } = ok(validateMatchRecipe(recipe, huge));
    expect(codes).toEqual([]);
    expect(recipeBotCount(value)).toBe(64);
    const over = {
      ...base(),
      teams: [
        { bots: [{ ref: builtinBotRef('vibe'), count: 50 }] },
        { bots: [{ ref: builtinBotRef('vibe'), count: 50 }] },
      ],
    };
    expect(recipeBotCount(ok(validateMatchRecipe(over, huge)).value)).toBe(64);
  });

  it('alcance de visão acima do teto do perfil é cortado com aviso próprio', () => {
    const { value, codes } = ok(validateMatchRecipe({ ...base(), match: { viewDistanceM: 140 } }, MOBILE));
    expect(codes).toEqual(['recipe.viewDistanceOverPlatformCap']);
    expect(value.match?.viewDistanceM).toBe(90);
  });

  it('humanos acima do teto: por time e no total', () => {
    const recipe = {
      ...base(),
      teams: [
        { humans: 3, bots: [] },
        { humans: 3, bots: [] },
      ],
    };
    const pc = ok(validateMatchRecipe(recipe, PC));
    expect(pc.codes).toEqual(['recipe.humansOverPlatformCap']);
    expect(pc.value.teams.map((t) => t.humans)).toEqual([3, 1]);
    const mobile = ok(validateMatchRecipe(recipe, MOBILE));
    expect(mobile.value.teams.map((t) => t.humans)).toEqual([1, 0]);
  });
});

describe('validateMatchRecipe: normalização e fallback', () => {
  it('bot ausente cai no Normal; embutido sem definição também', () => {
    const recipe = {
      ...base(),
      teams: [
        { bots: [{ ref: 'builtin:jorge-bob', count: 1 }] },
        {
          bots: [
            { ref: 'embedded:nao-existe', count: 2 },
            { ref: 42, count: 1 },
          ],
        },
      ],
    };
    const { value, codes } = ok(validateMatchRecipe(recipe, PC));
    expect(codes).toEqual(['content.missingBot', 'content.missingBot', 'content.missingBot']);
    expect(value.teams[0]!.bots[0]!.ref).toBe(FALLBACK_BOT_REF);
    expect(value.teams[1]!.bots.map((b) => b.ref)).toEqual([FALLBACK_BOT_REF, FALLBACK_BOT_REF]);
  });

  it('perfil de movimento ausente cai no bobo', () => {
    const { value, codes } = ok(validateMatchRecipe({ ...base(), players: { movement: 'moon' } }, PC));
    expect(codes).toEqual(['content.missingMovement']);
    expect(value.players?.movement).toBe('bobo');
  });

  it('limita números às faixas da gameplay.md §10.3', () => {
    const recipe = {
      ...base(),
      match: { timeLimitS: 60, scoreLimit: 5000.4 },
      players: { hp: 5000, respawnS: -2 },
    };
    const { value, codes } = ok(validateMatchRecipe(recipe, PC));
    expect(codes.every((c) => c === 'recipe.valueClamped')).toBe(true);
    expect(value.match).toEqual({ timeLimitS: 180, scoreLimit: 999 });
    expect(value.players).toEqual({ hp: 1000, respawnS: 0 });
    expect(ok(validateMatchRecipe({ ...base(), match: { timeLimitS: 0 } }, PC)).value.match).toEqual({
      timeLimitS: 0,
    });
  });

  it('semente: ausente vira 0 com aviso; fora de u32 é reduzida', () => {
    const { seed: _s, ...noSeed } = base();
    void _s;
    const missing = ok(validateMatchRecipe(noSeed, PC));
    expect(missing.value.seed).toBe(0);
    expect(missing.codes).toEqual(['recipe.seedMissing']);
    const neg = ok(validateMatchRecipe({ ...base(), seed: -1 }, PC));
    expect(neg.value.seed).toBe(0xffffffff);
    expect(neg.codes).toEqual(['recipe.valueClamped']);
  });

  it('nomes: corta espaços, limita tamanho sem partir emoji, ignora tipo errado', () => {
    const long = `  ${'🙂'.repeat(50)}  `;
    const { value } = ok(validateMatchRecipe({ ...base(), name: long }, PC));
    expect(Array.from(value.name!).length).toBe(40);
    expect(value.name!.startsWith('🙂')).toBe(true);
    const bad = ok(validateMatchRecipe({ ...base(), name: { x: 1 } }, PC));
    expect(bad.value.name).toBeUndefined();
    expect(bad.codes).toEqual(['recipe.invalidField']);
  });

  it('só um time recebe "all"; times e entradas de bot acima do limite são cortados', () => {
    const many = Array.from({ length: 6 }, () => ({ humans: 'all', bots: [] }));
    const { value, codes } = ok(validateMatchRecipe({ ...base(), teams: many }, PC));
    expect(value.teams.length).toBe(4);
    expect(value.teams.filter((t) => t.humans === 'all').length).toBe(1);
    expect(codes).toContain('recipe.tooManyTeams');
    expect(codes.filter((c) => c === 'recipe.duplicateAllHumans').length).toBe(3);
    const entries = Array.from({ length: 20 }, () => ({ ref: 'builtin:vibe-bob', count: 1 }));
    const cut = ok(validateMatchRecipe({ ...base(), teams: [{ bots: entries }] }, PC));
    expect(cut.value.teams[0]!.bots.length).toBe(16);
    expect(cut.codes).toEqual(['recipe.tooManyBotEntries']);
  });

  it('entradas de bot inválidas somem com aviso; time sem bots vira lista vazia', () => {
    const recipe = { ...base(), teams: [{ humans: 1, bots: [null, { ref: 'builtin:vibe-bob' }] }, { humans: 0 }] };
    const { value, codes } = ok(validateMatchRecipe(recipe, PC));
    expect(value.teams).toEqual([
      { humans: 1, bots: [] },
      { humans: 0, bots: [] },
    ]);
    expect(codes).toEqual(['recipe.invalidField', 'recipe.invalidField']);
  });
});
