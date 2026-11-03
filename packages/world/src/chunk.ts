import { AIR, cellIndex, type Cell } from './cell.ts';
import { CHUNK_VOLUME } from './constants.ts';

/**
 * Chunk de 32³ células (tecnico.md §5.3). Vazio ou uniforme guarda só `uniform` (cells = null); ao receber a primeira
 * célula diferente, materializa um `Uint16Array(32768)` (64 KB) para a consulta rápida de colisão.
 * O cenário é estático: a grade é montada no loading e não muda na partida (decisão #4).
 */
export interface ChunkData {
  /** Coordenadas do chunk (em chunks, não em células). */
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  /** `null` enquanto todas as células valem `uniform`. Índice: `cellIndex(lx, ly, lz)`. */
  cells: Uint16Array | null;
  uniform: Cell;
}

export function createChunk(cx: number, cy: number, cz: number, fill: Cell = AIR): ChunkData {
  return { cx, cy, cz, cells: null, uniform: fill };
}

export function chunkGet(chunk: ChunkData, lx: number, ly: number, lz: number): Cell {
  return chunk.cells === null ? chunk.uniform : chunk.cells[cellIndex(lx, ly, lz)]!;
}

export function chunkSet(chunk: ChunkData, lx: number, ly: number, lz: number, cell: Cell): void {
  if (chunk.cells === null) {
    if (cell === chunk.uniform) return;
    chunk.cells = new Uint16Array(CHUNK_VOLUME).fill(chunk.uniform);
  }
  chunk.cells[cellIndex(lx, ly, lz)] = cell;
}

/** Chunk sem nenhum bloco (só ar). */
export function chunkIsEmpty(chunk: ChunkData): boolean {
  if (chunk.cells === null) return chunk.uniform === AIR;
  for (let i = 0; i < CHUNK_VOLUME; i++) if (chunk.cells[i] !== AIR) return false;
  return true;
}
