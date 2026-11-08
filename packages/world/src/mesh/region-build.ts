import { assert } from '@boboforces/shared';
import { BLOCK_FLAG, type BlockRegistry } from '../blocks.ts';
import { cellIndex } from '../cell.ts';
import { cellTablesFor, cellTypeIndex, KIND_NONE, KIND_OPAQUE, type CellTables } from '../cell-tables.ts';
import { CHUNK_SIZE } from '../constants.ts';
import { chunkIsEmpty } from '../chunk.ts';
import type { WorldGrid } from '../grid.ts';
import type { LightField } from '../light.ts';
import {
  NO_FULL_FACE,
  OPPOSITE_FACE,
  POLY_AODIR,
  POLY_BOUNDARY,
  POLY_NORMAL,
  POLY_NVERT,
  POLY_SRC,
  POLY_TOP,
  POLY_VERTS,
  PROFILE_FULL,
  SO_FULL_OFF,
  SO_FULL_SRC,
  SO_POLY_COUNT,
  SO_POLY_START,
  SO_PROFILE,
} from '../shape-geometry.ts';
import type { RegionMesh, RegionMeshArrays, RegionMeshOptions } from './region.ts';

/**
 * Implementação do mesher por região (contrato em `region.ts`). Passos:
 * 1. Copia a região com 1 célula de borda (66 × 34 × 66) para rascunhos do módulo: tipo de célula (`ti`), luz
 *    (céu | emissivo) e sol.
 * 2. Greedy por direção e por fatia sobre as FACES CHEIAS (quadrado 16×16 alinhado ao eixo: cubos, fundo e topo de
 *    laje, costas de rampa, faces largas do painel…). A chave de fusão é a camada, o deslocamento do plano, as flags,
 *    variantes/quadros, a variação de cor e, nos 4 cantos, AO + céu + sol + emissivo. Funde em u só se os cantos não
 *    variam em u (e em v só se não variam em v): o quad fundido interpola igual às faces separadas.
 * 3. Polígonos das formas (faces parciais, planos inclinados, cruz) um a um, com AO/luz por vértice pela mesma regra.
 * 4. Junta tudo em 3 malhas (opaca, cutout, translúcida), com troca da diagonal pelo AO (0fps).
 *
 * AO (0fps): no vértice, com as duas laterais e o canto da camada da frente: `lado1 && lado2 ? 0 : 3 − (l1 + l2 + c)`.
 * Escurecem só cubos opacos ou cutout. Luz suave: média das 4 células da frente em volta do vértice, sem os cubos
 * opacos (e sem o canto quando as duas laterais são opacas); o emissivo do próprio bloco vale como mínimo.
 *
 * Determinístico (ordem fixa) e sem alocação por célula: os rascunhos são do módulo e só crescem.
 */

// Bits do nibble de flags (espelho de `REGION_VERTEX_FLAG`; o teste confere).
const VF_ANIMATED = 1;
const VF_SWAYS = 2;
const VF_RANDOM_UV = 4;
const VF_TOP = 8;

const RX = 2 * CHUNK_SIZE;
const RY = CHUNK_SIZE;
const RZ = 2 * CHUNK_SIZE;
const PX = RX + 2;
const PY = RY + 2;
const PZ = RZ + 2;
const PXZ = PX * PZ;
const PV = PXZ * PY;
/** Passo do índice com borda por eixo (x, y, z). */
const STRIDE = [1, PXZ, PX] as const;
/** Passo até a vizinha por face (+X, -X, +Y, -Y, +Z, -Z). */
const FACE_STEP = [1, -1, PXZ, -PXZ, PX, -PX] as const;
const DIMS = [RX, RY, RZ] as const;
const SUB = 16;

// Rascunhos da região com borda.
const pTi = new Uint16Array(PV);
const pSE = new Uint8Array(PV);
const pSun = new Uint8Array(PV);
/** Células não vazias por fatia (índice com borda) em cada eixo: fatia vazia não tem face e é pulada. */
const sliceCount = [new Uint32Array(PX), new Uint32Array(PY), new Uint32Array(PZ)] as const;
/** Células da região com polígonos de forma (índices com borda), na ordem da cópia (y, z, x). */
const shapeCells = new Int32Array(RX * RY * RZ);
let shapeCellCount = 0;

// Máscara de uma fatia (até 64 × 64).
const MASK = 64 * 64;
const maskPass = new Uint8Array(MASK);
const maskKey = new Uint32Array(MASK);
const maskC01 = new Uint32Array(MASK);
const maskC23 = new Uint32Array(MASK);

/** Tabelas por registro, além das de `cell-tables.ts`. */
interface MesherTables {
  readonly cells: CellTables;
  /** Por ti × direção: deslocamento da face cheia (ou 255) e camada. */
  readonly fullOff: Uint8Array;
  readonly fullLayer: Uint8Array;
  /** Por ti × face: perfil para o descarte (`SO_PROFILE`; 0 se a célula não desenha). */
  readonly profile: Uint8Array;
  /** Por id: camadas das 6 faces, parte fixa da chave (sem camada e sem deslocamento), nível emissivo. */
  readonly layers: Uint8Array;
  readonly keyBase: Uint32Array;
  readonly emissive: Uint8Array;
}

const tablesCache = new WeakMap<BlockRegistry, MesherTables>();

function mesherTablesFor(registry: BlockRegistry): MesherTables {
  const cached = tablesCache.get(registry);
  if (cached) return cached;
  const cells = cellTablesFor(registry);
  const n = registry.size;
  const layers = new Uint8Array(n * 6);
  const keyBase = new Uint32Array(n);
  const emissive = new Uint8Array(n);
  for (let id = 1; id < n; id++) {
    const def = registry.get(id);
    for (let f = 0; f < 6; f++) {
      const layer = def.faces[f]!;
      assert(Number.isInteger(layer) && layer >= 0 && layer <= 255, `mesher: camada ${layer} do bloco "${def.key}"`);
      layers[id * 6 + f] = layer;
    }
    const fl = def.flags;
    const vflags =
      (def.frames > 1 ? VF_ANIMATED : 0) |
      (fl & BLOCK_FLAG.swaysInWind ? VF_SWAYS : 0) |
      (fl & BLOCK_FLAG.randomUv ? VF_RANDOM_UV : 0);
    const varFrames = ((def.variants - 1) & 15) | (((def.frames - 1) & 15) << 4);
    keyBase[id] = (varFrames << 8) | (vflags << 16) | ((fl & BLOCK_FLAG.colorVariation ? 1 : 0) << 20);
    emissive[id] = fl & BLOCK_FLAG.emissive ? def.emissive : 0;
  }
  const len = cells.length;
  const fullOff = new Uint8Array(len * 6).fill(NO_FULL_FACE);
  const fullLayer = new Uint8Array(len * 6);
  const profile = new Uint8Array(len * 6);
  for (let ti = 8; ti < len; ti++) {
    if (cells.kind[ti] === KIND_NONE) continue;
    const so = cells.so[ti]!;
    const id = ti >> 3;
    for (let f = 0; f < 6; f++) {
      fullOff[ti * 6 + f] = SO_FULL_OFF[so * 6 + f]!;
      fullLayer[ti * 6 + f] = layers[id * 6 + SO_FULL_SRC[so * 6 + f]!]!;
      profile[ti * 6 + f] = SO_PROFILE[so * 6 + f]!;
    }
  }
  const t: MesherTables = { cells, fullOff, fullLayer, profile, layers, keyBase, emissive };
  tablesCache.set(registry, t);
  return t;
}

/** Construtor de uma malha (um por programa), com rascunhos que crescem dobrando e são reaproveitados. */
interface Builder {
  vtx: Uint16Array;
  idx: Uint32Array;
  vCount: number;
  iCount: number;
}

const builders: Builder[] = [0, 1, 2, 3].map(() => ({
  vtx: new Uint16Array(6 * 1024),
  idx: new Uint32Array(1536),
  vCount: 0,
  iCount: 0,
}));

function ensure(b: Builder, verts: number, inds: number): void {
  const needV = (b.vCount + verts) * 6;
  if (b.vtx.length < needV) {
    const grown = new Uint16Array(Math.max(needV, b.vtx.length * 2));
    grown.set(b.vtx.subarray(0, b.vCount * 6));
    b.vtx = grown;
  }
  const needI = b.iCount + inds;
  if (b.idx.length < needI) {
    const grown = new Uint32Array(Math.max(needI, b.idx.length * 2));
    grown.set(b.idx.subarray(0, b.iCount));
    b.idx = grown;
  }
}

// Conteúdo da região (subcélulas), para a AABB de culling.
let bMinX = 0;
let bMinY = 0;
let bMinZ = 0;
let bMaxX = 0;
let bMaxY = 0;
let bMaxZ = 0;

function pushVertex(b: Builder, x: number, y: number, z: number, w3: number, w4: number, w5: number): void {
  const o = b.vCount * 6;
  const v = b.vtx;
  v[o] = x;
  v[o + 1] = y;
  v[o + 2] = z;
  v[o + 3] = w3;
  v[o + 4] = w4;
  v[o + 5] = w5;
  b.vCount++;
  if (x < bMinX) bMinX = x;
  if (y < bMinY) bMinY = y;
  if (z < bMinZ) bMinZ = z;
  if (x > bMaxX) bMaxX = x;
  if (y > bMaxY) bMaxY = y;
  if (z > bMaxZ) bMaxZ = z;
}

// --- Cópia da região com borda --------------------------------------------------------------------------------------

/** Copia células e luz da região com 1 de borda. Devolve `false` se a região não tem bloco nenhum. */
function fillPadded(
  t: MesherTables,
  grid: WorldGrid,
  registry: BlockRegistry,
  light: LightField | null,
  ox: number,
  oy: number,
  oz: number,
): void {
  const size = registry.size;
  const sos = t.cells.so;
  const countX = sliceCount[0];
  const countY = sliceCount[1];
  const countZ = sliceCount[2];
  countX.fill(0);
  countY.fill(0);
  countZ.fill(0);
  shapeCellCount = 0;
  const sx = grid.sizeX;
  const sy = grid.sizeY;
  const sz = grid.sizeZ;
  for (let py = 0; py < PY; py++) {
    const gy = oy + py - 1;
    for (let pz = 0; pz < PZ; pz++) {
      const gz = oz + pz - 1;
      const row = pz * PX + py * PXZ;
      const rowIn = gy >= 0 && gy < sy && gz >= 0 && gz < sz;
      const inner = py >= 1 && py <= RY && pz >= 1 && pz <= RZ;
      let chunkCx = -1;
      let cells: Uint16Array | null = null;
      let uniform = 0;
      let lcCx = -1;
      let lse: Uint8Array | null = null;
      let lseU = 15;
      let lsun: Uint8Array | null = null;
      let lsunU = 1;
      for (let px = 0; px < PX; px++) {
        const gx = ox + px - 1;
        const i = row + px;
        if (!rowIn || gx < 0 || gx >= sx) {
          pTi[i] = 0;
          pSE[i] = 15;
          pSun[i] = 1;
          continue;
        }
        const cx = gx >> 5;
        if (cx !== chunkCx) {
          chunkCx = cx;
          const chunk = grid.getChunk(cx, gy >> 5, gz >> 5);
          cells = chunk ? chunk.cells : null;
          uniform = chunk ? chunk.uniform : 0;
        }
        const li = cellIndex(gx & 31, gy & 31, gz & 31);
        const cell = cells === null ? uniform : cells[li]!;
        const ti = cell === 0 ? 0 : cellTypeIndex(cell, size);
        pTi[i] = ti;
        if (ti !== 0 && inner && px >= 1 && px <= RX) {
          countX[px]!++;
          countY[py]!++;
          countZ[pz]!++;
          if (SO_POLY_COUNT[sos[ti]!]! > 0) shapeCells[shapeCellCount++] = i;
        }
        if (light === null) {
          pSE[i] = 15;
          pSun[i] = 1;
          continue;
        }
        if (cx !== lcCx) {
          lcCx = cx;
          const lc = light.getChunk(cx, gy >> 5, gz >> 5);
          lse = lc ? lc.skyEmissive : null;
          lseU = lc ? lc.uniformSkyEmissive : 15;
          lsun = lc ? lc.sun : null;
          lsunU = lc ? lc.uniformSun : 1;
        }
        pSE[i] = lse === null ? lseU : lse[li]!;
        pSun[i] = lsun === null ? lsunU : (lsun[li >> 3]! >> (li & 7)) & 1;
      }
    }
  }
}

function regionHasBlocks(grid: WorldGrid, rx: number, ry: number, rz: number): boolean {
  for (let dz = 0; dz < 2; dz++) {
    for (let dx = 0; dx < 2; dx++) {
      const c = grid.getChunk(rx * 2 + dx, ry, rz * 2 + dz);
      if (c && !chunkIsEmpty(c)) return true;
    }
  }
  return false;
}

// --- AO e luz de um canto -------------------------------------------------------------------------------------------

/** Canto empacotado: AO (2) | céu (4) << 2 | sol (4) << 6 | emissivo (4) << 10. */
function cornerValue(
  t: MesherTables,
  f: number,
  s1: number,
  s2: number,
  cr: number,
  selfEmissive: number,
  noAo: boolean,
): number {
  const occ = t.cells.aoOccluder;
  const lop = t.cells.lightOpaque;
  const t1 = pTi[s1]!;
  const t2 = pTi[s2]!;
  const t3 = pTi[cr]!;
  const o1 = occ[t1]!;
  const o2 = occ[t2]!;
  let ao = 3;
  if (!noAo) ao = o1 !== 0 && o2 !== 0 ? 0 : 3 - o1 - o2 - occ[t3]!;
  const l1 = lop[t1]!;
  const l2 = lop[t2]!;
  let n = 0;
  let sky = 0;
  let em = 0;
  let sun = 0;
  if (lop[pTi[f]!] === 0) {
    const v = pSE[f]!;
    sky += v & 15;
    em += v >> 4;
    sun += pSun[f]!;
    n++;
  }
  if (l1 === 0) {
    const v = pSE[s1]!;
    sky += v & 15;
    em += v >> 4;
    sun += pSun[s1]!;
    n++;
  }
  if (l2 === 0) {
    const v = pSE[s2]!;
    sky += v & 15;
    em += v >> 4;
    sun += pSun[s2]!;
    n++;
  }
  if (lop[t3] === 0 && !(l1 !== 0 && l2 !== 0)) {
    const v = pSE[cr]!;
    sky += v & 15;
    em += v >> 4;
    sun += pSun[cr]!;
    n++;
  }
  if (n === 0) {
    const v = pSE[f]!;
    sky = v & 15;
    em = v >> 4;
    sun = pSun[f]! * 15;
  } else {
    // Média arredondada (meio para cima), em inteiros.
    const d = 2 * n;
    sky = ((2 * sky + n) / d) | 0;
    em = ((2 * em + n) / d) | 0;
    sun = ((30 * sun + n) / d) | 0;
  }
  if (selfEmissive > em) em = selfEmissive;
  return ao | (sky << 2) | (sun << 6) | (em << 10);
}

/** Nota de brilho do canto para a troca da diagonal (o AO manda; a luz desempata). */
function cornerScore(c: number): number {
  return (c & 3) * 64 + ((c >> 2) & 15) + ((c >> 6) & 15) + ((c >> 10) & 15);
}

function cornerW3(normal: number, c: number, variation: number, layer: number): number {
  return (normal & 31) | ((c & 3) << 5) | (variation << 7) | (layer << 8);
}

function cornerW4(c: number, vflags: number): number {
  return ((c >> 2) & 15) | (((c >> 6) & 15) << 4) | (((c >> 10) & 15) << 8) | (vflags << 12);
}

// --- Greedy das faces cheias ----------------------------------------------------------------------------------------

const cornerScratch = new Uint32Array(4);

function greedyDirection(t: MesherTables, dir: number, noAo: boolean): void {
  const d = dir >> 1;
  const positive = (dir & 1) === 0;
  const ua = (d + 1) % 3;
  const va = (d + 2) % 3;
  const dimK = DIMS[d]!;
  const dimU = DIMS[ua]!;
  const dimV = DIMS[va]!;
  const sK = STRIDE[d]!;
  const sU = STRIDE[ua]!;
  const sV = STRIDE[va]!;
  const opp = OPPOSITE_FACE[dir]!;
  const toFront = positive ? sK : -sK;
  const kinds = t.cells.kind;
  const fullOff = t.fullOff;
  const profile = t.profile;
  const boundaryOff = positive ? SUB : 0;
  const counts = sliceCount[d]!;

  for (let k = 0; k < dimK; k++) {
    if (counts[k + 1] === 0) continue;
    let any = false;
    for (let v = 0; v < dimV; v++) {
      let p = (k + 1) * sK + sU + (v + 1) * sV;
      let m = v * dimU;
      for (let u = 0; u < dimU; u++, p += sU, m++) {
        maskPass[m] = 0;
        const ti = pTi[p]!;
        if (ti === 0) continue;
        const off = fullOff[ti * 6 + dir]!;
        if (off === NO_FULL_FACE) continue;
        const kind = kinds[ti]!;
        let front = p;
        if (off === boundaryOff) {
          front = p + toFront;
          const tn = pTi[front]!;
          if (profile[tn * 6 + opp] === PROFILE_FULL) {
            const kn = kinds[tn]!;
            if (kn === KIND_OPAQUE || (kind !== KIND_OPAQUE && tn >> 3 === ti >> 3)) continue;
          }
        }
        const id = ti >> 3;
        const self = t.emissive[id]!;
        const fu = front - sU;
        const bu = front + sU;
        const c0 = cornerValue(t, front, fu, front - sV, fu - sV, self, noAo);
        const c1 = cornerValue(t, front, bu, front - sV, bu - sV, self, noAo);
        const c2 = cornerValue(t, front, bu, front + sV, bu + sV, self, noAo);
        const c3 = cornerValue(t, front, fu, front + sV, fu + sV, self, noAo);
        maskPass[m] = kind;
        maskKey[m] = (t.keyBase[id]! | t.fullLayer[ti * 6 + dir]! | (off << 21)) >>> 0;
        maskC01[m] = c0 | (c1 << 14);
        maskC23[m] = c2 | (c3 << 14);
        any = true;
      }
    }
    if (!any) continue;
    const planeBase = k * SUB;
    for (let v = 0; v < dimV; v++) {
      for (let u = 0; u < dimU;) {
        const m = u + v * dimU;
        const pass = maskPass[m]!;
        if (pass === 0) {
          u++;
          continue;
        }
        const key = maskKey[m]!;
        const c01 = maskC01[m]!;
        const c23 = maskC23[m]!;
        const k0 = c01 & 0x3fff;
        const k1 = c01 >>> 14;
        const k2 = c23 & 0x3fff;
        const k3 = c23 >>> 14;
        let w = 1;
        if (k0 === k1 && k3 === k2) {
          while (
            u + w < dimU &&
            maskPass[m + w] === pass &&
            maskKey[m + w] === key &&
            maskC01[m + w] === c01 &&
            maskC23[m + w] === c23
          ) {
            w++;
          }
        }
        let h = 1;
        if (k0 === k3 && k1 === k2) {
          grow: while (v + h < dimV) {
            const row = m + h * dimU;
            for (let q = 0; q < w; q++) {
              const r = row + q;
              if (maskPass[r] !== pass || maskKey[r] !== key || maskC01[r] !== c01 || maskC23[r] !== c23) break grow;
            }
            h++;
          }
        }
        for (let hh = 0; hh < h; hh++) maskPass.fill(0, m + hh * dimU, m + hh * dimU + w);
        cornerScratch[0] = k0;
        cornerScratch[1] = k1;
        cornerScratch[2] = k2;
        cornerScratch[3] = k3;
        emitFullQuad(builders[pass]!, dir, d, ua, va, positive, planeBase + ((key >>> 21) & 31), u, v, w, h, key);
        u += w;
      }
    }
  }
}

const corner = [0, 0, 0];

function emitFullQuad(
  b: Builder,
  normal: number,
  d: number,
  ua: number,
  va: number,
  positive: boolean,
  plane: number,
  u0: number,
  v0: number,
  w: number,
  h: number,
  key: number,
): void {
  ensure(b, 4, 6);
  const layer = key & 255;
  const varFrames = (key >>> 8) & 255;
  const vflags = (key >>> 16) & 15;
  const variation = (key >>> 20) & 1;
  const base = b.vCount;
  // Ordem anti-horária vista de fora: (u0,v0) → (u1,v0) → (u1,v1) → (u0,v1) dá normal +d; invertida para -d.
  for (let i = 0; i < 4; i++) {
    const c = positive ? i : (4 - i) & 3;
    corner[d] = plane;
    corner[ua] = (c === 1 || c === 2 ? u0 + w : u0) * SUB;
    corner[va] = (c >= 2 ? v0 + h : v0) * SUB;
    const cv = cornerScratch[c]!;
    pushVertex(
      b,
      corner[0]!,
      corner[1]!,
      corner[2]!,
      cornerW3(normal, cv, variation, layer),
      cornerW4(cv, vflags),
      varFrames,
    );
  }
  // Diagonal: a que liga os cantos mais claros (0fps), para o escuro não virar listra.
  const flip =
    cornerScore(cornerScratch[0]!) + cornerScore(cornerScratch[2]!) <
    cornerScore(cornerScratch[1]!) + cornerScore(cornerScratch[3]!);
  pushQuadIndices(b, base, flip);
}

function pushQuadIndices(b: Builder, base: number, flip: boolean): void {
  const ix = b.iCount;
  const idx = b.idx;
  if (flip) {
    idx[ix] = base + 1;
    idx[ix + 1] = base + 2;
    idx[ix + 2] = base + 3;
    idx[ix + 3] = base + 1;
    idx[ix + 4] = base + 3;
    idx[ix + 5] = base;
  } else {
    idx[ix] = base;
    idx[ix + 1] = base + 1;
    idx[ix + 2] = base + 2;
    idx[ix + 3] = base;
    idx[ix + 4] = base + 2;
    idx[ix + 5] = base + 3;
  }
  b.iCount += 6;
}

// --- Polígonos das formas -------------------------------------------------------------------------------------------

const polyCorner = new Uint32Array(4);
const pc = [0, 0, 0];
const pg = [0, 0, 0];

function shapePolygons(t: MesherTables, noAo: boolean): void {
  const kinds = t.cells.kind;
  const sos = t.cells.so;
  const profile = t.profile;
  for (let n = 0; n < shapeCellCount; n++) {
    const p = shapeCells[n]!;
    const x = p % PX;
    const yz = (p - x) / PX;
    const z = yz % PZ;
    const y = (yz - z) / PZ;
    const ti = pTi[p]!;
    const so = sos[ti]!;
    const count = SO_POLY_COUNT[so]!;
    if (count === 0) continue;
    const kind = kinds[ti]!;
    if (kind === KIND_NONE) continue;
    const id = ti >> 3;
    const self = t.emissive[id]!;
    const keyBase = t.keyBase[id]!;
    const varFrames = (keyBase >>> 8) & 255;
    const vflags = (keyBase >>> 16) & 15;
    const variation = (keyBase >>> 20) & 1;
    const b = builders[kind]!;
    pc[0] = x;
    pc[1] = y;
    pc[2] = z;
    const start = SO_POLY_START[so]!;
    for (let q = start; q < start + count; q++) {
      const boundary = POLY_BOUNDARY[q]!;
      if (boundary >= 0) {
        const tn = pTi[p + FACE_STEP[boundary]!]!;
        const pn = profile[tn * 6 + OPPOSITE_FACE[boundary]!]!;
        if (pn === PROFILE_FULL || (pn >= 2 && pn === SO_PROFILE[so * 6 + boundary])) {
          const kn = kinds[tn]!;
          if (kn === KIND_OPAQUE || (kind !== KIND_OPAQUE && tn >> 3 === id)) continue;
        }
      }
      const nv = POLY_NVERT[q]!;
      const normal = POLY_NORMAL[q]!;
      const layer = t.layers[id * 6 + POLY_SRC[q]!]!;
      const aoDir = POLY_AODIR[q]!;
      const top = POLY_TOP[q]!;
      ensure(b, nv, nv === 4 ? 6 : 3);
      const base = b.vCount;
      for (let j = 0; j < nv; j++) {
        const vo = q * 12 + j * 3;
        const vx = POLY_VERTS[vo]!;
        const vy = POLY_VERTS[vo + 1]!;
        const vz = POLY_VERTS[vo + 2]!;
        let cv: number;
        if (aoDir < 0) {
          // Cruz: luz da própria célula, sem AO.
          const s = pSE[p]!;
          const em = Math.max(s >> 4, self);
          cv = 3 | ((s & 15) << 2) | ((pSun[p]! * 15) << 6) | (em << 10);
        } else {
          const a = aoDir >> 1;
          const ua = (a + 1) % 3;
          const va = (a + 2) % 3;
          pg[0] = x * SUB + vx;
          pg[1] = y * SUB + vy;
          pg[2] = z * SUB + vz;
          // Camada da frente: a célula logo adiante do vértice na direção do eixo.
          const layerA = Math.floor((pg[a]! + ((aoDir & 1) === 0 ? 0.5 : -0.5)) / SUB);
          const su = Math.round(pg[ua]! / SUB) > pc[ua]! ? STRIDE[ua]! : -STRIDE[ua]!;
          const sv = Math.round(pg[va]! / SUB) > pc[va]! ? STRIDE[va]! : -STRIDE[va]!;
          const f = p + (layerA - pc[a]!) * STRIDE[a]!;
          cv = cornerValue(t, f, f + su, f + sv, f + su + sv, self, noAo);
        }
        polyCorner[j] = cv;
        const flags = vflags | ((top >> j) & 1 ? VF_TOP : 0);
        pushVertex(
          b,
          (x - 1) * SUB + vx,
          (y - 1) * SUB + vy,
          (z - 1) * SUB + vz,
          cornerW3(normal, cv, variation, layer),
          cornerW4(cv, flags),
          varFrames,
        );
      }
      if (nv === 4) {
        const flip =
          cornerScore(polyCorner[0]!) + cornerScore(polyCorner[2]!) <
          cornerScore(polyCorner[1]!) + cornerScore(polyCorner[3]!);
        pushQuadIndices(b, base, flip);
      } else {
        const ix = b.iCount;
        b.idx[ix] = base;
        b.idx[ix + 1] = base + 1;
        b.idx[ix + 2] = base + 2;
        b.iCount += 3;
      }
    }
  }
}

// --- Saída ----------------------------------------------------------------------------------------------------------

const EMPTY_VERTICES = new Uint16Array(0);
const EMPTY_INDICES = new Uint16Array(0);

function finish(b: Builder, reuse: RegionMeshArrays | undefined): RegionMeshArrays {
  const nv = b.vCount;
  const ni = b.iCount;
  if (nv === 0) {
    return {
      vertexCount: 0,
      indexCount: 0,
      vertices: reuse ? reuse.vertices : EMPTY_VERTICES,
      indices: reuse ? reuse.indices : EMPTY_INDICES,
    };
  }
  const words = nv * 6;
  const vertices = reuse && reuse.vertices.length >= words ? reuse.vertices : new Uint16Array(words);
  vertices.set(b.vtx.subarray(0, words));
  // Uint16 só até 65.535 vértices: o WebGL2 reserva o índice 0xFFFF para reiniciar a primitiva.
  let indices: Uint16Array | Uint32Array;
  if (nv <= 0xffff) {
    indices =
      reuse && reuse.indices instanceof Uint16Array && reuse.indices.length >= ni ? reuse.indices : new Uint16Array(ni);
  } else {
    indices =
      reuse && reuse.indices instanceof Uint32Array && reuse.indices.length >= ni ? reuse.indices : new Uint32Array(ni);
  }
  indices.set(b.idx.subarray(0, ni));
  return { vertexCount: nv, indexCount: ni, vertices, indices };
}

/** Implementação de `buildRegionMesh` (ver `region.ts`). */
export function buildRegion(
  grid: WorldGrid,
  registry: BlockRegistry,
  light: LightField | null,
  rx: number,
  ry: number,
  rz: number,
  options: RegionMeshOptions | undefined,
): RegionMesh {
  const ox = rx * RX;
  const oy = ry * RY;
  const oz = rz * RZ;
  const reuse = options?.reuse;
  const noAo = options?.noAo === true;
  for (let pass = 1; pass <= 3; pass++) {
    builders[pass]!.vCount = 0;
    builders[pass]!.iCount = 0;
  }
  bMinX = bMinY = bMinZ = Infinity;
  bMaxX = bMaxY = bMaxZ = -Infinity;

  if (regionHasBlocks(grid, rx, ry, rz)) {
    if (light) {
      assert(
        light.sizeX === grid.sizeX && light.sizeY === grid.sizeY && light.sizeZ === grid.sizeZ,
        'buildRegionMesh: luz de outra grade',
      );
    }
    const t = mesherTablesFor(registry);
    fillPadded(t, grid, registry, light, ox, oy, oz);
    for (let dir = 0; dir < 6; dir++) greedyDirection(t, dir, noAo);
    shapePolygons(t, noAo);
  }

  const empty = bMinX > bMaxX;
  return {
    rx,
    ry,
    rz,
    originX: ox,
    originY: oy,
    originZ: oz,
    minX: empty ? 0 : bMinX / SUB,
    minY: empty ? 0 : bMinY / SUB,
    minZ: empty ? 0 : bMinZ / SUB,
    maxX: empty ? -1 : bMaxX / SUB,
    maxY: empty ? -1 : bMaxY / SUB,
    maxZ: empty ? -1 : bMaxZ / SUB,
    opaque: finish(builders[1]!, reuse?.opaque),
    cutout: finish(builders[2]!, reuse?.cutout),
    translucent: finish(builders[3]!, reuse?.translucent),
  };
}
