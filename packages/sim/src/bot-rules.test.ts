import { BOT_FORMAT, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, WEAPON_SLOT_COUNT, type InputFrame } from '@boboforces/input';
import { pitchToI16, yawToU16 } from '@boboforces/shared';
import { cellCenter, createTestBlocks, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { METRICS } from './config/metrics.ts';
import { MOVEMENT_BOBO } from './config/movement.ts';
import { WEAPON_CODE, WEAPON_RIFLE, WEAPON_SLOT } from './config/weapons.ts';
import { BOT_CONTROLLER_BASE, SIM_HZ } from './constants.ts';
import { entityIndex } from './entity.ts';
import type { SimEvent } from './events.ts';
import { aimPointWorld, type AimPoint } from './hitbox.ts';
import { createInputFrames } from './loop.ts';
import { createSim, type Sim } from './sim.ts';

/**
 * M2, fase 3b: regras por bot na sim (gameplay.md §6.5). Um humano (controlador 0) e um bot embutido com as regras do
 * teste (controlador 4, pilotado aqui, sem IA), frente a frente a 10 m.
 */

const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);
const BOT = BOT_CONTROLLER_BASE;
const PAST_PROTECTION = Math.round(1.6 * SIM_HZ);

function match(rules: Record<string, unknown>): { sim: Sim; f: InputFrame[] } {
  const grid = createWorldGrid(40, 12, 80);
  fillBox(grid, 0, 0, 0, 39, 0, 79, concrete);
  const recipe: MatchRecipe = {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'test',
    seed: 3,
    teams: [{ humans: 1, bots: [] }, { bots: [{ ref: 'embedded:t', count: 1 }] }],
    embeddedBots: [
      { ...JSON.parse(JSON.stringify({ format: BOT_FORMAT, id: 't', name: 'Teste' })), rules: { ...base(), ...rules } },
    ],
  };
  const spawns = [
    { x: cellCenter(20), y: 0.5, z: 30, yaw: 0, team: 0 },
    { x: cellCenter(20), y: 0.5, z: 20, yaw: Math.PI, team: 1 },
  ];
  const sim = createSim({ recipe, map: { grid, blocks, spawns }, humans: 1 });
  return { sim, f: createInputFrames() };
}

/** Regras padrão completas (o teste monta o documento já "validado"). */
function base(): Record<string, unknown> {
  return {
    hp: 100,
    damageMult: 1,
    speed: 1,
    ammo: 'normal',
    weapons: [],
    headshotImmune: false,
    explodeOnDeath: false,
    visionDeg: 120,
    visionRange: 1,
    hearing: 1,
    knowledge: 'normal',
  };
}

const e = (sim: Sim, c: number): number => entityIndex(sim.controllerEntity(c));

function run(sim: Sim, f: InputFrame[], ticks: number, onEvents?: (ev: SimEvent[]) => void): void {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step(f);
    events.length = 0;
    sim.drainEvents(events);
    onEvents?.(events);
  }
}

/** `from` mira no tronco (ou na cabeça) de `to` e atira 1 vez; devolve os acertos em `to`. */
function shootOnce(
  sim: Sim,
  f: InputFrame[],
  from: number,
  to: number,
  head = false,
  onEvents?: (ev: SimEvent[]) => void,
): number[] {
  const p: AimPoint = { x: 0, y: 0, z: 0 };
  aimPointWorld(sim.view(), e(sim, to), head, p);
  const v = sim.view();
  const a = e(sim, from);
  const dx = p.x - v.position[a * 3]!;
  const dy = p.y - (v.position[a * 3 + 1]! + METRICS.eyeHeight);
  const dz = p.z - v.position[a * 3 + 2]!;
  f[from]!.yaw = yawToU16(Math.atan2(-dx, -dz));
  f[from]!.pitch = pitchToI16(Math.atan2(dy, Math.hypot(dx, dz)));
  f[from]!.buttons = BUTTON.fire | BUTTON.ads;
  const hits: number[] = [];
  run(sim, f, 1, (list) => {
    for (const ev of list) if (ev.type === 'hit' && ev.target === sim.controllerEntity(to)) hits.push(ev.damage);
    onEvents?.(list);
  });
  f[from]!.buttons = 0;
  return hits;
}

describe('regras por bot', () => {
  it('vida 500 no spawn; o humano fica com a da partida', () => {
    const { sim } = match({ hp: 500 });
    expect([sim.view().health[e(sim, BOT)], sim.view().health[e(sim, 0)]]).toEqual([500, 100]);
  });

  it('dano ×2 no que o bot causa (o mesmo tiro de um bot sem a regra, dobrado)', () => {
    const plain = match({});
    run(plain.sim, plain.f, PAST_PROTECTION);
    const [d1] = shootOnce(plain.sim, plain.f, BOT, 0);
    const { sim, f } = match({ damageMult: 2 });
    run(sim, f, PAST_PROTECTION);
    expect(d1).toBeGreaterThan(0);
    expect(shootOnce(sim, f, BOT, 0)).toEqual([d1! * 2]);
  });

  it('velocidade ×1,4 andando', () => {
    const { sim, f } = match({ speed: 1.4 });
    f[BOT]!.yaw = yawToU16(Math.PI);
    f[BOT]!.moveY = 127;
    run(sim, f, SIM_HZ);
    const v = sim.view();
    const b = e(sim, BOT);
    expect(Math.hypot(v.velocity[b * 3]!, v.velocity[b * 3 + 2]!)).toBeCloseTo(MOVEMENT_BOBO.walk * 1.4, 3);
  });

  it('só faca: o loadout fica só com ela e a mão começa nela', () => {
    const { sim } = match({ weapons: ['knife'] });
    const v = sim.view();
    const b = e(sim, BOT);
    const k = b * WEAPON_SLOT_COUNT;
    expect(Array.from(v.loadout.subarray(k, k + WEAPON_SLOT_COUNT))).toEqual([255, 255, WEAPON_CODE.knife, 255]);
    expect([v.slot[b], v.weapon[b]]).toEqual([WEAPON_SLOT.melee, WEAPON_CODE.knife]);
  });

  it('arma fixa: só a escopeta, como primária', () => {
    const { sim } = match({ weapons: ['shotgun'] });
    const v = sim.view();
    const b = e(sim, BOT);
    expect([v.slot[b], v.weapon[b], v.loadout[b * WEAPON_SLOT_COUNT + WEAPON_SLOT.secondary]]).toEqual([
      WEAPON_SLOT.primary,
      WEAPON_CODE.shotgun,
      255,
    ]);
  });

  it('pente infinito: atirar não gasta', () => {
    const { sim, f } = match({ ammo: 'infiniteClip' });
    run(sim, f, PAST_PROTECTION);
    for (let i = 0; i < 5; i++) {
      shootOnce(sim, f, BOT, 0);
      run(sim, f, 10);
    }
    expect(sim.view().slotClip[e(sim, BOT) * WEAPON_SLOT_COUNT]).toBe(WEAPON_RIFLE.clipSize);
  });

  it('imune a tiro de cabeça: na cabeça leva o dano do tronco', () => {
    const { sim, f } = match({ headshotImmune: true });
    run(sim, f, PAST_PROTECTION);
    const hits = shootOnce(sim, f, 0, BOT, true);
    expect(hits).toEqual([WEAPON_RIFLE.damage]);
  });

  it('explode ao morrer: a explosão sai do peito de quem morreu', () => {
    const { sim, f } = match({ explodeOnDeath: true });
    run(sim, f, PAST_PROTECTION);
    const explosions: { x: number; z: number; owner: number }[] = [];
    const collect = (list: SimEvent[]): void => {
      for (const ev of list) if (ev.type === 'explosion') explosions.push({ x: ev.x, z: ev.z, owner: ev.owner });
    };
    for (let i = 0; i < 300 && sim.view().health[e(sim, BOT)]! > 0; i++) {
      shootOnce(sim, f, 0, BOT, false, collect);
      run(sim, f, 5, collect);
    }
    expect(explosions.length).toBe(1);
    expect(explosions[0]!.owner).toBe(sim.controllerEntity(BOT));
    expect(explosions[0]!.z).toBeCloseTo(20, 0);
  });
});
