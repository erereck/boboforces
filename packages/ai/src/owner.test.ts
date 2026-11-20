import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BitReader, BitWriter } from '@boboforces/shared';
import {
  BOT_CONTROLLER_BASE,
  createOwnerScript,
  createSim,
  ENTITY_FLAG,
  entityIndex,
  WEAPON_CODE,
  type OwnerEvent,
  type OwnerScriptEntry,
  type Sim,
  type SimEvent,
  type SimMap,
} from '@boboforces/sim';
import { buildSyntheticConstruto, TEST_NAV_PATHS } from '@boboforces/sim/testing';
import { describe, expect, it } from 'vitest';
import { createHeadlessMatch, type HeadlessMatch } from './headless.ts';
import { botPrimaries } from './weapons.ts';

/**
 * M9 (fase 4): as Ferramentas do Dono com a IA, no Construto sintético (navegação de teste): 2 × 2 bots Normal e uma
 * reserva de 4. O roteiro de comandos (a base do replay) dá o mesmo hash duas vezes; o snapshot no meio segue igual.
 */
const RECIPE: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'warfare.tdm',
  map: 'construto',
  seed: 5,
  match: { timeLimitS: 0, scoreLimit: 0 },
  teams: [
    { bots: [{ ref: builtinBotRef('normal'), count: 2 }] },
    { bots: [{ ref: builtinBotRef('normal'), count: 2 }] },
  ],
};
const OWNER = { reserve: 4 } as const;
/** Controladores: os 4 da receita, depois os 4 da reserva. */
const BOT = (i: number): number => BOT_CONTROLLER_BASE + i;
const RES = (i: number): number => BOT_CONTROLLER_BASE + 4 + i;

let cached: SimMap | null = null;
function construto(): SimMap {
  cached ??= buildSyntheticConstruto({ nav: true }).map;
  return cached;
}

/** O id de entidade de um controlador (estável na partida: a sim aloca tudo na criação). */
function idOf(c: number): number {
  const sim = createSim({ recipe: RECIPE, map: construto(), humans: 0, owner: OWNER });
  const id = sim.controllerEntity(c);
  sim.dispose();
  return id;
}

/** O roteiro: todo comando, em ticks variados (dois no mesmo tick também). */
function script(): OwnerScriptEntry[] {
  return [
    { tick: 30, cmd: { kind: 'spawnBot', team: 0, x: 40, y: 0.5, z: 60, yaw: Math.PI } },
    { tick: 30, cmd: { kind: 'spawnBot', team: 1, x: 40, y: 0.5, z: 20, yaw: 0 } },
    { tick: 120, cmd: { kind: 'freeze', entity: idOf(RES(0)), on: true } },
    { tick: 240, cmd: { kind: 'setTeam', entity: idOf(BOT(0)), team: 1 } },
    { tick: 300, cmd: { kind: 'giveWeapon', entity: idOf(RES(1)), weapon: WEAPON_CODE.sniper } },
    { tick: 360, cmd: { kind: 'setModifier', modifier: 'lowGravity', on: true } },
    { tick: 480, cmd: { kind: 'freeze', entity: idOf(RES(0)), on: false } },
    { tick: 600, cmd: { kind: 'remove', entity: idOf(BOT(3)) } },
    { tick: 700, cmd: { kind: 'spawnBot', team: 0, x: 30, y: 0.5, z: 50, yaw: 0 } },
  ];
}

function match(entries: readonly OwnerScriptEntry[], onEvents?: (ev: readonly SimEvent[], sim: Sim) => void) {
  return createHeadlessMatch({
    recipe: RECIPE,
    map: construto(),
    humans: 0,
    paths: TEST_NAV_PATHS,
    owner: OWNER,
    ownerScript: entries,
    ...(onEvents ? { onEvents } : {}),
  });
}

describe('Ferramentas do Dono com a IA (Construto sintético)', () => {
  it('a reserva ganha cérebros desde o começo', () => {
    const m = match([]);
    expect(m.director.botCount).toBe(8);
    expect(m.sim.view().owner!.reserve).toBe(4);
    m.run(120);
    // Dormentes: os cérebros não tiram ninguém de lá.
    for (let i = 0; i < 4; i++) {
      const e = entityIndex(m.sim.controllerEntity(RES(i)));
      expect(m.sim.view().flags[e]! & ENTITY_FLAG.dead).not.toBe(0);
    }
    m.dispose();
    // O 1º teste monta o Construto sintético com a navegação de teste (o resto reaproveita).
  }, 60_000);

  it('o roteiro de comandos dá o mesmo hash duas vezes (e todos valem)', () => {
    const run = (): { hash: number; ok: number; fail: OwnerEvent[] } => {
      let ok = 0;
      const fail: OwnerEvent[] = [];
      const m = match(script(), (events) => {
        for (const ev of events) {
          if (ev.type !== 'owner') continue;
          if (ev.ok) ok++;
          else fail.push({ ...ev });
        }
      });
      m.run(900);
      const hash = m.sim.stateHash();
      m.dispose();
      return { hash, ok, fail };
    };
    const a = run();
    const b = run();
    expect(a.fail).toEqual([]);
    expect(a.ok).toBe(script().length);
    expect(b.hash).toBe(a.hash);
  }, 60_000);

  it('o bot congelado não anda nem atira com a IA ligada; solto, volta a jogar', () => {
    const frozenId = idOf(RES(0));
    const e = entityIndex(frozenId);
    let shots = 0;
    const m = match(
      [
        { tick: 10, cmd: { kind: 'spawnBot', team: 0, x: 40, y: 0.5, z: 40, yaw: 0 } },
        { tick: 10, cmd: { kind: 'freeze', entity: frozenId, on: true } },
      ],
      (events) => {
        for (const ev of events) if (ev.type === 'shot' && ev.shooter === frozenId) shots++;
      },
    );
    const v = m.sim.view();
    m.run(11);
    expect(v.flags[e]! & ENTITY_FLAG.dead).toBe(0);
    expect(v.owner!.frozen[e]).toBe(1);
    let moved = 0;
    for (let t = 0; t < 600; t++) {
      const wasAlive = (v.flags[e]! & ENTITY_FLAG.dead) === 0;
      const x = v.position[e * 3]!;
      const z = v.position[e * 3 + 2]!;
      m.step();
      if (wasAlive && (v.flags[e]! & ENTITY_FLAG.dead) === 0) {
        moved += Math.hypot(v.position[e * 3]! - x, v.position[e * 3 + 2]! - z);
      }
    }
    expect(shots).toBe(0);
    expect(moved).toBeLessThan(0.5);
    m.command({ kind: 'freeze', entity: frozenId, on: false });
    let walked = 0;
    for (let t = 0; t < 900; t++) {
      const x = v.position[e * 3]!;
      const z = v.position[e * 3 + 2]!;
      const wasAlive = (v.flags[e]! & ENTITY_FLAG.dead) === 0;
      m.step();
      if (wasAlive && (v.flags[e]! & ENTITY_FLAG.dead) === 0) {
        walked += Math.hypot(v.position[e * 3]! - x, v.position[e * 3 + 2]! - z);
      }
    }
    expect(walked).toBeGreaterThan(3);
    m.dispose();
  }, 60_000);

  it('o snapshot no meio da partida (com o dono) segue igual com as mesmas entradas e comandos', () => {
    const entries = script();
    const a = match(entries);
    const SPLIT = 450;
    a.run(SPLIT);
    const w = new BitWriter(1024 * 1024);
    a.sim.writeSnapshot(w);
    const b = createSim({
      recipe: RECIPE,
      map: construto(),
      humans: 0,
      owner: OWNER,
      primaries: botPrimaries(RECIPE, 0, OWNER.reserve),
    });
    b.readSnapshot(new BitReader(w.bytes().slice()));
    expect(b.stateHash()).toBe(a.sim.stateHash());
    const rest = createOwnerScript(entries.filter((x) => x.tick >= SPLIT));
    for (let t = SPLIT; t < 900; t++) {
      a.step();
      rest.feed(b);
      b.step(a.frames);
      if (t % 50 === 0) expect(b.stateHash()).toBe(a.sim.stateHash());
    }
    expect(rest.done).toBe(true);
    expect(b.stateHash()).toBe(a.sim.stateHash());
    b.dispose();
    a.dispose();
  }, 60_000);

  it('o "Ajustar desafio" segue o time de agora (o dono trocou um bot de lado)', () => {
    const m: HeadlessMatch = match([{ tick: 0, cmd: { kind: 'setTeam', entity: idOf(BOT(0)), team: 1 } }]);
    m.run(2);
    expect(m.sim.view().team[entityIndex(idOf(BOT(0)))]).toBe(1);
    expect(m.director.setLevel('chill', 1)).toBe(3);
    m.dispose();
    // Sem o dono, como antes: o time da receita (na Infection o time muda, e o desafio segue os do começo).
    const plain = createHeadlessMatch({ recipe: RECIPE, map: construto(), humans: 0, paths: TEST_NAV_PATHS });
    plain.run(2);
    plain.sim.view().team[entityIndex(plain.sim.controllerEntity(BOT(0)))] = 1;
    expect(plain.director.setLevel('chill', 1)).toBe(2);
    plain.dispose();
  }, 60_000);
});
