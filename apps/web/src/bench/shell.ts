// Parte da casca que só existe no bench (`?bench&…`). Carregada por `import()` dinâmico no `main.ts`, só quando a URL
// pede o bench: o menu normal não paga estes bytes (a carga inicial está no limite de 350 KB, tecnico.md §16.4).
import type { BenchConfig } from '@boboforces/game';
import type { Unsubscribe } from '@boboforces/shared';
import {
  createBenchReportSink,
  installBenchReportShortcuts,
  type BenchReportSink,
  type ReportSinkEnv,
} from './report.ts';
import { readBenchFromUrl } from './url.ts';

export interface BenchShell {
  readonly config: BenchConfig;
  /** Avisos da leitura da URL (parâmetro desconhecido, valor limitado, repetido). */
  readonly warnings: readonly string[];
  readonly report: BenchReportSink;
  /** Liga os atalhos do relatório (`C`, `B`, toque) na janela e na canvas. */
  install(keys: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>, surface: typeof keys): Unsubscribe;
}

/** `null` quando a URL não pede o bench. */
export function createBenchShell(search: string, env: ReportSinkEnv): BenchShell | null {
  const parsed = readBenchFromUrl(search);
  if (!parsed) return null;
  const report = createBenchReportSink(env);
  return {
    config: parsed.config,
    warnings: parsed.warnings,
    report,
    install: (keys, surface) => installBenchReportShortcuts(report, keys, surface),
  };
}
