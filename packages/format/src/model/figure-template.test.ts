import { describe, expect, it } from 'vitest';
import {
  FIGURE_BODY_BOXES,
  FIGURE_BONE,
  FIGURE_BOX_FIELD as F,
  FIGURE_BOX_STRIDE,
  FIGURE_MAX_BOXES,
} from './figure.ts';
import { FIGURE_BEARD_LONG } from './figure-hair.ts';
import { FIGURE_LAYOUT } from './figure-layout.ts';
import { FIGURE_LOOK_DEFAULT, type FigureLook } from './figure-look.ts';
import { FIGURE_PRESETS } from './figure-presets.ts';
import { buildFigureTemplate, createFigureTemplateSet, figureHairBoxes } from './figure-template.ts';

const BODY = 14;
const body = Array.from(FIGURE_BODY_BOXES);
const hairOf = (look: FigureLook): number[] => {
  const out = new Float32Array(28 * FIGURE_BOX_STRIDE);
  const n = figureHairBoxes(look, out, 0);
  return Array.from(out.subarray(0, n * FIGURE_BOX_STRIDE));
};

describe('gabarito do boneco', () => {
  it('buildFigureTemplate: as 14 caixas do corpo e depois o cabelo do look, em out[o ..]', () => {
    const out = new Float32Array(2 + FIGURE_MAX_BOXES * FIGURE_BOX_STRIDE).fill(-1);
    // Franja (corte 1) sem chapéu, barba longa nem brinco: casca + franja. O look é montado aqui (o padrão e os presets
    // são da F2 e podem mudar sem quebrar este teste).
    const look: FigureLook = { ...FIGURE_LOOK_DEFAULT, hairStyle: 1, headwear: 0, beard: 0, earrings: 0, zombie: null };
    const n = buildFigureTemplate(look, out, 2);
    expect(n).toBe(BODY + 2);
    expect([out[0], out[1]]).toEqual([-1, -1]);
    expect(Array.from(out.subarray(2, 2 + BODY * FIGURE_BOX_STRIDE))).toEqual(body);
    expect(Array.from(out.subarray(2 + BODY * FIGURE_BOX_STRIDE, 2 + n * FIGURE_BOX_STRIDE))).toEqual(hairOf(look));
    expect(out[2 + n * FIGURE_BOX_STRIDE]).toBe(-1);
  });

  it('zumbi: o mesmo corpo de todos (#58: manga, antebraço, coxa e canela já leem as colunas da farda)', () => {
    const out = new Float32Array(FIGURE_MAX_BOXES * FIGURE_BOX_STRIDE);
    const zombie = FIGURE_PRESETS.zombie;
    expect(zombie.zombie).not.toBeNull();
    const n = buildFigureTemplate(zombie, out, 0);
    expect(n).toBe(BODY + hairOf(zombie).length / FIGURE_BOX_STRIDE);
    expect(Array.from(out.subarray(0, BODY * FIGURE_BOX_STRIDE))).toEqual(body);
    // As colunas que a skin do zumbi pinta rasgadas são as do corpo.
    const B = FIGURE_BONE;
    const L = FIGURE_LAYOUT;
    const uv = (i: number): number[] => [F.layer, F.u, F.v, F.w, F.h, F.d].map((f) => out[i * FIGURE_BOX_STRIDE + f]!);
    const cross = (r: { layer: number; u: number; v: number; w: number; h: number; d: number }): number[] => [
      r.layer,
      r.u,
      r.v,
      r.w,
      r.h,
      r.d,
    ];
    for (const i of [B.upperArmR, B.upperArmL]) expect(uv(i)).toEqual(cross(L.sleeve));
    for (const i of [B.forearmR, B.forearmL]) expect(uv(i)).toEqual(cross(L.forearm));
    for (const i of [B.thighR, B.thighL]) expect(uv(i)).toEqual(cross(L.thigh));
  });

  it('createFigureTemplateSet aloca count × FIGURE_MAX_BOXES × FIGURE_BOX_STRIDE e monta cada look no seu bloco', () => {
    const looks = [FIGURE_PRESETS.recruit, FIGURE_PRESETS.zombie, FIGURE_PRESETS.trancas];
    const set = createFigureTemplateSet(looks);
    expect(set.count).toBe(3);
    expect(set.boxes.length).toBe(3 * FIGURE_MAX_BOXES * FIGURE_BOX_STRIDE);
    // Corpo + o cabelo de cada look (os presets são da F2: a conta sai do look, sem número travado aqui).
    expect(Array.from(set.length)).toEqual(looks.map((l) => BODY + hairOf(l).length / FIGURE_BOX_STRIDE));
    const block = FIGURE_MAX_BOXES * FIGURE_BOX_STRIDE;
    for (let i = 0; i < 3; i++) {
      const one = new Float32Array(block);
      buildFigureTemplate(looks[i]!, one, 0);
      expect(Array.from(set.boxes.subarray(i * block, (i + 1) * block))).toEqual(Array.from(one));
    }
    expect(createFigureTemplateSet([]).boxes.length).toBe(0);
  });

  it('todo preset e toda combinação de cabelo cabem em FIGURE_MAX_BOXES (≤ 42)', () => {
    const out = new Float32Array(FIGURE_MAX_BOXES * FIGURE_BOX_STRIDE);
    for (const [id, look] of Object.entries(FIGURE_PRESETS)) {
      const n = buildFigureTemplate(look, out, 0);
      expect(n, id).toBeLessThanOrEqual(FIGURE_MAX_BOXES);
      expect(n, id).toBeGreaterThanOrEqual(BODY);
    }
    let max = 0;
    for (let hairStyle = 0; hairStyle < 34; hairStyle++)
      for (let headwear = 0; headwear < 5; headwear++)
        for (const beard of [0, FIGURE_BEARD_LONG])
          for (let earrings = 0; earrings < 4; earrings++) {
            const look = { ...FIGURE_LOOK_DEFAULT, hairStyle, headwear, beard, earrings };
            max = Math.max(max, buildFigureTemplate(look, out, 0));
          }
    expect(max).toBe(42);
  });

  it('teto de 255 gabaritos (o índice 255 é NO_FIGURE no ActorBuffer): 255 passa, 256 lança', () => {
    const looks = new Array<typeof FIGURE_LOOK_DEFAULT>(256).fill(FIGURE_LOOK_DEFAULT);
    expect(createFigureTemplateSet(looks.slice(0, 255)).count).toBe(255);
    expect(() => createFigureTemplateSet(looks)).toThrow('256 gabaritos');
  });
});
