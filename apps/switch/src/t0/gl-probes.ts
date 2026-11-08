// Sondas de GL do Teste Zero (tecnico.md §24.2), feitas pela casca com WebGL2 PURO, antes do three existir: o three
// guarda o estado do GL em cache, então tudo aqui roda no boot e devolve o contexto no estado padrão no fim.
// Itens: 1 (WebGL2 no modo aplicativo/applet), 2 (drawing buffer), 4 (TEXTURE_2D_ARRAY com mips, REPEAT dentro da
// camada, texSubImage3D de skin), 5 (atributo inteiro com vertexAttribIPointer), 6 (textura no vertex shader),
// 7 (OffscreenCanvas 2D → texImage2D) e 9 (FBO multisample + blitFramebuffer). Cada sonda grava uma linha `[t0]` com
// `fonte=casca`; uma sonda que lança vira `status=falha erro=…` e as outras seguem.
//
// #56 (porte do boneco do FutBobo, sonda T4): o programa 4 REAL (`INSTANCED_VERTEX`/`FRAGMENT` do render) compilado
// nas duas rotas do renderer (array + atributo inteiro; atlas + float), desenhando a fila de caixas sintéticas da
// `createFigureProbeScene` (cruz, paleta, coluna, mini-cruz, giro, rosto nas 8 expressões, luz e clarão pela 4ª linha,
// escondidos e uma prop do caminho de hoje) e conferindo os pixels contra o gêmeo do vertex shader. Grava uma linha
// `item=4 … sonda=figuras rota=<array|atlas>` por rota, depois das outras sondas.
//
// Instanciamento adiado do Eden (passo 4 do porte, decisão 7 da seção I do PLANO; bancada e medidas em
// `local/futbobo-port/passo45/eden/`): `detectDeferredInstancing` acha o defeito em ~1 draw e
// `installInstancingWorkaround` embrulha os draws instanciados do contexto com o contorno. A sonda das figuras grava
// `item=4 … sonda=instanciamento` e, quando o draw instanciado reprova, o resultado com o contorno (`contorno=`).
import {
  checkFigureProbe,
  createFigureProbeScene,
  INSTANCED_FRAGMENT,
  INSTANCED_VERTEX,
  type FigureProbeCheck,
  type FigureProbeScene,
} from '@boboforces/render/data';
import { errorText, ms2, type T0Logger } from './log.ts';

/** Constantes do WebGL2 (números fixos da especificação; o nx.js e o portcheck não precisam expor os estáticos). */
export const GL = {
  NO_ERROR: 0,
  POINTS: 0x0000,
  TRIANGLES: 0x0004,
  DEPTH_BUFFER_BIT: 0x0100,
  COLOR_BUFFER_BIT: 0x4000,
  VENDOR: 0x1f00,
  RENDERER: 0x1f01,
  VERSION: 0x1f02,
  SHADING_LANGUAGE_VERSION: 0x8b8c,
  MAX_TEXTURE_SIZE: 0x0d33,
  MAX_ARRAY_TEXTURE_LAYERS: 0x88ff,
  MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8b4c,
  MAX_SAMPLES: 0x8d57,
  TEXTURE_2D: 0x0de1,
  TEXTURE_2D_ARRAY: 0x8c1a,
  TEXTURE0: 0x84c0,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  NEAREST: 0x2600,
  NEAREST_MIPMAP_LINEAR: 0x2702,
  REPEAT: 0x2901,
  CLAMP_TO_EDGE: 0x812f,
  RGBA: 0x1908,
  RGBA8: 0x8058,
  DEPTH24_STENCIL8: 0x88f0,
  UNSIGNED_BYTE: 0x1401,
  UNSIGNED_SHORT: 0x1403,
  ARRAY_BUFFER: 0x8892,
  STATIC_DRAW: 0x88e4,
  VERTEX_SHADER: 0x8b31,
  FRAGMENT_SHADER: 0x8b30,
  COMPILE_STATUS: 0x8b81,
  LINK_STATUS: 0x8b82,
  FRAMEBUFFER: 0x8d40,
  READ_FRAMEBUFFER: 0x8ca8,
  DRAW_FRAMEBUFFER: 0x8ca9,
  RENDERBUFFER: 0x8d41,
  COLOR_ATTACHMENT0: 0x8ce0,
  DEPTH_STENCIL_ATTACHMENT: 0x821a,
  FRAMEBUFFER_COMPLETE: 0x8cd5,
  UNPACK_ALIGNMENT: 0x0cf5,
  PACK_ALIGNMENT: 0x0d05,
  SCISSOR_TEST: 0x0c11,
  DEPTH_TEST: 0x0b71,
  BLEND: 0x0be2,
  CULL_FACE: 0x0b44,
  ELEMENT_ARRAY_BUFFER: 0x8893,
  FLOAT: 0x1406,
  TEXTURE1: 0x84c1,
  LINES: 0x0001,
  TRIANGLE_STRIP: 0x0005,
} as const;

export interface GlProbeEnv {
  readonly gl: WebGL2RenderingContext;
  readonly now: () => number;
  readonly log: T0Logger;
  /** Tamanho da tela (para o viewport padrão e o FBO do item 9). */
  readonly width: number;
  readonly height: number;
  /** Construtor `OffscreenCanvas` do nx.js (item 7), ou `undefined`. */
  readonly OffscreenCanvas?: unknown;
}

interface GlObjects {
  textures: WebGLTexture[];
  buffers: WebGLBuffer[];
  framebuffers: WebGLFramebuffer[];
  renderbuffers: WebGLRenderbuffer[];
  programs: WebGLProgram[];
  shaders: WebGLShader[];
  vaos: WebGLVertexArrayObject[];
}

const num = (v: unknown): number => (typeof v === 'number' ? v : -1);

/** Lê erros pendentes (zera a fila) e devolve o primeiro, ou 0. */
function drainErrors(gl: WebGL2RenderingContext): number {
  let first = GL.NO_ERROR as number;
  try {
    for (let i = 0; i < 8; i++) {
      const e = gl.getError();
      if (e === GL.NO_ERROR) break;
      if (first === GL.NO_ERROR) first = e;
    }
  } catch {
    // contexto quebrado: quem chamou já está tratando a falha
  }
  return first;
}

function compile(gl: WebGL2RenderingContext, o: GlObjects, type: number, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error('createShader devolveu null');
  o.shaders.push(s);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, GL.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s) ?? '?'}`);
  return s;
}

function link(
  gl: WebGL2RenderingContext,
  o: GlObjects,
  vs: string,
  fs: string,
  attribute0: string | null = null,
): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error('createProgram devolveu null');
  o.programs.push(p);
  gl.attachShader(p, compile(gl, o, GL.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, o, GL.FRAGMENT_SHADER, fs));
  // Como o three (`WebGLProgram`: `bindAttribLocation(program, 0, 'position')`): a posição 0 nunca fica com um
  // atributo instanciado (proibido no GL de desktop e frágil em driver).
  if (attribute0) gl.bindAttribLocation(p, 0, attribute0);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, GL.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(p) ?? '?'}`);
  return p;
}

/** FBO pequeno com textura RGBA8 (alvo de leitura das sondas). */
function smallTarget(gl: WebGL2RenderingContext, o: GlObjects, size: number): WebGLFramebuffer {
  const tex = gl.createTexture()!;
  o.textures.push(tex);
  gl.bindTexture(GL.TEXTURE_2D, tex);
  gl.texStorage2D(GL.TEXTURE_2D, 1, GL.RGBA8, size, size);
  const fb = gl.createFramebuffer()!;
  o.framebuffers.push(fb);
  gl.bindFramebuffer(GL.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(GL.FRAMEBUFFER);
  if (status !== GL.FRAMEBUFFER_COMPLETE) throw new Error(`FBO de leitura incompleto (0x${status.toString(16)})`);
  gl.viewport(0, 0, size, size);
  return fb;
}

/** Camada, texel (x, y) e cor esperada no teste de amostragem do item 4/5. */
export const ARRAY_PROBE = { layer: 200, texelX: 3, texelY: 5 } as const;

/** Cor do texel do array 16×16 de teste: R = camada, G = x·16, B = y·16. */
export function arrayTexel(layer: number, x: number, y: number): [number, number, number, number] {
  return [layer & 255, (x * 16) & 255, (y * 16) & 255, 255];
}

const VS_INT = `#version 300 es
layout(location = 0) in uvec2 aCell;
flat out uint vLayer;
flat out uint vMark;
void main() {
  vLayer = aCell.y;
  vMark = aCell.x;
  vec2 p = vec2(float((gl_VertexID & 1) * 4) - 1.0, float((gl_VertexID & 2) * 2) - 1.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

// uv fora de [0, 1] de propósito: com REPEAT, (2 + 3,5/16, -1 + 5,5/16) cai no texel (3, 5) da MESMA camada.
const FS_ARRAY = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uTex;
flat in uint vLayer;
flat in uint vMark;
out vec4 oColor;
void main() {
  vec4 c = texture(uTex, vec3(2.0 + 3.5 / 16.0, -1.0 + 5.5 / 16.0, float(vLayer)));
  oColor = vMark == 40000u ? c : vec4(1.0, 0.0, 1.0, 1.0);
}`;

const VS_TEXTURE = `#version 300 es
uniform sampler2D uTex;
void main() {
  gl_Position = vec4(texture(uTex, vec2(0.5)).rgb, 1.0);
}`;

const FS_PLAIN = `#version 300 es
precision mediump float;
out vec4 oColor;
void main() { oColor = vec4(1.0); }`;

/** Item 4 (+5): arrays de 16×16×256 e 64×64×128 com mips, REPEAT, texSubImage3D e leitura por um shader inteiro. */
function probeArrays(env: GlProbeEnv, o: GlObjects): void {
  const { gl, now, log } = env;
  const maxLayers = num(gl.getParameter(GL.MAX_ARRAY_TEXTURE_LAYERS));
  const maxSize = num(gl.getParameter(GL.MAX_TEXTURE_SIZE));
  // Um buffer para tudo: 64×64×128×4 = 2 MiB (o maior nível); os outros usam pedaços.
  const big = new Uint8Array(64 * 64 * 128 * 4);
  // Só o tempo do GL conta (encher o buffer em JS é custo da sonda, não do upload).
  let msSmall = 0;
  let t0 = now();

  const small = gl.createTexture()!;
  o.textures.push(small);
  gl.activeTexture(GL.TEXTURE0);
  gl.bindTexture(GL.TEXTURE_2D_ARRAY, small);
  gl.texStorage3D(GL.TEXTURE_2D_ARRAY, 5, GL.RGBA8, 16, 16, 256);
  msSmall += now() - t0;
  for (let level = 0; level < 5; level++) {
    const s = 16 >> level;
    const data = big.subarray(0, s * s * 256 * 4);
    for (let layer = 0; layer < 256; layer++) {
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          // Nível 0 = `arrayTexel(layer, x, y)`; os mips ficam pretos (a leitura acontece no nível 0).
          const p = ((layer * s + y) * s + x) * 4;
          data[p] = level === 0 ? layer & 255 : 0;
          data[p + 1] = level === 0 ? (x * 16) & 255 : 0;
          data[p + 2] = level === 0 ? (y * 16) & 255 : 0;
          data[p + 3] = 255;
        }
      }
    }
    t0 = now();
    gl.texSubImage3D(GL.TEXTURE_2D_ARRAY, level, 0, 0, 0, s, s, 256, GL.RGBA, GL.UNSIGNED_BYTE, data);
    msSmall += now() - t0;
  }
  t0 = now();
  gl.texParameteri(GL.TEXTURE_2D_ARRAY, GL.TEXTURE_MIN_FILTER, GL.NEAREST_MIPMAP_LINEAR);
  gl.texParameteri(GL.TEXTURE_2D_ARRAY, GL.TEXTURE_MAG_FILTER, GL.NEAREST);
  gl.texParameteri(GL.TEXTURE_2D_ARRAY, GL.TEXTURE_WRAP_S, GL.REPEAT);
  gl.texParameteri(GL.TEXTURE_2D_ARRAY, GL.TEXTURE_WRAP_T, GL.REPEAT);
  const errSmall = drainErrors(gl);
  msSmall += now() - t0;

  const t1 = now();
  const models = gl.createTexture()!;
  o.textures.push(models);
  gl.bindTexture(GL.TEXTURE_2D_ARRAY, models);
  gl.texStorage3D(GL.TEXTURE_2D_ARRAY, 7, GL.RGBA8, 64, 64, 128);
  for (let level = 0; level < 7; level++) {
    const s = 64 >> level;
    gl.texSubImage3D(
      GL.TEXTURE_2D_ARRAY,
      level,
      0,
      0,
      0,
      s,
      s,
      128,
      GL.RGBA,
      GL.UNSIGNED_BYTE,
      big.subarray(0, s * s * 128 * 4),
    );
  }
  gl.texParameteri(GL.TEXTURE_2D_ARRAY, GL.TEXTURE_MIN_FILTER, GL.NEAREST_MIPMAP_LINEAR);
  gl.texParameteri(GL.TEXTURE_2D_ARRAY, GL.TEXTURE_MAG_FILTER, GL.NEAREST);
  const errModels = drainErrors(gl);
  const msModels = now() - t1;
  // Skin composta em runtime: uma camada 64×64 com profundidade 1 (o `writeModelLayer` faz isto num laço: as
  // `FIGURE_SKIN_LAYERS` = 2 camadas por skin do boneco do FutBobo × 7 níveis, #56; eram 4 na skin ampliada da #51;
  // aqui a sonda mede só o nível 0 de uma camada).
  const t2 = now();
  gl.texSubImage3D(
    GL.TEXTURE_2D_ARRAY,
    0,
    0,
    0,
    100,
    64,
    64,
    1,
    GL.RGBA,
    GL.UNSIGNED_BYTE,
    big.subarray(0, 64 * 64 * 4),
  );
  const errSkin = drainErrors(gl);
  const msSkin = now() - t2;

  // Leitura: atributo inteiro (u16 pelo vertexAttribIPointer) escolhe a camada; uv fora de [0, 1] testa o REPEAT.
  let sample = 'nao_testado';
  let intAttr = 'nao_testado';
  let sampleError = '';
  const t3 = now();
  let msShader = 0;
  let msDraw = 0;
  try {
    const program = link(gl, o, VS_INT, FS_ARRAY);
    msShader = now() - t3;
    const t4 = now();
    const fb = smallTarget(gl, o, 4);
    const vao = gl.createVertexArray()!;
    o.vaos.push(vao);
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer()!;
    o.buffers.push(buffer);
    gl.bindBuffer(GL.ARRAY_BUFFER, buffer);
    gl.bufferData(
      GL.ARRAY_BUFFER,
      new Uint16Array([
        40000,
        ARRAY_PROBE.layer,
        40000,
        ARRAY_PROBE.layer,
        40000,
        ARRAY_PROBE.layer,
        40000,
        ARRAY_PROBE.layer,
      ]),
      GL.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribIPointer(0, 2, GL.UNSIGNED_SHORT, 4, 0);
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, 'uTex'), 0);
    gl.activeTexture(GL.TEXTURE0);
    gl.bindTexture(GL.TEXTURE_2D_ARRAY, small);
    gl.bindFramebuffer(GL.FRAMEBUFFER, fb);
    gl.drawArrays(GL.TRIANGLES, 0, 3);
    const px = new Uint8Array(4);
    gl.readPixels(1, 1, 1, 1, GL.RGBA, GL.UNSIGNED_BYTE, px);
    const err = drainErrors(gl);
    msDraw = now() - t4;
    const want = arrayTexel(ARRAY_PROBE.layer, ARRAY_PROBE.texelX, ARRAY_PROBE.texelY);
    const magenta = px[0] === 255 && px[1] === 0 && px[2] === 255;
    intAttr = err !== GL.NO_ERROR ? `erro_gl_0x${err.toString(16)}` : magenta ? 'valor_errado' : 'ok';
    sample =
      err !== GL.NO_ERROR
        ? `erro_gl_0x${err.toString(16)}`
        : px[0] === want[0] && px[1] === want[1] && px[2] === want[2]
          ? 'ok'
          : `lido_${px[0]}_${px[1]}_${px[2]}`;
  } catch (error) {
    sampleError = errorText(error);
    sample = 'falhou';
    intAttr = 'falhou';
  }

  const allocOk = errSmall === GL.NO_ERROR && errModels === GL.NO_ERROR && errSkin === GL.NO_ERROR;
  log(4, allocOk && sample === 'ok' ? 'ok' : 'falha', {
    fonte: 'casca',
    camadas_max: maxLayers,
    textura_max: maxSize,
    blocos16: errSmall === GL.NO_ERROR ? 'ok' : `erro_0x${errSmall.toString(16)}`,
    blocos16_ms: ms2(msSmall),
    modelos64: errModels === GL.NO_ERROR ? 'ok' : `erro_0x${errModels.toString(16)}`,
    modelos64_ms: ms2(msModels),
    subimage3d: errSkin === GL.NO_ERROR ? 'ok' : `erro_0x${errSkin.toString(16)}`,
    subimage3d_ms: ms2(msSkin),
    repeat_na_camada: sample,
    shader_ms: ms2(msShader),
    desenho_ms: ms2(msDraw),
    ...(sampleError ? { erro: sampleError } : {}),
  });
  log(5, intAttr === 'ok' ? 'ok' : 'falha', {
    fonte: 'casca',
    vertexAttribIPointer: typeof gl.vertexAttribIPointer === 'function',
    u16_para_uvec2: intAttr,
    ...(sampleError ? { erro: sampleError } : {}),
  });
}

/** Item 6: textura no vertex shader (informativo: o plano não depende disso, regra 6). */
function probeVertexTexture(env: GlProbeEnv, o: GlObjects): void {
  const { gl, log } = env;
  const units = num(gl.getParameter(GL.MAX_VERTEX_TEXTURE_IMAGE_UNITS));
  let compiled = 'nao_testado';
  try {
    link(gl, o, VS_TEXTURE, FS_PLAIN);
    compiled = 'ok';
  } catch (error) {
    compiled = errorText(error);
  }
  log(6, 'info', { fonte: 'casca', unidades_vs: units, shader_com_textura: compiled });
}

/** Item 7: OffscreenCanvas 2D como fonte do texImage2D (plano B do texto; informativo). */
function probeOffscreen(env: GlProbeEnv, o: GlObjects): void {
  const { gl, now, log } = env;
  const Ctor = env.OffscreenCanvas as (new (w: number, h: number) => unknown) | undefined;
  if (typeof Ctor !== 'function') {
    log(7, 'falha', { fonte: 'casca', offscreen: false });
    return;
  }
  const t0 = now();
  const canvas = new Ctor(4, 4) as {
    getContext(id: '2d'): { fillStyle: string; fillRect(x: number, y: number, w: number, h: number): void } | null;
  };
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    log(7, 'falha', { fonte: 'casca', offscreen: true, contexto2d: false });
    return;
  }
  ctx.fillStyle = '#ff8000';
  ctx.fillRect(0, 0, 4, 4);
  const tex = gl.createTexture()!;
  o.textures.push(tex);
  gl.bindTexture(GL.TEXTURE_2D, tex);
  gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, canvas as unknown as TexImageSource);
  const errUpload = drainErrors(gl);
  const fb = gl.createFramebuffer()!;
  o.framebuffers.push(fb);
  gl.bindFramebuffer(GL.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, tex, 0);
  const px = new Uint8Array(4);
  gl.readPixels(1, 1, 1, 1, GL.RGBA, GL.UNSIGNED_BYTE, px);
  const errRead = drainErrors(gl);
  const close = (a: number, b: number): boolean => Math.abs(a - b) <= 2;
  const right = close(px[0]!, 255) && close(px[1]!, 128) && close(px[2]!, 0);
  log(7, errUpload === GL.NO_ERROR && right ? 'ok' : 'falha', {
    fonte: 'casca',
    offscreen: true,
    teximage2d: errUpload === GL.NO_ERROR ? 'ok' : `erro_0x${errUpload.toString(16)}`,
    leitura: errRead === GL.NO_ERROR ? `${px[0]}_${px[1]}_${px[2]}_${px[3]}` : `erro_0x${errRead.toString(16)}`,
    ms: ms2(now() - t0),
  });
}

/** Item 9: FBO multisample 2× + blitFramebuffer em 1280×720 (custo do resolve; informativo para o perfil). */
function probeMsaa(env: GlProbeEnv, o: GlObjects): void {
  const { gl, now, log } = env;
  const maxSamples = num(gl.getParameter(GL.MAX_SAMPLES));
  const samples = Math.min(2, Math.max(0, maxSamples));
  if (samples < 2) {
    log(9, 'falha', { fonte: 'casca', amostras_max: maxSamples });
    return;
  }
  const w = env.width;
  const h = env.height;
  const color = gl.createRenderbuffer()!;
  const depth = gl.createRenderbuffer()!;
  o.renderbuffers.push(color, depth);
  gl.bindRenderbuffer(GL.RENDERBUFFER, color);
  gl.renderbufferStorageMultisample(GL.RENDERBUFFER, samples, GL.RGBA8, w, h);
  gl.bindRenderbuffer(GL.RENDERBUFFER, depth);
  gl.renderbufferStorageMultisample(GL.RENDERBUFFER, samples, GL.DEPTH24_STENCIL8, w, h);
  const msFb = gl.createFramebuffer()!;
  o.framebuffers.push(msFb);
  gl.bindFramebuffer(GL.FRAMEBUFFER, msFb);
  gl.framebufferRenderbuffer(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.RENDERBUFFER, color);
  gl.framebufferRenderbuffer(GL.FRAMEBUFFER, GL.DEPTH_STENCIL_ATTACHMENT, GL.RENDERBUFFER, depth);
  const status = gl.checkFramebufferStatus(GL.FRAMEBUFFER);
  if (status !== GL.FRAMEBUFFER_COMPLETE) {
    log(9, 'falha', { fonte: 'casca', amostras: samples, fbo: `incompleto_0x${status.toString(16)}` });
    return;
  }
  const resolveTex = gl.createTexture()!;
  o.textures.push(resolveTex);
  gl.bindTexture(GL.TEXTURE_2D, resolveTex);
  gl.texStorage2D(GL.TEXTURE_2D, 1, GL.RGBA8, w, h);
  const resolveFb = gl.createFramebuffer()!;
  o.framebuffers.push(resolveFb);
  gl.bindFramebuffer(GL.FRAMEBUFFER, resolveFb);
  gl.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, resolveTex, 0);
  gl.viewport(0, 0, w, h);
  const runs = 10;
  gl.finish();
  const t0 = now();
  for (let i = 0; i < runs; i++) {
    gl.bindFramebuffer(GL.FRAMEBUFFER, msFb);
    gl.clearColor(i / runs, 0.5, 0.25, 1);
    gl.clear(GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT);
    gl.bindFramebuffer(GL.READ_FRAMEBUFFER, msFb);
    gl.bindFramebuffer(GL.DRAW_FRAMEBUFFER, resolveFb);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, GL.COLOR_BUFFER_BIT, GL.NEAREST);
  }
  gl.finish();
  const total = now() - t0;
  const err = drainErrors(gl);
  log(9, err === GL.NO_ERROR ? 'ok' : 'falha', {
    fonte: 'casca',
    amostras_max: maxSamples,
    amostras: samples,
    tamanho: `${w}x${h}`,
    clear_blit_ms: ms2(total / runs),
    ...(err === GL.NO_ERROR ? {} : { erro: `gl_0x${err.toString(16)}` }),
  });
}

// ——— Instanciamento adiado do Eden ———
//
// Medido no Eden `master-faaf1bac64` (04/11/2026; bancada em `local/futbobo-port/passo45/eden/lab/`): o mesa nvc0 do
// nx.js desenha um draw de N instâncias como N pares BEGIN/END (INSTANCE_NEXT a partir da 2ª). O Eden desenha a
// instância 0 na hora e ADIA as outras: elas só saem no BEGIN do draw seguinte (ou depois de uma macro da MME), com
// os registradores daquele momento, isto é, com o estado (buffers, uniforms, programa) do draw SEGUINTE. Efeitos: o
// draw mostra só a instância 0; o seguinte sai com N instâncias (truncado se tinha mais, com fantasmas lidos além do
// `count` se tinha menos); um draw comum depois de um instanciado sai N vezes. É do motor de GPU do Eden (igual em
// Vulkan e OpenGL e com qualquer opção de renderer da config); o console não deve ter (mesmo mesa, GPU de verdade).
//
// Contorno: logo depois de cada draw instanciado de 2+ instâncias, o MESMO draw sem instância e com 1 primitiva
// (mesmo programa, VAO, uniforms e início da faixa). Como nada muda no estado, o BEGIN dele solta as instâncias
// adiadas com o estado certo. Ele mesmo redesenha a 1ª primitiva da instância 0 (idêntica: some com depthFunc LEQUAL
// e sem blend; com blend, essa primitiva soma de novo). Por isso o contorno só liga onde a detecção acha o defeito.

/** Vértices de uma primitiva por modo do GL (POINTS 0 … TRIANGLE_FAN 6). */
const PRIMITIVE_VERTS = [1, 2, 2, 2, 3, 3, 3] as const;

/** Marca no contexto embrulhado (não embrulha duas vezes; a sonda sabe que o contorno já está ligado). */
const WORKAROUND_KEY = 'bfDeferredInstancingFix';

/** O contorno do instanciamento adiado já está no contexto? */
export function instancingWorkaroundInstalled(gl: WebGL2RenderingContext): boolean {
  return (gl as unknown as Record<string, unknown>)[WORKAROUND_KEY] === true;
}

/**
 * Embrulha `drawArraysInstanced` e `drawElementsInstanced` do contexto com o contorno (acima). O three chama os dois
 * pelo contexto a cada draw (`gl.drawElementsInstanced(...)`), então basta embrulhar antes ou depois de criar o
 * renderer. Custo: 1 draw a mais por draw instanciado de 2+ instâncias. Devolve como desfazer.
 * Efeito colateral conhecido (só onde a detecção liga, ou seja, no Eden): a 1ª primitiva da instância 0 sai duas vezes.
 * Nos opacos (depthFunc LEQUAL) é invisível; nos draws com blend (sombra-blob `decal`, partículas `additive`/`alpha`)
 * ela soma de novo, e a sombra do 1º boneco fica mais escura num triângulo. Um draw extra que não rasteriza (contagem
 * 0) talvez solte as instâncias sem esse efeito: falta medir no Eden. No console a detecção dá "normal" e nada muda.
 */
export function installInstancingWorkaround(gl: WebGL2RenderingContext): () => void {
  const target = gl as unknown as Record<string, unknown>;
  if (instancingWorkaroundInstalled(gl)) return () => {};
  const drawArraysInstanced = gl.drawArraysInstanced;
  const drawElementsInstanced = gl.drawElementsInstanced;
  const drawArrays = gl.drawArrays;
  const drawElements = gl.drawElements;
  const own = (name: string): boolean => Object.prototype.hasOwnProperty.call(target, name);
  const hadArrays = own('drawArraysInstanced');
  const hadElements = own('drawElementsInstanced');
  // quente: um par de draws por draw instanciado, todo quadro (sem alocação)
  function primitive(mode: number, count: number): number {
    const v = PRIMITIVE_VERTS[mode] ?? 3;
    return count < v ? count : v;
  }
  function arraysFixed(mode: number, first: number, count: number, instances: number): void {
    drawArraysInstanced.call(gl, mode, first, count, instances);
    if (instances > 1) drawArrays.call(gl, mode, first, primitive(mode, count));
  }
  function elementsFixed(mode: number, count: number, type: number, offset: number, instances: number): void {
    drawElementsInstanced.call(gl, mode, count, type, offset, instances);
    if (instances > 1) drawElements.call(gl, mode, primitive(mode, count), type, offset);
  }
  // fim-quente
  target['drawArraysInstanced'] = arraysFixed;
  target['drawElementsInstanced'] = elementsFixed;
  target[WORKAROUND_KEY] = true;
  return () => {
    if (hadArrays) target['drawArraysInstanced'] = drawArraysInstanced;
    else delete target['drawArraysInstanced'];
    if (hadElements) target['drawElementsInstanced'] = drawElementsInstanced;
    else delete target['drawElementsInstanced'];
    delete target[WORKAROUND_KEY];
  };
}

/** Instância i acende o pixel (i, 0) de um alvo 8×8; `uShift` empurra o draw para fora do alvo. */
const VS_DETECT = `#version 300 es
uniform float uShift;
void main() {
  float v = float(gl_VertexID);
  float x = float(gl_InstanceID) + uShift + (v < 0.5 ? 0.1 : (v < 1.5 ? 0.9 : 0.5));
  gl_Position = vec4(x * 0.25 - 1.0, v < 1.5 ? -3.0 : 5.0, 0.0, 1.0);
}`;

/** Resultado da detecção: `acesos` = instâncias que apareceram de 4 (GPU certa: 4; Eden: 1). */
export interface DeferredInstancingCheck {
  readonly deferred: boolean;
  readonly lit: number;
  /** `adiado`, `normal` ou `indefinido` (outra contagem, ou erro de GL). */
  readonly verdict: 'adiado' | 'normal' | 'indefinido';
}

function emptyObjects(): GlObjects {
  return { textures: [], buffers: [], framebuffers: [], renderbuffers: [], programs: [], shaders: [], vaos: [] };
}

function deleteObjects(gl: WebGL2RenderingContext, o: GlObjects): void {
  for (const x of o.vaos) gl.deleteVertexArray(x);
  for (const x of o.buffers) gl.deleteBuffer(x);
  for (const x of o.programs) gl.deleteProgram(x);
  for (const x of o.shaders) gl.deleteShader(x);
  for (const x of o.framebuffers) gl.deleteFramebuffer(x);
  for (const x of o.renderbuffers) gl.deleteRenderbuffer(x);
  for (const x of o.textures) gl.deleteTexture(x);
}

/**
 * Acha o instanciamento adiado em 3 draws minúsculos e um `readPixels` de 8 px. Chamar ANTES do three (como as
 * sondas): o contexto volta ao estado padrão no fim. Usa sempre os draws CRUS do contexto (com o contorno ligado, a
 * detecção diria "normal"). Sequência: um draw comum fora do alvo (solta o que estiver adiado, fora do alvo), um draw
 * de 4 instâncias no alvo e outro comum fora do alvo (no Eden, ele leva as 3 instâncias adiadas para fora).
 */
export function detectDeferredInstancing(gl: WebGL2RenderingContext): DeferredInstancingCheck {
  const o = emptyObjects();
  const proto = Object.getPrototypeOf(gl) as WebGL2RenderingContext | null;
  const rawInstanced = (instancingWorkaroundInstalled(gl) && proto?.drawArraysInstanced) || gl.drawArraysInstanced;
  let lit = -1;
  try {
    const program = link(gl, o, VS_DETECT, FS_PLAIN);
    smallTarget(gl, o, 8);
    const vao = gl.createVertexArray()!;
    o.vaos.push(vao);
    gl.bindVertexArray(vao);
    gl.useProgram(program);
    const shift = gl.getUniformLocation(program, 'uShift');
    gl.disable(GL.DEPTH_TEST);
    gl.disable(GL.BLEND);
    gl.disable(GL.CULL_FACE);
    gl.disable(GL.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(GL.COLOR_BUFFER_BIT);
    gl.uniform1f(shift, 100);
    gl.drawArrays(GL.TRIANGLES, 0, 3);
    gl.uniform1f(shift, 0);
    rawInstanced.call(gl, GL.TRIANGLES, 0, 3, 4);
    gl.uniform1f(shift, 100);
    gl.drawArrays(GL.TRIANGLES, 0, 3);
    const px = new Uint8Array(8 * 4);
    gl.readPixels(0, 0, 8, 1, GL.RGBA, GL.UNSIGNED_BYTE, px);
    if (drainErrors(gl) === GL.NO_ERROR) {
      lit = 0;
      for (let i = 0; i < 8; i++) if (px[i * 4 + 3]! > 0) lit++;
    }
  } catch {
    lit = -1;
  } finally {
    try {
      gl.bindVertexArray(null);
      gl.useProgram(null);
      gl.bindFramebuffer(GL.FRAMEBUFFER, null);
      gl.bindTexture(GL.TEXTURE_2D, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      deleteObjects(gl, o);
      drainErrors(gl);
    } catch {
      // contexto perdido: quem chamou segue sem o contorno
    }
  }
  const verdict = lit === 1 ? 'adiado' : lit === 4 ? 'normal' : 'indefinido';
  return { deferred: verdict === 'adiado', lit, verdict };
}

/**
 * Boot da casca: acha o instanciamento adiado e liga o contorno SÓ onde ele aparece (o Eden; no console a detecção deve
 * dar "normal" e nada muda). Roda a cada boot, fora da marca das sondas, antes delas e do renderer. Devolve a linha
 * `[boot]` do `runtime.log`.
 */
export function applyInstancingFix(gl: WebGL2RenderingContext): string {
  const check = detectDeferredInstancing(gl);
  if (check.deferred) installInstancingWorkaround(gl);
  return `[boot] instanciamento=${check.verdict} acesos=${check.lit}/4 contorno=${check.deferred ? 1 : 0}`;
}

/** Linha `item=4 … sonda=instanciamento` (detecção + se o contorno já está no contexto). */
function probeInstancing(env: GlProbeEnv): void {
  const t0 = env.now();
  const check = detectDeferredInstancing(env.gl);
  env.log(4, 'info', {
    fonte: 'casca',
    sonda: 'instanciamento',
    resultado: check.verdict,
    acesos: `${check.lit}/4`,
    contorno_ativo: instancingWorkaroundInstalled(env.gl),
    ms: ms2(env.now() - t0),
  });
}

/** As duas rotas do renderer (`creationDefines`): array + atributo inteiro e atlas + float (plano B do T0). */
export const FIGURE_PROBE_ROUTES = [
  { name: 'array', defines: '', atlas: false },
  { name: 'atlas', defines: '#define ATLAS 1\n#define VERTEX_FLOAT 1\n', atlas: true },
] as const;

/** Atlas do plano B na sonda: 2 colunas, padding de 4 px (o `ATLAS_PADDING.modelos64` do render). */
const PROBE_ATLAS_PADDING = 4;

/**
 * Cabeçalho que o three põe num `ShaderMaterial` GLSL3 (versão, `#define`s de criação, precisões, matrizes da câmera e
 * os atributos `position`/`normal`/`uv`/`instanceMatrix`): o resto é o texto real do programa 4.
 */
export function figureProbeHeader(defines: string, vertex: boolean): string {
  const common =
    `#version 300 es\n${defines}precision highp float;\nprecision highp int;\nprecision highp sampler2D;\n` +
    'precision highp sampler2DArray;\nuniform mat4 viewMatrix;\nuniform vec3 cameraPosition;\n';
  if (!vertex) return common;
  return (
    common +
    'uniform mat4 modelMatrix;\nuniform mat4 projectionMatrix;\n' +
    'in vec3 position;\nin vec3 normal;\nin vec2 uv;\nin mat4 instanceMatrix;\n'
  );
}

/** Bytes do atlas (camadas em grade, padding repetindo a borda, como `buildAtlasLevels` com `clamp`). */
export function figureProbeAtlas(scene: FigureProbeScene): { bytes: Uint8Array; cols: number; size: number } {
  const tile = scene.layerSize;
  const pad = PROBE_ATLAS_PADDING;
  const cols = Math.max(1, Math.ceil(Math.sqrt(scene.layers)));
  const rows = Math.max(1, Math.ceil(scene.layers / cols));
  const cell = tile + 2 * pad;
  const size = Math.max(cols, rows) * cell;
  const bytes = new Uint8Array(size * size * 4);
  for (let layer = 0; layer < scene.layers; layer++) {
    const ox = (layer % cols) * cell;
    const oy = Math.floor(layer / cols) * cell;
    for (let y = 0; y < cell; y++) {
      const sy = Math.min(tile - 1, Math.max(0, y - pad));
      for (let x = 0; x < cell; x++) {
        const sx = Math.min(tile - 1, Math.max(0, x - pad));
        const s = ((layer * tile + sy) * tile + sx) * 4;
        const d = ((oy + y) * size + ox + x) * 4;
        for (let c = 0; c < 4; c++) bytes[d + c] = scene.texels[s + c]!;
      }
    }
  }
  return { bytes, cols, size };
}

/** Nomes dos 4 `vec4` de dados por instância do programa 4 (`layout.ts`). */
const DATA_ATTRIBS = ['iLayer', 'iLight', 'iColor', 'iPart'] as const;

/** 4 `vec4` por instância num buffer de 16 floats (matriz: 4 colunas; dados: iLayer, iLight, iColor, iPart). */
interface InstanceAttribs {
  readonly buffer: WebGLBuffer;
  /** Posição de cada um dos 4 `vec4` (−1 = inativo). */
  readonly locs: readonly number[];
}

/**
 * Liga os 4 `vec4` de instância de um buffer de 16 floats por instância, na ordem do three
 * (`enableVertexAttribArray`, `vertexAttribDivisor`, `vertexAttribPointer`). `names` com 1 nome = uma matriz (4
 * posições seguidas a partir da do nome).
 */
function bindInstanceAttribs(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  names: readonly string[],
  buffer: WebGLBuffer,
  first: number,
): InstanceAttribs {
  gl.bindBuffer(GL.ARRAY_BUFFER, buffer);
  const base = names.length === 1 ? num(gl.getAttribLocation(program, names[0]!)) : -1;
  const locs: number[] = [];
  for (let k = 0; k < 4; k++) {
    const loc = names.length === 1 ? (base >= 0 ? base + k : -1) : num(gl.getAttribLocation(program, names[k]!));
    locs.push(loc);
    if (loc < 0) continue;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribDivisor(loc, 1);
    gl.vertexAttribPointer(loc, 4, GL.FLOAT, false, 64, first * 64 + k * 16);
  }
  return { buffer, locs };
}

function instanceBuffer(gl: WebGL2RenderingContext, o: GlObjects, values: Float32Array): WebGLBuffer {
  const buffer = gl.createBuffer()!;
  o.buffers.push(buffer);
  gl.bindBuffer(GL.ARRAY_BUFFER, buffer);
  // DYNAMIC_DRAW, como os atributos de instância do three (`setUsage`).
  gl.bufferData(GL.ARRAY_BUFFER, values, 0x88e8);
  return buffer;
}

function setUniforms(gl: WebGL2RenderingContext, program: WebGLProgram, scene: FigureProbeScene, atlas: number): void {
  const at = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name);
  for (const [name, v] of Object.entries(scene.uniforms)) {
    const loc = at(name);
    if (!loc) continue;
    if (v.length === 1) gl.uniform1f(loc, v[0]!);
    else gl.uniform3f(loc, v[0]!, v[1]!, v[2]!);
  }
  const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const model = at('modelMatrix');
  if (model) gl.uniformMatrix4fv(model, false, identity);
  const view = at('viewMatrix');
  if (view) gl.uniformMatrix4fv(view, false, identity);
  const projection = at('projectionMatrix');
  if (projection) gl.uniformMatrix4fv(projection, false, scene.projection);
  const camera = at('cameraPosition');
  if (camera) gl.uniform3f(camera, scene.camera[0], scene.camera[1], scene.camera[2]);
  const hide = at('uHideSlot');
  if (hide) gl.uniform1f(hide, scene.hideSlot);
  const outer = at('uOuterMaxDist');
  if (outer) gl.uniform1f(outer, scene.outerMaxDist);
  const models = at('uModels');
  if (models) gl.uniform1i(models, 0);
  // A LUT do grading (sampler2D) na unidade 1: na rota array o uModels é sampler2DArray na unidade 0, e dois tipos
  // de sampler na mesma unidade invalidam o draw.
  const lut = at('uGradeLut');
  if (lut) gl.uniform1i(lut, 1);
  const grid = at('uModelsAtlas');
  if (grid) gl.uniform4f(grid, atlas, atlas, scene.layerSize, PROBE_ATLAS_PADDING);
  const size = at('uModelsAtlasSize');
  const cell = scene.layerSize + 2 * PROBE_ATLAS_PADDING;
  if (size) gl.uniform2f(size, atlas * cell, atlas * cell);
}

/** Um draw da sonda já no GL: VAO (vértices, índices e os 2 buffers de instância). */
interface ProbeDrawGl {
  readonly vao: WebGLVertexArrayObject;
  readonly vertex: readonly WebGLBuffer[];
  readonly index: WebGLBuffer;
  readonly matrices: WebGLBuffer;
  readonly data: WebGLBuffer;
}

const VERTEX_ATTRIBS = [
  ['position', 3],
  ['normal', 3],
  ['uv', 2],
  ['aVert', 4],
] as const;

/** Liga os atributos de vértice e de instância do draw `d` no VAO atual (a partir da instância `first`). */
function bindDraw(gl: WebGL2RenderingContext, program: WebGLProgram, d: ProbeDrawGl, first: number): void {
  VERTEX_ATTRIBS.forEach(([name, size], k) => {
    const loc = num(gl.getAttribLocation(program, name));
    if (loc < 0) return;
    gl.bindBuffer(GL.ARRAY_BUFFER, d.vertex[k]!);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribDivisor(loc, 0);
    gl.vertexAttribPointer(loc, size, GL.FLOAT, false, 0, 0);
  });
  bindInstanceAttribs(gl, program, ['instanceMatrix'], d.matrices, first);
  bindInstanceAttribs(gl, program, DATA_ATTRIBS, d.data, first);
  gl.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, d.index);
}

/**
 * Como desenhar a cena:
 * - `cheio` (o que o renderer faz): o VAO de cada draw e um `drawElementsInstanced` com todas as instâncias;
 * - `instancia`: 1 draw de 1 instância por caixa, com os ponteiros deslocados (separa a conta do VS do
 *   instanciamento).
 * O `cheio` com o contorno é o próprio `cheio` com `installInstancingWorkaround` ligado.
 *
 * Medido no Eden `master-faaf1bac64` (04/11/2026): `instancia` e `cheio` com o contorno passam nas duas rotas e o
 * `cheio` cru não (o instanciamento adiado, acima de `installInstancingWorkaround`: a 1ª instância de cada draw sai
 * com o estado dele e as outras com o estado do draw seguinte). O console é o teste que vale.
 */
type ProbeDrawMode = 'cheio' | 'instancia';

function renderScene(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  scene: FigureProbeScene,
  draws: readonly ProbeDrawGl[],
  mode: ProbeDrawMode,
): Uint8Array {
  gl.clearColor(0, 0, 0, 0);
  gl.clear(GL.COLOR_BUFFER_BIT);
  scene.draws.forEach((d, k) => {
    const g = draws[k]!;
    gl.bindVertexArray(g.vao);
    if (mode === 'instancia') {
      for (let i = 0; i < d.instances; i++) {
        bindDraw(gl, program, g, i);
        gl.drawElementsInstanced(GL.TRIANGLES, d.geometry.indexCount, GL.UNSIGNED_SHORT, 0, 1);
      }
      bindDraw(gl, program, g, 0);
    } else {
      gl.drawElementsInstanced(GL.TRIANGLES, d.geometry.indexCount, GL.UNSIGNED_SHORT, 0, d.instances);
    }
    gl.bindVertexArray(null);
  });
  const pixels = new Uint8Array(scene.width * scene.height * 4);
  gl.readPixels(0, 0, scene.width, scene.height, GL.RGBA, GL.UNSIGNED_BYTE, pixels);
  return pixels;
}

/** Texto curto de uma conferência: "certos/total", e as caixas erradas quando há. */
function checkText(c: FigureProbeCheck): string {
  return c.ok === c.total ? `${c.ok}/${c.total}` : `${c.ok}/${c.total}:${c.failed.slice(0, 160)}`;
}

/** Uma rota: compila o programa 4, desenha a cena num FBO RGBA8 e confere os pixels. */
function probeFigureRoute(
  env: GlProbeEnv,
  o: GlObjects,
  scene: FigureProbeScene,
  route: (typeof FIGURE_PROBE_ROUTES)[number],
): void {
  const { gl, now, log } = env;
  const t0 = now();
  // `position` na posição 0, como o three (`bindAttribLocation(program, 0, 'position')`).
  const program = link(
    gl,
    o,
    figureProbeHeader(route.defines, true) + INSTANCED_VERTEX,
    figureProbeHeader(route.defines, false) + INSTANCED_FRAGMENT,
    'position',
  );
  const msShader = now() - t0;
  const t1 = now();

  // Textura da skin sintética (unidade 0) e a LUT de 1×1 (unidade 1).
  const S = scene.layerSize;
  gl.activeTexture(GL.TEXTURE0);
  const tex = gl.createTexture()!;
  o.textures.push(tex);
  let atlasCols = 1;
  if (route.atlas) {
    const atlas = figureProbeAtlas(scene);
    atlasCols = atlas.cols;
    gl.bindTexture(GL.TEXTURE_2D, tex);
    gl.texStorage2D(GL.TEXTURE_2D, 1, GL.RGBA8, atlas.size, atlas.size);
    gl.texSubImage2D(GL.TEXTURE_2D, 0, 0, 0, atlas.size, atlas.size, GL.RGBA, GL.UNSIGNED_BYTE, atlas.bytes);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.NEAREST);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.NEAREST);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
  } else {
    gl.bindTexture(GL.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(GL.TEXTURE_2D_ARRAY, 1, GL.RGBA8, S, S, scene.layers);
    gl.texSubImage3D(GL.TEXTURE_2D_ARRAY, 0, 0, 0, 0, S, S, scene.layers, GL.RGBA, GL.UNSIGNED_BYTE, scene.texels);
    gl.texParameteri(GL.TEXTURE_2D_ARRAY, GL.TEXTURE_MIN_FILTER, GL.NEAREST);
    gl.texParameteri(GL.TEXTURE_2D_ARRAY, GL.TEXTURE_MAG_FILTER, GL.NEAREST);
    gl.texParameteri(GL.TEXTURE_2D_ARRAY, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
    gl.texParameteri(GL.TEXTURE_2D_ARRAY, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
  }
  gl.activeTexture(GL.TEXTURE1);
  const lut = gl.createTexture()!;
  o.textures.push(lut);
  gl.bindTexture(GL.TEXTURE_2D, lut);
  gl.texStorage2D(GL.TEXTURE_2D, 1, GL.RGBA8, 1, 1);
  gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.NEAREST);
  gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.NEAREST);
  gl.activeTexture(GL.TEXTURE0);

  // Alvo W×H RGBA8, sem profundidade: as caixas ficam em células separadas e o culling de trás deixa só a face da
  // frente (as laterais ficam de perfil, sem área).
  const target = gl.createTexture()!;
  o.textures.push(target);
  gl.bindTexture(GL.TEXTURE_2D, target);
  gl.texStorage2D(GL.TEXTURE_2D, 1, GL.RGBA8, scene.width, scene.height);
  gl.bindTexture(GL.TEXTURE_2D, null);
  if (route.atlas) gl.bindTexture(GL.TEXTURE_2D, tex);
  const fb = gl.createFramebuffer()!;
  o.framebuffers.push(fb);
  gl.bindFramebuffer(GL.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, target, 0);
  const status = gl.checkFramebufferStatus(GL.FRAMEBUFFER);
  if (status !== GL.FRAMEBUFFER_COMPLETE) throw new Error(`FBO da sonda incompleto (0x${status.toString(16)})`);
  gl.viewport(0, 0, scene.width, scene.height);
  gl.disable(GL.DEPTH_TEST);
  gl.disable(GL.BLEND);
  gl.disable(GL.SCISSOR_TEST);
  gl.enable(GL.CULL_FACE);
  gl.useProgram(program);
  setUniforms(gl, program, scene, atlasCols);

  const draws: ProbeDrawGl[] = scene.draws.map((d) => {
    const vertex = [d.geometry.positions, d.geometry.normals, d.geometry.uvs, d.geometry.verts].map((values) => {
      const b = gl.createBuffer()!;
      o.buffers.push(b);
      gl.bindBuffer(GL.ARRAY_BUFFER, b);
      gl.bufferData(GL.ARRAY_BUFFER, values, GL.STATIC_DRAW);
      return b;
    });
    const index = gl.createBuffer()!;
    o.buffers.push(index);
    const vao = gl.createVertexArray()!;
    o.vaos.push(vao);
    const g: ProbeDrawGl = {
      vao,
      vertex,
      index,
      matrices: instanceBuffer(gl, o, d.matrices),
      data: instanceBuffer(gl, o, d.data),
    };
    gl.bindVertexArray(vao);
    bindDraw(gl, program, g, 0);
    gl.bufferData(GL.ELEMENT_ARRAY_BUFFER, d.geometry.indices, GL.STATIC_DRAW);
    gl.bindVertexArray(null);
    return g;
  });
  const check = checkFigureProbe(scene, renderScene(gl, program, scene, draws, 'cheio'));
  const err = drainErrors(gl);
  const msDraw = now() - t1;
  const ok = err === GL.NO_ERROR && check.ok === check.total;
  // Reprovou: 1 draw por instância e o draw cheio com o contorno (se ele já não estava no contexto). Se `instancia`
  // passa e o `cheio` não, a conta do VS está certa e o defeito é o instanciamento; `contorno` prova a correção.
  const fixed = instancingWorkaroundInstalled(gl);
  const extra: Record<string, string | number | boolean> = { contorno_ativo: fixed };
  const retries = ok ? ([] as const) : fixed ? (['instancia'] as const) : (['instancia', 'contorno'] as const);
  for (const mode of retries) {
    const undo = mode === 'contorno' ? installInstancingWorkaround(gl) : null;
    try {
      extra[mode] = checkText(
        checkFigureProbe(scene, renderScene(gl, program, scene, draws, mode === 'contorno' ? 'cheio' : mode)),
      );
    } catch (error) {
      extra[mode] = `erro:${errorText(error)}`;
    } finally {
      undo?.();
    }
  }
  drainErrors(gl);
  gl.disable(GL.CULL_FACE);
  log(4, ok ? 'ok' : 'falha', {
    fonte: 'casca',
    sonda: 'figuras',
    rota: route.name,
    compila: 'ok',
    instancias: scene.draws.reduce((n, d) => n + d.instances, 0),
    pixels: checkText(check),
    erro_gl: err === GL.NO_ERROR ? 0 : `0x${err.toString(16)}`,
    shader_ms: ms2(msShader),
    desenho_ms: ms2(msDraw),
    ...extra,
    ...(ok ? {} : { primeira_falha: check.firstFail, celulas: check.cells }),
  });
}

/** Sonda T4 do porte do boneco: as duas rotas, cada uma na sua linha; uma rota que lança não derruba a outra. */
function probeFigures(env: GlProbeEnv, o: GlObjects): void {
  try {
    probeInstancing(env);
  } catch (error) {
    env.log(4, 'falha', { fonte: 'casca', sonda: 'instanciamento', erro: errorText(error) });
    drainErrors(env.gl);
  }
  const scene = createFigureProbeScene();
  for (const route of FIGURE_PROBE_ROUTES) {
    try {
      probeFigureRoute(env, o, scene, route);
    } catch (error) {
      env.gl.disable(GL.CULL_FACE);
      env.log(4, 'falha', { fonte: 'casca', sonda: 'figuras', rota: route.name, erro: errorText(error) });
      drainErrors(env.gl);
    }
  }
}

/** Devolve o contexto ao estado padrão e apaga tudo o que as sondas criaram (o three assume o padrão). */
function restore(env: GlProbeEnv, o: GlObjects): void {
  const { gl } = env;
  gl.bindVertexArray(null);
  gl.bindBuffer(GL.ARRAY_BUFFER, null);
  gl.useProgram(null);
  gl.disable(GL.CULL_FACE);
  gl.activeTexture(GL.TEXTURE1);
  gl.bindTexture(GL.TEXTURE_2D, null);
  gl.activeTexture(GL.TEXTURE0);
  gl.bindTexture(GL.TEXTURE_2D, null);
  gl.bindTexture(GL.TEXTURE_2D_ARRAY, null);
  gl.bindRenderbuffer(GL.RENDERBUFFER, null);
  gl.bindFramebuffer(GL.FRAMEBUFFER, null);
  gl.disableVertexAttribArray(0);
  gl.pixelStorei(GL.UNPACK_ALIGNMENT, 4);
  gl.pixelStorei(GL.PACK_ALIGNMENT, 4);
  gl.clearColor(0, 0, 0, 0);
  gl.viewport(0, 0, env.width, env.height);
  deleteObjects(gl, o);
  drainErrors(gl);
}

/**
 * Roda as sondas de GL (4, 5, 6, 7, 9) e devolve o tempo total (ms). Chamar ANTES de criar o renderer: o estado do GL
 * volta ao padrão no fim, mesmo se uma sonda falhar.
 */
export function runGlProbes(env: GlProbeEnv): number {
  const t0 = env.now();
  const o = emptyObjects();
  // A sonda das figuras vai por último: lê o alvo inteiro e não pode mudar o estado que as outras assumem.
  const steps: [number, (env: GlProbeEnv, o: GlObjects) => void][] = [
    [4, probeArrays],
    [6, probeVertexTexture],
    [7, probeOffscreen],
    [9, probeMsaa],
    [4, probeFigures],
  ];
  for (const [item, step] of steps) {
    try {
      step(env, o);
    } catch (error) {
      env.log(item as 4 | 6 | 7 | 9, 'falha', { fonte: 'casca', erro: errorText(error) });
      drainErrors(env.gl);
    }
  }
  try {
    restore(env, o);
  } catch {
    // contexto perdido: o three vai acusar ao subir
  }
  return env.now() - t0;
}

/** Item 1: WebGL2 no modo aplicativo (ok) e no applet (esperado sem WebGL2: aviso "segure R"). */
export function logWebgl2(
  log: T0Logger,
  info: { readonly gl: WebGL2RenderingContext | null; readonly appletType: number; readonly application: boolean },
): void {
  const { gl } = info;
  const param = (p: number): string => {
    if (!gl) return '-';
    try {
      return String(gl.getParameter(p) ?? '-');
    } catch {
      return '-';
    }
  };
  const status = info.application ? (gl ? 'ok' : 'falha') : 'info';
  log(1, status, {
    modo_aplicativo: info.application,
    applet_tipo: info.appletType,
    webgl2: !!gl,
    versao: param(GL.VERSION),
    glsl: param(GL.SHADING_LANGUAGE_VERSION),
    gpu: param(GL.RENDERER),
    fabricante: param(GL.VENDOR),
  });
}

/** Item 2: tamanho do drawing buffer agora (boot e cada troca dock ↔ portátil). */
export function logDrawingBuffer(
  log: T0Logger,
  gl: WebGL2RenderingContext | null,
  screen: { readonly width: number; readonly height: number },
  mode: string,
  event: string,
): void {
  log(2, gl ? 'info' : 'pulado', {
    evento: event,
    modo: mode,
    buffer: gl ? `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}` : '-',
    tela: `${screen.width}x${screen.height}`,
  });
}
