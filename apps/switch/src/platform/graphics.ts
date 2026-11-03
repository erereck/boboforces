import type { GraphicsSurface } from '@boboforces/platform-api';
import type { Unsubscribe } from '@boboforces/shared';
import type { NxContext2D, NxScreen } from './nx.ts';

/**
 * Superfície WebGL2 do Switch (tecnico.md §6.11): `screen.getContext('webgl2')` (que só existe em application mode;
 * no applet devolve `null`) e um "canvas" de mentira para o three, que espera um elemento com tamanho, `style` e
 * eventos. Resolução fixa de 720p, sem AA e sem escala dinâmica (§6.10): `onResize` nunca dispara.
 */
export interface SwitchGraphics extends GraphicsSurface {
  /** `true` quando o WebGL2 existe (application mode). Sem ele o jogo sobe com o NullRenderer. */
  readonly hasGpu: boolean;
}

/** O que o `WebGLRenderer` do three lê do canvas quando recebe `{ canvas, context }` prontos. */
export interface CanvasShim {
  width: number;
  height: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly style: Record<string, string>;
  addEventListener(type: string, listener: unknown): void;
  removeEventListener(type: string, listener: unknown): void;
  getContext(id: string): unknown;
}

export function createCanvasShim(screen: NxScreen, gl: unknown): CanvasShim {
  return {
    width: screen.width,
    height: screen.height,
    clientWidth: screen.width,
    clientHeight: screen.height,
    style: {},
    // O Switch não perde o contexto como o navegador: não há `webglcontextlost` para ouvir.
    addEventListener() {},
    removeEventListener() {},
    getContext: (id) => (id === 'webgl2' ? gl : null),
  };
}

export function createSwitchGraphics(screen: NxScreen): SwitchGraphics {
  let gl: unknown = null;
  try {
    gl = screen.getContext('webgl2') ?? null;
  } catch {
    gl = null;
  }
  return {
    kind: 'webgl2',
    hasGpu: gl !== null,
    context: gl,
    canvas: gl === null ? null : createCanvasShim(screen, gl),
    get width() {
      return screen.width;
    },
    get height() {
      return screen.height;
    },
    pixelRatio: 1,
    // A TV e a tela do portátil não têm recorte: a margem de 5% da TV é da UI (SCREEN_MARGIN), não da plataforma.
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    onResize(listener): Unsubscribe {
      void listener;
      return () => {};
    },
  };
}

/**
 * Aviso em Canvas 2D quando não há WebGL2 (applet: o jogo foi aberto pelo álbum sem segurar R). Usa a fonte do
 * sistema porque o texto MSDF precisa de GPU; é a única tela fora da UI do jogo (tecnico.md §11.2).
 * Devolve `false` se nem o 2D estiver disponível.
 */
export function drawNotice(screen: NxScreen, lines: readonly string[]): boolean {
  let ctx: NxContext2D | null = null;
  try {
    ctx = screen.getContext('2d');
  } catch {
    ctx = null;
  }
  if (!ctx) return false;
  const w = screen.width;
  const h = screen.height;
  ctx.fillStyle = '#101317';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lineHeight = Math.round(h / 12);
  const top = h / 2 - ((lines.length - 1) * lineHeight) / 2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillStyle = i === 0 ? '#f2f4f7' : '#9aa3ad';
    ctx.font = `${i === 0 ? 36 : 26}px sans-serif`;
    ctx.fillText(lines[i] as string, w / 2, top + i * lineHeight);
  }
  return true;
}
