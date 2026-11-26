import { botPrimaries, createBotDirectorWithPaths } from '@boboforces/ai';
import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, quantizeAxis, type InputFrame } from '@boboforces/input';
import { StateHasher, yawToU16 } from '@boboforces/shared';
import {
  BOT_CONTROLLER_BASE,
  createInputFrames,
  createOwnerScript,
  createSim,
  createSimLoop,
  entityIndex,
  isOwnerDormant,
  MOD,
  WEAPON_CODE,
  type OwnerEvent,
  type OwnerScriptEntry,
  type Sim,
  type SimEvent,
} from '@boboforces/sim';
import { buildSyntheticConstruto, TEST_NAV_PATHS } from '@boboforces/sim/testing';
import { buildTestArena } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { createClientDriver, type ClientDriver } from './client.ts';
import { framesEqual, type NetFrame } from './frame.ts';
import { createHostDriver, createNetHost, type NetMatchDriver } from './host.ts';
import { decodeLobbyPayload, encodeLobbyMessage, LOBBY_MSG, parseLobbyStart } from './lobby.ts';
import { PROTOCOL_VERSION } from './protocol.ts';
import { ENTITY_SLOTS } from './schema.ts';
import type { NetEndpoint } from './transport.ts';
import { createLoopback } from './transport.ts';

/**
 * M9 (fase 5): as Ferramentas do Dono no online. O começo da partida leva a opção (a reserva) ao amigo (protocolo
 * 12); o host e o amigo criam a sim com ela e conferem que é a mesma. Só o host manda comandos; os amigos veem o efeito
 * pelo snapshot.
 */

const tdm: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'warfare.tdm',
  map: 'test',
  seed: 1,
  teams: [{ humans: 1, bots: [{ ref: builtinBotRef('normal'), count: 1 }] }, { bots: [] }],
};

describe('as Ferramentas do Dono e o online (a opção no começo)', () => {
  it('o protocolo é o 14 (M11) e o começo leva a reserva (fora da faixa, conta como ausente)', () => {
    expect(PROTOCOL_VERSION).toBe(14);
    const start = { recipe: tdm, seed: 3, members: [{ slot: 0, name: 'Erick', team: 0, ready: true, controller: 0 }] };
    const round = (owner: unknown) =>
      parseLobbyStart(decodeLobbyPayload(encodeLobbyMessage(LOBBY_MSG.start, { ...start, owner })));
    expect(round({ reserve: 8 })?.owner).toEqual({ reserve: 8 });
    expect(round({ reserve: 0 })?.owner).toEqual({ reserve: 0 });
    expect(round(undefined)?.owner).toBeUndefined();
    for (const bad of [{ reserve: 17 }, { reserve: -1 }, { reserve: 2.5 }, { reserve: '8' }, 'sim', null]) {
      const parsed = round(bad);
      expect(parsed).not.toBeNull();
      expect(parsed!.owner).toBeUndefined();
    }
  });

  it('host e amigo conferem que a sim tem a opção que o começo levou (a mesma reserva)', () => {
    const map = buildTestArena();
    const endpoint = {} as unknown as NetEndpoint;
    const withOwner = createSim({ recipe: tdm, map, humans: 1, owner: { reserve: 2 } });
    const without = createSim({ recipe: tdm, map, humans: 1 });
    const client = (sim: Sim, owner?: { reserve: number }) =>
      createClientDriver({ sim, endpoint, host: 0, writeLocalFrame: () => {}, ...(owner ? { owner } : {}) });
    // Sem a opção no começo, a sim com o dono não entra; nem o contrário; nem outra reserva.
    expect(() => createNetHost({ sim: withOwner, endpoint, snapshotHz: 30 })).toThrow(/opção do dono/);
    expect(() => client(withOwner)).toThrow(/opção do dono/);
    expect(() => createNetHost({ sim: without, endpoint, snapshotHz: 30, owner: { reserve: 2 } })).toThrow(
      /opção do dono/,
    );
    expect(() => client(without, { reserve: 2 })).toThrow(/opção do dono/);
    expect(() => createNetHost({ sim: withOwner, endpoint, snapshotHz: 30, owner: { reserve: 3 } })).toThrow(
      /opção do dono/,
    );
    expect(() => client(withOwner, { reserve: 1 })).toThrow(/opção do dono/);
    withOwner.dispose();
    without.dispose();
  });
});

// --- A partida pela rede de mentira: o host do Sandbox com o dono e 3 amigos ---

const { map } = buildSyntheticConstruto({ nav: true });
const HUMANS = 4;
const RESERVE = 4;
const normal = builtinBotRef('normal');
/** 3 times: os humanos nos dois primeiros, e cada time com 2 bots (controladores 4..9; a reserva em 10..13). */
const sandbox: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'sandbox',
  map: 'test',
  seed: 41,
  match: { timeLimitS: 20 },
  sandbox: { objective: 'points' },
  teams: [
    { humans: 2, bots: [{ ref: normal, count: 2 }] },
    { humans: 2, bots: [{ ref: normal, count: 2 }], hp: 150 },
    { bots: [{ ref: normal, count: 2 }], weapons: ['shotgun', 'pistol', 'knife'] },
  ],
};
const BOT = (k: number): number => BOT_CONTROLLER_BASE + k;

function play(slot: number, out: InputFrame, seq: number): void {
  out.yaw = yawToU16(slot * 1.7 + seq * 0.015);
  out.pitch = 0;
  out.moveY = quantizeAxis(seq % 200 < 150 ? 1 : -1);
  out.moveX = quantizeAxis(slot % 2 === 0 ? 0.3 : -0.3);
  out.buttons = seq % 30 < 14 ? BUTTON.fire : 0;
}

/** O que o `LocalDriver` do host faz com o dono: a sim com a reserva, a IA com a mesma opção e o roteiro do dono. */
function hostInner(
  writeHuman: (slot: number, out: InputFrame, seq: number) => void,
  onEvents: (events: readonly SimEvent[], sim: Sim) => void,
  script: (sim: Sim) => readonly OwnerScriptEntry[],
): NetMatchDriver & { sim: Sim } {
  const owner = { reserve: RESERVE };
  const sim = createSim({
    recipe: sandbox,
    map,
    humans: HUMANS,
    primaries: botPrimaries(sandbox, HUMANS, RESERVE),
    owner,
  });
  const director = createBotDirectorWithPaths({ recipe: sandbox, humans: HUMANS, hz: sim.hz, owner }, TEST_NAV_PATHS);
  const feed = createOwnerScript(script(sim));
  let seq = 0;
  const loop = createSimLoop({
    sim,
    frames: createInputFrames(),
    beforeTick: (s, f) => {
      seq = (seq + 1) & 0xffff;
      for (let h = 0; h < HUMANS; h++) writeHuman(h, f[h]!, seq);
      director.think(s.view(), f);
      feed.feed(s);
    },
    afterTick: (s, events) => onEvents(events, s),
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

/** O hash de um quadro da rede (os componentes inteiros na ordem): igual = o mesmo estado mostrado. */
function frameHash(f: NetFrame): number {
  const h = new StateHasher();
  h.u32(f.tick);
  h.u32(f.count);
  for (let i = 0; i < f.count * ENTITY_SLOTS.count; i++) h.u32(f.ent[i]! >>> 0);
  for (let i = 0; i < f.glob.length; i++) h.u32(f.glob[i]! >>> 0);
  return h.digest();
}

describe('as Ferramentas do Dono pela rede de mentira (M9 fase 5)', () => {
  it('host do Sandbox com o dono + 3 amigos: o roteiro de comandos vale no host e todos terminam com o mesmo hash', () => {
    const net = createLoopback({ seed: 17, latencyMs: 60, jitterMs: 20, loss: 0.03, duplicate: 0.01 });
    let netHost: ReturnType<typeof createNetHost> | null = null;
    const answers: OwnerEvent[] = [];
    // O roteiro (os ticks em que os comandos entram): criar 2 bots, congelar, trocar o time, dar arma, tirar e ligar e
    // desligar modificadores ao vivo (o Mini e a Lua).
    const script = (sim: Sim): OwnerScriptEntry[] => {
      const v = sim.view();
      const at = (c: number): { x: number; y: number; z: number } => {
        const e = entityIndex(sim.controllerEntity(c));
        return { x: v.position[e * 3]!, y: v.position[e * 3 + 1]!, z: v.position[e * 3 + 2]! };
      };
      const id = (c: number): number => sim.controllerEntity(c);
      const a = at(BOT(0));
      const b = at(BOT(4));
      return [
        { tick: 60, cmd: { kind: 'spawnBot', team: 2, x: a.x + 2, y: a.y, z: a.z, yaw: 0 } },
        { tick: 90, cmd: { kind: 'spawnBot', team: 0, x: b.x, y: b.y, z: b.z + 2, yaw: 1 } },
        { tick: 120, cmd: { kind: 'freeze', entity: id(BOT(1)), on: true } },
        { tick: 150, cmd: { kind: 'setTeam', entity: id(BOT(2)), team: 2 } },
        { tick: 180, cmd: { kind: 'giveWeapon', entity: id(BOT(3)), weapon: WEAPON_CODE.sniper } },
        { tick: 210, cmd: { kind: 'remove', entity: id(BOT(5)) } },
        { tick: 240, cmd: { kind: 'setModifier', modifier: 'mini', on: true } },
        { tick: 300, cmd: { kind: 'setModifier', modifier: 'lowGravity', on: true } },
        { tick: 420, cmd: { kind: 'freeze', entity: id(BOT(1)), on: false } },
        { tick: 480, cmd: { kind: 'setModifier', modifier: 'mini', on: false } },
      ];
    };
    const inner = hostInner(
      (slot, out, seq) => {
        if (slot === 0) play(0, out, seq);
        else netHost!.writeRemoteFrame(slot, out);
      },
      (events) => {
        for (const ev of events) if (ev.type === 'owner') answers.push({ ...ev });
        netHost!.recordEvents(events);
      },
      script,
    );
    netHost = createNetHost({ sim: inner.sim, endpoint: net.endpoint(0), snapshotHz: 30, owner: { reserve: RESERVE } });
    const host = createHostDriver(netHost, inner);
    const clients: ClientDriver[] = [];
    for (let slot = 1; slot < HUMANS; slot++) {
      netHost.addClient(slot, slot);
      // O amigo cria a sim pelo começo: a mesma receita, o mesmo mapa e a mesma opção do dono.
      const sim = createSim({
        recipe: sandbox,
        map,
        humans: HUMANS,
        primaries: botPrimaries(sandbox, HUMANS, RESERVE),
        owner: { reserve: RESERVE },
      });
      clients.push(
        createClientDriver({
          sim,
          endpoint: net.endpoint(slot),
          host: 0,
          writeLocalFrame: (out, seq) => play(slot, out, seq),
          owner: { reserve: RESERVE },
        }),
      );
    }
    const frame = 1 / 60;
    let after = 0;
    for (let f = 0; f < 60 * 40 && after < 60; f++) {
      net.advance(frame * 1000);
      host.update(frame);
      for (const c of clients) c.update(frame);
      if (inner.sim.view().match.phase === 'ended') after++;
    }
    const h = inner.sim.view();
    expect(h.match.phase).toBe('ended');
    // Os 10 comandos valeram no host, cada um com a resposta dele (que não vai pela rede).
    expect(answers.map((ev) => `${ev.command}:${ev.ok ? 'ok' : ev.reason}`)).toEqual([
      'spawnBot:ok',
      'spawnBot:ok',
      'freeze:ok',
      'setTeam:ok',
      'giveWeapon:ok',
      'remove:ok',
      'setModifier:ok',
      'setModifier:ok',
      'freeze:ok',
      'setModifier:ok',
    ]);
    const e = (c: number): number => entityIndex(inner.sim.controllerEntity(c));
    expect(h.team[e(BOT(2))]).toBe(2);
    expect(isOwnerDormant(h, e(BOT(5)))).toBe(true);
    // 2 dos 4 da reserva entraram (os dois primeiros), os outros 2 continuam fora.
    const reserve = [0, 1, 2, 3].map((k) => isOwnerDormant(h, e(BOT(6 + k))));
    expect(reserve).toEqual([false, false, true, true]);
    expect([h.team[e(BOT(6))], h.team[e(BOT(7))]]).toEqual([2, 0]);
    expect(h.chaos!.masks[0]! & (MOD.mini | MOD.lowGravity)).toBe(MOD.lowGravity);
    // M11 (fase 4, revisão): o `setTeam` levou o bot para o time 2 (só escopeta, pistola e faca): a máscara das armas
    // mudou no host, depois da criação.
    expect(h.weaponMask[e(BOT(2))]).not.toBe(0);
    for (const c of clients) {
      expect(c.state).toBe('playing');
      const mine = c.assembler.newest!;
      const theirs = netHost.history.get(mine.tick)!;
      // O último snapshot montado é, inteiro a inteiro, o do host do mesmo tick: o mesmo hash.
      expect(framesEqual(mine, theirs)).toBe(true);
      expect(frameHash(mine)).toBe(frameHash(theirs));
      // E a view do amigo mostra o que o dono fez: o time trocado, quem está fora e os modificadores.
      const v = c.sim.view();
      expect(v.match.phase).toBe('ended');
      expect(v.owner).not.toBeNull();
      for (let i = 0; i < h.count; i++) {
        expect([v.team[i], isOwnerDormant(v, i)], `entidade ${i}`).toEqual([h.team[i], isOwnerDormant(h, i)]);
      }
      expect(v.chaos!.masks[0]).toBe(h.chaos!.masks[0]);
      expect([...v.match.teamScore]).toEqual([...h.match.teamScore]);
      // M11 (fase 4, revisão): e a máscara das armas (o grupo `rules`, protocolo 14): a dica da troca e o radial leem
      // daqui.
      expect([...v.weaponMask.subarray(0, h.count)]).toEqual([...h.weaponMask.subarray(0, h.count)]);
    }
    host.dispose();
    for (const c of clients) c.dispose();
  }, 60_000);
});
