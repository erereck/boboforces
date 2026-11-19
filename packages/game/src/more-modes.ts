import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import type { ModeCard } from '@boboforces/ui';

/**
 * M6 (fase 0): a página "Mais modos" (o card dos Modos que entrou no lugar do Bobo Training). Mora no pedaço dos
 * editores, fora do menu da web (o menu está no teto de 350 KB): os cards, os textos (tabela extra) e a receita de cada
 * modo. Cada card começa direto, como o Bobo Zombies dos Modos; a Partida personalizada ajusta.
 */
export const MORE_MODE_CARDS: readonly ModeCard[] = [
  { id: 'training', nameKey: 'mode.name.training', descKey: 'mode.desc.training' },
  { id: 'warfare.domination', nameKey: 'mode.name.domination', descKey: 'mode.desc.domination' },
];

/** A receita de um card (o Bobo Training tem a dele, no `training.ts`); `null` = não é um card desta página. */
export function moreModePreset(id: string): MatchRecipe | null {
  const normal = builtinBotRef('normal');
  switch (id) {
    case 'warfare.domination':
      // GDD §4.1.2: 3 pontos, 200 pontos ou 10 min; 4 contra 4 no Construto (o único mapa com os pontos marcados).
      return {
        format: MATCH_RECIPE_FORMAT,
        mode: 'warfare.domination',
        map: 'construto',
        seed: 0,
        match: { timeLimitS: 600, scoreLimit: 200 },
        teams: [{ humans: 'all', bots: [{ ref: normal, count: 3 }] }, { bots: [{ ref: normal, count: 4 }] }],
      };
    default:
      return null;
  }
}
