import type { BotDirectorWithStats } from '@boboforces/ai';
import type { Sim } from '@boboforces/sim';
import { createLocalDriver, createMatchSim, type LocalDriverConfig, type MatchDriver } from '../local-driver.ts';
import type { OnlineHostLink, OnlineSession } from '../online-api.ts';

/**
 * O que conduz a partida da cena (M5 fase 4b): o `LocalDriver` de sempre (solo e sofá), ele mesmo com os amigos
 * (host online) ou o cliente online, que só mostra a sim do host e não tem diretor de bots. A cena fala só com isto.
 */
export interface SceneDriver extends MatchDriver {
  readonly sim: Sim;
  /** `null` no cliente online (os bots rodam no host). */
  readonly director: BotDirectorWithStats | null;
  readonly lastAiMs: number;
  readonly lastSimMs: number;
  setHumanControlled(controller: number, on: boolean): void;
  /** Online: a sala acabou (a cena volta ao menu). */
  readonly closed: boolean;
  /** Online: a sim não pausa (os amigos seguem jogando). */
  readonly online: boolean;
}

export function createSceneDriver(config: LocalDriverConfig, online: OnlineSession | null = null): SceneDriver {
  if (online === null) {
    const d = createLocalDriver(config);
    return {
      sim: d.sim,
      director: d.director,
      online: false,
      closed: false,
      get alpha(): number {
        return d.alpha;
      },
      get lastAiMs(): number {
        return d.lastAiMs;
      },
      get lastSimMs(): number {
        return d.lastSimMs;
      },
      setHumanControlled: (c, on) => d.setHumanControlled(c, on),
      update: (s) => d.update(s),
      dispose: () => d.dispose(),
    };
  }
  if (online.role === 'client') {
    const sim = createMatchSim(config);
    const link = online.attachClient(
      sim,
      (out, seq) => config.writeHumanFrame(online.localController, out, seq),
      (events, s) => config.onEvents?.(events, s),
    );
    return {
      sim,
      director: null,
      online: true,
      get closed(): boolean {
        return online.closed;
      },
      get alpha(): number {
        return link.alpha;
      },
      lastAiMs: 0,
      lastSimMs: 0,
      setHumanControlled: () => undefined,
      update: (s) => (online.closed ? 0 : link.update(s)),
      // O link solta a sim junto (ela é dele).
      dispose: () => link.dispose(),
    };
  }
  // Host: a partida de sempre; as entradas dos amigos vêm da rede e quem sai vira bot (o cérebro de reserva do sofá).
  const remote = new Set(online.remoteControllers);
  let link: OnlineHostLink | null = null;
  const d = createLocalDriver({
    ...config,
    standby: [...new Set([...(config.standby ?? []), ...online.remoteControllers])],
    writeHumanFrame: (slot, out, seq) => {
      if (remote.has(slot)) {
        link?.writeRemoteFrame(slot, out);
        return;
      }
      config.writeHumanFrame(slot, out, seq);
    },
    onEvents: (events, s) => {
      link?.recordEvents(events);
      config.onEvents?.(events, s);
    },
  });
  link = online.attachHost(d.sim);
  const lost: number[] = [];
  return {
    sim: d.sim,
    director: d.director,
    online: true,
    get closed(): boolean {
      return online.closed;
    },
    get alpha(): number {
      return d.alpha;
    },
    get lastAiMs(): number {
      return d.lastAiMs;
    },
    get lastSimMs(): number {
      return d.lastSimMs;
    },
    setHumanControlled: (c, on) => d.setHumanControlled(c, on),
    update(s): number {
      const l = link!;
      l.receive();
      const n = l.takeLost(lost);
      for (let i = 0; i < n; i++) {
        remote.delete(lost[i]!);
        d.setHumanControlled(lost[i]!, false);
      }
      const ticks = d.update(s);
      if (ticks > 0) l.afterTicks();
      return ticks;
    },
    dispose(): void {
      link?.dispose();
      d.dispose();
    },
  };
}
