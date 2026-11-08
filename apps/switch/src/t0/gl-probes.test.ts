import { describe, expect, it } from 'vitest';
import { createFigureProbeScene, figureProbeTexel } from '@boboforces/render/data';
import {
  applyInstancingFix,
  ARRAY_PROBE,
  arrayTexel,
  detectDeferredInstancing,
  FIGURE_PROBE_ROUTES,
  figureProbeAtlas,
  figureProbeHeader,
  GL,
  installInstancingWorkaround,
  instancingWorkaroundInstalled,
  logDrawingBuffer,
  logWebgl2,
  runGlProbes,
} from './gl-probes.ts';
import { createT0Logger } from './log.ts';

interface FakeOpts {
  pixels?: number[][];
  maxSamples?: number;
  failCompile?: boolean;
  figure?: Uint8Array;
  /** Instâncias acesas na detecção (alvo 8×1); padrão 4 (GPU certa). */
  detect?: number;
  /**
   * Imita o Eden: a imagem das figuras só sai certa se todo draw instanciado de 2+ instâncias for seguido do draw F
   * (o contorno); senão o `readPixels` devolve a imagem vazia.
   */
  eden?: boolean;
}

/** WebGL2 falso: registra chamadas, cria objetos numerados e devolve os pixels da fila no `readPixels`. */
function fakeGl(opts: FakeOpts = {}) {
  const calls: string[] = [];
  const draws: (string | number)[][] = [];
  let pendingFix = false;
  let broken = false;
  const created = new Map<string, number>();
  const deleted = new Map<string, number>();
  const bound = new Map<number, unknown>();
  const pixels = [...(opts.pixels ?? [])];
  let program: unknown = 'x';
  let vao: unknown = 'x';
  const params: Record<number, unknown> = {
    [GL.MAX_ARRAY_TEXTURE_LAYERS]: 2048,
    [GL.MAX_TEXTURE_SIZE]: 16384,
    [GL.MAX_VERTEX_TEXTURE_IMAGE_UNITS]: 32,
    [GL.MAX_SAMPLES]: opts.maxSamples ?? 8,
    [GL.VERSION]: 'WebGL 2.0 (falso)',
    [GL.SHADING_LANGUAGE_VERSION]: 'WebGL GLSL ES 3.00',
    [GL.RENDERER]: 'NVIDIA Tegra X1 (falsa)',
    [GL.VENDOR]: 'nouveau',
  };
  const impl: Record<string, (...a: never[]) => unknown> = {
    getParameter: (p: number) => params[p] ?? null,
    getError: () => GL.NO_ERROR,
    getShaderParameter: () => !opts.failCompile,
    getShaderInfoLog: () => 'erro falso',
    getProgramParameter: () => true,
    checkFramebufferStatus: () => GL.FRAMEBUFFER_COMPLETE,
    getUniformLocation: () => ({}),
    getAttribLocation: (_p: unknown, name: string) =>
      [
        'position',
        'instanceMatrix',
        '',
        '',
        '',
        'uv',
        'aVert',
        'iLayer',
        'iLight',
        'iColor',
        'normal',
        'iPart',
      ].indexOf(name),
    bindTexture: (target: number, t: unknown) => void bound.set(target, t),
    bindFramebuffer: (target: number, f: unknown) => void bound.set(target, f),
    bindRenderbuffer: (target: number, r: unknown) => void bound.set(target, r),
    bindBuffer: (target: number, b: unknown) => void bound.set(target, b),
    useProgram: (p: unknown) => void (program = p),
    bindVertexArray: (v: unknown) => void (vao = v),
    drawElementsInstanced: (mode: number, count: number, type: number, offset: number, n: number) => {
      if (pendingFix) broken = true;
      pendingFix = n > 1;
      draws.push(['drawElementsInstanced', mode, count, type, offset, n]);
    },
    drawArraysInstanced: (mode: number, first: number, count: number, n: number) => {
      if (pendingFix) broken = true;
      pendingFix = n > 1;
      draws.push(['drawArraysInstanced', mode, first, count, n]);
    },
    drawElements: (mode: number, count: number, type: number, offset: number) => {
      pendingFix = false;
      draws.push(['drawElements', mode, count, type, offset]);
    },
    drawArrays: (mode: number, first: number, count: number) => {
      pendingFix = false;
      draws.push(['drawArrays', mode, first, count]);
    },
    readPixels: (_x: number, _y: number, w: number, h: number, _f: number, _t: number, out: Uint8Array) => {
      const wrong = broken || pendingFix;
      broken = false;
      pendingFix = false;
      // Detecção do instanciamento adiado: 8×1, `detect` pixels acesos.
      if (w === 8 && h === 1) {
        for (let i = 0; i < (opts.detect ?? 4); i++) out[i * 4 + 3] = 255;
        return;
      }
      // O alvo da sonda das figuras (256×128) lê a imagem pronta (vazia no Eden imitado sem o contorno); os outros, a
      // fila.
      if (opts.figure && w * h * 4 === opts.figure.length) {
        if (!(opts.eden && wrong)) out.set(opts.figure);
        return;
      }
      const px = pixels.shift() ?? [0, 0, 0, 0];
      out.set(px);
    },
  };
  const gl = new Proxy(
    { drawingBufferWidth: 1280, drawingBufferHeight: 720 },
    {
      get(target, key) {
        if (typeof key !== 'string') return undefined;
        if (key in target) return (target as Record<string, unknown>)[key];
        return (...args: never[]) => {
          calls.push(key);
          if (key.startsWith('create')) {
            const kind = key.slice(6);
            created.set(kind, (created.get(kind) ?? 0) + 1);
            return { kind, id: created.get(kind) };
          }
          if (key.startsWith('delete')) {
            const kind = key.slice(6);
            deleted.set(kind, (deleted.get(kind) ?? 0) + 1);
            return undefined;
          }
          return impl[key]?.(...args);
        };
      },
    },
  ) as unknown as WebGL2RenderingContext;
  return { gl, calls, draws, created, deleted, bound, state: () => ({ program, vao }) };
}

class FakeOffscreen {
  getContext() {
    return { fillStyle: '', fillRect() {} };
  }
}

function capture() {
  const lines: string[] = [];
  return { lines, log: createT0Logger((l) => lines.push(l)) };
}

describe('sondas de GL da casca (itens 4, 5, 6, 7, 9)', () => {
  it('caminho feliz: array lido com REPEAT e atributo inteiro, OffscreenCanvas e MSAA; tudo apagado e desligado', () => {
    const fake = fakeGl({
      pixels: [arrayTexel(ARRAY_PROBE.layer, ARRAY_PROBE.texelX, ARRAY_PROBE.texelY), [255, 128, 0, 255]],
    });
    const { lines, log } = capture();
    let clock = 0;
    const ms = runGlProbes({
      gl: fake.gl,
      now: () => (clock += 1),
      log,
      width: 1280,
      height: 720,
      OffscreenCanvas: FakeOffscreen,
    });
    expect(ms).toBeGreaterThan(0);
    const byItem = (n: number) => lines.find((l) => l.startsWith(`[t0] item=${n} `)) ?? '';
    expect(byItem(4)).toMatch(/^\[t0\] item=4 nome=texture-array status=ok fonte=casca camadas_max=2048 /);
    expect(byItem(4)).toContain('repeat_na_camada=ok');
    expect(byItem(4)).toContain('subimage3d=ok');
    expect(byItem(5)).toBe(
      '[t0] item=5 nome=int-attributes status=ok fonte=casca vertexAttribIPointer=1 u16_para_uvec2=ok',
    );
    expect(byItem(6)).toContain('status=info fonte=casca unidades_vs=32 shader_com_textura=ok');
    expect(byItem(7)).toContain('status=ok fonte=casca offscreen=1 teximage2d=ok leitura=255_128_0_255');
    expect(byItem(9)).toMatch(/status=ok fonte=casca amostras_max=8 amostras=2 tamanho=1280x720 clear_blit_ms=/);
    // Tudo o que foi criado foi apagado, e o contexto volta ao padrão para o three.
    for (const [kind, n] of fake.created) expect(fake.deleted.get(kind), kind).toBe(n);
    expect(fake.bound.get(GL.FRAMEBUFFER)).toBeNull();
    expect(fake.bound.get(GL.TEXTURE_2D_ARRAY)).toBeNull();
    expect(fake.bound.get(GL.ARRAY_BUFFER)).toBeNull();
    expect(fake.state()).toEqual({ program: null, vao: null });
    expect(fake.calls.at(-1)).toBe('getError');
  });

  it('atributo inteiro errado (magenta), sem OffscreenCanvas e sem MSAA viram falha sem derrubar as outras', () => {
    const fake = fakeGl({ pixels: [[255, 0, 255, 255]], maxSamples: 0 });
    const { lines, log } = capture();
    runGlProbes({ gl: fake.gl, now: () => 0, log, width: 1280, height: 720 });
    expect(lines.find((l) => l.includes('item=5 '))).toContain(
      'status=falha fonte=casca vertexAttribIPointer=1 u16_para_uvec2=valor_errado',
    );
    expect(lines.find((l) => l.includes('item=4 '))).toContain('status=falha');
    expect(lines.find((l) => l.includes('item=7 '))).toBe(
      '[t0] item=7 nome=offscreen-canvas status=falha fonte=casca offscreen=0',
    );
    expect(lines.find((l) => l.includes('item=9 '))).toBe(
      '[t0] item=9 nome=msaa-blit status=falha fonte=casca amostras_max=0',
    );
  });

  it('shader que não compila vira falha com o motivo, e as sondas seguintes rodam', () => {
    const fake = fakeGl({ failCompile: true });
    const { lines, log } = capture();
    runGlProbes({ gl: fake.gl, now: () => 0, log, width: 1280, height: 720, OffscreenCanvas: FakeOffscreen });
    expect(lines.find((l) => l.includes('item=4 '))).toContain('repeat_na_camada=falhou');
    expect(lines.find((l) => l.includes('item=6 '))).toContain('shader_com_textura="shader: erro falso"');
    expect(lines.some((l) => l.includes('item=9 '))).toBe(true);
  });
});

describe('sonda T4 das figuras (#56)', () => {
  /** A imagem que um GL certo desenharia nos pontos conferidos (o resto fica vazio). */
  function rightImage(): Uint8Array {
    const scene = createFigureProbeScene();
    const img = new Uint8Array(scene.width * scene.height * 4);
    for (const s of scene.samples) img.set(s.rgba, (Math.floor(s.y) * scene.width + Math.floor(s.x)) * 4);
    return img;
  }

  it('pixels certos: uma linha ok por rota (array e atlas), e tudo apagado no fim', () => {
    const fake = fakeGl({ figure: rightImage() });
    const { lines, log } = capture();
    runGlProbes({ gl: fake.gl, now: () => 0, log, width: 1280, height: 720, OffscreenCanvas: FakeOffscreen });
    const fig = lines.filter((l) => l.includes('sonda=figuras'));
    expect(fig).toHaveLength(2);
    expect(fig[0]).toContain('status=ok fonte=casca sonda=figuras rota=array compila=ok instancias=32 pixels=108/108 ');
    expect(fig[1]).toContain('status=ok fonte=casca sonda=figuras rota=atlas compila=ok instancias=32 pixels=108/108 ');
    expect(fake.calls).toContain('drawElementsInstanced');
    expect(fake.calls).toContain('vertexAttribDivisor');
    // A posição 0 vai para `position`, como no three.
    expect(fake.calls).toContain('bindAttribLocation');
    for (const [kind, n] of fake.created) expect(fake.deleted.get(kind), kind).toBe(n);
    expect(fake.state()).toEqual({ program: null, vao: null });
  });

  it('pixels errados: falha com a 1ª amostra errada, as células e os diagnósticos', () => {
    const fake = fakeGl();
    const { lines, log } = capture();
    runGlProbes({ gl: fake.gl, now: () => 0, log, width: 1280, height: 720 });
    const fig = lines.filter((l) => l.includes('sonda=figuras'));
    expect(fig).toHaveLength(2);
    expect(fig[0]).toContain('status=falha');
    expect(fig[0]).toContain('pixels=2/108:rosto-0+');
    expect(fig[0]).toContain('primeira_falha="rosto-0@');
    expect(fig[0]).toMatch(/contorno_ativo=0 instancia=2\/108:\S+ contorno=2\/108:/);
  });

  it('Eden imitado: o draw cheio reprova e o contorno passa nas duas rotas; a detecção acusa "adiado"', () => {
    const fake = fakeGl({ figure: rightImage(), eden: true, detect: 1 });
    const { lines, log } = capture();
    runGlProbes({ gl: fake.gl, now: () => 0, log, width: 1280, height: 720, OffscreenCanvas: FakeOffscreen });
    expect(lines.find((l) => l.includes('sonda=instanciamento'))).toBe(
      '[t0] item=4 nome=texture-array status=info fonte=casca sonda=instanciamento resultado=adiado acesos=1/4 ' +
        'contorno_ativo=0 ms=0',
    );
    const fig = lines.filter((l) => l.includes('sonda=figuras'));
    expect(fig).toHaveLength(2);
    for (const line of fig) {
      expect(line).toContain('status=falha');
      expect(line).toContain('contorno_ativo=0 instancia=108/108 contorno=108/108');
    }
    // O contorno sai do contexto depois da sonda (quem liga de verdade é a casca).
    expect(instancingWorkaroundInstalled(fake.gl)).toBe(false);
    for (const [kind, n] of fake.created) expect(fake.deleted.get(kind), kind).toBe(n);
  });

  it('com o contorno já no contexto, o draw cheio passa e a linha diz contorno_ativo=1', () => {
    const fake = fakeGl({ figure: rightImage(), eden: true, detect: 1 });
    installInstancingWorkaround(fake.gl);
    const { lines, log } = capture();
    runGlProbes({ gl: fake.gl, now: () => 0, log, width: 1280, height: 720, OffscreenCanvas: FakeOffscreen });
    const fig = lines.filter((l) => l.includes('sonda=figuras'));
    expect(fig).toHaveLength(2);
    for (const line of fig) expect(line).toMatch(/status=ok .* pixels=108\/108 .*contorno_ativo=1/);
    expect(lines.find((l) => l.includes('sonda=instanciamento'))).toContain('contorno_ativo=1');
  });
  it('boot da casca: o contorno liga só com "adiado", a linha diz o veredito e a T4 do Eden imitado passa', () => {
    for (const [detect, line] of [
      [4, '[boot] instanciamento=normal acesos=4/4 contorno=0'],
      [0, '[boot] instanciamento=indefinido acesos=0/4 contorno=0'],
    ] as const) {
      const fake = fakeGl({ detect });
      expect(applyInstancingFix(fake.gl)).toBe(line);
      expect(instancingWorkaroundInstalled(fake.gl)).toBe(false);
      fake.gl.drawElementsInstanced(GL.TRIANGLES, 36, GL.UNSIGNED_SHORT, 0, 5);
      expect(fake.draws.filter((d) => d[0] === 'drawElements')).toHaveLength(0);
    }
    const eden = fakeGl({ figure: rightImage(), eden: true, detect: 1 });
    expect(applyInstancingFix(eden.gl)).toBe('[boot] instanciamento=adiado acesos=1/4 contorno=1');
    expect(instancingWorkaroundInstalled(eden.gl)).toBe(true);
    const { lines, log } = capture();
    runGlProbes({ gl: eden.gl, now: () => 0, log, width: 1280, height: 720, OffscreenCanvas: FakeOffscreen });
    const fig = lines.filter((l) => l.includes('sonda=figuras'));
    expect(fig).toHaveLength(2);
    for (const l of fig) expect(l).toMatch(/status=ok .* pixels=108\/108 .*contorno_ativo=1/);
  });
});

describe('instanciamento adiado do Eden (contorno e detecção)', () => {
  it('o contorno repete o draw sem instância com 1 primitiva, só com 2+ instâncias; desfazer devolve o contexto', () => {
    const fake = fakeGl();
    const undo = installInstancingWorkaround(fake.gl);
    expect(instancingWorkaroundInstalled(fake.gl)).toBe(true);
    // Embrulhar de novo não empilha.
    installInstancingWorkaround(fake.gl)();
    expect(instancingWorkaroundInstalled(fake.gl)).toBe(true);
    fake.gl.drawElementsInstanced(GL.TRIANGLES, 36, GL.UNSIGNED_SHORT, 24, 5);
    fake.gl.drawElementsInstanced(GL.TRIANGLES, 36, GL.UNSIGNED_SHORT, 0, 1);
    fake.gl.drawArraysInstanced(GL.TRIANGLE_STRIP, 4, 10, 3);
    fake.gl.drawArraysInstanced(GL.LINES, 0, 1, 3);
    fake.gl.drawArraysInstanced(GL.POINTS, 2, 9, 0);
    expect(fake.draws).toEqual([
      ['drawElementsInstanced', GL.TRIANGLES, 36, GL.UNSIGNED_SHORT, 24, 5],
      ['drawElements', GL.TRIANGLES, 3, GL.UNSIGNED_SHORT, 24],
      ['drawElementsInstanced', GL.TRIANGLES, 36, GL.UNSIGNED_SHORT, 0, 1],
      ['drawArraysInstanced', GL.TRIANGLE_STRIP, 4, 10, 3],
      ['drawArrays', GL.TRIANGLE_STRIP, 4, 3],
      ['drawArraysInstanced', GL.LINES, 0, 1, 3],
      ['drawArrays', GL.LINES, 0, 1],
      ['drawArraysInstanced', GL.POINTS, 2, 9, 0],
    ]);
    undo();
    expect(instancingWorkaroundInstalled(fake.gl)).toBe(false);
    expect(Object.keys(fake.gl as object)).not.toContain('drawElementsInstanced');
    fake.draws.length = 0;
    fake.gl.drawElementsInstanced(GL.TRIANGLES, 36, GL.UNSIGNED_SHORT, 0, 5);
    expect(fake.draws).toHaveLength(1);
  });

  it('detecção: 1 aceso = adiado, 4 = normal, outro = indefinido; tudo apagado e o contexto no padrão', () => {
    for (const [detect, verdict] of [
      [1, 'adiado'],
      [4, 'normal'],
      [0, 'indefinido'],
    ] as const) {
      const fake = fakeGl({ detect });
      const check = detectDeferredInstancing(fake.gl);
      expect(check.verdict).toBe(verdict);
      expect(check.deferred).toBe(verdict === 'adiado');
      expect(check.lit).toBe(detect);
      // Draw comum fora do alvo, 4 instâncias no alvo, draw comum fora do alvo.
      expect(fake.draws).toEqual([
        ['drawArrays', GL.TRIANGLES, 0, 3],
        ['drawArraysInstanced', GL.TRIANGLES, 0, 3, 4],
        ['drawArrays', GL.TRIANGLES, 0, 3],
      ]);
      for (const [kind, n] of fake.created) expect(fake.deleted.get(kind), kind).toBe(n);
      expect(fake.state()).toEqual({ program: null, vao: null });
      expect(fake.bound.get(GL.FRAMEBUFFER)).toBeNull();
    }
  });

  it('cabeçalho do three e atlas com borda repetida', () => {
    const vs = figureProbeHeader(FIGURE_PROBE_ROUTES[1].defines, true);
    expect(vs.startsWith('#version 300 es\n#define ATLAS 1\n#define VERTEX_FLOAT 1\n')).toBe(true);
    expect(vs).toContain('in mat4 instanceMatrix;');
    expect(figureProbeHeader('', false)).not.toContain('in vec3 position');
    const scene = createFigureProbeScene();
    const atlas = figureProbeAtlas(scene);
    const cell = scene.layerSize + 8;
    expect(atlas.size).toBe(atlas.cols * cell);
    const at = (x: number, y: number) =>
      Array.from(atlas.bytes.subarray((y * atlas.size + x) * 4, (y * atlas.size + x) * 4 + 4));
    // Camada 1 na 2ª coluna: o texel (5, 7) fica a 4 px da borda da célula; a borda repete o texel da quina.
    expect(at(cell + 4 + 5, 4 + 7)).toEqual(figureProbeTexel(1, 5, 7));
    expect(at(cell, 0)).toEqual(figureProbeTexel(1, 0, 0));
  });
});

describe('itens 1 e 2', () => {
  it('WebGL2: ok no modo aplicativo, falha sem GL no aplicativo, info no applet', () => {
    const { lines, log } = capture();
    const { gl } = fakeGl();
    logWebgl2(log, { gl, appletType: 0, application: true });
    logWebgl2(log, { gl: null, appletType: 0, application: true });
    logWebgl2(log, { gl: null, appletType: 2, application: false });
    expect(lines[0]).toBe(
      '[t0] item=1 nome=webgl2 status=ok modo_aplicativo=1 applet_tipo=0 webgl2=1 versao="WebGL 2.0 (falso)" ' +
        'glsl="WebGL GLSL ES 3.00" gpu="NVIDIA Tegra X1 (falsa)" fabricante=nouveau',
    );
    expect(lines[1]).toContain('status=falha modo_aplicativo=1 applet_tipo=0 webgl2=0');
    expect(lines[2]).toContain('status=info modo_aplicativo=0 applet_tipo=2 webgl2=0');
  });

  it('drawing buffer com o modo e o evento', () => {
    const { lines, log } = capture();
    logDrawingBuffer(log, fakeGl().gl, { width: 1280, height: 720 }, 'portatil', 'troca_de_modo');
    logDrawingBuffer(log, null, { width: 1280, height: 720 }, 'dock', 'boot');
    expect(lines).toEqual([
      '[t0] item=2 nome=drawing-buffer status=info evento=troca_de_modo modo=portatil buffer=1280x720 tela=1280x720',
      '[t0] item=2 nome=drawing-buffer status=pulado evento=boot modo=dock buffer=- tela=1280x720',
    ]);
  });
});
