import type { OnlineClientLink, OnlineHostLink, OnlineSession } from '@boboforces/game';
import type { LobbyStart, NetEndpoint, NetWelcome } from '@boboforces/net';
import type { NetModule } from './online.ts';

/**
 * A partida online da cena (M5 fase 4b) montada com o `net`: o `game` só conhece a `OnlineSession`; aqui ela vira o
 * `NetHost` (no host) ou o `ClientDriver` (no cliente), no lado "partida" do repartidor da sala.
 */
export interface OnlineMatchSetup {
  readonly net: NetModule;
  readonly role: 'host' | 'client';
  /** O lado "partida" do repartidor (o lobby segue no outro). */
  readonly endpoint: NetEndpoint;
  /** O começo que o lobby fechou (a receita, a semente e o controlador de cada um). */
  readonly start: LobbyStart;
  /** O slot do lobby deste aparelho (0 = host). */
  readonly mySlot: number;
  /** Host: o peer de um slot do lobby. */
  readonly peerOfSlot: (slot: number) => number;
  /** Cliente: o peer do host e o welcome do lobby. */
  readonly hostPeer: number;
  readonly welcome: NetWelcome | null;
  readonly snapshotHz: number;
  /** A sala acabou (o host saiu, fui expulso). */
  readonly isClosed: () => boolean;
  /** Host: os slots que saíram desde a última chamada. */
  readonly takeLeftSlots: () => readonly number[];
  /** M5 (fase 4c): a cena ligou (`true`) ou soltou (`false`) a partida (a sala descarta o que sobrar da rede). */
  readonly onAttached?: (attached: boolean) => void;
}

export function createOnlineSession(setup: OnlineMatchSetup): OnlineSession {
  const { net, start } = setup;
  const me = start.members.find((m) => m.slot === setup.mySlot);
  if (!me) throw new Error(`online: o slot ${setup.mySlot} não está no começo`);
  const remote = start.members.filter((m) => m.slot !== setup.mySlot);
  const names: (string | undefined)[] = [];
  for (const m of start.members) names[m.controller] = m.name;
  return {
    role: setup.role,
    humans: start.members.length,
    localController: me.controller,
    remoteControllers: remote.map((m) => m.controller),
    names,
    get closed(): boolean {
      return setup.isClosed();
    },
    attachHost(sim): OnlineHostLink {
      setup.onAttached?.(true);
      const host = net.createNetHost({ sim, endpoint: setup.endpoint, snapshotHz: setup.snapshotHz });
      for (const m of remote) host.addClient(setup.peerOfSlot(m.slot), m.controller, true);
      return {
        receive: () => host.receive(),
        writeRemoteFrame: (controller, out) => host.writeRemoteFrame(controller, out),
        recordEvents: (events) => host.recordEvents(events),
        afterTicks: () => host.afterTicks(),
        takeLost(out): number {
          out.length = 0;
          for (const slot of setup.takeLeftSlots()) {
            const m = remote.find((r) => r.slot === slot);
            if (m) out.push(m.controller);
          }
          return out.length;
        },
        dispose: () => setup.onAttached?.(false),
      };
    },
    attachClient(sim, writeLocalFrame, onEvents): OnlineClientLink {
      setup.onAttached?.(true);
      const client = net.createClientDriver({
        sim,
        endpoint: setup.endpoint,
        host: setup.hostPeer,
        ...(setup.welcome ? { welcome: setup.welcome } : {}),
        writeLocalFrame,
        onEvents,
      });
      return {
        update: (s) => client.update(s),
        get alpha(): number {
          return client.alpha;
        },
        dispose: () => {
          client.dispose();
          setup.onAttached?.(false);
        },
      };
    },
  };
}
