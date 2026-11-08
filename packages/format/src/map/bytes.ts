/**
 * Leitura e escrita de bytes little-endian do `.bfmap` (só no loading e nas ferramentas, nunca no laço quente).
 * O `world` tem um par parecido para a grade, mas o `format` não importa o `world` (o grafo é o contrário).
 */

/** Bytes que crescem sob demanda. */
export class ByteWriter {
  private buf = new Uint8Array(1 << 16);
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

  i32(v: number): void {
    this.u32(v | 0);
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

  bytes(src: Uint8Array): void {
    this.ensure(src.length);
    this.buf.set(src, this.length);
    this.length += src.length;
  }

  /** Grava `v` (u32) numa posição já escrita (tamanho de seção depois do conteúdo). */
  patchU32(at: number, v: number): void {
    this.buf[at] = v & 0xff;
    this.buf[at + 1] = (v >>> 8) & 0xff;
    this.buf[at + 2] = (v >>> 16) & 0xff;
    this.buf[at + 3] = (v >>> 24) & 0xff;
  }

  result(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

/** Leitor que nunca passa do fim: dado truncado vira erro com mensagem em pt-BR. */
export class ByteReader {
  private pos = 0;
  private readonly buf: Uint8Array;
  private readonly what: string;

  constructor(buf: Uint8Array, what: string) {
    this.buf = buf;
    this.what = what;
  }

  get offset(): number {
    return this.pos;
  }

  get remaining(): number {
    return this.buf.length - this.pos;
  }

  private need(n: number): void {
    if (n < 0 || this.pos + n > this.buf.length) throw new RangeError(`${this.what}: dados truncados`);
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

  i32(): number {
    return this.u32() | 0;
  }

  varUint(): number {
    let result = 0;
    let shift = 0;
    for (let i = 0; i < 5; i++) {
      const byte = this.u8();
      result += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) {
        if (result > 0xffffffff) break;
        return result;
      }
      shift += 7;
    }
    throw new RangeError(`${this.what}: varuint inválido`);
  }

  /** Fatia (sem cópia) dos próximos `n` bytes. */
  take(n: number): Uint8Array {
    this.need(n);
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  get done(): boolean {
    return this.pos === this.buf.length;
  }
}

/** Etiqueta ASCII de 4 letras → u32 (a primeira letra no byte menos significativo: lê como texto num dump). */
export function tagToU32(tag: string): number {
  return (tag.charCodeAt(0) | (tag.charCodeAt(1) << 8) | (tag.charCodeAt(2) << 16) | (tag.charCodeAt(3) << 24)) >>> 0;
}

export function u32ToTag(v: number): string {
  return String.fromCharCode(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
}
