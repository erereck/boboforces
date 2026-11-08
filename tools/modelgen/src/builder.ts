// DSL dos modelos (tecnico.md §15.1: "listas de caixas e primitivas low-poly paramétricas em TS"). Monta um
// `ModelDocument` (`model@1`) e as camadas 64×64 de textura dele, sempre a 32 px/m (1 texel de UV = 1 texel de
// geometria; arte-ux.md §1.2):
//   - `box`: caixa com UV em CRUZ (`boxCrossRects`), pintada face a face; para peças pequenas (armas, detalhes). A cruz
//     precisa caber na camada: 2·(L+P) ≤ 64 e P+A ≤ 64.
//   - `tiledBox`, `prism`, `frustum`, `quad`, `tri`: MALHA com UV num LADRILHO (`tile`) de material sem costura; face
//     maior que o ladrilho é dividida em pedaços que repetem o ladrilho (é assim que um jipe de 3 m cabe numa camada).
// Posições de malha são inteiros em texels (i16 do formato): vértices de cilindro são arredondados ao texel (3 cm).
import {
  boxCrossRects,
  MODEL_FORMAT,
  SKIN_FACE_AXES,
  type LayerKind,
  type ModelBox,
  type ModelCollider,
  type ModelDocument,
  type ModelKind,
  type ModelLight,
  type ModelMesh,
  type ModelSocket,
  type RgbaImage,
  type TexelVec3,
} from '@boboforces/format';
import { createRng, type Rng } from '@boboforces/shared';
import { shiftTone } from '../../skingen/src/palette.ts';

export const LAYER = 64;
export type FaceName = 'right' | 'left' | 'top' | 'bottom' | 'back' | 'front';
/** Ordem de `FACE` (+X, −X, +Y, −Y, +Z, −Z): a frente do modelo é −Z. */
export const FACES: readonly FaceName[] = ['right', 'left', 'top', 'bottom', 'back', 'front'];
const FACE_NORMALS: readonly TexelVec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

// ---------------------------------------------------------------------------------------------------------------
// Camadas e pintura

/** Pincel sobre um retângulo da camada (coordenadas locais, com volta dentro do retângulo). */
export interface Painter {
  readonly w: number;
  readonly h: number;
  readonly rng: Rng;
  px(x: number, y: number, rgb: number): void;
  get(x: number, y: number): number;
  rect(x: number, y: number, w: number, h: number, rgb: number): void;
  fill(rgb: number): void;
  /** Manchas de 2–3 px (nada de xadrez; arte-ux.md §1.3). */
  blotches(count: number, rgb: number, min?: number, max?: number): void;
  /** Bevel de 1 px (+1 tom em cima/esquerda, −1 embaixo/direita) de material modular. */
  bevel(x: number, y: number, w: number, h: number): void;
}

export class LayerCanvas {
  readonly image: RgbaImage & { readonly data: Uint8Array };
  /** Retângulos alocados (para a borda de 1 px que segura o mip). */
  readonly regions: { u: number; v: number; w: number; h: number }[] = [];

  readonly name: string;
  readonly kind: LayerKind;

  constructor(name: string, kind: LayerKind, background: number) {
    this.name = name;
    this.kind = kind;
    this.image = { width: LAYER, height: LAYER, data: new Uint8Array(LAYER * LAYER * 4) };
    for (let i = 0; i < LAYER * LAYER; i++) this.setRaw(i, background);
  }

  private setRaw(i: number, rgb: number): void {
    this.image.data[i * 4] = (rgb >> 16) & 0xff;
    this.image.data[i * 4 + 1] = (rgb >> 8) & 0xff;
    this.image.data[i * 4 + 2] = rgb & 0xff;
    this.image.data[i * 4 + 3] = 255;
  }

  /** Livre/ocupado por pixel (primeiro encaixe de cima para baixo, da esquerda para a direita). */
  private readonly used = new Uint8Array(LAYER * LAYER);

  private fits(u: number, v: number, w: number, h: number): boolean {
    // 1 px de folga em volta de cada região (a borda dilatada segura o mip 1).
    const x0 = Math.max(0, u - 1);
    const y0 = Math.max(0, v - 1);
    const x1 = Math.min(LAYER, u + w + 1);
    const y1 = Math.min(LAYER, v + h + 1);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (this.used[y * LAYER + x] === 1) return false;
    return true;
  }

  /** Reserva `w × h` px no primeiro lugar livre (com 1 px de folga em volta). Lança se não couber. */
  alloc(w: number, h: number): readonly [u: number, v: number] {
    if (w > LAYER || h > LAYER || w < 1 || h < 1) throw new Error(`camada ${this.name}: ${w}×${h} não cabe em 64×64`);
    for (let v = 0; v + h <= LAYER; v++) {
      for (let u = 0; u + w <= LAYER; u++) {
        if (this.used[v * LAYER + u] === 1 || !this.fits(u, v, w, h)) continue;
        for (let y = v; y < v + h; y++) this.used.fill(1, y * LAYER + u, y * LAYER + u + w);
        this.regions.push({ u, v, w, h });
        return [u, v];
      }
    }
    throw new Error(`camada ${this.name}: sem espaço para ${w}×${h}`);
  }

  painter(u: number, v: number, w: number, h: number, rng: Rng): Painter {
    const mod = (a: number, n: number): number => ((a % n) + n) % n;
    const at = (x: number, y: number): number => (v + mod(y, h)) * LAYER + u + mod(x, w);
    const px = (x: number, y: number, rgb: number): void => this.setRaw(at(x, y), rgb);
    const rect = (x: number, y: number, rw: number, rh: number, rgb: number): void => {
      for (let yy = 0; yy < rh; yy++) for (let xx = 0; xx < rw; xx++) px(x + xx, y + yy, rgb);
    };
    const get = (x: number, y: number): number => {
      const i = at(x, y) * 4;
      return (this.image.data[i]! << 16) | (this.image.data[i + 1]! << 8) | this.image.data[i + 2]!;
    };
    return {
      w,
      h,
      rng,
      px,
      get,
      rect,
      fill: (rgb) => rect(0, 0, w, h, rgb),
      blotches(count, rgb, min = 2, max = 3) {
        for (let n = 0; n < count; n++) {
          const bw = rng.int(min, max + 1);
          const bh = rng.int(min, max + 1);
          const x = rng.int(0, w);
          const y = rng.int(0, h);
          const skip = bw === 3 && bh === 3 ? rng.int(0, 4) : -1;
          for (let yy = 0; yy < bh; yy++) {
            for (let xx = 0; xx < bw; xx++) {
              const corner = (yy === 0 ? 0 : yy === bh - 1 ? 2 : -10) + (xx === 0 ? 0 : xx === bw - 1 ? 1 : -10);
              if (corner !== skip) px(x + xx, y + yy, rgb);
            }
          }
        }
      },
      bevel(x, y, bw, bh) {
        for (let i = 0; i < bw; i++) {
          px(x + i, y, shiftTone(get(x + i, y), 1));
          px(x + i, y + bh - 1, shiftTone(get(x + i, y + bh - 1), -1));
        }
        for (let i = 1; i < bh - 1; i++) {
          px(x, y + i, shiftTone(get(x, y + i), 1));
          px(x + bw - 1, y + i, shiftTone(get(x + bw - 1, y + i), -1));
        }
      },
    };
  }

  /** Copia a borda de cada região para a folga em volta (o mip 1 não puxa a cor da vizinha). */
  dilate(): void {
    const d = this.image.data;
    const copy = (sx: number, sy: number, dx: number, dy: number): void => {
      if (dx < 0 || dy < 0 || dx >= LAYER || dy >= LAYER) return;
      d.copyWithin((dy * LAYER + dx) * 4, (sy * LAYER + sx) * 4, (sy * LAYER + sx) * 4 + 4);
    };
    for (const r of this.regions) {
      for (let x = r.u; x < r.u + r.w; x++) {
        copy(x, r.v, x, r.v - 1);
        copy(x, r.v + r.h - 1, x, r.v + r.h);
      }
      for (let y = r.v - 1; y <= r.v + r.h; y++) {
        const sy = Math.max(r.v, Math.min(r.v + r.h - 1, y));
        copy(r.u, sy, r.u - 1, y);
        copy(r.u + r.w - 1, sy, r.u + r.w, y);
      }
    }
  }
}

/** Ladrilho de material: retângulo da camada que as malhas repetem. */
export interface Tile {
  readonly layer: LayerCanvas;
  readonly u: number;
  readonly v: number;
  readonly w: number;
  readonly h: number;
}

/** Pintura de uma caixa em cruz: recebe o pincel de cada face (eixos da textura como no `SKIN_FACE_AXES`). */
export type BoxPaint = (face: FaceName, p: Painter) => void;

/** Pintura padrão: laterais na cor, topo +1 tom, base −1 tom (luz pintada de cima). */
export function shaded(base: number, detail?: BoxPaint): BoxPaint {
  return (face, p) => {
    p.fill(face === 'top' ? shiftTone(base, 1) : face === 'bottom' ? shiftTone(base, -1) : base);
    detail?.(face, p);
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Malhas

class MeshAcc {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly uvs: number[] = [];
  readonly indices: number[] = [];

  readonly layer: string;

  constructor(layer: string) {
    this.layer = layer;
  }

  vertex(p: TexelVec3, n: TexelVec3, uv: readonly [number, number]): number {
    const i = this.positions.length / 3;
    for (const c of p) {
      const r = Math.round(c);
      if (r < -32768 || r > 32767) throw new Error('posição de malha fora do i16');
      this.positions.push(r);
    }
    for (const c of n) this.normals.push(Math.max(-127, Math.min(127, Math.round(c * 127))));
    for (const c of uv) {
      const r = Math.round(c);
      if (r < 0 || r > LAYER) throw new Error(`UV de malha ${r} fora da camada (${this.layer})`);
      this.uvs.push(r);
    }
    return i;
  }

  build(): ModelMesh {
    return {
      positions: Int16Array.from(this.positions),
      normals: Int8Array.from(this.normals),
      uvs: Uint8Array.from(this.uvs),
      indices: Uint16Array.from(this.indices),
      layer: this.layer,
    };
  }
}

type V3 = [number, number, number];
const sub = (a: TexelVec3, b: TexelVec3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: TexelVec3, b: TexelVec3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: TexelVec3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: TexelVec3): number => Math.hypot(a[0], a[1], a[2]);
const cross = (a: TexelVec3, b: TexelVec3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function normalize(a: TexelVec3): V3 {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

export type Axis = 'x' | 'y' | 'z';

export interface PartBuilder {
  readonly index: number;
  /** Caixa com UV em cruz, alocada e pintada na camada. Devolve a caixa (para repetir a mesma UV com `boxLike`). */
  box(
    origin: TexelVec3,
    size: TexelVec3,
    layer: LayerCanvas,
    paint: BoxPaint,
    options?: { inflate?: number; mirror?: boolean },
  ): ModelBox;
  /** Outra caixa do MESMO tamanho reaproveitando a UV de `like` (parafusos, rodas, degraus). */
  boxLike(origin: TexelVec3, like: ModelBox, options?: { mirror?: boolean }): ModelBox;
  /** Caixa como malha ladrilhada (faces maiores que a camada). `faces` escolhe o ladrilho por face (`null` = sem face). */
  tiledBox(min: TexelVec3, max: TexelVec3, tiles: Tile | Partial<Record<FaceName, Tile | null>>): void;
  /** Quad plano (cantos no sentido da textura: (0,0), (1,0), (1,1), (0,1)), ladrilhado. `double` = frente e verso. */
  quad(corners: readonly [TexelVec3, TexelVec3, TexelVec3, TexelVec3], tile: Tile, double?: boolean): void;
  /** Triângulo com UV explícita (texels na camada do ladrilho). */
  tri(
    points: readonly [TexelVec3, TexelVec3, TexelVec3],
    uvs: readonly [readonly [number, number], readonly [number, number], readonly [number, number]],
    tile: Tile,
    double?: boolean,
  ): void;
  /**
   * Cilindro de `sides` lados ao longo de `axis` (do `start` ao `start + length` na coordenada do eixo), raio do
   * VÉRTICE `radius`, centrado em `center` (as outras 2 coordenadas). Laterais no ladrilho `side` (u em volta, v ao
   * longo do eixo); tampas no ladrilho `cap` (`null` = sem tampa), `caps` diz quais ([início, fim]).
   */
  prism(
    axis: Axis,
    center: readonly [number, number],
    start: number,
    length: number,
    radius: number,
    sides: number,
    side: Tile,
    cap: Tile | null,
    caps?: readonly [boolean, boolean],
    phase?: number,
  ): void;
  /** Tronco de cone vertical (r0 em y0, r1 em y1; r1 = 0 vira cone), base opcional. */
  frustum(
    center: readonly [number, number],
    y0: number,
    y1: number,
    r0: number,
    r1: number,
    sides: number,
    side: Tile,
    base: Tile | null,
  ): void;
  /** Prisma de perfil qualquer ao longo de X (perfil em (z, y), anti-horário visto de +X), com tampas. */
  extrudeX(profile: readonly (readonly [number, number])[], x0: number, x1: number, side: Tile, cap: Tile | null): void;
}

export interface BuiltModel {
  readonly doc: ModelDocument;
  readonly layers: readonly LayerCanvas[];
}

export interface ModelOptions {
  readonly flags: number;
  readonly debrisColor: number;
  readonly blocksNav: boolean;
}

/** Construtor de um modelo. Pinte os ladrilhos (`tile`) antes de usá-los; a ordem das chamadas é a ordem no arquivo. */
export class ModelBuilder {
  private readonly parts: {
    name: string;
    parent: number;
    pivot: TexelVec3;
    boxes: ModelBox[];
    meshes: Map<string, MeshAcc>;
  }[] = [];
  private readonly sockets: ModelSocket[] = [];
  private readonly colliders: ModelCollider[] = [];
  private lightSource: ModelLight | null = null;
  private readonly layerList: LayerCanvas[] = [];
  readonly rng: Rng;

  readonly id: string;
  readonly kind: ModelKind;
  readonly options: ModelOptions;

  constructor(id: string, kind: ModelKind, options: ModelOptions) {
    this.id = id;
    this.kind = kind;
    this.options = options;
    this.rng = createRng('boboforces/modelgen').fork(id);
  }

  /** Camada nova deste modelo (ou uma compartilhada, já criada fora, com `useLayer`). */
  layer(name: string, kind: LayerKind, background: number): LayerCanvas {
    const l = new LayerCanvas(name, kind, background);
    this.layerList.push(l);
    return l;
  }

  useLayer(layer: LayerCanvas): LayerCanvas {
    if (!this.layerList.includes(layer)) this.layerList.push(layer);
    return layer;
  }

  /** Reserva e pinta um ladrilho de material. */
  tile(layer: LayerCanvas, w: number, h: number, paint: (p: Painter) => void): Tile {
    const [u, v] = layer.alloc(w, h);
    paint(layer.painter(u, v, w, h, this.rng.fork(`${layer.name}:${u},${v}`)));
    return { layer, u, v, w, h };
  }

  socket(name: string, part: number, position: TexelVec3, direction: TexelVec3): void {
    this.sockets.push({ name, part, position, direction: normalize(direction) });
  }

  collider(min: TexelVec3, max: TexelVec3): void {
    this.colliders.push({ min, max });
  }

  light(position: TexelVec3, level: number): void {
    this.lightSource = { position, level };
  }

  part(name: string, parent = -1, pivot: TexelVec3 = [0, 0, 0]): PartBuilder {
    const index = this.parts.length;
    const entry = { name, parent, pivot, boxes: [] as ModelBox[], meshes: new Map<string, MeshAcc>() };
    this.parts.push(entry);
    const rng = this.rng.fork(name);
    const mesh = (tile: Tile): MeshAcc => {
      let acc = entry.meshes.get(tile.layer.name);
      if (acc === undefined) {
        acc = new MeshAcc(tile.layer.name);
        entry.meshes.set(tile.layer.name, acc);
      }
      this.useLayer(tile.layer);
      return acc;
    };

    /** Quad plano com UV explícita nos 4 cantos; normal calculada dos cantos (ou dada). */
    const rawQuad = (
      tile: Tile,
      c: readonly [TexelVec3, TexelVec3, TexelVec3, TexelVec3],
      uv: readonly [
        readonly [number, number],
        readonly [number, number],
        readonly [number, number],
        readonly [number, number],
      ],
      normal?: TexelVec3,
    ): void => {
      const acc = mesh(tile);
      // Cantos na ordem da textura (u para a direita, v para baixo, vistos de fora): a normal de fora é V × U.
      const n = normal ?? normalize(cross(sub(c[3], c[0]), sub(c[1], c[0])));
      const i0 = acc.vertex(c[0], n, uv[0]);
      const i1 = acc.vertex(c[1], n, uv[1]);
      const i2 = acc.vertex(c[2], n, uv[2]);
      const i3 = acc.vertex(c[3], n, uv[3]);
      // Anti-horário visto de fora (padrão do three): 0-2-1 e 0-3-2.
      acc.indices.push(i0, i2, i1, i0, i3, i2);
    };

    /** Quad ladrilhado: divide em pedaços de no máximo o tamanho do ladrilho, cada um com UV 1:1. */
    const tiledQuad = (tile: Tile, c: readonly [TexelVec3, TexelVec3, TexelVec3, TexelVec3], double: boolean): void => {
      const uVec = sub(c[1], c[0]);
      const vVec = sub(c[3], c[0]);
      const uLen = len(uVec);
      const vLen = len(vVec);
      const nu = Math.max(1, Math.ceil(uLen / tile.w - 1e-6));
      const nv = Math.max(1, Math.ceil(vLen / tile.h - 1e-6));
      for (let j = 0; j < nv; j++) {
        for (let i = 0; i < nu; i++) {
          const a0 = (i * tile.w) / uLen;
          const a1 = Math.min(1, ((i + 1) * tile.w) / uLen);
          const b0 = (j * tile.h) / vLen;
          const b1 = Math.min(1, ((j + 1) * tile.h) / vLen);
          const p = (a: number, b: number): V3 => add(add(c[0], mul(uVec, a)), mul(vVec, b));
          const du = Math.round((a1 - a0) * uLen);
          const dv = Math.round((b1 - b0) * vLen);
          const corners = [p(a0, b0), p(a1, b0), p(a1, b1), p(a0, b1)] as const;
          const uv = [
            [tile.u, tile.v],
            [tile.u + du, tile.v],
            [tile.u + du, tile.v + dv],
            [tile.u, tile.v + dv],
          ] as const;
          rawQuad(tile, corners, uv);
          if (double) rawQuad(tile, [corners[1], corners[0], corners[3], corners[2]], [uv[1], uv[0], uv[3], uv[2]]);
        }
      }
    };

    const builder: PartBuilder = {
      index,
      box: (origin, size, layer, paint, options = {}) => {
        const [w, h, d] = size;
        const [u, v] = layer.alloc(2 * d + 2 * w, d + h);
        const rects = boxCrossRects(u, v, w, h, d);
        FACES.forEach((face, f) => {
          const r = rects[f]!;
          if (r.w > 0 && r.h > 0)
            paint(face, layer.painter(r.u, r.v, r.w, r.h, rng.fork(`box${entry.boxes.length}:${face}`)));
        });
        this.useLayer(layer);
        const box: ModelBox = {
          origin,
          size,
          uv: [u, v],
          layer: layer.name,
          inflate: options.inflate ?? 0,
          mirror: options.mirror ?? false,
        };
        entry.boxes.push(box);
        return box;
      },
      boxLike: (origin, like, options = {}) => {
        const box: ModelBox = { ...like, origin, mirror: options.mirror ?? like.mirror };
        entry.boxes.push(box);
        return box;
      },
      tiledBox: (min, max, tiles) => {
        const pick = (face: FaceName): Tile | null =>
          'layer' in tiles ? (tiles as Tile) : ((tiles as Partial<Record<FaceName, Tile | null>>)[face] ?? null);
        const size: V3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
        const center: V3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
        FACES.forEach((face, f) => {
          const tile = pick(face);
          if (tile === null) return;
          const n = FACE_NORMALS[f]!;
          const axes = SKIN_FACE_AXES[f]!;
          const corner = (a: number, b: number): V3 => {
            const p: V3 = [...center];
            for (let k = 0; k < 3; k++) {
              p[k] =
                p[k]! + (n[k]! * size[k]!) / 2 + axes.u[k]! * (a - 0.5) * size[k]! + axes.v[k]! * (b - 0.5) * size[k]!;
            }
            return p;
          };
          tiledQuad(tile, [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)], false);
        });
      },
      quad: (corners, tile, double = false) => tiledQuad(tile, corners, double),
      tri: (points, uvs, tile, double = false) => {
        const acc = mesh(tile);
        const n = normalize(cross(sub(points[1], points[0]), sub(points[2], points[0])));
        const ids = points.map((p, i) => acc.vertex(p, n, [tile.u + uvs[i]![0], tile.v + uvs[i]![1]]));
        acc.indices.push(ids[0]!, ids[1]!, ids[2]!);
        if (double) {
          const back = points.map((p, i) => acc.vertex(p, mul(n, -1), [tile.u + uvs[i]![0], tile.v + uvs[i]![1]]));
          acc.indices.push(back[0]!, back[2]!, back[1]!);
        }
      },
      prism: (axis, center, start, length, radius, sides, side, cap, caps = [true, true], phase = 0.5) => {
        // Monta no espaço (a, b, t) com t ao longo do eixo e leva para x, y, z.
        const toXyz = (a: number, b: number, t: number): V3 =>
          axis === 'y' ? [a, t, b] : axis === 'x' ? [t, b, a] : [a, b, t];
        const ring = (t: number): V3[] => {
          const out: V3[] = [];
          for (let i = 0; i < sides; i++) {
            const ang = ((i + phase) / sides) * Math.PI * 2;
            out.push(toXyz(center[0] + Math.cos(ang) * radius, center[1] + Math.sin(ang) * radius, t));
          }
          return out;
        };
        const r0 = ring(start);
        const r1 = ring(start + length);
        const exactChord = 2 * radius * Math.sin(Math.PI / sides);
        const chord = Math.max(1, Math.round(exactChord));
        const perRow = Math.max(1, Math.floor(side.w / chord));
        // Sentido: a normal tem que apontar para fora; testa com o centro.
        const mid = toXyz(center[0], center[1], start + length / 2);
        for (let i = 0; i < sides; i++) {
          const j = (i + 1) % sides;
          let quad: [V3, V3, V3, V3] = [r1[i]!, r1[j]!, r0[j]!, r0[i]!];
          const nrm = cross(sub(quad[1], quad[0]), sub(quad[3], quad[0]));
          const outward = sub(add(quad[0], quad[2]), mul(mid, 2));
          // U × V aponta para DENTRO num quad na ordem da textura; se apontar para fora, está espelhado.
          if (nrm[0] * outward[0] + nrm[1] * outward[1] + nrm[2] * outward[2] > 0)
            quad = [r1[j]!, r1[i]!, r0[i]!, r0[j]!];
          // Largura do pedaço = a corda real (sem dividir a face em fatia fina); a UV usa a corda arredondada.
          const sub_tile: Tile = { ...side, u: side.u + (i % perRow) * chord, w: exactChord + 1e-3 };
          tiledQuad(sub_tile, quad, false);
        }
        if (cap !== null) {
          for (const [k, ring_] of [
            [0, r0],
            [1, r1],
          ] as const) {
            if (!caps[k]) continue;
            const acc = mesh(cap);
            const t = k === 0 ? start : start + length;
            const c = toXyz(center[0], center[1], t);
            const n = normalize(sub(c, mid));
            const uvOf = (p: TexelVec3): [number, number] => {
              const d = sub(p, c);
              const [a, b] = axis === 'y' ? [d[0], d[2]] : axis === 'x' ? [d[2], d[1]] : [d[0], d[1]];
              const s = Math.min(1, (Math.min(cap.w, cap.h) - 0.01) / (radius * 2));
              return [cap.u + cap.w / 2 + a * s, cap.v + cap.h / 2 - b * s];
            };
            const ci = acc.vertex(c, n, uvOf(c));
            const ids = ring_.map((p) => acc.vertex(p, n, uvOf(p)));
            for (let i = 0; i < sides; i++) {
              const a = ids[i]!;
              const b = ids[(i + 1) % sides]!;
              const tn = cross(sub(ring_[(i + 1) % sides]!, c), sub(ring_[i]!, c));
              if (tn[0] * n[0] + tn[1] * n[1] + tn[2] * n[2] > 0) acc.indices.push(ci, b, a);
              else acc.indices.push(ci, a, b);
            }
          }
        }
      },
      frustum: (center, y0, y1, r0, r1, sides, side, base) => {
        const ring = (y: number, r: number): V3[] => {
          const out: V3[] = [];
          for (let i = 0; i < sides; i++) {
            const ang = ((i + 0.5) / sides) * Math.PI * 2;
            out.push([center[0] + Math.cos(ang) * r, y, center[1] + Math.sin(ang) * r]);
          }
          return out;
        };
        const lo = ring(y0, r0);
        const hi = ring(y1, r1);
        const chord0 = Math.max(1, Math.round(2 * r0 * Math.sin(Math.PI / sides)));
        const chord1 = Math.round(2 * r1 * Math.sin(Math.PI / sides));
        const slant = Math.min(side.h, Math.round(Math.hypot(y1 - y0, r0 - r1)));
        const cw = Math.min(chord0, side.w);
        const inset = Math.round((cw - Math.min(chord1, cw)) / 2);
        const acc = mesh(side);
        for (let i = 0; i < sides; i++) {
          const j = (i + 1) % sides;
          const a = lo[i]!;
          const b = lo[j]!;
          const c = hi[j]!;
          const d = hi[i]!;
          const n = normalize(cross(sub(b, a), sub(d, a)));
          const out = sub(a, [center[0], (y0 + y1) / 2, center[1]]);
          const flip = n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0;
          const nn: V3 = flip ? mul(n, -1) : n;
          const u0 = side.u;
          const ids = [
            acc.vertex(d, nn, [u0 + inset, side.v]),
            acc.vertex(c, nn, [u0 + cw - inset, side.v]),
            acc.vertex(b, nn, [u0 + cw, side.v + slant]),
            acc.vertex(a, nn, [u0, side.v + slant]),
          ];
          if (flip) acc.indices.push(ids[0]!, ids[1]!, ids[2]!, ids[0]!, ids[2]!, ids[3]!);
          else acc.indices.push(ids[0]!, ids[2]!, ids[1]!, ids[0]!, ids[3]!, ids[2]!);
        }
        if (base !== null) {
          const bacc = mesh(base);
          const n: V3 = [0, -1, 0];
          const uvOf = (p: TexelVec3): [number, number] => {
            const s = Math.min(1, (Math.min(base.w, base.h) - 0.01) / (r0 * 2));
            return [base.u + base.w / 2 + (p[0] - center[0]) * s, base.v + base.h / 2 + (p[2] - center[1]) * s];
          };
          const c: V3 = [center[0], y0, center[1]];
          const ci = bacc.vertex(c, n, uvOf(c));
          const ids = lo.map((p) => bacc.vertex(p, n, uvOf(p)));
          for (let i = 0; i < sides; i++) bacc.indices.push(ci, ids[i]!, ids[(i + 1) % sides]!);
        }
      },
      extrudeX: (profile, x0, x1, side, cap) => {
        const n = profile.length;
        // Laterais: um quad por aresta do perfil (u ao longo de X, v ao longo da aresta).
        let cz = 0;
        let cy = 0;
        for (const [z, y] of profile) {
          cz += z / n;
          cy += y / n;
        }
        for (let i = 0; i < n; i++) {
          const [za, ya] = profile[i]!;
          const [zb, yb] = profile[(i + 1) % n]!;
          let q: [V3, V3, V3, V3] = [
            [x0, ya, za],
            [x1, ya, za],
            [x1, yb, zb],
            [x0, yb, zb],
          ];
          const nrm = cross(sub(q[1], q[0]), sub(q[3], q[0]));
          const out: V3 = [0, (ya + yb) / 2 - cy, (za + zb) / 2 - cz];
          if (nrm[1] * out[1] + nrm[2] * out[2] > 0) q = [q[1], q[0], q[3], q[2]];
          tiledQuad(side, q, false);
        }
        if (cap !== null) {
          for (const x of [x0, x1]) {
            const acc = mesh(cap);
            const nrm: V3 = [x === x0 ? -1 : 1, 0, 0];
            let minZ = Infinity;
            let minY = Infinity;
            for (const [z, y] of profile) {
              minZ = Math.min(minZ, z);
              minY = Math.min(minY, y);
            }
            const ids = profile.map(([z, y]) =>
              acc.vertex([x, y, z], nrm, [
                cap.u + Math.min(cap.w, z - minZ),
                cap.v + Math.min(cap.h, cap.h - (y - minY)),
              ]),
            );
            for (let i = 1; i < n - 1; i++) {
              const tn = cross(
                sub([x, profile[i]![1], profile[i]![0]], [x, profile[0]![1], profile[0]![0]]),
                sub([x, profile[i + 1]![1], profile[i + 1]![0]], [x, profile[0]![1], profile[0]![0]]),
              );
              // (Pi − P0) × (Pi+1 − P0) na direção da normal = 0, i, i+1 já é anti-horário visto de fora.
              if (tn[0] * nrm[0] > 0) acc.indices.push(ids[0]!, ids[i]!, ids[i + 1]!);
              else acc.indices.push(ids[0]!, ids[i + 1]!, ids[i]!);
            }
          }
        }
      },
    };
    return builder;
  }

  build(): BuiltModel {
    const doc: ModelDocument = {
      format: MODEL_FORMAT,
      id: this.id,
      kind: this.kind,
      flags: this.options.flags,
      parts: this.parts.map((p) => ({
        name: p.name,
        parent: p.parent,
        pivot: p.pivot,
        boxes: p.boxes,
        meshes: [...p.meshes.values()].map((m) => m.build()),
      })),
      sockets: this.sockets,
      colliders: this.colliders,
      light: this.lightSource,
      debrisColor: this.options.debrisColor,
      blocksNav: this.options.blocksNav,
    };
    return { doc, layers: this.layerList };
  }
}
