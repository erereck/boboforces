import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { buildNavGrid } from '@boboforces/nav';
import { BOBO_NAV_METRICS, ENTITY_FLAG, ENTITY_KIND, SIM_HZ, type SimMap } from '@boboforces/sim';
import { createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { createHeadlessMatch } from './headless.ts';
import { NavLevels, strongComponents } from './levels.ts';

/**
 * M10 (fase 1c): o passeio que sobe. O índice de andares (`NavLevels`) só guarda o grupo principal (o maior componente
 * fortemente conexo) de cada componente, e o soldado às vezes sorteia o andar antes do nó: o deque pequeno no alto da
 * escada recebe gente, e o topo de onde só se cai (o A* não chega) nunca é sorteado.
 */

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);

describe('componentes fortemente conexos', () => {
  it('a queda é de mão única: quem cai não volta', () => {
    // 0 ↔ 1 → 2 ↔ 3 (1 → 2 é a queda) e 4 sozinho.
    const linkStart = Int32Array.from([0, 1, 3, 4, 5, 5]);
    const linkTarget = Int32Array.from([1, 0, 2, 3, 2]);
    const out = new Int32Array(5);
    expect(strongComponents(5, linkStart, linkTarget, out)).toBe(3);
    expect(out[0]).toBe(out[1]);
    expect(out[2]).toBe(out[3]);
    expect(out[0]).not.toBe(out[2]);
    expect(out[4]).not.toBe(out[0]);
    expect(out[4]).not.toBe(out[2]);
  });
});

/**
 * Térreo de 24 × 32 m (piso a 0,5 m) com um deque de 2 × 3 m a 4,5 m no alto de um lance reto de escada e, encostado no
 * deque, um bloco cujo topo fica 2,5 m acima dele: dali se cai no deque (mesmo componente da navegação), mas não se sobe.
 */
function towerMap(): { map: SimMap; deckY: number; perchY: number } {
  const grid = createWorldGrid(48, 24, 64);
  fillBox(grid, 0, 0, 0, 47, 0, 63, concrete);
  // Escada de cubos em +Z (x 20..23, z 30..37) e o deque (x 20..23, z 38..43) no topo dela.
  for (let t = 0; t < 8; t++) fillBox(grid, 20, 1, 30 + t, 23, 1 + t, 30 + t, concrete);
  fillBox(grid, 20, 1, 38, 23, 8, 43, concrete);
  // O poleiro: x 24..27, z 38..43, topo 2,5 m acima do deque.
  fillBox(grid, 24, 1, 38, 27, 13, 43, concrete);
  const map: SimMap = {
    grid,
    blocks,
    spawns: [
      { x: 6.5, y: 0.5, z: 6.5, yaw: Math.PI, team: 0 },
      { x: 17.5, y: 0.5, z: 6.5, yaw: Math.PI, team: 0 },
      { x: 6.5, y: 0.5, z: 26.5, yaw: 0, team: 1 },
    ],
    nav: buildNavGrid({ grid, blocks }, BOBO_NAV_METRICS),
  };
  return { map, deckY: 4.5, perchY: 7 };
}

describe('índice de andares', () => {
  it('o deque entra no andar 1 do grupo principal; o poleiro (só se cai dele) fica de fora', () => {
    const { map, deckY, perchY } = towerMap();
    const nav = map.nav!;
    const levels = new NavLevels();
    levels.bind(nav);
    const ground = nav.nearestNode(6.5, 0.5, 6.5);
    const deck = nav.nearestNode(11, deckY, 20.5);
    const perch = nav.nearestNode(13, perchY, 20.5);
    expect(nav.floorY[deck]).toBe(deckY);
    expect(nav.floorY[perch]).toBe(perchY);
    // O poleiro é do mesmo componente (a queda conta nos dois sentidos), mas de outro grupo.
    expect(nav.component[perch]).toBe(nav.component[ground]);
    const comp = nav.component[ground]!;
    expect(levels.group[ground]).toBe(levels.mainGroup[comp]);
    expect(levels.group[deck]).toBe(levels.mainGroup[comp]);
    expect(levels.group[perch]).not.toBe(levels.mainGroup[comp]);
    expect(levels.baseY).toBe(0.5);
    expect(levels.levelOf(deckY)).toBe(1);
    const bucket = comp * levels.count + 1;
    const inLevel1 = Array.from(levels.order.subarray(levels.start[bucket]!, levels.start[bucket + 1]!));
    expect(inLevel1).toContain(deck);
    expect(inLevel1).not.toContain(perch);
    expect(Array.from(levels.order)).not.toContain(perch);
  });

  it('o passeio dos bots sobe ao deque pequeno (3 bots, sem inimigo, 2 min) e nunca vai ao poleiro', () => {
    const { map, deckY, perchY } = towerMap();
    const recipe: MatchRecipe = {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.tdm',
      map: 'test',
      seed: 3,
      match: { timeLimitS: 0 },
      teams: [{ bots: [{ ref: builtinBotRef('normal'), count: 3 }] }, { bots: [] }],
    };
    const match = createHeadlessMatch({ recipe, map, humans: 0 });
    let onDeck = 0;
    let onPerch = 0;
    for (let t = 0; t < 120 * SIM_HZ; t++) {
      match.step();
      if (t % 30 !== 0) continue;
      const v = match.sim.view();
      for (let e = 0; e < v.count; e++) {
        if (v.kind[e] !== ENTITY_KIND.bobo || (v.flags[e]! & ENTITY_FLAG.dead) !== 0) continue;
        const y = v.position[e * 3 + 1]!;
        if (Math.abs(y - deckY) < 0.1) onDeck++;
        if (Math.abs(y - perchY) < 0.1) onPerch++;
      }
    }
    match.dispose();
    // Amostras de 0,5 s com alguém no deque: 17 nesta semente; sem o passeio que sobe (`upperChance` 0), 1.
    expect(onDeck).toBeGreaterThanOrEqual(8);
    expect(onPerch).toBe(0);
  }, 60_000);
});
