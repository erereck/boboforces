import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, quantizeAxis } from '@boboforces/input';
import { BitReader, BitWriter, yawToU16 } from '@boboforces/shared';
import { BLOCK_FLAG, cellCenter, createBlockRegistry, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { runnerChance, ZOMBIE_TYPE, ZOMBIES_MODE, zombiesInWave, zombieWaveHp } from './config/zombie.ts';
import { SIM_HZ, ZOMBIE_CONTROLLER_BASE } from './constants.ts';
import { ENTITY_FLAG, ENTITY_KIND, NULL_ENTITY } from './entity.ts';
import type { DownEvent, SimEvent, WaveEvent } from './events.ts';
import { createInputFrames } from './loop.ts';
import { createSim, type Sim, type SimMap, type SpawnPoint } from './sim.ts';

const SOLID = BLOCK_FLAG.solid | BLOCK_FLAG.blocksBullets | BLOCK_FLAG.blocksSight | BLOCK_FLAG.walkable;
const blocks = createBlockRegistry([
  { key: 'concrete', shape: 'cube', faces: [1, 1, 1, 1, 1, 1], flags: SOLID, frames: 1, stepSound: 'concrete' },
]);
const concrete = makeCell(blocks.byKey('concrete')!.id);
const FLOOR = 0.5;

/** Chão das células z `floorFromZ` a 59 (0,5 m cada; antes disso, o vazio: quem nasce ali cai no plano de morte). */
function map(spawns: SpawnPoint[], floorFromZ = 0): SimMap {
  const grid = createWorldGrid(40, 16, 60);
  fillBox(grid, 0, 0, floorFromZ, 39, 0, 59, concrete);
  return { grid, blocks, spawns };
}

function zombies(overrides: MatchRecipe['zombies'] = {}): MatchRecipe {
  return {
    format: MATCH_RECIPE_FORMAT,
    mode: 'zombies',
    map: 'test',
    seed: 5,
    teams: [{ humans: 'all', bots: [] }],
    zombies: overrides,
  };
}

function run(sim: Sim, ticks: number, onEvents?: (events: SimEvent[]) => void): void {
  const f = createInputFrames();
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks && sim.view().match.phase !== 'ended'; i++) {
    sim.step(f);
    events.length = 0;
    sim.drainEvents(events);
    onEvents?.(events);
  }
}

/**
 * Roda a partida com os zumbis indo atrás de `target` e batendo (a sim não tem a IA: os quadros são escritos aqui). Para
 * no fim da partida, depois de `ticks` ou quando `stop` disser.
 */
function chase(
  sim: Sim,
  target: number,
  ticks: number,
  onEvents?: (events: SimEvent[]) => void,
  setup?: (f: ReturnType<typeof createInputFrames>) => void,
  stop?: () => boolean,
): void {
  const f = createInputFrames();
  const v = sim.view();
  const events: SimEvent[] = [];
  for (let t = 0; t < ticks && v.match.phase !== 'ended' && !(stop?.() ?? false); t++) {
    const te = target & 0xffff;
    for (let i = 0; i < 10; i++) {
      const id = sim.controllerEntity(ZOMBIE_CONTROLLER_BASE + i);
      const e = id & 0xffff;
      const dx = v.position[te * 3]! - v.position[e * 3]!;
      const dz = v.position[te * 3 + 2]! - v.position[e * 3 + 2]!;
      const zf = f[ZOMBIE_CONTROLLER_BASE + i]!;
      zf.yaw = yawToU16(Math.atan2(-dx, -dz));
      zf.moveY = quantizeAxis(dx * dx + dz * dz > 1 ? 1 : 0);
      zf.buttons = BUTTON.melee;
    }
    setup?.(f);
    sim.step(f);
    events.length = 0;
    sim.drainEvents(events);
    onEvents?.(events);
  }
}

const human: SpawnPoint = { x: cellCenter(20), y: FLOOR, z: 27, yaw: 0, team: 0 };

describe('Bobo Zombies: as fórmulas (GDD §4.1.5)', () => {
  it('quantidade, vida e quem corre por onda', () => {
    expect(zombiesInWave(1, 1, 1)).toBe(10);
    expect(zombiesInWave(10, 1, 1)).toBe(46);
    // 4 humanos: × 2,5.
    expect(zombiesInWave(1, 4, 1)).toBe(25);
    expect(zombiesInWave(2, 1, 0.5)).toBe(7);
    expect(zombieWaveHp(1, 1)).toBe(100);
    expect(zombieWaveHp(10, 1)).toBe(640);
    expect(zombieWaveHp(11, 1)).toBe(704);
    expect(zombieWaveHp(1, 2)).toBe(200);
    expect(runnerChance(4)).toBe(0);
    expect(runnerChance(5)).toBeCloseTo(1 / 6, 9);
    expect(runnerChance(9)).toBeCloseTo(5 / 6, 9);
    expect(runnerChance(10)).toBe(1);
  });
});

describe('Bobo Zombies: o diretor de ondas (M3, fase 2a)', () => {
  it('o pool começa fora de jogo; a 1ª onda abre depois do intervalo e solta os zumbis aos poucos', () => {
    const far: SpawnPoint = { x: cellCenter(20), y: FLOOR, z: 5, yaw: Math.PI, team: -1 };
    const sim = createSim({ recipe: zombies(), map: map([human, far]), humans: 1, zombies: 6 });
    const v = sim.view();
    let zombiesOut = 0;
    for (let e = 0; e < v.count; e++) {
      if (v.kind[e] === ENTITY_KIND.zombie) {
        zombiesOut++;
        expect(v.flags[e]! & ENTITY_FLAG.dead).not.toBe(0);
      }
    }
    expect(zombiesOut).toBe(6);
    expect(v.match.zombieWave).toBe(0);
    const starts: number[] = [];
    run(sim, ZOMBIES_MODE.firstWaveS * SIM_HZ + 2, (evs) => {
      for (const ev of evs) if (ev.type === 'wave' && ev.action === 'start') starts.push(ev.wave);
    });
    expect(starts).toEqual([1]);
    expect(v.match.zombieWave).toBe(1);
    expect(v.match.zombieRestTicks).toBe(-1);
    expect(v.match.zombiesLeft).toBe(10);
    // 2 s depois: ~4 soltos, com a vida da onda 1, andando.
    run(sim, 2 * SIM_HZ);
    let up = 0;
    for (let e = 0; e < v.count; e++) {
      if (v.kind[e] !== ENTITY_KIND.zombie || (v.flags[e]! & ENTITY_FLAG.dead) !== 0) continue;
      up++;
      expect(v.health[e]).toBe(100);
    }
    expect(up).toBeGreaterThanOrEqual(3);
    expect(up).toBeLessThanOrEqual(4);
    expect(v.match.zombiesLeft).toBe(10);
  });

  it('vitória: zumbis que caem no vazio limpam as 5 ondas do Relâmpago', () => {
    // Os zumbis nascem no ponto mais longe (z 5), sobre o vazio, e morrem no plano de morte.
    const void5: SpawnPoint = { x: cellCenter(20), y: FLOOR, z: 5, yaw: 0, team: -1 };
    const sim = createSim({
      recipe: zombies({ waves: 5, quantity: 0.5 }),
      map: map([human, void5], 30),
      humans: 1,
      zombies: 8,
    });
    const waves: string[] = [];
    run(sim, 200 * SIM_HZ, (evs) => {
      for (const ev of evs) if (ev.type === 'wave') waves.push(`${(ev as WaveEvent).action}${ev.wave}`);
    });
    const m = sim.view().match;
    expect(m.phase).toBe('ended');
    expect(m.winnerTeam).toBe(0);
    expect(waves).toEqual([
      'start1',
      'clear1',
      'start2',
      'clear2',
      'start3',
      'clear3',
      'start4',
      'clear4',
      'start5',
      'clear5',
    ]);
    expect(m.zombiesLeft).toBe(0);
  }, 60_000);

  it('derrota: o humano sozinho gasta os 3 "levanta sozinho" e, caído de novo sem ninguém, perde', () => {
    const far: SpawnPoint = { x: cellCenter(20), y: FLOOR, z: 10, yaw: Math.PI, team: -1 };
    const sim = createSim({ recipe: zombies(), map: map([human, far]), humans: 1, zombies: 10 });
    const target = sim.controllerEntity(0);
    const actions: string[] = [];
    chase(sim, target, 120 * SIM_HZ, (evs) => {
      for (const ev of evs) if (ev.type === 'down') actions.push((ev as DownEvent).action);
    });
    const m = sim.view().match;
    expect(m.phase).toBe('ended');
    expect(m.winnerTeam).toBe(-1);
    expect(m.zombieWave).toBe(1);
    expect(m.selfRevivesLeft).toBe(0);
    expect(actions).toEqual(['down', 'selfRevive', 'down', 'selfRevive', 'down', 'selfRevive', 'down']);
  }, 60_000);

  it('reviver: o colega de pé a 1 m segurando o usar levanta o caído em 3 s, com metade da vida', () => {
    const far: SpawnPoint = { x: cellCenter(20), y: FLOOR, z: 10, yaw: Math.PI, team: -1 };
    const p2: SpawnPoint = { ...human, z: human.z + 1 };
    const sim = createSim({ recipe: zombies(), map: map([human, p2, far]), humans: 2, zombies: 10 });
    const p1 = sim.controllerEntity(0);
    const helper = sim.controllerEntity(1);
    let downAt = -1;
    let revivedAt = -1;
    let by = 0;
    let hpAfter = -1;
    chase(
      sim,
      p1,
      60 * SIM_HZ,
      (evs) => {
        for (const ev of evs) {
          if (ev.type !== 'down' || ev.entity !== p1) continue;
          if (ev.action === 'down' && downAt < 0) downAt = ev.tick;
          if (ev.action === 'revive' && revivedAt < 0) {
            revivedAt = ev.tick;
            by = ev.by;
            hpAfter = sim.view().health[p1 & 0xffff]!;
          }
        }
      },
      (f) => (f[1]!.buttons = BUTTON.use),
      () => revivedAt >= 0,
    );
    expect(downAt).toBeGreaterThan(0);
    expect(by).toBe(helper);
    // 3 s segurando: o colega já segurava, e o próprio tick da queda conta como o primeiro.
    expect(revivedAt - downAt).toBe(3 * SIM_HZ - 1);
    expect(hpAfter).toBe(50);
  }, 60_000);

  it('o último zumbi da onda corre e fica marcado', () => {
    const void5: SpawnPoint = { x: cellCenter(20), y: FLOOR, z: 5, yaw: 0, team: -1 };
    const sim = createSim({ recipe: zombies({ quantity: 0.5 }), map: map([human, void5], 30), humans: 1, zombies: 8 });
    let marked = 0;
    const v = sim.view();
    run(sim, 40 * SIM_HZ, () => {
      const last = v.match.lastZombie;
      if (last === NULL_ENTITY) return;
      marked++;
      expect(v.zombieType[last & 0xffff]).toBe(ZOMBIE_TYPE.runner);
    });
    expect(marked).toBeGreaterThan(0);
  }, 60_000);

  it('snapshot: o estado das ondas vai e volta (hash igual e o mesmo futuro)', () => {
    const far: SpawnPoint = { x: cellCenter(20), y: FLOOR, z: 10, yaw: Math.PI, team: -1 };
    const make = () => createSim({ recipe: zombies(), map: map([human, far]), humans: 1, zombies: 10 });
    const a = make();
    const b = make();
    run(a, 9 * SIM_HZ);
    const w = new BitWriter(1 << 16);
    a.writeSnapshot(w);
    b.readSnapshot(new BitReader(w.bytes()));
    expect(b.stateHash()).toBe(a.stateHash());
    run(a, 3 * SIM_HZ);
    run(b, 3 * SIM_HZ);
    expect(b.stateHash()).toBe(a.stateHash());
    expect(b.view().match.zombieWave).toBe(1);
  });
});

describe('Bobo Zombies: pontos (M3, fase 2b)', () => {
  /** O humano olha para −Z (onde os zumbis nascem) e atira sem parar; devolve os pontos e os eventos que contam. */
  function shoot(economy: number): { points: number; hits: number; kills: number; heads: number } {
    const far: SpawnPoint = { x: cellCenter(20), y: FLOOR, z: 10, yaw: 0, team: -1 };
    const sim = createSim({ recipe: zombies({ economy }), map: map([human, far]), humans: 1, zombies: 4 });
    const f = createInputFrames();
    f[0]!.buttons = BUTTON.fire;
    const me = sim.controllerEntity(0);
    let hits = 0;
    let kills = 0;
    let heads = 0;
    const events: SimEvent[] = [];
    for (let t = 0; t < 14 * SIM_HZ; t++) {
      sim.step(f);
      events.length = 0;
      sim.drainEvents(events);
      for (const ev of events) {
        if (ev.type === 'hit' && ev.shooter === me && ev.damage > 0) hits++;
        if (ev.type === 'kill' && ev.killer === me) {
          kills++;
          if (ev.headshot) heads++;
        }
      }
    }
    return { points: sim.view().points[me & 0xffff]!, hits, kills, heads };
  }

  it('começa com 500; acerto 10, abate 60 (na cabeça 100); a economia multiplica', () => {
    const one = shoot(1);
    expect(one.kills).toBeGreaterThan(0);
    expect(one.points).toBe(500 + 10 * one.hits + 60 * (one.kills - one.heads) + 100 * one.heads);
    const two = shoot(2);
    expect(two.hits).toBe(one.hits);
    expect(two.points - 500).toBe(2 * (one.points - 500));
  });
});
