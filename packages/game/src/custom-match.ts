import {
  AMMO_MODES,
  BOT_LEVELS,
  builtinBotRef,
  FRIENDLY_FIRE_LEVELS,
  REGEN_RULES,
  type BotDocument,
  type BotRef,
  type MatchRecipe,
  type PlayerRules,
  type WeaponRules,
  type HudRules,
} from '@boboforces/format';
import { formatDecimal, t, type StringKey } from '@boboforces/ui';
import { mapBotCap, mapForMode, mapName, mapsForMode, type MenuMap } from './maps.ts';

/**
 * M2 (fase 4e): o editor da Partida personalizada (gameplay.md §10.3), lógica pura sobre a receita. Cada aba tem
 * linhas; cada linha tem o valor em texto e um passo (-1/+1; o confirmar avança) que devolve a receita nova. Os
 * tamanhos param no teto de bots do aparelho e o alcance de visão no teto dele. Os bots são um por time (o nível
 * rápido ou um bot de fábrica) com a quantidade; misturas por porcentagem ficam para o Laboratório.
 */

export const CUSTOM_TABS = ['match', 'players', 'weapons', 'bots', 'mods', 'hud'] as const;
export type CustomTab = (typeof CUSTOM_TABS)[number];

export const CUSTOM_TAB_LABELS: Readonly<Record<CustomTab, StringKey>> = {
  match: 'custom.tab.match',
  players: 'custom.tab.players',
  weapons: 'custom.tab.weapons',
  bots: 'custom.tab.bots',
  mods: 'custom.tab.mods',
  hud: 'custom.tab.hud',
};

export interface CustomLimits {
  readonly maxBots: number;
  readonly maxViewM: number;
  /** M2 (fase 5b): os bots da Oficina, que entram na escolha do bot de cada time (embutidos no preset). */
  readonly savedBots?: readonly BotDocument[];
}

interface RowDef {
  readonly id: string;
  readonly labelKey: StringKey;
  value(r: MatchRecipe): string;
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
/** M2 (fase 5b): o Laboratório usa as mesmas escolhas de armas. */
export const ALLOWED_CHOICES: readonly (readonly string[])[] = [
  [],
  ['rifle'],
  ['smg'],
  ['shotgun'],
  ['sniper'],
  ['rocket'],
  ['lmg'],
  ['pistol'],
  ['knife'],
];
export const ALLOWED_KEYS: readonly StringKey[] = [
  'custom.allowed.all',
  'custom.allowed.rifle',
  'custom.allowed.smg',
  'custom.allowed.shotgun',
  'custom.allowed.sniper',
  'custom.allowed.rocket',
  'custom.allowed.lmg',
  'custom.allowed.pistol',
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

function flag(
  id: string,
  labelKey: StringKey,
  get: (r: MatchRecipe) => boolean,
  set: (r: MatchRecipe, v: boolean) => MatchRecipe,
): RowDef {
  return { id, labelKey, value: (r) => on(get(r)), step: (r) => set(r, !get(r)) };
}

const ffa = (r: MatchRecipe): boolean => r.mode === 'warfare.ffa';
const botsOf = (r: MatchRecipe, team: number): number => (r.teams[team]?.bots ?? []).reduce((n, b) => n + b.count, 0);
const refOf = (r: MatchRecipe, team: number): BotRef => r.teams[team]?.bots[0]?.ref ?? builtinBotRef('normal');

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

/** As escolhas de bot: os de fábrica, os da Oficina e o embutido que já está no preset (mesmo se saiu da Oficina). */
function botChoices(r: MatchRecipe, team: number, l: CustomLimits): BotRef[] {
  const refs: BotRef[] = [...CUSTOM_BOTS, ...(l.savedBots ?? []).map((b): BotRef => `embedded:${b.id}`)];
  const current = refOf(r, team);
  if (!refs.includes(current)) refs.push(current);
  return refs;
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
  const cap = mapBotCap(r.map, l.maxBots);
  if (ffa(r)) return botsOf(r, 0) > cap ? setTeam(r, 0, refOf(r, 0), cap) : r;
  const enemies = Math.min(botsOf(r, 1), Math.ceil(cap / 2));
  const allies = Math.min(botsOf(r, 0), cap - enemies);
  if (enemies === botsOf(r, 1) && allies === botsOf(r, 0)) return r;
  return setTeam(setTeam(r, 1, refOf(r, 1), enemies), 0, refOf(r, 0), allies);
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
const SCORES = [10, 15, 20, 25, 30, 50, 75, 100, 150, 0];
const VIEWS = [50, 75, 100, 125, 140];
const HPS = [25, 50, 75, 100, 150, 200, 300, 500, 1000];
const RESPAWNS = [0, 1, 2, 3, 5, 8, 10, 15];
const PROTECTIONS = [0, 0.5, 1, 1.5, 2, 3, 5];
const DAMAGES = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5];
const GRAVITIES = [0.25, 0.5, 0.75, 1, 1.5, 2];
/** M2 (fase 6a): os perfis do M2 (o Arcade é do M6+) e os passos do Personalizado. */
const MOVEMENTS = ['bobo', 'tactical', 'custom'] as const;
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

const MATCH_ROWS: readonly RowDef[] = [
  {
    id: 'mode',
    labelKey: 'quick.mode',
    value: (r) => t(ffa(r) ? 'mode.short.warfare.ffa' : 'mode.short.warfare.tdm'),
    step: (r, _d, l) => {
      // O mapa precisa ter o modo novo (o Ringue não tem FFA).
      const next = switchMode(r, l.maxBots);
      return fitMap({ ...next, map: mapForMode(next.map, next.mode) }, l);
    },
  },
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
      const s = r.match?.timeLimitS ?? 0;
      return s === 0 ? t('quick.noTime') : t('summary.time', { min: Math.round(s / 60) });
    },
    step: (r, d) => {
      const cur = r.match?.timeLimitS ?? 0;
      const i = cycleIndex(TIMES.length, Math.max(0, TIMES.indexOf(cur)), d);
      return { ...r, match: { ...r.match, timeLimitS: TIMES[i]! } };
    },
  },
  {
    id: 'score',
    labelKey: 'custom.row.score',
    value: (r) => {
      const n = r.match?.scoreLimit ?? 0;
      return n === 0 ? t('custom.noScore') : t('custom.kills', { n });
    },
    step: (r, d) => {
      const cur = r.match?.scoreLimit ?? 0;
      const i = cycleIndex(SCORES.length, Math.max(0, SCORES.indexOf(cur)), d);
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

/** M2 (fase 6a): o perfil de movimento; com o Personalizado, a velocidade e o pulo logo abaixo. */
const MOVEMENT_ROW: RowDef = {
  id: 'movement',
  labelKey: 'custom.row.movement',
  value: (r) => t(`movement.${movementOf(r)}` as StringKey),
  step: (r, d) => {
    const i = cycleIndex(MOVEMENTS.length, MOVEMENTS.indexOf(movementOf(r)), d);
    return withPlayers(r, { movement: MOVEMENTS[i]! });
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

/** O perfil do M2 da receita (o Arcade, que só chega no M6+, aparece como Bobo, que é como a sim joga). */
function movementOf(r: MatchRecipe): (typeof MOVEMENTS)[number] {
  const m = players(r).movement;
  return m === 'tactical' || m === 'custom' ? m : 'bobo';
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
    (r) => players(r).fallDamage ?? true,
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
    value: (r) => t(`custom.ammo.${weapons(r).ammo ?? 'normal'}` as StringKey),
    step: (r, d) => {
      const i = AMMO_MODES.indexOf(weapons(r).ammo ?? 'normal');
      return withWeapons(r, { ammo: AMMO_MODES[cycleIndex(AMMO_MODES.length, i, d)]! });
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
  const a = weapons(r).allowed ?? [];
  const i = ALLOWED_CHOICES.findIndex((c) => c.length === a.length && c.every((id) => a.includes(id)));
  return i < 0 ? 0 : i;
}

function botRows(r: MatchRecipe): readonly RowDef[] {
  const choose = (team: number): RowDef => ({
    id: `bot${team}`,
    labelKey: ffa(r) ? 'custom.row.bot' : team === 0 ? 'custom.row.allyBot' : 'custom.row.enemyBot',
    value: (rr) => botName(refOf(rr, team), rr),
    step: (rr, d, l) => {
      const choices = botChoices(rr, team, l);
      const i = cycleIndex(choices.length, Math.max(0, choices.indexOf(refOf(rr, team))), d);
      const next = setTeam(rr, team, choices[i]!, Math.max(team === 0 && !ffa(rr) ? 0 : 1, botsOf(rr, team)));
      return syncEmbedded(next, l);
    },
  });
  const count = (team: number): RowDef => ({
    id: `count${team}`,
    labelKey: ffa(r) ? 'quick.size' : team === 0 ? 'custom.row.allies' : 'custom.row.enemies',
    value: (rr) => String(botsOf(rr, team)),
    step: (rr, d, l) => {
      const other = ffa(rr) ? 0 : botsOf(rr, 1 - team);
      const min = team === 0 && !ffa(rr) ? 0 : 1;
      const n = Math.max(min, Math.min(mapBotCap(rr.map, l.maxBots) - other, botsOf(rr, team) + d));
      return setTeam(rr, team, refOf(rr, team), n);
    },
  });
  return ffa(r) ? [choose(0), count(0)] : [choose(0), count(0), choose(1), count(1)];
}

const MOD_ROWS: readonly RowDef[] = [
  flag(
    'headshot',
    'custom.row.headshotOnly',
    (r) => weapons(r).headshotOnly ?? false,
    (r, v) => withWeapons(r, { headshotOnly: v }),
  ),
  flag(
    'oneShot',
    'custom.row.oneShot',
    (r) => weapons(r).oneShot ?? false,
    (r, v) => withWeapons(r, { oneShot: v }),
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
    value: (r) => mult(players(r).gravity ?? 1),
    step: (r, d) => withPlayers(r, { gravity: stepList(GRAVITIES, players(r).gravity ?? 1, d) }),
  },
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

/** As linhas de uma aba (as de Bots dependem do modo). */
export function customRows(tab: CustomTab, r: MatchRecipe): readonly RowDef[] {
  switch (tab) {
    case 'match':
      return MATCH_ROWS;
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
  return row ? row.step(r, delta === 0 ? 1 : delta, limits) : r;
}

/**
 * Nome do preset salvo, sem digitar (gameplay.md §10.1): "Times De boa 4×4", "Todos contra todos Tryhard 8 bots";
 * repetido com outro jeito de partida, ganha " 2", " 3"…
 */
export function presetName(base: string, taken: (name: string) => boolean): string {
  if (!taken(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const name = `${base} ${n}`;
    if (!taken(name)) return name;
  }
  return base;
}
