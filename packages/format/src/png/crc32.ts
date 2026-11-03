// CRC-32 (polinômio 0xEDB88320, o do PNG e do zlib). Tabela criada na primeira chamada.

let table: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (table) return table;
  table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

/** Continua um CRC: comece com `0xffffffff` e termine com `^ 0xffffffff` (ou use `crc32`). */
export function crc32Update(crc: number, bytes: Uint8Array, start = 0, end = bytes.length): number {
  const t = crcTable();
  let c = crc;
  for (let i = start; i < end; i++) c = t[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return c >>> 0;
}

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  return (crc32Update(0xffffffff, bytes, start, end) ^ 0xffffffff) >>> 0;
}
