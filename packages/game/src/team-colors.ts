import type { MatchRecipe } from '@boboforces/format';
import { t, TEAM_PALETTE, type StringKey } from '@boboforces/ui';

/**
 * M10 (fase 8): a cor de cada time na partida (pergunta AK6). Fora do Sandbox, e no Sandbox sem `color`, é a da posição
 * (o time 0 é o Laranja, o 1 o Azul…, o `TEAM_COLORS`); no Sandbox, a que a receita escolheu (índice de
 * `TEAM_PALETTE`). Quem pinta a cor de um time (as skins, o HUD, o placar do Tab, o feed, os marcadores e a sala online)
 * lê daqui, nunca do `TEAM_COLORS` direto. Módulo pequeno: o menu (o card do sofá) também usa.
 */

/** O índice da cor do time `team` na paleta (`TEAM_PALETTE`). */
export function teamColorIndex(recipe: MatchRecipe, team: number): number {
  const c = recipe.mode === 'sandbox' ? recipe.teams[team]?.color : undefined;
  if (c !== undefined && Number.isInteger(c) && c >= 0 && c < TEAM_PALETTE.length) return c;
  return team >= 0 && team < 4 ? team : 0;
}

/** A cor RGBA (0xRRGGBBAA) do time `team`. */
export function teamColor(recipe: MatchRecipe, team: number): number {
  return TEAM_PALETTE[teamColorIndex(recipe, team)]!;
}

/** As cores RGBA dos 4 times da partida (montada uma vez no começo; os modelos do HUD e do placar guardam uma cópia). */
export function teamColorTable(recipe: MatchRecipe): number[] {
  return [0, 1, 2, 3].map((team) => teamColor(recipe, team));
}

/** O nome de uma cor da paleta (`feed.teamName.<i>`; fora dela, o do Laranja). */
export function colorName(index: number): string {
  return t(`feed.teamName.${index >= 0 && index < TEAM_PALETTE.length ? index : 0}` as StringKey);
}
