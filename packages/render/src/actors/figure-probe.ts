// Cena da sonda T4 do Eden (#56, PLANO do porte §D, risco 1 do §F): uma fila de caixas sintéticas no programa 4 REAL
// (cruz, paleta, coluna, mini-cruz, giro, centro deslocado, rosto nas 8 expressões, luz e clarão pela 4ª linha,
// escondido pelo slot e pelo `uOuterMaxDist`) e 7 instâncias do caminho de hoje (props com camada no vértice). A casca
// do Switch (`apps/switch/src/t0/gl-probes.ts`) só faz o WebGL2: desenha esta cena num FBO e compara os pixels com o
// que o gêmeo do VS (`figure-cube.ts`) espera. Sem three, sem DOM: os testes do render conferem a cena em Node.
import { FIGURE_BOX_FIELD, FIGURE_BOX_FLAG, FIGURE_BOX_STRIDE, FIGURE_LAYOUT, FIGURE_SWATCH } from '@boboforces/format';
import { figureSwatchCorner } from '@boboforces/format';
import { writeFigureRow4 } from './figure-row4.ts';
import { buildFigureCubeGeometry, figureVertexLocal, figureVertexTexel, writeFigureBoxData } from './figure-cube.ts';
import { addTexturedBox, GeometryBuilder, type GeometryArrays } from './geometry.ts';
import { INST, INSTANCE_FLOATS, VERTEX_FLAG, writeInstanceDefaults } from './layout.ts';
import { MAT4 } from './math.ts';

/** Um draw da sonda: geometria + instâncias (matrizes coluna-maior com a 4ª linha e 16 floats de dados). */
export interface FigureProbeDraw {
  readonly name: string;
  readonly geometry: GeometryArrays;
  readonly instances: number;
  readonly matrices: Float32Array;
  readonly data: Float32Array;
}

/** Um ponto a conferir: pixel (origem embaixo, a do `readPixels`) e a cor esperada. */
export interface FigureProbeSample {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly rgba: readonly [number, number, number, number];
  /** Diferença aceita por canal (arredondamento da luz e do clarão). */
  readonly tolerance: number;
}

export interface FigureProbeScene {
  /** Alvo (FBO RGBA8) em px, dividido em células de `cell` px (uma caixa por célula, na ordem das instâncias). */
  readonly cell: number;
  readonly width: number;
  readonly height: number;
  readonly draws: readonly FigureProbeDraw[];
  /** Textura sintética: `layers` camadas de `layerSize`², nível 0, RGBA8 (camadas 0 e 1 = a skin; 2 = modelo). */
  readonly layers: number;
  readonly layerSize: number;
  readonly texels: Uint8Array;
  /** Câmera ortográfica: x e y em px do alvo, z para dentro da tela (coluna-maior). `view` e `model` = identidade. */
  readonly projection: Float32Array;
  readonly camera: readonly [number, number, number];
  readonly hideSlot: number;
  readonly outerMaxDist: number;
  /** Valores dos uniforms comuns (glsl-common) que a sonda usa; os outros ficam 0. `uGradeLut` vai na unidade 1. */
  readonly uniforms: Readonly<Record<string, readonly number[]>>;
  readonly samples: readonly FigureProbeSample[];
}

/** Cor do texel (x, y) da camada da textura sintética: única em cada camada, e o azul diz a camada. */
export function figureProbeTexel(layer: number, x: number, y: number): [number, number, number, number] {
  return [x * 4 + 1, y * 4 + 1, 40 + 80 * layer, 255];
}

const WIDTH = 256;
const HEIGHT = 128;
const CELL = 32;
const COLS = WIDTH / CELL;
/** Lado da face na tela (px): sobra borda na célula. */
const FACE_PX = 24;
const LAYERS = 3;
const SIZE = 64;
const HIDE_SLOT = 3;
const OUTER_MAX = 500;

type Face = 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right';
type Expect = 'texel' | 'lit' | 'flash' | 'hidden';

interface ProbeCase {
  readonly name: string;
  readonly size: readonly [number, number, number];
  readonly center?: readonly [number, number, number];
  readonly rot?: readonly [number, number];
  readonly uv: {
    readonly layer: number;
    readonly u: number;
    readonly v: number;
    readonly w: number;
    readonly h: number;
    readonly d: number;
  };
  readonly flags: number;
  readonly face: Face;
  readonly expression?: number;
  readonly slot?: number;
  readonly sky?: number;
  readonly flash?: number;
  readonly expect: Expect;
}

function swatch(i: number): ProbeCase['uv'] {
  const corner = figureSwatchCorner(i);
  const u = corner % 64;
  return { layer: FIGURE_LAYOUT.palette.layer, u, v: (corner - u) / 64, w: 0, h: 0, d: 0 };
}

const LIT = FIGURE_BOX_FLAG.emissive;

function cases(): ProbeCase[] {
  const head = FIGURE_LAYOUT.head;
  const torso = FIGURE_LAYOUT.torso;
  const out: ProbeCase[] = [];
  for (let e = 0; e < 8; e++) {
    out.push({
      name: `rosto-${e}`,
      size: [8, 8, 8],
      uv: head,
      flags: FIGURE_BOX_FLAG.face + LIT,
      face: 'front',
      expression: e,
      expect: 'texel',
    });
  }
  for (const face of ['top', 'bottom', 'left', 'right', 'back'] as const) {
    out.push({
      name: `cabeca-${face}`,
      size: [8, 8, 8],
      uv: head,
      flags: FIGURE_BOX_FLAG.face + LIT,
      face,
      expect: 'texel',
    });
  }
  out.push({ name: 'tronco-frente', size: [8, 12, 4], uv: torso, flags: LIT, face: 'front', expect: 'texel' });
  out.push({ name: 'tronco-lado', size: [8, 12, 4], uv: torso, flags: LIT, face: 'left', expect: 'texel' });
  out.push({
    name: 'paleta',
    size: [4, 5.2, 4],
    uv: swatch(FIGURE_SWATCH.sleeve),
    flags: LIT,
    face: 'front',
    expect: 'texel',
  });
  out.push({
    name: 'coluna',
    size: [3.75, 4.9, 3.75],
    uv: FIGURE_LAYOUT.shin,
    flags: LIT,
    face: 'front',
    expect: 'texel',
  });
  out.push({
    name: 'minicruz-frente',
    size: [4.05, 2.7, 5.25],
    uv: FIGURE_LAYOUT.boot,
    flags: LIT,
    face: 'front',
    expect: 'texel',
  });
  out.push({
    name: 'minicruz-lado',
    size: [4.05, 2.7, 5.25],
    uv: FIGURE_LAYOUT.boot,
    flags: LIT,
    face: 'right',
    expect: 'texel',
  });
  out.push({
    name: 'giro',
    size: [8, 12, 4],
    rot: [0.5, -0.7],
    uv: torso,
    flags: LIT,
    face: 'front',
    expect: 'texel',
  });
  out.push({
    name: 'centro',
    size: [8, 8, 8],
    center: [1.5, -2, 0.75],
    uv: head,
    flags: FIGURE_BOX_FLAG.face + LIT,
    face: 'front',
    expression: 5,
    expect: 'texel',
  });
  out.push({ name: 'luz', size: [8, 12, 4], uv: torso, flags: 0, face: 'front', sky: 0.5, expect: 'lit' });
  out.push({ name: 'clarao', size: [8, 12, 4], uv: torso, flags: LIT, face: 'front', flash: 1, expect: 'flash' });
  out.push({ name: 'slot', size: [8, 8, 8], uv: head, flags: LIT, face: 'front', slot: HIDE_SLOT, expect: 'hidden' });
  out.push({
    name: 'externa',
    size: [8, 8, 8],
    uv: head,
    flags: FIGURE_BOX_FLAG.outer + LIT,
    face: 'front',
    expect: 'hidden',
  });
  return out;
}

// --- álgebra pequena (só no loading da sonda) ---

type M3 = [number, number, number, number, number, number, number, number, number]; // coluna-maior

function rotX(a: number): M3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [1, 0, 0, 0, c, s, 0, -s, c];
}
function rotY(a: number): M3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, -s, 0, 1, 0, s, 0, c];
}
function rotZ(a: number): M3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}
function mul(a: M3, b: M3): M3 {
  const out = new Array<number>(9).fill(0) as M3;
  for (let c = 0; c < 3; c++)
    for (let r = 0; r < 3; r++)
      out[c * 3 + r] = a[r]! * b[c * 3]! + a[3 + r]! * b[c * 3 + 1]! + a[6 + r]! * b[c * 3 + 2]!;
  return out;
}
function transpose(a: M3): M3 {
  return [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
}

/** Giro que leva a normal da face (frame do FutBobo) para +Z (a câmera). */
function faceToCamera(face: Face): M3 {
  switch (face) {
    case 'front':
      return rotY(0);
    case 'back':
      return rotY(Math.PI);
    case 'top':
      return rotX(Math.PI / 2);
    case 'bottom':
      return rotX(-Math.PI / 2);
    case 'left':
      return rotY(-Math.PI / 2);
    case 'right':
      return rotY(Math.PI / 2);
  }
}

function faceDims(face: Face, s: readonly [number, number, number]): number {
  if (face === 'front' || face === 'back') return Math.max(s[0], s[1]);
  if (face === 'top' || face === 'bottom') return Math.max(s[0], s[2]);
  return Math.max(s[2], s[1]);
}

/** Matriz 4×4 coluna-maior = T(t)·L (L 3×3) em out[o ..], 4ª linha 0 0 0 1. */
function affine(out: Float32Array, o: number, l: M3, tx: number, ty: number, tz: number): void {
  out.set([l[0], l[1], l[2], 0, l[3], l[4], l[5], 0, l[6], l[7], l[8], 0, tx, ty, tz, 1], o);
}

function transform(m: Float32Array, o: number, x: number, y: number, z: number): [number, number, number] {
  return [
    m[o]! * x + m[o + 4]! * y + m[o + 8]! * z + m[o + 12]!,
    m[o + 1]! * x + m[o + 5]! * y + m[o + 9]! * z + m[o + 13]!,
    m[o + 2]! * x + m[o + 6]! * y + m[o + 10]! * z + m[o + 14]!,
  ];
}

/** Face (4 vértices seguidos) cuja normal vai para +Z depois da matriz: o índice do 1º vértice, ou −1. */
function facingCorner(normalOf: (k: number) => [number, number, number], vertices: number): number {
  for (let k = 0; k < vertices; k += 4) if (normalOf(k)[2] > 0.5) return k;
  return -1;
}

/**
 * Amostras dentro de um paralelogramo de tela (cantos k, k+1, k+3) com a UV (texels) interpolada: só pontos com a UV
 * longe da borda do texel (≥ 0,15), para o arredondamento da GPU não trocar de texel.
 */
function sampleFace(
  p: readonly [number, number][],
  t: readonly [number, number][],
  want: number,
): { x: number; y: number; u: number; v: number }[] {
  const out: { x: number; y: number; u: number; v: number }[] = [];
  const ex = [p[1]![0] - p[0]![0], p[1]![1] - p[0]![1]];
  const ey = [p[3]![0] - p[0]![0], p[3]![1] - p[0]![1]];
  const det = ex[0]! * ey[1]! - ex[1]! * ey[0]!;
  const minX = Math.min(...p.map((q) => q[0]));
  const maxX = Math.max(...p.map((q) => q[0]));
  const minY = Math.min(...p.map((q) => q[1]));
  const maxY = Math.max(...p.map((q) => q[1]));
  const good = (f: number, constant: boolean): boolean => {
    const r = f - Math.floor(f);
    return constant || (r > 0.15 && r < 0.85);
  };
  const constU = Math.abs(t[1]![0] - t[0]![0]) + Math.abs(t[3]![0] - t[0]![0]) < 1e-6;
  const constV = Math.abs(t[1]![1] - t[0]![1]) + Math.abs(t[3]![1] - t[0]![1]) < 1e-6;
  const fr = [0.22, 0.38, 0.62, 0.78, 0.5, 0.3, 0.7];
  for (const fy of fr) {
    for (const fx of fr) {
      if (out.length >= want) return out;
      const x = Math.floor(minX + fx * (maxX - minX)) + 0.5;
      const y = Math.floor(minY + fy * (maxY - minY)) + 0.5;
      const dx = x - p[0]![0];
      const dy = y - p[0]![1];
      const a = (dx * ey[1]! - dy * ey[0]!) / det;
      const b = (ex[0]! * dy - ex[1]! * dx) / det;
      if (a < 0.05 || a > 0.95 || b < 0.05 || b > 0.95) continue;
      const u = t[0]![0] + a * (t[1]![0] - t[0]![0]) + b * (t[3]![0] - t[0]![0]);
      const v = t[0]![1] + a * (t[1]![1] - t[0]![1]) + b * (t[3]![1] - t[0]![1]);
      if (!good(u, constU) || !good(v, constV)) continue;
      if (out.some((s) => s.x === x && s.y === y)) continue;
      out.push({ x, y, u, v });
    }
  }
  return out;
}

function expected(layer: number, u: number, v: number, kind: Expect): [number, number, number, number] {
  const c = figureProbeTexel(layer, Math.floor(u), Math.floor(v));
  if (kind === 'lit') return [Math.round(c[0] * 0.5), Math.round(c[1] * 0.5), Math.round(c[2] * 0.5), 255];
  if (kind === 'flash') {
    const f = (x: number): number => Math.round(((x / 255) * 0.25 + 0.75) * 255);
    return [f(c[0]), f(c[1]), f(c[2]), 255];
  }
  return c;
}

/** Monta a cena da sonda: tudo determinístico, sem relógio nem sorteio. */
export function createFigureProbeScene(): FigureProbeScene {
  const list = cases();
  const cube = buildFigureCubeGeometry();
  const n = list.length;
  const matrices = new Float32Array(n * MAT4);
  const data = new Float32Array(n * INSTANCE_FLOATS);
  const box = new Float32Array(FIGURE_BOX_STRIDE);
  const samples: FigureProbeSample[] = [];
  const local = new Float32Array(6);
  const tex = new Float32Array(2);
  const F = FIGURE_BOX_FIELD;
  list.forEach((c, i) => {
    const center = c.center ?? [0, 0, 0];
    box.fill(0);
    box[F.cx] = center[0];
    box[F.cy] = center[1];
    box[F.cz] = center[2];
    box[F.sx] = c.size[0];
    box[F.sy] = c.size[1];
    box[F.sz] = c.size[2];
    box[F.rotX] = c.rot?.[0] ?? 0;
    box[F.rotZ] = c.rot?.[1] ?? 0;
    box[F.layer] = c.uv.layer;
    box[F.u] = c.uv.u;
    box[F.v] = c.uv.v;
    box[F.w] = c.uv.w;
    box[F.h] = c.uv.h;
    box[F.d] = c.uv.d;
    box[F.flags] = c.flags;
    writeFigureBoxData(data, i * INSTANCE_FLOATS, box, 0, 0, c.slot ?? 255);
    // Osso = T(célula)·S(k)·face→câmera·(Rx·Rz)ᵀ·T(−centro): a caixa aparece sem giro, com a face virada para a tela.
    const k = FACE_PX / faceDims(c.face, c.size);
    const giro = mul(rotX(c.rot?.[0] ?? 0), rotZ(c.rot?.[1] ?? 0));
    let l = mul(faceToCamera(c.face), transpose(giro));
    l = l.map((x) => x * k) as M3;
    const cx = (i % COLS) * CELL + CELL / 2;
    const cy = Math.floor(i / COLS) * CELL + CELL / 2;
    const t = transform(
      new Float32Array([...l.slice(0, 3), 0, ...l.slice(3, 6), 0, ...l.slice(6, 9), 0, 0, 0, 0, 1]),
      0,
      ...center,
    );
    affine(matrices, i * MAT4, l, cx - t[0], cy - t[1], -t[2]);
    writeFigureRow4(matrices, i * MAT4, c.sky ?? 1, 1, 0, c.expression ?? 0, c.flash ?? 0);

    if (c.expect === 'hidden') {
      samples.push({ name: c.name, x: cx + 0.5, y: cy + 0.5, rgba: [0, 0, 0, 0], tolerance: 0 });
      return;
    }
    const normalOf = (v: number): [number, number, number] => {
      figureVertexLocal(cube, v, data, i * INSTANCE_FLOATS, local, 0);
      const m = matrices;
      const o = i * MAT4;
      return [
        m[o]! * local[3]! + m[o + 4]! * local[4]! + m[o + 8]! * local[5]!,
        m[o + 1]! * local[3]! + m[o + 5]! * local[4]! + m[o + 9]! * local[5]!,
        (m[o + 2]! * local[3]! + m[o + 6]! * local[4]! + m[o + 10]! * local[5]!) / k,
      ];
    };
    const first = facingCorner(normalOf, cube.vertexCount);
    if (first < 0) throw new Error(`sonda: caixa ${c.name} sem face para a câmera`);
    const p: [number, number][] = [];
    const uv: [number, number][] = [];
    for (let v = first; v < first + 4; v++) {
      figureVertexLocal(cube, v, data, i * INSTANCE_FLOATS, local, 0);
      const w = transform(matrices, i * MAT4, local[0]!, local[1]!, local[2]!);
      p.push([w[0], w[1]]);
      figureVertexTexel(cube, v, data, i * INSTANCE_FLOATS, c.expression ?? 0, tex, 0);
      uv.push([tex[0]!, tex[1]!]);
    }
    for (const s of sampleFace(p, uv, 4)) {
      samples.push({
        name: c.name,
        x: s.x,
        y: s.y,
        rgba: expected(c.uv.layer, s.u, s.v, c.expect),
        tolerance: c.expect === 'texel' ? 0 : 2,
      });
    }
  });

  // Caminho de hoje (prop): caixa com a camada 2 no VÉRTICE, emissiva, 4ª linha 0 0 0 1, nas células que sobram, num
  // draw instanciado próprio. É o controle: se só a 1ª instância aparecer aqui também, o defeito é do instanciamento
  // do ambiente, não do VS novo.
  const b = new GeometryBuilder();
  addTexturedBox(
    b,
    {
      min: [-0.5, -0.5, -0.5],
      size: [1, 1, 1],
      inflate: 0,
      tex: [8, 8, 8],
      uv: [4, 4],
      layerSize: SIZE,
      mirror: false,
    },
    { layer: 2, flags: VERTEX_FLAG.emissive },
  );
  const prop = b.build();
  const props = COLS * (HEIGHT / CELL) - n;
  const propMatrices = new Float32Array(props * MAT4);
  const propData = new Float32Array(props * INSTANCE_FLOATS);
  for (let j = 0; j < props; j++) {
    const cell = n + j;
    const pcx = (cell % COLS) * CELL + CELL / 2;
    const pcy = Math.floor(cell / COLS) * CELL + CELL / 2;
    // O caminho de hoje usa o frame do BF (frente −Z): Ry(π) vira a frente para a câmera; o lado muda por instância.
    const k = FACE_PX - 2 * j;
    affine(propMatrices, j * MAT4, rotY(Math.PI).map((x) => x * k) as M3, pcx, pcy, 0);
    writeInstanceDefaults(propData, j * INSTANCE_FLOATS);
    propData[j * INSTANCE_FLOATS + INST.layer] = 0;
    const propNormal = (v: number): [number, number, number] => {
      const o = j * MAT4;
      const nx = prop.normals[v * 3]!;
      const ny = prop.normals[v * 3 + 1]!;
      const nz = prop.normals[v * 3 + 2]!;
      return [0, 0, (propMatrices[o + 2]! * nx + propMatrices[o + 6]! * ny + propMatrices[o + 10]! * nz) / k];
    };
    const pf = facingCorner(propNormal, prop.vertexCount);
    if (pf < 0) throw new Error('sonda: prop sem face para a câmera');
    const pp: [number, number][] = [];
    const puv: [number, number][] = [];
    for (let v = pf; v < pf + 4; v++) {
      const p = v * 3;
      const w = transform(propMatrices, j * MAT4, prop.positions[p]!, prop.positions[p + 1]!, prop.positions[p + 2]!);
      pp.push([w[0], w[1]]);
      puv.push([prop.uvs[v * 2]! * SIZE, prop.uvs[v * 2 + 1]! * SIZE]);
    }
    for (const s of sampleFace(pp, puv, 2)) {
      samples.push({ name: `hoje-${j}`, x: s.x, y: s.y, rgba: expected(2, s.u, s.v, 'texel'), tolerance: 0 });
    }
  }

  const texels = new Uint8Array(LAYERS * SIZE * SIZE * 4);
  for (let layer = 0; layer < LAYERS; layer++)
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) texels.set(figureProbeTexel(layer, x, y), ((layer * SIZE + y) * SIZE + x) * 4);

  // Ortográfica: x ∈ [0, W] → [−1, 1], y ∈ [0, H] → [−1, 1], z → −0,01·z (a câmera olha para −Z).
  const projection = new Float32Array([2 / WIDTH, 0, 0, 0, 0, 2 / HEIGHT, 0, 0, 0, 0, -0.01, 0, -1, -1, 0, 1]);
  return {
    cell: CELL,
    width: WIDTH,
    height: HEIGHT,
    draws: [
      { name: 'caixas', geometry: cube, instances: n, matrices, data },
      { name: 'hoje', geometry: prop, instances: props, matrices: propMatrices, data: propData },
    ],
    layers: LAYERS,
    layerSize: SIZE,
    texels,
    projection,
    camera: [WIDTH / 2, HEIGHT / 2, 1000],
    hideSlot: HIDE_SLOT,
    outerMaxDist: OUTER_MAX,
    uniforms: {
      uSunDir: [0, 1, 0],
      uSunColor: [1, 1, 1],
      uSkyLightColor: [1, 1, 1],
      uGroundColor: [1, 1, 1],
      uEmissiveColor: [0, 0, 0],
      uFogColor: [0, 0, 0],
      uSunStrength: [0],
      uSkyStrength: [1],
      uFogNear: [1e5],
      uFogFar: [2e5],
      uTime: [0],
      uFlash: [0],
      uWind: [0],
      uGrayscale: [0],
      uGradeStrength: [0],
    },
    samples,
  };
}

/** Resultado da comparação: amostras certas, total e a 1ª que falhou (nome, pixel, lido e esperado). */
export interface FigureProbeCheck {
  readonly ok: number;
  readonly total: number;
  readonly firstFail: string;
  /** Uma letra por célula: 1 = algum pixel desenhado, 0 = vazia (diagnóstico no runtime.log). */
  readonly cells: string;
  /** Caixas com alguma amostra errada, sem repetir, separadas por "+" (diagnóstico). */
  readonly failed: string;
}

/** Confere os pixels lidos (`readPixels` do alvo inteiro, RGBA8, origem embaixo) contra as amostras da cena. */
export function checkFigureProbe(scene: FigureProbeScene, pixels: Uint8Array): FigureProbeCheck {
  let ok = 0;
  let firstFail = '';
  const failed: string[] = [];
  for (const s of scene.samples) {
    const o = (Math.floor(s.y) * scene.width + Math.floor(s.x)) * 4;
    let good = true;
    for (let c = 0; c < 4; c++) if (Math.abs(pixels[o + c]! - s.rgba[c]!) > s.tolerance) good = false;
    if (good) ok++;
    else if (!failed.includes(s.name)) failed.push(s.name);
    if (!good && !firstFail)
      firstFail = `${s.name}@${Math.floor(s.x)},${Math.floor(s.y)}:${pixels[o]}_${pixels[o + 1]}_${pixels[o + 2]}_${pixels[o + 3]}!=${s.rgba.join('_')}`;
  }
  let cells = '';
  const cols = Math.floor(scene.width / scene.cell);
  const rows = Math.floor(scene.height / scene.cell);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let any = false;
      for (let y = r * scene.cell; y < (r + 1) * scene.cell && !any; y++)
        for (let x = c * scene.cell; x < (c + 1) * scene.cell && !any; x++)
          if (pixels[(y * scene.width + x) * 4 + 3]! > 0) any = true;
      cells += any ? '1' : '0';
    }
  }
  return { ok, total: scene.samples.length, firstFail, cells, failed: failed.join('+') };
}
