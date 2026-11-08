import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createFigureGameTable,
  decodeModelPack,
  FIGURE_ARM_REACH,
  FIGURE_BONE,
  FIGURE_BONES,
  FIGURE_GRIP,
  FIGURE_GRIP_DEFS,
  FIGURE_GRIPS,
  FIGURE_JOINT,
  FIGURE_MODE,
  FIGURE_PALM_Y,
  FIGURE_PITCH_SAMPLES,
  FIGURE_POSE_SIZE,
  FIGURE_POSTURE_INFO,
  FIGURE_POSTURES,
  FIGURE_TEXEL_PX,
  figureFk,
  figureGamePose,
  figureGripMatrix,
  type ModelDocument,
} from '@boboforces/format';
import { describe, expect, it } from 'vitest';
import { MODELGEN_OUTPUTS, MODELS_OUT_DIR } from './paths.ts';

/**
 * E.11 (PLANO do porte do boneco): os soquetes das armas (`hand_r`, `hand_l`, `mag`) no `.bfmodel` gravado batem com as
 * empunhaduras da tabela de jogo (`FIGURE_GRIPS`, frame do FutBobo em px de boneco), e o IK da tabela leva as palmas a
 * eles em toda postura armada × amostra de pitch.
 */
const pack = decodeModelPack(readFileSync(join(MODELS_OUT_DIR, MODELGEN_OUTPUTS.pack)));
const byId = new Map<string, ModelDocument>(pack.models.map((m) => [m.id, m]));

/** Soquete no espaço do modelo inteiro (texels): posição na peça + pivôs da cadeia de peças. */
function socket(model: ModelDocument, name: string): number[] {
  const s = model.sockets.find((k) => k.name === name);
  if (s === undefined) throw new Error(`${model.id}: sem o soquete ${name}`);
  const p = [s.position[0], s.position[1], s.position[2]];
  for (let part = s.part; part >= 0; part = model.parts[part]!.parent) {
    const pivot = model.parts[part]!.pivot;
    for (let a = 0; a < 3; a++) p[a]! += pivot[a]!;
  }
  return p;
}

/** Vetor do modelo (texels, +x direita, cano para −z) no frame do FutBobo (px): Ry(π) = (−x, y, −z). */
const toFigure = (v: readonly number[]): number[] => [
  -v[0]! * FIGURE_TEXEL_PX,
  v[1]! * FIGURE_TEXEL_PX,
  -v[2]! * FIGURE_TEXEL_PX,
];
const sub = (a: readonly number[], b: readonly number[]): number[] => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];

describe('soquetes das armas × empunhaduras do boneco (E.11)', () => {
  it('hand_l − hand_r e o ponto do pente (mag + magDownT para baixo − hand_r) = FIGURE_GRIPS ± 0,25 texel', () => {
    for (const def of [FIGURE_GRIPS.pistol, FIGURE_GRIPS.rifle, FIGURE_GRIPS.sniper]) {
      const model = byId.get(def.model)!;
      expect(model, def.model).toBeDefined();
      const handR = socket(model, 'hand_r');
      const left = toFigure(sub(socket(model, 'hand_l'), handR));
      const magAt = socket(model, 'mag');
      magAt[1]! -= def.magDownT;
      const mag = toFigure(sub(magAt, handR));
      for (let a = 0; a < 3; a++) {
        expect(Math.abs(left[a]! - def.left[a]!) / FIGURE_TEXEL_PX, `${def.model} hand_l [${a}]`).toBeLessThanOrEqual(
          0.25,
        );
        expect(Math.abs(mag[a]! - def.mag[a]!) / FIGURE_TEXEL_PX, `${def.model} mag [${a}]`).toBeLessThanOrEqual(0.25);
      }
    }
    // A ordem das empunhaduras da tabela é a de FIGURE_GRIP (pistola 1, fuzil 2, sniper 3).
    expect(FIGURE_GRIP_DEFS.map((d) => d.model)).toEqual(['pistol', 'rifle', 'sniper']);
    expect([FIGURE_GRIP.pistol, FIGURE_GRIP.rifle, FIGURE_GRIP.sniper]).toEqual([1, 2, 3]);
  });

  it('IK da tabela: alcance ≤ 100% e palma ≤ 0,1 px do soquete do .bfmodel em toda postura armada × amostra', () => {
    const table = createFigureGameTable();
    const unit = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const pose = new Float32Array(FIGURE_POSE_SIZE);
    const bones = new Float32Array(FIGURE_BONES * 16);
    const g = new Float32Array(16);
    const point = (b: number, x: number, y: number, z: number): number[] => {
      const m = b * 16;
      return [0, 1, 2].map(
        (r) => bones[m + 12 + r]! + bones[m + r]! * x + bones[m + 4 + r]! * y + bones[m + 8 + r]! * z,
      );
    };
    let worstReach = 0;
    let worstErr = 0;
    let checked = 0;
    const zombie = FIGURE_POSTURES - 1;
    for (let p = 0; p < FIGURE_POSTURES; p++) {
      const grip = FIGURE_POSTURE_INFO[p * 3 + 1]!;
      if (p === zombie || grip === FIGURE_GRIP.none) continue;
      const def = FIGURE_GRIP_DEFS[grip - 1]!;
      const model = byId.get(def.model)!;
      const handR = socket(model, 'hand_r');
      const onMag = FIGURE_POSTURE_INFO[p * 3 + 2] === FIGURE_MODE.sprint && def.sprintOnMag;
      const target = onMag ? socket(model, 'mag') : socket(model, 'hand_l');
      if (onMag) target[1]! -= def.magDownT;
      // Mão E nos eixos do modelo, em px, a partir da origem da arma (o hand_r).
      const leftModel = sub(target, handR).map((v) => v * FIGURE_TEXEL_PX);
      for (const pitch of FIGURE_PITCH_SAMPLES) {
        figureGamePose(table, p, pitch, pose, 0);
        figureFk(pose, 0, unit, 0, bones, 0);
        figureGripMatrix(table, p, pitch, g, 0);
        // Arma no FK: antebraço D × grip (eixos do modelo, origem no hand_r).
        const origin = point(FIGURE_BONE.forearmR, g[12]!, g[13]!, g[14]!);
        const lx = g[0]! * leftModel[0]! + g[4]! * leftModel[1]! + g[8]! * leftModel[2]! + g[12]!;
        const ly = g[1]! * leftModel[0]! + g[5]! * leftModel[1]! + g[9]! * leftModel[2]! + g[13]!;
        const lz = g[2]! * leftModel[0]! + g[6]! * leftModel[1]! + g[10]! * leftModel[2]! + g[14]!;
        const left = point(FIGURE_BONE.forearmR, lx, ly, lz);
        for (const [t, b, side] of [
          [origin, FIGURE_BONE.forearmR, -1],
          [left, FIGURE_BONE.forearmL, 1],
        ] as const) {
          const palm = point(b, 0, FIGURE_PALM_Y, 0);
          const shoulder = point(FIGURE_BONE.torso, side * FIGURE_JOINT.shoulderX, FIGURE_JOINT.shoulderY, 0);
          worstReach = Math.max(worstReach, Math.hypot(...sub(t, shoulder)) / FIGURE_ARM_REACH);
          worstErr = Math.max(worstErr, Math.hypot(...sub(t, palm)));
        }
        checked++;
      }
    }
    // 18 posturas armadas (em pé 9, agachado 6, deslizando 3; o zumbi não tem arma) × 5 amostras.
    expect(checked).toBe(18 * 5);
    expect(worstReach).toBeLessThanOrEqual(1);
    expect(worstErr).toBeLessThanOrEqual(0.1);
  });
});
