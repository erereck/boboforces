import { MATCH_RECIPE_FORMAT, MODIFIERS, type MatchRecipe, type ModifierId } from '@boboforces/format';
import { BUTTON, type InputFrame } from '@boboforces/input';
import { BitReader, BitWriter, pitchToI16, yawToU16 } from '@boboforces/shared';
import { cellCenter, createTestBlocks, createWorldGrid, fillBox, makeCell, type MapSpawn } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { METRICS } from './config/metrics.ts';
import { WEAPON_CHAOS_BLAST, WEAPON_CODE } from './config/weapons.ts';
import { SIM_HZ } from './constants.ts';
import { ENTITY_FLAG, entityIndex } from './entity.ts';
import type { SimEvent } from './events.ts';
import { aimPointWorld, type AimPoint } from './hitbox.ts';
import { createInputFrames } from './loop.ts';
import { createSim, type Sim, type SimMap } from './sim.ts';
import { MOD } from './systems/chaos.ts';
import { heldClip } from './view.ts';

/**
 * M6 (fase 4): os modificadores e a Roleta do Bobo Chaos na sim. Dois humanos num chão plano, um de frente para o
 * outro a 8 m (sem bots).
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

function recipe(extra: Partial<MatchRecipe> = {}): MatchRecipe {
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
    ...extra,
  };
}

const withMods = (...ids: ModifierId[]): MatchRecipe => recipe({ modifiers: ids });
const entity = (sim: Sim, c: number): number => entityIndex(sim.controllerEntity(c));
const popcount = (m: number): number => {
  let n = 0;
  for (let b = m; b !== 0; b &= b - 1) n++;
  return n;
};

function aimAt(sim: Sim, f: InputFrame, c: number, p: AimPoint): void {
  const v = sim.view();
  const e = entity(sim, c);
  const dx = p.x - v.position[e * 3]!;
  const dy = p.y - (v.position[e * 3 + 1]! + METRICS.eyeHeight);
  const dz = p.z - v.position[e * 3 + 2]!;
  f.yaw = yawToU16(Math.atan2(-dx, -dz));
  f.pitch = pitchToI16(Math.atan2(dy, Math.hypot(dx, dz)));
}

/** `c` atira no peito do outro até `stop` (no máximo 5 s); devolve os eventos do caminho. */
function shoot(sim: Sim, f: InputFrame[], c: number, stop: () => boolean): SimEvent[] {
  const out: SimEvent[] = [];
  const p: AimPoint = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 5 * SIM_HZ && !stop(); i++) {
    aimPointWorld(sim.view(), entity(sim, 1 - c), false, p);
    aimAt(sim, f[c]!, c, p);
    f[c]!.buttons = BUTTON.fire | BUTTON.ads;
    sim.step(f);
    const events: SimEvent[] = [];
    sim.drainEvents(events);
    for (const ev of events) out.push({ ...ev } as SimEvent);
  }
  f[c]!.buttons = 0;
  return out;
}

/** Anda para a frente por `ticks` e devolve a distância percorrida (m). */
function walk(sim: Sim, ticks: number): number {
  const f = createInputFrames();
  const e = entity(sim, 0);
  const z0 = sim.view().position[e * 3 + 2]!;
  f[0]!.moveY = 127;
  for (let i = 0; i < ticks; i++) sim.step(f);
  return Math.abs(sim.view().position[e * 3 + 2]! - z0);
}

/** Pula parado e devolve a altura máxima dos pés acima do chão (m) e os ticks no ar. */
function jumpPeak(sim: Sim): { peak: number; air: number } {
  const f = createInputFrames();
  const e = entity(sim, 0);
  sim.step(f);
  const y0 = sim.view().position[e * 3 + 1]!;
  let peak = 0;
  let air = 0;
  f[0]!.buttons = BUTTON.jump;
  for (let i = 0; i < 3 * SIM_HZ; i++) {
    sim.step(f);
    f[0]!.buttons = 0;
    const h = sim.view().position[e * 3 + 1]! - y0;
    peak = Math.max(peak, h);
    if (h > 0.01) air++;
  }
  return { peak, air };
}

describe('modificadores (M6 fase 4)', () => {
  it('a Lua pula mais alto; a pesada pula da mesma altura e cai mais rápido; a Pressa anda 1,5x', () => {
    const jumps = (['none', 'lowGravity', 'heavyGravity'] as const).map((m) => {
      const sim = createSim({ recipe: m === 'none' ? recipe() : withMods(m), map: flatMap(), humans: 2 });
      const p = jumpPeak(sim);
      sim.dispose();
      return p;
    });
    expect(jumps[1]!.peak).toBeGreaterThan(jumps[0]!.peak * 2);
    // Revisão: a pesada não baixa o pulo (a navegação tem pulos de até 1 m), só o deixa mais curto no tempo.
    expect(Math.abs(jumps[2]!.peak - jumps[0]!.peak)).toBeLessThan(0.05);
    expect(jumps[2]!.air).toBeLessThan(jumps[0]!.air * 0.8);
    const normal = createSim({ recipe: recipe(), map: flatMap(), humans: 2 });
    const fast = createSim({ recipe: withMods('speed'), map: flatMap(), humans: 2 });
    const a = walk(normal, SIM_HZ);
    const b = walk(fast, SIM_HZ);
    expect(b / a).toBeGreaterThan(1.4);
    expect(b / a).toBeLessThan(1.6);
    normal.dispose();
    fast.dispose();
  });

  it('revisão: a munição infinita não vale para a granada; a troca por abate respeita as armas permitidas', () => {
    const sim = createSim({ recipe: withMods('infiniteAmmo'), map: flatMap(), humans: 2 });
    const f = createInputFrames();
    sim.step(f);
    const a = entity(sim, 0);
    const nades = (): number => sim.view().slotClip[a * 4 + 3]!;
    const before = nades();
    f[0]!.pitch = pitchToI16(0.5);
    f[0]!.buttons = BUTTON.grenade;
    for (let i = 0; i < 3; i++) sim.step(f);
    f[0]!.buttons = 0;
    for (let i = 0; i < 5; i++) sim.step(f);
    expect(nades()).toBe(before - 1);
    sim.dispose();
    // Só fuzil e sniper: quem abate de fuzil ganha a sniper (a única outra que pode).
    const only = createSim({
      recipe: recipe({ modifiers: ['swapOnKill'], weapons: { allowed: ['rifle', 'sniper'] } }),
      map: flatMap(),
      humans: 2,
    });
    const g = createInputFrames();
    only.step(g);
    const b = entity(only, 1);
    shoot(only, g, 0, () => (only.view().flags[b]! & ENTITY_FLAG.dead) !== 0);
    expect(only.view().weapon[entity(only, 0)]).toBe(WEAPON_CODE.sniper);
    only.dispose();
  });

  it('munição infinita: o pente não acaba e ninguém recarrega', () => {
    const sim = createSim({ recipe: withMods('infiniteAmmo'), map: flatMap(), humans: 2 });
    const f = createInputFrames();
    f[0]!.pitch = pitchToI16(1.2);
    f[0]!.buttons = BUTTON.fire;
    let reloaded = false;
    for (let i = 0; i < 6 * SIM_HZ; i++) {
      sim.step(f);
      if ((sim.view().flags[entity(sim, 0)]! & ENTITY_FLAG.reloading) !== 0) reloaded = true;
    }
    expect(reloaded).toBe(false);
    expect(heldClip(sim.view(), entity(sim, 0))).toBe(30);
    sim.dispose();
  });

  it('tudo explode, a troca de arma por abate e o vampiro', () => {
    const sim = createSim({ recipe: withMods('explosive', 'swapOnKill', 'vampire'), map: flatMap(), humans: 2 });
    const f = createInputFrames();
    sim.step(f);
    const a = entity(sim, 0);
    const b = entity(sim, 1);
    // B fere A primeiro (A fica abaixo de 100); depois A atira em B e recupera o que tira.
    shoot(sim, f, 1, () => sim.view().health[a]! < 70);
    const hurt = sim.view().health[a]!;
    expect(hurt).toBeLessThan(70);
    const events = shoot(sim, f, 0, () => (sim.view().flags[b]! & ENTITY_FLAG.dead) !== 0);
    expect(sim.view().health[a]!).toBeGreaterThan(hurt);
    // B morreu e explodiu (a explosão do modificador, de B, onde ele estava).
    const kill = events.find((ev) => ev.type === 'kill');
    expect(kill).toBeDefined();
    expect(events.some((ev) => ev.type === 'explosion' && ev.weapon === WEAPON_CHAOS_BLAST)).toBe(true);
    // A ganhou outra primária (o fuzil era a dele).
    expect(sim.view().weapon[a]).not.toBe(WEAPON_CODE.rifle);
    sim.dispose();
  });

  it('a Roleta: 3 sorteados na largada, o aviso 5 s antes troca um, e a troca a cada minuto', () => {
    const r = recipe({ chaos: {}, modifiers: ['vampire'] });
    const sim = createSim({ recipe: r, map: flatMap(), humans: 2 });
    const f = createInputFrames();
    const masks = sim.view().chaos!.masks;
    expect(masks[0]).toBe(MOD.vampire);
    sim.step(f);
    // O fixo e mais 3, sem a gravidade lunar e a pesada juntas.
    const first = masks[0]!;
    expect(first & MOD.vampire).toBe(MOD.vampire);
    expect(popcount(first)).toBe(4);
    expect((first & MOD.lowGravity) !== 0 && (first & MOD.heavyGravity) !== 0).toBe(false);
    expect(masks[1]).toBe(first);
    // 55 s depois (o aviso): a próxima troca um da Roleta (nunca o fixo).
    for (let i = 0; i < 55 * SIM_HZ; i++) sim.step(f);
    const next = masks[1]!;
    expect(masks[0]).toBe(first);
    expect(popcount(next)).toBe(4);
    expect(popcount(next ^ first)).toBe(2);
    expect(next & MOD.vampire).toBe(MOD.vampire);
    expect(masks[2]).toBe(5 * SIM_HZ);
    // No minuto, a próxima vira a ligada.
    for (let i = 0; i < 5 * SIM_HZ; i++) sim.step(f);
    expect(masks[0]).toBe(next);
    expect(masks[2]).toBe(60 * SIM_HZ);
    // Todos os bits são de modificadores conhecidos.
    expect(masks[0]! >> MODIFIERS.length).toBe(0);
    sim.dispose();
  });

  it('o estado da Roleta entra no snapshot e no hash (a gravidade sorteada vale na cópia)', () => {
    const r = recipe({ chaos: { everyS: 20 } });
    const frames = createInputFrames();
    const one = createSim({ recipe: r, map: flatMap(), humans: 2 });
    for (let i = 0; i < 17 * SIM_HZ; i++) one.step(frames);
    const two = createSim({ recipe: r, map: flatMap(), humans: 2 });
    const w = new BitWriter(64 * 1024);
    one.writeSnapshot(w);
    two.readSnapshot(new BitReader(w.bytes()));
    expect(two.stateHash()).toEqual(one.stateHash());
    for (let i = 0; i < 10 * SIM_HZ; i++) {
      frames[0]!.buttons = i % 90 === 0 ? BUTTON.jump : 0;
      one.step(frames);
      two.step(frames);
    }
    expect(two.stateHash()).toEqual(one.stateHash());
    expect([...two.view().chaos!.masks]).toEqual([...one.view().chaos!.masks]);
    one.dispose();
    two.dispose();
  });

  it('Cabeção: a sniper 25 e 50 cm acima do centro da cabeça erra normalmente e acerta a cabeça com ele', () => {
    const shotAt = (big: boolean, above: number): string => {
      const r = recipe({ weapons: { allowed: ['sniper'] }, ...(big ? { modifiers: ['bigHead' as const] } : {}) });
      const sim = createSim({ recipe: r, map: flatMap(), humans: 2 });
      const f = createInputFrames();
      const p: AimPoint = { x: 0, y: 0, z: 0 };
      // Mira com o ADS inteiro antes do tiro (a sniper fica sem dispersão).
      for (let i = 0; i < SIM_HZ; i++) {
        aimPointWorld(sim.view(), entity(sim, 1), true, p);
        aimAt(sim, f[0]!, 0, { x: p.x, y: p.y + above, z: p.z });
        f[0]!.buttons = BUTTON.ads;
        sim.step(f);
      }
      f[0]!.buttons = BUTTON.ads | BUTTON.fire;
      const events: SimEvent[] = [];
      for (let i = 0; i < 3; i++) {
        sim.step(f);
        f[0]!.buttons = BUTTON.ads;
        sim.drainEvents(events);
      }
      const hit = events.find((ev) => ev.type === 'hit');
      sim.dispose();
      return hit !== undefined && hit.type === 'hit' ? hit.part : 'nada';
    };
    // Revisão da 4b: 50 cm acima passava da fase larga (o topo da cabeça grande não entrava).
    for (const above of [0.25, 0.5])
      expect([shotAt(false, above), shotAt(true, above)], `${above} m`).toEqual(['nada', 'head']);
  });

  it('revisão: com o "um tiro mata" da regra de arma, a Roleta nunca põe os Invisíveis nem o tudo explode', () => {
    const r = recipe({ chaos: { count: 4, everyS: 20 }, weapons: { oneShot: true } });
    const sim = createSim({ recipe: r, map: flatMap(), humans: 2 });
    const f = createInputFrames();
    const masks = sim.view().chaos!.masks;
    let seen = 0;
    for (let i = 0; i < 300 * SIM_HZ; i++) {
      sim.step(f);
      seen |= masks[0]! | masks[1]!;
    }
    expect(seen & (MOD.invisible | MOD.explosive | MOD.oneShot)).toBe(0);
    expect(popcount(seen)).toBeGreaterThan(5);
    sim.dispose();
  });

  it('sem modificador, nada de Roleta na view (e o hash dos outros modos não muda)', () => {
    const sim = createSim({ recipe: recipe(), map: flatMap(), humans: 2 });
    expect(sim.view().chaos).toBeNull();
    sim.dispose();
  });
});
