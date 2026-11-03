/**
 * WOFF2 → sfnt (TTF) só de build. O gerador MSDF (msdf-bmfont-xml → opentype.js 1.3) lê TTF/OTF/WOFF, mas não WOFF2;
 * as cópias da Barlow Condensed que temos (futbobo) são WOFF2. Implementa o necessário da especificação W3C:
 * diretório de tabelas, fluxo Brotli (zlib do Node) e a reconstrução das tabelas `glyf`/`loca` transformadas (§5).
 * A transformação de `hmtx` (versão 1) não aparece nas nossas fontes e é recusada com erro claro.
 */
import { brotliDecompressSync } from 'node:zlib';

// prettier-ignore
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ',
  'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS',
  'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc',
  'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop',
  'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
] as const;

interface TableEntry {
  tag: string;
  transformVersion: number;
  origLength: number;
  /** Bytes no fluxo descomprimido (transformLength se transformada, senão origLength). */
  streamLength: number;
  transformed: boolean;
}

class Reader {
  offset = 0;
  readonly bytes: Uint8Array;
  readonly view: DataView;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u8(): number {
    if (this.offset >= this.bytes.length) throw new Error('woff2: leitura além do fim');
    return this.bytes[this.offset++] as number;
  }
  u16(): number {
    const v = this.view.getUint16(this.offset);
    this.offset += 2;
    return v;
  }
  i16(): number {
    const v = this.view.getInt16(this.offset);
    this.offset += 2;
    return v;
  }
  u32(): number {
    const v = this.view.getUint32(this.offset);
    this.offset += 4;
    return v;
  }
  /** UIntBase128 (diretório de tabelas). */
  base128(): number {
    let result = 0;
    for (let i = 0; i < 5; i++) {
      const b = this.u8();
      if (i === 0 && b === 0x80) throw new Error('woff2: UIntBase128 com zero à esquerda');
      if (result & 0xfe000000) throw new Error('woff2: UIntBase128 estoura 32 bits');
      result = ((result << 7) | (b & 0x7f)) >>> 0;
      if ((b & 0x80) === 0) return result;
    }
    throw new Error('woff2: UIntBase128 longo demais');
  }
  /** 255UInt16 (fluxos do glyf transformado). */
  u255(): number {
    const code = this.u8();
    if (code === 253) return this.u16();
    if (code === 255) return 253 + this.u8();
    if (code === 254) return 253 * 2 + this.u8();
    return code;
  }
  take(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) throw new Error('woff2: fluxo menor que o declarado');
    const out = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }
}

/** Escritor que cresce sozinho (só de build: alocar aqui não importa). */
class Writer {
  bytes = new Uint8Array(1024);
  length = 0;
  private ensure(extra: number): void {
    if (this.length + extra <= this.bytes.length) return;
    let size = this.bytes.length * 2;
    while (size < this.length + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.bytes.subarray(0, this.length));
    this.bytes = next;
  }
  u8(v: number): void {
    this.ensure(1);
    this.bytes[this.length++] = v & 0xff;
  }
  u16(v: number): void {
    this.ensure(2);
    this.bytes[this.length++] = (v >> 8) & 0xff;
    this.bytes[this.length++] = v & 0xff;
  }
  u32(v: number): void {
    this.u16((v >>> 16) & 0xffff);
    this.u16(v & 0xffff);
  }
  bytesOf(data: Uint8Array): void {
    this.ensure(data.length);
    this.bytes.set(data, this.length);
    this.length += data.length;
  }
  pad4(): void {
    while (this.length % 4 !== 0) this.u8(0);
  }
  result(): Uint8Array {
    return this.bytes.slice(0, this.length);
  }
}

function withSign(flag: number, value: number): number {
  return flag & 1 ? value : -value;
}

/** Reconstrói `glyf` e `loca` a partir da tabela `glyf` transformada (WOFF2 §5.1). */
function reconstructGlyf(data: Uint8Array): { glyf: Uint8Array; loca: Uint8Array; indexFormat: number } {
  const header = new Reader(data);
  header.u16(); // reservado
  const optionFlags = header.u16();
  const numGlyphs = header.u16();
  const indexFormat = header.u16();
  const sizes = [header.u32(), header.u32(), header.u32(), header.u32(), header.u32(), header.u32(), header.u32()];
  let offset = header.offset;
  const streams: Reader[] = [];
  for (const size of sizes) {
    if (offset + size > data.length) throw new Error('woff2: glyf transformado truncado');
    streams.push(new Reader(data.subarray(offset, offset + size)));
    offset += size;
  }
  const [nContourStream, nPointsStream, flagStream, glyphStream, compositeStream, bboxStream, instructionStream] =
    streams as [Reader, Reader, Reader, Reader, Reader, Reader, Reader];
  const bboxBitmapLength = 4 * Math.floor((numGlyphs + 31) / 32);
  const bboxBitmap = bboxStream.take(bboxBitmapLength);
  const overlapBitmap = optionFlags & 1 ? data.subarray(offset, offset + Math.floor((numGlyphs + 7) / 8)) : null;
  const hasBbox = (i: number) => ((bboxBitmap[i >> 3] as number) & (0x80 >> (i & 7))) !== 0;
  const hasOverlap = (i: number) =>
    overlapBitmap !== null && ((overlapBitmap[i >> 3] as number) & (0x80 >> (i & 7))) !== 0;

  const glyf = new Writer();
  const offsets: number[] = [];
  for (let i = 0; i < numGlyphs; i++) {
    offsets.push(glyf.length);
    const nContours = nContourStream.i16();
    if (nContours === 0) {
      if (hasBbox(i)) throw new Error(`woff2: glifo vazio ${i} com bbox`);
      continue;
    }
    if (nContours === -1) {
      // Composto: copia os componentes como estão; bbox é obrigatória.
      if (!hasBbox(i)) throw new Error(`woff2: glifo composto ${i} sem bbox`);
      const start = compositeStream.offset;
      let haveInstructions = false;
      let flags: number;
      do {
        flags = compositeStream.u16();
        compositeStream.u16(); // glyphIndex
        if (flags & 0x0100) haveInstructions = true;
        compositeStream.offset += flags & 0x0001 ? 4 : 2;
        if (flags & 0x0008) compositeStream.offset += 2;
        else if (flags & 0x0040) compositeStream.offset += 4;
        else if (flags & 0x0080) compositeStream.offset += 8;
      } while (flags & 0x0020);
      const components = compositeStream.bytes.subarray(start, compositeStream.offset);
      glyf.u16(0xffff);
      for (let k = 0; k < 4; k++) glyf.u16(bboxStream.i16() & 0xffff);
      glyf.bytesOf(components);
      if (haveInstructions) {
        const instructionLength = glyphStream.u255();
        glyf.u16(instructionLength);
        glyf.bytesOf(instructionStream.take(instructionLength));
      }
      glyf.pad4();
      continue;
    }
    if (nContours < 0) throw new Error(`woff2: nContours inválido no glifo ${i}`);

    // Simples: pontos por contorno, flags + triplets, instruções.
    const endPts: number[] = [];
    let total = 0;
    for (let c = 0; c < nContours; c++) {
      total += nPointsStream.u255();
      endPts.push(total - 1);
    }
    const xs = new Int32Array(total);
    const ys = new Int32Array(total);
    const onCurve = new Uint8Array(total);
    let x = 0;
    let y = 0;
    for (let p = 0; p < total; p++) {
      let flag = flagStream.u8();
      onCurve[p] = flag & 0x80 ? 0 : 1;
      flag &= 0x7f;
      let dx: number;
      let dy: number;
      if (flag < 10) {
        dx = 0;
        dy = withSign(flag, ((flag & 14) << 7) + glyphStream.u8());
      } else if (flag < 20) {
        dx = withSign(flag, (((flag - 10) & 14) << 7) + glyphStream.u8());
        dy = 0;
      } else if (flag < 84) {
        const b0 = flag - 20;
        const b1 = glyphStream.u8();
        dx = withSign(flag, 1 + (b0 & 0x30) + (b1 >> 4));
        dy = withSign(flag >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f));
      } else if (flag < 120) {
        const b0 = flag - 84;
        const d0 = glyphStream.u8();
        const d1 = glyphStream.u8();
        dx = withSign(flag, 1 + (Math.floor(b0 / 12) << 8) + d0);
        dy = withSign(flag >> 1, 1 + (((b0 % 12) >> 2) << 8) + d1);
      } else if (flag < 124) {
        const d0 = glyphStream.u8();
        const b2 = glyphStream.u8();
        const d2 = glyphStream.u8();
        dx = withSign(flag, (d0 << 4) + (b2 >> 4));
        dy = withSign(flag >> 1, ((b2 & 0x0f) << 8) + d2);
      } else {
        const d0 = glyphStream.u8();
        const d1 = glyphStream.u8();
        const d2 = glyphStream.u8();
        const d3 = glyphStream.u8();
        dx = withSign(flag, (d0 << 8) + d1);
        dy = withSign(flag >> 1, (d2 << 8) + d3);
      }
      x += dx;
      y += dy;
      xs[p] = x;
      ys[p] = y;
    }
    const instructionLength = glyphStream.u255();
    const instructions = instructionStream.take(instructionLength);

    let xMin: number;
    let yMin: number;
    let xMax: number;
    let yMax: number;
    if (hasBbox(i)) {
      xMin = bboxStream.i16();
      yMin = bboxStream.i16();
      xMax = bboxStream.i16();
      yMax = bboxStream.i16();
    } else {
      xMin = yMin = 0x7fff;
      xMax = yMax = -0x8000;
      for (let p = 0; p < total; p++) {
        xMin = Math.min(xMin, xs[p] as number);
        xMax = Math.max(xMax, xs[p] as number);
        yMin = Math.min(yMin, ys[p] as number);
        yMax = Math.max(yMax, ys[p] as number);
      }
    }

    glyf.u16(nContours);
    glyf.u16(xMin & 0xffff);
    glyf.u16(yMin & 0xffff);
    glyf.u16(xMax & 0xffff);
    glyf.u16(yMax & 0xffff);
    for (const e of endPts) glyf.u16(e);
    glyf.u16(instructionLength);
    glyf.bytesOf(instructions);
    // Codificação padrão do glyf, sem o REPEAT (só tamanho, sem efeito no contorno).
    const flagsOut = new Uint8Array(total);
    const xOut = new Writer();
    const yOut = new Writer();
    let px = 0;
    let py = 0;
    for (let p = 0; p < total; p++) {
      let f = onCurve[p] as number;
      if (p === 0 && hasOverlap(i)) f |= 0x40;
      const dx = (xs[p] as number) - px;
      const dy = (ys[p] as number) - py;
      px = xs[p] as number;
      py = ys[p] as number;
      if (dx === 0) f |= 0x10;
      else if (dx > -256 && dx < 256) {
        f |= 0x02 | (dx > 0 ? 0x10 : 0);
        xOut.u8(Math.abs(dx));
      } else xOut.u16(dx & 0xffff);
      if (dy === 0) f |= 0x20;
      else if (dy > -256 && dy < 256) {
        f |= 0x04 | (dy > 0 ? 0x20 : 0);
        yOut.u8(Math.abs(dy));
      } else yOut.u16(dy & 0xffff);
      flagsOut[p] = f;
    }
    glyf.bytesOf(flagsOut);
    glyf.bytesOf(xOut.result());
    glyf.bytesOf(yOut.result());
    glyf.pad4();
  }
  offsets.push(glyf.length);

  const loca = new Writer();
  for (const o of offsets) {
    if (indexFormat === 0) loca.u16(o / 2);
    else loca.u32(o);
  }
  return { glyf: glyf.result(), loca: loca.result(), indexFormat };
}

function checksum(data: Uint8Array): number {
  let sum = 0;
  let padded = data;
  if (data.length % 4 !== 0) {
    padded = new Uint8Array(data.length + (4 - (data.length % 4)));
    padded.set(data);
  }
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  for (let i = 0; i < padded.length; i += 4) sum = (sum + view.getUint32(i)) >>> 0;
  return sum;
}

/** Monta um sfnt a partir das tabelas (ordem por tag, checksums e `head.checkSumAdjustment` refeitos). */
export function buildSfnt(flavor: number, tables: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const tags = [...tables.keys()].sort();
  const numTables = tags.length;
  let entrySelector = 0;
  while (1 << (entrySelector + 1) <= numTables) entrySelector++;
  const searchRange = (1 << entrySelector) * 16;
  const out = new Writer();
  out.u32(flavor);
  out.u16(numTables);
  out.u16(searchRange);
  out.u16(entrySelector);
  out.u16(numTables * 16 - searchRange);
  let offset = 12 + numTables * 16;
  const placed: { tag: string; data: Uint8Array; offset: number }[] = [];
  for (const tag of tags) {
    const data = tables.get(tag) as Uint8Array;
    if (tag === 'head') new DataView(data.buffer, data.byteOffset, data.byteLength).setUint32(8, 0);
    for (let k = 0; k < 4; k++) out.u8(tag.charCodeAt(k));
    out.u32(checksum(data));
    out.u32(offset);
    out.u32(data.length);
    placed.push({ tag, data, offset });
    offset += Math.ceil(data.length / 4) * 4;
  }
  for (const p of placed) {
    out.bytesOf(p.data);
    out.pad4();
  }
  const font = out.result();
  const head = placed.find((p) => p.tag === 'head');
  if (head) {
    const adjustment = (0xb1b0afba - checksum(font)) >>> 0;
    new DataView(font.buffer).setUint32(head.offset + 8, adjustment);
  }
  return font;
}

export function isWoff2(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x32;
}

/** Converte um WOFF2 (fonte única, sem coleção) em TTF/OTF. */
export function woff2ToSfnt(bytes: Uint8Array): Uint8Array {
  if (!isWoff2(bytes)) throw new Error('woff2: assinatura wOF2 ausente');
  const r = new Reader(bytes);
  r.offset = 4;
  const flavor = r.u32();
  if (flavor === 0x74746366) throw new Error('woff2: coleções (ttcf) não são suportadas');
  r.u32(); // length
  const numTables = r.u16();
  r.u16(); // reservado
  r.u32(); // totalSfntSize
  const totalCompressedSize = r.u32();
  r.offset = 48;

  const entries: TableEntry[] = [];
  for (let i = 0; i < numTables; i++) {
    const flags = r.u8();
    const tagIndex = flags & 0x3f;
    let tag: string;
    if (tagIndex === 63) tag = String.fromCharCode(r.u8(), r.u8(), r.u8(), r.u8());
    else tag = KNOWN_TAGS[tagIndex] as string;
    const transformVersion = (flags >> 6) & 3;
    const origLength = r.base128();
    const isGlyfLoca = tag === 'glyf' || tag === 'loca';
    const transformed = isGlyfLoca ? transformVersion === 0 : transformVersion !== 0;
    const streamLength = transformed ? r.base128() : origLength;
    entries.push({ tag, transformVersion, origLength, streamLength, transformed });
  }

  const stream = new Uint8Array(brotliDecompressSync(r.take(totalCompressedSize)));
  const tables = new Map<string, Uint8Array>();
  let offset = 0;
  const raw = new Map<string, Uint8Array>();
  for (const e of entries) {
    if (offset + e.streamLength > stream.length) throw new Error(`woff2: tabela ${e.tag} além do fluxo`);
    raw.set(e.tag, stream.subarray(offset, offset + e.streamLength));
    offset += e.streamLength;
  }
  for (const e of entries) {
    const data = raw.get(e.tag) as Uint8Array;
    if (!e.transformed) {
      tables.set(e.tag, data.slice());
      continue;
    }
    if (e.tag === 'glyf') {
      const { glyf, loca, indexFormat } = reconstructGlyf(data);
      tables.set('glyf', glyf);
      tables.set('loca', loca);
      const head = raw.get('head');
      if (head && new DataView(head.buffer, head.byteOffset).getInt16(50) !== indexFormat) {
        throw new Error('woff2: indexFormat do glyf difere do head');
      }
      continue;
    }
    if (e.tag === 'loca') continue; // refeita junto com o glyf
    throw new Error(`woff2: transformação ${e.transformVersion} da tabela ${e.tag} não suportada`);
  }
  return buildSfnt(flavor, tables);
}
