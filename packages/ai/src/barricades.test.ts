import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { buildNavGrid } from '@boboforces/nav';
import {
  BOBO_NAV_METRICS,
  ENTITY_FLAG,
  ENTITY_KIND,
  SIM_HZ,
  ZOMBIE_BARRICADES,
  type BarricadeDef,
  type SimEvent,
  type SimMap,
} from '@boboforces/sim';
import { cellCenter, createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { createHeadlessMatch } from './headless.ts';

/**
 * M3 (fase 3d): a IA com janelas com barricada. Muro de 3 m em z = 15..15,5 m com um vão de 1 m em x = 10..11 m (a
 * janela, de fora para o norte). Dentro (sul) ficam os bobos; os zumbis nascem fora.
 */
const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);
const WINDOW: BarricadeDef = { x: 10.5, y: 0.5, z: 15.25, outside: 2, width: 1 };

function walled(): SimMap {
  const grid = createWorldGrid(40, 16, 60);
  fillBox(grid, 0, 0, 0, 39, 0, 59, concrete);
  fillBox(grid, 0, 1, 30, 19, 6, 30, concrete);
  fillBox(grid, 22, 1, 30, 39, 6, 30, concrete);
  return {
    grid,
    blocks,
    spawns: [
      { x: cellCenter(8), y: 0.5, z: 6, yaw: 0, team: 0 },
      { x: cellCenter(30), y: 0.5, z: 26, yaw: Math.PI, team: -1 },
    ],
    nav: buildNavGrid({ grid, blocks }, BOBO_NAV_METRICS),
    barricades: [WINDOW],
  };
}

function recipe(bots: number, humans: number): MatchRecipe {
  return {
    format: MATCH_RECIPE_FORMAT,
    mode: 'zombies',
    map: 'test',
    seed: 11,
    teams: [
      {
        ...(humans > 0 ? { humans: 'all' as const } : {}),
        bots: bots > 0 ? [{ ref: builtinBotRef('normal'), count: bots }] : [],
      },
    ],
  };
}

describe('IA com janelas com barricada (M3, fase 3d)', () => {
  it('os zumbis vão pela janela, arrancam as tábuas, entram e pegam o humano parado', () => {
    let tears = 0;
    let downed = false;
    const match = createHeadlessMatch({
      recipe: recipe(0, 1),
      map: walled(),
      humans: 1,
      zombies: 3,
      onEvents: (events: readonly SimEvent[]) => {
        for (const ev of events) {
          if (ev.type === 'barricade' && ev.action === 'tear') tears++;
          if (ev.type === 'down' && ev.action === 'down') downed = true;
        }
      },
    });
    const v = match.sim.view();
    let inside = false;
    for (let t = 0; t < 45 * SIM_HZ && !downed; t++) {
      match.step();
      for (let e = 0; e < v.count; e++) {
        if (v.kind[e] !== ENTITY_KIND.zombie || (v.flags[e]! & ENTITY_FLAG.dead) !== 0) continue;
        if (v.position[e * 3 + 2]! < 14.5) inside = true;
      }
    }
    expect(tears).toBe(ZOMBIE_BARRICADES.planks);
    expect(inside).toBe(true);
    expect(downed).toBe(true);
    match.dispose();
  }, 60_000);

  it('o bot de apoio vai até a janela quebrada e repõe as tábuas', () => {
    const map = walled();
    let repairs = 0;
    const match = createHeadlessMatch({
      recipe: recipe(1, 0),
      map,
      humans: 0,
      zombies: 1,
      onEvents: (events: readonly SimEvent[]) => {
        for (const ev of events) if (ev.type === 'barricade' && ev.action === 'repair') repairs++;
      },
    });
    const v = match.sim.view();
    // Teste: começa sem tábua nenhuma (o zumbi da onda 1 nasce longe e demora a chegar).
    (v.mapObjects!.planks as Uint8Array)[0] = 0;
    // Antes da 1ª onda (5 s) e logo depois: chega em ~3 s e repõe 1 por segundo (depois para para atirar no zumbi
    // que aparece na janela; com o pool de 1 renascendo, a onda inteira).
    for (let t = 0; t < 7 * SIM_HZ; t++) match.step();
    expect(repairs).toBeGreaterThanOrEqual(3);
    expect(v.mapObjects!.planks[0]).toBe(repairs);
    match.dispose();
  }, 60_000);
});
