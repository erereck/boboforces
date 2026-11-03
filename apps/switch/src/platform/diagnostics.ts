import type { Diagnostics, PlatformReport } from '@boboforces/platform-api';
import { APPLET_TYPE, OPERATION_MODE, type NxFs, type NxSwitch } from './nx.ts';

/**
 * Diagnóstico sem coleta (decisão #42, tecnico.md §18): `runtime.log` no SD com rotação em 1 MB
 * (`runtime.old.log`) e a parte do relatório que só a plataforma sabe (sistema, GPU, limites WebGL).
 * Nada sai do aparelho: o jogador copia o arquivo se quiser mandar.
 */
export const LOG_ROTATE_BYTES = 1024 * 1024;

/** Só o que o relatório lê do contexto WebGL2 (que a casca recebe opaco). Sem `getExtension` (regra 6). */
interface GlInfo {
  getParameter(pname: number): unknown;
}

/** Constantes do WebGL2 usadas no relatório (números fixos da especificação). */
const GL = {
  VENDOR: 0x1f00,
  RENDERER: 0x1f01,
  VERSION: 0x1f02,
  SHADING_LANGUAGE_VERSION: 0x8b8c,
} as const;

const GL_LIMITS: Readonly<Record<string, number>> = {
  MAX_TEXTURE_SIZE: 0x0d33,
  MAX_ARRAY_TEXTURE_LAYERS: 0x88ff,
  MAX_3D_TEXTURE_SIZE: 0x8073,
  MAX_RENDERBUFFER_SIZE: 0x84e8,
  MAX_SAMPLES: 0x8d57,
  MAX_VERTEX_ATTRIBS: 0x8869,
  MAX_TEXTURE_IMAGE_UNITS: 0x8872,
  MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8b4c,
  MAX_VARYING_VECTORS: 0x8dfc,
  MAX_UNIFORM_BLOCK_SIZE: 0x8a30,
};

export interface SwitchDiagnosticsOptions {
  readonly fs: NxFs;
  readonly sw: NxSwitch;
  /** Pasta no SD, sem barra no fim. */
  readonly dir: string;
  /** Contexto WebGL2 (opaco) ou `null` sem GPU. */
  readonly gl: unknown;
  readonly screen: { readonly width: number; readonly height: number };
  /** Carimbo de data e hora de cada linha (relógio de parede: aqui é casca, a regra 10 não vale). */
  readonly timestamp: () => string;
  /** Eco opcional (console do nx.js, que aparece no nxlink). */
  readonly echo?: (line: string) => void;
  readonly rotateBytes?: number;
}

export interface SwitchDiagnostics extends Diagnostics {
  readonly logPath: string;
}

const encoder = new TextEncoder();

function safe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

export function createSwitchDiagnostics(opts: SwitchDiagnosticsOptions): SwitchDiagnostics {
  const { fs, sw, dir } = opts;
  const logPath = `${dir}/runtime.log`;
  const oldPath = `${dir}/runtime.old.log`;
  const limit = opts.rotateBytes ?? LOG_ROTATE_BYTES;
  let size = -1; // desconhecido até a primeira escrita
  let broken = false;

  const appendLog = (line: string): void => {
    opts.echo?.(line);
    if (broken) return;
    try {
      const text = `${opts.timestamp()} ${line.replace(/\r?\n/g, '\n  ')}\n`;
      const bytes = encoder.encode(text);
      if (size < 0) {
        fs.mkdirSync(dir);
        size = safe(() => fs.statSync(logPath)?.size ?? 0, 0);
      }
      if (size > 0 && size + bytes.length > limit) {
        safe(() => fs.removeSync(oldPath), undefined);
        fs.renameSync(logPath, oldPath);
        size = 0;
      }
      fs.appendFileSync(logPath, bytes);
      size += bytes.length;
    } catch {
      // SD cheio ou ausente: o jogo segue sem log em vez de quebrar por causa do diagnóstico.
      broken = true;
    }
  };

  const collectReport = (): Promise<PlatformReport> => {
    const v = sw.version;
    const ams = v.ams ? ` · Atmosphère ${v.ams}${v.emummc ? ' (emuMMC)' : ''}` : '';
    const gl = opts.gl as GlInfo | null;
    const param = (p: number): string => (gl ? safe(() => String(gl.getParameter(p) ?? ''), '') : '');
    const glLimits: Record<string, number> = {};
    if (gl) {
      for (const [name, pname] of Object.entries(GL_LIMITS)) {
        const value = safe(() => gl.getParameter(pname), null);
        if (typeof value === 'number') glLimits[name] = value;
      }
    }
    const applet = safe(() => sw.appletType(), -1);
    const mode = safe(() => sw.operationMode(), -1);
    const heap = safe(() => sw.memoryUsage?.(), undefined);
    const extra: Record<string, string> = {
      modoAplicativo: applet === APPLET_TYPE.application || applet === APPLET_TYPE.systemApplication ? 'sim' : 'não',
      modoOperacao: mode === OPERATION_MODE.handheld ? 'portátil' : mode === OPERATION_MODE.console ? 'dock' : '?',
      glVersao: param(GL.VERSION),
      glslVersao: param(GL.SHADING_LANGUAGE_VERSION),
      glFabricante: param(GL.VENDOR),
    };
    if (heap)
      extra['heapMB'] = `${(heap.usedHeapSize / 1048576).toFixed(1)}/${(heap.heapSizeLimit / 1048576).toFixed(0)}`;
    return Promise.resolve({
      platform: 'switch',
      system: `Horizon ${v.hos} · nx.js ${v.nxjs}${ams}`,
      screen: { width: opts.screen.width, height: opts.screen.height, pixelRatio: 1 },
      gpu: param(GL.RENDERER) || 'desconhecida',
      glLimits,
      storagePersisted: null,
      extra,
    });
  };

  return { logPath, appendLog, collectReport };
}
