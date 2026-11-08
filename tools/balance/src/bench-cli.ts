// Bench headless de sim + IA (Teste Zero, item 12). Uso (da raiz):
//   npm run bench:sim -w @boboforces/balance -- --ticks 3600 --hz 60 --scenario all
// Imprime linhas `chave=valor` e uma tabela para o docs/PERF.md (a integração registra lá).
import { parseArgs } from 'node:util';
import { PerformanceObserver } from 'node:perf_hooks';
import { BENCH_SCENARIOS, formatBench, prepareMap, runBench, type BenchResult } from './bench.ts';

const { values } = parseArgs({
  options: {
    ticks: { type: 'string', default: '3600' },
    warmup: { type: 'string', default: '600' },
    hz: { type: 'string', default: '60' },
    seed: { type: 'string', default: '42' },
    scenario: { type: 'string', default: 'all' },
  },
});

const ticks = Number(values.ticks);
const warmupTicks = Number(values.warmup);
const hz = Number(values.hz);
const seed = Number(values.seed);
if (![ticks, warmupTicks, hz, seed].every(Number.isInteger) || ticks < 1 || hz < 10) {
  console.error('bench-sim: --ticks, --warmup, --hz e --seed precisam ser inteiros');
  process.exit(2);
}
const scenarios = values.scenario === 'all' ? BENCH_SCENARIOS : BENCH_SCENARIOS.filter((s) => s.id === values.scenario);
if (scenarios.length === 0) {
  console.error(`bench-sim: cenário desconhecido (${BENCH_SCENARIOS.map((s) => s.id).join(', ')})`);
  process.exit(2);
}

// Pausas de GC durante as rodadas (regra 11: o laço quente não deveria alocar).
let gcCount = 0;
let gcMs = 0;
let gcMax = 0;
const obs = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    gcCount++;
    gcMs += e.duration;
    gcMax = Math.max(gcMax, e.duration);
  }
});
obs.observe({ entryTypes: ['gc'] });

const now = (): number => performance.now();
const prepared = prepareMap(now);
const results: BenchResult[] = [];
const gcLines: string[] = [];
for (const s of scenarios) {
  gcCount = 0;
  gcMs = 0;
  gcMax = 0;
  results.push(runBench(s, prepared, { ticks, warmupTicks, hz, seed, now }));
  await new Promise((r) => setTimeout(r, 50));
  gcLines.push(`gc cenario=${s.id} pausas=${gcCount} total_ms=${gcMs.toFixed(2)} maior_ms=${gcMax.toFixed(2)}`);
}
obs.disconnect();
console.log(formatBench(results, { ticks, hz, seed }));
console.log(gcLines.join('\n'));
console.log(`node=${process.version}`);
