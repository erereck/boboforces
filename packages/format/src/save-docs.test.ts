import { describe, expect, it } from 'vitest';
import { builtinBot } from './bot.ts';
import {
  BACKUP_FORMAT,
  createBackup,
  EMPTY_PRESET_LIBRARY,
  LIBRARY_LIMITS,
  validateBackup,
  validatePresetLibrary,
} from './backup.ts';
import { MATCH_RECIPE_FORMAT, type MatchRecipe } from './match-recipe.ts';
import { DEFAULT_SETTINGS, SETTINGS_FORMAT, validateSettings } from './settings.ts';
import { EMPTY_STATS, STATS_FORMAT, validateStats } from './stats.ts';
import { cloneJson, ISSUE_CODES, type RecipeLimits } from './validation.ts';

/** M2, fase 4b: os documentos do jogador (settings@1, stats@1, a biblioteca de presets e o backup@1). */

const LIMITS: RecipeLimits = { maxBots: 64, maxLocalHumans: 4, maxViewDistanceM: 140 };

function preset(name: string, seed = 1): MatchRecipe {
  return {
    format: MATCH_RECIPE_FORMAT,
    name,
    mode: 'warfare.tdm',
    map: 'construto',
    seed,
    teams: [
      { humans: 'all', bots: [{ ref: 'builtin:chill-bob', count: 3 }] },
      { bots: [{ ref: 'builtin:chill-bob', count: 4 }] },
    ],
  };
}

function codesKnown(warnings: readonly { code: string }[]): void {
  for (const w of warnings) expect(ISSUE_CODES as readonly string[]).toContain(w.code);
}

describe('settings@1', () => {
  it('o padrão passa limpo e ida e volta por JSON não muda nada', () => {
    const r = validateSettings(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
    expect(r.ok && r.warnings).toEqual([]);
    expect(r.ok && r.value).toEqual(DEFAULT_SETTINGS);
    // Assistência: Desligada no mouse, Média no controle e no toque (gameplay.md §10.5).
    expect(DEFAULT_SETTINGS.controls.keyboardMouse.aimAssist).toBe('off');
    expect(DEFAULT_SETTINGS.controls.gamepad.aimAssist).toBe('medium');
    expect(DEFAULT_SETTINGS.controls.touch.aimAssist).toBe('medium');
  });

  it('o que falta vem do padrão; fora da faixa é limitado; tipo errado cai no padrão; tudo com aviso conhecido', () => {
    const r = validateSettings({
      format: SETTINGS_FORMAT,
      controls: {
        gamepad: { sensitivity: 99, aimAssist: 'turbo', invertY: 'sim', deadzoneInner: 0.4, deadzoneOuter: 0.45 },
        keyboardMouse: { bindings: { tabPrev: ['key:KeyZ', 7, 'key:KeyX'] } },
      },
      video: { fovDeg: 30, uiScale: 1.2 },
      accessibility: 'nada',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const g = r.value.controls.gamepad;
    expect([g.sensitivity, g.aimAssist, g.invertY]).toEqual([5, 'medium', false]);
    // A externa nunca fica abaixo da interna + 0,1.
    expect(g.deadzoneInner).toBe(0.4);
    expect(g.deadzoneOuter).toBeCloseTo(0.5, 9);
    expect(r.value.controls.keyboardMouse.bindings).toEqual({ tabPrev: ['key:KeyZ', 'key:KeyX'] });
    expect(r.value.video).toEqual({ quality: 'auto', uiScale: 1.2, fovDeg: 60 });
    expect(r.value.accessibility).toEqual(DEFAULT_SETTINGS.accessibility);
    expect(r.value.controls.touch).toEqual(DEFAULT_SETTINGS.controls.touch);
    expect(r.warnings.length).toBeGreaterThanOrEqual(6);
    codesKnown(r.warnings);
  });

  it('recusa o que não é ajuste, e versão mais nova', () => {
    expect(validateSettings('oi').ok).toBe(false);
    expect(validateSettings({ format: STATS_FORMAT }).ok).toBe(false);
    const newer = validateSettings({ format: 'boboforces/settings@9' });
    expect(!newer.ok && newer.errors[0]!.code).toBe('format.newerVersion');
  });
});

describe('stats@1', () => {
  it('contadores inteiros ≥ 0, recordes e o que o onboarding lembra', () => {
    expect(validateStats(cloneJson(EMPTY_STATS))).toEqual({ ok: true, value: EMPTY_STATS, warnings: [] });
    const r = validateStats({
      format: STATS_FORMAT,
      totals: { matches: 3.4, kills: -2, deaths: 'x', playTimeS: 600 },
      records: { mostKills: 12 },
      onboarding: { tipsSeen: ['sprint', 5, 'ads'], seenNews: '0.0.1' },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([r.value.totals.matches, r.value.totals.kills, r.value.totals.deaths, r.value.totals.playTimeS]).toEqual([
      3, 0, 0, 600,
    ]);
    expect(r.value.records).toEqual({ mostKills: 12, bestStreak: 0 });
    expect(r.value.onboarding).toEqual({ tipsSeen: ['sprint', 'ads'], seenNews: '0.0.1' });
    codesKnown(r.warnings);
  });
});

describe('biblioteca de presets', () => {
  it('5 últimos, salvos com nome único, favoritos só de salvos; preset estragado sai com aviso', () => {
    const recent = Array.from({ length: 7 }, (_, i) => preset(`r${i}`, i));
    const r = validatePresetLibrary(
      {
        recent,
        saved: [preset('Sexta'), preset('Sexta'), { ...preset(''), name: '   ' }, { format: 'lixo' }],
        favorites: ['Sexta (2)', 'Sumiu', 'Sexta (2)'],
      },
      LIMITS,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.recent.map((p) => p.name)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
    expect(r.value.saved.map((p) => p.name)).toEqual(['Sexta', 'Sexta (2)', 'Preset 3']);
    expect(r.value.favorites).toEqual(['Sexta (2)']);
    expect(r.warnings.some((w) => w.code === 'save.droppedEntry')).toBe(true);
    codesKnown(r.warnings);
    expect(validatePresetLibrary(undefined, LIMITS)).toEqual({ ok: true, value: EMPTY_PRESET_LIBRARY, warnings: [] });
    expect(LIBRARY_LIMITS.favorites).toBe(6);
  });
});

describe('backup@1', () => {
  it('ida e volta: o que sai do jogo volta igual', () => {
    const backup = createBackup(
      {
        settings: DEFAULT_SETTINGS,
        stats: EMPTY_STATS,
        presets: { recent: [preset('última')], saved: [preset('Sexta')], favorites: ['Sexta'] },
        bots: [builtinBot('jorge-the-immortal')!],
      },
      '2026-11-09T05:00:00Z',
      '0.0.1',
    );
    const r = validateBackup(JSON.parse(JSON.stringify(backup)), LIMITS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.format).toBe(BACKUP_FORMAT);
    expect(r.value.presets.saved[0]!.name).toBe('Sexta');
    expect(r.value.bots).toHaveLength(1);
    expect(r.value.createdAt).toBe('2026-11-09T05:00:00Z');
    expect(r.warnings).toEqual([]);
  });

  it('cada parte vale sozinha: a estragada cai no padrão com aviso, o resto fica', () => {
    const r = validateBackup(
      {
        format: BACKUP_FORMAT,
        settings: { format: 'boboforces/settings@9' },
        stats: { format: STATS_FORMAT, totals: { matches: 4 } },
        presets: { saved: [preset('Boa')] },
        bots: [{ format: 'nada' }, builtinBot('knife-ninja')],
      },
      LIMITS,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.settings).toEqual(DEFAULT_SETTINGS);
    expect(r.value.stats.totals.matches).toBe(4);
    expect(r.value.presets.saved).toHaveLength(1);
    expect(r.value.bots.map((b) => b.id)).toEqual(['knife-ninja']);
    expect(r.warnings.filter((w) => w.code === 'save.droppedEntry').map((w) => w.path)).toEqual([
      'settings',
      'bots[0]',
    ]);
    expect(validateBackup({ format: STATS_FORMAT }, LIMITS).ok).toBe(false);
  });
});
