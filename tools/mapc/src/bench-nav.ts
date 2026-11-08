// Medição da navegação no caminho do LOADING (o mesmo do jogo): .bfmap → grade → registro → buildNavGrid, e A* entre
// pares de nós sorteados com semente. Uso: `node tools/mapc/src/bench-nav.ts [mapa] [pares]` (padrão: construto, 2000).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { decodeMap } from '@boboforces/format';
import { buildNavGrid, createNavPath, findPath, type NavGridImpl } from '@boboforces/nav';
import { createRng } from '@boboforces/shared';
import { BOBO_NAV_METRICS } from '@boboforces/sim';
import { createMapBlockRegistry, gridFromMapGrid } from '@boboforces/world';
import { loadBlockTable } from './blocks.ts';
import { MAPS_OUT_DIR } from './paths.ts';

const id = process.argv[2] ?? 'construto';
const pairs = Number(process.argv[3] ?? 2000);
const bytes = new Uint8Array(readFileSync(join(MAPS_OUT_DIR, `${id}.bfmap`)));
const ms = (a: number, b: number): string => `${(b - a).toFixed(1)} ms`;

const t0 = performance.now();
const doc = decodeMap(bytes);
const t1 = performance.now();
const grid = gridFromMapGrid(doc.grid);
const registry = createMapBlockRegistry(doc.blocks, loadBlockTable().defs);
const t2 = performance.now();
// Aquece o JIT uma vez e mede a segunda montagem (o loading do jogo é a primeira; as duas vão no relatório).
const first = performance.now();
buildNavGrid({ grid, blocks: registry }, BOBO_NAV_METRICS);
const firstMs = performance.now() - first;
const t3 = performance.now();
const nav = buildNavGrid({ grid, blocks: registry }, BOBO_NAV_METRICS) as NavGridImpl;
const t4 = performance.now();

const typed = [
  nav.floorY,
  nav.clearance,
  nav.component,
  nav.columnStart,
  nav.nodeColumn,
  nav.topY,
  nav.ceilY,
  nav.linkStart,
  nav.linkTarget,
  nav.linkKind,
  nav.linkCost,
].reduce((sum, a) => sum + a.byteLength, 0);
const pool = nav.search.slots.reduce(
  (sum, s) =>
    sum +
    s.g.byteLength +
    s.f.byteLength +
    s.parent.byteLength +
    s.heap.byteLength +
    s.heapPos.byteLength +
    s.stamp.byteLength,
  0,
);

// A* entre nós sorteados do maior componente, com orçamento de 256 nós por chamada (uma "fatia" por frame).
const sizes = new Map<number, number>();
for (let n = 0; n < nav.nodeCount; n++) sizes.set(nav.component[n]!, (sizes.get(nav.component[n]!) ?? 0) + 1);
const main = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]![0];
const nodes: number[] = [];
for (let n = 0; n < nav.nodeCount; n++) if (nav.component[n] === main) nodes.push(n);
const rng = createRng('bench-nav');
const path = createNavPath(nav, 512);
const times: number[] = [];
const slices: number[] = [];
let found = 0;
for (let i = 0; i < pairs; i++) {
  const a = rng.pick(nodes);
  const b = rng.pick(nodes);
  const s = performance.now();
  let calls = 1;
  let status = findPath(nav, a, b, path, 256);
  while (status === 'pending') {
    status = findPath(nav, a, b, path, 256);
    calls++;
  }
  times.push(performance.now() - s);
  slices.push(calls);
  if (status === 'found') found++;
}
times.sort((x, y) => x - y);
slices.sort((x, y) => x - y);
const pct = (list: number[], p: number): number => list[Math.min(list.length - 1, Math.floor(list.length * p))]!;
const mean = times.reduce((x, y) => x + y, 0) / times.length;

console.log(`bench-nav ${id}`);
console.log(
  `  decode ${ms(t0, t1)} · grade + registro ${ms(t1, t2)} · nav (1ª) ${firstMs.toFixed(1)} ms · nav ${ms(t3, t4)}`,
);
console.log(
  `  ${nav.nodeCount} nós, ${nav.linkTarget.length} ligações; grade ${(typed / 1024).toFixed(0)} KB + pool do A* ${(pool / 1024).toFixed(0)} KB`,
);
console.log(
  `  A* (${pairs} pares, ${found} achados, fatias de 256 nós): média ${mean.toFixed(3)} ms, p50 ${pct(times, 0.5).toFixed(3)} ms, ` +
    `p99 ${pct(times, 0.99).toFixed(3)} ms, máx ${times[times.length - 1]!.toFixed(3)} ms; fatias p50 ${pct(slices, 0.5)}, p99 ${pct(slices, 0.99)}, máx ${slices[slices.length - 1]}`,
);
