/**
 * Globais FALSOS do nx.js para dar boot no bundle do Switch em `node:vm` (evolução do `test/platform.test.mjs` do
 * MMM). Fidelidade primeiro: o contexto só tem o que o nx.js 1.0.0-beta.7 declara (`NXJS_GLOBALS`); o que não está
 * na lista (document, self, Worker, HTMLCanvasElement…) NÃO existe, e usar dá ReferenceError, como no console.
 *
 * - Simulados de verdade: `screen` (sem WebGL2, com 2D que grava o texto), `Switch` (arquivos em memória com o
 *   RomFS do build e o SD), `navigator.getGamepads` (um Pro Controller parado), `requestAnimationFrame`, timers e
 *   `performance.now` num relógio falso, eventos globais, `console`, `fetch` só de `romfs:`/`sdmc:`.
 * - Rede (`fetch` http, `WebSocket`, `Switch.connect`…) registra a tentativa e falha: o Switch é offline.
 * - O resto da lista vira "armadilha": existe (então `typeof X` bate com o console), mas usar registra o nome e lança.
 *   `AudioContext` é armadilha de propósito: no boot sem áudio a casca usa `audio: null`.
 */
import { webcrypto } from 'node:crypto';

/** Globais declarados pelo `@nx.js/runtime` 1.0.0-beta.7 (`dist/index.d.ts`); um teste confere contra o pacote. */
export const NXJS_GLOBALS: readonly string[] = [
  'AbortController',
  'AbortSignal',
  'AmbientLightSensor',
  'Audio',
  'AudioBuffer',
  'AudioBufferSourceNode',
  'AudioContext',
  'AudioDestinationNode',
  'AudioNode',
  'AudioParam',
  'AudioScheduledSourceNode',
  'BaseAudioContext',
  'BatteryManager',
  'Blob',
  'Bluetooth',
  'BluetoothCharacteristicProperties',
  'BluetoothDevice',
  'BluetoothRemoteGATTCharacteristic',
  'BluetoothRemoteGATTServer',
  'BluetoothRemoteGATTService',
  'BluetoothUUID',
  'ByteLengthQueuingStrategy',
  'CONSOLE_SCREEN_CTX',
  'CanvasGradient',
  'CanvasRenderingContext2D',
  'CloseEvent',
  'CompressionStream',
  'Console',
  'CountQueuingStrategy',
  'Crypto',
  'CryptoKey',
  'CustomEvent',
  'DOMException',
  'DOMMatrix',
  'DOMMatrixReadOnly',
  'DOMPoint',
  'DOMPointReadOnly',
  'DOMRect',
  'DOMRectReadOnly',
  'DecompressionStream',
  'ErrorEvent',
  'Event',
  'EventTarget',
  'File',
  'FontFace',
  'FontFaceSet',
  'FormData',
  'GL_CONSTANTS',
  'GainNode',
  'Gamepad',
  'GamepadButton',
  'GamepadEvent',
  'GamepadHapticActuator',
  'Headers',
  'Image',
  'ImageBitmap',
  'ImageData',
  'KeyboardEvent',
  'MessageEvent',
  'Navigator',
  'OfflineAudioCompletionEvent',
  'OfflineAudioContext',
  'OffscreenCanvas',
  'OffscreenCanvasRenderingContext2D',
  'Path2D',
  'Performance',
  'PerformanceEntry',
  'PerformanceMark',
  'PerformanceMeasure',
  'PromiseRejectionEvent',
  'ReadableByteStreamController',
  'ReadableStream',
  'ReadableStreamBYOBReader',
  'ReadableStreamBYOBRequest',
  'ReadableStreamDefaultController',
  'ReadableStreamDefaultReader',
  'Request',
  'Response',
  'Screen',
  'StereoPannerNode',
  'Storage',
  'SubtleCrypto',
  'Terminal',
  'TextDecoder',
  'TextEncoder',
  'Touch',
  'TouchEvent',
  'TouchList',
  'TransformStream',
  'TransformStreamDefaultController',
  'UIEvent',
  'URL',
  'URLSearchParams',
  'USB',
  'USBAlternateInterface',
  'USBConfiguration',
  'USBDevice',
  'USBEndpoint',
  'USBInterface',
  'Video',
  'VirtualKeyboard',
  'WebGL2RenderingContext',
  'WebGLActiveInfo',
  'WebGLBuffer',
  'WebGLFramebuffer',
  'WebGLProgram',
  'WebGLQuery',
  'WebGLRenderbuffer',
  'WebGLSampler',
  'WebGLShader',
  'WebGLShaderPrecisionFormat',
  'WebGLSync',
  'WebGLTexture',
  'WebGLTransformFeedback',
  'WebGLUniformLocation',
  'WebGLVertexArrayObject',
  'WebSocket',
  'Window',
  'WritableStream',
  'WritableStreamDefaultController',
  'WritableStreamDefaultWriter',
  'addEventListener',
  'atob',
  'bluetooth',
  'btoa',
  'cancelAnimationFrame',
  'clearInterval',
  'clearTimeout',
  'console',
  'consoleFontAvailable',
  'createAudioBuffer',
  'createAudioParam',
  'createImageBitmap',
  'crypto',
  'dispatchEvent',
  'fetch',
  'fonts',
  'getSharedAudioContext',
  'kNativeDecompressSetup',
  'kNativeFileSource',
  'localStorage',
  'navigator',
  'performance',
  'queueMicrotask',
  'removeEventListener',
  'requestAnimationFrame',
  'screen',
  'setContextState',
  'setInterval',
  'setTimeout',
  'stopImmediatePropagationFlag',
  'trackActiveSource',
  'usb',
  'window',
];

/** Globais internos do runtime que não existem para o app (declarados no .d.ts só por tipagem). */
const INTERNAL = new Set([
  'CONSOLE_SCREEN_CTX',
  'kNativeDecompressSetup',
  'kNativeFileSource',
  'stopImmediatePropagationFlag',
  'createAudioParam',
  'setContextState',
  'trackActiveSource',
  'GL_CONSTANTS',
]);

/** Globais em minúscula que são funções (o resto em minúscula é objeto). */
const TRAP_FUNCTIONS = new Set([
  'consoleFontAvailable',
  'createImageBitmap',
  'createAudioBuffer',
  'getSharedAudioContext',
]);

/** Do Node para o contexto, porque o nx.js tem o mesmo (Web APIs comuns). */
const PASSTHROUGH = [
  'AbortController',
  'AbortSignal',
  'Blob',
  'ByteLengthQueuingStrategy',
  'CompressionStream',
  'CountQueuingStrategy',
  'CustomEvent',
  'DOMException',
  'DecompressionStream',
  'Event',
  'EventTarget',
  'File',
  'FormData',
  'Headers',
  'ReadableStream',
  'Request',
  'Response',
  'TextDecoder',
  'TransformStream',
  'URL',
  'URLSearchParams',
  'WritableStream',
  'atob',
  'btoa',
  'queueMicrotask',
] as const;

export const SD_ROOT = 'sdmc:/switch/boboforces';
export const RUNTIME_LOG = `${SD_ROOT}/runtime.log`;
/** `Switch.appletType()` falso: library applet, coerente com "sem WebGL2". */
const FAKE_APPLET_TYPE = 2;
/** `Switch.operationMode()` falso: dock. */
const FAKE_OPERATION_MODE = 1;

/** O Switch real fecharia o app; aqui interrompe o callback que chamou `Switch.exit()`. */
export class ExitSignal extends Error {
  constructor() {
    super('Switch.exit()');
    this.name = 'ExitSignal';
  }
}

export interface ConsoleLine {
  readonly level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  readonly text: string;
}

interface Timer {
  readonly id: number;
  at: number;
  readonly every: number | null;
  readonly callback: (...args: unknown[]) => void;
  readonly args: unknown[];
}

type Listener = (event: unknown) => unknown;

/** Construtores do realm do vm, para devolver bytes que passem em `instanceof` lá dentro. */
export interface Realm {
  readonly ArrayBuffer: ArrayBufferConstructor;
  readonly Uint8Array: Uint8ArrayConstructor;
}

export interface FakeNxOptions {
  /** Arquivos do RomFS (caminho relativo, com `/`) → bytes. */
  readonly romfs: ReadonlyMap<string, Uint8Array>;
  /** Arquivos já existentes no SD (caminho completo `sdmc:/…`). */
  readonly sd?: ReadonlyMap<string, Uint8Array>;
}

export interface FakeNx {
  /** Objeto a passar para `vm.createContext`. */
  readonly sandbox: Record<string, unknown>;
  /** Arquivos (`romfs:/…` e `sdmc:/…`) depois do boot. */
  readonly files: Map<string, Uint8Array>;
  readonly console: ConsoleLine[];
  /** APIs do nx.js usadas mas não simuladas. */
  readonly traps: string[];
  /** Tentativas de rede. */
  readonly network: string[];
  /** Textos desenhados no Canvas 2D do `screen`. */
  readonly drawnText: string[];
  /** Pedidos de contexto ao `screen` (`webgl2`, `2d`). */
  readonly contexts: string[];
  readonly exits: { count: number };
  /** Frames pedidos ao `requestAnimationFrame`. */
  readonly framesRequested: { count: number };
  now(): number;
  /** Liga os construtores do realm do vm (chamar logo depois do `createContext`). */
  setRealm(realm: Realm): void;
  /** Avança o relógio e roda os timers vencidos. */
  advance(ms: number): void;
  /** Roda os callbacks de `requestAnimationFrame` pendentes; devolve quantos rodaram. */
  runFrame(onError: (error: unknown) => void): number;
  /** Dispara um evento global; devolve se algum listener chamou `preventDefault()`. */
  dispatch(type: string, init?: Record<string, unknown>): boolean;
  readText(path: string): string | null;
}

export function createFakeNx(opts: FakeNxOptions): FakeNx {
  let clock = 0;
  let realm: Realm = { ArrayBuffer, Uint8Array };
  const files = new Map<string, Uint8Array>();
  for (const [rel, bytes] of opts.romfs) files.set(`romfs:/${rel}`, bytes);
  for (const [path, bytes] of opts.sd ?? []) files.set(path, bytes);
  const dirs = new Set<string>();
  const consoleLines: ConsoleLine[] = [];
  const traps: string[] = [];
  const network: string[] = [];
  const drawnText: string[] = [];
  const contexts: string[] = [];
  const exits = { count: 0 };
  const framesRequested = { count: 0 };
  const listeners = new Map<string, Listener[]>();
  let rafQueue: { id: number; callback: (now: number) => void }[] = [];
  let rafId = 0;
  const timers: Timer[] = [];
  let timerId = 0;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const trap = (name: string): never => {
    traps.push(name);
    throw new Error(`portcheck: ${name} existe no nx.js mas não é simulado no boot sem GPU`);
  };
  const trapClass = (name: string): unknown =>
    class {
      constructor() {
        trap(name);
      }
    };
  const trapFunction = (name: string) => (): never => trap(name);
  const trapObject = (name: string): unknown =>
    new Proxy(
      {},
      {
        get: (_target, key) =>
          key === Symbol.toPrimitive || key === 'then' ? undefined : trapFunction(`${name}.${String(key)}`),
      },
    );
  const networkAttempt = (what: string): never => {
    network.push(what);
    throw new Error(`portcheck: rede proibida no Switch (${what})`);
  };

  /** Bytes do realm do vm (para `instanceof Uint8Array` lá dentro dar certo). */
  const toRealmBuffer = (bytes: Uint8Array): ArrayBuffer => {
    const buffer = new realm.ArrayBuffer(bytes.length);
    new realm.Uint8Array(buffer).set(bytes);
    return buffer;
  };
  const toBytes = (data: unknown): Uint8Array => {
    if (typeof data === 'string') return encoder.encode(data);
    if (ArrayBuffer.isView(data))
      return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    if (data && typeof data === 'object' && 'byteLength' in data) return new Uint8Array((data as ArrayBuffer).slice(0));
    throw new TypeError('portcheck: Switch.writeFileSync com dado inválido');
  };
  const parentOf = (path: string): string => path.slice(0, path.lastIndexOf('/'));
  const mtimes = new Map<string, number>();
  const write = (path: string, bytes: Uint8Array): void => {
    const dir = parentOf(path);
    if (path.startsWith('romfs:')) throw new Error(`portcheck: RomFS é somente leitura (${path})`);
    if (!dirs.has(dir) && dir !== 'sdmc:') throw new Error(`portcheck: pasta ${dir} não existe (faltou mkdirSync)`);
    files.set(path, bytes);
    mtimes.set(path, clock);
  };

  const Switch = {
    version: { nxjs: '1.0.0-beta.7', hos: '20.0.0', ams: '1.9.0', emummc: true, v8: 'portcheck' },
    readFileSync(path: string): ArrayBuffer | null {
      const bytes = files.get(String(path));
      return bytes ? toRealmBuffer(bytes) : null;
    },
    readFile(path: string): Promise<ArrayBuffer | null> {
      return Promise.resolve(Switch.readFileSync(path));
    },
    writeFileSync(path: string, data: unknown): void {
      write(String(path), toBytes(data));
    },
    appendFileSync(path: string, data: unknown): void {
      const p = String(path);
      const previous = files.get(p) ?? new Uint8Array();
      const extra = toBytes(data);
      const joined = new Uint8Array(previous.length + extra.length);
      joined.set(previous);
      joined.set(extra, previous.length);
      write(p, joined);
    },
    mkdirSync(path: string): number {
      let created = 0;
      const parts = String(path).replace(/\/+$/, '').split('/');
      for (let i = 2; i <= parts.length; i++) {
        const dir = parts.slice(0, i).join('/');
        if (!dirs.has(dir)) {
          dirs.add(dir);
          created++;
        }
      }
      return created;
    },
    removeSync(path: string): void {
      files.delete(String(path));
    },
    renameSync(path: string, dest: string): void {
      const bytes = files.get(String(path));
      if (!bytes) throw new Error(`portcheck: ${String(path)} não existe`);
      files.delete(String(path));
      write(String(dest), bytes);
    },
    statSync(path: string): { size: number; mtime: number } | null {
      const bytes = files.get(String(path));
      return bytes ? { size: bytes.length, mtime: mtimes.get(String(path)) ?? 0 } : null;
    },
    readDirSync(path: string): string[] | null {
      const prefix = `${String(path).replace(/\/+$/, '')}/`;
      const names = new Set<string>();
      for (const f of files.keys()) if (f.startsWith(prefix)) names.add(f.slice(prefix.length).split('/')[0] as string);
      return names.size || dirs.has(prefix.slice(0, -1)) ? [...names].sort() : null;
    },
    exit(): never {
      exits.count++;
      throw new ExitSignal();
    },
    appletType: (): number => FAKE_APPLET_TYPE,
    operationMode: (): number => FAKE_OPERATION_MODE,
    memoryUsage: () => ({ usedHeapSize: 8 << 20, totalHeapSize: 16 << 20, heapSizeLimit: 256 << 20 }),
    cwd: (): string => 'romfs:/',
    connect: (address: unknown): never => networkAttempt(`Switch.connect(${String(address)})`),
    listen: (): never => networkAttempt('Switch.listen'),
    listenDatagram: (): never => networkAttempt('Switch.listenDatagram'),
    resolveDns: (host: unknown): never => networkAttempt(`Switch.resolveDns(${String(host)})`),
    networkInfo: (): never => networkAttempt('Switch.networkInfo'),
  };

  // Canvas 2D que só registra o texto (o aviso de "modo aplicativo").
  const ctx2dState: Record<string, unknown> = {
    fillStyle: '#000',
    strokeStyle: '#000',
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    fillText: (text: unknown) => void drawnText.push(String(text)),
    measureText: (text: unknown) => ({ width: String(text).length * 10 }),
  };
  const ctx2d = new Proxy(ctx2dState, {
    get: (target, key) => (typeof key === 'string' && key in target ? target[key] : () => undefined),
    set: (target, key, value) => {
      if (typeof key === 'string') target[key] = value;
      return true;
    },
  });
  let contextKind: string | null = null;
  const screen = {
    width: 1280,
    height: 720,
    availWidth: 1280,
    availHeight: 720,
    getContext(id: unknown): unknown {
      contexts.push(String(id));
      // Sem WebGL2 (como no applet). E, como no nx.js, um tipo de contexto por canvas: depois do 2D, nada de outro.
      if (id !== '2d' || (contextKind !== null && contextKind !== id)) return null;
      contextKind = id;
      return ctx2d;
    },
    addEventListener(): void {},
    removeEventListener(): void {},
  };

  const button = () => ({ pressed: false, touched: false, value: 0 });
  const proController = {
    connected: true,
    id: 'Pro Controller (portcheck)',
    index: 0,
    mapping: 'standard',
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 16 }, button),
    styleSet: 1, // FullKey
    rawButtons: 0n,
    deviceType: 0,
    vibrationActuator: {
      type: 'dual-rumble',
      playEffect: () => Promise.resolve('complete'),
      reset: () => Promise.resolve('complete'),
    },
  };
  const navigator = {
    userAgent: 'BoboForces portcheck (nx.js falso)',
    platform: 'Horizon arm64',
    maxTouchPoints: 0,
    getGamepads: () => [proController, null, null, null, null, null, null, null],
    vibrate: () => false,
    getBattery: trapFunction('navigator.getBattery'),
    virtualKeyboard: trapObject('navigator.virtualKeyboard'),
  };

  const addTimer = (callback: unknown, ms: unknown, every: boolean, args: unknown[]): number => {
    if (typeof callback !== 'function') throw new TypeError('portcheck: timer sem função (string não é aceita)');
    const delay = Math.max(0, Number(ms) || 0);
    timers.push({
      id: ++timerId,
      at: clock + delay,
      every: every ? Math.max(1, delay) : null,
      callback: callback as Timer['callback'],
      args,
    });
    return timerId;
  };
  const clearTimer = (id: unknown): void => {
    const i = timers.findIndex((t) => t.id === id);
    if (i >= 0) timers.splice(i, 1);
  };

  const makeConsole = () => {
    const out =
      (level: ConsoleLine['level']) =>
      (...args: unknown[]) => {
        consoleLines.push({ level, text: args.map((a) => (typeof a === 'string' ? a : safeString(a))).join(' ') });
      };
    return {
      log: out('log'),
      info: out('info'),
      warn: out('warn'),
      error: out('error'),
      debug: out('debug'),
      trace: out('debug'),
    };
  };

  const fakeFetch = (input: unknown): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : String((input as { url?: unknown })?.url ?? input);
    if (url.startsWith('romfs:/') || url.startsWith('sdmc:/')) {
      const bytes = files.get(url.split(/[?#]/)[0] as string);
      return Promise.resolve(bytes ? new Response(bytes.slice()) : new Response(null, { status: 404 }));
    }
    try {
      networkAttempt(`fetch(${url})`);
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.reject(new Error('inalcançável'));
  };

  const sandbox: Record<string, unknown> = {};
  for (const name of NXJS_GLOBALS) {
    if (INTERNAL.has(name)) continue;
    const first = name[0] as string;
    if (first === first.toUpperCase()) sandbox[name] = trapClass(name);
    else sandbox[name] = TRAP_FUNCTIONS.has(name) ? trapFunction(name) : trapObject(name);
  }
  // O `window` do nx.js é o próprio global: o boot liga `globalThis.window = globalThis` depois do createContext.
  delete sandbox['window'];
  for (const name of PASSTHROUGH) sandbox[name] = (globalThis as Record<string, unknown>)[name];
  Object.assign(sandbox, {
    screen,
    Switch,
    navigator,
    console: makeConsole(),
    crypto: webcrypto,
    fetch: fakeFetch,
    localStorage: undefined, // `userAccountSaveDataSize: 0` no NACP desliga o localStorage do nx.js
    performance: { now: () => clock, timeOrigin: 0, mark: () => undefined, measure: () => undefined },
    requestAnimationFrame: (callback: unknown) => {
      if (typeof callback !== 'function') throw new TypeError('requestAnimationFrame sem função');
      framesRequested.count++;
      rafQueue.push({ id: ++rafId, callback: callback as (now: number) => void });
      return rafId;
    },
    cancelAnimationFrame: (id: unknown) => {
      rafQueue = rafQueue.filter((r) => r.id !== id);
    },
    setTimeout: (cb: unknown, ms?: unknown, ...args: unknown[]) => addTimer(cb, ms, false, args),
    setInterval: (cb: unknown, ms?: unknown, ...args: unknown[]) => addTimer(cb, ms, true, args),
    clearTimeout: clearTimer,
    clearInterval: clearTimer,
    addEventListener: (type: unknown, listener: unknown) => {
      if (typeof listener !== 'function') return;
      const list = listeners.get(String(type)) ?? [];
      list.push(listener as Listener);
      listeners.set(String(type), list);
    },
    removeEventListener: (type: unknown, listener: unknown) => {
      const list = listeners.get(String(type));
      if (list)
        listeners.set(
          String(type),
          list.filter((l) => l !== listener),
        );
    },
    dispatchEvent: (event: unknown) => {
      for (const l of listeners.get(String((event as { type?: unknown })?.type)) ?? []) l(event);
      return true;
    },
    WebSocket: class {
      constructor(url: unknown) {
        networkAttempt(`new WebSocket(${String(url)})`);
      }
    },
    structuredClone,
  });
  // `TextEncoder` devolvendo bytes do realm do vm.
  sandbox['TextEncoder'] = class {
    readonly encoding = 'utf-8';
    encode(text?: string): Uint8Array {
      const bytes = encoder.encode(text);
      const out = new realm.Uint8Array(bytes.length);
      out.set(bytes);
      return out;
    }
  };

  return {
    sandbox,
    files,
    console: consoleLines,
    traps,
    network,
    drawnText,
    contexts,
    exits,
    framesRequested,
    now: () => clock,
    setRealm(r) {
      realm = r;
    },
    advance(ms) {
      const target = clock + ms;
      for (;;) {
        let next: Timer | undefined;
        for (const t of timers) if (t.at <= target && (!next || t.at < next.at)) next = t;
        if (!next) break;
        clock = Math.max(clock, next.at);
        if (next.every === null) clearTimer(next.id);
        else next.at += next.every;
        next.callback(...next.args);
      }
      clock = target;
    },
    runFrame(onError) {
      const queue = rafQueue;
      rafQueue = [];
      for (const r of queue) {
        try {
          r.callback(clock);
        } catch (error) {
          onError(error);
        }
      }
      return queue.length;
    },
    dispatch(type, init = {}) {
      let prevented = false;
      const event = {
        type,
        ...init,
        get defaultPrevented() {
          return prevented;
        },
        preventDefault() {
          prevented = true;
        },
      };
      for (const l of listeners.get(type) ?? []) l(event);
      return prevented;
    },
    readText(path) {
      const bytes = files.get(path);
      return bytes ? decoder.decode(bytes) : null;
    },
  };

  function safeString(value: unknown): string {
    if (value instanceof Error || (value && typeof value === 'object' && 'stack' in value)) {
      return String((value as Error).stack ?? value);
    }
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  }
}
