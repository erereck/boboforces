import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { WEAPON_SLOT_COUNT } from '@boboforces/input';
import { yawToU16 } from '@boboforces/shared';
import {
  BOT_CONTROLLER_BASE,
  DEFAULT_PRIMARY,
  entityIndex,
  isPrimaryWeapon,
  MAX_CONTROLLERS,
  SIM_HZ,
  WEAPON_CODE,
  type SimEvent,
  type SimMap,
} from '@boboforces/sim';
import { cellCenter, createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { createHeadlessMatch, type HeadlessMatch } from './headless.ts';
import { BOT_PRIMARY_WEIGHTS, botPrimaries, botPrimary } from './weapons.ts';

/**
 * M2, fase 1d: a IA usa as armas novas (gameplay.md §4.3: "nenhuma arma entra sem o bot saber quando usá-la"). Um
 * humano parado (controlador 0) e um bot Normal (controlador 4) frente a frente num chão aberto.
 */

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);
const HUMAN_Z = 35;

function arena(botZ: number): SimMap {
  const grid = createWorldGrid(40, 12, 80);
  fillBox(grid, 0, 0, 0, 39, 0, 79, concrete);
  return {
    grid,
    blocks,
    spawns: [
      { x: cellCenter(20), y: 0.5, z: HUMAN_Z, yaw: 0, team: 0 },
      { x: cellCenter(20), y: 0.5, z: botZ, yaw: Math.PI, team: 1 },
    ],
  };
}

function duelRecipe(seed = 3): MatchRecipe {
  return {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'test',
    seed,
    teams: [{ humans: 1, bots: [] }, { bots: [{ ref: builtinBotRef('normal'), count: 1 }] }],
  };
}

/** Bot com a primária `primary` a `distance` m do humano parado; `onEvents` vê os eventos de cada tick. */
function botVsDummy(
  primary: number,
  distance: number,
  onEvents: (events: readonly SimEvent[], match: HeadlessMatch) => void,
): HeadlessMatch {
  const primaries = new Array<number>(MAX_CONTROLLERS).fill(WEAPON_CODE.rifle);
  primaries[BOT_CONTROLLER_BASE] = primary;
  let self: HeadlessMatch | null = null;
  const match = createHeadlessMatch({
    recipe: duelRecipe(),
    map: arena(HUMAN_Z - distance),
    humans: 1,
    primaries,
    writeHumans: (f) => {
      f[0]!.yaw = yawToU16(0);
      f[0]!.buttons = 0;
    },
    onEvents: (events) => {
      if (self) onEvents(events, self);
    },
  });
  self = match;
  return match;
}

describe('primária dos bots', () => {
  it('sorteio determinístico, só primárias, perto dos pesos; humanos ficam com a padrão', () => {
    const counts = new Map<number, number>();
    for (let seed = 0; seed < 400; seed++) {
      for (let c = BOT_CONTROLLER_BASE; c < BOT_CONTROLLER_BASE + 10; c++) {
        const p = botPrimary(seed, c);
        expect(botPrimary(seed, c)).toBe(p);
        expect(isPrimaryWeapon(p)).toBe(true);
        counts.set(p, (counts.get(p) ?? 0) + 1);
      }
    }
    for (const w of BOT_PRIMARY_WEIGHTS) {
      const share = ((counts.get(w.code) ?? 0) / 4000) * 100;
      expect(Math.abs(share - w.weight), `código ${w.code}: ${share.toFixed(1)}%`).toBeLessThan(3);
    }
    const r = duelRecipe(77);
    const list = botPrimaries(r, 1);
    expect(list.length).toBe(MAX_CONTROLLERS);
    expect(list[0]).toBe(DEFAULT_PRIMARY);
    expect(list[BOT_CONTROLLER_BASE]).toBe(botPrimary(77, BOT_CONTROLLER_BASE));
  });
});

describe('uso das armas', () => {
  it('foguete a 20 m: lança, explode e mata o alvo parado', () => {
    let launches = 0;
    let kills = 0;
    const match = botVsDummy(WEAPON_CODE.rocket, 20, (events, m) => {
      for (const ev of events) {
        if (ev.type === 'projectile' && ev.action === 'launch') launches++;
        if (ev.type === 'kill' && ev.victim === m.sim.controllerEntity(0)) kills++;
      }
    });
    for (let t = 0; t < 12 * SIM_HZ && kills === 0; t++) match.step();
    expect(launches).toBeGreaterThan(0);
    expect(kills).toBe(1);
    match.dispose();
  });

  it('foguete a 3 m: troca para a pistola e atira várias vezes com ela (o gatilho solta entre os tiros)', () => {
    const switches: number[] = [];
    let pistolShots = 0;
    let rockets = 0;
    const match = botVsDummy(WEAPON_CODE.rocket, 3, (events, m) => {
      const bot = m.sim.controllerEntity(BOT_CONTROLLER_BASE);
      for (const ev of events) {
        if (ev.type === 'weapon' && ev.action === 'switch' && ev.entity === bot) switches.push(ev.weapon);
        if (ev.type === 'shot' && ev.shooter === bot && ev.weapon === WEAPON_CODE.pistol) pistolShots++;
        if (ev.type === 'projectile' && ev.action === 'launch' && ev.owner === bot) rockets++;
      }
    });
    match.run(6 * SIM_HZ);
    expect(switches).toContain(WEAPON_CODE.pistol);
    expect(pistolShots).toBeGreaterThan(2);
    expect(rockets).toBe(0);
    match.dispose();
  });

  it('sniper a 30 m: todo tiro sai com o ADS completo', () => {
    let shots = 0;
    let unscoped = 0;
    const match = botVsDummy(WEAPON_CODE.sniper, 30, (events, m) => {
      const bot = m.sim.controllerEntity(BOT_CONTROLLER_BASE);
      for (const ev of events) {
        if (ev.type !== 'shot' || ev.shooter !== bot) continue;
        shots++;
        if (m.sim.view().adsAmount[entityIndex(bot)]! < 0.95) unscoped++;
      }
    });
    match.run(8 * SIM_HZ);
    expect(shots).toBeGreaterThan(0);
    expect(unscoped).toBe(0);
    match.dispose();
  });

  it('colado no alvo: troca o fuzil pela faca e golpeia', () => {
    const switches: number[] = [];
    let stabs = 0;
    const match = botVsDummy(WEAPON_CODE.rifle, 1.2, (events, m) => {
      const bot = m.sim.controllerEntity(BOT_CONTROLLER_BASE);
      for (const ev of events) {
        if (ev.type === 'weapon' && ev.action === 'switch' && ev.entity === bot) switches.push(ev.weapon);
        if (ev.type === 'melee' && ev.attacker === bot && ev.target === m.sim.controllerEntity(0)) stabs++;
      }
    });
    match.run(5 * SIM_HZ);
    expect(switches).toContain(WEAPON_CODE.knife);
    expect(stabs).toBeGreaterThan(0);
    match.dispose();
  });

  it('primária sem munição: vai para a pistola', () => {
    let pistolShots = 0;
    const match = botVsDummy(WEAPON_CODE.shotgun, 40, (events, m) => {
      const bot = m.sim.controllerEntity(BOT_CONTROLLER_BASE);
      for (const ev of events)
        if (ev.type === 'shot' && ev.shooter === bot && ev.weapon === WEAPON_CODE.pistol) pistolShots++;
    });
    // Esvazia a escopeta do bot por fora (pente e reserva), como se tivesse gastado tudo.
    const v = match.sim.view();
    const k = entityIndex(match.sim.controllerEntity(BOT_CONTROLLER_BASE)) * WEAPON_SLOT_COUNT;
    (v.slotClip as Uint16Array)[k] = 0;
    (v.slotReserve as Uint16Array)[k] = 0;
    match.run(6 * SIM_HZ);
    expect(pistolShots).toBeGreaterThan(0);
    match.dispose();
  });
});
