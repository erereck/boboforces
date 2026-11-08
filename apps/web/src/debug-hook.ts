// Gancho de depuração da casca web (`window.__bfDebug`). Só a casca toca no `window`: o teste de fumaça, os prints
// automáticos (`scripts/prints.ts`), o bench do PC (`scripts/bench.ts`) e o console leem o estado do jogo por aqui,
// sem tocar no código compartilhado. Nada disso existe no Switch.
import type { BenchConfig, GameDebugApi, GameHandle } from '@boboforces/game';
import type { MemoryUsage } from '@boboforces/platform-api';
import type { BenchReportSink, ReportDelivery } from './bench/report.ts';

export interface WebDebugHook {
  readonly screen: string;
  readonly paused: boolean;
  readonly frames: number;
  readonly simTick: number;
  /** Estatísticas do último frame (`programs` ≤ 7, regra 8; `views` por vista no M1). */
  readonly stats: GameHandle['renderer']['stats'];
  /**
   * M1: gancho dos prints (`GameHandle.debug`, contrato `GameDebugApi`): câmera nomeada, hora do dia, dose, cinza,
   * filtro de mip, HUD, viewmodel, congelar, folha das fontes em uso, `readyForPrint` e `whenReady`. `null` até o
   * Construto carregar.
   */
  readonly print: GameDebugApi | null;
  /** M1: bench lido da URL (`null` sem `?bench`) e os avisos da leitura (parâmetro desconhecido, valor limitado). */
  readonly bench: BenchConfig | null;
  readonly benchWarnings: readonly string[];
  /** M1: texto do relatório (`formatBenchReport`) quando o bench termina; `null` antes. */
  readonly benchReport: string | null;
  /** Como o relatório saiu da última vez (`null` = ainda não saiu ou esperando um gesto). */
  readonly benchDelivery: ReportDelivery | null;
  /** Copia o relatório de novo (dentro de um gesto o clipboard aceita; senão cai no download do .txt). */
  copyBenchReport(): Promise<ReportDelivery>;
  /** Heap do JS agora (Chromium); `null` nos outros navegadores. */
  memory(): MemoryUsage | null;
  /** Últimas linhas do log da plataforma (`[boot]`, `[bench]`, `[t0]`, avisos). */
  log(maxLines?: number): readonly string[];
}

export interface DebugHookSources {
  readonly game: GameHandle;
  readonly bench: BenchConfig | null;
  readonly benchWarnings: readonly string[];
  /** Só no bench (`null` fora dele). */
  readonly report: BenchReportSink | null;
  readonly memory: () => MemoryUsage | null;
  readonly recentLog: (maxLines: number) => readonly string[];
}

/** Monta o gancho com getters (tudo lido na hora: o `print` só deixa de ser `null` quando o Construto carrega). */
export function createDebugHook(sources: DebugHookSources): WebDebugHook {
  const { game, report } = sources;
  return {
    get screen() {
      return game.screen;
    },
    get paused() {
      return game.paused;
    },
    get frames() {
      return game.frames;
    },
    get simTick() {
      return game.match?.sim.tick ?? -1;
    },
    get stats() {
      return game.renderer.stats;
    },
    get print() {
      return game.debug;
    },
    bench: sources.bench,
    benchWarnings: sources.benchWarnings,
    get benchReport() {
      return report?.text ?? null;
    },
    get benchDelivery() {
      return report?.delivery ?? null;
    },
    copyBenchReport: () => (report ? report.copy() : Promise.resolve('falhou')),
    memory: () => sources.memory(),
    log: (maxLines = 200) => sources.recentLog(maxLines),
  };
}
