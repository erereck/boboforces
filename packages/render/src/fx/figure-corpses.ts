// Desmonte dos bonecos do FutBobo (#56, PLANO do porte §B13): 6 corpos Verlet por cadáver (cabeça + cabelo, tronco,
// braço D, braço E, perna D, perna E, pelo `FIGURE_BONE_GROUP`), que nascem do ÚLTIMO quadro do ator: cada corpo começa
// na matriz do osso-raiz do grupo e cada osso que não é raiz guarda `rel = inverso(raiz)·osso` (calculado uma vez), então
// a dobra do cotovelo e do joelho fica. Por quadro: 1 `m4FromQuat` por corpo e 6 multiplicações afins por cadáver
// (antebraço, canela e chuteira dos dois lados); as caixas extras (mãos, cabelo) copiam o osso. As instâncias são as
// mesmas caixas do boneco (cubo do programa 4, `FIGURE_INST`), num draw só para todos. Expressão `dead` na cabeça.
// Sem three, sem alocação depois da criação.
import {
  FACE_EXPRESSION,
  FIGURE_BONE_GROUP,
  FIGURE_BONES,
  FIGURE_BOX_FIELD,
  FIGURE_BOX_STRIDE,
  FIGURE_MAX_BOXES,
  type FigureTemplateSet,
} from '@boboforces/format';
import { writeFigureBoxData } from '../actors/figure-cube.ts';
import { writeFigureRow4 } from '../actors/figure-row4.ts';
import { INSTANCE_FLOATS, NO_SLOT } from '../actors/layout.ts';
import { m4FromQuat, m4Translate, MAT4, orientedHalfExtent, qIntegrate, qNormalize, qSettle } from '../actors/math.ts';
import { verletStep, VERLET_HIT, type CollisionWorld, type VerletParams } from './verlet.ts';

/** Cadáveres simultâneos (o mais antigo é reciclado) e corpos por cadáver. */
export const FIGURE_CORPSES_MAX = 16;
/** Vida do desmonte (decisão #9, arte-ux.md §4.6): some em 4 s, encolhendo no fim. */
export const CORPSE_LIFE_S = 4;
/** Física cosmética dos corpos contra a grade (só leitura). */
export const CORPSE_PHYSICS: VerletParams = { gravity: 15, bounce: 0.3, friction: 5, drag: 0.25 };

/** Gerador de números do desmonte (o render tem RNG próprio: cosmético, fora da sim). */
export interface FxRandom {
  next(): number;
}
export const FIGURE_CORPSE_GROUPS = 6;
/** Osso-raiz de cada grupo (`FIGURE_GROUP`): cabeça, tronco, manga D, manga E, coxa D, coxa E. */
export const FIGURE_GROUP_ROOT: readonly number[] = [0, 1, 2, 3, 6, 7];
const SHRINK_S = 0.35;
const DEAD = FACE_EXPRESSION.dead;
const F = FIGURE_BOX_FIELD;
const BLOCK = FIGURE_MAX_BOXES * FIGURE_BOX_STRIDE;

export interface FigureCorpsePool {
  readonly corpses: number;
  /** Instâncias da malha (cadáveres × `FIGURE_MAX_BOXES`). */
  readonly instances: number;
  readonly matrices: Float32Array;
  readonly data: Float32Array;
  /** Por corpo (cadáver × 6): posição, anterior, giro (quatérnio), giro angular, meias medidas (m) e centro (px). */
  readonly pos: Float32Array;
  readonly prev: Float32Array;
  readonly quat: Float32Array;
  readonly spin: Float32Array;
  readonly half: Float32Array;
  readonly center: Float32Array;
  /** Por cadáver: idade, vivo, m por px (escala do boneco), caixas, luz (céu, sol, emissivo). */
  readonly age: Float32Array;
  readonly alive: Uint8Array;
  readonly unit: Float32Array;
  readonly boxes: Uint8Array;
  readonly light: Float32Array;
  /** Por cadáver: osso de cada caixa e `rel` de cada osso (16 floats; identidade nos ossos-raiz). */
  readonly boxBone: Uint8Array;
  readonly rel: Float32Array;
  /** Matriz de cada corpo no quadro (rascunho). */
  readonly body: Float32Array;
  next: number;
  /** 1 + maior instância viva (= `count` da malha). */
  highWater: number;
  dataDirtyMin: number;
  dataDirtyMax: number;
  lastDt: number;
}

export function createFigureCorpsePool(corpses = FIGURE_CORPSES_MAX): FigureCorpsePool {
  const bodies = corpses * FIGURE_CORPSE_GROUPS;
  const instances = corpses * FIGURE_MAX_BOXES;
  return {
    corpses,
    instances,
    matrices: new Float32Array(instances * MAT4),
    data: new Float32Array(instances * INSTANCE_FLOATS),
    pos: new Float32Array(bodies * 3),
    prev: new Float32Array(bodies * 3),
    quat: new Float32Array(bodies * 4),
    spin: new Float32Array(bodies * 3),
    half: new Float32Array(bodies * 3),
    center: new Float32Array(bodies * 3),
    age: new Float32Array(corpses),
    alive: new Uint8Array(corpses),
    unit: new Float32Array(corpses),
    boxes: new Uint8Array(corpses),
    light: new Float32Array(corpses * 3),
    boxBone: new Uint8Array(instances),
    rel: new Float32Array(corpses * FIGURE_BONES * MAT4),
    body: new Float32Array(bodies * MAT4),
    next: 0,
    highWater: 0,
    dataDirtyMin: -1,
    dataDirtyMax: -1,
    lastDt: 1 / 60,
  };
}

/** O golpe e a luz do cadáver (lidos do `FxDeath`). */
export interface FigureCorpseSpec {
  dirX: number;
  dirY: number;
  dirZ: number;
  force: number;
  /** Parte atingida (`FigurePart` 0..11; fora disso, nenhuma). */
  bodyPart: number;
  skin: number;
  sky: number;
  sun: number;
  emissive: number;
}

export function createFigureCorpseSpec(): FigureCorpseSpec {
  return { dirX: 0, dirY: 0, dirZ: 0, force: 0, bodyPart: -1, skin: 0, sky: 1, sun: 1, emissive: 0 };
}

/** Inverso afim (3×4) de a[ao ..] vezes b[bo ..], em out[oo ..] (4ª linha 0 0 0 1). Só no nascer. */
function inverseTimes(a: Float32Array, ao: number, b: Float32Array, bo: number, out: Float32Array, oo: number): void {
  const a0 = a[ao]!;
  const a1 = a[ao + 1]!;
  const a2 = a[ao + 2]!;
  const a4 = a[ao + 4]!;
  const a5 = a[ao + 5]!;
  const a6 = a[ao + 6]!;
  const a8 = a[ao + 8]!;
  const a9 = a[ao + 9]!;
  const a10 = a[ao + 10]!;
  // Inversa 3×3 por cofatores (coluna-maior: elemento (linha r, coluna c) em c·4 + r).
  const c00 = a5 * a10 - a9 * a6;
  const c01 = a9 * a2 - a1 * a10;
  const c02 = a1 * a6 - a5 * a2;
  const det = a0 * c00 + a4 * c01 + a8 * c02;
  const k = Math.abs(det) > 1e-20 ? 1 / det : 0;
  const i0 = c00 * k;
  const i1 = c01 * k;
  const i2 = c02 * k;
  const i4 = (a8 * a6 - a4 * a10) * k;
  const i5 = (a0 * a10 - a8 * a2) * k;
  const i6 = (a4 * a2 - a0 * a6) * k;
  const i8 = (a4 * a9 - a8 * a5) * k;
  const i9 = (a8 * a1 - a0 * a9) * k;
  const i10 = (a0 * a5 - a4 * a1) * k;
  const tx = a[ao + 12]!;
  const ty = a[ao + 13]!;
  const tz = a[ao + 14]!;
  for (let c = 0; c < 4; c++) {
    const bx = b[bo + c * 4]! - (c === 3 ? tx : 0);
    const by = b[bo + c * 4 + 1]! - (c === 3 ? ty : 0);
    const bz = b[bo + c * 4 + 2]! - (c === 3 ? tz : 0);
    out[oo + c * 4] = i0 * bx + i4 * by + i8 * bz;
    out[oo + c * 4 + 1] = i1 * bx + i5 * by + i9 * bz;
    out[oo + c * 4 + 2] = i2 * bx + i6 * by + i10 * bz;
    out[oo + c * 4 + 3] = c === 3 ? 1 : 0;
  }
}

/** Quatérnio da parte de giro da matriz a[ao ..] (colunas normalizadas e ortogonalizadas) em q[qo ..]. */
function quatFromMatrix(a: Float32Array, ao: number, q: Float32Array, qo: number): number {
  let xx = a[ao]!;
  let xy = a[ao + 1]!;
  let xz = a[ao + 2]!;
  const unit = Math.hypot(xx, xy, xz);
  xx /= unit;
  xy /= unit;
  xz /= unit;
  let yx = a[ao + 4]!;
  let yy = a[ao + 5]!;
  let yz = a[ao + 6]!;
  const d = xx * yx + xy * yy + xz * yz;
  yx -= d * xx;
  yy -= d * xy;
  yz -= d * xz;
  const yl = Math.hypot(yx, yy, yz) || 1;
  yx /= yl;
  yy /= yl;
  yz /= yl;
  const zx = xy * yz - xz * yy;
  const zy = xz * yx - xx * yz;
  const zz = xx * yy - xy * yx;
  const tr = xx + yy + zz;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q[qo + 3] = 0.25 * s;
    q[qo] = (yz - zy) / s;
    q[qo + 1] = (zx - xz) / s;
    q[qo + 2] = (xy - yx) / s;
  } else if (xx > yy && xx > zz) {
    const s = Math.sqrt(1 + xx - yy - zz) * 2;
    q[qo + 3] = (yz - zy) / s;
    q[qo] = 0.25 * s;
    q[qo + 1] = (yx + xy) / s;
    q[qo + 2] = (zx + xz) / s;
  } else if (yy > zz) {
    const s = Math.sqrt(1 + yy - xx - zz) * 2;
    q[qo + 3] = (zx - xz) / s;
    q[qo] = (yx + xy) / s;
    q[qo + 1] = 0.25 * s;
    q[qo + 2] = (zy + yz) / s;
  } else {
    const s = Math.sqrt(1 + zz - xx - yy) * 2;
    q[qo + 3] = (xy - yx) / s;
    q[qo] = (zx + xz) / s;
    q[qo + 1] = (zy + yz) / s;
    q[qo + 2] = 0.25 * s;
  }
  qNormalize(q, qo);
  return unit;
}

/**
 * Desmonta: `bones` (12 matrizes de osso do último quadro, px → mundo, em bones[bo ..]) com o gabarito `template` e a
 * 1ª camada da skin. Cada corpo nasce na raiz do grupo com o golpe (mais forte no grupo da parte atingida), um empurrão
 * para fora do tronco, um pulo e giro aleatório. Devolve o cadáver.
 */
export function spawnFigureCorpse(
  pool: FigureCorpsePool,
  bones: Float32Array,
  bo: number,
  templates: FigureTemplateSet,
  template: number,
  spec: Readonly<FigureCorpseSpec>,
  rng: FxRandom,
): number {
  const c = pool.next;
  pool.next = (c + 1) % pool.corpses;
  pool.age[c] = 0;
  pool.alive[c] = 1;
  pool.light[c * 3] = spec.sky;
  pool.light[c * 3 + 1] = spec.sun;
  pool.light[c * 3 + 2] = spec.emissive;
  const tpl = template < templates.count ? template : 0;
  const n = templates.length[tpl]!;
  pool.boxes[c] = n;
  const base = tpl * BLOCK;
  // `rel` de cada osso (identidade na raiz do grupo) e o osso de cada caixa.
  const rel = pool.rel;
  const r0 = c * FIGURE_BONES * MAT4;
  for (let b = 0; b < FIGURE_BONES; b++) {
    const root = FIGURE_GROUP_ROOT[FIGURE_BONE_GROUP[b]!]!;
    inverseTimes(bones, bo + root * MAT4, bones, bo + b * MAT4, rel, r0 + b * MAT4);
  }
  const i0 = c * FIGURE_MAX_BOXES;
  for (let k = 0; k < FIGURE_MAX_BOXES; k++) {
    const o = (i0 + k) * INSTANCE_FLOATS;
    if (k < n) {
      pool.boxBone[i0 + k] = templates.boxes[base + k * FIGURE_BOX_STRIDE + F.bone]!;
      writeFigureBoxData(pool.data, o, templates.boxes, base + k * FIGURE_BOX_STRIDE, spec.skin, NO_SLOT);
    } else {
      pool.boxBone[i0 + k] = 0;
      pool.data.fill(0, o, o + INSTANCE_FLOATS);
      pool.matrices.fill(0, (i0 + k) * MAT4, (i0 + k + 1) * MAT4);
    }
  }
  // Caixa de cada grupo no espaço do osso-raiz (px): centro e meias medidas, pelas caixas dos ossos do grupo.
  const dt = pool.lastDt > 0 ? pool.lastDt : 1 / 60;
  const dl = Math.hypot(spec.dirX, spec.dirY, spec.dirZ);
  const dx = dl > 1e-6 ? spec.dirX / dl : 0;
  const dy = dl > 1e-6 ? spec.dirY / dl : 0;
  const dz = dl > 1e-6 ? spec.dirZ / dl : 0;
  const force = Math.max(1.5, Math.min(14, spec.force));
  const hitGroup = spec.bodyPart >= 0 && spec.bodyPart < FIGURE_BONES ? FIGURE_BONE_GROUP[spec.bodyPart]! : -1;
  // Centro do tronco no mundo (empurrão radial): o centro da caixa do tronco, (0; 6; 0) px no osso.
  const to = bo + MAT4;
  const tx = bones[to + 12]! + 6 * bones[to + 4]!;
  const ty = bones[to + 13]! + 6 * bones[to + 5]!;
  const tz = bones[to + 14]! + 6 * bones[to + 6]!;
  for (let g = 0; g < FIGURE_CORPSE_GROUPS; g++) {
    const b = c * FIGURE_CORPSE_GROUPS + g;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let k = 0; k < n; k++) {
      const bone = pool.boxBone[i0 + k]!;
      if (FIGURE_BONE_GROUP[bone] !== g) continue;
      const box = base + k * FIGURE_BOX_STRIDE;
      const t = templates.boxes;
      const hx = t[box + F.sx]! / 2;
      const hy = t[box + F.sy]! / 2;
      const hz = t[box + F.sz]! / 2;
      const ro = r0 + bone * MAT4;
      for (let corner = 0; corner < 8; corner++) {
        const x = t[box + F.cx]! + (corner & 1 ? hx : -hx);
        const y = t[box + F.cy]! + (corner & 2 ? hy : -hy);
        const z = t[box + F.cz]! + (corner & 4 ? hz : -hz);
        const px = rel[ro]! * x + rel[ro + 4]! * y + rel[ro + 8]! * z + rel[ro + 12]!;
        const py = rel[ro + 1]! * x + rel[ro + 5]! * y + rel[ro + 9]! * z + rel[ro + 13]!;
        const pz = rel[ro + 2]! * x + rel[ro + 6]! * y + rel[ro + 10]! * z + rel[ro + 14]!;
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        minZ = Math.min(minZ, pz);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
        maxZ = Math.max(maxZ, pz);
      }
    }
    if (minX > maxX) {
      minX = maxX = minY = maxY = minZ = maxZ = 0;
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    pool.center[b * 3] = cx;
    pool.center[b * 3 + 1] = cy;
    pool.center[b * 3 + 2] = cz;
    const ro = bo + FIGURE_GROUP_ROOT[g]! * MAT4;
    const unit = quatFromMatrix(bones, ro, pool.quat, b * 4);
    if (g === 0) pool.unit[c] = unit;
    pool.half[b * 3] = ((maxX - minX) / 2) * unit;
    pool.half[b * 3 + 1] = ((maxY - minY) / 2) * unit;
    pool.half[b * 3 + 2] = ((maxZ - minZ) / 2) * unit;
    // Centro do corpo no mundo = raiz · centro.
    const wx = bones[ro]! * cx + bones[ro + 4]! * cy + bones[ro + 8]! * cz + bones[ro + 12]!;
    const wy = bones[ro + 1]! * cx + bones[ro + 5]! * cy + bones[ro + 9]! * cz + bones[ro + 13]!;
    const wz = bones[ro + 2]! * cx + bones[ro + 6]! * cy + bones[ro + 10]! * cz + bones[ro + 14]!;
    let ox = wx - tx;
    let oy = wy - ty;
    let oz = wz - tz;
    const ol = Math.hypot(ox, oy, oz);
    if (ol > 1e-4) {
      ox /= ol;
      oy /= ol;
      oz /= ol;
    }
    const boost = g === hitGroup ? 1 : 0.45;
    const vx = dx * force * boost + ox * 1.6 + (rng.next() - 0.5) * 1.6;
    const vy = dy * force * boost + oy * 1.2 + 2.2 + rng.next() * 1.8;
    const vz = dz * force * boost + oz * 1.6 + (rng.next() - 0.5) * 1.6;
    pool.pos[b * 3] = wx;
    pool.pos[b * 3 + 1] = wy;
    pool.pos[b * 3 + 2] = wz;
    pool.prev[b * 3] = wx - vx * dt;
    pool.prev[b * 3 + 1] = wy - vy * dt;
    pool.prev[b * 3 + 2] = wz - vz * dt;
    pool.spin[b * 3] = (rng.next() - 0.5) * 16;
    pool.spin[b * 3 + 1] = (rng.next() - 0.5) * 10;
    pool.spin[b * 3 + 2] = (rng.next() - 0.5) * 16;
  }
  const first = i0;
  const last = i0 + FIGURE_MAX_BOXES - 1;
  if (pool.dataDirtyMin < 0 || first < pool.dataDirtyMin) pool.dataDirtyMin = first;
  if (last > pool.dataDirtyMax) pool.dataDirtyMax = last;
  if (last + 1 > pool.highWater) pool.highWater = last + 1;
  writeFigureCorpse(pool, c, 1);
  return c;
}

/**
 * Matrizes das caixas do cadáver `c` pelos corpos: corpo = T(pos)·R(q)·S(m/px·encolhe)·T(−centro); osso-raiz = corpo;
 * os outros = corpo·rel (a dobra fica); extras = cópia do osso; 4ª linha com a luz e `dead`.
 */
export function writeFigureCorpse(pool: FigureCorpsePool, c: number, shrink: number): void {
  // quente:
  const s = pool.unit[c]! * shrink;
  const body = pool.body;
  for (let g = 0; g < FIGURE_CORPSE_GROUPS; g++) {
    const b = c * FIGURE_CORPSE_GROUPS + g;
    const m = b * MAT4;
    m4FromQuat(body, m, pool.pos[b * 3]!, pool.pos[b * 3 + 1]!, pool.pos[b * 3 + 2]!, pool.quat, b * 4, s);
    m4Translate(body, -pool.center[b * 3]!, -pool.center[b * 3 + 1]!, -pool.center[b * 3 + 2]!, m);
  }
  const out = pool.matrices;
  const i0 = c * FIGURE_MAX_BOXES;
  const r0 = c * FIGURE_BONES * MAT4;
  for (let bone = 0; bone < FIGURE_BONES; bone++) {
    const g = FIGURE_BONE_GROUP[bone]!;
    const w = (c * FIGURE_CORPSE_GROUPS + g) * MAT4;
    const o = (i0 + bone) * MAT4;
    if (FIGURE_GROUP_ROOT[g] === bone) {
      for (let k = 0; k < 15; k++) out[o + k] = body[w + k]!;
      continue;
    }
    const ro = r0 + bone * MAT4;
    for (let col = 0; col < 4; col++) {
      const b0 = pool.rel[ro + col * 4]!;
      const b1 = pool.rel[ro + col * 4 + 1]!;
      const b2 = pool.rel[ro + col * 4 + 2]!;
      const b3 = col === 3 ? 1 : 0;
      for (let row = 0; row < 3; row++) {
        out[o + col * 4 + row] =
          body[w + row]! * b0 + body[w + 4 + row]! * b1 + body[w + 8 + row]! * b2 + body[w + 12 + row]! * b3;
      }
    }
  }
  const n = pool.boxes[c]!;
  for (let k = FIGURE_BONES; k < n; k++) {
    const src = (i0 + pool.boxBone[i0 + k]!) * MAT4;
    const dst = (i0 + k) * MAT4;
    for (let q = 0; q < 15; q++) out[dst + q] = out[src + q]!;
  }
  const sky = pool.light[c * 3]!;
  const sun = pool.light[c * 3 + 1]!;
  const emissive = pool.light[c * 3 + 2]!;
  for (let k = 0; k < n; k++) writeFigureRow4(out, (i0 + k) * MAT4, sky, sun, emissive, DEAD, 0);
  // fim-quente
}

/** Avança os corpos e escreve as matrizes. Devolve quantos cadáveres estão vivos. */
export function stepFigureCorpses(pool: FigureCorpsePool, dt: number, world: CollisionWorld | null): number {
  // quente:
  let alive = 0;
  let high = 0;
  for (let c = 0; c < pool.corpses; c++) {
    if (pool.alive[c] !== 1) continue;
    const age = pool.age[c]! + dt;
    if (age >= CORPSE_LIFE_S) {
      pool.alive[c] = 0;
      pool.matrices.fill(0, c * FIGURE_MAX_BOXES * MAT4, (c + 1) * FIGURE_MAX_BOXES * MAT4);
      continue;
    }
    pool.age[c] = age;
    const shrink = age > CORPSE_LIFE_S - SHRINK_S ? (CORPSE_LIFE_S - age) / SHRINK_S : 1;
    for (let g = 0; g < FIGURE_CORPSE_GROUPS; g++) {
      const b = c * FIGURE_CORPSE_GROUPS + g;
      const q = b * 4;
      const hx = pool.half[b * 3]!;
      const hy = pool.half[b * 3 + 1]!;
      const hz = pool.half[b * 3 + 2]!;
      const ex = orientedHalfExtent(pool.quat, q, 0, hx, hy, hz);
      const ey = orientedHalfExtent(pool.quat, q, 1, hx, hy, hz);
      const ez = orientedHalfExtent(pool.quat, q, 2, hx, hy, hz);
      const hit = verletStep(pool.pos, pool.prev, b * 3, dt, pool.lastDt, ex, ey, ez, world, CORPSE_PHYSICS);
      let wx = pool.spin[b * 3]!;
      let wy = pool.spin[b * 3 + 1]!;
      let wz = pool.spin[b * 3 + 2]!;
      if ((hit & VERLET_HIT.ground) !== 0) {
        const damp = Math.max(0, 1 - 6 * dt);
        wx *= damp;
        wy *= damp;
        wz *= damp;
        qSettle(pool.quat, q, Math.min(1, dt * 8));
      } else if ((hit & VERLET_HIT.wall) !== 0) {
        wx *= 0.7;
        wy *= 0.7;
        wz *= 0.7;
      }
      pool.spin[b * 3] = wx;
      pool.spin[b * 3 + 1] = wy;
      pool.spin[b * 3 + 2] = wz;
      qIntegrate(pool.quat, q, wx, wy, wz, dt);
    }
    writeFigureCorpse(pool, c, shrink);
    high = (c + 1) * FIGURE_MAX_BOXES;
    alive++;
  }
  pool.highWater = high;
  if (dt > 0) pool.lastDt = dt;
  return alive;
  // fim-quente
}

export function clearFigureCorpses(pool: FigureCorpsePool): void {
  pool.alive.fill(0);
  pool.matrices.fill(0);
  pool.highWater = 0;
  pool.next = 0;
}
