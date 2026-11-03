import { describe, expect, it } from 'vitest';
import { createWebLifecycle } from './lifecycle.ts';

/** Janela e documento sintéticos sobre o EventTarget do Node: só o que a lifecycle lê. */
function fakeBrowser() {
  const doc = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as DocumentVisibilityState,
    pointerLockElement: null as Element | null,
  });
  const wakeLocks: { released: boolean }[] = [];
  const history = {
    state: null as unknown,
    pushes: 0,
    backs: 0,
    pushState(state: unknown) {
      this.state = state;
      this.pushes++;
    },
    back() {
      this.backs++;
      this.state = null;
      win.dispatchEvent(new Event('popstate'));
    },
  };
  const win = Object.assign(new EventTarget(), {
    history,
    navigator: {
      wakeLock: {
        request: async () => {
          const sentinel = { released: false, release: async () => void (sentinel.released = true) };
          wakeLocks.push(sentinel);
          return sentinel;
        },
      },
    },
  });
  return { win, doc, history, wakeLocks };
}

function setup() {
  const b = fakeBrowser();
  const log: string[] = [];
  let flushes = 0;
  const lifecycle = createWebLifecycle({
    win: b.win as unknown as Window,
    doc: b.doc as unknown as Document,
    flush: () => flushes++,
  });
  lifecycle.onPause(() => log.push('pause'));
  lifecycle.onResume(() => log.push('resume'));
  lifecycle.onVisibility((v) => log.push(v ? 'visible' : 'hidden'));
  return { ...b, lifecycle, log, flushes: () => flushes };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('createWebLifecycle', () => {
  it('aba oculta pausa e grava; aba visível avisa a volta', () => {
    const t = setup();
    t.doc.visibilityState = 'hidden';
    t.doc.dispatchEvent(new Event('visibilitychange'));
    expect(t.log).toEqual(['hidden', 'pause']);
    expect(t.flushes()).toBe(1);
    t.doc.visibilityState = 'visible';
    t.doc.dispatchEvent(new Event('visibilitychange'));
    expect(t.log).toEqual(['hidden', 'pause', 'visible', 'resume']);
  });

  it('pagehide grava sem pausar duas vezes', () => {
    const t = setup();
    t.doc.visibilityState = 'hidden';
    t.doc.dispatchEvent(new Event('visibilitychange'));
    t.win.dispatchEvent(new Event('pagehide'));
    expect(t.log).toEqual(['hidden', 'pause']);
    expect(t.flushes()).toBeGreaterThanOrEqual(2);
  });

  it('volta do bfcache conta como visível', () => {
    const t = setup();
    t.win.dispatchEvent(new Event('pagehide'));
    t.win.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    expect(t.log).toEqual(['hidden', 'pause', 'visible', 'resume']);
  });

  it('pointer lock perdido pausa; sem lock antes, não', () => {
    const t = setup();
    t.doc.dispatchEvent(new Event('pointerlockchange'));
    expect(t.log).toEqual([]);
    t.doc.pointerLockElement = {} as Element;
    t.doc.dispatchEvent(new Event('pointerlockchange'));
    t.doc.pointerLockElement = null;
    t.doc.dispatchEvent(new Event('pointerlockchange'));
    expect(t.log).toEqual(['pause']);
  });

  it('na partida: confirma ao fechar, voltar do navegador vira pausa e o Wake Lock segura a tela', async () => {
    const t = setup();
    const before = new Event('beforeunload', { cancelable: true });
    t.win.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(false);

    t.lifecycle.setInMatch(true);
    await tick();
    expect(t.history.pushes).toBe(1);
    expect(t.wakeLocks).toHaveLength(1);

    const during = new Event('beforeunload', { cancelable: true });
    Object.defineProperty(during, 'returnValue', { value: true, writable: true });
    t.win.dispatchEvent(during);
    expect(during.defaultPrevented).toBe(true);

    t.history.state = null; // o navegador voltou uma entrada
    t.win.dispatchEvent(new Event('popstate'));
    expect(t.log).toEqual(['pause']);
    expect(t.history.pushes).toBe(2); // empurrou de novo

    t.lifecycle.setInMatch(false);
    await tick();
    expect(t.history.backs).toBe(1); // tirou a entrada extra
    expect(t.log).toEqual(['pause']); // e o popstate dessa volta não pausou
    expect(t.wakeLocks[0]?.released).toBe(true);
  });

  it('refaz o Wake Lock ao voltar para a aba durante a partida', async () => {
    const t = setup();
    t.lifecycle.setInMatch(true);
    await tick();
    t.doc.visibilityState = 'hidden';
    t.doc.dispatchEvent(new Event('visibilitychange'));
    t.doc.visibilityState = 'visible';
    t.doc.dispatchEvent(new Event('visibilitychange'));
    await tick();
    expect(t.wakeLocks).toHaveLength(2);
  });

  it('dispose solta tudo', () => {
    const t = setup();
    t.lifecycle.dispose();
    t.doc.visibilityState = 'hidden';
    t.doc.dispatchEvent(new Event('visibilitychange'));
    expect(t.log).toEqual([]);
  });
});
