import { validateBot, type BotDocument } from './bot.ts';
import { isValidContentLocal, resolveContent } from './content-ids.ts';
import type { FormatId } from './format-id.ts';
import { migrateDocument } from './migrations.ts';
import { ENGINE_MAX_BOTS, ENGINE_MAX_LOCAL_HUMANS, ENGINE_MAX_TEAMS } from './platform-profiles.ts';
import {
  isPlainObject,
  issue,
  unknownFields,
  type IssueCode,
  type RecipeLimits,
  type ValidationIssue,
  type ValidationResult,
} from './validation.ts';

/**
 * MatchRecipe@1: a ÚNICA entrada da sim (tecnico.md §4.4). Menu, preset, Surpreenda-me, Partida Rápida, golden,
 * robô de balanceamento e lobby online geram a mesma receita.
 *
 * É o subconjunto mínimo do esquema `preset@1` (gameplay.md §10.4): o preset é a receita com `name`. Por isso o
 * `format` é `boboforces/preset@1`. Os blocos `players`, `weapons`, `embeddedBots`, `director` e `modifiers` entram no
 * M2 sem quebrar documentos (campos novos opcionais). Valores de conteúdo vão SEM prefixo de tipo.
 */
export const MATCH_RECIPE_FORMAT = 'boboforces/preset@1' satisfies FormatId;

/** Níveis rápidos de dificuldade (decisão #21): Pela vibe, De boa, Normal, Suado, Tryhard. */
export const BOT_LEVELS = ['vibe', 'chill', 'normal', 'sweaty', 'tryhard'] as const;

export type BotLevel = (typeof BOT_LEVELS)[number];

/** Ref de bot: de fábrica (`builtin:normal-bob`) ou embutido no preset (`embedded:<id>`). */
export type BotRef = `builtin:${string}` | `embedded:${string}`;

/** Bot de fábrica de um nível: `chill` → `builtin:chill-bob`. */
export function builtinBotRef(level: BotLevel): BotRef {
  return `builtin:${level}-bob`;
}

/** Nível do bot de fábrica, ou `null` se a ref não for de um bot de nível. */
export function botLevelFromRef(ref: string): BotLevel | null {
  const m = /^builtin:([a-z]+)-bob$/.exec(ref);
  if (!m) return null;
  const level = m[1] as BotLevel;
  return (BOT_LEVELS as readonly string[]).includes(level) ? level : null;
}

/** Perfis de movimento (gameplay.md §3.3): `bobo` é o padrão e o único do M0. */
export type MovementProfileId = 'bobo' | 'tactical' | 'arcade' | 'custom';

export interface BotSlotRecipe {
  readonly ref: BotRef;
  readonly count: number;
}

export interface TeamRecipe {
  /** Nome exibido do time (texto do jogador); sem nome, a UI usa a cor do time. */
  readonly name?: string;
  /** `'all'` = todos os humanos locais entram neste time; número = quantos slots humanos. Ausente = nenhum. */
  readonly humans?: 'all' | number;
  readonly bots: readonly BotSlotRecipe[];
}

export interface MatchRules {
  readonly timeLimitS?: number;
  readonly scoreLimit?: number;
  /** Alcance de visão da partida (humanos e bots); o perfil da plataforma só define o teto. */
  readonly viewDistanceM?: number;
}

export interface PlayerRules {
  readonly movement?: MovementProfileId;
  readonly hp?: number;
  readonly respawnS?: number;
}

export interface MatchRecipe {
  readonly format: typeof MATCH_RECIPE_FORMAT;
  /** Só presets têm nome. */
  readonly name?: string;
  /** ID do modo sem prefixo, ex.: `warfare.tdm`. */
  readonly mode: string;
  /** ID do mapa sem prefixo, ex.: `construto`. */
  readonly map: string;
  /** Semente u32 da partida: raiz de todos os fluxos de RNG da sim e da IA. */
  readonly seed: number;
  readonly match?: MatchRules;
  readonly players?: PlayerRules;
  /** FFA usa um time só com todo mundo. */
  readonly teams: readonly TeamRecipe[];
  /** M2 (fase 3a): bots do jogador levados no preset (`bot@1` já validados; refs `embedded:<id>`). */
  readonly embeddedBots?: readonly BotDocument[];
}

/**
 * Faixas dos campos da receita (gameplay.md §10.3). Fora da faixa, o validador limita e avisa (`recipe.valueClamped`).
 * O teto do alcance de visão é o do perfil da plataforma (`RecipeLimits.maxViewDistanceM`).
 */
export const RECIPE_RANGES = {
  nameMaxLength: 40,
  teamNameMaxLength: 24,
  /** 0 = sem limite de tempo; senão 3 a 30 min. */
  timeLimitS: { min: 180, max: 1800 },
  /** 0 = sem meta. */
  scoreLimit: { min: 0, max: 999 },
  viewDistanceM: { min: 20 },
  hp: { min: 25, max: 1000 },
  respawnS: { min: 0, max: 15 },
  maxTeams: ENGINE_MAX_TEAMS,
  maxBotEntriesPerTeam: 16,
} as const;

/** Bot que entra quando a ref não existe nesta versão (fallback de conteúdo). */
export const FALLBACK_BOT_REF: BotRef = 'builtin:normal-bob';

const TOP_KEYS = ['format', 'name', 'mode', 'map', 'seed', 'match', 'players', 'teams', 'embeddedBots'] as const;
const MATCH_KEYS = ['timeLimitS', 'scoreLimit', 'viewDistanceM'] as const;
const PLAYER_KEYS = ['movement', 'hp', 'respawnS'] as const;
const TEAM_KEYS = ['name', 'humans', 'bots'] as const;
const BOT_KEYS = ['ref', 'count'] as const;

/** Quantos bots a receita põe em campo (soma de todos os `count`). */
export function recipeBotCount(recipe: MatchRecipe): number {
  let total = 0;
  for (const team of recipe.teams) for (const slot of team.bots) total += slot.count;
  return total;
}

interface Ctx {
  readonly errors: ValidationIssue[];
  readonly warnings: ValidationIssue[];
}

/** Valor curto e seguro para o `detail` (nunca lança, nem com ciclo ou BigInt). */
function describe(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function warn(ctx: Ctx, path: string, code: IssueCode, detail?: string): void {
  ctx.warnings.push(issue(path, code, detail));
}

/** Número finito, `undefined` se ausente; tipo errado vira aviso e `undefined`. */
function readNumber(ctx: Ctx, value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  warn(ctx, path, 'recipe.invalidField', describe(value));
  return undefined;
}

function clampWarn(ctx: Ctx, v: number, min: number, max: number, path: string): number {
  const c = v < min ? min : v > max ? max : v;
  if (c !== v) warn(ctx, path, 'recipe.valueClamped', `${v} → ${c}`);
  return c;
}

/** Texto do jogador: corta espaços nas pontas e limita o tamanho (em caracteres, sem partir emoji). */
function readText(ctx: Ctx, value: unknown, path: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    warn(ctx, path, 'recipe.invalidField', describe(value));
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const chars = Array.from(trimmed);
  if (chars.length <= maxLength) return trimmed;
  warn(ctx, path, 'recipe.valueClamped', `${chars.length} → ${maxLength} caracteres`);
  return chars.slice(0, maxLength).join('').trimEnd();
}

/** Modo ou mapa: obrigatório e registrado; ausente recusa a receita (tecnico.md §14.5). */
function readRequiredContent(ctx: Ctx, kind: 'mode' | 'map', value: unknown): string | undefined {
  const code = kind === 'mode' ? 'content.missingMode' : 'content.missingMap';
  if (typeof value !== 'string' || !isValidContentLocal(value)) {
    ctx.errors.push(issue(kind, code, describe(value)));
    return undefined;
  }
  const r = resolveContent(kind, value);
  if (r.status === 'known') return r.local;
  if (r.status === 'retired') {
    warn(ctx, kind, 'content.retired', `${value} → ${r.local}`);
    return r.local;
  }
  ctx.errors.push(issue(kind, code, value));
  return undefined;
}

function readSeed(ctx: Ctx, value: unknown): number {
  if (value === undefined) {
    warn(ctx, 'seed', 'recipe.seedMissing');
    return 0;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    warn(ctx, 'seed', 'recipe.invalidField', describe(value));
    return 0;
  }
  const seed = Math.trunc(value) >>> 0;
  if (seed !== value) warn(ctx, 'seed', 'recipe.valueClamped', `${value} → ${seed}`);
  return seed;
}

function readMatch(ctx: Ctx, value: unknown, limits: RecipeLimits): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    warn(ctx, 'match', 'recipe.invalidField', describe(value));
    return undefined;
  }
  const out: Record<string, unknown> = {};
  const time = readNumber(ctx, value['timeLimitS'], 'match.timeLimitS');
  if (time !== undefined) {
    const t = Math.round(time);
    if (t === 0) out['timeLimitS'] = 0;
    else {
      const { min, max } = RECIPE_RANGES.timeLimitS;
      out['timeLimitS'] =
        t < 0 ? clampWarn(ctx, t, 0, 0, 'match.timeLimitS') : clampWarn(ctx, t, min, max, 'match.timeLimitS');
    }
  }
  const score = readNumber(ctx, value['scoreLimit'], 'match.scoreLimit');
  if (score !== undefined) {
    const { min, max } = RECIPE_RANGES.scoreLimit;
    out['scoreLimit'] = clampWarn(ctx, Math.round(score), min, max, 'match.scoreLimit');
  }
  const view = readNumber(ctx, value['viewDistanceM'], 'match.viewDistanceM');
  if (view !== undefined) {
    const cap = Math.max(RECIPE_RANGES.viewDistanceM.min, limits.maxViewDistanceM);
    if (view > cap) {
      warn(ctx, 'match.viewDistanceM', 'recipe.viewDistanceOverPlatformCap', `${view} → ${cap}`);
      out['viewDistanceM'] = cap;
    } else {
      out['viewDistanceM'] = clampWarn(ctx, view, RECIPE_RANGES.viewDistanceM.min, cap, 'match.viewDistanceM');
    }
  }
  return Object.assign(out, unknownFields(value, MATCH_KEYS));
}

function readPlayers(ctx: Ctx, value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    warn(ctx, 'players', 'recipe.invalidField', describe(value));
    return undefined;
  }
  const out: Record<string, unknown> = {};
  const movement = value['movement'];
  if (movement !== undefined) {
    if (typeof movement !== 'string') warn(ctx, 'players.movement', 'recipe.invalidField', describe(movement));
    else {
      const r = resolveContent('movement', movement);
      if (r.status === 'known') out['movement'] = r.local;
      else if (r.status === 'retired') {
        warn(ctx, 'players.movement', 'content.retired', `${movement} → ${r.local}`);
        out['movement'] = r.local;
      } else if (r.status === 'fallback' && r.local !== null) {
        warn(ctx, 'players.movement', 'content.missingMovement', `${movement} → ${r.local}`);
        out['movement'] = r.local;
      }
    }
  }
  const hp = readNumber(ctx, value['hp'], 'players.hp');
  if (hp !== undefined)
    out['hp'] = clampWarn(ctx, Math.round(hp), RECIPE_RANGES.hp.min, RECIPE_RANGES.hp.max, 'players.hp');
  const respawn = readNumber(ctx, value['respawnS'], 'players.respawnS');
  if (respawn !== undefined) {
    const { min, max } = RECIPE_RANGES.respawnS;
    out['respawnS'] = clampWarn(ctx, respawn, min, max, 'players.respawnS');
  }
  return Object.assign(out, unknownFields(value, PLAYER_KEYS));
}

/** IDs dos bots embutidos no documento (o `bot@1` completo é validado no M2; aqui só a existência do id). */
function embeddedBotIds(doc: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  const list = doc['embeddedBots'];
  if (!Array.isArray(list)) return ids;
  for (const bot of list) {
    if (isPlainObject(bot) && typeof bot['id'] === 'string') ids.add(bot['id']);
  }
  return ids;
}

function readBotRef(ctx: Ctx, value: unknown, path: string, embedded: ReadonlySet<string>): BotRef {
  if (typeof value === 'string') {
    if (value.startsWith('builtin:')) {
      const local = value.slice('builtin:'.length);
      if (isValidContentLocal(local)) {
        const r = resolveContent('bot', local);
        if (r.status === 'known') return `builtin:${r.local}`;
        if (r.status === 'retired') {
          warn(ctx, path, 'content.retired', `${value} → builtin:${r.local}`);
          return `builtin:${r.local}`;
        }
      }
    } else if (value.startsWith('embedded:')) {
      const id = value.slice('embedded:'.length);
      if (id !== '' && embedded.has(id)) return `embedded:${id}`;
    }
  }
  warn(ctx, path, 'content.missingBot', `${describe(value)} → ${FALLBACK_BOT_REF}`);
  return FALLBACK_BOT_REF;
}

interface MutableTeam {
  readonly out: Record<string, unknown>;
  /** Entradas de bot (mutáveis para o corte no teto). */
  readonly bots: Record<string, unknown>[];
  humans: 'all' | number | undefined;
}

function readTeam(
  ctx: Ctx,
  value: unknown,
  i: number,
  limits: RecipeLimits,
  embedded: ReadonlySet<string>,
  seenAll: { value: boolean },
): MutableTeam {
  const path = `teams[${i}]`;
  const out: Record<string, unknown> = {};
  const bots: Record<string, unknown>[] = [];
  if (!isPlainObject(value)) {
    warn(ctx, path, 'recipe.invalidField', describe(value));
    return { out, bots, humans: undefined };
  }
  const name = readText(ctx, value['name'], `${path}.name`, RECIPE_RANGES.teamNameMaxLength);
  if (name !== undefined) out['name'] = name;

  let humans: 'all' | number | undefined;
  const h = value['humans'];
  if (h === 'all') {
    if (seenAll.value) warn(ctx, `${path}.humans`, 'recipe.duplicateAllHumans');
    else {
      humans = 'all';
      seenAll.value = true;
    }
  } else if (h !== undefined) {
    const n = readNumber(ctx, h, `${path}.humans`);
    if (n !== undefined) {
      const r = Math.round(n);
      if (r > limits.maxLocalHumans) {
        warn(ctx, `${path}.humans`, 'recipe.humansOverPlatformCap', `${r} → ${limits.maxLocalHumans}`);
        humans = limits.maxLocalHumans;
      } else humans = clampWarn(ctx, r, 0, limits.maxLocalHumans, `${path}.humans`);
    }
  }

  const list = value['bots'];
  if (list !== undefined && !Array.isArray(list)) warn(ctx, `${path}.bots`, 'recipe.invalidField', describe(list));
  if (Array.isArray(list)) {
    const max = RECIPE_RANGES.maxBotEntriesPerTeam;
    if (list.length > max) warn(ctx, `${path}.bots`, 'recipe.tooManyBotEntries', `${list.length} → ${max}`);
    for (let j = 0; j < list.length && j < max; j++) {
      const entry: unknown = list[j];
      const bpath = `${path}.bots[${j}]`;
      if (!isPlainObject(entry)) {
        warn(ctx, bpath, 'recipe.invalidField', describe(entry));
        continue;
      }
      const count = readNumber(ctx, entry['count'], `${bpath}.count`);
      if (count === undefined) {
        if (entry['count'] === undefined) warn(ctx, `${bpath}.count`, 'recipe.invalidField', 'ausente');
        continue;
      }
      const slot: Record<string, unknown> = {
        ref: readBotRef(ctx, entry['ref'], `${bpath}.ref`, embedded),
        count: clampWarn(ctx, Math.round(count), 0, ENGINE_MAX_BOTS, `${bpath}.count`),
      };
      bots.push(Object.assign(slot, unknownFields(entry, BOT_KEYS)));
    }
  }
  Object.assign(out, unknownFields(value, TEAM_KEYS));
  return { out, bots, humans };
}

/** Corta humanos numéricos acima do teto, dos últimos times para os primeiros. */
function capHumans(ctx: Ctx, teams: MutableTeam[], max: number): void {
  let total = 0;
  for (const t of teams) if (typeof t.humans === 'number') total += t.humans;
  if (total <= max) return;
  warn(ctx, 'teams', 'recipe.humansOverPlatformCap', `${total} → ${max}`);
  let excess = total - max;
  for (let i = teams.length - 1; i >= 0 && excess > 0; i--) {
    const t = teams[i]!;
    if (typeof t.humans !== 'number' || t.humans === 0) continue;
    const cut = Math.min(t.humans, excess);
    t.humans -= cut;
    excess -= cut;
  }
}

/**
 * Corta bots acima do teto e avisa (regra 19). Corte justo e determinístico, um bot por vez:
 * - do time com mais bots (empate: o último), então "4 vs 40" num teto de 12 vira "3 vs 9";
 * - dentro do time, da entrada que perdeu menos em proporção (empate: a maior, depois a última), então uma mistura
 *   70%/30% continua perto de 70%/30%.
 */
function capBots(ctx: Ctx, teams: MutableTeam[], max: number): void {
  const totals: number[] = [];
  const original: number[][] = [];
  let total = 0;
  for (const t of teams) {
    let sum = 0;
    const counts: number[] = [];
    for (const b of t.bots) {
      const c = b['count'] as number;
      counts.push(c);
      sum += c;
    }
    original.push(counts);
    totals.push(sum);
    total += sum;
  }
  if (total <= max) return;
  warn(ctx, 'teams', 'recipe.botsOverPlatformCap', `${total} → ${max}`);
  for (let excess = total - max; excess > 0; excess--) {
    let ti = -1;
    for (let i = 0; i < teams.length; i++) if (totals[i]! > 0 && (ti < 0 || totals[i]! >= totals[ti]!)) ti = i;
    const bots = teams[ti]!.bots;
    const orig = original[ti]!;
    let ei = -1;
    for (let j = 0; j < bots.length; j++) {
      const c = bots[j]!['count'] as number;
      if (c === 0) continue;
      if (ei < 0) {
        ei = j;
        continue;
      }
      const best = bots[ei]!['count'] as number;
      // Compara c/orig[j] com best/orig[ei] sem divisão (contas inteiras, sem erro de arredondamento).
      const lhs = c * orig[ei]!;
      const rhs = best * orig[j]!;
      if (lhs > rhs || (lhs === rhs && c >= best)) ei = j;
    }
    bots[ei]!['count'] = (bots[ei]!['count'] as number) - 1;
    totals[ti]!--;
  }
}

/**
 * Valida, limita aos tetos da plataforma (regra 19) e devolve a receita normalizada (tecnico.md §14.5):
 * - `format` com versão maior é recusado; menor passa pelas migrações;
 * - modo e mapa ausentes recusam; bot e perfil de movimento ausentes caem em fallback com aviso;
 * - números fora da faixa são limitados com aviso; bots e humanos acima do teto são cortados com aviso;
 * - campos desconhecidos são ignorados pela sim e MANTIDOS no resultado (para regravar sem perder dados).
 * Puro e determinístico; não altera o documento de entrada.
 */
export function validateMatchRecipe(input: unknown, limits: RecipeLimits): ValidationResult<MatchRecipe> {
  const migrated = migrateDocument(input, 'preset');
  if (!migrated.ok) return migrated;
  const doc = migrated.value;
  const ctx: Ctx = { errors: [], warnings: [...migrated.warnings] };
  const safeLimits: RecipeLimits = {
    maxBots: Math.max(0, Math.min(ENGINE_MAX_BOTS, Math.floor(limits.maxBots))),
    maxLocalHumans: Math.max(0, Math.min(ENGINE_MAX_LOCAL_HUMANS, Math.floor(limits.maxLocalHumans))),
    maxViewDistanceM: limits.maxViewDistanceM,
  };

  const out: Record<string, unknown> = { format: MATCH_RECIPE_FORMAT };
  const name = readText(ctx, doc['name'], 'name', RECIPE_RANGES.nameMaxLength);
  if (name !== undefined) out['name'] = name;
  out['mode'] = readRequiredContent(ctx, 'mode', doc['mode']);
  out['map'] = readRequiredContent(ctx, 'map', doc['map']);
  out['seed'] = readSeed(ctx, doc['seed']);
  const match = readMatch(ctx, doc['match'], safeLimits);
  if (match !== undefined) out['match'] = match;
  const players = readPlayers(ctx, doc['players']);
  if (players !== undefined) out['players'] = players;

  const teamsIn = doc['teams'];
  if (!Array.isArray(teamsIn) || teamsIn.length === 0) {
    ctx.errors.push(issue('teams', 'recipe.noTeams', describe(teamsIn)));
  } else {
    if (teamsIn.length > RECIPE_RANGES.maxTeams) {
      warn(ctx, 'teams', 'recipe.tooManyTeams', `${teamsIn.length} → ${RECIPE_RANGES.maxTeams}`);
    }
    const embedded = embeddedBotIds(doc);
    const seenAll = { value: false };
    const teams: MutableTeam[] = [];
    for (let i = 0; i < teamsIn.length && i < RECIPE_RANGES.maxTeams; i++) {
      teams.push(readTeam(ctx, teamsIn[i], i, safeLimits, embedded, seenAll));
    }
    capHumans(ctx, teams, safeLimits.maxLocalHumans);
    capBots(ctx, teams, safeLimits.maxBots);
    out['teams'] = teams.map((t) => {
      const team: Record<string, unknown> = {};
      if (t.out['name'] !== undefined) team['name'] = t.out['name'];
      if (t.humans !== undefined) team['humans'] = t.humans;
      team['bots'] = t.bots;
      return Object.assign(team, unknownFields(t.out, TEAM_KEYS));
    });
  }

  // M2 (fase 3a): os bots embutidos passam pelo validador do `bot@1` (avisos com o caminho; o que não é bot cai).
  const embeddedIn = doc['embeddedBots'];
  if (embeddedIn !== undefined) {
    if (!Array.isArray(embeddedIn)) warn(ctx, 'embeddedBots', 'recipe.invalidField', describe(embeddedIn));
    else {
      const bots: BotDocument[] = [];
      embeddedIn.forEach((bot, i) => {
        const r = validateBot(bot);
        if (!r.ok) {
          warn(ctx, `embeddedBots[${i}]`, 'content.missingBot', r.errors[0]?.code);
          return;
        }
        for (const w of r.warnings) ctx.warnings.push({ ...w, path: `embeddedBots[${i}].${w.path}` });
        bots.push(r.value);
      });
      out['embeddedBots'] = bots;
    }
  }
  if (ctx.errors.length > 0) return { ok: false, errors: ctx.errors };
  Object.assign(out, unknownFields(doc, TOP_KEYS));
  return { ok: true, value: out as unknown as MatchRecipe, warnings: ctx.warnings };
}
