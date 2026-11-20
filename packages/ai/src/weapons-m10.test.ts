import { builtinBotRef, levelBot, MATCH_RECIPE_FORMAT, type BotRules, type MatchRecipe } from '@boboforces/format';
import { WEAPON_SLOT_COUNT } from '@boboforces/input';
import { yawToU16 } from '@boboforces/shared';
import {
  BOT_CONTROLLER_BASE,
  entityIndex,
  MAX_CONTROLLERS,
  SIM_HZ,
  WEAPON_CODE,
  type SimEvent,
  type SimMap,
} from '@boboforces/sim';
import { cellCenter, createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { createHeadlessMatch, type HeadlessMatch } from './headless.ts';

/**
 * M10 (fases 6 e 7): a IA usa as 5 armas novas (GDD §4.3.1: "nenhuma arma entra sem o bot saber quando usá-la"). Cada
 * uma contra um humano parado num chão aberto (o bot tem que atirar com ela e matar), o revólver pela regra do bot (o
 * Laboratório, AK5), e uma partida só de bots com as 4 primárias novas em que cada uma abate alguém.
 */

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);
const HUMAN_Z = 50;

function arena(botZ: number): SimMap {
  const grid = createWorldGrid(40, 12, 120);
  fillBox(grid, 0, 0, 0, 39, 0, 119, concrete);
  return {
    grid,
    blocks,
    spawns: [
      { x: cellCenter(20), y: 0.5, z: HUMAN_Z, yaw: 0, team: 0 },
      { x: cellCenter(20), y: 0.5, z: botZ, yaw: Math.PI, team: 1 },
    ],
  };
}

/** Regras do bot embutido: as do Normal com a lista de armas (como o Laboratório grava). */
function rules(weapons: string[]): BotRules {
  return { ...levelBot('normal').rules, weapons };
}

/** Bot Normal com a primária `primary` (ou só as armas `weapons`, pela regra dele) a `distance` m do humano parado. */
function botVsDummy(
  primary: number,
  distance: number,
  onEvents: (events: readonly SimEvent[], match: HeadlessMatch) => void,
  weapons?: string[],
): HeadlessMatch {
  const primaries = new Array<number>(MAX_CONTROLLERS).fill(WEAPON_CODE.rifle);
  primaries[BOT_CONTROLLER_BASE] = primary;
  const recipe: MatchRecipe = {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'test',
    seed: 5,
    teams: [
      { humans: 1, bots: [] },
      weapons ? { bots: [{ ref: 'embedded:t', count: 1 }] } : { bots: [{ ref: builtinBotRef('normal'), count: 1 }] },
    ],
    ...(weapons ? { embeddedBots: [{ ...levelBot('normal'), id: 't', name: 'Teste', rules: rules(weapons) }] } : {}),
  };
  let self: HeadlessMatch | null = null;
  const match = createHeadlessMatch({
    recipe,
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

/** Roda até o bot matar o humano (ou o tempo); devolve os disparos do bot com a arma `code` e se matou com ela. */
function duelWith(code: number, distance: number, weapons?: string[]): { fired: number; killedWith: boolean } {
  let fired = 0;
  let killedWith = false;
  const match = botVsDummy(
    code,
    distance,
    (events, m) => {
      const bot = m.sim.controllerEntity(BOT_CONTROLLER_BASE);
      for (const ev of events) {
        if (ev.type === 'shot' && ev.shooter === bot && ev.weapon === code) fired++;
        if (ev.type === 'projectile' && ev.action === 'launch' && ev.owner === bot && ev.weapon === code) fired++;
        if (ev.type === 'kill' && ev.killer === bot && ev.victim === m.sim.controllerEntity(0) && ev.weapon === code)
          killedWith = true;
      }
    },
    weapons,
  );
  for (let t = 0; t < 15 * SIM_HZ && !killedWith; t++) match.step();
  match.dispose();
  return { fired, killedWith };
}

describe('M10: a IA usa as armas novas', () => {
  it('DMR a 35 m: mira, atira semiautomático e mata', () => {
    const r = duelWith(WEAPON_CODE.dmr, 35);
    expect(r.fired).toBeGreaterThan(1);
    expect(r.killedWith).toBe(true);
  });

  it('escopeta automática a 15 m: chega perto e mata', () => {
    const r = duelWith(WEAPON_CODE.autoShotgun, 15);
    expect(r.fired).toBeGreaterThan(0);
    expect(r.killedWith).toBe(true);
  });

  it('besta a 30 m: o virote sobe pelo arco e mata', () => {
    const r = duelWith(WEAPON_CODE.crossbow, 30);
    expect(r.fired).toBeGreaterThan(0);
    expect(r.killedWith).toBe(true);
  });

  it('lança-granadas a 18 m: no pé, com a queda do arco, e mata', () => {
    const r = duelWith(WEAPON_CODE.grenadeLauncher, 18);
    expect(r.fired).toBeGreaterThan(0);
    expect(r.killedWith).toBe(true);
  });

  it('lança-granadas a 3 m: não atira colado (troca para a secundária)', () => {
    let launches = 0;
    const match = botVsDummy(WEAPON_CODE.grenadeLauncher, 3, (events, m) => {
      const bot = m.sim.controllerEntity(BOT_CONTROLLER_BASE);
      for (const ev of events) if (ev.type === 'projectile' && ev.action === 'launch' && ev.owner === bot) launches++;
    });
    match.run(4 * SIM_HZ);
    expect(launches).toBe(0);
    match.dispose();
  });

  it('revólver pela regra do bot (o Laboratório, AK5): a secundária dele é o revólver, e mata a 12 m', () => {
    const match = botVsDummy(WEAPON_CODE.sniper, 12, () => undefined, ['sniper', 'pistol.revolver']);
    const k = entityIndex(match.sim.controllerEntity(BOT_CONTROLLER_BASE)) * WEAPON_SLOT_COUNT;
    expect(match.sim.view().loadout[k]).toBe(WEAPON_CODE.sniper);
    expect(match.sim.view().loadout[k + 1]).toBe(WEAPON_CODE.revolver);
    match.dispose();
    const r = duelWith(WEAPON_CODE.revolver, 12, ['pistol.revolver']);
    expect(r.fired).toBeGreaterThan(1);
    expect(r.killedWith).toBe(true);
  });

  it('partida só de bots com as 4 primárias novas: cada uma abate alguém', () => {
    const grid = createWorldGrid(60, 12, 80);
    fillBox(grid, 0, 0, 0, 59, 0, 79, concrete);
    // Umas caixas no meio para os bots se cobrirem e se acharem de novo.
    for (const [x, z] of [
      [20, 30],
      [38, 30],
      [20, 48],
      [38, 48],
      [29, 39],
    ] as const)
      fillBox(grid, x, 1, z, x + 2, 3, z + 2, concrete);
    const spawns = [];
    for (let i = 0; i < 4; i++) {
      spawns.push({ x: cellCenter(10 + i * 12), y: 0.5, z: 6, yaw: Math.PI, team: 0 });
      spawns.push({ x: cellCenter(10 + i * 12), y: 0.5, z: 34, yaw: 0, team: 1 });
    }
    const news = [WEAPON_CODE.dmr, WEAPON_CODE.autoShotgun, WEAPON_CODE.crossbow, WEAPON_CODE.grenadeLauncher];
    const primaries = new Array<number>(MAX_CONTROLLERS).fill(WEAPON_CODE.rifle);
    for (let i = 0; i < 8; i++) primaries[BOT_CONTROLLER_BASE + i] = news[i % news.length]!;
    const kills = new Map<number, number>();
    const match = createHeadlessMatch({
      recipe: {
        format: MATCH_RECIPE_FORMAT,
        mode: 'warfare.tdm',
        map: 'test',
        seed: 9,
        teams: [
          { bots: [{ ref: builtinBotRef('normal'), count: 4 }] },
          { bots: [{ ref: builtinBotRef('normal'), count: 4 }] },
        ],
      },
      map: { grid, blocks, spawns },
      humans: 0,
      primaries,
      onEvents: (events) => {
        for (const ev of events) if (ev.type === 'kill') kills.set(ev.weapon, (kills.get(ev.weapon) ?? 0) + 1);
      },
    });
    for (let t = 0; t < 120 * SIM_HZ && news.some((c) => (kills.get(c) ?? 0) === 0); t++) match.step();
    match.dispose();
    for (const c of news) expect(kills.get(c) ?? 0, `abates com o código ${c}`).toBeGreaterThan(0);
  });
});
