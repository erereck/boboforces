import { assert } from '@boboforces/shared';
import { AIR, cellToChunk, cellToLocal, type Cell } from './cell.ts';
import { chunkGet, chunkSet, createChunk, type ChunkData } from './chunk.ts';
import { CHUNK_SIZE } from './constants.ts';

/**
 * Grade do mapa em células de 0,5 m, a partir de (0, 0, 0). Fora dos limites `get` devolve ar (os limites do mundo
 * são paredes invisíveis declaradas no mapa, tratadas pela colisão, não pela grade).
 */
export interface WorldGrid {
  /** Tamanho em células. */
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  /** Tamanho em chunks (arredondado para cima). */
  readonly chunksX: number;
  readonly chunksY: number;
  readonly chunksZ: number;
  inBounds(x: number, y: number, z: number): boolean;
  get(x: number, y: number, z: number): Cell;
  /** Só no loading/construção (o cenário é estático). Fora dos limites é erro. */
  set(x: number, y: number, z: number, cell: Cell): void;
  /** `null` = fora dos limites ou chunk nunca tocado (todo ar). */
  getChunk(cx: number, cy: number, cz: number): ChunkData | null;
  /** Visita os chunks existentes numa ordem fixa (x mais rápido, depois z, depois y). */
  forEachChunk(fn: (chunk: ChunkData) => void): void;
}

export function createWorldGrid(sizeX: number, sizeY: number, sizeZ: number): WorldGrid {
  assert(sizeX > 0 && sizeY > 0 && sizeZ > 0, 'WorldGrid: tamanho precisa ser positivo');
  const chunksX = Math.ceil(sizeX / CHUNK_SIZE);
  const chunksY = Math.ceil(sizeY / CHUNK_SIZE);
  const chunksZ = Math.ceil(sizeZ / CHUNK_SIZE);
  const chunks: (ChunkData | null)[] = new Array<ChunkData | null>(chunksX * chunksY * chunksZ).fill(null);
  const chunkSlot = (cx: number, cy: number, cz: number): number => cx + cz * chunksX + cy * chunksX * chunksZ;
  const inBounds = (x: number, y: number, z: number): boolean =>
    x >= 0 && y >= 0 && z >= 0 && x < sizeX && y < sizeY && z < sizeZ;

  return {
    sizeX,
    sizeY,
    sizeZ,
    chunksX,
    chunksY,
    chunksZ,
    inBounds,
    get(x, y, z) {
      if (!inBounds(x, y, z)) return AIR;
      const chunk = chunks[chunkSlot(cellToChunk(x), cellToChunk(y), cellToChunk(z))];
      return chunk ? chunkGet(chunk, cellToLocal(x), cellToLocal(y), cellToLocal(z)) : AIR;
    },
    set(x, y, z, cell) {
      assert(inBounds(x, y, z), `WorldGrid.set fora dos limites: ${x},${y},${z}`);
      const cx = cellToChunk(x);
      const cy = cellToChunk(y);
      const cz = cellToChunk(z);
      const slot = chunkSlot(cx, cy, cz);
      let chunk = chunks[slot];
      if (!chunk) {
        if (cell === AIR) return;
        chunk = createChunk(cx, cy, cz);
        chunks[slot] = chunk;
      }
      chunkSet(chunk, cellToLocal(x), cellToLocal(y), cellToLocal(z), cell);
    },
    getChunk(cx, cy, cz) {
      if (cx < 0 || cy < 0 || cz < 0 || cx >= chunksX || cy >= chunksY || cz >= chunksZ) return null;
      return chunks[chunkSlot(cx, cy, cz)] ?? null;
    },
    forEachChunk(fn) {
      for (const chunk of chunks) if (chunk) fn(chunk);
    },
  };
}
