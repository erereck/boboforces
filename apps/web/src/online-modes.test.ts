import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeMap, decodeModelPack, parseLayerManifest, type MatchRecipe } from '@boboforces/format';
import { createSceneDriver, onlineRecipe, type SceneDriver } from '@boboforces/game';
import { roomPreset, type RoomPresetMode } from '@boboforces/game/online';
import { buildMapNav, buildMapWorld, buildSimMap } from '@boboforces/game/scene';
import { BUTTON, quantizeAxis, type InputFrame } from '@boboforces/input';
import * as net from '@boboforces/net';
import { yawToU16 } from '@boboforces/shared';
import type { SimMap } from '@boboforces/sim';
import { parseBlockDefs } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { createOnlineSession } from './online-session.ts';

/**
 * M5 (fase 6a): cada partida da sala pela rede de mentira, com os mapas de verdade (o Construto, o Ringue e a Base
 * Abandonada): o host com os bots e um ou mais amigos, 60 ms de ida, variação e perda. No fim, o amigo mostra o mesmo
 * placar, as mesmas mortes e (no Bobo Zombies) a mesma onda, os mesmos pontos e as mesmas portas que o host.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RUNTIME = JSON.parse(readFileSync(join(ROOT, 'assets-src', 'runtime-assets.json'), 'utf8')) as {
  files: Record<string, string>;
};
const asset = (logical: string): Uint8Array =>
  new Uint8Array(readFileSync(join(ROOT, 'assets-src', RUNTIME.files[logical]!)));
const text = (logical: string): string => new TextDecoder().decode(asset(logical));

const maps = new Map<string, SimMap>();
function loadMap(id: string): SimMap {
  const known = maps.get(id);
  if (known) return known;
  const manifest = parseLayerManifest(JSON.parse(text('textures/blocos16.json')) as unknown);
  const layers = new Map(manifest.layers.map((l, i) => [l.name, i] as const));
  const world = buildMapWorld({
    map: decodeMap(asset(`maps/${id}.bfmap`)),
    blockDefs: parseBlockDefs(JSON.parse(text('blocks/blocks.json')) as unknown),
    blockLayer: (name) => layers.get(name),
    models: decodeModelPack(asset('models/modelos.bfmodel')).models,
  });
  const map = buildSimMap(world, buildMapNav(world));
  maps.set(id, map);
  return map;
}

/** Cada humano anda, vira e atira, igual em qualquer aparelho (depende só do seq). */
function play(slot: number, out: InputFrame, seq: number): void {
  out.yaw = yawToU16(slot * 1.9 + seq * 0.012);
  out.pitch = 0;
  out.moveY = quantizeAxis(seq % 240 < 180 ? 1 : -1);
  out.moveX = quantizeAxis(slot % 2 === 0 ? 0.4 : -0.4);
  out.buttons = (seq % 40 < 18 ? BUTTON.fire : 0) | (seq % 120 === 0 ? BUTTON.jump : 0);
}

interface RoomRun {
  readonly host: SceneDriver;
  readonly clients: readonly SceneDriver[];
  readonly seconds: number;
  readonly hostBytesPerClient: number;
}

/** A partida da sala com `teams.length` jogadores (o host primeiro), até acabar no host (mais 2 s) ou `maxS`. */
function playRoom(
  recipe: MatchRecipe,
  teams: readonly number[],
  options: { readonly snapshotHz: number; readonly zombies: number; readonly maxS: number },
): RoomRun {
  const map = loadMap(recipe.map);
  const loop = net.createLoopback({ seed: 13, latencyMs: 60, jitterMs: 15, loss: 0.03 });
  const placed = onlineRecipe(recipe, teams);
  const start: net.LobbyStart = {
    recipe: placed.recipe,
    seed: 77,
    members: teams.map((team, i) => ({
      slot: i,
      name: `J${i}`,
      team,
      bobo: null,
      ready: true,
      controller: placed.controllers[i]!,
    })),
  };
  const common = { net, start, snapshotHz: options.snapshotHz, isClosed: () => false, takeLeftSlots: () => [] };
  const driverConfig = {
    recipe: { ...placed.recipe, seed: 77 },
    map,
    humans: teams.length,
    writeHumanFrame: play,
    ...(options.zombies > 0 ? { zombies: options.zombies } : {}),
  };
  const host = createSceneDriver(
    driverConfig,
    createOnlineSession({
      ...common,
      role: 'host',
      endpoint: loop.endpoint(0),
      mySlot: 0,
      peerOfSlot: (slot) => slot,
      hostPeer: -1,
      welcome: null,
    }),
  );
  const clients = teams.slice(1).map((_team, k) =>
    createSceneDriver(
      driverConfig,
      createOnlineSession({
        ...common,
        role: 'client',
        endpoint: loop.endpoint(k + 1),
        mySlot: k + 1,
        peerOfSlot: () => -1,
        hostPeer: 0,
        welcome: { slot: k + 1, hz: 60, snapshotHz: options.snapshotHz },
      }),
    ),
  );
  let after = 0;
  for (let f = 0; f < options.maxS * 60 && after < 120; f++) {
    loop.advance(1000 / 60);
    host.update(1 / 60);
    for (const c of clients) c.update(1 / 60);
    if (host.sim.view().match.phase === 'ended') after++;
  }
  const seconds = loop.now / 1000;
  return { host, clients, seconds, hostBytesPerClient: loop.bytesSentBy(0) / clients.length / seconds };
}

/** O amigo mostra o que o host decidiu: o fim, o placar, as mortes e (no Bobo Zombies) a onda, os pontos e as portas. */
function expectSameResult(run: RoomRun): void {
  const h = run.host.sim.view();
  expect(h.match.phase).toBe('ended');
  for (const c of run.clients) {
    const v = c.sim.view();
    expect(v.match.phase).toBe('ended');
    expect(v.count).toBe(h.count);
    expect(v.match.winnerTeam).toBe(h.match.winnerTeam);
    expect(v.match.winnerEntity).toBe(h.match.winnerEntity);
    expect([...v.match.teamScore]).toEqual([...h.match.teamScore]);
    expect(v.match.zombieWave).toBe(h.match.zombieWave);
    for (let e = 0; e < h.count; e++) {
      expect([v.kills[e], v.deaths[e], v.points[e]], `entidade ${e}`).toEqual([h.kills[e], h.deaths[e], h.points[e]]);
    }
    if (h.mapObjects !== null) expect([...v.mapObjects!.doorOpen]).toEqual([...h.mapObjects.doorOpen]);
  }
}

function dispose(run: RoomRun): void {
  run.host.dispose();
  for (const c of run.clients) c.dispose();
}

/** O preset do card com a partida encurtada (o teste não espera 5 min). */
function short(mode: RoomPresetMode, seconds: number): MatchRecipe {
  const r = roomPreset(mode);
  return { ...r, match: { ...r.match, timeLimitS: seconds } };
}

describe('as partidas da sala pela rede de mentira (M5 fase 6a)', () => {
  it('Todos contra todos no Construto: 3 humanos e 5 bots; o amigo vê o mesmo vencedor e o mesmo placar', () => {
    const run = playRoom(short('warfare.ffa', 30), [-1, -1, -1], { snapshotHz: 30, zombies: 0, maxS: 120 });
    expectSameResult(run);
    const h = run.host.sim.view();
    let kills = 0;
    for (let e = 0; e < h.count; e++) kills += h.kills[e]!;
    expect(kills).toBeGreaterThan(3);
    console.log(
      `[modos] FFA: ${run.seconds.toFixed(1)} s, ${kills} abates, host→amigo ${(run.hostBytesPerClient / 1024).toFixed(2)} KB/s`,
    );
    dispose(run);
  }, 120_000);

  it('X1 no Ringue: o host contra o amigo, sem bot', () => {
    const run = playRoom(short('x1', 30), [-1, -1], { snapshotHz: 30, zombies: 0, maxS: 120 });
    expectSameResult(run);
    const h = run.host.sim.view();
    // Só os 2 humanos, um de cada lado.
    expect(h.count).toBe(2);
    expect(h.team[0]).not.toBe(h.team[1]);
    console.log(
      `[modos] X1: ${run.seconds.toFixed(1)} s, placar ${[...h.match.teamScore].join(' × ')}, host→amigo ${(run.hostBytesPerClient / 1024).toFixed(2)} KB/s`,
    );
    dispose(run);
  }, 120_000);

  it('Bobo Zombies na Base Abandonada: 2 humanos e 1 bot de apoio, 1 onda; a mesma onda, os mesmos pontos', () => {
    const r = roomPreset('zombies');
    const run = playRoom({ ...r, zombies: { waves: 1 } }, [-1, -1], { snapshotHz: 30, zombies: 16, maxS: 240 });
    expectSameResult(run);
    const h = run.host.sim.view();
    let points = 0;
    for (let e = 0; e < h.count; e++) points += h.points[e]!;
    expect(points).toBeGreaterThan(0);
    console.log(
      `[modos] Zombies: ${run.seconds.toFixed(1)} s, onda ${h.match.zombieWave}, vencedor ${h.match.winnerTeam}, ${points} pontos, host→amigo ${(run.hostBytesPerClient / 1024).toFixed(2)} KB/s`,
    );
    dispose(run);
  }, 240_000);
});
