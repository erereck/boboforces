import {
  FIGURE_BODY_BOXES,
  FIGURE_BONE,
  FIGURE_BONES,
  FIGURE_BOX_FIELD,
  FIGURE_BOX_STRIDE,
  FIGURE_CROUCH_TOP_M,
  FIGURE_HEAD_HALF_M,
  FIGURE_HEIGHT_PX,
  FIGURE_PX_M,
  FIGURE_REST_POSE,
  figureFk,
  figureRoot,
} from '@boboforces/format';
import { BLOCK_SIZE } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { HEADSHOT_MULTIPLIER, METRICS } from './config/metrics.ts';
import { MOVEMENT_BOBO } from './config/movement.ts';
import { BOBO_NAV_METRICS } from './config/nav-metrics.ts';
import { MAX_FRAME_SECONDS, MAX_STEPS_PER_FRAME, secondsToTicks, SIM_DT } from './constants.ts';
import { entityGeneration, entityIndex, makeEntityId, NULL_ENTITY } from './entity.ts';
import { FixedStep } from './fixed-step.ts';

const cells = (m: number): number => m / BLOCK_SIZE;

/**
 * Faixa vertical (m) de cada uma das 14 caixas do corpo do boneco do FutBobo no repouso, raiz na origem: o FK do
 * format posa os ossos e cada caixa vai para o mundo pelos 8 cantos (as caixas do corpo não têm giro próprio).
 */
function restBodyBoxes(): { readonly minY: number[]; readonly maxY: number[]; readonly bone: number[] } {
  const root = new Float32Array(16);
  const bones = new Float32Array(FIGURE_BONES * 16);
  figureRoot(root, 0, 0, 0, 0, 0, 1, 0);
  figureFk(FIGURE_REST_POSE, 0, root, 0, bones, 0);
  const F = FIGURE_BOX_FIELD;
  const minY: number[] = [];
  const maxY: number[] = [];
  const bone: number[] = [];
  for (let o = 0; o < FIGURE_BODY_BOXES.length; o += FIGURE_BOX_STRIDE) {
    const b = FIGURE_BODY_BOXES[o + F.bone]!;
    const m = b * 16;
    let lo = Infinity;
    let hi = -Infinity;
    for (let corner = 0; corner < 8; corner++) {
      const x = FIGURE_BODY_BOXES[o + F.cx]! + ((corner & 1) - 0.5) * FIGURE_BODY_BOXES[o + F.sx]!;
      const y = FIGURE_BODY_BOXES[o + F.cy]! + (((corner >> 1) & 1) - 0.5) * FIGURE_BODY_BOXES[o + F.sy]!;
      const z = FIGURE_BODY_BOXES[o + F.cz]! + ((corner >> 2) - 0.5) * FIGURE_BODY_BOXES[o + F.sz]!;
      const wy = bones[m + 1]! * x + bones[m + 5]! * y + bones[m + 9]! * z + bones[m + 13]!;
      lo = Math.min(lo, wy);
      hi = Math.max(hi, wy);
    }
    minY.push(lo);
    maxY.push(hi);
    bone.push(b);
  }
  return { minY, maxY, bone };
}

describe('tabela de métricas', () => {
  it('bate com a grade de 0,5 m', () => {
    // 1,75 m = 3½ células (#55): a navegação pede 4 células livres em pé e 2 agachado.
    expect(cells(METRICS.bodyHeight)).toBe(3.5);
    expect(Math.ceil(cells(METRICS.aabbHeight))).toBe(4);
    expect(Math.ceil(cells(METRICS.aabbCrouchHeight))).toBe(2);
    expect(cells(METRICS.headSize)).toBe(0.875);
    expect(cells(METRICS.stepHeight)).toBe(1);
    expect(cells(METRICS.jumpHeight)).toBe(2);
    expect(cells(METRICS.doorWidth)).toBe(2);
    expect(cells(METRICS.doorHeight)).toBe(4);
    expect(cells(METRICS.corridorMin)).toBe(2);
    expect(cells(METRICS.coverLow)).toBe(2);
    expect(cells(METRICS.safeFallHeight)).toBe(10);
  });

  it('é coerente por dentro', () => {
    expect(METRICS.aabbHeight).toBe(METRICS.bodyHeight);
    expect(METRICS.eyeHeight).toBeLessThan(METRICS.bodyHeight);
    expect(METRICS.crouchEyeHeight).toBeLessThan(METRICS.crouchHeight);
    expect(METRICS.aabbCrouchHeight).toBe(METRICS.crouchHeight);
    // Cobertura baixa esconde o agachado; a alta esconde em pé.
    expect(METRICS.coverLow).toBeGreaterThanOrEqual(METRICS.crouchHeight);
    expect(METRICS.coverHighMin).toBeGreaterThanOrEqual(METRICS.bodyHeight);
    // Corredor mínimo e porta deixam passar a AABB.
    expect(METRICS.corridorMin).toBeGreaterThan(METRICS.aabbWidth);
    expect(METRICS.doorHeight).toBeGreaterThan(METRICS.bodyHeight);
  });

  // Altura B (#55) com o boneco do FutBobo (#56): quem tem a altura é o FIGURE do format.
  it('o boneco do FutBobo tem a altura da tabela: quadril 12 px + tronco 12 + cabeça 8 = 32 px', () => {
    const { minY, maxY, bone } = restBodyBoxes();
    const px = (m: number): number => m / FIGURE_PX_M;
    const torso = bone.indexOf(FIGURE_BONE.torso);
    const head = bone.indexOf(FIGURE_BONE.head);
    const top = Math.max(...maxY);
    // Topo do repouso = altura do bobo, sola em 0 (o FK escreve float32: 1e-6 m de folga).
    expect(top).toBeCloseTo(METRICS.bodyHeight, 6);
    expect(Math.min(...minY)).toBeCloseTo(0, 6);
    expect(FIGURE_HEIGHT_PX * FIGURE_PX_M).toBe(METRICS.bodyHeight);
    // O tronco começa no quadril a 12 px; tronco 12 px; cabeça 8 px em cima dele, e ela é o topo.
    expect(px(minY[torso]!)).toBeCloseTo(12, 4);
    expect(px(maxY[torso]! - minY[torso]!)).toBeCloseTo(12, 4);
    expect(px(minY[head]!)).toBeCloseTo(24, 4);
    expect(px(maxY[head]! - minY[head]!)).toBeCloseTo(8, 4);
    expect(maxY[head]).toBe(top);
    expect(12 + 12 + 8).toBe(FIGURE_HEIGHT_PX);
    // Cabeça de 8 px = 0,4375 m; o olho (1,55) fica dentro dela.
    expect(8 * FIGURE_PX_M).toBe(2 * FIGURE_HEAD_HALF_M);
    expect(maxY[head]! - minY[head]!).toBeCloseTo(2 * FIGURE_HEAD_HALF_M, 6);
    expect(METRICS.eyeHeight).toBeGreaterThan(minY[head]!);
    expect(METRICS.eyeHeight).toBeLessThan(maxY[head]!);
    // Porta − corpo ≥ 0,25 m com o topo medido no FK.
    expect(METRICS.doorHeight - top).toBeGreaterThanOrEqual(0.25 - 1e-6);
  });

  it('METRICS.headSize = cabeça do boneco do FutBobo (8 px)', () => {
    expect(METRICS.headSize).toBe(2 * FIGURE_HEAD_HALF_M);
  });

  it('altura do bobo (decisões #53 e #55): olho e porta com folga', () => {
    expect(METRICS.bodyHeight).toBe(1.75);
    expect(METRICS.bodyHeight).toBeLessThanOrEqual(METRICS.coverHighMin);
    expect(METRICS.doorHeight - METRICS.bodyHeight).toBeGreaterThanOrEqual(0.25);
    expect(METRICS.ceilingMin - METRICS.bodyHeight).toBeGreaterThanOrEqual(0.25);
    // O olho fica 0,2 m abaixo do topo, dentro da cabeça e na faixa das aberturas do Construto (1,0–2,0 m).
    expect(METRICS.eyeHeight).toBeCloseTo(METRICS.bodyHeight - 0.2, 9);
    expect(METRICS.eyeHeight).toBeGreaterThan(METRICS.bodyHeight - METRICS.headSize);
    expect(METRICS.eyeHeight).toBeGreaterThan(1.0);
    expect(METRICS.eyeHeight).toBeLessThan(2.0);
    // A navegação lê a altura da AABB daqui.
    expect(BOBO_NAV_METRICS.height).toBe(METRICS.aabbHeight);
    expect(BOBO_NAV_METRICS.crouchHeight).toBe(METRICS.aabbCrouchHeight);
  });

  it('agachado (boneco do FutBobo, #56): topo abaixo da cobertura baixa e acima do olho agachado', () => {
    // As hitboxes agachadas por pitch ficam no hitbox.test.ts e na tabela do format; aqui só a conta das métricas.
    expect(FIGURE_CROUCH_TOP_M).toBeLessThan(METRICS.coverLow);
    expect(FIGURE_CROUCH_TOP_M).toBeGreaterThanOrEqual(METRICS.crouchHeight);
    expect(METRICS.crouchEyeHeight).toBeLessThan(FIGURE_CROUCH_TOP_M);
  });

  it('headshot e perfil Bobo seguem o GDD', () => {
    expect(HEADSHOT_MULTIPLIER).toEqual({ default: 1.5, sniper: 2.0, shotgun: 1.25 });
    expect(MOVEMENT_BOBO.walk).toBe(4.8);
    expect(MOVEMENT_BOBO.sprint).toBe(6.8);
    expect(MOVEMENT_BOBO.crouch).toBe(2.4);
    expect(MOVEMENT_BOBO.jump).toBe(METRICS.jumpHeight);
    expect(MOVEMENT_BOBO.bhop).toBe(false);
  });
});

describe('EntityId', () => {
  it('índice + geração em u32, com 0 inválido', () => {
    const id = makeEntityId(1023, 0xffff);
    expect(entityIndex(id)).toBe(1023);
    expect(entityGeneration(id)).toBe(0xffff);
    expect(id).toBeGreaterThan(0);
    expect(makeEntityId(0, 1)).not.toBe(NULL_ENTITY);
  });
});

describe('FixedStep', () => {
  it('acumula, limita a 4 passos e a 0,1 s, e expõe alpha', () => {
    const fs = new FixedStep();
    expect(fs.advance(SIM_DT * 2.5)).toBe(2);
    expect(fs.alpha).toBeCloseTo(0.5);
    expect(fs.advance(SIM_DT * 0.75)).toBe(1);
    expect(fs.advance(10)).toBeLessThanOrEqual(MAX_STEPS_PER_FRAME);
    fs.reset();
    expect(fs.advance(MAX_FRAME_SECONDS)).toBe(MAX_STEPS_PER_FRAME);
    expect(secondsToTicks(0.7)).toBe(42);
  });

  /** Ticks por frame com timestamps de rAF a `fps`, arredondados a 0,1 ms (o jitter normal do navegador). */
  const histogram = (hz: number, fps: number, frames = 600): Map<number, number> => {
    const fs = new FixedStep(hz);
    const out = new Map<number, number>();
    let last = 1000;
    for (let f = 1; f <= frames; f++) {
      const t = Math.round((1000 + (f * 1000) / fps) * 10) / 10;
      const n = fs.advance((t - last) / 1000);
      last = t;
      out.set(n, (out.get(n) ?? 0) + 1);
      expect(fs.alpha).toBeGreaterThanOrEqual(0);
      expect(fs.alpha).toBeLessThan(1);
    }
    return out;
  };

  it('frame igual ao tick (ou múltiplo) com jitter de relógio dá sempre o mesmo número de ticks', () => {
    expect([...histogram(60, 60)]).toEqual([[1, 600]]);
    expect([...histogram(60, 30)]).toEqual([[2, 600]]);
    expect([...histogram(30, 30)]).toEqual([[1, 600]]);
  });

  it('ritmo diferente de verdade continua contando certo (144 Hz roda 60 ticks/s)', () => {
    const h = histogram(60, 144, 1440);
    expect((h.get(1) ?? 0) + 2 * (h.get(2) ?? 0)).toBeGreaterThanOrEqual(599);
    expect((h.get(1) ?? 0) + 2 * (h.get(2) ?? 0)).toBeLessThanOrEqual(601);
  });
});
