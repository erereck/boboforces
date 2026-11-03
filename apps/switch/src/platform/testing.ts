/**
 * nx.js falso e leve para os testes da casca (dados sintéticos, sem vm). O portcheck tem a versão completa, que roda
 * o bundle de verdade num realm separado.
 */
import type { NxEvent, NxGamepad, NxGlobals, NxStats } from './nx.ts';

export interface FakeSwitch {
  readonly nx: NxGlobals;
  readonly files: Map<string, Uint8Array>;
  /** Texto desenhado pelo Canvas 2D. */
  readonly drawn: string[];
  /** Chamadas de `clear` no WebGL2 falso (o aviso de falha com GPU desenha só com scissor + clear). */
  readonly glClears: { count: number };
  readonly pads: (NxGamepad | null)[];
  readonly exits: { count: number };
  /** Dispara um evento global; devolve se algum listener cancelou. */
  dispatch(type: string, extra?: Partial<NxEvent>): boolean;
  /** Roda o próximo frame com o relógio em `nowMs`. */
  frame(nowMs: number): void;
  /** Roda os timers vencidos até `nowMs`. */
  advance(nowMs: number): void;
  setOperationMode(mode: number): void;
  text(path: string): string | null;
}

export interface FakeSwitchOptions {
  readonly gpu?: boolean;
  readonly files?: Record<string, string>;
}

export function pad(index: number, styleSet: number, pressed: number[] = []): NxGamepad {
  return {
    connected: true,
    id: `pad-${index}`,
    index,
    axes: [0.5, -0.25, 0, 1],
    buttons: Array.from({ length: 16 }, (_, b) => ({
      pressed: pressed.includes(b),
      value: pressed.includes(b) ? 1 : 0,
    })),
    styleSet,
  };
}

export function createFakeSwitch(opts: FakeSwitchOptions = {}): FakeSwitch {
  const enc = new TextEncoder();
  const files = new Map<string, Uint8Array>();
  for (const [path, text] of Object.entries(opts.files ?? {})) files.set(path, enc.encode(text));
  const mtimes = new Map<string, number>();
  const drawn: string[] = [];
  const pads: (NxGamepad | null)[] = [pad(0, 1)];
  const exits = { count: 0 };
  const listeners = new Map<string, ((e: NxEvent) => void)[]>();
  const timers: { id: number; at: number; cb: () => void }[] = [];
  let raf: ((now: number) => void)[] = [];
  let clock = 0;
  let nextId = 1;
  let mode = 1;
  const toBytes = (data: string | Uint8Array): Uint8Array =>
    typeof data === 'string' ? enc.encode(data) : data.slice();
  const ctx2d = {
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    fillRect() {},
    fillText(text: string) {
      drawn.push(text);
    },
  };
  const glClears = { count: 0 };
  const noop = (): void => {};
  const gl = {
    getParameter: (p: number) => (p === 0x1f01 ? 'NVIDIA Tegra X1 (falsa)' : p === 0x0d33 ? 16384 : null),
    bindFramebuffer: noop,
    viewport: noop,
    colorMask: noop,
    enable: noop,
    disable: noop,
    scissor: noop,
    clearColor: noop,
    clear: () => void glClears.count++,
  };

  // Como no nx.js: cada canvas aceita UM tipo de contexto; depois do primeiro, o outro tipo vem `null`.
  let contextKind: string | null = null;
  function getContext(id: 'webgl2'): unknown;
  function getContext(id: '2d'): typeof ctx2d | null;
  function getContext(id: string): unknown {
    const ctx = id === 'webgl2' ? (opts.gpu ? gl : null) : id === '2d' ? ctx2d : null;
    if (ctx === null || (contextKind !== null && contextKind !== id)) return null;
    contextKind = id;
    return ctx;
  }

  const nx: NxGlobals = {
    screen: { width: 1280, height: 720, getContext },
    Switch: {
      version: { nxjs: '1.0.0-beta.7', hos: '20.0.0', ams: '1.9.0', emummc: false },
      readFileSync: (p) => {
        const b = files.get(p);
        return b ? (b.slice().buffer as ArrayBuffer) : null;
      },
      readFile: (p) => Promise.resolve(nx.Switch.readFileSync(p)),
      writeFileSync: (p, d) => {
        files.set(p, toBytes(d));
        mtimes.set(p, clock);
      },
      appendFileSync: (p, d) => {
        const prev = files.get(p) ?? new Uint8Array();
        const add = toBytes(d);
        const out = new Uint8Array(prev.length + add.length);
        out.set(prev);
        out.set(add, prev.length);
        files.set(p, out);
      },
      mkdirSync: () => 0,
      removeSync: (p) => void files.delete(p),
      renameSync: (p, d) => {
        const b = files.get(p);
        if (!b) throw new Error(`${p} não existe`);
        files.delete(p);
        files.set(d, b);
      },
      statSync: (p): NxStats | null => {
        const b = files.get(p);
        return b ? { size: b.length, mtime: mtimes.get(p) ?? 0 } : null;
      },
      readDirSync: (dir) => {
        const names = [...files.keys()].filter((f) => f.startsWith(`${dir}/`)).map((f) => f.slice(dir.length + 1));
        return names.length ? names : null;
      },
      exit: () => {
        exits.count++;
      },
      appletType: () => (opts.gpu ? 0 : 2),
      operationMode: () => mode,
    },
    navigator: { getGamepads: () => pads },
    performance: { now: () => clock },
    requestAnimationFrame: (cb) => {
      raf.push(cb);
      return raf.length;
    },
    cancelAnimationFrame: () => {},
    setTimeout: (cb, ms) => {
      const id = nextId++;
      timers.push({ id, at: clock + ms, cb });
      return id;
    },
    clearTimeout: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    addEventListener: (type, l) => listeners.set(type, [...(listeners.get(type) ?? []), l]),
    removeEventListener: (type, l) =>
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((x) => x !== l),
      ),
    AudioContext: undefined,
  };

  return {
    nx,
    files,
    drawn,
    glClears,
    pads,
    exits,
    dispatch(type, extra = {}) {
      let prevented = false;
      const event: NxEvent = { type, ...extra, preventDefault: () => void (prevented = true) };
      for (const l of listeners.get(type) ?? []) l(event);
      return prevented;
    },
    frame(nowMs) {
      clock = nowMs;
      const run = raf;
      raf = [];
      for (const cb of run) cb(nowMs);
    },
    advance(nowMs) {
      clock = nowMs;
      for (const t of [...timers].sort((a, b) => a.at - b.at)) {
        if (t.at > nowMs) continue;
        timers.splice(timers.indexOf(t), 1);
        t.cb();
      }
    },
    setOperationMode(m) {
      mode = m;
    },
    text(path) {
      const b = files.get(path);
      return b ? new TextDecoder().decode(b) : null;
    },
  };
}
