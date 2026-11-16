import { createRng } from '@boboforces/shared';
import type { NetChannel } from './protocol.ts';

/**
 * Transporte visto pelo host e pelos clientes (tecnico.md §13.2): mensagens endereçadas por peer, em dois canais. O de
 * verdade (Trystero + WebRTC, fase 3 do M5) e o de mentira em memória (`createLoopback`, testes e CI) cumprem o mesmo
 * contrato: `send` copia os bytes (quem chama reaproveita o buffer) e `poll` entrega o que chegou até agora.
 */
export interface NetEndpoint {
  /** Este peer (0 = host no loopback). */
  readonly id: number;
  send(to: number, channel: NetChannel, bytes: Uint8Array): void;
  /** Entrega o que chegou, na ordem de chegada. Os bytes valem só durante a chamada. */
  poll(handler: (from: number, channel: NetChannel, bytes: Uint8Array) => void): void;
}

export interface LoopbackConfig {
  /** Semente da latência e da perda (o mesmo teste dá o mesmo resultado). */
  readonly seed: number;
  /** Latência de uma via, ms (padrão 0). */
  readonly latencyMs?: number;
  /** Variação de cada mensagem, ms (0..jitter a mais; reordena o canal não confiável). */
  readonly jitterMs?: number;
  /** Perda no canal não confiável, 0..1. */
  readonly loss?: number;
  /** Duplicação no canal não confiável, 0..1. */
  readonly duplicate?: number;
}

export interface LoopbackStats {
  sent: number;
  dropped: number;
  duplicated: number;
  delivered: number;
  bytes: number;
  /** Maior mensagem (bytes). */
  largest: number;
}

export interface Loopback {
  /** O peer `id` (criado na primeira chamada). */
  endpoint(id: number): NetEndpoint;
  /** Avança o relógio: o que tem hora de chegada até agora fica disponível no `poll`. */
  advance(ms: number): void;
  readonly now: number;
  readonly stats: LoopbackStats;
  /** Bytes que cada peer mandou (banda por peer). */
  bytesSentBy(id: number): number;
}

interface InFlight {
  at: number;
  order: number;
  from: number;
  channel: NetChannel;
  bytes: Uint8Array;
}

/**
 * Rede de mentira em memória (M5 fase 1): latência + variação, perda e duplicação só no canal não confiável (o
 * confiável chega sempre e em ordem por par de peers). Determinística pela semente. Só testes e CI: copia cada
 * mensagem (aloca), o que o transporte de verdade também faz por baixo.
 */
export function createLoopback(config: LoopbackConfig): Loopback {
  const rng = createRng(config.seed).fork('loopback');
  const latency = config.latencyMs ?? 0;
  const jitter = config.jitterMs ?? 0;
  const loss = config.loss ?? 0;
  const duplicate = config.duplicate ?? 0;
  const queues = new Map<number, InFlight[]>();
  const reliableAt = new Map<string, number>();
  const sentBy = new Map<number, number>();
  const stats: LoopbackStats = { sent: 0, dropped: 0, duplicated: 0, delivered: 0, bytes: 0, largest: 0 };
  let now = 0;
  let order = 0;

  const queueOf = (id: number): InFlight[] => {
    let q = queues.get(id);
    if (!q) {
      q = [];
      queues.set(id, q);
    }
    return q;
  };

  const enqueue = (from: number, to: number, channel: NetChannel, bytes: Uint8Array): void => {
    let at = now + latency + (jitter > 0 ? rng.range(0, jitter) : 0);
    if (channel === 'reliable') {
      const key = `${from}>${to}`;
      at = Math.max(at, reliableAt.get(key) ?? 0);
      reliableAt.set(key, at);
    }
    queueOf(to).push({ at, order: order++, from, channel, bytes: bytes.slice() });
  };

  const endpoints = new Map<number, NetEndpoint>();
  return {
    get now(): number {
      return now;
    },
    stats,
    bytesSentBy: (id) => sentBy.get(id) ?? 0,
    advance(ms: number): void {
      now += ms;
    },
    endpoint(id: number): NetEndpoint {
      let ep = endpoints.get(id);
      if (ep) return ep;
      ep = {
        id,
        send(to, channel, bytes): void {
          stats.sent++;
          stats.bytes += bytes.length;
          stats.largest = Math.max(stats.largest, bytes.length);
          sentBy.set(id, (sentBy.get(id) ?? 0) + bytes.length);
          if (channel === 'unreliable' && loss > 0 && rng.chance(loss)) {
            stats.dropped++;
            return;
          }
          enqueue(id, to, channel, bytes);
          if (channel === 'unreliable' && duplicate > 0 && rng.chance(duplicate)) {
            stats.duplicated++;
            enqueue(id, to, channel, bytes);
          }
        },
        poll(handler): void {
          const q = queueOf(id);
          if (q.length === 0) return;
          const ready = q.filter((m) => m.at <= now).sort((a, b) => a.at - b.at || a.order - b.order);
          if (ready.length === 0) return;
          queues.set(
            id,
            q.filter((m) => m.at > now),
          );
          for (const m of ready) {
            stats.delivered++;
            handler(m.from, m.channel, m.bytes);
          }
        },
      };
      endpoints.set(id, ep);
      return ep;
    },
  };
}
