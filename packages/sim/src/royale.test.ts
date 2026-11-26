import { builtinBotRef, MATCH_RECIPE_FORMAT, validateMatchRecipe, type MatchRecipe } from '@boboforces/format';
import { BUTTON, type InputFrame } from '@boboforces/input';
import { BitReader, BitWriter } from '@boboforces/shared';
import { createTestBlocks, createWorldGrid, fillBox, makeCell, type MapSpawn } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { royaleWeaponCode, WEAPON_CODE, WEAPON_SLOT, weaponBase, weaponDef, weaponRarity } from './config/weapons.ts';
import { SIM_HZ } from './constants.ts';
import { WEAPON_NONE } from './context.ts';
import { ENTITY_FLAG, entityIndex } from './entity.ts';
import { createInputFrames } from './loop.ts';
import { createSim, type Sim, type SimMap } from './sim.ts';
import { CIRCLE, ROYALE, ROYALE_AMMO_BASE, ROYALE_UNDECIDED, ZONE } from './systems/royale.ts';
import { PICKUP_KIND } from './view.ts';

/**
 * M7 (fase 6): o Bobo Royale Mini na sim. Um chão plano de 80 × 120 m com 4 largadas sem time nos cantos e 6 pontos de
 * loot no meio; humanos sem IA (as entradas, as posições e alguns itens são escritos aqui).
 */
const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);
const LOOT = [
  { x: 30, y: 0.5, z: 40 },
  { x: 50, y: 0.5, z: 40 },
  { x: 30, y: 0.5, z: 60 },
  { x: 50, y: 0.5, z: 60 },
  { x: 30, y: 0.5, z: 80 },
  { x: 50, y: 0.5, z: 80 },
];

function flatMap(): SimMap {
  const grid = createWorldGrid(160, 16, 240);
  fillBox(grid, 0, 0, 0, 159, 0, 239, concrete);
  const spawns: MapSpawn[] = [
    { x: 10.25, y: 0.5, z: 10.25, yaw: 0, team: -1 },
    { x: 70.25, y: 0.5, z: 10.25, yaw: 0, team: -1 },
    { x: 10.25, y: 0.5, z: 110.25, yaw: 0, team: -1 },
    { x: 70.25, y: 0.5, z: 110.25, yaw: 0, team: -1 },
  ];
  return { grid, blocks, spawns, playArea: { minX: 0, minZ: 0, maxX: 80, maxZ: 120 }, lootSpots: LOOT };
}

const recipe = (squad: 'solo' | 'duo', seed = 3): MatchRecipe => ({
  format: MATCH_RECIPE_FORMAT,
  mode: 'royale.mini',
  map: 'test',
  seed,
  royale: { squad },
  teams: [{ humans: 'all', bots: [] }],
});

const entity = (sim: Sim, c: number): number => entityIndex(sim.controllerEntity(c));
const DEAD = ENTITY_FLAG.dead;
const DOWNED = ENTITY_FLAG.downed;

function put(sim: Sim, e: number, x: number, z: number): void {
  const v = sim.view();
  v.position[e * 3] = x;
  v.position[e * 3 + 1] = 0.5;
  v.position[e * 3 + 2] = z;
}

function steps(sim: Sim, f: InputFrame[], n: number): void {
  for (let i = 0; i < n; i++) sim.step(f);
}

/** Escreve o item `kind` (com a munição da arma) no pickup `i`, em (x, z). */
function setItem(sim: Sim, i: number, kind: number, x: number, z: number, ammo = 0): void {
  const p = sim.view().pickups;
  p.kind[i] = kind;
  p.position[i * 3] = x;
  p.position[i * 3 + 1] = 0.5;
  p.position[i * 3 + 2] = z;
  p.ticksLeft[i] = ROYALE_AMMO_BASE + ammo;
}

/** Os pickups vivos de um tipo. */
function count(sim: Sim, kind: number): number {
  const p = sim.view().pickups;
  let n = 0;
  for (let i = 0; i < p.count; i++) if (p.alive[i] === 1 && p.kind[i] === kind) n++;
  return n;
}

/** Leva `e` para fora da zona e espera ele cair ou morrer (o dano da zona é lento: a vida vai a quase nada antes). */
function finishInZone(sim: Sim, f: InputFrame[], e: number): void {
  const v = sim.view();
  v.health[e] = 0.01;
  put(sim, e, 0.5, 0.5);
  const c = v.royale!.circle;
  // Fora do círculo de agora (o canto da área fica fora até da zona inicial? então a zona já encolheu ou o raio cobre):
  // o teste encolhe a zona à mão para o meio.
  c[CIRCLE.r] = Math.min(c[CIRCLE.r]!, 20);
  c[CIRCLE.cx] = 40;
  c[CIRCLE.cz] = 60;
  // A zona fere em pulsos de 0,5 s: até 1 s para o golpe chegar.
  for (let t = 0; t < SIM_HZ && (v.flags[e]! & (DEAD | DOWNED)) === 0; t++) sim.step(f);
}

describe('Bobo Royale na sim (M7 fase 6)', () => {
  it('a receita: solo, duplas e quartetos', () => {
    const limits = { maxBots: 40, maxLocalHumans: 4, maxViewDistanceM: 140 };
    const ok = validateMatchRecipe({ ...recipe('duo'), map: 'island' }, limits);
    if (!ok.ok) throw new Error('receita do Royale recusada');
    expect(ok.value.royale).toEqual({ squad: 'duo' });
    const bad = validateMatchRecipe({ ...recipe('duo'), map: 'island', royale: { squad: 'trio' } }, limits);
    if (!bad.ok) throw new Error('receita do Royale recusada');
    expect(bad.value.royale).toEqual({});
    expect(bad.warnings.some((w) => w.path === 'royale.squad')).toBe(true);
  });

  it('as raridades: o pente e o recuo melhoram, o dano não', () => {
    for (const base of [WEAPON_CODE.smg, WEAPON_CODE.shotgun, WEAPON_CODE.rifle, WEAPON_CODE.sniper]) {
      const common = weaponDef(base)!;
      expect(royaleWeaponCode(base, 0)).toBe(base);
      for (const rarity of [1, 2]) {
        const code = royaleWeaponCode(base, rarity);
        const def = weaponDef(code)!;
        expect(def.code).toBe(code);
        expect(weaponRarity(code)).toBe(rarity);
        expect(weaponBase(code)).toBe(base);
        expect(def.damage).toBe(common.damage);
        expect(def.clipSize).toBeGreaterThan(common.clipSize);
        expect(def.recoilKickDeg).toBeLessThan(common.recoilKickDeg);
        expect(def.grip).toBe(common.grip);
      }
    }
    // A pistola não tem raridade.
    expect(royaleWeaponCode(WEAPON_CODE.pistol, 2)).toBe(WEAPON_CODE.pistol);
  });

  it('solo: a largada, o loot, a troca de arma, o colete, a cura, a zona e o último vivo', () => {
    const sim = createSim({ recipe: recipe('solo'), map: flatMap(), humans: 4 });
    const v = sim.view();
    const ro = v.royale!;
    const f = createInputFrames();
    const [a, b, c, d] = [0, 1, 2, 3].map((k) => entity(sim, k)) as [number, number, number, number];
    // Cada um no seu esquadrão, em cantos diferentes, só com a pistola.
    expect([a, b, c, d].map((e) => v.team[e])).toEqual([0, 1, 2, 3]);
    expect(new Set([a, b, c, d].map((e) => `${v.position[e * 3]},${v.position[e * 3 + 2]}`)).size).toBe(4);
    for (const e of [a, b, c, d]) {
      expect(v.loadout[e * 4 + WEAPON_SLOT.primary]).toBe(WEAPON_NONE);
      expect(v.weapon[e]).toBe(WEAPON_CODE.pistol);
      expect(v.slotReserve[e * 4 + WEAPON_SLOT.secondary]).toBe(
        weaponDef(WEAPON_CODE.pistol)!.clipSize * ROYALE.startPistolClips,
      );
    }
    // O loot: um ou dois itens por ponto; a zona esperando a 1ª fase, cobrindo a área.
    expect(v.pickups.count).toBeGreaterThanOrEqual(LOOT.length);
    expect(v.pickups.count).toBeLessThanOrEqual(LOOT.length * 2);
    expect(ro.squads).toBe(4);
    expect(ro.data[ZONE.stage]).toBe(0);
    expect(ro.data[ZONE.ticks]).toBe(ROYALE.zone[0]!.waitS * SIM_HZ);
    expect(ro.circle[CIRCLE.r]).toBeCloseTo(Math.hypot(80, 120) / 2, 6);
    sim.step(f);

    // A arma do chão: com a primária vazia, pega sozinho (e a mão vai nela, com o pente guardado no item).
    const rare = royaleWeaponCode(WEAPON_CODE.rifle, 1);
    const epic = royaleWeaponCode(WEAPON_CODE.smg, 2);
    setItem(sim, 0, PICKUP_KIND.weaponBase + rare, 20, 20, 7 + 30 * 1000);
    setItem(sim, 1, PICKUP_KIND.weaponBase + epic, 24, 20, 12 + 5 * 1000);
    setItem(sim, 2, PICKUP_KIND.armor100, 28, 20);
    setItem(sim, 3, PICKUP_KIND.heal, 32, 20);
    put(sim, a, 20, 20);
    sim.step(f);
    expect(v.loadout[a * 4 + WEAPON_SLOT.primary]).toBe(rare);
    expect(v.weapon[a]).toBe(rare);
    expect(v.slotClip[a * 4 + WEAPON_SLOT.primary]).toBe(7);
    expect(v.slotReserve[a * 4 + WEAPON_SLOT.primary]).toBe(30);
    // Com a primária ocupada, passar por cima não pega; apertar o usar troca (a de agora fica no chão).
    put(sim, a, 24, 20);
    steps(sim, f, 2);
    expect(v.loadout[a * 4 + WEAPON_SLOT.primary]).toBe(rare);
    const before = count(sim, PICKUP_KIND.weaponBase + rare);
    f[0]!.buttons = BUTTON.use;
    sim.step(f);
    f[0]!.buttons = 0;
    sim.step(f);
    expect(v.loadout[a * 4 + WEAPON_SLOT.primary]).toBe(epic);
    expect(v.slotClip[a * 4 + WEAPON_SLOT.primary]).toBe(12);
    expect(count(sim, PICKUP_KIND.weaponBase + rare)).toBe(before + 1);
    expect(count(sim, PICKUP_KIND.weaponBase + epic)).toBe(0);
    // O colete de 100 e o kit de cura pegam sozinhos.
    put(sim, a, 28, 20);
    sim.step(f);
    expect(v.armor[a]).toBe(100);
    put(sim, a, 32, 20);
    sim.step(f);
    expect(v.heals[a]).toBe(1);
    // A cura: segurar o usar 3 s (longe de arma e de aliado caído) cura 60 e gasta o kit.
    put(sim, a, 40, 60);
    v.health[a] = 30;
    f[0]!.buttons = BUTTON.use;
    steps(sim, f, ROYALE.healUseS * SIM_HZ - 2);
    expect(v.health[a]).toBe(30);
    expect(v.healTicks[a]).toBeGreaterThan(0);
    steps(sim, f, 3);
    f[0]!.buttons = 0;
    expect(v.health[a]).toBe(90);
    expect(v.heals[a]).toBe(0);

    // A zona: depois da espera, encolhe até o círculo da fase (num mapa pequeno o raio não cresce) e fere quem está
    // fora (2 HP/s na 1ª fase; o colete não segura).
    steps(sim, f, ro.data[ZONE.ticks]! + 1);
    expect(ro.data[ZONE.shrinking]).toBe(1);
    const shrink = ro.data[ZONE.ticks]!;
    steps(sim, f, shrink);
    expect(ro.data[ZONE.stage]).toBe(1);
    expect(ro.data[ZONE.shrinking]).toBe(0);
    expect(ro.circle[CIRCLE.r]).toBeLessThanOrEqual(Math.hypot(80, 120) / 2);
    // Neste mapa o círculo ainda cobre quase tudo: o teste o aperta à mão (a fase 1 só espera) e põe o b fora.
    ro.circle[CIRCLE.cx] = 40;
    ro.circle[CIRCLE.cz] = 60;
    ro.circle[CIRCLE.r] = 20;
    put(sim, b, 40, 100);
    const hp = v.health[b]!;
    steps(sim, f, SIM_HZ);
    expect(hp - v.health[b]!).toBeCloseTo(ROYALE.zone[1]!.dps, 0);

    // Morre o b (sem respawn): deixa a pistola? Não: só a primária, o colete e os kits. A colocação dele é a 4ª.
    finishInZone(sim, f, b);
    expect(v.flags[b]! & DEAD).not.toBe(0);
    sim.step(f);
    expect(ro.data[ZONE.squadsAlive]).toBe(3);
    expect(ro.place[1]).toBe(4);
    steps(sim, f, 10 * SIM_HZ);
    expect(v.flags[b]! & DEAD).not.toBe(0);

    // Snapshot no meio: a zona, a colocação e os campos dos bobos vão junto (e o hash).
    const copy = createSim({ recipe: recipe('solo'), map: flatMap(), humans: 4 });
    const w = new BitWriter(512 * 1024);
    sim.writeSnapshot(w);
    copy.readSnapshot(new BitReader(w.bytes()));
    expect(copy.stateHash()).toEqual(sim.stateHash());
    steps(sim, f, 30);
    steps(copy, f, 30);
    expect(copy.stateHash()).toEqual(sim.stateHash());
    copy.dispose();

    // Os outros dois caem: o a é o último vivo e vence (no solo, o vencedor também é o bobo).
    finishInZone(sim, f, c);
    finishInZone(sim, f, d);
    steps(sim, f, 2);
    expect(ro.data[ZONE.winner]).toBe(0);
    expect(ro.place[0]).toBe(1);
    expect(v.match.phase).toBe('ended');
    expect(v.match.winnerTeam).toBe(0);
    expect(v.match.winnerEntity).toBe(sim.controllerEntity(0));
    sim.dispose();
  });

  it('duplas: o caído, o reviver, o tiro no caído e o esquadrão que cai inteiro', () => {
    const sim = createSim({ recipe: recipe('duo', 5), map: flatMap(), humans: 4 });
    const v = sim.view();
    const ro = v.royale!;
    const f = createInputFrames();
    const [a, b, c, d] = [0, 1, 2, 3].map((k) => entity(sim, k)) as [number, number, number, number];
    expect([a, b, c, d].map((e) => v.team[e])).toEqual([0, 0, 1, 1]);
    // A dupla nasce junto.
    expect(v.position[a * 3]).toBe(v.position[b * 3]);
    expect(v.position[a * 3 + 2]).toBe(v.position[b * 3 + 2]);
    expect(ro.squads).toBe(2);
    sim.step(f);

    // O a cai (o b está de pé): caído com a vida de caído; o b segura o usar do lado 3 s e levanta ele.
    finishInZone(sim, f, a);
    expect(v.flags[a]! & DOWNED).not.toBe(0);
    expect(v.flags[a]! & DEAD).toBe(0);
    expect(v.health[a]).toBe(ROYALE.downHp);
    put(sim, a, 40, 60);
    put(sim, b, 40.5, 60);
    f[1]!.buttons = BUTTON.use;
    steps(sim, f, 3 * SIM_HZ + 2);
    f[1]!.buttons = 0;
    expect(v.flags[a]! & DOWNED).toBe(0);
    expect(v.health[a]).toBeGreaterThan(0);

    // O caído toma dano: a zona tira a vida de caído e ele morre (o esquadrão continua vivo com o b).
    finishInZone(sim, f, a);
    expect(v.flags[a]! & DOWNED).not.toBe(0);
    v.health[a] = 0.01;
    steps(sim, f, SIM_HZ);
    expect(v.flags[a]! & DEAD).not.toBe(0);
    expect(ro.data[ZONE.squadsAlive]).toBe(2);

    // Na outra dupla, o c cai e depois o d morre: sem ninguém de pé para levantar o c, a dupla sai no mesmo tick (o c
    // sangraria no começo do seguinte) e a dupla 0 vence.
    finishInZone(sim, f, c);
    expect(v.flags[c]! & DOWNED).not.toBe(0);
    put(sim, c, 40, 60);
    finishInZone(sim, f, d);
    expect(v.flags[d]! & DEAD).not.toBe(0);
    expect(ro.data[ZONE.winner]).toBe(0);
    expect(ro.place[1]).toBe(2);
    expect(v.match.phase).toBe('ended');
    expect(v.match.winnerTeam).toBe(0);
    sim.dispose();
  });

  it('revisão: o caído que sangra no snapshot (3 duplas) e a granada cozinhando não deixa pegar arma', () => {
    // 4 humanos e 2 bots parados (sem IA): 3 duplas.
    const recipe3: MatchRecipe = {
      ...recipe('duo', 7),
      teams: [{ humans: 'all', bots: [{ ref: builtinBotRef('normal'), count: 2 }] }],
    };
    const sim = createSim({ recipe: recipe3, map: flatMap(), humans: 4 });
    const v = sim.view();
    const ro = v.royale!;
    const f = createInputFrames();
    const [a1, a2] = [entity(sim, 0), entity(sim, 1)];
    sim.step(f);
    // O a1 cai; o a2 morre: o a1 sangra no começo do tick seguinte (antes do dano), e a cópia tirada agora segue igual.
    finishInZone(sim, f, a1);
    put(sim, a1, 40, 60);
    finishInZone(sim, f, a2);
    expect(v.flags[a2]! & DEAD).not.toBe(0);
    expect(ro.place[0]).toBe(3);
    const copy = createSim({ recipe: recipe3, map: flatMap(), humans: 4 });
    const w = new BitWriter(512 * 1024);
    sim.writeSnapshot(w);
    copy.readSnapshot(new BitReader(w.bytes()));
    steps(sim, f, 5);
    steps(copy, f, 5);
    expect(v.flags[a1]! & DEAD).not.toBe(0);
    expect(copy.view().flags[a1]! & DEAD).not.toBe(0);
    expect(copy.stateHash()).toEqual(sim.stateHash());
    copy.dispose();

    // A granada cozinhando: passar por cima de uma arma não pega (a mão fica na granada até lançar).
    const b1 = entity(sim, 2);
    const k = b1 * 4 + WEAPON_SLOT.throwable;
    v.slotClip[k] = 1;
    put(sim, b1, 20, 100);
    f[2]!.weapon = WEAPON_SLOT.throwable;
    steps(sim, f, 30);
    f[2]!.buttons = BUTTON.fire;
    steps(sim, f, 5);
    expect(v.cookTicks[b1]).toBeGreaterThanOrEqual(0);
    setItem(sim, 0, PICKUP_KIND.weaponBase + WEAPON_CODE.rifle, 20, 100, 30 + 30 * 1000);
    sim.step(f);
    expect(v.loadout[b1 * 4 + WEAPON_SLOT.primary]).toBe(WEAPON_NONE);
    // Solta: a granada sai, e aí ele pega a arma.
    f[2]!.buttons = 0;
    f[2]!.weapon = WEAPON_SLOT.secondary;
    steps(sim, f, 30);
    expect(v.loadout[b1 * 4 + WEAPON_SLOT.primary]).toBe(WEAPON_CODE.rifle);
    sim.dispose();
  });

  it('a zona inteira: 5 fases até fechar (~8 min); o empate quando ninguém sobra', () => {
    const sim = createSim({ recipe: recipe('solo', 9), map: flatMap(), humans: 2 });
    const v = sim.view();
    const ro = v.royale!;
    const f = createInputFrames();
    const a = entity(sim, 0);
    const b = entity(sim, 1);
    let total = 0;
    for (const z of ROYALE.zone) total += z.waitS + z.shrinkS;
    expect(total).toBeGreaterThan(7 * 60);
    expect(total).toBeLessThan(10 * 60);
    // Os dois no meio do círculo final, com vida de sobra para a zona não acabar com eles antes do fim.
    const radii: number[] = [];
    for (let t = 0; t < (total + 1) * SIM_HZ && ro.data[ZONE.stage]! < ROYALE.zone.length; t++) {
      v.health[a] = 100;
      v.health[b] = 100;
      put(sim, a, ro.circle[CIRCLE.toCx]!, ro.circle[CIRCLE.toCz]!);
      put(sim, b, ro.circle[CIRCLE.toCx]!, ro.circle[CIRCLE.toCz]!);
      const before = ro.data[ZONE.stage]!;
      sim.step(f);
      if (ro.data[ZONE.stage] !== before) radii.push(ro.circle[CIRCLE.r]!);
    }
    expect(radii.length).toBe(ROYALE.zone.length);
    expect(radii[radii.length - 1]).toBe(0);
    for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeLessThanOrEqual(radii[i - 1]!);
    expect(ro.data[ZONE.winner]).toBe(ROYALE_UNDECIDED);
    // Fechada: 40 HP/s em todo mundo; os dois morrem no mesmo tick: empate.
    for (let t = 0; t < 5 * SIM_HZ && v.match.phase !== 'ended'; t++) sim.step(f);
    expect(v.flags[a]! & DEAD).not.toBe(0);
    expect(v.flags[b]! & DEAD).not.toBe(0);
    expect(ro.data[ZONE.winner]).toBe(-1);
    expect(v.match.winnerTeam).toBe(-1);
    sim.dispose();
  });

  it('M11 (fase 5): o Royale Grande tem a zona dele (6 fases, ~12 min) e acaba com um vencedor', () => {
    const grande: MatchRecipe = { ...recipe('solo', 5), mode: 'royale.grande' };
    const sim = createSim({ recipe: grande, map: flatMap(), humans: 2 });
    const v = sim.view();
    const ro = v.royale!;
    expect(ro.zone).toBe(ROYALE.zoneGrande);
    expect(ro.zone.length).toBe(6);
    let total = 0;
    for (const z of ROYALE.zoneGrande) total += z.waitS + z.shrinkS;
    expect(total).toBeGreaterThanOrEqual(12 * 60);
    expect(total).toBeLessThanOrEqual(15 * 60);
    expect(ro.data[ZONE.ticks]).toBe(ROYALE.zoneGrande[0]!.waitS * SIM_HZ);
    // Sem tempo nem meta (como o Mini): quem acaba é o último esquadrão.
    expect(v.match.ticksLeft).toBe(-1);
    const f = createInputFrames();
    const a = entity(sim, 0);
    const b = entity(sim, 1);
    // O 1 fica no meio do próximo círculo; o 0 fica de fora e a zona o derruba: o 1 vence.
    let stages = 0;
    for (let t = 0; t < (total + 10) * SIM_HZ && v.match.phase !== 'ended'; t++) {
      v.health[b] = 100;
      put(sim, b, ro.circle[CIRCLE.toCx]!, ro.circle[CIRCLE.toCz]!);
      put(sim, a, 1, 1);
      const before = ro.data[ZONE.stage]!;
      sim.step(f);
      if (ro.data[ZONE.stage] !== before) stages++;
    }
    expect(v.match.phase).toBe('ended');
    expect(v.flags[a]! & DEAD).not.toBe(0);
    expect(v.flags[b]! & DEAD).toBe(0);
    expect(ro.data[ZONE.winner]).toBe(v.team[b]);
    expect(v.match.winnerTeam).toBe(v.team[b]);
    expect(stages).toBeGreaterThan(0);
    sim.dispose();
  });

  it('determinístico: a mesma semente, o mesmo loot e o mesmo hash', () => {
    const run = (): string => {
      const sim = createSim({ recipe: recipe('solo', 21), map: flatMap(), humans: 4 });
      const f = createInputFrames();
      steps(sim, f, 600);
      const p = sim.view().pickups;
      const kinds = Array.from(p.kind.subarray(0, p.count)).join(',');
      const out = `${kinds}|${sim.stateHash()}`;
      sim.dispose();
      return out;
    };
    expect(run()).toBe(run());
  });
});
