/**
 * M8 (fase 1): um deflate pequeno (RFC 1951) só para os códigos de compartilhar: um bloco com o Huffman fixo e o LZ77
 * guloso (janela de 32 KB, cadeias de até 128). Por que não o `deflateSync` do `fflate`: o menu da web já leva o
 * inflate do `fflate` (o atlas das fontes é PNG), e o `fflate` é um módulo só: usar o compressor dele de qualquer pedaço
 * punha o compressor inteiro no menu (+2,8 KB em gzip, acima do teto de 350 KB). Este mora só no pedaço dos editores; a
 * volta usa o inflate de sempre. Comprime o JSON dos bots e dos presets a ~35–45% (o nível 9 do `fflate` faz ~30%).
 */

const LEN_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
  8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

const WINDOW = 32768;
const MASK = WINDOW - 1;
const HASH_SIZE = 1 << 15;
const MAX_CHAIN = 128;
const MIN_MATCH = 3;
const MAX_MATCH = 258;

/** Os bits saem do menos significativo para o mais (RFC 1951 §3.1.1). */
class BitWriter {
  readonly bytes: number[] = [];
  private acc = 0;
  private count = 0;

  put(value: number, bits: number): void {
    this.acc |= value << this.count;
    this.count += bits;
    while (this.count >= 8) {
      this.bytes.push(this.acc & 255);
      this.acc >>>= 8;
      this.count -= 8;
    }
  }

  /** Um código de Huffman (escrito do bit mais significativo para o menos). */
  code(code: number, bits: number): void {
    let rev = 0;
    for (let i = 0; i < bits; i++) rev |= ((code >> i) & 1) << (bits - 1 - i);
    this.put(rev, bits);
  }

  finish(): Uint8Array {
    if (this.count > 0) this.bytes.push(this.acc & 255);
    return Uint8Array.from(this.bytes);
  }
}

/** O símbolo de literal/tamanho no Huffman fixo (RFC 1951 §3.2.6). */
function writeSymbol(w: BitWriter, sym: number): void {
  if (sym < 144) w.code(0x30 + sym, 8);
  else if (sym < 256) w.code(0x190 + sym - 144, 9);
  else if (sym < 280) w.code(sym - 256, 7);
  else w.code(0xc0 + sym - 280, 8);
}

function writeMatch(w: BitWriter, length: number, distance: number): void {
  let li = LEN_BASE.length - 1;
  while (LEN_BASE[li]! > length) li--;
  writeSymbol(w, 257 + li);
  if (LEN_EXTRA[li]! > 0) w.put(length - LEN_BASE[li]!, LEN_EXTRA[li]!);
  let di = DIST_BASE.length - 1;
  while (DIST_BASE[di]! > distance) di--;
  w.code(di, 5);
  if (DIST_EXTRA[di]! > 0) w.put(distance - DIST_BASE[di]!, DIST_EXTRA[di]!);
}

/** Deflate cru (sem o cabeçalho zlib), num bloco final com o Huffman fixo. */
export function deflateLite(data: Uint8Array): Uint8Array {
  const n = data.length;
  const w = new BitWriter();
  w.put(1, 1); // BFINAL
  w.put(1, 2); // BTYPE = 01 (Huffman fixo)
  const head = new Int32Array(HASH_SIZE).fill(-1);
  const prev = new Int32Array(WINDOW).fill(-1);
  const hash = (i: number): number => ((data[i]! << 10) ^ (data[i + 1]! << 5) ^ data[i + 2]!) & (HASH_SIZE - 1);
  const insert = (i: number): void => {
    if (i + MIN_MATCH > n) return;
    const h = hash(i);
    prev[i & MASK] = head[h]!;
    head[h] = i;
  };
  let i = 0;
  while (i < n) {
    let bestLen = 0;
    let bestDist = 0;
    if (i + MIN_MATCH <= n) {
      const max = Math.min(MAX_MATCH, n - i);
      let j = head[hash(i)]!;
      let chain = MAX_CHAIN;
      while (j >= 0 && i - j <= WINDOW && chain-- > 0) {
        let len = 0;
        while (len < max && data[j + len] === data[i + len]) len++;
        if (len > bestLen) {
          bestLen = len;
          bestDist = i - j;
          if (len === max) break;
        }
        const next = prev[j & MASK]!;
        // A janela é circular: um elo velho sobrescrito apontaria para a frente.
        if (next >= j) break;
        j = next;
      }
    }
    if (bestLen >= MIN_MATCH) {
      writeMatch(w, bestLen, bestDist);
      for (let k = 0; k < bestLen; k++) insert(i + k);
      i += bestLen;
    } else {
      writeSymbol(w, data[i]!);
      insert(i);
      i++;
    }
  }
  writeSymbol(w, 256); // fim do bloco
  return w.finish();
}

/** UTF-8 sem `TextEncoder` (o do `fflate` puxaria o módulo dele para o menu; nem todo runtime tem o global). */
export function encodeUtf8Lite(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d < 0xe000) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}
