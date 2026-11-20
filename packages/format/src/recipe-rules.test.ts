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
  it('M8 (fase 5): o Diretor de Partida: o objetivo da lista passa; fora dela sai com aviso; não-objeto cai', () => {
    const ok = validateMatchRecipe(recipe({ director: { goal: 'challenge' } }), LIMITS);
    expect(ok.ok && ok.value.director).toEqual({ goal: 'challenge' });
    expect(ok.ok && ok.warnings).toEqual([]);
    const empty = validateMatchRecipe(recipe({ director: {} }), LIMITS);
    expect(empty.ok && empty.value.director).toEqual({});
    const bad = validateMatchRecipe(recipe({ director: { goal: 'easy' } }), LIMITS);
    expect(bad.ok && bad.value.director).toEqual({});
    expect(bad.ok && bad.warnings.map((w) => w.path)).toContain('director.goal');
    const junk = validateMatchRecipe(recipe({ director: 3 }), LIMITS);
    expect(junk.ok && junk.value.director).toBeUndefined();
    expect(junk.ok && junk.warnings.map((w) => w.code)).toContain('recipe.invalidField');
  });
});

describe('M9 (fase 2): o Bobo Sandbox na receita', () => {
  const four = (extra: Record<string, unknown>[]): Record<string, unknown>[] =>
    [0, 1, 2, 3].map((i) => ({ bots: [{ ref: 'builtin:normal-bob', count: 2 }], ...extra[i] }));

  it('4 times com vida e armas e o objetivo passam limpos e voltam iguais (ida e volta)', () => {
    const input = recipe({
      mode: 'sandbox',
      sandbox: { objective: 'elimination' },
      teams: four([
        { name: 'Laranja', hp: 150, weapons: ['shotgun', 'knife'] },
        { hp: 1 },
        { weapons: [] },
        { hp: 1000, weapons: ['sniper'] },
      ]),
    });
    const r = validateMatchRecipe(input, LIMITS);
    expect(r.ok && r.warnings).toEqual([]);
    if (!r.ok) return;
    expect(r.value.sandbox).toEqual({ objective: 'elimination' });
    expect(r.value.teams.map((t) => [t.hp, t.weapons])).toEqual([
      [150, ['shotgun', 'knife']],
      [1, undefined],
      [undefined, []],
      [1000, ['sniper']],
    ]);
    const again = validateMatchRecipe(JSON.parse(JSON.stringify(r.value)) as unknown, LIMITS);
    expect(again.ok && again.value).toEqual(r.value);
  });

  it('vida fora da faixa é limitada e arredondada; arma desconhecida e tipo errado saem com aviso', () => {
    const r = validateMatchRecipe(
      recipe({
        mode: 'sandbox',
        teams: four([
          { hp: 0 },
          { hp: 5000 },
          { hp: 33.6, weapons: ['shotgun', 'laser', 'shotgun', 3] },
          { hp: 'x', weapons: 'rifle' },
        ]),
      }),
      LIMITS,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.teams.map((t) => [t.hp, t.weapons])).toEqual([
      [1, undefined],
      [1000, undefined],
      [34, ['shotgun']],
      [undefined, undefined],
    ]);
    const paths = r.warnings.map((w) => `${w.path}:${w.code}`);
    expect(paths).toContain('teams[0].hp:recipe.valueClamped');
    expect(paths).toContain('teams[1].hp:recipe.valueClamped');
    expect(paths).toContain('teams[2].weapons:content.missingWeapon');
    expect(paths).toContain('teams[3].hp:recipe.invalidField');
    expect(paths).toContain('teams[3].weapons:recipe.invalidField');
    for (const w of r.warnings) expect(ISSUE_CODES as readonly string[]).toContain(w.code);
  });

  it('o objetivo fora da lista sai com aviso; o bloco fora do modo sandbox é ignorado com aviso', () => {
    const bad = validateMatchRecipe(recipe({ mode: 'sandbox', sandbox: { objective: 'capture' } }), LIMITS);
    expect(bad.ok && bad.value.sandbox).toEqual({});
    expect(bad.ok && bad.warnings.map((w) => w.path)).toContain('sandbox.objective');
    const tdm = validateMatchRecipe(recipe({ sandbox: { objective: 'none' } }), LIMITS);
    expect(tdm.ok && tdm.value.sandbox).toBeUndefined();
    expect(tdm.ok && tdm.warnings.map((w) => `${w.path}:${w.code}`)).toEqual(['sandbox:recipe.invalidField']);
    // A vida e as armas do time ficam (a sim só usa no Sandbox).
    const kept = validateMatchRecipe(recipe({ teams: [{ hp: 50, bots: [] }] }), LIMITS);
    expect(kept.ok && kept.value.teams[0]?.hp).toBe(50);
  });
});

describe('M10 (fase 8): a cor do time na receita', () => {
  const teams = (colors: unknown[]): Record<string, unknown>[] =>
    colors.map((color) => ({ bots: [{ ref: 'builtin:normal-bob', count: 1 }], ...(color !== '-' ? { color } : {}) }));
  const colorsOf = (input: unknown[]): { colors: (number | undefined)[]; warnings: string[] } => {
    const r = validateMatchRecipe(recipe({ mode: 'sandbox', teams: teams(input) }), LIMITS);
    if (!r.ok) throw new Error('recusada');
    for (const w of r.warnings) expect(ISSUE_CODES as readonly string[]).toContain(w.code);
    return { colors: r.value.teams.map((t) => t.color), warnings: r.warnings.map((w) => `${w.path}:${w.code}`) };
  };

  it('cores diferentes (de 0 a 7) passam limpas e voltam iguais (ida e volta)', () => {
    const r = validateMatchRecipe(recipe({ mode: 'sandbox', teams: teams([4, '-', 7, 0]) }), LIMITS);
    expect(r.ok && r.warnings).toEqual([]);
    if (!r.ok) return;
    expect(r.value.teams.map((t) => t.color)).toEqual([4, undefined, 7, 0]);
    const again = validateMatchRecipe(JSON.parse(JSON.stringify(r.value)) as unknown, LIMITS);
    expect(again.ok && again.value).toEqual(r.value);
    // Sem cor, nada muda (as cores da posição, sem aviso).
    expect(colorsOf(['-', '-', '-', '-'])).toEqual({
      colors: [undefined, undefined, undefined, undefined],
      warnings: [],
    });
  });

  it('fora da faixa é limitada e arredondada; tipo errado sai com aviso', () => {
    const r = colorsOf([-3, 9, 4.6, 'vermelho']);
    expect(r.colors).toEqual([0, 7, 5, undefined]);
    expect(r.warnings).toEqual([
      'teams[0].color:recipe.valueClamped',
      'teams[1].color:recipe.valueClamped',
      'teams[3].color:recipe.invalidField',
    ]);
  });

  it('dois times com a mesma cor: o de depois fica com a 1ª livre, com aviso (determinístico)', () => {
    // A escolhida repete a de outro escolhido.
    expect(colorsOf([5, 5, '-', '-'])).toEqual({
      colors: [5, 0, undefined, undefined],
      warnings: ['teams[1].color:recipe.duplicateTeamColor'],
    });
    // M10 (fase 8, revisão): a escolhida ganha da cor da posição de um time sem cor (o Azul do time 1): ele pega a
    // primeira livre.
    expect(colorsOf(['-', '-', 1]).colors).toEqual([undefined, 2, 1]);
    // A da posição de um time sem cor repete a escolhida de um anterior: ele ganha uma cor.
    expect(colorsOf([2, '-', '-'])).toEqual({
      colors: [2, undefined, 0],
      warnings: ['teams[2].color:recipe.duplicateTeamColor'],
    });
    // A faixa limita primeiro (8 vira 7) e depois a repetida troca.
    expect(colorsOf([7, 8]).colors).toEqual([7, 0]);
    const once = validateMatchRecipe(recipe({ mode: 'sandbox', teams: teams([6, 6, 6, 6]) }), LIMITS);
    expect(once.ok && once.value.teams.map((t) => t.color)).toEqual([6, 0, 1, 2]);
    const again = validateMatchRecipe(JSON.parse(JSON.stringify(once.ok && once.value)) as unknown, LIMITS);
    expect(again.ok && again.warnings).toEqual([]);
  });
});
