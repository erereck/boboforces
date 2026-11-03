import { describe, expect, it } from 'vitest';
import { BitReader, BitWriter } from './bits.ts';

describe('BitWriter/BitReader', () => {
  it('ida e volta com larguras variadas', () => {
    const w = new BitWriter(64);
    const cases: [number, number][] = [
      [1, 1],
      [5, 3],
      [0x1f, 5],
      [0xabc, 12],
      [0xffff, 16],
      [0x7fffffff, 31],
      [0xffffffff, 32],
      [0, 7],
      [123456789, 32],
    ];
    for (const [v, bits] of cases) w.writeUint(v, bits);
    const r = new BitReader(w.bytes(), w.bitLength);
    for (const [v, bits] of cases) expect(r.readUint(bits)).toBe(v);
    expect(r.remainingBits).toBe(0);
  });

  it('inteiros com sinal, bool, floats, quantizados e varuint', () => {
    const w = new BitWriter(128);
    w.writeInt(-1, 8);
    w.writeInt(-128, 8);
    w.writeInt(127, 8);
    w.writeInt(-32767, 16);
    w.writeInt(-5, 32);
    w.writeBool(true);
    w.writeBool(false);
    w.writeF32(1.5);
    w.writeF64(Math.PI);
    w.writeQuantized(0.25, 0, 1, 10);
    w.writeVarUint(0);
    w.writeVarUint(300);
    w.writeVarUint(0xffffffff);
    const r = new BitReader(w.bytes(), w.bitLength);
    expect(r.readInt(8)).toBe(-1);
    expect(r.readInt(8)).toBe(-128);
    expect(r.readInt(8)).toBe(127);
    expect(r.readInt(16)).toBe(-32767);
    expect(r.readInt(32)).toBe(-5);
    expect(r.readBool()).toBe(true);
    expect(r.readBool()).toBe(false);
    expect(r.readF32()).toBe(1.5);
    expect(r.readF64()).toBe(Math.PI);
    expect(r.readQuantized(0, 1, 10)).toBeCloseTo(0.25, 3);
    expect(r.readVarUint()).toBe(0);
    expect(r.readVarUint()).toBe(300);
    expect(r.readVarUint()).toBe(0xffffffff);
  });

  it('confere intervalos e capacidade', () => {
    const w = new BitWriter(1);
    expect(() => w.writeUint(256, 8)).toThrow();
    expect(() => w.writeInt(128, 8)).toThrow();
    w.writeU8(7);
    expect(() => w.writeBits(1, 1)).toThrow(RangeError);
    const r = new BitReader(w.bytes());
    r.readU8();
    expect(() => r.readBits(1)).toThrow(RangeError);
  });

  it('reset reaproveita o buffer zerado', () => {
    const w = new BitWriter(4);
    w.writeU32(0xffffffff);
    w.reset();
    w.writeBits(1, 1);
    expect(Array.from(w.bytes())).toEqual([1]);
    expect(w.buffer[1]).toBe(0);
  });

  it('alinha em byte e lê bytes crus', () => {
    const w = new BitWriter(8);
    w.writeBits(1, 3);
    w.alignToByte();
    w.writeBytes(new Uint8Array([9, 8, 7]));
    expect(w.byteLength).toBe(4);
    const r = new BitReader(w.bytes());
    expect(r.readBits(3)).toBe(1);
    r.alignToByte();
    expect(Array.from(r.readBytes(new Uint8Array(3)))).toEqual([9, 8, 7]);
  });
});
