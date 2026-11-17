import { builtinBotRef, presetBotCounts, validateMatchRecipe, type MatchRecipe } from '@boboforces/format';
import { ONLINE_MATCH_CARDS } from '@boboforces/ui';
import { describe, expect, it } from 'vitest';
import { MAP_MODES, type MenuMap } from './maps.ts';
import { onlineRecipe } from './online-api.ts';
import {
  capRoomRecipe,
  hostSnapshotHz,
  ROOM_MODES,
  roomLimits,
  roomPreset,
  type RoomPresetMode,
} from './online-presets.ts';
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

describe('o teto da sala (M5 fase 6b)', () => {
  it('host no celular: 8 bots, 16 zumbis e snapshots a 20 Hz; no PC, 40 e 60 a 30 Hz; um amigo no celular baixa o PC', () => {
    expect(roomLimits('mobile', false)).toEqual({ maxBots: 8, maxZombies: 16, maxViewM: 90 });
    expect(roomLimits('pc', false)).toEqual({ maxBots: 40, maxZombies: 60, maxViewM: 140 });
    expect(roomLimits('pc', true)).toEqual({ maxBots: 12, maxZombies: 24, maxViewM: 90 });
    // O host no celular já é o menor.
    expect(roomLimits('mobile', true)).toEqual({ maxBots: 8, maxZombies: 16, maxViewM: 90 });
    expect([hostSnapshotHz(true), hostSnapshotHz(false)]).toEqual([20, 30]);
  });

  it('corta do lado com mais bobos, um de cada vez (empate: o adversário), e baixa o alcance de visão', () => {
    const normal = builtinBotRef('normal');
    const six: MatchRecipe = {
      ...roomPreset('warfare.tdm'),
      match: { timeLimitS: 300, viewDistanceM: 140 },
      teams: [
        { humans: 'all', bots: [{ ref: normal, count: 5 }] },
        {
          bots: [
            { ref: normal, count: 3 },
            { ref: builtinBotRef('tryhard'), count: 3 },
          ],
        },
      ],
    };
    const phone = capRoomRecipe(six, roomLimits('mobile', false));
    // 6 contra 6 (11 bots) vira 4 contra 4 (7 bots, dentro dos 8, e o lado do adversário perde o 8º).
    expect(presetBotCounts(phone)).toEqual([4, 4]);
    expect(phone.teams[1]!.bots).toEqual([
      { ref: normal, count: 3 },
      { ref: builtinBotRef('tryhard'), count: 1 },
    ]);
    expect(phone.match?.viewDistanceM).toBe(90);
    // Os bots que acabam somem da lista (3 bots: você e 1 contra 2); dentro do teto, o mesmo objeto.
    const three = capRoomRecipe(six, { maxBots: 3, maxZombies: 16, maxViewM: 140 });
    expect(three.teams[1]!.bots).toEqual([{ ref: normal, count: 2 }]);
    expect(presetBotCounts(three)).toEqual([1, 2]);
    const tdm = roomPreset('warfare.tdm');
    expect(capRoomRecipe(tdm, roomLimits('mobile', false))).toBe(tdm);
    // O FFA de 8 bobos tem 7 bots: cabe no celular.
    expect(presetBotCounts(capRoomRecipe(roomPreset('warfare.ffa'), roomLimits('mobile', false)))).toEqual([7]);
  });
});
