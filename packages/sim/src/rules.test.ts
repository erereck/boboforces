import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, type InputFrame } from '@boboforces/input';
import { pitchToI16, yawToU16 } from '@boboforces/shared';
import { cellCenter, createTestBlocks, createWorldGrid, fillBox, makeCell, type MapSpawn } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { METRICS } from './config/metrics.ts';
import { MATCH_DEFAULTS } from './config/rules.ts';
import { WEAPON_CODE } from './config/weapons.ts';
import { SIM_HZ } from './constants.ts';
import { WEAPON_KILL_PLANE } from './context.ts';
import { entityIndex, NULL_ENTITY } from './entity.ts';
import type { KillEvent, SimEvent } from './events.ts';
import { aimPointWorld, type AimPoint } from './hitbox.ts';
import { createInputFrames } from './loop.ts';
import { createSim, type Sim, type SimMap } from './sim.ts';

/**
 * M2, fase 2a: regras da partida (gameplay.md §2.2, §5.1 e §5.3; GDD §3.8). Contagem inicial, morte súbita, vencedor
 * do FFA, assistência, crédito do plano de morte e spawn pontuado no FFA e no TDM.
 */

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);
const FLOOR = 0.5;
const PAST_PROTECTION = Math.round(1.6 * SIM_HZ);

type Grid = ReturnType<typeof createWorldGrid>;

/** Chão de 20 × 40 m (ou só até `floorZ` m, com o vazio depois). */
function flatMap(spawns: MapSpawn[], floorZ = 40, build?: (grid: Grid) => void): SimMap {
  const grid = createWorldGrid(40, 16, 80);
  fillBox(grid, 0, 0, 0, 39, 0, floorZ * 2 - 1, concrete);
  build?.(grid);
  return { grid, blocks, spawns };
}

/** Chão de 40 × 80 m com uma parede de 5 m atravessada em z = 60 m (para os testes de spawn). */
function bigMap(spawns: MapSpawn[]): SimMap {
  const grid = createWorldGrid(80, 16, 160);
  fillBox(grid, 0, 0, 0, 79, 0, 159, concrete);
  fillBox(grid, 0, 1, 120, 79, 10, 120, concrete);
  return { grid, blocks, spawns };
}

function recipe(mode: string, teams: MatchRecipe['teams'], match?: MatchRecipe['match']): MatchRecipe {
  return { format: MATCH_RECIPE_FORMAT, mode, map: 'test', seed: 23, teams, ...(match ? { match } : {}) };
}

const DUEL_TEAMS: MatchRecipe['teams'] = [
  { humans: 1, bots: [] },
  { humans: 1, bots: [] },
];

function spawn(z: number, team: number, x = cellCenter(20)): MapSpawn {
  return { x, y: FLOOR, z, yaw: 0, team };
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

function entity(sim: Sim, c: number): number {
  return entityIndex(sim.controllerEntity(c));
}

function torsoOf(sim: Sim, c: number): AimPoint {
  const p: AimPoint = { x: 0, y: 0, z: 0 };
  aimPointWorld(sim.view(), entity(sim, c), false, p);
  return p;
}

function aimAt(sim: Sim, f: InputFrame, c: number, p: AimPoint): void {
  const v = sim.view();
  const e = entity(sim, c);
  const dx = p.x - v.position[e * 3]!;
  const dy = p.y - (v.position[e * 3 + 1]! + METRICS.eyeHeight);
  const dz = p.z - v.position[e * 3 + 2]!;
  f.yaw = yawToU16(Math.atan2(-dx, -dz));
  f.pitch = pitchToI16(Math.atan2(dy, Math.hypot(dx, dz)));
}

/** O controlador `c` atira em `target` até `stop` dizer chega (no máximo 5 s). Devolve as mortes do caminho. */
function shoot(sim: Sim, f: InputFrame[], c: number, target: number, stop: () => boolean): KillEvent[] {
  const kills: KillEvent[] = [];
  for (let i = 0; i < 5 * SIM_HZ && !stop(); i++) {
    aimAt(sim, f[c]!, c, torsoOf(sim, target));
    f[c]!.buttons = BUTTON.fire | BUTTON.ads;
    run(sim, f, 1, (events) => {
      for (const ev of events) if (ev.type === 'kill') kills.push(ev);
    });
  }
  f[c]!.buttons = 0;
  return kills;
}

function healthOf(sim: Sim, c: number): number {
  return sim.view().health[entity(sim, c)]!;
}

function dead(sim: Sim, c: number): boolean {
  return healthOf(sim, c) <= 0;
}

describe('contagem inicial', () => {
  it('3 s olhando em volta: não anda, não atira, não troca de arma e o relógio não corre', () => {
    const map = flatMap([spawn(25, 0), spawn(15, 1)]);
    const sim = createSim({
      recipe: recipe('warfare.tdm', DUEL_TEAMS, { timeLimitS: 180 }),
      map,
      humans: 2,
      countdownS: MATCH_DEFAULTS.countdownS,
    });
    const f = createInputFrames();
    const ticks = MATCH_DEFAULTS.countdownS * SIM_HZ;
    const v = sim.view();
    expect([v.match.phase, v.match.countdownTicks]).toEqual(['warmup', ticks]);
    const e = entity(sim, 0);
    const z0 = v.position[e * 3 + 2]!;
    const clock = v.match.ticksLeft;
    f[0]!.buttons = BUTTON.fire;
    f[0]!.moveY = 127;
    f[0]!.weapon = 1;
    f[0]!.yaw = yawToU16(1);
    const phases: string[] = [];
    let shots = 0;
    run(sim, f, ticks, (events) => {
      for (const ev of events) {
        if (ev.type === 'shot') shots++;
        if (ev.type === 'matchPhase') phases.push(ev.phase);
      }
    });
    expect(shots).toBe(0);
    expect(v.position[e * 3 + 2]).toBe(z0);
    expect(v.slot[e]).toBe(0);
    expect(v.yaw[e]).toBeCloseTo(1, 3);
    expect(v.match.ticksLeft).toBe(clock);
    // O evento da fase inicial (do construtor) sai junto com os do 1º tick.
    expect([v.match.phase, v.match.countdownTicks, phases]).toEqual(['playing', 0, ['warmup', 'playing']]);
    run(sim, f, 30);
    expect(v.position[e * 3 + 2]).not.toBe(z0);
    expect(v.match.ticksLeft).toBe(clock - 30);
  });

  it('sem contagem (padrão da sim), a partida já começa jogando', () => {
    const sim = createSim({ recipe: recipe('warfare.tdm', DUEL_TEAMS), map: flatMap([spawn(25, 0)]), humans: 2 });
    expect([sim.view().match.phase, sim.view().match.countdownTicks]).toEqual(['playing', 0]);
  });
});

describe('fim da partida', () => {
  function duel(timeLimitS: number): { sim: Sim; f: InputFrame[] } {
    const map = flatMap([spawn(25, 0), spawn(15, 1)]);
    const sim = createSim({
      recipe: recipe('warfare.tdm', DUEL_TEAMS, { timeLimitS }),
      map,
      humans: 2,
      primaries: [WEAPON_CODE.rifle, WEAPON_CODE.rifle],
    });
    return { sim, f: createInputFrames() };
  }

  it('empate no fim do tempo abre 60 s de morte súbita; o abate que desempata encerra', () => {
    const { sim, f } = duel(2);
    const phases: string[] = [];
    run(sim, f, 2 * SIM_HZ, (events) => {
      for (const ev of events) if (ev.type === 'matchPhase') phases.push(ev.phase);
    });
    const m = sim.view().match;
    expect([m.phase, m.ticksLeft, phases]).toEqual([
      'suddenDeath',
      MATCH_DEFAULTS.suddenDeathS * SIM_HZ,
      ['playing', 'suddenDeath'],
    ]);
    const kills = shoot(sim, f, 0, 1, () => dead(sim, 1));
    expect(kills.length).toBe(1);
    expect([m.phase, m.winnerTeam, m.winnerEntity]).toEqual(['ended', 0, NULL_ENTITY]);
  });

  it('a morte súbita sem abate acaba empatada', () => {
    const { sim, f } = duel(2);
    run(sim, f, (2 + MATCH_DEFAULTS.suddenDeathS) * SIM_HZ);
    const m = sim.view().match;
    expect([m.phase, m.winnerTeam]).toEqual(['ended', -1]);
  });

  it('FFA: a meta encerra e o vencedor é o bobo (winnerEntity)', () => {
    const map = flatMap([spawn(25, -1), spawn(20, -1), spawn(5, -1)]);
    const sim = createSim({
      recipe: recipe('warfare.ffa', [{ humans: 'all', bots: [] }], { scoreLimit: 1 }),
      map,
      humans: 2,
    });
    const f = createInputFrames();
    run(sim, f, PAST_PROTECTION);
    shoot(sim, f, 0, 1, () => dead(sim, 1));
    const m = sim.view().match;
    expect([m.phase, m.winnerTeam, m.winnerEntity]).toEqual(['ended', 0, sim.controllerEntity(0)]);
  });
});

describe('assistência', () => {
  /** A (0) e C (1) no time 0, B (2) no time 1, a 10 m. */
  function trio(): { sim: Sim; f: InputFrame[] } {
    const map = flatMap([spawn(25, 0, cellCenter(16)), spawn(25, 0, cellCenter(24)), spawn(15, 1)]);
    const sim = createSim({
      recipe: recipe('warfare.tdm', [
        { humans: 2, bots: [] },
        { humans: 1, bots: [] },
      ]),
      map,
      humans: 3,
    });
    const f = createInputFrames();
    run(sim, f, PAST_PROTECTION);
    return { sim, f };
  }

  it('25 de dano ou mais nos últimos 10 s viram assistência; o KillEvent leva o assistente', () => {
    const { sim, f } = trio();
    shoot(sim, f, 0, 2, () => healthOf(sim, 2) <= 60);
    const kills = shoot(sim, f, 1, 2, () => dead(sim, 2));
    expect(kills.map((k) => [k.killer, k.assister])).toEqual([[sim.controllerEntity(1), sim.controllerEntity(0)]]);
    const v = sim.view();
    expect([v.assists[entity(sim, 0)], v.assists[entity(sim, 1)], v.kills[entity(sim, 1)]]).toEqual([1, 0, 1]);
  });

  it('o dano de mais de 10 s atrás não conta', () => {
    const { sim, f } = trio();
    shoot(sim, f, 0, 2, () => healthOf(sim, 2) <= 60);
    run(sim, f, (MATCH_DEFAULTS.assistWindowS + 0.5) * SIM_HZ);
    const kills = shoot(sim, f, 1, 2, () => dead(sim, 2));
    expect(kills.map((k) => k.assister)).toEqual([NULL_ENTITY]);
    expect(sim.view().assists[entity(sim, 0)]).toBe(0);
  });
});

describe('plano de morte', () => {
  /** O 1 fica a 1,5 m da beira do chão (z = 20 m), olhando para o vazio; o 0 está a 10 m dele. */
  function edge(): { sim: Sim; f: InputFrame[] } {
    const sim = createSim({
      recipe: recipe('warfare.tdm', DUEL_TEAMS),
      map: flatMap([spawn(8.5, 0), spawn(18.5, 1)], 20),
      humans: 2,
    });
    const f = createInputFrames();
    f[1]!.yaw = yawToU16(Math.PI);
    run(sim, f, PAST_PROTECTION);
    return { sim, f };
  }

  function walkOff(sim: Sim, f: InputFrame[]): KillEvent[] {
    const kills: KillEvent[] = [];
    f[1]!.moveY = 127;
    run(sim, f, 4 * SIM_HZ, (events) => {
      for (const ev of events) if (ev.type === 'kill') kills.push(ev);
    });
    return kills;
  }

  it('quem feriu a vítima nos últimos 5 s leva o abate e o ponto', () => {
    const { sim, f } = edge();
    shoot(sim, f, 0, 1, () => healthOf(sim, 1) < 100);
    const kills = walkOff(sim, f);
    expect(kills.map((k) => [k.killer, k.weapon])).toEqual([[sim.controllerEntity(0), WEAPON_KILL_PLANE]]);
    expect([sim.view().kills[entity(sim, 0)], sim.view().match.teamScore[0]]).toEqual([1, 1]);
  });

  it('sem ninguém, é acidente: não conta para ninguém', () => {
    const { sim, f } = edge();
    const kills = walkOff(sim, f);
    expect(kills.map((k) => [k.killer, k.weapon])).toEqual([[NULL_ENTITY, WEAPON_KILL_PLANE]]);
    expect([sim.view().kills[entity(sim, 0)], sim.view().match.teamScore[0]]).toEqual([0, 0]);
  });
});

describe('spawn pontuado', () => {
  /**
   * O matador (0) fica em z = 40 m; a vítima (1) começa a 5 m dele. Os outros pontos ficam a 35 m: um à vista (z =
   * 5 m) e um atrás da parede de z = 60 m (z = 75 m). Mesma distância: só a visão separa os dois.
   */
  function respawnSpots(mode: string, seeds: number[]): number[] {
    const ffa = mode === 'warfare.ffa';
    const team = ffa ? -1 : 1;
    const spawns = [spawn(40, ffa ? -1 : 0), spawn(45, team), spawn(5, team), spawn(75, team)];
    const teams: MatchRecipe['teams'] = ffa ? [{ humans: 'all', bots: [] }] : DUEL_TEAMS;
    return seeds.map((seed) => {
      const sim = createSim({ recipe: { ...recipe(mode, teams), seed }, map: bigMap(spawns), humans: 2 });
      const f = createInputFrames();
      run(sim, f, PAST_PROTECTION);
      shoot(sim, f, 0, 1, () => dead(sim, 1));
      expect(dead(sim, 1)).toBe(true);
      run(sim, f, (MATCH_DEFAULTS.respawnS + 0.2) * SIM_HZ);
      return sim.view().position[entity(sim, 1) * 3 + 2]!;
    });
  }

  it('FFA: só o ponto a mais de 20 m e sem linha de visão do inimigo', () => {
    expect(new Set(respawnSpots('warfare.ffa', [1, 2, 3, 4, 5, 6]))).toEqual(new Set([75]));
  });

  it('TDM: o ponto do time com menos inimigos à vista', () => {
    expect(new Set(respawnSpots('warfare.tdm', [1, 2, 3, 4, 5, 6]))).toEqual(new Set([75]));
  });
});
