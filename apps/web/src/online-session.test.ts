import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { createSceneDriver, onlineRecipe } from '@boboforces/game';
import { quantizeAxis } from '@boboforces/input';
import * as net from '@boboforces/net';
import { buildSyntheticConstruto } from '@boboforces/sim/testing';
import { describe, expect, it } from 'vitest';
import { createOnlineSession } from './online-session.ts';

const base: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'warfare.tdm',
  map: 'test',
  seed: 8,
  teams: [
    { humans: 'all', bots: [{ ref: builtinBotRef('normal'), count: 2 }] },
    { bots: [{ ref: builtinBotRef('normal'), count: 3 }] },
  ],
};

describe('a partida online na cena, pela rede de mentira (M5 fase 4b)', () => {
  it('do lobby ao começo: o amigo joga no host e o cliente vê o mesmo mundo', () => {
    const { map } = buildSyntheticConstruto();
    const loop = net.createLoopback({ seed: 12, latencyMs: 50, jitterMs: 10, loss: 0.03 });
    const [hostLobbyEp, hostMatchEp] = net.createEndpointMux(loop.endpoint(0), net.isLobbyMessage);
    const [clientLobbyEp, clientMatchEp] = net.createEndpointMux(loop.endpoint(1), net.isLobbyMessage);
    const lobby = net.createLobbyHost({
      endpoint: hostLobbyEp,
      code: 'BOBOS',
      host: { name: 'Host', team: 0, bobo: null, ready: true },
      hz: 60,
      snapshotHz: 30,
    });
    const lc = net.createLobbyClient({
      endpoint: clientLobbyEp,
      choice: { name: 'Amigo', team: 1, bobo: null, ready: true },
    });
    lc.addPeer(0);
    const tick = (step: () => void, frames: number): void => {
      for (let i = 0; i < frames; i++) {
        loop.advance(1000 / 60);
        step();
      }
    };
    tick(() => {
      lobby.update();
      lc.update();
    }, 20);
    expect(lc.status).toBe('in');
    // O host monta a receita com os times da sala e começa.
    const members = lobby.state.members;
    const placed = onlineRecipe(
      base,
      members.map((m) => m.team),
    );
    const start: net.LobbyStart = {
      recipe: placed.recipe,
      seed: 31,
      members: members.map((m, i) => ({ ...m, controller: placed.controllers[i]! })),
    };
    lobby.start(start);
    tick(() => {
      lobby.update();
      lc.update();
    }, 20);
    expect(lc.status).toBe('started');
    expect(lc.start).toEqual(start);
    const left: number[] = [];
    const common = { net, start, snapshotHz: 30, isClosed: () => false } as const;
    const hostSession = createOnlineSession({
      ...common,
      role: 'host',
      endpoint: hostMatchEp,
      mySlot: 0,
      peerOfSlot: (slot) => lobby.peerOfSlot(slot),
      hostPeer: -1,
      welcome: null,
      takeLeftSlots: () => left.splice(0),
    });
    const clientSession = createOnlineSession({
      ...common,
      role: 'client',
      endpoint: clientMatchEp,
      mySlot: lc.welcome!.slot,
      peerOfSlot: () => -1,
      hostPeer: lc.host,
      welcome: lc.welcome,
      takeLeftSlots: () => [],
    });
    expect([hostSession.localController, clientSession.localController]).toEqual([0, 1]);
    const recipe = lc.start!.recipe as MatchRecipe;
    const host = createSceneDriver(
      { recipe: { ...placed.recipe, seed: 31 }, map, humans: 2, writeHumanFrame: () => undefined },
      hostSession,
    );
    const client = createSceneDriver(
      {
        recipe: { ...recipe, seed: 31 },
        map,
        humans: 2,
        // O amigo anda para a frente sem parar.
        writeHumanFrame: (slot, out) => {
          expect(slot).toBe(1);
          out.moveY = quantizeAxis(1);
        },
      },
      clientSession,
    );
    const e = host.sim.controllerEntity(1) & 0xffff;
    const x0 = host.sim.view().position[e * 3 + 2]!;
    tick(() => {
      lobby.update();
      lc.update();
      host.update(1 / 60);
      client.update(1 / 60);
    }, 180);
    // O boneco do amigo andou no host (as entradas chegaram) e o cliente mostra o mesmo mundo (100 ms atrás).
    const hv = host.sim.view();
    expect(Math.abs(hv.position[e * 3 + 2]! - x0)).toBeGreaterThan(2);
    expect(client.sim.view().count).toBe(hv.count);
    expect(client.director).toBeNull();
    expect(client.sim.tick).toBeGreaterThan(hv.tick - 20);
    host.dispose();
    client.dispose();
  });
});

describe('o AFK pela rede de mentira (M5 fase 5a)', () => {
  it('60 s com a entrada parada e um bot assume; o primeiro passo devolve a vaga', () => {
    const { map } = buildSyntheticConstruto();
    const loop = net.createLoopback({ seed: 21, latencyMs: 30, jitterMs: 5, loss: 0.02 });
    const placed = onlineRecipe(base, [0, 1]);
    const start: net.LobbyStart = {
      recipe: placed.recipe,
      seed: 5,
      members: [
        { slot: 0, name: 'Host', team: 0, bobo: null, ready: true, controller: placed.controllers[0]! },
        { slot: 1, name: 'Bia', team: 1, bobo: null, ready: true, controller: placed.controllers[1]! },
      ],
    };
    const common = { net, start, snapshotHz: 30, isClosed: () => false, takeLeftSlots: () => [] } as const;
    const hostSession = createOnlineSession({
      ...common,
      role: 'host',
      endpoint: loop.endpoint(0),
      mySlot: 0,
      peerOfSlot: (slot) => (slot === 1 ? 1 : -1),
      hostPeer: -1,
      welcome: null,
    });
    // Espia o que o link do host decide (a cena só aplica).
    const decided: number[] = [];
    const spy = {
      ...hostSession,
      attachHost: (sim: Parameters<typeof hostSession.attachHost>[0]) => {
        const link = hostSession.attachHost(sim);
        return {
          ...link,
          takeControl: (out: number[]) => {
            const n = link.takeControl(out);
            decided.push(...out.slice(0, n));
            return n;
          },
        };
      },
    };
    const clientSession = createOnlineSession({
      ...common,
      role: 'client',
      endpoint: loop.endpoint(1),
      mySlot: 1,
      peerOfSlot: () => -1,
      hostPeer: 0,
      welcome: { slot: 1, hz: 60, snapshotHz: 30 },
    });
    const moving = { on: true };
    const host = createSceneDriver(
      { recipe: { ...placed.recipe, seed: 5 }, map, humans: 2, writeHumanFrame: () => undefined },
      spy,
    );
    const client = createSceneDriver(
      {
        recipe: { ...placed.recipe, seed: 5 },
        map,
        humans: 2,
        writeHumanFrame: (_slot, out) => {
          out.moveY = quantizeAxis(moving.on ? 1 : 0);
        },
      },
      clientSession,
    );
    const frames = (n: number): void => {
      for (let i = 0; i < n; i++) {
        loop.advance(1000 / 60);
        host.update(1 / 60);
        client.update(1 / 60);
      }
    };
    frames(120);
    expect(decided).toEqual([]);
    // Parado por 61 s: o bot assume (o controlador do amigo, "foi").
    moving.on = false;
    frames(61 * 60);
    const c = placed.controllers[1]!;
    expect(decided).toEqual([c * 2]);
    // Um passo: a vaga volta para ele.
    moving.on = true;
    frames(30);
    expect(decided).toEqual([c * 2, c * 2 + 1]);
    host.dispose();
    client.dispose();
  }, 120_000);
});
