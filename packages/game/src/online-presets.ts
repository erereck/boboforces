import {
  builtinBotRef,
  MATCH_RECIPE_FORMAT,
  PLATFORM_PROFILES,
  selectPlatformProfile,
  type MatchRecipe,
  type PlatformFamily,
} from '@boboforces/format';

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

// ---------------------------------------------------------------------------------------------------------------
// M5 (fase 6b): o host no celular e o menor teto da sala.
// ---------------------------------------------------------------------------------------------------------------

/** Os snapshots do host (tecnico.md §13.3 e §13.4): 30 Hz no PC, 20 Hz no celular. */
export function hostSnapshotHz(mobile: boolean): number {
  return mobile ? 20 : 30;
}

export interface RoomLimits {
  readonly maxBots: number;
  /** O pool de zumbis da sim do host (o amigo cria a dele com o mesmo número). */
  readonly maxZombies: number;
  readonly maxViewM: number;
}

/**
 * O teto da sala: o do aparelho do host como host (no celular, 8 bots e 16 zumbis) e, com um celular entre os amigos,
 * o do celular também (GDD §2: "no online vale o menor teto entre os participantes"), para o amigo no celular não
 * desenhar mais bobos do que o aparelho dele aguenta.
 */
export function roomLimits(hostFamily: PlatformFamily, mobileFriend: boolean): RoomLimits {
  const host = selectPlatformProfile(hostFamily, 1);
  const out = { maxBots: host.hostMaxBots, maxZombies: host.hostMaxZombies, maxViewM: host.maxViewDistanceM };
  if (!mobileFriend) return out;
  const phone = PLATFORM_PROFILES.mobile;
  return {
    maxBots: Math.min(out.maxBots, phone.maxBots),
    maxZombies: Math.min(out.maxZombies, phone.maxZombies),
    maxViewM: Math.min(out.maxViewM, phone.maxViewDistanceM),
  };
}

/**
 * A receita dentro do teto da sala: tira bots do lado com mais bobos (humanos e bots), um de cada vez, do fim da lista
 * dele (empate: o lado de trás, o adversário do host), e baixa o alcance de visão. Dentro do teto, devolve a mesma
 * receita (o mesmo objeto).
 */
export function capRoomRecipe(recipe: MatchRecipe, limits: RoomLimits): MatchRecipe {
  const counts = recipe.teams.map((t) => t.bots.map((b) => b.count));
  const humans = recipe.teams.map((t) => (t.humans === 'all' ? 1 : (t.humans ?? 0)));
  const sum = (list: readonly number[]): number => list.reduce((a, b) => a + b, 0);
  let total = counts.reduce((a, list) => a + sum(list), 0);
  let trimmed = false;
  while (total > Math.max(0, limits.maxBots)) {
    let pick = -1;
    let size = -1;
    for (let i = 0; i < counts.length; i++) {
      const bots = sum(counts[i]!);
      if (bots > 0 && humans[i]! + bots >= size) {
        size = humans[i]! + bots;
        pick = i;
      }
    }
    if (pick < 0) break;
    const list = counts[pick]!;
    for (let k = list.length - 1; k >= 0; k--) {
      if (list[k]! > 0) {
        list[k]!--;
        break;
      }
    }
    total--;
    trimmed = true;
  }
  const view = recipe.match?.viewDistanceM;
  const farther = view !== undefined && view > limits.maxViewM;
  if (!trimmed && !farther) return recipe;
  return {
    ...recipe,
    ...(farther ? { match: { ...recipe.match, viewDistanceM: limits.maxViewM } } : {}),
    teams: recipe.teams.map((t, i) => ({
      ...t,
      bots: t.bots.map((b, k) => ({ ...b, count: counts[i]![k]! })).filter((b) => b.count > 0),
    })),
  };
}
