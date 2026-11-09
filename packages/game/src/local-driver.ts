import {
  botPrimaries,
  createBotDirectorWithPaths,
  NAV_PATH_API,
  type AiBudget,
  type BotDirectorWithStats,
} from '@boboforces/ai';
import type { FigureGameTable, MatchRecipe } from '@boboforces/format';
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
  /** M1: zumbis do estresse (`SimConfig.zombies` e o mesmo número no diretor). */
  readonly zombies?: number;
  /** M1: orçamento da IA do perfil da plataforma (`aiBudgetFor`). */
  readonly budget?: AiBudget;
  /** M1: relógio para medir as fases (F2 e bench); ausente = sem medição. */
  readonly now?: () => number;
  /**
   * #56: tabela de jogo do boneco montada no loading (`SimConfig.figureTable`): o MESMO objeto que o render recebe em
   * `setFigures`. Ausente = a sim monta a dela na criação (testes).
   */
  readonly figureTable?: FigureGameTable;
  /** M2: primária de cada controlador no 1º spawn (`SimConfig.primaries`); ausente = o sorteio dos bots (`botPrimaries`). */
  readonly primaries?: ReadonlyArray<number>;
  /** M2 (fase 2d): contagem antes da partida (`SimConfig.countdownS`); ausente = sem contagem. */
  readonly countdownS?: number;
}

export interface LocalDriver extends MatchDriver {
  readonly sim: Sim;
  readonly director: BotDirectorWithStats;
  readonly loop: SimLoop;
  /** ms gastos no último `update` na IA (`think`) e na sim (o resto do passo); 0 sem `now`. */
  readonly lastAiMs: number;
  readonly lastSimMs: number;
}

/**
 * Driver local (solo e tela dividida): passo fixo (60 Hz por padrão) com acumulador (no máximo 4 ticks por frame, frame
 * limitado a 0,1 s), IA antes de cada `step` (passo 0 da ordem fixa) e eventos drenados a cada tick. Pausar é só não
 * chamar `update` (solo e local pausam a sim, tecnico.md §4.2). Sem alocação por tick: os frames e as closures nascem
 * aqui. M1: a IA usa a navegação de verdade (`NAV_PATH_API` sobre `SimMap.nav`), o orçamento do perfil e os zumbis.
 */
export function createLocalDriver(config: LocalDriverConfig): LocalDriver {
  const { recipe, map, humans, writeHumanFrame, onEvents } = config;
  const zombies = config.zombies ?? 0;
  const sim = createSim({
    recipe,
    map,
    humans,
    zombies,
    ...(config.hz !== undefined ? { hz: config.hz } : {}),
    ...(config.figureTable ? { figureTable: config.figureTable } : {}),
    // M2: bots com a primária sorteada pela semente (`botPrimaries` da IA); o bench fixa a dele.
    primaries: config.primaries ?? botPrimaries(recipe, humans),
    ...(config.countdownS !== undefined ? { countdownS: config.countdownS } : {}),
  });
  const director = createBotDirectorWithPaths(
    { recipe, humans, hz: sim.hz, zombies, ...(config.budget ? { budget: config.budget } : {}) },
    NAV_PATH_API,
  );
  const frames = createInputFrames();
  const now = config.now ?? null;
  let seq = 0;
  let aiMs = 0;
  let lastAiMs = 0;
  let lastSimMs = 0;
  const loop = createSimLoop({
    sim,
    frames,
    beforeTick: (s, f) => {
      seq = (seq + 1) & 0xffff;
      for (let h = 0; h < humans; h++) writeHumanFrame(h, f[h]!, seq);
      if (now) {
        const t0 = now();
        director.think(s.view(), f);
        aiMs += now() - t0;
      } else {
        director.think(s.view(), f);
      }
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
    get lastAiMs(): number {
      return lastAiMs;
    },
    get lastSimMs(): number {
      return lastSimMs;
    },
    update(frameSeconds: number): number {
      if (disposed) return 0;
      if (!now) return loop.frame(frameSeconds);
      aiMs = 0;
      const t0 = now();
      const ticks = loop.frame(frameSeconds);
      const total = now() - t0;
      lastAiMs = aiMs;
      lastSimMs = Math.max(0, total - aiMs);
      return ticks;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      director.dispose();
      sim.dispose();
    },
  };
}
