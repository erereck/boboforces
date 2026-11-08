import type { BlockRegistry } from './blocks.ts';
import { cellIndex } from './cell.ts';
import { cellTablesFor, cellTypeIndex } from './cell-tables.ts';
import { CHUNK_SIZE, CHUNK_VOLUME } from './constants.ts';
import type { WorldGrid } from './grid.ts';

/**
 * Luz em canais (tecnico.md §5.3 e §6.4). CONTRATO DO M1; implementação da frente "mundo".
 *
 * Por CÉLULA de 0,5 m, calculada no loading (nunca por frame, o cenário é estático):
 * - céu 0..15: flood fill a partir do céu aberto (interiores escurecem);
 * - emissivo 0..15: flood fill a partir de blocos emissivos (`BlockDef.emissive`) e das fontes das props (`.bfmap`);
 * - sol 0/1: visibilidade do sol por varredura na direção do sol do mapa.
 * Guardado por chunk não vazio: 1 byte (céu | emissivo << 4) por célula + 1 bit de sol por célula (bitset).
 *
 * No VÉRTICE do cenário (`mesh/region.ts`) céu, sol e emissivo viram 4 bits cada (o sol suavizado: média das células
 * em volta do vértice, 0..15). Os atores e as props instanciadas usam a GRADE DE LUZ de 2 m (abaixo).
 *
 * Como a luz anda (implementação):
 * - A luz passa de uma célula para a vizinha pela face comum, a menos que uma das duas cubra essa face por inteiro
 *   (`shapeCoveredFaces`) e seja opaca: o telhado de rampas ou de lajes fecha o interior; painel, poste, cruz,
 *   cutout e translúcido deixam passar. A forma parcial recebe luz na parte de ar dela (a face de cima da laje e o
 *   plano da rampa usam a luz da própria célula).
 * - Céu: a coluna aberta para cima recebe 15 sem perda; depois o flood fill perde 1 por célula em qualquer direção.
 *   Fora da grade é céu aberto, então a borda X/Z também recebe 14 de fora.
 * - Emissivo: a fonte (bloco emissivo ou prop) fica com o nível dela e espalha para as 6 vizinhas mesmo sendo um cubo.
 * - Sol: um mapa de sombra 2D no plano do topo da grade, projetado na direção do sol; as camadas são varridas de cima
 *   para baixo e cada célula com face coberta (cubo, laje, degrau, rampa) marca a sua sombra. 1 arredondamento por
 *   camada (sem erro acumulado).
 * - Chunk sem luz diferente do padrão (céu 15, sol 1, emissivo 0) não guarda nada (`getChunk` → `null`); um chunk de
 *   ar debaixo de um teto guarda (senão a face do vizinho leria céu aberto).
 */

export const LIGHT_MAX = 15;
/** Byte por célula: céu nos bits 0..3, emissivo nos bits 4..7. */
export const LIGHT_SKY_MASK = 0x0f;
export const LIGHT_EMISSIVE_SHIFT = 4;

export function packCellLight(sky: number, emissive: number): number {
  return (sky & 15) | ((emissive & 15) << LIGHT_EMISSIVE_SHIFT);
}

/** Luz de um chunk de dados (32³). Uniforme (`null`) quando todas as células têm o mesmo valor. */
export interface LightChunk {
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  /** 32768 bytes (céu | emissivo << 4), índice `cellIndex(lx, ly, lz)`; `null` = todas valem `uniformSkyEmissive`. */
  skyEmissive: Uint8Array | null;
  uniformSkyEmissive: number;
  /** Bitset de 4096 bytes (bit `i & 7` do byte `i >> 3`, i = `cellIndex`); `null` = todas valem `uniformSun`. */
  sun: Uint8Array | null;
  uniformSun: 0 | 1;
}

/**
 * Campo de luz do mapa inteiro. Fora da grade: céu 15, sol 1, emissivo 0 (o mundo termina no céu aberto). Chunks sem
 * bloco nenhum não guardam nada (`getChunk` → `null`) e respondem céu 15 e sol 1.
 */
export interface LightField {
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  /** Byte empacotado (céu | emissivo << 4) da célula. */
  skyEmissive(x: number, y: number, z: number): number;
  sky(x: number, y: number, z: number): number;
  emissive(x: number, y: number, z: number): number;
  sun(x: number, y: number, z: number): 0 | 1;
  getChunk(cx: number, cy: number, cz: number): LightChunk | null;
}

/** Fonte de luz de prop emissiva (holofote, gerador ligado), declarada no `.bfmap` e somada ao flood fill. */
export interface LightEmitter {
  /** Célula da fonte. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Nível 1..15. */
  readonly level: number;
}

export interface LightParams {
  /** Direção PARA o sol (unitária, y > 0), a mesma do `.bfmap` e do uniform do render. */
  readonly sunDirX: number;
  readonly sunDirY: number;
  readonly sunDirZ: number;
  readonly emitters: readonly LightEmitter[];
}

/**
 * Trabalho fatiado (loading sem travar o frame; o Switch tem 4 s para o Construto inteiro, tecnico.md §24.3).
 * `step(budget)` faz no máximo `budget` unidades de trabalho (células visitadas) e devolve `true` quando terminou.
 * Granularidade: a fatia fecha no fim da fileira (ou do chunk) em que o orçamento acabou, então pode passar um pouco.
 */
export interface LightJob {
  step(budget: number): boolean;
  readonly done: boolean;
  /** 0..1, para a barra do loading. */
  readonly progress: number;
  /** Válido quando `done`; antes disso, lança. */
  readonly result: LightField;
}

/** Valor padrão do byte céu | emissivo (céu aberto, sem emissivo). */
const DEFAULT_SE = 15;
/** O sol fica baixo demais para a projeção: limita a inclinação (sombra de até 20 células por camada). */
const MIN_SUN_Y = 0.05;

// Bits de face (1 << FACE): +X 1, -X 2, +Y 4, -Y 8, +Z 16, -Z 32.
const B_PX = 1;
const B_NX = 2;
const B_PY = 4;
const B_NY = 8;
const B_PZ = 16;
const B_NZ = 32;

/** Fila FIFO de índices que cresce dobrando (a frente do flood fill é bem menor que o volume). */
class IndexQueue {
  private buf = new Int32Array(1 << 16);
  private head = 0;
  private tail = 0;
  size = 0;

  push(i: number): void {
    if (this.size === this.buf.length) this.grow();
    this.buf[this.tail] = i;
    this.tail = (this.tail + 1) & (this.buf.length - 1);
    this.size++;
  }

  pop(): number {
    const i = this.buf[this.head]!;
    this.head = (this.head + 1) & (this.buf.length - 1);
    this.size--;
    return i;
  }

  private grow(): void {
    const next = new Int32Array(this.buf.length * 2);
    for (let k = 0; k < this.size; k++) next[k] = this.buf[(this.head + k) & (this.buf.length - 1)]!;
    this.buf = next;
    this.head = 0;
    this.tail = this.size;
  }

  release(): void {
    this.buf = new Int32Array(0);
    this.head = this.tail = this.size = 0;
  }
}

/** Grade de luz de 2 m calculada junto com o campo (o `buildLightGrid` só devolve esta). */
const precomputedGrids = new WeakMap<LightField, LightGrid>();

const PHASES = 8;

/** Cria o cálculo de luz (céu, sol e emissivo) do mapa. Determinístico (regra 10). */
export function createLightJob(grid: WorldGrid, registry: BlockRegistry, params: LightParams): LightJob {
  const tables = cellTablesFor(registry);
  const regSize = registry.size;
  const sx = grid.sizeX;
  const sy = grid.sizeY;
  const sz = grid.sizeZ;
  const layer = sx * sz;
  const volume = layer * sy;

  let cover = new Uint8Array(volume);
  let se = new Uint8Array(volume);
  let sunBits = new Uint8Array((volume + 7) >> 3);
  const queue = new IndexQueue();
  /** Pares (índice, nível) das células emissivas. */
  const sources: number[] = [];
  /** Camada mais alta com face que barra luz: acima dela é tudo céu 15 e sol 1, sem varrer célula por célula. */
  let maxCoverY = -1;

  let phase = 0;
  /** Cursor da fase (chunk, fileira, camada…). */
  let cursor = 0;
  let done = false;
  let field: LightField | null = null;
  const chunkSlots = grid.chunksX * grid.chunksY * grid.chunksZ;

  // --- Fase 0: cobertura das faces e fontes emissivas, chunk a chunk ---
  function coverChunk(slot: number): void {
    const cx = slot % grid.chunksX;
    const t = (slot - cx) / grid.chunksX;
    const cz = t % grid.chunksZ;
    const cy = (t - cz) / grid.chunksZ;
    const chunk = grid.getChunk(cx, cy, cz);
    if (!chunk) return;
    const bx = cx * CHUNK_SIZE;
    const by = cy * CHUNK_SIZE;
    const bz = cz * CHUNK_SIZE;
    const ex = Math.min(CHUNK_SIZE, sx - bx);
    const ey = Math.min(CHUNK_SIZE, sy - by);
    const ez = Math.min(CHUNK_SIZE, sz - bz);
    const cells = chunk.cells;
    for (let ly = 0; ly < ey; ly++) {
      for (let lz = 0; lz < ez; lz++) {
        let i = bx + (bz + lz) * sx + (by + ly) * layer;
        let li = cellIndex(0, ly, lz);
        for (let lx = 0; lx < ex; lx++, i++, li++) {
          const cell = cells === null ? chunk.uniform : cells[li]!;
          if (cell === 0) continue;
          const ti = cellTypeIndex(cell, regSize);
          const c = tables.lightCover[ti]!;
          cover[i] = c;
          if (c !== 0 && by + ly > maxCoverY) maxCoverY = by + ly;
          const level = tables.emissive[ti]!;
          if (level > 0) sources.push(i, level);
        }
      }
    }
  }

  // --- Fase 1: colunas de céu aberto (15 sem perda, de cima para baixo) ---
  /** Camada mais baixa com céu 15 pela coluna (`maxCoverY + 1` se o topo já é coberto). */
  const colBottom = new Int16Array(sx * sz);

  function skyColumn(x: number, z: number): number {
    const col = x + z * sx;
    if (maxCoverY < 0) return 1;
    let i = col + maxCoverY * layer;
    if ((cover[i]! & B_PY) !== 0) {
      colBottom[col] = maxCoverY + 1;
      return 1;
    }
    let y = maxCoverY;
    let visited = 0;
    for (;;) {
      visited++;
      se[i] = 15;
      if ((cover[i]! & B_NY) !== 0 || y === 0) break;
      const below = i - layer;
      if ((cover[below]! & B_PY) !== 0) break;
      i = below;
      y--;
    }
    colBottom[col] = y;
    return visited;
  }

  // --- Fase 2: sementes do flood fill do céu, por coluna ---
  // Só interessam (a) as células acesas pela coluna na altura em que a coluna vizinha ainda está no escuro e (b) as
  // células escuras da borda X/Z, que recebem 14 do céu de fora. Nada acima da camada mais alta coberta.
  function seedSkyColumns(z: number): number {
    let work = 0;
    for (let x = 0; x < sx; x++) {
      const col = x + z * sx;
      const bottom = colBottom[col]!;
      if (x === 0 || z === 0 || x === sx - 1 || z === sz - 1) {
        for (let y = 0; y < bottom && y < sy; y++, work++) {
          const i = col + y * layer;
          const c = cover[i]!;
          if (
            (se[i]! & 15) < 14 &&
            ((x === 0 && (c & B_NX) === 0) ||
              (x === sx - 1 && (c & B_PX) === 0) ||
              (z === 0 && (c & B_NZ) === 0) ||
              (z === sz - 1 && (c & B_PZ) === 0))
          ) {
            se[i] = (se[i]! & 0xf0) | 14;
            queue.push(i);
          }
        }
      }
      let hi = -1;
      if (x + 1 < sx) hi = Math.max(hi, colBottom[col + 1]! - 1);
      if (x > 0) hi = Math.max(hi, colBottom[col - 1]! - 1);
      if (z + 1 < sz) hi = Math.max(hi, colBottom[col + sx]! - 1);
      if (z > 0) hi = Math.max(hi, colBottom[col - sx]! - 1);
      if (hi > sy - 1) hi = sy - 1;
      for (let y = bottom; y <= hi; y++, work++) {
        const i = col + y * layer;
        const c = cover[i]!;
        if (
          (x + 1 < sx && (c & B_PX) === 0 && (cover[i + 1]! & B_NX) === 0 && (se[i + 1]! & 15) < 14) ||
          (x > 0 && (c & B_NX) === 0 && (cover[i - 1]! & B_PX) === 0 && (se[i - 1]! & 15) < 14) ||
          (z + 1 < sz && (c & B_PZ) === 0 && (cover[i + sx]! & B_NZ) === 0 && (se[i + sx]! & 15) < 14) ||
          (z > 0 && (c & B_NZ) === 0 && (cover[i - sx]! & B_PZ) === 0 && (se[i - sx]! & 15) < 14)
        ) {
          queue.push(i);
        }
      }
    }
    return work + sx;
  }

  /** Propaga o canal `shift` (0 céu, 4 emissivo) até a fila esvaziar ou o orçamento acabar. Devolve o gasto. */
  function flood(shift: number, budget: number): number {
    const keep = ~(15 << shift) & 0xff;
    let used = 0;
    while (queue.size > 0 && used < budget) {
      const i = queue.pop();
      used++;
      const v = (se[i]! >> shift) & 15;
      if (v <= 1) continue;
      const nv = v - 1;
      const x = i % sx;
      const t = (i - x) / sx;
      const z = t % sz;
      const y = (t - z) / sz;
      const c = cover[i]!;
      if (x + 1 < sx && (c & B_PX) === 0) spread(i + 1, B_NX, nv, shift, keep);
      if (x > 0 && (c & B_NX) === 0) spread(i - 1, B_PX, nv, shift, keep);
      if (y + 1 < sy && (c & B_PY) === 0) spread(i + layer, B_NY, nv, shift, keep);
      if (y > 0 && (c & B_NY) === 0) spread(i - layer, B_PY, nv, shift, keep);
      if (z + 1 < sz && (c & B_PZ) === 0) spread(i + sx, B_NZ, nv, shift, keep);
      if (z > 0 && (c & B_NZ) === 0) spread(i - sx, B_PZ, nv, shift, keep);
    }
    return used;
  }

  function spread(j: number, enterBit: number, nv: number, shift: number, keep: number): void {
    if ((cover[j]! & enterBit) !== 0) return;
    if (((se[j]! >> shift) & 15) >= nv) return;
    se[j] = (se[j]! & keep) | (nv << shift);
    queue.push(j);
  }

  /** Fonte emissiva: fica com o nível e acende as 6 vizinhas mesmo sendo um cubo (a face dela é que brilha). */
  function seedEmitter(i: number, level: number): void {
    const keep = 0x0f;
    if (((se[i]! >> 4) & 15) < level) se[i] = (se[i]! & keep) | (level << 4);
    if (level <= 1) return;
    const nv = level - 1;
    const x = i % sx;
    const t = (i - x) / sx;
    const z = t % sz;
    const y = (t - z) / sz;
    if (x + 1 < sx) spread(i + 1, B_NX, nv, 4, keep);
    if (x > 0) spread(i - 1, B_PX, nv, 4, keep);
    if (y + 1 < sy) spread(i + layer, B_NY, nv, 4, keep);
    if (y > 0) spread(i - layer, B_PY, nv, 4, keep);
    if (z + 1 < sz) spread(i + sx, B_NZ, nv, 4, keep);
    if (z > 0) spread(i - sx, B_PZ, nv, 4, keep);
  }

  // --- Fase 5: sol por mapa de sombra projetado ---
  const sunY = Math.max(params.sunDirY, MIN_SUN_Y);
  const rx = params.sunDirX / sunY;
  const rz = params.sunDirZ / sunY;
  const shiftX = (y: number): number => Math.floor(0.5 + (sy - y - 0.5) * rx);
  const shiftZ = (y: number): number => Math.floor(0.5 + (sy - y - 0.5) * rz);
  const minSX = Math.min(shiftX(0), shiftX(sy - 1));
  const minSZ = Math.min(shiftZ(0), shiftZ(sy - 1));
  const shadowW = sx + Math.max(shiftX(0), shiftX(sy - 1)) - minSX;
  const shadowH = sz + Math.max(shiftZ(0), shiftZ(sy - 1)) - minSZ;
  let shadow: Uint8Array | null = null;

  function sunLayer(y: number): void {
    shadow ??= new Uint8Array(shadowW * shadowH);
    const ox = shiftX(y) - minSX;
    const oz = shiftZ(y) - minSZ;
    for (let z = 0; z < sz; z++) {
      let i = z * sx + y * layer;
      let s = ox + (z + oz) * shadowW;
      for (let x = 0; x < sx; x++, i++, s++) {
        if (shadow[s] === 0) sunBits[i >> 3]! |= 1 << (i & 7);
        // Testa antes de marcar: a própria laje/rampa recebe sol; quem está embaixo, não.
        if ((cover[i]! & 63) !== 0) shadow[s] = 1;
      }
    }
  }

  // --- Fase 6: grade de luz de 2 m (enquanto os arrays planos existem) ---
  let lightGrid: LightGrid | null = null;
  const gridX = Math.ceil(sx / LIGHT_GRID_CELL_CELLS);
  const gridY = Math.ceil(sy / LIGHT_GRID_CELL_CELLS);
  const gridZ = Math.ceil(sz / LIGHT_GRID_CELL_CELLS);
  let gridSums: Uint32Array | null = null;

  /** Soma uma camada de células de 0,5 m nas células de 2 m (só as que não são cubo opaco). */
  function gridLayer(y: number): void {
    const sums = (gridSums ??= new Uint32Array(gridX * gridY * gridZ * 4));
    const gyi = (y >> 2) * gridX * gridZ;
    for (let z = 0; z < sz; z++) {
      const row = gyi + (z >> 2) * gridX;
      let i = z * sx + y * layer;
      for (let x = 0; x < sx; x++, i++) {
        if (cover[i] === 63) continue;
        const g = (row + (x >> 2)) * 4;
        const v = se[i]!;
        sums[g]! += v & 15;
        sums[g + 1]! += (sunBits[i >> 3]! >> (i & 7)) & 1;
        sums[g + 2]! += v >> 4;
        sums[g + 3]!++;
      }
    }
  }

  // --- Fase 7: empacota por chunk ---
  const lightChunks: (LightChunk | null)[] = new Array<LightChunk | null>(chunkSlots).fill(null);

  const packSe = new Uint8Array(CHUNK_VOLUME);
  const packSun = new Uint8Array(CHUNK_VOLUME >> 3);

  function packChunk(slot: number): void {
    const cx = slot % grid.chunksX;
    const t = (slot - cx) / grid.chunksX;
    const cz = t % grid.chunksZ;
    const cy = (t - cz) / grid.chunksZ;
    const bx = cx * CHUNK_SIZE;
    const by = cy * CHUNK_SIZE;
    const bz = cz * CHUNK_SIZE;
    const ex = Math.min(CHUNK_SIZE, sx - bx);
    const ey = Math.min(CHUNK_SIZE, sy - by);
    const ez = Math.min(CHUNK_SIZE, sz - bz);
    // Uma passada: copia para os rascunhos e vê se é tudo padrão ou uniforme. As células de fora da grade (chunk de
    // borda) nunca são consultadas (o campo responde o padrão antes): a uniformidade só olha as de dentro e, no array,
    // as de fora ficam com o padrão.
    packSe.fill(DEFAULT_SE);
    packSun.fill(0xff);
    let firstSe = -1;
    let firstSun = -1;
    let uniformSe = true;
    let uniformSun = true;
    let allDefault = true;
    for (let ly = 0; ly < ey; ly++) {
      for (let lz = 0; lz < ez; lz++) {
        let i = bx + (bz + lz) * sx + (by + ly) * layer;
        let li = cellIndex(0, ly, lz);
        for (let lx = 0; lx < ex; lx++, i++, li++) {
          const v = se[i]!;
          const s = (sunBits[i >> 3]! >> (i & 7)) & 1;
          packSe[li] = v;
          if (s === 0) {
            packSun[li >> 3]! &= ~(1 << (li & 7));
            allDefault = false;
          } else if (v !== DEFAULT_SE) {
            allDefault = false;
          }
          if (firstSe < 0) {
            firstSe = v;
            firstSun = s;
          }
          if (v !== firstSe) uniformSe = false;
          if (s !== firstSun) uniformSun = false;
        }
      }
    }
    if (allDefault) return;
    const skyEmissive = uniformSe ? null : packSe.slice();
    const sun = uniformSun ? null : packSun.slice();
    lightChunks[slot] = {
      cx,
      cy,
      cz,
      skyEmissive,
      uniformSkyEmissive: skyEmissive ? DEFAULT_SE : firstSe,
      sun,
      uniformSun: sun ? 1 : (firstSun as 0 | 1),
    };
  }

  function makeField(): LightField {
    const chunksX = grid.chunksX;
    const chunksY = grid.chunksY;
    const chunksZ = grid.chunksZ;
    const chunkAt = (x: number, y: number, z: number): LightChunk | null => {
      if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return null;
      return lightChunks[(x >> 5) + (z >> 5) * chunksX + (y >> 5) * chunksX * chunksZ] ?? null;
    };
    const skyEmissive = (x: number, y: number, z: number): number => {
      const c = chunkAt(x, y, z);
      if (c === null) return DEFAULT_SE;
      return c.skyEmissive === null ? c.uniformSkyEmissive : c.skyEmissive[cellIndex(x & 31, y & 31, z & 31)]!;
    };
    return {
      sizeX: sx,
      sizeY: sy,
      sizeZ: sz,
      skyEmissive,
      sky: (x, y, z) => skyEmissive(x, y, z) & LIGHT_SKY_MASK,
      emissive: (x, y, z) => skyEmissive(x, y, z) >> LIGHT_EMISSIVE_SHIFT,
      sun(x, y, z) {
        const c = chunkAt(x, y, z);
        if (c === null) return 1;
        if (c.sun === null) return c.uniformSun;
        const li = cellIndex(x & 31, y & 31, z & 31);
        return ((c.sun[li >> 3]! >> (li & 7)) & 1) as 0 | 1;
      },
      getChunk(cx, cy, cz) {
        if (cx < 0 || cy < 0 || cz < 0 || cx >= chunksX || cy >= chunksY || cz >= chunksZ) return null;
        return lightChunks[cx + cz * chunksX + cy * chunksX * chunksZ] ?? null;
      },
    };
  }

  let progressInPhase = 0;

  const job: LightJob = {
    get done() {
      return done;
    },
    get progress() {
      return done ? 1 : Math.min(0.999, (phase + progressInPhase) / PHASES);
    },
    get result(): LightField {
      if (!done || field === null) throw new Error('LightJob: luz ainda não terminou');
      return field;
    },
    step(budget) {
      let used = 0;
      while (!done && used < budget) {
        switch (phase) {
          case 0: // cobertura
            if (cursor >= chunkSlots) {
              // Acima da camada mais alta que barra luz: céu aberto direto.
              se.fill(15, (maxCoverY + 1) * layer);
              phase++;
              progressInPhase = 0;
              cursor = 0;
              break;
            }
            coverChunk(cursor++);
            used += CHUNK_VOLUME;
            progressInPhase = cursor / chunkSlots;
            break;
          case 1: // colunas de céu, uma fileira de X por vez
            if (cursor >= sz) {
              phase++;
              progressInPhase = 0;
              cursor = 0;
              break;
            }
            for (let x = 0; x < sx; x++) used += skyColumn(x, cursor);
            cursor++;
            progressInPhase = cursor / sz;
            break;
          case 2: // sementes do céu
            if (cursor >= sz) {
              phase++;
              progressInPhase = 0;
              cursor = 0;
              break;
            }
            used += seedSkyColumns(cursor++);
            progressInPhase = cursor / sz;
            break;
          case 3: // flood do céu
            if (queue.size === 0) {
              phase++;
              progressInPhase = 0;
              cursor = 0;
              break;
            }
            used += flood(0, budget - used);
            progressInPhase = 0.5;
            break;
          case 4: // fontes emissivas (blocos, depois props) e flood
            if (cursor === 0) {
              for (let k = 0; k < sources.length; k += 2) seedEmitter(sources[k]!, sources[k + 1]!);
              for (const e of params.emitters) {
                if (e.x < 0 || e.y < 0 || e.z < 0 || e.x >= sx || e.y >= sy || e.z >= sz) continue;
                const level = Math.max(0, Math.min(LIGHT_MAX, Math.floor(e.level)));
                if (level > 0) seedEmitter(e.x + e.z * sx + e.y * layer, level);
              }
              used += sources.length / 2 + params.emitters.length;
              cursor = 1;
              break;
            }
            if (queue.size === 0) {
              // Acima da camada mais alta que barra luz, tudo recebe sol.
              const from = (maxCoverY + 1) * layer;
              let i = from;
              for (; i < volume && (i & 7) !== 0; i++) sunBits[i >> 3]! |= 1 << (i & 7);
              if (i < volume) sunBits.fill(0xff, i >> 3);
              phase++;
              progressInPhase = 0;
              cursor = 0;
              break;
            }
            used += flood(4, budget - used);
            progressInPhase = 0.5;
            break;
          case 5: // sol, de cima para baixo
            if (cursor > maxCoverY) {
              phase++;
              progressInPhase = 0;
              cursor = 0;
              shadow = null;
              break;
            }
            sunLayer(maxCoverY - cursor);
            cursor++;
            used += layer;
            progressInPhase = cursor / (maxCoverY + 1);
            break;
          case 6: // grade de 2 m, uma camada por vez
            if (cursor >= sy) {
              lightGrid = finishLightGrid(gridX, gridY, gridZ, gridSums ?? new Uint32Array(gridX * gridY * gridZ * 4));
              gridSums = null;
              phase++;
              progressInPhase = 0;
              cursor = 0;
              break;
            }
            gridLayer(cursor++);
            used += layer;
            progressInPhase = cursor / sy;
            break;
          case 7: // empacota
            if (cursor >= chunkSlots) {
              field = makeField();
              precomputedGrids.set(field, lightGrid!);
              // Solta os arrays planos (o campo guarda só os chunks).
              cover = se = sunBits = new Uint8Array(0);
              queue.release();
              sources.length = 0;
              done = true;
              break;
            }
            packChunk(cursor++);
            used += CHUNK_VOLUME;
            progressInPhase = cursor / chunkSlots;
            break;
        }
      }
      return done;
    },
  };
  return job;
}

/** Atalho: roda o `LightJob` até o fim (ferramentas e testes). */
export function computeLight(grid: WorldGrid, registry: BlockRegistry, params: LightParams): LightField {
  const job = createLightJob(grid, registry, params);
  while (!job.step(1 << 20));
  return job.result;
}

// --- Grade de luz de 2 m (atores, props instanciadas e objetos dinâmicos; tecnico.md §6.4) ---

/** Lado da célula da grade de luz, em metros e em células de 0,5 m. */
export const LIGHT_GRID_CELL_M = 2;
export const LIGHT_GRID_CELL_CELLS = 4;
/** Bytes por célula da grade: céu, sol, emissivo (cada um 0..255, já em escala cheia). */
export const LIGHT_GRID_STRIDE = 3;

/**
 * Grade de luz ambiente de 2 m derivada do `LightField` (média das 4×4×4 células de 0,5 m, só as de ar; célula toda
 * sólida herda a vizinha mais clara para um ator encostado na parede não ficar preto). Origem em (0, 0, 0) m, cobre a
 * grade toda. Índice da célula: `x + z · sizeX + y · sizeX · sizeZ` (x mais rápido, depois z, depois y, como o chunk);
 * `data[i · 3 + 0..2]` = céu, sol, emissivo.
 */
export interface LightGrid {
  /** Tamanho em células de 2 m. */
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  readonly data: Uint8Array;
}

/**
 * Grade de 2 m do campo. Para um campo do `createLightJob` ela já foi montada no fim do cálculo (com os arrays planos,
 * sabendo quais células são cubo opaco) e é devolvida direto; para outro `LightField` qualquer, é calculada pelas
 * consultas, tratando toda célula como ar.
 */
export function buildLightGrid(light: LightField): LightGrid {
  const pre = precomputedGrids.get(light);
  if (pre) return pre;
  const gx = Math.ceil(light.sizeX / LIGHT_GRID_CELL_CELLS);
  const gy = Math.ceil(light.sizeY / LIGHT_GRID_CELL_CELLS);
  const gz = Math.ceil(light.sizeZ / LIGHT_GRID_CELL_CELLS);
  const sums = new Uint32Array(gx * gy * gz * 4);
  for (let y = 0; y < light.sizeY; y++) {
    for (let z = 0; z < light.sizeZ; z++) {
      for (let x = 0; x < light.sizeX; x++) {
        const g = ((x >> 2) + (z >> 2) * gx + (y >> 2) * gx * gz) * 4;
        const v = light.skyEmissive(x, y, z);
        sums[g]! += v & 15;
        sums[g + 1]! += light.sun(x, y, z);
        sums[g + 2]! += v >> 4;
        sums[g + 3]! += 1;
      }
    }
  }
  return finishLightGrid(gx, gy, gz, sums);
}

/** Médias → bytes; células sem ar herdam a vizinha (6-vizinhança) mais clara. */
function finishLightGrid(gx: number, gy: number, gz: number, sums: Uint32Array): LightGrid {
  const n = gx * gy * gz;
  const data = new Uint8Array(n * LIGHT_GRID_STRIDE);
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const count = sums[i * 4 + 3]!;
    if (count === 0) {
      solid[i] = 1;
      continue;
    }
    data[i * 3] = Math.round((sums[i * 4]! * 17) / count);
    data[i * 3 + 1] = Math.round((sums[i * 4 + 1]! * 255) / count);
    data[i * 3 + 2] = Math.round((sums[i * 4 + 2]! * 17) / count);
  }
  const layer = gx * gz;
  for (let i = 0; i < n; i++) {
    if (solid[i] === 0) continue;
    const x = i % gx;
    const t = (i - x) / gx;
    const z = t % gz;
    const y = (t - z) / gz;
    let best = -1;
    let bestSum = -1;
    const consider = (j: number): void => {
      if (solid[j] === 1) return;
      const s = data[j * 3]! + data[j * 3 + 1]! + data[j * 3 + 2]!;
      if (s > bestSum) {
        bestSum = s;
        best = j;
      }
    };
    if (x + 1 < gx) consider(i + 1);
    if (x > 0) consider(i - 1);
    if (y + 1 < gy) consider(i + layer);
    if (y > 0) consider(i - layer);
    if (z + 1 < gz) consider(i + gx);
    if (z > 0) consider(i - gx);
    if (best >= 0) data.copyWithin(i * 3, best * 3, best * 3 + 3);
  }
  return { sizeX: gx, sizeY: gy, sizeZ: gz, data };
}

/**
 * Amostra a grade de luz num ponto em metros, com interpolação trilinear entre os CENTROS das células de 2 m (fora da
 * grade, limita na borda). Escreve céu, sol e emissivo em 0..1 em `out[offset..offset+2]`. Sem alocação: a CPU chama
 * 1x por ator por frame (o `game` preenche `ActorBuffer.light`) e 1x por prop no loading.
 */
export function sampleLightGrid(
  grid: LightGrid,
  x: number,
  y: number,
  z: number,
  out: Float32Array,
  offset: number,
): void {
  const gx = grid.sizeX;
  const gy = grid.sizeY;
  const gz = grid.sizeZ;
  // Coordenada contínua em células da grade, com os centros nos inteiros.
  let u = x / LIGHT_GRID_CELL_M - 0.5;
  let v = y / LIGHT_GRID_CELL_M - 0.5;
  let w = z / LIGHT_GRID_CELL_M - 0.5;
  u = u < 0 ? 0 : u > gx - 1 ? gx - 1 : u;
  v = v < 0 ? 0 : v > gy - 1 ? gy - 1 : v;
  w = w < 0 ? 0 : w > gz - 1 ? gz - 1 : w;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const z0 = Math.floor(w);
  const fx = u - x0;
  const fy = v - y0;
  const fz = w - z0;
  const dx = x0 + 1 < gx ? 3 : 0;
  const dy = y0 + 1 < gy ? gx * gz * 3 : 0;
  const dz = z0 + 1 < gz ? gx * 3 : 0;
  const base = (x0 + z0 * gx + y0 * gx * gz) * 3;
  const d = grid.data;
  for (let c = 0; c < 3; c++) {
    const p = base + c;
    const c00 = d[p]! + (d[p + dx]! - d[p]!) * fx;
    const c10 = d[p + dz]! + (d[p + dz + dx]! - d[p + dz]!) * fx;
    const c01 = d[p + dy]! + (d[p + dy + dx]! - d[p + dy]!) * fx;
    const c11 = d[p + dy + dz]! + (d[p + dy + dz + dx]! - d[p + dy + dz]!) * fx;
    const lo = c00 + (c10 - c00) * fz;
    const hi = c01 + (c11 - c01) * fz;
    out[offset + c] = (lo + (hi - lo) * fy) / 255;
  }
}
