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
  // M6 (fase 2): os presets de festa.
  { id: 'gunGame', nameKey: 'mode.name.gunGame', descKey: 'mode.desc.gunGame' },
  { id: 'infection', nameKey: 'mode.name.infection', descKey: 'mode.desc.infection' },
];

/** M6 (fase 2): a escada do Gun Game (GDD: 7 níveis com o arsenal do M2; a faca por último). */
export const GUN_GAME_LADDER = ['rifle', 'smg', 'shotgun', 'lmg', 'sniper', 'pistol', 'knife'] as const;

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
    case 'gunGame':
      // Todos contra todos com a escada; a reserva infinita (só a arma do nível na mão); até alguém fechar (10 min).
      return {
        format: MATCH_RECIPE_FORMAT,
        name: 'Gun Game',
        mode: 'warfare.ffa',
        map: 'construto',
        seed: 0,
        match: { timeLimitS: 600, scoreLimit: 0 },
        weapons: { ladder: [...GUN_GAME_LADDER], ammo: 'infiniteReserve' },
        teams: [{ humans: 'all', bots: [{ ref: normal, count: 7 }] }],
      };
    case 'infection':
      // Os Times com todo mundo de sobrevivente (o 1º infectado é sorteado na largada); 3 min.
      return {
        format: MATCH_RECIPE_FORMAT,
        name: 'Infection',
        mode: 'warfare.tdm',
        map: 'construto',
        seed: 0,
        match: { timeLimitS: 180, scoreLimit: 0 },
        infection: {},
        teams: [{ humans: 'all', bots: [{ ref: normal, count: 7 }] }, { bots: [] }],
      };
    default:
      return null;
  }
}
