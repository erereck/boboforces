/**
 * M2 (fase 4f): UTF-8 → texto sem o `TextDecoder` (fora do DOM e do Node, como no Switch): lê o arquivo importado
 * (backup). Sequência inválida vira U+FFFD; o BOM do começo é ignorado. Fora do laço quente (aloca a string).
 */
export function decodeUtf8(bytes: Uint8Array): string {
  const out: string[] = [];
  let i = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  let chunk: number[] = [];
  const flush = (): void => {
    out.push(String.fromCodePoint(...chunk));
    chunk = [];
  };
  while (i < bytes.length) {
    const b = bytes[i]!;
    let cp = 0xfffd;
    let n = 1;
    if (b < 0x80) cp = b;
    else if (b >= 0xc2 && b < 0xe0) n = 2;
    else if (b >= 0xe0 && b < 0xf0) n = 3;
    else if (b >= 0xf0 && b < 0xf5) n = 4;
    if (n > 1) {
      let v = b & (0xff >> (n + 1));
      let ok = i + n <= bytes.length;
      for (let k = 1; ok && k < n; k++) {
        const c = bytes[i + k]!;
        if ((c & 0xc0) !== 0x80) ok = false;
        else v = (v << 6) | (c & 0x3f);
      }
      const min = n === 2 ? 0x80 : n === 3 ? 0x800 : 0x10000;
      if (ok && v >= min && v <= 0x10ffff && (v < 0xd800 || v > 0xdfff)) cp = v;
      else n = 1;
    }
    chunk.push(cp);
    if (chunk.length >= 4096) flush();
    i += n;
  }
  flush();
  return out.join('');
}
