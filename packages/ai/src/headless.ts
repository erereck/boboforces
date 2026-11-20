import type { InputFrame } from '@boboforces/input';
import type { Disposable } from '@boboforces/shared';
import {
  createInputFrames,
  createOwnerScript,
  createSim,
  createSimLoop,
  type OwnerCommand,
  type OwnerScriptEntry,
  type Sim,
  type SimConfig,
  type SimEvent,
} from '@boboforces/sim';
import { createBotDirectorWithPaths, type BotDirectorWithStats } from './director.ts';
import { NAV_PATH_API, type NavPathApi } from './paths.ts';
import { botPrimaries } from './weapons.ts';

/**
 * Partida headless só com bots (teste golden, robô de balanceamento, bench): sim + IA + laço de 1 tick por chamada.
 * M2: sem `primaries`, os bots sorteiam a primária como no jogo (`botPrimaries`).
 * Os frames dos humanos (se houver) ficam neutros, a não ser que `writeHumans` os escreva. Zumbis (`zombies`) vão
 * para a sim e para o diretor juntos. M9 (fase 4): as Ferramentas do Dono (`owner`) também vão para os dois, e o
 * roteiro de comandos (`ownerScript`) entra na fila antes de cada tick.
 */
export interface HeadlessMatch extends Disposable {
  readonly sim: Sim;
  readonly director: BotDirectorWithStats;
  readonly frames: InputFrame[];
  /** Roda 1 tick: humanos → roteiro do dono → IA → `sim.step` → eventos para `onEvents` (válidos só durante a chamada). */
  step(): void;
  run(ticks: number): void;
  /** M9 (fase 4): um comando do dono (vale no próximo tick; `Sim.command`). */
  command(cmd: OwnerCommand): number;
}

export interface HeadlessMatchConfig extends SimConfig {
  readonly onEvents?: (events: readonly SimEvent[], sim: Sim) => void;
  /** Escreve os frames dos humanos (controladores 0..humans-1) antes da IA, a cada tick. */
  readonly writeHumans?: (frames: InputFrame[], sim: Sim) => void;
  /** Funções de caminho (padrão: o `@boboforces/nav`; testes e bench usam a navegação de teste da sim). */
  readonly paths?: NavPathApi;
  /** M9 (fase 4): o roteiro dos comandos do dono (`{ tick, cmd }`, o tick em que cada um entra na fila). */
  readonly ownerScript?: readonly OwnerScriptEntry[];
}

export function createHeadlessMatch(config: HeadlessMatchConfig): HeadlessMatch {
  // M2: a mesma primária sorteada do jogo (o `LocalDriver` faz igual); quem calibra uma arma passa `primaries`.
  const sim = createSim({
    ...config,
    primaries: config.primaries ?? botPrimaries(config.recipe, config.humans, config.owner?.reserve ?? 0),
  });
  const director = createBotDirectorWithPaths(
    {
      recipe: config.recipe,
      humans: config.humans,
      hz: sim.hz,
      ...(config.zombies !== undefined ? { zombies: config.zombies } : {}),
      ...(config.owner !== undefined ? { owner: config.owner } : {}),
    },
    config.paths ?? NAV_PATH_API,
  );
  const frames = createInputFrames();
  const { onEvents, writeHumans } = config;
  const script = config.ownerScript !== undefined ? createOwnerScript(config.ownerScript) : null;
  const loop = createSimLoop({
    sim,
    frames,
    beforeTick: (s, f) => {
      writeHumans?.(f, s);
      script?.feed(s);
      director.think(s.view(), f);
    },
    ...(onEvents ? { afterTick: (s: Sim, events: readonly SimEvent[]) => onEvents(events, s) } : {}),
  });
  return {
    sim,
    director,
    frames,
    step: loop.tick,
    run(ticks: number): void {
      for (let i = 0; i < ticks; i++) loop.tick();
    },
    command: (cmd) => sim.command(cmd),
    dispose(): void {
      director.dispose();
      sim.dispose();
    },
  };
}
