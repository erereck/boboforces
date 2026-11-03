/**
 * O pedaço do nx.js (1.0.0-beta.7) que a casca usa, em interfaces locais mínimas. O `.d.ts` do `@nx.js/runtime` é um
 * lib global próprio (no-default-lib) que conflita com o lib DOM de que render/game precisam (docs/ARCHITECTURE.md
 * §6), então ele fica só como referência e tudo passa por aqui. Isso também deixa a casca testável com objetos falsos
 * (testes e portcheck).
 */

/** Pasta do jogo no SD (save, log, relatórios, importação). Decisão "Save no Switch" (DECISOES.md). */
export const SD_DIR = 'sdmc:/switch/boboforces';
/** Raiz dos assets empacotados no NRO/NSP (`build.ts` copia para `romfs/assets/`). */
export const ROMFS_ASSETS = 'romfs:/assets/';

/** Bits de `Gamepad.styleSet` (HidNpadStyleTag do libnx). */
export const NPAD_STYLE = {
  fullKey: 1 << 0,
  handheld: 1 << 1,
  joyDual: 1 << 2,
  joyLeft: 1 << 3,
  joyRight: 1 << 4,
} as const;

/** `Switch.appletType()` (AppletType do libnx). Só `application` tem a memória e o WebGL2 de que o jogo precisa. */
export const APPLET_TYPE = { application: 0, systemApplication: 4 } as const;
/** `Switch.operationMode()` (AppletOperationMode do libnx). */
export const OPERATION_MODE = { handheld: 0, console: 1 } as const;

export interface NxGamepadButton {
  readonly pressed: boolean;
  readonly value: number;
}

export interface NxGamepad {
  readonly connected: boolean;
  readonly id: string;
  readonly index: number;
  readonly axes: readonly number[];
  readonly buttons: readonly NxGamepadButton[];
  readonly styleSet?: number;
  readonly vibrationActuator?: {
    playEffect(
      type: 'dual-rumble',
      params: { duration: number; strongMagnitude: number; weakMagnitude: number },
    ): Promise<unknown>;
  } | null;
}

export interface NxStats {
  readonly size: number;
  readonly mtime: number;
}

/** Arquivos (`Switch.*`). Caminhos com protocolo: `sdmc:/…`, `romfs:/…`. */
export interface NxFs {
  readFileSync(path: string): ArrayBuffer | null;
  readFile(path: string): Promise<ArrayBuffer | null>;
  writeFileSync(path: string, data: string | Uint8Array): void;
  appendFileSync(path: string, data: string | Uint8Array): void;
  mkdirSync(path: string): number;
  removeSync(path: string): void;
  renameSync(path: string, dest: string): void;
  statSync(path: string): NxStats | null;
  readDirSync(path: string): string[] | null;
}

export interface NxVersions {
  readonly nxjs: string;
  readonly hos: string;
  readonly ams?: string | undefined;
  readonly emummc?: boolean | undefined;
}

export interface NxSwitch extends NxFs {
  readonly version: NxVersions;
  exit(): void;
  appletType(): number;
  operationMode(): number;
  memoryUsage?(): { readonly usedHeapSize: number; readonly heapSizeLimit: number };
}

/** O que o 2D do `screen` precisa ter para o aviso de "abra em modo aplicativo". */
export interface NxContext2D {
  fillStyle: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
}

export interface NxScreen {
  readonly width: number;
  readonly height: number;
  getContext(id: 'webgl2'): unknown;
  getContext(id: '2d'): NxContext2D | null;
}

export interface NxEvent {
  readonly type: string;
  readonly defaultPrevented?: boolean;
  preventDefault(): void;
  /** `error` */
  readonly error?: unknown;
  readonly message?: string;
  /** `unhandledrejection` */
  readonly reason?: unknown;
  /** `keydown`/`keyup` (teclado USB) */
  readonly code?: string;
}

export interface NxNavigator {
  getGamepads(): readonly (NxGamepad | null)[];
  readonly userAgent?: string;
}

/** Os globais do nx.js que a casca lê. */
export interface NxGlobals {
  readonly screen: NxScreen;
  readonly Switch: NxSwitch;
  readonly navigator: NxNavigator;
  readonly performance: { now(): number };
  requestAnimationFrame(callback: (nowMs: number) => void): number;
  cancelAnimationFrame(handle: number): void;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  addEventListener(type: string, listener: (event: NxEvent) => void): void;
  removeEventListener(type: string, listener: (event: NxEvent) => void): void;
  /** Ausente (ou falhando) quando não há áudio, como no boot do portcheck. */
  readonly AudioContext?: (new () => unknown) | undefined;
}

type Fn = (...args: never[]) => unknown;

/**
 * Lê os globais do nx.js de `scope` (normalmente `globalThis`), confere que existem e prende as funções ao escopo
 * (o nx.js, como o navegador, espera `this` = global em `requestAnimationFrame` e afins).
 */
export function readNxGlobals(scope: object): NxGlobals {
  const g = scope as Record<string, unknown>;
  const missing = ['screen', 'Switch', 'navigator', 'performance'].filter((k) => typeof g[k] !== 'object' || !g[k]);
  const fns = [
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'setTimeout',
    'clearTimeout',
    'addEventListener',
    'removeEventListener',
  ];
  missing.push(...fns.filter((k) => typeof g[k] !== 'function'));
  if (missing.length) throw new Error(`platform-switch: globais do nx.js ausentes: ${missing.join(', ')}`);
  const bind = <T extends Fn>(name: string): T => (g[name] as T).bind(scope) as T;
  const audio = g['AudioContext'];
  return {
    screen: g['screen'] as NxScreen,
    Switch: g['Switch'] as NxSwitch,
    navigator: g['navigator'] as NxNavigator,
    performance: g['performance'] as { now(): number },
    requestAnimationFrame: bind('requestAnimationFrame'),
    cancelAnimationFrame: bind('cancelAnimationFrame'),
    setTimeout: bind('setTimeout'),
    clearTimeout: bind('clearTimeout'),
    addEventListener: bind('addEventListener'),
    removeEventListener: bind('removeEventListener'),
    AudioContext: typeof audio === 'function' ? (audio as new () => unknown) : undefined,
  };
}

/** Texto de um erro qualquer, com pilha quando houver (para o runtime.log). */
export function describeError(error: unknown): string {
  // Sem `instanceof Error`: erros de outro realm (o vm do portcheck, módulos nativos) também têm pilha.
  if (error && typeof error === 'object' && 'message' in error) {
    const e = error as { name?: unknown; message?: unknown; stack?: unknown };
    return typeof e.stack === 'string' ? e.stack : `${String(e.name ?? 'Error')}: ${String(e.message)}`;
  }
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}
