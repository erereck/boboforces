import type { MatchRecipe } from '@boboforces/format';
import { t, type StringKey } from '@boboforces/ui';
import { cleanHudText } from './names.ts';

/**
 * M9 (fase 3): os nomes dos times. As cores ficam pela posição (pergunta AH4: Laranja, Azul, Verde e Roxo, como o
 * `TEAM_COLORS`); o nome que o Sandbox dá ao time aparece no placar, no resultado e na Partida personalizada.
 */

/** O nome da cor do time (`feed.teamName.<i>`; fora de 0..3, o do Laranja). */
export function teamColorName(team: number): string {
  return t(`feed.teamName.${team >= 0 && team < 4 ? team : 0}` as StringKey);
}

/** O nome do time para mostrar: o da receita (só o que o atlas do HUD desenha) ou, sem ele, o da cor. */
export function teamName(recipe: MatchRecipe, team: number): string {
  const name = cleanHudText(recipe.teams[team]?.name ?? '', TEAM_NAME_MAX).trim();
  return name !== '' ? name : teamColorName(team);
}

/**
 * O nome digitado na Partida personalizada: até 15 caracteres (o validador aceita 24, mas o nome tem que caber na área
 * do valor da linha, ao lado do quadradinho da cor: 15 "M" cabem no `CUSTOM_NAME_VALUE_WIDTH`; e no placar).
 */
export const TEAM_NAME_MAX = 15;
