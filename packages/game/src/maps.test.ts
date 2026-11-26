import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEBUT_PRESET, decodeMap } from '@boboforces/format';
import { describe, expect, it } from 'vitest';
import { customRows, stepCustom } from './custom-match.ts';
import { MAP_MODES, mapBotCap, mapForMode, mapGravity, mapsForMode, MENU_MAPS } from './maps.ts';
import { quickFromPreset, quickToPreset, quickValue, stepQuick } from './quick-match.ts';

/** M2, fase 5c: os mapas dos menus (Construto e Ringue) e os modos de cada um. */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('mapas dos menus', () => {
  it('os modos de cada mapa são os do .bfmap compilado', () => {
    for (const id of MENU_MAPS) {
      const bytes = new Uint8Array(readFileSync(join(ROOT, 'assets-src', 'maps', 'generated', `${id}.bfmap`)));
      const map = decodeMap(bytes);
      expect([...map.meta.modes].sort(), id).toEqual([...MAP_MODES[id]].sort());
      // M10 (fase 4, revisão): a gravidade de série também.
      expect(map.meta.gravity ?? 1, id).toBe(mapGravity(id));
    }
    expect(mapsForMode('warfare.ffa')).toEqual(['construto', 'construction', 'port', 'moonbase']);
    expect(mapsForMode('royale.mini')).toEqual(['island']);
    expect(mapForMode('ringue', 'warfare.ffa')).toBe('construto');
    expect(mapBotCap('ringue', 40)).toBe(7);
    expect(mapBotCap('airbase', 40)).toBe(9);
    expect(mapBotCap('construto', 12)).toBe(12);
  });

  it('M10 (fase 4, revisão): na Estação Lunar a Partida personalizada mostra a gravidade que vale, a Lua ligada e o Arcade desligado', () => {
    const value = (tab: 'mods' | 'players', r: typeof DEBUT_PRESET, id: string): string =>
      customRows(tab, r)
        .find((x) => x.id === id)!
        .value(r);
    const moon = { ...DEBUT_PRESET, map: 'moonbase' };
    expect(value('mods', moon, 'gravity')).toBe('×1 (×0,35)');
    expect(value('mods', { ...moon, players: { gravity: 0.5 } }, 'gravity')).toBe('×0,5 (×0,25)');
    expect(value('mods', DEBUT_PRESET, 'gravity')).toBe('×1');
    const arcade = { ...moon, modifiers: ['arcade' as const] };
    expect(value('mods', arcade, 'arcade')).toBe(value('mods', DEBUT_PRESET, 'arcade'));
    expect(value('mods', moon, 'lowGravity')).not.toBe(value('mods', DEBUT_PRESET, 'lowGravity'));
    expect(value('players', arcade, 'movement')).toBe(value('players', DEBUT_PRESET, 'movement'));
  });

  it('a Ilha Tropical (M7, fases 5 e 6): 200 m, pontos de loot e as largadas sem time', () => {
    const map = decodeMap(new Uint8Array(readFileSync(join(ROOT, 'assets-src', 'maps', 'generated', 'island.bfmap'))));
    expect(map.grid.sizeX / 2).toBe(200);
    expect(map.grid.sizeZ / 2).toBe(200);
    expect(map.markers.lootSpots!.length).toBeGreaterThanOrEqual(24);
    expect(map.markers.spawns.length).toBeGreaterThanOrEqual(30);
    expect(map.markers.spawns.every((sp) => sp.team === -1)).toBe(true);
  });

  it('Partida Rápida: o Ringue só no TDM, até 4 contra 4; trocar para FFA volta ao Construto', () => {
    let q = quickFromPreset(DEBUT_PRESET, 40);
    q = stepQuick(q, 'map', 1, 40);
    expect(q.map).toBe('ringue');
    expect(quickValue(q, 'map')).toBe('Ringue');
    for (let i = 0; i < 10; i++) q = stepQuick(q, 'size', 1, 40);
    expect(q.size).toBe(4);
    expect(quickToPreset(q).map).toBe('ringue');
    const ffa = stepQuick(q, 'mode', 1, 40);
    expect(ffa.map).toBe('construto');
  });

  it('Partida personalizada: o mapa anda pelos do modo e corta os bots no teto do Ringue', () => {
    const limits = { maxBots: 40, maxViewM: 140 };
    let r = DEBUT_PRESET;
    for (let i = 0; i < 6; i++) r = stepCustom('bots', r, 'count1', 1, limits);
    r = stepCustom('match', r, 'map', 1, limits);
    expect(r.map).toBe('ringue');
    const value = customRows('match', r)
      .find((x) => x.id === 'map')!
      .value(r);
    expect(value).toBe('Ringue');
    const total = r.teams.reduce((n, tm) => n + tm.bots.reduce((m, b) => m + b.count, 0), 0);
    expect(total).toBeLessThanOrEqual(7);
    expect(stepCustom('match', r, 'mode', 1, limits).map).toBe('construto');
  });
});
