import {
  BOT_LEVELS,
  builtinBotRef,
  MATCH_RECIPE_FORMAT,
  presetBotCounts,
  presetLevel,
  type MatchRecipe,
} from '@boboforces/format';
import type { Rng } from '@boboforces/shared';
import { t, type StringKey } from '@boboforces/ui';

/**
 * M2 (fase 4c): o preset em texto (o resumo do JOGAR no título e as linhas do card do Surpreenda-me) e o sorteio do
 * Surpreenda-me. Pela tabela de textos (regra 13); só um jogador local no M2.
 */

const LOCAL_HUMANS = 1;

function humansIn(team: MatchRecipe['teams'][number]): number {
  return team.humans === 'all' ? LOCAL_HUMANS : (team.humans ?? 0);
}

function ffa(recipe: MatchRecipe): boolean {
  return recipe.mode === 'warfare.ffa';
}

/** "4 contra 4" (você conta no seu time) ou "8 bobos" no FFA. */
function sides(recipe: MatchRecipe): string {
  const counts = presetBotCounts(recipe);
  if (ffa(recipe) || recipe.teams.length < 2) {
    const n = counts.reduce((a, b) => a + b, 0) + recipe.teams.reduce((a, team) => a + humansIn(team), 0);
    return t('summary.ffa', { n });
  }
  const a = counts[0]! + humansIn(recipe.teams[0]!);
  const b = counts[1]! + humansIn(recipe.teams[1]!);
  return t('summary.teams', { a, b });
}

/** "5 min ou 30 abates", "10 min", "até 30 abates"; `''` sem limite na receita. */
function duration(recipe: MatchRecipe): string {
  const time = recipe.match?.timeLimitS ?? 0;
  const score = recipe.match?.scoreLimit ?? 0;
  const min = Math.round(time / 60);
  if (time > 0 && score > 0) return t('summary.timeOrScore', { min, n: score });
  if (time > 0) return t('summary.time', { min });
  if (score > 0) return t('summary.score', { n: score });
  return '';
}

function levelName(recipe: MatchRecipe): string {
  const level = presetLevel(recipe);
  return level === null ? '' : t(`level.${level}` as StringKey);
}

/** Resumo de uma linha para o título: "Times · De boa · 4 contra 4 · Construto". */
export function presetSummary(recipe: MatchRecipe): string {
  const parts = [
    t(`mode.short.${recipe.mode}` as StringKey),
    levelName(recipe),
    sides(recipe),
    t(`map.${recipe.map}` as StringKey),
  ].filter((p) => p !== '');
  return parts.join(t('summary.separator'));
}

/** As linhas do card do sorteio: o modo (em destaque), o mapa, o nível, os times e a duração. */
export function presetLines(recipe: MatchRecipe): string[] {
  return [
    t(`mode.${recipe.mode}` as StringKey),
    t(`map.${recipe.map}` as StringKey),
    levelName(recipe),
    sides(recipe),
    duration(recipe),
  ].filter((l) => l !== '');
}

/**
 * Sorteio do Surpreenda-me: modo (TDM 70%, FFA 30%), um dos 5 níveis, o tamanho (TDM de 3 a 6 por lado; FFA de 5 a 9
 * bots, dentro do teto do celular) e a duração (5 ou 10 min, com a meta de abates do modo). Mapa: o Construto (o
 * Ringue entra na fase 5).
 */
export function rollSurprise(rng: Rng): MatchRecipe {
  const level = BOT_LEVELS[rng.int(0, BOT_LEVELS.length)]!;
  const ref = builtinBotRef(level);
  const long = rng.chance(0.5);
  if (rng.chance(0.3)) {
    return {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.ffa',
      map: 'construto',
      seed: 0,
      match: { timeLimitS: long ? 600 : 300, scoreLimit: long ? 25 : 15 },
      teams: [{ humans: 'all', bots: [{ ref, count: rng.int(5, 10) }] }],
    };
  }
  const side = rng.int(3, 7);
  return {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'construto',
    seed: 0,
    match: { timeLimitS: long ? 600 : 300, scoreLimit: long ? 75 : 30 },
    teams: [{ humans: 'all', bots: side > 1 ? [{ ref, count: side - 1 }] : [] }, { bots: [{ ref, count: side }] }],
  };
}

/**
 * M2 (fase 4d): um atalho da Partida Rápida: o rótulo curto do botão (o nome do preset ou "4×4 De boa") e a linha de
 * baixo ("Times · 5 min ou 30 abates"; o mapa entra quando houver mais de um, na fase 5).
 */
export function presetShortcut(recipe: MatchRecipe): { label: string; caption: string } {
  const counts = presetBotCounts(recipe);
  let size: string;
  if (ffa(recipe) || recipe.teams.length < 2) size = t('quick.bots', { n: counts.reduce((a, b) => a + b, 0) });
  else {
    const a = counts[0]! + humansIn(recipe.teams[0]!);
    const b = counts[1]! + humansIn(recipe.teams[1]!);
    size = t('summary.teamsShort', { a, b });
  }
  const name = (recipe.name ?? '').trim();
  const label = name !== '' ? name : [size, levelName(recipe)].filter((p) => p !== '').join(' ');
  const caption = [t(`mode.short.${recipe.mode}` as StringKey), duration(recipe)]
    .filter((p) => p !== '')
    .join(t('summary.separator'));
  return { label, caption };
}
