import { MATCH_RECIPE_FORMAT, validateMatchRecipe, type MatchRecipe } from '@boboforces/format';
import { BUTTON, type InputFrame } from '@boboforces/input';
import { BitReader, BitWriter } from '@boboforces/shared';
import { createTestBlocks, createWorldGrid, fillBox, makeCell, type MapSpawn } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { MAP_WEAPONS } from './config/rules.ts';
import { WEAPON_CODE, WEAPON_SLOT, weaponCodeOf, weaponDef, weaponMaskBit } from './config/weapons.ts';
import { SIM_HZ } from './constants.ts';
import { WEAPON_NONE } from './context.ts';
import { ENTITY_FLAG, entityIndex } from './entity.ts';
import { createInputFrames } from './loop.ts';
import { createSim, type Sim, type SimMap } from './sim.ts';
import { mapWeaponsDropPrimary } from './systems/map-weapons.ts';
import { ROYALE_AMMO_BASE } from './systems/royale.ts';
import { PICKUP_KIND, spotWeapon } from './view.ts';

/**
 * M11 (fase 4): as armas no mapa (`weapons.pickups`). Um chão plano de 80 × 80 m, as largadas nos cantos e 3 armas no
 * meio; humanos sem IA (as entradas e as posições são escritas aqui).
 */
const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);
const SPOTS = [
  { x: 30, y: 0.5, z: 40, weapon: 'shotgun' },
  { x: 40, y: 0.5, z: 40, weapon: 'sniper' },
  { x: 50, y: 0.5, z: 40, weapon: 'rocket.grenade-launcher' },
];
const LIMITS = { maxBots: 40, maxLocalHumans: 4, maxViewDistanceM: 140 };

function flatMap(withSpots = true): SimMap {
  const grid = createWorldGrid(160, 16, 160);
  fillBox(grid, 0, 0, 0, 159, 0, 159, concrete);
  const spawns: MapSpawn[] = [
    { x: 5.25, y: 0.5, z: 5.25, yaw: 0, team: 0 },
    { x: 5.25, y: 0.5, z: 8.25, yaw: 0, team: 0 },
    { x: 75.25, y: 0.5, z: 75.25, yaw: 0, team: 1 },
    { x: 75.25, y: 0.5, z: 72.25, yaw: 0, team: 1 },
    { x: 5.25, y: 0.5, z: 75.25, yaw: 0, team: -1 },
    { x: 75.25, y: 0.5, z: 5.25, yaw: 0, team: -1 },
  ];
  return {
    grid,
    blocks,
    spawns,
    playArea: { minX: 0, minZ: 0, maxX: 80, maxZ: 80 },
    ...(withSpots ? { weaponSpots: SPOTS } : {}),
  };
}

function recipe(extra: Partial<MatchRecipe> = {}, pickups = true): MatchRecipe {
  return {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'test',
    seed: 5,
    match: { timeLimitS: 0, scoreLimit: 0 },
    weapons: { pickups },
    teams: [
      { humans: 1, bots: [] },
      { humans: 1, bots: [] },
    ],
    ...extra,
  };
}

const entity = (sim: Sim, c: number): number => entityIndex(sim.controllerEntity(c));
const P = WEAPON_SLOT.primary;

function put(sim: Sim, e: number, x: number, z: number): void {
  const v = sim.view();
  v.position[e * 3] = x;
  v.position[e * 3 + 1] = 0.5;
  v.position[e * 3 + 2] = z;
}

function steps(sim: Sim, f: InputFrame[], n: number): void {
  for (let i = 0; i < n; i++) sim.step(f);
}

/** O pickup do ponto em (x, z) (os pontos ficam a partida toda no mesmo slot do pool). */
function spotAt(sim: Sim, x: number, z: number): number {
  const p = sim.view().pickups;
  for (let i = 0; i < p.count; i++) {
    if (p.alive[i] === 1 && p.position[i * 3] === x && p.position[i * 3 + 2] === z) return i;
  }
  return -1;
}

describe('armas no mapa (M11 fase 4)', () => {
  it('a receita: vale nos modos de loadout livre; sai com a escada, no Infection e nos modos com arma própria', () => {
    const ok = validateMatchRecipe({ ...recipe(), map: 'construto' }, LIMITS);
    if (!ok.ok) throw new Error('receita recusada');
    expect(ok.value.weapons?.pickups).toBe(true);
    expect(ok.warnings).toEqual([]);
    for (const mode of ['warfare.ffa', 'warfare.domination', 'sandbox', 'juggernaut']) {
      const r = validateMatchRecipe({ ...recipe({ mode }), map: 'construto' }, LIMITS);
      if (!r.ok) throw new Error(`receita ${mode} recusada`);
      expect(r.value.weapons?.pickups, mode).toBe(true);
    }
    const drops: Record<string, unknown>[] = [
      { mode: 'zombies' },
      { mode: 'royale.mini' },
      { mode: 'strike' },
      { mode: 'paintball' },
      { mode: 'training' },
      { infection: {} },
      { weapons: { pickups: true, ladder: ['rifle', 'knife'] } },
    ];
    for (const extra of drops) {
      const r = validateMatchRecipe({ ...recipe(), map: 'construto', ...extra }, LIMITS);
      if (!r.ok) throw new Error('receita recusada');
      expect(r.value.weapons?.pickups, JSON.stringify(extra)).toBeUndefined();
      expect(r.warnings.some((w) => w.path === 'weapons.pickups')).toBe(true);
    }
    const bad = validateMatchRecipe({ ...recipe(), map: 'construto', weapons: { pickups: 'sim' } }, LIMITS);
    if (!bad.ok) throw new Error('receita recusada');
    expect(bad.value.weapons?.pickups).toBeUndefined();
  });

  it('a largada sem primária, a arma passando por cima, o ponto vazio e a volta em 20 s', () => {
    const sim = createSim({ recipe: recipe(), map: flatMap(), humans: 2 });
    const v = sim.view();
    const f = createInputFrames();
    const [a, b] = [entity(sim, 0), entity(sim, 1)];
    expect(v.mapWeapons?.spots.map((s) => s.weapon)).toEqual([
      WEAPON_CODE.shotgun,
      WEAPON_CODE.sniper,
      WEAPON_CODE.grenadeLauncher,
    ]);
    expect(v.mapWeapons?.respawnTicks).toBe(MAP_WEAPONS.respawnS * SIM_HZ);
    // Ninguém nasce com a primária: a pistola na mão, a faca e a granada de sempre.
    for (const e of [a, b]) {
      expect(v.loadout[e * 4 + P]).toBe(WEAPON_NONE);
      expect(v.weapon[e]).toBe(WEAPON_CODE.pistol);
      expect(v.loadout[e * 4 + WEAPON_SLOT.melee]).toBe(WEAPON_CODE.knife);
      expect(v.loadout[e * 4 + WEAPON_SLOT.throwable]).toBe(WEAPON_CODE.grenade);
    }
    // As 3 armas já estão no chão no tick 0 (o tipo da arma do Royale; não piscam).
    const shot = spotAt(sim, 30, 40);
    const sniper = spotAt(sim, 40, 40);
    const launcher = spotAt(sim, 50, 40);
    expect([shot, sniper, launcher].every((i) => i >= 0)).toBe(true);
    expect(v.pickups.kind[shot]).toBe(PICKUP_KIND.weaponBase + WEAPON_CODE.shotgun);
    expect(v.pickups.ticksLeft[shot]).toBe(ROYALE_AMMO_BASE);
    steps(sim, f, 30);
    // Caiu até o chão.
    expect(v.pickups.position[shot * 3 + 1]).toBeCloseTo(0.5, 6);

    // Passando por cima com a primária vazia: a arma vai para a mão, com o pente e a reserva cheios.
    put(sim, a, 30, 40);
    sim.step(f);
    const def = weaponDef(WEAPON_CODE.shotgun)!;
    expect(v.loadout[a * 4 + P]).toBe(WEAPON_CODE.shotgun);
    expect(v.weapon[a]).toBe(WEAPON_CODE.shotgun);
    expect(v.slotClip[a * 4 + P]).toBe(def.clipSize);
    expect(v.slotReserve[a * 4 + P]).toBe(def.reserve);
    // O ponto fica vazio (o mesmo pickup), contando a volta.
    expect(spotWeapon(v.pickups.kind[shot]!)).toBe(WEAPON_CODE.shotgun);
    expect(v.pickups.ticksLeft[shot]).toBe(MAP_WEAPONS.respawnS * SIM_HZ);
    // O outro passando pelo ponto vazio não pega nada.
    put(sim, a, 20, 20);
    put(sim, b, 30, 40);
    steps(sim, f, 2);
    expect(v.loadout[b * 4 + P]).toBe(WEAPON_NONE);
    // A arma volta 20 s depois de pega (o ponto conta 1 por tick, a partir do tick seguinte ao da pega).
    put(sim, b, 60, 60);
    steps(sim, f, MAP_WEAPONS.respawnS * SIM_HZ - 3);
    expect(spotWeapon(v.pickups.kind[shot]!)).toBe(WEAPON_CODE.shotgun);
    steps(sim, f, 1);
    expect(v.pickups.kind[shot]).toBe(PICKUP_KIND.weaponBase + WEAPON_CODE.shotgun);
    expect(v.pickups.position[shot * 3]).toBe(30);

    // A mesma arma enche a munição (com tudo cheio, fica no chão para o próximo).
    put(sim, a, 30, 40);
    sim.step(f);
    expect(v.pickups.kind[shot]).toBe(PICKUP_KIND.weaponBase + WEAPON_CODE.shotgun);
    v.slotClip[a * 4 + P] = 1;
    v.slotReserve[a * 4 + P] = 0;
    sim.step(f);
    expect(v.slotClip[a * 4 + P]).toBe(def.clipSize);
    expect(v.slotReserve[a * 4 + P]).toBe(def.reserve);
    expect(spotWeapon(v.pickups.kind[shot]!)).toBe(WEAPON_CODE.shotgun);

    // Outra arma: passando por cima, nada; no usar, troca (a de agora some, sem cair no chão).
    put(sim, a, 40, 40);
    steps(sim, f, 2);
    expect(v.loadout[a * 4 + P]).toBe(WEAPON_CODE.shotgun);
    const alive = (): number => {
      let n = 0;
      for (let i = 0; i < v.pickups.count; i++) if (v.pickups.alive[i] === 1) n++;
      return n;
    };
    const before = alive();
    f[0]!.buttons = BUTTON.use;
    sim.step(f);
    f[0]!.buttons = 0;
    sim.step(f);
    expect(v.loadout[a * 4 + P]).toBe(WEAPON_CODE.sniper);
    expect(v.weapon[a]).toBe(WEAPON_CODE.sniper);
    expect(spotWeapon(v.pickups.kind[sniper]!)).toBe(WEAPON_CODE.sniper);
    expect(alive()).toBe(before);
  });

  it('quem morre renasce sem a primária; o Jugg não pega; a regra de armas do bot e as permitidas valem', () => {
    const sim = createSim({ recipe: recipe(), map: flatMap(), humans: 2 });
    const v = sim.view();
    const f = createInputFrames();
    const a = entity(sim, 0);
    put(sim, a, 40, 40);
    sim.step(f);
    expect(v.loadout[a * 4 + P]).toBe(WEAPON_CODE.sniper);
    // Cai no vazio: renasce sem a primária.
    v.position[a * 3 + 1] = -50;
    for (let t = 0; t < 6 * SIM_HZ && (v.flags[a]! & ENTITY_FLAG.dead) === 0; t++) sim.step(f);
    expect(v.flags[a]! & ENTITY_FLAG.dead).not.toBe(0);
    for (let t = 0; t < 6 * SIM_HZ && (v.flags[a]! & ENTITY_FLAG.dead) !== 0; t++) sim.step(f);
    expect(v.loadout[a * 4 + P]).toBe(WEAPON_NONE);
    expect(v.weapon[a]).toBe(WEAPON_CODE.pistol);

    // Com `weapons.allowed`, só as permitidas: os pontos de outra arma viram a permitida.
    const only = createSim({
      recipe: recipe({ weapons: { pickups: true, allowed: ['shotgun'] } }),
      map: flatMap(),
      humans: 2,
    });
    expect(only.view().mapWeapons?.spots.map((s) => s.weapon)).toEqual([
      WEAPON_CODE.shotgun,
      WEAPON_CODE.shotgun,
      WEAPON_CODE.shotgun,
    ]);
    // Sem primária permitida (só a faca), a regra não vale: o loadout de sempre.
    const knife = createSim({
      recipe: recipe({ weapons: { pickups: true, allowed: ['knife'] } }),
      map: flatMap(),
      humans: 2,
    });
    expect(knife.view().mapWeapons).toBeNull();

    // O Juggernaut: o Jugg (time 1) passa pela arma e não pega.
    const jugg = createSim({
      recipe: recipe({ mode: 'juggernaut', teams: [{ humans: 2, bots: [] }] }),
      map: flatMap(),
      humans: 2,
    });
    const jv = jugg.view();
    const jf = createInputFrames();
    steps(jugg, jf, 2 * SIM_HZ);
    let j = -1;
    for (let e = 0; e < jv.count; e++) if (jv.team[e] === 1) j = e;
    expect(j).toBeGreaterThanOrEqual(0);
    const held = jv.loadout[j * 4 + P];
    put(jugg, j, 30, 40);
    steps(jugg, jf, 2);
    expect(jv.loadout[j * 4 + P]).toBe(held);
    expect(jv.pickups.kind[spotAt(jugg, 30, 40)]).toBe(PICKUP_KIND.weaponBase + WEAPON_CODE.shotgun);
    sim.dispose();
    only.dispose();
    knife.dispose();
    jugg.dispose();
  });

  it('sem a regra ou sem ponto no mapa, o loadout de sempre', () => {
    for (const [r, map] of [
      [recipe({}, false), flatMap()],
      [recipe(), flatMap(false)],
    ] as const) {
      const sim = createSim({ recipe: r, map, humans: 2 });
      const v = sim.view();
      expect(v.mapWeapons).toBeNull();
      expect(v.pickups.count).toBe(0);
      expect(v.loadout[entity(sim, 0) * 4 + P]).toBe(WEAPON_CODE.rifle);
      sim.dispose();
    }
  });

  it('o estado mora no pool de pickups: o snapshot lido de volta segue igual', () => {
    const a = createSim({ recipe: recipe(), map: flatMap(), humans: 2 });
    const f = createInputFrames();
    put(a, entity(a, 0), 30, 40);
    steps(a, f, 10);
    const w = new BitWriter(512 * 1024);
    a.writeSnapshot(w);
    const b = createSim({ recipe: recipe(), map: flatMap(), humans: 2 });
    b.readSnapshot(new BitReader(w.bytes()));
    expect(b.stateHash()).toBe(a.stateHash());
    steps(a, f, 30 * SIM_HZ);
    steps(b, f, 30 * SIM_HZ);
    expect(b.stateHash()).toBe(a.stateHash());
    expect(a.view().pickups.kind[spotAt(a, 30, 40)]).toBe(PICKUP_KIND.weaponBase + WEAPON_CODE.shotgun);
    a.dispose();
    b.dispose();
  });

  it('revisão: ninguém nasce desarmado (a regra de armas sem arma de mão, ou sem arma dos pontos, fica com o loadout)', () => {
    const bit = (id: string): number => weaponMaskBit(weaponCodeOf(id));
    const spotMask = bit('shotgun') | bit('sniper') | bit('rocket.grenade-launcher');
    expect(mapWeaponsDropPrimary(0, spotMask)).toBe(true);
    expect(mapWeaponsDropPrimary(bit('pistol') | bit('sniper'), spotMask)).toBe(true);
    expect(mapWeaponsDropPrimary(bit('knife') | bit('shotgun'), spotMask)).toBe(true);
    // Só primárias (o "Só fuzil", o Camper Carl, o Jorge): ficaria sem arma de mão.
    expect(mapWeaponsDropPrimary(bit('sniper'), spotMask)).toBe(false);
    expect(mapWeaponsDropPrimary(bit('sniper') | bit('grenade'), spotMask)).toBe(false);
    // Nenhuma arma dos pontos que ele possa pegar.
    expect(mapWeaponsDropPrimary(bit('pistol') | bit('lmg'), spotMask)).toBe(false);
    const armed = (sim: Sim): void => {
      const v = sim.view();
      for (let e = 0; e < v.count; e++) {
        if (v.alive[e] === 0) continue;
        expect(weaponDef(v.weapon[e]!), `entidade ${e}`).not.toBeNull();
      }
    };
    const run = (r: MatchRecipe): Sim => {
      const sim = createSim({ recipe: r, map: flatMap(), humans: 2 });
      armed(sim);
      // Morre (no vazio) e renasce: o mesmo loadout.
      const v = sim.view();
      const f = createInputFrames();
      for (let e = 0; e < v.count; e++) v.position[e * 3 + 1] = -50;
      for (let t = 0; t < 8 * SIM_HZ && v.deaths[0] === 0; t++) sim.step(f);
      steps(sim, f, 5 * SIM_HZ);
      armed(sim);
      return sim;
    };
    // As estrelas do Surpreenda-me (só escopeta e só sniper), o Knife Ninja e um bot sem regra.
    const stars = run(
      recipe({
        teams: [
          {
            humans: 1,
            bots: [
              { ref: 'builtin:jorge-the-immortal', count: 1 },
              { ref: 'builtin:camper-carl', count: 1 },
              { ref: 'builtin:knife-ninja', count: 1 },
            ],
          },
          { humans: 1, bots: [{ ref: 'builtin:normal-bob', count: 1 }] },
        ],
      }),
    );
    const sv = stars.view();
    const bot = (k: number): number => entity(stars, 4 + k);
    expect(sv.weapon[bot(0)]).toBe(WEAPON_CODE.shotgun);
    expect(sv.weapon[bot(1)]).toBe(WEAPON_CODE.sniper);
    expect(sv.weapon[bot(2)]).toBe(WEAPON_CODE.knife);
    expect(sv.loadout[bot(3) * 4 + P]).toBe(WEAPON_NONE);
    expect(sv.weapon[bot(3)]).toBe(WEAPON_CODE.pistol);
    stars.dispose();
    // O "Só fuzil" da partida: os pontos viram fuzil e todo mundo nasce com ele.
    const rifle = run(recipe({ weapons: { pickups: true, allowed: ['rifle'] } }));
    expect(rifle.view().weapon[entity(rifle, 0)]).toBe(WEAPON_CODE.rifle);
    rifle.dispose();
    // O "Só X" do time no Sandbox: só a SMG (fica com ela); pistola e sniper (nasce de pistola e pega a sniper);
    // pistola e metralhadora (nenhuma arma dos pontos: fica com a metralhadora).
    const sandbox = run(
      recipe({
        mode: 'sandbox',
        teams: [
          { humans: 1, bots: [], weapons: ['smg'] },
          { humans: 1, bots: [], weapons: ['pistol', 'sniper'] },
          { bots: [{ ref: 'builtin:normal-bob', count: 1 }], weapons: ['pistol', 'lmg'] },
        ],
      }),
    );
    const xv = sandbox.view();
    expect(xv.weapon[entity(sandbox, 0)]).toBe(WEAPON_CODE.smg);
    expect(xv.loadout[entity(sandbox, 1) * 4 + P]).toBe(WEAPON_NONE);
    expect(xv.weapon[entity(sandbox, 1)]).toBe(WEAPON_CODE.pistol);
    expect(xv.weapon[entity(sandbox, 4)]).toBe(WEAPON_CODE.lmg);
    sandbox.dispose();
  });

  it('revisão: na morte súbita (o renascer continua) a troca no usar também vale', () => {
    const sim = createSim({ recipe: recipe({ match: { timeLimitS: 1, scoreLimit: 0 } }), map: flatMap(), humans: 2 });
    const v = sim.view();
    const f = createInputFrames();
    const a = entity(sim, 0);
    put(sim, a, 30, 40);
    for (let t = 0; t < 3 * SIM_HZ && v.match.phase !== 'suddenDeath'; t++) sim.step(f);
    expect(v.match.phase).toBe('suddenDeath');
    expect(v.loadout[a * 4 + P]).toBe(WEAPON_CODE.shotgun);
    put(sim, a, 40, 40);
    f[0]!.buttons = BUTTON.use;
    sim.step(f);
    f[0]!.buttons = 0;
    sim.step(f);
    expect(v.match.phase).toBe('suddenDeath');
    expect(v.loadout[a * 4 + P]).toBe(WEAPON_CODE.sniper);
    sim.dispose();
  });
});
