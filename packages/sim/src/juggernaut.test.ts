import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, type InputFrame } from '@boboforces/input';
import { BitReader, BitWriter, pitchToI16, yawToU16 } from '@boboforces/shared';
import { cellCenter, createTestBlocks, createWorldGrid, fillBox, makeCell, type MapSpawn } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { METRICS } from './config/metrics.ts';
import { BIG_BRRT, WEAPON_BIG_BRRT } from './config/weapons.ts';
import { SIM_HZ } from './constants.ts';
import { ENTITY_FLAG, entityIndex } from './entity.ts';
import type { KillEvent } from './events.ts';
import { aimPointWorld, type AimPoint } from './hitbox.ts';
import { createInputFrames } from './loop.ts';
import { createSim, type Sim, type SimMap } from './sim.ts';
import { JUGGERNAUT, juggernautHp } from './systems/party.ts';
import { heldClip } from './view.ts';

/**
 * M6 (fase 3): o Juggernaut na sim (a variante Rodízio). Três humanos num chão plano, sem bots: na largada um vira o
 * Jugg; os outros dois atiram nele até cair, e quem deu o golpe final vira o próximo.
 */
const blocks = createTestBlocks();
const concrete = makeCell(blocks.byKey('concrete')!.id);

function flatMap(): SimMap {
  const grid = createWorldGrid(40, 16, 80);
  fillBox(grid, 0, 0, 0, 39, 0, 79, concrete);
  // Três pontos em triângulo, a uns 8 m um do outro (ninguém no caminho do tiro do outro).
  const spawns: MapSpawn[] = [
    { x: cellCenter(10), y: 0.5, z: cellCenter(30), yaw: 0, team: -1 },
    { x: cellCenter(26), y: 0.5, z: cellCenter(30), yaw: 0, team: -1 },
    { x: cellCenter(18), y: 0.5, z: cellCenter(44), yaw: 0, team: -1 },
  ];
  return { grid, blocks, spawns };
}

const recipe = (scoreLimit: number): MatchRecipe => ({
  format: MATCH_RECIPE_FORMAT,
  mode: 'juggernaut',
  map: 'test',
  seed: 5,
  match: { timeLimitS: 0, scoreLimit },
  teams: [{ humans: 'all', bots: [] }, { bots: [] }],
});

const entity = (sim: Sim, c: number): number => entityIndex(sim.controllerEntity(c));

/** O controlador que é o Jugg agora (-1 = nenhum). */
function juggController(sim: Sim): number {
  const v = sim.view();
  for (let c = 0; c < 3; c++) if (v.team[entity(sim, c)] === 1) return c;
  return -1;
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

describe('Juggernaut na sim (M6 fase 3)', () => {
  it('na largada um vira o Jugg (vida de Jugg, a Big Brrt); quem o derruba vira o próximo e o caído volta a caçar', () => {
    const sim = createSim({ recipe: recipe(0), map: flatMap(), humans: 3 });
    const f = createInputFrames();
    sim.step(f);
    const first = juggController(sim);
    expect(first).toBeGreaterThanOrEqual(0);
    const v = sim.view();
    const j = entity(sim, first);
    // 2 caçadores: 600 de vida pela conta, o mínimo é 1000.
    expect(juggernautHp(2)).toBe(JUGGERNAUT.minHp);
    expect(v.health[j]).toBe(JUGGERNAUT.minHp);
    expect(v.weapon[j]).toBe(WEAPON_BIG_BRRT);
    expect(heldClip(v, j)).toBe(BIG_BRRT.clipSize);
    // Os outros dois atiram no peito do Jugg até ele cair.
    const kills: KillEvent[] = [];
    const point: AimPoint = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 20 * SIM_HZ && kills.length === 0; i++) {
      aimPointWorld(sim.view(), entity(sim, first), false, point);
      for (let c = 0; c < 3; c++) {
        if (c === first) continue;
        aimAt(sim, f[c]!, c, point);
        f[c]!.buttons = BUTTON.fire;
      }
      sim.step(f);
      const events: Parameters<Sim['drainEvents']>[0] = [];
      sim.drainEvents(events);
      for (const ev of events) if (ev.type === 'kill') kills.push({ ...ev });
    }
    for (const fr of f) fr.buttons = 0;
    expect(kills.length).toBe(1);
    const killer = entityIndex(kills[0]!.killer);
    const after = sim.view();
    // O caído: time dos caçadores, esperando o respawn. Quem derrubou: o Jugg, com a vida cheia de Jugg.
    expect(after.team[j]).toBe(0);
    expect((after.flags[j]! & ENTITY_FLAG.dead) !== 0).toBe(true);
    expect(after.team[killer]).toBe(1);
    expect(after.health[killer]).toBe(JUGGERNAUT.minHp);
    expect(after.weapon[killer]).toBe(WEAPON_BIG_BRRT);
    // O caído renasce caçando, com o loadout de sempre e a vida de sempre.
    for (let i = 0; i < 5 * SIM_HZ && (sim.view().flags[j]! & ENTITY_FLAG.dead) !== 0; i++) sim.step(f);
    expect(sim.view().team[j]).toBe(0);
    expect(sim.view().health[j]).toBe(100);
    expect(sim.view().weapon[j]).not.toBe(WEAPON_BIG_BRRT);
    // O placar dos times não anda no Juggernaut (é de cada um).
    expect(sim.view().match.teamScore[0]).toBe(0);
    sim.dispose();
  });

  it('cada segundo como Jugg vale 1 ponto; a meta encerra com ele de vencedor', () => {
    const sim = createSim({ recipe: recipe(3), map: flatMap(), humans: 3 });
    const f = createInputFrames();
    for (let i = 0; i < 4 * SIM_HZ && sim.view().match.phase !== 'ended'; i++) sim.step(f);
    const v = sim.view();
    expect(v.match.phase).toBe('ended');
    const j = juggController(sim);
    const e = entity(sim, j);
    expect(v.points[e]).toBe(3);
    expect(v.match.winnerEntity).toBe(sim.controllerEntity(j));
    expect(v.match.winnerTeam).toBe(1);
    sim.dispose();
  });

  it('a Big Brrt superaquece em 6 s de fogo e esfria parada', () => {
    const sim = createSim({ recipe: recipe(0), map: flatMap(), humans: 3 });
    const f = createInputFrames();
    sim.step(f);
    const j = juggController(sim);
    const e = entity(sim, j);
    // Para o alto, sem acertar ninguém.
    f[j]!.pitch = pitchToI16(1.2);
    f[j]!.buttons = BUTTON.fire;
    for (let i = 0; i < 2 * SIM_HZ; i++) sim.step(f);
    const warm = heldClip(sim.view(), e);
    expect(warm).toBeGreaterThan(70);
    expect(warm).toBeLessThan(90);
    // Solta o gatilho: em 2,5 s volta ao cheio.
    f[j]!.buttons = 0;
    for (let i = 0; i < 2.5 * SIM_HZ; i++) sim.step(f);
    expect(heldClip(sim.view(), e)).toBe(BIG_BRRT.clipSize);
    // 6 s sem parar: superaquece (a "recarga" de esfriar), e depois volta cheia.
    f[j]!.buttons = BUTTON.fire;
    let overheated = false;
    for (let i = 0; i < 7 * SIM_HZ && !overheated; i++) {
      sim.step(f);
      overheated = (sim.view().flags[e]! & ENTITY_FLAG.reloading) !== 0;
    }
    expect(overheated).toBe(true);
    f[j]!.buttons = 0;
    for (let i = 0; i < (BIG_BRRT.reloadS + 0.2) * SIM_HZ; i++) sim.step(f);
    expect(heldClip(sim.view(), e)).toBe(BIG_BRRT.clipSize);
    sim.dispose();
  });

  it('revisão: gente posta no time 1 pela sala ou pelo sofá começa caçando; sai um Jugg só, com a vida cheia', () => {
    const twoSides: MatchRecipe = {
      ...recipe(0),
      teams: [
        { humans: 2, bots: [] },
        { humans: 2, bots: [] },
      ],
    };
    const map = flatMap();
    const sim = createSim({ recipe: twoSides, map: { ...map, spawns: [...map.spawns, map.spawns[0]!] }, humans: 4 });
    const f = createInputFrames();
    // Na largada (antes do 1º passo), ninguém é o Jugg.
    for (let c = 0; c < 4; c++) expect(sim.view().team[entity(sim, c)]).toBe(0);
    sim.step(f);
    let juggs = 0;
    for (let c = 0; c < 4; c++) {
      const e = entity(sim, c);
      if (sim.view().team[e] === 1) {
        juggs++;
        // 3 caçadores: 900 pela conta, o mínimo é 1000.
        expect(sim.view().health[e]).toBe(JUGGERNAUT.minHp);
      }
    }
    expect(juggs).toBe(1);
    sim.dispose();
  });

  it('revisão: o R não trava a Big Brrt (só o superaquecimento)', () => {
    const sim = createSim({ recipe: recipe(0), map: flatMap(), humans: 3 });
    const f = createInputFrames();
    sim.step(f);
    const j = juggController(sim);
    const e = entity(sim, j);
    f[j]!.pitch = pitchToI16(1.2);
    f[j]!.buttons = BUTTON.fire;
    for (let i = 0; i < SIM_HZ; i++) sim.step(f);
    f[j]!.buttons = BUTTON.reload;
    sim.step(f);
    f[j]!.buttons = 0;
    sim.step(f);
    expect((sim.view().flags[e]! & ENTITY_FLAG.reloading) !== 0).toBe(false);
    sim.dispose();
  });

  it('o estado do Juggernaut entra no snapshot e no hash', () => {
    const frames = createInputFrames();
    const one = createSim({ recipe: recipe(0), map: flatMap(), humans: 3 });
    for (let i = 0; i < 2.5 * SIM_HZ; i++) one.step(frames);
    const two = createSim({ recipe: recipe(0), map: flatMap(), humans: 3 });
    const w = new BitWriter(64 * 1024);
    one.writeSnapshot(w);
    two.readSnapshot(new BitReader(w.bytes()));
    expect(two.stateHash()).toEqual(one.stateHash());
    // As duas seguem iguais (o relógio do ponto e as regras do Jugg vieram junto).
    for (let i = 0; i < 2 * SIM_HZ; i++) {
      one.step(frames);
      two.step(frames);
    }
    expect(two.stateHash()).toEqual(one.stateHash());
    const j = juggController(one);
    expect(one.view().points[entity(one, j)]).toBe(4);
    one.dispose();
    two.dispose();
  });
});
