import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, WEAPON_SLOT_COUNT, type InputFrame } from '@boboforces/input';
import { pitchToI16, yawToU16 } from '@boboforces/shared';
import { cellCenter, createTestBlocks, createWorldGrid, fillBox, makeCell, type MapSpawn } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { METRICS } from './config/metrics.ts';
import {
  isPrimaryWeapon,
  WEAPON_CODE,
  WEAPON_PAINT_BUCKET,
  WEAPON_PAINT_MARKER,
  WEAPON_PAINT_SNIPER,
} from './config/weapons.ts';
import { SIM_HZ } from './constants.ts';
import { WEAPON_NONE } from './context.ts';
import { ENTITY_FLAG, entityIndex } from './entity.ts';
import type { SimEvent } from './events.ts';
import { aimPointWorld, type AimPoint } from './hitbox.ts';
import { createInputFrames } from './loop.ts';
import { createSim, type Sim, type SimMap } from './sim.ts';

/**
 * M6 (fase 5): o Bobo Paintball na sim. Dois humanos num chão plano, um de frente para o outro a 8 m: o loadout de
 * tinta, os acertos que derrubam e as regras do modo.
 */
const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);

function flatMap(): SimMap {
  const grid = createWorldGrid(40, 16, 80);
  fillBox(grid, 0, 0, 0, 39, 0, 79, concrete);
  const spawns: MapSpawn[] = [
    { x: cellCenter(20), y: 0.5, z: cellCenter(40), yaw: 0, team: 0 },
    { x: cellCenter(20), y: 0.5, z: cellCenter(24), yaw: Math.PI, team: 1 },
  ];
  return { grid, blocks, spawns };
}

const recipe = (hits: number): MatchRecipe => ({
  format: MATCH_RECIPE_FORMAT,
  mode: 'paintball',
  map: 'test',
  seed: 3,
  match: { timeLimitS: 0, scoreLimit: 0 },
  players: { respawnS: 1 },
  weapons: { ammo: 'infiniteReserve' },
  paintball: { hits },
  teams: [
    { humans: 1, bots: [] },
    { humans: 1, bots: [] },
  ],
});

const entity = (sim: Sim, c: number): number => entityIndex(sim.controllerEntity(c));
/** Passa da proteção de spawn (1,5 s), que segura o dano. */
const PAST_PROTECTION = Math.round(1.6 * SIM_HZ);
function settle(sim: Sim): void {
  const f = createInputFrames();
  for (let i = 0; i < PAST_PROTECTION; i++) sim.step(f);
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

/** O controlador 0 atira no peito do 1, tiro a tiro, até ele cair (no máximo 6 s); devolve os acertos e se caiu. */
function shootUntilDown(sim: Sim): { hits: number; down: boolean } {
  const f = createInputFrames();
  const b = entity(sim, 1);
  const p: AimPoint = { x: 0, y: 0, z: 0 };
  let hits = 0;
  for (let i = 0; i < 6 * SIM_HZ && (sim.view().flags[b]! & ENTITY_FLAG.dead) === 0; i++) {
    aimPointWorld(sim.view(), b, false, p);
    aimAt(sim, f[0]!, 0, p);
    // Um tiro a cada 0,25 s (o marcador é automático: o gatilho solto entre um e outro).
    f[0]!.buttons = i % 15 === 0 ? BUTTON.fire | BUTTON.ads : BUTTON.ads;
    sim.step(f);
    const events: SimEvent[] = [];
    sim.drainEvents(events);
    for (const ev of events) if (ev.type === 'hit' && ev.target === sim.controllerEntity(1)) hits++;
  }
  return { hits, down: (sim.view().flags[b]! & ENTITY_FLAG.dead) !== 0 };
}

describe('Bobo Paintball na sim (M6 fase 5)', () => {
  it('o loadout de tinta: o marcador no lugar do fuzil, o balde, sem pistola e sem faca', () => {
    const sim = createSim({ recipe: recipe(1), map: flatMap(), humans: 2, primaries: [4, 0] });
    const v = sim.view();
    const a = entity(sim, 0);
    const b = entity(sim, 1);
    const loadout = (e: number): number[] =>
      Array.from(v.loadout.slice(e * WEAPON_SLOT_COUNT, e * WEAPON_SLOT_COUNT + WEAPON_SLOT_COUNT));
    // O controlador 0 escolheu a sniper (código 4): vira a sniper de tinta; o 1, o fuzil: o marcador.
    expect(loadout(a)).toEqual([WEAPON_PAINT_SNIPER, WEAPON_NONE, WEAPON_NONE, WEAPON_PAINT_BUCKET]);
    expect(loadout(b)).toEqual([WEAPON_PAINT_MARKER, WEAPON_NONE, WEAPON_NONE, WEAPON_PAINT_BUCKET]);
    expect(v.weapon[b]).toBe(WEAPON_PAINT_MARKER);
    sim.dispose();
  });

  it('1 acerto derruba no padrão; com 2, o segundo derruba (e o primeiro não regenera)', () => {
    const one = createSim({ recipe: recipe(1), map: flatMap(), humans: 2 });
    settle(one);
    const r1 = shootUntilDown(one);
    expect(r1).toEqual({ hits: 1, down: true });
    one.dispose();
    const two = createSim({ recipe: recipe(2), map: flatMap(), humans: 2 });
    settle(two);
    const r2 = shootUntilDown(two);
    expect(r2).toEqual({ hits: 2, down: true });
    two.dispose();
    // Um acerto de 2 e espera: sem regeneração, a vida fica na metade.
    const wait = createSim({ recipe: recipe(2), map: flatMap(), humans: 2 });
    const f = createInputFrames();
    settle(wait);
    const b = entity(wait, 1);
    const p: AimPoint = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < SIM_HZ && wait.view().health[b] === 100; i++) {
      aimPointWorld(wait.view(), b, false, p);
      aimAt(wait, f[0]!, 0, p);
      f[0]!.buttons = i === 0 ? BUTTON.fire | BUTTON.ads : BUTTON.ads;
      wait.step(f);
    }
    f[0]!.buttons = 0;
    expect(wait.view().health[b]).toBe(50);
    for (let i = 0; i < 10 * SIM_HZ; i++) wait.step(f);
    expect(wait.view().health[b]).toBe(50);
    wait.dispose();
  });

  it('revisão: o bot só de faca continua sem primária nem balde; arma de modo não é primária escolhível', () => {
    const r: MatchRecipe = {
      ...recipe(1),
      teams: [
        { humans: 1, bots: [] },
        { humans: 1, bots: [{ ref: 'builtin:knife-ninja', count: 1 }] },
      ],
    };
    const sim = createSim({ recipe: r, map: flatMap(), humans: 2 });
    const v = sim.view();
    let ninja = -1;
    for (let e = 0; e < v.count; e++) if (v.alive[e] === 1 && v.controller[e]! >= 4) ninja = e;
    expect(ninja).toBeGreaterThanOrEqual(0);
    const k = ninja * WEAPON_SLOT_COUNT;
    expect(v.loadout[k]).toBe(WEAPON_NONE);
    expect(v.loadout[k + 3]).toBe(WEAPON_NONE);
    sim.dispose();
    expect(isPrimaryWeapon(WEAPON_PAINT_MARKER)).toBe(false);
    expect(isPrimaryWeapon(WEAPON_CODE.smg)).toBe(true);
  });
});
