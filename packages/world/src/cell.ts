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

/**
 * Layout de bits da célula (contrato do M1, compatível com o `makeCell` do M0):
 *
 *   bit  15 14 13 | 12   | 11 10    | 9 ........ 0
 *        reservado| inv. | giro Y   | blockId
 *
 * - giro Y: quartos de volta ANTI-HORÁRIOS vistos de cima (o mesmo sentido do yaw positivo). O giro 1 leva -Z para -X.
 * - inversão: espelha a forma em Y dentro da célula (laje em cima, rampa de teto). É aplicada ANTES do giro.
 * - reservados: sempre 0 (o decodificador do `.bfmap` recusa célula com bit reservado ligado).
 * Orientação = giro | inversão << 2 (0..7): índice das tabelas por orientação das formas (`shapes.ts`).
 */
export const CELL_ROTATION_SHIFT = 10;
export const CELL_FLIP_SHIFT = 12;
export const CELL_ORIENTATION_SHIFT = CELL_ROTATION_SHIFT;
/** Bits 13..15: precisam ser 0. */
export const CELL_RESERVED_MASK = 0xe000;
/** Orientações possíveis (4 giros × 2 inversões). */
export const ORIENTATION_COUNT = 8;

/** Monta a célula. `rotation` em quartos de volta em Y (0..3); `flipped` = de cabeça para baixo (lajes, rampas). */
export function makeCell(block: BlockId, rotation = 0, flipped = false): Cell {
  return (block & MAX_BLOCK_ID) | ((rotation & 3) << CELL_ROTATION_SHIFT) | ((flipped ? 1 : 0) << CELL_FLIP_SHIFT);
}

/** Orientação 0..7 (giro | inversão << 2) da célula. */
export function cellOrientation(cell: Cell): number {
  return (cell >>> CELL_ORIENTATION_SHIFT) & 7;
}

/** Célula com bits reservados ligados (inválida em arquivo). */
export function cellHasReservedBits(cell: Cell): boolean {
  return (cell & CELL_RESERVED_MASK) !== 0;
}

export function cellBlock(cell: Cell): BlockId {
  return cell & MAX_BLOCK_ID;
}

export function cellRotation(cell: Cell): number {
  return (cell >>> CELL_ROTATION_SHIFT) & 3;
}

export function cellFlipped(cell: Cell): boolean {
  return ((cell >>> CELL_FLIP_SHIFT) & 1) === 1;
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
