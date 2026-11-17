import type { OnlineBundle } from '@boboforces/game';
import * as onlineScreens from '@boboforces/game/online';
import * as net from '@boboforces/net';
import type { LocalSignalChannel } from '@boboforces/net/rtc';
import { loadOnline, type RtcModule } from './online.ts';
import { createWebRooms } from './online-rooms.ts';

/**
 * O Online na web (M5 fase 4c): as telas (`@boboforces/game/online`), a sala e o núcleo do `net` vão no chunk da cena
 * (`scene.ts` reexporta); a rede de verdade (`@boboforces/net/rtc`: Trystero, sinalização e WebRTC) chega num chunk só
 * dela, que o `main.ts` pede junto ao abrir "Online", com o `net.json`. Nada disso entra no menu (≤ 350 KB).
 */
export interface WebOnlineOptions {
  /**
   * Sinalização entre abas do mesmo navegador (BroadcastChannel), sem relay nenhum: o teste das duas abas no Edge e
   * a depuração (`?sinal=local`). A conexão entre as abas continua sendo WebRTC de verdade.
   */
  readonly localSignal: boolean;
  readonly log: (line: string) => void;
}

function openLocalChannel(name: string): LocalSignalChannel {
  const bc = new BroadcastChannel(name);
  const channel: LocalSignalChannel = {
    postMessage: (message) => bc.postMessage(message),
    onmessage: null,
    close: () => bc.close(),
  };
  bc.onmessage = (event): void => channel.onmessage?.(event);
  return channel;
}

export async function loadWebOnline(rtc: RtcModule, options: WebOnlineOptions): Promise<OnlineBundle> {
  const load = await loadOnline(net, rtc);
  const { config } = load;
  options.log(
    `[online] rede pronta (${load.fromNetwork ? 'net.json' : 'cópia embutida'}, ${config.relays.length} relays` +
      `${load.clockOffsetMs !== null ? `, relógio ${Math.round(load.clockOffsetMs)} ms` : ''}` +
      `${options.localSignal ? ', sinalização local' : ''})`,
  );
  const joinRoom = options.localSignal ? rtc.createLocalJoinRoom(openLocalChannel) : rtc.joinNostrRoom;
  const iceServers: RTCIceServer[] = config.iceServers.map((s) => ({
    ...s,
    urls: typeof s.urls === 'string' ? s.urls : [...s.urls],
  }));
  const random = new Uint32Array(1);
  const rooms = createWebRooms({
    net,
    connect: (code) =>
      rtc.joinNetRoom({
        joinRoom,
        roomCode: code,
        relays: config.relays,
        iceServers: options.localSignal ? [] : iceServers,
        now: () => performance.now(),
        ...(options.localSignal ? { loopbackCandidates: true } : {}),
      }),
    now: () => performance.now(),
    random: () => {
      crypto.getRandomValues(random);
      return random[0]! / 0x1_0000_0000;
    },
    randomHex16: () => {
      const words = crypto.getRandomValues(new Uint32Array(2));
      return words[0]!.toString(16).padStart(8, '0') + words[1]!.toString(16).padStart(8, '0');
    },
    linkFor: (code) => `${location.origin}${location.pathname}${net.roomLinkHash(code)}`,
    copy: (text) =>
      navigator.clipboard
        ? navigator.clipboard.writeText(text).then(
            () => true,
            () => false,
          )
        : Promise.resolve(false),
    log: options.log,
  });
  return { module: onlineScreens, rooms };
}
