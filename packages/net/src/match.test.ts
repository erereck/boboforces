import { botPrimaries, createBotDirectorWithPaths } from '@boboforces/ai';
import { builtinBotRef, MATCH_RECIPE_FORMAT, type MatchRecipe } from '@boboforces/format';
import { BUTTON, quantizeAxis, type InputFrame } from '@boboforces/input';
import { yawToU16 } from '@boboforces/shared';
import { createInputFrames, createSim, createSimLoop, ENTITY_FLAG, type Sim, type SimEvent } from '@boboforces/sim';
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
function hostInner(
  writeHuman: (slot: number, out: InputFrame, seq: number) => void,
  onEvents: (events: readonly SimEvent[], sim: Sim) => void,
): NetMatchDriver & { sim: Sim } {
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

/**
 * M5 (fase 6b): a mesma partida com o host no PC (snapshots a 30 Hz) e no celular (20 Hz). A 20 Hz chegam 2/3 dos
 * snapshots e a interpolação de 100 ms fica com menos folga: o p99 sobe de ~2 para ~5 cm (invisível num bobo).
 */
const RATES = [
  { hz: 30, p99: 0.05 },
  { hz: 20, p99: 0.08 },
] as const;

describe('partida pelo loopback (M5 fase 1, critério 1 do plano)', () => {
  it.each(RATES)(
    'host + 3 clientes com 80 ms, variação e 5% de perda, snapshots a $hz Hz: termina igual em todos',
    ({ hz, p99: p99Max }) => {
      const net = createLoopback({ seed: 9, latencyMs: 80, jitterMs: 25, loss: 0.05, duplicate: 0.01 });
      // O host é o peer 0 e joga no slot 0; os clientes 1..3 nos slots 1..3.
      let netHost: ReturnType<typeof createNetHost> | null = null;
      const MAX_E = 32;
      const hostPos = new Float64Array(60 * 60 * MAX_E * 3);
      const hostOk = new Uint8Array(60 * 60 * MAX_E);
      const interpErrors: number[] = [];
      // Os abates de cada um, na ordem (host e clientes), e o tick mostrado quando cada evento saiu.
      const hostKills: number[] = [];
      const inner = hostInner(
        (slot, out, seq) => {
          if (slot === 0) play(0, out, seq);
          else netHost!.writeRemoteFrame(slot, out);
        },
        (events, s) => {
          for (const ev of events) if (ev.type === 'kill') hostKills.push(ev.victim);
          netHost!.recordEvents(events);
          // O histórico do host (a régua da interpolação): posição e "vivo e em pé" de cada boneco em cada tick.
          const v = s.view();
          for (let e = 0; e < Math.min(v.count, MAX_E); e++) {
            const o = (s.tick * MAX_E + e) * 3;
            for (let k = 0; k < 3; k++) hostPos[o + k] = v.position[e * 3 + k]!;
            hostOk[s.tick * MAX_E + e] = v.alive[e] === 1 && (v.flags[e]! & ENTITY_FLAG.dead) === 0 ? 1 : 0;
          }
        },
      );
      netHost = createNetHost({ sim: inner.sim, endpoint: net.endpoint(0), snapshotHz: hz });
      /** Os snapshots e as reconciliações de 30 s (a partida tem 40 s). */
      const atLeast = hz * 30;
      const host = createHostDriver(netHost, inner);
      const clients: ClientDriver[] = [];
      const clientKills: number[][] = [];
      let early = 0;
      for (let slot = 1; slot < HUMANS; slot++) {
        netHost.addClient(slot, slot);
        const kills: number[] = [];
        clientKills.push(kills);
        clients.push(
          createClientDriver({
            sim: createSim({ recipe, map, humans: HUMANS, primaries: botPrimaries(recipe, HUMANS) }),
            endpoint: net.endpoint(slot),
            host: 0,
            writeLocalFrame: (out, seq) => play(slot, out, seq),
            onEvents: (events) => {
              const shown = Math.floor(clients[slot - 1]!.renderTick);
              for (const ev of events) {
                if (ev.type === 'kill') kills.push(ev.victim);
                // O efeito sai junto com os bonecos: nunca antes do tick mostrado.
                if (ev.tick > shown) early++;
              }
            },
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
        // Fase 2c: o cliente 1 mostra os outros onde o host estava no tick mostrado (entre os dois ticks inteiros).
        const c1 = clients[0]!;
        const rt = c1.renderTick;
        if (rt > 60 && inner.sim.view().match.phase === 'playing') {
          const t0 = Math.floor(rt);
          const f = rt - t0;
          const v = c1.sim.view();
          for (let e = 0; e < Math.min(v.count, MAX_E); e++) {
            if (e === c1.ownEntity || hostOk[t0 * MAX_E + e] !== 1 || hostOk[(t0 + 1) * MAX_E + e] !== 1) continue;
            let err = 0;
            let jump = 0;
            for (let k = 0; k < 3; k++) {
              const a = hostPos[(t0 * MAX_E + e) * 3 + k]!;
              const b = hostPos[((t0 + 1) * MAX_E + e) * 3 + k]!;
              jump = Math.max(jump, Math.abs(b - a));
              err = Math.max(err, Math.abs(v.position[e * 3 + k]! - (a + (b - a) * f)));
            }
            if (jump < 0.5) interpErrors.push(err);
          }
        }
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
        expect(c.stats.snapshotsApplied).toBeGreaterThan(atLeast);
        // As entradas chegaram quase todas (a redundância cobre os 5% de perda).
        const input = netHost.inputOf(clients.indexOf(c) + 1)!;
        expect(input.stats.received / c.stats.inputsSent).toBeGreaterThan(0.99);
      }
      // Fase 2c: a interpolação fica a menos de 5 cm do host em 99% das medidas (média abaixo de 1 cm). Acima de 1 m é
      // um respawn entre dois snapshots (o cliente segura a posição de antes até o seguinte): raro.
      interpErrors.sort((x, y) => x - y);
      const p99 = interpErrors[Math.floor(interpErrors.length * 0.99)]!;
      const near = interpErrors.filter((x) => x <= 1);
      const mean = near.reduce((n, x) => n + x, 0) / near.length;
      expect(interpErrors.length).toBeGreaterThan(10_000);
      expect(p99).toBeLessThan(p99Max);
      expect(mean).toBeLessThan(0.01);
      expect(interpErrors.length - near.length).toBeLessThan(interpErrors.length * 0.005);
      // Fase 2b: a predição erra mais de 10 cm em menos de 1% das reconciliações (fora os teleportes do respawn).
      for (const c of clients) {
        expect(c.stats.reconciles).toBeGreaterThan(atLeast);
        expect(c.stats.mispredicts / c.stats.reconciles).toBeLessThan(0.01);
        expect(c.stats.errorSumM / c.stats.reconciles).toBeLessThan(0.01);
        expect(c.renderTick).toBeGreaterThan(c.assembler.newest!.tick - 12);
      }
      console.log(
        `[interp] ${hz} Hz: ${interpErrors.length} medidas · média ${(mean * 100).toFixed(2)} cm · p99 ${(p99 * 100).toFixed(2)} cm`,
      );
      // Os eventos chegam todos (canal confiável), na ordem, e nunca antes do estado.
      for (const kills of clientKills) expect(kills).toEqual(hostKills);
      expect(early).toBe(0);
      expect(net.stats.dropped).toBeGreaterThan(100);
      expect(net.stats.largest).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
      // Banda do host por cliente (snapshots a 30 Hz e os eventos, 4 humanos + 8 bots): abaixo dos 16 KB/s do §13.3.
      const seconds = net.now / 1000;
      const perClient = net.bytesSentBy(0) / 3 / seconds;
      expect(perClient).toBeLessThan(12_000);
      for (const c of clients)
        console.log(
          `[pred] reconc ${c.stats.reconciles} refeitas/reconc ${(c.stats.replayed / c.stats.reconciles).toFixed(1)} erro médio ${((c.stats.errorSumM / c.stats.reconciles) * 100).toFixed(2)} cm máx ${(c.stats.errorMaxM * 100).toFixed(1)} cm acima10cm ${c.stats.mispredicts} teleportes ${c.stats.teleports} · lag ${(c.assembler.newest!.tick - c.renderTick).toFixed(1)}`,
        );
      console.log(
        `[net] ${hz} Hz: ${seconds.toFixed(1)} s · host→cliente ${(perClient / 1024).toFixed(2)} KB/s · ` +
          `cliente→host ${(net.bytesSentBy(1) / seconds / 1024).toFixed(2)} KB/s · maior ${net.stats.largest} B · ` +
          `snapshots ${netHost.stats.snapshots}, completos ${netHost.stats.full}, partes máx ${netHost.stats.maxParts}`,
      );
      host.dispose();
      for (const c of clients) c.dispose();
    },
    60_000,
  );
});
