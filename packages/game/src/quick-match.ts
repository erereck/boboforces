import {
  BOT_LEVELS,
  builtinBotRef,
  MATCH_RECIPE_FORMAT,
  presetBotCounts,
  presetLevel,
  type BotLevel,
  type BotRef,
  type MatchRecipe,
} from '@boboforces/format';
import { t } from '@boboforces/ui';

/**
 * M2 (fase 4d): a Partida Rápida (arte-ux.md §6.3; gameplay.md §10.1: "modo, mapa, nível, quantidade de bots") e os
 * presets de fábrica que já têm modo (gameplay.md §10.4). Lógica pura: do preset para as opções, cada passo de opção e
 * das opções de volta para o preset. O tamanho respeita o teto de bots do aparelho.
 */

export const QUICK_MODES = ['warfare.tdm', 'warfare.ffa'] as const;
export type QuickMode = (typeof QUICK_MODES)[number];

/** Mapas da Partida Rápida (o Ringue entra na fase 5). */
export const QUICK_MAPS = ['construto'] as const;

/** Durações em minutos; 0 = sem limite de tempo (só a meta de abates). */
export const QUICK_MINUTES = [3, 5, 10, 15, 20, 0] as const;

export interface QuickSettings {
  readonly mode: QuickMode;
  readonly map: string;
  readonly level: BotLevel;
  /** TDM: bobos por lado (você conta no seu); FFA: quantos bots. */
  readonly size: number;
  readonly minutes: number;
}

/**
 * Meta de abates por duração (gameplay.md §7.4: TDM com 75 abates ou 10 min). O TDM soma o time; o FFA é de um bobo
 * só. Sem limite de tempo, a meta do jogo de 10 min.
 */
const SCORE_BY_MINUTES: Readonly<Record<QuickMode, Readonly<Record<number, number>>>> = {
  'warfare.tdm': { 3: 20, 5: 30, 10: 75, 15: 100, 20: 125, 0: 75 },
  'warfare.ffa': { 3: 10, 5: 15, 10: 25, 15: 30, 20: 40, 0: 25 },
};

export function scoreFor(mode: QuickMode, minutes: number): number {
  return SCORE_BY_MINUTES[mode][minutes] ?? SCORE_BY_MINUTES[mode][10]!;
}

/** Faixa do tamanho: TDM de 1 a metade do teto (mais você); FFA de 1 ao teto. */
export function sizeRange(mode: QuickMode, maxBots: number): { min: number; max: number } {
  return mode === 'warfare.tdm'
    ? { min: 1, max: Math.max(1, Math.floor((maxBots + 1) / 2)) }
    : { min: 1, max: maxBots };
}

function clampSize(mode: QuickMode, size: number, maxBots: number): number {
  const r = sizeRange(mode, maxBots);
  return Math.max(r.min, Math.min(r.max, size));
}

/** As opções a partir de um preset (o último jogado abre a Partida Rápida como estava). */
export function quickFromPreset(recipe: MatchRecipe, maxBots: number): QuickSettings {
  const mode: QuickMode = recipe.mode === 'warfare.ffa' ? 'warfare.ffa' : 'warfare.tdm';
  const counts = presetBotCounts(recipe);
  const size = mode === 'warfare.tdm' ? Math.max(counts[1] ?? 1, (counts[0] ?? 0) + 1) : (counts[0] ?? 1);
  const time = recipe.match?.timeLimitS ?? 0;
  const minutes = QUICK_MINUTES.reduce<number>(
    (best, m) => (Math.abs(m * 60 - time) < Math.abs(best * 60 - time) ? m : best),
    QUICK_MINUTES[0],
  );
  return {
    mode,
    map: (QUICK_MAPS as readonly string[]).includes(recipe.map) ? recipe.map : QUICK_MAPS[0],
    level: presetLevel(recipe) ?? 'normal',
    size: clampSize(mode, size, maxBots),
    minutes,
  };
}

/** O preset das opções: bots de nível nos dois times (TDM) ou no time único (FFA). */
export function quickToPreset(q: QuickSettings): MatchRecipe {
  const ref = builtinBotRef(q.level);
  const match = {
    ...(q.minutes > 0 ? { timeLimitS: q.minutes * 60 } : { timeLimitS: 0 }),
    scoreLimit: scoreFor(q.mode, q.minutes),
  };
  if (q.mode === 'warfare.ffa') {
    return {
      format: MATCH_RECIPE_FORMAT,
      mode: q.mode,
      map: q.map,
      seed: 0,
      match,
      teams: [{ humans: 'all', bots: [{ ref, count: q.size }] }],
    };
  }
  return {
    format: MATCH_RECIPE_FORMAT,
    mode: q.mode,
    map: q.map,
    seed: 0,
    match,
    teams: [
      { humans: 'all', bots: q.size > 1 ? [{ ref, count: q.size - 1 }] : [] },
      { bots: [{ ref, count: q.size }] },
    ],
  };
}

/** Opções da Partida Rápida, na ordem da tela. */
export const QUICK_OPTIONS = ['mode', 'map', 'level', 'size', 'minutes'] as const;
export type QuickOption = (typeof QUICK_OPTIONS)[number];

function cycle<T>(list: readonly T[], current: T, delta: number): T {
  const i = Math.max(0, list.indexOf(current));
  return list[(i + delta + list.length) % list.length]!;
}

/** Um passo numa opção (`delta` -1 ou +1; o confirmar avança). Modo, mapa e duração dão a volta; nível e tamanho param. */
export function stepQuick(q: QuickSettings, option: QuickOption, delta: number, maxBots: number): QuickSettings {
  switch (option) {
    case 'mode': {
      const mode = cycle(QUICK_MODES, q.mode, delta);
      // Mesma quantidade de bobos ao trocar: 4 contra 4 (7 bots) vira 7 bots no FFA, e volta.
      const size = mode === 'warfare.ffa' ? q.size * 2 - 1 : Math.ceil((q.size + 1) / 2);
      return { ...q, mode, size: clampSize(mode, size, maxBots) };
    }
    case 'map':
      return { ...q, map: cycle(QUICK_MAPS, q.map as (typeof QUICK_MAPS)[number], delta) };
    case 'level': {
      const i = BOT_LEVELS.indexOf(q.level) + delta;
      return { ...q, level: BOT_LEVELS[Math.max(0, Math.min(BOT_LEVELS.length - 1, i))]! };
    }
    case 'size':
      return { ...q, size: clampSize(q.mode, q.size + delta, maxBots) };
    case 'minutes':
      return { ...q, minutes: cycle(QUICK_MINUTES, q.minutes as (typeof QUICK_MINUTES)[number], delta) };
  }
}

/** O valor de cada opção em texto, para a linha de opção. */
export function quickValue(q: QuickSettings, option: QuickOption): string {
  switch (option) {
    case 'mode':
      return t(q.mode === 'warfare.tdm' ? 'mode.short.warfare.tdm' : 'mode.short.warfare.ffa');
    case 'map':
      return t('map.construto');
    case 'level':
      return t(`level.${q.level}`);
    case 'size':
      return q.mode === 'warfare.tdm' ? t('summary.teams', { a: q.size, b: q.size }) : t('quick.bots', { n: q.size });
    case 'minutes':
      return q.minutes === 0 ? t('quick.noTime') : t('summary.time', { min: q.minutes });
  }
}

/**
 * Presets de fábrica cujo modo já existe (gameplay.md §10.4): Vibe (Pela vibe, 4v4), Tryhard (6v6) e Sexta do Jorge
 * (você e 5 Normal Bob contra 6 Jorges). Os outros (X1 Sniper, 2v2 + bots, 4 vs 40, Sofá Zombies, Paintball) chegam
 * com o modo, o mapa ou o multijogador deles.
 */
export function factoryPresets(): MatchRecipe[] {
  const tdm = (
    name: string,
    ally: BotRef,
    allies: number,
    foe: BotRef,
    foes: number,
    minutes: number,
  ): MatchRecipe => ({
    format: MATCH_RECIPE_FORMAT,
    name,
    mode: 'warfare.tdm',
    map: 'construto',
    seed: 0,
    match: { timeLimitS: minutes * 60, scoreLimit: scoreFor('warfare.tdm', minutes) },
    teams: [{ humans: 'all', bots: [{ ref: ally, count: allies }] }, { bots: [{ ref: foe, count: foes }] }],
  });
  return [
    tdm(t('preset.name.vibe'), builtinBotRef('vibe'), 3, builtinBotRef('vibe'), 4, 5),
    tdm(t('preset.name.tryhard'), builtinBotRef('tryhard'), 5, builtinBotRef('tryhard'), 6, 10),
    tdm(t('preset.name.fridayJorge'), builtinBotRef('normal'), 5, 'builtin:jorge-the-immortal', 6, 10),
  ];
}
