import type { BenchStats } from '../bench/report.ts';

/**
 * Amostras de tempo (ms) com capacidade fixa (nada se aloca por frame, regra 11). Percentis por cópia ordenada, só
 * quando alguém pede (fim do bench, F2 a cada meio segundo).
 */
export interface Samples {
  readonly capacity: number;
  count: number;
  push(value: number): void;
  clear(): void;
  /** Percentil 0..1 (0,5 = mediana) das amostras guardadas; 0 sem amostras. */
  percentile(p: number): number;
  stats(): BenchStats;
}

/** Guarda as últimas `capacity` (janela deslizante) ou, com `ring` falso, as primeiras (o bench não perde o começo). */
export function createSamples(capacity: number, ring = true): Samples {
  const data = new Float32Array(Math.max(1, capacity));
  const sorted = new Float32Array(Math.max(1, capacity));
  let head = 0;
  let count = 0;
  let sortedFor = -1;
  let pushes = 0;
  function sort(): number {
    if (sortedFor === pushes) return count;
    sorted.set(data.subarray(0, count));
    sorted.subarray(0, count).sort();
    sortedFor = pushes;
    return count;
  }
  return {
    capacity: data.length,
    get count() {
      return count;
    },
    set count(v: number) {
      count = Math.max(0, Math.min(data.length, v));
    },
    push(value: number): void {
      pushes++;
      if (count < data.length) {
        data[count++] = value;
      } else if (ring) {
        data[head] = value;
        head = (head + 1) % data.length;
      }
    },
    clear(): void {
      head = 0;
      count = 0;
      pushes++;
    },
    percentile(p: number): number {
      const n = sort();
      if (n === 0) return 0;
      const i = Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1));
      return sorted[i]!;
    },
    stats(): BenchStats {
      const n = sort();
      if (n === 0) return { avg: 0, p50: 0, p90: 0, p99: 0, max: 0 };
      let sum = 0;
      let hi = 0;
      for (let i = 0; i < n; i++) {
        sum += sorted[i]!;
        if (sorted[i]! > hi) hi = sorted[i]!;
      }
      const at = (p: number): number => sorted[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))]!;
      return { avg: sum / n, p50: at(0.5), p90: at(0.9), p99: at(0.99), max: hi };
    },
  };
}
