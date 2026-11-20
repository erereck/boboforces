// M9 (fase 0): a leitura da GPU e a montagem do relatório (`collectReport`), fora do menu da web: o
// `diagnostics.ts` pede este módulo por `import()` só quando alguém quer o relatório (a qualidade automática da 1ª
// abertura, o "Copiar relatório" dos Ajustes, o bench). Regra 15: o `import()` dinâmico fica no `apps/web`.
import type { PlatformReport } from '@boboforces/platform-api';
import type { DiagnosticsSources } from './diagnostics.ts';

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

/** O relatório (#42) com a GPU já lida, os erros capturados e o estado das outras peças da plataforma. */
export function buildWebReport(
  sources: DiagnosticsSources,
  info: GlInfo,
  errors: readonly string[],
  errorCount: number,
): PlatformReport {
  const { win } = sources;
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
    errors: errors.join('\n---\n'),
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
}
