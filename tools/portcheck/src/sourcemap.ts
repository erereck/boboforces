/**
 * Leitor mínimo de source map v3 (sem dependências): traduz linha:coluna do `romfs/main.js` para o arquivo de origem,
 * para o portcheck apontar `packages/x/src/y.ts:12` em vez de uma linha do bundle.
 */
export interface SourcePosition {
  readonly source: string;
  /** 1-based. */
  readonly line: number;
  readonly col: number;
}

interface RawSourceMap {
  readonly version: number;
  readonly sources: readonly string[];
  readonly mappings: string;
  readonly sourceRoot?: string;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));

/** Decodifica um segmento VLQ (`AAgBC`) em números. */
export function decodeVlq(segment: string): number[] {
  const out: number[] = [];
  let value = 0;
  let shift = 0;
  for (const ch of segment) {
    const digit = B64_INDEX.get(ch);
    if (digit === undefined) throw new Error(`source map: caractere VLQ inválido "${ch}"`);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    out.push(value & 1 ? -(value >>> 1) : value >>> 1);
    value = 0;
    shift = 0;
  }
  return out;
}

/** Por linha gerada: segmentos [colGerada, fonte, linhaOrig, colOrig] (todos 0-based), em ordem de coluna. */
type Segment = readonly [number, number, number, number];

export interface SourceMapLookup {
  /** `line`/`col` 1-based do arquivo gerado. `null` se a posição não tiver mapeamento. */
  lookup(line: number, col: number): SourcePosition | null;
}

export function parseSourceMap(json: string): SourceMapLookup {
  const map = JSON.parse(json) as RawSourceMap;
  if (map.version !== 3) throw new Error(`source map: versão ${map.version} não suportada`);
  const lines: Segment[][] = [];
  let source = 0;
  let origLine = 0;
  let origCol = 0;
  for (const lineText of map.mappings.split(';')) {
    const segments: Segment[] = [];
    let genCol = 0;
    for (const seg of lineText.split(',')) {
      if (!seg) continue;
      const v = decodeVlq(seg);
      genCol += v[0] ?? 0;
      if (v.length >= 4) {
        source += v[1] ?? 0;
        origLine += v[2] ?? 0;
        origCol += v[3] ?? 0;
        segments.push([genCol, source, origLine, origCol]);
      }
    }
    lines.push(segments);
  }
  const root = map.sourceRoot ?? '';
  return {
    lookup(line, col) {
      const segments = lines[line - 1];
      if (!segments?.length) return null;
      let best: Segment | undefined;
      for (const s of segments) {
        if (s[0] > col - 1) break;
        best = s;
      }
      best ??= segments[0];
      if (!best) return null;
      const name = map.sources[best[1]];
      if (name === undefined) return null;
      return { source: root + name, line: best[2] + 1, col: best[3] + 1 };
    },
  };
}
