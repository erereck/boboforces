import { assert } from './assert.ts';
import { clamp } from './math/scalar.ts';

/**
 * Empacotamento em bits (LSB primeiro dentro de cada byte) para InputFrame, snapshots, replays e formatos binários.
 * Estourar a capacidade lança `RangeError`: quem divide um snapshot por prioridade confere `remainingBits` antes.
 */

// Rascunho para converter floats em bits sem alocar.
const scratch = new ArrayBuffer(8);
const scratchF32 = new Float32Array(scratch);
const scratchF64 = new Float64Array(scratch);
const scratchU32 = new Uint32Array(scratch);

function checkBits(bits: number): void {
  assert(Number.isInteger(bits) && bits >= 0 && bits <= 32, `bits precisa estar em [0, 32]: ${bits}`);
}

/** Maior inteiro sem sinal em `bits` bits (sem `<<`, que dá negativo a partir de 31 bits). */
function maxUint(bits: number): number {
  return 2 ** bits - 1;
}

export class BitWriter {
  private buf: Uint8Array;
  private bitPos = 0;

  /** `capacity`: tamanho em bytes de um buffer novo, ou um buffer existente (é zerado). */
  constructor(capacity: number | Uint8Array = 1024) {
    if (typeof capacity === 'number') {
      this.buf = new Uint8Array(capacity);
    } else {
      this.buf = capacity;
      this.buf.fill(0);
    }
  }

  /** O buffer inteiro (inclui bytes ainda não escritos). Use `bytes()` para só a parte escrita. */
  get buffer(): Uint8Array {
    return this.buf;
  }

  get bitLength(): number {
    return this.bitPos;
  }

  get byteLength(): number {
    return (this.bitPos + 7) >>> 3;
  }

  get remainingBits(): number {
    return this.buf.length * 8 - this.bitPos;
  }

  /** Volta ao início e zera o que foi escrito (o buffer é reaproveitado). */
  reset(): void {
    this.buf.fill(0, 0, this.byteLength);
    this.bitPos = 0;
  }

  /** Vista dos bytes escritos (cria um objeto de vista; não copia). */
  bytes(): Uint8Array {
    return this.buf.subarray(0, this.byteLength);
  }

  /** Escreve os `bits` bits menos significativos de `value` (sem sinal). */
  writeBits(value: number, bits: number): void {
    checkBits(bits);
    if (bits === 0) return;
    if (this.bitPos + bits > this.buf.length * 8) {
      throw new RangeError(`BitWriter: sem espaço para ${bits} bits (restam ${this.remainingBits})`);
    }
    let v = bits === 32 ? value >>> 0 : (value >>> 0) & maxUint(bits);
    let remaining = bits;
    while (remaining > 0) {
      const byteIndex = this.bitPos >>> 3;
      const bitOffset = this.bitPos & 7;
      const take = Math.min(8 - bitOffset, remaining);
      const chunk = v & ((1 << take) - 1);
      this.buf[byteIndex] = this.buf[byteIndex]! | (chunk << bitOffset);
      v >>>= take;
      remaining -= take;
      this.bitPos += take;
    }
  }

  writeBool(value: boolean): void {
    this.writeBits(value ? 1 : 0, 1);
  }

  /** Inteiro sem sinal; confere o intervalo. */
  writeUint(value: number, bits: number): void {
    checkBits(bits);
    assert(
      Number.isInteger(value) && value >= 0 && value <= maxUint(bits),
      `writeUint: ${value} não cabe em ${bits} bits`,
    );
    this.writeBits(value, bits);
  }

  /** Inteiro com sinal em complemento de dois; confere o intervalo. */
  writeInt(value: number, bits: number): void {
    checkBits(bits);
    assert(bits > 0, 'writeInt: precisa de pelo menos 1 bit');
    const min = -(2 ** (bits - 1));
    const max = 2 ** (bits - 1) - 1;
    assert(Number.isInteger(value) && value >= min && value <= max, `writeInt: ${value} não cabe em ${bits} bits`);
    this.writeBits(value >>> 0, bits);
  }

  writeU8(value: number): void {
    this.writeUint(value, 8);
  }

  writeU16(value: number): void {
    this.writeUint(value, 16);
  }

  writeU32(value: number): void {
    this.writeUint(value, 32);
  }

  writeF32(value: number): void {
    scratchF32[0] = value;
    this.writeBits(scratchU32[0]!, 32);
  }

  writeF64(value: number): void {
    scratchF64[0] = value;
    this.writeBits(scratchU32[0]!, 32);
    this.writeBits(scratchU32[1]!, 32);
  }

  /** Real em [min, max] quantizado em `bits` bits (valores fora são limitados). */
  writeQuantized(value: number, min: number, max: number, bits: number): void {
    checkBits(bits);
    assert(max > min && bits > 0, 'writeQuantized: intervalo ou bits inválidos');
    const steps = maxUint(bits);
    const q = Math.round(((clamp(value, min, max) - min) / (max - min)) * steps);
    this.writeBits(q, bits);
  }

  /** Inteiro sem sinal de tamanho variável: grupos de 7 bits + 1 bit de continuação (até 2^32 - 1). */
  writeVarUint(value: number): void {
    assert(Number.isInteger(value) && value >= 0 && value <= 0xffffffff, `writeVarUint: ${value} fora de u32`);
    let v = value >>> 0;
    for (;;) {
      const group = v & 0x7f;
      v >>>= 7;
      if (v === 0) {
        this.writeBits(group, 8);
        return;
      }
      this.writeBits(group | 0x80, 8);
    }
  }

  writeBytes(bytes: Uint8Array): void {
    for (let i = 0; i < bytes.length; i++) this.writeBits(bytes[i]!, 8);
  }

  /** Pula até o próximo limite de byte (bits de enchimento ficam zerados). */
  alignToByte(): void {
    this.bitPos = (this.bitPos + 7) & ~7;
  }
}

export class BitReader {
  private buf: Uint8Array;
  private bitLen: number;
  private bitPos = 0;

  constructor(bytes: Uint8Array, bitLength: number = bytes.length * 8) {
    this.buf = bytes;
    this.bitLen = bitLength;
  }

  /** Reaproveita o leitor para outro buffer. */
  reset(bytes: Uint8Array, bitLength: number = bytes.length * 8): void {
    this.buf = bytes;
    this.bitLen = bitLength;
    this.bitPos = 0;
  }

  get bitPosition(): number {
    return this.bitPos;
  }

  get remainingBits(): number {
    return this.bitLen - this.bitPos;
  }

  /** Lê `bits` bits sem sinal. */
  readBits(bits: number): number {
    checkBits(bits);
    if (bits === 0) return 0;
    if (this.bitPos + bits > this.bitLen) {
      throw new RangeError(`BitReader: fim dos dados (pediu ${bits} bits, restam ${this.remainingBits})`);
    }
    let result = 0;
    let shift = 0;
    let remaining = bits;
    while (remaining > 0) {
      const byte = this.buf[this.bitPos >>> 3]!;
      const bitOffset = this.bitPos & 7;
      const take = Math.min(8 - bitOffset, remaining);
      const chunk = (byte >>> bitOffset) & ((1 << take) - 1);
      result = (result | (chunk << shift)) >>> 0;
      shift += take;
      remaining -= take;
      this.bitPos += take;
    }
    return result;
  }

  readBool(): boolean {
    return this.readBits(1) === 1;
  }

  readUint(bits: number): number {
    return this.readBits(bits);
  }

  readInt(bits: number): number {
    assert(bits > 0, 'readInt: precisa de pelo menos 1 bit');
    const v = this.readBits(bits);
    if (bits === 32) return v | 0;
    return v >= 2 ** (bits - 1) ? v - 2 ** bits : v;
  }

  readU8(): number {
    return this.readBits(8);
  }

  readU16(): number {
    return this.readBits(16);
  }

  readU32(): number {
    return this.readBits(32);
  }

  readF32(): number {
    scratchU32[0] = this.readBits(32);
    return scratchF32[0]!;
  }

  readF64(): number {
    scratchU32[0] = this.readBits(32);
    scratchU32[1] = this.readBits(32);
    return scratchF64[0]!;
  }

  readQuantized(min: number, max: number, bits: number): number {
    const steps = maxUint(bits);
    return min + (this.readBits(bits) / steps) * (max - min);
  }

  readVarUint(): number {
    let result = 0;
    let shift = 0;
    for (let i = 0; i < 5; i++) {
      const byte = this.readBits(8);
      result += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7;
    }
    throw new RangeError('BitReader: varuint maior que 5 bytes');
  }

  /** Lê `out.length` bytes para `out`. */
  readBytes(out: Uint8Array): Uint8Array {
    for (let i = 0; i < out.length; i++) out[i] = this.readBits(8);
    return out;
  }

  alignToByte(): void {
    this.bitPos = (this.bitPos + 7) & ~7;
  }
}
