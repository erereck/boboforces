// E.15 (PLANO do porte §E): os 6 grupos particionam as caixas; a pose inicial do cadáver = o último quadro, com a dobra
// do cotovelo e do joelho (≤ 1e−5); a dobra continua enquanto os corpos rolam; acerto na parte p lê o texel de uma caixa
// do osso p; mão D atingida → amostra 7 (a luva).
import {
  createFigureTemplateSet,
  FACE_EXPRESSION,
  FIGURE_BONE_GROUP,
  FIGURE_BONES,
  FIGURE_BOX_FIELD,
  FIGURE_BOX_STRIDE,
  FIGURE_CROUCH_POSE,
  FIGURE_LOOK_DEFAULT,
  FIGURE_MAX_BOXES,
  FIGURE_POSE,
  FIGURE_PRESETS,
  FIGURE_SWATCH,
  figureFk,
  figureRoot,
  figureSwatchCorner,
} from '@boboforces/format';
import { describe, expect, it } from 'vitest';
import { figureRow4Expression } from '../actors/figure-row4.ts';
import { MAT4 } from '../actors/math.ts';
import type { AssembledTextureArray } from '../types.ts';
import { figureBoxTexelColor, figureHitBox } from './colors.ts';
import {
  createFigureCorpsePool,
  createFigureCorpseSpec,
  FIGURE_CORPSE_GROUPS,
  FIGURE_GROUP_ROOT,
  spawnFigureCorpse,
  stepFigureCorpses,
} from './figure-corpses.ts';

const F = FIGURE_BOX_FIELD;
const looks = [FIGURE_LOOK_DEFAULT, ...Object.values(FIGURE_PRESETS)];
const templates = createFigureTemplateSet(looks);
const rng = { next: () => 0.5 };

/** 12 ossos de um boneco agachado com os cotovelos dobrados, em (x, y, z) com giro e escala. */
function bentBones(): Float32Array {
  const pose = new Float32Array(FIGURE_CROUCH_POSE);
  pose[FIGURE_POSE.elR] = 1.1;
  pose[FIGURE_POSE.elL] = 0.7;
  pose[FIGURE_POSE.shRX] = -0.6;
  const root = new Float32Array(16);
  figureRoot(root, 0, 3, 0.25, -4, 0.8, 1.1, 0);
  const bones = new Float32Array(FIGURE_BONES * MAT4);
  figureFk(pose, 0, root, 0, bones, 0);
  return bones;
}

/** Array de 64×64 com 2 níveis: o texel diz onde está (x, y) e a camada e o nível no azul. */
function fakeModels(layers: number): AssembledTextureArray {
  const levels = [64, 32].map((size, level) => {
    const out = new Uint8Array(layers * size * size * 4);
    for (let l = 0; l < layers; l++)
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) out.set([x, y, l * 16 + level, 255], ((l * size + y) * size + x) * 4);
    return out;
  });
  return {
    name: 'modelos64',
    data: { width: 64, height: 64, layers, levels },
    layers: new Map(),
    info: [],
    reservedStart: 0,
    reservedCount: layers,
  };
}

describe('desmonte e cubinhos do boneco do FutBobo (E.15)', () => {
  it('os 6 grupos particionam as caixas de todo gabarito; a raiz de cada grupo é dele', () => {
    for (let g = 0; g < FIGURE_CORPSE_GROUPS; g++) expect(FIGURE_BONE_GROUP[FIGURE_GROUP_ROOT[g]!]).toBe(g);
    for (let t = 0; t < templates.count; t++) {
      const seen = new Array<number>(FIGURE_CORPSE_GROUPS).fill(0);
      for (let k = 0; k < templates.length[t]!; k++) {
        const bone = templates.boxes[t * FIGURE_MAX_BOXES * FIGURE_BOX_STRIDE + k * FIGURE_BOX_STRIDE + F.bone]!;
        const g = FIGURE_BONE_GROUP[bone]!;
        expect(g >= 0 && g < FIGURE_CORPSE_GROUPS).toBe(true);
        seen[g]!++;
      }
      expect(seen.every((n) => n > 0)).toBe(true);
      expect(seen.reduce((a, b) => a + b, 0)).toBe(templates.length[t]);
    }
  });

  it('nasce do último quadro com a dobra (≤ 1e−5) e a dobra fica enquanto os corpos rolam', () => {
    const bones = bentBones();
    const pool = createFigureCorpsePool(2);
    const spec = createFigureCorpseSpec();
    spec.skin = 40;
    spec.sky = 0.6;
    spec.force = 5;
    spec.dirZ = -1;
    spec.bodyPart = 4;
    const t = 3;
    const c = spawnFigureCorpse(pool, bones, 0, templates, t, spec, rng);
    const n = templates.length[t]!;
    let worst = 0;
    for (let k = 0; k < n; k++) {
      const bone = templates.boxes[t * FIGURE_MAX_BOXES * FIGURE_BOX_STRIDE + k * FIGURE_BOX_STRIDE + F.bone]!;
      for (let q = 0; q < 15; q++) {
        if ((q & 3) === 3) continue;
        worst = Math.max(
          worst,
          Math.abs(pool.matrices[(c * FIGURE_MAX_BOXES + k) * MAT4 + q]! - bones[bone * MAT4 + q]!),
        );
      }
    }
    expect(worst).toBeLessThanOrEqual(1e-5);
    // Expressão `dead` e a luz do cadáver na 4ª linha.
    expect(figureRow4Expression(pool.matrices[c * FIGURE_MAX_BOXES * MAT4 + 15]!)).toBe(FACE_EXPRESSION.dead);
    expect(pool.matrices[c * FIGURE_MAX_BOXES * MAT4 + 3]).toBeCloseTo(0.6, 6);
    expect(pool.highWater).toBe((c + 1) * FIGURE_MAX_BOXES);

    // O cotovelo D (manga → antebraço) e o joelho continuam dobrados como no último quadro: o giro relativo não muda.
    const relative = (a: number, b: number): number[] => {
      const m = pool.matrices;
      const oa = (c * FIGURE_MAX_BOXES + a) * MAT4;
      const ob = (c * FIGURE_MAX_BOXES + b) * MAT4;
      const dot = (i: number, j: number) =>
        (m[oa + i * 4]! * m[ob + j * 4]! +
          m[oa + i * 4 + 1]! * m[ob + j * 4 + 1]! +
          m[oa + i * 4 + 2]! * m[ob + j * 4 + 2]!) /
        Math.hypot(m[oa + i * 4]!, m[oa + i * 4 + 1]!, m[oa + i * 4 + 2]!) /
        Math.hypot(m[ob + j * 4]!, m[ob + j * 4 + 1]!, m[ob + j * 4 + 2]!);
      return [dot(0, 0), dot(1, 1), dot(2, 2), dot(1, 2)];
    };
    const elbow = relative(2, 4);
    const knee = relative(6, 8);
    expect(elbow[1]!).toBeLessThan(0.9); // dobrado de verdade
    for (let s = 0; s < 40; s++) stepFigureCorpses(pool, 1 / 60, null);
    const elbow2 = relative(2, 4);
    const knee2 = relative(6, 8);
    for (let k = 0; k < 4; k++) {
      expect(elbow2[k]).toBeCloseTo(elbow[k]!, 4);
      expect(knee2[k]).toBeCloseTo(knee[k]!, 4);
    }
    // O corpo caiu (gravidade) e o cadáver some depois da vida.
    for (let s = 0; s < 300; s++) stepFigureCorpses(pool, 1 / 60, null);
    expect(pool.alive[c]).toBe(0);
    expect(pool.highWater).toBe(0);
  });

  it('acerto na parte p lê o texel de uma caixa do osso p; mão D → amostra 7', () => {
    const bones = bentBones();
    const t = 0;
    const n = templates.length[t]!;
    const base = t * FIGURE_MAX_BOXES * FIGURE_BOX_STRIDE;
    // As matrizes das caixas do ator: o osso de cada uma (como o quadro escreve).
    const matrices = new Float32Array(n * MAT4);
    for (let k = 0; k < n; k++) {
      const bone = templates.boxes[base + k * FIGURE_BOX_STRIDE + F.bone]!;
      matrices.set(bones.subarray(bone * MAT4, bone * MAT4 + 16), k * MAT4);
    }
    const models = fakeModels(4);
    const skin = 2;
    const local = new Float32Array(3);
    for (let p = 0; p < FIGURE_BONES; p++) {
      // Ponto do acerto: perto da frente (+z do FutBobo) da caixa primária do osso p.
      const b = base + p * FIGURE_BOX_STRIDE;
      const lx = templates.boxes[b + F.cx]! + 0.1;
      const ly = templates.boxes[b + F.cy]! + 0.2;
      const lz = templates.boxes[b + F.cz]! + templates.boxes[b + F.sz]! * 0.45;
      const o = p * MAT4;
      const x = bones[o]! * lx + bones[o + 4]! * ly + bones[o + 8]! * lz + bones[o + 12]!;
      const y = bones[o + 1]! * lx + bones[o + 5]! * ly + bones[o + 9]! * lz + bones[o + 13]!;
      const z = bones[o + 2]! * lx + bones[o + 6]! * ly + bones[o + 10]! * lz + bones[o + 14]!;
      const k = figureHitBox(matrices, 0, templates.boxes, base, n, p, x, y, z, local);
      expect(k, `osso ${p}`).toBeGreaterThanOrEqual(0);
      expect(templates.boxes[base + k * FIGURE_BOX_STRIDE + F.bone]).toBe(p);
      const rgb = figureBoxTexelColor(
        models,
        skin,
        templates.boxes,
        base + k * FIGURE_BOX_STRIDE,
        local[0]!,
        local[1]!,
        local[2]!,
        0,
        0,
      );
      const tx = (rgb >> 16) & 0xff;
      const ty = (rgb >> 8) & 0xff;
      const tl = rgb & 0xff;
      const box = base + k * FIGURE_BOX_STRIDE;
      // Nível 1, camada = 1ª da skin + camada da caixa.
      expect(tl, `osso ${p}`).toBe((skin + templates.boxes[box + F.layer]!) * 16 + 1);
      // Dentro da cruz da caixa (no nível 1: metade).
      const u = templates.boxes[box + F.u]!;
      const v = templates.boxes[box + F.v]!;
      const w = templates.boxes[box + F.w]!;
      const h = templates.boxes[box + F.h]!;
      const d = templates.boxes[box + F.d]!;
      expect(tx * 2 + 1 >= u && tx * 2 <= u + 2 * d + 2 * w, `osso ${p} u`).toBe(true);
      expect(ty * 2 + 1 >= v && ty * 2 <= v + d + h, `osso ${p} v`).toBe(true);
    }
    // Mão D (caixa 12, no osso do antebraço D, 4) é amostra de paleta: devolve o texel da amostra 7 (a luva; a manga
    // virou coluna com a farda da #58).
    const corner = figureSwatchCorner(FIGURE_SWATCH.hand);
    const h = 4 * 16;
    const k = figureHitBox(
      matrices,
      0,
      templates.boxes,
      base,
      n,
      4,
      bones[h + 4]! * -5.6 + bones[h + 12]!,
      bones[h + 5]! * -5.6 + bones[h + 13]!,
      bones[h + 6]! * -5.6 + bones[h + 14]!,
      local,
    );
    expect(k).toBe(12);
    const rgb = figureBoxTexelColor(
      models,
      skin,
      templates.boxes,
      base + k * FIGURE_BOX_STRIDE,
      local[0]!,
      local[1]!,
      local[2]!,
      1,
      1,
    );
    expect([(rgb >> 16) & 0xff, (rgb >> 8) & 0xff]).toEqual([(corner % 64) >> 1, Math.floor(corner / 64) >> 1]);
    // Sem o nível 1 na cópia da CPU: lê o nível 0 no texel do canto.
    const level0 = { ...models, data: { ...models.data, levels: [models.data.levels[0]!] } };
    const rgb0 = figureBoxTexelColor(
      level0,
      skin,
      templates.boxes,
      base + k * FIGURE_BOX_STRIDE,
      local[0]!,
      local[1]!,
      local[2]!,
      0,
      0,
    );
    expect([(rgb0 >> 16) & 0xff, (rgb0 >> 8) & 0xff]).toEqual([corner % 64, Math.floor(corner / 64)]);
  });
});
