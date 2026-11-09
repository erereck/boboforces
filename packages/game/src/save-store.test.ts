import {
  builtinBot,
  DEFAULT_SETTINGS,
  EMPTY_STATS,
  LIBRARY_LIMITS,
  MATCH_RECIPE_FORMAT,
  type MatchRecipe,
} from '@boboforces/format';
import type { Storage } from '@boboforces/platform-api';
import { describe, expect, it } from 'vitest';
import { createSaveStore, libraryCapsFor, SAVE_KEYS } from './save-store.ts';

/** M2, fase 4b: o save do jogador sobre o storage da plataforma. */

function memoryStorage(initial: Record<string, string> = {}): Storage & { readonly data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: (k) => data.get(k) ?? null,
    set: (k, v) => void data.set(k, v),
    remove: (k) => void data.delete(k),
    keys: () => [...data.keys()],
    getBackup: () => null,
    flush: async () => {},
  };
}

function preset(name: string, seed = 1, bots = 3): MatchRecipe & { name: string } {
  return {
    format: MATCH_RECIPE_FORMAT,
    name,
    mode: 'warfare.tdm',
    map: 'construto',
    seed,
    teams: [
      { humans: 'all', bots: [{ ref: 'builtin:chill-bob', count: bots }] },
      { bots: [{ ref: 'builtin:chill-bob', count: 4 }] },
    ],
  };
}

describe('save do jogador', () => {
  it('sem nada salvo: os padrões, sem aviso; o que muda vai para o storage e volta igual', () => {
    const storage = memoryStorage();
    const save = createSaveStore(storage);
    expect([save.settings, save.stats, save.presets.recent, save.bots, save.loadWarnings]).toEqual([
      DEFAULT_SETTINGS,
      EMPTY_STATS,
      [],
      [],
      [],
    ]);
    save.setSettings({ ...DEFAULT_SETTINGS, video: { ...DEFAULT_SETTINGS.video, fovDeg: 95 } });
    save.setStats({ ...EMPTY_STATS, totals: { ...EMPTY_STATS.totals, matches: 2 } });
    save.savePreset(preset('Sexta'));
    const again = createSaveStore(storage);
    expect(again.settings.video.fovDeg).toBe(95);
    expect(again.stats.totals.matches).toBe(2);
    expect(again.presets.saved.map((p) => p.name)).toEqual(['Sexta']);
    expect(again.loadWarnings).toEqual([]);
  });

  it('os últimos: o mais novo em cima, sem repetir o mesmo jeito de partida (a semente muda), até 5', () => {
    const save = createSaveStore(memoryStorage());
    save.pushRecent(preset('a', 1, 3));
    save.pushRecent(preset('b', 2, 2));
    save.pushRecent(preset('a de novo', 9, 3));
    expect(save.presets.recent.map((p) => p.name)).toEqual(['a de novo', 'b']);
    for (let i = 0; i < 8; i++) save.pushRecent(preset(`x${i}`, i, 10 + i));
    expect(save.presets.recent).toHaveLength(LIBRARY_LIMITS.recent);
    expect(save.presets.recent[0]!.name).toBe('x7');
  });

  it('salvos e favoritos: o mesmo nome substitui; 6 favoritos no máximo; apagar tira o favorito', () => {
    const save = createSaveStore(memoryStorage());
    for (let i = 0; i < 7; i++) save.savePreset(preset(`p${i}`));
    save.savePreset(preset('p0', 42));
    expect(save.presets.saved).toHaveLength(7);
    expect(save.presets.saved[0]!.seed).toBe(42);
    for (let i = 0; i < 6; i++) expect(save.setFavorite(`p${i}`, true)).toBe(true);
    expect(save.setFavorite('p6', true)).toBe(false);
    expect(save.setFavorite('não existe', true)).toBe(false);
    save.deletePreset('p0');
    expect(save.presets.favorites).not.toContain('p0');
    expect(save.setFavorite('p6', true)).toBe(true);
    // Biblioteca cheia (teto do Switch: 50).
    const sw = createSaveStore(memoryStorage(), libraryCapsFor('switch'));
    for (let i = 0; i < 50; i++) expect(sw.savePreset(preset(`s${i}`))).toBe(true);
    expect(sw.savePreset(preset('mais um'))).toBe(false);
    expect(sw.savePreset(preset('s3', 7))).toBe(true);
  });

  it('save estragado: JSON quebrado e campo fora da faixa caem no padrão, com aviso por chave', () => {
    const save = createSaveStore(
      memoryStorage({
        [SAVE_KEYS.settings]: '{ quebrado',
        [SAVE_KEYS.stats]: JSON.stringify({ format: 'boboforces/stats@1', totals: { kills: -5 } }),
        [SAVE_KEYS.bots]: JSON.stringify([{ format: 'x' }, builtinBot('buddy')]),
      }),
    );
    expect(save.settings).toEqual(DEFAULT_SETTINGS);
    expect(save.stats.totals.kills).toBe(0);
    expect(save.bots.map((b) => b.id)).toEqual(['buddy']);
    expect(save.loadWarnings.map((w) => `${w.path} ${w.code}`)).toEqual([
      'settings save.droppedEntry',
      'stats.totals.kills save.valueClamped',
      'bots[0] save.droppedEntry',
    ]);
  });

  it('backup: exporta, lê e aplica (substituir troca tudo; juntar soma presets e bots e mantém os ajustes daqui)', () => {
    const a = createSaveStore(memoryStorage());
    a.setSettings({ ...DEFAULT_SETTINGS, accessibility: { ...DEFAULT_SETTINGS.accessibility, tips: false } });
    a.savePreset(preset('Sexta'));
    const text = a.exportBackup('2026-11-09T05:00:00Z', '0.0.1');

    const b = createSaveStore(memoryStorage());
    b.savePreset(preset('Sexta', 5));
    const read = b.readBackup(text);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    b.applyBackup(read.value, 'merge');
    expect(b.presets.saved.map((p) => p.name)).toEqual(['Sexta', 'Sexta (2)']);
    expect(b.settings.accessibility.tips).toBe(true);
    b.applyBackup(read.value, 'replace');
    expect(b.presets.saved.map((p) => p.name)).toEqual(['Sexta']);
    expect(b.settings.accessibility.tips).toBe(false);
    expect(b.readBackup('não é json').ok).toBe(false);
    expect(b.readBackup(JSON.stringify(DEFAULT_SETTINGS)).ok).toBe(false);
  });
});
