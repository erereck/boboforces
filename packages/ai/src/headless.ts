import type { InputFrame } from '@boboforces/input';
import type { Disposable } from '@boboforces/shared';
import { createInputFrames, createSim, createSimLoop, type Sim, type SimConfig, type SimEvent } from '@boboforces/sim';
import { createBotDirector, type BotDirector } from './director.ts';

/**
 * Partida headless só com bots (teste golden, robô de balanceamento, bench): sim + IA + laço de 1 tick por chamada.
 * Os frames dos humanos (se houver) ficam neutros.
 */
export interface HeadlessMatch extends Disposable {
  readonly sim: Sim;
  readonly director: BotDirector;
  readonly frames: InputFrame[];
  /** Roda 1 tick: IA → `sim.step` → eventos para `onEvents` (válidos só durante a chamada). */
  step(): void;
  run(ticks: number): void;
}

export interface HeadlessMatchConfig extends SimConfig {
  readonly onEvents?: (events: readonly SimEvent[], sim: Sim) => void;
}

export function createHeadlessMatch(config: HeadlessMatchConfig): HeadlessMatch {
  const sim = createSim(config);
  const director = createBotDirector({ recipe: config.recipe, humans: config.humans, hz: sim.hz });
  const frames = createInputFrames();
  const onEvents = config.onEvents;
  const loop = createSimLoop({
    sim,
    frames,
    beforeTick: (s, f) => director.think(s.view(), f),
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
