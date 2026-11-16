import { selfId, type DataPayload, type JoinRoom, type MessageAction, type Room } from '@trystero-p2p/core';
import type { NetChannel } from '../protocol.ts';
import type { NetEndpoint } from '../transport.ts';

/**
 * A sala de verdade (M5 fase 3, tecnico.md §13.2): o `NetEndpoint` sobre o Trystero. A sinalização é a estratégia
 * dada (`joinRoom`: a Nostr do jogo ou a local dos testes). Os dois canais por amigo:
 * - **confiável e ordenado:** uma action do Trystero (o canal de dados dele), para o handshake, os eventos e o lobby;
 * - **não confiável:** um `RTCDataChannel` negociado nos dois lados com o mesmo id (sem sinalização nova), sem ordem e
 *   sem reenvio, para as entradas e os snapshots. Se ele não abrir em `UNRELIABLE_TIMEOUT_MS`, tudo vai pelo confiável
 *   (o reserva do §13.2).
 * Os amigos ganham números locais na ordem em que entram (1, 2, 3…); este aparelho é o 0.
 */

/** O canal não confiável (o mesmo id nos dois lados; longe dos que o Trystero numera sozinho a partir de 0). */
export const UNRELIABLE_CHANNEL = { label: 'bf-u', id: 300 } as const;
/** Sem abrir neste tempo, o não confiável vai pelo canal do Trystero. */
export const UNRELIABLE_TIMEOUT_MS = 4000;
/** Mais que isto esperando para sair no canal não confiável: descarta (mandar atrasado não serve). */
const MAX_UNRELIABLE_BUFFER = 64 * 1024;
/** O `appId` do Trystero: o mesmo em toda versão (versões diferentes se acham e o handshake manda atualizar). */
export const NET_APP_ID = 'boboforces';

export interface NetRoomConfig {
  /** A estratégia de sinalização (`joinNostrRoom` do jogo; a local nos testes). */
  readonly joinRoom: JoinRoom;
  /** O código da sala (5 caracteres): o nome e a senha da sala (o SDP vai cifrado com ele). */
  readonly roomCode: string;
  readonly appId?: string;
  /** Relays Nostr fixos (`net.json`); ausente = os padrões da estratégia. */
  readonly relays?: readonly string[];
  readonly redundancy?: number;
  readonly iceServers?: readonly RTCIceServer[];
  /** Relógio em ms (o canal não confiável tem prazo para abrir). */
  readonly now: () => number;
  /** Só testes no mesmo aparelho: candidatos mDNS viram 127.0.0.1. */
  readonly loopbackCandidates?: boolean;
}

export type UnreliableState = 'opening' | 'open' | 'fallback' | 'closed';

export interface NetRoomPeer {
  /** O número local deste amigo (o `from`/`to` do `NetEndpoint`). */
  readonly id: number;
  readonly peerId: string;
  readonly unreliable: UnreliableState;
}

export interface NetRoomStats {
  reliableSent: number;
  unreliableSent: number;
  /** Mensagens do canal não confiável que foram pelo confiável (canal fechado ou sem abrir). */
  fallbackSent: number;
  /** Descartadas: amigo que saiu, fila do não confiável cheia ou erro ao mandar. */
  dropped: number;
  received: number;
}

export interface NetRoom {
  readonly endpoint: NetEndpoint;
  readonly selfPeerId: string;
  readonly peers: readonly NetRoomPeer[];
  readonly stats: NetRoomStats;
  onPeerJoin: ((id: number) => void) | null;
  onPeerLeave: ((id: number) => void) | null;
  /** A cada frame: o prazo do canal não confiável. */
  update(): void;
  leave(): Promise<void>;
}

interface PeerState {
  readonly id: number;
  readonly peerId: string;
  unreliable: UnreliableState;
  channel: RTCDataChannel | null;
  readonly joinedAt: number;
}

interface Inbound {
  readonly from: number;
  readonly channel: NetChannel;
  readonly bytes: Uint8Array;
}

function toBytes(data: DataPayload): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

export function joinNetRoom(config: NetRoomConfig): NetRoom {
  const { now } = config;
  const room: Room = config.joinRoom(
    {
      appId: config.appId ?? NET_APP_ID,
      password: config.roomCode,
      ...(config.iceServers ? { rtcConfig: { iceServers: [...config.iceServers] } } : {}),
      ...(config.relays || config.redundancy !== undefined
        ? {
            relayConfig: {
              ...(config.relays ? { urls: [...config.relays] } : {}),
              ...(config.redundancy !== undefined ? { redundancy: config.redundancy } : {}),
            },
          }
        : {}),
      ...(config.loopbackCandidates ? { _test_only_mdnsHostFallbackToLoopback: true } : {}),
    },
    config.roomCode,
  );
  const reliable: MessageAction<DataPayload> = room.makeAction<DataPayload>('bf');
  const peers: PeerState[] = [];
  const inbound: Inbound[] = [];
  const stats: NetRoomStats = { reliableSent: 0, unreliableSent: 0, fallbackSent: 0, dropped: 0, received: 0 };
  let nextId = 1;
  let left = false;

  const byPeerId = (peerId: string): PeerState | null => {
    for (const p of peers) if (p.peerId === peerId) return p;
    return null;
  };
  const byId = (id: number): PeerState | null => {
    for (const p of peers) if (p.id === id) return p;
    return null;
  };

  reliable.onMessage = (data, context) => {
    const p = byPeerId(context.peerId);
    const bytes = toBytes(data);
    if (p === null || bytes === null) return;
    stats.received++;
    inbound.push({ from: p.id, channel: 'reliable', bytes });
  };

  const openUnreliable = (p: PeerState): void => {
    const pc = room.getPeers()[p.peerId];
    if (!pc) {
      p.unreliable = 'fallback';
      return;
    }
    try {
      const ch = pc.createDataChannel(UNRELIABLE_CHANNEL.label, {
        negotiated: true,
        id: UNRELIABLE_CHANNEL.id,
        ordered: false,
        maxRetransmits: 0,
      });
      ch.binaryType = 'arraybuffer';
      ch.onopen = (): void => {
        if (p.unreliable !== 'closed') p.unreliable = 'open';
      };
      ch.onclose = (): void => {
        if (p.unreliable !== 'closed') p.unreliable = 'fallback';
      };
      ch.onmessage = (ev: MessageEvent): void => {
        const bytes = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : null;
        if (bytes === null) return;
        stats.received++;
        inbound.push({ from: p.id, channel: 'unreliable', bytes });
      };
      p.channel = ch;
    } catch {
      p.unreliable = 'fallback';
    }
  };

  const net: NetRoom = {
    selfPeerId: selfId,
    stats,
    get peers(): readonly NetRoomPeer[] {
      return peers;
    },
    onPeerJoin: null,
    onPeerLeave: null,
    endpoint: {
      id: 0,
      send(to, channel, bytes): void {
        const p = byId(to);
        if (p === null || left) {
          stats.dropped++;
          return;
        }
        if (channel === 'unreliable' && p.unreliable !== 'fallback') {
          const ch = p.channel;
          if (ch === null || ch.readyState !== 'open') {
            // Ainda abrindo: o pacote perde (é o canal que perde); passado o prazo, vira o reserva.
            stats.dropped++;
            return;
          }
          if (ch.bufferedAmount > MAX_UNRELIABLE_BUFFER) {
            stats.dropped++;
            return;
          }
          try {
            ch.send(bytes.slice());
            stats.unreliableSent++;
          } catch {
            stats.dropped++;
          }
          return;
        }
        if (channel === 'unreliable') stats.fallbackSent++;
        else stats.reliableSent++;
        // O Trystero manda depois (promessa): vai uma cópia, quem chama reaproveita o buffer.
        reliable.send(bytes.slice(), { target: p.peerId }).catch(() => {
          stats.dropped++;
        });
      },
      poll(handler): void {
        if (inbound.length === 0) return;
        // Os que chegarem durante o handler esperam o próximo poll.
        const n = inbound.length;
        for (let i = 0; i < n; i++) {
          const m = inbound[i]!;
          handler(m.from, m.channel, m.bytes);
        }
        inbound.splice(0, n);
      },
    },
    update(): void {
      const t = now();
      for (const p of peers) {
        if (p.unreliable === 'opening' && t - p.joinedAt > UNRELIABLE_TIMEOUT_MS) p.unreliable = 'fallback';
      }
    },
    async leave(): Promise<void> {
      if (left) return;
      left = true;
      for (const p of peers) {
        p.unreliable = 'closed';
        p.channel?.close();
      }
      await room.leave();
    },
  };

  room.onPeerJoin = (peerId) => {
    if (left || byPeerId(peerId) !== null) return;
    const p: PeerState = { id: nextId++, peerId, unreliable: 'opening', channel: null, joinedAt: now() };
    peers.push(p);
    openUnreliable(p);
    net.onPeerJoin?.(p.id);
  };
  room.onPeerLeave = (peerId) => {
    const p = byPeerId(peerId);
    if (p === null) return;
    p.unreliable = 'closed';
    p.channel?.close();
    peers.splice(peers.indexOf(p), 1);
    net.onPeerLeave?.(p.id);
  };
  return net;
}
