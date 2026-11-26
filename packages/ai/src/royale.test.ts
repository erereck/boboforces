import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { buildNavGrid } from '@boboforces/nav';
import {
  BOBO_NAV_METRICS,
  CIRCLE,
  PICKUP_KIND,
  ROYALE_AMMO_BASE,
  royaleWeaponCode,
  SIM_HZ,
  WEAPON_CODE,
  WEAPON_NONE,
  WEAPON_SLOT,
  ZONE,
  type SimMap,
} from '@boboforces/sim';
import { createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { createHeadlessMatch, type HeadlessMatch } from './headless.ts';
import { itemValue } from './royale.ts';

/**
 * M7 (fase 7): a IA do Bobo Royale num chão plano de 80 × 80 m com navegação: 2 bots Normal em cantos opostos (longe
 * demais para brigar no começo) e pontos de loot espalhados. O teste escreve a zona, a vida e os itens na view.
 */
const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);
const LOOT = [
  { x: 12, y: 0.5, z: 12 },
  { x: 68, y: 0.5, z: 68 },
  { x: 40, y: 0.5, z: 40 },
  { x: 20, y: 0.5, z: 60 },
  { x: 60, y: 0.5, z: 20 },
];

function flatMap(): SimMap {
  const grid = createWorldGrid(160, 16, 160);
  fillBox(grid, 0, 0, 0, 159, 0, 159, concrete);
  return {
    grid,
    blocks,
    spawns: [
      { x: 6.25, y: 0.5, z: 6.25, yaw: 0, team: -1 },
      { x: 74.25, y: 0.5, z: 74.25, yaw: 0, team: -1 },
    ],
    playArea: { minX: 1, minZ: 1, maxX: 79, maxZ: 79 },
    lootSpots: LOOT,
    nav: buildNavGrid({ grid, blocks }, BOBO_NAV_METRICS),
  };
}

const recipe: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'royale.mini',
  map: 'test',
  seed: 11,
  royale: { squad: 'solo' },
  teams: [{ bots: [{ ref: builtinBotRef('normal'), count: 2 }] }],
};

/** Passos com o outro bot (`hold`) preso no canto oposto ao de `e` (longe demais para brigar). */
function steps(m: HeadlessMatch, n: number, hold = -1): void {
  for (let i = 0; i < n; i++) {
    if (hold >= 0) park(m, hold);
    m.step();
  }
}

function park(m: HeadlessMatch, o: number): void {
  const v = m.sim.view();
  v.position[o * 3] = 2;
  v.position[o * 3 + 1] = 0.5;
  v.position[o * 3 + 2] = 78;
}

/** O bobo do controlador de bot `k`. */
function bot(m: HeadlessMatch, k: number): number {
  return m.sim.controllerEntity(4 + k) & 0xffff;
}

/**
 * Troca todo o loot do chão por `kind` (com a munição) em (x, z) no 1º pickup (vivo); o resto vira colete de 50 num canto
 * (o bot, de colete 100, não quer; longe do mapa eles cairiam no vazio e o pool esvaziaria).
 */
function onlyItem(m: HeadlessMatch, kind: number, x: number, z: number, ammo = 0): void {
  const p = m.sim.view().pickups;
  for (let i = 0; i < p.count; i++) {
    p.alive[i] = 1;
    p.kind[i] = i === 0 ? kind : PICKUP_KIND.armor50;
    p.position[i * 3] = i === 0 ? x : 78;
    p.position[i * 3 + 1] = 0.5;
    p.position[i * 3 + 2] = i === 0 ? z : 2;
    p.ticksLeft[i] = ROYALE_AMMO_BASE + ammo;
  }
}

describe('IA do Bobo Royale (M7 fase 7)', () => {
  it('o valor dos itens: a arma melhor, o colete melhor, o kit até o teto', () => {
    const m = createHeadlessMatch({ recipe, map: flatMap(), humans: 0 });
    const v = m.sim.view();
    const e = bot(m, 0);
    const rifle = PICKUP_KIND.weaponBase + WEAPON_CODE.rifle;
    const epic = PICKUP_KIND.weaponBase + royaleWeaponCode(WEAPON_CODE.rifle, 2);
    // Sem primária, qualquer arma vale muito; com o fuzil comum, só o raro ou o épico.
    expect(itemValue(v, e, rifle, 100)).toBeGreaterThan(5);
    v.loadout[e * 4 + WEAPON_SLOT.primary] = WEAPON_CODE.rifle;
    expect(itemValue(v, e, rifle, 100)).toBe(0);
    expect(itemValue(v, e, epic, 100)).toBeGreaterThan(1);
    expect(itemValue(v, e, PICKUP_KIND.armor50, 100)).toBe(2);
    v.armor[e] = 100;
    expect(itemValue(v, e, PICKUP_KIND.armor100, 100)).toBe(0);
    v.heals[e] = 3;
    expect(itemValue(v, e, PICKUP_KIND.heal, 100)).toBe(0);
    m.dispose();
  });

  it('looteia: vai até a arma do chão e pega; com a primária, troca pela melhor no usar', () => {
    const m = createHeadlessMatch({ recipe, map: flatMap(), humans: 0 });
    const v = m.sim.view();
    const e = bot(m, 0);
    const o = bot(m, 1);
    m.step();
    v.armor[e] = 100;
    // A SMG a uns 10 m do bot, para dentro do mapa.
    const sx = v.position[e * 3]! > 40 ? v.position[e * 3]! - 8 : v.position[e * 3]! + 8;
    const sz = v.position[e * 3 + 2]! > 40 ? v.position[e * 3 + 2]! - 6 : v.position[e * 3 + 2]! + 6;
    onlyItem(m, PICKUP_KIND.weaponBase + WEAPON_CODE.smg, sx, sz, 30 + 30 * 1000);
    for (let t = 0; t < 20 * SIM_HZ && v.loadout[e * 4 + WEAPON_SLOT.primary] === WEAPON_NONE; t++) steps(m, 1, o);
    expect(v.loadout[e * 4 + WEAPON_SLOT.primary]).toBe(WEAPON_CODE.smg);
    // O fuzil épico a uns 15 m: ele vai e troca (a SMG fica no chão).
    const epic = royaleWeaponCode(WEAPON_CODE.rifle, 2);
    const x = v.position[e * 3]! > 40 ? v.position[e * 3]! - 12 : v.position[e * 3]! + 12;
    const z = v.position[e * 3 + 2]! > 40 ? v.position[e * 3 + 2]! - 9 : v.position[e * 3 + 2]! + 9;
    onlyItem(m, PICKUP_KIND.weaponBase + epic, x, z, 45 + 45 * 1000);
    for (let t = 0; t < 20 * SIM_HZ && v.loadout[e * 4 + WEAPON_SLOT.primary] !== epic; t++) steps(m, 1, o);
    expect(v.loadout[e * 4 + WEAPON_SLOT.primary]).toBe(epic);
    m.dispose();
  });

  it('a zona: fora do círculo, corre para dentro; machucado e sem inimigo perto, usa o kit', () => {
    const m = createHeadlessMatch({ recipe, map: flatMap(), humans: 0 });
    const v = m.sim.view();
    const ro = v.royale!;
    const e = bot(m, 0);
    const o = bot(m, 1);
    m.step();
    v.armor[e] = 100;
    onlyItem(m, PICKUP_KIND.armor50, 78, 2);
    // A zona à mão: um círculo de 12 m no meio, esperando (o bot está num canto, fora).
    const c = ro.circle;
    for (const k of [CIRCLE.cx, CIRCLE.toCx, CIRCLE.fromCx, CIRCLE.cz, CIRCLE.toCz, CIRCLE.fromCz]) c[k] = 40;
    for (const k of [CIRCLE.r, CIRCLE.toR, CIRCLE.fromR]) c[k] = 12;
    ro.data[ZONE.ticks] = 1_000_000;
    const inside = (): boolean => Math.hypot(v.position[e * 3]! - 40, v.position[e * 3 + 2]! - 40) < 12;
    expect(inside()).toBe(false);
    for (let t = 0; t < 20 * SIM_HZ && !inside(); t++) steps(m, 1, o);
    expect(inside()).toBe(true);
    // Machucado, com 2 kits e ninguém perto: cura (60 por kit, 3 s cada) até passar da linha da cura.
    v.health[e] = 30;
    v.heals[e] = 2;
    steps(m, 8 * SIM_HZ, o);
    expect(v.health[e]).toBeGreaterThanOrEqual(90);
    expect(v.heals[e]).toBeLessThan(2);
    m.dispose();
  });

  it('M11 (fase 5): no Royale Grande, vai para o círculo novo 40 s antes de encolher (no Mini, 20 s)', () => {
    /**
     * Dentro do círculo de agora, fora do próximo (no canto oposto), com um colete a 24 m ao longo da borda e `waitS`
     * até o encolher: em 2 s, o bot já saiu na diagonal, para a zona nova (e não pela borda, para o colete)?
     */
    const leaves = (mode: string, waitS: number): boolean => {
      const m = createHeadlessMatch({ recipe: { ...recipe, mode }, map: flatMap(), humans: 0 });
      const v = m.sim.view();
      const ro = v.royale!;
      const e = bot(m, 0);
      const o = bot(m, 1);
      m.step();
      v.armor[e] = 0;
      const bx = v.position[e * 3]!;
      const bz = v.position[e * 3 + 2]!;
      const low = bx < 40;
      onlyItem(m, PICKUP_KIND.armor100, bx, low ? bz + 24 : bz - 24);
      // O círculo de agora cobre tudo; o próximo, de 8 m, no ponto de loot do canto oposto ao do bot.
      const c = ro.circle;
      for (const k of [CIRCLE.cx, CIRCLE.cz, CIRCLE.fromCx, CIRCLE.fromCz]) c[k] = 40;
      for (const k of [CIRCLE.r, CIRCLE.fromR]) c[k] = 200;
      for (const k of [CIRCLE.toCx, CIRCLE.toCz]) c[k] = low ? 68 : 12;
      c[CIRCLE.toR] = 8;
      for (let t = 0; t < 2 * SIM_HZ; t++) {
        ro.data[ZONE.ticks] = waitS * SIM_HZ;
        steps(m, 1, o);
      }
      const across = Math.abs(v.position[e * 3]! - bx);
      m.dispose();
      return across > 3;
    };
    expect(leaves('royale.grande', 30)).toBe(true);
    expect(leaves('royale.mini', 30)).toBe(false);
    expect(leaves('royale.mini', 15)).toBe(true);
  });
});
