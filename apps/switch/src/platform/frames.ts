/**
 * `platform.requestFrame` sobre o `requestAnimationFrame` do nx.js, sem alocar por frame (regra 11: pausa de GC é
 * risco real no Switch). Um único callback nativo fixo roda o "tick" da casca (ciclo de vida) e depois os callbacks
 * agendados, guardados em vetores de tamanho fixo.
 */
export const MAX_FRAME_CALLBACKS = 8;

export interface FrameScheduler {
  request(callback: (nowMs: number) => void): number;
  cancel(handle: number): void;
}

export interface FrameSchedulerOptions {
  readonly requestAnimationFrame: (callback: (nowMs: number) => void) => number;
  /** Roda no início de cada frame, antes dos callbacks do jogo. */
  readonly beforeFrame: (nowMs: number) => void;
  /** Roda no fim de cada frame, depois dos callbacks (mesmo se um deles lançar). */
  readonly afterFrame?: () => void;
  /** Roda quando um frame nativo é pedido (o ciclo de vida mede o vão a partir do pedido). */
  readonly onNativeRequest?: () => void;
}

export function createFrameScheduler(opts: FrameSchedulerOptions): FrameScheduler {
  // Dois conjuntos alternados: o que roda neste frame e o que o jogo agenda para o próximo.
  let callbacks: (((nowMs: number) => void) | null)[] = new Array(MAX_FRAME_CALLBACKS).fill(null);
  let handles = new Int32Array(MAX_FRAME_CALLBACKS);
  let running: (((nowMs: number) => void) | null)[] = new Array(MAX_FRAME_CALLBACKS).fill(null);
  let runningHandles = new Int32Array(MAX_FRAME_CALLBACKS);
  let count = 0;
  let nextHandle = 1;
  let nativePending = false;

  const onNativeFrame = (nowMs: number): void => {
    nativePending = false;
    opts.beforeFrame(nowMs);
    const n = count;
    const swapCallbacks = callbacks;
    callbacks = running;
    running = swapCallbacks;
    const swapHandles = handles;
    handles = runningHandles;
    runningHandles = swapHandles;
    count = 0;
    try {
      for (let i = 0; i < n; i++) {
        const cb = running[i];
        running[i] = null;
        if (cb) cb(nowMs);
      }
    } finally {
      opts.afterFrame?.();
    }
  };

  return {
    request(callback) {
      if (count >= MAX_FRAME_CALLBACKS) throw new Error('platform-switch: callbacks de frame demais no mesmo frame');
      const handle = nextHandle++;
      callbacks[count] = callback;
      handles[count] = handle;
      count++;
      if (!nativePending) {
        nativePending = true;
        opts.onNativeRequest?.();
        opts.requestAnimationFrame(onNativeFrame);
      }
      return handle;
    },
    cancel(handle) {
      for (let i = 0; i < count; i++) if (handles[i] === handle) callbacks[i] = null;
      for (let i = 0; i < running.length; i++) if (runningHandles[i] === handle) running[i] = null;
    },
  };
}
