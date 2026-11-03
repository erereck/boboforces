/**
 * Leitura mínima de um sfnt (TTF/OTF) só de build: quais códigos a fonte cobre (`cmap` formatos 4 e 12) e os nomes
 * (`name`), para o fontbake pedir ao gerador só glifos que existem e registrar a versão da fonte.
 */

interface TableRecord {
  offset: number;
  length: number;
}

function tables(view: DataView): Map<string, TableRecord> {
  const numTables = view.getUint16(4);
  const out = new Map<string, TableRecord>();
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    let tag = '';
    for (let k = 0; k < 4; k++) tag += String.fromCharCode(view.getUint8(rec + k));
    out.set(tag, { offset: view.getUint32(rec + 8), length: view.getUint32(rec + 12) });
  }
  return out;
}

function viewOf(font: Uint8Array): DataView {
  return new DataView(font.buffer, font.byteOffset, font.byteLength);
}

/** Códigos Unicode com glifo (≠ .notdef) na fonte. */
export function cmapCodepoints(font: Uint8Array): Set<number> {
  const view = viewOf(font);
  const cmap = tables(view).get('cmap');
  if (!cmap) throw new Error('sfnt: tabela cmap ausente');
  const base = cmap.offset;
  const numSubtables = view.getUint16(base + 2);
  // Preferência: Unicode completo (3,10 ou 0,4+), depois BMP (3,1 ou 0,3).
  let best = -1;
  let bestRank = -1;
  for (let i = 0; i < numSubtables; i++) {
    const platform = view.getUint16(base + 4 + i * 8);
    const encoding = view.getUint16(base + 4 + i * 8 + 2);
    const offset = view.getUint32(base + 4 + i * 8 + 4);
    const format = view.getUint16(base + offset);
    let rank = -1;
    if (format === 12 && ((platform === 3 && encoding === 10) || platform === 0)) rank = 2;
    else if (format === 4 && ((platform === 3 && encoding === 1) || platform === 0)) rank = 1;
    if (rank > bestRank) {
      bestRank = rank;
      best = base + offset;
    }
  }
  if (best < 0) throw new Error('sfnt: nenhum cmap Unicode (formato 4 ou 12)');
  const out = new Set<number>();
  const format = view.getUint16(best);
  if (format === 4) {
    const segX2 = view.getUint16(best + 6);
    const endCodes = best + 14;
    const startCodes = endCodes + segX2 + 2;
    const idDeltas = startCodes + segX2;
    const idRangeOffsets = idDeltas + segX2;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = view.getUint16(endCodes + s * 2);
      const start = view.getUint16(startCodes + s * 2);
      const delta = view.getInt16(idDeltas + s * 2);
      const rangeOffset = view.getUint16(idRangeOffsets + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let glyph: number;
        if (rangeOffset === 0) glyph = (c + delta) & 0xffff;
        else {
          const addr = idRangeOffsets + s * 2 + rangeOffset + (c - start) * 2;
          glyph = view.getUint16(addr);
          if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
        }
        if (glyph !== 0) out.add(c);
      }
    }
  } else {
    const groups = view.getUint32(best + 12);
    for (let g = 0; g < groups; g++) {
      const rec = best + 16 + g * 12;
      const start = view.getUint32(rec);
      const end = view.getUint32(rec + 4);
      const startGlyph = view.getUint32(rec + 8);
      for (let c = start; c <= end; c++) if (startGlyph + (c - start) !== 0) out.add(c);
    }
  }
  return out;
}

/** Nome `nameID` (1 família, 4 nome completo, 5 versão…) em inglês, ou `''`. */
export function fontName(font: Uint8Array, nameID: number): string {
  const view = viewOf(font);
  const name = tables(view).get('name');
  if (!name) return '';
  const count = view.getUint16(name.offset + 2);
  const storage = name.offset + view.getUint16(name.offset + 4);
  let fallback = '';
  for (let i = 0; i < count; i++) {
    const rec = name.offset + 6 + i * 12;
    const platform = view.getUint16(rec);
    const encoding = view.getUint16(rec + 2);
    const id = view.getUint16(rec + 6);
    if (id !== nameID) continue;
    const length = view.getUint16(rec + 8);
    const offset = storage + view.getUint16(rec + 10);
    if (platform === 3 && (encoding === 1 || encoding === 10)) {
      let s = '';
      for (let k = 0; k < length; k += 2) s += String.fromCharCode(view.getUint16(offset + k));
      return s;
    }
    if (platform === 1 && encoding === 0) {
      let s = '';
      for (let k = 0; k < length; k++) s += String.fromCharCode(view.getUint8(offset + k));
      fallback = s;
    }
  }
  return fallback;
}
