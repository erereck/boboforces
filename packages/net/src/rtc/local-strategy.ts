import { createTopicStrategy, type JoinRoom, type StrategyMessage } from '@trystero-p2p/core';

/**
 * Um canal de mensagens entre abas da mesma origem (o `BroadcastChannel` do navegador). A casca web passa a fábrica:
 * o guard não deixa o global no `net` (regra 1).
 */
export interface LocalSignalChannel {
  postMessage(message: unknown): void;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  close(): void;
}

interface LocalRelay {
  readonly channel: LocalSignalChannel;
  readonly handlers: Map<string, (topic: string, message: StrategyMessage) => void>;
}

/**
 * Sinalização local do Trystero (M5 fase 3): as mesmas ofertas e respostas da Nostr, mas por um canal entre abas, sem
 * relay nenhum. Para o teste de verdade do WebRTC no Edge (duas abas, a mesma máquina) e para a depuração; o jogo
 * usa a Nostr (`joinNostrRoom`). A conexão entre os aparelhos é WebRTC de verdade nos dois casos.
 */
export function createLocalJoinRoom(open: (name: string) => LocalSignalChannel): JoinRoom {
  return createTopicStrategy<LocalRelay>({
    steadyAnnounceIntervalMs: 2000,
    init: () => {
      const relay: LocalRelay = { channel: open('boboforces-sinal'), handlers: new Map() };
      relay.channel.onmessage = (event): void => {
        const data = event.data as { topic?: unknown; message?: unknown } | null;
        if (!data || typeof data.topic !== 'string') return;
        const message = data.message;
        if (typeof message !== 'string' && (typeof message !== 'object' || message === null)) return;
        relay.handlers.get(data.topic)?.(data.topic, message as StrategyMessage);
      };
      return relay;
    },
    subscribeTopic: (relay, topic, onMessage) => {
      relay.handlers.set(topic, (t, m) => void onMessage(t, m));
      return () => {
        relay.handlers.delete(topic);
      };
    },
    publishTopic: (relay, topic, message) => {
      relay.channel.postMessage({ topic, message });
    },
  });
}
