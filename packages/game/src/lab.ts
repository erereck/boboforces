import {
  AMMO_RULES,
  BOT_RANGES,
  COMBAT_MOVES,
  intelligenceForLevel,
  KNOWLEDGE_RULES,
  LEVEL_ORDER,
  levelBot,
  PERSONALITIES,
  PERSONALITY_PRESETS,
  type BotDocument,
  type BotIntelligence,
  type BotPersonality,
  type BotRules,
  type BotSkill,
} from '@boboforces/format';
import type { Rng } from '@boboforces/shared';
import { t, type StringKey, type TabbedRow } from '@boboforces/ui';
import { botDisplayName, botLevelOf } from './bot-card.ts';
import { ALLOWED_CHOICES, ALLOWED_KEYS } from './custom-match.ts';

/**
 * M2 (fase 5b): o Laboratório (gameplay.md §6), o editor de um bot por vez, lógica pura sobre o `bot@1`. Cada aba tem
 * linhas de opção com passo (-1/+1; o confirmar avança). O nível rápido (a 1ª linha da Habilidade; 5 abas cabem no
 * 640×360, 6 não) preenche habilidade e inteligência; o nível
 * de inteligência liga os comportamentos dele e o "modo avançado" liga e desliga cada um; a personalidade base
 * preenche os pesos. Os valores andam por listas dentro das faixas do formato (`BOT_RANGES`).
 */

export const LAB_TABS = ['skill', 'mind', 'persona', 'rules', 'name'] as const;
export type LabTab = (typeof LAB_TABS)[number];

export const LAB_TAB_LABELS: Readonly<Record<LabTab, StringKey>> = {
  skill: 'lab.tab.skill',
  mind: 'lab.tab.mind',
  persona: 'lab.tab.persona',
  rules: 'lab.tab.rules',
  name: 'lab.tab.name',
};

interface LabRow {
  readonly id: string;
  readonly labelKey: StringKey;
  value(d: BotDocument): string;
  step(d: BotDocument, delta: number): BotDocument;
}

function stepList(list: readonly number[], current: number, delta: number): number {
  let i = 0;
  for (let k = 1; k < list.length; k++) if (Math.abs(list[k]! - current) < Math.abs(list[i]! - current)) i = k;
  return list[Math.max(0, Math.min(list.length - 1, i + delta))]!;
}

function cycle<T>(list: readonly T[], current: T, delta: number): T {
  const i = Math.max(0, list.indexOf(current));
  return list[(((i + delta) % list.length) + list.length) % list.length]!;
}

const withSkill = (d: BotDocument, s: Partial<BotSkill>): BotDocument => ({ ...d, skill: { ...d.skill, ...s } });
const withMind = (d: BotDocument, m: Partial<BotIntelligence>): BotDocument => ({
  ...d,
  intelligence: { ...d.intelligence, ...m },
});
const withPersona = (d: BotDocument, p: Partial<BotPersonality>): BotDocument => ({
  ...d,
  personality: { ...d.personality, ...p },
});
const withRules = (d: BotDocument, r: Partial<BotRules>): BotDocument => ({ ...d, rules: { ...d.rules, ...r } });

const pct = (v: number): string => t('settings.percent', { n: Math.round(v * 100) });
const mult = (v: number): string => t('custom.mult', { n: v });
const onOff = (v: boolean): string => t(v ? 'custom.on' : 'custom.off');

function numeric(
  id: string,
  labelKey: StringKey,
  list: readonly number[],
  get: (d: BotDocument) => number,
  set: (d: BotDocument, v: number) => BotDocument,
  show: (v: number) => string,
): LabRow {
  return { id, labelKey, value: (d) => show(get(d)), step: (d, delta) => set(d, stepList(list, get(d), delta)) };
}

function toggle(
  id: string,
  labelKey: StringKey,
  get: (d: BotDocument) => boolean,
  set: (d: BotDocument, v: boolean) => BotDocument,
): LabRow {
  return { id, labelKey, value: (d) => onOff(get(d)), step: (d) => set(d, !get(d)) };
}

const UNIT = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

const LEVEL_ROWS: readonly LabRow[] = [
  {
    id: 'level',
    labelKey: 'lab.row.level',
    value: (d) => {
      const level = botLevelOf(d);
      return level !== null ? t(`level.${level}` as StringKey) : t('bot.card.customSkill');
    },
    step: (d, delta) => {
      const current = botLevelOf(d);
      const i = current === null ? (delta > 0 ? -1 : LEVEL_ORDER.length) : LEVEL_ORDER.indexOf(current);
      const level = LEVEL_ORDER[Math.max(0, Math.min(LEVEL_ORDER.length - 1, i + delta))]!;
      const base = levelBot(level);
      return { ...d, skill: base.skill, intelligence: base.intelligence };
    },
  },
];

const SKILL_ROWS: readonly LabRow[] = [
  numeric(
    'reaction',
    'lab.row.reaction',
    [100, 150, 180, 220, 260, 300, 350, 400, 450, 550, 650, 750, 900, 1050, 1200],
    (d) => d.skill.reactionMs,
    (d, v) => withSkill(d, { reactionMs: v }),
    (v) => t('lab.ms', { n: v }),
  ),
  numeric(
    'aimError',
    'lab.row.aimError',
    [0.2, 0.4, 0.6, 0.8, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10],
    (d) => d.skill.aimErrorDeg,
    (d, v) => withSkill(d, { aimErrorDeg: v }),
    (v) => t('settings.degrees', { n: v }),
  ),
  numeric(
    'acquire',
    'lab.row.acquire',
    [0, 0.1, 0.2, 0.35, 0.5, 0.6, 0.75, 0.9, 1.05, 1.2, 1.5],
    (d) => d.skill.acquireS,
    (d, v) => withSkill(d, { acquireS: v }),
    (v) => t('lab.seconds', { n: v }),
  ),
  numeric(
    'turn',
    'lab.row.turn',
    [90, 120, 150, 180, 220, 260, 320, 400, 500, 650, 800, 900],
    (d) => d.skill.turnDegS,
    (d, v) => withSkill(d, { turnDegS: v }),
    (v) => t('lab.degPerS', { n: v }),
  ),
  numeric(
    'recoil',
    'lab.row.recoil',
    [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.75, 0.85, 0.95, 1],
    (d) => d.skill.recoilControl,
    (d, v) => withSkill(d, { recoilControl: v }),
    pct,
  ),
  numeric(
    'head',
    'lab.row.head',
    [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8, 1],
    (d) => d.skill.headPref,
    (d, v) => withSkill(d, { headPref: v }),
    pct,
  ),
  numeric(
    'grenade',
    'lab.row.grenade',
    UNIT,
    (d) => d.skill.grenadeUse,
    (d, v) => withSkill(d, { grenadeUse: v }),
    pct,
  ),
  {
    id: 'move',
    labelKey: 'lab.row.move',
    value: (d) => t(`lab.move.${d.skill.combatMove}` as StringKey),
    step: (d, delta) => withSkill(d, { combatMove: cycle(COMBAT_MOVES, d.skill.combatMove, delta) }),
  },
  numeric(
    'trigger',
    'lab.row.trigger',
    [0, 0.25, 0.5, 0.75, 1],
    (d) => d.skill.triggerHold,
    (d, v) => withSkill(d, { triggerHold: v }),
    pct,
  ),
  numeric(
    'switch',
    'lab.row.switch',
    [0.2, 0.4, 0.6, 0.8, 1, 1.5, 2],
    (d) => d.skill.targetSwitchS,
    (d, v) => withSkill(d, { targetSwitchS: v }),
    (v) => t('lab.seconds', { n: v }),
  ),
];

const MIND_ROWS: readonly LabRow[] = [
  {
    id: 'mindLevel',
    labelKey: 'lab.row.mindLevel',
    value: (d) => t('lab.n', { n: d.intelligence.level }),
    step: (d, delta) => {
      const n = Math.max(0, Math.min(BOT_RANGES.intelligence.max, d.intelligence.level + delta));
      return { ...d, intelligence: intelligenceForLevel(n) };
    },
  },
  toggle(
    'cover',
    'lab.row.cover',
    (d) => d.intelligence.useCover,
    (d, v) => withMind(d, { useCover: v }),
  ),
  toggle(
    'flank',
    'lab.row.flank',
    (d) => d.intelligence.flank,
    (d, v) => withMind(d, { flank: v }),
  ),
  toggle(
    'retreat',
    'lab.row.retreat',
    (d) => d.intelligence.retreat,
    (d, v) => withMind(d, { retreat: v }),
  ),
  toggle(
    'grenades',
    'lab.row.grenades',
    (d) => d.intelligence.grenades,
    (d, v) => withMind(d, { grenades: v }),
  ),
  toggle(
    'callouts',
    'lab.row.callouts',
    (d) => d.intelligence.callouts,
    (d, v) => withMind(d, { callouts: v }),
  ),
  toggle(
    'ambush',
    'lab.row.ambush',
    (d) => d.intelligence.ambush,
    (d, v) => withMind(d, { ambush: v }),
  ),
  toggle(
    'learn',
    'lab.row.learn',
    (d) => d.intelligence.learn,
    (d, v) => withMind(d, { learn: v }),
  ),
  toggle(
    'objective',
    'lab.row.objective',
    (d) => d.intelligence.playObjective,
    (d, v) => withMind(d, { playObjective: v }),
  ),
];

const PERSONA_ROWS: readonly LabRow[] = [
  {
    id: 'preset',
    labelKey: 'lab.row.preset',
    value: (d) => t(`persona.${d.personality.preset}` as StringKey),
    step: (d, delta) => ({ ...d, personality: PERSONALITY_PRESETS[cycle(PERSONALITIES, d.personality.preset, delta)] }),
  },
  numeric(
    'aggression',
    'lab.row.aggression',
    UNIT,
    (d) => d.personality.aggression,
    (d, v) => withPersona(d, { aggression: v }),
    pct,
  ),
  numeric(
    'caution',
    'lab.row.caution',
    UNIT,
    (d) => d.personality.caution,
    (d, v) => withPersona(d, { caution: v }),
    pct,
  ),
  numeric(
    'patience',
    'lab.row.patience',
    UNIT,
    (d) => d.personality.patience,
    (d, v) => withPersona(d, { patience: v }),
    pct,
  ),
  numeric(
    'range',
    'lab.row.range',
    [-1, 3, 5, 8, 10, 15, 20, 25, 30, 40, 50, 60, 80],
    (d) => d.personality.preferredRangeM,
    (d, v) => withPersona(d, { preferredRangeM: v }),
    (v) => (v < 0 ? t('lab.range.weapon') : t('lab.meters', { n: v })),
  ),
  numeric(
    'silliness',
    'lab.row.silliness',
    UNIT,
    (d) => d.personality.silliness,
    (d, v) => withPersona(d, { silliness: v }),
    pct,
  ),
];

function allowedIndex(d: BotDocument): number {
  const i = ALLOWED_CHOICES.findIndex(
    (c) => c.length === d.rules.weapons.length && c.every((w, k) => w === d.rules.weapons[k]),
  );
  return i < 0 ? 0 : i;
}

const RULE_ROWS: readonly LabRow[] = [
  numeric(
    'hp',
    'lab.row.hp',
    [1, 25, 50, 75, 100, 150, 200, 300, 500, 750, 1000],
    (d) => d.rules.hp,
    (d, v) => withRules(d, { hp: v }),
    (v) => String(v),
  ),
  numeric(
    'damage',
    'lab.row.damage',
    [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5],
    (d) => d.rules.damageMult,
    (d, v) => withRules(d, { damageMult: v }),
    mult,
  ),
  numeric(
    'speed',
    'lab.row.speed',
    [0.5, 0.75, 1, 1.25, 1.5, 2],
    (d) => d.rules.speed,
    (d, v) => withRules(d, { speed: v }),
    mult,
  ),
  {
    id: 'ammo',
    labelKey: 'lab.row.ammo',
    value: (d) => t(`custom.ammo.${d.rules.ammo}` as StringKey),
    step: (d, delta) => withRules(d, { ammo: cycle(AMMO_RULES, d.rules.ammo, delta) }),
  },
  {
    id: 'weapons',
    labelKey: 'lab.row.weapons',
    value: (d) => t(ALLOWED_KEYS[allowedIndex(d)]!),
    step: (d, delta) => {
      const n = ALLOWED_CHOICES.length;
      const i = (((allowedIndex(d) + delta) % n) + n) % n;
      return withRules(d, { weapons: ALLOWED_CHOICES[i]! });
    },
  },
  toggle(
    'headImmune',
    'lab.row.headImmune',
    (d) => d.rules.headshotImmune,
    (d, v) => withRules(d, { headshotImmune: v }),
  ),
  toggle(
    'explode',
    'lab.row.explode',
    (d) => d.rules.explodeOnDeath,
    (d, v) => withRules(d, { explodeOnDeath: v }),
  ),
  numeric(
    'vision',
    'lab.row.vision',
    [60, 90, 120, 150, 180, 240, 300, 360],
    (d) => d.rules.visionDeg,
    (d, v) => withRules(d, { visionDeg: v }),
    (v) => t('settings.degrees', { n: v }),
  ),
  numeric(
    'visionRange',
    'lab.row.visionRange',
    [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2],
    (d) => d.rules.visionRange,
    (d, v) => withRules(d, { visionRange: v }),
    mult,
  ),
  numeric(
    'hearing',
    'lab.row.hearing',
    [0, 0.25, 0.5, 0.75, 1, 1.5, 2],
    (d) => d.rules.hearing,
    (d, v) => withRules(d, { hearing: v }),
    mult,
  ),
  {
    id: 'knowledge',
    labelKey: 'lab.row.knowledge',
    value: (d) => t(`lab.knowledge.${d.rules.knowledge}` as StringKey),
    step: (d, delta) => withRules(d, { knowledge: cycle(KNOWLEDGE_RULES, d.rules.knowledge, delta) }),
  },
];

function rowsOf(tab: LabTab): readonly LabRow[] {
  switch (tab) {
    case 'skill':
      return [...LEVEL_ROWS, ...SKILL_ROWS];
    case 'mind':
      return MIND_ROWS;
    case 'persona':
      return PERSONA_ROWS;
    case 'rules':
      return RULE_ROWS;
    case 'name':
      return [];
  }
}

/**
 * As linhas da aba. Nome: o nome (confirmar abre a digitação, quando o aparelho tem teclado) e "Rolar nome".
 */
export function labRows(tab: LabTab, d: BotDocument, canType: boolean): TabbedRow[] {
  if (tab === 'name') {
    return [
      { kind: 'value', id: 'name', labelKey: 'lab.row.name', value: d.name },
      { kind: 'action', id: 'roll', label: { key: 'lab.roll' } },
      ...(canType ? [] : [{ kind: 'text' as const, id: 'noKeyboard', text: t('lab.noKeyboard'), dim: true }]),
    ];
  }
  const rows: TabbedRow[] = rowsOf(tab).map((r) => ({
    kind: 'option',
    id: r.id,
    labelKey: r.labelKey,
    value: r.value(d),
  }));
  // A dica do nível rápido logo embaixo dele.
  if (tab === 'skill') rows.splice(1, 0, { kind: 'text', id: 'hint', text: t('lab.levelHint'), dim: true });
  if (tab === 'mind') rows.push({ kind: 'text', id: 'hint', text: t('lab.mindHint'), dim: true });
  return rows;
}

/** Um passo na linha `id` da aba (`delta` 0 = o confirmar, que avança). */
export function stepLab(tab: LabTab, d: BotDocument, id: string, delta: number): BotDocument {
  const row = rowsOf(tab).find((r) => r.id === id);
  return row ? row.step(d, delta === 0 ? 1 : delta) : d;
}

/** A linha de baixo do título: "Jorge the Immortal 2 · Kamikaze · N0". */
export function labSummary(d: BotDocument): string {
  return t('lab.summary', {
    name: botDisplayName(d),
    persona: t(`persona.${d.personality.preset}` as StringKey),
    n: d.intelligence.level,
  });
}

// Gerador de nomes bobos em inglês (§6.7, #15: "Private Pickles", "Sergeant Noodle"). Nomes de bot são dado do
// jogador, como os de fábrica: ficam em inglês, fora da tabela de textos.
const RANKS = ['Private', 'Corporal', 'Sergeant', 'Captain', 'Major', 'Colonel', 'General', 'Cadet', 'Agent', 'Doctor'];
const NOUNS = [
  'Pickles',
  'Noodle',
  'Waffle',
  'Biscuit',
  'Nugget',
  'Muffin',
  'Pudding',
  'Taco',
  'Meatball',
  'Pancake',
  'Dumpling',
  'Bagel',
  'Cupcake',
  'Potato',
  'Burrito',
  'Nacho',
  'Sprinkles',
  'Toast',
];

/** Um nome bobo novo, fora dos já usados (no limite, ganha um número). */
export function rollBotName(rng: Rng, taken: ReadonlySet<string>): string {
  for (let tries = 0; tries < 40; tries++) {
    const name = `${RANKS[rng.int(0, RANKS.length)]!} ${NOUNS[rng.int(0, NOUNS.length)]!}`;
    if (!taken.has(name)) return name;
  }
  return `${RANKS[0]!} ${NOUNS[0]!} ${rng.int(2, 100)}`;
}

/** O nome digitado: só letras latinas, números, espaço e pontuação simples (o atlas do HUD), sem sobrar espaço. */
export function cleanBotName(text: string): string {
  return text
    .replace(/[^A-Za-z0-9À-ÖØ-öø-ÿ .,'!?&-]/gu, '')
    .replace(/\s+/gu, ' ')
    .trimStart()
    .slice(0, BOT_RANGES.nameMaxLength);
}
