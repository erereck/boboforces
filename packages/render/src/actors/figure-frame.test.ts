// Quadro dos bonecos com o rig de repouso: recorte do cabelo no teto (E.3, parte do render: 34 cortes × 5 chapéus com
// a cabeça reta ≤ 0,99 + 0,005 agachado), caixas extras = cópia do osso, arma na mão pela matriz do rig e o rig real da
// F4 no mesmo contrato.
import {
  createFigureGameTable,
  createFigureTemplateSet,
  FIGURE_BOX_FIELD,
  FIGURE_BOX_FLAG,
  FIGURE_BOX_STRIDE,
  FIGURE_GRIP,
  FIGURE_HEADWEAR,
  FIGURE_LOOK_DEFAULT,
  FIGURE_MAX_BOXES,
  FIGURE_MODE,
  FIGURE_STANCE,
  figurePosture,
  normalizeFigureLook,
  type FigureGameTable,
} from '@boboforces/format';
import { describe, expect, it } from 'vitest';
import { createFrameViews, type FrameContext } from '../shared/passes.ts';
import { createActorBuffer, createRenderDebug, type ActorBuffer } from '../types.ts';
import { buildFigureCubeGeometry, figureVertexLocal } from './figure-cube.ts';
import { clipHairBox, createFigureFrame } from './figure-frame.ts';
import { FIGURE_HAIR_CEILING, createRestFigureRig } from './figure-rest-rig.ts';
import { INSTANCE_FLOATS } from './layout.ts';
import { MAT4 } from './math.ts';

const F = FIGURE_BOX_FIELD;
let table: FigureGameTable | null = null;
const gameTable = (): FigureGameTable => (table ??= createFigureGameTable());
const cube = buildFigureCubeGeometry();

function frameCtx(): FrameContext {
  return { dt: 1 / 60, timeS: 0, debug: createRenderDebug(), world: null, views: createFrameViews() };
}

function oneActor(posture: number, figure = 0, weapon = 255): ActorBuffer {
  const a = createActorBuffer(4);
  a.count = 1;
  a.entity[0] = 0x00010001;
  a.position.set([1, 0.5, -2], 0);
  a.yaw[0] = 0.4;
  a.figure[0] = figure;
  a.posture[0] = posture;
  a.weapon[0] = weapon;
  a.localSlot[0] = 255;
  return a;
}

/** Maior y do mundo dos vértices das caixas com a flag `hair` do ator 0. */
function hairTop(frame: ReturnType<typeof createFigureFrame>, boxes: Float32Array, tplBase: number): number {
  const inst = frame.instances;
  const r = inst.actorRecord[0]!;
  const local = new Float32Array(6);
  let top = -Infinity;
  for (let k = 0; k < inst.recBoxes[r]!; k++) {
    if ((Math.round(boxes[tplBase + k * FIGURE_BOX_STRIDE + F.flags]!) & FIGURE_BOX_FLAG.hair) === 0) continue;
    const o = (inst.recStart[r]! + k) * MAT4;
    const m = inst.matrices;
    for (let v = 0; v < cube.vertexCount; v++) {
      figureVertexLocal(cube, v, inst.data, (inst.recStart[r]! + k) * INSTANCE_FLOATS, local, 0);
      const y = m[o + 1]! * local[0]! + m[o + 5]! * local[1]! + m[o + 9]! * local[2]! + m[o + 13]!;
      top = Math.max(top, y);
    }
  }
  return top;
}

describe('quadro dos bonecos (rig de repouso)', () => {
  it('E.3 (render): cabelo dos 34 cortes × 5 chapéus recortado no teto (agachado ≤ 0,995; em pé ≤ 1,995 acima dos pés)', () => {
    const looks = [];
    for (let hairStyle = 0; hairStyle < 34; hairStyle++) {
      for (const headwear of Object.values(FIGURE_HEADWEAR)) {
        looks.push(normalizeFigureLook({ ...FIGURE_LOOK_DEFAULT, hairStyle, headwear }));
      }
    }
    const templates = createFigureTemplateSet(looks);
    const frame = createFigureFrame(createRestFigureRig());
    frame.setFigures(templates, gameTable());
    const crouch = figurePosture(FIGURE_STANCE.crouch, FIGURE_GRIP.none, FIGURE_MODE.base, false);
    const stand = figurePosture(FIGURE_STANCE.stand, FIGURE_GRIP.none, FIGURE_MODE.base, false);
    let cut = 0;
    let worstLow = -Infinity;
    let worstHigh = -Infinity;
    for (let t = 0; t < templates.count; t++) {
      const base = t * FIGURE_MAX_BOXES * FIGURE_BOX_STRIDE;
      for (const [posture, ceiling] of [
        [crouch, FIGURE_HAIR_CEILING.low],
        [stand, FIGURE_HAIR_CEILING.stand],
      ] as const) {
        const a = oneActor(posture, t);
        frame.update(frameCtx(), a, t * 2 + (posture === crouch ? 1 : 2));
        const top = hairTop(frame, templates.boxes, base) - 0.5;
        if (posture === crouch) worstLow = Math.max(worstLow, top);
        else worstHigh = Math.max(worstHigh, top);
        expect(top, `gabarito ${t} postura ${posture}`).toBeLessThanOrEqual(ceiling + 0.005);
        if (posture === crouch && top > 0.98) cut++;
      }
    }
    // Agachado, os cortes altos encostam no teto (topo plano a 0,99).
    expect(cut).toBeGreaterThan(20);
    expect(worstLow).toBeGreaterThan(0.95);
    expect(worstHigh).toBeLessThanOrEqual(1.995);
  });

  it('recorte: caixa abaixo do teto intacta, cortada encolhe da base, toda acima some', () => {
    const m = new Float32Array(16);
    const reset = () => m.set([0.05, 0, 0, 0, 0, 0.05, 0, 0, 0, 0, 0.05, 0, 0, 1, 0, 0]);
    reset();
    expect(clipHairBox(m, 0, 2, 6, 1 + 0.05 * 10)).toBe(1);
    expect(clipHairBox(m, 0, 2, 6, 1 + 0.05 * 4)).toBeCloseTo(0.5, 6);
    // Base continua em y = 1 + 0,05·2 e o topo vai a 1 + 0,05·4.
    expect(m[5]! * 2 + m[13]!).toBeCloseTo(1 + 0.05 * 2, 6);
    expect(m[5]! * 6 + m[13]!).toBeCloseTo(1 + 0.05 * 4, 6);
    reset();
    expect(clipHairBox(m, 0, 2, 6, 1)).toBe(0);
    expect([...m.slice(0, 15)].filter((v, k) => (k & 3) !== 3 && v !== 0)).toEqual([]);
    reset();
    expect(clipHairBox(m, 0, 2, 6, Infinity)).toBe(1);
  });

  it('mãos = antebraço; arma = antebraço D × empunhadura (m, no soquete); manequim posa uma vez', () => {
    const templates = createFigureTemplateSet([FIGURE_LOOK_DEFAULT]);
    const frame = createFigureFrame(createRestFigureRig());
    frame.setFigures(templates, gameTable());
    const rifle = figurePosture(FIGURE_STANCE.stand, FIGURE_GRIP.rifle, FIGURE_MODE.base, false);
    const a = oneActor(rifle, 0, 0);
    frame.update(frameCtx(), a, 1);
    const inst = frame.instances;
    const r = inst.actorRecord[0]!;
    const s = inst.recStart[r]!;
    const m = inst.matrices;
    // Caixa 12 (mão D) e 13 (mão E) = osso 4 e 5 (parte afim).
    for (const [hand, bone] of [
      [12, 4],
      [13, 5],
    ]) {
      for (let k = 0; k < 15; k++) if ((k & 3) !== 3) expect(m[(s + hand!) * 16 + k]).toBe(m[(s + bone!) * 16 + k]);
    }
    expect(inst.recArmed[r]).toBe(1);
    const w = inst.recWeapon.slice(r * 16, r * 16 + 16);
    // Giro sem escala (metros): colunas unitárias; a arma fica perto da mão D (≤ 0,15 m do centro da mão).
    for (let c = 0; c < 3; c++) expect(Math.hypot(w[c * 4]!, w[c * 4 + 1]!, w[c * 4 + 2]!)).toBeCloseTo(1, 4);
    const hx = m[(s + 4) * 16]! * 0 + m[(s + 4) * 16 + 4]! * -5.6 + m[(s + 4) * 16 + 12]!;
    const hy = m[(s + 4) * 16 + 1]! * 0 + m[(s + 4) * 16 + 5]! * -5.6 + m[(s + 4) * 16 + 13]!;
    const hz = m[(s + 4) * 16 + 2]! * 0 + m[(s + 4) * 16 + 6]! * -5.6 + m[(s + 4) * 16 + 14]!;
    expect(Math.hypot(w[12]! - hx, w[13]! - hy, w[14]! - hz)).toBeLessThan(0.15);
    // Sem arma na postura: não arma.
    const b = oneActor(0, 0, 0);
    b.entity[0] = 0x00020001;
    frame.update(frameCtx(), b, 2);
    expect(inst.recArmed[inst.actorRecord[0]!]).toBe(0);
  });
});
