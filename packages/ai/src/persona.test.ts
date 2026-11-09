import {
  BOT_FORMAT,
  levelBot,
  MATCH_RECIPE_FORMAT,
  PERSONALITY_PRESETS,
  type BotDocument,
  type BotRef,
  type BotRules,
  type MatchRecipe,
  type PersonalityId,
} from '@boboforces/format';
import { BUTTON } from '@boboforces/input';
import { buildNavGrid } from '@boboforces/nav';
import { angleDelta, createRng } from '@boboforces/shared';
import {
  BOBO_NAV_METRICS,
  BOT_CONTROLLER_BASE,
  createSim,
  ENTITY_FLAG,
  SIM_HZ,
  WEAPON_CODE,
  type SimEvent,
  type SimMap,
  type Sim,
} from '@boboforces/sim';
import { createTestBlocks, createWorldGrid, fillBox, makeCell, type WorldGrid } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { createHeadlessMatch } from './headless.ts';
import { PathFollower } from './paths.ts';
import { personaOverride } from './persona.ts';
import { SoldierBrain, SoldierTiming } from './soldier.ts';
import { retreatBelow } from './tactics2.ts';

/** M2, fase 3g: o comportamento visível de cada personalidade (gameplay.md §6.4) e os loadouts restritos. */

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);

interface Spawn {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly team: number;
}

/** Campo aberto de 30 × 100 m com navegação; `walls` levanta paredes (em células, 2 por metro). */
function field(spawns: readonly Spawn[], walls?: (grid: WorldGrid) => void): SimMap {
  const grid = createWorldGrid(60, 16, 200);
  fillBox(grid, 0, 0, 0, 59, 0, 199, concrete);
  walls?.(grid);
  return {
    grid,
    blocks,
    spawns: spawns.map((s) => ({ x: s.x, y: 0.5, z: s.z, yaw: s.yaw, team: s.team })),
    nav: buildNavGrid({ grid, blocks }, BOBO_NAV_METRICS),
  };
}

/** Bot embutido com a habilidade e a inteligência do Normal e a personalidade `preset`. */
function persona(id: string, preset: PersonalityId, rules: Partial<BotRules> = {}): BotDocument {
  const base = levelBot('normal');
  return {
    ...base,
    format: BOT_FORMAT,
    id,
    name: id,
    personality: PERSONALITY_PRESETS[preset],
    rules: { ...base.rules, ...rules },
  };
}

function recipe(
  teams: MatchRecipe['teams'],
  embeddedBots: readonly BotDocument[],
  players: MatchRecipe['players'] = undefined,
): MatchRecipe {
  return {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'test',
    seed: 7,
    teams,
    embeddedBots: [...embeddedBots],
    ...(players ? { players } : {}),
  };
}

/** Humano parado (time 0) contra 1 bot (time 1). */
function duel(bot: BotDocument | BotRef, players?: MatchRecipe['players']): MatchRecipe {
  const ref: BotRef = typeof bot === 'string' ? bot : `embedded:${bot.id}`;
  return recipe(
    [{ humans: 1, bots: [] }, { bots: [{ ref, count: 1 }] }],
    typeof bot === 'string' ? [] : [bot],
    players,
  );
}

function entity(sim: Sim, controller: number): number {
  return sim.controllerEntity(controller) & 0xffff;
}

function planar(sim: Sim, a: number, b: number): number {
  const v = sim.view();
  return Math.hypot(v.position[a * 3]! - v.position[b * 3]!, v.position[a * 3 + 2]! - v.position[b * 3 + 2]!);
}

const BOT = BOT_CONTROLLER_BASE;

describe('personalidades: comportamento visível', () => {
  it('Rusher corre até o contato e pula; o Equilibrado segura a distância e não pula', () => {
    const run = (preset: PersonalityId): { minD: number; jumps: number } => {
      const match = createHeadlessMatch({
        recipe: duel(persona('p', preset, { damageMult: 0 })),
        map: field([
          { x: 15, z: 80, yaw: 0, team: 0 },
          { x: 15, z: 40, yaw: Math.PI, team: 1 },
        ]),
        humans: 1,
        primaries: [],
      });
      match.step();
      const h = entity(match.sim, 0);
      const b = entity(match.sim, BOT);
      let minD = Infinity;
      let jumps = 0;
      let wasGround = true;
      for (let i = 0; i < 10 * SIM_HZ; i++) {
        match.step();
        minD = Math.min(minD, planar(match.sim, h, b));
        const ground = (match.sim.view().flags[b]! & ENTITY_FLAG.onGround) !== 0;
        if (wasGround && !ground) jumps++;
        wasGround = ground;
      }
      match.dispose();
      return { minD, jumps };
    };
    const rusher = run('rusher');
    const balanced = run('balanced');
    expect(rusher.minD).toBeLessThan(11);
    expect(balanced.minD).toBeGreaterThan(15);
    expect(rusher.jumps).toBeGreaterThanOrEqual(3);
    expect(balanced.jumps).toBe(0);
  });

  it('Covarde se afasta de quem está perto; foge com 60% de vida; o Kamikaze nunca recua', () => {
    const run = (preset: PersonalityId): number => {
      const match = createHeadlessMatch({
        recipe: duel(persona('p', preset, { damageMult: 0 })),
        map: field([
          { x: 15, z: 80, yaw: 0, team: 0 },
          { x: 15, z: 70, yaw: Math.PI, team: 1 },
        ]),
        humans: 1,
        primaries: [],
      });
      match.run(6 * SIM_HZ);
      const d = planar(match.sim, entity(match.sim, 0), entity(match.sim, BOT));
      match.dispose();
      return d;
    };
    expect(run('coward')).toBeGreaterThan(16);
    expect(run('balanced')).toBeLessThan(13);
    const brain = (preset: PersonalityId): SoldierBrain =>
      new SoldierBrain(
        0,
        BOT,
        'normal',
        createRng(1),
        new SoldierTiming(SIM_HZ),
        new PathFollower(0),
        persona('p', preset),
      );
    expect(retreatBelow(brain('coward'))).toBe(0.6);
    expect(retreatBelow(brain('kamikaze'))).toBe(0);
    expect(retreatBelow(brain('balanced'))).toBeCloseTo(0.375, 6);
  });

  it('fingindo de morto: agachado, parado, olhando o chão; acabou o tempo, volta a jogar', () => {
    const map = field([
      { x: 15, z: 80, yaw: 0, team: 0 },
      { x: 15, z: 40, yaw: Math.PI, team: 1 },
    ]);
    const sim = createSim({ recipe: duel(persona('p', 'coward')), map, humans: 1 });
    const t = new SoldierTiming(SIM_HZ);
    const b = new SoldierBrain(0, BOT, 'normal', createRng(1), t, new PathFollower(0), persona('p', 'coward'));
    const local = { x: 1, y: 1 };
    b.playDeadUntil = 100;
    let buttons = 0;
    for (let tick = 0; tick < 60; tick++) buttons = personaOverride(sim.view(), b, 1, tick, t, local);
    expect(buttons).toBe(BUTTON.crouch);
    expect(local).toEqual({ x: 0, y: 0 });
    expect(b.aimPitch).toBeLessThan(-1.2);
    expect(personaOverride(sim.view(), b, 1, 100, t, local)).toBe(-1);
  });

  it('Camper vai para um ponto e espera agachado; o Equilibrado passeia', () => {
    // O humano fica numa caixa fechada: ninguém vê nem ouve ninguém.
    const box = (grid: WorldGrid): void => {
      fillBox(grid, 4, 1, 4, 12, 6, 4, concrete);
      fillBox(grid, 4, 1, 12, 12, 6, 12, concrete);
      fillBox(grid, 4, 1, 4, 4, 6, 12, concrete);
      fillBox(grid, 12, 1, 4, 12, 6, 12, concrete);
      fillBox(grid, 4, 6, 4, 12, 6, 12, concrete);
    };
    const run = (preset: PersonalityId): { path: number; crouched: number } => {
      const match = createHeadlessMatch({
        recipe: duel(persona('p', preset, { damageMult: 0 })),
        map: field(
          [
            { x: 4, z: 4, yaw: 0, team: 0 },
            { x: 15, z: 60, yaw: 0, team: 1 },
          ],
          box,
        ),
        humans: 1,
        primaries: [],
      });
      match.run(20 * SIM_HZ);
      const b = entity(match.sim, BOT);
      let path = 0;
      let crouched = 0;
      const v = match.sim.view();
      let px = v.position[b * 3]!;
      let pz = v.position[b * 3 + 2]!;
      const n = 15 * SIM_HZ;
      for (let i = 0; i < n; i++) {
        match.step();
        const x = v.position[b * 3]!;
        const z = v.position[b * 3 + 2]!;
        path += Math.hypot(x - px, z - pz);
        px = x;
        pz = z;
        if ((v.flags[b]! & ENTITY_FLAG.crouching) !== 0) crouched++;
      }
      match.dispose();
      return { path, crouched: crouched / n };
    };
    const camper = run('camper');
    const balanced = run('balanced');
    expect(camper.path).toBeLessThan(2);
    expect(camper.crouched).toBeGreaterThan(0.8);
    expect(balanced.path).toBeGreaterThan(10);
  });

  it('Kamikaze cola no alvo e se explode com a granada na mão (sem arremessar)', () => {
    let blasts = 0;
    let thrown = 0;
    const match = createHeadlessMatch({
      recipe: duel(persona('k', 'kamikaze', { hp: 99 }), { hp: 1000 }),
      map: field([
        { x: 15, z: 80, yaw: 0, team: 0 },
        { x: 15, z: 50, yaw: Math.PI, team: 1 },
      ]),
      humans: 1,
      primaries: [],
      onEvents: (events: readonly SimEvent[], sim: Sim) => {
        const me = sim.controllerEntity(BOT);
        for (const ev of events) {
          if (ev.type === 'explosion' && ev.owner === me && ev.weapon === WEAPON_CODE.grenade) blasts++;
          if (ev.type === 'projectile' && ev.action === 'launch' && ev.owner === me) thrown++;
        }
      },
    });
    let hurt = false;
    for (let i = 0; i < 15 * SIM_HZ && blasts === 0; i++) match.step();
    // A granada na mão fere o próprio Kamikaze (dano em si mesmo pela metade, `selfDamageMul`).
    const k = entity(match.sim, BOT);
    const v = match.sim.view();
    hurt = v.health[k]! < 99 || (v.flags[k]! & ENTITY_FLAG.dead) !== 0;
    expect(blasts).toBeGreaterThanOrEqual(1);
    expect(thrown).toBe(0);
    expect(hurt).toBe(true);
    match.dispose();
  });

  it('Caçador vai na presa (o humano) mesmo com outro inimigo mais perto; o Equilibrado atira no mais perto', () => {
    const firstTarget = (preset: PersonalityId): string => {
      let first = '';
      const match = createHeadlessMatch({
        recipe: recipe(
          [{ humans: 1, bots: [{ ref: 'embedded:decoy', count: 1 }] }, { bots: [{ ref: 'embedded:p', count: 1 }] }],
          [persona('decoy', 'camper', { damageMult: 0 }), persona('p', preset)],
          { hp: 1000 },
        ),
        map: field([
          { x: 24, z: 80, yaw: 0, team: 0 },
          { x: 6, z: 56, yaw: 0, team: 0 },
          { x: 15, z: 40, yaw: Math.PI, team: 1 },
        ]),
        humans: 1,
        primaries: [],
        onEvents: (events: readonly SimEvent[], sim: Sim) => {
          for (const ev of events) {
            if (first !== '' || ev.type !== 'hit' || ev.shooter !== sim.controllerEntity(BOT + 1)) continue;
            first = ev.target === sim.controllerEntity(0) ? 'human' : 'decoy';
          }
        },
      });
      match.run(8 * SIM_HZ);
      match.dispose();
      return first;
    };
    expect(firstTarget('hunter')).toBe('human');
    expect(firstTarget('balanced')).toBe('decoy');
  });

  it('Suporte vai até o humano aliado e vigia as costas dele', () => {
    // O inimigo fica numa caixa fechada no fundo do campo.
    const box = (grid: WorldGrid): void => {
      fillBox(grid, 4, 1, 184, 12, 6, 184, concrete);
      fillBox(grid, 4, 1, 196, 12, 6, 196, concrete);
      fillBox(grid, 4, 1, 184, 4, 6, 196, concrete);
      fillBox(grid, 12, 1, 184, 12, 6, 196, concrete);
      fillBox(grid, 4, 6, 184, 12, 6, 196, concrete);
    };
    const match = createHeadlessMatch({
      recipe: recipe(
        [{ humans: 1, bots: [{ ref: 'embedded:s', count: 1 }] }, { bots: [{ ref: 'embedded:enemy', count: 1 }] }],
        [persona('s', 'support'), persona('enemy', 'camper', { damageMult: 0 })],
      ),
      map: field(
        [
          { x: 15, z: 20, yaw: 0, team: 0 },
          { x: 15, z: 60, yaw: 0, team: 0 },
          { x: 4, z: 95, yaw: 0, team: 1 },
        ],
        box,
      ),
      humans: 1,
      primaries: [],
    });
    match.run(15 * SIM_HZ);
    const h = entity(match.sim, 0);
    const s = entity(match.sim, BOT);
    expect(planar(match.sim, h, s)).toBeLessThan(7);
    const v = match.sim.view();
    expect(Math.abs(angleDelta(v.yaw[s]!, v.yaw[h]! + Math.PI))).toBeLessThan((70 * Math.PI) / 180);
    match.dispose();
  });

  it('Palhaço dança depois do abate (gira e agacha); o Equilibrado não', () => {
    const spin = (preset: PersonalityId): number => {
      let killTick = -1;
      const match = createHeadlessMatch({
        recipe: duel(persona('p', preset), { hp: 25 }),
        map: field([
          { x: 15, z: 60, yaw: 0, team: 0 },
          { x: 15, z: 45, yaw: Math.PI, team: 1 },
        ]),
        humans: 1,
        primaries: [],
        onEvents: (events: readonly SimEvent[], sim: Sim) => {
          for (const ev of events) {
            if (killTick < 0 && ev.type === 'kill' && ev.killer === sim.controllerEntity(BOT)) killTick = sim.tick;
          }
        },
      });
      for (let i = 0; i < 10 * SIM_HZ && killTick < 0; i++) match.step();
      expect(killTick).toBeGreaterThan(0);
      const b = entity(match.sim, BOT);
      const v = match.sim.view();
      let turned = 0;
      let last = v.yaw[b]!;
      for (let i = 0; i < 1.5 * SIM_HZ; i++) {
        match.step();
        turned += Math.abs(angleDelta(last, v.yaw[b]!));
        last = v.yaw[b]!;
      }
      match.dispose();
      return turned;
    };
    expect(spin('clown')).toBeGreaterThan(4 * Math.PI);
    expect(spin('balanced')).toBeLessThan(Math.PI);
  });
});

describe('bots de fábrica com loadout restrito', () => {
  for (const [id, weapon, startM] of [
    ['knife-ninja', WEAPON_CODE.knife, 14],
    ['jorge-the-immortal', WEAPON_CODE.shotgun, 14],
    ['camper-carl', WEAPON_CODE.sniper, 4],
  ] as const) {
    it(`${id} acerta o humano só com a arma dele`, () => {
      let hits = 0;
      const match = createHeadlessMatch({
        recipe: duel(`builtin:${id}`, { hp: 1000 }),
        map: field([
          { x: 15, z: 80, yaw: 0, team: 0 },
          { x: 15, z: 80 - startM, yaw: Math.PI, team: 1 },
        ]),
        humans: 1,
        primaries: [],
        onEvents: (events: readonly SimEvent[], sim: Sim) => {
          for (const ev of events) {
            if (ev.type !== 'hit' || ev.shooter !== sim.controllerEntity(BOT)) continue;
            expect(sim.view().weapon[entity(sim, BOT)]).toBe(weapon);
            hits++;
          }
        },
      });
      match.run(15 * SIM_HZ);
      expect(hits).toBeGreaterThan(0);
      match.dispose();
    });
  }
});
