import { createBotDirector, type BotDirector } from '@boboforces/ai';
import type { MatchRecipe } from '@boboforces/format';
import type { InputFrame } from '@boboforces/input';
import type { Disposable } from '@boboforces/shared';
import {
  createInputFrames,
  createSim,
  createSimLoop,
  type Sim,
  type SimEvent,
  type SimLoop,
  type SimMap,
} from '@boboforces/sim';

/**
 * Quem conduz uma partida (tecnico.md §13.1). O `game` só conhece esta interface: `LocalDriver` (1 a 4 locais) fica
 * aqui; `HostDriver` e `ClientDriver` ficam em `net` (M5, só web).
 */
export interface MatchDriver extends Disposable {
  /** Avança o tempo real do frame (acumulador do passo fixo dentro). Devolve quantos ticks rodaram. */
  update(frameSeconds: number): number;
  /** Fração para interpolar o render (`prev*` → atual). */
  readonly alpha: number;
}

export interface LocalDriverConfig {
  /** Receita já validada (`validateMatchRecipe`). */
  readonly recipe: MatchRecipe;
  readonly map: SimMap;
  /** Humanos locais nos controladores 0..humans-1. */
  readonly humans: number;
  /** Preenche o InputFrame do humano `slot` antes de cada tick (o mapeador do slot faz isso). */
  readonly writeHumanFrame: (slot: number, out: InputFrame, seq: number) => void;
  /** Eventos de cada tick. Objetos de pool da sim: valem só durante a chamada. */
  readonly onEvents?: (events: readonly SimEvent[], sim: Sim) => void;
  /** Ticks por segundo (padrão `SIM_HZ`; o Switch pode cair para 30 depois do Teste Zero). */
  readonly hz?: number;
}

export interface LocalDriver extends MatchDriver {
  readonly sim: Sim;
  readonly director: BotDirector;
  readonly loop: SimLoop;
}

/**
 * Driver local (solo e tela dividida): passo fixo (60 Hz por padrão) com acumulador (no máximo 4 ticks por frame, frame
 * limitado a 0,1 s), IA antes de cada `step` (passo 0 da ordem fixa) e eventos drenados a cada tick. Pausar é só não
 * chamar `update` (solo e local pausam a sim, tecnico.md §4.2). Sem alocação por tick: os frames e as closures nascem
 * aqui.
 */
export function createLocalDriver(config: LocalDriverConfig): LocalDriver {
  const { recipe, map, humans, writeHumanFrame, onEvents } = config;
  const sim = createSim({ recipe, map, humans, ...(config.hz !== undefined ? { hz: config.hz } : {}) });
  const director = createBotDirector({ recipe, humans, hz: sim.hz });
  const frames = createInputFrames();
  let seq = 0;
  const loop = createSimLoop({
    sim,
    frames,
    beforeTick: (s, f) => {
      seq = (seq + 1) & 0xffff;
      for (let h = 0; h < humans; h++) writeHumanFrame(h, f[h]!, seq);
      director.think(s.view(), f);
    },
    ...(onEvents ? { afterTick: (s: Sim, events: readonly SimEvent[]) => onEvents(events, s) } : {}),
  });
  let disposed = false;
  return {
    sim,
    director,
    loop,
    get alpha(): number {
      return loop.alpha;
    },
    update(frameSeconds: number): number {
      if (disposed) return 0;
      return loop.frame(frameSeconds);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      director.dispose();
      sim.dispose();
    },
  };
}
