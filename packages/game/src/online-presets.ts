import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';

/**
 * M5 (fase 6a): as partidas da sala (GDD §7, a linha do M5: TDM, FFA, X1, Surpreenda-me e Bobo Zombies coop). Cada
 * card da "Partida da sala" vira uma receita feita para 1 humano no time 0 (`humans: 'all'`), como os presets do sofá:
 * os amigos tomam o lugar de bots do time que escolherem (`onlineRecipe`). Lógica pura, fora do menu (vai no pedaço do
 * Online).
 */

/** Os cards, na ordem da tela. */
export const ROOM_MODES = ['warfare.tdm', 'warfare.ffa', 'x1', 'zombies', 'surprise', 'custom'] as const;
export type RoomMode = (typeof ROOM_MODES)[number];
/** Os cards que já são uma receita (o Surpreenda-me sorteia; a personalizada abre a tela de sempre). */
export type RoomPresetMode = Exclude<RoomMode, 'surprise' | 'custom'>;

/** 5 min com a meta de abates da Partida Rápida para 5 min (TDM 30, FFA 15); o X1 vai a 15, como no GDD. */
const SHORT_S = 300;

export function roomPreset(mode: RoomPresetMode): MatchRecipe {
  const normal = builtinBotRef('normal');
  switch (mode) {
    case 'warfare.tdm':
      return {
        format: MATCH_RECIPE_FORMAT,
        mode: 'warfare.tdm',
        map: 'construto',
        seed: 0,
        match: { timeLimitS: SHORT_S, scoreLimit: 30 },
        teams: [{ humans: 'all', bots: [{ ref: normal, count: 3 }] }, { bots: [{ ref: normal, count: 4 }] }],
      };
    case 'warfare.ffa':
      return {
        format: MATCH_RECIPE_FORMAT,
        mode: 'warfare.ffa',
        map: 'construto',
        seed: 0,
        match: { timeLimitS: SHORT_S, scoreLimit: 15 },
        teams: [{ humans: 'all', bots: [{ ref: normal, count: 7 }] }],
      };
    case 'x1':
      // O Ringue não tem FFA (`maps.ts`): o X1 é um TDM de 1 por lado. O amigo do outro lado toma o lugar do bot.
      return {
        format: MATCH_RECIPE_FORMAT,
        mode: 'warfare.tdm',
        map: 'ringue',
        seed: 0,
        match: { timeLimitS: SHORT_S, scoreLimit: 15 },
        teams: [{ humans: 'all', bots: [] }, { bots: [{ ref: normal, count: 1 }] }],
      };
    case 'zombies':
      // O Sofá Zombies (M3): 3 bots de apoio, e cada amigo toma o lugar de um.
      return {
        format: MATCH_RECIPE_FORMAT,
        mode: 'zombies',
        map: 'base',
        seed: 0,
        match: { timeLimitS: 0, scoreLimit: 0 },
        zombies: { waves: 10 },
        teams: [{ humans: 'all', bots: [{ ref: normal, count: 3 }] }],
      };
  }
}
