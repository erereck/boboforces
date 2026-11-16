import { createInputFrame, type InputFrame } from '@boboforces/input';
import { BitReader, BitWriter } from '@boboforces/shared';
import type { Sim, SimEvent } from '@boboforces/sim';
import { EventQueue } from './events.ts';
import { applyFrame, createRemoteState } from './frame.ts';
import type { NetMatchDriver } from './host.ts';
import { InputHistory } from './inputs.ts';
import {
  checkHello,
  localHello,
  MAX_MESSAGE_BYTES,
  MSG,
  NO_TICK,
  readReject,
  readWelcome,
  REJECT_REASON,
  writeHello,
  type HelloVerdict,
  type NetChannel,
  type NetHello,
  type NetWelcome,
} from './protocol.ts';
import { createNetLayout, type NetLayout } from './schema.ts';
import { SnapshotAssembler } from './snapshot.ts';
import type { NetEndpoint } from './transport.ts';

export interface ClientDriverConfig {
  /**
   * A sim do cliente: criada com a mesma receita e o mesmo mapa do host (o lobby manda; fase 4). Ela não roda: o
   * cliente escreve nela o estado de cada snapshot (`sim.remote`) e o render lê a view como sempre.
   */
  readonly sim: Sim;
  readonly endpoint: NetEndpoint;
  /** O peer do host. */
  readonly host: number;
  /** Preenche o InputFrame do jogador a cada tick (o mapeador do slot, como no `LocalDriver`). */
  readonly writeLocalFrame: (out: InputFrame, seq: number) => void;
  /** O hello desta build (padrão `localHello()`; os testes trocam). */
  readonly hello?: NetHello;
  /**
   * Os eventos do host, soltos quando o estado mostrado chega no tick deles (como o `onEvents` do `LocalDriver`:
   * objetos de pool, valem só durante a chamada).
   */
  readonly onEvents?: (events: readonly SimEvent[], sim: Sim) => void;
}

/** `connecting` até o host responder; `rejected` com o veredito (quem atualiza) ou sala cheia. */
export type ClientNetState = 'connecting' | 'playing' | 'rejected';

export interface ClientNetStats {
  inputsSent: number;
  snapshotsApplied: number;
}

export interface ClientDriver extends NetMatchDriver {
  readonly sim: Sim;
  readonly layout: NetLayout;
  readonly state: ClientNetState;
  readonly welcome: NetWelcome | null;
  /** Por que o host recusou: `full`/`locked` ou o veredito de versão deste lado. */
  readonly rejection: HelloVerdict | 'full' | 'locked' | null;
  readonly assembler: SnapshotAssembler;
  readonly events: EventQueue;
  readonly stats: ClientNetStats;
}

/** Fila de ticks locais por frame (como o `LocalDriver`): frame limitado a 0,1 s, no máximo 4 ticks. */
const MAX_FRAME_S = 0.1;
const MAX_TICKS = 4;

/**
 * O driver do cliente (M5 fase 1): manda a entrada de cada tick (com as 3 anteriores) e mostra o snapshot completo
 * mais novo do host. O render interpola do snapshot anterior para o novo ao longo do intervalo entre eles. A predição
 * do próprio movimento e a interpolação com 100 ms de atraso são a fase 2.
 */
export function createClientDriver(config: ClientDriverConfig): ClientDriver {
  const { sim, endpoint, host, writeLocalFrame } = config;
  const hello = config.hello ?? localHello();
  const layout = createNetLayout(sim.view());
  const assembler = new SnapshotAssembler(layout);
  const events = new EventQueue();
  const onEvents = config.onEvents;
  const release = onEvents ? (list: readonly SimEvent[]): void => onEvents(list, sim) : null;
  const remoteState = createRemoteState();
  const reader = new BitReader(new Uint8Array(0));
  const out = new BitWriter(MAX_MESSAGE_BYTES);
  const history = new InputHistory();
  const frame = createInputFrame();
  const stats: ClientNetStats = { inputsSent: 0, snapshotsApplied: 0 };
  const dt = 1 / sim.hz;
  let state: ClientNetState = 'connecting';
  let welcome: NetWelcome | null = null;
  let rejection: ClientDriver['rejection'] = null;
  let helloSent = false;
  let disposed = false;
  let acc = 0;
  let seq = 0;
  let appliedTick = -1;
  let interval = 1 / 30;
  let sinceApply = 0;

  const onMessage = (_from: number, channel: NetChannel, bytes: Uint8Array): void => {
    reader.reset(bytes);
    const type = reader.readBits(8);
    if (channel === 'reliable') {
      if (type === MSG.welcome && state === 'connecting') {
        welcome = readWelcome(reader);
        state = 'playing';
      } else if (type === MSG.reject && state === 'connecting') {
        const r = readReject(reader);
        rejection =
          r.reason === REJECT_REASON.full
            ? 'full'
            : r.reason === REJECT_REASON.locked
              ? 'locked'
              : checkHello(hello, r.host);
        state = 'rejected';
      }
      if (type === MSG.events && state === 'playing') events.receive(bytes);
      return;
    }
    if (type === MSG.snapshot && state === 'playing') assembler.receive(bytes);
  };

  return {
    sim,
    layout,
    assembler,
    events,
    stats,
    get state(): ClientNetState {
      return state;
    },
    get welcome(): NetWelcome | null {
      return welcome;
    },
    get rejection(): ClientDriver['rejection'] {
      return rejection;
    },
    get alpha(): number {
      return Math.min(1, sinceApply / interval);
    },
    update(frameSeconds: number): number {
      if (!helloSent) {
        out.reset();
        writeHello(out, hello);
        endpoint.send(host, 'reliable', out.bytes());
        helloSent = true;
      }
      endpoint.poll(onMessage);
      const newest = assembler.newest;
      if (newest !== null && newest.tick !== NO_TICK && newest.tick > appliedTick) {
        if (appliedTick >= 0) interval = Math.min(0.25, Math.max(dt, (newest.tick - appliedTick) * dt));
        applyFrame(layout, newest, sim, remoteState);
        appliedTick = newest.tick;
        sinceApply = 0;
        stats.snapshotsApplied++;
      } else {
        sinceApply += Math.min(frameSeconds, MAX_FRAME_S);
      }
      if (appliedTick >= 0) events.release(appliedTick, release);
      if (state !== 'playing') return 0;
      acc += Math.min(frameSeconds, MAX_FRAME_S);
      let ticks = 0;
      while (acc >= dt && ticks < MAX_TICKS) {
        acc -= dt;
        seq = (seq + 1) & 0xffff;
        writeLocalFrame(frame, seq);
        frame.seq = seq;
        history.push(frame);
        out.reset();
        history.write(out, newest?.tick ?? NO_TICK);
        endpoint.send(host, 'unreliable', out.bytes());
        stats.inputsSent++;
        ticks++;
      }
      if (acc >= dt) acc = 0;
      return ticks;
    },
    /** Solta a sim também (como o `LocalDriver`: quem cria o driver entrega a sim a ele). */
    dispose(): void {
      if (disposed) return;
      disposed = true;
      sim.dispose();
    },
  };
}
