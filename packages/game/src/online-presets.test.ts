import { presetBotCounts, validateMatchRecipe } from '@boboforces/format';
import { ONLINE_MATCH_CARDS } from '@boboforces/ui';
import { describe, expect, it } from 'vitest';
import { MAP_MODES, type MenuMap } from './maps.ts';
import { onlineRecipe } from './online-api.ts';
import { ROOM_MODES, roomPreset, type RoomPresetMode } from './online-presets.ts';
import { STORAGE_RECIPE_LIMITS } from './save-store.ts';

const PRESETS: readonly RoomPresetMode[] = ['warfare.tdm', 'warfare.ffa', 'x1', 'zombies'];

describe('as partidas da sala (M5 fase 6a)', () => {
  it('os cards da tela são os modos da sala, na mesma ordem', () => {
    expect(ONLINE_MATCH_CARDS.map((c) => c.id)).toEqual([...ROOM_MODES]);
  });

  it('cada preset passa no validador e o mapa dele tem o modo', () => {
    for (const mode of PRESETS) {
      const r = roomPreset(mode);
      const v = validateMatchRecipe(r, STORAGE_RECIPE_LIMITS);
      expect(v.ok, mode).toBe(true);
      expect(MAP_MODES[r.map as MenuMap], mode).toContain(r.mode);
    }
  });

  it('os amigos tomam o lugar dos bots: X1 de 2 sem bot, Zombies de 4 sem apoio, Times de 4 com 2 bots por lado', () => {
    const x1 = onlineRecipe(roomPreset('x1'), [-1, -1]);
    expect(presetBotCounts(x1.recipe)).toEqual([0, 0]);
    expect(x1.recipe.teams.map((t) => t.humans)).toEqual([1, 1]);
    // Com 4, vira 2 contra 2 (os do mesmo lado ficam juntos).
    const x1Four = onlineRecipe(roomPreset('x1'), [0, 1, -1, -1]);
    expect(x1Four.recipe.teams.map((t) => t.humans)).toEqual([2, 2]);
    expect(presetBotCounts(x1Four.recipe)).toEqual([0, 0]);
    const zombies = onlineRecipe(roomPreset('zombies'), [-1, 1, 0, -1]);
    expect(zombies.recipe.teams.map((t) => t.humans)).toEqual([4]);
    expect(presetBotCounts(zombies.recipe)).toEqual([0]);
    const tdm = onlineRecipe(roomPreset('warfare.tdm'), [0, 1, 0, 1]);
    expect(presetBotCounts(tdm.recipe)).toEqual([2, 2]);
    const ffa = onlineRecipe(roomPreset('warfare.ffa'), [-1, -1, -1]);
    expect(presetBotCounts(ffa.recipe)).toEqual([5]);
  });
});
