// Folha de contato dos modelos (local/m1/modelos.png): armas em isométrica e de lado, a silhueta lateral em escala
// real (32 px/m: o teste de "reconhece em 1 s" da arte-ux.md §12), as props com o boneco do FutBobo de 1,75 m ao
// lado para escala (o recruta, com o gabarito e o pintor novos: decisões #55 e #56), os colisores em arame e as camadas
// de textura. Só para revisão.
import {
  MODEL_FLAG,
  MODEL_TEXELS_PER_METER,
  modelTriangleCount,
  type ModelDocument,
  type RgbaImage,
} from '@boboforces/format';
import { boxTris } from '../../skingen/src/box-mesh.ts';
import { referenceFigureTris } from '../../skingen/src/figure-preview.ts';
import {
  blit,
  camera,
  checker,
  clearDepth,
  createTarget,
  drawTri,
  fillRect,
  label,
  targetImage,
  VIEW,
  type Target,
  type Tri,
  type Vec3,
} from '../../skingen/src/raster.ts';
import type { StripLayer } from '../../skingen/src/strip.ts';
import type { BuiltModel } from './builder.ts';

const BG = 0x4a515c;
const PANEL = 0x3b414a;
const TEXT = 0xe2e0d6;
const MUTED = 0xa6a7a5;
const UNIT = 1 / MODEL_TEXELS_PER_METER;

/** Triângulos do modelo em metros (pivôs somados pela hierarquia; camada emissiva sem luz). */
export function modelTris(
  doc: ModelDocument,
  layers: ReadonlyMap<string, StripLayer>,
  offset: Vec3 = [0, 0, 0],
): Tri[] {
  const out: Tri[] = [];
  const pivots: Vec3[] = [];
  doc.parts.forEach((part) => {
    const base = part.parent >= 0 ? pivots[part.parent]! : ([0, 0, 0] as Vec3);
    const pivot: Vec3 = [base[0] + part.pivot[0], base[1] + part.pivot[1], base[2] + part.pivot[2]];
    pivots.push(pivot);
    const move = (p: Vec3): Vec3 => [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]];
    for (const box of part.boxes) {
      const layer = layers.get(box.layer);
      const min: Vec3 = [box.origin[0] + pivot[0], box.origin[1] + pivot[1], box.origin[2] + pivot[2]];
      out.push(
        ...boxTris(min, box.size, box.uv, layer?.image ?? null, {
          unit: UNIT,
          inflate: box.inflate,
          mirror: box.mirror,
          transform: move,
          unlit: layer?.kind === 'emissive',
        }),
      );
    }
    for (const mesh of part.meshes) {
      const layer = layers.get(mesh.layer);
      const p = (i: number): Vec3 =>
        move([
          (mesh.positions[i * 3]! + pivot[0]) * UNIT,
          (mesh.positions[i * 3 + 1]! + pivot[1]) * UNIT,
          (mesh.positions[i * 3 + 2]! + pivot[2]) * UNIT,
        ]);
      const uv = (i: number): readonly [number, number] => [mesh.uvs[i * 2]!, mesh.uvs[i * 2 + 1]!];
      for (let t = 0; t < mesh.indices.length; t += 3) {
        const [a, b, c] = [mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!];
        const tri: Tri = { p: [p(a), p(b), p(c)], uv: [uv(a), uv(b), uv(c)], tex: layer?.image ?? null };
        out.push(layer?.kind === 'emissive' ? { ...tri, unlit: true } : tri);
      }
    }
  });
  return out;
}

/** Caixa delimitadora do modelo em metros (dos colisores, ou das caixas nas armas). */
function bounds(doc: ModelDocument): { min: Vec3; max: Vec3 } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const grow = (x: number, y: number, z: number): void => {
    min[0] = Math.min(min[0], x * UNIT);
    min[1] = Math.min(min[1], y * UNIT);
    min[2] = Math.min(min[2], z * UNIT);
    max[0] = Math.max(max[0], x * UNIT);
    max[1] = Math.max(max[1], y * UNIT);
    max[2] = Math.max(max[2], z * UNIT);
  };
  for (const c of doc.colliders) {
    grow(c.min[0], c.min[1], c.min[2]);
    grow(c.max[0], c.max[1], c.max[2]);
  }
  for (const part of doc.parts) {
    for (const b of part.boxes) {
      grow(b.origin[0], b.origin[1], b.origin[2]);
      grow(b.origin[0] + b.size[0], b.origin[1] + b.size[1], b.origin[2] + b.size[2]);
    }
  }
  return { min, max };
}

/** Arame do colisor (12 arestas como triângulos finos de cor sólida, desenhados por cima). */
function colliderWire(t: Target, cam: ReturnType<typeof camera>, doc: ModelDocument, offset: Vec3): void {
  for (const c of doc.colliders) {
    const p = (x: number, y: number, z: number): Vec3 => [
      x * UNIT + offset[0],
      y * UNIT + offset[1],
      z * UNIT + offset[2],
    ];
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
      p(i & 1 ? c.max[0] : c.min[0], i & 2 ? c.max[1] : c.min[1], i & 4 ? c.max[2] : c.min[2]),
    );
    for (let a = 0; a < 8; a++) {
      for (const bit of [1, 2, 4]) {
        if (a & bit) continue;
        const pa = corners[a]!;
        const pb = corners[a | bit]!;
        for (let k = 0; k <= 40; k++) {
          const s = k / 40;
          const q: Vec3 = [pa[0] + (pb[0] - pa[0]) * s, pa[1] + (pb[1] - pa[1]) * s, pa[2] + (pb[2] - pa[2]) * s];
          const x = Math.round(cam.cx + (q[0] * cam.right[0] + q[1] * cam.right[1] + q[2] * cam.right[2]) * cam.scale);
          const y = Math.round(cam.cy - (q[0] * cam.up[0] + q[1] * cam.up[1] + q[2] * cam.up[2]) * cam.scale);
          fillRect(t, x, y, 1, 1, 0xff7a1a);
        }
      }
    }
  }
}

/** Câmera que põe `center` (metros) no ponto (sx, sy) da tela. */
function centered(dir: Vec3, scale: number, center: Vec3, sx: number, sy: number): ReturnType<typeof camera> {
  const c = camera(dir, scale, 0, 0);
  const px = center[0] * c.right[0] + center[1] * c.right[1] + center[2] * c.right[2];
  const py = center[0] * c.up[0] + center[1] * c.up[1] + center[2] * c.up[2];
  return camera(dir, scale, sx - px * scale, sy + py * scale);
}

function flagsText(doc: ModelDocument): string {
  const f = doc.flags;
  const parts: string[] = [];
  if (f & MODEL_FLAG.blocksBullets) parts.push('bala');
  if (f & MODEL_FLAG.partialSight) parts.push('visao parcial');
  else if (f & MODEL_FLAG.blocksSight) parts.push('visao');
  if (f & MODEL_FLAG.walkable) parts.push('andavel');
  if (f & MODEL_FLAG.emissive) parts.push(`luz ${doc.light?.level ?? 0}`);
  if (f & MODEL_FLAG.swaysInWind) parts.push('vento');
  if (doc.blocksNav) parts.push('nav');
  return parts.join(' ');
}

export function buildModelsSheet(
  models: readonly BuiltModel[],
  pending: readonly BuiltModel[],
  layers: readonly StripLayer[],
): RgbaImage {
  const byName = new Map<string, StripLayer>(layers.map((l) => [l.name, l]));
  for (const m of pending)
    for (const l of m.layers) byName.set(l.name, { name: l.name, kind: l.kind, cutout: false, image: l.image });
  const figure = referenceFigureTris('recruit');
  const t = createTarget(1600, 1500, BG);
  let y = 10;

  // 1. Armas: iso e lado em escala grande, e a silhueta em escala real (1 texel = 1 px), ampliada 4×.
  label(t, 'ARMAS (ISO, LADO E SILHUETA REAL 32 PX/M AMPLIADA 4X)', 12, y, TEXT, 2);
  y += 20;
  const weapons = models.filter((m) => m.doc.kind === 'weapon');
  weapons.forEach((m, i) => {
    const x0 = 12 + i * 528;
    const b = bounds(m.doc);
    const center: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    fillRect(t, x0, y, 520, 200, PANEL);
    const tris = modelTris(m.doc, byName);
    const scale = Math.min(300, 230 / Math.max(0.2, b.max[2] - b.min[2]));
    clearDepth(t);
    for (const tri of tris) drawTri(t, centered(VIEW.iso, scale, center, x0 + 130, y + 100), tri);
    clearDepth(t);
    for (const tri of tris) drawTri(t, centered(VIEW.side, scale, center, x0 + 390, y + 100), tri);
    // Silhueta em escala real (1 texel = 1 px), ampliada 4×.
    const sil = createTarget(64, 24, 0xe2e0d6);
    const sc = centered(VIEW.side, MODEL_TEXELS_PER_METER, center, 32, 12);
    for (const tri of tris) drawTri(sil, sc, { ...tri, tex: null, color: 0x2c2f3b, unlit: true });
    blit(t, targetImage(sil), x0, y + 206, 4);
    label(t, m.doc.id, x0 + 264, y + 214, TEXT, 2);
    label(t, `${modelTriangleCount(m.doc)} tri`, x0 + 264, y + 234, MUTED, 1);
    label(t, `pecas ${m.doc.parts.map((p) => p.name).join(' ')}`, x0 + 264, y + 246, MUTED, 1);
    label(t, `soquetes ${m.doc.sockets.map((s) => s.name).join(' ')}`, x0 + 264, y + 258, MUTED, 1);
  });
  y += 300;

  // 2. Props com o boneco de 1,75 m (decisão #55) ao lado e o colisor em arame laranja.
  label(t, 'PROPS (BOBO DE 1,75 M PARA ESCALA; COLISOR EM LARANJA)', 12, y, TEXT, 2);
  y += 20;
  const props = [...models.filter((m) => m.doc.kind !== 'weapon'), ...pending];
  const cellW = 260;
  const cellH = 300;
  props.forEach((m, i) => {
    const col = i % 6;
    const row = Math.floor(i / 6);
    const x0 = 12 + col * (cellW + 4);
    const y0 = y + row * (cellH + 40);
    fillRect(t, x0, y0, cellW, cellH, PANEL);
    const b = bounds(m.doc);
    const span = Math.max(b.max[0] - b.min[0] + 1.2, b.max[1] - b.min[1], b.max[2] - b.min[2]);
    const scale = Math.min(95, (cellH - 50) / span);
    const cam = camera(VIEW.iso, scale, x0 + cellW / 2 + 0.3 * scale, y0 + cellH - 40);
    clearDepth(t);
    for (const tri of modelTris(m.doc, byName)) drawTri(t, cam, tri);
    const boboAt: Vec3 = [b.min[0] - 0.6, 0, 0];
    for (const tri of figure) {
      drawTri(t, cam, {
        ...tri,
        p: tri.p.map((p) => [p[0] + boboAt[0], p[1], p[2] + boboAt[2]] as Vec3) as unknown as Tri['p'],
      });
    }
    colliderWire(t, cam, m.doc, [0, 0, 0]);
    const isPending = pending.includes(m);
    label(t, m.doc.id + (isPending ? ' (id pendente)' : ''), x0 + 4, y0 + cellH + 4, isPending ? 0xe0985a : TEXT, 1);
    label(t, `${modelTriangleCount(m.doc)} tri  ${flagsText(m.doc)}`, x0 + 4, y0 + cellH + 14, MUTED, 1);
  });
  y += Math.ceil(props.length / 6) * (cellH + 40) + 10;

  // 3. Camadas de textura (tira modelos64-modelos), ampliadas 2×.
  label(t, 'CAMADAS (MODELOS64-MODELOS) 2X', 12, y, TEXT, 2);
  y += 20;
  const all = [...layers, ...pending.flatMap((m) => m.layers.map((l) => byName.get(l.name)!))];
  all.forEach((l, i) => {
    const x0 = 12 + (i % 11) * 144;
    const y0 = y + Math.floor(i / 11) * 150;
    checker(t, x0, y0, 128, 128, 4);
    blit(t, l.image, x0, y0, 2);
    label(t, l.name, x0, y0 + 132, MUTED, 1);
  });
  return targetImage(t);
}
