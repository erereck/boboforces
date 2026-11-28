import {
  AMMO_MODES,
  BOT_LEVELS,
  builtinBotRef,
  FRIENDLY_FIRE_LEVELS,
  ENGINE_MAX_TEAMS,
  MAP_GRAVITY_RANGE,
  MODIFIERS,
  modifiersConflict,
  REGEN_RULES,
  SANDBOX_DEFAULTS,
  ZOMBIES_DEFAULTS,
  ZOMBIES_WAVE_CHOICES,
  type BotDocument,
  type SquadDocument,
  type BotRef,
  type MatchRecipe,
  type ModifierId,
  type PlayerRules,
  type SandboxObjective,
  type TeamRecipe,
  type WeaponRules,
  type HudRules,
  type ZombiesRules,
} from '@boboforces/format';
import {
  CUSTOM_NAME_VALUE_WIDTH,
  formatDecimal,
  t,
  TEAM_PALETTE,
  type StringKey,
  type TextParams,
} from '@boboforces/ui';
import { mapBotCap, mapForMode, mapGravity, mapName, mapsForMode, mapWeaponsInEffect, type MenuMap } from './maps.ts';
import { fortressName } from './more-modes.ts';
import { teamColor, teamColorIndex } from './team-colors.ts';
import { teamColorName, teamName } from './team-names.ts';

/**
 * M2 (fase 4e): o editor da Partida personalizada (gameplay.md §10.3), lógica pura sobre a receita. Cada aba tem
 * linhas; cada linha tem o valor em texto e um passo (-1/+1; o confirmar avança) que devolve a receita nova. Os
 * tamanhos param no teto de bots do aparelho e o alcance de visão no teto dele. Os bots são um por time (o nível
 * rápido ou um bot de fábrica) com a quantidade; misturas por porcentagem ficam para o Laboratório.
 */

export const CUSTOM_TABS = ['match', 'players', 'weapons', 'bots', 'mods', 'hud'] as const;
/** M9 (fase 3): a aba Times é do Bobo Sandbox (no lugar da aba Bots). */
export type CustomTab = (typeof CUSTOM_TABS)[number] | 'teams';

/**
 * M3 (fase 6b): as abas do Bobo Zombies: Partida (as regras do modo), Jogadores (os bots de apoio e o movimento),
 * Armas e Tela. Bots e Modificadores saem (não há bot adversário; os modificadores de mira são do Warfare).
 */
export const ZOMBIES_TABS = ['match', 'players', 'weapons', 'hud'] as const satisfies readonly CustomTab[];

/**
 * M9 (fase 3): as abas do Bobo Sandbox: a aba Times (de 2 a 4 times, cada um com nome, bots, vida e armas) logo depois
 * da Partida, no lugar da aba Bots.
 */
export const SANDBOX_TABS = [
  'match',
  'teams',
  'players',
  'weapons',
  'mods',
  'hud',
] as const satisfies readonly CustomTab[];

/** As abas da receita (o Bobo Zombies e o Bobo Sandbox têm as deles). */
export function customTabs(r: MatchRecipe): readonly CustomTab[] {
  return r.mode === 'zombies' ? ZOMBIES_TABS : r.mode === 'sandbox' ? SANDBOX_TABS : CUSTOM_TABS;
}

export const CUSTOM_TAB_LABELS: Readonly<Record<CustomTab, StringKey>> = {
  match: 'custom.tab.match',
  players: 'custom.tab.players',
  weapons: 'custom.tab.weapons',
  bots: 'custom.tab.bots',
  mods: 'custom.tab.mods',
  hud: 'custom.tab.hud',
  teams: 'custom.tab.teams',
};

export interface CustomLimits {
  readonly maxBots: number;
  readonly maxViewM: number;
  /** M2 (fase 5b): os bots da Oficina, que entram na escolha do bot de cada time (embutidos no preset). */
  readonly savedBots?: readonly BotDocument[];
  /** M8 (fase 2): os esquadrões, que também entram na escolha (o time recebe as entradas dele). */
  readonly squads?: readonly SquadDocument[];
}

interface RowDef {
  readonly id: string;
  readonly labelKey: StringKey;
  /** M9 (fase 3): os parâmetros do rótulo (as linhas de cada time do Sandbox: "Verde: vida"). */
  readonly labelParams?: TextParams;
  /** M9 (fase 3): o quadradinho da cor do time (RGB) antes do valor, e a área do valor mais larga (o nome do time). */
  readonly swatch?: number;
  readonly valueWidth?: number;
  /** M9 (fase 3b): o valor só para ler (sem setas; o confirmar age): o nome do time, que abre o teclado. */
  readonly valueOnly?: boolean;
  /** M8 (fase 2): com os tetos (os esquadrões), a linha do bot mostra o nome do esquadrão do time. */
  value(r: MatchRecipe, limits?: CustomLimits): string;
  step(r: MatchRecipe, delta: number, limits: CustomLimits): MatchRecipe;
}

/** Bots que dá para pôr num time: os 5 níveis e os especiais de fábrica. */
export const CUSTOM_BOTS: readonly BotRef[] = [
  ...BOT_LEVELS.map(builtinBotRef),
  'builtin:jorge-the-immortal',
  'builtin:camper-carl',
  'builtin:knife-ninja',
  'builtin:scaredy-sam',
  'builtin:hunter-hank',
  'builtin:buddy',
  'builtin:goofy-gus',
];

/** Escolhas de "armas permitidas": todas, ou uma só. */
/**
 * M2 (fase 5b): o Laboratório usa as mesmas escolhas de armas. M10 (fases 6 e 7): as armas novas, cada uma depois da
 * parecida (o revólver depois da pistola: a secundária escolhida como ela, AK5; "só revólver" troca a pistola).
 */
export const ALLOWED_CHOICES: readonly (readonly string[])[] = [
  [],
  ['rifle'],
  ['rifle.dmr'],
  ['smg'],
  ['shotgun'],
  ['shotgun.auto'],
  ['sniper'],
  ['sniper.crossbow'],
  ['rocket'],
  ['rocket.grenade-launcher'],
  ['lmg'],
  ['pistol'],
  ['pistol.revolver'],
  ['knife'],
];
export const ALLOWED_KEYS: readonly StringKey[] = [
  'custom.allowed.all',
  'custom.allowed.rifle',
  'custom.allowed.dmr',
  'custom.allowed.smg',
  'custom.allowed.shotgun',
  'custom.allowed.autoShotgun',
  'custom.allowed.sniper',
  'custom.allowed.crossbow',
  'custom.allowed.rocket',
  'custom.allowed.grenadeLauncher',
  'custom.allowed.lmg',
  'custom.allowed.pistol',
  'custom.allowed.revolver',
  'custom.allowed.knife',
];

function cycleIndex(n: number, i: number, delta: number): number {
  return (((i + delta) % n) + n) % n;
}

/** Passo numa lista de números: acha o mais perto do atual e anda (para nas pontas). */
function stepList(list: readonly number[], current: number, delta: number): number {
  let i = 0;
  for (let k = 1; k < list.length; k++) if (Math.abs(list[k]! - current) < Math.abs(list[i]! - current)) i = k;
  return list[Math.max(0, Math.min(list.length - 1, i + delta))]!;
}

const on = (v: boolean): string => t(v ? 'custom.on' : 'custom.off');
const players = (r: MatchRecipe): PlayerRules => r.players ?? {};
const weapons = (r: MatchRecipe): WeaponRules => r.weapons ?? {};
const hud = (r: MatchRecipe): HudRules => r.hud ?? {};
const withPlayers = (r: MatchRecipe, p: Partial<PlayerRules>): MatchRecipe => ({
  ...r,
  players: { ...players(r), ...p },
});
const withWeapons = (r: MatchRecipe, w: Partial<WeaponRules>): MatchRecipe => ({
  ...r,
  weapons: { ...weapons(r), ...w },
});
const withHud = (r: MatchRecipe, h: Partial<HudRules>): MatchRecipe => ({ ...r, hud: { ...hud(r), ...h } });
/** M11 (fase 4): liga as armas no mapa, ou tira a regra (a receita volta a ser a de antes, sem o campo). */
function withPickups(r: MatchRecipe, on: boolean): MatchRecipe {
  if (on) return withWeapons(r, { pickups: true });
  if (r.weapons?.pickups === undefined) return r;
  const { pickups: _gone, ...rest } = r.weapons;
  return { ...r, weapons: rest };
}

function flag(
  id: string,
  labelKey: StringKey,
  get: (r: MatchRecipe) => boolean,
  set: (r: MatchRecipe, v: boolean) => MatchRecipe,
): RowDef {
  return { id, labelKey, value: (r) => on(get(r)), step: (r) => set(r, !get(r)) };
}

const ffa = (r: MatchRecipe): boolean => r.mode === 'warfare.ffa';
const zombies = (r: MatchRecipe): ZombiesRules => r.zombies ?? {};
const withZombies = (r: MatchRecipe, z: Partial<ZombiesRules>): MatchRecipe => ({
  ...r,
  zombies: { ...zombies(r), ...z },
});
const botsOf = (r: MatchRecipe, team: number): number => (r.teams[team]?.bots ?? []).reduce((n, b) => n + b.count, 0);
const refOf = (r: MatchRecipe, team: number): BotRef => r.teams[team]?.bots[0]?.ref ?? builtinBotRef('normal');
const sandbox = (r: MatchRecipe): boolean => r.mode === 'sandbox';

/** M9 (fase 3): o time dos humanos (o que tem `humans`; sem nenhum, o 0). */
export function homeTeam(r: MatchRecipe): number {
  return Math.max(
    0,
    r.teams.findIndex((tm) => tm.humans === 'all' || (tm.humans ?? 0) > 0),
  );
}

/** O mínimo de bots do time: o seu time (o 0 nos Times; no Sandbox, o dos humanos) pode ficar só com você. */
function minBots(r: MatchRecipe, team: number): number {
  if (ffa(r)) return 1;
  return team === (sandbox(r) ? homeTeam(r) : 0) ? 0 : 1;
}

const EMBEDDED = 'embedded:';

/** O nome do bot de uma ref: de fábrica pela tabela; embutido pelo nome dele (o Normal Bob se sumiu). */
function botName(ref: BotRef, r: MatchRecipe): string {
  if (ref.startsWith(EMBEDDED)) {
    const doc = r.embeddedBots?.find((b) => b.id === ref.slice(EMBEDDED.length));
    if (doc) return doc.name;
    return t('bot.name.normal-bob');
  }
  return t(`bot.name.${ref.slice('builtin:'.length)}` as StringKey);
}

const SQUAD = 'squad:';
/** M8 (fase 2): o time com mais de um bot que não é um esquadrão salvo ("Normal Bob +2"). */
const MIXED = 'mixed';

const sameEntries = (a: SquadDocument, b: SquadDocument): boolean => JSON.stringify(a.bots) === JSON.stringify(b.bots);

/** M8 (fase 2): o esquadrão que tem exatamente as entradas do time (`null` = nenhum). */
function squadOfTeam(r: MatchRecipe, team: number, l: CustomLimits): SquadDocument | null {
  const bots = r.teams[team]?.bots ?? [];
  if (bots.length < 2) return null;
  const key = JSON.stringify(bots);
  return l.squads?.find((q) => JSON.stringify(q.bots) === key) ?? null;
}

/** A escolha de agora: a ref do bot (1 linha), o esquadrão (`squad:<id>`) ou a mistura. */
function currentChoice(r: MatchRecipe, team: number, l: CustomLimits): string {
  if ((r.teams[team]?.bots.length ?? 0) < 2) return refOf(r, team);
  const q = squadOfTeam(r, team, l);
  return q !== null ? SQUAD + q.id : MIXED;
}

/**
 * As escolhas do bot do time: os de fábrica, os da Oficina, os esquadrões (M8, fase 2) e a escolha de agora (o embutido
 * que saiu da Oficina, ou a mistura de um preset antigo).
 */
function botChoices(r: MatchRecipe, team: number, l: CustomLimits): string[] {
  const refs: string[] = [
    ...CUSTOM_BOTS,
    ...(l.savedBots ?? []).map((b): BotRef => `embedded:${b.id}`),
    // Com 2 ou mais bots diferentes (o de um bot só já é a escolha do bot) e sem repetir o mesmo conteúdo (a cópia).
    ...(l.squads ?? [])
      .filter((q, i, all) => q.bots.length > 1 && all.findIndex((x) => sameEntries(x, q)) === i)
      .map((q) => SQUAD + q.id),
  ];
  const current = currentChoice(r, team, l);
  if (!refs.includes(current)) refs.push(current);
  return refs;
}

/** Quantos bots o time tem. */
function teamTotal(r: MatchRecipe, team: number): number {
  return botsOf(r, team);
}

/**
 * M8 (fase 2): muda o total do time. Com um bot só, é o de sempre; com várias entradas (um esquadrão), a última cresce
 * ou encolhe (e sai a 0), sem passar do teto.
 */
function setTotal(r: MatchRecipe, team: number, n: number): MatchRecipe {
  const bots = r.teams[team]?.bots ?? [];
  if (bots.length < 2) return setTeam(r, team, refOf(r, team), n);
  const next = bots.map((b) => ({ ...b }));
  let total = next.reduce((s, b) => s + b.count, 0);
  while (total > n && next.length > 0) {
    const last = next[next.length - 1]!;
    const cut = Math.min(last.count, total - n);
    last.count -= cut;
    total -= cut;
    if (last.count === 0) next.pop();
  }
  if (total < n && next.length > 0) next[next.length - 1]!.count += n - total;
  const teams = r.teams.map((tm, i) => (i === team ? { ...tm, bots: next } : tm));
  return { ...r, teams };
}

/** Põe o bot da Oficina no preset (`embeddedBots`) e tira os embutidos que nenhum time usa mais. */
function syncEmbedded(r: MatchRecipe, l: CustomLimits): MatchRecipe {
  const used = new Set(r.teams.flatMap((tm) => tm.bots.map((b) => b.ref)).filter((ref) => ref.startsWith(EMBEDDED)));
  const docs: BotDocument[] = [];
  for (const ref of used) {
    const id = ref.slice(EMBEDDED.length);
    const doc = l.savedBots?.find((b) => b.id === id) ?? r.embeddedBots?.find((b) => b.id === id);
    if (doc) docs.push(doc);
  }
  if (docs.length === 0) {
    if (r.embeddedBots === undefined) return r;
    const { embeddedBots: _gone, ...rest } = r;
    return rest;
  }
  return { ...r, embeddedBots: docs };
}

/** Troca um time inteiro por uma linha só de bots (o editor trabalha com um bot por time). */
function setTeam(r: MatchRecipe, team: number, ref: BotRef, count: number): MatchRecipe {
  const teams = r.teams.map((tm, i) => (i === team ? { ...tm, bots: count > 0 ? [{ ref, count }] : [] } : tm));
  return { ...r, teams };
}

/** M2 (fase 5c): os bots cabem no mapa (o Ringue leva 7): corta os inimigos primeiro até a metade, depois os aliados. */
function fitMap(r: MatchRecipe, l: CustomLimits): MatchRecipe {
  if (r.mode === 'zombies') return r;
  const cap = mapBotCap(r.map, l.maxBots);
  if (ffa(r)) return botsOf(r, 0) > cap ? setTotal(r, 0, cap) : r;
  if (sandbox(r)) {
    // M9 (fase 3): corta um bot por vez do time com mais bots acima do mínimo dele (no empate, o de depois).
    let out = r;
    let total = r.teams.reduce((n, _tm, i) => n + botsOf(r, i), 0);
    while (total > cap) {
      let pick = -1;
      for (let i = 0; i < out.teams.length; i++) {
        if (botsOf(out, i) > minBots(out, i) && (pick < 0 || botsOf(out, i) >= botsOf(out, pick))) pick = i;
      }
      if (pick < 0) break;
      out = setTotal(out, pick, botsOf(out, pick) - 1);
      total--;
    }
    return out;
  }
  const enemies = Math.min(botsOf(r, 1), Math.ceil(cap / 2));
  const allies = Math.min(botsOf(r, 0), cap - enemies);
  if (enemies === botsOf(r, 1) && allies === botsOf(r, 0)) return r;
  return setTotal(setTotal(r, 1, enemies), 0, allies);
}

/** M3 (fase 6b): os modos da linha Modo, na ordem do ciclo. M9 (fase 3): o Bobo Sandbox no fim. */
const CUSTOM_MODES = ['warfare.tdm', 'warfare.ffa', 'warfare.domination', 'zombies', 'sandbox'] as const;
/** M6 (fase 1): a meta e o tempo do Domination (GDD §4.1.2; os da sim, `DOMINATION`). */
const DOMINATION_MATCH = { timeLimitS: 600, scoreLimit: 200 } as const;

/** M3 (fase 6b): o mapa do Bobo Zombies quando se chega nele (a Base Abandonada; o Construto é mapa de teste). */
const ZOMBIES_MAP = 'base';
/** M3 (fase 6b): os bots de apoio completam o time até 4 (gameplay.md "Bobo Zombies": humanos e aliados 1–4). */
export const ZOMBIES_SUPPORT_MAX = 3;

/** Um passo no ciclo de modos. Do Bobo Zombies para o Warfare nasce um TDM do JOGAR (10 min, 75 abates). */
function stepMode(r: MatchRecipe, delta: number, l: CustomLimits): MatchRecipe {
  const i = Math.max(0, (CUSTOM_MODES as readonly string[]).indexOf(r.mode));
  const next = CUSTOM_MODES[cycleIndex(CUSTOM_MODES.length, i, delta)]!;
  // M9 (fase 3): o Sandbox nasce dos Times; saindo dele, os Times de agora (o seu time contra o resto) seguem o ciclo.
  if (next === 'sandbox') return syncEmbedded(toSandbox(r, l), l);
  if (sandbox(r)) r = fromSandbox(r, l);
  if (next === 'zombies') return syncEmbedded(toZombies(r, l), l);
  let warfare = r.mode === 'zombies' ? fromZombies(r, l) : r;
  // M6 (fase 1): o Domination usa os times do TDM (do FFA, divide antes), com a meta dos pontos.
  if (next === 'warfare.domination') {
    const teams = ffa(warfare) ? switchMode(warfare, l.maxBots) : warfare;
    return fitMap(
      {
        ...teams,
        mode: 'warfare.domination',
        map: mapForMode(teams.map, 'warfare.domination'),
        match: { ...teams.match, ...DOMINATION_MATCH },
      },
      l,
    );
  }
  if (warfare.mode === 'warfare.domination') {
    warfare = { ...warfare, mode: 'warfare.tdm', match: { ...warfare.match, timeLimitS: 600, scoreLimit: 75 } };
  }
  if (warfare.mode === next) return fitMap(warfare, l);
  const switched = switchMode(warfare, l.maxBots);
  return fitMap({ ...switched, map: mapForMode(switched.map, switched.mode) }, l);
}

/** Para o Bobo Zombies: só o time dos humanos, com os aliados que já tinha como bots de apoio (até 3). */
function toZombies(r: MatchRecipe, l: CustomLimits): MatchRecipe {
  const support = Math.min(ZOMBIES_SUPPORT_MAX, l.maxBots, ffa(r) ? 0 : botsOf(r, 0));
  const map = mapsForMode('zombies').includes(r.map as MenuMap) && r.map !== 'construto' ? r.map : ZOMBIES_MAP;
  const { viewDistanceM } = r.match ?? {};
  // M6 (fase 4): o Bobo Zombies não tem a aba Modificadores: os modificadores e a Roleta não vão junto; nem o Diretor
  // de Partida (M8, fase 5: não vale no Zombies); nem as armas no mapa (M11, fase 4: o Zombies tem as dele).
  const { modifiers: _mods, chaos: _chaos, director: _director, ...rest } = withPickups(r, false);
  return {
    ...rest,
    mode: 'zombies',
    map,
    match: { timeLimitS: 0, scoreLimit: 0, ...(viewDistanceM !== undefined ? { viewDistanceM } : {}) },
    teams: [{ humans: 'all', bots: support > 0 ? [{ ref: refOf(r, 0), count: support }] : [] }],
  };
}

/** Do Bobo Zombies para os Times: os bots de apoio viram aliados e entram 4 adversários do mesmo bot. */
function fromZombies(r: MatchRecipe, l: CustomLimits): MatchRecipe {
  const { zombies: _gone, ...rest } = r;
  const ref = refOf(r, 0);
  const allies = Math.min(botsOf(r, 0), Math.max(0, l.maxBots - 4));
  const { viewDistanceM } = r.match ?? {};
  return {
    ...rest,
    mode: 'warfare.tdm',
    map: mapForMode(r.map, 'warfare.tdm'),
    match: { timeLimitS: 600, scoreLimit: 75, ...(viewDistanceM !== undefined ? { viewDistanceM } : {}) },
    teams: [{ humans: 'all', bots: allies > 0 ? [{ ref, count: allies }] : [] }, { bots: [{ ref, count: 4 }] }],
  };
}

/**
 * M9 (fase 3): para o Bobo Sandbox, a partir dos Times (do FFA, divide; do Zombies, os Times do JOGAR; do Domination,
 * o tempo e a meta do TDM): os 2 times de agora, sem o Diretor de Partida (ele mira um adversário, e aqui são até 3).
 */
function toSandbox(r: MatchRecipe, l: CustomLimits): MatchRecipe {
  let base = r.mode === 'zombies' ? fromZombies(r, l) : r;
  if (ffa(base)) base = switchMode(base, l.maxBots);
  const { director: _director, ...rest } = base;
  const match = base.mode === 'warfare.domination' ? { ...base.match, timeLimitS: 600, scoreLimit: 75 } : base.match;
  return fitMap(
    { ...rest, mode: 'sandbox', map: mapForMode(base.map, 'sandbox'), ...(match !== undefined ? { match } : {}) },
    l,
  );
}

/**
 * M9 (fase 3): do Sandbox para os Times: o seu time (com os bots dele) contra os bots de todos os outros juntos (o mesmo
 * bot soma numa linha), sem os nomes, a vida e as armas por time; o tempo e a meta que a linha mostrava.
 */
function fromSandbox(r: MatchRecipe, l: CustomLimits): MatchRecipe {
  const { sandbox: _sandbox, ...rest } = r;
  const home = homeTeam(r);
  const enemies: { ref: BotRef; count: number }[] = [];
  r.teams.forEach((tm, i) => {
    if (i === home) return;
    for (const b of tm.bots) {
      const same = enemies.find((e) => e.ref === b.ref);
      if (same) same.count += b.count;
      else if (b.count > 0) enemies.push({ ref: b.ref, count: b.count });
    }
  });
  if (enemies.length === 0) enemies.push({ ref: refOf(r, home), count: 1 });
  return fitMap(
    {
      ...rest,
      mode: 'warfare.tdm',
      match: { ...r.match, timeLimitS: timeOf(r), scoreLimit: scoreOf(r) },
      teams: [{ humans: 'all', bots: r.teams[home]?.bots ?? [] }, { bots: enemies }],
    },
    l,
  );
}

/** TDM ↔ FFA mantendo a quantidade de bots: o FFA junta todo mundo num time; o TDM divide (você no primeiro). */
function switchMode(r: MatchRecipe, maxBots: number): MatchRecipe {
  if (ffa(r)) {
    const total = Math.max(1, botsOf(r, 0));
    const enemies = Math.ceil((total + 1) / 2);
    const allies = Math.max(0, Math.min(total - enemies, maxBots - enemies));
    const ref = refOf(r, 0);
    return {
      ...r,
      mode: 'warfare.tdm',
      teams: [{ humans: 'all', bots: allies > 0 ? [{ ref, count: allies }] : [] }, { bots: [{ ref, count: enemies }] }],
    };
  }
  const total = Math.max(1, Math.min(maxBots, botsOf(r, 0) + botsOf(r, 1)));
  return { ...r, mode: 'warfare.ffa', teams: [{ humans: 'all', bots: [{ ref: refOf(r, 1), count: total }] }] };
}

const TIMES = [180, 300, 600, 900, 1200, 1800, 0];
const SCORES = [10, 15, 20, 25, 30, 50, 75, 100, 150, 200, 0];
const VIEWS = [50, 75, 100, 125, 140];
const HPS = [25, 50, 75, 100, 150, 200, 300, 500, 1000];
const RESPAWNS = [0, 1, 2, 3, 5, 8, 10, 15];
const PROTECTIONS = [0, 0.5, 1, 1.5, 2, 3, 5];
const DAMAGES = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5];
const GRAVITIES = [0.25, 0.5, 0.75, 1, 1.5, 2];
/** M2 (fase 6a): os perfis e os passos do Personalizado. M8 (fase 7): o Arcade. */
const MOVEMENTS = ['bobo', 'tactical', 'arcade', 'custom'] as const;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const JUMPS = [0.5, 0.75, 1, 1.5, 2, 3];

/**
 * "×0,25", "×1,5", "×2": até 2 casas, sem zero sobrando. O `t` arredonda número quebrado a 1 casa, e o ×0,25 da
 * gravidade e do dano aparecia como ×0,3 (fase 6a).
 */
const mult = (v: number): string => {
  const two = formatDecimal(v, 2);
  const text = Number.isInteger(v) ? String(v) : two.endsWith('0') ? two.slice(0, -1) : two;
  return t('custom.mult', { n: text });
};

/** M9 (fase 3): o objetivo do Sandbox (ausente = pontos). */
const objectiveOf = (r: MatchRecipe): SandboxObjective => r.sandbox?.objective ?? SANDBOX_DEFAULTS.objective;
/** M9 (fase 3): a ordem da linha Objetivo (o padrão primeiro). */
const OBJECTIVES: readonly SandboxObjective[] = ['points', 'elimination', 'none'];

/**
 * O tempo e a meta como a sim joga (`matchLimits`): fora do Sandbox, os da receita (ausente = sem); no Sandbox,
 * ausentes = os padrões dele, e a eliminação sempre com tempo.
 */
function timeOf(r: MatchRecipe): number {
  const s = r.match?.timeLimitS;
  if (!sandbox(r)) return s ?? 0;
  return objectiveOf(r) === 'elimination' ? s || SANDBOX_DEFAULTS.timeLimitS : (s ?? SANDBOX_DEFAULTS.timeLimitS);
}
function scoreOf(r: MatchRecipe): number {
  return r.match?.scoreLimit ?? (sandbox(r) ? SANDBOX_DEFAULTS.scoreLimit : 0);
}

/** M3 (fase 6b): a linha Modo (Times, Todos contra todos, Zombies); o mapa acompanha (o Ringue não tem FFA). */
const MODE_ROW: RowDef = {
  id: 'mode',
  labelKey: 'quick.mode',
  // M12 (fase 3): o nome curto do modo da receita, o mesmo do resumo embaixo do título (antes, o Training, o Domination
  // e os modos da Mais modos apareciam como "Times" com o resumo dizendo outra coisa).
  value: (r) => t(`mode.short.${r.mode}` as StringKey),
  step: (r, d, l) => stepMode(r, d, l),
};

/**
 * M9 (fase 3): o objetivo do Sandbox: Pontos (o fim do TDM), Eliminação (sem renascer) ou Nenhum (o "brinquedo", sem
 * tempo nem meta). Pontos é o padrão: sai do bloco.
 */
const OBJECTIVE_ROW: RowDef = {
  id: 'objective',
  labelKey: 'custom.row.objective',
  value: (r) => t(`custom.objective.${objectiveOf(r)}` as StringKey),
  step: (r, d) => {
    const next = OBJECTIVES[cycleIndex(OBJECTIVES.length, OBJECTIVES.indexOf(objectiveOf(r)), d)]!;
    const { sandbox: _drop, ...rest } = r;
    return next === SANDBOX_DEFAULTS.objective ? rest : { ...rest, sandbox: { objective: next } };
  },
};

const MATCH_ROWS: readonly RowDef[] = [
  MODE_ROW,
  {
    id: 'map',
    labelKey: 'quick.map',
    value: (r) => mapName(r.map),
    step: (r, d, l) => {
      const maps = mapsForMode(r.mode);
      const i = cycleIndex(maps.length, Math.max(0, maps.indexOf(r.map as MenuMap)), d);
      return fitMap({ ...r, map: maps[i]! }, l);
    },
  },
  {
    id: 'time',
    labelKey: 'custom.row.time',
    value: (r) => {
      const s = timeOf(r);
      return s === 0 ? t('quick.noTime') : t('summary.time', { min: Math.round(s / 60) });
    },
    step: (r, d) => {
      // M9 (fase 3): na eliminação do Sandbox a partida sempre tem tempo (sem o "sem limite").
      const list = objectiveOf(r) === 'elimination' ? TIMES.filter((s) => s > 0) : TIMES;
      const i = cycleIndex(list.length, Math.max(0, list.indexOf(timeOf(r))), d);
      return { ...r, match: { ...r.match, timeLimitS: list[i]! } };
    },
  },
  {
    id: 'score',
    labelKey: 'custom.row.score',
    value: (r) => {
      const n = scoreOf(r);
      return n === 0 ? t('custom.noScore') : t('custom.kills', { n });
    },
    step: (r, d) => {
      const i = cycleIndex(SCORES.length, Math.max(0, SCORES.indexOf(scoreOf(r))), d);
      return { ...r, match: { ...r.match, scoreLimit: SCORES[i]! } };
    },
  },
  {
    id: 'view',
    labelKey: 'custom.row.view',
    value: (r) => t('custom.meters', { n: r.match?.viewDistanceM ?? 100 }),
    step: (r, d, l) => {
      const list = VIEWS.filter((v) => v <= l.maxViewM);
      return { ...r, match: { ...r.match, viewDistanceM: stepList(list, r.match?.viewDistanceM ?? 100, d) } };
    },
  },
];

/** M3 (fase 6b): passos das regras do Bobo Zombies (as faixas do formato: quantidade 0,5–3×, vida 0,25–5×…). */
const Z_QUANTITY = [0.5, 0.75, 1, 1.5, 2, 3];
const Z_SPEED = [0.75, 1, 1.25, 1.5];
const Z_HP = [0.5, 0.75, 1, 1.5, 2, 3];
const Z_ECONOMY = [0.5, 0.75, 1, 1.5, 2, 3];
/** "Levanta sozinho" por partida; -1 = sem limite (fica no fim do ciclo). */
const Z_SELF_REVIVES = [0, 1, 2, 3, 5, 9, -1];
const Z = ZOMBIES_DEFAULTS;

function zombieMult(
  id: string,
  labelKey: StringKey,
  list: readonly number[],
  get: (z: ZombiesRules) => number | undefined,
  key: 'quantity' | 'speed' | 'hpMul' | 'economy',
): RowDef {
  return {
    id,
    labelKey,
    value: (r) => mult(get(zombies(r)) ?? Z[key]),
    step: (r, d) => withZombies(r, { [key]: stepList(list, get(zombies(r)) ?? Z[key], d) }),
  };
}

const ZOMBIE_MATCH_ROWS: readonly RowDef[] = [
  MODE_ROW,
  {
    id: 'map',
    labelKey: 'quick.map',
    value: (r) => mapName(r.map),
    step: (r, d) => {
      const maps = mapsForMode('zombies');
      return { ...r, map: maps[cycleIndex(maps.length, Math.max(0, maps.indexOf(r.map as MenuMap)), d)]! };
    },
  },
  {
    id: 'waves',
    labelKey: 'custom.row.waves',
    value: (r) => t(`custom.waves.${zombies(r).waves ?? Z.waves}` as StringKey),
    step: (r, d) => {
      const list = ZOMBIES_WAVE_CHOICES as readonly number[];
      const i = Math.max(0, list.indexOf(zombies(r).waves ?? Z.waves));
      return withZombies(r, { waves: list[cycleIndex(list.length, i, d)]! });
    },
  },
  zombieMult('quantity', 'custom.row.zombieQuantity', Z_QUANTITY, (z) => z.quantity, 'quantity'),
  zombieMult('zspeed', 'custom.row.zombieSpeed', Z_SPEED, (z) => z.speed, 'speed'),
  zombieMult('zhp', 'custom.row.zombieHp', Z_HP, (z) => z.hpMul, 'hpMul'),
  flag(
    'specials',
    'custom.row.specials',
    (r) => zombies(r).specials ?? Z.specials,
    (r, v) => withZombies(r, { specials: v }),
  ),
  flag(
    'bosses',
    'custom.row.bosses',
    (r) => zombies(r).bosses ?? Z.bosses,
    (r, v) => withZombies(r, { bosses: v }),
  ),
  zombieMult('economy', 'custom.row.economy', Z_ECONOMY, (z) => z.economy, 'economy'),
  {
    id: 'selfRevives',
    labelKey: 'custom.row.selfRevives',
    value: (r) => {
      const n = zombies(r).selfRevives ?? Z.selfRevives;
      return n < 0 ? t('custom.selfRevives.unlimited') : String(n);
    },
    step: (r, d) => {
      const i = Math.max(0, Z_SELF_REVIVES.indexOf(zombies(r).selfRevives ?? Z.selfRevives));
      return withZombies(r, { selfRevives: Z_SELF_REVIVES[cycleIndex(Z_SELF_REVIVES.length, i, d)]! });
    },
  },
];

/** M3 (fase 6b): os bots de apoio do Bobo Zombies (um bot, 0 a 3; os humanos do sofá tomam o lugar deles). */
const SUPPORT_ROWS: readonly RowDef[] = [
  {
    id: 'support',
    labelKey: 'custom.row.supportBots',
    value: (r) => String(botsOf(r, 0)),
    step: (r, d, l) => {
      const n = Math.max(0, Math.min(ZOMBIES_SUPPORT_MAX, l.maxBots, botsOf(r, 0) + d));
      return setTeam(r, 0, refOf(r, 0), n);
    },
  },
  {
    id: 'supportBot',
    labelKey: 'custom.row.supportBot',
    value: (r) => botName(refOf(r, 0), r),
    step: (r, d, l) => {
      // Os bots de apoio do Zombies são de um tipo só (sem os esquadrões).
      const choices = botChoices(r, 0, l).filter(
        (c): c is BotRef => c.startsWith('builtin:') || c.startsWith(EMBEDDED),
      );
      const i = cycleIndex(choices.length, Math.max(0, choices.indexOf(refOf(r, 0))), d);
      return syncEmbedded(setTeam(r, 0, choices[i]!, botsOf(r, 0)), l);
    },
  },
];

/** M2 (fase 6a): o perfil de movimento; com o Personalizado, a velocidade e o pulo logo abaixo. */
const MOVEMENT_ROW: RowDef = {
  id: 'movement',
  labelKey: 'custom.row.movement',
  // M10 (fase 4, revisão): num mapa de gravidade baixa o Arcade vira o Bobo (a sim desliga).
  value: (r) => {
    const m = movementOf(r);
    return t(`movement.${m === 'arcade' && mapGravity(r.map) < 1 ? 'bobo' : m}` as StringKey);
  },
  step: (r, d) => {
    const i = cycleIndex(MOVEMENTS.length, MOVEMENTS.indexOf(movementOf(r)), d);
    // Mexer no perfil tira o modificador Arcade (senão a linha mostraria um perfil que a sim não joga).
    const base = (r.modifiers ?? []).includes('arcade') ? withModifier(r, 'arcade', false) : r;
    return withPlayers(base, { movement: MOVEMENTS[i]! });
  },
};

const CUSTOM_MOVEMENT_ROWS: readonly RowDef[] = [
  {
    id: 'speed',
    labelKey: 'custom.row.speed',
    value: (r) => mult(players(r).speed ?? 1),
    step: (r, d) => withPlayers(r, { speed: stepList(SPEEDS, players(r).speed ?? 1, d) }),
  },
  {
    id: 'jump',
    labelKey: 'custom.row.jump',
    value: (r) => mult(players(r).jump ?? 1),
    step: (r, d) => withPlayers(r, { jump: stepList(JUMPS, players(r).jump ?? 1, d) }),
  },
];

/** O perfil da receita (sem ele, o Bobo); o modificador Arcade manda nele (é como a sim joga). */
function movementOf(r: MatchRecipe): (typeof MOVEMENTS)[number] {
  if ((r.modifiers ?? []).includes('arcade')) return 'arcade';
  const m = players(r).movement;
  return m === 'tactical' || m === 'custom' || m === 'arcade' ? m : 'bobo';
}

const PLAYER_ROWS: readonly RowDef[] = [
  {
    id: 'hp',
    labelKey: 'custom.row.hp',
    value: (r) => String(players(r).hp ?? 100),
    step: (r, d) => withPlayers(r, { hp: stepList(HPS, players(r).hp ?? 100, d) }),
  },
  {
    id: 'regen',
    labelKey: 'custom.row.regen',
    value: (r) => t(`custom.regen.${players(r).regen ?? 'default'}` as StringKey),
    step: (r, d) => {
      const i = REGEN_RULES.indexOf(players(r).regen ?? 'default');
      return withPlayers(r, { regen: REGEN_RULES[cycleIndex(REGEN_RULES.length, i, d)]! });
    },
  },
  {
    id: 'respawn',
    labelKey: 'custom.row.respawn',
    value: (r) => t('custom.seconds', { n: players(r).respawnS ?? 3 }),
    step: (r, d) => withPlayers(r, { respawnS: stepList(RESPAWNS, players(r).respawnS ?? 3, d) }),
  },
  {
    id: 'protection',
    labelKey: 'custom.row.protection',
    value: (r) => t('custom.seconds', { n: players(r).spawnProtectionS ?? 1.5 }),
    step: (r, d) => withPlayers(r, { spawnProtectionS: stepList(PROTECTIONS, players(r).spawnProtectionS ?? 1.5, d) }),
  },
  flag(
    'fall',
    'custom.row.fall',
    // M8 (fase 7): o Arcade não tem dano de queda (o padrão do perfil).
    (r) => players(r).fallDamage ?? movementOf(r) !== 'arcade',
    (r, v) => withPlayers(r, { fallDamage: v }),
  ),
  // M2 (fase 6b): a câmera permitida (livre ou só a 1ª pessoa).
  {
    id: 'camera',
    labelKey: 'custom.row.camera',
    value: (r) => t(players(r).camera === 'first' ? 'custom.camera.first' : 'custom.camera.any'),
    step: (r) => withPlayers(r, { camera: players(r).camera === 'first' ? 'any' : 'first' }),
  },
];

const WEAPON_ROWS: readonly RowDef[] = [
  // M11 (fase 4): a primária livre (o radial da tela de morte) ou pega no mapa (todos nascem de pistola).
  {
    id: 'pickups',
    labelKey: 'custom.row.pickups',
    // Revisão: ligada mas sem valer (as armas permitidas sem primária, ou um mapa sem pontos), diz que não vale.
    value: (r) =>
      t(
        weapons(r).pickups !== true
          ? 'custom.pickups.free'
          : mapWeaponsInEffect(r)
            ? 'custom.pickups.map'
            : 'custom.pickups.idle',
      ),
    step: (r) => withPickups(r, weapons(r).pickups !== true),
  },
  {
    id: 'allowed',
    labelKey: 'custom.row.allowed',
    value: (r) => t(ALLOWED_KEYS[allowedIndex(r)]!),
    step: (r, d) => {
      const i = cycleIndex(ALLOWED_CHOICES.length, allowedIndex(r), d);
      return withWeapons(r, { allowed: ALLOWED_CHOICES[i]! });
    },
  },
  {
    id: 'ammo',
    labelKey: 'custom.row.ammo',
    // M6 (fase 4): o modificador "munição infinita" aparece como o pente infinito; mexer na linha tira o modificador.
    value: (r) => t(`custom.ammo.${ammoOf(r)}` as StringKey),
    step: (r, d) => {
      const i = AMMO_MODES.indexOf(ammoOf(r));
      return withWeapons(withModifier(r, 'infiniteAmmo', false), {
        ammo: AMMO_MODES[cycleIndex(AMMO_MODES.length, i, d)]!,
      });
    },
  },
  {
    id: 'damage',
    labelKey: 'custom.row.damage',
    value: (r) => mult(weapons(r).damageMul ?? 1),
    step: (r, d) => withWeapons(r, { damageMul: stepList(DAMAGES, weapons(r).damageMul ?? 1, d) }),
  },
  flag(
    'ads',
    'custom.row.ads',
    (r) => weapons(r).ads ?? true,
    (r, v) => withWeapons(r, { ads: v }),
  ),
  flag(
    'assist',
    'custom.row.assist',
    (r) => weapons(r).aimAssist ?? true,
    (r, v) => withWeapons(r, { aimAssist: v }),
  ),
];

function allowedIndex(r: MatchRecipe): number {
  return choiceIndex(weapons(r).allowed ?? []);
}

/** A escolha do bot do time `team` (o de fábrica, o da Oficina ou o esquadrão). */
function chooseRow(team: number, labelKey: StringKey): RowDef {
  return {
    id: `bot${team}`,
    labelKey,
    value: (rr, l) => {
      const bots = rr.teams[team]?.bots ?? [];
      if (bots.length < 2) return botName(refOf(rr, team), rr);
      const q = l !== undefined ? squadOfTeam(rr, team, l) : null;
      if (q !== null) return t('custom.squad', { name: q.name });
      // Sem um esquadrão igual (um preset antigo, ou o esquadrão mudou): o primeiro bot e quantos tipos a mais.
      return t('custom.mixed', { name: botName(refOf(rr, team), rr), n: bots.length - 1 });
    },
    step: (rr, d, l) => {
      const choices = botChoices(rr, team, l);
      const i = cycleIndex(choices.length, Math.max(0, choices.indexOf(currentChoice(rr, team, l))), d);
      const pick = choices[i]!;
      if (pick === MIXED) return rr;
      if (pick.startsWith(SQUAD)) {
        const q = l.squads?.find((s) => SQUAD + s.id === pick);
        if (!q) return rr;
        const teams = rr.teams.map((tm, k) => (k === team ? { ...tm, bots: q.bots.map((b) => ({ ...b })) } : tm));
        return syncEmbedded(fitMap({ ...rr, teams }, l), l);
      }
      const next = setTeam(rr, team, pick as BotRef, Math.max(minBots(rr, team), botsOf(rr, team)));
      return syncEmbedded(next, l);
    },
  };
}

/** Quantos bots o time `team` tem (do mínimo dele até o teto do mapa menos os bots dos outros times). */
function countRow(team: number, labelKey: StringKey): RowDef {
  return {
    id: `count${team}`,
    labelKey,
    value: (rr) => String(botsOf(rr, team)),
    step: (rr, d, l) => {
      let other = 0;
      if (!ffa(rr)) for (let k = 0; k < rr.teams.length; k++) if (k !== team) other += botsOf(rr, k);
      const n = Math.max(minBots(rr, team), Math.min(mapBotCap(rr.map, l.maxBots) - other, teamTotal(rr, team) + d));
      return syncEmbedded(setTotal(rr, team, n), l);
    },
  };
}

function botRows(r: MatchRecipe): readonly RowDef[] {
  if (ffa(r)) return [chooseRow(0, 'custom.row.bot'), countRow(0, 'quick.size'), DIRECTOR_ROW];
  return [
    chooseRow(0, 'custom.row.allyBot'),
    countRow(0, 'custom.row.allies'),
    chooseRow(1, 'custom.row.enemyBot'),
    countRow(1, 'custom.row.enemies'),
    DIRECTOR_ROW,
  ];
}

/** M9 (fase 3): a vida do time no Sandbox (de 1, o "um toque derruba", a 1000; ausente = a da partida). */
const TEAM_HPS = [1, 10, 25, 50, 75, 100, 150, 200, 300, 500, 1000];

const teamHpOf = (r: MatchRecipe, team: number): number => r.teams[team]?.hp ?? players(r).hp ?? 100;

/** Índice de uma lista de armas nas escolhas (`ALLOWED_CHOICES`; desconhecida = Todas). */
function choiceIndex(list: readonly string[]): number {
  const i = ALLOWED_CHOICES.findIndex((c) => c.length === list.length && c.every((id) => list.includes(id)));
  return i < 0 ? 0 : i;
}

/** Troca um campo do time `team` (`undefined` tira o campo: o nome, a vida, as armas e a cor voltam ao padrão). */
function withTeamField<K extends 'name' | 'hp' | 'weapons' | 'color'>(
  r: MatchRecipe,
  team: number,
  key: K,
  value: TeamRecipe[K] | undefined,
): MatchRecipe {
  const teams = r.teams.map((tm, i) => {
    if (i !== team) return tm;
    const { [key]: _drop, ...rest } = tm;
    return (value === undefined ? rest : { ...rest, [key]: value }) as unknown as TeamRecipe;
  });
  return { ...r, teams };
}

/**
 * M9 (fase 3): o nome do time `team` (o que o jogador digitou; vazio ou o da cor = sem nome, o da cor aparece). Só o
 * que o teclado aceita (`cleanTypedName` na digitação), no máximo `TEAM_NAME_MAX`.
 */
export function withTeamName(r: MatchRecipe, team: number, name: string): MatchRecipe {
  const clean = name.trim();
  return withTeamField(r, team, 'name', clean === '' || clean === teamColorName(r, team) ? undefined : clean);
}

/** M10 (fase 8): a 1ª cor da paleta fora de `used`. */
function freeColor(used: readonly number[]): number {
  let c = 0;
  while (used.includes(c)) c++;
  return c;
}

/**
 * M10 (fase 8): a cor do time `team` anda para a próxima (no sentido de `delta`) que nenhum outro time usa; voltar à
 * da posição tira o campo (a receita fica como antes da escolha).
 */
function stepTeamColor(r: MatchRecipe, team: number, delta: number): MatchRecipe {
  const taken = r.teams.map((_tm, k) => (k === team ? -1 : teamColorIndex(r, k)));
  let c = teamColorIndex(r, team);
  for (let k = 0; k < TEAM_PALETTE.length; k++) {
    c = cycleIndex(TEAM_PALETTE.length, c, delta);
    if (!taken.includes(c)) break;
  }
  return withTeamField(r, team, 'color', c === team ? undefined : c);
}

/** M9 (fase 3): a linha do nome do time é `teamName<i>`: o confirmar abre o teclado (o `game` cuida); -1 = outra. */
export function customNameTeam(rowId: string): number {
  const m = /^teamName([0-3])$/.exec(rowId);
  return m ? Number(m[1]) : -1;
}

/** M9 (fase 3): os humanos (todos os locais) passam para o time `to`; o time que eles deixam fica com 1 bot no mínimo. */
function moveHumans(r: MatchRecipe, to: number, l: CustomLimits): MatchRecipe {
  const from = homeTeam(r);
  const teams = r.teams.map((tm, i): TeamRecipe => {
    const { humans: _humans, ...rest } = tm;
    if (i === to) return { ...rest, humans: 'all' };
    if (i === from && botsOf(r, i) === 0) return { ...rest, bots: [{ ref: refOf(r, i), count: 1 }] };
    return rest;
  });
  return fitMap({ ...r, teams }, l);
}

/**
 * M9 (fase 3): um time a mais (até 4) ou a menos (até 2). O novo vem com o bot e a quantidade do último time (dentro do
 * teto do mapa; sem folga, os maiores cedem); quem sai é o último, e os humanos que estavam nele vão para o 1º.
 */
function stepTeams(r: MatchRecipe, delta: number, l: CustomLimits): MatchRecipe {
  const n = r.teams.length;
  if (delta > 0 && n < ENGINE_MAX_TEAMS) {
    const last = n - 1;
    const room = mapBotCap(r.map, l.maxBots) - r.teams.reduce((s, _tm, i) => s + botsOf(r, i), 0);
    const count = Math.max(1, Math.min(Math.max(1, botsOf(r, last)), room));
    // M10 (fase 8): a cor da posição dele, se nenhum time a escolheu; senão, a 1ª livre.
    const used = r.teams.map((_tm, i) => teamColorIndex(r, i));
    const team: TeamRecipe = {
      bots: [{ ref: refOf(r, last), count }],
      ...(used.includes(n) ? { color: freeColor(used) } : {}),
    };
    return syncEmbedded(fitMap({ ...r, teams: [...r.teams, team] }, l), l);
  }
  if (delta < 0 && n > 2) {
    const home = homeTeam(r);
    let out: MatchRecipe = { ...r, teams: r.teams.slice(0, n - 1) };
    if (home === n - 1) out = moveHumans(out, 0, l);
    return syncEmbedded(out, l);
  }
  return r;
}

const TEAMS_ROW: RowDef = {
  id: 'teams',
  labelKey: 'custom.row.teams',
  value: (r) => String(r.teams.length),
  step: (r, d, l) => stepTeams(r, d, l),
};

/**
 * M9 (fase 3): a aba Times do Sandbox: quantos times, o seu e, por time, o nome, a cor (M10, fase 8), o bot, quantos,
 * a vida e as armas.
 */
function teamRows(r: MatchRecipe): readonly RowDef[] {
  const home = homeTeam(r);
  const rows: RowDef[] = [
    TEAMS_ROW,
    {
      id: 'you',
      labelKey: 'custom.row.you',
      swatch: teamColor(r, home) >>> 8,
      valueWidth: CUSTOM_NAME_VALUE_WIDTH,
      value: (rr) => teamName(rr, homeTeam(rr)),
      step: (rr, d, l) => moveHumans(rr, cycleIndex(rr.teams.length, homeTeam(rr), d), l),
    },
  ];
  for (let i = 0; i < r.teams.length; i++) {
    const labelParams = { team: teamColorName(r, i) };
    const swatch = teamColor(r, i) >>> 8;
    rows.push(
      {
        id: `teamName${i}`,
        labelKey: 'custom.row.teamName',
        labelParams,
        swatch,
        valueWidth: CUSTOM_NAME_VALUE_WIDTH,
        valueOnly: true,
        value: (rr) => teamName(rr, i),
        // O confirmar abre o teclado (o `game`); as setas não mudam o nome.
        step: (rr) => rr,
      },
      // M10 (fase 8): a cor (o quadradinho mostra a escolhida; as setas pulam as dos outros times).
      {
        id: `teamColor${i}`,
        labelKey: 'custom.row.teamColor',
        labelParams,
        swatch,
        value: (rr) => teamColorName(rr, i),
        step: (rr, d) => stepTeamColor(rr, i, d),
      },
      { ...chooseRow(i, 'custom.row.teamBot'), labelParams },
      { ...countRow(i, 'custom.row.teamCount'), labelParams },
      {
        id: `teamHp${i}`,
        labelKey: 'custom.row.teamHp',
        labelParams,
        value: (rr) => String(teamHpOf(rr, i)),
        step: (rr, d) => withTeamField(rr, i, 'hp', stepList(TEAM_HPS, teamHpOf(rr, i), d)),
      },
      {
        id: `teamArms${i}`,
        labelKey: 'custom.row.teamArms',
        labelParams,
        value: (rr) => t(ALLOWED_KEYS[choiceIndex(rr.teams[i]?.weapons ?? [])]!),
        step: (rr, d) => {
          const k = cycleIndex(ALLOWED_CHOICES.length, choiceIndex(rr.teams[i]?.weapons ?? []), d);
          const list = ALLOWED_CHOICES[k]!;
          return withTeamField(rr, i, 'weapons', list.length > 0 ? list : undefined);
        },
      },
    );
  }
  return rows;
}

/** M8 (fase 5): o Diretor de Partida na aba Bots: desligado (sem o bloco), Relax, Equilibrado ou Desafio. */
const DIRECTOR_CHOICES = [null, 'relax', 'balanced', 'challenge'] as const;

const DIRECTOR_ROW: RowDef = {
  id: 'director',
  labelKey: 'custom.row.director',
  value: (r) =>
    r.director === undefined ? t('director.off') : t(`director.goal.${r.director.goal ?? 'balanced'}` as StringKey),
  step: (r, d) => {
    const cur = r.director === undefined ? null : (r.director.goal ?? 'balanced');
    const pick = DIRECTOR_CHOICES[cycleIndex(DIRECTOR_CHOICES.length, DIRECTOR_CHOICES.indexOf(cur), d)]!;
    const { director: _drop, ...rest } = r;
    return pick === null ? rest : { ...rest, director: { goal: pick } };
  },
};

/** M6 (fase 4): liga ou desliga um modificador fixo (na ordem da lista; ligar tira o que conflita com ele). */
function withModifier(r: MatchRecipe, id: ModifierId, on: boolean): MatchRecipe {
  // O "um tiro mata" da regra de arma conflita como o modificador: ligar um que conflita com ele o desliga.
  if (on && modifiersConflict('oneShot', id) && weapons(r).oneShot === true) r = withWeapons(r, { oneShot: false });
  const now = r.modifiers ?? [];
  const list = MODIFIERS.filter((m) => (m === id ? on : now.includes(m) && !(on && modifiersConflict(m, id))));
  const { modifiers: _drop, ...rest } = r;
  return list.length > 0 ? { ...rest, modifiers: list } : rest;
}

const hasModifier = (r: MatchRecipe, id: ModifierId): boolean => (r.modifiers ?? []).includes(id);

/** Ligando `id` pela regra de arma, sai o modificador que conflita com ele (Invisíveis e tudo explode com um tiro mata). */
function withoutConflicts(r: MatchRecipe, id: ModifierId, on: boolean): MatchRecipe {
  if (!on) return r;
  let out = r;
  for (const m of r.modifiers ?? []) if (modifiersConflict(id, m)) out = withModifier(out, m, false);
  return out;
}

/** A munição como a linha mostra: o modificador "munição infinita" vale como o pente infinito. */
const ammoOf = (r: MatchRecipe): (typeof AMMO_MODES)[number] =>
  hasModifier(r, 'infiniteAmmo') ? 'infiniteClip' : (weapons(r).ammo ?? 'normal');

function modifierFlag(id: ModifierId, rowId: string, labelKey: StringKey): RowDef {
  const row = flag(
    rowId,
    labelKey,
    (r) => (r.modifiers ?? []).includes(id),
    (r, v) => withModifier(r, id, v),
  );
  if (id !== 'lowGravity' && id !== 'arcade') return row;
  // M10 (fase 4, revisão): num mapa de gravidade baixa a Lua já vale (é a do mapa) e o Arcade não (a sim desliga).
  return { ...row, value: (r) => (mapGravity(r.map) < 1 ? on(id === 'lowGravity') : row.value(r)) };
}

/** M6 (fase 4): a Roleta do Bobo Chaos (ligada com os padrões: 3 modificadores, troca a cada 60 s). */
function withChaos(r: MatchRecipe, on: boolean): MatchRecipe {
  const { chaos: _drop, ...rest } = r;
  return on ? { ...rest, chaos: {} } : rest;
}

const MOD_ROWS: readonly RowDef[] = [
  // M6 (fase 4): ligada pela regra de arma ou pelo modificador; desligar tira os dois.
  flag(
    'headshot',
    'custom.row.headshotOnly',
    (r) => (weapons(r).headshotOnly ?? false) || hasModifier(r, 'headshotOnly'),
    (r, v) => withWeapons(withModifier(r, 'headshotOnly', false), { headshotOnly: v }),
  ),
  flag(
    'oneShot',
    'custom.row.oneShot',
    (r) => (weapons(r).oneShot ?? false) || hasModifier(r, 'oneShot'),
    (r, v) => withWeapons(withModifier(withoutConflicts(r, 'oneShot', v), 'oneShot', false), { oneShot: v }),
  ),
  flag(
    'sniperBody',
    'custom.row.sniperBody',
    (r) => weapons(r).sniperBodyKill ?? false,
    (r, v) => withWeapons(r, { sniperBodyKill: v }),
  ),
  flag(
    'recoil',
    'custom.row.recoil',
    (r) => weapons(r).recoil ?? true,
    (r, v) => withWeapons(r, { recoil: v }),
  ),
  flag(
    'spread',
    'custom.row.spread',
    (r) => weapons(r).spread ?? true,
    (r, v) => withWeapons(r, { spread: v }),
  ),
  {
    id: 'friendly',
    labelKey: 'custom.row.friendlyFire',
    value: (r) => {
      const v = weapons(r).friendlyFire ?? 0;
      return t(v === 0 ? 'custom.off' : v === 1 ? 'custom.ff.full' : 'custom.ff.half');
    },
    step: (r, d) => {
      const i = Math.max(0, (FRIENDLY_FIRE_LEVELS as readonly number[]).indexOf(weapons(r).friendlyFire ?? 0));
      return withWeapons(r, { friendlyFire: FRIENDLY_FIRE_LEVELS[cycleIndex(FRIENDLY_FIRE_LEVELS.length, i, d)]! });
    },
  },
  flag(
    'self',
    'custom.row.selfDamage',
    (r) => weapons(r).selfDamage ?? true,
    (r, v) => withWeapons(r, { selfDamage: v }),
  ),
  {
    id: 'gravity',
    labelKey: 'custom.row.gravity',
    // M10 (fase 4, revisão): num mapa com gravidade de série, a que vale de verdade entre parênteses (a regra vezes a
    // do mapa, nunca abaixo de 0,25: `mapGravityFloor` da sim).
    value: (r) => {
      const g = players(r).gravity ?? 1;
      const m = mapGravity(r.map);
      return m === 1 ? mult(g) : `${mult(g)} (${mult(Math.max(MAP_GRAVITY_RANGE.min, g * m))})`;
    },
    step: (r, d) => withPlayers(r, { gravity: stepList(GRAVITIES, players(r).gravity ?? 1, d) }),
  },
  // M6 (fase 4): os modificadores de festa (GDD §4.5.3) e a Roleta, em qualquer modo.
  modifierFlag('lowGravity', 'lowGravity', 'custom.row.lowGravity'),
  modifierFlag('heavyGravity', 'heavyGravity', 'custom.row.heavyGravity'),
  modifierFlag('speed', 'speedMod', 'custom.row.speedMod'),
  modifierFlag('vampire', 'vampire', 'custom.row.vampire'),
  modifierFlag('explosive', 'explosive', 'custom.row.explosive'),
  modifierFlag('swapOnKill', 'swapOnKill', 'custom.row.swapOnKill'),
  modifierFlag('bigHead', 'bigHead', 'custom.row.bigHead'),
  modifierFlag('invisible', 'invisible', 'custom.row.invisible'),
  modifierFlag('confetti', 'confetti', 'custom.row.confetti'),
  // M8 (fase 7): o Arcade como modificador (o perfil inteiro, a partida toda).
  modifierFlag('arcade', 'arcade', 'custom.row.arcade'),
  // M9 (fase 1).
  modifierFlag('mini', 'mini', 'custom.row.mini'),
  modifierFlag('giantBots', 'giantBots', 'custom.row.giantBots'),
  modifierFlag('ricochet', 'ricochet', 'custom.row.ricochet'),
  flag(
    'chaos',
    'custom.row.chaos',
    (r) => r.chaos !== undefined,
    (r, v) => withChaos(r, v),
  ),
];

const HUD_ROWS: readonly RowDef[] = [
  flag(
    'killFeed',
    'custom.row.killFeed',
    (r) => hud(r).killFeed ?? true,
    (r, v) => withHud(r, { killFeed: v }),
  ),
  flag(
    'hitmarker',
    'custom.row.hitmarker',
    (r) => hud(r).hitmarker ?? true,
    (r, v) => withHud(r, { hitmarker: v }),
  ),
  flag(
    'allyMarkers',
    'custom.row.allyMarkers',
    (r) => hud(r).allyMarkers ?? true,
    (r, v) => withHud(r, { allyMarkers: v }),
  ),
];

/** M3 (fase 6b): Jogadores no Bobo Zombies: os bots de apoio, o movimento, a queda e a câmera (vida e renascer são do modo). */
function zombiePlayerRows(r: MatchRecipe): readonly RowDef[] {
  const keep = new Set(['fall', 'camera']);
  const movement = movementOf(r) === 'custom' ? [MOVEMENT_ROW, ...CUSTOM_MOVEMENT_ROWS] : [MOVEMENT_ROW];
  return [...SUPPORT_ROWS, ...movement, ...PLAYER_ROWS.filter((x) => keep.has(x.id))];
}

/** M3 (fase 6b): Armas no Bobo Zombies: as armas vêm da parede e da caixa, então só o dano, a mira e o recuo. */
const ZOMBIE_WEAPON_IDS = new Set(['damage', 'ads', 'assist']);

/**
 * M9 (fase 3): a aba Partida do Sandbox: o objetivo depois do mapa; o tempo só com objetivo (o "nenhum" não acaba) e a
 * meta só nos pontos (a eliminação acaba com o último time de pé).
 */
function sandboxMatchRows(r: MatchRecipe): readonly RowDef[] {
  const objective = objectiveOf(r);
  const out: RowDef[] = [];
  for (const row of MATCH_ROWS) {
    if (row.id === 'time' && objective === 'none') continue;
    if (row.id === 'score' && objective !== 'points') continue;
    out.push(row);
    if (row.id === 'map') out.push(OBJECTIVE_ROW);
  }
  return out;
}

/** As linhas de uma aba (as de Bots dependem do modo). */
export function customRows(tab: CustomTab, r: MatchRecipe): readonly RowDef[] {
  if (r.mode === 'zombies') {
    if (tab === 'match') return [...ZOMBIE_MATCH_ROWS, ...MATCH_ROWS.filter((x) => x.id === 'view')];
    if (tab === 'players') return zombiePlayerRows(r);
    if (tab === 'weapons') {
      return [
        ...WEAPON_ROWS.filter((x) => ZOMBIE_WEAPON_IDS.has(x.id)),
        ...MOD_ROWS.filter((x) => x.id === 'recoil' || x.id === 'spread'),
      ];
    }
  }
  switch (tab) {
    case 'match':
      return sandbox(r) ? sandboxMatchRows(r) : MATCH_ROWS;
    case 'teams':
      return sandbox(r) ? teamRows(r) : [];
    case 'players':
      return movementOf(r) === 'custom'
        ? [MOVEMENT_ROW, ...CUSTOM_MOVEMENT_ROWS, ...PLAYER_ROWS]
        : [MOVEMENT_ROW, ...PLAYER_ROWS];
    case 'weapons':
      return WEAPON_ROWS;
    case 'bots':
      return botRows(r);
    case 'mods':
      return MOD_ROWS;
    case 'hud':
      return HUD_ROWS;
  }
}

/** Um passo na linha `id` da aba (`delta` 0 = o confirmar, que avança). */
export function stepCustom(
  tab: CustomTab,
  r: MatchRecipe,
  id: string,
  delta: number,
  limits: CustomLimits,
): MatchRecipe {
  const row = customRows(tab, r).find((x) => x.id === id);
  const next = row ? row.step(r, delta === 0 ? 1 : delta, limits) : r;
  // M12 (fase 3): a Fortaleza leva o mapa no nome ("Fortaleza: Posto Avançado"), também quando a linha Mapa troca.
  // (O nome de antes do M12, sem o mapa, também.)
  const fortress = r.name === fortressName(r.map) || r.name === 'Bobo Zombies: Fortaleza';
  if (next.map !== r.map && next.zombies?.variant === 'fortress' && fortress) {
    return { ...next, name: fortressName(next.map) };
  }
  return next;
}

/**
 * Nome do preset salvo, sem digitar (gameplay.md §10.1): "Times De boa 4×4", "Todos contra todos Tryhard 8 bots";
 * repetido com outro jeito de partida, ganha " 2", " 3"…
 */
/**
 * Refino R4c (#79): a frase embaixo das linhas para o foco atual (`tab:<i>` ou `row:<id>`), da tabela extra
 * (`custom.help.*`); sem frase (os botões do canto), `''`.
 */
export function customHelp(tabs: readonly CustomTab[], focusedId: string | null): string {
  if (focusedId === null) return '';
  let key: string;
  if (focusedId.startsWith('tab:')) {
    const tab = tabs[Number(focusedId.slice(4))];
    if (tab === undefined) return '';
    key = `custom.help.tab.${tab}`;
  } else if (focusedId.startsWith('row:')) key = `custom.help.${focusedId.slice(4)}`;
  else return '';
  // O `t` devolve a própria chave quando ela não existe. M9 (fase 3): as linhas de cada time (`teamHp2`, `bot3`) usam a
  // frase sem o número.
  for (const k of [key, key.replace(/\d+$/, '')]) {
    const text = t(k as StringKey);
    if (text !== k) return text;
  }
  return '';
}

/**
 * M9 (fase 3): as linhas da aba como a tela mostra (o rótulo com o time, o quadradinho da cor e o valor). Mora aqui,
 * no pedaço dos editores, para o menu da web não pagar por ela.
 */
export function customRowViews(
  tab: CustomTab,
  r: MatchRecipe,
  limits: CustomLimits,
): {
  readonly id: string;
  readonly labelKey: StringKey;
  readonly labelParams?: TextParams;
  readonly swatch?: number;
  readonly valueWidth?: number;
  readonly valueOnly?: boolean;
  readonly value: string;
}[] {
  return customRows(tab, r).map((row) => ({
    id: row.id,
    labelKey: row.labelKey,
    ...(row.labelParams !== undefined ? { labelParams: row.labelParams } : {}),
    ...(row.swatch !== undefined ? { swatch: row.swatch } : {}),
    ...(row.valueWidth !== undefined ? { valueWidth: row.valueWidth } : {}),
    ...(row.valueOnly === true ? { valueOnly: true } : {}),
    value: row.value(r, limits),
  }));
}

export function presetName(base: string, taken: (name: string) => boolean): string {
  if (!taken(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const name = `${base} ${n}`;
    if (!taken(name)) return name;
  }
  return base;
}
