import { BLOCK_SIZE, CELLS_PER_METER, CHUNK_MASK, CHUNK_SHIFT } from './constants.ts';

/**
 * Célula = u16 (tecnico.md §5.2): blockId (10 bits, até 1.024 tipos) + giro em Y (2 bits) + inversão vertical (1 bit)
 * + 3 bits reservados. `0` é ar.
 */
export type Cell = number;

/** Índice local do bloco no `BlockRegistry` do mapa (0 = ar). Não é o ID de conteúdo: esse é `BlockDef.key`. */
export type BlockId = number;

export const AIR: Cell = 0;
export const BLOCK_ID_BITS = 10;
export const MAX_BLOCK_ID = (1 << BLOCK_ID_BITS) - 1;

const ROTATION_SHIFT = 10;
const FLIP_SHIFT = 12;

/** Monta a célula. `rotation` em quartos de volta em Y (0..3); `flipped` = de cabeça para baixo (lajes, rampas). */
export function makeCell(block: BlockId, rotation = 0, flipped = false): Cell {
  return (block & MAX_BLOCK_ID) | ((rotation & 3) << ROTATION_SHIFT) | ((flipped ? 1 : 0) << FLIP_SHIFT);
}

export function cellBlock(cell: Cell): BlockId {
  return cell & MAX_BLOCK_ID;
}

export function cellRotation(cell: Cell): number {
  return (cell >>> ROTATION_SHIFT) & 3;
}

export function cellFlipped(cell: Cell): boolean {
  return ((cell >>> FLIP_SHIFT) & 1) === 1;
}

/**
 * Índice da célula dentro do chunk: x varia mais rápido, depois z, depois y (camadas horizontais).
 * `lx`, `ly`, `lz` em [0, 32).
 */
export function cellIndex(lx: number, ly: number, lz: number): number {
  return lx | (lz << CHUNK_SHIFT) | (ly << (CHUNK_SHIFT * 2));
}

/** Coordenada de célula → coordenada de chunk (funciona para negativos). */
export function cellToChunk(c: number): number {
  return c >> CHUNK_SHIFT;
}

/** Coordenada de célula → coordenada local no chunk, em [0, 32). */
export function cellToLocal(c: number): number {
  return c & CHUNK_MASK;
}

/** Metros → célula que contém o ponto. */
export function worldToCell(m: number): number {
  return Math.floor(m * CELLS_PER_METER);
}

/** Célula → metros do canto mínimo. */
export function cellToWorld(c: number): number {
  return c * BLOCK_SIZE;
}
