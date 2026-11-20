import type { Diagnostics, MemoryUsage, PlatformFeatures, PlatformReport } from '@boboforces/platform-api';
import { RECENT_LOG_CAPACITY, RingBuffer, type Disposable } from '@boboforces/shared';
import type { BuildInfo } from './build-info.ts';
import type { GlInfo } from './diagnostics-report.ts';

/** Linhas guardadas pelo `appendLog` (só memória na web; o Switch grava `runtime.log`). */
export const WEB_LOG_CAPACITY = 200;
const MAX_ERROR_CHARS = 2000;

/** Tira query e fragmento de URLs (`#bot=…`, `#p=…` levam códigos do jogador; o relatório nunca inclui). */
export function scrubUrls(text: string): string {
  return text.replace(/\b((?:https?|blob):\/\/[^\s?#)'"]+)[?#][^\s)'"]*/g, '$1');
}

export function formatErrorText(text: string): string {
  const clean = scrubUrls(text);
  return clean.length > MAX_ERROR_CHARS ? clean.slice(0, MAX_ERROR_CHARS) + '…' : clean;
}

function describeReason(reason: unknown): string {
  if (reason instanceof Error) return reason.stack || `${reason.name}: ${reason.message}`;
  return String(reason);
}

export function formatErrorEvent(event: ErrorEvent): string {
  const where = event.filename ? ` @ ${event.filename}:${event.lineno}:${event.colno}` : '';
  const error: unknown = event.error;
  const stack = error instanceof Error && error.stack ? `\n${error.stack}` : '';
  return formatErrorText(`${event.message}${where}${stack}`);
}

export function formatRejection(reason: unknown): string {
  return formatErrorText(`promessa rejeitada: ${describeReason(reason)}`);
}

/** O que a diagnostics lê das outras peças da plataforma, no momento do relatório. */
export interface DiagnosticsSources {
  readonly win: Window;
  readonly build: BuildInfo;
  readonly features: PlatformFeatures;
  readonly graphics: {
    readonly context: WebGL2RenderingContext;
    readonly contextLost: boolean;
    readonly antialias: boolean;
    readonly width: number;
    readonly height: number;
    readonly renderScale: number;
    readonly maxPixelRatio: number;
  };
  readonly storage: { readonly durable: boolean; readonly failedWrites: number };
  readonly persistence: { readonly persisted: boolean | null; refresh(): Promise<boolean | null> };
}

export interface WebDiagnostics extends Diagnostics, Disposable {
  /** Últimos erros capturados (do mais antigo ao mais novo). */
  readonly errors: readonly string[];
  /** Copia as linhas do log em memória para `out` (painel F2). */
  readLog(out: string[]): number;
  memoryUsage(): MemoryUsage | null;
  recentLog(maxLines: number): readonly string[];
}

/** `performance.memory` (só Chromium, não padronizado): o resto dos navegadores não diz o heap. */
interface ChromiumMemory {
  readonly usedJSHeapSize?: number;
  readonly jsHeapSizeLimit?: number;
}

/**
 * Heap do JS para o F2, o bench e o item 14 do T0. Na web só o Chromium responde (`performance.memory`, em passos
 * grossos de propósito, contra fingerprinting); Firefox e Safari dão `null` e o relatório escreve -1.
 */
export function readMemoryUsage(perf: { readonly memory?: ChromiumMemory } | undefined): MemoryUsage | null {
  const memory = perf?.memory;
  const used = memory?.usedJSHeapSize;
  if (typeof used !== 'number' || !Number.isFinite(used) || used <= 0) return null;
  const limit = memory?.jsHeapSizeLimit;
  return { usedHeapBytes: used, heapLimitBytes: typeof limit === 'number' && limit > 0 ? limit : -1 };
}

/**
 * Diagnóstico sem coleta (decisão #42, tecnico.md §18): nada sai do aparelho sozinho. Captura `error` (inclusive
 * falha de carga de `<script>`/`<link>`, por isso em captura) e `unhandledrejection` num anel com os últimos 20, já
 * adotando os que o script inline do index.html pegou antes de qualquer módulo rodar.
 */
export function createWebDiagnostics(sources: DiagnosticsSources): WebDiagnostics {
  const { win } = sources;
  const errors = new RingBuffer<string>(RECENT_LOG_CAPACITY);
  const log = new RingBuffer<string>(WEB_LOG_CAPACITY);
  let errorCount = 0;
  let glInfo: GlInfo | null = null;

  function pushError(text: string): void {
    errorCount++;
    errors.push(text);
  }

  for (const early of win.__bfErr ?? []) pushError(formatErrorText(early));
  win.__bfErr = undefined;
  win.__bfCaptured = true;

  function onError(event: Event): void {
    // Erro de script chega como ErrorEvent (no window); falha de carga de recurso, como Event comum no elemento.
    if ('message' in event && 'filename' in event) {
      pushError(formatErrorEvent(event as ErrorEvent));
      return;
    }
    const target = event.target as { tagName?: unknown; src?: unknown; href?: unknown } | null;
    if (target && typeof target.tagName === 'string') {
      const url = typeof target.src === 'string' ? target.src : typeof target.href === 'string' ? target.href : '';
      pushError(formatErrorText(`falha ao carregar <${target.tagName.toLowerCase()}> ${url}`));
    }
  }
  function onRejection(event: PromiseRejectionEvent): void {
    pushError(formatRejection(event.reason));
  }
  win.addEventListener('error', onError, true);
  win.addEventListener('unhandledrejection', onRejection);

  return {
    get errors() {
      return errors.toArray();
    },
    async collectReport(): Promise<PlatformReport> {
      // M9 (fase 0): a leitura da GPU e a montagem chegam por import() (fora do menu da web).
      const report = await import('./diagnostics-report.ts');
      await sources.persistence.refresh();
      let info: GlInfo;
      if (glInfo) info = glInfo;
      else if (sources.graphics.contextLost) info = { gpu: 'desconhecida (contexto perdido)', vendor: '', limits: {} };
      else info = glInfo = report.readGlInfo(sources.graphics.context);
      return report.buildWebReport(sources, info, errors.toArray(), errorCount);
    },
    appendLog(line) {
      log.push(formatErrorText(line));
    },
    readLog(out) {
      out.length = 0;
      log.forEach((line) => out.push(line));
      return out.length;
    },
    memoryUsage() {
      return readMemoryUsage((win as Window & { performance?: { memory?: ChromiumMemory } }).performance);
    },
    recentLog(maxLines) {
      const all = log.toArray();
      const n = Math.max(0, Math.floor(maxLines));
      return n >= all.length ? all : all.slice(all.length - n);
    },
    dispose() {
      win.removeEventListener('error', onError, true);
      win.removeEventListener('unhandledrejection', onRejection);
    },
  };
}
