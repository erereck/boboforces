import { describe, expect, it } from 'vitest';
import { createWebDiagnostics, formatErrorText, readGlInfo, scrubUrls } from './diagnostics.ts';

/** Contexto WebGL2 sintético: constantes, getParameter e getExtension contados. */
function fakeGl(renderer: string, unmasked: string | null) {
  const calls: string[] = [];
  const P: Record<string, number> = {
    RENDERER: 1,
    VENDOR: 2,
    MAX_TEXTURE_SIZE: 10,
    MAX_ARRAY_TEXTURE_LAYERS: 11,
    MAX_VIEWPORT_DIMS: 12,
    MAX_SAMPLES: 13,
  };
  const values: Record<number, unknown> = {
    1: renderer,
    2: 'WebKit',
    10: 16384,
    11: 2048,
    12: new Int32Array([32767, 32767]),
    13: 8,
    100: unmasked,
    101: 'Google Inc. (NVIDIA)',
  };
  const gl = {
    ...P,
    getParameter: (p: number) => values[p] ?? null,
    getExtension: (name: string) => {
      calls.push(name);
      return unmasked === null ? null : { UNMASKED_RENDERER_WEBGL: 100, UNMASKED_VENDOR_WEBGL: 101 };
    },
  };
  return { gl: gl as unknown as WebGL2RenderingContext, calls };
}

function fakeWin(early: string[] | undefined) {
  return Object.assign(new EventTarget(), {
    __bfErr: early,
    __bfCaptured: false,
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1.5,
    matchMedia: () => ({ matches: false }),
    navigator: { userAgent: 'TesteUA/1.0', hardwareConcurrency: 8, language: 'pt-BR' },
  });
}

describe('readGlInfo', () => {
  it('só pede WEBGL_debug_renderer_info quando o RENDERER veio mascarado', () => {
    const masked = fakeGl('WebKit WebGL', 'ANGLE (NVIDIA GeForce GTX 1060)');
    expect(readGlInfo(masked.gl).gpu).toBe('ANGLE (NVIDIA GeForce GTX 1060)');
    expect(masked.calls).toEqual(['WEBGL_debug_renderer_info']);

    const open = fakeGl('Mesa Intel(R) UHD Graphics 620', 'nunca');
    expect(readGlInfo(open.gl).gpu).toBe('Mesa Intel(R) UHD Graphics 620');
    expect(open.calls).toEqual([]);
  });

  it('cai no RENDERER mascarado quando a extensão não existe', () => {
    expect(readGlInfo(fakeGl('WebKit WebGL', null).gl).gpu).toBe('WebKit WebGL');
  });

  it('lê os limites do núcleo do WebGL2', () => {
    const { limits } = readGlInfo(fakeGl('Apple GPU', null).gl);
    expect(limits['MAX_TEXTURE_SIZE']).toBe(16384);
    expect(limits['MAX_ARRAY_TEXTURE_LAYERS']).toBe(2048);
    expect(limits['MAX_VIEWPORT_WIDTH']).toBe(32767);
  });
});

describe('relatório sem dados do jogador', () => {
  it('tira query e fragmento (#bot=…, #p=…) das URLs', () => {
    expect(scrubUrls('em https://erereck.github.io/boboforces/#bot=BF1-abc:1:2 e blob://x/y?k=1')).toBe(
      'em https://erereck.github.io/boboforces/ e blob://x/y',
    );
  });
  it('corta erros gigantes', () => {
    expect(formatErrorText('x'.repeat(5000)).length).toBeLessThan(2100);
  });
});

describe('createWebDiagnostics', () => {
  it('adota os erros do script inline e monta o relatório', async () => {
    const win = fakeWin(['TypeError: a @ https://h/boboforces/#p=BFP1-segredo:1:2']);
    const diagnostics = createWebDiagnostics({
      win: win as unknown as Window,
      build: { version: '0.0.1', codename: 'Primeiro Bloco', build: 'abc1234' },
      features: { profileHint: 'pc', touch: false, keyboardMouse: true, reducedMotion: false, canExit: false },
      graphics: {
        context: fakeGl('WebKit WebGL', 'Mesa Teste').gl,
        contextLost: false,
        antialias: true,
        width: 1920,
        height: 1080,
        renderScale: 1,
        maxPixelRatio: 2,
      },
      storage: { durable: true, failedWrites: 0 },
      persistence: { persisted: true, refresh: async () => true },
    });
    expect(win.__bfErr).toBeUndefined();
    expect(win.__bfCaptured).toBe(true);
    expect(diagnostics.errors).toEqual(['TypeError: a @ https://h/boboforces/']);

    const report = await diagnostics.collectReport();
    expect(report.platform).toBe('web');
    expect(report.gpu).toBe('Mesa Teste');
    expect(report.screen).toEqual({ width: 1280, height: 720, pixelRatio: 1.5 });
    expect(report.storagePersisted).toBe(true);
    expect(report.extra['version']).toBe('0.0.1');
    expect(report.extra['build']).toBe('abc1234');
    expect(report.extra['profileHint']).toBe('pc');
    expect(report.extra['errorCount']).toBe('1');
    expect(JSON.stringify(report)).not.toContain('segredo');

    diagnostics.appendLog('linha 1');
    const lines: string[] = [];
    expect(diagnostics.readLog(lines)).toBe(1);
    diagnostics.dispose();
  });
});
