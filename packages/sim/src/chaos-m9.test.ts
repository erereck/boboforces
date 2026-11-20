import {
  builtinBotRef,
  createFigureGameTable,
  FIGURE_GRIP,
  FIGURE_MAX_TOP_M,
  FIGURE_MODE,
  FIGURE_STANCE,
  figurePosture,
  MATCH_RECIPE_FORMAT,
  MODIFIER_CONFLICTS,
  MODIFIERS,
  type MatchRecipe,
  type ModifierId,
} from '@boboforces/format';
import { BUTTON, type InputFrame } from '@boboforces/input';
import { BitReader, BitWriter, pitchToI16, yawToU16 } from '@boboforces/shared';
import { cellCenter, createTestBlocks, createWorldGrid, fillBox, makeCell, type MapSpawn } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { METRICS } from './config/metrics.ts';
import { BOT_CONTROLLER_BASE, SIM_HZ } from './constants.ts';
import { ENTITY_FLAG, entityIndex } from './entity.ts';
import type { SimEvent } from './events.ts';
import {
  aimPointWorld,
  CHAOS_SCALE,
  CHAOS_SQUEEZE,
  chaosScaleOf,
  FigureHitCache,
  GIANT_EYE_CEILING_GAP_M,
  type AimPoint,
} from './hitbox.ts';
import { createInputFrames } from './loop.ts';
import { createSim, type Sim, type SimMap } from './sim.ts';
import type { SimState } from './state.ts';
import { MOD } from './systems/chaos.ts';

/**
 * M9 (fase 1): o Mini, os Bots gigantes e o Ricochete na sim. O canto do Ricochete: chão de 20 × 40 m, uma parede com
 * a face oeste no x = 14 m e um pilar entre A (time 0, em 11,25; 26,25) e B (time 1, em 11,25; 22,25): B não se vê
 * de A, mas o tiro na parede volta nele.
 */
const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);
const WALL_X = 14;
const A_POS = [cellCenter(22), 0.5, cellCenter(52)] as const;
const B_POS = [cellCenter(22), 0.5, cellCenter(44)] as const;

function cornerMap(): SimMap {
  const grid = createWorldGrid(40, 16, 80);
  fillBox(grid, 0, 0, 0, 39, 0, 79, concrete);
  // A parede (x 14..15 m) e o pilar (x 10,5..12 m, z 23,5..24,5 m), até 6,5 m de altura.
  fillBox(grid, 28, 1, 0, 29, 12, 79, concrete);
  fillBox(grid, 21, 1, 47, 23, 12, 48, concrete);
  const spawns: MapSpawn[] = [
    { x: A_POS[0], y: A_POS[1], z: A_POS[2], yaw: 0, team: 0 },
    { x: B_POS[0], y: B_POS[1], z: B_POS[2], yaw: Math.PI, team: 1 },
  ];
  return { grid, blocks, spawns };
}

function recipe(mods: readonly ModifierId[], weapon: string, extra: Partial<MatchRecipe> = {}): MatchRecipe {
  return {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'test',
    seed: 9,
    match: { timeLimitS: 0, scoreLimit: 0 },
    teams: [
      { humans: 1, bots: [] },
      { humans: 1, bots: [] },
    ],
    weapons: { spread: false, recoil: false, allowed: [weapon] },
    ...(mods.length > 0 ? { modifiers: [...mods] } : {}),
    ...extra,
  };
}

const entity = (sim: Sim, c: number): number => entityIndex(sim.controllerEntity(c));

function aimAt(sim: Sim, f: InputFrame, c: number, p: AimPoint): void {
  const v = sim.view();
  const e = entity(sim, c);
  const dx = p.x - v.position[e * 3]!;
  const dy = p.y - (v.position[e * 3 + 1]! + METRICS.eyeHeight);
  const dz = p.z - v.position[e * 3 + 2]!;
  f.yaw = yawToU16(Math.atan2(-dx, -dz));
  f.pitch = pitchToI16(Math.atan2(dy, Math.hypot(dx, dz)));
}

/** Espera a proteção do spawn, mira com `aim` e dá 1 tiro; devolve os eventos dos ticks do tiro. */
function fireOnce(sim: Sim, aim: (f: InputFrame) => void): SimEvent[] {
  const f = createInputFrames();
  for (let i = 0; i < 4 * SIM_HZ; i++) {
    aim(f[0]!);
    sim.step(f);
    sim.drainEvents([]);
  }
  const out: SimEvent[] = [];
  f[0]!.buttons = BUTTON.fire;
  for (let i = 0; i < 3; i++) {
    sim.step(f);
    f[0]!.buttons = 0;
    const events: SimEvent[] = [];
    sim.drainEvents(events);
    for (const ev of events) out.push({ ...ev } as SimEvent);
  }
  return out;
}

/** O tiro de A no peito de B espelhado na parede (a tabela da bala: d → d − 2(d·n)n). */
function bankShot(mods: readonly ModifierId[], weapon: string): { events: SimEvent[]; a: number; b: number } {
  const sim = createSim({ recipe: recipe(mods, weapon), map: cornerMap(), humans: 2 });
  sim.step(createInputFrames());
  const v = sim.view();
  const a = entity(sim, 0);
  const b = entity(sim, 1);
  expect([v.position[a * 3], v.position[a * 3 + 2], v.position[b * 3], v.position[b * 3 + 2]]).toEqual([
    A_POS[0],
    A_POS[2],
    B_POS[0],
    B_POS[2],
  ]);
  const p: AimPoint = { x: 0, y: 0, z: 0 };
  const events = fireOnce(sim, (f) => {
    aimPointWorld(sim.view(), b, false, p);
    aimAt(sim, f, 0, { x: 2 * WALL_X - p.x, y: p.y, z: p.z });
  });
  const ids = { a: sim.controllerEntity(0), b: sim.controllerEntity(1) };
  sim.dispose();
  return { events, ...ids };
}

const hitsOn = (events: readonly SimEvent[], target: number): number =>
  events.filter((ev) => ev.type === 'hit' && ev.target === target).length;

describe('Ricochete (M9 fase 1)', () => {
  it('o tiro na parede volta e acerta quem está atrás do pilar; sem o modificador, para na parede', () => {
    const on = bankShot(['ricochet'], 'rifle');
    const off = bankShot([], 'rifle');
    expect(hitsOn(off.events, off.b)).toBe(0);
    expect(off.events.some((ev) => ev.type === 'ricochet')).toBe(false);
    expect(off.events.some((ev) => ev.type === 'impact' && Math.abs(ev.x - WALL_X) < 1e-6)).toBe(true);
    expect(hitsOn(on.events, on.b)).toBe(1);
    const hit = on.events.find((ev) => ev.type === 'hit')!;
    expect(hit.type === 'hit' && hit.shooter).toBe(on.a);
    // O evento do quique: de quem, onde (5 cm fora da face) e para onde (o x trocou de sinal; o z não).
    const shot = on.events.find((ev) => ev.type === 'shot')!;
    const rico = on.events.find((ev) => ev.type === 'ricochet')!;
    if (shot.type !== 'shot' || rico.type !== 'ricochet') throw new Error('eventos');
    expect(rico.shooter).toBe(on.a);
    expect(rico.weapon).toBe(shot.weapon);
    expect(rico.x).toBeCloseTo(WALL_X - 0.05, 9);
    expect(rico.dirX).toBeCloseTo(-shot.dirX, 12);
    expect(rico.dirY).toBeCloseTo(shot.dirY, 12);
    expect(rico.dirZ).toBeCloseTo(shot.dirZ, 12);
    // O `shot` vai até a parede; o quique, até B.
    expect(shot.originX + shot.dirX * shot.distance).toBeCloseTo(WALL_X, 6);
    expect(rico.distance).toBeGreaterThan(2);
    expect(rico.distance).toBeLessThan(5);
    // O impacto da parede sai também.
    expect(on.events.some((ev) => ev.type === 'impact' && Math.abs(ev.x - WALL_X) < 1e-6)).toBe(true);
  });

  it('os chumbos da escopeta quicam cada um (até 8 quiques) e acertam B só com o Ricochete', () => {
    const on = bankShot(['ricochet'], 'shotgun');
    const off = bankShot([], 'shotgun');
    expect(on.events.filter((ev) => ev.type === 'ricochet')).toHaveLength(8);
    expect(on.events.filter((ev) => ev.type === 'shot')).toHaveLength(8);
    expect(hitsOn(on.events, on.b)).toBe(1);
    expect(hitsOn(off.events, off.b)).toBe(0);
  });

  it('quem atira de frente para a parede não leva o próprio tiro de volta', () => {
    const sim = createSim({ recipe: recipe(['ricochet'], 'rifle'), map: cornerMap(), humans: 2 });
    const events = fireOnce(sim, (f) => {
      // Olhando para +X (a parede), na horizontal: o quique volta pelo mesmo caminho, pelo olho de A.
      f.yaw = yawToU16(-Math.PI / 2);
      f.pitch = 0;
    });
    sim.dispose();
    const rico = events.find((ev) => ev.type === 'ricochet');
    if (rico?.type !== 'ricochet') throw new Error('sem o quique');
    expect(rico.dirX).toBeCloseTo(-1, 6);
    expect(events.filter((ev) => ev.type === 'hit')).toHaveLength(0);
  });

  it('o raio que começa dentro do bloco não quica (normal nula)', () => {
    // A com o olho dentro de uma laje (2,0..2,5 m) logo acima dele.
    const map = cornerMap();
    fillBox(map.grid, 22, 4, 52, 22, 4, 52, concrete);
    const sim = createSim({ recipe: recipe(['ricochet'], 'rifle'), map, humans: 2 });
    const events = fireOnce(sim, (f) => {
      f.yaw = yawToU16(-Math.PI / 2);
      f.pitch = 0;
    });
    const a = entity(sim, 0);
    expect(sim.view().position[a * 3 + 1]! + METRICS.eyeHeight).toBeGreaterThan(2);
    sim.dispose();
    const shot = events.find((ev) => ev.type === 'shot');
    expect(shot !== undefined && shot.type === 'shot' && shot.distance).toBe(0);
    expect(events.some((ev) => ev.type === 'ricochet')).toBe(false);
  });
});

describe('Mini e Bots gigantes na sim (M9 fase 1)', () => {
  it('o tiro sai do olho em escala: o Mini na metade; o bot gigante no triplo, ou 10 cm abaixo do teto', () => {
    const shotY = (mods: readonly ModifierId[], roof: boolean, c: number): number => {
      const map = cornerMap();
      // Teto de 3,0 a 3,5 m em cima do spawn de B (célula y = 6).
      if (roof) fillBox(map.grid, 18, 6, 40, 26, 6, 47, concrete);
      const r = recipe(mods, 'rifle', {
        teams: [{ humans: 1, bots: [] }, { bots: [{ ref: builtinBotRef('normal'), count: 1 }] }],
      });
      const sim = createSim({ recipe: r, map, humans: 1 });
      const f = createInputFrames();
      for (let i = 0; i < 4 * SIM_HZ; i++) sim.step(f);
      f[c]!.pitch = pitchToI16(0.3);
      f[c]!.buttons = BUTTON.fire;
      let y = Number.NaN;
      for (let i = 0; i < 3 && Number.isNaN(y); i++) {
        sim.step(f);
        const events: SimEvent[] = [];
        sim.drainEvents(events);
        const e = entity(sim, c);
        for (const ev of events) {
          if (ev.type === 'shot' && entityIndex(ev.shooter) === e) y = ev.originY - sim.view().position[e * 3 + 1]!;
        }
      }
      sim.dispose();
      return y;
    };
    const bot = BOT_CONTROLLER_BASE;
    expect(shotY([], false, bot)).toBeCloseTo(METRICS.eyeHeight, 9);
    expect(shotY(['mini'], false, 0)).toBeCloseTo(METRICS.eyeHeight / 2, 9);
    expect(shotY(['mini'], false, bot)).toBeCloseTo(METRICS.eyeHeight / 2, 9);
    // O gigante: só o bot; o humano continua com o olho normal.
    expect(shotY(['giantBots'], false, 0)).toBeCloseTo(METRICS.eyeHeight, 9);
    expect(shotY(['giantBots'], false, bot)).toBeCloseTo(METRICS.eyeHeight * 3, 9);
    // Fase 1b: debaixo da laje o gigante encolhe (2,5 m livres) e o olho vai junto, abaixo do teto.
    const k = Math.fround((2.5 - CHAOS_SQUEEZE.gapM) / CHAOS_SQUEEZE.topM);
    expect(shotY(['giantBots'], true, bot)).toBeCloseTo(METRICS.eyeHeight * k, 9);
    expect(METRICS.eyeHeight * k).toBeLessThan(2.5 - GIANT_EYE_CEILING_GAP_M);
  });

  /**
   * Fase 1b: o bot gigante (B) com a laje de 3,0 a 3,5 m em cima (o chão vai até 0,5 m) e o humano (A) a céu aberto.
   * `crouch` agacha o bot pela entrada dele. Devolve a escala do bot, a do humano e o topo do bot que leva tiro.
   */
  function squeezeRun(
    mods: readonly ModifierId[],
    roof: boolean,
    crouch = false,
  ): { sim: Sim; bot: number; human: number; f: InputFrame[] } {
    const map = cornerMap();
    if (roof) fillBox(map.grid, 18, 6, 40, 26, 6, 47, concrete);
    const r = recipe(mods, 'rifle', {
      teams: [{ humans: 1, bots: [] }, { bots: [{ ref: builtinBotRef('normal'), count: 1 }] }],
    });
    const sim = createSim({ recipe: r, map, humans: 1 });
    const f = createInputFrames();
    if (crouch) f[BOT_CONTROLLER_BASE]!.buttons = BUTTON.crouch;
    for (let i = 0; i < 4 * SIM_HZ; i++) sim.step(f);
    return { sim, bot: entity(sim, BOT_CONTROLLER_BASE), human: entity(sim, 0), f };
  }

  /** O topo (m acima dos pés) das hitboxes do corpo `e` na escala da view: o raio horizontal mais alto que acerta. */
  function hitTop(sim: Sim, e: number, posture: number): number {
    const v = sim.view();
    const cache = new FigureHitCache(createFigureGameTable(), 64);
    const s = v as unknown as SimState;
    const x = v.position[e * 3]!;
    const y = v.position[e * 3 + 1]!;
    const z = v.position[e * 3 + 2]!;
    let top = 0;
    let tick = 1;
    for (let h = 0; h < 7; h += 0.01) {
      for (let a = 0; a < 8; a++) {
        const yaw = (a * Math.PI) / 4;
        const dx = Math.sin(yaw);
        const dz = Math.cos(yaw);
        cache.beginRay(x - dx * 10, y + h, z - dz * 10, dx, 0, dz, 100);
        if (cache.testEntity(s, e, posture, tick++) >= 0) top = h;
      }
    }
    cache.release();
    return top;
  }

  it('fase 1b: debaixo da laje o gigante encolhe e a hitbox fica abaixo dela; a céu aberto, o triplo', () => {
    const under = squeezeRun(['giantBots'], true);
    const v = under.sim.view();
    const k = chaosScaleOf(v, under.bot);
    expect(k).toBeLessThan(CHAOS_SCALE.giantBots);
    expect(k).toBeCloseTo((2.5 - CHAOS_SQUEEZE.gapM) / CHAOS_SQUEEZE.topM, 6);
    expect(chaosScaleOf(v, under.human)).toBe(1);
    const stand = figurePosture(FIGURE_STANCE.stand, FIGURE_GRIP.rifle, FIGURE_MODE.base, false);
    const top = hitTop(under.sim, under.bot, stand);
    expect(v.position[under.bot * 3 + 1]! + top).toBeLessThan(3);
    expect(top).toBeGreaterThan(FIGURE_MAX_TOP_M);
    under.sim.dispose();
    const open = squeezeRun(['giantBots'], false);
    expect(chaosScaleOf(open.sim.view(), open.bot)).toBe(CHAOS_SCALE.giantBots);
    expect(hitTop(open.sim, open.bot, stand)).toBeGreaterThan(FIGURE_MAX_TOP_M * 2.9);
    open.sim.dispose();
  });

  it('fase 1b (revisão): agachado, o gigante fica do mesmo tamanho (o topo é o de pé em toda postura)', () => {
    const run = squeezeRun(['giantBots'], true, true);
    const v = run.sim.view();
    expect(v.flags[run.bot]! & ENTITY_FLAG.crouching).not.toBe(0);
    const k = chaosScaleOf(v, run.bot);
    expect(k).toBeCloseTo((2.5 - CHAOS_SQUEEZE.gapM) / CHAOS_SQUEEZE.topM, 6);
    const crouch = figurePosture(FIGURE_STANCE.crouch, FIGURE_GRIP.rifle, FIGURE_MODE.base, false);
    expect(v.position[run.bot * 3 + 1]! + hitTop(run.sim, run.bot, crouch)).toBeLessThan(3);
    run.sim.dispose();
  });

  it('fase 1b: sem tamanho na máscara, ou no Mini, nada aperta (o teto não muda nada)', () => {
    for (const roof of [false, true]) {
      const none = squeezeRun([], roof);
      expect(Array.from(none.sim.view().chaosScale.subarray(0, none.sim.view().count))).toEqual(
        Array.from({ length: none.sim.view().count }, () => 1),
      );
      none.sim.dispose();
      const mini = squeezeRun(['mini'], roof);
      const mv = mini.sim.view();
      expect([chaosScaleOf(mv, mini.bot), chaosScaleOf(mv, mini.human)]).toEqual([0.5, 0.5]);
      mini.sim.dispose();
    }
  });

  it('fase 1b: determinístico, e a escala volta igual da leitura de snapshot (ela não entra nele)', () => {
    const play = (): { hash: number; scales: number[]; sim: Sim; f: InputFrame[] } => {
      const run = squeezeRun(['giantBots'], true);
      // O bot anda para fora da laje e volta: a escala muda no caminho.
      for (let i = 0; i < 120; i++) {
        run.f[BOT_CONTROLLER_BASE]!.moveY = i < 60 ? 127 : -127;
        run.sim.step(run.f);
      }
      const v = run.sim.view();
      return { hash: run.sim.stateHash(), scales: Array.from(v.chaosScale.subarray(0, v.count)), ...run };
    };
    const a = play();
    const b = play();
    expect(b.hash).toBe(a.hash);
    expect(b.scales).toEqual(a.scales);
    // O snapshot de A numa sim nova: a mesma escala (refeita do estado lido) e, seguindo junto, o mesmo hash.
    const w = new BitWriter(64 * 1024);
    a.sim.writeSnapshot(w);
    const c = squeezeRun(['giantBots'], true);
    c.sim.readSnapshot(new BitReader(w.bytes()));
    const cv = c.sim.view();
    expect(Array.from(cv.chaosScale.subarray(0, cv.count))).toEqual(a.scales);
    expect(c.sim.stateHash()).toBe(a.hash);
    for (let i = 0; i < 60; i++) {
      a.f[BOT_CONTROLLER_BASE]!.moveY = 127;
      a.sim.step(a.f);
      c.sim.step(a.f);
    }
    expect(c.sim.stateHash()).toBe(a.sim.stateHash());
    expect(Array.from(cv.chaosScale.subarray(0, cv.count))).toEqual(
      Array.from(a.sim.view().chaosScale.subarray(0, cv.count)),
    );
    for (const r of [a, b, c]) r.sim.dispose();
  });

  it('a Roleta nunca põe dois que conflitam (Mini e gigantes, gigantes e Cabeção, Ricochete e um tiro mata)', () => {
    const r: MatchRecipe = { ...recipe([], 'rifle'), chaos: { count: 4, everyS: 10 } };
    const sim = createSim({ recipe: r, map: cornerMap(), humans: 2 });
    const f = createInputFrames();
    const masks = sim.view().chaos!.masks;
    const pairs = MODIFIER_CONFLICTS.map(([x, y]) => (1 << MODIFIERS.indexOf(x)) | (1 << MODIFIERS.indexOf(y)));
    let seen = 0;
    const bad: number[] = [];
    for (let i = 0; i < 600 * SIM_HZ; i++) {
      sim.step(f);
      if (i % 30 !== 0) continue;
      for (const m of [masks[0]!, masks[1]!]) {
        seen |= m;
        for (const p of pairs) if ((m & p) === p) bad.push(m);
      }
    }
    sim.dispose();
    expect(bad).toEqual([]);
    // Os três novos saem na Roleta.
    expect(seen & (MOD.mini | MOD.giantBots | MOD.ricochet)).toBe(MOD.mini | MOD.giantBots | MOD.ricochet);
  });
});

/**
 * Revisão da fase 1b: o humano A em cima da laje (3,0 a 3,5 m de altura em x 9..13,5 m e z 20..24 m; o chão vai até
 * 0,5 m) atira em y = 4,2 m, em cima do bot gigante B: acima da laje, o tiro só acerta B se a hitbox dele atravessa o
 * teto. B começa em (11,25; `bz`), virado para −Z.
 */
describe('revisão da fase 1b: o gigante debaixo da laje não leva tiro por cima dela', () => {
  const SHOT_Y = 4.2;
  const LIVE = 4 * SIM_HZ;

  function slab(bz: number, rewind = false): { sim: Sim; f: InputFrame[]; a: number; b: number } {
    const grid = createWorldGrid(40, 16, 80);
    fillBox(grid, 0, 0, 0, 39, 0, 79, concrete);
    fillBox(grid, 18, 6, 40, 26, 6, 47, concrete);
    const spawns: MapSpawn[] = [
      { x: cellCenter(18), y: 3.5, z: cellCenter(42), yaw: 0, team: 0 },
      { x: cellCenter(22), y: 0.5, z: bz, yaw: 0, team: 1 },
    ];
    const r = recipe(['giantBots'], 'rifle', {
      teams: [{ humans: 1, bots: [] }, { bots: [{ ref: builtinBotRef('normal'), count: 1 }] }],
    });
    const sim = createSim({ recipe: r, map: { grid, blocks, spawns }, humans: 1 });
    if (rewind) sim.rewind.enable();
    return { sim, f: createInputFrames(), a: entity(sim, 0), b: entity(sim, BOT_CONTROLLER_BASE) };
  }

  /** A mira em (x, `SHOT_Y`, z) e atira neste passo; devolve as alturas dos acertos em B. */
  function shoot(run: ReturnType<typeof slab>, x: number, z: number): number[] {
    const { sim, f, a, b } = run;
    const v = sim.view();
    const dx = x - v.position[a * 3]!;
    const dy = SHOT_Y - (v.position[a * 3 + 1]! + METRICS.eyeHeight);
    const dz = z - v.position[a * 3 + 2]!;
    f[0]!.yaw = yawToU16(Math.atan2(-dx, -dz));
    f[0]!.pitch = pitchToI16(Math.atan2(dy, Math.hypot(dx, dz)));
    f[0]!.buttons = BUTTON.fire;
    sim.step(f);
    f[0]!.buttons = 0;
    const events: SimEvent[] = [];
    sim.drainEvents(events);
    expect(events.some((ev) => ev.type === 'shot')).toBe(true);
    const ys: number[] = [];
    for (const ev of events) if (ev.type === 'hit' && entityIndex(ev.target) === b) ys.push(ev.y);
    return ys;
  }

  /** B anda para −Z: a posição (x, z) e a escala de B depois de cada passo, até `steps` passos. */
  function walk(run: ReturnType<typeof slab>, steps: number): { x: number; z: number; k: number }[] {
    const { sim, f, b } = run;
    const track: { x: number; z: number; k: number }[] = [];
    f[BOT_CONTROLLER_BASE]!.moveY = 127;
    for (let t = 0; t < steps; t++) {
      sim.step(f);
      sim.drainEvents([]);
      const v = sim.view();
      track.push({ x: v.position[b * 3]!, z: v.position[b * 3 + 2]!, k: v.chaosScale[b]! });
    }
    return track;
  }

  function warm(run: ReturnType<typeof slab>): void {
    for (let i = 0; i < LIVE; i++) {
      run.sim.step(run.f);
      run.sim.drainEvents([]);
    }
  }

  it('o tick em que ele passa para debaixo da laje: o tiro usa a escala da posição nova (não a de fora)', () => {
    // Uma volta de sondagem acha o passo em que B (vindo de fora, z 26,25) entra debaixo da laje (z < 24).
    const probe = slab(cellCenter(52));
    warm(probe);
    const track = walk(probe, 90);
    probe.sim.dispose();
    const T = track.findIndex((p) => p.z < 24);
    expect(T).toBeGreaterThan(0);
    expect(track[T - 1]!.k).toBe(CHAOS_SCALE.giantBots);
    expect(track[T]!.k).toBeLessThan(1.5);
    // Controle: um passo antes (B ainda fora, no triplo), o mesmo tiro em y 4,2 acerta.
    const before = slab(cellCenter(52));
    warm(before);
    walk(before, T - 1);
    expect(shoot(before, track[T - 1]!.x, track[T - 1]!.z).length).toBeGreaterThan(0);
    before.sim.dispose();
    // No passo da entrada, o tiro sai depois do movimento: B já está apertado e nada passa da laje.
    const cross = slab(cellCenter(52));
    warm(cross);
    walk(cross, T);
    expect(shoot(cross, track[T]!.x, track[T]!.z)).toEqual([]);
    cross.sim.dispose();
  });

  it('levantar debaixo da laje: agachado ele não cresce, e no tick em que levanta nada passa da laje', () => {
    const run = slab(cellCenter(44));
    run.f[BOT_CONTROLLER_BASE]!.buttons = BUTTON.crouch;
    warm(run);
    const v = run.sim.view();
    expect(v.flags[run.b]! & ENTITY_FLAG.crouching).not.toBe(0);
    const k = chaosScaleOf(v, run.b);
    expect(k).toBeCloseTo((2.5 - CHAOS_SQUEEZE.gapM) / CHAOS_SQUEEZE.topM, 6);
    run.f[BOT_CONTROLLER_BASE]!.buttons = 0;
    expect(shoot(run, v.position[run.b * 3]!, v.position[run.b * 3 + 2]!)).toEqual([]);
    expect(v.flags[run.b]! & ENTITY_FLAG.crouching).toBe(0);
    expect(chaosScaleOf(v, run.b)).toBe(k);
    run.sim.dispose();
  });

  it('o tiro no passado: B é testado no tamanho que tinha (saindo da laje, a cabeça de agora não volta para lá)', () => {
    // B na beira da laje (z 20,75) sai para −Z; o tiro de A volta até o último passo em que B estava embaixo.
    const run = slab(cellCenter(41), true);
    warm(run);
    const start = run.sim.tick;
    const track = walk(run, 30);
    const out = track.findIndex((p) => p.k === CHAOS_SCALE.giantBots);
    expect(out).toBeGreaterThan(0);
    expect(out).toBeLessThan(20);
    const inside = track[out - 1]!;
    expect(inside.k).toBeLessThan(1.5);
    // O passo `i` do trajeto termina no tick `start + i + 1` (a numeração do histórico).
    const back = run.sim.tick - (start + out);
    expect(back).toBeLessThanOrEqual(run.sim.rewind.maxTicks);
    run.f[BOT_CONTROLLER_BASE]!.moveY = 0;
    // Voltando até onde B estava debaixo da laje: o tamanho de lá (1,2), e nada passa da laje.
    const rewound = run.sim.rewind.rewound;
    run.sim.rewind.set(0, back);
    expect(shoot(run, inside.x, inside.z)).toEqual([]);
    expect(run.sim.rewind.rewound).toBe(rewound + 1);
    // A escala de agora volta depois do tiro (o `swapOut`).
    expect(chaosScaleOf(run.sim.view(), run.b)).toBe(CHAOS_SCALE.giantBots);
    // Controle: sem voltar (depois da cadência), B está fora, no triplo, e o tiro em y 4,2 na posição de agora acerta.
    run.sim.rewind.set(0, 0);
    for (let i = 0; i < 20; i++) run.sim.step(run.f);
    run.sim.drainEvents([]);
    const v = run.sim.view();
    expect(shoot(run, v.position[run.b * 3]!, v.position[run.b * 3 + 2]!).length).toBeGreaterThan(0);
    run.sim.dispose();
  });
});
