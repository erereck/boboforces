import {
  BUILTIN_BOTS,
  MATCH_RECIPE_FORMAT,
  recipeLimitsFor,
  selectPlatformProfile,
  type MatchRecipe,
} from '@boboforces/format';
import type { Storage } from '@boboforces/platform-api';
import { describe, expect, it } from 'vitest';
import { exportBackup } from './save-backup.ts';
import { createSaveStore, libraryCapsFor } from './save-store.ts';
import { importWorkshopFiles, WORKSHOP_FILE_MAX_BYTES } from './workshop-files.ts';

/** Fixtures sintéticas (regra 4): um bot copiado de um de fábrica com id e nome novos, e um preset de times. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get: (k) => data.get(k) ?? null,
    set: (k, v) => void data.set(k, v),
    remove: (k) => void data.delete(k),
    keys: () => [...data.keys()],
    getBackup: () => null,
    flush: async () => {},
  };
}

const bot = { ...BUILTIN_BOTS['chill-bob']!, id: 'pc-bot-1', name: 'Bobo do PC' };
const preset: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  name: 'Do PC',
  mode: 'warfare.tdm',
  map: 'construto',
  seed: 7,
  teams: [
    { humans: 'all', bots: [{ ref: 'builtin:chill-bob', count: 3 }] },
    { bots: [{ ref: 'builtin:chill-bob', count: 4 }] },
  ],
};
const limits = recipeLimitsFor(selectPlatformProfile('switch', 1));

describe('pasta oficina/ do SD (M4, fase 2c)', () => {
  it('bot e preset entram; JSON quebrado, formato desconhecido e arquivo grande ficam no registro', () => {
    const save = createSaveStore(memoryStorage(), libraryCapsFor('switch'));
    const got = importWorkshopFiles(
      [
        { name: 'bot.json', text: JSON.stringify(bot) },
        { name: 'preset.json', text: JSON.stringify(preset) },
        { name: 'quebrado.json', text: '{ "format": ' },
        { name: 'outro.json', text: JSON.stringify({ format: 'boboforces/settings@1' }) },
        { name: 'sem-format.json', text: '{}' },
        {
          name: 'grande.json',
          text: JSON.stringify({ ...bot, id: 'grande', pad: 'a'.repeat(WORKSHOP_FILE_MAX_BYTES) }),
        },
      ],
      save,
      limits,
    );
    expect([got.bots, got.presets]).toEqual([1, 1]);
    expect(save.bots.map((b) => b.id)).toContain('pc-bot-1');
    expect(save.presets.saved.map((p) => p.name)).toContain('Do PC');
    expect(got.lines).toEqual([
      'oficina: quebrado.json ignorado (não é JSON)',
      'oficina: outro.json ignorado (formato boboforces/settings@1)',
      'oficina: sem-format.json ignorado (sem "format")',
      'oficina: grande.json ignorado (maior que 64 KB)',
    ]);
  });

  it('ler a pasta de novo não duplica nem passa por cima (bot pelo id, preset pelo nome)', () => {
    const save = createSaveStore(memoryStorage(), libraryCapsFor('switch'));
    const files = [
      { name: 'bot.json', text: JSON.stringify(bot) },
      { name: 'preset.json', text: JSON.stringify(preset) },
    ];
    importWorkshopFiles(files, save, limits);
    // O jogador mudou o bot no Switch: a pasta não desfaz a mudança.
    save.saveBot({ ...save.bots.find((b) => b.id === 'pc-bot-1')!, name: 'Mudado aqui' });
    const again = importWorkshopFiles(files, save, limits);
    expect([again.bots, again.presets, again.lines.length]).toEqual([0, 0, 0]);
    expect(save.bots.filter((b) => b.id === 'pc-bot-1').map((b) => b.name)).toEqual(['Mudado aqui']);
    expect(save.presets.saved.filter((p) => p.name === 'Do PC')).toHaveLength(1);
  });

  it('preset sem nome usa o nome do arquivo; bot inválido diz o código do validador', () => {
    const save = createSaveStore(memoryStorage(), libraryCapsFor('switch'));
    const { name: _drop, ...noName } = preset;
    void _drop;
    const got = importWorkshopFiles(
      [
        { name: 'Sexta.json', text: JSON.stringify(noName) },
        { name: 'bot-ruim.json', text: JSON.stringify({ ...bot, id: 'pc-bot-9', format: 'boboforces/bot@9' }) },
      ],
      save,
      limits,
    );
    expect(save.presets.saved.map((p) => p.name)).toContain('Sexta');
    expect(got.lines.length).toBe(1);
    expect(got.lines[0]).toMatch(/^oficina: bot-ruim\.json ignorado \(.+\)$/);
  });
});

describe('o backup da web na oficina/ (M4, fase 2c)', () => {
  it('traz só os bots e os presets salvos dele, pelas mesmas regras; ler de novo não duplica', () => {
    const pc = createSaveStore(memoryStorage(), libraryCapsFor('web'));
    pc.saveBot(bot);
    pc.savePreset({ ...preset, name: 'Sexta do PC' });
    const text = exportBackup(pc, '2026-11-16T00:00:00.000Z', '0.0.1');
    const sw = createSaveStore(memoryStorage(), libraryCapsFor('switch'));
    const settingsBefore = sw.settings;
    const got = importWorkshopFiles([{ name: 'boboforces-backup.json', text }], sw, limits);
    expect([got.bots, got.presets, got.lines]).toEqual([1, 1, []]);
    expect(sw.bots.map((b) => b.id)).toContain('pc-bot-1');
    expect(sw.presets.saved.map((p) => p.name)).toContain('Sexta do PC');
    // Os ajustes do Switch ficam como estão; a 2ª leitura não traz nada de novo.
    expect(sw.settings).toBe(settingsBefore);
    const again = importWorkshopFiles([{ name: 'boboforces-backup.json', text }], sw, limits);
    expect([again.bots, again.presets]).toEqual([0, 0]);
  });
});
