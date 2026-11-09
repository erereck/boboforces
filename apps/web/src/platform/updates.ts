import type { UpdateService } from '@boboforces/platform-api';

/**
 * M2 (fase 8c): o lado da página do service worker (`scripts/service-worker.ts` gera o `sw.js`). Registra depois do
 * `load` e de uma folga (o precache não disputa a banda do menu nem da primeira partida), procura versão nova a cada
 * 30 min e deixa a nova ESPERANDO até o jogo chamar `apply()` no título. Na troca de controlador, recarrega.
 */
export const UPDATE_CHECK_MS = 30 * 60 * 1000;
export const REGISTER_DELAY_MS = 4000;
/** Mesmo texto de `APPLY_UPDATE_MESSAGE` em `scripts/service-worker.ts` (o teste confere). */
export const APPLY_UPDATE = 'boboforces:apply-update';

export interface WebUpdates extends UpdateService {
  dispose(): void;
}

export function createWebUpdates(
  win: Window,
  log: (line: string) => void,
  /** Grava o save pendente antes de recarregar. */
  flush: () => Promise<void>,
): WebUpdates | null {
  const container = win.navigator.serviceWorker as ServiceWorkerContainer | undefined;
  if (!container) return null;
  let waiting: ServiceWorker | null = null;
  let applying = false;
  let timer = 0;
  let interval = 0;
  let disposed = false;

  const track = (reg: ServiceWorkerRegistration): void => {
    // Só é "atualização" se a página já tem um controlador (na 1ª visita, o worker novo é a 1ª instalação).
    if (reg.waiting && container.controller) waiting = reg.waiting;
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && container.controller) {
          waiting = worker;
          log('[web] versão nova pronta (aplica no título)');
        }
      });
    });
  };
  const onControllerChange = (): void => {
    if (applying) void flush().then(() => win.location.reload());
  };
  container.addEventListener('controllerchange', onControllerChange);

  const register = (): void => {
    if (disposed) return;
    container.register('./sw.js').then(
      (reg) => {
        track(reg);
        interval = win.setInterval(() => void reg.update().catch(() => undefined), UPDATE_CHECK_MS);
      },
      (error: unknown) => log(`[web] service worker não registrou: ${String(error)}`),
    );
  };
  const schedule = (): void => {
    timer = win.setTimeout(register, REGISTER_DELAY_MS);
  };
  if (win.document.readyState === 'complete') schedule();
  else win.addEventListener('load', schedule, { once: true });

  return {
    get ready() {
      return waiting !== null && !applying;
    },
    apply() {
      if (!waiting || applying) return;
      applying = true;
      log('[web] aplicando a versão nova');
      waiting.postMessage(APPLY_UPDATE);
    },
    dispose() {
      disposed = true;
      win.clearTimeout(timer);
      win.clearInterval(interval);
      win.removeEventListener('load', schedule);
      container.removeEventListener('controllerchange', onControllerChange);
    },
  };
}
