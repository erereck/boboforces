import type { GraphicsSurface, SafeAreaInsets } from '@boboforces/platform-api';
import type { Disposable, Unsubscribe } from '@boboforces/shared';

/** `getContext('webgl2')` devolveu `null` (navegador sem WebGL2, GPU na lista negra ou aceleração desligada). */
export class WebGl2UnavailableError extends Error {
  constructor() {
    super('WebGL2 indisponível neste navegador');
    this.name = 'WebGl2UnavailableError';
  }
}

export interface BufferSizeInput {
  /** Tamanho do canvas em px de layout (CSS). */
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly devicePixelRatio: number;
  /** Teto de DPR do perfil (PC 2, celular 1,5; tecnico.md §16.1). */
  readonly maxPixelRatio: number;
  /** Escala dinâmica de resolução, em (0, 1]. */
  readonly renderScale: number;
  /** Tamanho exato em px do aparelho (`devicePixelContentBoxSize`), quando o navegador informa. */
  readonly devicePixelWidth: number | undefined;
  readonly devicePixelHeight: number | undefined;
  /** Maior lado aceito (MAX_RENDERBUFFER_SIZE / MAX_VIEWPORT_DIMS). */
  readonly maxSize: number;
}

export interface BufferSize {
  width: number;
  height: number;
  pixelRatio: number;
}

/**
 * Tamanho do drawing buffer. Usa os px exatos do aparelho quando existem e o DPR não foi limitado (evita a borra de
 * arredondamento em DPR fracionário, ex.: 1,25 no Windows); senão, CSS × DPR limitado × escala. Nunca passa de
 * `maxSize` em nenhum lado (encolhe os dois, mantendo a proporção) e nunca fica abaixo de 1 px.
 */
export function computeBufferSize(input: BufferSizeInput, out: BufferSize): BufferSize {
  const dpr = input.devicePixelRatio > 0 ? input.devicePixelRatio : 1;
  const cappedDpr = Math.min(dpr, input.maxPixelRatio);
  const scale = Math.min(1, Math.max(0.01, input.renderScale));
  let w: number;
  let h: number;
  // Os px exatos só valem se baterem com CSS × DPR (±2 px de arredondamento): a emulação de DPR do Chromium headless
  // informa o box do aparelho sem escalar, e o canvas sairia em 1x num aparelho 2x.
  const exact =
    input.devicePixelWidth !== undefined &&
    input.devicePixelHeight !== undefined &&
    Math.abs(input.devicePixelWidth - input.cssWidth * dpr) <= 2 &&
    Math.abs(input.devicePixelHeight - input.cssHeight * dpr) <= 2;
  if (cappedDpr === dpr && exact) {
    w = input.devicePixelWidth * scale;
    h = input.devicePixelHeight * scale;
  } else {
    w = input.cssWidth * cappedDpr * scale;
    h = input.cssHeight * cappedDpr * scale;
  }
  const fit = Math.min(1, input.maxSize / Math.max(w, 1), input.maxSize / Math.max(h, 1));
  out.width = Math.max(1, Math.round(w * fit));
  out.height = Math.max(1, Math.round(h * fit));
  out.pixelRatio = cappedDpr * scale * fit;
  return out;
}

export interface WebGraphicsOptions {
  readonly antialias: boolean;
  readonly maxPixelRatio: number;
  readonly powerPreference: WebGLPowerPreference;
}

/** `GraphicsSurface` + os controles que só a casca web tem. */
export interface WebGraphics extends GraphicsSurface, Disposable {
  readonly canvas: HTMLCanvasElement;
  readonly context: WebGL2RenderingContext;
  readonly antialias: boolean;
  readonly maxPixelRatio: number;
  readonly renderScale: number;
  readonly contextLost: boolean;
  /** Escala dinâmica de resolução (tecnico.md §16.1), limitada a [0,25; 1]. */
  setRenderScale(scale: number): void;
  setMaxPixelRatio(maxPixelRatio: number): void;
  onContextLost(listener: () => void): Unsubscribe;
  onContextRestored(listener: () => void): Unsubscribe;
}

type ResizeListener = (width: number, height: number, pixelRatio: number) => void;

type MutableInsets = { -readonly [K in keyof SafeAreaInsets]: number };

/**
 * Sonda das margens seguras: um elemento invisível com `padding: env(safe-area-inset-*)`. Ler o padding computado é o
 * jeito portátil de saber o valor (não existe API de script para o `env()`). Só faz sentido com `viewport-fit=cover`
 * (index.html); fora do celular dá zero.
 */
function createSafeAreaProbe(doc: Document): HTMLElement | null {
  const body = doc.body as HTMLElement | null;
  if (!body) return null;
  const probe = doc.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText =
    'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) ' +
    'env(safe-area-inset-left,0px)';
  body.appendChild(probe);
  return probe;
}

function readSafeArea(win: Window, probe: HTMLElement | null, pixelRatio: number, out: MutableInsets): void {
  if (!probe) return;
  const style = win.getComputedStyle(probe);
  // CSS px → px reais do drawing buffer.
  out.top = Math.round((parseFloat(style.paddingTop) || 0) * pixelRatio);
  out.right = Math.round((parseFloat(style.paddingRight) || 0) * pixelRatio);
  out.bottom = Math.round((parseFloat(style.paddingBottom) || 0) * pixelRatio);
  out.left = Math.round((parseFloat(style.paddingLeft) || 0) * pixelRatio);
}

/**
 * Cria o contexto WebGL2 no canvas e mantém o drawing buffer no tamanho certo (ResizeObserver, com
 * `device-pixel-content-box` quando existe, e mudança de DPR por `matchMedia`). A plataforma é dona de
 * `canvas.width/height`: o render não deve redimensionar o canvas por conta própria.
 *
 * Contexto: sem alpha, sem stencil, antialias só no PC (tecnico.md §6.10), WebGL2 puro e sem extensões (regra 6).
 * Lança `WebGl2UnavailableError` se não der para criar.
 */
export function createWebGraphics(canvas: HTMLCanvasElement, options: WebGraphicsOptions): WebGraphics {
  const win = canvas.ownerDocument.defaultView ?? window;
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: options.antialias,
    depth: true,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: options.powerPreference,
    failIfMajorPerformanceCaveat: false,
  });
  if (!gl) throw new WebGl2UnavailableError();

  const maxDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array | null;
  const maxRenderbuffer = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number | null;
  const maxSize = Math.min(maxRenderbuffer || 4096, maxDims ? Math.min(maxDims[0] ?? 4096, maxDims[1] ?? 4096) : 4096);

  const resizeListeners = new Set<ResizeListener>();
  const lostListeners = new Set<() => void>();
  const restoredListeners = new Set<() => void>();
  let maxPixelRatio = options.maxPixelRatio;
  let renderScale = 1;
  let contextLost = false;
  let cssWidth = canvas.clientWidth || win.innerWidth;
  let cssHeight = canvas.clientHeight || win.innerHeight;
  let devicePixelWidth: number | undefined;
  let devicePixelHeight: number | undefined;
  const size: BufferSize = { width: 0, height: 0, pixelRatio: 1 };
  const safeArea: MutableInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  const safeProbe = createSafeAreaProbe(canvas.ownerDocument);

  function apply(): void {
    const prevW = size.width;
    const prevH = size.height;
    const prevRatio = size.pixelRatio;
    computeBufferSize(
      {
        cssWidth,
        cssHeight,
        devicePixelRatio: win.devicePixelRatio,
        maxPixelRatio,
        renderScale,
        devicePixelWidth,
        devicePixelHeight,
        maxSize,
      },
      size,
    );
    if (size.width === prevW && size.height === prevH && size.pixelRatio === prevRatio) return;
    // A margem segura muda com a rotação, que sempre muda o tamanho: basta reler aqui.
    readSafeArea(win, safeProbe, size.pixelRatio, safeArea);
    if (canvas.width !== size.width) canvas.width = size.width;
    if (canvas.height !== size.height) canvas.height = size.height;
    for (const listener of resizeListeners) listener(size.width, size.height, size.pixelRatio);
  }

  const observer = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (!entry) return;
    const content = entry.contentBoxSize?.[0];
    cssWidth = content ? content.inlineSize : entry.contentRect.width;
    cssHeight = content ? content.blockSize : entry.contentRect.height;
    const device = entry.devicePixelContentBoxSize?.[0];
    devicePixelWidth = device?.inlineSize;
    devicePixelHeight = device?.blockSize;
    apply();
  });
  try {
    observer.observe(canvas, { box: 'device-pixel-content-box' });
  } catch {
    // Safari não conhece `device-pixel-content-box`: cai para o content-box e para o matchMedia de DPR abaixo.
    observer.observe(canvas);
  }

  // Zoom do navegador ou janela arrastada para outra tela muda o DPR sem mudar o tamanho CSS.
  let dprQuery: MediaQueryList | null = null;
  function watchDpr(): void {
    dprQuery?.removeEventListener('change', onDprChange);
    dprQuery =
      typeof win.matchMedia === 'function' ? win.matchMedia(`(resolution: ${win.devicePixelRatio}dppx)`) : null;
    dprQuery?.addEventListener('change', onDprChange);
  }
  function onDprChange(): void {
    // Com DPR novo, os px exatos antigos não valem mais até o próximo callback do ResizeObserver.
    devicePixelWidth = undefined;
    devicePixelHeight = undefined;
    apply();
    watchDpr();
  }
  watchDpr();

  function onLost(event: Event): void {
    // Sem o preventDefault o navegador nunca devolve o contexto (tecnico.md §11.1).
    event.preventDefault();
    contextLost = true;
    for (const listener of lostListeners) listener();
  }
  function onRestored(): void {
    contextLost = false;
    for (const listener of restoredListeners) listener();
  }
  function onContextMenu(event: Event): void {
    event.preventDefault();
  }
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  canvas.addEventListener('contextmenu', onContextMenu);

  apply();

  return {
    kind: 'webgl2',
    canvas,
    context: gl,
    antialias: options.antialias,
    get width() {
      return size.width;
    },
    get height() {
      return size.height;
    },
    get pixelRatio() {
      return size.pixelRatio;
    },
    safeArea,
    get maxPixelRatio() {
      return maxPixelRatio;
    },
    get renderScale() {
      return renderScale;
    },
    get contextLost() {
      return contextLost;
    },
    onResize(listener) {
      resizeListeners.add(listener);
      return () => resizeListeners.delete(listener);
    },
    onContextLost(listener) {
      lostListeners.add(listener);
      return () => lostListeners.delete(listener);
    },
    onContextRestored(listener) {
      restoredListeners.add(listener);
      return () => restoredListeners.delete(listener);
    },
    setRenderScale(scale) {
      renderScale = Math.min(1, Math.max(0.25, scale));
      apply();
    },
    setMaxPixelRatio(next) {
      maxPixelRatio = Math.max(0.5, next);
      apply();
    },
    dispose() {
      observer.disconnect();
      safeProbe?.remove();
      dprQuery?.removeEventListener('change', onDprChange);
      dprQuery = null;
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      canvas.removeEventListener('contextmenu', onContextMenu);
      resizeListeners.clear();
      lostListeners.clear();
      restoredListeners.clear();
    },
  };
}
