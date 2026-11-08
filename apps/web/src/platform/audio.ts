import type { AudioSurface } from '@boboforces/platform-api';
import type { Disposable } from '@boboforces/shared';

/** Eventos que contam como gesto para a política de autoplay (o `touchend` é o que o iOS aceita). */
const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchend', 'mousedown'] as const;

export interface WebAudio extends AudioSurface, Disposable {
  readonly context: AudioContext;
}

/**
 * O `AudioContext` da casca (tecnico.md §11.1 e §12). Nasce suspenso; o primeiro gesto do jogador chama `resume()` e
 * só então `unlocked` vira verdade e `onUnlock` dispara. Na volta para a aba (`visibilitychange` e `pageshow` do
 * bfcache), um contexto que já tinha sido liberado e ficou suspenso ou "interrupted" (iOS) é retomado. Sem
 * `AudioContext` no navegador, devolve `null`. O `@boboforces/audio` só usa o subconjunto `AudioContextLike`
 * (Context, BufferSource, Gain, StereoPanner, `createBuffer`, `decodeAudioData`; regra 9). O `onended` do contrato
 * aceita o `(ev: Event) => any` do DOM desde a integração do M1 (`m1-pieces.test.ts` confere o tipo).
 */
export function createWebAudio(win: Window): WebAudio | null {
  const Ctor = (win as Window & { AudioContext?: typeof AudioContext }).AudioContext;
  if (typeof Ctor !== 'function') return null;
  let context: AudioContext;
  try {
    context = new Ctor({ latencyHint: 'interactive' });
  } catch {
    return null;
  }
  const listeners = new Set<() => void>();
  let unlocked = context.state === 'running';
  let disposed = false;

  function markUnlocked(): void {
    if (unlocked || context.state !== 'running') return;
    unlocked = true;
    for (const event of UNLOCK_EVENTS) win.removeEventListener(event, onGesture, true);
    for (const listener of listeners) listener();
  }
  function onGesture(): void {
    if (unlocked || disposed) return;
    context.resume().then(markUnlocked, () => {});
  }
  function onStateChange(): void {
    markUnlocked();
  }
  function onVisibility(): void {
    if (unlocked && !disposed && win.document.visibilityState === 'visible' && context.state !== 'running') {
      context.resume().catch(() => {});
    }
  }

  if (!unlocked) for (const event of UNLOCK_EVENTS) win.addEventListener(event, onGesture, true);
  context.addEventListener('statechange', onStateChange);
  win.document.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('pageshow', onVisibility);

  return {
    context,
    get unlocked() {
      return unlocked;
    },
    onUnlock(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      for (const event of UNLOCK_EVENTS) win.removeEventListener(event, onGesture, true);
      context.removeEventListener('statechange', onStateChange);
      win.document.removeEventListener('visibilitychange', onVisibility);
      win.removeEventListener('pageshow', onVisibility);
      listeners.clear();
      void context.close().catch(() => {});
    },
  };
}
