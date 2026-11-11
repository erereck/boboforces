import { builtinBot, DEBUT_PRESET, presetBotCounts, validateMatchRecipe, type MatchRecipe } from '@boboforces/format';
import { describe, expect, it } from 'vitest';
import { CUSTOM_TABS, customRows, customTabs, presetName, stepCustom, ZOMBIES_TABS } from './custom-match.ts';

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

  it('M2 (fase 6a): o perfil de movimento; velocidade e pulo só aparecem no Personalizado', () => {
    const ids = (r: MatchRecipe): string[] => customRows('players', r).map((x) => x.id);
    expect(value('players', DEBUT_PRESET, 'movement')).toBe('Bobo');
    expect(ids(DEBUT_PRESET).slice(0, 2)).toEqual(['movement', 'hp']);
    let r = stepCustom('players', DEBUT_PRESET, 'movement', 1, PC);
    expect(value('players', r, 'movement')).toBe('Tático');
    r = stepCustom('players', r, 'movement', 1, PC);
    expect(ids(r).slice(0, 4)).toEqual(['movement', 'speed', 'jump', 'hp']);
    r = stepCustom('players', r, 'speed', 1, PC);
    r = stepCustom('players', r, 'jump', -1, PC);
    expect(r.players).toEqual({ movement: 'custom', speed: 1.25, jump: 0.75 });
    expect([value('players', r, 'speed'), value('players', r, 'jump')]).toEqual(['×1,25', '×0,75']);
    const checked = validateMatchRecipe(r, { maxBots: 40, maxLocalHumans: 4, maxViewDistanceM: 140 });
    expect(checked.ok && checked.warnings).toEqual([]);
    // Volta ao Bobo dando a volta.
    expect(stepCustom('players', r, 'movement', 1, PC).players?.movement).toBe('bobo');
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
    // M3 (fase 6b): o modo é um ciclo de 3 (Times → Todos contra todos → Zombies); para trás, o FFA volta aos Times.
    expect(presetBotCounts(stepCustom('match', ffa, 'mode', -1, PHONE))).toEqual([3, 4]);
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

  it('M2 (fase 5b): os bots da Oficina entram na escolha; o escolhido vai embutido e sai quando ninguém usa', () => {
    const pickles = { ...builtinBot('jorge-the-immortal')!, id: 'a1b2c3', name: 'Private Pickles' };
    const limits = { ...PC, savedBots: [pickles] };
    // Do Normal Bob (padrão do time dos inimigos? o da estreia é o De boa), anda até depois dos 12 de fábrica.
    let r: MatchRecipe = DEBUT_PRESET;
    for (let i = 0; i < 12 && !value('bots', r, 'bot1').startsWith('Private'); i++)
      r = stepCustom('bots', r, 'bot1', 1, limits);
    expect(value('bots', r, 'bot1')).toBe('Private Pickles');
    expect(r.teams[1]!.bots[0]!.ref).toBe('embedded:a1b2c3');
    expect(r.embeddedBots).toEqual([pickles]);
    expect(validateMatchRecipe(r, { maxBots: 40, maxLocalHumans: 4, maxViewDistanceM: 140 }).ok).toBe(true);
    // Mais um passo: volta ao primeiro de fábrica e o embutido sai do preset.
    const back = stepCustom('bots', r, 'bot1', 1, limits);
    expect(back.teams[1]!.bots[0]!.ref.startsWith('builtin:')).toBe(true);
    expect(back.embeddedBots).toBeUndefined();
    // Saiu da Oficina, mas o preset ainda tem: continua na escolha, com o nome dele.
    expect(value('bots', r, 'bot1')).toBe('Private Pickles');
    expect(stepCustom('bots', r, 'bot1', -1, PC).embeddedBots).toBeUndefined();
  });
});

describe('M3 (fase 6b): o Bobo Zombies na Partida personalizada', () => {
  const LIMITS = { maxBots: 40, maxLocalHumans: 4, maxViewDistanceM: 140 };
  const toZombies = (r: MatchRecipe): MatchRecipe => {
    let z = r;
    for (let i = 0; i < 3 && z.mode !== 'zombies'; i++) z = stepCustom('match', z, 'mode', 1, PC);
    return z;
  };

  it('Times → Todos contra todos → Zombies: abas e linhas do modo, na Base, aliados viram apoio', () => {
    const z = toZombies(DEBUT_PRESET);
    expect(z.mode).toBe('zombies');
    expect(z.map).toBe('base');
    expect(customTabs(z)).toEqual(ZOMBIES_TABS);
    expect(customRows('match', z).map((x) => x.id)).toEqual([
      'mode',
      'map',
      'waves',
      'quantity',
      'zspeed',
      'zhp',
      'specials',
      'bosses',
      'economy',
      'selfRevives',
      'view',
    ]);
    expect(value('match', z, 'mode')).toBe('Zombies');
    expect(value('match', z, 'waves')).toBe('Curta · 10 ondas');
    expect(value('match', z, 'selfRevives')).toBe('3');
    expect(customRows('players', z).map((x) => x.id)).toEqual(['support', 'supportBot', 'movement', 'fall', 'camera']);
    expect(customRows('weapons', z).map((x) => x.id)).toEqual(['damage', 'ads', 'assist', 'recoil', 'spread']);
    expect(z.match).toMatchObject({ timeLimitS: 0, scoreLimit: 0 });
    expect(z.teams).toHaveLength(1);
    const checked = validateMatchRecipe(z, LIMITS);
    expect(checked.ok && checked.warnings).toEqual([]);
  });

  it('as regras do modo mudam a receita, que segue válida; os bots de apoio param em 3', () => {
    let z = toZombies(DEBUT_PRESET);
    z = stepCustom('match', z, 'waves', -1, PC);
    z = stepCustom('match', z, 'quantity', 1, PC);
    z = stepCustom('match', z, 'zspeed', 1, PC);
    z = stepCustom('match', z, 'zhp', -1, PC);
    z = stepCustom('match', z, 'specials', 0, PC);
    z = stepCustom('match', z, 'economy', 1, PC);
    z = stepCustom('match', z, 'selfRevives', -1, PC);
    expect(z.zombies).toEqual({
      waves: 5,
      quantity: 1.5,
      speed: 1.25,
      hpMul: 0.75,
      specials: false,
      economy: 1.5,
      selfRevives: 2,
    });
    expect(value('match', z, 'waves')).toBe('Relâmpago · 5 ondas');
    for (let i = 0; i < 6; i++) z = stepCustom('players', z, 'support', 1, PC);
    expect(presetBotCounts(z)).toEqual([3]);
    const before = value('players', z, 'supportBot');
    z = stepCustom('players', z, 'supportBot', 1, PC);
    expect(value('players', z, 'supportBot')).not.toBe(before);
    expect(presetBotCounts(z)).toEqual([3]);
    // 2 → 1 → 0 → sem limite (o fim do ciclo).
    let unlimited = z;
    for (let i = 0; i < 3; i++) unlimited = stepCustom('match', unlimited, 'selfRevives', -1, PC);
    expect(value('match', unlimited, 'selfRevives')).toBe('Sem limite');
    const checked = validateMatchRecipe(z, LIMITS);
    expect(checked.ok && checked.warnings).toEqual([]);
  });

  it('do Zombies de volta aos Times: sem o bloco do modo, num mapa do Warfare, com adversários', () => {
    let z = toZombies(DEBUT_PRESET);
    z = stepCustom('match', z, 'map', -1, PC);
    expect(z.map).toBe('posto');
    z = stepCustom('match', z, 'quantity', 1, PC);
    const tdm = stepCustom('match', z, 'mode', 1, PC);
    expect(tdm.mode).toBe('warfare.tdm');
    expect(tdm.map).toBe('construto');
    expect(tdm.zombies).toBeUndefined();
    expect(tdm.teams).toHaveLength(2);
    expect(presetBotCounts(tdm)[1]).toBe(4);
    const ffa = stepCustom('match', z, 'mode', -1, PC);
    expect(ffa.mode).toBe('warfare.ffa');
    const checked = validateMatchRecipe(tdm, LIMITS);
    expect(checked.ok && checked.warnings).toEqual([]);
  });
});
