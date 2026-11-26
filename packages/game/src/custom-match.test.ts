import { builtinBot, DEBUT_PRESET, presetBotCounts, validateMatchRecipe, type MatchRecipe } from '@boboforces/format';
import { TEAM_COLORS } from '@boboforces/ui';
import { describe, expect, it } from 'vitest';
import {
  CUSTOM_TABS,
  customHelp,
  customNameTeam,
  customRows,
  customRowViews,
  customTabs,
  presetName,
  SANDBOX_TABS,
  stepCustom,
  withTeamName,
  ZOMBIES_TABS,
} from './custom-match.ts';

/** M2, fase 4e: o editor da Partida personalizada. */

const PC = { maxBots: 40, maxViewM: 140 };
const PHONE = { maxBots: 12, maxViewM: 90 };

function value(tab: Parameters<typeof customRows>[0], r: MatchRecipe, id: string): string {
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
    // M10: "Só escopeta" é a 5ª escolha (o DMR entrou depois do fuzil).
    r = stepCustom('weapons', r, 'allowed', 4, PC);
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

  it('M6 (fase 4): os modificadores e a Roleta na aba Modificadores; todo modificador da receita aparece e desliga', () => {
    let r = DEBUT_PRESET;
    r = stepCustom('mods', r, 'lowGravity', 0, PC);
    r = stepCustom('mods', r, 'vampire', 0, PC);
    r = stepCustom('mods', r, 'chaos', 0, PC);
    expect(r.modifiers).toEqual(['lowGravity', 'vampire']);
    expect(r.chaos).toEqual({});
    // Ligar a pesada tira a Lua (conflitam).
    r = stepCustom('mods', r, 'heavyGravity', 0, PC);
    expect(r.modifiers).toEqual(['heavyGravity', 'vampire']);
    const checked = validateMatchRecipe(r, { maxBots: 40, maxLocalHumans: 4, maxViewDistanceM: 140 });
    expect(checked.ok && checked.warnings).toEqual([]);
    // Um preset com os modificadores de arma: as linhas de sempre mostram ligado, e desligar tira o modificador.
    let p: MatchRecipe = { ...DEBUT_PRESET, modifiers: ['headshotOnly', 'oneShot', 'infiniteAmmo'] };
    expect(value('mods', p, 'headshot')).toBe('Ligado');
    expect(value('mods', p, 'oneShot')).toBe('Ligado');
    expect(value('weapons', p, 'ammo')).toBe(
      value('weapons', { ...DEBUT_PRESET, weapons: { ammo: 'infiniteClip' } }, 'ammo'),
    );
    p = stepCustom('mods', p, 'headshot', 0, PC);
    p = stepCustom('mods', p, 'oneShot', 0, PC);
    p = stepCustom('weapons', p, 'ammo', 1, PC);
    expect(p.modifiers).toBeUndefined();
    expect(p.weapons).toEqual({ headshotOnly: false, oneShot: false, ammo: 'normal' });
    r = stepCustom('mods', r, 'chaos', 0, PC);
    expect(r.chaos).toBeUndefined();
    // Revisão da 4b: Invisíveis com o "um tiro mata" da regra: um desliga o outro, nos dois sentidos.
    let q = stepCustom('mods', DEBUT_PRESET, 'oneShot', 0, PC);
    q = stepCustom('mods', q, 'invisible', 0, PC);
    expect(q.modifiers).toEqual(['invisible']);
    expect(q.weapons?.oneShot).toBe(false);
    q = stepCustom('mods', q, 'oneShot', 0, PC);
    expect(q.modifiers).toBeUndefined();
    expect(q.weapons?.oneShot).toBe(true);
    // O Bobo Zombies não leva os modificadores (não tem a aba).
    const z = stepCustom('match', { ...DEBUT_PRESET, modifiers: ['invisible'], chaos: {} }, 'mode', 3, PC);
    expect(z.mode).toBe('zombies');
    expect(z.modifiers).toBeUndefined();
    expect(z.chaos).toBeUndefined();
  });

  it('M2 (fase 6a): o perfil de movimento; velocidade e pulo só aparecem no Personalizado', () => {
    const ids = (r: MatchRecipe): string[] => customRows('players', r).map((x) => x.id);
    expect(value('players', DEBUT_PRESET, 'movement')).toBe('Bobo');
    expect(ids(DEBUT_PRESET).slice(0, 2)).toEqual(['movement', 'hp']);
    let r = stepCustom('players', DEBUT_PRESET, 'movement', 1, PC);
    expect(value('players', r, 'movement')).toBe('Tático');
    // M8 (fase 7): o Arcade entre o Tático e o Personalizado.
    r = stepCustom('players', r, 'movement', 1, PC);
    expect(value('players', r, 'movement')).toBe('Arcade');
    expect(ids(r).slice(0, 2)).toEqual(['movement', 'hp']);
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
    expect(customRows('bots', ffa).map((x) => x.id)).toEqual(['bot0', 'count0', 'director']);
  });

  it('M8 (fase 5): o Diretor de Partida na aba Bots: desligado → Relax → Equilibrado → Desafio → desligado', () => {
    const seen: string[] = [];
    let r: MatchRecipe = DEBUT_PRESET;
    for (let i = 0; i < 4; i++) {
      seen.push(value('bots', r, 'director'));
      r = stepCustom('bots', r, 'director', 1, PC);
    }
    seen.push(value('bots', r, 'director'));
    expect(seen).toEqual(['Desligado', 'Relax', 'Equilibrado', 'Desafio', 'Desligado']);
    expect(r.director).toBeUndefined();
    const on = stepCustom('bots', DEBUT_PRESET, 'director', -1, PC);
    expect(on.director).toEqual({ goal: 'challenge' });
    expect(validateMatchRecipe(on, { maxBots: 40, maxLocalHumans: 4, maxViewDistanceM: 140 }).ok).toBe(true);
    // No Bobo Zombies o Diretor não vale: sai junto com os modificadores.
    let z = on;
    for (let i = 0; i < 3 && z.mode !== 'zombies'; i++) z = stepCustom('match', z, 'mode', 1, PC);
    expect(z.mode).toBe('zombies');
    expect(z.director).toBeUndefined();
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
    // M9 (fase 3): depois do Zombies vem o Sandbox; dois passos, os Times.
    expect(stepCustom('match', z, 'mode', 1, PC).mode).toBe('sandbox');
    const tdm = stepCustom('match', z, 'mode', 2, PC);
    expect(tdm.mode).toBe('warfare.tdm');
    expect(tdm.map).toBe('construto');
    expect(tdm.zombies).toBeUndefined();
    expect(tdm.teams).toHaveLength(2);
    expect(presetBotCounts(tdm)[1]).toBe(4);
    // M6 (fase 1): para trás, o Domination (os times do TDM e a meta dos pontos).
    const dom = stepCustom('match', z, 'mode', -1, PC);
    expect(dom.mode).toBe('warfare.domination');
    expect(dom.map).toBe('construto');
    expect(dom.match).toMatchObject({ timeLimitS: 600, scoreLimit: 200 });
    expect(dom.teams).toHaveLength(2);
    // E do Domination para trás, o Todos contra todos; para a frente, o Zombies.
    expect(stepCustom('match', dom, 'mode', -1, PC).mode).toBe('warfare.ffa');
    expect(stepCustom('match', dom, 'mode', 1, PC).mode).toBe('zombies');
    const checked = validateMatchRecipe(tdm, LIMITS);
    expect(checked.ok && checked.warnings).toEqual([]);
  });
});

describe('M9 (fase 3): o Bobo Sandbox na Partida personalizada', () => {
  const LIMITS = { maxBots: 40, maxLocalHumans: 4, maxViewDistanceM: 140 };
  const valid = (r: MatchRecipe): void => {
    const checked = validateMatchRecipe(r, LIMITS);
    expect(checked.ok && checked.warnings).toEqual([]);
  };
  const ids = (tab: Parameters<typeof customRows>[0], r: MatchRecipe): string[] => customRows(tab, r).map((x) => x.id);
  /** Dos Times, para trás: o Sandbox é o último do ciclo. */
  const toSandbox = (r: MatchRecipe = DEBUT_PRESET): MatchRecipe => stepCustom('match', r, 'mode', -1, PC);
  const withTeams = (n: number, limits = PC): MatchRecipe => {
    let r = toSandbox();
    while (r.teams.length < n) r = stepCustom('teams', r, 'teams', 1, limits);
    return r;
  };

  it('dos Times: as abas do Sandbox, os 2 times de agora, sem o Diretor; o objetivo manda no tempo e na meta', () => {
    const s = toSandbox({ ...DEBUT_PRESET, director: { goal: 'balanced' } });
    expect(s.mode).toBe('sandbox');
    expect(s.map).toBe('construto');
    expect(s.director).toBeUndefined();
    expect(customTabs(s)).toEqual(SANDBOX_TABS);
    expect(presetBotCounts(s)).toEqual([3, 4]);
    expect(value('match', s, 'mode')).toBe('Sandbox');
    expect(ids('match', s)).toEqual(['mode', 'map', 'objective', 'time', 'score', 'view']);
    expect(value('match', s, 'objective')).toBe('Pontos');
    valid(s);
    const elim = stepCustom('match', s, 'objective', 0, PC);
    expect(elim.sandbox).toEqual({ objective: 'elimination' });
    expect(value('match', elim, 'objective')).toBe('Eliminação');
    // Na eliminação a meta não vale, e o tempo não tem o "sem limite" (a sim dá 10 min ao 0).
    expect(ids('match', elim)).toEqual(['mode', 'map', 'objective', 'time', 'view']);
    let noTime = stepCustom('match', { ...elim, match: { timeLimitS: 0 } }, 'time', 0, PC);
    expect(value('match', { ...elim, match: { timeLimitS: 0 } }, 'time')).toBe('10 min');
    for (let i = 0; i < 10; i++) noTime = stepCustom('match', noTime, 'time', 1, PC);
    expect(noTime.match?.timeLimitS).toBeGreaterThan(0);
    valid(elim);
    const toy = stepCustom('match', elim, 'objective', 1, PC);
    expect(toy.sandbox).toEqual({ objective: 'none' });
    expect(ids('match', toy)).toEqual(['mode', 'map', 'objective', 'view']);
    valid(toy);
    // De volta aos pontos (o padrão): o bloco sai.
    expect(stepCustom('match', toy, 'objective', 1, PC).sandbox).toBeUndefined();
    // Sem tempo e meta na receita, as linhas mostram os padrões do Sandbox (10 min, 75 abates).
    const bare = { ...s, match: {} };
    expect([value('match', bare, 'time'), value('match', bare, 'score')]).toEqual(['10 min', '75 abates']);
    // Os mapas do Sandbox (M10, fase 8: a Base Bobo depois do Ringue).
    const ringue = stepCustom('match', s, 'map', 1, PC);
    expect(ringue.map).toBe('ringue');
    const airbase = stepCustom('match', ringue, 'map', 1, PC);
    expect(airbase.map).toBe('airbase');
    // A Base Bobo leva 9 bots (5 contra 5 com você).
    expect(presetBotCounts(airbase).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(9);
    valid(airbase);
    // M10 (fase 2): depois da Base Bobo, o Canteiro; e volta ao Construto.
    const canteiro = stepCustom('match', airbase, 'map', 1, PC);
    expect(canteiro.map).toBe('construction');
    // M10 (fase 1): depois do Canteiro, o Porto; e volta ao Construto.
    const port = stepCustom('match', canteiro, 'map', 1, PC);
    expect(port.map).toBe('port');
    expect(stepCustom('match', port, 'map', 1, PC).map).toBe('construto');
  });

  it('a aba Times: de 2 a 4 times, o seu time, e por time o nome, o bot, quantos, a vida e as armas', () => {
    let r = withTeams(4);
    expect(r.teams).toHaveLength(4);
    // O time novo vem com o bot e a quantidade do último.
    expect(presetBotCounts(r)).toEqual([3, 4, 4, 4]);
    expect(stepCustom('teams', r, 'teams', 1, PC).teams).toHaveLength(4);
    const perTeam = (i: number): string[] => [
      `teamName${i}`,
      `teamColor${i}`,
      `bot${i}`,
      `count${i}`,
      `teamHp${i}`,
      `teamArms${i}`,
    ];
    expect(ids('teams', r)).toEqual(['teams', 'you', ...perTeam(0), ...perTeam(1), ...perTeam(2), ...perTeam(3)]);
    // Os rótulos levam a cor do time; o nome e o seu time, o quadradinho da cor.
    const views = customRowViews('teams', r, PC);
    const name2 = views.find((v) => v.id === 'teamName2')!;
    expect([name2.labelKey, name2.labelParams, name2.value]).toEqual([
      'custom.row.teamName',
      { team: 'Verde' },
      'Verde',
    ]);
    expect(name2.swatch).toBe(TEAM_COLORS[2]! >>> 8);
    expect(views.find((v) => v.id === 'teamHp3')!.labelParams).toEqual({ team: 'Roxo' });
    expect(views.find((v) => v.id === 'you')!.value).toBe('Laranja');
    // O nome: o digitado aparece; vazio (ou o da cor) volta ao da cor.
    r = withTeamName(r, 2, '  Os Bobões ');
    expect(r.teams[2]!.name).toBe('Os Bobões');
    expect(value('teams', r, 'teamName2')).toBe('Os Bobões');
    expect(withTeamName(r, 2, '').teams[2]!.name).toBeUndefined();
    expect(withTeamName(r, 2, 'Verde').teams[2]!.name).toBeUndefined();
    // As setas não mexem no nome (o confirmar abre o teclado: `customNameTeam`).
    expect(stepCustom('teams', r, 'teamName2', 1, PC)).toBe(r);
    expect([customNameTeam('teamName2'), customNameTeam('teams'), customNameTeam('teamHp2')]).toEqual([2, -1, -1]);
    // A vida: os passos de 1 a 1000 (ausente = a da partida).
    expect(value('teams', r, 'teamHp1')).toBe('100');
    r = stepCustom('teams', r, 'teamHp1', -1, PC);
    expect(r.teams[1]!.hp).toBe(75);
    for (let i = 0; i < 12; i++) r = stepCustom('teams', r, 'teamHp3', -1, PC);
    expect(r.teams[3]!.hp).toBe(1);
    for (let i = 0; i < 12; i++) r = stepCustom('teams', r, 'teamHp0', 1, PC);
    expect(r.teams[0]!.hp).toBe(1000);
    // As armas: todas (sem o campo) ou uma primária só.
    r = stepCustom('teams', r, 'teamArms1', 1, PC);
    expect([r.teams[1]!.weapons, value('teams', r, 'teamArms1')]).toEqual([['rifle'], 'Só fuzil']);
    expect(stepCustom('teams', r, 'teamArms1', -1, PC).teams[1]!.weapons).toBeUndefined();
    // Quantos: o seu time pode ficar só com você; os outros, com 1 no mínimo.
    for (let i = 0; i < 6; i++) r = stepCustom('teams', r, 'count0', -1, PC);
    for (let i = 0; i < 6; i++) r = stepCustom('teams', r, 'count2', -1, PC);
    expect(presetBotCounts(r)).toEqual([0, 4, 1, 4]);
    valid(r);
    // O seu time: os humanos vão para o Azul; o Laranja, sem ninguém, ganha 1 bot.
    r = stepCustom('teams', r, 'you', 1, PC);
    expect(r.teams.map((tm) => tm.humans)).toEqual([undefined, 'all', undefined, undefined]);
    expect(presetBotCounts(r)).toEqual([1, 4, 1, 4]);
    expect(value('teams', r, 'you')).toBe('Azul');
    // Agora o Azul pode ficar só com você.
    for (let i = 0; i < 6; i++) r = stepCustom('teams', r, 'count1', -1, PC);
    expect(presetBotCounts(r)[1]).toBe(0);
    valid(r);
    // Tirar times: sai o último; os humanos que estavam nele voltam ao Laranja.
    r = stepCustom('teams', r, 'you', -2, PC);
    expect(r.teams[3]!.humans).toBe('all');
    r = stepCustom('teams', r, 'teams', -1, PC);
    expect(r.teams).toHaveLength(3);
    expect(r.teams[0]!.humans).toBe('all');
    r = stepCustom('teams', r, 'teams', -1, PC);
    expect(stepCustom('teams', r, 'teams', -1, PC).teams).toHaveLength(2);
    valid(r);
  });

  it('os bots cabem no teto do aparelho e do mapa: o time novo e os maiores cedem; o Ringue leva 7', () => {
    const phone = withTeams(4, PHONE);
    expect(presetBotCounts(phone)).toEqual([3, 4, 4, 1]);
    for (let i = 0; i < 5; i++) expect(stepCustom('teams', phone, 'count3', 1, PHONE)).toEqual(phone);
    const ringue = stepCustom('match', phone, 'map', 1, PHONE);
    expect(ringue.map).toBe('ringue');
    expect(presetBotCounts(ringue).reduce((a, b) => a + b, 0)).toBe(7);
    expect(presetBotCounts(ringue).every((n, i) => n >= (i === 0 ? 0 : 1))).toBe(true);
    valid(ringue);
  });

  it('saindo do Sandbox: o seu time contra os bots de todos os outros, sem os nomes, a vida e as armas', () => {
    let r = withTeams(4);
    r = withTeamName(r, 1, 'Os Bobões');
    r = stepCustom('teams', r, 'teamHp1', 1, PC);
    r = stepCustom('teams', r, 'you', 1, PC);
    r = stepCustom('match', r, 'objective', 0, PC);
    const tdm = stepCustom('match', r, 'mode', 1, PC);
    expect(tdm.mode).toBe('warfare.tdm');
    expect(tdm.sandbox).toBeUndefined();
    expect(tdm.teams).toHaveLength(2);
    expect(tdm.teams[0]!.humans).toBe('all');
    // O Azul (o seu) vira o time 0; os outros 3 somam o mesmo bot numa linha só.
    expect(tdm.teams[0]!.bots).toEqual(r.teams[1]!.bots);
    expect(tdm.teams[1]!.bots).toEqual([{ ref: DEBUT_PRESET.teams[1]!.bots[0]!.ref, count: 3 + 4 + 4 }]);
    expect(tdm.teams.some((tm) => tm.name !== undefined || tm.hp !== undefined)).toBe(false);
    expect(tdm.match).toMatchObject({ timeLimitS: 300, scoreLimit: 30 });
    valid(tdm);
    // E para o Zombies (o ciclo para trás), também sem o bloco do Sandbox.
    const z = stepCustom('match', r, 'mode', -1, PC);
    expect([z.mode, z.sandbox, z.teams.length]).toEqual(['zombies', undefined, 1]);
  });

  it('M10 (fase 8): a cor de cada time: anda entre as 8 sem repetir a de outro time; o quadradinho e o nome seguem', () => {
    let r = withTeams(3);
    const color = (rr: MatchRecipe, i: number): string => value('teams', rr, `teamColor${i}`);
    expect([0, 1, 2].map((i) => color(r, i))).toEqual(['Laranja', 'Azul', 'Verde']);
    // Para a frente, o Laranja pula o Azul e o Verde (dos outros times) e vai ao Roxo; depois, ao Vermelho.
    r = stepCustom('teams', r, 'teamColor0', 1, PC);
    expect([r.teams[0]!.color, color(r, 0)]).toEqual([3, 'Roxo']);
    r = stepCustom('teams', r, 'teamColor0', 1, PC);
    expect([r.teams[0]!.color, color(r, 0)]).toEqual([4, 'Vermelho']);
    // Para trás, o Verde pula o Azul (do time 1) e chega ao Laranja (agora livre); mais um, dá a volta até o Ciano.
    r = stepCustom('teams', r, 'teamColor2', -1, PC);
    expect(r.teams[2]!.color).toBe(0);
    expect(stepCustom('teams', r, 'teamColor2', -1, PC).teams[2]!.color).toBe(7);
    // As linhas do time seguem a cor: o rótulo, o quadradinho, o nome sem nome e o seu time.
    const views = customRowViews('teams', r, PC);
    const row = (id: string) => views.find((v) => v.id === id)!;
    expect([row('teamColor0').labelParams, row('teamColor0').swatch]).toEqual([{ team: 'Vermelho' }, 0xe8283c]);
    expect([row('teamName0').value, row('teamName0').swatch, row('teamHp0').labelParams]).toEqual([
      'Vermelho',
      0xe8283c,
      { team: 'Vermelho' },
    ]);
    expect([row('you').value, row('you').swatch]).toEqual(['Vermelho', 0xe8283c]);
    expect(row('teamName2').value).toBe('Laranja');
    // Digitar o nome da cor escolhida é o mesmo que não dar nome.
    expect(withTeamName(r, 0, 'Vermelho').teams[0]!.name).toBeUndefined();
    valid(r);
    // Voltar à cor da posição tira o campo (a receita fica como sem escolha).
    let back = r;
    for (let i = 0; i < 8 && back.teams[1]!.color !== undefined; i++)
      back = stepCustom('teams', back, 'teamColor1', 1, PC);
    expect(back.teams[1]).not.toHaveProperty('color');
    expect(stepCustom('teams', stepCustom('teams', r, 'teamColor1', 1, PC), 'teamColor1', -1, PC)).toEqual(r);
    // O 4º time que chega: a cor da posição (o Roxo) está livre, sem campo; com o Roxo tomado, a 1ª livre.
    const four = stepCustom('teams', r, 'teams', 1, PC);
    expect([four.teams[3]!.color, color(four, 3)]).toEqual([undefined, 'Roxo']);
    const purple = stepCustom('teams', stepCustom('teams', r, 'teamColor1', 2, PC), 'teams', 1, PC);
    expect(purple.teams[1]!.color).toBe(3);
    expect([purple.teams[3]!.color, color(purple, 3)]).toEqual([1, 'Azul']);
    valid(purple);
    // Com 4 times, as 4 cores nunca repetem, ande quanto andar.
    let all = purple;
    for (let k = 0; k < 20; k++) {
      all = stepCustom('teams', all, `teamColor${k % 4}`, k % 3 === 0 ? -1 : 1, PC);
      const used = [0, 1, 2, 3].map((i) => color(all, i));
      expect(new Set(used).size, used.join()).toBe(4);
    }
    valid(all);
    // Saindo do Sandbox, as cores ficam para trás.
    const tdm = stepCustom('match', all, 'mode', 1, PC);
    expect(tdm.teams.some((tm) => tm.color !== undefined)).toBe(false);
  });

  it('salvar como Cenário: a receita passa pelo validador inteira e volta igual', () => {
    let r = withTeams(3);
    r = withTeamName(r, 0, 'Laranjada');
    r = withTeamName(r, 2, 'Os Verdes');
    r = stepCustom('teams', r, 'teamHp2', 1, PC);
    // M10: "Só sniper" é a 7ª escolha (o DMR e a escopeta automática entraram antes).
    r = stepCustom('teams', r, 'teamArms2', 6, PC);
    r = stepCustom('match', r, 'objective', 0, PC);
    const saved = { ...r, name: 'Cenário 4×4×4', seed: 0 };
    const checked = validateMatchRecipe(JSON.parse(JSON.stringify(saved)) as unknown, LIMITS);
    expect(checked.ok && checked.warnings).toEqual([]);
    if (!checked.ok) return;
    expect(checked.value).toEqual(saved);
    expect(checked.value.teams[2]).toMatchObject({ name: 'Os Verdes', hp: 150, weapons: ['sniper'] });
    expect(checked.value.sandbox).toEqual({ objective: 'elimination' });
  });
});

describe('Partida personalizada: a frase de ajuda (refino R4c, #79)', () => {
  it('toda linha e toda aba, nos 4 modos, têm frase; os botões do canto não', () => {
    for (const mode of ['warfare.tdm', 'warfare.ffa', 'zombies', 'sandbox'] as const) {
      let r = { ...DEBUT_PRESET, mode, ...(mode === 'zombies' ? { map: 'base' } : {}) } as MatchRecipe;
      // M9 (fase 3): o Sandbox com os 4 times (as linhas de cada um usam a frase sem o número).
      for (let i = 0; i < 2 && mode === 'sandbox'; i++) r = stepCustom('teams', r, 'teams', 1, PC);
      const tabs = customTabs(r);
      tabs.forEach((tab, i) => {
        expect(customHelp(tabs, `tab:${i}`), `${mode}/${tab}`).not.toBe('');
        for (const row of customRows(tab, r)) {
          const help = customHelp(tabs, `row:${row.id}`);
          expect(help, `${mode}/${tab}/${row.id}`).not.toBe('');
          expect(help, `${mode}/${tab}/${row.id}`).not.toContain('custom.help.');
        }
      });
      // O Personalizado libera Velocidade e Pulo.
      const custom = stepCustom('players', r, 'movement', 1, { maxBots: 12, maxViewM: 140 });
      for (const row of customRows(
        'players',
        stepCustom('players', custom, 'movement', 1, { maxBots: 12, maxViewM: 140 }),
      ))
        expect(customHelp(tabs, `row:${row.id}`), row.id).not.toBe('');
    }
    expect(customHelp(CUSTOM_TABS, 'start')).toBe('');
    expect(customHelp(CUSTOM_TABS, null)).toBe('');
  });
});
