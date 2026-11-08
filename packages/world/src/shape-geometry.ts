import { NORMAL_TABLE } from './mesh/vertex.ts';
import {
  SHAPE_COUNT,
  SHAPE_ID,
  shapeCollision,
  shapeCollisionBoxes,
  shapeCoveredFaces,
  shapeFaceSource,
  shapeVisualBoxes,
} from './shapes.ts';

/**
 * Geometria das formas pré-calculada por FORMA × ORIENTAÇÃO (`so = forma · 8 + orientação`, 96 entradas), a partir das
 * tabelas e fórmulas do contrato (`shapes.ts`). É o que colisão, raio e mesher leem no laço quente: typed arrays fixos,
 * montados uma vez no carregamento do módulo (determinístico, sem relógio).
 *
 * Unidades: a colisão e o raio usam FRAÇÕES da célula (0..1, subcélulas / 16); o mesher usa subcélulas inteiras (0..16).
 */

export const SO_COUNT = SHAPE_COUNT * 8;

/** Índice forma × orientação. */
export function shapeOrientation(shape: number, orientation: number): number {
  return shape * 8 + (orientation & 7);
}

/** Bits de face (1 << FACE) e a face oposta. */
export const OPPOSITE_FACE = [1, 0, 3, 2, 5, 4] as const;

// --- Colisão ---------------------------------------------------------------------------------------------------------

export const COLL_NONE = 0;
/** Cubo cheio: caminho rápido (o mesmo do M0). */
export const COLL_CUBE = 1;
export const COLL_BOXES = 2;
/** Piso inclinado (rampas em pé): sólido abaixo de `h(fx, fz)`. */
export const COLL_SLOPE = 3;

export const SO_COLL_KIND = new Uint8Array(SO_COUNT);
export const SO_COLL_COUNT = new Uint8Array(SO_COUNT);
/** Até 2 caixas × 6 (minX, minY, minZ, maxX, maxY, maxZ), em frações da célula. */
export const SO_COLL_BOXES = new Float64Array(SO_COUNT * 12);
/**
 * O degrau automático pode pousar em cima? Formas finas (painel, poste + travessa) não: cerca de 1 célula bloqueia o
 * passo (tecnico.md §5.2, "bloqueia" na navegação). Pular em cima continua possível (é caixa).
 */
export const SO_STEPPABLE = new Uint8Array(SO_COUNT);

/**
 * Piso inclinado: até 2 peças lineares `h = a + bx·fx + bz·fz` (frações) combinadas por `SO_SLOPE_OP`
 * (0 = só a peça 0, 1 = máximo, 2 = mínimo). Cada peça depende de UM eixo só (as quinas combinam um plano em X e outro
 * em Z), o que deixa o máximo num retângulo e o ponto de contato com conta fechada.
 */
export const SLOPE_SINGLE = 0;
export const SLOPE_MAX = 1;
export const SLOPE_MIN = 2;
export const SO_SLOPE_OP = new Uint8Array(SO_COUNT);
/** [a0, bx0, bz0, a1, bx1, bz1] por `so`. Também vale para as rampas invertidas (o raio usa; a colisão é cubo). */
export const SO_SLOPE = new Float64Array(SO_COUNT * 6);

/** Máximo de `h` no retângulo [x0, x1] × [z0, z1] (frações). */
export function slopeMaxInRect(so: number, x0: number, x1: number, z0: number, z1: number): number {
  const o = so * 6;
  const bx0 = SO_SLOPE[o + 1]!;
  const bz0 = SO_SLOPE[o + 2]!;
  const p0 = SO_SLOPE[o]! + (bx0 > 0 ? bx0 * x1 : bx0 * x0) + (bz0 > 0 ? bz0 * z1 : bz0 * z0);
  const op = SO_SLOPE_OP[so]!;
  if (op === SLOPE_SINGLE) return p0;
  const bx1 = SO_SLOPE[o + 4]!;
  const bz1 = SO_SLOPE[o + 5]!;
  const p1 = SO_SLOPE[o + 3]! + (bx1 > 0 ? bx1 * x1 : bx1 * x0) + (bz1 > 0 ? bz1 * z1 : bz1 * z0);
  return op === SLOPE_MAX ? (p0 > p1 ? p0 : p1) : p0 < p1 ? p0 : p1;
}

// --- Raio -------------------------------------------------------------------------------------------------------------

export const RAY_NONE = 0;
export const RAY_CUBE = 1;
export const RAY_BOXES = 2;
/** Partes convexas: caixa da célula ∩ até 2 semiespaços (rampas, em pé ou invertidas). */
export const RAY_PARTS = 3;
/** Dois planos diagonais sem espessura (cruz). */
export const RAY_CROSS = 4;

export const SO_RAY_KIND = new Uint8Array(SO_COUNT);
export const SO_RAY_COUNT = new Uint8Array(SO_COUNT);
/** Caixas do raio (até 3 × 6, frações): as de colisão, exceto o poste + travessa, que usa as visuais (bala passa no vão). */
export const SO_RAY_BOXES = new Float64Array(SO_COUNT * 18);
/** Por parte (até 2): quantos semiespaços (1 ou 2). */
export const SO_RAY_PLANE_COUNT = new Uint8Array(SO_COUNT * 2);
/** Semiespaço `n·p ≤ c` (p em frações da célula): [nx, ny, nz, c, índice da normal] por (so, parte, plano). */
export const SO_RAY_PLANES = new Float64Array(SO_COUNT * 2 * 2 * 5);

// --- Malha ------------------------------------------------------------------------------------------------------------

/** Sem face cheia nesta direção (`SO_FULL_OFF`). */
export const NO_FULL_FACE = 255;
/**
 * Face CHEIA (quadrado 16×16 alinhado ao eixo) por `so` × direção de mundo: deslocamento do plano em subcélulas dentro
 * da célula (0..16) ou `NO_FULL_FACE`. É o que o greedy funde (cubo, fundo de laje, costas de rampa, topo de laje, as
 * duas faces largas do painel). No máximo uma por direção.
 */
export const SO_FULL_OFF = new Uint8Array(SO_COUNT * 6).fill(NO_FULL_FACE);
/** Face de `BlockDef.faces` que dá a textura da face cheia. */
export const SO_FULL_SRC = new Uint8Array(SO_COUNT * 6);

/**
 * Perfil de cada face da célula para descartar faces encostadas: 0 = nada da forma encosta nesta face, 1 = cobre a
 * face inteira (`shapeCoveredFaces`), ≥ 2 = desenho parcial (dois desenhos iguais frente a frente se escondem: fim de
 * painel com painel, laje com laje, travessa com travessa).
 */
export const PROFILE_NONE = 0;
export const PROFILE_FULL = 1;
export const SO_PROFILE = new Uint8Array(SO_COUNT * 6);

/** Polígonos que NÃO vão pelo greedy (faces parciais, planos inclinados, cruz), por `so`. */
export const SO_POLY_START = new Uint16Array(SO_COUNT);
export const SO_POLY_COUNT = new Uint8Array(SO_COUNT);
/** 3 ou 4 vértices. */
export let POLY_NVERT = new Uint8Array(0);
/** 4 × (x, y, z) em subcélulas (0..16), em ordem anti-horária vista de fora. */
export let POLY_VERTS = new Uint8Array(0);
export let POLY_NORMAL = new Uint8Array(0);
/** Face de `BlockDef.faces` da textura. */
export let POLY_SRC = new Uint8Array(0);
/** Face da célula em que o polígono está deitado (descarte contra o vizinho), ou -1 (dentro da célula). */
export let POLY_BOUNDARY = new Int8Array(0);
/** Direção de eixo para o AO e a luz suave (face de mundo), ou -1 (cruz: luz da própria célula, sem AO). */
export let POLY_AODIR = new Int8Array(0);
/** Bit por vértice: vértice de cima da cruz (`REGION_VERTEX_FLAG.top`). */
export let POLY_TOP = new Uint8Array(0);

// ---------------------------------------------------------------------------------------------------------------------
// Montagem das tabelas
// ---------------------------------------------------------------------------------------------------------------------

type V3 = readonly [number, number, number];

interface CanonPoly {
  /** Vértices em ordem cíclica (subcélulas). */
  readonly verts: readonly V3[];
  /** Normal para fora (não precisa ser unitária). */
  readonly normal: V3;
  /** Face de `BlockDef.faces` (faces de eixo: a face canônica; inclinadas: -1 = regra de `shapeFaceSource`). */
  readonly src: number;
}

const AXIS_NORMALS: readonly V3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** Retângulo no plano de eixo `face` (coordenada `plane`), cobrindo [a0, a1] × [b0, b1] nos outros dois eixos. */
function rect(face: number, plane: number, a0: number, a1: number, b0: number, b1: number): CanonPoly {
  const axis = face >> 1;
  const ua = (axis + 1) % 3;
  const va = (axis + 2) % 3;
  const corners: [number, number][] = [
    [a0, b0],
    [a1, b0],
    [a1, b1],
    [a0, b1],
  ];
  const verts = corners.map(([a, b]) => {
    const p: [number, number, number] = [0, 0, 0];
    p[axis] = plane;
    p[ua] = a;
    p[va] = b;
    return p as V3;
  });
  return { verts, normal: AXIS_NORMALS[face]!, src: face };
}

/** As faces de uma caixa (subcélulas), menos as de `omit` (bits por face). Eixos u/v como `rect`: (y,z), (z,x), (x,y). */
function boxFaces(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, omit = 0): CanonPoly[] {
  const out: CanonPoly[] = [];
  if (!(omit & 1)) out.push(rect(0, x1, y0, y1, z0, z1));
  if (!(omit & 2)) out.push(rect(1, x0, y0, y1, z0, z1));
  if (!(omit & 4)) out.push(rect(2, y1, z0, z1, x0, x1));
  if (!(omit & 8)) out.push(rect(3, y0, z0, z1, x0, x1));
  if (!(omit & 16)) out.push(rect(4, z1, x0, x1, y0, y1));
  if (!(omit & 32)) out.push(rect(5, z0, x0, x1, y0, y1));
  return out;
}

function poly(normal: V3, ...verts: V3[]): CanonPoly {
  return { verts, normal, src: -1 };
}

function side(face: number, ...verts: V3[]): CanonPoly {
  return { verts, normal: AXIS_NORMALS[face]!, src: face };
}

/** Polígonos canônicos (giro 0, sem inversão) de cada forma. Ver a tabela do topo de `shapes.ts`. */
function canonicalPolys(shape: number): CanonPoly[] {
  switch (shape) {
    case SHAPE_ID.cube:
      return boxFaces(0, 0, 0, 16, 16, 16);
    case SHAPE_ID.slab:
      return boxFaces(0, 0, 0, 16, 8, 16);
    case SHAPE_ID.step:
      return [
        rect(3, 0, 0, 16, 0, 16), // fundo
        rect(5, 0, 0, 16, 0, 16), // costas (-Z) cheias
        rect(4, 16, 0, 16, 0, 8), // frente de baixo
        rect(4, 8, 0, 16, 8, 16), // frente de cima (dentro da célula)
        rect(2, 8, 8, 16, 0, 16), // topo de baixo (z 8..16)
        rect(2, 16, 0, 8, 0, 16), // topo de cima (z 0..8)
        rect(0, 16, 0, 8, 0, 16), // lados: parte baixa inteira…
        rect(0, 16, 8, 16, 0, 8), // …e parte alta nas costas
        rect(1, 0, 0, 8, 0, 16),
        rect(1, 0, 8, 16, 0, 8),
      ];
    case SHAPE_ID.ramp:
      return [
        rect(3, 0, 0, 16, 0, 16),
        rect(5, 0, 0, 16, 0, 16),
        poly([0, 1, 1], [0, 16, 0], [16, 16, 0], [16, 0, 16], [0, 0, 16]),
        side(0, [16, 0, 0], [16, 16, 0], [16, 0, 16]),
        side(1, [0, 0, 0], [0, 16, 0], [0, 0, 16]),
      ];
    case SHAPE_ID.rampHalfLow:
      return [
        rect(3, 0, 0, 16, 0, 16),
        rect(5, 0, 0, 16, 0, 8),
        poly([0, 2, 1], [0, 8, 0], [16, 8, 0], [16, 0, 16], [0, 0, 16]),
        side(0, [16, 0, 0], [16, 8, 0], [16, 0, 16]),
        side(1, [0, 0, 0], [0, 8, 0], [0, 0, 16]),
      ];
    case SHAPE_ID.rampHalfHigh:
      return [
        rect(3, 0, 0, 16, 0, 16),
        rect(5, 0, 0, 16, 0, 16),
        rect(4, 16, 0, 16, 0, 8),
        poly([0, 2, 1], [0, 16, 0], [16, 16, 0], [16, 8, 16], [0, 8, 16]),
        side(0, [16, 0, 0], [16, 16, 0], [16, 8, 16], [16, 0, 16]),
        side(1, [0, 0, 0], [0, 16, 0], [0, 8, 16], [0, 0, 16]),
      ];
    case SHAPE_ID.rampCornerIn:
      return [
        rect(3, 0, 0, 16, 0, 16),
        rect(5, 0, 0, 16, 0, 16),
        rect(1, 0, 0, 16, 0, 16),
        poly([0, 1, 1], [0, 16, 0], [16, 16, 0], [16, 0, 16]), // z ≤ x: piso 16 − z
        poly([1, 1, 0], [0, 16, 0], [16, 0, 16], [0, 16, 16]), // x ≤ z: piso 16 − x
        side(0, [16, 0, 0], [16, 16, 0], [16, 0, 16]),
        side(4, [0, 0, 16], [0, 16, 16], [16, 0, 16]),
      ];
    case SHAPE_ID.rampCornerOut:
      return [
        rect(3, 0, 0, 16, 0, 16),
        poly([0, 1, 1], [0, 16, 0], [16, 0, 16], [0, 0, 16]), // z ≥ x: piso 16 − z
        poly([1, 1, 0], [0, 16, 0], [16, 0, 0], [16, 0, 16]), // x ≥ z: piso 16 − x
        side(5, [0, 0, 0], [0, 16, 0], [16, 0, 0]),
        side(1, [0, 0, 0], [0, 16, 0], [0, 0, 16]),
      ];
    case SHAPE_ID.panel:
      return boxFaces(0, 0, 7, 16, 16, 9);
    case SHAPE_ID.postRail:
      // Poste inteiro e as travessas cortadas em volta dele (sem face escondida dentro do poste).
      return [
        ...boxFaces(6, 0, 6, 10, 16, 10),
        ...boxFaces(0, 4, 7, 6, 7, 9, 1),
        ...boxFaces(10, 4, 7, 16, 7, 9, 2),
        ...boxFaces(0, 11, 7, 6, 14, 9, 1),
        ...boxFaces(10, 11, 7, 16, 14, 9, 2),
      ];
    case SHAPE_ID.cross: {
      const a: V3[] = [
        [0, 0, 0],
        [16, 0, 16],
        [16, 16, 16],
        [0, 16, 0],
      ];
      const b: V3[] = [
        [16, 0, 0],
        [0, 0, 16],
        [0, 16, 16],
        [16, 16, 0],
      ];
      // Dupla face: cada diagonal sai nos dois sentidos (a cruz não tem verso).
      return [
        { verts: a, normal: [1, 0, -1], src: 0 },
        { verts: a, normal: [-1, 0, 1], src: 0 },
        { verts: b, normal: [1, 0, 1], src: 0 },
        { verts: b, normal: [-1, 0, -1], src: 0 },
      ];
    }
    default:
      return [];
  }
}

/** Ponto em subcélulas: inversão em Y e depois giros anti-horários vistos de cima: (x, z) → (z, 16 − x). */
function orientPoint(p: V3, orientation: number): [number, number, number] {
  let x = p[0];
  let y = p[1];
  let z = p[2];
  if (orientation & 4) y = 16 - y;
  for (let r = orientation & 3; r > 0; r--) {
    const nx = z;
    z = 16 - x;
    x = nx;
  }
  return [x, y, z];
}

/** Vetor: inversão nega Y; giro (x, z) → (z, −x). */
function orientVector(v: V3, orientation: number): [number, number, number] {
  let x = v[0];
  let y = v[1];
  let z = v[2];
  if (orientation & 4) y = -y;
  for (let r = orientation & 3; r > 0; r--) {
    const nx = z;
    z = -x;
    x = nx;
  }
  return [x + 0, y + 0, z + 0];
}

function normalIndexOf(v: V3): number {
  const len = Math.hypot(v[0], v[1], v[2]);
  let best = -1;
  let bestDot = 0.999;
  NORMAL_TABLE.forEach((n, i) => {
    const d = (n[0] * v[0] + n[1] * v[1] + n[2] * v[2]) / len;
    if (d > bestDot) {
      bestDot = d;
      best = i;
    }
  });
  if (best < 0) throw new Error(`shape-geometry: normal fora da tabela (${v.join(', ')})`);
  return best;
}

/** Face de eixo em que TODOS os vértices estão (borda da célula), coerente com a normal; -1 se nenhuma. */
function boundaryFaceOf(verts: readonly V3[], normalIndex: number): number {
  if (normalIndex >= 6) return -1;
  const axis = normalIndex >> 1;
  const plane = (normalIndex & 1) === 0 ? 16 : 0;
  return verts.every((p) => p[axis] === plane) ? normalIndex : -1;
}

/** Quadrado cheio 16×16 alinhado ao eixo: devolve o plano (0..16) ou -1. */
function fullSquarePlane(verts: readonly V3[], normalIndex: number): number {
  if (normalIndex >= 6 || verts.length !== 4) return -1;
  const axis = normalIndex >> 1;
  const plane = verts[0]![axis];
  if (!verts.every((p) => p[axis] === plane)) return -1;
  const ua = (axis + 1) % 3;
  const va = (axis + 2) % 3;
  const key = verts
    .map((p) => `${p[ua]},${p[va]}`)
    .sort()
    .join(' ');
  return key === '0,0 0,16 16,0 16,16' ? plane! : -1;
}

/** Garante ordem anti-horária vista de fora (o produto vetorial aponta para a normal). */
function windOutward(verts: [number, number, number][], normal: V3): [number, number, number][] {
  const a = verts[0]!;
  const b = verts[1]!;
  const c = verts[2]!;
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cx = e1[1]! * e2[2]! - e1[2]! * e2[1]!;
  const cy = e1[2]! * e2[0]! - e1[0]! * e2[2]!;
  const cz = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
  return cx * normal[0] + cy * normal[1] + cz * normal[2] < 0 ? verts.slice().reverse() : verts;
}

function build(): void {
  // Colisão.
  const boxes = new Float32Array(18);
  for (let shape = 0; shape < SHAPE_COUNT; shape++) {
    for (let o = 0; o < 8; o++) {
      const so = shapeOrientation(shape, o);
      const kind = shapeCollision(shape as never, o);
      SO_STEPPABLE[so] = shape === SHAPE_ID.panel || shape === SHAPE_ID.postRail ? 0 : 1;
      if (kind === 'slope') {
        SO_COLL_KIND[so] = COLL_SLOPE;
      } else if (kind === 'boxes') {
        const n = shapeCollisionBoxes(shape as never, o, boxes);
        const isCube = n === 1 && [0, 0, 0, 16, 16, 16].every((v, i) => boxes[i] === v);
        SO_COLL_KIND[so] = isCube ? COLL_CUBE : COLL_BOXES;
        SO_COLL_COUNT[so] = n;
        for (let i = 0; i < n * 6; i++) SO_COLL_BOXES[so * 12 + i] = boxes[i]! / 16;
      }
      buildSlope(shape, o, so);
      buildRay(shape, o, so, boxes);
    }
  }
  buildMeshTables();
}

/** Peças canônicas do piso: h = a + cx·xc + cz·zc (frações). */
function canonicalSlopePieces(shape: number): { op: number; pieces: [number, number, number][] } | null {
  switch (shape) {
    case SHAPE_ID.ramp:
      return { op: SLOPE_SINGLE, pieces: [[1, 0, -1]] };
    case SHAPE_ID.rampHalfLow:
      return { op: SLOPE_SINGLE, pieces: [[0.5, 0, -0.5]] };
    case SHAPE_ID.rampHalfHigh:
      return { op: SLOPE_SINGLE, pieces: [[1, 0, -0.5]] };
    case SHAPE_ID.rampCornerIn:
      return {
        op: SLOPE_MAX,
        pieces: [
          [1, 0, -1],
          [1, -1, 0],
        ],
      };
    case SHAPE_ID.rampCornerOut:
      return {
        op: SLOPE_MIN,
        pieces: [
          [1, 0, -1],
          [1, -1, 0],
        ],
      };
    default:
      return null;
  }
}

function buildSlope(shape: number, o: number, so: number): void {
  const canon = canonicalSlopePieces(shape);
  if (!canon) return;
  // Mundo → canônico (o inverso do giro, como em `shapeFloorHeight`): r vezes (x, z) → (1 − z, x), em formas afins.
  let X = [0, 1, 0];
  let Z = [0, 0, 1];
  for (let r = o & 3; r > 0; r--) {
    const nX = [1 - Z[0]!, -Z[1]!, -Z[2]!];
    Z = X;
    X = nX;
  }
  SO_SLOPE_OP[so] = canon.op;
  canon.pieces.forEach(([a, cx, cz], i) => {
    SO_SLOPE[so * 6 + i * 3] = a + cx * X[0]! + cz * Z[0]!;
    SO_SLOPE[so * 6 + i * 3 + 1] = cx * X[1]! + cz * Z[1]! + 0;
    SO_SLOPE[so * 6 + i * 3 + 2] = cx * X[2]! + cz * Z[2]! + 0;
  });
}

function buildRay(shape: number, o: number, so: number, scratch: Float32Array): void {
  if (shape === SHAPE_ID.empty) return;
  if (shape === SHAPE_ID.cross) {
    SO_RAY_KIND[so] = RAY_CROSS;
    return;
  }
  const canon = canonicalSlopePieces(shape);
  if (canon) {
    // Em pé: sólido onde y ≤ h  →  −bx·x + y − bz·z ≤ a. Invertida (espelho em Y): −bx·x − y − bz·z ≤ a − 1.
    const flipped = (o & 4) !== 0;
    const planes: [number, number, number, number][] = [0, 1].slice(0, canon.op === SLOPE_SINGLE ? 1 : 2).map((i) => {
      const a = SO_SLOPE[so * 6 + i * 3]!;
      const bx = SO_SLOPE[so * 6 + i * 3 + 1]!;
      const bz = SO_SLOPE[so * 6 + i * 3 + 2]!;
      return flipped ? [-bx, -1, -bz, a - 1] : [-bx, 1, -bz, a];
    });
    const write = (part: number, list: [number, number, number, number][]): void => {
      SO_RAY_PLANE_COUNT[so * 2 + part] = list.length;
      list.forEach((p, k) => {
        const at = ((so * 2 + part) * 2 + k) * 5;
        SO_RAY_PLANES.set(p, at);
        SO_RAY_PLANES[at + 4] = normalIndexOf([p[0], p[1], p[2]]);
      });
    };
    SO_RAY_KIND[so] = RAY_PARTS;
    if (canon.op === SLOPE_MAX) {
      // União de duas cunhas convexas.
      SO_RAY_COUNT[so] = 2;
      write(0, [planes[0]!]);
      write(1, [planes[1]!]);
    } else {
      // Uma peça, ou a interseção das duas (quina externa): convexo.
      SO_RAY_COUNT[so] = 1;
      write(0, planes);
    }
    return;
  }
  const n =
    shape === SHAPE_ID.postRail
      ? shapeVisualBoxes(shape as never, o, scratch)
      : shapeCollisionBoxes(shape as never, o, scratch);
  const isCube = n === 1 && [0, 0, 0, 16, 16, 16].every((v, i) => scratch[i] === v);
  SO_RAY_KIND[so] = isCube ? RAY_CUBE : RAY_BOXES;
  SO_RAY_COUNT[so] = n;
  for (let i = 0; i < n * 6; i++) SO_RAY_BOXES[so * 18 + i] = scratch[i]! / 16;
}

function buildMeshTables(): void {
  const nvert: number[] = [];
  const verts: number[] = [];
  const normals: number[] = [];
  const srcs: number[] = [];
  const bounds: number[] = [];
  const aoDirs: number[] = [];
  const tops: number[] = [];
  const profileIds = new Map<string, number>();

  for (let shape = 0; shape < SHAPE_COUNT; shape++) {
    const canon = canonicalPolys(shape);
    for (let o = 0; o < 8; o++) {
      const so = shapeOrientation(shape, o);
      const covered = shapeCoveredFaces(shape as never, o);
      const onFace: string[][] = [[], [], [], [], [], []];
      SO_POLY_START[so] = nvert.length;
      for (const cp of canon) {
        const normal = orientVector(cp.normal, o);
        const ni = normalIndexOf(normal);
        const pts = windOutward(
          cp.verts.map((p) => orientPoint(p, o)),
          normal,
        );
        const boundary = boundaryFaceOf(pts, ni);
        // Textura: faces de eixo seguem a face canônica (como o cubo girado do M0); planos inclinados e cruz seguem a
        // regra do contrato (`shapeFaceSource`: py em pé, ny invertida, px na cruz).
        const src = cp.src >= 0 && ni < 6 ? cp.src : shapeFaceSource(ni);
        if (boundary >= 0) {
          const axis = boundary >> 1;
          const ua = (axis + 1) % 3;
          const va = (axis + 2) % 3;
          onFace[boundary]!.push(
            pts
              .map((p) => `${p[ua]},${p[va]}`)
              .sort()
              .join(' '),
          );
        }
        const full = fullSquarePlane(pts, ni);
        if (full >= 0) {
          if (SO_FULL_OFF[so * 6 + ni] !== NO_FULL_FACE) throw new Error('shape-geometry: duas faces cheias');
          SO_FULL_OFF[so * 6 + ni] = full;
          SO_FULL_SRC[so * 6 + ni] = src;
          continue;
        }
        nvert.push(pts.length);
        for (let i = 0; i < 4; i++) {
          const p = pts[Math.min(i, pts.length - 1)]!;
          verts.push(p[0], p[1], p[2]);
        }
        normals.push(ni);
        srcs.push(src);
        bounds.push(boundary);
        aoDirs.push(shape === SHAPE_ID.cross ? -1 : ni < 6 ? ni : normal[1] > 0 ? 2 : 3);
        let top = 0;
        if (shape === SHAPE_ID.cross) pts.forEach((p, i) => (top |= p[1] === 16 ? 1 << i : 0));
        tops.push(top);
      }
      SO_POLY_COUNT[so] = nvert.length - SO_POLY_START[so]!;
      for (let f = 0; f < 6; f++) {
        if ((covered & (1 << f)) !== 0) {
          // Coerência com o contrato: a face coberta é exatamente um quadrado cheio.
          if (onFace[f]!.length !== 1 || onFace[f]![0] !== '0,0 0,16 16,0 16,16') {
            throw new Error(`shape-geometry: forma ${shape} orientação ${o} face ${f} não é cheia`);
          }
          SO_PROFILE[so * 6 + f] = PROFILE_FULL;
        } else if (onFace[f]!.length > 0) {
          const key = onFace[f]!.slice().sort().join(' | ');
          let id = profileIds.get(key);
          if (id === undefined) {
            id = profileIds.size + 2;
            if (id > 255) throw new Error('shape-geometry: perfis demais');
            profileIds.set(key, id);
          }
          SO_PROFILE[so * 6 + f] = id;
        }
      }
    }
  }
  POLY_NVERT = Uint8Array.from(nvert);
  POLY_VERTS = Uint8Array.from(verts);
  POLY_NORMAL = Uint8Array.from(normals);
  POLY_SRC = Uint8Array.from(srcs);
  POLY_BOUNDARY = Int8Array.from(bounds);
  POLY_AODIR = Int8Array.from(aoDirs);
  POLY_TOP = Uint8Array.from(tops);
}

build();
