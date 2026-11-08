import type { Files, Platform, RawInputSource } from '@boboforces/platform-api';
import { createLogger, type Disposable, type Logger } from '@boboforces/shared';
import { createWebInputSource, type WebInputSource } from '../input/index.ts';
import { createWebAssets } from './assets.ts';
import { createWebAudio, type WebAudio } from './audio.ts';
import { withControllerInfo, type GetGamepads } from './controllers.ts';
import { BUILD_INFO } from './build-info.ts';
import { createWebDiagnostics, type WebDiagnostics } from './diagnostics.ts';
import { computeFeatures, readFeatureEnv } from './features.ts';
import { createWebFiles } from './files.ts';
import { createWebGraphics, type WebGraphics } from './graphics.ts';
import { createWebLifecycle, type WebLifecycle } from './lifecycle.ts';
import { createStoragePersistence, type StoragePersistence } from './persistence.ts';
import { installShellGuards } from './shell-guards.ts';
import { createWebStorage, readLocalStorage, type WebStorage } from './storage.ts';
import { createWebTextInput } from './text-input.ts';

export { WebGl2UnavailableError } from './graphics.ts';
export { BUILD_INFO, type BuildInfo } from './build-info.ts';
export type { WebAudio, WebDiagnostics, WebGraphics, WebLifecycle, WebStorage, StoragePersistence };

export interface WebPlatformOptions {
  /** Canvas já existente. Sem ele, a plataforma cria `<canvas id="bf-game">` dentro de `container`. */
  readonly canvas?: HTMLCanvasElement;
  /** Onde o canvas criado entra (padrão: `document.body`). */
  readonly container?: HTMLElement;
  /** MSAA nativo. Padrão: ligado no PC, desligado no celular (tecnico.md §6.10). */
  readonly antialias?: boolean;
  /** Teto de DPR. Padrão: 2 no PC, 1,5 no celular (tecnico.md §16.1). */
  readonly maxPixelRatio?: number;
  /** Base dos assets lógicos. Padrão: a pasta do index.html (`base: './'`). */
  readonly assetsBaseUrl?: string;
  /** Fonte de input pronta (testes, integração). Padrão: os adaptadores web de `src/input` no canvas. */
  readonly input?: RawInputSource & Partial<Disposable>;
  /** O que `exit()` faz. Padrão: grava o save e recarrega a página, que volta ao título. */
  readonly onExit?: () => void;
}

/** `Platform` da web com as peças concretas (o jogo só enxerga `Platform`; a casca e o F2 usam o resto). */
export interface WebPlatform extends Platform, Disposable {
  readonly graphics: WebGraphics;
  readonly storage: WebStorage;
  readonly files: Files & Disposable;
  readonly lifecycle: WebLifecycle;
  readonly diagnostics: WebDiagnostics;
  readonly audio: WebAudio | null;
  /** `navigator.storage.persist()`: a casca pede sozinha na primeira gravação feita num gesto. */
  readonly persistence: StoragePersistence;
  /**
   * Adaptadores de input da web com o pointer lock (o `main.ts` pede o lock no clique). `null` quando os testes
   * injetaram outra fonte em `options.input` ou quando os adaptadores não subiram.
   */
  readonly webInput: WebInputSource | null;
}

const NULL_INPUT: RawInputSource = {
  poll() {},
  vibrate() {},
};

function createInput(canvas: HTMLCanvasElement, log: Logger): WebInputSource | null {
  try {
    return createWebInputSource(canvas);
  } catch (error) {
    // Sem adaptador o jogo ainda abre (splash, título); o erro fica no console e no relatório.
    log.error('adaptadores de input indisponíveis; o jogo segue sem entrada', error);
    return null;
  }
}

function createCanvas(doc: Document, container: HTMLElement): HTMLCanvasElement {
  const canvas = doc.createElement('canvas');
  canvas.id = 'bf-game';
  canvas.setAttribute('aria-label', 'BoboForces');
  container.appendChild(canvas);
  return canvas;
}

function isCanvas(value: unknown): value is HTMLCanvasElement {
  return typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement;
}

/**
 * platform-web: a `Platform` da casca web (tecnico.md §9, §11.1, §14.4, §18). DOM, `localStorage`, `fetch` e
 * `getExtension` (só o diagnóstico) ficam todos aqui dentro; o jogo recebe só a interface.
 *
 * Lança `WebGl2UnavailableError` se não houver WebGL2 (o boot troca o splash pela página de aviso). Aceita também
 * um canvas direto (`createWebPlatform(canvas)`), atalho para `{ canvas }`.
 */
export function createWebPlatform(target: HTMLCanvasElement | WebPlatformOptions = {}): WebPlatform {
  const options: WebPlatformOptions = isCanvas(target) ? { canvas: target } : target;
  const win = window;
  const doc = document;
  const log = createLogger('web');
  const warn = (message: string, error: unknown): void => log.warn(message, error);

  const features = computeFeatures(readFeatureEnv(win));
  const mobile = features.profileHint === 'mobile';
  const ownsCanvas = options.canvas === undefined;
  const canvas = options.canvas ?? createCanvas(doc, options.container ?? doc.body);
  let graphics: WebGraphics;
  try {
    graphics = createWebGraphics(canvas, {
      antialias: options.antialias ?? !mobile,
      maxPixelRatio: options.maxPixelRatio ?? (mobile ? 1.5 : 2),
      powerPreference: mobile ? 'default' : 'high-performance',
    });
  } catch (error) {
    if (ownsCanvas) canvas.remove();
    throw error;
  }

  const persistence = createStoragePersistence(win.navigator);
  void persistence.refresh();
  const storage = createWebStorage({
    backend: readLocalStorage(win),
    onWarning: warn,
    onWrite: () => persistence.requestIfGesture(),
  });
  const lifecycle = createWebLifecycle({ win, doc, flush: () => void storage.flush(), onWarning: warn });
  const unsubscribes = [
    lifecycle.onPause(() => void storage.flush()),
    graphics.onContextLost(() => {
      log.warn('contexto WebGL perdido; pausando');
      lifecycle.requestPause();
    }),
  ];
  const diagnostics = createWebDiagnostics({ win, build: BUILD_INFO, features, graphics, storage, persistence });
  const assets = createWebAssets(options.assetsBaseUrl ?? new URL('./', doc.baseURI).href, (url, init) =>
    win.fetch(url, init),
  );
  const files = createWebFiles(doc);
  const textInput = createWebTextInput(doc);
  const audio = createWebAudio(win);
  const guards = installShellGuards(win, features);
  const webInput = options.input ? null : createInput(canvas, log);
  // M1: `describeControllers` (contrato) vem da casca, com os mesmos índices dos adaptadores de `src/input`. Fonte
  // injetada pelos testes não é mexida se já tiver o seu.
  const getGamepads: GetGamepads = () => (win.navigator.getGamepads ? win.navigator.getGamepads() : null);
  const input: RawInputSource & Partial<Disposable> = withControllerInfo(
    options.input ?? webInput ?? NULL_INPUT,
    getGamepads,
  );
  let disposed = false;

  return {
    id: 'web',
    features,
    graphics,
    storage,
    assets,
    files,
    textInput,
    lifecycle,
    diagnostics,
    input,
    audio,
    online: null,
    persistence,
    webInput,
    now: () => win.performance.now(),
    requestFrame: (callback) => win.requestAnimationFrame(callback),
    cancelFrame: (handle) => win.cancelAnimationFrame(handle),
    exit() {
      // A web não tem "sair" (features.canExit = false): o equivalente é voltar ao título.
      if (options.onExit) {
        options.onExit();
        return;
      }
      lifecycle.setInMatch(false);
      void storage.flush().then(() => win.location.reload());
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const unsubscribe of unsubscribes) unsubscribe();
      input.dispose?.();
      guards.dispose();
      audio?.dispose();
      textInput.dispose();
      files.dispose();
      diagnostics.dispose();
      lifecycle.dispose();
      void storage.flush();
      graphics.dispose();
      if (ownsCanvas) canvas.remove();
    },
  };
}
