// Prévia do pintor do boneco do FutBobo (decisão #56; PLANO do porte §B19): as 2 camadas da skin a 4× (com o nível 1),
// a frente e as costas dos 12 looks prontos (sem time e nos times A e B) e os 8 rostos de zumbi. Só para revisão,
// gravada em local/skins/ (privado, fora do git); não vai para o jogo nem para o `assets:check`.
//
// O boneco é montado como o render R4c monta (PLANO §B7): as caixas do gabarito no espaço do osso, o cubo do
// `addTexturedBox` (cruz `boxCrossRects` + `SKIN_FACE_AXES`) girado Ry(π), medidas de UV 0 lendo o centro do texel e a
// frente da cabeça (flag `face`) na célula da expressão. Os ossos saem do `figureFk` com a raiz `figureRoot`.
import {
  boxCrossRects,
  buildFigureTemplate,
  FACE_EXPRESSIONS,
  FIGURE_BODY_BOXES,
  FIGURE_BONES,
  FIGURE_BOX_FIELD,
  FIGURE_BOX_FLAG,
  FIGURE_BOX_STRIDE,
  FIGURE_MAX_BOXES,
  FIGURE_PRESETS,
  FIGURE_REST_POSE,
  FIGURE_SKIN_BYTES,
  FIGURE_SKIN_LAYERS,
  FIGURE_SKIN_LEVEL1_BYTES,
  figureFk,
  figureRoot,
  normalizeFigureLook,
  paintFigureSkin,
  SKIN_FACE_AXES,
  type FigureLook,
  type FigurePresetId,
  type FigureSkinRecipe,
  type RgbaImage,
} from '@boboforces/format';
import {
  blit,
  camera,
  clearDepth,
  createTarget,
  drawTri,
  fillRect,
  label,
  targetImage,
  VIEW,
  type Tri,
  type Vec3,
} from './raster.ts';

const BG = 0x4a515c;
const PANEL = 0x3b414a;
const TEXT = 0xe2e0d6;
const MUTED = 0xa6a7a5;
/** Cores dos times A e B (`ui/tokens.ts`), em RGB. */
export const PREVIEW_TEAMS: readonly number[] = [0xff7a1a, 0x2e8bff];
/** Ordem da prévia: as 4 prontas e os 8 visuais do teste. */
export const PREVIEW_LOOKS: readonly FigurePresetId[] = [
  'recruit',
  'mechanic',
  'pilot',
  'zombie',
  'classico',
  'blackpower',
  'sardento',
  'dreads',
  'bandana',
  'moicano',
  'barbudo',
  'trancas',
  // M2 (fase 6d): as fantasias do Meu Bobo (#62).
  'astronaut',
  'pajamas',
  'cardboard',
  'diver',
];

/** A skin pintada: as 2 camadas 64×64 e o nível 1 (32×32 por camada). */
export interface PaintedSkin {
  readonly layers: readonly RgbaImage[];
  readonly level1: readonly RgbaImage[];
}

export function paintPreviewSkin(recipe: FigureSkinRecipe): PaintedSkin {
  const out = new Uint8Array(FIGURE_SKIN_BYTES);
  const l1 = new Uint8Array(FIGURE_SKIN_LEVEL1_BYTES);
  paintFigureSkin(recipe, out, l1);
  const layers: RgbaImage[] = [];
  const level1: RgbaImage[] = [];
  for (let k = 0; k < FIGURE_SKIN_LAYERS; k++) {
    layers.push({ width: 64, height: 64, data: out.subarray(k * 16384, (k + 1) * 16384) });
    level1.push({ width: 32, height: 32, data: l1.subarray(k * 4096, (k + 1) * 4096) });
  }
  return { layers, level1 };
}

/** Normal de cada face na ordem de `FACE` (+X, −X, +Y, −Y, +Z, −Z), no espaço da caixa do BF. */
const FACE_NORMALS: readonly Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
const FRONT_FACE = 5;

/** Gabarito do look: o do `buildFigureTemplate` (com o cabelo da F1, quando houver) ou só as 14 caixas do corpo. */
export function previewTemplate(look: FigureLook): { boxes: Float32Array; count: number; hair: boolean } {
  const boxes = new Float32Array(FIGURE_MAX_BOXES * FIGURE_BOX_STRIDE);
  try {
    const count = buildFigureTemplate(look, boxes, 0);
    return { boxes, count, hair: count > FIGURE_BODY_BOXES.length / FIGURE_BOX_STRIDE };
  } catch {
    boxes.set(FIGURE_BODY_BOXES);
    return { boxes, count: FIGURE_BODY_BOXES.length / FIGURE_BOX_STRIDE, hair: false };
  }
}

/** Matrizes dos 12 ossos (coluna-maior, metros) na pose de repouso, com a raiz em (0, 0, 0) e o `yaw` dado. */
export function restBones(yaw: number, scale = 1): Float32Array {
  const root = new Float32Array(16);
  figureRoot(root, 0, 0, 0, 0, yaw, scale, 0);
  const bones = new Float32Array(FIGURE_BONES * 16);
  figureFk(FIGURE_REST_POSE, 0, root, 0, bones, 0);
  return bones;
}

/**
 * Triângulos do boneco (metros, sola em y = 0, frente para −Z com yaw 0) com a skin dada. `expression` escolhe a
 * célula do rosto (ordem de `FACE_EXPRESSIONS`).
 */
export function figureTris(
  skin: PaintedSkin,
  look: FigureLook,
  expression: number,
  bones: Float32Array,
  offset: Vec3 = [0, 0, 0],
): Tri[] {
  const F = FIGURE_BOX_FIELD;
  const { boxes, count } = previewTemplate(look);
  const out: Tri[] = [];
  for (let i = 0; i < count; i++) {
    const o = i * FIGURE_BOX_STRIDE;
    const b = boxes[o + F.bone]! * 16;
    const m = (r: number, c: number): number => bones[b + c * 4 + r]!;
    const c: Vec3 = [boxes[o + F.cx]!, boxes[o + F.cy]!, boxes[o + F.cz]!];
    const s: Vec3 = [boxes[o + F.sx]!, boxes[o + F.sy]!, boxes[o + F.sz]!];
    const rx = boxes[o + F.rotX]!;
    const rz = boxes[o + F.rotZ]!;
    const layer = boxes[o + F.layer]!;
    const flags = boxes[o + F.flags]!;
    const rects = boxCrossRects(boxes[o + F.u]!, boxes[o + F.v]!, boxes[o + F.w]!, boxes[o + F.h]!, boxes[o + F.d]!);
    const tex = skin.layers[layer]!;
    // Canto do cubo unitário do BF → Ry(π) → medida → giro próprio (Rx·Rz) → centro → osso → mundo.
    const world = (p: Vec3): Vec3 => {
      let x = -p[0] * s[0];
      let y = p[1] * s[1];
      let z = -p[2] * s[2];
      if (rz !== 0) [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
      if (rx !== 0) [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
      x += c[0];
      y += c[1];
      z += c[2];
      return [
        m(0, 0) * x + m(0, 1) * y + m(0, 2) * z + m(0, 3) + offset[0],
        m(1, 0) * x + m(1, 1) * y + m(1, 2) * z + m(1, 3) + offset[1],
        m(2, 0) * x + m(2, 1) * y + m(2, 2) * z + m(2, 3) + offset[2],
      ];
    };
    for (let f = 0; f < 6; f++) {
      const n = FACE_NORMALS[f]!;
      const axes = SKIN_FACE_AXES[f]!;
      const r = rects[f]!;
      let u0 = r.u;
      let v0 = r.v;
      if (f === FRONT_FACE && (flags & FIGURE_BOX_FLAG.face) !== 0) {
        u0 += 16 * (expression & 3) - 16;
        v0 += 32 + 16 * (expression >> 2) - 16;
      }
      const corner = (a: number, bb: number): Vec3 =>
        world([
          n[0] * 0.5 + axes.u[0] * (a - 0.5) + axes.v[0] * (bb - 0.5),
          n[1] * 0.5 + axes.u[1] * (a - 0.5) + axes.v[1] * (bb - 0.5),
          n[2] * 0.5 + axes.u[2] * (a - 0.5) + axes.v[2] * (bb - 0.5),
        ]);
      // Medida 0: o VS soma 0,5 e lê o centro do texel.
      const uv = (a: number, bb: number): [number, number] => [
        r.w === 0 ? u0 + 0.5 : u0 + a * r.w,
        r.h === 0 ? v0 + 0.5 : v0 + bb * r.h,
      ];
      const p = [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)] as const;
      const t = [uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)] as const;
      out.push({ p: [p[0], p[1], p[2]], uv: [t[0], t[1], t[2]], tex });
      out.push({ p: [p[0], p[2], p[3]], uv: [t[0], t[2], t[3]], tex });
    }
  }
  return out;
}

/** Desenha o boneco numa vista ortográfica (`scale` px/m) com a sola em (sx, sy). */
function drawFigure(
  t: ReturnType<typeof createTarget>,
  tris: readonly Tri[],
  dir: Vec3,
  scale: number,
  sx: number,
  sy: number,
): void {
  clearDepth(t);
  const cam = camera(dir, scale, sx, sy);
  for (const tri of tris) drawTri(t, cam, tri);
}

/** Folha de um look: as 2 camadas a 4× (e o nível 1 a 8×), frente e costas sem time e a frente nos times A e B. */
export function buildLookSheet(id: FigurePresetId): RgbaImage {
  const look = FIGURE_PRESETS[id];
  const t = createTarget(1640, 600, BG);
  label(t, `${id.toUpperCase()}  (CAMADAS 0 E 1 A 4X; NIVEL 1 A 8X)`, 12, 8, TEXT, 2);
  const skin = paintPreviewSkin({ look, team: -1, teamColors: PREVIEW_TEAMS });
  for (let k = 0; k < FIGURE_SKIN_LAYERS; k++) {
    blit(t, skin.layers[k]!, 12 + k * 268, 30, 4);
    blit(t, skin.level1[k]!, 12 + k * 268, 30 + 268, 8);
  }
  const bones = restBones(0);
  const scale = (4 * 64) / 1.75;
  const views: { label: string; team: number; dir: Vec3 }[] = [
    { label: 'FRENTE', team: -1, dir: VIEW.front },
    { label: 'COSTAS', team: -1, dir: VIEW.back },
    { label: 'TIME A', team: 0, dir: VIEW.front },
    { label: 'TIME B COSTAS', team: 1, dir: VIEW.back },
  ];
  views.forEach((v, i) => {
    const x0 = 560 + i * 268;
    fillRect(t, x0, 30, 260, 540, PANEL);
    const s = v.team < 0 ? skin : paintPreviewSkin({ look, team: v.team, teamColors: PREVIEW_TEAMS });
    drawFigure(t, figureTris(s, look, 0, bones), v.dir, scale, x0 + 130, 540);
    label(t, v.label, x0 + 6, 36, MUTED, 2);
  });
  return targetImage(t);
}

/** Frente e costas dos 12 looks, lado a lado (sem time; e a frente nos times A e B). */
export function buildFiguresSheet(): RgbaImage {
  const cellW = 132;
  const t = createTarget(12 + PREVIEW_LOOKS.length * cellW, 3 * 250 + 40, BG);
  const bones = restBones(0);
  const scale = (2 * 64) / 1.75;
  PREVIEW_LOOKS.forEach((id, i) => {
    const look = FIGURE_PRESETS[id];
    const x0 = 12 + i * cellW;
    const rows: { team: number; dir: Vec3 }[] = [
      { team: -1, dir: VIEW.front },
      { team: -1, dir: VIEW.back },
      { team: i % 2, dir: VIEW.front },
    ];
    rows.forEach((r, j) => {
      const y0 = 30 + j * 250;
      fillRect(t, x0, y0, cellW - 4, 244, PANEL);
      const skin = paintPreviewSkin({ look, team: r.team, teamColors: PREVIEW_TEAMS });
      drawFigure(t, figureTris(skin, look, 0, bones), r.dir, scale, x0 + (cellW - 4) / 2, y0 + 236);
    });
    label(t, id.toUpperCase(), x0, 12, TEXT, 1);
  });
  return targetImage(t);
}

/** Os 8 estilos de rosto de zumbi (linhas) × as 8 expressões (colunas), a 4×, e o zumbi de frente e de costas. */
export function buildZombieSheet(): RgbaImage {
  const t = createTarget(12 + 8 * 68 + 300, 40 + 8 * 68, BG);
  label(t, 'ZUMBI: ESTILO (LINHA) X EXPRESSAO (COLUNA)', 12, 8, TEXT, 2);
  FACE_EXPRESSIONS.forEach((e, k) => label(t, e, 12 + k * 68, 30, MUTED, 1));
  const base = FIGURE_PRESETS.zombie;
  for (let style = 0; style < 8; style++) {
    const look = normalizeFigureLook({ ...base, zombie: { kind: 'common', faceStyle: style } });
    const skin = paintPreviewSkin({ look, team: -1, teamColors: [] });
    const cells = skin.layers[0]!;
    for (let e = 0; e < 8; e++) {
      const cell: RgbaImage = { width: 16, height: 16, data: cropCell(cells, 16 * (e & 3), 32 + 16 * (e >> 2)) };
      blit(t, cell, 12 + e * 68, 40 + style * 68, 4);
    }
  }
  const bones = restBones(0);
  const skin = paintPreviewSkin({ look: base, team: -1, teamColors: [] });
  const tris = figureTris(skin, base, 2, bones);
  fillRect(t, 12 + 8 * 68, 40, 140, 300, PANEL);
  drawFigure(t, tris, VIEW.front, (2 * 64) / 1.75, 12 + 8 * 68 + 70, 330);
  fillRect(t, 12 + 8 * 68 + 148, 40, 140, 300, PANEL);
  drawFigure(t, tris, VIEW.back, (2 * 64) / 1.75, 12 + 8 * 68 + 218, 330);
  return targetImage(t);
}

function cropCell(layer: RgbaImage, u: number, v: number): Uint8Array {
  const out = new Uint8Array(16 * 16 * 4);
  for (let y = 0; y < 16; y++)
    out.set(layer.data.subarray(((v + y) * 64 + u) * 4, ((v + y) * 64 + u + 16) * 4), y * 64);
  return out;
}

/** O boneco de repouso (recruta sem time) para a escala de outras folhas (`modelgen`): triângulos em metros. */
export function referenceFigureTris(id: FigurePresetId = 'recruit', offset: Vec3 = [0, 0, 0]): Tri[] {
  const look = FIGURE_PRESETS[id];
  const skin = paintPreviewSkin({ look, team: -1, teamColors: [] });
  return figureTris(skin, look, 0, restBones(0), offset);
}
