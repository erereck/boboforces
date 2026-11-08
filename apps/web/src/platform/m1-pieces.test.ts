import type { AudioContextLike, ControllerInfo, RawInputSource } from '@boboforces/platform-api';
import { describe, expect, it } from 'vitest';
import { describeWebControllers, withControllerInfo, type GamepadLike } from './controllers.ts';
import { createWebDiagnostics, readMemoryUsage, type DiagnosticsSources } from './diagnostics.ts';

const pad = (id: string, mapping = 'standard', vibrationActuator?: unknown): GamepadLike => ({
  connected: true,
  id,
  mapping,
  ...(vibrationActuator === undefined ? {} : { vibrationActuator }),
});

describe('describeControllers (contrato do M1)', () => {
  it('mesmos índices do RawInputState, pula buracos e desconectados', () => {
    const out: ControllerInfo[] = [];
    const list = [
      null,
      pad('Xbox Wireless Controller', 'standard', {}),
      { ...pad('velho'), connected: false },
      pad('genérico', ''),
    ];
    expect(describeWebControllers(() => list, out)).toBe(2);
    expect(out[0]).toEqual({
      index: 1,
      id: 'Xbox Wireless Controller',
      kind: 'standard',
      styleSet: -1,
      deviceType: -1,
      complete: true,
      canVibrate: true,
    });
    expect(out[1]).toMatchObject({ index: 3, kind: 'unknown', canVibrate: false, complete: true });
  });

  it('reaproveita as entradas do array (sem alocar no frame)', () => {
    const out: ControllerInfo[] = [];
    describeWebControllers(() => [pad('a')], out);
    const first = out[0];
    describeWebControllers(() => [pad('b')], out);
    expect(out[0]).toBe(first);
    expect(out[0]?.id).toBe('b');
  });

  it('Gamepad API bloqueada ou ausente: zero controles', () => {
    expect(
      describeWebControllers(() => {
        throw new Error('bloqueada pela política de permissões');
      }, []),
    ).toBe(0);
    expect(describeWebControllers(() => null, [])).toBe(0);
  });

  it('fonte sem describeControllers ganha um embrulho que repassa poll, vibrate e dispose', () => {
    const calls: string[] = [];
    const source: RawInputSource & { dispose(): void } = {
      poll: () => calls.push('poll'),
      vibrate: () => calls.push('vibrate'),
      dispose: () => calls.push('dispose'),
    };
    const wrapped = withControllerInfo(source, () => [pad('x')]);
    expect(wrapped).not.toBe(source);
    wrapped.poll({} as never);
    wrapped.vibrate(0, 1, 1, 10);
    wrapped.dispose?.();
    expect(calls).toEqual(['poll', 'vibrate', 'dispose']);
    expect(wrapped.describeControllers?.([])).toBe(1);

    const own: RawInputSource = { poll() {}, vibrate() {}, describeControllers: () => 7 };
    expect(withControllerInfo(own, () => null)).toBe(own);
  });
});

describe('memória e log recente (contrato do M1)', () => {
  it('performance.memory só no Chromium; senão null', () => {
    expect(readMemoryUsage({ memory: { usedJSHeapSize: 50_000_000, jsHeapSizeLimit: 4_000_000_000 } })).toEqual({
      usedHeapBytes: 50_000_000,
      heapLimitBytes: 4_000_000_000,
    });
    expect(readMemoryUsage({ memory: { usedJSHeapSize: 10 } })).toEqual({ usedHeapBytes: 10, heapLimitBytes: -1 });
    expect(readMemoryUsage({})).toBeNull();
    expect(readMemoryUsage(undefined)).toBeNull();
  });

  it('recentLog devolve as últimas N linhas do appendLog', () => {
    const win = Object.assign(new EventTarget(), {
      __bfErr: undefined,
      __bfCaptured: false,
      performance: { memory: { usedJSHeapSize: 123, jsHeapSizeLimit: 456 } },
    }) as unknown as Window;
    const sources = { win } as unknown as DiagnosticsSources;
    const diagnostics = createWebDiagnostics(sources);
    for (let i = 0; i < 5; i++) diagnostics.appendLog(`[t0] item=${i + 1}`);
    expect(diagnostics.recentLog(2)).toEqual(['[t0] item=4', '[t0] item=5']);
    expect(diagnostics.recentLog(99).length).toBe(5);
    expect(diagnostics.recentLog(0)).toEqual([]);
    expect(diagnostics.memoryUsage()).toEqual({ usedHeapBytes: 123, heapLimitBytes: 456 });
    diagnostics.dispose();
  });
});

describe('AudioContextLike (contrato da platform-api)', () => {
  it('o AudioContext do DOM cabe no tipo, sem cast (onended com parâmetro never, integração do M1)', () => {
    const fits = (ctx: AudioContext): AudioContextLike => ctx;
    expect(typeof fits).toBe('function');
  });
});
