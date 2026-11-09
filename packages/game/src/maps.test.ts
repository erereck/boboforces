import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEBUT_PRESET, decodeMap } from '@boboforces/format';
import { describe, expect, it } from 'vitest';
import { customRows, stepCustom } from './custom-match.ts';
import { MAP_MODES, mapBotCap, mapForMode, mapsForMode, MENU_MAPS } from './maps.ts';
import { quickFromPreset, quickToPreset, quickValue, stepQuick } from './quick-match.ts';

/** M2, fase 5c: os mapas dos menus (Construto e Ringue) e os modos de cada um. */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('mapas dos menus', () => {
  it('os modos de cada mapa são os do .bfmap compilado', () => {
    for (const id of MENU_MAPS) {
      const bytes = new Uint8Array(readFileSync(join(ROOT, 'assets-src', 'maps', 'generated', `${id}.bfmap`)));
      const map = decodeMap(bytes);
      expect([...map.meta.modes].sort(), id).toEqual([...MAP_MODES[id]].sort());
    }
    expect(mapsForMode('warfare.ffa')).toEqual(['construto']);
    expect(mapForMode('ringue', 'warfare.ffa')).toBe('construto');
    expect(mapBotCap('ringue', 40)).toBe(7);
    expect(mapBotCap('construto', 12)).toBe(12);
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
