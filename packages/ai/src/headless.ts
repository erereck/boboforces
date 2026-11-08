import type { InputFrame } from '@boboforces/input';
import type { Disposable } from '@boboforces/shared';
import { createInputFrames, createSim, createSimLoop, type Sim, type SimConfig, type SimEvent } from '@boboforces/sim';
import { createBotDirectorWithPaths, type BotDirectorWithStats } from './director.ts';
import { NAV_PATH_API, type NavPathApi } from './paths.ts';

/**
 * Partida headless só com bots (teste golden, robô de balanceamento, bench): sim + IA + laço de 1 tick por chamada.
 * Os frames dos humanos (se houver) ficam neutros, a não ser que `writeHumans` os escreva. Zumbis (`zombies`) vão
 * para a sim e para o diretor juntos.
 */
export interface HeadlessMatch extends Disposable {
  readonly sim: Sim;
  readonly director: BotDirectorWithStats;
  readonly frames: InputFrame[];
  /** Roda 1 tick: humanos → IA → `sim.step` → eventos para `onEvents` (válidos só durante a chamada). */
  step(): void;
  run(ticks: number): void;
}

export interface HeadlessMatchConfig extends SimConfig {
  readonly onEvents?: (events: readonly SimEvent[], sim: Sim) => void;
  /** Escreve os frames dos humanos (controladores 0..humans-1) antes da IA, a cada tick. */
  readonly writeHumans?: (frames: InputFrame[], sim: Sim) => void;
  /** Funções de caminho (padrão: o `@boboforces/nav`; testes e bench usam a navegação de teste da sim). */
  readonly paths?: NavPathApi;
}

export function createHeadlessMatch(config: HeadlessMatchConfig): HeadlessMatch {
  const sim = createSim(config);
  const director = createBotDirectorWithPaths(
    {
      recipe: config.recipe,
      humans: config.humans,
      hz: sim.hz,
      ...(config.zombies !== undefined ? { zombies: config.zombies } : {}),
    },
    config.paths ?? NAV_PATH_API,
  );
  const frames = createInputFrames();
  const { onEvents, writeHumans } = config;
  const loop = createSimLoop({
    sim,
    frames,
    beforeTick: (s, f) => {
      writeHumans?.(f, s);
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
    dispose(): void {
      director.dispose();
      sim.dispose();
    },
  };
}
