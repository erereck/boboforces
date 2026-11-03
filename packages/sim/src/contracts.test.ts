import { BLOCK_SIZE } from '@boboforces/world';
import { describe, expect, it } from 'vitest';
import { HEADSHOT_MULTIPLIER, HITBOXES, METRICS } from './config/metrics.ts';
import { MOVEMENT_BOBO } from './config/movement.ts';
import { MAX_FRAME_SECONDS, MAX_STEPS_PER_FRAME, secondsToTicks, SIM_DT } from './constants.ts';
import { entityGeneration, entityIndex, makeEntityId, NULL_ENTITY } from './entity.ts';
import { FixedStep } from './fixed-step.ts';

const cells = (m: number): number => m / BLOCK_SIZE;

describe('tabela de métricas', () => {
  it('bate com a grade de 0,5 m', () => {
    expect(cells(METRICS.bodyHeight)).toBe(3);
    expect(cells(METRICS.headSize)).toBe(1);
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
    // Cabeça + tronco + perna = altura do bobo.
    expect(HITBOXES.head[1] + HITBOXES.torso[1] + HITBOXES.leg[1]).toBeCloseTo(METRICS.bodyHeight);
    expect(HITBOXES.head[0]).toBe(METRICS.headSize);
    // Cobertura baixa esconde o agachado; a alta esconde em pé.
    expect(METRICS.coverLow).toBeGreaterThanOrEqual(METRICS.crouchHeight);
    expect(METRICS.coverHighMin).toBeGreaterThanOrEqual(METRICS.bodyHeight);
    // Corredor mínimo e porta deixam passar a AABB.
    expect(METRICS.corridorMin).toBeGreaterThan(METRICS.aabbWidth);
    expect(METRICS.doorHeight).toBeGreaterThan(METRICS.bodyHeight);
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
