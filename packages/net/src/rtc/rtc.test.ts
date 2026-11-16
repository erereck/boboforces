import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DataPayload, JoinRoom, MessageContext, Room } from '@trystero-p2p/core';
import { describe, expect, it } from 'vitest';
import { clockOffsetFromDate, DEFAULT_NET_CONFIG, parseNetConfig } from '../net-config.ts';
import { passesReplayGate, settleOverdueGates, type ReplayGate } from './nostr-strategy.ts';
import { joinNetRoom, UNRELIABLE_CHANNEL, UNRELIABLE_TIMEOUT_MS } from './room.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

describe('configuração da rede (M5 fase 3)', () => {
  it('a embutida é igual ao net.json publicado', () => {
    const published: unknown = JSON.parse(readFileSync(join(ROOT, 'apps', 'web', 'public', 'net.json'), 'utf8'));
    expect(published).toEqual(DEFAULT_NET_CONFIG);
    expect(parseNetConfig(published)).toEqual(DEFAULT_NET_CONFIG);
  });

  it('campo estragado volta ao padrão; só wss:// e stun/turn', () => {
    expect(parseNetConfig(null)).toBe(DEFAULT_NET_CONFIG);
    expect(parseNetConfig({ version: 2 })).toBe(DEFAULT_NET_CONFIG);
    const c = parseNetConfig({
      version: 1,
      protocolVersion: 3,
      relays: ['ws://inseguro', 'wss://bom.example', 42],
      iceServers: [{ urls: 'http://x' }, { urls: ['turn:t.example:3478'], username: 'u', credential: 'c' }],
    });
    expect(c).toEqual({
      version: 1,
      protocolVersion: 3,
      relays: ['wss://bom.example'],
      iceServers: [{ urls: ['turn:t.example:3478'], username: 'u', credential: 'c' }],
    });
    expect(parseNetConfig({ version: 1, relays: [], iceServers: 'x' }).relays).toBe(DEFAULT_NET_CONFIG.relays);
  });

  it('o desvio do relógio vem do cabeçalho Date (menos de 1,5 s não conta)', () => {
    const server = Date.UTC(2026, 10, 16, 12, 0, 0);
    const header = new Date(server).toUTCString();
    expect(clockOffsetFromDate(header, server + 20_000)).toBe(20_000);
    expect(clockOffsetFromDate(header, server - 30_000)).toBe(-30_000);
    expect(clockOffsetFromDate(header, server + 900)).toBe(0);
    expect(clockOffsetFromDate(null, server)).toBeNull();
    expect(clockOffsetFromDate('ontem', server)).toBeNull();
  });
});

describe('a estratégia Nostr do FutBobo (o portão antes do EOSE)', () => {
  it('antes do EOSE só passa o que é mais novo que o pedido − 10 s; o vigia abre o portão vencido', () => {
    const gate: ReplayGate = { subscribedAtSec: 1000, requestedAtMs: 0, pendingEose: 1, overdueSeen: false };
    expect(passesReplayGate(995, gate)).toBe(true);
    expect(passesReplayGate(980, gate)).toBe(false);
    expect(passesReplayGate('x', gate)).toBe(false);
    expect(passesReplayGate(1, undefined)).toBe(true);
    // Passo atrasado só marca; o passo seguinte em dia abre.
    settleOverdueGates([gate], 6000, true);
    expect(gate.pendingEose).toBe(1);
    settleOverdueGates([gate], 6100, true);
    expect(gate.pendingEose).toBe(0);
    expect(passesReplayGate(1, gate)).toBe(true);
  });
});

/** Um canal de dados de mentira (o `RTCDataChannel` negociado). */
class FakeChannel {
  readyState: RTCDataChannelState = 'connecting';
  bufferedAmount = 0;
  binaryType = 'blob';
  readonly sent: Uint8Array[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  readonly init: RTCDataChannelInit;
  constructor(init: RTCDataChannelInit) {
    this.init = init;
  }
  send(data: Uint8Array): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 'closed';
  }
  open(): void {
    this.readyState = 'open';
    this.onopen?.();
  }
}

/** Um Trystero de mentira: a sala com a action `bf` e uma conexão por amigo. */
function fakeTrystero(): {
  joinRoom: JoinRoom;
  room: Room;
  channels: Map<string, FakeChannel>;
  sent: { data: DataPayload; target: string }[];
  deliver: (peerId: string, data: DataPayload) => void;
} {
  const channels = new Map<string, FakeChannel>();
  const sent: { data: DataPayload; target: string }[] = [];
  let onMessage: ((data: DataPayload, ctx: MessageContext) => void) | null = null;
  const room = {
    makeAction: () => ({
      send: (data: DataPayload, options?: { readonly target?: unknown }) => {
        sent.push({ data, target: String(options?.target) });
        return Promise.resolve();
      },
      set onMessage(fn: ((data: DataPayload, ctx: MessageContext) => void) | null) {
        onMessage = fn;
      },
      get onMessage() {
        return onMessage;
      },
      onReceiveProgress: null,
      onReceive: null,
    }),
    getPeers: () =>
      Object.fromEntries(
        ['a', 'b'].map((id) => [
          id,
          {
            createDataChannel: (_label: string, init: RTCDataChannelInit) => {
              const ch = new FakeChannel(init);
              channels.set(id, ch);
              return ch;
            },
          },
        ]),
      ),
    leave: () => Promise.resolve(),
    onPeerJoin: null,
    onPeerLeave: null,
  } as unknown as Room;
  return {
    joinRoom: (() => room) as unknown as JoinRoom,
    room,
    channels,
    sent,
    deliver: (peerId, data) => onMessage?.(data, { peerId }),
  };
}

describe('a sala sobre o Trystero (M5 fase 3)', () => {
  it('numera os amigos, manda nos dois canais e cai no confiável quando o outro não abre', () => {
    const t = fakeTrystero();
    let clock = 0;
    const net = joinNetRoom({ joinRoom: t.joinRoom, roomCode: 'ABCDE', now: () => clock });
    const joined: number[] = [];
    net.onPeerJoin = (id) => joined.push(id);
    t.room.onPeerJoin!('a');
    t.room.onPeerJoin!('b');
    expect(joined).toEqual([1, 2]);
    // O canal não confiável é o negociado, sem ordem e sem reenvio.
    expect(t.channels.get('a')!.init).toEqual({
      negotiated: true,
      id: UNRELIABLE_CHANNEL.id,
      ordered: false,
      maxRetransmits: 0,
    });
    const buf = Uint8Array.of(1, 2, 3);
    // Confiável: pela action, para o amigo certo, uma cópia.
    net.endpoint.send(2, 'reliable', buf);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]!.target).toBe('b');
    expect(t.sent[0]!.data).not.toBe(buf);
    // Não confiável ainda abrindo: perde (é o canal que perde).
    net.endpoint.send(1, 'unreliable', buf);
    expect(net.stats.dropped).toBe(1);
    // Aberto: vai por ele.
    t.channels.get('a')!.open();
    net.endpoint.send(1, 'unreliable', buf);
    expect(t.channels.get('a')!.sent).toHaveLength(1);
    // O de 'b' nunca abre: passado o prazo, vai pelo confiável.
    clock = UNRELIABLE_TIMEOUT_MS + 1;
    net.update();
    expect(net.peers.map((p) => p.unreliable)).toEqual(['open', 'fallback']);
    net.endpoint.send(2, 'unreliable', buf);
    expect(net.stats.fallbackSent).toBe(1);
    expect(t.sent).toHaveLength(2);
    // Chegando: dos dois canais, com o número local de quem mandou.
    t.deliver('b', Uint8Array.of(9).buffer);
    t.channels.get('a')!.onmessage!({ data: Uint8Array.of(7).buffer });
    const got: string[] = [];
    net.endpoint.poll((from, channel, bytes) => got.push(`${from}:${channel}:${bytes[0]}`));
    expect(got).toEqual(['2:reliable:9', '1:unreliable:7']);
    // Quem sai some (e mandar para ele descarta).
    const left: number[] = [];
    net.onPeerLeave = (id) => left.push(id);
    t.room.onPeerLeave!('a');
    expect(left).toEqual([1]);
    net.endpoint.send(1, 'reliable', buf);
    expect(net.stats.dropped).toBe(2);
  });
});
