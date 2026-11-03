import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, createInputFrame, quantizeAxis, type InputFrame } from '@boboforces/input';
import { BitReader, BitWriter, pitchToI16, yawToU16 } from '@boboforces/shared';
import {
  buildTestArena,
  cellCenter,
  createTestBlocks,
  createWorldGrid,
  fillBox,
  makeCell,
  type MapSpawn,
} from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { METRICS } from './config/metrics.ts';
import { MOVEMENT_BOBO } from './config/movement.ts';
import { WEAPON_RIFLE } from './config/weapons.ts';
import { MAX_CONTROLLERS, SIM_HZ } from './constants.ts';
import { ENTITY_FLAG, NULL_ENTITY, entityIndex } from './entity.ts';
import type { SimEvent } from './events.ts';
import { createInputFrames, createSimLoop } from './loop.ts';
import { createSim, type Sim, type SimMap } from './sim.ts';

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);

/** Chão plano de 40 × 40 células (20 × 20 m) com topo em 0,5 m e os spawns dados. */
function flatMap(spawns: MapSpawn[], build?: (grid: ReturnType<typeof createWorldGrid>) => void): SimMap {
  const grid = createWorldGrid(40, 16, 40);
  fillBox(grid, 0, 0, 0, 39, 0, 39, concrete);
  build?.(grid);
  return { grid, blocks, spawns };
}

/** Dois humanos (controladores 0 e 1), um em cada time. */
function duelRecipe(overrides: Partial<MatchRecipe> = {}): MatchRecipe {
  return {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'test',
    seed: 7,
    teams: [
      { humans: 1, bots: [] },
      { humans: 1, bots: [] },
    ],
    ...overrides,
  };
}

function frames(): InputFrame[] {
  return createInputFrames();
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

function pos(sim: Sim, controller: number): [number, number, number] {
  const e = entityIndex(sim.controllerEntity(controller));
  const p = sim.view().position;
  return [p[e * 3]!, p[e * 3 + 1]!, p[e * 3 + 2]!];
}

function flagsOf(sim: Sim, controller: number): number {
  return sim.view().flags[entityIndex(sim.controllerEntity(controller))]!;
}

const FLOOR = 0.5;
/** A sul olhando para o norte (-Z, yaw 0) e a norte olhando para o sul. */
const south: MapSpawn = { x: cellCenter(20), y: FLOOR, z: 15, yaw: 0, team: 0 };
const north: MapSpawn = { x: cellCenter(20), y: FLOOR, z: 5, yaw: Math.PI, team: 1 };

describe('criação e contrato', () => {
  it('um bobo por controlador, nascido no spawn do time, com vida e munição cheias', () => {
    const sim = createSim({ recipe: duelRecipe(), map: flatMap([south, north]), humans: 2 });
    expect(sim.controllerCount).toBe(2);
    expect(sim.controllerEntity(0)).not.toBe(NULL_ENTITY);
    expect(sim.controllerEntity(5)).toBe(NULL_ENTITY);
    const v = sim.view();
    const e = entityIndex(sim.controllerEntity(1));
    expect(v.team[e]).toBe(1);
    expect(v.health[e]).toBe(100);
    expect(v.ammoClip[e]).toBe(WEAPON_RIFLE.clipSize);
    expect(pos(sim, 1)).toEqual([north.x, FLOOR, north.z]);
    const events: SimEvent[] = [];
    sim.step(frames());
    sim.drainEvents(events);
    expect(events.filter((ev) => ev.type === 'spawn')).toHaveLength(2);
    expect(events.some((ev) => ev.type === 'matchPhase')).toBe(true);
    // Drenar esvazia; o próximo step só traz os eventos dele.
    sim.drainEvents(events);
    expect(events.filter((ev) => ev.type === 'spawn')).toHaveLength(2);
    expect(sim.tick).toBe(1);
    expect(v.tick).toBe(1);
  });

  it('bots expandem a receita em ordem a partir do controlador 4', () => {
    const recipe = duelRecipe({
      teams: [
        { bots: [{ ref: 'builtin:normal-bob', count: 2 }] },
        { humans: 'all', bots: [{ ref: 'builtin:vibe-bob', count: 1 }] },
      ],
    });
    const sim = createSim({ recipe, map: flatMap([south, north]), humans: 1 });
    const v = sim.view();
    expect(v.team[entityIndex(sim.controllerEntity(0))]).toBe(1);
    expect(v.team[entityIndex(sim.controllerEntity(4))]).toBe(0);
    expect(v.team[entityIndex(sim.controllerEntity(5))]).toBe(0);
    expect(v.team[entityIndex(sim.controllerEntity(6))]).toBe(1);
    expect(sim.controllerCount).toBe(7);
  });
});

describe('movimento (perfil Bobo)', () => {
  it('parado continua no chão; andando chega na velocidade de andar; correndo na de sprint', () => {
    const sim = createSim({ recipe: duelRecipe(), map: flatMap([south, north]), humans: 2 });
    const f = frames();
    run(sim, f, 30);
    expect(pos(sim, 0)[1]).toBe(FLOOR);
    expect(flagsOf(sim, 0) & ENTITY_FLAG.onGround).toBeTruthy();

    f[0]!.moveY = quantizeAxis(1);
    run(sim, f, 30);
    const v = sim.view().velocity;
    const e = entityIndex(sim.controllerEntity(0));
    expect(Math.hypot(v[e * 3]!, v[e * 3 + 2]!)).toBeCloseTo(MOVEMENT_BOBO.walk, 5);
    expect(v[e * 3 + 2]!).toBeLessThan(0); // yaw 0 anda para -Z

    f[0]!.buttons = BUTTON.sprint;
    run(sim, f, 20);
    expect(Math.hypot(v[e * 3]!, v[e * 3 + 2]!)).toBeCloseTo(MOVEMENT_BOBO.sprint, 5);
    expect(flagsOf(sim, 0) & ENTITY_FLAG.sprinting).toBeTruthy();

    // Soltou tudo: o atrito para o bobo.
    f[0]!.buttons = 0;
    f[0]!.moveY = 0;
    run(sim, f, 60);
    expect(Math.hypot(v[e * 3]!, v[e * 3 + 2]!)).toBe(0);
  });

  it('pulo alcança 1,0 m e volta ao chão', () => {
    const sim = createSim({ recipe: duelRecipe(), map: flatMap([south, north]), humans: 2 });
    const f = frames();
    run(sim, f, 2);
    f[0]!.buttons = BUTTON.jump;
    let peak = 0;
    let jumps = 0;
    let lands = 0;
    for (let i = 0; i < 60; i++) {
      run(sim, f, 1, (events) => {
        for (const ev of events) {
          if (ev.type === 'move' && ev.move === 'jump') jumps++;
          if (ev.type === 'move' && ev.move === 'land') lands++;
        }
      });
      f[0]!.buttons = 0;
      peak = Math.max(peak, pos(sim, 0)[1] - FLOOR);
    }
    expect(jumps).toBe(1);
    expect(lands).toBe(1);
    expect(peak).toBeGreaterThan(METRICS.jumpHeight - 0.02);
    expect(peak).toBeLessThanOrEqual(METRICS.jumpHeight + 1e-9);
    expect(pos(sim, 0)[1]).toBe(FLOOR);
  });

  it('sobe degrau de 0,5 m andando e caixote de 1,0 m pulando', () => {
    // Degrau de 0,5 m em z = 11,0..11,5 m; caixote de 1,0 m em z = 8,0..8,5 m (o bobo anda para -Z a partir de z = 15).
    const map = flatMap([south, north], (grid) => {
      fillBox(grid, 0, 1, 22, 39, 1, 22, concrete);
      fillBox(grid, 0, 1, 16, 39, 2, 16, concrete);
    });
    const sim = createSim({ recipe: duelRecipe(), map, humans: 2 });
    const f = frames();
    f[0]!.moveY = quantizeAxis(1);
    let steps = 0;
    run(sim, f, 50, (events) => {
      for (const ev of events) if (ev.type === 'move' && ev.move === 'step') steps++;
    });
    expect(steps).toBe(1);
    // Passou do degrau e desceu do outro lado; agora parado na frente do caixote de 1 m.
    run(sim, f, 30);
    const [, y, z] = pos(sim, 0);
    expect(y).toBe(FLOOR);
    expect(z).toBeCloseTo(8.5 + METRICS.aabbWidth / 2, 5);
    // Pula e segue andando: o "mantle" do ar (0,5 m) põe o bobo em cima.
    f[0]!.buttons = BUTTON.jump;
    run(sim, f, 1);
    f[0]!.buttons = 0;
    run(sim, f, 40);
    expect(pos(sim, 0)[2]).toBeLessThan(8.5);
  });

  it('agachar abaixa a caixa; agachar correndo desliza a 8 m/s', () => {
    const sim = createSim({ recipe: duelRecipe(), map: flatMap([south, north]), humans: 2 });
    const f = frames();
    f[0]!.moveY = quantizeAxis(1);
    f[0]!.buttons = BUTTON.sprint;
    run(sim, f, 30);
    let slides = 0;
    f[0]!.buttons = BUTTON.sprint | BUTTON.crouch;
    run(sim, f, 1, (events) => {
      for (const ev of events) if (ev.type === 'move' && ev.move === 'slide') slides++;
    });
    expect(slides).toBe(1);
    expect(flagsOf(sim, 0) & ENTITY_FLAG.sliding).toBeTruthy();
    const v = sim.view().velocity;
    const e = entityIndex(sim.controllerEntity(0));
    expect(Math.hypot(v[e * 3]!, v[e * 3 + 2]!)).toBeGreaterThan(7.5);
    run(sim, f, Math.round(MOVEMENT_BOBO.slide!.durationS * SIM_HZ) + 2);
    expect(flagsOf(sim, 0) & ENTITY_FLAG.sliding).toBe(0);
    expect(flagsOf(sim, 0) & ENTITY_FLAG.crouching).toBeTruthy();
    expect(Math.hypot(v[e * 3]!, v[e * 3 + 2]!)).toBeCloseTo(MOVEMENT_BOBO.crouch, 1);
  });

  it('fica morto exatamente respawnS (no mínimo 1 tick, mesmo com respawnS = 0)', () => {
    for (const [respawnS, expected] of [
      [0, 1],
      [3, 3 * SIM_HZ],
    ] as const) {
      const grid = createWorldGrid(40, 16, 40);
      fillBox(grid, 0, 0, 0, 3, 0, 3, concrete); // spawns sobre o vazio: morte pelo plano de morte
      const recipe = duelRecipe({ players: { respawnS } });
      const sim = createSim({ recipe, map: { grid, blocks, spawns: [south, north] }, humans: 2 });
      const f = frames();
      const me = sim.controllerEntity(0);
      let killTick = -1;
      let spawnTick = -1;
      let deadTicks = 0;
      for (let t = 0; t < 600 && spawnTick < 0; t++) {
        run(sim, f, 1, (events) => {
          for (const ev of events) {
            if (ev.type === 'kill' && ev.victim === me && killTick < 0) killTick = ev.tick;
            if (ev.type === 'spawn' && ev.entity === me && killTick >= 0) spawnTick = ev.tick;
          }
        });
        if (killTick >= 0 && spawnTick < 0 && flagsOf(sim, 0) & ENTITY_FLAG.dead) deadTicks++;
      }
      expect(killTick, `respawnS ${respawnS}`).toBeGreaterThan(0);
      expect(spawnTick - killTick, `respawnS ${respawnS}`).toBe(expected);
      expect(deadTicks, `respawnS ${respawnS}`).toBe(expected);
    }
  });

  it('cair no vazio passa do plano de morte e mata sem atacante', () => {
    const grid = createWorldGrid(40, 16, 40);
    fillBox(grid, 0, 0, 0, 3, 0, 3, concrete); // só um pedacinho de chão longe dos spawns
    const sim = createSim({ recipe: duelRecipe(), map: { grid, blocks, spawns: [south, north] }, humans: 2 });
    const kills: SimEvent[] = [];
    run(sim, frames(), 120, (events) => kills.push(...events.filter((e) => e.type === 'kill')));
    expect(kills.length).toBe(2);
    expect(kills[0]!.type === 'kill' && kills[0]!.killer).toBe(NULL_ENTITY);
  });
});

/** Aponta o controlador `c` para o ponto (x, y, z) a partir do olho. */
function aimAt(sim: Sim, f: InputFrame, c: number, x: number, y: number, z: number): void {
  const [px, py, pz] = pos(sim, c);
  const dx = x - px;
  const dy = y - (py + METRICS.eyeHeight);
  const dz = z - pz;
  f.yaw = yawToU16(Math.atan2(-dx, -dz));
  f.pitch = pitchToI16(Math.atan2(dy, Math.hypot(dx, dz)));
}

describe('fuzil hitscan, dano, morte e respawn', () => {
  it('mata em 4 tiros no tronco, conta o abate e renasce depois de 3 s', () => {
    const sim = createSim({ recipe: duelRecipe(), map: flatMap([south, north]), humans: 2 });
    const f = frames();
    run(sim, f, Math.round(1.6 * SIM_HZ)); // passa a proteção de spawn (1,5 s)
    const [tx, ty, tz] = pos(sim, 1);
    aimAt(sim, f[0]!, 0, tx, ty + 0.75, tz);
    f[0]!.buttons = BUTTON.fire | BUTTON.ads;
    const hits: number[] = [];
    let kill: SimEvent | undefined;
    let shots = 0;
    run(sim, f, 60, (events) => {
      for (const ev of events) {
        if (ev.type === 'shot') shots++;
        if (ev.type === 'hit') hits.push(ev.damage);
        if (ev.type === 'kill') kill = ev;
      }
      if (kill) f[0]!.buttons = 0;
    });
    expect(kill).toBeDefined();
    expect(kill?.type === 'kill' && kill.killer).toBe(sim.controllerEntity(0));
    expect(kill?.type === 'kill' && kill.weapon).toBe(0);
    // ADS parado a 10 m: os 4 tiros pegam no tronco (28) ou na cabeça (42, se o recuo subir), nada nos membros.
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(hits.length).toBeLessThanOrEqual(4);
    for (const d of hits) expect([28, 42]).toContain(d);
    const v = sim.view();
    const shooter = entityIndex(sim.controllerEntity(0));
    const victim = entityIndex(sim.controllerEntity(1));
    expect(v.kills[shooter]).toBe(1);
    expect(v.deaths[victim]).toBe(1);
    expect(v.match.teamScore[0]).toBe(1);
    expect(v.flags[victim]! & ENTITY_FLAG.dead).toBeTruthy();
    expect(v.ammoClip[shooter]).toBe(WEAPON_RIFLE.clipSize - shots);

    let spawned = false;
    run(sim, f, 3 * SIM_HZ, (events) => {
      if (events.some((ev) => ev.type === 'spawn' && ev.entity === sim.controllerEntity(1))) spawned = true;
    });
    expect(spawned).toBe(true);
    expect(v.health[victim]).toBe(100);
    expect(v.flags[victim]! & ENTITY_FLAG.spawnProtected).toBeTruthy();
    expect(sim.controllerEntity(1)).toBe(kill?.type === 'kill' ? kill.victim : -1);
  });

  it('cadência média igual à da arma a 30 e a 60 Hz (o resto do tick passa para o tiro seguinte)', () => {
    const rifle = WEAPON_RIFLE as { rpm: number };
    const original = rifle.rpm;
    try {
      for (const rpm of [400, 600, 700, 850, 1200]) {
        // Tempo de ~25 tiros (o pente tem 30): conta os tiros com o gatilho preso, numa parede a 2 m.
        const seconds = (25 * 60) / rpm;
        for (const hz of [60, 30]) {
          rifle.rpm = rpm;
          const map = flatMap([south, north], (grid) => fillBox(grid, 0, 1, 26, 39, 8, 26, concrete));
          const sim = createSim({ recipe: duelRecipe(), map, humans: 2, hz });
          const f = frames();
          f[0]!.buttons = BUTTON.fire;
          let shots = 0;
          run(sim, f, Math.round(seconds * hz), (events) => {
            for (const ev of events) if (ev.type === 'shot' && ev.shooter === sim.controllerEntity(0)) shots++;
          });
          // O 1º tiro sai no tick 0; os outros a cada 60/rpm s em média (±1 pelo arredondamento do fim da janela).
          expect(Math.abs(shots - (1 + seconds * (rpm / 60))), `rpm ${rpm} a ${hz} Hz: ${shots} tiros`).toBeLessThan(
            1.01,
          );
        }
      }
    } finally {
      rifle.rpm = original;
    }
  });

  it('soltar o gatilho não acumula tiro adiantado (sem rajada depois de esperar)', () => {
    const map = flatMap([south, north], (grid) => fillBox(grid, 0, 1, 26, 39, 8, 26, concrete));
    const sim = createSim({ recipe: duelRecipe(), map, humans: 2 });
    const f = frames();
    const shotTicks: number[] = [];
    const onEvents = (events: SimEvent[]): void => {
      for (const ev of events)
        if (ev.type === 'shot' && ev.shooter === sim.controllerEntity(0)) shotTicks.push(ev.tick);
    };
    f[0]!.buttons = BUTTON.fire;
    run(sim, f, 1, onEvents);
    f[0]!.buttons = 0;
    run(sim, f, 60, onEvents);
    f[0]!.buttons = BUTTON.fire;
    run(sim, f, 20, onEvents);
    // 600/min = 6 ticks: depois da espera, o 2º tiro da rajada nova sai 6 ticks depois do 1º, não antes.
    expect(shotTicks.length).toBeGreaterThanOrEqual(3);
    expect(shotTicks[2]! - shotTicks[1]!).toBe(6);
  });

  it('parede para a bala (evento de impacto, sem dano)', () => {
    const map = flatMap([south, north], (grid) => fillBox(grid, 0, 1, 20, 39, 6, 20, concrete));
    const sim = createSim({ recipe: duelRecipe(), map, humans: 2 });
    const f = frames();
    run(sim, f, 100);
    const [tx, ty, tz] = pos(sim, 1);
    aimAt(sim, f[0]!, 0, tx, ty + 0.75, tz);
    f[0]!.buttons = BUTTON.fire;
    let impacts = 0;
    let hits = 0;
    run(sim, f, 30, (events) => {
      for (const ev of events) {
        if (ev.type === 'impact') impacts++;
        if (ev.type === 'hit') hits++;
      }
    });
    expect(impacts).toBeGreaterThan(0);
    expect(hits).toBe(0);
  });

  it('recarrega sozinho com o pente vazio e o recuo sobe e volta', () => {
    const sim = createSim({ recipe: duelRecipe(), map: flatMap([south, north]), humans: 2 });
    const f = frames();
    f[0]!.pitch = pitchToI16(0.6); // atira para o alto
    f[0]!.buttons = BUTTON.fire;
    const actions: string[] = [];
    let maxRecoil = 0;
    const e = entityIndex(sim.controllerEntity(0));
    // 30 tiros a cada 0,1 s (3 s) + recarga de 2,2 s.
    run(sim, f, 330, (events) => {
      for (const ev of events) if (ev.type === 'weapon') actions.push(ev.action);
      maxRecoil = Math.max(maxRecoil, sim.view().recoilPitch[e]!);
    });
    expect(actions).toContain('reloadStart');
    expect(actions).toContain('reloadEnd');
    expect(maxRecoil).toBeGreaterThan(0.03);
    f[0]!.buttons = 0;
    run(sim, f, 60);
    expect(sim.view().recoilPitch[e]).toBe(0);
    expect(sim.view().ammoReserve[e]).toBe(WEAPON_RIFLE.reserve - WEAPON_RIFLE.clipSize);
  });

  it('correndo não atira', () => {
    const sim = createSim({ recipe: duelRecipe(), map: flatMap([south, north]), humans: 2 });
    const f = frames();
    f[0]!.moveY = quantizeAxis(1);
    f[0]!.buttons = BUTTON.sprint | BUTTON.fire;
    let shots = 0;
    run(sim, f, 30, (events) => (shots += events.filter((ev) => ev.type === 'shot').length));
    expect(shots).toBe(0);
  });
});

/** Inputs roteirizados (determinísticos) para os testes de hash e snapshot. */
function scripted(f: InputFrame[], tick: number): void {
  for (let c = 0; c < 2; c++) {
    const fr = f[c]!;
    fr.seq = tick & 0xffff;
    fr.moveY = quantizeAxis(Math.sin(tick * 0.05 + c));
    fr.moveX = quantizeAxis(Math.cos(tick * 0.031 + c * 2));
    fr.yaw = yawToU16(tick * 0.02 * (c === 0 ? 1 : -1));
    fr.pitch = pitchToI16(Math.sin(tick * 0.01) * 0.3);
    fr.buttons = (tick % 90 < 40 ? BUTTON.fire : 0) | (tick % 120 === 0 ? BUTTON.jump : 0);
  }
}

describe('determinismo e snapshot', () => {
  it('mesma receita e mesmos inputs dão o mesmo hash', () => {
    const hashes = [0, 1].map(() => {
      const sim = createSim({ recipe: duelRecipe(), map: buildTestArena(), humans: 2 });
      const f = frames();
      for (let t = 0; t < 600; t++) {
        scripted(f, t);
        sim.step(f);
      }
      return sim.stateHash();
    });
    expect(hashes[0]).toBe(hashes[1]);
  });

  it('ler o snapshot numa sim nova e seguir dá o mesmo hash', () => {
    const map = buildTestArena();
    const a = createSim({ recipe: duelRecipe(), map, humans: 2 });
    const f = frames();
    for (let t = 0; t < 400; t++) {
      scripted(f, t);
      a.step(f);
    }
    const w = new BitWriter(64 * 1024);
    a.writeSnapshot(w);
    const b = createSim({ recipe: duelRecipe(), map, humans: 2 });
    expect(b.stateHash()).not.toBe(a.stateHash());
    b.readSnapshot(new BitReader(w.bytes()));
    expect(b.stateHash()).toBe(a.stateHash());
    expect(b.tick).toBe(400);
    for (let t = 400; t < 800; t++) {
      scripted(f, t);
      a.step(f);
      b.step(f);
    }
    expect(b.stateHash()).toBe(a.stateHash());
  });

  it('o laço de passo fixo roda no máximo 4 ticks por frame e chama a IA antes de cada um', () => {
    const sim = createSim({ recipe: duelRecipe(), map: flatMap([south, north]), humans: 2 });
    let before = 0;
    let after = 0;
    const loop = createSimLoop({
      sim,
      frames: frames(),
      beforeTick: () => before++,
      afterTick: (_, events) => {
        after++;
        expect(Array.isArray(events)).toBe(true);
      },
    });
    expect(loop.frame(2.5 / SIM_HZ)).toBe(2);
    expect(loop.alpha).toBeCloseTo(0.5);
    expect(loop.frame(5)).toBe(4);
    expect(before).toBe(6);
    expect(after).toBe(6);
    expect(sim.tick).toBe(6);
    expect(createInputFrames()).toHaveLength(MAX_CONTROLLERS);
    expect(createInputFrame().weapon).toBe(0);
  });
});
