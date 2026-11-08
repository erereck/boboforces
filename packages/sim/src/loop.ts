import { createInputFrame, type InputFrame } from '@boboforces/input';
import { MAX_CONTROLLERS_WITH_ZOMBIES } from './constants.ts';
import type { SimEvent } from './events.ts';
import { FixedStep } from './fixed-step.ts';
import type { Sim } from './sim.ts';

/**
 * Um InputFrame por controlador possível (0..3 humanos, 4..67 bots, 68..131 zumbis do estresse), reaproveitados a cada
 * tick. Cobre os zumbis sempre, para quem cria a partida com `zombies` não precisar dimensionar nada.
 */
export function createInputFrames(count: number = MAX_CONTROLLERS_WITH_ZOMBIES): InputFrame[] {
  return Array.from({ length: count }, createInputFrame);
}

export interface SimLoopOptions {
  readonly sim: Sim;
  /** Frames de entrada (use `createInputFrames()`); quem escreve são os mapeadores humanos e a IA. */
  readonly frames: InputFrame[];
  /** Antes de cada tick: preencher os frames (mapeador de cada humano, `bots.think(view, frames)`). */
  readonly beforeTick?: (sim: Sim, frames: InputFrame[]) => void;
  /** Depois de cada tick, com os eventos dele (válidos só durante a chamada). */
  readonly afterTick?: (sim: Sim, events: readonly SimEvent[]) => void;
  /** Ticks por segundo (padrão: o da sim, `sim.hz`). */
  readonly hz?: number;
}

/**
 * Helper do laço de passo fixo (tecnico.md §4.2): `frame(segundosDoFrame)` acumula o tempo real, roda de 0 a 4 ticks
 * (frame limitado a 0,1 s, ver `FixedStep`) e expõe `alpha` para o render interpolar `prev*` → atual. Não sabe de
 * relógio: quem mede o frame é o driver (game) com `platform.now()`.
 */
export interface SimLoop {
  readonly fixedStep: FixedStep;
  /** Fração [0, 1) entre o último tick e o próximo. */
  readonly alpha: number;
  /** Avança o tempo real do frame; devolve quantos ticks rodou. */
  frame(frameSeconds: number): number;
  /** Roda exatamente 1 tick (headless, testes, robô de balanceamento). */
  tick(): void;
}

export function createSimLoop(options: SimLoopOptions): SimLoop {
  const { sim, frames, beforeTick, afterTick } = options;
  const fixedStep = new FixedStep(options.hz ?? sim.hz);
  const events: SimEvent[] = [];
  const tick = (): void => {
    beforeTick?.(sim, frames);
    sim.step(frames);
    events.length = 0;
    sim.drainEvents(events);
    afterTick?.(sim, events);
    events.length = 0;
  };
  return {
    fixedStep,
    get alpha(): number {
      return fixedStep.alpha;
    },
    frame(frameSeconds: number): number {
      const steps = fixedStep.advance(frameSeconds);
      for (let i = 0; i < steps; i++) tick();
      return steps;
    },
    tick,
  };
}
