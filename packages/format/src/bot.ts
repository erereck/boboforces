import type { FormatId } from './format-id.ts';
// Só tipos da receita: o `match-recipe.ts` importa este arquivo (valida os `embeddedBots`), e um import de valor faria
// ciclo na inicialização.
import type { BotLevel, BotRef, MatchRecipe } from './match-recipe.ts';
import { isPlainObject, issue, type IssueCode, type ValidationIssue, type ValidationResult } from './validation.ts';

/**
 * `bot@1` (gameplay.md §6.1–§6.7; M2, fase 3a): um bot é Inteligência + Habilidade + Personalidade + Regras + visual e
 * nome. O mesmo documento serve aos bots de fábrica (`BUILTIN_BOTS`), aos embutidos no preset (`embeddedBots`) e, na
 * fase 5, à Oficina. Chaves em inglês; valores fora da faixa são limitados com aviso; campos ausentes caem no padrão
 * do nível; o `look` viaja como veio (o sistema de visual é da fase 6).
 */
export const BOT_FORMAT = 'boboforces/bot@1' satisfies FormatId;

/** Personalidades (gameplay.md §6.4). */
export const PERSONALITIES = [
  'balanced',
  'rusher',
  'lunatic',
  'coward',
  'camper',
  'strategist',
  'kamikaze',
  'hunter',
  'support',
  'clown',
] as const;
export type PersonalityId = (typeof PERSONALITIES)[number];

/** Movimento em combate (§6.2): parado, strafe leve, strafe, strafe com pulos e agachadas. */
export const COMBAT_MOVES = ['none', 'light', 'strafe', 'strafeDodge'] as const;
export type CombatMoveId = (typeof COMBAT_MOVES)[number];

/** Munição (§6.5): normal, reserva infinita ou pente infinito. */
export const AMMO_RULES = ['normal', 'infiniteReserve', 'infiniteClip'] as const;
export type AmmoRule = (typeof AMMO_RULES)[number];

/** Conhecimento (§6.5): normal, área aproximada (15 m, a cada 10 s) ou wallhack total. */
export const KNOWLEDGE_RULES = ['normal', 'area', 'wallhack'] as const;
export type KnowledgeRule = (typeof KNOWLEDGE_RULES)[number];

/** Habilidade mecânica (§6.2). */
export interface BotSkill {
  readonly reactionMs: number;
  readonly aimErrorDeg: number;
  readonly acquireS: number;
  readonly turnDegS: number;
  /** 0..1. */
  readonly recoilControl: number;
  /** 0..1: chance de mirar na cabeça. */
  readonly headPref: number;
  /** 0..1: frequência de granada. */
  readonly grenadeUse: number;
  readonly combatMove: CombatMoveId;
  /** 0..1: 0 = rajadas curtas, 1 = segura o gatilho. */
  readonly triggerHold: number;
  /** Tempo para trocar de alvo (s). */
  readonly targetSwitchS: number;
}

/** Inteligência (§6.3): o nível N0..N4 e os comportamentos (o "modo avançado" liga e desliga cada um). */
export interface BotIntelligence {
  readonly level: number;
  readonly useCover: boolean;
  readonly flank: boolean;
  readonly retreat: boolean;
  readonly grenades: boolean;
  readonly callouts: boolean;
  readonly ambush: boolean;
  readonly learn: boolean;
  readonly playObjective: boolean;
}

/** Personalidade (§6.4): a base escolhida e os pesos (0..1), mais a distância preferida (m; -1 = aleatória). */
export interface BotPersonality {
  readonly preset: PersonalityId;
  readonly aggression: number;
  readonly caution: number;
  readonly patience: number;
  readonly preferredRangeM: number;
  readonly silliness: number;
}

/** Regras e vantagens (§6.5); toda regra ativa aparece no card, no placar e na tela de morte. */
export interface BotRules {
  readonly hp: number;
  readonly damageMult: number;
  readonly speed: number;
  readonly ammo: AmmoRule;
  /** Armas permitidas (ids de `weapon:` sem o prefixo); vazio = todas. Uma só = arma fixa. */
  readonly weapons: readonly string[];
  readonly headshotImmune: boolean;
  readonly explodeOnDeath: boolean;
  /** Cone de visão (graus, 60..360) e fração do alcance da partida (0,1..1; passar de 1 é "Olho de águia"). */
  readonly visionDeg: number;
  readonly visionRange: number;
  /** Audição 0..2 (×). */
  readonly hearing: number;
  readonly knowledge: KnowledgeRule;
}

export interface BotDocument {
  readonly format: typeof BOT_FORMAT;
  readonly id: string;
  /** Nome do jogador (embutidos e Oficina); os de fábrica usam a tabela de textos (`bot.name.<id>`). */
  readonly name: string;
  readonly look: unknown;
  readonly skill: BotSkill;
  readonly intelligence: BotIntelligence;
  readonly personality: BotPersonality;
  readonly rules: BotRules;
}

/** Faixas (§6.2, §6.5). Fora delas, o validador limita e avisa (`bot.valueClamped`). */
export const BOT_RANGES = {
  reactionMs: { min: 100, max: 1200 },
  aimErrorDeg: { min: 0.2, max: 10 },
  acquireS: { min: 0, max: 1.5 },
  turnDegS: { min: 90, max: 900 },
  unit: { min: 0, max: 1 },
  targetSwitchS: { min: 0.2, max: 2 },
  intelligence: { min: 0, max: 4 },
  preferredRangeM: { min: -1, max: 80 },
  hp: { min: 1, max: 1000 },
  damageMult: { min: 0.25, max: 5 },
  speed: { min: 0.5, max: 2 },
  visionDeg: { min: 60, max: 360 },
  visionRange: { min: 0.1, max: 2 },
  hearing: { min: 0, max: 2 },
  nameMaxLength: 24,
} as const;

/** Habilidade dos 5 níveis rápidos (tabela da §6.6; a mesma do `ai/skill.ts`). */
export const LEVEL_SKILLS: Readonly<Record<BotLevel, BotSkill>> = {
  vibe: skill(900, 6, 1.2, 150, 0.1, 0.05, 0, 'none', 0.7, 1.5),
  chill: skill(650, 3.5, 0.9, 220, 0.3, 0.1, 0.1, 'light', 0.6, 1.2),
  normal: skill(450, 2, 0.6, 320, 0.5, 0.2, 0.25, 'strafe', 0.5, 0.8),
  sweaty: skill(300, 1, 0.35, 500, 0.75, 0.4, 0.4, 'strafeDodge', 0.4, 0.5),
  tryhard: skill(180, 0.4, 0.2, 800, 0.95, 0.65, 0.55, 'strafeDodge', 0.3, 0.3),
};

function skill(
  reactionMs: number,
  aimErrorDeg: number,
  acquireS: number,
  turnDegS: number,
  recoilControl: number,
  headPref: number,
  grenadeUse: number,
  combatMove: CombatMoveId,
  triggerHold: number,
  targetSwitchS: number,
): BotSkill {
  return {
    reactionMs,
    aimErrorDeg,
    acquireS,
    turnDegS,
    recoilControl,
    headPref,
    grenadeUse,
    combatMove,
    triggerHold,
    targetSwitchS,
  };
}

/** Os níveis na ordem da inteligência (N0..N4): a mesma de `BOT_LEVELS` (o teste confere). */
export const LEVEL_ORDER: readonly BotLevel[] = ['vibe', 'chill', 'normal', 'sweaty', 'tryhard'];

/** Comportamentos ligados até o nível (cumulativos, §6.3). */
export function intelligenceForLevel(level: number): BotIntelligence {
  const n = Math.max(0, Math.min(4, Math.round(level)));
  return {
    level: n,
    useCover: n >= 1,
    flank: n >= 2,
    retreat: n >= 2,
    grenades: n >= 2,
    callouts: n >= 3,
    ambush: n >= 3,
    learn: n >= 4,
    playObjective: true,
  };
}

/** Pesos de cada personalidade (§6.4; a distância -1 = aleatória). */
export const PERSONALITY_PRESETS: Readonly<Record<PersonalityId, BotPersonality>> = {
  balanced: personality('balanced', 0.5, 0.5, 0.5, 20, 0.05),
  rusher: personality('rusher', 0.9, 0.1, 0.2, 6, 0.1),
  lunatic: personality('lunatic', 0.8, 0, 0, -1, 0.6),
  coward: personality('coward', 0.2, 0.9, 0.6, 35, 0.1),
  camper: personality('camper', 0.3, 0.7, 0.95, 40, 0.05),
  strategist: personality('strategist', 0.5, 0.6, 0.7, 25, 0.05),
  kamikaze: personality('kamikaze', 1, 0, 0, 0, 0.3),
  hunter: personality('hunter', 0.8, 0.3, 0.4, 15, 0.05),
  support: personality('support', 0.4, 0.6, 0.6, 15, 0.05),
  clown: personality('clown', 0.5, 0.3, 0.3, 15, 0.5),
};

function personality(
  preset: PersonalityId,
  aggression: number,
  caution: number,
  patience: number,
  preferredRangeM: number,
  silliness: number,
): BotPersonality {
  return { preset, aggression, caution, patience, preferredRangeM, silliness };
}

/** Regras sem vantagem nenhuma (os níveis rápidos, §6.6). */
export const DEFAULT_BOT_RULES: BotRules = {
  hp: 100,
  damageMult: 1,
  speed: 1,
  ammo: 'normal',
  weapons: [],
  headshotImmune: false,
  explodeOnDeath: false,
  visionDeg: 120,
  visionRange: 1,
  hearing: 1,
  knowledge: 'normal',
};

/**
 * Mistura de personalidades dos níveis rápidos (§6.6): 50% Equilibrado, 20% Rusher, 15% Camper, 15% Estrategista. O
 * bot sorteia pela semente (`personalityForRoll`).
 */
export const LEVEL_PERSONALITY_MIX: readonly { readonly preset: PersonalityId; readonly weight: number }[] = [
  { preset: 'balanced', weight: 50 },
  { preset: 'rusher', weight: 20 },
  { preset: 'camper', weight: 15 },
  { preset: 'strategist', weight: 15 },
];

/** Personalidade da mistura para um sorteio em [0, 1). */
export function personalityForRoll(roll: number): PersonalityId {
  let acc = 0;
  for (const m of LEVEL_PERSONALITY_MIX) {
    acc += m.weight / 100;
    if (roll < acc) return m.preset;
  }
  return 'balanced';
}

/** Bot de um nível rápido (Vibe Bob…Tryhard Bob): habilidade e inteligência do nível, sem regra; a personalidade da mistura. */
export function levelBot(level: BotLevel): BotDocument {
  return {
    format: BOT_FORMAT,
    id: `${level}-bob`,
    name: '',
    look: null,
    skill: LEVEL_SKILLS[level],
    intelligence: intelligenceForLevel(LEVEL_ORDER.indexOf(level)),
    personality: PERSONALITY_PRESETS.balanced,
    rules: DEFAULT_BOT_RULES,
  };
}

/** Um bot de fábrica com personalidade e regras próprias, a partir de um nível. */
function special(
  id: string,
  level: BotLevel,
  intelligenceLevel: number,
  preset: PersonalityId,
  rules: Partial<BotRules>,
  skillOver: Partial<BotSkill> = {},
): BotDocument {
  return {
    format: BOT_FORMAT,
    id,
    name: '',
    look: null,
    skill: { ...LEVEL_SKILLS[level], ...skillOver },
    intelligence: intelligenceForLevel(intelligenceLevel),
    personality: PERSONALITY_PRESETS[preset],
    rules: { ...DEFAULT_BOT_RULES, ...rules },
  };
}

/**
 * Bots de fábrica (§6.7; nomes em inglês bobo, #15 e #61). Ids de conteúdo `bot:<id>`; os nomes na tabela de textos
 * (`bot.name.<id>`). Os 5 níveis rápidos e os 7 especiais.
 */
export const BUILTIN_BOTS: Readonly<Record<string, BotDocument>> = {
  'vibe-bob': levelBot('vibe'),
  'chill-bob': levelBot('chill'),
  'normal-bob': levelBot('normal'),
  'sweaty-bob': levelBot('sweaty'),
  'tryhard-bob': levelBot('tryhard'),
  // 500 HP, Door Knocker, Kamikaze, N0, erro alto.
  'jorge-the-immortal': special('jorge-the-immortal', 'vibe', 0, 'kamikaze', { hp: 500, weapons: ['shotgun'] }),
  // Peekaboo, Camper, N2.
  'camper-carl': special('camper-carl', 'normal', 2, 'camper', { weapons: ['sniper'] }),
  // Só faca, velocidade 1,4×, Rusher.
  'knife-ninja': special('knife-ninja', 'normal', 1, 'rusher', { weapons: ['knife'], speed: 1.4 }),
  // Covarde, N2.
  'scaredy-sam': special('scaredy-sam', 'normal', 2, 'coward', {}),
  // Caçador (persegue o humano com mais abates), N3.
  'hunter-hank': special('hunter-hank', 'sweaty', 3, 'hunter', {}),
  // Suporte: segue, cobre e revive.
  buddy: special('buddy', 'normal', 2, 'support', {}),
  // Palhaço.
  'goofy-gus': special('goofy-gus', 'chill', 1, 'clown', {}),
};

/**
 * O documento de uma ref da receita: de fábrica (`builtin:<id>`) ou embutido (`embedded:<id>`); sem ele, o Normal Bob
 * (fallback de conteúdo, tecnico.md §14.5).
 */
export function resolveBot(recipe: MatchRecipe, ref: BotRef): BotDocument {
  if (ref.startsWith('builtin:')) return builtinBot(ref.slice('builtin:'.length)) ?? BUILTIN_BOTS['normal-bob']!;
  const id = ref.slice('embedded:'.length);
  return recipe.embeddedBots?.find((b) => b.id === id) ?? BUILTIN_BOTS['normal-bob']!;
}

/** O bot de fábrica de uma ref `builtin:<id>`, ou `null`. */
export function builtinBot(id: string): BotDocument | null {
  return Object.prototype.hasOwnProperty.call(BUILTIN_BOTS, id) ? BUILTIN_BOTS[id]! : null;
}

// --- Validação --------------------------------------------------------------------------------------------------

interface Ctx {
  readonly warnings: ValidationIssue[];
}

function warn(ctx: Ctx, path: string, code: IssueCode, detail?: string): void {
  ctx.warnings.push(issue(path, code, detail));
}

function num(
  ctx: Ctx,
  src: Record<string, unknown>,
  key: string,
  path: string,
  fallback: number,
  range: { min: number; max: number },
): number {
  const v = src[key];
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    warn(ctx, `${path}.${key}`, 'bot.invalidField');
    return fallback;
  }
  const c = v < range.min ? range.min : v > range.max ? range.max : v;
  if (c !== v) warn(ctx, `${path}.${key}`, 'bot.valueClamped', `${v} → ${c}`);
  return c;
}

function bool(ctx: Ctx, src: Record<string, unknown>, key: string, path: string, fallback: boolean): boolean {
  const v = src[key];
  if (v === undefined) return fallback;
  if (typeof v === 'boolean') return v;
  warn(ctx, `${path}.${key}`, 'bot.invalidField');
  return fallback;
}

function pick<T extends string>(
  ctx: Ctx,
  src: Record<string, unknown>,
  key: string,
  path: string,
  fallback: T,
  allowed: readonly T[],
): T {
  const v = src[key];
  if (v === undefined) return fallback;
  if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T;
  warn(ctx, `${path}.${key}`, 'bot.invalidField');
  return fallback;
}

function obj(ctx: Ctx, src: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = src[key];
  if (v === undefined) return {};
  if (isPlainObject(v)) return v;
  warn(ctx, key, 'bot.invalidField');
  return {};
}

/**
 * Valida e completa um `bot@1`: recusa só o que não é um bot (sem objeto ou formato errado); o resto é limitado à faixa
 * com aviso, e o que falta vem do bot Normal (a inteligência, do nível pedido).
 */
export function validateBot(doc: unknown): ValidationResult<BotDocument> {
  if (!isPlainObject(doc)) return { ok: false, errors: [issue('', 'doc.notObject')] };
  if (doc['format'] !== BOT_FORMAT) {
    return {
      ok: false,
      errors: [issue('format', doc['format'] === undefined ? 'format.missing' : 'format.wrongKind')],
    };
  }
  const ctx: Ctx = { warnings: [] };
  const base = levelBot('normal');
  const id = typeof doc['id'] === 'string' && doc['id'] !== '' ? doc['id'] : 'bot';
  let name = typeof doc['name'] === 'string' ? doc['name'].trim() : '';
  const chars = Array.from(name);
  if (chars.length > BOT_RANGES.nameMaxLength) {
    warn(ctx, 'name', 'bot.valueClamped', `${chars.length} → ${BOT_RANGES.nameMaxLength} caracteres`);
    name = chars.slice(0, BOT_RANGES.nameMaxLength).join('').trimEnd();
  }
  const s = obj(ctx, doc, 'skill');
  const R = BOT_RANGES;
  const sk = base.skill;
  const skillOut: BotSkill = {
    reactionMs: num(ctx, s, 'reactionMs', 'skill', sk.reactionMs, R.reactionMs),
    aimErrorDeg: num(ctx, s, 'aimErrorDeg', 'skill', sk.aimErrorDeg, R.aimErrorDeg),
    acquireS: num(ctx, s, 'acquireS', 'skill', sk.acquireS, R.acquireS),
    turnDegS: num(ctx, s, 'turnDegS', 'skill', sk.turnDegS, R.turnDegS),
    recoilControl: num(ctx, s, 'recoilControl', 'skill', sk.recoilControl, R.unit),
    headPref: num(ctx, s, 'headPref', 'skill', sk.headPref, R.unit),
    grenadeUse: num(ctx, s, 'grenadeUse', 'skill', sk.grenadeUse, R.unit),
    combatMove: pick(ctx, s, 'combatMove', 'skill', sk.combatMove, COMBAT_MOVES),
    triggerHold: num(ctx, s, 'triggerHold', 'skill', sk.triggerHold, R.unit),
    targetSwitchS: num(ctx, s, 'targetSwitchS', 'skill', sk.targetSwitchS, R.targetSwitchS),
  };
  const i = obj(ctx, doc, 'intelligence');
  const level = Math.round(num(ctx, i, 'level', 'intelligence', base.intelligence.level, R.intelligence));
  const il = intelligenceForLevel(level);
  const intelligence: BotIntelligence = {
    level,
    useCover: bool(ctx, i, 'useCover', 'intelligence', il.useCover),
    flank: bool(ctx, i, 'flank', 'intelligence', il.flank),
    retreat: bool(ctx, i, 'retreat', 'intelligence', il.retreat),
    grenades: bool(ctx, i, 'grenades', 'intelligence', il.grenades),
    callouts: bool(ctx, i, 'callouts', 'intelligence', il.callouts),
    ambush: bool(ctx, i, 'ambush', 'intelligence', il.ambush),
    learn: bool(ctx, i, 'learn', 'intelligence', il.learn),
    playObjective: bool(ctx, i, 'playObjective', 'intelligence', il.playObjective),
  };
  const p = obj(ctx, doc, 'personality');
  const preset = pick(ctx, p, 'preset', 'personality', 'balanced', PERSONALITIES);
  const pp = PERSONALITY_PRESETS[preset];
  const personalityOut: BotPersonality = {
    preset,
    aggression: num(ctx, p, 'aggression', 'personality', pp.aggression, R.unit),
    caution: num(ctx, p, 'caution', 'personality', pp.caution, R.unit),
    patience: num(ctx, p, 'patience', 'personality', pp.patience, R.unit),
    preferredRangeM: num(ctx, p, 'preferredRangeM', 'personality', pp.preferredRangeM, R.preferredRangeM),
    silliness: num(ctx, p, 'silliness', 'personality', pp.silliness, R.unit),
  };
  const r = obj(ctx, doc, 'rules');
  const dr = DEFAULT_BOT_RULES;
  let weapons: string[] = [];
  if (r['weapons'] !== undefined) {
    if (Array.isArray(r['weapons']) && r['weapons'].every((w) => typeof w === 'string')) {
      weapons = (r['weapons'] as string[]).slice(0, 16);
    } else warn(ctx, 'rules.weapons', 'bot.invalidField');
  }
  const rules: BotRules = {
    hp: Math.round(num(ctx, r, 'hp', 'rules', dr.hp, R.hp)),
    damageMult: num(ctx, r, 'damageMult', 'rules', dr.damageMult, R.damageMult),
    speed: num(ctx, r, 'speed', 'rules', dr.speed, R.speed),
    ammo: pick(ctx, r, 'ammo', 'rules', dr.ammo, AMMO_RULES),
    weapons,
    headshotImmune: bool(ctx, r, 'headshotImmune', 'rules', dr.headshotImmune),
    explodeOnDeath: bool(ctx, r, 'explodeOnDeath', 'rules', dr.explodeOnDeath),
    visionDeg: num(ctx, r, 'visionDeg', 'rules', dr.visionDeg, R.visionDeg),
    visionRange: num(ctx, r, 'visionRange', 'rules', dr.visionRange, R.visionRange),
    hearing: num(ctx, r, 'hearing', 'rules', dr.hearing, R.hearing),
    knowledge: pick(ctx, r, 'knowledge', 'rules', dr.knowledge, KNOWLEDGE_RULES),
  };
  return {
    ok: true,
    value: {
      format: BOT_FORMAT,
      id,
      name,
      look: doc['look'] ?? null,
      skill: skillOut,
      intelligence,
      personality: personalityOut,
      rules,
    },
    warnings: ctx.warnings,
  };
}
