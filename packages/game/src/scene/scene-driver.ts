import type { BotDirectorWithStats } from '@boboforces/ai';
import type { Sim } from '@boboforces/sim';
import { createLocalDriver, createMatchSim, type LocalDriverConfig, type MatchDriver } from '../local-driver.ts';
import {
  HOST_AWAY_END_S,
  ONLINE_CONTROL,
  waitsForHost,
  type OnlineHostLink,
  type OnlineSession,
} from '../online-api.ts';

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
  /** M5 (fase 5a): o cliente online: há quantos segundos o host está ausente (0 = presente, e sempre 0 fora dele). */
  readonly hostAbsentS: number;
  /** M5 (fase 5a): a ausência veio do aviso do host (só aí o PvP acaba em 10 s). */
  readonly hostAwayNotified: boolean;
  /**
   * M5 (fase 5a): a aba sumiu (`true`) ou voltou, com o relógio da plataforma em ms. O host online avisa os amigos e,
   * num PvP, volta de mais de `HOST_AWAY_END_S` encerrando a partida. Fora do host online, nada.
   */
  setHidden(hidden: boolean, nowMs: number): void;
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
      hostAbsentS: 0,
      hostAwayNotified: false,
      setHidden: () => undefined,
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
      get hostAbsentS(): number {
        return link.hostAbsentS;
      },
      get hostAwayNotified(): boolean {
        return link.hostAwayNotified;
      },
      setHidden: () => undefined,
      setHumanControlled: () => undefined,
      update: (s) => (online.closed ? 0 : link.update(s)),
      // O link solta a sim junto (ela é dele).
      dispose: () => link.dispose(),
    };
  }
  // Host: a partida de sempre; as entradas dos amigos vêm da rede e quem sai vira bot (o cérebro de reserva do sofá).
  const remote = new Set(online.remoteControllers);
  /** M5 (fase 5a): amigos AFK (um bot no lugar): a entrada deles não é lida (o bot escreve o frame). */
  const away = new Set<number>();
  let link: OnlineHostLink | null = null;
  const d = createLocalDriver({
    ...config,
    standby: [...new Set([...(config.standby ?? []), ...online.remoteControllers])],
    writeHumanFrame: (slot, out, seq) => {
      if (remote.has(slot)) {
        if (!away.has(slot)) link?.writeRemoteFrame(slot, out);
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
  const control: number[] = [];
  /** Quando a aba do host sumiu (ms da plataforma; -1 = à vista). */
  let hiddenAt = -1;
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
    hostAbsentS: 0,
    hostAwayNotified: false,
    setHidden(hidden, nowMs): void {
      if (hidden === hiddenAt >= 0) return;
      link!.setAway(hidden);
      if (hidden) {
        hiddenAt = nowMs;
        return;
      }
      // Num PvP, quem esperou mais de 10 s já viu o resultado: a partida do host acaba com o placar de quando ele saiu.
      if (!waitsForHost(config.recipe.mode) && nowMs - hiddenAt >= HOST_AWAY_END_S * 1000) d.sim.finish();
      hiddenAt = -1;
    },
    update(s): number {
      const l = link!;
      l.receive();
      const n = l.takeLost(lost);
      for (let i = 0; i < n; i++) {
        remote.delete(lost[i]!);
        d.setHumanControlled(lost[i]!, false);
      }
      // M5 (fase 5a): AFK (60 s sem entrada) passa ao bot; a primeira entrada de verdade devolve.
      const k = l.takeControl(control);
      for (let i = 0; i < k; i++) {
        const c = control[i]! >> 2;
        const kind = control[i]! & 3;
        // M5 (fase 5b): só quem caiu e voltou é da rede de novo (um "voltou do AFK" de quem já saiu não conta).
        if (kind === ONLINE_CONTROL.rejoined) remote.add(c);
        if (!remote.has(c)) continue;
        if (kind === ONLINE_CONTROL.away) {
          away.add(c);
          // O tiro do bot não volta no tempo pelo que o amigo via (fase 2d).
          d.sim.rewind.set(c, 0);
          d.setHumanControlled(c, false);
        } else {
          away.delete(c);
          d.setHumanControlled(c, true);
        }
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
