import { copyInputFrame, createInputFrame, type InputFrame } from '@boboforces/input';
import { BitReader, BitWriter } from '@boboforces/shared';
import type { Sim, SimEvent } from '@boboforces/sim';
import { EventQueue } from './events.ts';
import { applyFrame, createRemoteState, type NetFrame } from './frame.ts';
import type { NetMatchDriver } from './host.ts';
import { InputHistory } from './inputs.ts';
import { interpolate, OwnView, patchOwn } from './view-sync.ts';
import {
  checkHello,
  localHello,
  MAX_MESSAGE_BYTES,
  MSG,
  NO_TICK,
  seqDiff,
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
  /** Snapshots completos novos que chegaram. */
  snapshotsApplied: number;
  /** Fase 2b: reconciliações (o próprio boneco voltou ao estado do host e refez as entradas). */
  reconciles: number;
  /** Entradas refeitas nas reconciliações (o ida e volta em ticks, somado). */
  replayed: number;
  /** Mensagens estragadas ignoradas. */
  bad: number;
  /**
   * Fase 2b: o erro da predição em cada reconciliação (onde o cliente achou que estaria depois da entrada que o host
   * acabou de usar, contra onde o host diz que ficou), somado e o maior, em metros, e quantas passaram de 10 cm. Acima
   * de 1 m é teleporte (respawn, desentalar): conta em `teleports`, fora da soma.
   */
  errorSumM: number;
  teleports: number;
  errorMaxM: number;
  mispredicts: number;
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
  /** Fase 2c: o tick que os outros bonecos mostram (100 ms atrás do host; -1 = nenhum snapshot ainda). */
  readonly renderTick: number;
  /** Fase 2b: o índice do próprio boneco (-1 = ainda não veio). */
  readonly ownEntity: number;
}

/** Fila de ticks locais por frame (como o `LocalDriver`): frame limitado a 0,1 s, no máximo 4 ticks. */
const MAX_FRAME_S = 0.1;
const MAX_TICKS = 4;
/** Fase 2c: os outros bonecos ficam este tanto atrás do host (tecnico.md §13.3). */
export const INTERP_DELAY_S = 0.1;
/** Entradas guardadas para refazer (em `seq`): mais que o ida e volta de 1 s a 60 Hz. */
const REPLAY = 64;

/**
 * O driver do cliente (M5): manda a entrada de cada tick (com as 3 anteriores). O próprio boneco é previsto com o
 * mesmo código da sim (`Sim.predict`): a cada snapshot novo ele volta ao estado que o host mandou e refaz as entradas
 * que o host ainda não tinha usado. Os outros ficam `INTERP_DELAY_S` atrás, entre dois snapshots, com os eventos
 * no mesmo relógio. O `alpha` é o do passo fixo local (o próprio boneco); os outros já vêm com `prev` = atual.
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
  const stats: ClientNetStats = {
    inputsSent: 0,
    snapshotsApplied: 0,
    reconciles: 0,
    replayed: 0,
    bad: 0,
    errorSumM: 0,
    teleports: 0,
    errorMaxM: 0,
    mispredicts: 0,
  };
  const dt = 1 / sim.hz;
  let state: ClientNetState = 'connecting';
  let welcome: NetWelcome | null = null;
  let rejection: ClientDriver['rejection'] = null;
  let helloSent = false;
  let disposed = false;
  let acc = 0;
  let seq = 0;
  const hz = sim.hz;
  const delayTicks = Math.round(INTERP_DELAY_S * hz);
  const inputs = Array.from({ length: REPLAY }, createInputFrame);
  const inputSeqs = new Int32Array(REPLAY).fill(-1);
  /** Onde o próprio boneco ficou depois de cada entrada (a medida do erro da predição). */
  const predicted = new Float64Array(REPLAY * 3);
  const ownView = new OwnView();
  let own = -1;
  let reconciledTick = -1;
  let shownTick = -1;
  let renderTick = -1;
  let clientTime = 0;
  let arrivalTick = -1;
  let arrivalTime = 0;

  /** O par em volta do tick mostrado na fila dos completos (`b` nulo = nada depois). */
  const pair = { a: null as NetFrame | null, b: null as NetFrame | null };
  const findPair = (tick: number): void => {
    pair.a = null;
    pair.b = null;
    let oldest: NetFrame | null = null;
    for (const f of assembler.frames) {
      if (f.tick === NO_TICK) continue;
      if (oldest === null || f.tick < oldest.tick) oldest = f;
      if (f.tick <= tick) {
        if (pair.a === null || f.tick > pair.a.tick) pair.a = f;
      } else if (pair.b === null || f.tick < pair.b.tick) {
        pair.b = f;
      }
    }
    if (pair.a === null) {
      pair.a = oldest;
      pair.b = null;
    }
  };

  /** Fase 2c: o tick mostrado anda com o relógio e puxa devagar para "o host agora − 100 ms". */
  const advanceRender = (step: number, newest: NetFrame): void => {
    const target = arrivalTick + (clientTime - arrivalTime) * hz - delayTicks;
    if (renderTick < 0 || Math.abs(target - renderTick) > hz * 0.5) renderTick = target;
    else renderTick += step * hz + (target - renderTick) * 0.1;
    if (renderTick > newest.tick) renderTick = newest.tick;
  };

  const notePredicted = (k: number): void => {
    const p = sim.view().position;
    predicted[k * 3] = p[own * 3]!;
    predicted[k * 3 + 1] = p[own * 3 + 1]!;
    predicted[k * 3 + 2] = p[own * 3 + 2]!;
  };

  /** Fase 2b: o próprio boneco volta ao estado do host e refaz as entradas que o host ainda não tinha usado. */
  const reconcile = (newest: NetFrame): void => {
    own = newest.privEntity;
    const used = assembler.newestInputSeq;
    const ku = used & (REPLAY - 1);
    if (used >= 0 && inputSeqs[ku] === used) {
      const err = Math.hypot(
        predicted[ku * 3]! - newest.priv[0]!,
        predicted[ku * 3 + 1]! - newest.priv[1]!,
        predicted[ku * 3 + 2]! - newest.priv[2]!,
      );
      if (err > 1) {
        stats.teleports++;
      } else {
        stats.errorSumM += err;
        if (err > stats.errorMaxM) stats.errorMaxM = err;
        if (err > 0.1) stats.mispredicts++;
      }
    }
    sim.predict.load(own, newest.priv);
    if (used >= 0) {
      for (let q = (used + 1) & 0xffff; seqDiff(seq, q) >= 0; q = (q + 1) & 0xffff) {
        const k = q & (REPLAY - 1);
        if (inputSeqs[k] !== q) continue;
        sim.predict.step(own, inputs[k]!);
        notePredicted(k);
        stats.replayed++;
      }
    }
    patchOwn(newest, sim.view(), own);
    reconciledTick = newest.tick;
    stats.reconciles++;
  };

  const onMessage = (from: number, channel: NetChannel, bytes: Uint8Array): void => {
    try {
      handle(from, channel, bytes);
    } catch {
      // Mensagem truncada ou estragada: ignorada (o snapshot seguinte vem contra o ack).
      stats.bad++;
    }
  };

  const handle = (_from: number, channel: NetChannel, bytes: Uint8Array): void => {
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
      return Math.min(1, acc / dt);
    },
    get renderTick(): number {
      return renderTick;
    },
    get ownEntity(): number {
      return own;
    },
    update(frameSeconds: number): number {
      if (!helloSent) {
        out.reset();
        writeHello(out, hello);
        endpoint.send(host, 'reliable', out.bytes());
        helloSent = true;
      }
      endpoint.poll(onMessage);
      const step = Math.min(frameSeconds, MAX_FRAME_S);
      clientTime += step;
      const newest = assembler.newest;
      if (newest !== null && newest.tick !== arrivalTick) {
        arrivalTick = newest.tick;
        arrivalTime = clientTime;
        stats.snapshotsApplied++;
      }
      const view = sim.view();
      if (newest !== null) {
        // Fase 2c: os outros, atrasados, entre os dois snapshots em volta do tick mostrado.
        advanceRender(step, newest);
        findPair(renderTick);
        const fa = pair.a!;
        if (fa.tick !== shownTick) {
          if (own >= 0) ownView.save(view, own);
          applyFrame(layout, fa, sim, remoteState);
          shownTick = fa.tick;
          if (own >= 0) {
            ownView.restore(view, own);
            patchOwn(newest, view, own);
          }
        }
        const fb = pair.b;
        interpolate(fa, fb, fb === null ? 0 : (renderTick - fa.tick) / (fb.tick - fa.tick), view, own);
        events.release(Math.floor(renderTick), release);
        // Fase 2b: o próprio boneco volta ao do host a cada snapshot novo.
        if (newest.tick > reconciledTick && newest.privEntity >= 0) reconcile(newest);
      }
      if (state !== 'playing') return 0;
      acc += step;
      let ticks = 0;
      while (acc >= dt && ticks < MAX_TICKS) {
        acc -= dt;
        seq = (seq + 1) & 0xffff;
        writeLocalFrame(frame, seq);
        frame.seq = seq;
        history.push(frame);
        const k = seq & (REPLAY - 1);
        copyInputFrame(inputs[k]!, frame);
        inputSeqs[k] = seq;
        out.reset();
        history.write(out, newest?.tick ?? NO_TICK);
        endpoint.send(host, 'unreliable', out.bytes());
        stats.inputsSent++;
        if (own >= 0) {
          sim.predict.step(own, frame);
          notePredicted(k);
        }
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
