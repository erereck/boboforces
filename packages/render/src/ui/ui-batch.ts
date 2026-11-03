import { DRAW_FLOATS_PER_COMMAND, DRAW_OP, type DrawList } from '@boboforces/ui';

/**
 * DrawList → vértices de quads (sem three: testável em Node). Um lote só por viewport: retângulos (forma por SDF),
 * sprites e glifos MSDF usam o mesmo programa e o mesmo texture array, e o recorte (`clipPush`/`clipPop`) é feito
 * na CPU cortando os quads, então nunca quebra o lote.
 *
 * Vértice: 12 floats (`UI_FLOATS_PER_VERTEX`) + cor RGBA8 num buffer à parte.
 *   0-1 posição (px do alvo) · 2-3 uv (sprite/glifo) ou coordenada local em px (retângulo)
 *   4-7 data0: modo, camada, (retângulo: largura, altura | glifo: faixa MSDF em px de tela)
 *   8-11 data1: retângulo: chanfro, contorno, faixa zebrada, 0
 */

export const UI_FLOATS_PER_VERTEX = 12;
export const UI_MODE = { rect: 0, sprite: 1, glyph: 2 } as const;
const MAX_CLIP_DEPTH = 16;

export interface UiAtlasInfo {
  readonly width: number;
  readonly height: number;
  /** Faixa de distância MSDF (px do atlas) por camada de fonte; o índice é a camada. */
  readonly msdfRanges: readonly number[];
  /** Camada da página 0 de sprites. */
  readonly spriteBase: number;
  readonly layers: number;
}

export interface UiBatch {
  /** Capacidade em quads (cresce sozinha, dobrando; nunca encolhe). */
  capacity: number;
  quads: number;
  vertices: Float32Array;
  colors: Uint8Array;
  /** Quantas vezes cresceu (o F2 mostra: crescer é alocação). */
  grows: number;
}

export function createUiBatch(capacity = 1024): UiBatch {
  return {
    capacity,
    quads: 0,
    vertices: new Float32Array(capacity * 4 * UI_FLOATS_PER_VERTEX),
    colors: new Uint8Array(capacity * 4 * 4),
    grows: 0,
  };
}

function grow(batch: UiBatch, needed: number): void {
  let capacity = batch.capacity;
  while (capacity < needed) capacity *= 2;
  const vertices = new Float32Array(capacity * 4 * UI_FLOATS_PER_VERTEX);
  vertices.set(batch.vertices);
  const colors = new Uint8Array(capacity * 4 * 4);
  colors.set(batch.colors);
  batch.vertices = vertices;
  batch.colors = colors;
  batch.capacity = capacity;
  batch.grows++;
}

// Pilha de recortes pré-alocada (x0, y0, x1, y1 já intersectados com o pai).
const clipStack = new Float32Array(MAX_CLIP_DEPTH * 4);

function writeVertex(
  v: Float32Array,
  o: number,
  x: number,
  y: number,
  u: number,
  w: number,
  mode: number,
  layer: number,
  d2: number,
  d3: number,
  e0: number,
  e1: number,
  e2: number,
): void {
  v[o] = x;
  v[o + 1] = y;
  v[o + 2] = u;
  v[o + 3] = w;
  v[o + 4] = mode;
  v[o + 5] = layer;
  v[o + 6] = d2;
  v[o + 7] = d3;
  v[o + 8] = e0;
  v[o + 9] = e1;
  v[o + 10] = e2;
  v[o + 11] = 0;
}

/**
 * Preenche `batch` com os quads da lista e devolve quantos são. Comandos de textura sem atlas (ou com camada fora
 * dele) são pulados. `pxScale` = px do drawing buffer por px da DrawList (entra na faixa MSDF em px de tela).
 * Sem alocação, exceto quando o lote precisa crescer.
 */
export function buildUiBatch(list: DrawList, atlas: UiAtlasInfo | null, batch: UiBatch, pxScale = 1): number {
  // Cada comando vira no máximo 1 quad: crescer antes deixa o laço sem checagem.
  if (list.count > batch.capacity) grow(batch, list.count);
  const { ops, geom, colors: cmdColors, textures } = list;
  let depth = 0;
  let cx0 = -Infinity;
  let cy0 = -Infinity;
  let cx1 = Infinity;
  let cy1 = Infinity;
  let quads = 0;
  const v = batch.vertices;
  const c = batch.colors;
  for (let i = 0; i < list.count; i++) {
    const op = ops[i];
    const g = i * DRAW_FLOATS_PER_COMMAND;
    const x = geom[g] as number;
    const y = geom[g + 1] as number;
    const w = geom[g + 2] as number;
    const h = geom[g + 3] as number;
    if (op === DRAW_OP.clipPush) {
      if (depth < MAX_CLIP_DEPTH) {
        clipStack[depth * 4] = cx0;
        clipStack[depth * 4 + 1] = cy0;
        clipStack[depth * 4 + 2] = cx1;
        clipStack[depth * 4 + 3] = cy1;
      }
      depth++;
      cx0 = Math.max(cx0, x);
      cy0 = Math.max(cy0, y);
      cx1 = Math.min(cx1, x + w);
      cy1 = Math.min(cy1, y + h);
      continue;
    }
    if (op === DRAW_OP.clipPop) {
      if (depth > 0) {
        depth--;
        if (depth < MAX_CLIP_DEPTH) {
          cx0 = clipStack[depth * 4] as number;
          cy0 = clipStack[depth * 4 + 1] as number;
          cx1 = clipStack[depth * 4 + 2] as number;
          cy1 = clipStack[depth * 4 + 3] as number;
        }
      }
      continue;
    }
    if (w <= 0 || h <= 0) continue;
    let mode: number;
    let layer = 0;
    let d2 = 0;
    let d3 = 0;
    let e0 = 0;
    let e1 = 0;
    let e2 = 0;
    const a0 = geom[g + 4] as number;
    const b0 = geom[g + 5] as number;
    const a1 = geom[g + 6] as number;
    const b1 = geom[g + 7] as number;
    if (op === DRAW_OP.rect) {
      mode = UI_MODE.rect;
      d2 = w;
      d3 = h;
      e0 = a0;
      e1 = b0;
      e2 = a1;
    } else if (op === DRAW_OP.glyph) {
      if (!atlas) continue;
      layer = textures[i] as number;
      const range = atlas.msdfRanges[layer];
      if (range === undefined || layer >= atlas.layers) continue;
      mode = UI_MODE.glyph;
      const atlasPx = (a1 - a0) * atlas.width;
      d2 = atlasPx > 0 ? Math.max(1, (range * w * pxScale) / atlasPx) : 1;
    } else if (op === DRAW_OP.sprite) {
      if (!atlas) continue;
      layer = atlas.spriteBase + (textures[i] as number);
      if (layer >= atlas.layers) continue;
      mode = UI_MODE.sprite;
    } else continue;

    // Recorte na CPU: corta o quad e interpola uv/coordenada local na mesma proporção.
    const x0 = Math.max(x, cx0);
    const y0 = Math.max(y, cy0);
    const x1 = Math.min(x + w, cx1);
    const y1 = Math.min(y + h, cy1);
    if (x1 <= x0 || y1 <= y0) continue;
    let u0: number;
    let v0: number;
    let u1: number;
    let v1: number;
    if (mode === UI_MODE.rect) {
      u0 = x0 - x;
      v0 = y0 - y;
      u1 = x1 - x;
      v1 = y1 - y;
    } else {
      const du = (a1 - a0) / w;
      const dv = (b1 - b0) / h;
      u0 = a0 + (x0 - x) * du;
      u1 = a0 + (x1 - x) * du;
      v0 = b0 + (y0 - y) * dv;
      v1 = b0 + (y1 - y) * dv;
    }

    const o = quads * 4 * UI_FLOATS_PER_VERTEX;
    writeVertex(v, o, x0, y0, u0, v0, mode, layer, d2, d3, e0, e1, e2);
    writeVertex(v, o + UI_FLOATS_PER_VERTEX, x1, y0, u1, v0, mode, layer, d2, d3, e0, e1, e2);
    writeVertex(v, o + UI_FLOATS_PER_VERTEX * 2, x0, y1, u0, v1, mode, layer, d2, d3, e0, e1, e2);
    writeVertex(v, o + UI_FLOATS_PER_VERTEX * 3, x1, y1, u1, v1, mode, layer, d2, d3, e0, e1, e2);
    const color = cmdColors[i] as number;
    const co = quads * 16;
    for (let k = 0; k < 4; k++) {
      c[co + k * 4] = color >>> 24;
      c[co + k * 4 + 1] = (color >>> 16) & 0xff;
      c[co + k * 4 + 2] = (color >>> 8) & 0xff;
      c[co + k * 4 + 3] = color & 0xff;
    }
    quads++;
  }
  batch.quads = quads;
  return quads;
}
