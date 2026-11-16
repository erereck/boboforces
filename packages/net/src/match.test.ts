import { botPrimaries, createBotDirectorWithPaths } from '@boboforces/ai';
import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, quantizeAxis, type InputFrame } from '@boboforces/input';
import { yawToU16 } from '@boboforces/shared';
import { createInputFrames, createSim, createSimLoop, type Sim } from '@boboforces/sim';
import { buildSyntheticConstruto, TEST_NAV_PATHS } from '@boboforces/sim/testing';
import { describe, expect, it } from 'vitest';
import { createClientDriver, type ClientDriver } from './client.ts';
import { framesEqual } from './frame.ts';
import { createHostDriver, createNetHost, type NetMatchDriver } from './host.ts';
import { MAX_MESSAGE_BYTES } from './protocol.ts';
import { createLoopback } from './transport.ts';

const { map } = buildSyntheticConstruto({ nav: true });
const HUMANS = 4;

const recipe: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'warfare.tdm',
  map: 'test',
  seed: 33,
  match: { timeLimitS: 40 },
  teams: [
    { humans: 2, bots: [{ ref: builtinBotRef('normal'), count: 4 }] },
    { humans: 2, bots: [{ ref: builtinBotRef('normal'), count: 4 }] },
  ],
};

/** Humano `slot` andando e atirando, igual em qualquer aparelho (depende só do seq). */
function play(slot: number, out: InputFrame, seq: number): void {
  out.yaw = yawToU16(slot * 1.7 + seq * 0.015);
  out.pitch = 0;
  out.moveY = quantizeAxis(seq % 200 < 150 ? 1 : -1);
  out.moveX = quantizeAxis(slot % 2 === 0 ? 0.3 : -0.3);
  out.buttons = (seq % 30 < 14 ? BUTTON.fire : 0) | (seq % 90 === 0 ? BUTTON.jump : 0);
}

/** O que o `LocalDriver` do `game` faz (a sim, a IA e o passo fixo), com os slots remotos vindo da rede. */
function hostInner(writeHuman: (slot: number, out: InputFrame, seq: number) => void): NetMatchDriver & { sim: Sim } {
  const sim = createSim({ recipe, map, humans: HUMANS, primaries: botPrimaries(recipe, HUMANS) });
  const director = createBotDirectorWithPaths({ recipe, humans: HUMANS, hz: sim.hz }, TEST_NAV_PATHS);
  let seq = 0;
  const loop = createSimLoop({
    sim,
    frames: createInputFrames(),
    beforeTick: (s, f) => {
      seq = (seq + 1) & 0xffff;
      for (let h = 0; h < HUMANS; h++) writeHuman(h, f[h]!, seq);
      director.think(s.view(), f);
    },
  });
  return {
    sim,
    get alpha(): number {
      return loop.alpha;
    },
    update: (s) => loop.frame(s),
    dispose(): void {
      director.dispose();
      sim.dispose();
    },
  };
}

describe('partida pelo loopback (M5 fase 1, critério 1 do plano)', () => {
  it('host + 3 clientes com 80 ms, variação e 5% de perda: a partida inteira termina igual em todos', () => {
    const net = createLoopback({ seed: 9, latencyMs: 80, jitterMs: 25, loss: 0.05, duplicate: 0.01 });
    // O host é o peer 0 e joga no slot 0; os clientes 1..3 nos slots 1..3.
    let netHost: ReturnType<typeof createNetHost> | null = null;
    const inner = hostInner((slot, out, seq) => {
      if (slot === 0) play(0, out, seq);
      else netHost!.writeRemoteFrame(slot, out);
    });
    netHost = createNetHost({ sim: inner.sim, endpoint: net.endpoint(0), snapshotHz: 30 });
    const host = createHostDriver(netHost, inner);
    const clients: ClientDriver[] = [];
    for (let slot = 1; slot < HUMANS; slot++) {
      netHost.addClient(slot, slot);
      clients.push(
        createClientDriver({
          sim: createSim({ recipe, map, humans: HUMANS, primaries: botPrimaries(recipe, HUMANS) }),
          endpoint: net.endpoint(slot),
          host: 0,
          writeLocalFrame: (out, seq) => play(slot, out, seq),
        }),
      );
    }
    const frame = 1 / 60;
    const spawn = clients.map((_c, i) => {
      const e = inner.sim.controllerEntity(i + 1) & 0xffff;
      return [inner.sim.view().position[e * 3]!, inner.sim.view().position[e * 3 + 2]!];
    });
    let moved = 0;
    let after = 0;
    // Até acabar no host e mais 1 s para o fim chegar a todos.
    for (let f = 0; f < 60 * 60 && after < 60; f++) {
      net.advance(frame * 1000);
      host.update(frame);
      for (const c of clients) c.update(frame);
      if (inner.sim.view().match.phase === 'ended') after++;
      for (let i = 0; i < clients.length; i++) {
        const e = inner.sim.controllerEntity(i + 1) & 0xffff;
        const p = inner.sim.view().position;
        if (Math.hypot(p[e * 3]! - spawn[i]![0]!, p[e * 3 + 2]! - spawn[i]![1]!) > 2) moved |= 1 << i;
      }
    }
    const h = inner.sim.view();
    expect(h.match.phase).toBe('ended');
    // As entradas dos clientes chegaram e mexeram os bonecos deles no host.
    expect(moved).toBe(0b111);
    let kills = 0;
    for (let e = 0; e < h.count; e++) kills += h.kills[e]!;
    expect(kills).toBeGreaterThan(3);
    for (const c of clients) {
      expect(c.state).toBe('playing');
      const v = c.sim.view();
      expect(v.match.phase).toBe('ended');
      expect(v.match.winnerTeam).toBe(h.match.winnerTeam);
      expect([...v.match.teamScore]).toEqual([...h.match.teamScore]);
      for (let e = 0; e < h.count; e++)
        expect([v.kills[e], v.deaths[e]], `entidade ${e}`).toEqual([h.kills[e], h.deaths[e]]);
      // O último snapshot montado é, inteiro a inteiro, o que o host guardou.
      const mine = c.assembler.newest!;
      expect(framesEqual(mine, netHost.history.get(mine.tick)!)).toBe(true);
      expect(c.stats.snapshotsApplied).toBeGreaterThan(900);
      // As entradas chegaram quase todas (a redundância cobre os 5% de perda).
      const input = netHost.inputOf(clients.indexOf(c) + 1)!;
      expect(input.stats.received / c.stats.inputsSent).toBeGreaterThan(0.99);
    }
    expect(net.stats.dropped).toBeGreaterThan(100);
    expect(net.stats.largest).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
    // Banda do host por cliente (snapshots a 30 Hz, 4 humanos + 8 bots): bem abaixo dos 16 KB/s do §13.3.
    const seconds = net.now / 1000;
    const perClient = net.bytesSentBy(0) / 3 / seconds;
    expect(perClient).toBeLessThan(8000);
    console.log(
      `[net] ${seconds.toFixed(1)} s · host→cliente ${(perClient / 1024).toFixed(2)} KB/s · ` +
        `cliente→host ${(net.bytesSentBy(1) / seconds / 1024).toFixed(2)} KB/s · maior ${net.stats.largest} B · ` +
        `snapshots ${netHost.stats.snapshots}, completos ${netHost.stats.full}, partes máx ${netHost.stats.maxParts}`,
    );
    host.dispose();
    for (const c of clients) c.dispose();
  }, 60_000);
});
