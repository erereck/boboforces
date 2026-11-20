import { describe, expect, it } from 'vitest';
import { createFxQueue, FX_STRIDE, pushMuzzleFlash, pushTracer, TRACER_STYLE } from '../fx-queue.ts';
import { TRACER_LOOK, tracerLife, tracerLookOf } from './tracer.ts';

describe('traçante e clarão (M9, fase 1b)', () => {
  it('o traçante de sempre não mudou (2,5 cm, comprimento ÷ 320 entre 40 ms e 0,3 s)', () => {
    const look = tracerLookOf(TRACER_STYLE.normal);
    expect(look.size).toBe(0.025);
    expect(look.tail).toBe(2.6);
    expect(look.color).toBe(0xffeb99);
    expect(look.alpha).toBe(0.85);
    expect(tracerLife(look, 3)).toBe(0.04);
    expect(tracerLife(look, 64)).toBeCloseTo(0.2, 12);
    expect(tracerLife(look, 500)).toBe(0.3);
    // Valor estranho no pedido vira o de sempre.
    expect(tracerLookOf(7)).toBe(look);
  });

  it('o quique do Ricochete: mais grosso, mais claro e vive pelo menos 0,12 s (o curto vivia 40 ms)', () => {
    const normal = TRACER_LOOK[TRACER_STYLE.normal];
    const rico = tracerLookOf(TRACER_STYLE.ricochet);
    expect(rico.size).toBeGreaterThanOrEqual(normal.size * 2);
    expect(rico.alpha).toBeGreaterThan(normal.alpha);
    expect(tracerLife(rico, 3)).toBe(0.12);
    expect(tracerLife(rico, 3)).toBeGreaterThanOrEqual(3 * tracerLife(normal, 3));
    expect(tracerLife(rico, 40)).toBeCloseTo(0.25, 12);
    expect(tracerLife(rico, 500)).toBe(0.35);
  });

  it('a fila guarda o estilo do traçante e o tamanho do clarão (1 quando não dito)', () => {
    const q = createFxQueue(4);
    pushTracer(q, 0, 0, 0, 1, 0, 0);
    pushTracer(q, 0, 0, 0, 1, 0, 0, TRACER_STYLE.ricochet);
    pushMuzzleFlash(q, 1, 0, 1, 0, 0, 0, -1, -1, 0);
    pushMuzzleFlash(q, 1, 0, 1, 0, 0, 0, -1, -1, 0, 3);
    expect(q.data[6]).toBe(TRACER_STYLE.normal);
    expect(q.data[FX_STRIDE + 6]).toBe(TRACER_STYLE.ricochet);
    expect(q.data[2 * FX_STRIDE + 8]).toBe(1);
    expect(q.data[3 * FX_STRIDE + 8]).toBe(3);
  });
});
