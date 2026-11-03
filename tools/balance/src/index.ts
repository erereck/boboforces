// Robô de balanceamento: duelos de fuzil entre os 5 níveis rápidos, headless e com semente fixa.
// Uso (da raiz): `npm run balance -- --rounds 300 --seed 42`. Sai com código 1 se a ordem dos níveis quebrar.
import { parseArgs } from 'node:util';
import { formatReport, runDuels } from './duel.ts';

const { values } = parseArgs({
  options: {
    rounds: { type: 'string', default: '300' },
    seed: { type: 'string', default: '42' },
  },
});

const roundsPerPair = Number(values.rounds);
const seed = Number(values.seed);
if (!Number.isInteger(roundsPerPair) || roundsPerPair < 2 || !Number.isInteger(seed)) {
  console.error('balance: --rounds (≥ 2) e --seed precisam ser inteiros');
  process.exit(2);
}

const started = performance.now();
const report = runDuels({ roundsPerPair, seed });
console.log(formatReport(report));
console.log(`\n(${((performance.now() - started) / 1000).toFixed(1)} s, semente ${seed})`);
process.exit(report.ok ? 0 : 1);
