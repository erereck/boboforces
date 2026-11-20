import { isKnownContentId, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, WEAPON_SLOT_COUNT, type InputFrame } from '@boboforces/input';
import { pitchToI16, yawToU16 } from '@boboforces/shared';
import { cellCenter, createTestBlocks, createWorldGrid, fillBox, makeCell, type MapSpawn } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { BASE_HP, METRICS } from './config/metrics.ts';
import {
  ARSENAL,
  firstAllowedPrimary,
  isPrimaryWeapon,
  loadoutSecondary,
  WEAPON_AUTO_SHOTGUN,
  WEAPON_CODE,
  WEAPON_CROSSBOW,
  WEAPON_DESMONTADOR,
  WEAPON_DMR,
  WEAPON_FIRE,
  WEAPON_GRENADE_LAUNCHER,
  WEAPON_M10_FIRST,
  WEAPON_REVOLVER,
  WEAPON_SLOT,
  weaponCodeOf,
  weaponDamageAt,
  weaponDef,
  weaponMaskBit,
  WEAPONS,
  WEAPONS_M10,
  type WeaponDef,
} from './config/weapons.ts';
import { SIM_HZ } from './constants.ts';
import { WEAPON_NONE } from './context.ts';
import { entityIndex } from './entity.ts';
import type { SimEvent } from './events.ts';
import { aimPointWorld, type AimPoint } from './hitbox.ts';
import { createInputFrames } from './loop.ts';
import { createSim, type Sim, type SimMap } from './sim.ts';
import { ROUND, ROUND_PHASE } from './systems/rounds.ts';
import { STRIKE_BUY_BASE, STRIKE_SHOP } from './systems/strike.ts';
import { heldClip } from './view.ts';

/**
 * M10 (fases 6 e 7): as 5 armas novas (GDD §4.3.3). A tabela confere os códigos, as máscaras e os números de projeto
 * (tiros para matar e TTK); a sim confere o DMR semiautomático com queda, o revólver como a secundária escolhida pelas
 * armas permitidas (AK5), a escopeta automática, o virote da besta (arco, parte acertada, cravado no bloco) e a granada
 * do lança-granadas (arco, explode no contato com corpo ou bloco, autodano).
 */

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);
const FLOOR = 0.5;
const PAST_PROTECTION = Math.round(1.6 * SIM_HZ);

type Build = (grid: ReturnType<typeof createWorldGrid>) => void;

function recipe(weapons?: MatchRecipe['weapons']): MatchRecipe {
  return {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'test',
    seed: 17,
    teams: [
      { humans: 1, bots: [] },
      { humans: 1, bots: [] },
    ],
    ...(weapons ? { weapons } : {}),
  };
}

/** O 0 em `z0` olhando para -Z e o 1 em `z1` (< z0) olhando para +Z, num chão de 20 × 60 m. */
function duel(
  z0: number,
  z1: number,
  primary: number,
  weapons?: MatchRecipe['weapons'],
  build?: Build,
): { sim: Sim; f: InputFrame[] } {
  const grid = createWorldGrid(40, 16, 120);
  fillBox(grid, 0, 0, 0, 39, 0, 119, concrete);
  build?.(grid);
  const spawns: MapSpawn[] = [
    { x: cellCenter(20), y: FLOOR, z: z0, yaw: 0, team: 0 },
    { x: cellCenter(20), y: FLOOR, z: z1, yaw: Math.PI, team: 1 },
  ];
  const map: SimMap = { grid, blocks, spawns };
  const sim = createSim({ recipe: recipe(weapons), map, humans: 2, primaries: [primary] });
  return { sim, f: createInputFrames() };
}

function run(sim: Sim, f: InputFrame[], ticks: number, onEvents?: (events: SimEvent[]) => void): void {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step(f);
    events.length = 0;
    sim.drainEvents(events);
    onEvents?.(events);
  }
}

const entity = (sim: Sim, c: number): number => entityIndex(sim.controllerEntity(c));

function pointOf(sim: Sim, c: number, head = false): AimPoint {
  const p: AimPoint = { x: 0, y: 0, z: 0 };
  aimPointWorld(sim.view(), entity(sim, c), head, p);
  return p;
}

/**
 * Aponta `c` para (x, y, z) a partir do olho em pé; com `def` de projétil com gravidade, sobe a mira pelo arco baixo
 * (a mesma conta da IA, `throwPitch`).
 */
function aimAt(sim: Sim, f: InputFrame, c: number, x: number, y: number, z: number, def?: WeaponDef): void {
  const v = sim.view();
  const e = entity(sim, c);
  const dx = x - v.position[e * 3]!;
  const dy = y - (v.position[e * 3 + 1]! + METRICS.eyeHeight);
  const dz = z - v.position[e * 3 + 2]!;
  const d = Math.hypot(dx, dz);
  let pitch = Math.atan2(dy, d);
  if (def !== undefined && def.projectileGravity > 0) {
    const v2 = def.projectileSpeed * def.projectileSpeed;
    const g = def.projectileGravity;
    pitch = Math.atan((v2 - Math.sqrt(v2 * v2 - g * (g * d * d + 2 * dy * v2))) / (g * d));
  }
  f.yaw = yawToU16(Math.atan2(-dx, -dz));
  f.pitch = pitchToI16(pitch);
}

interface Tally {
  hits: { target: number; damage: number; part: string }[];
  explosions: { tick: number; x: number; y: number; z: number }[];
  sticks: { x: number; y: number; z: number; vx: number; vy: number; vz: number }[];
  launches: number;
  shots: number;
  kills: number;
  reloads: number;
}

function tally(): Tally {
  return { hits: [], explosions: [], sticks: [], launches: 0, shots: 0, kills: 0, reloads: 0 };
}

function collect(t: Tally, shooter?: number): (events: SimEvent[]) => void {
  return (events) => {
    for (const ev of events) {
      if (ev.type === 'hit') t.hits.push({ target: ev.target, damage: ev.damage, part: ev.part });
      if (ev.type === 'explosion') t.explosions.push({ tick: ev.tick, x: ev.x, y: ev.y, z: ev.z });
      if (ev.type === 'projectile' && ev.action === 'launch') t.launches++;
      if (ev.type === 'projectile' && ev.action === 'stick') t.sticks.push(ev);
      if (ev.type === 'shot' && (shooter === undefined || ev.shooter === shooter)) t.shots++;
      if (ev.type === 'kill') t.kills++;
      if (ev.type === 'weapon' && ev.action === 'reloadStart') t.reloads++;
    }
  };
}

const shots = (dmg: number): number => Math.ceil(BASE_HP / dmg);

describe('M10: a tabela das armas novas', () => {
  it('códigos 27 a 31, ids conhecidos com a categoria do fallback, slots; as máscaras de antes não mudam', () => {
    expect(WEAPONS_M10.map((w) => w.code)).toEqual([
      WEAPON_CODE.dmr,
      WEAPON_CODE.revolver,
      WEAPON_CODE.autoShotgun,
      WEAPON_CODE.crossbow,
      WEAPON_CODE.grenadeLauncher,
    ]);
    WEAPONS_M10.forEach((w, i) => {
      expect(w.code).toBe(WEAPON_M10_FIRST + i);
      expect(weaponDef(w.code)).toBe(w);
      expect(weaponCodeOf(w.id)).toBe(w.code);
      expect(isKnownContentId(`weapon:${w.id}`), w.id).toBe(true);
      // O prefixo antes do `.` é uma arma do M2 do mesmo slot (o fallback de uma versão que não conhece a nova).
      const base = WEAPONS.find((x) => x.id === w.id.slice(0, w.id.indexOf('.')));
      expect(base?.slot, w.id).toBe(w.slot);
    });
    // As do M2 no bit do próprio código (as máscaras gravadas e os goldens não mudam); as novas nos bits 9 a 13.
    for (const w of WEAPONS) expect(weaponMaskBit(w.code)).toBe(1 << w.code);
    expect(WEAPONS_M10.map((w) => weaponMaskBit(w.code))).toEqual([1 << 9, 1 << 10, 1 << 11, 1 << 12, 1 << 13]);
    expect(ARSENAL.length).toBeLessThanOrEqual(16);
    expect(weaponMaskBit(WEAPON_DESMONTADOR)).toBe(0);
    expect(weaponMaskBit(WEAPON_NONE)).toBe(0);
    expect(WEAPON_REVOLVER.slot).toBe(WEAPON_SLOT.secondary);
    for (const w of [WEAPON_DMR, WEAPON_AUTO_SHOTGUN, WEAPON_CROSSBOW, WEAPON_GRENADE_LAUNCHER])
      expect(isPrimaryWeapon(w.code), w.id).toBe(true);
    expect(isPrimaryWeapon(WEAPON_CODE.revolver)).toBe(false);
    expect(isPrimaryWeapon(WEAPON_DESMONTADOR)).toBe(false);
    // A secundária pela lista (AK5) e a 1ª primária liberada na ordem do arsenal.
    expect(loadoutSecondary(0)).toBe(WEAPON_CODE.pistol);
    expect(loadoutSecondary(weaponMaskBit(WEAPON_CODE.pistol))).toBe(WEAPON_CODE.pistol);
    expect(loadoutSecondary(weaponMaskBit(WEAPON_CODE.revolver))).toBe(WEAPON_CODE.revolver);
    expect(firstAllowedPrimary(weaponMaskBit(WEAPON_CODE.crossbow) | weaponMaskBit(WEAPON_CODE.sniper))).toBe(
      WEAPON_CODE.sniper,
    );
    expect(firstAllowedPrimary(weaponMaskBit(WEAPON_CODE.dmr) | weaponMaskBit(WEAPON_CODE.revolver))).toBe(
      WEAPON_CODE.dmr,
    );
    expect(firstAllowedPrimary(weaponMaskBit(WEAPON_CODE.revolver))).toBe(-1);
  });

  it('tiros para matar (corpo / cabeça) e TTK sem errar, na faixa da classe (GDD §4.3)', () => {
    const ttk = (w: WeaponDef, dmg: number): number => ((shots(dmg) - 1) * 60) / w.rpm;
    // DMR: 3 no corpo a qualquer distância (até os 34 do fim da queda), 2 na cabeça.
    expect([shots(WEAPON_DMR.damage), shots(WEAPON_DMR.damage * WEAPON_DMR.headMultiplier)]).toEqual([3, 2]);
    expect(shots(weaponDamageAt(WEAPON_DMR, 120))).toBe(3);
    expect(ttk(WEAPON_DMR, WEAPON_DMR.damage)).toBeCloseTo(0.4, 5);
    expect(ttk(WEAPON_DMR, WEAPON_DMR.damage * WEAPON_DMR.headMultiplier)).toBeCloseTo(0.2, 5);
    // Revólver: 2 de perto (0,5 s), 3 longe.
    expect(shots(WEAPON_REVOLVER.damage)).toBe(2);
    expect(shots(weaponDamageAt(WEAPON_REVOLVER, 60))).toBe(3);
    expect(ttk(WEAPON_REVOLVER, WEAPON_REVOLVER.damage)).toBeCloseTo(0.5, 5);
    // Escopeta automática: 8 × 9 = 72 por tiro de perto, 2 tiros (0,33 s); 0 aos 16 m.
    const blast = WEAPON_AUTO_SHOTGUN.damage * WEAPON_AUTO_SHOTGUN.pellets;
    expect(blast).toBeLessThan(BASE_HP);
    expect(ttk(WEAPON_AUTO_SHOTGUN, blast)).toBeCloseTo(1 / 3, 5);
    expect(weaponDamageAt(WEAPON_AUTO_SHOTGUN, 16)).toBe(0);
    // Besta: 2 no corpo (o TTK é a recarga do virote), 1 na cabeça.
    expect([shots(WEAPON_CROSSBOW.damage), shots(WEAPON_CROSSBOW.damage * WEAPON_CROSSBOW.headMultiplier)]).toEqual([
      2, 1,
    ]);
    expect(WEAPON_CROSSBOW.clipSize).toBe(1);
    // Revisão: não é uma sniper de quadril: do quadril abre como a SMG ou mais; mirada, quase não espalha.
    expect(WEAPON_CROSSBOW.hipSpreadDeg).toBeGreaterThanOrEqual(3);
    expect(WEAPON_CROSSBOW.hipSpreadDeg * WEAPON_CROSSBOW.adsSpreadMul).toBeLessThanOrEqual(0.2);
    expect(WEAPON_CROSSBOW.category).not.toBe('sniper');
    // Lança-granadas: 2 acertos diretos (0,67 s).
    expect(shots(WEAPON_GRENADE_LAUNCHER.damage)).toBe(2);
    expect(ttk(WEAPON_GRENADE_LAUNCHER, WEAPON_GRENADE_LAUNCHER.damage)).toBeCloseTo(2 / 3, 5);
    expect(WEAPON_CROSSBOW.fire).toBe(WEAPON_FIRE.bolt);
    expect(WEAPON_GRENADE_LAUNCHER.fire).toBe(WEAPON_FIRE.projectile);
  });
});

describe('M10: onde as armas novas entram', () => {
  it('escada do Gun Game feita à mão (a padrão não muda): cada nível dá a arma, o revólver no slot dele', () => {
    const r: MatchRecipe = {
      ...recipe({ ladder: ['rifle.dmr', 'pistol.revolver', 'sniper.crossbow'] }),
      mode: 'warfare.ffa',
      teams: [{ humans: 2, bots: [] }],
    };
    const grid = createWorldGrid(40, 16, 120);
    fillBox(grid, 0, 0, 0, 39, 0, 119, concrete);
    const spawns: MapSpawn[] = [
      { x: cellCenter(20), y: FLOOR, z: 40, yaw: 0, team: 0 },
      { x: cellCenter(20), y: FLOOR, z: 30, yaw: Math.PI, team: 0 },
    ];
    const sim = createSim({ recipe: r, map: { grid, blocks, spawns }, humans: 2 });
    const a = entity(sim, 0);
    const k = a * WEAPON_SLOT_COUNT;
    expect(sim.view().weapon[a]).toBe(WEAPON_CODE.dmr);
    expect(Array.from(sim.view().loadout.slice(k, k + WEAPON_SLOT_COUNT))).toEqual([
      WEAPON_CODE.dmr,
      WEAPON_NONE,
      WEAPON_NONE,
      WEAPON_NONE,
    ]);
  });

  it('BoboStrike: comprar o DMR troca a primária; o revólver troca a pistola (no slot dele)', () => {
    const r: MatchRecipe = { ...recipe(), mode: 'strike' };
    const grid = createWorldGrid(40, 16, 120);
    fillBox(grid, 0, 0, 0, 39, 0, 119, concrete);
    const spawns: MapSpawn[] = [
      { x: cellCenter(20), y: FLOOR, z: 40, yaw: 0, team: 0 },
      { x: cellCenter(20), y: FLOOR, z: 20, yaw: Math.PI, team: 1 },
    ];
    const sim = createSim({ recipe: r, map: { grid, blocks, spawns }, humans: 2 });
    const f = createInputFrames();
    const shop = (id: string): number => STRIKE_SHOP.findIndex((x) => x.id === id);
    const a = entity(sim, 0);
    const k = a * WEAPON_SLOT_COUNT;
    // Até a compra abrir (a 1ª rodada começa depois da largada).
    for (let i = 0; i < 10 * SIM_HZ && sim.view().rounds?.data[ROUND.phase] !== ROUND_PHASE.buy; i++) run(sim, f, 1);
    expect(sim.view().rounds?.data[ROUND.phase]).toBe(ROUND_PHASE.buy);
    // O dinheiro da largada (800) dá o revólver (700), não o DMR.
    f[0]!.primary = STRIKE_BUY_BASE + shop('revolver');
    run(sim, f, 2);
    expect(sim.view().loadout[k + WEAPON_SLOT.secondary]).toBe(WEAPON_CODE.revolver);
    expect(sim.view().weapon[a]).toBe(WEAPON_CODE.revolver);
    f[0]!.primary = STRIKE_BUY_BASE + shop('dmr');
    run(sim, f, 2);
    expect(sim.view().loadout[k + WEAPON_SLOT.primary]).not.toBe(WEAPON_CODE.dmr);
    // Com dinheiro (posto à mão no teste), compra o DMR (a compra é na borda: o pedido volta a 0 antes).
    (sim.view().points as Int32Array)[a] = 5000;
    f[0]!.primary = 0;
    run(sim, f, 1);
    f[0]!.primary = STRIKE_BUY_BASE + shop('dmr');
    run(sim, f, 2);
    expect(sim.view().loadout[k + WEAPON_SLOT.primary]).toBe(WEAPON_CODE.dmr);
    expect(sim.view().weapon[a]).toBe(WEAPON_CODE.dmr);
  });
});

describe('M10: DMR', () => {
  it('semiautomático: o gatilho preso dá 1 tiro; mirado a 40 m tira 46 no tronco e 92 na cabeça', () => {
    const { sim, f } = duel(55, 15, WEAPON_CODE.dmr, { spread: false, recoil: false });
    run(sim, f, PAST_PROTECTION);
    const t = tally();
    const p = pointOf(sim, 1);
    aimAt(sim, f[0]!, 0, p.x, p.y, p.z);
    f[0]!.buttons = BUTTON.fire | BUTTON.ads;
    run(sim, f, SIM_HZ, collect(t, sim.controllerEntity(0)));
    expect(t.shots).toBe(1);
    expect(t.hits.map((h) => h.damage)).toEqual([WEAPON_DMR.damage]);
    f[0]!.buttons = BUTTON.ads;
    run(sim, f, 1);
    const h = pointOf(sim, 1, true);
    aimAt(sim, f[0]!, 0, h.x, h.y, h.z);
    f[0]!.buttons = BUTTON.fire | BUTTON.ads;
    const t2 = tally();
    run(sim, f, 1, collect(t2));
    expect(t2.hits).toEqual([
      { target: sim.controllerEntity(1), damage: WEAPON_DMR.damage * WEAPON_DMR.headMultiplier, part: 'head' },
    ]);
  });

  it('300/min e pente de 10: 10 tiros apertando sem parar, depois a recarga de 2,5 s enche o pente', () => {
    const { sim, f } = duel(55, 15, WEAPON_CODE.dmr);
    const a = entity(sim, 0);
    f[0]!.pitch = pitchToI16(0.8);
    run(sim, f, PAST_PROTECTION);
    const t = tally();
    const ticks = Math.round(2.2 * SIM_HZ);
    const start = sim.tick;
    const shotTicks: number[] = [];
    for (let i = 0; i < ticks; i++) {
      f[0]!.buttons = i % 2 === 0 ? BUTTON.fire : 0;
      run(sim, f, 1, (events) => {
        for (const ev of events) if (ev.type === 'shot') shotTicks.push(ev.tick - start);
        collect(t)(events);
      });
    }
    expect(shotTicks.length).toBe(WEAPON_DMR.clipSize);
    for (let i = 1; i < shotTicks.length; i++)
      expect(shotTicks[i]! - shotTicks[i - 1]!).toBeGreaterThanOrEqual(Math.floor((60 / WEAPON_DMR.rpm) * SIM_HZ));
    expect(t.reloads).toBe(1);
    f[0]!.buttons = 0;
    run(sim, f, Math.ceil(WEAPON_DMR.reloadS * SIM_HZ) + 1);
    expect(heldClip(sim.view(), a)).toBe(WEAPON_DMR.clipSize);
  });
});

describe('M10: revólver (AK5: a secundária escolhida como a pistola)', () => {
  it('sem lista é a pistola; com o revólver na lista da partida ele troca a pistola', () => {
    const loadout = (weapons?: MatchRecipe['weapons']): number[] => {
      const { sim } = duel(30, 20, WEAPON_CODE.rifle, weapons);
      const k = entity(sim, 0) * WEAPON_SLOT_COUNT;
      return Array.from(sim.view().loadout.slice(k, k + WEAPON_SLOT_COUNT));
    };
    const N = WEAPON_NONE;
    expect(loadout()).toEqual([WEAPON_CODE.rifle, WEAPON_CODE.pistol, WEAPON_CODE.knife, WEAPON_CODE.grenade]);
    expect(loadout({ allowed: ['rifle', 'pistol.revolver'] })).toEqual([WEAPON_CODE.rifle, WEAPON_CODE.revolver, N, N]);
    expect(loadout({ allowed: ['pistol.revolver'] })).toEqual([N, WEAPON_CODE.revolver, N, N]);
    expect(loadout({ allowed: ['rifle.dmr', 'pistol', 'knife'] })).toEqual([
      WEAPON_CODE.dmr,
      WEAPON_CODE.pistol,
      WEAPON_CODE.knife,
      N,
    ]);
  });

  it('só revólver: a mão começa nele; 2 tiros no corpo matam de perto; tambor de 6', () => {
    const { sim, f } = duel(30, 20, WEAPON_CODE.rifle, { allowed: ['pistol.revolver'], spread: false, recoil: false });
    const a = entity(sim, 0);
    expect(sim.view().weapon[a]).toBe(WEAPON_CODE.revolver);
    expect(heldClip(sim.view(), a)).toBe(WEAPON_REVOLVER.clipSize);
    run(sim, f, PAST_PROTECTION);
    const t = tally();
    for (let i = 0; i < 2; i++) {
      const p = pointOf(sim, 1);
      aimAt(sim, f[0]!, 0, p.x, p.y, p.z);
      f[0]!.buttons = BUTTON.fire;
      run(sim, f, 1, collect(t));
      f[0]!.buttons = 0;
      run(sim, f, Math.ceil((60 / WEAPON_REVOLVER.rpm) * SIM_HZ), collect(t));
    }
    expect(t.hits.map((h) => h.damage)).toEqual([WEAPON_REVOLVER.damage, WEAPON_REVOLVER.damage]);
    expect(t.kills).toBe(1);
    expect(heldClip(sim.view(), a)).toBe(WEAPON_REVOLVER.clipSize - 2);
  });
});

describe('M10: escopeta automática', () => {
  it('o gatilho preso atira a 180/min, 8 chumbos por tiro; de perto, 2 tiros matam', () => {
    const { sim, f } = duel(20, 17, WEAPON_CODE.autoShotgun, { recoil: false });
    run(sim, f, PAST_PROTECTION);
    const p = pointOf(sim, 1);
    aimAt(sim, f[0]!, 0, p.x, p.y, p.z);
    f[0]!.buttons = BUTTON.fire;
    const t = tally();
    const ticks = Math.round((60 / WEAPON_AUTO_SHOTGUN.rpm) * SIM_HZ);
    run(sim, f, ticks + 1, collect(t, sim.controllerEntity(0)));
    expect(t.shots).toBe(2 * WEAPON_AUTO_SHOTGUN.pellets);
    expect(t.hits.length).toBe(2);
    expect(t.kills).toBe(1);
  });

  it('aos 20 m os chumbos não fazem dano; pente de 8 e recarga inteira de 2,6 s', () => {
    const { sim, f } = duel(40, 20, WEAPON_CODE.autoShotgun);
    const a = entity(sim, 0);
    run(sim, f, PAST_PROTECTION);
    const p = pointOf(sim, 1);
    aimAt(sim, f[0]!, 0, p.x, p.y, p.z);
    f[0]!.buttons = BUTTON.fire;
    const t = tally();
    run(sim, f, Math.ceil(WEAPON_AUTO_SHOTGUN.clipSize * (60 / WEAPON_AUTO_SHOTGUN.rpm) * SIM_HZ) + 2, collect(t));
    expect(t.hits).toEqual([]);
    expect(t.shots).toBe(WEAPON_AUTO_SHOTGUN.clipSize * WEAPON_AUTO_SHOTGUN.pellets);
    expect(t.reloads).toBe(1);
    f[0]!.buttons = 0;
    run(sim, f, Math.ceil(WEAPON_AUTO_SHOTGUN.reloadS * SIM_HZ) + 1);
    expect(heldClip(sim.view(), a)).toBe(WEAPON_AUTO_SHOTGUN.clipSize);
  });
});

describe('M10: besta (o virote)', () => {
  it('voa em arco: a gravidade da arma puxa o virote para baixo da reta', () => {
    const { sim, f } = duel(55, 5, WEAPON_CODE.crossbow, { spread: false, recoil: false });
    run(sim, f, PAST_PROTECTION);
    const a = entity(sim, 0);
    const eyeY = sim.view().position[a * 3 + 1]! + METRICS.eyeHeight;
    f[0]!.pitch = pitchToI16(0);
    f[0]!.buttons = BUTTON.fire;
    const t = tally();
    run(sim, f, 1, collect(t));
    f[0]!.buttons = 0;
    expect(t.launches).toBe(1);
    const flight = Math.round(0.3 * SIM_HZ);
    run(sim, f, flight);
    const pv = sim.view().projectiles;
    let y = Number.NaN;
    for (let p = 0; p < pv.count; p++) if (pv.alive[p] === 1) y = pv.position[p * 3 + 1]!;
    const tS = (flight + 1) / SIM_HZ;
    const drop = 0.5 * WEAPON_CROSSBOW.projectileGravity * tS * tS;
    expect(eyeY - y).toBeGreaterThan(drop * 0.7);
    expect(eyeY - y).toBeLessThan(drop * 1.5);
  });

  it('no tronco tira 90 (sem explosão); na cabeça, 1 virote mata; o pente de 1 recarrega em 1,5 s', () => {
    const { sim, f } = duel(40, 20, WEAPON_CODE.crossbow, { spread: false, recoil: false });
    const a = entity(sim, 0);
    run(sim, f, PAST_PROTECTION);
    const p = pointOf(sim, 1);
    aimAt(sim, f[0]!, 0, p.x, p.y, p.z, WEAPON_CROSSBOW);
    f[0]!.buttons = BUTTON.fire | BUTTON.ads;
    const t = tally();
    run(sim, f, 1, collect(t));
    f[0]!.buttons = BUTTON.ads;
    expect(heldClip(sim.view(), a)).toBe(0);
    run(sim, f, SIM_HZ, collect(t));
    expect(t.hits).toEqual([{ target: sim.controllerEntity(1), damage: WEAPON_CROSSBOW.damage, part: 'torso' }]);
    expect(t.explosions).toEqual([]);
    expect(t.sticks).toEqual([]);
    expect(t.reloads).toBe(1);
    run(sim, f, Math.ceil(WEAPON_CROSSBOW.reloadS * SIM_HZ));
    expect(heldClip(sim.view(), a)).toBe(1);
    const h = pointOf(sim, 1, true);
    aimAt(sim, f[0]!, 0, h.x, h.y, h.z, WEAPON_CROSSBOW);
    f[0]!.buttons = BUTTON.fire | BUTTON.ads;
    const t2 = tally();
    run(sim, f, SIM_HZ, collect(t2));
    expect(t2.hits.map((x) => x.part)).toEqual(['head']);
    expect(t2.hits[0]!.damage).toBe(WEAPON_CROSSBOW.damage * WEAPON_CROSSBOW.headMultiplier);
    expect(t2.kills).toBe(1);
  });

  it('no bloco, o virote crava: o evento `stick` na face, com a direção do voo, sem explosão; o pool esvazia', () => {
    // Parede de concreto nas células z = 20 (de z = 10 a 10,5 m): o virote vindo de z = 25 bate na face de z = 10,5.
    const { sim, f } = duel(25, 5, WEAPON_CODE.crossbow, { spread: false, recoil: false }, (grid) =>
      fillBox(grid, 0, 1, 20, 39, 8, 20, concrete),
    );
    run(sim, f, PAST_PROTECTION);
    f[0]!.pitch = pitchToI16(0);
    f[0]!.buttons = BUTTON.fire;
    const t = tally();
    run(sim, f, SIM_HZ, collect(t));
    expect(t.launches).toBe(1);
    expect(t.sticks.length).toBe(1);
    const s = t.sticks[0]!;
    expect(s.z).toBeCloseTo(10.5, 3);
    expect(s.vz).toBeLessThan(0);
    expect(s.vy).toBeLessThan(0);
    expect(t.explosions).toEqual([]);
    expect(t.hits).toEqual([]);
    expect(sim.view().projectiles.count).toBe(0);
  });
});

describe('M10: lança-granadas', () => {
  it('acerto direto: 85 no alvo, explode no contato e some do pool', () => {
    const { sim, f } = duel(30, 18, WEAPON_CODE.grenadeLauncher, { spread: false, recoil: false });
    run(sim, f, PAST_PROTECTION);
    const p = pointOf(sim, 1);
    aimAt(sim, f[0]!, 0, p.x, p.y, p.z, WEAPON_GRENADE_LAUNCHER);
    f[0]!.buttons = BUTTON.fire;
    const t = tally();
    run(sim, f, 1, collect(t));
    f[0]!.buttons = 0;
    run(sim, f, SIM_HZ, collect(t));
    expect(t.launches).toBe(1);
    expect(t.hits).toEqual([
      { target: sim.controllerEntity(1), damage: WEAPON_GRENADE_LAUNCHER.damage, part: 'torso' },
    ]);
    expect(t.explosions.length).toBe(1);
    expect(sim.view().projectiles.count).toBe(0);
  });

  it('no chão perto do pé explode no contato (sem quicar nem esperar pavio), com a área caindo', () => {
    const { sim, f } = duel(30, 18, WEAPON_CODE.grenadeLauncher, { spread: false, recoil: false });
    run(sim, f, PAST_PROTECTION);
    const b = entity(sim, 1);
    const bz = sim.view().position[b * 3 + 2]!;
    aimAt(sim, f[0]!, 0, cellCenter(20), FLOOR, bz + 1.6, WEAPON_GRENADE_LAUNCHER);
    f[0]!.buttons = BUTTON.fire;
    const t = tally();
    const start = sim.tick;
    run(sim, f, 1, collect(t));
    f[0]!.buttons = 0;
    run(sim, f, 2 * SIM_HZ, collect(t));
    expect(t.explosions.length).toBe(1);
    // ~10 m a 30 m/s: explode no 1º contato (≈ 0,35 s), muito antes do fim do alcance (2 s).
    expect(t.explosions[0]!.tick - start).toBeLessThan(0.6 * SIM_HZ);
    expect(t.explosions[0]!.z).toBeCloseTo(bz + 1.6, 0);
    const splash = t.hits.find((h) => h.target === sim.controllerEntity(1));
    expect(splash).toBeDefined();
    expect(splash!.damage).toBeGreaterThan(0);
    expect(splash!.damage).toBeLessThan(WEAPON_GRENADE_LAUNCHER.blastDamage);
  });

  it('autodano: no próprio pé tira no máximo a metade', () => {
    const { sim, f } = duel(30, 5, WEAPON_CODE.grenadeLauncher, { spread: false, recoil: false });
    run(sim, f, PAST_PROTECTION);
    const a = entity(sim, 0);
    const az = sim.view().position[a * 3 + 2]!;
    aimAt(sim, f[0]!, 0, cellCenter(20), FLOOR, az - 1, WEAPON_GRENADE_LAUNCHER);
    f[0]!.buttons = BUTTON.fire;
    const t = tally();
    run(sim, f, SIM_HZ, collect(t));
    const self = t.hits.find((h) => h.target === sim.controllerEntity(0));
    expect(self).toBeDefined();
    expect(self!.damage).toBeGreaterThan(0);
    expect(self!.damage).toBeLessThanOrEqual(
      WEAPON_GRENADE_LAUNCHER.blastDamage * WEAPON_GRENADE_LAUNCHER.selfDamageMul,
    );
  });

  it('pente de 6 a 90/min, e a recarga de 3,2 s', () => {
    const { sim, f } = duel(55, 5, WEAPON_CODE.grenadeLauncher);
    const a = entity(sim, 0);
    f[0]!.pitch = pitchToI16(0.5);
    run(sim, f, PAST_PROTECTION);
    const t = tally();
    for (let i = 0; i < Math.round(4.2 * SIM_HZ); i++) {
      f[0]!.buttons = i % 2 === 0 ? BUTTON.fire : 0;
      run(sim, f, 1, collect(t));
    }
    expect(t.launches).toBe(WEAPON_GRENADE_LAUNCHER.clipSize);
    expect(t.reloads).toBe(1);
    f[0]!.buttons = 0;
    run(sim, f, Math.ceil(WEAPON_GRENADE_LAUNCHER.reloadS * SIM_HZ) + 1);
    expect(heldClip(sim.view(), a)).toBe(WEAPON_GRENADE_LAUNCHER.clipSize);
  });
});
