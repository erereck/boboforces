import type { Diagnostics, MemoryUsage, PlatformFeatures, PlatformReport } from '@boboforces/platform-api';
import { RECENT_LOG_CAPACITY, RingBuffer, type Disposable } from '@boboforces/shared';
import type { BuildInfo } from './build-info.ts';

/** Linhas guardadas pelo `appendLog` (só memória na web; o Switch grava `runtime.log`). */
export const WEB_LOG_CAPACITY = 200;
const MAX_ERROR_CHARS = 2000;

/** Limites WebGL2 que entram no relatório (todos núcleo do WebGL2; nenhum precisa de extensão). */
const GL_LIMITS = [
  'MAX_TEXTURE_SIZE',
  'MAX_ARRAY_TEXTURE_LAYERS',
  'MAX_3D_TEXTURE_SIZE',
  'MAX_RENDERBUFFER_SIZE',
  'MAX_SAMPLES',
  'MAX_VERTEX_ATTRIBS',
  'MAX_TEXTURE_IMAGE_UNITS',
  'MAX_VERTEX_TEXTURE_IMAGE_UNITS',
  'MAX_COMBINED_TEXTURE_IMAGE_UNITS',
  'MAX_VERTEX_UNIFORM_VECTORS',
  'MAX_FRAGMENT_UNIFORM_VECTORS',
  'MAX_VARYING_VECTORS',
  'MAX_UNIFORM_BLOCK_SIZE',
  'MAX_DRAW_BUFFERS',
] as const;

export interface GlInfo {
  readonly gpu: string;
  readonly vendor: string;
  readonly limits: Readonly<Record<string, number>>;
}

/** Valores de RENDERER que os navegadores usam quando escondem a GPU de verdade. */
function isMaskedRenderer(renderer: string): boolean {
  return renderer === '' || /^(webkit webgl|webkit|mozilla)$/i.test(renderer.trim());
}

/**
 * GPU e limites do contexto. `WEBGL_debug_renderer_info` é a ÚNICA extensão pedida no jogo inteiro (regra 6, exceção
 * do diagnóstico da casca web), e só quando o RENDERER veio mascarado: o Firefox já entrega o nome e avisa no console
 * se alguém pedir a extensão.
 */
export function readGlInfo(gl: WebGL2RenderingContext): GlInfo {
  let gpu = String(gl.getParameter(gl.RENDERER) ?? '');
  let vendor = String(gl.getParameter(gl.VENDOR) ?? '');
  if (isMaskedRenderer(gpu)) {
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      gpu = String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ?? gpu);
      vendor = String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) ?? vendor);
    }
  }
  const limits: Record<string, number> = {};
  const enums = gl as unknown as Record<string, number>;
  for (const name of GL_LIMITS) {
    const value: unknown = gl.getParameter(enums[name] ?? 0);
    if (typeof value === 'number') limits[name] = value;
  }
  const viewport: unknown = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
  if (viewport instanceof Int32Array && viewport.length >= 2) {
    limits['MAX_VIEWPORT_WIDTH'] = viewport[0] ?? 0;
    limits['MAX_VIEWPORT_HEIGHT'] = viewport[1] ?? 0;
  }
  return { gpu: gpu || 'desconhecida', vendor: vendor || 'desconhecido', limits };
}

/** Tira query e fragmento de URLs (`#bot=…`, `#p=…` levam códigos do jogador; o relatório nunca inclui). */
export function scrubUrls(text: string): string {
  return text.replace(/\b((?:https?|blob):\/\/[^\s?#)'"]+)[?#][^\s)'"]*/g, '$1');
}

export function formatErrorText(text: string): string {
  const clean = scrubUrls(text);
  return clean.length > MAX_ERROR_CHARS ? clean.slice(0, MAX_ERROR_CHARS) + '…' : clean;
}

function describeReason(reason: unknown): string {
  if (reason instanceof Error) return reason.stack || `${reason.name}: ${reason.message}`;
  return String(reason);
}

export function formatErrorEvent(event: ErrorEvent): string {
  const where = event.filename ? ` @ ${event.filename}:${event.lineno}:${event.colno}` : '';
  const error: unknown = event.error;
  const stack = error instanceof Error && error.stack ? `\n${error.stack}` : '';
  return formatErrorText(`${event.message}${where}${stack}`);
}

export function formatRejection(reason: unknown): string {
  return formatErrorText(`promessa rejeitada: ${describeReason(reason)}`);
}

/** O que a diagnostics lê das outras peças da plataforma, no momento do relatório. */
export interface DiagnosticsSources {
  readonly win: Window;
  readonly build: BuildInfo;
  readonly features: PlatformFeatures;
  readonly graphics: {
    readonly context: WebGL2RenderingContext;
    readonly contextLost: boolean;
    readonly antialias: boolean;
    readonly width: number;
    readonly height: number;
    readonly renderScale: number;
    readonly maxPixelRatio: number;
  };
  readonly storage: { readonly durable: boolean; readonly failedWrites: number };
  readonly persistence: { readonly persisted: boolean | null; refresh(): Promise<boolean | null> };
}

export interface WebDiagnostics extends Diagnostics, Disposable {
  /** Últimos erros capturados (do mais antigo ao mais novo). */
  readonly errors: readonly string[];
  /** Copia as linhas do log em memória para `out` (painel F2). */
  readLog(out: string[]): number;
  memoryUsage(): MemoryUsage | null;
  recentLog(maxLines: number): readonly string[];
}

/** `performance.memory` (só Chromium, não padronizado): o resto dos navegadores não diz o heap. */
interface ChromiumMemory {
  readonly usedJSHeapSize?: number;
  readonly jsHeapSizeLimit?: number;
}

/**
 * Heap do JS para o F2, o bench e o item 14 do T0. Na web só o Chromium responde (`performance.memory`, em passos
 * grossos de propósito, contra fingerprinting); Firefox e Safari dão `null` e o relatório escreve -1.
 */
export function readMemoryUsage(perf: { readonly memory?: ChromiumMemory } | undefined): MemoryUsage | null {
  const memory = perf?.memory;
  const used = memory?.usedJSHeapSize;
  if (typeof used !== 'number' || !Number.isFinite(used) || used <= 0) return null;
  const limit = memory?.jsHeapSizeLimit;
  return { usedHeapBytes: used, heapLimitBytes: typeof limit === 'number' && limit > 0 ? limit : -1 };
}

/**
 * Diagnóstico sem coleta (decisão #42, tecnico.md §18): nada sai do aparelho sozinho. Captura `error` (inclusive
 * falha de carga de `<script>`/`<link>`, por isso em captura) e `unhandledrejection` num anel com os últimos 20, já
 * adotando os que o script inline do index.html pegou antes de qualquer módulo rodar.
 */
export function createWebDiagnostics(sources: DiagnosticsSources): WebDiagnostics {
  const { win } = sources;
  const errors = new RingBuffer<string>(RECENT_LOG_CAPACITY);
  const log = new RingBuffer<string>(WEB_LOG_CAPACITY);
  let errorCount = 0;
  let glInfo: GlInfo | null = null;

  function pushError(text: string): void {
    errorCount++;
    errors.push(text);
  }

  for (const early of win.__bfErr ?? []) pushError(formatErrorText(early));
  win.__bfErr = undefined;
  win.__bfCaptured = true;

  function onError(event: Event): void {
    // Erro de script chega como ErrorEvent (no window); falha de carga de recurso, como Event comum no elemento.
    if ('message' in event && 'filename' in event) {
      pushError(formatErrorEvent(event as ErrorEvent));
      return;
    }
    const target = event.target as { tagName?: unknown; src?: unknown; href?: unknown } | null;
    if (target && typeof target.tagName === 'string') {
      const url = typeof target.src === 'string' ? target.src : typeof target.href === 'string' ? target.href : '';
      pushError(formatErrorText(`falha ao carregar <${target.tagName.toLowerCase()}> ${url}`));
    }
  }
  function onRejection(event: PromiseRejectionEvent): void {
    pushError(formatRejection(event.reason));
  }
  win.addEventListener('error', onError, true);
  win.addEventListener('unhandledrejection', onRejection);

  function gl(): GlInfo {
    if (glInfo) return glInfo;
    if (sources.graphics.contextLost) return { gpu: 'desconhecida (contexto perdido)', vendor: '', limits: {} };
    glInfo = readGlInfo(sources.graphics.context);
    return glInfo;
  }

  return {
    get errors() {
      return errors.toArray();
    },
    async collectReport(): Promise<PlatformReport> {
      await sources.persistence.refresh();
      const info = gl();
      const nav = win.navigator as Navigator & { deviceMemory?: number };
      const g = sources.graphics;
      const standalone = typeof win.matchMedia === 'function' && win.matchMedia('(display-mode: standalone)').matches;
      const extra: Record<string, string> = {
        version: sources.build.version,
        codename: sources.build.codename,
        build: sources.build.build,
        profileHint: sources.features.profileHint,
        touch: String(sources.features.touch),
        keyboardMouse: String(sources.features.keyboardMouse),
        reducedMotion: String(sources.features.reducedMotion),
        glVendor: info.vendor,
        antialias: String(g.antialias),
        drawingBuffer: `${g.width}x${g.height}`,
        renderScale: String(g.renderScale),
        maxPixelRatio: String(g.maxPixelRatio),
        contextLost: String(g.contextLost),
        cores: String(nav.hardwareConcurrency || 0),
        deviceMemoryGb: nav.deviceMemory === undefined ? 'desconhecida' : String(nav.deviceMemory),
        language: nav.language,
        installed: String(standalone),
        storage: sources.storage.durable ? 'localStorage' : 'memória (não sobrevive ao fechar)',
        storageFailedWrites: String(sources.storage.failedWrites),
        errorCount: String(errorCount),
        errors: errors.toArray().join('\n---\n'),
      };
      return {
        platform: 'web',
        system: nav.userAgent,
        screen: { width: win.innerWidth, height: win.innerHeight, pixelRatio: win.devicePixelRatio },
        gpu: info.gpu,
        glLimits: info.limits,
        storagePersisted: sources.persistence.persisted,
        extra,
      };
    },
    appendLog(line) {
      log.push(formatErrorText(line));
    },
    readLog(out) {
      out.length = 0;
      log.forEach((line) => out.push(line));
      return out.length;
    },
    memoryUsage() {
      return readMemoryUsage((win as Window & { performance?: { memory?: ChromiumMemory } }).performance);
    },
    recentLog(maxLines) {
      const all = log.toArray();
      const n = Math.max(0, Math.floor(maxLines));
      return n >= all.length ? all : all.slice(all.length - n);
    },
    dispose() {
      win.removeEventListener('error', onError, true);
      win.removeEventListener('unhandledrejection', onRejection);
    },
  };
}
