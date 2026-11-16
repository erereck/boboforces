import type { InputFrame } from '@boboforces/input';
import { BitReader, BitWriter } from '@boboforces/shared';
import { NULL_ENTITY, type Sim } from '@boboforces/sim';
import { captureFrame } from './frame.ts';
import { RemoteInputBuffer } from './inputs.ts';
import {
  checkHello,
  localHello,
  MAX_MESSAGE_BYTES,
  MSG,
  readHello,
  REJECT_REASON,
  writeReject,
  writeWelcome,
  type NetChannel,
  type NetHello,
} from './protocol.ts';
import { createNetLayout, type NetLayout } from './schema.ts';
import { FrameRing, SnapshotEncoder } from './snapshot.ts';
import type { NetEndpoint } from './transport.ts';

/**
 * Quem conduz a partida, do jeito que o `game` enxerga (`MatchDriver` em `packages/game/src/local-driver.ts`; o `net`
 * não importa o `game`, então o contrato é repetido aqui pela forma).
 */
export interface NetMatchDriver {
  update(frameSeconds: number): number;
  readonly alpha: number;
  dispose(): void;
}

export interface NetHostConfig {
  /** A sim do host (a do `LocalDriver`): o host simula, os clientes só mostram. */
  readonly sim: Sim;
  readonly endpoint: NetEndpoint;
  /** Snapshots por segundo: 30 com host no PC, 20 no celular (tecnico.md §13.3 e §13.4). */
  readonly snapshotHz: number;
  /** Snapshots guardados como base do delta (padrão 32: ~1 s a 30 Hz). Ack mais velho = snapshot completo. */
  readonly history?: number;
  /** O hello desta build (padrão `localHello()`; os testes trocam). */
  readonly hello?: NetHello;
}

export interface NetHostStats {
  snapshots: number;
  parts: number;
  bytes: number;
  /** Snapshots completos (sem base) mandados: o 1º de cada cliente e os de ack velho demais. */
  full: number;
  maxParts: number;
  maxBytes: number;
}

interface HostClient {
  readonly peer: number;
  readonly slot: number;
  readonly input: RemoteInputBuffer;
  readonly send: (bytes: Uint8Array) => void;
  verified: boolean;
}

export interface NetHost {
  /** Reserva o controlador `slot` para o peer (o lobby escolhe; fase 4). Só ele passa no handshake. */
  addClient(peer: number, slot: number): void;
  removeClient(peer: number): void;
  /**
   * Escreve a entrada do humano remoto do controlador `slot` (o `writeHumanFrame` do `LocalDriver` chama nos slots
   * remotos). `false` = nenhum cliente nesse slot.
   */
  writeRemoteFrame(slot: number, out: InputFrame): boolean;
  /** Lê o que chegou (handshakes, entradas, acks). Antes dos ticks do frame. */
  receive(): void;
  /** Depois dos ticks: se deu a hora, captura o snapshot e manda a cada cliente (delta contra o ack dele). */
  afterTicks(): void;
  readonly layout: NetLayout;
  readonly stats: NetHostStats;
  /** Os snapshots guardados (testes conferem o que o cliente reconstruiu). */
  readonly history: FrameRing;
  /** A fila de entradas de um peer (testes e o F2). */
  inputOf(peer: number): RemoteInputBuffer | null;
}

export function createNetHost(config: NetHostConfig): NetHost {
  const { sim, endpoint } = config;
  const hello = config.hello ?? localHello();
  const layout = createNetLayout(sim.view());
  const history = new FrameRing(layout, config.history ?? 32);
  const encoder = new SnapshotEncoder(layout);
  const interval = Math.max(1, Math.round(sim.hz / config.snapshotHz));
  const clients: HostClient[] = [];
  const reader = new BitReader(new Uint8Array(0));
  const reply = new BitWriter(MAX_MESSAGE_BYTES);
  const stats: NetHostStats = { snapshots: 0, parts: 0, bytes: 0, full: 0, maxParts: 0, maxBytes: 0 };
  let lastSnapshot = -1;

  const find = (peer: number): HostClient | null => {
    for (const c of clients) if (c.peer === peer) return c;
    return null;
  };

  const onMessage = (from: number, channel: NetChannel, bytes: Uint8Array): void => {
    reader.reset(bytes);
    const type = reader.readBits(8);
    const client = find(from);
    if (type === MSG.hello && channel === 'reliable') {
      const theirs = readHello(reader);
      reply.reset();
      if (client === null) {
        writeReject(reply, REJECT_REASON.full, hello);
      } else if (checkHello(hello, theirs) !== 'ok') {
        writeReject(reply, REJECT_REASON.version, hello);
      } else {
        client.verified = true;
        writeWelcome(reply, { slot: client.slot, hz: sim.hz, snapshotHz: config.snapshotHz });
      }
      endpoint.send(from, 'reliable', reply.bytes());
      return;
    }
    if (type === MSG.input && client !== null && client.verified) client.input.receive(reader);
  };

  return {
    layout,
    stats,
    history,
    inputOf: (peer) => find(peer)?.input ?? null,
    addClient(peer, slot): void {
      if (find(peer) !== null) return;
      clients.push({
        peer,
        slot,
        input: new RemoteInputBuffer(),
        send: (bytes) => endpoint.send(peer, 'unreliable', bytes),
        verified: false,
      });
    },
    removeClient(peer): void {
      const i = clients.findIndex((c) => c.peer === peer);
      if (i >= 0) clients.splice(i, 1);
    },
    writeRemoteFrame(slot, out): boolean {
      for (const c of clients) {
        if (c.slot === slot) {
          c.input.consume(out);
          return true;
        }
      }
      return false;
    },
    receive(): void {
      endpoint.poll(onMessage);
    },
    afterTicks(): void {
      const tick = sim.tick;
      if (lastSnapshot >= 0 && tick - lastSnapshot < interval) return;
      lastSnapshot = tick;
      const frame = history.next();
      captureFrame(layout, sim.view(), frame);
      stats.snapshots++;
      for (const c of clients) {
        if (!c.verified) continue;
        const base = history.get(c.input.ackTick);
        if (base === null) stats.full++;
        const id = sim.controllerEntity(c.slot);
        const r = encoder.encode(
          frame,
          base === frame ? null : base,
          { focus: id === NULL_ENTITY ? -1 : id & 0xffff, inputSeq: c.input.lastConsumedSeq },
          c.send,
        );
        stats.parts += r.parts;
        stats.bytes += r.bytes;
        stats.maxParts = Math.max(stats.maxParts, r.parts);
        stats.maxBytes = Math.max(stats.maxBytes, r.bytes);
      }
    },
  };
}

/**
 * O driver do host: o de sempre (o `LocalDriver` do `game`, com a sim e os bots) mais a rede. Antes dos ticks lê as
 * entradas dos clientes; depois, manda o snapshot. O `writeHumanFrame` do driver de dentro chama
 * `net.writeRemoteFrame` nos slots remotos.
 */
export function createHostDriver(net: NetHost, inner: NetMatchDriver): NetMatchDriver {
  return {
    get alpha(): number {
      return inner.alpha;
    },
    update(frameSeconds: number): number {
      net.receive();
      const ticks = inner.update(frameSeconds);
      if (ticks > 0) net.afterTicks();
      return ticks;
    },
    dispose(): void {
      inner.dispose();
    },
  };
}
