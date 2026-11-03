import { assert } from '@boboforces/shared';
import { BLOCK_FLAG, FACE, type BlockRegistry } from '../blocks.ts';
import { cellBlock, cellFlipped, cellIndex, cellRotation } from '../cell.ts';
import { CHUNK_SIZE } from '../constants.ts';
import type { WorldGrid } from '../grid.ts';
import {
  AO_NONE,
  LIGHT_FULL,
  POSITION_STEPS_PER_CELL,
  VERTEX_FLAG,
  packEmissiveFlags,
  packLight,
  packNormalAo,
  type ChunkMesh,
  type MeshArrays,
  type MeshOptions,
} from './vertex.ts';

/**
 * Mesher por face com culling e greedy meshing por textura (tecnico.md §6.2), versão do M0:
 * - só a forma `cube` gera faces; as outras formas do catálogo chegam no M1 (até lá não geram malha nem escondem
 *   faces vizinhas);
 * - sem AO e sem luz em canais: todo vértice sai com AO aberto e céu/sol cheios, então a fusão só depende da camada,
 *   da variação de cor, do emissivo e das flags (os 4 bytes do vértice) e do programa;
 * - a face de bloco opaco some contra bloco opaco; cutout e translúcido somem contra opaco e contra o MESMO bloco
 *   (vidro com vidro, água com água), e aparecem contra qualquer outro.
 *
 * Determinístico (a ordem de varredura é fixa) e sem alocação por célula: usa rascunhos do módulo e só cresce os
 * buffers de saída quando falta capacidade.
 */

const KIND_NONE = 0;
const KIND_OPAQUE = 1;
const KIND_CUTOUT = 2;
const KIND_TRANSLUCENT = 3;

/** Lado do bloco de células com borda de 1 (vizinhos dos chunks ao lado). */
const PAD = CHUNK_SIZE + 2;
const PAD_AREA = PAD * PAD;

/** Tabelas por registro (calculadas uma vez): tipo de malha por id e camada por id × face local. */
interface RegistryTables {
  readonly kind: Uint8Array;
  readonly layers: Uint8Array;
  /** Byte 0 sem a normal (só variação de cor) e byte 3 (emissivo + flags), por id. */
  readonly variation: Uint8Array;
  readonly emissiveFlags: Uint8Array;
}

const tablesCache = new WeakMap<BlockRegistry, RegistryTables>();

function tablesFor(registry: BlockRegistry): RegistryTables {
  const cached = tablesCache.get(registry);
  if (cached) return cached;
  const n = registry.size;
  const kind = new Uint8Array(n);
  const layers = new Uint8Array(n * 6);
  const variation = new Uint8Array(n);
  const emissiveFlags = new Uint8Array(n);
  for (let id = 1; id < n; id++) {
    const def = registry.get(id);
    if (def.shape !== 'cube') continue;
    const f = def.flags;
    kind[id] = f & BLOCK_FLAG.translucent ? KIND_TRANSLUCENT : f & BLOCK_FLAG.cutout ? KIND_CUTOUT : KIND_OPAQUE;
    for (let face = 0; face < 6; face++) {
      const layer = def.faces[face]!;
      assert(layer >= 0 && layer <= 255 && Number.isInteger(layer), `mesher: camada ${layer} do bloco "${def.key}"`);
      layers[id * 6 + face] = layer;
    }
    variation[id] = f & BLOCK_FLAG.colorVariation ? 1 : 0;
    const vflags =
      (def.frames > 1 ? VERTEX_FLAG.animated : 0) | (f & BLOCK_FLAG.swaysInWind ? VERTEX_FLAG.swaysInWind : 0);
    emissiveFlags[id] = packEmissiveFlags(f & BLOCK_FLAG.emissive ? LIGHT_FULL : 0, vflags);
  }
  const tables: RegistryTables = { kind, layers, variation, emissiveFlags };
  tablesCache.set(registry, tables);
  return tables;
}

/** Faces laterais na ordem de um giro positivo em Y (anti-horário visto de cima, o mesmo sentido do yaw). */
const SIDE_RING = [FACE.pz, FACE.px, FACE.nz, FACE.nx] as const;
const RING_INDEX = [1, 3, -1, -1, 0, 2] as const;

/** Face LOCAL do bloco que aparece na face de MUNDO `face`, para o giro e a inversão da célula. */
function localFace(face: number, rotation: number, flipped: boolean): number {
  if (face === FACE.py || face === FACE.ny) return flipped ? face ^ 1 : face;
  if (rotation === 0) return face;
  return SIDE_RING[(RING_INDEX[face]! - rotation + 4) & 3]!;
}

// Rascunhos do módulo (o mesher roda no loading, numa thread só): células com borda e a máscara de uma fatia.
const padded = new Uint16Array(PAD * PAD * PAD);
const maskKey = new Uint32Array(CHUNK_SIZE * CHUNK_SIZE);
const maskPass = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

/** Construtor de uma malha (um por programa), com buffers que crescem dobrando. */
interface Builder {
  positions: Uint16Array;
  attributes: Uint8Array;
  indices: Uint32Array;
  vertexCount: number;
  indexCount: number;
}

const EMPTY_U16 = new Uint16Array(0);
const EMPTY_U8 = new Uint8Array(0);

// Índices são escritos aqui (u32) e copiados no fim para u16 quando couber.
const builders: Builder[] = [0, 1, 2, 3].map(() => ({
  positions: EMPTY_U16,
  attributes: EMPTY_U8,
  indices: new Uint32Array(0),
  vertexCount: 0,
  indexCount: 0,
}));

function startBuilder(b: Builder, reuse: MeshArrays | undefined): void {
  b.positions = reuse ? reuse.positions : EMPTY_U16;
  b.attributes = reuse ? reuse.attributes : EMPTY_U8;
  b.vertexCount = 0;
  b.indexCount = 0;
}

function ensureCapacity(b: Builder, extraVertices: number, extraIndices: number): void {
  const needV = (b.vertexCount + extraVertices) * 3;
  if (b.positions.length < needV) {
    const grown = new Uint16Array(Math.max(needV, b.positions.length * 2, 1024 * 3));
    grown.set(b.positions.subarray(0, b.vertexCount * 3));
    b.positions = grown;
  }
  const needA = (b.vertexCount + extraVertices) * 4;
  if (b.attributes.length < needA) {
    const grown = new Uint8Array(Math.max(needA, b.attributes.length * 2, 1024 * 4));
    grown.set(b.attributes.subarray(0, b.vertexCount * 4));
    b.attributes = grown;
  }
  const needI = b.indexCount + extraIndices;
  if (b.indices.length < needI) {
    const grown = new Uint32Array(Math.max(needI, b.indices.length * 2, 1536));
    grown.set(b.indices.subarray(0, b.indexCount));
    b.indices = grown;
  }
}

function finishBuilder(b: Builder, reuse: MeshArrays | undefined): MeshArrays {
  const n = b.indexCount;
  let indices: Uint16Array | Uint32Array;
  if (b.vertexCount <= 0x10000) {
    indices =
      reuse && reuse.indices instanceof Uint16Array && reuse.indices.length >= n ? reuse.indices : new Uint16Array(n);
  } else {
    indices =
      reuse && reuse.indices instanceof Uint32Array && reuse.indices.length >= n ? reuse.indices : new Uint32Array(n);
  }
  for (let i = 0; i < n; i++) indices[i] = b.indices[i]!;
  const out: MeshArrays = {
    vertexCount: b.vertexCount,
    indexCount: n,
    positions: b.positions,
    attributes: b.attributes,
    indices,
  };
  // Solta as referências: a malha devolvida é dona dos buffers.
  b.positions = EMPTY_U16;
  b.attributes = EMPTY_U8;
  return out;
}

const corner = [0, 0, 0];

/** Emite um quad de w × h células no plano `plane` do eixo `d`, com o canto mínimo (u0, v0). */
function emitQuad(
  b: Builder,
  d: number,
  positive: boolean,
  plane: number,
  u0: number,
  v0: number,
  w: number,
  h: number,
  key: number,
): void {
  ensureCapacity(b, 4, 6);
  const ua = (d + 1) % 3;
  const va = (d + 2) % 3;
  const base = b.vertexCount;
  const S = POSITION_STEPS_PER_CELL;
  // Ordem anti-horária vista de fora: (u0,v0) → (u1,v0) → (u1,v1) → (u0,v1) dá normal +d (u × v = d); invertida para -d.
  for (let i = 0; i < 4; i++) {
    const c = positive ? i : (4 - i) & 3;
    corner[d] = plane;
    corner[ua] = c === 1 || c === 2 ? u0 + w : u0;
    corner[va] = c >= 2 ? v0 + h : v0;
    const p = (base + i) * 3;
    b.positions[p] = corner[0]! * S;
    b.positions[p + 1] = corner[1]! * S;
    b.positions[p + 2] = corner[2]! * S;
    const a = (base + i) * 4;
    b.attributes[a] = key & 0xff;
    b.attributes[a + 1] = (key >>> 8) & 0xff;
    b.attributes[a + 2] = (key >>> 16) & 0xff;
    b.attributes[a + 3] = key >>> 24;
  }
  const ix = b.indexCount;
  b.indices[ix] = base;
  b.indices[ix + 1] = base + 1;
  b.indices[ix + 2] = base + 2;
  b.indices[ix + 3] = base;
  b.indices[ix + 4] = base + 2;
  b.indices[ix + 5] = base + 3;
  b.vertexCount += 4;
  b.indexCount += 6;
}

/** Copia o chunk e uma borda de 1 célula dos vizinhos para `padded` (índice x + z·PAD + y·PAD²). */
function fillPadded(grid: WorldGrid, cx: number, cy: number, cz: number): boolean {
  const ox = cx * CHUNK_SIZE - 1;
  const oy = cy * CHUNK_SIZE - 1;
  const oz = cz * CHUNK_SIZE - 1;
  const chunk = grid.getChunk(cx, cy, cz);
  let any = false;
  for (let y = 0; y < PAD; y++) {
    const yInner = y > 0 && y <= CHUNK_SIZE;
    for (let z = 0; z < PAD; z++) {
      const zInner = z > 0 && z <= CHUNK_SIZE;
      const row = z * PAD + y * PAD_AREA;
      for (let x = 0; x < PAD; x++) {
        let cell: number;
        if (yInner && zInner && x > 0 && x <= CHUNK_SIZE) {
          cell =
            chunk === null ? 0 : chunk.cells === null ? chunk.uniform : chunk.cells[cellIndex(x - 1, y - 1, z - 1)]!;
          if (cell !== 0) any = true;
        } else {
          cell = grid.get(ox + x, oy + y, oz + z);
        }
        padded[row + x] = cell;
      }
    }
  }
  return any;
}

/**
 * Gera as malhas de um chunk de dados (32³). Consulta os vizinhos na `grid` para não gerar faces escondidas na borda.
 * Posições relativas ao canto mínimo do chunk (`origin*` em células).
 */
export function buildChunkMesh(
  grid: WorldGrid,
  registry: BlockRegistry,
  cx: number,
  cy: number,
  cz: number,
  options?: MeshOptions,
): ChunkMesh {
  const reuse = options?.reuse;
  const reuseArrays = [undefined, reuse?.opaque, reuse?.cutout, reuse?.translucent] as const;
  for (let pass = 1; pass <= 3; pass++) startBuilder(builders[pass]!, reuseArrays[pass]);

  if (fillPadded(grid, cx, cy, cz)) {
    const { kind, layers, variation, emissiveFlags } = tablesFor(registry);
    const light = packLight(LIGHT_FULL, LIGHT_FULL) << 16;
    const step = [1, PAD_AREA, PAD];
    for (let face = 0; face < 6; face++) {
      const d = face >> 1;
      const positive = (face & 1) === 0;
      const ua = (d + 1) % 3;
      const va = (d + 2) % 3;
      const neighborOffset = positive ? step[d]! : -step[d]!;
      const strideU = step[ua]!;
      const strideV = step[va]!;
      const strideK = step[d]!;
      for (let k = 0; k < CHUNK_SIZE; k++) {
        // Máscara da fatia: chave de 32 bits (os 4 bytes do vértice) + programa (0 = sem face).
        let any = false;
        for (let v = 0; v < CHUNK_SIZE; v++) {
          let at = (k + 1) * strideK + 1 * strideU + (v + 1) * strideV;
          for (let u = 0; u < CHUNK_SIZE; u++, at += strideU) {
            const m = u + v * CHUNK_SIZE;
            const cell = padded[at]!;
            const id = cellBlock(cell);
            const kd = id < kind.length ? kind[id]! : KIND_NONE;
            maskPass[m] = 0;
            if (kd === KIND_NONE) continue;
            const nCell = padded[at + neighborOffset]!;
            const nId = cellBlock(nCell);
            const nk = nId < kind.length ? kind[nId]! : KIND_NONE;
            if (nk === KIND_OPAQUE || (nk !== KIND_NONE && kd !== KIND_OPAQUE && nId === id)) continue;
            const layer = layers[id * 6 + localFace(face, cellRotation(cell), cellFlipped(cell))]!;
            maskKey[m] =
              (packNormalAo(face, AO_NONE, variation[id] === 1) | (layer << 8) | light | (emissiveFlags[id]! << 24)) >>>
              0;
            maskPass[m] = kd;
            any = true;
          }
        }
        if (!any) continue;
        const plane = positive ? k + 1 : k;
        // Greedy: estende em u enquanto a chave bate, depois em v enquanto a linha inteira bate.
        for (let v = 0; v < CHUNK_SIZE; v++) {
          for (let u = 0; u < CHUNK_SIZE;) {
            const m = u + v * CHUNK_SIZE;
            const pass = maskPass[m]!;
            if (pass === 0) {
              u++;
              continue;
            }
            const key = maskKey[m]!;
            let w = 1;
            while (u + w < CHUNK_SIZE && maskPass[m + w] === pass && maskKey[m + w] === key) w++;
            let h = 1;
            grow: while (v + h < CHUNK_SIZE) {
              const row = m + h * CHUNK_SIZE;
              for (let t = 0; t < w; t++) if (maskPass[row + t] !== pass || maskKey[row + t] !== key) break grow;
              h++;
            }
            for (let hh = 0; hh < h; hh++) maskPass.fill(0, m + hh * CHUNK_SIZE, m + hh * CHUNK_SIZE + w);
            emitQuad(builders[pass]!, d, positive, plane, u, v, w, h, key);
            u += w;
          }
        }
      }
    }
  }

  return {
    originX: cx * CHUNK_SIZE,
    originY: cy * CHUNK_SIZE,
    originZ: cz * CHUNK_SIZE,
    opaque: finishBuilder(builders[KIND_OPAQUE]!, reuse?.opaque),
    cutout: finishBuilder(builders[KIND_CUTOUT]!, reuse?.cutout),
    translucent: finishBuilder(builders[KIND_TRANSLUCENT]!, reuse?.translucent),
  };
}
