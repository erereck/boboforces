// @boboforces/net: o online P2P (M5, só web; tecnico.md §13). Puro: sem DOM e sem relógio (quem chama passa o tempo
// do frame). Só `apps/web` importa (regra 4); o Switch nunca tem rede (#1).
export * from './protocol.ts';
export * from './schema.ts';
export * from './frame.ts';
export * from './snapshot.ts';
export * from './inputs.ts';
export * from './events.ts';
export * from './transport.ts';
export * from './host.ts';
export * from './client.ts';
export * from './room-code.ts';
export * from './mux.ts';
export * from './lobby.ts';
// Fase 3: a rede de verdade (Trystero + WebRTC). Só a casca web carrega, sob demanda (o chunk do Online).
export * from './net-config.ts';
export * from './rtc/room.ts';
export * from './rtc/local-strategy.ts';
export {
  joinRoom as joinNostrRoom,
  kickRelays,
  pauseRelayReconnection,
  relayHealth,
  resumeRelayReconnection,
  setClockOffset,
} from './rtc/nostr-strategy.ts';
