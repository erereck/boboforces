/**
 * Boot do bundle do Switch em `node:vm` com os globais falsos do nx.js (tecnico.md §3 e §20): roda o `main.js` sem
 * GPU (o jogo sobe com o NullRenderer) e avança frames num relógio falso até o primeiro frame do menu.
 *
 * Como saber que o menu apareceu: o `game` grava `MENU_READY_MARKER` no log da plataforma
 * (`platform.diagnostics.appendLog`), que no Switch vai para `sdmc:/switch/boboforces/runtime.log`. Serve também no
 * console de verdade (Teste Zero: "do boot ao menu em até 4 s").
 */
import { setImmediate as nextMacrotask } from 'node:timers/promises';
import vm from 'node:vm';
import { ExitSignal, RUNTIME_LOG, createFakeNx, type ConsoleLine, type FakeNx } from './fake-nx.ts';

/** Linha (ou começo de linha) que o game grava no log no primeiro frame do menu. */
export const MENU_READY_MARKER = '[boot] menu-ready';

/** Texto do aviso de application mode que a casca desenha sem GPU (tecnico.md §11.2). */
export const APPLET_NOTICE = 'Abra segurando R ou instale o NSP';

export type BootStatus = 'ok' | 'pendente' | 'falha';

export interface BootOptions {
  readonly code: string;
  /** Nome do arquivo nas pilhas de erro (o source map mapeia a partir dele). */
  readonly filename: string;
  readonly romfs: ReadonlyMap<string, Uint8Array>;
  /** Teto de frames simulados (padrão 600 = 10 s a 60 Hz). */
  readonly maxFrames?: number;
  /** Frames extras depois do menu, para pegar erro logo após ele aparecer (padrão 30). */
  readonly settleFrames?: number;
  readonly frameMs?: number;
  /** Tempo real máximo de cada trecho síncrono (boot e cada frame), em ms. */
  readonly timeoutMs?: number;
}

export interface BootReport {
  readonly status: BootStatus;
  /** Motivos da falha ou da pendência (vazio quando ok). */
  readonly problems: string[];
  /** Avisos que não reprovam (APIs-armadilha tocadas, console.warn…). */
  readonly notes: string[];
  readonly bootError: string | null;
  readonly frameErrors: string[];
  readonly framesRequested: number;
  readonly framesRun: number;
  /** Frame (1-based) em que o marcador do menu apareceu, ou `null`. */
  readonly menuReadyFrame: number | null;
  /** Tempo simulado até o menu, em ms. */
  readonly menuReadyMs: number | null;
  readonly appletNotice: boolean;
  /** O `+` (beforeunload) fecharia o app? Sem GPU tem que fechar: não há menu para sair. */
  readonly plusExits: boolean;
  readonly network: string[];
  readonly traps: string[];
  readonly console: ConsoleLine[];
  readonly exitCalls: number;
  readonly runtimeLog: string;
}

/** O que `apps/switch/src/main.ts` expõe em `globalThis.BOBOFORCES_SWITCH`. */
interface DebugHandle {
  readonly game?: unknown;
  readonly bootError?: string | null;
}

function describe(error: unknown): string {
  if (error && typeof error === 'object' && 'stack' in error && typeof error.stack === 'string') return error.stack;
  return String(error);
}

async function settle(): Promise<void> {
  // Microtarefas do vm e do Node dividem a mesma fila: uma volta de macrotarefa esvazia as duas.
  await nextMacrotask();
}

export async function bootBundle(opts: BootOptions): Promise<BootReport> {
  const maxFrames = opts.maxFrames ?? 600;
  const settleFrames = opts.settleFrames ?? 30;
  const frameMs = opts.frameMs ?? 1000 / 60;
  const timeout = opts.timeoutMs ?? 10_000;
  const env: FakeNx = createFakeNx({ romfs: opts.romfs });
  const context = vm.createContext(env.sandbox, { name: 'nx.js (portcheck)' });
  vm.runInContext('globalThis.window = globalThis;', context);
  env.setRealm({
    ArrayBuffer: vm.runInContext('ArrayBuffer', context) as ArrayBufferConstructor,
    Uint8Array: vm.runInContext('Uint8Array', context) as Uint8ArrayConstructor,
  });

  const problems: string[] = [];
  const notes: string[] = [];
  const frameErrors: string[] = [];
  let bootError: string | null = null;
  let exited = false;

  const onRejection = (reason: unknown): void => {
    frameErrors.push(`promessa rejeitada sem tratamento: ${describe(reason)}`);
    env.dispatch('unhandledrejection', { reason });
  };
  process.on('unhandledRejection', onRejection);

  const onFrameError = (error: unknown): void => {
    if (error instanceof ExitSignal || (error as { name?: unknown })?.name === 'ExitSignal') {
      exited = true;
      return;
    }
    frameErrors.push(describe(error));
    env.dispatch('error', { error, message: String((error as { message?: unknown })?.message ?? error) });
  };
  (env.sandbox as Record<string, unknown>)['__portcheckFrame'] = () => env.runFrame(onFrameError);
  const frameScript = new vm.Script('__portcheckFrame()', { filename: 'portcheck-frame.js' });

  try {
    // O bundle é ESM sem import/export (a varredura garante): roda como script estrito dentro de uma função async,
    // o que aceita `await` no topo. O prefixo fica na linha 1 para não deslocar as linhas do source map.
    const wrapped = `"use strict";(async () => {${opts.code}\n})()`;
    const script = new vm.Script(wrapped, { filename: opts.filename });
    const done = script.runInContext(context, { timeout }) as Promise<unknown>;
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), timeout)));
    try {
      if ((await Promise.race([done, limit])) === 'timeout') bootError = `o main.js não terminou em ${timeout} ms`;
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    if (error instanceof ExitSignal || (error as { name?: unknown })?.name === 'ExitSignal') exited = true;
    else bootError = describe(error);
  }
  await settle();

  const readLog = (): string => env.readText(RUNTIME_LOG) ?? '';
  let framesRun = 0;
  let menuReadyFrame: number | null = null;
  let menuReadyMs: number | null = null;
  if (!bootError && !exited) {
    for (let frame = 1; frame <= maxFrames; frame++) {
      env.advance(frameMs);
      let ran = 0;
      try {
        ran = frameScript.runInContext(context, { timeout }) as number;
      } catch (error) {
        frameErrors.push(`frame ${frame}: ${describe(error)}`);
      }
      await settle();
      if (ran > 0) framesRun++;
      if (frameErrors.length || exited) break;
      if (menuReadyFrame === null && readLog().includes(MENU_READY_MARKER)) {
        menuReadyFrame = frame;
        menuReadyMs = Math.round(env.now());
      }
      if (menuReadyFrame !== null && frame - menuReadyFrame >= settleFrames) break;
      // 1 s simulado sem nenhum pedido de frame: o jogo não tem laço (ainda), não adianta esperar os 10 s.
      if (env.framesRequested.count === 0 && frame >= 60) break;
    }
  }
  // O `+` do primeiro controle: sem GPU ele precisa fechar o app (a casca não pode cancelar o beforeunload).
  const plusExits = !exited && !bootError ? !env.dispatch('beforeunload') : true;
  process.off('unhandledRejection', onRejection);

  const debug = (env.sandbox as { BOBOFORCES_SWITCH?: DebugHandle }).BOBOFORCES_SWITCH;
  if (!bootError && debug?.bootError) bootError = debug.bootError;
  const appletNotice = env.drawnText.some((t) => t.includes(APPLET_NOTICE));
  const runtimeLog = readLog();

  if (bootError) problems.push(`erro no boot: ${bootError}`);
  if (!bootError && !exited && !debug) problems.push('main.js terminou sem expor globalThis.BOBOFORCES_SWITCH');
  for (const e of frameErrors) problems.push(`erro durante os frames: ${e}`);
  for (const n of env.network) problems.push(`tentativa de rede: ${n}`);
  for (const line of env.console) if (line.level === 'error') problems.push(`console.error: ${line.text}`);
  if (exited || env.exits.count) problems.push('Switch.exit() chamado durante o boot');
  if (!appletNotice) problems.push(`sem WebGL2 a casca deveria desenhar o aviso "${APPLET_NOTICE}" em Canvas 2D`);
  if (!plusExits) problems.push('sem GPU o + precisa fechar o app (beforeunload foi cancelado)');
  for (const t of new Set(env.traps)) {
    // AudioContext falha de propósito: no boot sem áudio a casca usa `audio: null` (platform-api).
    if (t !== 'AudioContext') notes.push(`API do nx.js não simulada foi tocada: ${t}`);
  }
  for (const line of env.console) if (line.level === 'warn') notes.push(`console.warn: ${line.text}`);

  let status: BootStatus = problems.length ? 'falha' : 'ok';
  if (status === 'ok' && menuReadyFrame === null) {
    if (env.framesRequested.count === 0) {
      status = 'pendente';
      problems.push('o game ainda não agenda frames (platform.requestFrame): laço do M0 pendente na integração');
    } else {
      status = 'falha';
      problems.push(
        `o menu não ficou pronto em ${maxFrames} frames: o game deve gravar "${MENU_READY_MARKER}" com ` +
          'platform.diagnostics.appendLog no primeiro frame do menu',
      );
    }
  }

  return {
    status,
    problems,
    notes,
    bootError,
    frameErrors,
    framesRequested: env.framesRequested.count,
    framesRun,
    menuReadyFrame,
    menuReadyMs,
    appletNotice,
    plusExits,
    network: env.network,
    traps: env.traps,
    console: env.console,
    exitCalls: env.exits.count,
    runtimeLog,
  };
}
