import { botPrimaries, createHeadlessMatch, type HeadlessMatch } from '@boboforces/ai';
import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, quantizeAxis, type InputFrame } from '@boboforces/input';
import { yawToU16 } from '@boboforces/shared';
import { createSim, simMapFromMarkers, type Sim } from '@boboforces/sim';
import { buildSyntheticConstruto, TEST_NAV_PATHS } from '@boboforces/sim/testing';
import { BLOCK_FLAG, createBlockRegistry, createWorldGrid, fillBox, makeCell } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { applyFrame, captureFrame, createRemoteState, framesEqual, NetFrame } from './frame.ts';
import { MAX_MESSAGE_BYTES } from './protocol.ts';
import { createNetLayout, ENTITY_SLOTS, type NetLayout } from './schema.ts';
import { FrameRing, SnapshotAssembler, SnapshotEncoder } from './snapshot.ts';

const { map } = buildSyntheticConstruto({ nav: true });

function recipe(bots: number): MatchRecipe {
  return {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'test',
    seed: 21,
    teams: [
      { humans: 2, bots: [{ ref: builtinBotRef('normal'), count: bots }] },
      { humans: 2, bots: [{ ref: builtinBotRef('sweaty'), count: bots }] },
    ],
  };
}

/** Os 4 humanos andam em círculo atirando de vez em quando (dá tiro, morte e projétil). */
function scripted(frames: InputFrame[], sim: Sim): void {
  for (let h = 0; h < 4; h++) {
    const f = frames[h]!;
    f.yaw = yawToU16(h * 1.6 + sim.tick * 0.02);
    f.moveY = quantizeAxis(1);
    f.buttons = sim.tick % 40 < 12 ? BUTTON.fire : 0;
    f.weapon = sim.tick % 600 > 540 ? 3 : 0;
  }
}

function host(bots: number, zombies = 0): HeadlessMatch {
  return createHeadlessMatch({
    recipe: recipe(bots),
    map,
    humans: 4,
    zombies,
    paths: TEST_NAV_PATHS,
    writeHumans: scripted,
  });
}

/** Codifica e devolve as partes (cópias). */
function encode(enc: SnapshotEncoder, cur: NetFrame, base: NetFrame | null, focus = -1): Uint8Array[] {
  const parts: Uint8Array[] = [];
  enc.encode(cur, base, { focus, inputSeq: 7 }, (b) => parts.push(b.slice()));
  return parts;
}

function capture(layout: NetLayout, ring: FrameRing, sim: Sim): NetFrame {
  const f = ring.next();
  captureFrame(layout, sim.view(), f);
  return f;
}

describe('snapshot da rede (M5 fase 1)', () => {
  it('completo e delta voltam idênticos, em partes de até 1.100 B, mesmo fora de ordem e com parte perdida', () => {
    const m = host(24, 24);
    m.run(300);
    const layout = createNetLayout(m.sim.view());
    const ring = new FrameRing(layout, 32);
    const enc = new SnapshotEncoder(layout);
    const asm = new SnapshotAssembler(layout);
    const me = m.sim.controllerEntity(1) & 0xffff;

    const f1 = capture(layout, ring, m.sim);
    const full = encode(enc, f1, null, me);
    // 4 humanos, 48 bots e 24 zumbis não cabem numa mensagem.
    expect(full.length).toBeGreaterThan(1);
    for (const p of full) expect(p.length).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
    for (const p of [...full].reverse()) asm.receive(p);
    expect(asm.newest).not.toBeNull();
    expect(framesEqual(asm.newest!, f1)).toBe(true);
    expect(asm.newestInputSeq).toBe(7);

    m.run(2);
    const f2 = capture(layout, ring, m.sim);
    const delta = encode(enc, f2, f1, me);
    const bytes = (ps: Uint8Array[]): number => ps.reduce((n, p) => n + p.length, 0);
    expect(bytes(delta)).toBeLessThan(bytes(full) / 2);
    for (const p of delta) asm.receive(p);
    expect(framesEqual(asm.newest!, f2)).toBe(true);

    // Parte perdida: o snapshot não completa (nem vira base); o próximo, contra a base antiga, completa.
    m.run(2);
    const f3 = capture(layout, ring, m.sim);
    const lost = encode(enc, f3, f2, me);
    for (const p of lost.slice(1)) asm.receive(p);
    expect(asm.newest!.tick).toBe(f2.tick);
    m.run(2);
    const f4 = capture(layout, ring, m.sim);
    for (const p of encode(enc, f4, f2, me)) asm.receive(p);
    expect(framesEqual(asm.newest!, f4)).toBe(true);
    // A parte que faltava chega atrasada: velha, ignorada.
    asm.receive(lost[0]!);
    expect(asm.stats.stale).toBeGreaterThan(0);
    expect(asm.newest!.tick).toBe(f4.tick);

    // Base que o cliente não tem: não monta (o host manda outro contra o ack).
    const ghost = new NetFrame(layout);
    captureFrame(layout, m.sim.view(), ghost);
    ghost.tick = 1;
    m.run(2);
    const f5 = capture(layout, ring, m.sim);
    for (const p of encode(enc, f5, ghost, me)) asm.receive(p);
    expect(asm.stats.noBase).toBeGreaterThan(0);
    expect(asm.newest!.tick).toBe(f4.tick);
    m.dispose();
  }, 30_000);

  it('a prioridade põe o próprio jogador na 1ª parte', () => {
    const m = host(24, 24);
    m.run(120);
    const layout = createNetLayout(m.sim.view());
    const enc = new SnapshotEncoder(layout);
    const f = new NetFrame(layout);
    captureFrame(layout, m.sim.view(), f);
    const n = ENTITY_SLOTS.count;
    for (const c of [0, 3]) {
      const me = m.sim.controllerEntity(c) & 0xffff;
      const parts = encode(enc, f, null, me);
      expect(parts.length).toBeGreaterThan(1);
      // Só a 1ª parte, dizendo ser a única (bits 78..83 do cabeçalho = partes - 1 = 0): o jogador já está nela.
      const only = parts[0]!.slice();
      only[9] = only[9]! & 0x3f;
      only[10] = only[10]! & 0xf0;
      const asm = new SnapshotAssembler(layout);
      expect(asm.receive(only)).toBe(true);
      expect(asm.newest!.ent.subarray(me * n, me * n + n)).toEqual(f.ent.subarray(me * n, me * n + n));
    }
    m.dispose();
  }, 30_000);

  it('aplicado na sim do cliente, a view fica a 1 cm da do host (mira na volta de 16 bits) e o placar igual', () => {
    const m = host(6);
    m.run(600);
    const layout = createNetLayout(m.sim.view());
    const enc = new SnapshotEncoder(layout);
    const asm = new SnapshotAssembler(layout);
    const client = createSim({ recipe: recipe(6), map, humans: 4, primaries: botPrimaries(recipe(6), 4) });
    const state = createRemoteState();
    let prev: NetFrame | null = null;
    const ring = new FrameRing(layout, 8);
    for (let round = 0; round < 3; round++) {
      m.run(3);
      const f = capture(layout, ring, m.sim);
      for (const p of encode(enc, f, prev)) asm.receive(p);
      prev = f;
      applyFrame(layout, asm.newest!, client, state);
      const h = m.sim.view();
      const c = client.view();
      expect(c.tick).toBe(h.tick);
      expect(c.count).toBe(h.count);
      for (let e = 0; e < h.count; e++) {
        for (const k of ['alive', 'generation', 'kind', 'team', 'flags', 'controller', 'weapon', 'slot'] as const) {
          expect(c[k][e], `${k}[${e}]`).toBe(h[k][e]);
        }
        for (let a = 0; a < 3; a++) {
          expect(Math.abs(c.position[e * 3 + a]! - h.position[e * 3 + a]!)).toBeLessThanOrEqual(0.0051);
        }
        const dyaw = Math.abs(((c.yaw[e]! - h.yaw[e]! + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        expect(dyaw).toBeLessThan(1e-4);
        expect(Math.abs(c.pitch[e]! - h.pitch[e]!)).toBeLessThan(1e-4);
        expect(Math.abs(c.health[e]! - h.health[e]!)).toBeLessThanOrEqual(0.051);
        expect([c.kills[e], c.deaths[e]]).toEqual([h.kills[e], h.deaths[e]]);
      }
      expect([...c.match.teamScore]).toEqual([...h.match.teamScore]);
      expect([c.match.phase, c.match.ticksLeft]).toEqual([h.match.phase, h.match.ticksLeft]);
      for (let k = 0; k < m.sim.controllerCount; k++)
        expect(client.controllerEntity(k)).toBe(m.sim.controllerEntity(k));
      expect(c.projectiles.count).toBe(h.projectiles.count);
    }
    // O cliente não roda a sim: sem eventos.
    const events: unknown[] = [];
    client.drainEvents(events as never[]);
    expect(events).toEqual([]);
    client.dispose();
    m.dispose();
  }, 30_000);

  it('Bobo Zombies: as ondas, os pontos e a Caixa viajam', () => {
    const SOLID = BLOCK_FLAG.solid | BLOCK_FLAG.blocksBullets | BLOCK_FLAG.blocksSight | BLOCK_FLAG.walkable;
    const blocks = createBlockRegistry([
      { key: 'concrete', shape: 'cube', faces: [1, 1, 1, 1, 1, 1], flags: SOLID, frames: 1, stepSound: 'concrete' },
    ]);
    const grid = createWorldGrid(40, 16, 60);
    fillBox(grid, 0, 0, 0, 39, 0, 59, makeCell(blocks.byKey('concrete')!.id));
    const zmap = simMapFromMarkers({
      grid,
      blocks,
      markers: {
        spawns: [
          { x: 10, y: 0.5, z: 14, yaw: 0, team: 0 },
          { x: 10, y: 0.5, z: 4, yaw: 0, team: -1 },
        ],
        playArea: { minX: 0, minZ: 0, maxX: 20, maxZ: 30, killPlaneY: -10 },
        boxSpots: [{ x: 4, y: 0.5, z: 14.5, facing: 3 }],
      },
    });
    const zr: MatchRecipe = {
      format: MATCH_RECIPE_FORMAT,
      mode: 'zombies',
      map: 'test',
      seed: 3,
      teams: [{ humans: 'all', bots: [] }],
    };
    const hostSim = createSim({ recipe: zr, map: zmap, humans: 1, zombies: 6 });
    const clientSim = createSim({ recipe: zr, map: zmap, humans: 1, zombies: 6 });
    const layout = createNetLayout(hostSim.view());
    expect(layout.globals.map((g) => g.name)).toContain('boxUser');
    const enc = new SnapshotEncoder(layout);
    const asm = new SnapshotAssembler(layout);
    const f = new NetFrame(layout);
    const frames = Array.from({ length: hostSim.controllerCount }, () => null);
    for (let t = 0; t < 60 * 12; t++) hostSim.step(frames);
    captureFrame(layout, hostSim.view(), f);
    for (const p of encode(enc, f, null)) asm.receive(p);
    applyFrame(layout, asm.newest!, clientSim, createRemoteState());
    const h = hostSim.view().match;
    const c = clientSim.view().match;
    expect(h.zombieWave).toBeGreaterThan(0);
    for (const k of ['zombieWave', 'zombiesLeft', 'zombieRestTicks', 'selfRevivesLeft', 'lastZombie'] as const) {
      expect(c[k], k).toBe(h[k]);
    }
    expect([...clientSim.view().mapObjects!.boxState]).toEqual([...hostSim.view().mapObjects!.boxState]);
    const me = hostSim.controllerEntity(0) & 0xffff;
    expect(clientSim.view().points[me]).toBe(hostSim.view().points[me]);
    hostSim.dispose();
    clientSim.dispose();
  }, 30_000);
});
