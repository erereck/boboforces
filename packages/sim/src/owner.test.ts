import { MATCH_RECIPE_FORMAT, MODIFIERS, builtinBotRef, type MatchRecipe } from '@boboforces/format';
import { BUTTON, WEAPON_SLOT_COUNT, type InputFrame } from '@boboforces/input';
import { buildNavGrid } from '@boboforces/nav';
import { BitReader, BitWriter, pitchToI16, u16ToYaw, yawToU16 } from '@boboforces/shared';
import { cellCenter, createTestBlocks, createWorldGrid, fillBox, makeCell, type MapSpawn } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { METRICS } from './config/metrics.ts';
import { BOBO_NAV_METRICS } from './config/nav-metrics.ts';
import {
  paintPrimaryFor,
  WEAPON_CODE,
  WEAPON_PAINT_MARKER,
  WEAPON_PAINT_SNIPER,
  WEAPON_SLOT,
} from './config/weapons.ts';
import { WEAPON_NONE } from './context.ts';
import { BOT_CONTROLLER_BASE, SIM_HZ } from './constants.ts';
import { ENTITY_FLAG, entityIndex, NULL_ENTITY, type EntityId } from './entity.ts';
import type { OwnerEvent, SimEvent } from './events.ts';
import { aimPointWorld, type AimPoint } from './hitbox.ts';
import { createInputFrames } from './loop.ts';
import { createOwnerScript, OwnerLog } from './owner-script.ts';
import { createSim, navMainComponent, type Sim, type SimConfig, type SimMap } from './sim.ts';
import { MOD } from './systems/chaos.ts';
import {
  isOwnerDormant,
  OWNER,
  ownerAllowed,
  ownerReserveCount,
  ownerReserveSlots,
  ownerSpotNodes,
  ownerSpotTaken,
  type OwnerCommand,
} from './systems/owner.ts';

/**
 * M9 (fase 4): as Ferramentas do Dono na sim. Chão plano de 20 × 40 m com navegação; o humano (controlador 0) e o bot
 * 4 no time 0 (z = 30 m), o bot 5 no time 1 (z = 10 m); a reserva nos controladores 6 e 7. Sem a IA aqui (os quadros
 * dos bots são escritos à mão); a IA está em `ai/src/owner.test.ts`.
 */
const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);
const FLOOR = 0.5;

function flatMap(): SimMap {
  const grid = createWorldGrid(40, 16, 80);
  fillBox(grid, 0, 0, 0, 39, 0, 79, concrete);
  const spawns: MapSpawn[] = [
    { x: cellCenter(10), y: FLOOR, z: 30, yaw: 0, team: 0 },
    { x: cellCenter(16), y: FLOOR, z: 30, yaw: 0, team: 0 },
    { x: cellCenter(10), y: FLOOR, z: 10, yaw: Math.PI, team: 1 },
    { x: cellCenter(16), y: FLOOR, z: 10, yaw: Math.PI, team: 1 },
  ];
  return { grid, blocks, spawns, nav: buildNavGrid({ grid, blocks }, BOBO_NAV_METRICS) };
}

function recipe(extra: Partial<MatchRecipe> = {}): MatchRecipe {
  return {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'test',
    seed: 11,
    match: { timeLimitS: 0, scoreLimit: 0 },
    players: { respawnS: 1, spawnProtectionS: 0 },
    teams: [
      { humans: 1, bots: [{ ref: builtinBotRef('normal'), count: 1 }] },
      { bots: [{ ref: builtinBotRef('normal'), count: 1 }] },
    ],
    ...extra,
  };
}

const HUMAN = 0;
const ALLY = BOT_CONTROLLER_BASE;
const ENEMY = BOT_CONTROLLER_BASE + 1;
const RESERVE = BOT_CONTROLLER_BASE + 2;

function make(extra: Partial<SimConfig> = {}, r: MatchRecipe = recipe()): Sim {
  return createSim({ recipe: r, map: flatMap(), humans: 1, owner: { reserve: 2 }, ...extra });
}

const idx = (sim: Sim, c: number): number => entityIndex(sim.controllerEntity(c));
const dead = (sim: Sim, e: number): boolean => (sim.view().flags[e]! & ENTITY_FLAG.dead) !== 0;

/** Um passo; devolve as cópias dos eventos. */
function step(sim: Sim, f: InputFrame[]): SimEvent[] {
  sim.step(f);
  const out: SimEvent[] = [];
  sim.drainEvents(out);
  return out.map((ev) => ({ ...ev }) as SimEvent);
}

const owners = (events: readonly SimEvent[]): OwnerEvent[] =>
  events.filter((ev): ev is OwnerEvent => ev.type === 'owner');

/** Manda um comando e roda o passo em que ele vale; devolve o evento `owner` dele e todos os eventos. */
function run(sim: Sim, f: InputFrame[], cmd: OwnerCommand): { ev: OwnerEvent; events: SimEvent[] } {
  const seq = sim.command(cmd);
  expect(seq).toBeGreaterThan(0);
  const events = step(sim, f);
  const ev = owners(events).find((e) => e.seq === seq);
  expect(ev).toBeDefined();
  return { ev: ev!, events };
}

function aimAt(sim: Sim, f: InputFrame, c: number, p: AimPoint): void {
  const v = sim.view();
  const e = idx(sim, c);
  const dx = p.x - v.position[e * 3]!;
  const dy = p.y - (v.position[e * 3 + 1]! + METRICS.eyeHeight);
  const dz = p.z - v.position[e * 3 + 2]!;
  f.yaw = yawToU16(Math.atan2(-dx, -dz));
  f.pitch = pitchToI16(Math.atan2(dy, Math.hypot(dx, dz)));
}

/** O humano atira no peito de `target` por até 5 s ou até ele cair; devolve os eventos do caminho. */
function shoot(sim: Sim, f: InputFrame[], target: number): SimEvent[] {
  const out: SimEvent[] = [];
  const p: AimPoint = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 5 * SIM_HZ && !dead(sim, target); i++) {
    aimPointWorld(sim.view(), target, false, p);
    aimAt(sim, f[HUMAN]!, HUMAN, p);
    f[HUMAN]!.buttons = i % 2 === 0 ? BUTTON.fire : 0;
    out.push(...step(sim, f));
  }
  f[HUMAN]!.buttons = 0;
  return out;
}

describe('Ferramentas do Dono: a opção e a reserva', () => {
  it('sem a opção, nada: sem comando, sem reserva, sem modificadores', () => {
    const sim = createSim({ recipe: recipe(), map: flatMap(), humans: 1 });
    expect(sim.command({ kind: 'remove', entity: sim.controllerEntity(ALLY) })).toBe(-1);
    expect(sim.view().owner).toBeNull();
    expect(sim.view().chaos).toBeNull();
    expect(sim.controllerCount).toBe(ENEMY + 1);
    sim.dispose();
  });

  it('a reserva: dormente desde a criação, nunca renasce sozinha, com o estado dos modificadores ligado', () => {
    const sim = make();
    const v = sim.view();
    expect(sim.controllerCount).toBe(RESERVE + 2);
    expect(v.owner).not.toBeNull();
    expect(v.owner!.reserve).toBe(2);
    expect(v.owner!.reserveBase).toBe(RESERVE);
    expect(v.chaos).not.toBeNull();
    expect(v.chaos!.masks[0]).toBe(0);
    const f = createInputFrames();
    for (let t = 0; t < 5 * SIM_HZ; t++) step(sim, f);
    for (const c of [RESERVE, RESERVE + 1]) {
      const e = idx(sim, c);
      expect(sim.controllerEntity(c)).not.toBe(NULL_ENTITY);
      expect(dead(sim, e)).toBe(true);
      expect(isOwnerDormant(v, e)).toBe(true);
    }
    expect(isOwnerDormant(v, idx(sim, ALLY))).toBe(false);
    sim.dispose();
  });

  it('a reserva respeita os tetos (16 e o teto de bots do motor) e é a mesma conta da IA', () => {
    const r = recipe();
    expect(ownerReserveCount(r, 1, 100)).toBe(OWNER.maxReserve);
    expect(ownerReserveCount(r, 1, -3)).toBe(0);
    const full = recipe({ teams: [{ bots: [{ ref: builtinBotRef('normal'), count: 60 }] }, { bots: [] }] });
    expect(ownerReserveCount(full, 0, 8)).toBe(4);
    expect(ownerReserveSlots(r, 1, 2).map((s) => s.controller)).toEqual([RESERVE, RESERVE + 1]);
  });

  it('a sim recusa as ferramentas nos modos que trazem os mortos de volta (Zombies, rodadas, Royale, festa)', () => {
    const map = flatMap();
    const refused: Partial<MatchRecipe>[] = [
      { mode: 'zombies' },
      { mode: 'strike' },
      { mode: 'royale.mini' },
      { mode: 'juggernaut' },
      { mode: 'juggernaut', juggernaut: { variant: 'fixed' } },
      { mode: 'warfare.ffa', infection: {} },
      { mode: 'warfare.ffa', weapons: { ladder: ['pistol', 'knife'] } },
    ];
    for (const extra of refused) {
      // A UI pergunta antes (puro, sem criar a sim); a sim recusa do mesmo jeito.
      expect(ownerAllowed(recipe(extra)), extra.mode).toBe(false);
      expect(() => createSim({ recipe: recipe(extra), map, humans: 1, owner: { reserve: 1 } })).toThrow(
        /Ferramentas do Dono/,
      );
    }
    for (const mode of [
      'warfare.tdm',
      'warfare.ffa',
      'warfare.domination',
      'paintball',
      'training',
      'sandbox',
    ] as const) {
      expect(ownerAllowed(recipe({ mode })), mode).toBe(true);
    }
  });
});

describe('Ferramentas do Dono: os comandos', () => {
  it('spawnBot: o 1º dormente entra num lugar livre perto do ponto, no time pedido; sem reserva, recusa', () => {
    const sim = make();
    const f = createInputFrames();
    const v = sim.view();
    const at = { x: 10, y: FLOOR, z: 20 };
    const a = run(sim, f, { kind: 'spawnBot', team: 1, ...at, yaw: 1 });
    expect(a.ev.ok).toBe(true);
    expect(a.ev.reason).toBe('none');
    expect(a.ev.entity).toBe(sim.controllerEntity(RESERVE));
    expect(a.events.some((ev) => ev.type === 'spawn' && ev.entity === a.ev.entity)).toBe(true);
    const e1 = entityIndex(a.ev.entity);
    expect(dead(sim, e1)).toBe(false);
    expect(v.team[e1]).toBe(1);
    expect(v.health[e1]).toBeGreaterThan(0);
    const d1 = Math.hypot(v.position[e1 * 3]! - at.x, v.position[e1 * 3 + 2]! - at.z);
    expect(d1).toBeLessThan(1);
    expect(v.position[e1 * 3 + 1]).toBeCloseTo(FLOOR, 3);

    // O mesmo ponto: o 2º não nasce em cima do 1º.
    const b = run(sim, f, { kind: 'spawnBot', team: 0, ...at, yaw: 0 });
    expect(b.ev.ok).toBe(true);
    const e2 = entityIndex(b.ev.entity);
    expect(e2).toBe(idx(sim, RESERVE + 1));
    expect(v.team[e2]).toBe(0);
    const apart = Math.hypot(
      v.position[e2 * 3]! - v.position[e1 * 3]!,
      v.position[e2 * 3 + 2]! - v.position[e1 * 3 + 2]!,
    );
    expect(apart).toBeGreaterThanOrEqual(OWNER.placeClearM);
    expect(Math.hypot(v.position[e2 * 3]! - at.x, v.position[e2 * 3 + 2]! - at.z)).toBeLessThan(3);

    // Acabou a reserva.
    const c = run(sim, f, { kind: 'spawnBot', team: 0, ...at, yaw: 0 });
    expect(c.ev.ok).toBe(false);
    expect(c.ev.reason).toBe('reserve');
    expect(c.ev.entity).toBe(NULL_ENTITY);
    sim.dispose();
  });

  it('spawnBot recusa time que não existe e ponto sem lugar livre por perto', () => {
    const sim = make();
    const f = createInputFrames();
    expect(run(sim, f, { kind: 'spawnBot', team: 2, x: 10, y: FLOOR, z: 20, yaw: 0 }).ev.reason).toBe('team');
    expect(run(sim, f, { kind: 'spawnBot', team: 0, x: 500, y: FLOOR, z: 500, yaw: 0 }).ev.reason).toBe('place');
    expect(run(sim, f, { kind: 'spawnBot', team: 0, x: Number.NaN, y: 0, z: 0, yaw: 0 }).ev.reason).toBe('place');
    // Nada saiu da reserva.
    expect(isOwnerDormant(sim.view(), idx(sim, RESERVE))).toBe(true);
    sim.dispose();
  });

  it('remove: o bot sai sem morte no placar e não volta; o da receita volta pelo spawnBot quando a reserva acaba', () => {
    const sim = make();
    const f = createInputFrames();
    const v = sim.view();
    const enemy = sim.controllerEntity(ENEMY);
    const e = entityIndex(enemy);
    const { ev, events } = run(sim, f, { kind: 'remove', entity: enemy });
    expect(ev.ok).toBe(true);
    expect(ev.entity).toBe(enemy);
    expect(events.some((x) => x.type === 'kill')).toBe(false);
    expect(dead(sim, e)).toBe(true);
    expect(v.deaths[e]).toBe(0);
    expect(Array.from(v.match.teamScore)).toEqual([0, 0, 0, 0]);
    for (let t = 0; t < 3 * SIM_HZ; t++) step(sim, f);
    expect(isOwnerDormant(v, e)).toBe(true);
    // Já fora: recusa. Humano: recusa. Id velho: recusa.
    expect(run(sim, f, { kind: 'remove', entity: enemy }).ev.reason).toBe('dormant');
    expect(run(sim, f, { kind: 'remove', entity: sim.controllerEntity(HUMAN) }).ev.reason).toBe('human');
    expect(run(sim, f, { kind: 'freeze', entity: (enemy + 0x10000) >>> 0, on: true }).ev.reason).toBe('entity');
    // A reserva primeiro; depois o removido da receita.
    for (let i = 0; i < 2; i++) run(sim, f, { kind: 'spawnBot', team: 1, x: 6, y: FLOOR, z: 12 + i * 3, yaw: 0 });
    const back = run(sim, f, { kind: 'spawnBot', team: 1, x: 14, y: FLOOR, z: 14, yaw: 0 });
    expect(back.ev.ok).toBe(true);
    expect(back.ev.entity).toBe(enemy);
    expect(dead(sim, e)).toBe(false);
    sim.dispose();
    // Sem reserva nenhuma: o removido também volta.
    const none = make({ owner: { reserve: 0 } });
    const g = createInputFrames();
    expect(none.view().owner!.reserveBase).toBe(RESERVE);
    const ally = none.controllerEntity(ALLY);
    expect(run(none, g, { kind: 'remove', entity: ally }).ev.ok).toBe(true);
    const again = run(none, g, { kind: 'spawnBot', team: 1, x: 10, y: FLOOR, z: 20, yaw: 0 }).ev;
    expect(again.ok).toBe(true);
    expect(again.entity).toBe(ally);
    expect(none.view().team[entityIndex(ally)]).toBe(1);
    none.dispose();
  });

  it('freeze: o bot congelado não anda nem atira (mira parada) e volta ao soltar', () => {
    const sim = make();
    const f = createInputFrames();
    const v = sim.view();
    const ally = sim.controllerEntity(ALLY);
    const e = entityIndex(ally);
    const bot = f[ALLY]!;
    bot.moveY = 127;
    bot.buttons = BUTTON.fire;
    bot.yaw = yawToU16(0.5);
    const yaw0 = v.yaw[e]!;
    expect(run(sim, f, { kind: 'freeze', entity: ally, on: true }).ev.ok).toBe(true);
    expect(v.owner!.frozen[e]).toBe(1);
    const x0 = v.position[e * 3]!;
    const z0 = v.position[e * 3 + 2]!;
    let shots = 0;
    for (let t = 0; t < 2 * SIM_HZ; t++) {
      for (const ev of step(sim, f)) if (ev.type === 'shot' && ev.shooter === ally) shots++;
    }
    expect(shots).toBe(0);
    expect(v.position[e * 3]).toBe(x0);
    expect(v.position[e * 3 + 2]).toBe(z0);
    expect(v.yaw[e]).toBe(yaw0);
    expect(run(sim, f, { kind: 'freeze', entity: ally, on: false }).ev.ok).toBe(true);
    for (let t = 0; t < SIM_HZ; t++) {
      for (const ev of step(sim, f)) if (ev.type === 'shot' && ev.shooter === ally) shots++;
    }
    expect(shots).toBeGreaterThan(0);
    expect(Math.hypot(v.position[e * 3]! - x0, v.position[e * 3 + 2]! - z0)).toBeGreaterThan(1);
    sim.dispose();
  });

  it('freeze com a granada cozinhando: o pino volta (nada é jogado)', () => {
    const sim = make();
    const f = createInputFrames();
    const v = sim.view();
    const ally = sim.controllerEntity(ALLY);
    const e = entityIndex(ally);
    f[ALLY]!.weapon = WEAPON_SLOT.throwable;
    for (let t = 0; t < SIM_HZ; t++) step(sim, f);
    expect(v.weapon[e]).toBe(WEAPON_CODE.grenade);
    f[ALLY]!.buttons = BUTTON.fire;
    for (let t = 0; t < 10; t++) step(sim, f);
    expect(v.cookTicks[e]).toBeGreaterThanOrEqual(0);
    const clip = v.slotClip[e * WEAPON_SLOT_COUNT + WEAPON_SLOT.throwable]!;
    run(sim, f, { kind: 'freeze', entity: ally, on: true });
    expect(v.cookTicks[e]).toBe(-1);
    let thrown = 0;
    for (let t = 0; t < 2 * SIM_HZ; t++) {
      for (const ev of step(sim, f)) if (ev.type === 'projectile' && ev.owner === ally) thrown++;
    }
    expect(thrown).toBe(0);
    expect(v.slotClip[e * WEAPON_SLOT_COUNT + WEAPON_SLOT.throwable]).toBe(clip);
    sim.dispose();
  });

  it('setTeam: a hostilidade e o placar seguem o time novo; humano não', () => {
    const sim = make();
    const f = createInputFrames();
    const v = sim.view();
    const enemy = sim.controllerEntity(ENEMY);
    const e = entityIndex(enemy);
    // No meu time, o tiro passa (sem fogo amigo).
    expect(run(sim, f, { kind: 'setTeam', entity: enemy, team: 0 }).ev.ok).toBe(true);
    expect(v.team[e]).toBe(0);
    const hp = v.health[e]!;
    const friendly = shoot(sim, f, e);
    expect(friendly.some((ev) => ev.type === 'hit' && ev.target === enemy)).toBe(false);
    expect(v.health[e]).toBe(hp);
    // O aliado vira inimigo: o abate conta para o time 0.
    const ally = sim.controllerEntity(ALLY);
    const a = entityIndex(ally);
    expect(run(sim, f, { kind: 'setTeam', entity: ally, team: 1 }).ev.ok).toBe(true);
    const events = shoot(sim, f, a);
    expect(events.some((ev) => ev.type === 'kill' && ev.victim === ally)).toBe(true);
    expect(v.match.teamScore[0]).toBe(1);
    // Inválidos.
    expect(run(sim, f, { kind: 'setTeam', entity: enemy, team: 3 }).ev.reason).toBe('team');
    expect(run(sim, f, { kind: 'setTeam', entity: sim.controllerEntity(HUMAN), team: 1 }).ev.reason).toBe('human');
    sim.dispose();
  });

  it('giveWeapon: na mão na hora e fica depois do renascer, mesmo com a arma fora das liberadas', () => {
    const r = recipe({ weapons: { allowed: ['rifle', 'pistol', 'knife', 'grenade'] } });
    const sim = make({}, r);
    const f = createInputFrames();
    const v = sim.view();
    const ally = sim.controllerEntity(ALLY);
    const e = entityIndex(ally);
    const primary = e * WEAPON_SLOT_COUNT + WEAPON_SLOT.primary;
    expect(v.loadout[primary]).toBe(WEAPON_CODE.rifle);
    expect(run(sim, f, { kind: 'giveWeapon', entity: ally, weapon: WEAPON_CODE.sniper }).ev.ok).toBe(true);
    expect(v.loadout[primary]).toBe(WEAPON_CODE.sniper);
    expect(v.weapon[e]).toBe(WEAPON_CODE.sniper);
    // Cai no vazio e renasce: a sniper continua.
    v.position[e * 3 + 1] = -100;
    for (let t = 0; t < 3 * SIM_HZ && (dead(sim, e) || v.position[e * 3 + 1]! < 0); t++) step(sim, f);
    expect(v.deaths[e]).toBe(1);
    expect(dead(sim, e)).toBe(false);
    expect(v.loadout[primary]).toBe(WEAPON_CODE.sniper);
    // Faca não é primária; código fora do arsenal também não.
    expect(run(sim, f, { kind: 'giveWeapon', entity: ally, weapon: WEAPON_CODE.knife }).ev.reason).toBe('weapon');
    expect(run(sim, f, { kind: 'giveWeapon', entity: ally, weapon: 99 }).ev.reason).toBe('weapon');
    sim.dispose();
  });

  it('setModifier: liga e desliga ao vivo; ligar um desliga o par dele; Arcade e desconhecido não; conflito com a receita não', () => {
    const sim = make();
    const f = createInputFrames();
    const v = sim.view();
    const mask = (): number => v.chaos!.masks[0]!;
    expect(run(sim, f, { kind: 'setModifier', modifier: 'lowGravity', on: true }).ev.ok).toBe(true);
    expect(mask()).toBe(MOD.lowGravity);
    expect(run(sim, f, { kind: 'setModifier', modifier: 'heavyGravity', on: true }).ev.ok).toBe(true);
    expect(mask()).toBe(MOD.heavyGravity);
    expect(run(sim, f, { kind: 'setModifier', modifier: 'oneShot', on: true }).ev.ok).toBe(true);
    expect(v.mods.oneShot).toBe(true);
    // O "tudo explode" tira o "um tiro mata".
    expect(run(sim, f, { kind: 'setModifier', modifier: 'explosive', on: true }).ev.ok).toBe(true);
    expect(mask()).toBe(MOD.heavyGravity | MOD.explosive);
    expect(v.mods.oneShot).toBe(false);
    expect(run(sim, f, { kind: 'setModifier', modifier: 'heavyGravity', on: false }).ev.ok).toBe(true);
    expect(mask()).toBe(MOD.explosive);
    expect(run(sim, f, { kind: 'setModifier', modifier: 'arcade', on: true }).ev.reason).toBe('modifier');
    const bogus = { kind: 'setModifier', modifier: 'nope', on: true } as unknown as OwnerCommand;
    expect(run(sim, f, bogus).ev.reason).toBe('modifier');
    expect(MODIFIERS.length).toBeGreaterThan(0);
    sim.dispose();
    // A regra fixa da receita (um tiro mata nas armas) não sai: o "invisíveis" conflita e é recusado.
    const fixed = make({}, recipe({ weapons: { oneShot: true } }));
    const ev = run(fixed, createInputFrames(), { kind: 'setModifier', modifier: 'invisible', on: true }).ev;
    expect(ev.reason).toBe('conflict');
    expect(fixed.view().chaos!.masks[0]).toBe(0);
    fixed.dispose();
  });

  it('a fila: na ordem de chegada, num ponto só do passo; cheia recusa; partida acabada recusa', () => {
    const sim = make();
    const f = createInputFrames();
    const v = sim.view();
    const s1 = sim.command({ kind: 'setModifier', modifier: 'heavyGravity', on: true });
    const s2 = sim.command({ kind: 'setModifier', modifier: 'lowGravity', on: true });
    expect(s2).toBe(s1 + 1);
    // Antes do passo nada muda.
    expect(v.chaos!.masks[0]).toBe(0);
    const evs = owners(step(sim, f));
    expect(evs.map((e) => e.seq)).toEqual([s1, s2]);
    expect(v.chaos!.masks[0]).toBe(MOD.lowGravity);
    for (let i = 0; i < OWNER.maxQueue; i++) sim.command({ kind: 'setModifier', modifier: 'speed', on: true });
    expect(sim.command({ kind: 'setModifier', modifier: 'speed', on: false })).toBe(-1);
    expect(owners(step(sim, f))).toHaveLength(OWNER.maxQueue);
    sim.finish();
    step(sim, f);
    const late = run(sim, f, { kind: 'freeze', entity: sim.controllerEntity(ALLY), on: true }).ev;
    expect(late.ok).toBe(false);
    expect(late.reason).toBe('ended');
    expect(v.owner!.frozen[idx(sim, ALLY)]).toBe(0);
    sim.dispose();
  });
});

describe('Ferramentas do Dono: determinismo', () => {
  /** Um roteiro que usa todo comando (os bots com quadros fixos: andam e atiram). */
  function script(sim: Sim): { tick: number; cmd: OwnerCommand }[] {
    const ally = sim.controllerEntity(ALLY);
    const enemy = sim.controllerEntity(ENEMY);
    const reserve: EntityId = sim.controllerEntity(RESERVE);
    return [
      { tick: 5, cmd: { kind: 'spawnBot', team: 1, x: 12, y: FLOOR, z: 18, yaw: 0 } },
      { tick: 5, cmd: { kind: 'setModifier', modifier: 'lowGravity', on: true } },
      { tick: 30, cmd: { kind: 'freeze', entity: ally, on: true } },
      { tick: 60, cmd: { kind: 'giveWeapon', entity: reserve, weapon: WEAPON_CODE.shotgun } },
      { tick: 90, cmd: { kind: 'setTeam', entity: enemy, team: 0 } },
      { tick: 120, cmd: { kind: 'freeze', entity: ally, on: false } },
      { tick: 150, cmd: { kind: 'remove', entity: enemy } },
      { tick: 150, cmd: { kind: 'setModifier', modifier: 'speed', on: true } },
    ];
  }

  function botsWalk(f: InputFrame[], t: number): void {
    for (const c of [ALLY, ENEMY, RESERVE]) {
      f[c]!.moveY = 127;
      f[c]!.moveX = t % 120 < 60 ? 60 : -60;
      f[c]!.yaw = yawToU16((t * 0.02 + c) % 6.28);
      f[c]!.buttons = t % 30 < 10 ? BUTTON.fire : 0;
    }
  }

  /** Joga o roteiro "ao vivo" (como a UI: `command` no tick do roteiro) e grava o que foi aceito. */
  function play(ticks: number): { hash: number; log: OwnerLog; ok: number } {
    const sim = make();
    const f = createInputFrames();
    const entries = script(sim);
    const log = new OwnerLog();
    let ok = 0;
    for (let t = 0; t < ticks; t++) {
      botsWalk(f, t);
      for (const { tick, cmd } of entries) {
        if (tick !== sim.tick) continue;
        if (sim.command(cmd) > 0) log.record(sim.tick, cmd);
      }
      for (const ev of owners(step(sim, f))) if (ev.ok) ok++;
    }
    const hash = sim.stateHash();
    sim.dispose();
    return { hash, log, ok };
  }

  it('o mesmo roteiro dá o mesmo hash; o roteiro gravado toca igual', () => {
    const a = play(240);
    const b = play(240);
    expect(b.hash).toBe(a.hash);
    expect(a.ok).toBe(8);
    expect(a.log.entries).toHaveLength(8);
    expect(a.log.entries[0]!.tick).toBe(5);
    // O gravado (passando por JSON), tocado de novo, dá o mesmo hash; sem o roteiro, outro.
    const sim = make();
    const f = createInputFrames();
    const player = createOwnerScript(JSON.parse(JSON.stringify(a.log.entries)) as typeof a.log.entries);
    for (let t = 0; t < 240; t++) {
      botsWalk(f, t);
      player.feed(sim);
      sim.step(f);
    }
    expect(player.done).toBe(true);
    expect(sim.stateHash()).toBe(a.hash);
    sim.dispose();
    const plain = make();
    const g = createInputFrames();
    for (let t = 0; t < 240; t++) {
      botsWalk(g, t);
      plain.step(g);
    }
    expect(plain.stateHash()).not.toBe(a.hash);
    plain.dispose();
  });

  it('o snapshot leva o congelado, as armas liberadas, a reserva e os modificadores (e segue igual)', () => {
    const r = recipe({ weapons: { allowed: ['rifle', 'pistol', 'knife', 'grenade'] } });
    const sim = make({}, r);
    const f = createInputFrames();
    const ally = sim.controllerEntity(ALLY);
    run(sim, f, { kind: 'spawnBot', team: 1, x: 12, y: FLOOR, z: 18, yaw: 0 });
    run(sim, f, { kind: 'freeze', entity: ally, on: true });
    run(sim, f, { kind: 'giveWeapon', entity: sim.controllerEntity(ENEMY), weapon: WEAPON_CODE.sniper });
    run(sim, f, { kind: 'setModifier', modifier: 'bigHead', on: true });
    const w = new BitWriter(512 * 1024);
    sim.writeSnapshot(w);
    const copy = make({}, r);
    copy.readSnapshot(new BitReader(w.bytes().slice()));
    expect(copy.stateHash()).toBe(sim.stateHash());
    expect(copy.view().owner!.frozen[entityIndex(ally)]).toBe(1);
    expect(copy.view().chaos!.masks[0]).toBe(MOD.bigHead);
    // O inimigo cai no vazio nas duas: renasce com a sniper (a máscara alargada veio no snapshot).
    const enemy = idx(sim, ENEMY);
    for (const s of [sim, copy]) s.view().position[enemy * 3 + 1] = -100;
    for (let t = 0; t < 3 * SIM_HZ; t++) {
      botsWalk(f, t);
      sim.step(f);
      copy.step(f);
    }
    expect(copy.stateHash()).toBe(sim.stateHash());
    expect(copy.view().loadout[enemy * WEAPON_SLOT_COUNT]).toBe(WEAPON_CODE.sniper);
    // Uma sim sem o dono não lê (o conjunto de entidades é outro).
    const plain = createSim({ recipe: r, map: flatMap(), humans: 1 });
    expect(() => plain.readSnapshot(new BitReader(w.bytes().slice()))).toThrow();
    plain.dispose();
    sim.dispose();
    copy.dispose();
  });
});

describe('Ferramentas do Dono: revisão', () => {
  it('spawnBot: o rumo pedido vale (o quadro velho da IA fica de fora só no passo da entrada)', () => {
    const sim = make();
    const f = createInputFrames();
    const v = sim.view();
    // O quadro da reserva é de quando ela estava fora de jogo (outro rumo).
    f[RESERVE]!.yaw = yawToU16(2);
    const { ev } = run(sim, f, { kind: 'spawnBot', team: 0, x: 10, y: FLOOR, z: 20, yaw: -1 });
    const e = entityIndex(ev.entity);
    // Normalizado em [0, 2π), no passo do quadro (u16).
    expect(v.yaw[e]).toBeCloseTo(u16ToYaw(yawToU16(2 * Math.PI - 1)), 9);
    // No passo seguinte a entrada volta a valer.
    step(sim, f);
    expect(v.yaw[e]).toBeCloseTo(u16ToYaw(yawToU16(2)), 9);
    sim.dispose();
  });

  it('giveWeapon no Paintball dá a versão de tinta (na mão e no renascer)', () => {
    const sim = make({}, recipe({ mode: 'paintball' }));
    const f = createInputFrames();
    const v = sim.view();
    const ally = sim.controllerEntity(ALLY);
    const e = entityIndex(ally);
    const primary = e * WEAPON_SLOT_COUNT + WEAPON_SLOT.primary;
    expect(v.loadout[primary]).toBe(WEAPON_PAINT_MARKER);
    expect(run(sim, f, { kind: 'giveWeapon', entity: ally, weapon: WEAPON_CODE.rocket }).ev.ok).toBe(true);
    expect(v.weapon[e]).toBe(WEAPON_PAINT_MARKER);
    expect(run(sim, f, { kind: 'giveWeapon', entity: ally, weapon: WEAPON_CODE.sniper }).ev.ok).toBe(true);
    expect(v.weapon[e]).toBe(WEAPON_PAINT_SNIPER);
    expect(v.loadout[primary]).toBe(paintPrimaryFor(WEAPON_CODE.sniper));
    v.position[e * 3 + 1] = -100;
    for (let t = 0; t < 3 * SIM_HZ && (dead(sim, e) || v.position[e * 3 + 1]! < 0); t++) step(sim, f);
    expect(dead(sim, e)).toBe(false);
    expect(v.loadout[primary]).toBe(WEAPON_PAINT_SNIPER);
    sim.dispose();
  });

  it('a Roleta: o que o dono ligou antes da largada fica (a largada sorteia em cima)', () => {
    const r = recipe({ chaos: { count: 2 } });
    const sim = make({}, r);
    const f = createInputFrames();
    const v = sim.view();
    // Sem contagem, a largada é no 1º passo (logo depois dos comandos do dono).
    expect(run(sim, f, { kind: 'setModifier', modifier: 'lowGravity', on: true }).ev.ok).toBe(true);
    const mask = v.chaos!.masks[0]!;
    expect(mask & MOD.lowGravity).toBe(MOD.lowGravity);
    expect(mask & MOD.heavyGravity).toBe(0);
    expect(bits(mask)).toBe(3);
    // Sem o dono, a largada sai igual à de sempre (só os sorteados).
    const plain = createSim({ recipe: r, map: flatMap(), humans: 1 });
    plain.step(createInputFrames());
    expect(bits(plain.view().chaos!.masks[0]!)).toBe(2);
    plain.dispose();
    sim.dispose();
  });

  it('setModifier não desliga o "só na cabeça" nem o "um tiro mata" das regras de arma da receita', () => {
    const sim = make({}, recipe({ weapons: { oneShot: true, headshotOnly: true } }));
    const f = createInputFrames();
    expect(run(sim, f, { kind: 'setModifier', modifier: 'oneShot', on: false }).ev.reason).toBe('conflict');
    expect(run(sim, f, { kind: 'setModifier', modifier: 'headshotOnly', on: false }).ev.reason).toBe('conflict');
    expect(sim.view().mods.oneShot).toBe(true);
    expect(sim.view().mods.headshotOnly).toBe(true);
    sim.dispose();
  });

  it('o Sandbox: setTeam e spawnBot põem o bot nas regras do time de destino (vida e armas)', () => {
    const r = recipe({
      mode: 'sandbox',
      teams: [
        { humans: 1, bots: [{ ref: builtinBotRef('normal'), count: 1 }] },
        { bots: [{ ref: builtinBotRef('normal'), count: 1 }] },
        { hp: 150, weapons: ['sniper'], bots: [] },
      ],
    });
    const sim = make({}, r);
    const f = createInputFrames();
    const v = sim.view();
    const ally = sim.controllerEntity(ALLY);
    const e = entityIndex(ally);
    const k = e * WEAPON_SLOT_COUNT;
    expect(v.loadout[k + WEAPON_SLOT.primary]).toBe(WEAPON_CODE.rifle);
    expect(v.health[e]).toBe(100);
    // setTeam: as armas que o time novo não libera trocam na hora; a vida não cura (o teto novo vale no renascer).
    expect(run(sim, f, { kind: 'setTeam', entity: ally, team: 2 }).ev.ok).toBe(true);
    expect(v.loadout[k + WEAPON_SLOT.primary]).toBe(WEAPON_CODE.sniper);
    expect(v.weapon[e]).toBe(WEAPON_CODE.sniper);
    for (const slot of [WEAPON_SLOT.secondary, WEAPON_SLOT.melee, WEAPON_SLOT.throwable]) {
      expect(v.loadout[k + slot]).toBe(WEAPON_NONE);
    }
    // Sem cura na troca: só a regeneração de sempre do tick (o teto agora é 150).
    expect(v.health[e]).toBeGreaterThanOrEqual(100);
    expect(v.health[e]).toBeLessThan(101);
    v.position[e * 3 + 1] = -100;
    for (let t = 0; t < 3 * SIM_HZ && (dead(sim, e) || v.position[e * 3 + 1]! < 0); t++) step(sim, f);
    expect(dead(sim, e)).toBe(false);
    expect(v.health[e]).toBe(150);
    expect(v.loadout[k + WEAPON_SLOT.primary]).toBe(WEAPON_CODE.sniper);
    // De volta ao time 0: a vida máxima cai na hora (a vida corta no teto), as armas voltam no renascer.
    expect(run(sim, f, { kind: 'setTeam', entity: ally, team: 0 }).ev.ok).toBe(true);
    expect(v.health[e]).toBe(100);
    // spawnBot: o bot da reserva já entra com as regras do time pedido.
    const spawned = run(sim, f, { kind: 'spawnBot', team: 2, x: 10, y: FLOOR, z: 20, yaw: 0 }).ev;
    const b = entityIndex(spawned.entity);
    expect(v.health[b]).toBe(150);
    expect(v.loadout[b * WEAPON_SLOT_COUNT + WEAPON_SLOT.primary]).toBe(WEAPON_CODE.sniper);
    expect(v.loadout[b * WEAPON_SLOT_COUNT + WEAPON_SLOT.secondary]).toBe(WEAPON_NONE);
    sim.dispose();
  });

  it('quem o dono tirou não pontua: some o que voava, sai dos créditos e não lidera o FFA', () => {
    const ffa = recipe({
      mode: 'warfare.ffa',
      teams: [{ humans: 1, bots: [{ ref: builtinBotRef('normal'), count: 2 }] }],
    });
    const sim = make({}, ffa);
    const f = createInputFrames();
    const v = sim.view();
    const ally = sim.controllerEntity(ALLY);
    const e = entityIndex(ally);
    // Uma granada no ar.
    f[ALLY]!.weapon = WEAPON_SLOT.throwable;
    for (let t = 0; t < SIM_HZ; t++) step(sim, f);
    f[ALLY]!.buttons = BUTTON.fire;
    for (let t = 0; t < 10; t++) step(sim, f);
    f[ALLY]!.buttons = 0;
    step(sim, f);
    const flying = (): number => {
      let n = 0;
      const pv = v.projectiles;
      for (let p = 0; p < pv.count; p++) if (pv.alive[p] === 1 && pv.owner[p] === ally) n++;
      return n;
    };
    expect(flying()).toBe(1);
    // O crédito do plano de morte apontando para ele; e o maior número de abates.
    const enemy = idx(sim, ENEMY);
    v.lastAttacker[enemy] = ally;
    v.kills[e] = 5;
    expect(run(sim, f, { kind: 'remove', entity: ally }).ev.ok).toBe(true);
    expect(flying()).toBe(0);
    expect(v.lastAttacker[enemy]).toBe(NULL_ENTITY);
    sim.finish();
    step(sim, f);
    expect(v.match.phase).toBe('ended');
    expect(v.match.winnerEntity).not.toBe(ally);
    sim.dispose();
  });

  it('o "criar bot onde mira" fica dentro da área jogável', () => {
    const map = { ...flatMap(), playArea: { minX: 2, minZ: 2, maxX: 15, maxZ: 38 } };
    const sim = createSim({ recipe: recipe(), map, humans: 1, owner: { reserve: 1 } });
    const f = createInputFrames();
    const { ev } = run(sim, f, { kind: 'spawnBot', team: 0, x: 19, y: FLOOR, z: 20, yaw: 0 });
    expect(ev.ok).toBe(true);
    const e = entityIndex(ev.entity);
    expect(sim.view().position[e * 3]).toBeLessThanOrEqual(15 - METRICS.aabbWidth / 2);
    sim.dispose();
  });

  it('fase 5b: a conta do lugar é pública (a cena escolhe o nó antes): em ordem, na área, e o nó mandado é o da sim', () => {
    const map = { ...flatMap(), playArea: { minX: 2, minZ: 2, maxX: 15, maxZ: 38 } };
    const sim = createSim({ recipe: recipe(), map, humans: 1, owner: { reserve: 2 } });
    const f = createInputFrames();
    const v = sim.view();
    const nav = v.nav!;
    const main = navMainComponent(nav);
    const nodes = new Int32Array(8);
    const d2 = new Float64Array(8);
    const at = new Float64Array(3);
    // Os 8 nós mais perto de (10, chão, 20), em ordem de distância, até 3 m e todos dentro da área.
    const n = ownerSpotNodes(nav, main, v.playArea, 10, FLOOR, 20, 3, nodes, d2);
    expect(n).toBe(8);
    for (let k = 0; k < n; k++) {
      nav.nodePosition(nodes[k]!, at, 0);
      const d = (at[0]! - 10) ** 2 + (at[1]! - FLOOR) ** 2 + (at[2]! - 20) ** 2;
      expect(d2[k]).toBeCloseTo(d, 9);
      if (k > 0) expect(d2[k]).toBeGreaterThanOrEqual(d2[k - 1]!);
      expect(d).toBeLessThanOrEqual(9);
    }
    // Perto da borda: nada fora da área (a meia largura da caixa conta); outro componente: nada.
    const edge = ownerSpotNodes(nav, main, v.playArea, 15, FLOOR, 20, 3, nodes, d2);
    for (let k = 0; k < edge; k++) {
      nav.nodePosition(nodes[k]!, at, 0);
      expect(at[0]).toBeLessThanOrEqual(15 - METRICS.aabbWidth / 2);
    }
    expect(ownerSpotNodes(nav, main + 1000, v.playArea, 10, FLOOR, 20, 3, nodes, d2)).toBe(0);
    // O nó mandado no comando é o que a sim usa (distância 0); depois dele, o mesmo nó está tomado.
    ownerSpotNodes(nav, main, v.playArea, 10.3, FLOOR, 20.2, 3, nodes, d2);
    nav.nodePosition(nodes[3]!, at, 0);
    expect(ownerSpotTaken(v, at[0]!, at[1]!, at[2]!)).toBe(false);
    const { ev } = run(sim, f, { kind: 'spawnBot', team: 0, x: at[0]!, y: at[1]!, z: at[2]!, yaw: 0 });
    const e = entityIndex(ev.entity);
    expect([v.position[e * 3], v.position[e * 3 + 1], v.position[e * 3 + 2]]).toEqual([at[0], at[1], at[2]]);
    expect(ownerSpotTaken(v, at[0]!, at[1]!, at[2]!)).toBe(true);
    // Tirado da partida (dormente), o lugar fica livre de novo.
    run(sim, f, { kind: 'remove', entity: ev.entity });
    expect(ownerSpotTaken(v, at[0]!, at[1]!, at[2]!)).toBe(false);
    sim.dispose();
  });

  it('o log do replay tem teto e diz quando encheu', () => {
    const log = new OwnerLog(2);
    const cmd: OwnerCommand = { kind: 'setModifier', modifier: 'speed', on: true };
    expect(log.record(0, cmd)).toBe(true);
    expect(log.record(1, cmd)).toBe(true);
    expect(log.full).toBe(true);
    expect(log.record(2, cmd)).toBe(false);
    expect(log.dropped).toBe(1);
    expect(log.entries).toHaveLength(2);
  });
});

function bits(mask: number): number {
  let n = 0;
  for (let b = mask; b !== 0; b &= b - 1) n++;
  return n;
}
