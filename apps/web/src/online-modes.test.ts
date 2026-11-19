import type { MatchRecipe } from '@boboforces/format';
import { createSceneDriver, onlineRecipe, type OnlineSession, type SceneDriver } from '@boboforces/game';
import { moreModePreset } from '@boboforces/game/editors';
import { roomPreset, type RoomPresetMode } from '@boboforces/game/online';
import { BUTTON, quantizeAxis, type InputFrame } from '@boboforces/input';
import * as net from '@boboforces/net';
import { yawToU16 } from '@boboforces/shared';
import { ENTITY_KIND } from '@boboforces/sim';
import { describe, expect, it } from 'vitest';
import { loadRealMap } from '../scripts/real-maps.ts';
import { createOnlineSession } from './online-session.ts';

/**
 * M5 (fase 6a): cada partida da sala pela rede de mentira, com os mapas de verdade (o Construto, o Ringue e a Base
 * Abandonada): o host com os bots e um ou mais amigos, 60 ms de ida, variação e perda. No fim, o amigo mostra o mesmo
 * placar, as mesmas mortes e (no Bobo Zombies) a mesma onda, os mesmos pontos e as mesmas portas que o host.
 */

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
  const map = loadRealMap(recipe.map);
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
    // Revisão da fase 6: o pool de zumbis do host vai no começo, e cada lado cria a sim com o da própria sessão.
    ...(options.zombies > 0 ? { zombies: options.zombies } : {}),
  };
  const common = { net, start, snapshotHz: options.snapshotHz, isClosed: () => false, takeLeftSlots: () => [] };
  /** Como a cena faz: o pool do Bobo Zombies é o da sessão (o host mandou no começo). */
  const configFor = (session: OnlineSession) => ({
    recipe: { ...placed.recipe, seed: 77 },
    map,
    humans: teams.length,
    writeHumanFrame: play,
    ...(session.zombiePool !== undefined && recipe.mode === 'zombies' ? { zombies: session.zombiePool } : {}),
  });
  const drive = (session: OnlineSession): SceneDriver => createSceneDriver(configFor(session), session);
  const host = drive(
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
    drive(
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
    // M6 (fase 4): os modificadores ligados.
    if (h.chaos !== null) expect(v.chaos!.masks[0]).toBe(h.chaos.masks[0]);
    // M6 (fase 1): os pontos do Domination (o dono e o progresso, em milésimos).
    if (h.controlPoints !== null) {
      expect([...v.controlPoints!.owner]).toEqual([...h.controlPoints.owner]);
      for (let i = 0; i < h.controlPoints.count; i++) {
        expect(Math.abs(v.controlPoints!.progress[i]! - h.controlPoints.progress[i]!)).toBeLessThan(0.002);
      }
    }
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

  it('M5 (fase 6b): host no celular: Times a 20 Hz (o host e 1 amigo, 6 bots); o mesmo resultado, menos banda', () => {
    const at30 = playRoom(short('warfare.tdm', 30), [0, 1], { snapshotHz: 30, zombies: 0, maxS: 120 });
    const at20 = playRoom(short('warfare.tdm', 30), [0, 1], { snapshotHz: 20, zombies: 0, maxS: 120 });
    expectSameResult(at30);
    expectSameResult(at20);
    expect(at20.hostBytesPerClient).toBeLessThan(at30.hostBytesPerClient * 0.85);
    const kb = (run: RoomRun): string => (run.hostBytesPerClient / 1024).toFixed(2);
    console.log(`[modos] Times: 30 Hz ${kb(at30)} KB/s, 20 Hz ${kb(at20)} KB/s por amigo`);
    dispose(at30);
    dispose(at20);
  }, 240_000);

  it('M6 (fase 1): Domination no Construto: o host, 1 amigo e 6 bots; os mesmos pontos e o mesmo placar', () => {
    const r = moreModePreset('warfare.domination')!;
    const run = playRoom({ ...r, match: { timeLimitS: 90, scoreLimit: 200 } }, [0, 1], {
      snapshotHz: 30,
      zombies: 0,
      maxS: 240,
    });
    expectSameResult(run);
    const h = run.host.sim.view();
    expect(h.controlPoints!.count).toBe(3);
    // Os bots jogaram o objetivo: alguém marcou pelos pontos.
    expect(h.match.teamScore[0]! + h.match.teamScore[1]!).toBeGreaterThan(0);
    console.log(
      `[modos] Domination: ${run.seconds.toFixed(1)} s, placar ${h.match.teamScore[0]} × ${h.match.teamScore[1]}, pontos ${[...h.controlPoints!.owner].join(' ')}, host→amigo ${(run.hostBytesPerClient / 1024).toFixed(2)} KB/s`,
    );
    dispose(run);
  }, 240_000);

  it('M6 (fase 5): Bobo Paintball: as bolas de tinta e os abates chegam iguais ao amigo', () => {
    const base = moreModePreset('paintball')!;
    const r: MatchRecipe = { ...base, match: { ...base.match, timeLimitS: 90 } };
    const run = playRoom(r, [0, 1], { snapshotHz: 30, zombies: 0, maxS: 120 });
    expectSameResult(run);
    const h = run.host.sim.view().match.teamScore;
    expect(h[0]! + h[1]!).toBeGreaterThan(5);
    const net = run.clients[0]!.net!;
    expect(net.mispredicts / net.reconciles).toBeLessThan(0.02);
    console.log(
      `[modos] Bobo Paintball: ${run.seconds.toFixed(1)} s, placar ${h[0]}×${h[1]}, predição errada ${net.mispredicts}/${net.reconciles}`,
    );
    dispose(run);
  }, 240_000);

  it('M6 (fase 4): Bobo Chaos com a Roleta a cada 20 s: os modificadores chegam iguais e a predição anda com eles', () => {
    const base = moreModePreset('chaos')!;
    // 90 s com a troca a cada 20 s: a largada e 4 trocas; o amigo no time 0.
    const r: MatchRecipe = { ...base, match: { ...base.match, timeLimitS: 90 }, chaos: { everyS: 20 } };
    const run = playRoom(r, [0, 0], { snapshotHz: 30, zombies: 0, maxS: 120 });
    expectSameResult(run);
    const h = run.host.sim.view().chaos!.masks;
    const v = run.clients[0]!.sim.view().chaos!.masks;
    expect(v[0]).toBe(h[0]);
    const net = run.clients[0]!.net!;
    expect(net.reconciles).toBeGreaterThan(1000);
    expect(net.mispredicts / net.reconciles).toBeLessThan(0.02);
    console.log(
      `[modos] Bobo Chaos: ${run.seconds.toFixed(1)} s, máscara final ${h[0]!.toString(2)}, placar ${run.host.sim.view().match.teamScore[0]}×${run.host.sim.view().match.teamScore[1]}, predição errada ${net.mispredicts}/${net.reconciles}`,
    );
    dispose(run);
  }, 240_000);

  it('M7 (fase 0): Juggernaut Fixo com o amigo: as rodadas chegam iguais, a compra congela a predição e o mesmo fim', () => {
    const base = moreModePreset('juggernautFixed')!;
    // Só os 2 (sem bot): 2 rodadas de até 3 min.
    const r: MatchRecipe = { ...base, teams: [{ humans: 'all', bots: [] }, { bots: [] }] };
    const run = playRoom(r, [0, 0], { snapshotHz: 30, zombies: 0, maxS: 420 });
    expectSameResult(run);
    const h = run.host.sim.view();
    const v = run.clients[0]!.sim.view();
    expect(Array.from(v.rounds!.data)).toEqual(Array.from(h.rounds!.data));
    expect(h.rounds!.data[0]).toBe(2);
    for (let e = 0; e < h.count; e++) expect(v.points[e], `pontos da entidade ${e}`).toBe(h.points[e]);
    const net = run.clients[0]!.net!;
    expect(net.mispredicts / net.reconciles).toBeLessThan(0.02);
    console.log(
      `[modos] Juggernaut Fixo: ${run.seconds.toFixed(1)} s, rodadas ${h.rounds!.data[3]}×${h.rounds!.data[4]}, vencedor ${h.match.winnerEntity}, predição errada ${net.mispredicts}/${net.reconciles}`,
    );
    dispose(run);
  }, 300_000);

  it('M6 (fase 3): Juggernaut com o amigo caçando: o Jugg troca de mãos igual nos dois lados e o mesmo fim', () => {
    const base = moreModePreset('juggernaut')!;
    // 90 s em vez de 10 min (a meta de 150 não chega: vence quem tiver mais pontos de Jugg).
    const r: MatchRecipe = { ...base, match: { ...base.match, timeLimitS: 90 } };
    const run = playRoom(r, [0, 0], { snapshotHz: 30, zombies: 0, maxS: 120 });
    expectSameResult(run);
    const h = run.host.sim.view();
    const v = run.clients[0]!.sim.view();
    // Quem é o Jugg no fim (o time) e a vida dele chegam iguais.
    for (let e = 0; e < h.count; e++) expect(v.team[e], `time da entidade ${e}`).toBe(h.team[e]);
    let best = 0;
    for (let e = 0; e < h.count; e++) best = Math.max(best, h.points[e]!);
    expect(best).toBeGreaterThan(10);
    const net = run.clients[0]!.net!;
    expect(net.mispredicts / net.reconciles).toBeLessThan(0.02);
    console.log(
      `[modos] Juggernaut: ${run.seconds.toFixed(1)} s, o melhor com ${best} pontos, vencedor ${h.match.winnerEntity}, predição errada ${net.mispredicts}/${net.reconciles}`,
    );
    dispose(run);
  }, 240_000);

  it('M6 (fase 2): Infection com o amigo infectado desde o começo: o mesmo fim, e a predição dele anda como no host', () => {
    const r = moreModePreset('infection')!;
    // O amigo escolhe o time 1: começa infectado (1,2x de velocidade), e a predição dele precisa saber disso.
    const run = playRoom(r, [0, 1], { snapshotHz: 30, zombies: 0, maxS: 200 });
    expectSameResult(run);
    const net = run.clients[0]!.net!;
    expect(net.reconciles).toBeGreaterThan(1000);
    expect(net.mispredicts / net.reconciles).toBeLessThan(0.02);
    const h = run.host.sim.view();
    console.log(
      `[modos] Infection: ${run.seconds.toFixed(1)} s, sobreviventes ${h.match.teamScore[0]} × infectados ${h.match.teamScore[1]}, vencedor ${h.match.winnerTeam}, predição errada ${net.mispredicts}/${net.reconciles}`,
    );
    dispose(run);
  }, 240_000);

  it('M6 (fase 6b): Horda armada na Base, 1 onda: os 2 no time 0, a horda é de bots e o fim é o mesmo no amigo', () => {
    const base = moreModePreset('zombiesArmed')!;
    const r: MatchRecipe = { ...base, zombies: { ...base.zombies, waves: 1 } };
    const run = playRoom(r, [-1, 1], { snapshotHz: 30, zombies: 0, maxS: 240 });
    expectSameResult(run);
    const h = run.host.sim.view();
    // Ninguém humano na horda (mesmo quem pediu o time 1) e nenhum zumbi; a onda acabou (vitória ou derrota).
    for (let c = 0; c < 2; c++) expect(h.team[run.host.sim.controllerEntity(c) & 0xffff]).toBe(0);
    let zombies = 0;
    for (let i = 0; i < h.count; i++) if (h.alive[i] === 1 && h.kind[i] === ENTITY_KIND.zombie) zombies++;
    expect(zombies).toBe(0);
    console.log(
      `[modos] Horda armada: ${run.seconds.toFixed(1)} s, onda ${h.match.zombieWave}, vencedor ${h.match.winnerTeam}`,
    );
    dispose(run);
  }, 240_000);

  it('M6 (fase 6a): Zombies Fortress no Posto, 1 onda: o mesmo fim e a vida do gerador igual no amigo', () => {
    const base = moreModePreset('zombiesFortress')!;
    const r: MatchRecipe = { ...base, zombies: { ...base.zombies, waves: 1 }, teams: [{ humans: 'all', bots: [] }] };
    const run = playRoom(r, [-1, -1], { snapshotHz: 30, zombies: 16, maxS: 240 });
    expectSameResult(run);
    const h = run.host.sim.view().fortress!;
    const c = run.clients[0]!.sim.view().fortress!;
    expect(Math.abs(c.hp[0]! - h.hp[0]!)).toBeLessThan(1);
    console.log(
      `[modos] Zombies Fortress: ${run.seconds.toFixed(1)} s, onda ${run.host.sim.view().match.zombieWave}, vencedor ${run.host.sim.view().match.winnerTeam}, gerador ${Math.round(h.hp[0]!)}`,
    );
    dispose(run);
  }, 240_000);

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
