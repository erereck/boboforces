// Página do teste de verdade do WebRTC (M5 fase 3; `npm run rtc:web`). Montada pelo esbuild e servida em 127.0.0.1:
// duas abas do mesmo Edge, `?papel=host` e `?papel=cliente`, se acham pela sinalização local (BroadcastChannel, sem
// relay nenhum) e conectam por WebRTC de verdade. O host roda a partida (sim + bots) e o cliente joga pela rede; no
// fim, cada aba deixa o resultado em `window.__rtc`. Não vai para o build do jogo.
import { botPrimaries, createBotDirectorWithPaths } from '@boboforces/ai';
import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, quantizeAxis, type InputFrame } from '@boboforces/input';
import {
  createClientDriver,
  createHostDriver,
  createNetHost,
  type ClientDriver,
  type NetMatchDriver,
} from '@boboforces/net';
import { createLocalJoinRoom, joinNetRoom, type LocalSignalChannel } from '@boboforces/net/rtc';
import { yawToU16 } from '@boboforces/shared';
import { createInputFrames, createSim, createSimLoop, type Sim } from '@boboforces/sim';
import { buildSyntheticConstruto, TEST_NAV_PATHS } from '@boboforces/sim/testing';

export interface RtcResult {
  readonly papel: string;
  readonly phase: string;
  readonly winnerTeam: number;
  readonly teamScore: readonly number[];
  readonly kills: readonly number[];
  readonly deaths: readonly number[];
  readonly unreliable: readonly string[];
  readonly sent: { reliable: number; unreliable: number; fallback: number; dropped: number; received: number };
  readonly connectMs: number;
  readonly client?: {
    snapshots: number;
    reconciles: number;
    mispredicts: number;
    errorMeanCm: number;
    renderLag: number;
    events: number;
  };
  readonly error?: string;
}

declare global {
  interface Window {
    __rtc?: RtcResult;
    __rtcLog?: string[];
  }
}

const HUMANS = 2;
const recipe: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'warfare.tdm',
  map: 'test',
  seed: 77,
  match: { timeLimitS: 20 },
  teams: [
    { humans: 1, bots: [{ ref: builtinBotRef('normal'), count: 3 }] },
    { humans: 1, bots: [{ ref: builtinBotRef('normal'), count: 3 }] },
  ],
};

const papel = new URLSearchParams(location.search).get('papel') ?? 'host';
const log = (msg: string): void => {
  (window.__rtcLog ??= []).push(`${Math.round(performance.now())} ${msg}`);
};

/** Humano andando e atirando (o mesmo jeito no host e no cliente). */
function play(slot: number, out: InputFrame, seq: number): void {
  out.yaw = yawToU16(slot * 1.7 + seq * 0.015);
  out.moveY = quantizeAxis(seq % 200 < 150 ? 1 : -1);
  out.buttons = seq % 30 < 14 ? BUTTON.fire : 0;
}

function finish(sim: Sim, extra: Partial<RtcResult>, net: ReturnType<typeof joinNetRoom>, startedAt: number): void {
  const v = sim.view();
  window.__rtc = {
    papel,
    phase: v.match.phase,
    winnerTeam: v.match.winnerTeam,
    teamScore: [...v.match.teamScore],
    kills: Array.from({ length: v.count }, (_, e) => v.kills[e]!),
    deaths: Array.from({ length: v.count }, (_, e) => v.deaths[e]!),
    unreliable: net.peers.map((p) => p.unreliable),
    sent: {
      reliable: net.stats.reliableSent,
      unreliable: net.stats.unreliableSent,
      fallback: net.stats.fallbackSent,
      dropped: net.stats.dropped,
      received: net.stats.received,
    },
    connectMs: startedAt,
    ...extra,
  };
  log('fim');
}

function main(): void {
  const { map } = buildSyntheticConstruto({ nav: true });
  const started = performance.now();
  const net = joinNetRoom({
    joinRoom: createLocalJoinRoom((name) => {
      const bc = new BroadcastChannel(name);
      const channel: LocalSignalChannel = {
        postMessage: (message) => bc.postMessage(message),
        onmessage: null,
        close: () => bc.close(),
      };
      bc.onmessage = (event): void => channel.onmessage?.(event);
      return channel;
    }),
    roomCode: 'RTC01',
    iceServers: [],
    now: () => performance.now(),
    loopbackCandidates: true,
  });
  let driver: NetMatchDriver | null = null;
  let sim: Sim | null = null;
  let client: ClientDriver | null = null;
  let connectMs = -1;
  let events = 0;
  let endedFrames = 0;
  net.onPeerJoin = (id) => {
    if (driver !== null) return;
    connectMs = Math.round(performance.now() - started);
    log(`amigo ${id} em ${connectMs} ms`);
    if (papel === 'host') {
      const s = createSim({ recipe, map, humans: HUMANS, primaries: botPrimaries(recipe, HUMANS) });
      const director = createBotDirectorWithPaths({ recipe, humans: HUMANS, hz: s.hz }, TEST_NAV_PATHS);
      let seq = 0;
      const host = createNetHost({ sim: s, endpoint: net.endpoint, snapshotHz: 30 });
      const loop = createSimLoop({
        sim: s,
        frames: createInputFrames(),
        beforeTick: (ss, f) => {
          seq = (seq + 1) & 0xffff;
          play(0, f[0]!, seq);
          host.writeRemoteFrame(1, f[1]!);
          director.think(ss.view(), f);
        },
        afterTick: (_ss, evs) => host.recordEvents(evs),
      });
      host.addClient(id, 1);
      sim = s;
      driver = createHostDriver(host, {
        update: (dt) => loop.frame(dt),
        get alpha() {
          return loop.alpha;
        },
        dispose: () => {
          director.dispose();
          s.dispose();
        },
      });
    } else {
      const s = createSim({ recipe, map, humans: HUMANS, primaries: botPrimaries(recipe, HUMANS) });
      sim = s;
      client = createClientDriver({
        sim: s,
        endpoint: net.endpoint,
        host: id,
        writeLocalFrame: (out, seq) => play(1, out, seq),
        onEvents: (list) => {
          events += list.length;
        },
      });
      driver = client;
    }
  };
  let last = performance.now();
  const timer = setInterval(() => {
    const t = performance.now();
    const dt = (t - last) / 1000;
    last = t;
    net.update();
    if (driver === null || sim === null) return;
    driver.update(dt);
    if (sim.view().match.phase === 'ended') endedFrames++;
    // Depois do fim, 2 s para o último snapshot e os eventos chegarem.
    if (endedFrames < 120) return;
    clearInterval(timer);
    const c = client as ClientDriver | null;
    finish(
      sim,
      c !== null
        ? {
            client: {
              snapshots: c.stats.snapshotsApplied,
              reconciles: c.stats.reconciles,
              mispredicts: c.stats.mispredicts,
              errorMeanCm: (c.stats.errorSumM / Math.max(1, c.stats.reconciles)) * 100,
              renderLag: c.assembler.newest!.tick - c.renderTick,
              events,
            },
          }
        : {},
      net,
      connectMs,
    );
  }, 1000 / 60);
}

try {
  main();
} catch (error) {
  window.__rtc = {
    papel,
    phase: 'erro',
    winnerTeam: -1,
    teamScore: [],
    kills: [],
    deaths: [],
    unreliable: [],
    sent: { reliable: 0, unreliable: 0, fallback: 0, dropped: 0, received: 0 },
    connectMs: -1,
    error: String(error),
  };
}
