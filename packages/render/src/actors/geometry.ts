// Montagem de geometria do programa 4 em arrays (sem three, testável em Node): caixas texturizadas com a UV em CRUZ
// (`boxCrossRects` do format, igual para skins e `.bfmodel`), quads e malhas. Roda só no loading (`setModels`,
// `setMap`, criação dos passes); o resultado vira `BufferGeometry` em `three-geometry.ts`.
import { boxCrossRects, SKIN_FACE_AXES } from '@boboforces/format';
import { MAT4 } from './math.ts';
import { VERT_COMPONENTS } from './layout.ts';

/** Arrays prontos de uma geometria do programa 4 (posição em metros, normal unitária, UV 0..1 na camada). */
export interface GeometryArrays {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  /** `VERT_COMPONENTS` por vértice: camada (ou -1), flags (`VERTEX_FLAG`), balanço, livre (−1). */
  readonly verts: Float32Array;
  readonly indices: Uint16Array;
  readonly vertexCount: number;
  readonly indexCount: number;
}

/** Normais das 6 faces na ordem de `FACE` (+X, -X, +Y, -Y, +Z, -Z). */
const FACE_NORMALS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** Atributos por vértice que acompanham uma peça: camada e flags (o balanço é função da altura, opcional). */
export interface VertexTag {
  readonly layer: number;
  readonly flags: number;
}

/** Caixa texturizada com UV em cruz. Medidas em METROS; a cruz de UV em TEXELS da camada. */
export interface TexturedBox {
  /** Canto mínimo e tamanho da caixa (m), antes do `inflate`. */
  readonly min: readonly [number, number, number];
  readonly size: readonly [number, number, number];
  /** Metros a mais por lado (camada externa: meio pixel), sem mudar a UV. */
  readonly inflate: number;
  /** Medidas da cruz (texels: largura, altura, profundidade) e o canto dela na camada. */
  readonly tex: readonly [number, number, number];
  readonly uv: readonly [number, number];
  /** Lado da camada em texels (64). */
  readonly layerSize: number;
  /** Espelha a UV em X (troca as faces ±X e inverte u em cada face). */
  readonly mirror: boolean;
}

/** Acumula vértices (loading; usa arrays normais e converte no fim). */
export class GeometryBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly uvs: number[] = [];
  readonly verts: number[] = [];
  readonly indices: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  vertex(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    u: number,
    v: number,
    tag: VertexTag,
    sway = 0,
  ): number {
    const index = this.vertexCount;
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    this.uvs.push(u, v);
    this.verts.push(tag.layer, tag.flags, sway, -1);
    return index;
  }

  /** Quad c0..c3 virado para fora: a normal (nx, ny, nz) aponta para quem deve ver a frente. */
  quad(a: number, b: number, c: number, d: number, nx: number, ny: number, nz: number): void {
    const p = this.positions;
    const ax = p[b * 3]! - p[a * 3]!;
    const ay = p[b * 3 + 1]! - p[a * 3 + 1]!;
    const az = p[b * 3 + 2]! - p[a * 3 + 2]!;
    const bx = p[c * 3]! - p[a * 3]!;
    const by = p[c * 3 + 1]! - p[a * 3 + 1]!;
    const bz = p[c * 3 + 2]! - p[a * 3 + 2]!;
    // Sentido anti-horário visto de fora: (b − a) × (c − a) na direção da normal.
    const cross = (ay * bz - az * by) * nx + (az * bx - ax * bz) * ny + (ax * by - ay * bx) * nz;
    if (cross >= 0) this.indices.push(a, b, c, a, c, d);
    else this.indices.push(a, c, b, a, d, c);
  }

  /** Acrescenta outra geometria transformada por uma matriz afim (column-major) e com outra marca. */
  append(src: GeometryArrays, m: Float32Array | null, retag: ((i: number, out: number[]) => void) | null): void {
    const base = this.vertexCount;
    for (let i = 0; i < src.vertexCount; i++) {
      const x = src.positions[i * 3]!;
      const y = src.positions[i * 3 + 1]!;
      const z = src.positions[i * 3 + 2]!;
      const nx = src.normals[i * 3]!;
      const ny = src.normals[i * 3 + 1]!;
      const nz = src.normals[i * 3 + 2]!;
      if (m) {
        this.positions.push(
          m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
          m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
          m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
        );
        const tx = m[0]! * nx + m[4]! * ny + m[8]! * nz;
        const ty = m[1]! * nx + m[5]! * ny + m[9]! * nz;
        const tz = m[2]! * nx + m[6]! * ny + m[10]! * nz;
        const len = Math.hypot(tx, ty, tz) || 1;
        this.normals.push(tx / len, ty / len, tz / len);
      } else {
        this.positions.push(x, y, z);
        this.normals.push(nx, ny, nz);
      }
      this.uvs.push(src.uvs[i * 2]!, src.uvs[i * 2 + 1]!);
      const tag: number[] = [
        src.verts[i * VERT_COMPONENTS]!,
        src.verts[i * VERT_COMPONENTS + 1]!,
        src.verts[i * VERT_COMPONENTS + 2]!,
        src.verts[i * VERT_COMPONENTS + 3]!,
      ];
      retag?.(i, tag);
      this.verts.push(...tag);
    }
    for (let k = 0; k < src.indexCount; k++) this.indices.push(base + src.indices[k]!);
  }

  build(): GeometryArrays {
    if (this.vertexCount > 65535) throw new Error(`geometria do programa 4 com ${this.vertexCount} vértices (u16)`);
    return {
      positions: Float32Array.from(this.positions),
      normals: Float32Array.from(this.normals),
      uvs: Float32Array.from(this.uvs),
      verts: Float32Array.from(this.verts),
      indices: Uint16Array.from(this.indices),
      vertexCount: this.vertexCount,
      indexCount: this.indices.length,
    };
  }
}

function axisIndex(v: readonly [number, number, number]): number {
  return v[0] !== 0 ? 0 : v[1] !== 0 ? 1 : 2;
}

/**
 * Acrescenta uma caixa de 6 faces com a UV da cruz (`boxCrossRects`): cada face lê o seu retângulo, com os eixos de
 * `SKIN_FACE_AXES` (u para a direita da imagem, v para baixo). `swayOf(y)` dá o balanço por altura (0 = parada).
 */
export function addTexturedBox(
  b: GeometryBuilder,
  box: TexturedBox,
  tag: VertexTag,
  swayOf: ((y: number) => number) | null = null,
): void {
  const [tw, th, td] = box.tex;
  const rects = boxCrossRects(box.uv[0], box.uv[1], tw, th, td);
  const ext = [box.size[0] + 2 * box.inflate, box.size[1] + 2 * box.inflate, box.size[2] + 2 * box.inflate] as const;
  const cx = box.min[0] + box.size[0] / 2;
  const cy = box.min[1] + box.size[1] / 2;
  const cz = box.min[2] + box.size[2] / 2;
  const inv = 1 / box.layerSize;
  for (let f = 0; f < 6; f++) {
    const n = FACE_NORMALS[f]!;
    const axes = SKIN_FACE_AXES[f]!;
    // Espelhado: a face +X lê o retângulo da -X e vice-versa, com u invertido.
    const rect = rects[box.mirror && f < 2 ? 1 - f : f]!;
    const ui = axisIndex(axes.u);
    const vi = axisIndex(axes.v);
    const us = axes.u[ui]!;
    const vs = axes.v[vi]!;
    const ni = axisIndex(n);
    const corner: number[] = [];
    for (let k = 0; k < 4; k++) {
      const a = k === 1 || k === 2 ? 1 : 0;
      const bb = k >= 2 ? 1 : 0;
      const p = [cx, cy, cz];
      p[ni] = p[ni]! + n[ni]! * ext[ni]! * 0.5;
      p[ui] = p[ui]! + us * (a - 0.5) * ext[ui]!;
      p[vi] = p[vi]! + vs * (bb - 0.5) * ext[vi]!;
      const au = box.mirror ? 1 - a : a;
      const u = (rect.u + au * rect.w) * inv;
      const v = (rect.v + bb * rect.h) * inv;
      corner.push(b.vertex(p[0]!, p[1]!, p[2]!, n[0], n[1], n[2], u, v, tag, swayOf ? swayOf(p[1]!) : 0));
    }
    b.quad(corner[0]!, corner[1]!, corner[2]!, corner[3]!, n[0], n[1], n[2]);
  }
}

/** Escreve uma matriz afim em `m` (column-major) a partir de T · R (R como 3 colunas). Só para o loading. */
export function affine(
  t: readonly [number, number, number],
  c0: readonly [number, number, number],
  c1: readonly [number, number, number],
  c2: readonly [number, number, number],
): Float32Array {
  const m = new Float32Array(MAT4);
  m.set([c0[0], c0[1], c0[2], 0, c1[0], c1[1], c1[2], 0, c2[0], c2[1], c2[2], 0, t[0], t[1], t[2], 1]);
  return m;
}

/** Geometria vazia (modelo ausente: nada a desenhar, sem quebrar o índice dos modelos). */
export function emptyGeometry(): GeometryArrays {
  return new GeometryBuilder().build();
}

/** Caixa de raio da geometria: centro e raio da esfera envolvente (culling dos grupos de props). */
export function boundingSphere(g: GeometryArrays): { x: number; y: number; z: number; radius: number } {
  if (g.vertexCount === 0) return { x: 0, y: 0, z: 0, radius: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < g.vertexCount; i++) {
    const x = g.positions[i * 3]!;
    const y = g.positions[i * 3 + 1]!;
    const z = g.positions[i * 3 + 2]!;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  const x = (minX + maxX) / 2;
  const y = (minY + maxY) / 2;
  const z = (minZ + maxZ) / 2;
  let r2 = 0;
  for (let i = 0; i < g.vertexCount; i++) {
    const dx = g.positions[i * 3]! - x;
    const dy = g.positions[i * 3 + 1]! - y;
    const dz = g.positions[i * 3 + 2]! - z;
    r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
  }
  return { x, y, z, radius: Math.sqrt(r2) };
}
