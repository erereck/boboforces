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
export * from './net-config.ts';
// Fase 3: a rede de verdade (Trystero + WebRTC) fica no subcaminho `@boboforces/net/rtc` (M5 fase 4c): o núcleo vai
// com o pedaço da cena e o Trystero num pedaço só dele, pedido ao abrir "Online".
