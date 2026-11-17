import { botPrimaries } from '@boboforces/ai';
import { MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { createInputFrames, createSim, createSimLoop } from '@boboforces/sim';
import { buildSyntheticConstruto } from '@boboforces/sim/testing';
import { createRng } from '@boboforces/shared';
import { describe, expect, it } from 'vitest';
import { createClientDriver } from './client.ts';
import { createHostDriver, createNetHost } from './host.ts';
import {
  createLobbyClient,
  createLobbyHost,
  isLobbyMessage,
  parseLobbyChoice,
  type LobbyChoice,
  type LobbyClient,
} from './lobby.ts';
import { createEndpointMux } from './mux.ts';
import { localHello, PROTOCOL_VERSION } from './protocol.ts';
import { newRoomCode, normalizeRoomCode, parseRoomHash, ROOM_CODE_ALPHABET, roomLinkHash } from './room-code.ts';
import { createLoopback, type Loopback } from './transport.ts';

describe('código da sala (M5 fase 4a)', () => {
  it('5 caracteres sem ambíguos; o que se digita e o link viram o código', () => {
    const rng = createRng(3);
    for (let i = 0; i < 200; i++) {
      const code = newRoomCode(() => rng.next());
      expect(code).toMatch(/^[A-Z2-9]{5}$/);
      expect(normalizeRoomCode(code)).toBe(code);
    }
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[01OI]/);
    expect(normalizeRoomCode(' ab-cd e ')).toBe('ABCDE');
    expect(normalizeRoomCode('ABC0E')).toBeNull();
    expect(normalizeRoomCode('ABCD')).toBeNull();
    expect(parseRoomHash(roomLinkHash('XY2Z9'))).toBe('XY2Z9');
    expect(parseRoomHash('#x=1&sala=ab-cde')).toBe('ABCDE');
    expect(parseRoomHash('#sala=%E0')).toBeNull();
    expect(parseRoomHash('')).toBeNull();
  });

  it('a escolha de um amigo é validada (nome limpo e curto, time de -1 a 3)', () => {
    expect(parseLobbyChoice({ name: '  Jo\u0000ão   da\nSilva Sauro Rex Max ', team: 9, ready: 'sim' }, 'X')).toEqual({
      name: 'João da Silva Sa',
      team: -1,
      bobo: null,
      ready: false,
    });
    expect(parseLobbyChoice({ name: '', team: 2, ready: true, bobo: 'x'.repeat(5000) }, 'Amigo 1')).toEqual({
      name: 'Amigo 1',
      team: 2,
      bobo: null,
      ready: true,
    });
    expect(parseLobbyChoice('oi', 'X')).toBeNull();
  });
});

const choice = (name: string, team: number, ready = false): LobbyChoice => ({ name, team, bobo: null, ready });

function pump(net: Loopback, frames: number, step: () => void): void {
  for (let i = 0; i < frames; i++) {
    net.advance(1000 / 60);
    step();
  }
}

describe('lobby pela rede de mentira (M5 fase 4a)', () => {
  it('entram 3, o 4º é recusado (cheia), versão diferente é recusada, travar e expulsar, e o começo chega igual', () => {
    const net = createLoopback({ seed: 2, latencyMs: 40, jitterMs: 10, loss: 0.05 });
    const [hostLobby] = createEndpointMux(net.endpoint(0), isLobbyMessage);
    const host = createLobbyHost({
      endpoint: hostLobby,
      code: 'ABCDE',
      host: choice('Erick', 0, true),
      hz: 60,
      snapshotHz: 30,
    });
    const clients: LobbyClient[] = [];
    const join = (id: number, hello = localHello()): LobbyClient => {
      const [ep] = createEndpointMux(net.endpoint(id), isLobbyMessage);
      const c = createLobbyClient({ endpoint: ep, choice: choice(`Amigo${id}`, id % 2), hello });
      // A sala liga todo mundo com todo mundo: o oi vai ao host e aos outros (só o host responde).
      c.addPeer(0);
      for (const other of clients) c.addPeer(net.endpoint(clients.indexOf(other) + 1).id);
      clients.push(c);
      return c;
    };
    const step = (): void => {
      host.update();
      for (const c of clients) c.update();
    };
    // Versão diferente: quem está na mais nova ouve "seu amigo precisa atualizar".
    const newer = join(9, { ...localHello(), protocolVersion: PROTOCOL_VERSION + 1 });
    clients.length = 0;
    for (let id = 1; id <= 4; id++) join(id);
    clients.push(newer);
    pump(net, 30, step);
    expect(newer.status).toBe('rejected');
    expect(newer.rejection).toBe('update-friend');
    // A variação da rede embaralha a chegada dos oi: 3 entram (slots 1..3, na ordem em que chegaram) e 1 ouve "cheia".
    const inside = clients.slice(0, 4).filter((c) => c.status === 'in');
    const full = clients.slice(0, 4).filter((c) => c.status === 'rejected');
    expect(inside).toHaveLength(3);
    expect(full.map((c) => c.rejection)).toEqual(['full']);
    const bySlot = (slot: number): LobbyClient => inside.find((c) => c.welcome!.slot === slot)!;
    expect(host.state.members.map((m) => m.slot)).toEqual([0, 1, 2, 3]);
    for (const m of host.state.members.slice(1)) {
      const id = clients.indexOf(bySlot(m.slot)) + 1;
      expect([m.name, m.team]).toEqual([`Amigo${id}`, id % 2]);
    }
    // Todos veem o mesmo estado.
    for (const c of inside) expect(c.state).toEqual(host.state);
    // Trocar de time e ficar pronto; travar; expulsar o do slot 3.
    bySlot(2).setChoice(choice('Bia', 1, true));
    host.setLocked(true);
    host.setSummary('TDM · Construto · 6 bots');
    host.kick(3);
    pump(net, 20, step);
    expect(bySlot(3).status).toBe('kicked');
    expect(host.state.locked).toBe(true);
    expect(host.state.members.map((m) => `${m.slot}:${m.name}:${m.ready}`)).toEqual([
      '0:Erick:true',
      `1:${host.state.members[1]!.name}:false`,
      '2:Bia:true',
    ]);
    expect(bySlot(1).state).toEqual(host.state);
    // Travada: quem chega agora é recusado.
    const late = join(5);
    pump(net, 20, step);
    expect(late.status).toBe('rejected');
    expect(late.rejection).toBe('locked');
    // O começo chega igual aos dois que ficaram.
    const start = {
      recipe: { format: 'boboforces/match@1', mode: 'warfare.tdm' },
      seed: 1234,
      members: host.state.members.map((m, i) => ({ ...m, controller: i })),
    };
    host.start(start);
    pump(net, 20, step);
    for (const c of [bySlot(1), bySlot(2)]) {
      expect(c.status).toBe('started');
      expect(c.start).toEqual(start);
      expect(c.state!.playing).toBe(true);
    }
    // M5 (fase 4c): o que um amigo escolhe durante a partida não vale; a partida acaba e a sala volta ao lobby: os
    // dois voltam a "in", a escolha deles vai de novo, e dá para começar outra.
    bySlot(1).setChoice(choice('Caio', 0, true));
    pump(net, 10, step);
    expect(host.state.members[1]!.name).not.toBe('Caio');
    host.reopen();
    pump(net, 20, step);
    for (const c of [bySlot(1), bySlot(2)]) {
      expect([c.status, c.start, c.state!.playing]).toEqual(['in', null, false]);
    }
    expect(host.state.members.map((m) => `${m.slot}:${m.name}:${m.ready}`)).toEqual([
      '0:Erick:true',
      '1:Caio:true',
      '2:Bia:true',
    ]);
    host.start({ ...start, seed: 99 });
    pump(net, 20, step);
    expect(bySlot(2).start!.seed).toBe(99);
  });

  it('do lobby à partida no mesmo canal: o repartidor separa e o cliente entra jogando', () => {
    const { map } = buildSyntheticConstruto();
    const recipe: MatchRecipe = {
      format: MATCH_RECIPE_FORMAT,
      mode: 'warfare.tdm',
      map: 'test',
      seed: 6,
      teams: [
        { humans: 1, bots: [] },
        { humans: 1, bots: [] },
      ],
    };
    const net = createLoopback({ seed: 4, latencyMs: 60, jitterMs: 15, loss: 0.05 });
    const [hostLobby, hostMatch] = createEndpointMux(net.endpoint(0), isLobbyMessage);
    const [clientLobby, clientMatch] = createEndpointMux(net.endpoint(1), isLobbyMessage);
    const lobby = createLobbyHost({ endpoint: hostLobby, code: 'QWERT', host: choice('H', 0), hz: 60, snapshotHz: 30 });
    const lc = createLobbyClient({ endpoint: clientLobby, choice: choice('C', 1) });
    lc.addPeer(0);
    pump(net, 20, () => {
      lobby.update();
      lc.update();
    });
    expect(lc.status).toBe('in');
    // O host começa: a partida com o cliente já aceito (sem handshake de novo).
    const sim = createSim({ recipe, map, humans: 2, primaries: botPrimaries(recipe, 2) });
    const netHost = createNetHost({ sim, endpoint: hostMatch, snapshotHz: 30 });
    netHost.addClient(lobby.peerOfSlot(1), 1, true);
    const loop = createSimLoop({
      sim,
      frames: createInputFrames(),
      beforeTick: (_s, f) => netHost.writeRemoteFrame(1, f[1]!),
    });
    const host = createHostDriver(netHost, {
      update: (dt) => loop.frame(dt),
      get alpha() {
        return loop.alpha;
      },
      dispose: () => sim.dispose(),
    });
    lobby.start({ recipe, seed: 6, members: lobby.state.members.map((m, i) => ({ ...m, controller: i })) });
    pump(net, 20, () => {
      lobby.update();
      lc.update();
      host.update(1 / 60);
    });
    expect(lc.status).toBe('started');
    const client = createClientDriver({
      sim: createSim({ recipe, map, humans: 2, primaries: botPrimaries(recipe, 2) }),
      endpoint: clientMatch,
      host: lc.host,
      welcome: lc.welcome!,
      writeLocalFrame: (out) => {
        out.moveY = 127;
      },
    });
    expect(client.state).toBe('playing');
    pump(net, 120, () => {
      lobby.update();
      lc.update();
      host.update(1 / 60);
      client.update(1 / 60);
    });
    expect(client.stats.snapshotsApplied).toBeGreaterThan(40);
    expect(client.stats.reconciles).toBeGreaterThan(40);
    expect(netHost.inputOf(lobby.peerOfSlot(1))!.stats.received).toBeGreaterThan(80);
    // O lobby segue vivo durante a partida: o cliente sai e o host fica sabendo.
    lc.leave();
    pump(net, 10, () => {
      lobby.update();
      host.update(1 / 60);
    });
    expect(lobby.state.members.map((m) => m.slot)).toEqual([0]);
    host.dispose();
    client.dispose();
  });
});
