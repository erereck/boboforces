import {
  builtinBotRef,
  MATCH_RECIPE_FORMAT,
  MODIFIER_CONFLICTS,
  MODIFIERS,
  type MatchRecipe,
  type ModifierId,
} from '@boboforces/format';
import { BUTTON, type InputFrame } from '@boboforces/input';
import { pitchToI16, yawToU16 } from '@boboforces/shared';
import { cellCenter, createTestBlocks, createWorldGrid, fillBox, makeCell, type MapSpawn } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { METRICS } from './config/metrics.ts';
import { BOT_CONTROLLER_BASE, SIM_HZ } from './constants.ts';
import { entityIndex } from './entity.ts';
import type { SimEvent } from './events.ts';
import { aimPointWorld, GIANT_EYE_CEILING_GAP_M, type AimPoint } from './hitbox.ts';
import { createInputFrames } from './loop.ts';
import { createSim, type Sim, type SimMap } from './sim.ts';
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
    expect(shotY(['giantBots'], true, bot)).toBeCloseTo(3 - GIANT_EYE_CEILING_GAP_M - 0.5, 9);
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
