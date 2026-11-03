/**
 * Hash de estado: FNV-1a de 32 bits sobre bytes. Simples, sem dependências e estável entre plataformas para os mesmos
 * bytes. Serve ao teste golden da sim (3.600 ticks com hash estável), aos IDs de fluxo do RNG e ao hash de conteúdo do
 * handshake online. Não é criptográfico.
 *
 * Os bytes de typed arrays são lidos na ordem da memória: todos os alvos (x86, ARM do Switch) são little-endian.
 */
export const FNV_OFFSET_BASIS = 0x811c9dc5;
export const FNV_PRIME = 0x01000193;

/** FNV-1a 32 sobre `bytes`. `seed` permite encadear (passe o hash anterior). */
export function fnv1a32(bytes: Uint8Array, seed: number = FNV_OFFSET_BASIS): number {
  let h = seed >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h = Math.imul(h ^ bytes[i]!, FNV_PRIME);
  }
  return h >>> 0;
}

/** FNV-1a 32 sobre a codificação UTF-8 da string (sem alocar e sem TextEncoder, que não existe no lib ES puro). */
export function fnv1a32String(s: string, seed: number = FNV_OFFSET_BASIS): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    let cp = s.charCodeAt(i);
    // Par substituto → code point completo.
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
        i++;
      }
    }
    if (cp < 0x80) {
      h = Math.imul(h ^ cp, FNV_PRIME);
    } else if (cp < 0x800) {
      h = Math.imul(h ^ (0xc0 | (cp >> 6)), FNV_PRIME);
      h = Math.imul(h ^ (0x80 | (cp & 0x3f)), FNV_PRIME);
    } else if (cp < 0x10000) {
      h = Math.imul(h ^ (0xe0 | (cp >> 12)), FNV_PRIME);
      h = Math.imul(h ^ (0x80 | ((cp >> 6) & 0x3f)), FNV_PRIME);
      h = Math.imul(h ^ (0x80 | (cp & 0x3f)), FNV_PRIME);
    } else {
      h = Math.imul(h ^ (0xf0 | (cp >> 18)), FNV_PRIME);
      h = Math.imul(h ^ (0x80 | ((cp >> 12) & 0x3f)), FNV_PRIME);
      h = Math.imul(h ^ (0x80 | ((cp >> 6) & 0x3f)), FNV_PRIME);
      h = Math.imul(h ^ (0x80 | (cp & 0x3f)), FNV_PRIME);
    }
  }
  return h >>> 0;
}

/** Finalizador do murmur3 (fmix32): espalha bem os bits de um inteiro de 32 bits. */
export function mix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Combina dois hashes de 32 bits (ordem importa). */
export function hashCombine(a: number, b: number): number {
  return mix32((a ^ (b + 0x9e3779b9 + (a << 6) + (a >>> 2))) >>> 0);
}

// Rascunho compartilhado para hashear números sem alocar.
const scratch = new ArrayBuffer(8);
const scratchF64 = new Float64Array(scratch);
const scratchF32 = new Float32Array(scratch);
const scratchU8 = new Uint8Array(scratch);

/**
 * Hash incremental para o estado da sim: alimente na ordem fixa dos sistemas e leia `digest()`.
 * Reutilizável (`reset`), sem alocação por chamada, exceto `bytes()`, que cria uma vista (use fora do laço quente).
 */
export class StateHasher {
  private h: number = FNV_OFFSET_BASIS;

  reset(seed: number = FNV_OFFSET_BASIS): this {
    this.h = seed >>> 0;
    return this;
  }

  u8(v: number): this {
    this.h = Math.imul(this.h ^ (v & 0xff), FNV_PRIME);
    return this;
  }

  u16(v: number): this {
    return this.u8(v).u8(v >>> 8);
  }

  u32(v: number): this {
    return this.u8(v)
      .u8(v >>> 8)
      .u8(v >>> 16)
      .u8(v >>> 24);
  }

  i32(v: number): this {
    return this.u32(v | 0);
  }

  bool(v: boolean): this {
    return this.u8(v ? 1 : 0);
  }

  f32(v: number): this {
    scratchF32[0] = v;
    for (let i = 0; i < 4; i++) this.u8(scratchU8[i]!);
    return this;
  }

  f64(v: number): this {
    scratchF64[0] = v;
    for (let i = 0; i < 8; i++) this.u8(scratchU8[i]!);
    return this;
  }

  string(s: string): this {
    this.h = fnv1a32String(s, this.h);
    return this;
  }

  /** Bytes crus de qualquer typed array (ou DataView). */
  bytes(view: ArrayBufferView): this {
    this.h = fnv1a32(new Uint8Array(view.buffer, view.byteOffset, view.byteLength), this.h);
    return this;
  }

  digest(): number {
    return this.h >>> 0;
  }
}

/** Formata um hash de 32 bits como 8 dígitos hex (para logs, relatórios e testes golden). */
export function hashToHex(h: number): string {
  return (h >>> 0).toString(16).padStart(8, '0');
}
