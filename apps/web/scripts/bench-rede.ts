// `npm run bench:rede` (M5 fase 7a): o custo do host online no Node, com os mapas de verdade, a IA e 3 amigos pela
// rede de mentira (40 ms ± 10 ms, 1% de perda). Mede, por segundo de partida, a sim e a IA do host (os mesmos relógios
// do F2), a rede do host (receber as entradas e montar e mandar os snapshots: o `receive` e o `afterTicks` do link) e,
// à parte, o trabalho dos amigos de mentira (que no jogo de verdade roda em outros aparelhos). Mostra o custo por quadro
// a 30 fps (33,3 ms) ao lado do orçamento do host no celular do tecnico.md §13.4 (sim 2,5; IA 1,0; rede 2,0 ms) e a
// banda por amigo. Os números são do PC (Node com JIT); a CPU do celular sai do F2 no teste real (ROTEIRO_M5).
//
//   npm run bench:rede                    os 4 casos, 60 s de partida cada (mais 5 s de aquecimento)
//   npm run bench:rede -- --segundos 20   mais curto
//   npm run bench:rede -- --caso celular  um caso só (celular, pc, zombies-celular, zombies-pc)
//
// Relatório em local/m5/bench-rede/<AAAA-MM-DD-HHMM>.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import {
  createSceneDriver,
  onlineRecipe,
  type OnlineHostLink,
  type OnlineSession,
  type SceneDriver,
} from '@boboforces/game';
import { BUTTON, quantizeAxis, type InputFrame } from '@boboforces/input';
import * as net from '@boboforces/net';
import { yawToU16 } from '@boboforces/shared';
import { ENTITY_FLAG } from '@boboforces/sim';
import { createOnlineSession } from '../src/online-session.ts';
import { parseArgs, stamp } from './args.ts';
import { REPO_ROOT } from './edge.ts';
import { loadRealMap } from './real-maps.ts';

const args = parseArgs(process.argv.slice(2));
const seconds = Math.max(5, Number(args.get('segundos') ?? 60) || 60);
const only = typeof args.get('caso') === 'string' ? (args.get('caso') as string) : null;
const WARMUP_S = 5;
const FRIENDS = 3;
/** O orçamento do host no celular a 30 fps (tecnico.md §13.4), em ms por quadro. */
const BUDGET = { sim: 2.5, ai: 1.0, net: 2.0 } as const;

interface Case {
  readonly id: string;
  readonly title: string;
  readonly recipe: MatchRecipe;
  readonly snapshotHz: number;
  /** O pool de zumbis do host (0 fora do Bobo Zombies). */
  readonly zombies: number;
}

const normal = builtinBotRef('normal');

/** TDM no Construto com 4 humanos (2 por lado) e `bots` bots (metade por lado). */
function tdm(bots: number, minutes: number): MatchRecipe {
  const half = Math.floor(bots / 2);
  return {
    format: MATCH_RECIPE_FORMAT,
    mode: 'warfare.tdm',
    map: 'construto',
    seed: 0,
    match: { timeLimitS: minutes * 60, scoreLimit: 999 },
    teams: [
      { humans: 'all', bots: [{ ref: normal, count: half + 1 }] },
      // Os 2 humanos de cada lado tomam o lugar de 2 bots (o `onlineRecipe`): sobram `half` e `bots - half`.
      { bots: [{ ref: normal, count: bots - half + 2 }] },
    ],
  };
}

const zombiesRecipe: MatchRecipe = {
  format: MATCH_RECIPE_FORMAT,
  mode: 'zombies',
  map: 'base',
  seed: 0,
  match: { timeLimitS: 0, scoreLimit: 0 },
  // Sem fim e com a horda no máximo (3× a quantidade): o bench mede o pool cheio, não a vitória. Os humanos de mentira
  // não matam quase nada, então as ondas se acumulam até o teto do pool.
  zombies: { waves: 0, quantity: 3, hpMul: 4 },
  teams: [{ humans: 'all', bots: [] }],
};

const CASES: readonly Case[] = [
  {
    id: 'celular',
    title: 'Host no celular: 4 humanos + 8 bots, 20 Hz',
    recipe: tdm(8, 30),
    snapshotHz: 20,
    zombies: 0,
  },
  { id: 'pc', title: 'Host no PC: 4 humanos + 40 bots, 30 Hz', recipe: tdm(40, 30), snapshotHz: 30, zombies: 0 },
  {
    id: 'zombies-celular',
    title: 'Bobo Zombies, host no celular: 4 humanos, pool de 16, 20 Hz',
    recipe: zombiesRecipe,
    snapshotHz: 20,
    zombies: 16,
  },
  {
    id: 'zombies-pc',
    title: 'Bobo Zombies, host no PC: 4 humanos, pool de 60, 30 Hz',
    recipe: zombiesRecipe,
    snapshotHz: 30,
    zombies: 60,
  },
];

/** Cada humano anda, vira e atira, igual em qualquer aparelho (depende só do seq). */
function play(slot: number, out: InputFrame, seq: number): void {
  out.yaw = yawToU16(slot * 1.9 + seq * 0.012);
  out.pitch = 0;
  out.moveY = quantizeAxis(seq % 240 < 180 ? 1 : -1);
  out.moveX = quantizeAxis(slot % 2 === 0 ? 0.4 : -0.4);
  out.buttons = (seq % 40 < 18 ? BUTTON.fire : 0) | (seq % 120 === 0 ? BUTTON.jump : 0);
}

interface CaseResult {
  readonly id: string;
  readonly title: string;
  readonly seconds: number;
  readonly entities: number;
  /** Bobos vivos em média (humanos, bots e zumbis em jogo), amostrados a cada segundo. */
  readonly aliveMean: number;
  /** ms por quadro a 30 fps (custo por segundo ÷ 30). */
  readonly simMs: number;
  readonly aiMs: number;
  readonly netMs: number;
  /** O trabalho dos 3 amigos de mentira juntos (outros aparelhos no jogo de verdade). */
  readonly friendsMs: number;
  readonly upKBps: number;
  readonly downKBps: number;
  readonly largestBytes: number;
}

function runCase(c: Case): CaseResult {
  const map = loadRealMap(c.recipe.map);
  const loop = net.createLoopback({ seed: 5, latencyMs: 40, jitterMs: 10, loss: 0.01 });
  const teams = [0, 1, 0, 1];
  const placed = onlineRecipe(c.recipe, teams);
  const start: net.LobbyStart = {
    recipe: placed.recipe,
    seed: 4242,
    members: teams.map((team, i) => ({
      slot: i,
      name: `J${i}`,
      team,
      bobo: null,
      ready: true,
      controller: placed.controllers[i]!,
    })),
    ...(c.zombies > 0 ? { zombies: c.zombies } : {}),
  };
  const common = { net, start, snapshotHz: c.snapshotHz, isClosed: () => false, takeLeftSlots: () => [] };
  const now = (): number => performance.now();
  const driverConfig = {
    recipe: { ...placed.recipe, seed: 4242 },
    map,
    humans: teams.length,
    writeHumanFrame: play,
    now,
    ...(c.zombies > 0 ? { zombies: c.zombies } : {}),
  };
  // A rede do host: o relógio em volta do que o link faz no quadro (receber e montar/mandar os snapshots).
  let netMs = 0;
  let measuring = false;
  const timed = (session: OnlineSession): OnlineSession => ({
    ...session,
    names: session.names,
    attachHost: (sim) => {
      const link = session.attachHost(sim);
      const wrap: OnlineHostLink = {
        ...link,
        receive: () => {
          const t0 = now();
          link.receive();
          if (measuring) netMs += now() - t0;
        },
        afterTicks: () => {
          const t0 = now();
          link.afterTicks();
          if (measuring) netMs += now() - t0;
        },
      };
      return wrap;
    },
  });
  const host = createSceneDriver(
    driverConfig,
    timed(
      createOnlineSession({
        ...common,
        role: 'host',
        endpoint: loop.endpoint(0),
        mySlot: 0,
        peerOfSlot: (slot) => slot,
        hostPeer: -1,
        welcome: null,
      }),
    ),
  );
  const friends: SceneDriver[] = [];
  for (let k = 1; k <= FRIENDS; k++) {
    friends.push(
      createSceneDriver(
        driverConfig,
        createOnlineSession({
          ...common,
          role: 'client',
          endpoint: loop.endpoint(k),
          mySlot: k,
          peerOfSlot: () => -1,
          hostPeer: 0,
          welcome: { slot: k, hz: 60, snapshotHz: c.snapshotHz },
        }),
      ),
    );
  }
  let simMs = 0;
  let aiMs = 0;
  let friendsMs = 0;
  let aliveSum = 0;
  let aliveSamples = 0;
  let upBytes0 = 0;
  let downBytes0 = 0;
  const frame = 1 / 60;
  const total = (WARMUP_S + seconds) * 60;
  for (let f = 0; f < total; f++) {
    if (f === WARMUP_S * 60) {
      measuring = true;
      upBytes0 = loop.bytesSentBy(0);
      downBytes0 = loop.bytesSentBy(1);
    }
    loop.advance(frame * 1000);
    host.update(frame);
    if (measuring) {
      simMs += host.lastSimMs;
      aiMs += host.lastAiMs;
      if (f % 60 === 0) {
        const v = host.sim.view();
        for (let e = 0; e < v.count; e++) if (v.alive[e] === 1 && (v.flags[e]! & ENTITY_FLAG.dead) === 0) aliveSum++;
        aliveSamples++;
      }
    }
    const t0 = now();
    for (const fr of friends) fr.update(frame);
    if (measuring) friendsMs += now() - t0;
  }
  const perFrame = (ms: number): number => ms / seconds / 30;
  const out: CaseResult = {
    id: c.id,
    title: c.title,
    seconds,
    entities: host.sim.view().count,
    aliveMean: aliveSum / Math.max(1, aliveSamples),
    simMs: perFrame(simMs),
    aiMs: perFrame(aiMs),
    netMs: perFrame(netMs),
    friendsMs: perFrame(friendsMs),
    upKBps: (loop.bytesSentBy(0) - upBytes0) / FRIENDS / seconds / 1024,
    downKBps: (loop.bytesSentBy(1) - downBytes0) / seconds / 1024,
    largestBytes: loop.stats.largest,
  };
  host.dispose();
  for (const fr of friends) fr.dispose();
  return out;
}

const fmt = (n: number, d = 2): string => n.toFixed(d).replace('.', ',');
const results: CaseResult[] = [];
for (const c of CASES) {
  if (only !== null && c.id !== only) continue;
  const t0 = performance.now();
  const r = runCase(c);
  results.push(r);
  const over = (v: number, b: number): string => (v > b ? ' (acima)' : '');
  console.log(
    `[bench:rede] ${r.title}: ${r.entities} entidades (${fmt(r.aliveMean, 1)} em jogo) · por quadro a 30 fps: sim ${fmt(r.simMs)}${over(r.simMs, BUDGET.sim)} · ` +
      `IA ${fmt(r.aiMs)}${over(r.aiMs, BUDGET.ai)} · rede ${fmt(r.netMs)}${over(r.netMs, BUDGET.net)} ms ` +
      `(amigos de mentira ${fmt(r.friendsMs)} ms) · host→amigo ${fmt(r.upKBps)} KB/s · amigo→host ${fmt(r.downKBps)} KB/s · ` +
      `maior ${r.largestBytes} B · ${fmt((performance.now() - t0) / 1000, 1)} s`,
  );
}
const dir = join(REPO_ROOT, 'local', 'm5', 'bench-rede');
mkdirSync(dir, { recursive: true });
const file = join(dir, `${stamp(new Date())}.json`);
writeFileSync(file, JSON.stringify({ seconds, budget: BUDGET, node: process.version, results }, null, 2));
console.log(`[bench:rede] relatório em ${file}`);
