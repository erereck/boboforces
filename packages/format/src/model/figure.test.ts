import { createRng } from '@boboforces/shared';
import { describe, expect, it } from 'vitest';
import { FIGURE_LAYOUT, FIGURE_SWATCH, figureSwatchCorner } from './figure-layout.ts';
import {
  FIGURE_BODY_BOXES,
  FIGURE_BONE,
  FIGURE_BONE_GROUP,
  FIGURE_BONE_PARENT,
  FIGURE_BONES,
  FIGURE_BOX_FIELD,
  FIGURE_BOX_FLAG,
  FIGURE_BOX_STRIDE,
  FIGURE_CROUCH_POSE,
  FIGURE_CROUCH_TOP_M,
  FIGURE_GRIP,
  FIGURE_HEAD_HALF_M,
  FIGURE_HEIGHT_PX,
  FIGURE_MODE,
  FIGURE_PART_CATEGORY,
  FIGURE_PITCH_SAMPLES,
  FIGURE_POSE,
  FIGURE_POSE_SIZE,
  FIGURE_POSTURE_INFO,
  FIGURE_POSTURES,
  FIGURE_PX_M,
  FIGURE_REST_POSE,
  FIGURE_SLIDE_POSE,
  FIGURE_STANCE,
  FIGURE_ZOMBIE_POSE,
  figureFk,
  figurePosture,
  figureRoot,
  type FigureGrip,
  type FigureMode,
  type FigureStance,
} from './figure.ts';

type Key = keyof typeof FIGURE_POSE;
const PX = FIGURE_PX_M;
// Números da tabela de métricas da sim (o format não importa a sim; o contracts.test de lá confere contra o METRICS).
const BODY_HEIGHT = 1.75;
const EYE_HEIGHT = 1.55;
const AABB_HALF_WIDTH = 0.3;

function poseOf(values: Partial<Record<Key, number>>): Float32Array {
  const p = new Float32Array(FIGURE_POSE_SIZE);
  for (const [k, v] of Object.entries(values)) p[FIGURE_POSE[k as Key]] = v;
  return p;
}
const get = (pose: Float32Array, key: Key): number => pose[FIGURE_POSE[key]]!;

/** Ossos no mundo (raiz na origem, escala 1, sem achatamento). */
function bonesOf(pose: Float32Array, yaw = 0): Float32Array {
  const root = new Float32Array(16);
  figureRoot(root, 0, 0, 0, 0, yaw, 1, 0);
  const out = new Float32Array(FIGURE_BONES * 16);
  figureFk(pose, 0, root, 0, out, 0);
  return out;
}

const point = (m: Float32Array, o: number, x: number, y: number, z: number): [number, number, number] => [
  m[o]! * x + m[o + 4]! * y + m[o + 8]! * z + m[o + 12]!,
  m[o + 1]! * x + m[o + 5]! * y + m[o + 9]! * z + m[o + 13]!,
  m[o + 2]! * x + m[o + 6]! * y + m[o + 10]! * z + m[o + 14]!,
];

interface Bounds {
  lo: [number, number, number];
  hi: [number, number, number];
}

/** AABB no mundo de cada uma das 14 caixas do corpo (metros). */
function boxBounds(bones: Float32Array): Bounds[] {
  const F = FIGURE_BOX_FIELD;
  const out: Bounds[] = [];
  for (let i = 0; i < 14; i++) {
    const b = FIGURE_BODY_BOXES.subarray(i * FIGURE_BOX_STRIDE, (i + 1) * FIGURE_BOX_STRIDE);
    const o = b[F.bone]! * 16;
    const lo: [number, number, number] = [Infinity, Infinity, Infinity];
    const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const sx of [-0.5, 0.5]) {
      for (const sy of [-0.5, 0.5]) {
        for (const sz of [-0.5, 0.5]) {
          const q = point(bones, o, b[F.cx]! + sx * b[F.sx]!, b[F.cy]! + sy * b[F.sy]!, b[F.cz]! + sz * b[F.sz]!);
          for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k]!, q[k]!);
            hi[k] = Math.max(hi[k]!, q[k]!);
          }
        }
      }
    }
    out.push({ lo, hi });
  }
  return out;
}

function extents(pose: Float32Array, yaw = 0): Bounds {
  const all = boxBounds(bonesOf(pose, yaw));
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const b of all) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, b.lo[k]!);
      hi[k] = Math.max(hi[k]!, b.hi[k]!);
    }
  }
  return { lo, hi };
}

// --- Referência ingênua: cadeia de matrizes 4×4 (float64, coluna-maior) montada junta a junta ---

type M4 = Float64Array;
function m4(cols: readonly number[]): M4 {
  return Float64Array.from(cols);
}
function mul(a: M4, b: M4): M4 {
  const r = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + row]! * b[c * 4 + k]!;
      r[c * 4 + row] = s;
    }
  }
  return r;
}
const chain = (...ms: M4[]): M4 => ms.reduce((acc, m) => mul(acc, m));
const T = (x: number, y: number, z: number): M4 => m4([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
const S = (x: number, y: number, z: number): M4 => m4([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]);
const RX = (a: number): M4 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return m4([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
};
const RY = (a: number): M4 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return m4([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
};
const RZ = (a: number): M4 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return m4([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
};
const XYZ = (x: number, y: number, z: number): M4 => chain(RX(x), RY(y), RZ(z));

/** O esqueleto do FutBobo (`character.ts:2947-2976`, `:4099-4134`) sem o pé plano, como no contrato. */
function referenceFk(
  p: Float32Array,
  x: number,
  y: number,
  z: number,
  yaw: number,
  scale: number,
  squash: number,
): M4[] {
  const v = (key: Key): number => get(p, key);
  const k = FIGURE_PX_M * scale;
  const root = chain(T(x, y, z), RY(yaw + Math.PI), S(k * (1 - squash / 2), k * (1 + squash), k * (1 - squash / 2)));
  const rX = v('bodyRotX');
  const rZ = v('bodyRotZ');
  const aX = rX + v('pivX');
  const aZ = rZ + v('pivZ');
  const foot = [-13 * Math.sin(rZ), 13 * Math.cos(rZ) * Math.cos(rX), 13 * Math.cos(rZ) * Math.sin(rX)];
  const total = [-13 * Math.sin(aZ), 13 * Math.cos(aZ) * Math.cos(aX), 13 * Math.cos(aZ) * Math.sin(aX)];
  const body = chain(
    root,
    RY(v('spinY')),
    T(v('bodyX') + foot[0]! - total[0]!, v('bodyY') + foot[1]! - total[1]!, v('bodyZ') + foot[2]! - total[2]!),
    RX(aX),
    RZ(aZ),
  );
  const hips = chain(body, T(0, 12, 0), RY(v('hipsY')));
  const torso = chain(hips, T(0, -v('torsoSink'), 0), XYZ(v('torsoX'), v('torsoY'), v('torsoZ')));
  const slide = v('neckSlide');
  const head = mul(
    T(slide * root[8]!, slide * root[9]!, slide * root[10]!),
    chain(torso, T(0, 12 - v('neckSink'), 0), XYZ(v('neckX'), v('neckY'), v('neckZ'))),
  );
  const armR = chain(torso, T(-6, 11.5, 0), XYZ(v('shRX'), v('shRY'), v('shRZ')));
  const armL = chain(torso, T(6, 11.5, 0), XYZ(v('shLX'), v('shLY'), v('shLZ')));
  const foreR = chain(armR, T(0, -4.9, 0), RX(v('elR')));
  const foreL = chain(armL, T(0, -4.9, 0), RX(v('elL')));
  const thighR = chain(hips, T(-2.05, 0.4, 0), RX(v('hipRX')), RZ(v('hipRZ')));
  const thighL = chain(hips, T(2.05, 0.4, 0), RX(v('hipLX')), RZ(v('hipLZ')));
  const shinR = chain(thighR, T(0, -5.6, 0), RX(v('kneeR')));
  const shinL = chain(thighL, T(0, -5.6, 0), RX(v('kneeL')));
  const footR = chain(shinR, T(0, -4.3, 0), RX(v('ankleR')), RZ(-v('hipRZ')));
  const footL = chain(shinL, T(0, -4.3, 0), RX(v('ankleL')), RZ(-v('hipLZ')));
  return [head, torso, armR, armL, foreR, foreL, thighR, thighL, shinR, shinL, footR, footL];
}

/** `legDrop` do FutBobo (`character.ts:1010-1014`): quanto o quadril desce com a chuteira plana. */
function legDrop(hipX: number, hipZ: number, knee: number): number {
  const cz = Math.cos(hipZ);
  const cx = Math.cos(hipX);
  return 9.9 - (5.6 * cz * cx + 4.3 * (Math.cos(knee) * cz * cx - Math.sin(knee) * Math.sin(hipX)));
}
/** Giro X do tornozelo pelo pé plano do FutBobo (`character.ts:4127-4134`, parado: peso 1). */
function flatAnkle(shin: number): number {
  const t = Math.min(1, Math.max(0, (Math.abs(shin) - 0.7) / 0.6));
  return -shin * (1 - t * t * (3 - 2 * t));
}

const AFFINE = [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14];

describe('figure: constantes', () => {
  it('escala U: 32 px = 1,75 m, cabeça 8 px = 0,4375 m', () => {
    expect(FIGURE_HEIGHT_PX * FIGURE_PX_M).toBe(BODY_HEIGHT);
    expect(FIGURE_HEAD_HALF_M).toBe(0.21875);
    expect(2 * FIGURE_HEAD_HALF_M).toBe(8 * FIGURE_PX_M);
    expect(8 * FIGURE_PX_M).toBe(0.4375);
    expect(FIGURE_CROUCH_TOP_M).toBe(0.97);
    expect(FIGURE_PITCH_SAMPLES).toEqual([-1.2, -0.6, 0, 0.6, 1.2]);
  });

  it('ossos, categorias, pais e grupos do desmonte são coerentes', () => {
    expect(Object.values(FIGURE_BONE)).toEqual([...Array(FIGURE_BONES).keys()]);
    expect(FIGURE_PART_CATEGORY).toEqual([0, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3]);
    expect(FIGURE_BONE_PARENT).toEqual([1, -1, 1, 1, 2, 3, -1, -1, 6, 7, 8, 9]);
    expect(FIGURE_BONE_GROUP).toEqual([0, 1, 2, 3, 2, 3, 4, 5, 4, 5, 4, 5]);
    // Filho e pai no mesmo grupo, exceto os que nascem no tronco/hips (cabeça, braços e coxas).
    for (let b = 0; b < FIGURE_BONES; b++) {
      const parent = FIGURE_BONE_PARENT[b]!;
      if (parent >= 0 && parent !== FIGURE_BONE.torso)
        expect(FIGURE_BONE_GROUP[b], `osso ${b}`).toBe(FIGURE_BONE_GROUP[parent]);
    }
  });

  it('o pai de cada osso é o que o FK usa: girar uma junta mexe só no osso e nos descendentes', () => {
    const joint: Key[] = [
      'neckX',
      'torsoX',
      'shRX',
      'shLX',
      'elR',
      'elL',
      'hipRX',
      'hipLX',
      'kneeR',
      'kneeL',
      'ankleR',
      'ankleL',
    ];
    const base = bonesOf(FIGURE_REST_POSE);
    const descends = (b: number, of: number): boolean => {
      for (let x = b; x >= 0; x = FIGURE_BONE_PARENT[x]!) if (x === of) return true;
      return false;
    };
    for (let j = 0; j < FIGURE_BONES; j++) {
      const p = FIGURE_REST_POSE.slice();
      const at = FIGURE_POSE[joint[j]!];
      p[at] = p[at]! + 0.3;
      const moved = bonesOf(p);
      for (let b = 0; b < FIGURE_BONES; b++) {
        let diff = 0;
        for (const k of AFFINE) diff = Math.max(diff, Math.abs(moved[b * 16 + k]! - base[b * 16 + k]!));
        expect(diff > 1e-6, `junta ${joint[j]} × osso ${b}`).toBe(descends(b, j));
      }
    }
  });
});

describe('figure: caixas do corpo', () => {
  const F = FIGURE_BOX_FIELD;
  const box = (i: number): Float32Array =>
    FIGURE_BODY_BOXES.subarray(i * FIGURE_BOX_STRIDE, (i + 1) * FIGURE_BOX_STRIDE);

  it('14 caixas: as 12 primárias na ordem dos ossos, depois mão D e mão E', () => {
    expect(FIGURE_BODY_BOXES.length).toBe(14 * FIGURE_BOX_STRIDE);
    const bones = [...Array(14).keys()].map((i) => box(i)[F.bone]);
    expect(bones).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, FIGURE_BONE.forearmR, FIGURE_BONE.forearmL]);
    for (let i = 0; i < 14; i++) {
      expect(box(i)[F.rotX]).toBe(0);
      expect(box(i)[F.rotZ]).toBe(0);
      expect(box(i)[F.flags], `caixa ${i}`).toBe(i === 0 ? FIGURE_BOX_FLAG.face : 0);
    }
  });

  it('medidas do FutBobo; a chuteira é 4,05 × 2,7 × 5,25 com centro (0; −1,15; +0,55)', () => {
    const expected: [number[], number[]][] = [
      [
        [0, 4, 0],
        [8, 8, 8],
      ],
      [
        [0, 6, 0],
        [8, 12, 4],
      ],
      [
        [0, -2.4, 0],
        [4, 5.2, 4],
      ],
      [
        [0, -2.4, 0],
        [4, 5.2, 4],
      ],
      [
        [0, -2.4, 0],
        [3.6, 5, 3.6],
      ],
      [
        [0, -2.4, 0],
        [3.6, 5, 3.6],
      ],
      [
        [0, -2.5, 0],
        [4.25, 5.6, 4.3],
      ],
      [
        [0, -2.5, 0],
        [4.25, 5.6, 4.3],
      ],
      [
        [0, -1.9, 0],
        [3.75, 4.9, 3.75],
      ],
      [
        [0, -1.9, 0],
        [3.75, 4.9, 3.75],
      ],
      [
        [0, -1.15, 0.55],
        [4.05, 2.7, 5.25],
      ],
      [
        [0, -1.15, 0.55],
        [4.05, 2.7, 5.25],
      ],
      [
        [0, -5.6, 0],
        [3.8, 2.2, 3.8],
      ],
      [
        [0, -5.6, 0],
        [3.8, 2.2, 3.8],
      ],
    ];
    expected.forEach(([c, s], i) => {
      const b = box(i);
      [b[F.cx], b[F.cy], b[F.cz], b[F.sx], b[F.sy], b[F.sz]].forEach((x, k) =>
        expect(x, `caixa ${i} campo ${k}`).toBeCloseTo([...c, ...s][k]!, 6),
      );
    });
  });

  it('UV: cabeça e tronco na cruz, membros nas colunas da farda, mão na amostra da luva, bota na mini-cruz', () => {
    const uvOf = (i: number): number[] => [F.layer, F.u, F.v, F.w, F.h, F.d].map((f) => box(i)[f]!);
    const cross = (r: { layer: number; u: number; v: number; w: number; h: number; d: number }): number[] => [
      r.layer,
      r.u,
      r.v,
      r.w,
      r.h,
      r.d,
    ];
    const swatch = (i: number): number[] => {
      const c = figureSwatchCorner(i);
      return [0, c % 64, Math.floor(c / 64), 0, 0, 0];
    };
    expect(uvOf(0)).toEqual(cross(FIGURE_LAYOUT.head));
    expect(uvOf(1)).toEqual(cross(FIGURE_LAYOUT.torso));
    // Farda (#58): manga com a braçadeira, antebraço com o punho da luva, coxa e canela com a joelheira em colunas; a mão
    // fica na amostra (a luva, como os retalhos sólidos do FutBobo, `character.ts:2998-3011`).
    for (const i of [2, 3]) expect(uvOf(i)).toEqual(cross(FIGURE_LAYOUT.sleeve));
    for (const i of [4, 5]) expect(uvOf(i)).toEqual(cross(FIGURE_LAYOUT.forearm));
    for (const i of [6, 7]) expect(uvOf(i)).toEqual(cross(FIGURE_LAYOUT.thigh));
    for (const i of [12, 13]) expect(uvOf(i)).toEqual(swatch(FIGURE_SWATCH.hand));
    for (const i of [8, 9]) expect(uvOf(i)).toEqual(cross(FIGURE_LAYOUT.shin));
    for (const i of [10, 11]) expect(uvOf(i)).toEqual(cross(FIGURE_LAYOUT.boot));
  });
});

describe('figure: FK', () => {
  it('afim = cadeia 4×4 de referência até 1e−5, em poses sorteadas com semente', () => {
    const rng = createRng('figure-fk').fork('poses');
    const root = new Float32Array(40);
    const out = new Float32Array(FIGURE_BONES * 16 + 24);
    const pose = new Float32Array(FIGURE_POSE_SIZE + 5);
    let worst = 0;
    for (let n = 0; n < 300; n++) {
      const po = n % 5;
      for (let k = 0; k < FIGURE_POSE_SIZE; k++) pose[po + k] = rng.range(-Math.PI, Math.PI);
      for (const key of ['bodyX', 'bodyY', 'bodyZ'] as const) pose[po + FIGURE_POSE[key]] = rng.range(-12, 12);
      pose[po + FIGURE_POSE.neckSink] = rng.range(0, 4);
      pose[po + FIGURE_POSE.torsoSink] = rng.range(0, 2);
      pose[po + FIGURE_POSE.neckSlide] = rng.range(-1.5, 1.5);
      const x = rng.range(-20, 20);
      const y = rng.range(-2, 10);
      const z = rng.range(-20, 20);
      const yaw = rng.range(-7, 7);
      const scale = rng.range(0.5, 2);
      const squash = rng.range(-0.09, 0.07);
      const ro = 8 + (n % 3) * 4;
      const o = (n % 4) * 2;
      // A 4ª linha não é lida (raiz com NaN) nem escrita (sentinela).
      root.fill(Number.NaN);
      figureRoot(root, ro, x, y, z, yaw, scale, squash);
      root[ro + 3] = root[ro + 7] = root[ro + 11] = root[ro + 15] = Number.NaN;
      out.fill(777);
      figureFk(pose.subarray(0), po, root, ro, out, o);
      const ref = referenceFk(pose.subarray(po, po + FIGURE_POSE_SIZE), x, y, z, yaw, scale, squash);
      for (let b = 0; b < FIGURE_BONES; b++) {
        for (const k of AFFINE) {
          const d = Math.abs(out[o + b * 16 + k]! - ref[b]![k]!);
          worst = Math.max(worst, d);
          expect(d, `pose ${n} osso ${b} [${k}]`).toBeLessThan(1e-5);
        }
        for (const k of [3, 7, 11, 15]) expect(out[o + b * 16 + k]).toBe(777);
      }
      for (let k = 0; k < out.length; k++) if (k < o || k >= o + 192) expect(out[k]).toBe(777);
    }
    expect(worst).toBeLessThan(1e-5);
  });

  it('a raiz escreve T·Ry(yaw + π)·S inteira, com a 4ª linha (0, 0, 0, 1)', () => {
    const root = new Float32Array(16);
    figureRoot(root, 0, 1, 2, 3, 0.7, 1.3, 0.05);
    const k = FIGURE_PX_M * 1.3;
    const ref = chain(T(1, 2, 3), RY(0.7 + Math.PI), S(k * 0.975, k * 1.05, k * 0.975));
    for (let i = 0; i < 16; i++) expect(root[i]).toBeCloseTo(ref[i]!, 7);
  });

  it('repouso: topo 32 px e sola 0 (chuteira de 2,7 px)', () => {
    const e = extents(FIGURE_REST_POSE);
    expect(e.hi[1] / PX).toBeCloseTo(32, 6);
    expect(Math.abs(e.lo[1])).toBeLessThan(1e-6);
    // Ombro a ombro com os braços retos: 16 px = 0,875 m, como no bobo A (o ARM_REST abre 0,09 rad e passa disso).
    const straight = extents(poseOf({}));
    expect((straight.hi[0] - straight.lo[0]) / PX).toBeCloseTo(16, 5);
  });

  it('as poses de conferência do FutBobo: sitDown 22,107 px e keeper 30,356 px (topo da cabeça)', () => {
    // Estudo de anatomia (fk-anatomia.mjs): conferidas na malha real do FutBobo. O topo da cabeça não depende da sola.
    const sitDown = poseOf({
      bodyY: -9.8,
      hipLX: -2,
      hipRX: -2,
      kneeL: 0.9,
      kneeR: 0.9,
      hipLZ: 0.12,
      hipRZ: -0.12,
      torsoX: 0.3,
      neckX: 0.5,
    });
    const keeper = poseOf({
      bodyY: -1.1,
      torsoX: 0.36,
      neckX: -0.3,
      hipLZ: 0.26,
      hipRZ: -0.26,
      hipLX: -0.3,
      hipRX: -0.3,
      kneeL: 0.62,
      kneeR: 0.62,
    });
    const headTop = (p: Float32Array): number => boxBounds(bonesOf(p))[0]!.hi[1] / PX;
    expect(headTop(sitDown)).toBeCloseTo(22.107, 3);
    expect(headTop(keeper)).toBeCloseTo(30.356, 3);
  });

  it('tornozelo Z = −hipZ (diferença consciente): contra o FutBobo literal, −hipZ·peso, a chuteira muda ≤ 0,3 px', () => {
    // O FutBobo gira o tornozelo em Z por −hipZ·peso, peso = (1 − smooth((|canela| − 0,7)/0,6))·(1 − 0,55·corrida)
    // (`character.ts:4127-4134`); o FK do contrato usa peso 1 (a pose não tem chave do Z do tornozelo). Medido aqui:
    // parado com a canela vertical (keeper) é igual; sitDown (canela −1,1, peso 0,259) muda ~0,29 px na chuteira.
    const flatWeight = (shin: number, run: number): number => {
      const t = Math.min(1, Math.max(0, (Math.abs(shin) - 0.7) / 0.6));
      return (1 - t * t * (3 - 2 * t)) * (1 - 0.55 * run);
    };
    const bootShift = (values: Partial<Record<Key, number>>, run: number): number => {
      const p = poseOf(values);
      const flatR = flatWeight(get(p, 'hipRX') + get(p, 'kneeR'), run);
      const flatL = flatWeight(get(p, 'hipLX') + get(p, 'kneeL'), run);
      // X do pé plano na pose, como a animação escreve; o Z fica com o FK.
      p[FIGURE_POSE.ankleR] = -(get(p, 'hipRX') + get(p, 'kneeR')) * flatR;
      p[FIGURE_POSE.ankleL] = -(get(p, 'hipLX') + get(p, 'kneeL')) * flatL;
      const ours = bonesOf(p);
      const ref = referenceFk(p, 0, 0, 0, 0, 1, 0);
      let worst = 0;
      for (const [bone, shin, ankle, hipZ, flat] of [
        [FIGURE_BONE.footR, ref[8]!, get(p, 'ankleR'), get(p, 'hipRZ'), flatR],
        [FIGURE_BONE.footL, ref[9]!, get(p, 'ankleL'), get(p, 'hipLZ'), flatL],
      ] as const) {
        const fb = chain(shin, T(0, -4.3, 0), RX(ankle), RZ(-hipZ * flat));
        for (const sx of [-1, 1])
          for (const sy of [-1, 1])
            for (const sz of [-1, 1]) {
              const x = sx * 2.025;
              const y = -1.15 + sy * 1.35;
              const z = 0.55 + sz * 2.625;
              const a = point(ours, bone * 16, x, y, z);
              for (let k = 0; k < 3; k++) {
                const b = fb[k]! * x + fb[4 + k]! * y + fb[8 + k]! * z + fb[12 + k]!;
                worst = Math.max(worst, Math.abs(a[k]! - b) / PX);
              }
            }
      }
      return worst;
    };
    const keeper = { bodyY: -1.1, hipLZ: 0.26, hipRZ: -0.26, hipLX: -0.3, hipRX: -0.3, kneeL: 0.62, kneeR: 0.62 };
    const sitDown = { bodyY: -9.8, hipLX: -2, hipRX: -2, kneeL: 0.9, kneeR: 0.9, hipLZ: 0.12, hipRZ: -0.12 };
    expect(bootShift(keeper, 0)).toBeLessThan(1e-4);
    const sit = bootShift(sitDown, 0);
    expect(sit).toBeGreaterThan(0.2);
    expect(sit).toBeLessThanOrEqual(0.3);
    // Passinho lateral correndo (canela vertical, corrida 1): o FutBobo gira 0,45·hipZ; com hipZ 0,25 a chuteira muda
    // 0,36 px (2 cm na quina da ponta).
    expect(bootShift({ hipLZ: 0.25, hipRZ: -0.25 }, 1)).toBeLessThanOrEqual(0.4);
  });

  it('raiz com yaw 0: ombro direito em +X do mundo e frente em −Z; yaw π/2 vira para a esquerda (−X)', () => {
    const at0 = bonesOf(FIGURE_REST_POSE, 0);
    const R = FIGURE_BONE.upperArmR * 16;
    const Lf = FIGURE_BONE.upperArmL * 16;
    const H = FIGURE_BONE.head * 16;
    expect(at0[R + 12]).toBeCloseTo(6 * PX, 6);
    expect(at0[Lf + 12]).toBeCloseTo(-6 * PX, 6);
    // Frente do boneco (+z do FutBobo) = coluna 2 da cabeça.
    expect([at0[H + 8], at0[H + 9], at0[H + 10]].map((v) => v! / PX)).toEqual([
      expect.closeTo(0, 6),
      expect.closeTo(0, 6),
      expect.closeTo(-1, 6),
    ]);
    // A ponta da chuteira (+0,55 + 5,25/2 no z do osso) fica à frente: z < 0.
    const toe = point(at0, FIGURE_BONE.footR * 16, 0, -1.15, 0.55 + 5.25 / 2);
    expect(toe[2]).toBeLessThan(0);
    const at90 = bonesOf(FIGURE_REST_POSE, Math.PI / 2);
    expect(at90[H + 8]! / PX).toBeCloseTo(-1, 6);
    expect(at90[R + 14]! / PX).toBeCloseTo(-6, 5);
  });

  it('topo em pé (repouso, pitch 0) = 1,75 m; sola 0; o olho 1,55 cai nas linhas 7–8 do rosto', () => {
    const bounds = boxBounds(bonesOf(FIGURE_REST_POSE));
    const head = bounds[0]!;
    expect(Math.abs(head.hi[1] - BODY_HEIGHT)).toBeLessThan(1e-6);
    expect(head.hi[1] - head.lo[1]).toBeCloseTo(0.4375, 6);
    expect(Math.min(bounds[10]!.lo[1], bounds[11]!.lo[1])).toBeCloseTo(0, 6);
    // Rosto 16 t em 8 px (2 t/px); as linhas 7–8 vão de 3,5 a 4,5 px abaixo do topo.
    const eyeLo = head.hi[1] - 4.5 * PX;
    const eyeHi = head.hi[1] - 3.5 * PX;
    expect(eyeLo).toBeCloseTo(1.504, 3);
    expect(eyeHi).toBeCloseTo(1.559, 3);
    expect(EYE_HEIGHT).toBeGreaterThan(eyeLo);
    expect(EYE_HEIGHT).toBeLessThan(eyeHi);
  });

  it('achatamento e escala vão na raiz, presos aos pés', () => {
    const root = new Float32Array(16);
    const out = new Float32Array(FIGURE_BONES * 16);
    figureRoot(root, 0, 0, 0, 0, 0, 1.5, 0.05);
    figureFk(FIGURE_REST_POSE, 0, root, 0, out, 0);
    const b = boxBounds(out);
    expect(b[0]!.hi[1]).toBeCloseTo(BODY_HEIGHT * 1.5 * 1.05, 5);
    expect(Math.min(b[10]!.lo[1], b[11]!.lo[1])).toBeCloseTo(0, 6);
  });
});

describe('figure: poses base', () => {
  it('repouso do FutBobo: ARM_REST espelhado, sem respiração, pernas retas e pé plano', () => {
    const p = FIGURE_REST_POSE;
    expect([get(p, 'shLX'), get(p, 'shLY'), get(p, 'shLZ'), get(p, 'elL')]).toEqual([
      0,
      0,
      expect.closeTo(0.09, 6),
      expect.closeTo(-0.14, 6),
    ]);
    expect(get(p, 'shRX')).toBe(get(p, 'shLX'));
    expect(get(p, 'shRY')).toBe(-get(p, 'shLY'));
    expect(get(p, 'shRZ')).toBe(-get(p, 'shLZ'));
    expect(get(p, 'elR')).toBe(get(p, 'elL'));
    const arms = new Set<Key>(['shLX', 'shLY', 'shLZ', 'elL', 'shRX', 'shRY', 'shRZ', 'elR']);
    for (const k of Object.keys(FIGURE_POSE) as Key[]) if (!arms.has(k)) expect(get(p, k), k).toBe(0);
  });

  it('agachado P4f: topo 0,940 ± 0,002 m, |z| ≤ 0,30 m, sola em [0; 0,002] m', () => {
    const e = extents(FIGURE_CROUCH_POSE);
    expect(Math.abs(e.hi[1] - 0.94)).toBeLessThanOrEqual(0.002);
    expect(Math.max(Math.abs(e.lo[2]), Math.abs(e.hi[2]))).toBeLessThanOrEqual(AABB_HALF_WIDTH);
    expect(e.lo[1]).toBeGreaterThanOrEqual(0);
    expect(e.lo[1]).toBeLessThanOrEqual(0.002);
    expect(e.hi[1]).toBeLessThanOrEqual(FIGURE_CROUCH_TOP_M);
    // Meia faixa z 0,286 m e centro da cabeça a 0,722 m (PLANO §B4), ± 1 mm.
    expect(Math.abs((e.hi[2] - e.lo[2]) / 2 - 0.286)).toBeLessThanOrEqual(0.001);
    const head = boxBounds(bonesOf(FIGURE_CROUCH_POSE))[0]!;
    expect(Math.abs((head.lo[1] + head.hi[1]) / 2 - 0.722)).toBeLessThanOrEqual(0.001);
  });

  it('agachado P4f: as constantes congeladas refazem o fechamento', () => {
    const p = FIGURE_CROUCH_POSE;
    const hipX = get(p, 'hipLX');
    const knee = get(p, 'kneeL');
    expect(get(p, 'hipRX')).toBe(hipX);
    expect(get(p, 'kneeR')).toBe(knee);
    expect(get(p, 'hipLZ')).toBe(0);
    expect(get(p, 'hipRZ')).toBe(0);
    // Quadril pelo legDrop (sola no chão), tornozelo pelo pé plano, cabeça na vertical.
    expect(Math.abs(get(p, 'bodyY') + legDrop(hipX, 0, knee))).toBeLessThan(1e-3);
    expect(get(p, 'ankleL')).toBeCloseTo(flatAnkle(hipX + knee), 4);
    expect(get(p, 'ankleR')).toBeCloseTo(flatAnkle(hipX + knee), 4);
    expect(get(p, 'neckX')).toBe(-get(p, 'torsoX'));
    expect(get(p, 'neckSink')).toBe(4);
    // bodyZ centra a faixa z (no frame do FutBobo; com yaw 0 o z do mundo é o oposto).
    const free = p.slice();
    free[FIGURE_POSE.bodyZ] = 0;
    const e = extents(free);
    expect(Math.abs(get(p, 'bodyZ') - (e.lo[2] + e.hi[2]) / 2 / PX)).toBeLessThan(0.01);
  });

  it('deslize "carrinho": topo ≤ 0,95 m (0,928), sola no chão, pé plano do FutBobo', () => {
    const p = FIGURE_SLIDE_POSE;
    const e = extents(p);
    expect(e.hi[1]).toBeLessThanOrEqual(0.95);
    expect(Math.abs(e.hi[1] - 0.928)).toBeLessThanOrEqual(0.001);
    expect(e.lo[1]).toBeGreaterThanOrEqual(0);
    expect(e.lo[1]).toBeLessThanOrEqual(0.005);
    expect(get(p, 'ankleL')).toBeCloseTo(flatAnkle(get(p, 'hipLX') + get(p, 'kneeL')), 4);
    expect(get(p, 'ankleR')).toBeCloseTo(flatAnkle(get(p, 'hipRX') + get(p, 'kneeR')), 4);
    expect(get(p, 'neckX')).toBe(-get(p, 'torsoX'));
    const free = p.slice();
    free[FIGURE_POSE.bodyZ] = 0;
    const f = extents(free);
    expect(Math.abs(get(p, 'bodyZ') - (f.lo[2] + f.hi[2]) / 2 / PX)).toBeLessThan(0.02);
    // Faixa z (E.13, ± 1 mm): ±0,654 m com o bodyZ −1,3; antes de recentrar, 0,725 m à frente e 0,582 m atrás (com yaw
    // 0 a frente é −Z). O "−0,58..+0,72" do §B4 é a faixa SEM o bodyZ.
    expect(Math.abs((e.hi[2] - e.lo[2]) / 2 - 0.654)).toBeLessThanOrEqual(0.001);
    expect(Math.abs(f.lo[2] + 0.725)).toBeLessThanOrEqual(0.001);
    expect(Math.abs(f.hi[2] - 0.582)).toBeLessThanOrEqual(0.001);
    // Centro da cabeça 0,414 m atrás do eixo do olho (o "~0,27 m" do §B3 trocou o sinal do bodyZ) e a 0,709 m de altura.
    const head = boxBounds(bonesOf(p))[0]!;
    expect(Math.abs((head.lo[2] + head.hi[2]) / 2 - 0.414)).toBeLessThanOrEqual(0.001);
    expect(Math.abs((head.lo[1] + head.hi[1]) / 2 - 0.709)).toBeLessThanOrEqual(0.001);
  });

  it('zumbi: tronco +0,35, braços à frente, pescoço −0,2; cabe sob a altura em pé', () => {
    const p = FIGURE_ZOMBIE_POSE;
    expect(get(p, 'torsoX')).toBeCloseTo(0.35, 6);
    expect(get(p, 'neckX')).toBeCloseTo(-0.2, 6);
    expect([get(p, 'shLX'), get(p, 'shLZ'), get(p, 'elL')].map((v) => +v.toFixed(4))).toEqual([-1.47, 0.1, -0.1]);
    expect([get(p, 'shRX'), get(p, 'shRZ'), get(p, 'elR')].map((v) => +v.toFixed(4))).toEqual([-1.47, -0.1, -0.1]);
    const e = extents(p);
    expect(e.hi[1]).toBeLessThan(BODY_HEIGHT);
    expect(Math.abs(e.lo[1])).toBeLessThan(1e-6);
  });
});

describe('figure: posturas', () => {
  const stances: FigureStance[] = [0, 1, 2];
  const grips: FigureGrip[] = [0, 1, 2, 3];
  const modes: FigureMode[] = [0, 1, 2];

  it('as 22 combinações válidas mapeiam 1:1 para 0..21 (zumbi = 21), e o FIGURE_POSTURE_INFO as decompõe', () => {
    const valid: [FigureStance, FigureGrip, FigureMode][] = [];
    for (const s of stances) {
      for (const g of grips) {
        for (const m of modes) {
          const ok =
            (g !== FIGURE_GRIP.none || m === FIGURE_MODE.base) &&
            (s !== FIGURE_STANCE.slide || m === FIGURE_MODE.base) &&
            (s === FIGURE_STANCE.stand || m !== FIGURE_MODE.sprint);
          if (ok) valid.push([s, g, m]);
        }
      }
    }
    expect(valid.length + 1).toBe(FIGURE_POSTURES);
    const seen = new Set<number>();
    for (const [s, g, m] of valid) {
      const p = figurePosture(s, g, m, false);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(21);
      expect([...FIGURE_POSTURE_INFO.subarray(p * 3, p * 3 + 3)], `postura ${p}`).toEqual([s, g, m]);
      seen.add(p);
    }
    expect(seen.size).toBe(21);
    expect(figurePosture(0, 0, 0, true)).toBe(21);
    expect(FIGURE_POSTURE_INFO.length).toBe(FIGURE_POSTURES * 3);
    expect([...FIGURE_POSTURE_INFO.subarray(63, 66)]).toEqual([0, 0, 0]);
    // Contagem por stance: em pé 10, agachado 7, deslizando 4.
    const count = [0, 0, 0];
    for (let p = 0; p < 21; p++) count[FIGURE_POSTURE_INFO[p * 3]!]!++;
    expect(count).toEqual([10, 7, 4]);
  });

  it('regras: zumbi vence tudo; sem arma o modo é base; deslizando o modo é base; correr só em pé', () => {
    for (const s of stances) {
      for (const g of grips) {
        for (const m of modes) {
          expect(figurePosture(s, g, m, true)).toBe(21);
          const p = figurePosture(s, g, m, false);
          if (g === FIGURE_GRIP.none)
            expect(p, `sem arma ${s}/${m}`).toBe(figurePosture(s, g, FIGURE_MODE.base, false));
          if (s === FIGURE_STANCE.slide)
            expect(p, `deslize ${g}/${m}`).toBe(figurePosture(s, g, FIGURE_MODE.base, false));
          if (s === FIGURE_STANCE.crouch && m === FIGURE_MODE.sprint) {
            expect(p, `agachado correndo ${g}`).toBe(figurePosture(s, g, FIGURE_MODE.base, false));
          }
          // A postura nunca muda de stance nem de arma.
          expect(FIGURE_POSTURE_INFO[p * 3]).toBe(s);
          expect(FIGURE_POSTURE_INFO[p * 3 + 1]).toBe(g);
        }
      }
    }
    // Em pé armado, correr e mirar são posturas próprias.
    const base = figurePosture(0, FIGURE_GRIP.rifle, FIGURE_MODE.base, false);
    expect(figurePosture(0, FIGURE_GRIP.rifle, FIGURE_MODE.sprint, false)).not.toBe(base);
    expect(figurePosture(0, FIGURE_GRIP.rifle, FIGURE_MODE.ads, false)).not.toBe(base);
    expect(figurePosture(FIGURE_STANCE.crouch, FIGURE_GRIP.rifle, FIGURE_MODE.ads, false)).not.toBe(
      figurePosture(FIGURE_STANCE.crouch, FIGURE_GRIP.rifle, FIGURE_MODE.base, false),
    );
  });
});
