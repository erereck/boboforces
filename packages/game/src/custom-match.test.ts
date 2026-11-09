import { DEBUT_PRESET, presetBotCounts, validateMatchRecipe, type MatchRecipe } from '@boboforces/format';
import { describe, expect, it } from 'vitest';
import { CUSTOM_TABS, customRows, presetName, stepCustom } from './custom-match.ts';

/** M2, fase 4e: o editor da Partida personalizada. */

const PC = { maxBots: 40, maxViewM: 140 };
const PHONE = { maxBots: 12, maxViewM: 90 };

function value(tab: (typeof CUSTOM_TABS)[number], r: MatchRecipe, id: string): string {
  return customRows(tab, r)
    .find((x) => x.id === id)!
    .value(r);
}

describe('Partida personalizada', () => {
  it('cada aba tem linhas, e o padrão aparece sem nada na receita', () => {
    for (const tab of CUSTOM_TABS) expect(customRows(tab, DEBUT_PRESET).length, tab).toBeGreaterThan(0);
    expect(value('players', DEBUT_PRESET, 'hp')).toBe('100');
    expect(value('players', DEBUT_PRESET, 'regen')).toBe('Padrão');
    expect(value('weapons', DEBUT_PRESET, 'allowed')).toBe('Todas');
    expect(value('mods', DEBUT_PRESET, 'friendly')).toBe('Desligado');
    expect(value('hud', DEBUT_PRESET, 'killFeed')).toBe('Ligado');
    expect(value('bots', DEBUT_PRESET, 'bot1')).toBe('Chill Bob');
  });

  it('os passos mudam a receita, que segue válida; ligar e desligar inverte', () => {
    let r = DEBUT_PRESET;
    r = stepCustom('players', r, 'hp', 1, PC);
    r = stepCustom('players', r, 'regen', 1, PC);
    r = stepCustom('weapons', r, 'allowed', 3, PC);
    r = stepCustom('mods', r, 'oneShot', 0, PC);
    r = stepCustom('mods', r, 'friendly', 1, PC);
    r = stepCustom('mods', r, 'gravity', -1, PC);
    r = stepCustom('hud', r, 'hitmarker', 0, PC);
    r = stepCustom('match', r, 'time', 1, PC);
    expect(r.players).toEqual({ hp: 150, regen: 'fast', gravity: 0.75 });
    expect(r.weapons).toEqual({ allowed: ['shotgun'], oneShot: true, friendlyFire: 0.5 });
    expect(r.hud).toEqual({ hitmarker: false });
    expect(r.match?.timeLimitS).toBe(600);
    const checked = validateMatchRecipe(r, { maxBots: 40, maxLocalHumans: 4, maxViewDistanceM: 140 });
    expect(checked.ok && checked.warnings).toEqual([]);
  });

  it('bots: troca o bot de cada time e para no teto do aparelho; TDM ↔ FFA mantém a quantidade', () => {
    let r = stepCustom('bots', DEBUT_PRESET, 'bot1', 4, PHONE);
    expect(r.teams[1]!.bots[0]!.ref).toBe('builtin:jorge-the-immortal');
    for (let i = 0; i < 20; i++) r = stepCustom('bots', r, 'count1', 1, PHONE);
    expect(presetBotCounts(r).reduce((a, b) => a + b, 0)).toBe(PHONE.maxBots);
    for (let i = 0; i < 20; i++) r = stepCustom('bots', r, 'count0', -1, PHONE);
    expect(presetBotCounts(r)).toEqual([0, 9]);
    for (let i = 0; i < 5; i++) r = stepCustom('bots', r, 'count1', 1, PHONE);
    expect(presetBotCounts(r)).toEqual([0, 12]);
    const ffa = stepCustom('match', DEBUT_PRESET, 'mode', 1, PHONE);
    expect([ffa.mode, presetBotCounts(ffa)]).toEqual(['warfare.ffa', [7]]);
    expect(presetBotCounts(stepCustom('match', ffa, 'mode', 1, PHONE))).toEqual([3, 4]);
    expect(customRows('bots', ffa).map((x) => x.id)).toEqual(['bot0', 'count0']);
  });

  it('alcance de visão para no teto do aparelho', () => {
    let r = DEBUT_PRESET;
    for (let i = 0; i < 6; i++) r = stepCustom('match', r, 'view', 1, PHONE);
    expect(r.match?.viewDistanceM).toBe(75);
  });

  it('nome do preset salvo: o do gerador, e " 2" se já existe', () => {
    const taken = new Set(['Times 4×4 De boa']);
    expect(presetName('Times 4×4 Tryhard', (n) => taken.has(n))).toBe('Times 4×4 Tryhard');
    expect(presetName('Times 4×4 De boa', (n) => taken.has(n))).toBe('Times 4×4 De boa 2');
  });
});
