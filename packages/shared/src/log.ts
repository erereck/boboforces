import { RingBuffer } from './ring-buffer.ts';

/**
 * Log com escopo. A saída vai para um "sink" injetável: o padrão usa o `console` global se existir (web, Node e nx.js
 * têm), e a casca pode trocar (o Switch também grava no `runtime.log` via `platform.diagnostics`).
 *
 * Avisos e erros ficam num anel com os últimos `RECENT_LOG_CAPACITY` registros, que o relatório de diagnóstico lê
 * ("últimos 20 erros", decisão #42). Logar aloca strings: não logue dentro do laço quente.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
  readonly data: unknown;
  /** Número de sequência global (o shared não tem relógio; a casca pode correlacionar). */
  readonly seq: number;
}

export type LogSink = (record: LogRecord) => void;

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export const RECENT_LOG_CAPACITY = 20;

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = { debug: 0, info: 1, warn: 2, error: 3 };

interface ConsoleLike {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

function consoleSink(record: LogRecord): void {
  const c = (globalThis as unknown as { console?: ConsoleLike }).console;
  if (!c) return;
  const line = `[${record.scope}] ${record.message}`;
  const args: unknown[] = record.data === undefined ? [line] : [line, record.data];
  if (record.level === 'error') c.error(...args);
  else if (record.level === 'warn') c.warn(...args);
  else c.log(...args);
}

let sink: LogSink = consoleSink;
let minLevel: LogLevel = 'info';
let seq = 0;
const recent = new RingBuffer<LogRecord>(RECENT_LOG_CAPACITY);

/** Troca o destino dos logs. `null` volta ao console. */
export function setLogSink(next: LogSink | null): void {
  sink = next ?? consoleSink;
}

/** Nível mínimo que chega ao sink (avisos e erros sempre entram no anel de recentes). */
export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

/** Copia os avisos/erros recentes (do mais antigo ao mais novo) para `out` e devolve quantos copiou. */
export function recentLogs(out: LogRecord[]): number {
  out.length = 0;
  recent.forEach((r) => out.push(r));
  return out.length;
}

export function clearRecentLogs(): void {
  recent.clear();
}

function emit(level: LogLevel, scope: string, message: string, data: unknown): void {
  const record: LogRecord = { level, scope, message, data, seq: seq++ };
  if (LEVEL_ORDER[level] >= LEVEL_ORDER.warn) recent.push(record);
  if (LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel]) sink(record);
}

export function createLogger(scope: string): Logger {
  return {
    debug: (message, data) => emit('debug', scope, message, data),
    info: (message, data) => emit('info', scope, message, data),
    warn: (message, data) => emit('warn', scope, message, data),
    error: (message, data) => emit('error', scope, message, data),
  };
}
