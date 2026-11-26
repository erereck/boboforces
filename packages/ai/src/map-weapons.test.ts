import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { buildNavGrid } from '@boboforces/nav';
import {
  BOBO_NAV_METRICS,
  PICKUP_KIND,
  SIM_HZ,
  spotWeapon,
  WEAPON_CODE,
  WEAPON_NONE,
  WEAPON_SLOT,
  type SimMap,
} from '@boboforces/sim';
import { createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { createHeadlessMatch, type HeadlessMatch } from './headless.ts';

/**
 * M11 (fase 4): a IA das armas no mapa num chão plano de 80 × 80 m com navegação: um bot em cada canto (o do time 1
 * preso no canto dele, longe demais para brigar) e armas espalhadas.
 */
const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);

function flatMap(spots: readonly { x: number; z: number; weapon: string }[]): SimMap {
  const grid = createWorldGrid(160, 16, 160);
  fillBox(grid, 0, 0, 0, 159, 0, 159, concrete);
  return {
    grid,
    blocks,
    spawns: [
      { x: 6.25, y: 0.5, z: 6.25, yaw: 0, team: 0 },
      { x: 74.25, y: 0.5, z: 74.25, yaw: 0, team: 1 },
    ],
    playArea: { minX: 1, minZ: 1, maxX: 79, maxZ: 79 },
    weaponSpots: spots.map((s) => ({ x: s.x, y: 0.5, z: s.z, weapon: s.weapon })),
    nav: buildNavGrid({ grid, blocks }, BOBO_NAV_METRICS),
  };
}

const recipe: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'warfare.tdm',
  map: 'test',
  seed: 21,
  match: { timeLimitS: 0, scoreLimit: 0 },
  weapons: { pickups: true },
  teams: [
    { bots: [{ ref: builtinBotRef('normal'), count: 1 }] },
    { bots: [{ ref: builtinBotRef('normal'), count: 1 }] },
  ],
};

/** O bobo do controlador de bot `k`. */
function bot(m: HeadlessMatch, k: number): number {
  return m.sim.controllerEntity(4 + k) & 0xffff;
}

/** Passos com o bot `hold` preso no canto dele (longe demais para brigar). */
function steps(m: HeadlessMatch, n: number, hold: number): void {
  const v = m.sim.view();
  for (let i = 0; i < n; i++) {
    v.position[hold * 3] = 78;
    v.position[hold * 3 + 1] = 0.5;
    v.position[hold * 3 + 2] = 78;
    m.step();
  }
}

/** O pickup do ponto em (x, z). */
function spotAt(m: HeadlessMatch, x: number, z: number): number {
  const p = m.sim.view().pickups;
  for (let i = 0; i < p.count; i++) if (p.position[i * 3] === x && p.position[i * 3 + 2] === z) return i;
  return -1;
}

describe('IA das armas no mapa (M11 fase 4)', () => {
  it('só com a pistola, vai à arma mais perto e pega; sem munição, enche na mesma arma', () => {
    const m = createHeadlessMatch({
      recipe,
      map: flatMap([
        { x: 16, z: 14, weapon: 'smg' },
        { x: 40, z: 40, weapon: 'rocket' },
        { x: 64, z: 66, weapon: 'smg' },
      ]),
      humans: 0,
    });
    const v = m.sim.view();
    const e = bot(m, 0);
    const o = bot(m, 1);
    expect(v.loadout[e * 4 + WEAPON_SLOT.primary]).toBe(WEAPON_NONE);
    // A SMG a ~13 m vale mais que o foguete a ~48 m (a nota cai com a distância).
    for (let t = 0; t < 20 * SIM_HZ && v.loadout[e * 4 + WEAPON_SLOT.primary] === WEAPON_NONE; t++) steps(m, 1, o);
    expect(v.loadout[e * 4 + WEAPON_SLOT.primary]).toBe(WEAPON_CODE.smg);
    const smg = spotAt(m, 16, 14);
    expect(spotWeapon(v.pickups.kind[smg]!)).toBe(WEAPON_CODE.smg);
    // Sem munição e com a SMG de volta no ponto: vai e enche passando por cima.
    v.pickups.ticksLeft[smg] = 1;
    steps(m, 2, o);
    expect(v.pickups.kind[smg]).toBe(PICKUP_KIND.weaponBase + WEAPON_CODE.smg);
    v.slotClip[e * 4 + WEAPON_SLOT.primary] = 0;
    v.slotReserve[e * 4 + WEAPON_SLOT.primary] = 0;
    for (let t = 0; t < 20 * SIM_HZ && v.slotReserve[e * 4 + WEAPON_SLOT.primary] === 0; t++) steps(m, 1, o);
    expect(v.slotReserve[e * 4 + WEAPON_SLOT.primary]).toBeGreaterThan(0);
    m.dispose();
  });

  it('a arma some no caminho (outro pegou): ele não fica no ponto vazio e vai à seguinte', () => {
    const m = createHeadlessMatch({
      recipe,
      map: flatMap([
        { x: 22, z: 20, weapon: 'shotgun' },
        { x: 40, z: 44, weapon: 'rifle' },
      ]),
      humans: 0,
    });
    const v = m.sim.view();
    const e = bot(m, 0);
    const o = bot(m, 1);
    const near = spotAt(m, 22, 20);
    // Indo para a escopeta: quando chega perto, ela vira o ponto vazio (com a volta bem longe).
    for (let t = 0; t < 20 * SIM_HZ; t++) {
      steps(m, 1, o);
      if (Math.hypot(v.position[e * 3]! - 22, v.position[e * 3 + 2]! - 20) < 4) break;
    }
    expect(v.loadout[e * 4 + WEAPON_SLOT.primary]).toBe(WEAPON_NONE);
    v.pickups.kind[near] = PICKUP_KIND.spotBase + WEAPON_CODE.shotgun;
    v.pickups.ticksLeft[near] = 1_000_000;
    for (let t = 0; t < 25 * SIM_HZ && v.loadout[e * 4 + WEAPON_SLOT.primary] === WEAPON_NONE; t++) steps(m, 1, o);
    expect(v.loadout[e * 4 + WEAPON_SLOT.primary]).toBe(WEAPON_CODE.rifle);
    m.dispose();
  });

  it('com a regra do bot (só faca), não corre atrás das armas', () => {
    const knife: MatchRecipe = {
      ...recipe,
      teams: [
        { bots: [{ ref: 'builtin:knife-ninja', count: 1 }] },
        { bots: [{ ref: builtinBotRef('normal'), count: 1 }] },
      ],
    };
    const m = createHeadlessMatch({ recipe: knife, map: flatMap([{ x: 14, z: 12, weapon: 'smg' }]), humans: 0 });
    const v = m.sim.view();
    const e = bot(m, 0);
    const o = bot(m, 1);
    expect(v.weaponMask[e]).not.toBe(0);
    steps(m, 10 * SIM_HZ, o);
    expect(v.loadout[e * 4 + WEAPON_SLOT.primary]).toBe(WEAPON_NONE);
    expect(v.pickups.kind[spotAt(m, 14, 12)]).toBe(PICKUP_KIND.weaponBase + WEAPON_CODE.smg);
    m.dispose();
  });

  it('revisão: na morte súbita (o renascer continua) ele também vai buscar a arma', () => {
    const sudden: MatchRecipe = { ...recipe, match: { timeLimitS: 1, scoreLimit: 0 } };
    const m = createHeadlessMatch({ recipe: sudden, map: flatMap([{ x: 26, z: 24, weapon: 'smg' }]), humans: 0 });
    const v = m.sim.view();
    const e = bot(m, 0);
    const o = bot(m, 1);
    // O empate no fim do relógio (1 s) abre a morte súbita; o bot ainda está longe da arma.
    for (let t = 0; t < 3 * SIM_HZ && v.match.phase !== 'suddenDeath'; t++) steps(m, 1, o);
    expect(v.match.phase).toBe('suddenDeath');
    expect(v.loadout[e * 4 + WEAPON_SLOT.primary]).toBe(WEAPON_NONE);
    for (let t = 0; t < 30 * SIM_HZ && v.loadout[e * 4 + WEAPON_SLOT.primary] === WEAPON_NONE; t++) steps(m, 1, o);
    expect(v.match.phase).toBe('suddenDeath');
    expect(v.loadout[e * 4 + WEAPON_SLOT.primary]).toBe(WEAPON_CODE.smg);
    m.dispose();
  });
});
