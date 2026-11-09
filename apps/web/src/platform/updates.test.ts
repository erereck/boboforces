import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APPLY_UPDATE, createWebUpdates, REGISTER_DELAY_MS } from './updates.ts';

type Listener = () => void;

/** `ServiceWorker`, `ServiceWorkerRegistration` e o container, só com o que `updates.ts` usa. */
function fakeWorld(withController: boolean) {
  const listeners = new Map<string, Listener[]>();
  const on = (map: Map<string, Listener[]>, type: string, fn: Listener): void => {
    map.set(type, [...(map.get(type) ?? []), fn]);
  };
  const fire = (map: Map<string, Listener[]>, type: string): void => {
    for (const fn of map.get(type) ?? []) fn();
  };
  const workerListeners = new Map<string, Listener[]>();
  const worker = {
    state: 'installing',
    posted: [] as unknown[],
    postMessage(m: unknown) {
      this.posted.push(m);
    },
    addEventListener: (type: string, fn: Listener) => on(workerListeners, type, fn),
  };
  const regListeners = new Map<string, Listener[]>();
  const reg = {
    waiting: null as typeof worker | null,
    installing: null as typeof worker | null,
    update: vi.fn(() => Promise.resolve()),
    addEventListener: (type: string, fn: Listener) => on(regListeners, type, fn),
  };
  const container = {
    controller: withController ? {} : null,
    register: vi.fn(() => Promise.resolve(reg)),
    addEventListener: (type: string, fn: Listener) => on(listeners, type, fn),
    removeEventListener: vi.fn(),
  };
  const reload = vi.fn();
  const win = {
    navigator: { serviceWorker: container },
    document: { readyState: 'complete' },
    location: { reload },
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (h: number) => clearTimeout(h),
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    clearInterval: (h: number) => clearInterval(h),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as Window;
  /** O navegador achou um sw.js novo e terminou de instalar. */
  const newVersion = (): void => {
    reg.installing = worker;
    fire(regListeners, 'updatefound');
    worker.state = 'installed';
    fire(workerListeners, 'statechange');
  };
  return { win, container, worker, reload, newVersion, controllerChange: () => fire(listeners, 'controllerchange') };
}

describe('createWebUpdates (fase 8c)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('registra o sw.js só depois da folga', async () => {
    const w = fakeWorld(true);
    createWebUpdates(
      w.win,
      () => {},
      () => Promise.resolve(),
    );
    expect(w.container.register).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(REGISTER_DELAY_MS);
    expect(w.container.register).toHaveBeenCalledWith('./sw.js');
  });

  it('a versão nova espera; apply manda a mensagem e recarrega depois de gravar o save', async () => {
    const w = fakeWorld(true);
    const flush = vi.fn(() => Promise.resolve());
    const updates = createWebUpdates(w.win, () => {}, flush)!;
    await vi.advanceTimersByTimeAsync(REGISTER_DELAY_MS);
    expect(updates.ready).toBe(false);
    w.newVersion();
    expect(updates.ready).toBe(true);
    // Sem apply, trocar de controlador (outra aba aplicou) não recarrega esta.
    updates.apply();
    expect(w.worker.posted).toEqual([APPLY_UPDATE]);
    expect(updates.ready).toBe(false);
    w.controllerChange();
    await vi.advanceTimersByTimeAsync(0);
    expect(flush).toHaveBeenCalled();
    expect(w.reload).toHaveBeenCalled();
  });

  it('na 1ª visita (sem controlador) a instalação não conta como atualização', async () => {
    const w = fakeWorld(false);
    const updates = createWebUpdates(
      w.win,
      () => {},
      () => Promise.resolve(),
    )!;
    await vi.advanceTimersByTimeAsync(REGISTER_DELAY_MS);
    w.newVersion();
    expect(updates.ready).toBe(false);
    w.controllerChange();
    expect(w.reload).not.toHaveBeenCalled();
  });

  it('sem suporte a service worker, nada', () => {
    const win = { navigator: {} } as unknown as Window;
    expect(
      createWebUpdates(
        win,
        () => {},
        () => Promise.resolve(),
      ),
    ).toBeNull();
  });
});
