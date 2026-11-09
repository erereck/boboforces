import { DEBUT_PRESET, presetBotCounts, validateMatchRecipe } from '@boboforces/format';
import { describe, expect, it } from 'vitest';
import { presetShortcut } from './presets-ui.ts';
import {
  factoryPresets,
  quickFromPreset,
  quickToPreset,
  quickValue,
  scoreFor,
  sizeRange,
  stepQuick,
} from './quick-match.ts';

/** M2, fase 4d: a lógica da Partida Rápida e os presets de fábrica. */

const PC = 40;
const PHONE = 12;

describe('Partida Rápida', () => {
  it('abre como o preset estava e volta para o mesmo jeito de partida', () => {
    const q = quickFromPreset(DEBUT_PRESET, PC);
    expect(q).toEqual({ mode: 'warfare.tdm', map: 'construto', level: 'chill', size: 4, minutes: 5 });
    const back = quickToPreset(q);
    expect(back.teams).toEqual(DEBUT_PRESET.teams);
    expect(back.match).toEqual({ timeLimitS: 300, scoreLimit: 30 });
    expect(quickValue(q, 'size')).toBe('4 contra 4');
    expect(quickValue(q, 'minutes')).toBe('5 min');
  });

  it('trocar o modo mantém a quantidade de bobos (4 contra 4 vira 7 bots no FFA, e volta)', () => {
    const tdm = quickFromPreset(DEBUT_PRESET, PC);
    const ffa = stepQuick(tdm, 'mode', 1, PC);
    expect([ffa.mode, ffa.size]).toEqual(['warfare.ffa', 7]);
    expect(quickValue(ffa, 'size')).toBe('7 bots');
    expect(presetBotCounts(quickToPreset(ffa))).toEqual([7]);
    expect(stepQuick(ffa, 'mode', -1, PC).size).toBe(4);
  });

  it('o tamanho para no teto do aparelho; o nível para nas pontas; a duração dá a volta', () => {
    let q = quickFromPreset(DEBUT_PRESET, PHONE);
    for (let i = 0; i < 20; i++) q = stepQuick(q, 'size', 1, PHONE);
    expect(q.size).toBe(sizeRange('warfare.tdm', PHONE).max);
    const preset = quickToPreset(q);
    expect(presetBotCounts(preset).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(PHONE);
    for (let i = 0; i < 9; i++) q = stepQuick(q, 'level', 1, PHONE);
    expect(q.level).toBe('tryhard');
    for (let i = 0; i < 9; i++) q = stepQuick(q, 'level', -1, PHONE);
    expect(q.level).toBe('vibe');
    expect(stepQuick({ ...q, minutes: 0 }, 'minutes', 1, PHONE).minutes).toBe(3);
    expect(quickValue({ ...q, minutes: 0 }, 'minutes')).toBe('Sem limite');
    expect(quickToPreset({ ...q, minutes: 0 }).match).toEqual({
      timeLimitS: 0,
      scoreLimit: scoreFor('warfare.tdm', 0),
    });
  });

  it('toda combinação vira uma receita válida no teto do celular', () => {
    let q = quickFromPreset(DEBUT_PRESET, PHONE);
    for (const mode of [0, 1]) {
      if (mode === 1) q = stepQuick(q, 'mode', 1, PHONE);
      for (let s = 0; s < 14; s++) {
        q = stepQuick(q, 'size', s < 7 ? 1 : -1, PHONE);
        const r = validateMatchRecipe(quickToPreset(q), { maxBots: PHONE, maxLocalHumans: 1, maxViewDistanceM: 90 });
        expect(r.ok && r.warnings, `${q.mode} ${q.size}`).toEqual([]);
      }
    }
  });
});

describe('presets de fábrica', () => {
  it('Vibe, Tryhard e Sexta do Jorge: válidos, com nome e o atalho pelo nome', () => {
    const presets = factoryPresets();
    expect(presets.map((p) => p.name)).toEqual(['Vibe', 'Tryhard', 'Sexta do Jorge']);
    for (const p of presets) {
      const r = validateMatchRecipe(p, { maxBots: PC, maxLocalHumans: 4, maxViewDistanceM: 140 });
      expect(r.ok && r.warnings).toEqual([]);
    }
    expect(presets[2]!.teams[1]!.bots).toEqual([{ ref: 'builtin:jorge-the-immortal', count: 6 }]);
    expect(presetShortcut(presets[2]!)).toEqual({ label: 'Sexta do Jorge', caption: 'Times · 10 min ou 75 abates' });
    expect(presetShortcut(DEBUT_PRESET)).toEqual({ label: '4×4 De boa', caption: 'Times · 5 min ou 30 abates' });
  });
});
