import {
  BOT_LEVELS,
  builtinBotRef,
  encodeShareCode,
  MATCH_RECIPE_FORMAT,
  MODIFIERS,
  modifiersConflict,
  withPresetLevel,
  type BotLevel,
  type MatchRecipe,
  type ModifierId,
  type TeamRecipe,
} from '@boboforces/format';
import type { MenuInput, RawInputState } from '@boboforces/input';
import type { Platform } from '@boboforces/platform-api';
import { createRng, type Rng } from '@boboforces/shared';
import {
  buildTabbed,
  t,
  TABBED_ROW_PREFIX,
  type DrawList,
  type StringKey,
  type TabbedRow,
  type UiNode,
} from '@boboforces/ui';
import { createMenuController, type UiFrame } from './menu.ts';
import { mapBotCap, mapGravity, mapsForMode } from './maps.ts';
import { GUN_GAME_LADDER, moreModePreset } from './more-modes.ts';

/**
 * M8 (fase 3): o Surpreenda-me completo (GDD §3.3, gameplay.md "Surpreenda-me"): sorteia um modo (os 14 com card), um
 * mapa que vale para ele, as armas (livres ou uma fixa), de 0 a 3 modificadores, o nível dos bots e de 0 a 2 bots
 * "estrela" (os de fábrica com personalidade forte). Cada linha tem cadeado: travada, ela não muda no "Rolar de novo".
 * O código (`BFR1-`) guarda o sorteio em si (não a semente): quem colar joga a mesma partida, mesmo com o conteúdo
 * mudando de versão para versão (o que não existir mais é recusado).
 */
export const SURPRISE_LINES = ['mode', 'map', 'weapons', 'mods', 'enemies'] as const;
export type SurpriseLine = (typeof SURPRISE_LINES)[number];

/** A versão da tabela do sorteio no código (o que muda o significado de um campo sobe ela). */
export const SURPRISE_CODE_VERSION = 1;

export interface SurpriseRoll {
  /** O id do card (os da página Modos e os da Mais modos). */
  readonly mode: string;
  readonly map: string;
  /** `''` = as armas do modo (livres); senão a única arma da partida. */
  readonly weapon: string;
  readonly mods: readonly ModifierId[];
  readonly level: BotLevel;
  /** Os bots estrela (ids de fábrica) no time adversário. */
  readonly stars: readonly string[];
  /** Times e FFA: quantos por lado (ou bots no FFA) e a partida longa (10 min) ou curta (5). */
  readonly size: number;
  readonly long: boolean;
}

/** Os modos do sorteio, com o peso (os de festa aparecem menos que os Times). */
const POOL: readonly (readonly [string, number])[] = [
  ['warfare.tdm', 6],
  ['warfare.ffa', 3],
  ['warfare.domination', 2],
  ['gunGame', 2],
  ['infection', 2],
  ['juggernaut', 1],
  ['juggernautFixed', 1],
  ['chaos', 1],
  ['paintball', 2],
  ['zombies', 2],
  ['zombiesFortress', 1],
  ['zombiesArmed', 1],
  ['strike', 1],
  ['royale', 1],
];
const POOL_IDS: readonly string[] = POOL.map(([id]) => id);

/** Os modos que aceitam a arma fixa e os modificadores sorteados (os outros têm regra de arma própria). */
const FREE_RULES = new Set(['warfare.tdm', 'warfare.ffa', 'warfare.domination']);
/**
 * Os modos com o mapa sorteado (os outros dependem do mapa deles: os pontos do Domination, o gerador da Fortaleza, os
 * sites do BoboStrike, a ilha do Royale).
 */
const MAP_ROLL = new Set(['warfare.tdm', 'warfare.ffa', 'zombies']);
/** Os mapas que valem para o card. */
function mapsOf(mode: string): readonly string[] {
  const base = baseRecipe({ ...EMPTY_ROLL, mode });
  return MAP_ROLL.has(mode) ? (mapsForMode(base.mode) as readonly string[]) : [base.map];
}
/** Os modos que ganham bots estrela (os de time contra bots). */
const STAR_MODES = new Set(['warfare.tdm', 'warfare.ffa', 'warfare.domination', 'paintball', 'strike']);
/** Os modos sem bots de nível (a horda é da sim): o nível não muda nada neles. */
const NO_LEVEL_MODES = new Set(['zombies', 'zombiesFortress']);
const STARS = ['jorge-the-immortal', 'camper-carl', 'knife-ninja', 'scaredy-sam', 'hunter-hank', 'goofy-gus'] as const;
/** Os modificadores do sorteio (o Confete é só enfeite; fica de fora para não gastar uma vaga). */
const ROLL_MODS: readonly ModifierId[] = MODIFIERS.filter((m) => m !== 'confetti');

function pickWeighted(rng: Rng): string {
  let total = 0;
  for (const [, w] of POOL) total += w;
  let r = rng.int(0, total);
  for (const [id, w] of POOL) {
    if (r < w) return id;
    r -= w;
  }
  return POOL[0]![0];
}

/** A receita base do card (os Times, o FFA e o Zombies como no sorteio antigo; o resto, a da página Mais modos). */
function baseRecipe(roll: SurpriseRoll): MatchRecipe {
  const ref = builtinBotRef('normal');
  if (roll.mode === 'warfare.ffa') {
    return {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.ffa',
      map: 'construto',
      seed: 0,
      match: { timeLimitS: roll.long ? 600 : 300, scoreLimit: roll.long ? 25 : 15 },
      teams: [{ humans: 'all', bots: [{ ref, count: roll.size }] }],
    };
  }
  if (roll.mode === 'warfare.tdm') {
    return {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.tdm',
      map: 'construto',
      seed: 0,
      match: { timeLimitS: roll.long ? 600 : 300, scoreLimit: roll.long ? 75 : 30 },
      teams: [
        { humans: 'all', bots: roll.size > 1 ? [{ ref, count: roll.size - 1 }] : [] },
        { bots: [{ ref, count: roll.size }] },
      ],
    };
  }
  if (roll.mode === 'zombies') {
    return {
      format: MATCH_RECIPE_FORMAT,
      mode: 'zombies',
      map: 'base',
      seed: 0,
      match: { timeLimitS: 0, scoreLimit: 0 },
      teams: [{ humans: 'all', bots: [] }],
    };
  }
  return moreModePreset(roll.mode) ?? baseRecipe({ ...roll, mode: 'warfare.tdm' });
}

/** As estrelas entram no lugar de bots de nível do último time (no FFA, o único). */
function withStars(recipe: MatchRecipe, stars: readonly string[]): MatchRecipe {
  if (stars.length === 0) return recipe;
  const last = recipe.teams.length - 1;
  const teams = recipe.teams.map((team, i): TeamRecipe => {
    if (i !== last) return team;
    const bots = team.bots.map((b) => ({ ...b }));
    const total = bots.reduce((n, b) => n + b.count, 0);
    // Cada estrela tira um bot da primeira entrada que tem sobra (o time não cresce); time pequeno demais, sem estrela.
    let room = Math.max(0, total - 1);
    const added: { ref: `builtin:${string}`; count: number }[] = [];
    for (const id of stars) {
      if (room === 0) break;
      const from = bots.find((b) => b.count > 1);
      if (!from) break;
      from.count--;
      room--;
      added.push({ ref: `builtin:${id}`, count: 1 });
    }
    return { ...team, bots: [...bots.filter((b) => b.count > 0), ...added] };
  });
  return { ...recipe, teams };
}

/**
 * O tamanho que cabe no mapa (o Ringue leva 7 bots: 4 contra 4; a Base Bobo 9), como na Partida Rápida e na
 * personalizada: nos Times, os dois lados (o do jogador tem um bot a menos); no FFA, os bots.
 */
export function surpriseSize(roll: SurpriseRoll): number {
  const cap = mapBotCap(roll.map, 99);
  return roll.mode === 'warfare.ffa' ? Math.min(roll.size, cap) : Math.min(roll.size, Math.floor((cap + 1) / 2));
}

/** Os modificadores que valem com a arma sorteada (com uma arma só, o "troca a arma no abate" não faz nada). */
function activeMods(roll: SurpriseRoll): readonly ModifierId[] {
  if (!FREE_RULES.has(roll.mode)) return [];
  return roll.mods.filter(
    (m) => !(roll.weapon !== '' && m === 'swapOnKill') && !(roll.weapon === 'knife' && m === 'infiniteAmmo'),
  );
}

/** A receita do sorteio (o validador da cena ainda corta no teto do aparelho). */
export function surpriseRecipe(roll: SurpriseRoll): MatchRecipe {
  const base = baseRecipe({ ...roll, size: surpriseSize(roll) });
  let recipe = withPresetLevel(base, roll.level);
  if (mapsOf(roll.mode).includes(roll.map)) recipe = { ...recipe, map: roll.map };
  if (FREE_RULES.has(roll.mode)) {
    if (roll.weapon !== '') recipe = { ...recipe, weapons: { ...recipe.weapons, allowed: [roll.weapon] } };
    const mods = activeMods(roll);
    if (mods.length > 0) recipe = { ...recipe, modifiers: [...mods] };
  }
  if (STAR_MODES.has(roll.mode)) recipe = withStars(recipe, roll.stars);
  // O nome do card fica (o Gun Game, a Fortaleza): o atalho do JOGAR mostra o modo de verdade.
  return { ...recipe, name: base.name ?? t('surprise.presetName') };
}

/** Um sorteio novo; as linhas travadas (`locks`) ficam como em `prev`. */
export function rollSurprise(seed: number, prev: SurpriseRoll | null, locks: ReadonlySet<SurpriseLine>): SurpriseRoll {
  const rng = createRng(seed >>> 0);
  const keep = (line: SurpriseLine): boolean => prev !== null && locks.has(line);
  const mode = keep('mode') ? prev!.mode : pickWeighted(rng);
  const maps = mapsOf(mode);
  // O mapa travado que não vale para o modo novo é sorteado de novo (o cadeado vale enquanto o mapa couber).
  const map = keep('map') && maps.includes(prev!.map) ? prev!.map : (maps[rng.int(0, Math.max(1, maps.length))] ?? '');
  const free = FREE_RULES.has(mode);
  const weapon = keep('weapons')
    ? prev!.weapon
    : free && rng.chance(0.35)
      ? GUN_GAME_LADDER[rng.int(0, GUN_GAME_LADDER.length)]!
      : '';
  let mods: ModifierId[] = keep('mods') ? [...prev!.mods] : [];
  if (!keep('mods') && free) {
    const want = rng.int(0, 4);
    for (let tries = 0; tries < 20 && mods.length < want; tries++) {
      const m = ROLL_MODS[rng.int(0, ROLL_MODS.length)]!;
      // M10 (fase 4, revisão): num mapa de gravidade baixa a Lua não muda nada e a sim desliga o Arcade.
      const useless =
        (weapon !== '' && m === 'swapOnKill') ||
        (weapon === 'knife' && m === 'infiniteAmmo') ||
        (mapGravity(map) < 1 && (m === 'lowGravity' || m === 'arcade'));
      if (!useless && !mods.includes(m) && !mods.some((x) => modifiersConflict(x, m))) mods.push(m);
    }
  }
  const enemies = keep('enemies');
  const level = enemies ? prev!.level : BOT_LEVELS[rng.int(0, BOT_LEVELS.length)]!;
  const stars: string[] = enemies ? [...prev!.stars] : [];
  if (!enemies) {
    const n = rng.int(0, 3);
    for (let tries = 0; tries < 10 && stars.length < n; tries++) {
      const s = STARS[rng.int(0, STARS.length)]!;
      if (!stars.includes(s)) stars.push(s);
    }
  }
  // O tamanho e a duração andam com o modo (Times: 3 a 6 por lado; FFA: 5 a 9 bots).
  const size = keep('mode') ? prev!.size : mode === 'warfare.ffa' ? rng.int(5, 10) : rng.int(3, 7);
  const long = keep('mode') ? prev!.long : rng.chance(0.5);
  return { mode, map, weapon, mods, level, stars, size, long };
}

const EMPTY_ROLL: SurpriseRoll = {
  mode: 'warfare.tdm',
  map: 'construto',
  weapon: '',
  mods: [],
  level: 'normal',
  stars: [],
  size: 4,
  long: false,
};

/** O nome do modo do card (os de fábrica pela tabela da página Modos; os da Mais modos pela deles). */
function modeName(id: string): string {
  if (id === 'warfare.tdm' || id === 'warfare.ffa') return t(`mode.${id}` as StringKey);
  if (id === 'zombies') return t('mode.zombies');
  if (id === 'warfare.domination') return t('mode.name.domination' as StringKey);
  return t(`mode.name.${id}` as StringKey);
}

/** As estrelas que entram de verdade (o time pequeno demais não ganha nenhuma; os modos sem estrela, nenhuma). */
function starsIn(roll: SurpriseRoll): string[] {
  if (!STAR_MODES.has(roll.mode)) return [];
  const refs = new Set(surpriseRecipe(roll).teams.flatMap((tm) => tm.bots.map((b) => b.ref)));
  return roll.stars.filter((id) => refs.has(`builtin:${id}`));
}

/**
 * O texto curto de cada linha (o valor da linha tem ~23 letras: o resto vai em `surpriseDetails`): o modo, o mapa,
 * as armas, o 1º modificador e quantos a mais, o nível e quantas estrelas.
 */
export function surpriseLineText(roll: SurpriseRoll, line: SurpriseLine): string {
  switch (line) {
    case 'mode':
      return modeName(roll.mode);
    case 'map':
      return roll.map === '' ? '—' : t(`map.${roll.map}` as StringKey);
    case 'weapons':
      return FREE_RULES.has(roll.mode)
        ? roll.weapon === ''
          ? t('surprise.weaponsFree')
          : t('surprise.weaponOnly', { name: t(`weapon.${roll.weapon}` as StringKey) })
        : t('surprise.weaponsMode');
    case 'mods': {
      const mods = activeMods(roll);
      if (mods.length === 0) return t('surprise.modsNone');
      const first = t(`mod.${mods[0]!}` as StringKey);
      return mods.length === 1 ? first : t('surprise.more', { name: first, n: mods.length - 1 });
    }
    case 'enemies': {
      if (NO_LEVEL_MODES.has(roll.mode)) return t('surprise.enemiesMode');
      const level = t(`level.${roll.level}` as StringKey);
      const stars = starsIn(roll).length;
      return stars === 0 ? level : t(stars === 1 ? 'surprise.levelStar' : 'surprise.levelStars', { level, n: stars });
    }
  }
}

/**
 * A linha de baixo do título com o que não cabe nas linhas: o tamanho e o tempo (Times e FFA), os modificadores (com
 * 2 ou mais) e as estrelas pelo nome. `''` = nada a mais.
 */
export function surpriseDetails(roll: SurpriseRoll): string {
  const parts: string[] = [];
  const min = roll.long ? 10 : 5;
  if (roll.mode === 'warfare.tdm') parts.push(t('surprise.sizeTeams', { n: surpriseSize(roll), min }));
  else if (roll.mode === 'warfare.ffa') parts.push(t('surprise.sizeFfa', { n: surpriseSize(roll), min }));
  const mods = activeMods(roll);
  if (mods.length > 1) parts.push(mods.map((m) => t(`mod.${m}` as StringKey)).join(', '));
  const stars = starsIn(roll);
  if (stars.length > 0) {
    parts.push(t('surprise.starsNamed', { names: stars.map((s) => t(`bot.name.${s}` as StringKey)).join(' e ') }));
  }
  return parts.join(' · ');
}

/** O que vai no código `BFR1-` (o sorteio, com a versão da tabela). */
export function surpriseCodeDoc(roll: SurpriseRoll): Record<string, unknown> {
  return { v: SURPRISE_CODE_VERSION, ...roll };
}

/** O sorteio de um código (`null` = de outra versão, ou com algo que não existe mais). */
/** O código é de uma versão mais nova da tabela do sorteio ("atualize o jogo")? */
export function surpriseCodeIsNewer(doc: unknown): boolean {
  const v = typeof doc === 'object' && doc !== null ? (doc as Record<string, unknown>)['v'] : undefined;
  return typeof v === 'number' && v > SURPRISE_CODE_VERSION;
}

export function surpriseFromCode(doc: unknown): SurpriseRoll | null {
  if (typeof doc !== 'object' || doc === null) return null;
  const d = doc as Record<string, unknown>;
  if (d['v'] !== SURPRISE_CODE_VERSION) return null;
  const mode = d['mode'];
  if (typeof mode !== 'string' || !POOL_IDS.includes(mode)) return null;
  const maps = mapsOf(mode);
  const map = typeof d['map'] === 'string' && maps.includes(d['map']) ? d['map'] : (maps[0] ?? '');
  const weapon =
    typeof d['weapon'] === 'string' && (GUN_GAME_LADDER as readonly string[]).includes(d['weapon']) ? d['weapon'] : '';
  const rawMods = Array.isArray(d['mods']) ? d['mods'] : [];
  const mods: ModifierId[] = [];
  for (const m of rawMods) {
    if ((ROLL_MODS as readonly unknown[]).includes(m) && !mods.includes(m as ModifierId) && mods.length < 3) {
      if (!mods.some((x) => modifiersConflict(x, m as ModifierId))) mods.push(m as ModifierId);
    }
  }
  const level = (BOT_LEVELS as readonly unknown[]).includes(d['level']) ? (d['level'] as BotLevel) : 'normal';
  const rawStars = Array.isArray(d['stars']) ? d['stars'] : [];
  const stars = rawStars
    .filter((s, i): s is string => (STARS as readonly unknown[]).includes(s) && rawStars.indexOf(s) === i)
    .slice(0, 2);
  const sizeRaw = typeof d['size'] === 'number' && Number.isFinite(d['size']) ? Math.round(d['size']) : 4;
  const size = mode === 'warfare.ffa' ? Math.min(9, Math.max(5, sizeRaw)) : Math.min(6, Math.max(3, sizeRaw));
  return { mode, map, weapon, mods, level, stars, size, long: d['long'] === true };
}

// --- a tela (no pedaço dos editores; o `game` só abre e recebe o "Jogar") ---

export type SurpriseOutcome =
  { readonly kind: 'open' } | { readonly kind: 'back' } | { readonly kind: 'play'; readonly recipe: MatchRecipe };

export interface SurpriseFlowDeps {
  readonly platform: Platform;
  readonly rng: Rng;
}

export interface SurpriseFlow {
  /** Um sorteio novo, sem cadeado. */
  open(): void;
  readonly roll: SurpriseRoll;
  readonly locks: ReadonlySet<SurpriseLine>;
  /** Um botão (o `frame` chama pelo menu; os testes, direto). `delta`: nas linhas, +1 trava e -1 solta. */
  act(action: string, delta?: number): SurpriseOutcome;
  frame(menu: MenuInput, raw: Readonly<RawInputState>, ui: UiFrame, list: DrawList): SurpriseOutcome;
}

export const SURPRISE_FLOW_ACTION = {
  back: 'back',
  reroll: 'surprise.reroll',
  /** A linha Copiar código (`row:copy`). */
  copy: TABBED_ROW_PREFIX + 'copy',
  play: 'surprise.play',
} as const;
const COPY_ROW = 'copy';

const OPEN_OUTCOME: SurpriseOutcome = { kind: 'open' };
const BACK_OUTCOME: SurpriseOutcome = { kind: 'back' };

/** A árvore da tela (os testes de layout montam com o sorteio mais comprido). */
export function surpriseTree(
  roll: SurpriseRoll,
  locks: ReadonlySet<SurpriseLine>,
  note: string,
  canCopy: boolean,
): UiNode {
  const rows: TabbedRow[] = SURPRISE_LINES.map((line) => {
    const value = surpriseLineText(roll, line);
    return {
      kind: 'option',
      id: line,
      // O cadeado vai no rótulo ("INIMIGOS · TRAVADO"): o valor já ocupa a área dele.
      labelKey: (locks.has(line) ? `surprise.lineLocked.${line}` : `surprise.line.${line}`) as StringKey,
      value,
    };
  });
  // O Copiar código fica no fim das linhas (4 botões embaixo não cabem no celular).
  if (canCopy) rows.push({ kind: 'action', id: COPY_ROW, label: { key: 'surprise.copyCode' } });
  return buildTabbed({
    titleKey: 'surprise.title',
    tabs: [],
    tab: 0,
    rows,
    summary: surpriseDetails(roll),
    note,
    help: t('surprise.lockHint'),
    buttons: [
      { id: SURPRISE_FLOW_ACTION.back, labelKey: 'menu.back', variant: 'secondary' },
      { id: SURPRISE_FLOW_ACTION.reroll, labelKey: 'surprise.reroll', variant: 'secondary' },
      { id: SURPRISE_FLOW_ACTION.play, labelKey: 'menu.play', variant: 'primary', autofocus: true },
    ],
  });
}

export function createSurpriseFlow(deps: SurpriseFlowDeps): SurpriseFlow {
  const menu = createMenuController();
  const locks = new Set<SurpriseLine>();
  let roll: SurpriseRoll = rollSurprise(deps.rng.int(0, 0x7fffffff), null, locks);
  let note = '';
  const canCopy = deps.platform.id !== 'switch' && deps.platform.clipboard !== undefined;

  function rebuild(): void {
    menu.setRoot(surpriseTree(roll, locks, note, canCopy));
  }

  function act(a: string, delta = 0): SurpriseOutcome {
    if (a === SURPRISE_FLOW_ACTION.back) return BACK_OUTCOME;
    if (a === SURPRISE_FLOW_ACTION.play) return { kind: 'play', recipe: surpriseRecipe(roll) };
    note = '';
    if (a === SURPRISE_FLOW_ACTION.reroll) {
      // Tudo travado: o "Rolar de novo" solta tudo (senão o botão não faria nada).
      if (locks.size === SURPRISE_LINES.length) locks.clear();
      const before = roll;
      roll = rollSurprise(deps.rng.int(0, 0x7fffffff), roll, locks);
      // O mapa travado que não vale para o modo novo foi sorteado de novo: o cadeado sai (não trava um mapa que o
      // jogador não escolheu).
      if (locks.has('map') && roll.map !== before.map) locks.delete('map');
    } else if (a === SURPRISE_FLOW_ACTION.copy && deps.platform.clipboard !== undefined) {
      const enc = encodeShareCode('surprise', surpriseCodeDoc(roll));
      if (enc.ok) {
        void deps.platform.clipboard.writeText(enc.code).then((ok) => {
          note = t(ok ? 'surprise.copied' : 'share.copyFailed');
          rebuild();
        });
      }
    } else if (a.startsWith(TABBED_ROW_PREFIX)) {
      const line = a.slice(TABBED_ROW_PREFIX.length) as SurpriseLine;
      if ((SURPRISE_LINES as readonly string[]).includes(line)) {
        // Direita trava, esquerda solta (segurar não pisca); o confirmar alterna.
        const on = delta > 0 ? true : delta < 0 ? false : !locks.has(line);
        if (on) locks.add(line);
        else locks.delete(line);
      }
    }
    rebuild();
    return OPEN_OUTCOME;
  }

  return {
    get roll() {
      return roll;
    },
    locks,
    open() {
      locks.clear();
      note = '';
      roll = rollSurprise(deps.rng.int(0, 0x7fffffff), null, locks);
      rebuild();
      menu.focus(SURPRISE_FLOW_ACTION.play);
    },
    act,
    frame(input, raw, ui, list) {
      const nav = menu.update(input, raw, ui);
      const r = nav.back ? BACK_OUTCOME : nav.activated !== null ? act(nav.activated, nav.delta) : OPEN_OUTCOME;
      if (r.kind === 'open') menu.draw(list, ui);
      return r;
    },
  };
}
