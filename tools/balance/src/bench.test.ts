import { describe, expect, it } from 'vitest';
import { BENCH_SCENARIOS, formatBench, prepareMap, runBench, stat } from './bench.ts';

describe('bench headless de sim + IA', () => {
  it('estatística: média, p50, p99 e máximo', () => {
    const s = stat(Float64Array.from({ length: 100 }, (_, i) => i + 1));
    expect(s.mean).toBeCloseTo(50.5);
    expect(s.p50).toBe(50);
    expect(s.p99).toBe(99);
    expect(s.max).toBe(100);
  });

  it('roda os 4 cenários do Teste Zero (poucos ticks) e formata as linhas chave=valor', () => {
    let clock = 0;
    const now = (): number => (clock += 0.01);
    const prepared = prepareMap(now);
    const results = BENCH_SCENARIOS.map((s) =>
      runBench(s, prepared, { ticks: 30, warmupTicks: 0, hz: 60, seed: 1, now }),
    );
    expect(results.map((r) => r.scenario.id)).toEqual(['dock-12', '1p-24', 'stress-48', 'zombies-24']);
    for (const r of results) {
      expect(r.ai.mean).toBeGreaterThan(0);
      expect(r.total.p99).toBeGreaterThanOrEqual(r.total.p50);
      expect(r.hash).toMatch(/^[0-9a-f]{8}$/);
    }
    const text = formatBench(results, { ticks: 30, hz: 60, seed: 1 });
    expect(text.split('\n')[0]).toBe('BoboForces bench-sim 1');
    expect(text).toContain('cenario=zombies-24 humanos=4 bots=0 zumbis=24');
    expect(text).toContain('\nfim\n');
  });
});
