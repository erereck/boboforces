import { MATCH_RECIPE_FORMAT, type BotDocument, type BotRef, type MatchRecipe } from '@boboforces/format';

/**
 * M2 (fase 5d): o Bobo Training (gameplay.md §7: arena pequena com alvos fixos e móveis; os bots do Laboratório em
 * loop; precisão, TTK médio e % de cabeça; sem placar). No Ringue, sem tempo nem meta (não termina: sai-se pela
 * pausa), com respawn de 1 s. Os alvos são os bots de fábrica com a personalidade Alvo: Dummy Dan (parado) e Dashing
 * Dave (andando de lado).
 */
export const TRAINING_TARGETS: readonly { readonly ref: BotRef; readonly count: number }[] = [
  { ref: 'builtin:training-dummy', count: 2 },
  { ref: 'builtin:training-runner', count: 2 },
];

/** O preset do treino: os alvos e, junto (o Testar do Laboratório, fase 5e), os bots pedidos, embutidos se precisar. */
export function trainingPreset(
  extra: readonly { readonly ref: BotRef; readonly count: number }[] = [],
  embedded: readonly BotDocument[] = [],
): MatchRecipe {
  return {
    format: MATCH_RECIPE_FORMAT,
    mode: 'training',
    map: 'ringue',
    seed: 0,
    match: { timeLimitS: 0, scoreLimit: 0 },
    players: { respawnS: 1 },
    teams: [{ humans: 'all', bots: [] }, { bots: [...TRAINING_TARGETS, ...extra] }],
    ...(embedded.length > 0 ? { embeddedBots: embedded } : {}),
  };
}
