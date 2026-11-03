import type { Lifecycle } from '@boboforces/platform-api';
import type { Disposable, Unsubscribe } from '@boboforces/shared';

export interface WebLifecycle extends Lifecycle, Disposable {
  readonly visible: boolean;
  readonly inMatch: boolean;
  /** Pausa pedida pela própria casca (ex.: contexto WebGL perdido). */
  requestPause(): void;
}

export interface WebLifecycleOptions {
  readonly win: Window;
  readonly doc: Document;
  /** Grava o save pendente (o `pagehide` é a última chance garantida no celular). */
  readonly flush: () => void;
  readonly onWarning?: (message: string, error: unknown) => void;
}

interface WakeLockSentinelLike {
  release(): Promise<void>;
}
interface WakeLockNavigator {
  readonly wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
}

const HISTORY_MARK = 'boboforces:match';

/**
 * Ciclo de vida da web (tecnico.md §11.1):
 * - aba oculta → `onVisibility(false)` + `onPause`; visível de novo → `onVisibility(true)` + `onResume`
 *   (o jogo decide se despausa; solo e local continuam na pausa até o jogador voltar);
 * - `pagehide` grava o save; volta do bfcache (`pageshow` persistido) conta como "voltou";
 * - pointer lock perdido (Esc) → `onPause`, porque o `keydown` do Esc nem chega à página;
 * - durante a partida: `beforeunload` pede confirmação, o voltar do navegador vira pausa (`pushState` + `popstate`)
 *   e o Wake Lock segura a tela acesa (refeito ao voltar para a aba, porque o sistema solta ao esconder).
 */
export function createWebLifecycle(options: WebLifecycleOptions): WebLifecycle {
  const { win, doc, flush } = options;
  const warn = options.onWarning ?? (() => {});
  const pauseListeners = new Set<() => void>();
  const resumeListeners = new Set<() => void>();
  const visibilityListeners = new Set<(visible: boolean) => void>();
  let visible = doc.visibilityState !== 'hidden';
  let inMatch = false;
  let pointerLocked = doc.pointerLockElement != null;
  let wakeLock: WakeLockSentinelLike | null = null;
  let wakeLockPending = false;
  let ignoreNextPop = false;

  function emitPause(): void {
    for (const listener of pauseListeners) listener();
  }
  function emitResume(): void {
    for (const listener of resumeListeners) listener();
  }
  function setVisible(next: boolean): void {
    if (next === visible) return;
    visible = next;
    for (const listener of visibilityListeners) listener(next);
    if (next) {
      emitResume();
      if (inMatch) acquireWakeLock();
    } else {
      emitPause();
      flush();
    }
  }

  function acquireWakeLock(): void {
    const api = (win.navigator as Navigator & WakeLockNavigator).wakeLock;
    if (!api || wakeLock || wakeLockPending || !visible) return;
    wakeLockPending = true;
    api.request('screen').then(
      (sentinel) => {
        wakeLockPending = false;
        if (inMatch) wakeLock = sentinel;
        else void sentinel.release().catch(() => {});
      },
      (error: unknown) => {
        wakeLockPending = false;
        warn('lifecycle: Wake Lock recusado', error);
      },
    );
  }
  function releaseWakeLock(): void {
    const sentinel = wakeLock;
    wakeLock = null;
    if (sentinel) void sentinel.release().catch(() => {});
  }

  function onVisibilityChange(): void {
    // O sistema solta o Wake Lock sozinho quando a aba some.
    if (doc.visibilityState === 'hidden') wakeLock = null;
    setVisible(doc.visibilityState !== 'hidden');
  }
  function onPageHide(): void {
    flush();
    setVisible(false);
  }
  function onPageShow(event: PageTransitionEvent): void {
    if (event.persisted) setVisible(doc.visibilityState !== 'hidden');
  }
  function onPointerLockChange(): void {
    const locked = doc.pointerLockElement != null;
    if (pointerLocked && !locked) emitPause();
    pointerLocked = locked;
  }
  function onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!inMatch) return;
    event.preventDefault();
    // Navegadores antigos só mostram a confirmação com returnValue preenchido.
    event.returnValue = '';
  }
  function onPopState(): void {
    if (ignoreNextPop) {
      ignoreNextPop = false;
      return;
    }
    if (!inMatch) return;
    emitPause();
    pushMatchState();
  }
  function pushMatchState(): void {
    try {
      win.history.pushState({ [HISTORY_MARK]: true }, '');
    } catch (error) {
      warn('lifecycle: pushState falhou', error);
    }
  }
  function isMatchState(state: unknown): boolean {
    return typeof state === 'object' && state !== null && (state as Record<string, unknown>)[HISTORY_MARK] === true;
  }

  // O `beforeunload` só fica registrado durante a partida: com ele, o Firefox tira a página do bfcache.
  doc.addEventListener('visibilitychange', onVisibilityChange);
  doc.addEventListener('pointerlockchange', onPointerLockChange);
  win.addEventListener('pagehide', onPageHide);
  win.addEventListener('pageshow', onPageShow);
  win.addEventListener('popstate', onPopState);

  function subscribe<T>(set: Set<T>, listener: T): Unsubscribe {
    set.add(listener);
    return () => set.delete(listener);
  }

  return {
    get visible() {
      return visible;
    },
    get inMatch() {
      return inMatch;
    },
    onPause: (listener) => subscribe(pauseListeners, listener),
    onResume: (listener) => subscribe(resumeListeners, listener),
    onVisibility: (listener) => subscribe(visibilityListeners, listener),
    setInMatch(next) {
      if (next === inMatch) return;
      inMatch = next;
      if (next) {
        win.addEventListener('beforeunload', onBeforeUnload);
        pushMatchState();
        acquireWakeLock();
      } else {
        win.removeEventListener('beforeunload', onBeforeUnload);
        releaseWakeLock();
        // Tira a entrada extra do histórico para o voltar do navegador voltar a funcionar normalmente no menu.
        if (isMatchState(win.history.state)) {
          ignoreNextPop = true;
          win.history.back();
        }
      }
    },
    requestPause: emitPause,
    dispose() {
      doc.removeEventListener('visibilitychange', onVisibilityChange);
      doc.removeEventListener('pointerlockchange', onPointerLockChange);
      win.removeEventListener('pagehide', onPageHide);
      win.removeEventListener('pageshow', onPageShow);
      win.removeEventListener('beforeunload', onBeforeUnload);
      win.removeEventListener('popstate', onPopState);
      releaseWakeLock();
      inMatch = false;
      pauseListeners.clear();
      resumeListeners.clear();
      visibilityListeners.clear();
    },
  };
}
