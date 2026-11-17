import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { quantizeAxis } from '@boboforces/input';
import { createInputFrames, createSim, createSimLoop } from '@boboforces/sim';
import { buildSyntheticConstruto } from '@boboforces/sim/testing';
import { describe, expect, it } from 'vitest';
import { createClientDriver, HOST_SILENT_S } from './client.ts';
import { AFK_S, createHostDriver, createNetHost } from './host.ts';
import { createLoopback } from './transport.ts';

const recipe: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'warfare.tdm',
  map: 'test',
  seed: 9,
  teams: [
    { humans: 1, bots: [] },
    { humans: 1, bots: [] },
  ],
};

/** Host (controlador 0, parado) e um cliente (controlador 1) pelo loopback; o teste diz o que o cliente aperta. */
function pair() {
  const { map } = buildSyntheticConstruto();
  const loop = createLoopback({ seed: 3, latencyMs: 40, jitterMs: 5, loss: 0 });
  const sim = createSim({ recipe, map, humans: 2 });
  const netHost = createNetHost({ sim, endpoint: loop.endpoint(0), snapshotHz: 30 });
  const simLoop = createSimLoop({
    sim,
    frames: createInputFrames(),
    beforeTick: (_s, f) => void netHost.writeRemoteFrame(1, f[1]!),
    afterTick: (_s, events) => netHost.recordEvents(events),
  });
  /** O host pode parar de rodar (a aba dele sumiu): sem ticks nem snapshots. */
  const hostState = { running: true };
  const host = createHostDriver(netHost, {
    update: (dt) => (hostState.running ? simLoop.frame(dt) : 0),
    get alpha() {
      return simLoop.alpha;
    },
    dispose: () => sim.dispose(),
  });
  netHost.addClient(1, 1);
  const press = { moveY: 0 };
  const client = createClientDriver({
    sim: createSim({ recipe, map, humans: 2 }),
    endpoint: loop.endpoint(1),
    host: 0,
    writeLocalFrame: (out) => {
      out.moveY = quantizeAxis(press.moveY);
    },
  });
  const run = (frames: number, hostRuns = true): void => {
    for (let i = 0; i < frames; i++) {
      loop.advance(1000 / 60);
      if (hostRuns) host.update(1 / 60);
      else netHost.receive();
      client.update(1 / 60);
    }
  };
  return { sim, netHost, host, client, press, hostState, run };
}

describe('as ausências (M5 fase 5a)', () => {
  it('o host avisa que saiu: o amigo para de predizer e de mandar entradas; volta, e tudo recomeça', () => {
    const p = pair();
    p.press.moveY = 1;
    p.run(60);
    expect(p.client.hostAbsentS).toBe(0);
    const sent = p.client.stats.inputsSent;
    expect(sent).toBeGreaterThan(30);
    // O aviso chega antes de a aba parar: o amigo vê o host ausente na hora (sem esperar os 3 s).
    p.netHost.setAway(true);
    p.run(30, false);
    expect(p.client.hostAbsentS).toBeGreaterThan(0.2);
    expect(p.client.hostAbsentS).toBeLessThan(HOST_SILENT_S);
    const frozen = p.client.stats.inputsSent;
    p.run(60, false);
    expect(p.client.stats.inputsSent).toBe(frozen);
    expect(p.client.hostAbsentS).toBeGreaterThan(1);
    // Voltou: o aviso de volta e os snapshots de novo.
    p.netHost.setAway(false);
    p.run(30);
    expect(p.client.hostAbsentS).toBe(0);
    expect(p.client.stats.inputsSent).toBeGreaterThan(frozen);
    p.host.dispose();
    p.client.dispose();
  });

  it('antes do 1º snapshot não é ausência (o host ainda carregando a cena)', () => {
    const p = pair();
    p.run(60 * 6, false);
    expect(p.client.hostAbsentS).toBe(0);
    expect(p.client.hostAwayNotified).toBe(false);
    p.netHost.setAway(true);
    p.run(10, false);
    expect(p.client.hostAbsentS).toBeGreaterThan(0);
    expect(p.client.hostAwayNotified).toBe(true);
    p.host.dispose();
    p.client.dispose();
  });

  it('sem aviso (o celular suspendeu a aba), 3 s sem snapshot contam como host ausente', () => {
    const p = pair();
    p.run(60);
    p.run(Math.round(60 * (HOST_SILENT_S - 0.5)), false);
    expect(p.client.hostAbsentS).toBe(0);
    p.run(60, false);
    expect(p.client.hostAbsentS).toBeGreaterThanOrEqual(HOST_SILENT_S);
    p.run(10);
    expect(p.client.hostAbsentS).toBe(0);
    p.host.dispose();
    p.client.dispose();
  });

  it('o host conta as entradas de verdade que chegam do amigo (o AFK de 60 s é medido por elas)', () => {
    const p = pair();
    p.press.moveY = 1;
    p.run(60);
    expect(p.netHost.activity(1)).toBeGreaterThan(30);
    // Parado: as 3 repetidas das últimas que andavam ainda chegam, e depois nada sobe.
    p.press.moveY = 0;
    p.run(30);
    const still = p.netHost.activity(1);
    p.run(120);
    expect(p.netHost.activity(1)).toBe(still);
    // Um passo: sobe de novo.
    p.press.moveY = 1;
    p.run(20);
    expect(p.netHost.activity(1)).toBeGreaterThan(still);
    expect(p.netHost.activity(7)).toBe(-1);
    expect(AFK_S).toBe(60);
    p.host.dispose();
    p.client.dispose();
  });
});
