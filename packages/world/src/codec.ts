import { assert } from '@boboforces/shared';
import { deflateSync, Inflate } from 'fflate';
import { AIR, type Cell } from './cell.ts';
import { CHUNK_SIZE, CHUNK_VOLUME, MAX_GRID_SIZE_XZ, MAX_GRID_SIZE_Y } from './constants.ts';
import { createWorldGrid, type WorldGrid } from './grid.ts';

/**
 * Grade em binário próprio: RLE por chunk + deflate (fflate) por cima (tecnico.md §15.2, regra 23). Vai dentro do
 * `.bfmap` no M1; no M0 serve para a arena de teste e para provar o formato.
 *
 * Layout antes do deflate (little-endian):
 *   u32 magia "BFGR" · u8 versão · u16 sizeX · u16 sizeY · u16 sizeZ · varuint nº de chunks
 *   por chunk (na ordem de `forEachChunk`): u16 cx · u16 cy · u16 cz · varuint nº de corridas · (u16 célula, varuint
 *   comprimento) × corridas, na ordem do índice da célula (`lx | lz << 5 | ly << 10`).
 * Chunks ausentes são ar. Chunk uniforme vira 1 corrida.
 *
 * O decodificador não confia no arquivo (no M1 o `.bfmap` e no M6 os códigos da Oficina vêm de fora): tamanho dentro
 * do teto do motor ANTES de alocar a grade, número de chunks que cabe nela, chunk repetido recusado e o inflate com
 * teto de saída tirado do cabeçalho (um "zip bomb" para antes de alocar).
 */
export const GRID_CODEC_MAGIC = 0x52474642; // 'B' 'F' 'G' 'R'
export const GRID_CODEC_VERSION = 1;

/** Bytes que crescem sob demanda (só no loading/ferramentas, nunca no laço quente). */
class ByteSink {
  private buf = new Uint8Array(4096);
  length = 0;

  private ensure(extra: number): void {
    if (this.length + extra <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }

  u8(v: number): void {
    this.ensure(1);
    this.buf[this.length++] = v & 0xff;
  }

  u16(v: number): void {
    this.ensure(2);
    this.buf[this.length++] = v & 0xff;
    this.buf[this.length++] = (v >>> 8) & 0xff;
  }

  u32(v: number): void {
    this.ensure(4);
    this.buf[this.length++] = v & 0xff;
    this.buf[this.length++] = (v >>> 8) & 0xff;
    this.buf[this.length++] = (v >>> 16) & 0xff;
    this.buf[this.length++] = (v >>> 24) & 0xff;
  }

  varUint(v: number): void {
    let x = v >>> 0;
    for (;;) {
      const group = x & 0x7f;
      x >>>= 7;
      if (x === 0) {
        this.u8(group);
        return;
      }
      this.u8(group | 0x80);
    }
  }

  bytes(): Uint8Array {
    return this.buf.subarray(0, this.length);
  }
}

class ByteSource {
  private pos = 0;
  private readonly buf: Uint8Array;

  constructor(buf: Uint8Array) {
    this.buf = buf;
  }

  private need(n: number): void {
    if (this.pos + n > this.buf.length) throw new RangeError('grade: dados truncados');
  }

  u8(): number {
    this.need(1);
    return this.buf[this.pos++]!;
  }

  u16(): number {
    this.need(2);
    const v = this.buf[this.pos]! | (this.buf[this.pos + 1]! << 8);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const b = this.buf;
    const p = this.pos;
    this.pos += 4;
    return (b[p]! | (b[p + 1]! << 8) | (b[p + 2]! << 16) | (b[p + 3]! << 24)) >>> 0;
  }

  varUint(): number {
    let result = 0;
    let shift = 0;
    for (let i = 0; i < 5; i++) {
      const byte = this.u8();
      result += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7;
    }
    throw new RangeError('grade: varuint inválido');
  }

  get done(): boolean {
    return this.pos === this.buf.length;
  }
}

/** RLE de células u16: nº de corridas e depois os pares (valor, comprimento). */
function writeRuns(sink: ByteSink, cells: Uint16Array | null, uniform: Cell): void {
  if (cells === null) {
    sink.varUint(1);
    sink.u16(uniform);
    sink.varUint(CHUNK_VOLUME);
    return;
  }
  let runs = 0;
  for (let i = 0; i < CHUNK_VOLUME;) {
    const v = cells[i]!;
    let j = i + 1;
    while (j < CHUNK_VOLUME && cells[j] === v) j++;
    runs++;
    i = j;
  }
  sink.varUint(runs);
  for (let i = 0; i < CHUNK_VOLUME;) {
    const v = cells[i]!;
    let j = i + 1;
    while (j < CHUNK_VOLUME && cells[j] === v) j++;
    sink.u16(v);
    sink.varUint(j - i);
    i = j;
  }
}

/** Codifica a grade inteira (RLE + deflate). `level` do deflate: 0..9. */
export function encodeGrid(grid: WorldGrid, level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 9): Uint8Array {
  const sink = new ByteSink();
  sink.u32(GRID_CODEC_MAGIC);
  sink.u8(GRID_CODEC_VERSION);
  sink.u16(grid.sizeX);
  sink.u16(grid.sizeY);
  sink.u16(grid.sizeZ);
  let count = 0;
  grid.forEachChunk(() => count++);
  sink.varUint(count);
  grid.forEachChunk((chunk) => {
    sink.u16(chunk.cx);
    sink.u16(chunk.cy);
    sink.u16(chunk.cz);
    writeRuns(sink, chunk.cells, chunk.uniform);
  });
  return deflateSync(sink.bytes(), { level });
}

/** Bytes do cabeçalho até os tamanhos (magia, versão, sizeX/Y/Z) e o maior que ele pode ter (com o varuint). */
const HEADER_SIZES_BYTES = 11;
const HEADER_MAX_BYTES = HEADER_SIZES_BYTES + 5;
/** Maior chunk possível no fio: coordenadas, nº de corridas e uma corrida por célula (u16 + varuint de até 3 bytes). */
const CHUNK_MAX_BYTES = 6 + 5 + CHUNK_VOLUME * 5;

/** Confere o tamanho declarado contra o teto do motor; devolve o número de chunks da grade. */
function checkGridSize(sizeX: number, sizeY: number, sizeZ: number): number {
  if (
    sizeX < 1 ||
    sizeZ < 1 ||
    sizeY < 1 ||
    sizeX > MAX_GRID_SIZE_XZ ||
    sizeZ > MAX_GRID_SIZE_XZ ||
    sizeY > MAX_GRID_SIZE_Y
  ) {
    throw new RangeError(
      `grade: tamanho ${sizeX}×${sizeY}×${sizeZ} fora do teto do motor (${MAX_GRID_SIZE_XZ}×${MAX_GRID_SIZE_Y}×${MAX_GRID_SIZE_XZ})`,
    );
  }
  return Math.ceil(sizeX / CHUNK_SIZE) * Math.ceil(sizeY / CHUNK_SIZE) * Math.ceil(sizeZ / CHUNK_SIZE);
}

/**
 * Inflate com teto de saída: a entrada vai em fatias (cada fatia descompacta no máximo ~1 MB) e, assim que os tamanhos
 * do cabeçalho chegam, o teto vira o maior conteúdo possível para aquela grade. Passou do teto: erro, sem alocar o resto.
 */
function inflateBounded(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  let limit = HEADER_MAX_BYTES + checkGridSize(MAX_GRID_SIZE_XZ, MAX_GRID_SIZE_Y, MAX_GRID_SIZE_XZ) * CHUNK_MAX_BYTES;
  let headerSeen = false;
  const inflater = new Inflate((chunk) => {
    total += chunk.length;
    if (total > limit) throw new RangeError('grade: dados descompactados maiores que a grade declarada');
    parts.push(chunk);
    if (!headerSeen && total >= HEADER_SIZES_BYTES) {
      headerSeen = true;
      const head = concat(parts, total);
      const u16 = (at: number): number => head[at]! | (head[at + 1]! << 8);
      limit = HEADER_MAX_BYTES + checkGridSize(u16(5), u16(7), u16(9)) * CHUNK_MAX_BYTES;
      if (total > limit) throw new RangeError('grade: dados descompactados maiores que a grade declarada');
    }
  });
  const STEP = 1024;
  if (bytes.length === 0) inflater.push(bytes, true);
  for (let i = 0; i < bytes.length; i += STEP) inflater.push(bytes.subarray(i, i + STEP), i + STEP >= bytes.length);
  return concat(parts, total);
}

function concat(parts: readonly Uint8Array[], total: number): Uint8Array {
  if (parts.length === 1) return parts[0]!;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p.subarray(0, Math.min(p.length, total - at)), at);
    at += p.length;
    if (at >= total) break;
  }
  return out;
}

/** Decodifica o que `encodeGrid` gerou. Lança erro com mensagem em pt-BR se os dados forem inválidos. */
export function decodeGrid(bytes: Uint8Array): WorldGrid {
  const src = new ByteSource(inflateBounded(bytes));
  if (src.u32() !== GRID_CODEC_MAGIC) throw new Error('grade: assinatura inválida');
  const version = src.u8();
  if (version > GRID_CODEC_VERSION) throw new Error(`grade: versão ${version} mais nova que a suportada`);
  const sizeX = src.u16();
  const sizeY = src.u16();
  const sizeZ = src.u16();
  const slots = checkGridSize(sizeX, sizeY, sizeZ);
  const chunkCount = src.varUint();
  if (chunkCount > slots) throw new RangeError(`grade: ${chunkCount} chunks não cabem numa grade de ${slots}`);
  const grid = createWorldGrid(sizeX, sizeY, sizeZ);
  const seen = new Uint8Array(slots);
  const scratch = new Uint16Array(CHUNK_VOLUME);
  for (let c = 0; c < chunkCount; c++) {
    const cx = src.u16();
    const cy = src.u16();
    const cz = src.u16();
    if (cx >= grid.chunksX || cy >= grid.chunksY || cz >= grid.chunksZ) {
      throw new RangeError(`grade: chunk ${cx},${cy},${cz} fora`);
    }
    const slot = cx + cz * grid.chunksX + cy * grid.chunksX * grid.chunksZ;
    if (seen[slot] === 1) throw new RangeError(`grade: chunk ${cx},${cy},${cz} repetido`);
    seen[slot] = 1;
    const runs = src.varUint();
    let at = 0;
    let firstSolid = -1;
    for (let r = 0; r < runs; r++) {
      const v = src.u16();
      const len = src.varUint();
      if (at + len > CHUNK_VOLUME) throw new RangeError('grade: corrida passa do chunk');
      if (v !== AIR && firstSolid < 0) firstSolid = at;
      scratch.fill(v, at, at + len);
      at += len;
    }
    if (at !== CHUNK_VOLUME) throw new RangeError('grade: chunk incompleto');
    if (firstSolid < 0) continue;
    // Materializa o chunk pela API da grade (a primeira célula não-ar cria o chunk) e copia o resto direto.
    const lx = firstSolid & (CHUNK_SIZE - 1);
    const lz = (firstSolid >>> 5) & (CHUNK_SIZE - 1);
    const ly = firstSolid >>> 10;
    grid.set(cx * CHUNK_SIZE + lx, cy * CHUNK_SIZE + ly, cz * CHUNK_SIZE + lz, scratch[firstSolid]!);
    const chunk = grid.getChunk(cx, cy, cz);
    assert(chunk !== null && chunk.cells !== null, 'grade: chunk não materializou');
    if (runs === 1) {
      chunk.cells = null;
      chunk.uniform = scratch[0]!;
    } else {
      chunk.cells.set(scratch);
    }
  }
  if (!src.done) throw new Error('grade: bytes sobrando no fim');
  return grid;
}

/** Mesmo conteúdo célula a célula (testes e validação de ida e volta). */
export function gridsEqual(a: WorldGrid, b: WorldGrid): boolean {
  if (a.sizeX !== b.sizeX || a.sizeY !== b.sizeY || a.sizeZ !== b.sizeZ) return false;
  for (let y = 0; y < a.sizeY; y++) {
    for (let z = 0; z < a.sizeZ; z++) {
      for (let x = 0; x < a.sizeX; x++) if (a.get(x, y, z) !== b.get(x, y, z)) return false;
    }
  }
  return true;
}
