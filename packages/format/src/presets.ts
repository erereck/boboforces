import {
  botLevelFromRef,
  builtinBotRef,
  MATCH_RECIPE_FORMAT,
  type BotLevel,
  type MatchRecipe,
  type TeamRecipe,
} from './match-recipe.ts';

/**
 * M2 (fase 4c): presets prontos e o nível rápido de um preset.
 * - A **partida de estreia** (gameplay.md §2.5, #21): Bobo Warfare TDM no Construto, 4v4 (você e 3 aliados contra 4),
 *   todos no De boa, 5 min ou 30 abates. É o JOGAR de quem ainda não jogou.
 * - O **nível do preset** é o dos bots de nível do lado adversário (o "Mais fácil" e o "Mais difícil" do resultado
 *   andam um passo trocando todos os bots de nível; os especiais e os embutidos ficam como estão).
 */
export const DEBUT_PRESET: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'warfare.tdm',
  map: 'construto',
  seed: 0,
  match: { timeLimitS: 300, scoreLimit: 30 },
  teams: [
    { humans: 'all', bots: [{ ref: builtinBotRef('chill'), count: 3 }] },
    { bots: [{ ref: builtinBotRef('chill'), count: 4 }] },
  ],
};

function teamLevel(team: TeamRecipe): BotLevel | null {
  for (const b of team.bots) {
    const level = botLevelFromRef(b.ref);
    if (level !== null) return level;
  }
  return null;
}

/**
 * O nível rápido do preset: o dos bots de nível do primeiro time sem humanos (no FFA, ou sem time assim, o primeiro
 * que tiver); `null` se não houver bot de nível.
 */
export function presetLevel(recipe: MatchRecipe): BotLevel | null {
  for (const team of recipe.teams) {
    if (team.humans !== undefined && team.humans !== 0) continue;
    const level = teamLevel(team);
    if (level !== null) return level;
  }
  for (const team of recipe.teams) {
    const level = teamLevel(team);
    if (level !== null) return level;
  }
  return null;
}

/** O mesmo preset com todos os bots de nível no nível `level` (os especiais e os embutidos ficam). */
export function withPresetLevel(recipe: MatchRecipe, level: BotLevel): MatchRecipe {
  const ref = builtinBotRef(level);
  return {
    ...recipe,
    teams: recipe.teams.map((team) => ({
      ...team,
      bots: team.bots.map((b) => (botLevelFromRef(b.ref) !== null ? { ...b, ref } : b)),
    })),
  };
}

/** Quantos bots o preset tem em cada time (para o resumo do título e do sorteio). */
export function presetBotCounts(recipe: MatchRecipe): number[] {
  return recipe.teams.map((team) => team.bots.reduce((sum, b) => sum + b.count, 0));
}
