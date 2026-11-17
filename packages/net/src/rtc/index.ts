// @boboforces/net/rtc: a rede de verdade (M5 fase 3): o Trystero, a sinalização (Nostr ou local) e a sala WebRTC. Fica
// num subcaminho à parte do núcleo puro (`@boboforces/net`): a casca web pede este pedaço por `import()` só quando o
// jogador abre "Online" (o núcleo, que precisa da `sim`, vai com o pedaço da cena; M5 fase 4c). Só `apps/web` importa.
export * from './room.ts';
export * from './local-strategy.ts';
export {
  joinRoom as joinNostrRoom,
  kickRelays,
  pauseRelayReconnection,
  relayHealth,
  resumeRelayReconnection,
  setClockOffset,
} from './nostr-strategy.ts';
