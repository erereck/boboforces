// Sondas do Teste Zero que a casca roda sozinha no boot (sem o jogador fazer nada): 1, 2 e as de GL (4, 5, 6, 7, 9)
// antes do renderer, e as tardias (8, 20 bateria, 21) alguns segundos depois do menu, para não pesar no loading.
// Os testes com o jogador (17, 18, 19) ficam nas telas do título (`items.ts`). Também guarda os `console.warn` e
// `console.error` no runtime.log (item 3: o que o three reclama ao subir com o shim).
import type { Platform } from '@boboforces/platform-api';
import { probeAudioSilently } from './audio-probe.ts';
import { probeBattery, probeFontFace, probeIntlAndDecompression } from './env-probes.ts';
import { logDrawingBuffer, logWebgl2, runGlProbes } from './gl-probes.ts';
import { createT0Logger, ms2, type T0Logger } from './log.ts';
import { APPLET_TYPE, OPERATION_MODE, type NxFs, type NxGlobals } from '../platform/nx.ts';

/**
 * Marca "sondas de GL já rodaram": elas custam ~0,8 s no boot (medido no Eden, quase tudo compilação de shader), então
 * rodam UMA vez por build e por modo (dock/portátil). Apagar o arquivo repete.
 */
export const GL_PROBES_MARKER = 't0-sondas.txt';

export interface GlProbeMarker {
  readonly fs: Pick<NxFs, 'readFileSync' | 'writeFileSync' | 'mkdirSync'>;
  readonly dir: string;
  /** Identidade do build (`versão sha-do-main.js`); `null` = sem manifesto, roda sempre. */
  readonly build: string | null;
}

/** Atraso das sondas tardias depois do boot (ms): o menu já está na tela e o loading não sofre. */
export const LATE_PROBES_DELAY_MS = 3000;
/** Teto de linhas de console copiadas para o runtime.log por sessão (o three pode repetir avisos). */
export const CONSOLE_LOG_LIMIT = 40;

export function modeName(mode: number): string {
  return mode === OPERATION_MODE.handheld ? 'portatil' : mode === OPERATION_MODE.console ? 'dock' : 'desconhecido';
}

function safeCall<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export interface BootProbeEnv {
  readonly nx: NxGlobals;
  /** WebGL2 da casca (`null` no applet). */
  readonly gl: unknown;
  readonly log: (line: string) => void;
  readonly now: () => number;
  readonly marker?: GlProbeMarker;
}

export interface BootProbes {
  readonly t0: T0Logger;
  /** Tempo das sondas de GL no boot (ms), ou 0 sem GPU. */
  readonly glMs: number;
}

/** Itens 1 e 2 e as sondas de GL. Chamar ANTES de criar o renderer (o GL volta ao estado padrão no fim). */
export function runBootProbes(env: BootProbeEnv): BootProbes {
  const t0 = createT0Logger(env.log);
  const { nx } = env;
  const gl = (env.gl ?? null) as WebGL2RenderingContext | null;
  const appletType = safeCall(() => nx.Switch.appletType(), -1);
  const application = appletType === APPLET_TYPE.application || appletType === APPLET_TYPE.systemApplication;
  logWebgl2(t0, { gl, appletType, application });
  const mode = modeName(safeCall(() => nx.Switch.operationMode(), -1));
  logDrawingBuffer(t0, gl, nx.screen, mode, 'boot');
  if (!gl) {
    for (const item of [4, 5, 6, 7, 9] as const) t0(item, 'pulado', { fonte: 'casca', motivo: 'sem_webgl2' });
    return { t0, glMs: 0 };
  }
  const m = env.marker;
  const markerKey = m?.build ? `${m.build} ${mode}` : null;
  const markerPath = m ? `${m.dir}/${GL_PROBES_MARKER}` : '';
  if (m && markerKey) {
    const previous = safeCall(() => {
      const b = m.fs.readFileSync(markerPath);
      return b ? new TextDecoder().decode(new Uint8Array(b)).trim() : null;
    }, null);
    if (previous === markerKey) {
      for (const item of [4, 5, 6, 7, 9] as const) {
        t0(item, 'pulado', { fonte: 'casca', motivo: 'ja_medido_neste_build', modo: mode });
      }
      return { t0, glMs: 0 };
    }
  }
  const glMs = runGlProbes({
    gl,
    now: env.now,
    log: t0,
    width: nx.screen.width,
    height: nx.screen.height,
    OffscreenCanvas: nx.probes?.['OffscreenCanvas'],
  });
  env.log(`[t0] sondas de GL da casca em ${ms2(glMs)} ms`);
  if (m && markerKey) {
    safeCall(() => {
      m.fs.mkdirSync(m.dir);
      m.fs.writeFileSync(
        markerPath,
        `${markerKey}
`,
      );
    }, undefined);
  }
  return { t0, glMs };
}

/**
 * Itens 8, 20 (bateria), 21 e 19 (áudio em silêncio, com `platform`), depois do boot. Devolve quando todas gravaram.
 */
export async function runLateProbes(env: BootProbeEnv, t0: T0Logger, platform?: Platform): Promise<void> {
  const { nx } = env;
  const globals = nx.probes ?? {};
  if (env.gl) probeFontFace(t0, globals, env.now);
  else t0(8, 'pulado', { motivo: 'applet' });
  const nav = nx.navigator;
  await probeBattery(
    t0,
    nav.getBattery ? () => nav.getBattery!() : undefined,
    'boot',
    modeName(safeCall(() => nx.Switch.operationMode(), -1)),
  );
  await probeIntlAndDecompression(t0, globals);
  if (platform) await probeAudioSilently(t0, platform);
}

/** Console com os métodos que a casca embrulha. */
interface ConsoleLike {
  warn?: ((...args: unknown[]) => void) | undefined;
  error?: ((...args: unknown[]) => void) | undefined;
}

/**
 * Copia `console.warn`/`console.error` para o runtime.log (sem deixar de chamar o original, que o nxlink e o
 * portcheck leem). Devolve quantas linhas já foram copiadas e como desfazer.
 */
export function captureConsole(
  target: unknown,
  log: (line: string) => void,
  limit: number = CONSOLE_LOG_LIMIT,
): { readonly count: () => number; restore(): void } {
  const c = target as ConsoleLike | null;
  if (!c || typeof c !== 'object') return { count: () => 0, restore() {} };
  let copied = 0;
  const original = { warn: c.warn, error: c.error };
  const wrap =
    (level: 'warn' | 'error', fn: ((...args: unknown[]) => void) | undefined) =>
    (...args: unknown[]): void => {
      fn?.apply(c, args);
      if (copied >= limit) return;
      copied++;
      const text = args
        .map((a) =>
          typeof a === 'string' ? a : a instanceof Error ? a.message : safeCall(() => JSON.stringify(a), String(a)),
        )
        .join(' ');
      log(`[console.${level}] ${text.slice(0, 300)}`);
      if (copied === limit) log(`[console] limite de ${limit} linhas atingido; o resto fica só no console`);
    };
  try {
    c.warn = wrap('warn', original.warn);
    c.error = wrap('error', original.error);
  } catch {
    return { count: () => 0, restore() {} };
  }
  return {
    count: () => copied,
    restore() {
      c.warn = original.warn;
      c.error = original.error;
    },
  };
}
