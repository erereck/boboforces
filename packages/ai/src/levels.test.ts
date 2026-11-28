import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { buildNavGrid } from '@boboforces/nav';
import { BOBO_NAV_METRICS, ENTITY_FLAG, ENTITY_KIND, SIM_HZ, type SimMap } from '@boboforces/sim';
import { createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { createHeadlessMatch } from './headless.ts';
import { NavLevels, prepareNavLevels, strongComponents } from './levels.ts';

/**
 * M10 (fase 1c): o passeio que sobe. O índice (`NavLevels`) só guarda o grupo principal (o maior componente fortemente
 * conexo) de cada componente, e o soldado às vezes sorteia o lugar alto antes do nó (M11, fase 2: o lugar é um piso
 * plano; era o andar, uma faixa de 3 m): o deque pequeno no alto da escada recebe gente, mesmo ao lado de um mezanino
 * grande, e o topo de onde só se cai (o A* não chega) nunca é sorteado.
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

/** Os lugares do componente `comp` (piso e nós), do mais baixo ao mais alto. */
function placesOf(levels: NavLevels, comp: number): { y: number; nodes: number[] }[] {
  const out: { y: number; nodes: number[] }[] = [];
  for (let k = levels.compStart[comp]!; k < levels.compStart[comp + 1]!; k++) {
    out.push({
      y: levels.floorY[k]!,
      nodes: Array.from(levels.order.subarray(levels.start[k]!, levels.start[k + 1]!)),
    });
  }
  return out;
}

/**
 * M11 (fase 2): o deque da antena da Lua em miniatura. Térreo de 24 × 32 m (piso a 0,5 m), um mezanino de 8 × 8 m a
 * 4,5 m (escada de 2 m de largura) e, do outro lado, um deque de 2 × 3 m a 3,5 m (escada da mesma largura): os dois na
 * mesma faixa de 3 m do índice por andar da fase 1c, onde o deque (8 nós) dividia o sorteio com o mezanino (66).
 */
function deckAndMezzanineMap(): { map: SimMap; deckY: number; mezzanineY: number } {
  const grid = createWorldGrid(48, 24, 64);
  fillBox(grid, 0, 0, 0, 47, 0, 63, concrete);
  // O mezanino (x 4..19, z 40..55) no alto da escada (x 4..7, z 32..39).
  for (let t = 0; t < 8; t++) fillBox(grid, 4, 1, 32 + t, 7, 1 + t, 32 + t, concrete);
  fillBox(grid, 4, 1, 40, 19, 8, 55, concrete);
  // O deque (x 32..35, z 44..49) no alto da escada (x 32..35, z 38..43).
  for (let t = 0; t < 6; t++) fillBox(grid, 32, 1, 38 + t, 35, 1 + t, 38 + t, concrete);
  fillBox(grid, 32, 1, 44, 35, 6, 49, concrete);
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
  return { map, deckY: 3.5, mezzanineY: 4.5 };
}

describe('índice de lugares', () => {
  it('o deque é um lugar do grupo principal; o poleiro (só se cai dele) fica de fora', () => {
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
    // Dois lugares: o térreo e o deque (a escada, degrau de 0,5 m a cada nó, não junta os dois).
    const places = placesOf(levels, comp);
    expect(places.map((p) => p.y)).toEqual([0.5, deckY]);
    expect(places[0]!.nodes).toContain(ground);
    expect(places[1]!.nodes).toContain(deck);
    expect(places[1]!.nodes.length).toBeGreaterThanOrEqual(6);
    expect(Array.from(levels.order)).not.toContain(perch);
  });

  it('o deque pequeno e o mezanino grande na mesma faixa de 3 m são lugares separados', () => {
    const { map, deckY, mezzanineY } = deckAndMezzanineMap();
    const nav = map.nav!;
    const levels = new NavLevels();
    levels.bind(nav);
    const comp = nav.component[nav.nearestNode(6.5, 0.5, 6.5)]!;
    const deck = nav.nearestNode(17, deckY, 23.5);
    const mezzanine = nav.nearestNode(6, mezzanineY, 24);
    expect(nav.floorY[deck]).toBe(deckY);
    expect(nav.floorY[mezzanine]).toBe(mezzanineY);
    const places = placesOf(levels, comp);
    expect(places.map((p) => p.y)).toEqual([0.5, deckY, mezzanineY]);
    expect(places[1]!.nodes).toContain(deck);
    expect(places[2]!.nodes).toContain(mezzanine);
    // O mezanino tem 66 nós e o deque, 8; o sorteio por lugar dá a mesma vez aos dois.
    expect(places[2]!.nodes.length).toBeGreaterThan(places[1]!.nodes.length * 5);
  });

  it('M12 (fase 7b): o índice montado no loading é o mesmo do 1º tick, e a partida com ele também', () => {
    const area = { minX: 1, maxX: 23, minZ: 1, maxZ: 31 };
    const fresh = towerMap().map.nav!;
    const built = new NavLevels();
    built.bind(fresh, area);
    const nav = towerMap().map.nav!;
    expect(prepareNavLevels(nav, area)).toBe(built.count);
    const levels = new NavLevels();
    levels.bind(nav, area);
    expect(levels.count).toBe(built.count);
    expect(Array.from(levels.order)).toEqual(Array.from(built.order));
    expect(Array.from(levels.start)).toEqual(Array.from(built.start));
    expect(Array.from(levels.floorY)).toEqual(Array.from(built.floorY));
    expect(Array.from(levels.compStart)).toEqual(Array.from(built.compStart));
    expect(Array.from(levels.group)).toEqual(Array.from(built.group));
    expect(Array.from(levels.mainGroup)).toEqual(Array.from(built.mainGroup));
    // O 1º tick só copia: os arrays são os do loading (nada montado de novo).
    const again = new NavLevels();
    again.bind(nav, area);
    expect(again.order).toBe(levels.order);
    // Outra área: monta de novo (o índice depende dela).
    const other = new NavLevels();
    other.bind(nav, { minX: 1, maxX: 12, minZ: 1, maxZ: 31 });
    expect(other.order).not.toBe(levels.order);
    // A partida com o índice pronto é a mesma da que monta no 1º tick.
    const recipe: MatchRecipe = {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.tdm',
      map: 'test',
      seed: 5,
      match: { timeLimitS: 0 },
      teams: [
        { bots: [{ ref: builtinBotRef('normal'), count: 2 }] },
        { bots: [{ ref: builtinBotRef('normal'), count: 1 }] },
      ],
    };
    const run = (prepare: boolean): bigint | number => {
      const { map } = towerMap();
      if (prepare) prepareNavLevels(map.nav!, map.playArea ?? null);
      const match = createHeadlessMatch({ recipe, map, humans: 0 });
      match.run(20 * SIM_HZ);
      const h = match.sim.stateHash();
      match.dispose();
      return h;
    };
    expect(run(true)).toBe(run(false));
  }, 60_000);

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

  it('o passeio dos bots sobe ao deque pequeno ao lado do mezanino grande (3 bots, sem inimigo, 2 min)', () => {
    const { map, deckY, mezzanineY } = deckAndMezzanineMap();
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
    let onMezzanine = 0;
    for (let t = 0; t < 120 * SIM_HZ; t++) {
      match.step();
      if (t % 30 !== 0) continue;
      const v = match.sim.view();
      for (let e = 0; e < v.count; e++) {
        if (v.kind[e] !== ENTITY_KIND.bobo || (v.flags[e]! & ENTITY_FLAG.dead) !== 0) continue;
        const y = v.position[e * 3 + 1]!;
        if (Math.abs(y - deckY) < 0.1 && v.position[e * 3]! > 15) onDeck++;
        if (Math.abs(y - mezzanineY) < 0.1 && v.position[e * 3]! < 10) onMezzanine++;
      }
    }
    match.dispose();
    // Amostras de 0,5 s no deque: 8 nesta semente (5 a 25 nas sementes 1 a 8); com o sorteio por andar da fase 1c, 2
    // (2 a 4).
    expect(onDeck).toBeGreaterThanOrEqual(5);
    expect(onMezzanine).toBeGreaterThan(0);
  }, 60_000);
});
