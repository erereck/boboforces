import type { NetChannel } from './protocol.ts';
import type { NetEndpoint } from './transport.ts';

/**
 * Reparte um `NetEndpoint` em dois pelo tipo da mensagem (o 1º byte): o lobby e a partida usam o mesmo canal sem um
 * `poll` roubar a mensagem do outro. O que é do outro fica guardado (cópia: os bytes do transporte só valem na
 * chamada) até o `poll` dele.
 */
export function createEndpointMux(
  endpoint: NetEndpoint,
  isFirst: (type: number) => boolean,
): readonly [NetEndpoint, NetEndpoint] {
  type Held = { from: number; channel: NetChannel; bytes: Uint8Array };
  const held: [Held[], Held[]] = [[], []];

  const make = (side: 0 | 1): NetEndpoint => ({
    id: endpoint.id,
    send: (to, channel, bytes) => endpoint.send(to, channel, bytes),
    poll(handler): void {
      const mine = held[side];
      if (mine.length > 0) {
        const n = mine.length;
        for (let i = 0; i < n; i++) handler(mine[i]!.from, mine[i]!.channel, mine[i]!.bytes);
        mine.splice(0, n);
      }
      endpoint.poll((from, channel, bytes) => {
        const target = bytes.length > 0 && isFirst(bytes[0]!) ? 0 : 1;
        if (target === side) handler(from, channel, bytes);
        else held[target].push({ from, channel, bytes: bytes.slice() });
      });
    },
  });
  return [make(0), make(1)];
}
