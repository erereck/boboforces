import { afterEach, describe, expect, it } from 'vitest';
import { assert, assertNever } from './assert.ts';
import {
  clearRecentLogs,
  createLogger,
  RECENT_LOG_CAPACITY,
  recentLogs,
  setLogLevel,
  setLogSink,
  type LogRecord,
} from './log.ts';

afterEach(() => {
  setLogSink(null);
  setLogLevel('info');
  clearRecentLogs();
});

describe('log', () => {
  it('manda para o sink respeitando o nível', () => {
    const got: LogRecord[] = [];
    setLogSink((r) => got.push(r));
    setLogLevel('warn');
    const log = createLogger('teste');
    log.info('ignorado');
    log.warn('aviso', { n: 1 });
    expect(got.map((r) => `${r.level}:${r.scope}:${r.message}`)).toEqual(['warn:teste:aviso']);
    expect(got[0]?.data).toEqual({ n: 1 });
  });

  it('guarda os últimos avisos/erros para o relatório', () => {
    setLogSink(() => {});
    const log = createLogger('x');
    for (let i = 0; i < RECENT_LOG_CAPACITY + 5; i++) log.error(`erro ${i}`);
    log.info('não entra');
    const out: LogRecord[] = [];
    expect(recentLogs(out)).toBe(RECENT_LOG_CAPACITY);
    expect(out[0]?.message).toBe('erro 5');
    expect(out.at(-1)?.message).toBe(`erro ${RECENT_LOG_CAPACITY + 4}`);
  });
});

describe('assert', () => {
  it('lança com a mensagem', () => {
    expect(() => assert(false, 'quebrou')).toThrow('quebrou');
    expect(() => assert(1)).not.toThrow();
    expect(() => assertNever('x' as never)).toThrow();
  });
});
