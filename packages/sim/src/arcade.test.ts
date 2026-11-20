import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe, type ModifierId } from '@boboforces/format';
import { BUTTON, FRAME_HUMAN } from '@boboforces/input';
import { BitReader, BitWriter } from '@boboforces/shared';
import { createTestBlocks, createWorldGrid, fillBox, makeCell, type WorldGrid } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { ARCADE_TUNING, MOVEMENT_ARCADE, MOVEMENT_BOBO, resolveMovementProfile } from './config/movement.ts';
import { BOT_CONTROLLER_BASE, SIM_HZ } from './constants.ts';
import { ENTITY_FLAG, entityIndex } from './entity.ts';
import type { SimEvent } from './events.ts';
import { createInputFrames } from './loop.ts';
import { createSim, PREDICT_STATE_SIZE } from './sim.ts';

/** M8 (fase 7): o perfil Arcade (GDD §4.2.2). */

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);

interface Rig {
  step(n?: number): void;
  readonly frame: ReturnType<typeof createInputFrames>[number];
  readonly events: SimEvent[];
  speed(): number;
  vx(): number;
  vz(): number;
  vy(): number;
  y(): number;
  z(): number;
  onGround(): boolean;
  health(): number;
  readonly sim: ReturnType<typeof createSim>;
}

/**
 * Um bobo num chão de 40 × 100 m (células de 0,5 m), olhando para −Z. `bot` = o corpo é de um bot (o controlador
 * dele é escrito pelo teste); `build` mexe no mapa.
 */
function rig(
  opts: {
    movement?: 'arcade' | 'bobo';
    modifiers?: ModifierId[];
    bot?: boolean;
    build?: (g: WorldGrid) => void;
    spawnY?: number;
    hz?: number;
  } = {},
): Rig {
  const grid = createWorldGrid(80, 40, 200);
  fillBox(grid, 0, 0, 0, 79, 0, 199, concrete);
  opts.build?.(grid);
  const recipe: MatchRecipe = {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'test',
    seed: 1,
    teams: [opts.bot ? { bots: [{ ref: builtinBotRef('normal'), count: 1 }] } : { humans: 1, bots: [] }],
    players: { movement: opts.movement ?? 'arcade' },
    ...(opts.modifiers ? { modifiers: opts.modifiers } : {}),
  };
  const spawn = { x: 20, y: opts.spawnY ?? 0.5, z: 95, yaw: 0, team: 0 };
  const sim = createSim({
    recipe,
    map: { grid, blocks, spawns: [spawn] },
    humans: opts.bot ? 0 : 1,
    countdownS: 0,
    ...(opts.hz !== undefined ? { hz: opts.hz } : {}),
  });
  const frames = createInputFrames();
  const ctl = opts.bot ? BOT_CONTROLLER_BASE : 0;
  const e = entityIndex(sim.controllerEntity(ctl));
  const v = sim.view();
  const events: SimEvent[] = [];
  return {
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        // O quadro de quem joga leva a marca (o mapeador liga em todo quadro); o do bot, não.
        if (!opts.bot) frames[ctl]!.buttons |= FRAME_HUMAN;
        sim.step(frames);
        sim.drainEvents(events);
      }
    },
    frame: frames[ctl]!,
    events,
    speed: () => Math.hypot(v.velocity[e * 3]!, v.velocity[e * 3 + 2]!),
    vx: () => v.velocity[e * 3]!,
    vz: () => v.velocity[e * 3 + 2]!,
    vy: () => v.velocity[e * 3 + 1]!,
    y: () => v.position[e * 3 + 1]!,
    z: () => v.position[e * 3 + 2]!,
    onGround: () => (v.flags[e]! & ENTITY_FLAG.onGround) !== 0,
    health: () => v.health[e]!,
    sim,
  };
}

/** O pico de um pulo (com um 2º toque no pulo `second` ticks depois do 1º; -1 = sem). */
function peak(r: Rig, second: number, third = -1): number {
  r.step(2);
  const y0 = r.y();
  let top = y0;
  for (let t = 0; t < 90; t++) {
    r.frame.buttons = t === 0 || t === second || t === third ? BUTTON.jump : 0;
    r.step();
    top = Math.max(top, r.y());
  }
  return top - y0;
}

/** O pico do pulo duplo a 30 Hz (o 2º toque 1/3 s depois, como os 20 ticks a 60 Hz). */
function peak30(): number {
  const r = rig({ hz: 30 });
  r.step(2);
  const y0 = r.y();
  let top = y0;
  for (let t = 0; t < 45; t++) {
    r.frame.buttons = t === 0 || t === 10 ? BUTTON.jump : 0;
    r.step();
    top = Math.max(top, r.y());
  }
  return top - y0;
}

describe('M8 (fase 7): o perfil Arcade', () => {
  it('os números da tabela (pelo perfil ou pelo modificador)', () => {
    expect(resolveMovementProfile({ movement: 'arcade' })).toBe(MOVEMENT_ARCADE);
    expect(resolveMovementProfile(undefined, ['arcade'])).toBe(MOVEMENT_ARCADE);
    expect(MOVEMENT_ARCADE).toMatchObject({ walk: 5.5, sprint: 8, jump: 1.3, mantleHeight: 2, fallDamage: false });
    expect(resolveMovementProfile(undefined)).toBe(MOVEMENT_BOBO);
  });

  it('pulo de 1,3 m e o duplo (um só por pulo; no Bobo, nada)', () => {
    const single = peak(rig(), -1);
    expect(single).toBeGreaterThan(1.25);
    expect(single).toBeLessThan(1.35);
    const double = peak(rig(), 20);
    expect(double).toBeGreaterThan(single + 0.8);
    // O 3º toque no ar não faz nada.
    expect(peak(rig(), 20, 40)).toBeCloseTo(double, 6);
    const bobo = peak(rig({ movement: 'bobo' }), 20);
    expect(bobo).toBeLessThan(1.05);
  });

  it('o modificador liga o Arcade numa partida de perfil Bobo', () => {
    expect(peak(rig({ movement: 'bobo', modifiers: ['arcade'] }), 20)).toBeGreaterThan(2);
  });

  it('bunny hop: +5% por pulo logo depois de pousar, até 12 m/s; o bot não ganha', () => {
    const hop = (bot: boolean): number[] => {
      const r = rig({ bot });
      r.frame.moveY = 127;
      r.frame.buttons = BUTTON.sprint;
      r.step(40);
      const speeds: number[] = [];
      for (let t = 0; t < 900 && speeds.length < 11; t++) {
        // Aperta o pulo no tick em que está no chão (a borda); no ar, solta.
        const ground = r.onGround();
        r.frame.buttons = BUTTON.sprint | (ground ? BUTTON.jump : 0);
        r.step();
        if (ground && !r.onGround()) speeds.push(r.speed());
      }
      return speeds;
    };
    const human = hop(false);
    expect(human.length).toBe(11);
    expect(human[3]!).toBeGreaterThan(human[0]! * 1.1);
    expect(Math.max(...human)).toBeLessThanOrEqual(ARCADE_TUNING.bhopMaxSpeed + 1e-6);
    expect(human.at(-1)!).toBeGreaterThan(ARCADE_TUNING.bhopMaxSpeed - 0.5);
    const bot = hop(true);
    expect(Math.max(...bot)).toBeLessThan(MOVEMENT_ARCADE.sprint + 0.5);
  });

  /** A velocidade vertical depois do tick do pulo: a do wall jump (pulo inteiro) ou a do duplo (0,9). */
  const after = (r: Rig): number => r.vy() + MOVEMENT_ARCADE.gravity / SIM_HZ;
  const jumpSpeed = Math.sqrt(2 * MOVEMENT_ARCADE.gravity * MOVEMENT_ARCADE.jump);

  /** Anda até a parede alta em −Z (a face em z = 93 m), pula e espera 8 ticks no ar, encostado. */
  function atWall(r: Rig): void {
    r.frame.moveY = 127;
    r.step(30);
    expect(r.z()).toBeLessThan(93.5);
    r.frame.buttons = BUTTON.jump;
    r.step();
    r.frame.buttons = 0;
    r.step(8);
  }
  const wall = (g: WorldGrid): void => fillBox(g, 0, 1, 184, 79, 30, 185, concrete);
  const press = (r: Rig): void => {
    r.frame.buttons = BUTTON.jump;
    r.step();
    r.frame.buttons = 0;
  };

  it('wall jump: sobe com o pulo inteiro e empurra para longe da parede; a mesma parede de novo vira o duplo', () => {
    const r = rig({ build: wall });
    atWall(r);
    r.frame.moveY = 0;
    press(r);
    expect(after(r)).toBeCloseTo(jumpSpeed, 1);
    expect(r.vz()).toBeGreaterThan(ARCADE_TUNING.wallPushSpeed - 0.5);
    // De volta até encostar na mesma parede (o controle no ar puxa) e um toque novo: o pulo duplo (0,9), sem
    // empurrão.
    r.frame.moveY = 127;
    for (let t = 0; t < 40 && r.z() > 93.32; t++) r.step();
    expect(r.z()).toBeLessThan(93.35);
    expect(r.onGround()).toBe(false);
    press(r);
    expect(after(r)).toBeCloseTo(jumpSpeed * ARCADE_TUNING.doubleJumpMul, 1);
    expect(r.vz()).toBeLessThan(0.5);
  });

  it('num corredor, no máximo dois wall jumps por voo (alternar as paredes não vira escada)', () => {
    // Paredes de 15 m dos dois lados de um corredor de 2,5 m (x de 19 a 21,5 m).
    const r = rig({
      build: (g) => {
        fillBox(g, 36, 1, 0, 37, 30, 199, concrete);
        fillBox(g, 43, 1, 0, 44, 30, 199, concrete);
      },
    });
    r.frame.moveX = -127;
    r.step(30);
    const y0 = r.y();
    press(r);
    r.frame.moveX = 0;
    let top = y0;
    for (let t = 0; t < 3 * SIM_HZ; t++) {
      r.frame.buttons = t % 4 === 0 ? BUTTON.jump : 0;
      r.step();
      top = Math.max(top, r.y());
    }
    // O do chão (1,3 m), dois nas paredes e o duplo não passam de uns 5 m (sem o teto, eram 40 m de escada).
    expect(top - y0).toBeLessThan(6);
  });

  it('meio-fio não é parede: o 2º toque perto dele, ainda baixo, é o pulo duplo (sem empurrão de lado)', () => {
    // Um meio-fio de 0,5 m a leste, encostado.
    const r = rig({ build: (g) => fillBox(g, 42, 1, 0, 42, 1, 199, concrete) });
    r.frame.moveX = 127;
    r.step(30);
    r.frame.moveX = 0;
    press(r);
    r.step(5);
    press(r);
    expect(after(r)).toBeCloseTo(jumpSpeed * ARCADE_TUNING.doubleJumpMul, 1);
    // Sem empurrão para longe do meio-fio (para −X): segue com a velocidade de antes, para +X.
    expect(r.vx()).toBeGreaterThan(-0.5);
  });

  it('o bot não faz wall jump (encostado na parede, o toque é o pulo duplo)', () => {
    const r = rig({ build: wall, bot: true });
    atWall(r);
    r.frame.moveY = 0;
    press(r);
    expect(after(r)).toBeCloseTo(jumpSpeed * ARCADE_TUNING.doubleJumpMul, 1);
    expect(r.vz()).toBeLessThan(0.5);
  });

  it('o pulo duplo com o analógico pela metade não perde a velocidade', () => {
    const r = rig();
    r.frame.moveY = 127;
    r.frame.buttons = BUTTON.sprint;
    r.step(40);
    r.frame.buttons = BUTTON.sprint | BUTTON.jump;
    r.step();
    r.frame.buttons = BUTTON.sprint;
    r.step(10);
    const before = r.speed();
    r.frame.moveY = 38;
    r.frame.buttons = BUTTON.sprint | BUTTON.jump;
    r.step();
    expect(r.speed()).toBeGreaterThan(before - 0.2);
  });

  it('o pulo duplo sobe igual a 30 e a 60 Hz', () => {
    const at60 = peak(rig(), 20);
    const at30 = peak30();
    expect(Math.abs(at60 - at30)).toBeLessThan(0.08);
  });

  it('sem dano de queda (no Bobo, a queda de 6 m machuca)', () => {
    // Uma torre de 6,5 m embaixo do nascer; anda para fora dela.
    const tower = (g: WorldGrid): void => fillBox(g, 36, 1, 186, 44, 13, 194, concrete);
    const drop = (movement: 'arcade' | 'bobo'): number => {
      const r = rig({ movement, build: tower, spawnY: 7 });
      r.step(5);
      const hp = r.health();
      r.frame.moveY = 127;
      r.step(3 * SIM_HZ);
      return hp - r.health();
    };
    expect(drop('arcade')).toBe(0);
    expect(drop('bobo')).toBeGreaterThan(0);
  });

  it('o deslize mantém o momento (começa na velocidade que tinha e termina em 3/4 dela)', () => {
    const r = rig();
    r.frame.moveY = 127;
    r.frame.buttons = BUTTON.sprint;
    r.step(40);
    const before = r.speed();
    r.frame.buttons = BUTTON.sprint | BUTTON.crouch;
    r.step();
    const start = Math.max(MOVEMENT_ARCADE.slide!.startSpeed, before);
    expect(r.speed()).toBeGreaterThan(start - 0.2);
    r.step(Math.round(MOVEMENT_ARCADE.slide!.durationS * SIM_HZ) - 3);
    expect(r.speed()).toBeGreaterThan(start * ARCADE_TUNING.slideEndKeep - 0.1);
    expect(r.speed()).toBeGreaterThan(MOVEMENT_ARCADE.crouch + 2);
  });

  it('atira correndo (no Bobo, o gatilho corta a corrida)', () => {
    const run = (movement: 'arcade' | 'bobo'): { shots: number; speed: number } => {
      const r = rig({ movement });
      r.frame.moveY = 127;
      r.frame.buttons = BUTTON.sprint;
      r.step(30);
      r.events.length = 0;
      r.frame.buttons = BUTTON.sprint | BUTTON.fire;
      r.step(30);
      return { shots: r.events.filter((ev) => ev.type === 'shot').length, speed: r.speed() };
    };
    const arcade = run('arcade');
    expect(arcade.shots).toBeGreaterThan(0);
    // Correndo e atirando: a velocidade de correr.
    expect(arcade.speed).toBeCloseTo(MOVEMENT_ARCADE.sprint, 1);
    const bobo = run('bobo');
    expect(bobo.speed).toBeCloseTo(MOVEMENT_BOBO.walk, 1);
  });

  it('o estado do Arcade vai no snapshot (o hash volta igual) e na predição', () => {
    const r = rig();
    r.frame.moveY = 127;
    r.frame.buttons = BUTTON.sprint;
    r.step(40);
    r.frame.buttons = BUTTON.sprint | BUTTON.jump;
    r.step();
    r.frame.buttons = BUTTON.sprint;
    r.step(10);
    r.frame.buttons = BUTTON.sprint | BUTTON.jump;
    r.step();
    const w = new BitWriter(1 << 20);
    r.sim.writeSnapshot(w);
    const hash = r.sim.stateHash();
    r.step(30);
    expect(r.sim.stateHash()).not.toBe(hash);
    r.sim.readSnapshot(new BitReader(w.bytes().slice()));
    expect(r.sim.stateHash()).toBe(hash);
    // A predição leva os 5 campos do Arcade (salvar e carregar volta ao mesmo hash).
    const e = entityIndex(r.sim.controllerEntity(0));
    const saved = new Float64Array(PREDICT_STATE_SIZE);
    r.sim.predict.save(e, saved);
    expect(saved[16]).toBe(1);
    r.step(20);
    r.sim.predict.load(e, saved);
    const again = new Float64Array(PREDICT_STATE_SIZE);
    r.sim.predict.save(e, again);
    expect(Array.from(again)).toEqual(Array.from(saved));
  });
});
