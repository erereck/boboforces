// Robô de balanceamento: duelos de fuzil entre os 5 níveis rápidos, headless e com semente fixa.
// Uso (da raiz): `npm run balance -- --rounds 300 --seed 42`. Sai com código 1 se a ordem dos níveis quebrar.
// M10: `npm run balance -- --weapons [--rounds 24]` mede cada arma de fogo (TTK teórico na faixa da classe e o TTK dos
// duelos com a arma); sai com código 1 se alguma ficar fora da faixa.
import { parseArgs } from 'node:util';
import { formatReport, runDuels } from './duel.ts';
import { formatWeaponReport, runWeaponDuels } from './weapons.ts';

const { values } = parseArgs({
  options: {
    rounds: { type: 'string' },
    seed: { type: 'string', default: '42' },
    weapons: { type: 'boolean', default: false },
  },
});

const roundsPerPair = Number(values.rounds ?? (values.weapons ? '24' : '300'));
const seed = Number(values.seed);
if (!Number.isInteger(roundsPerPair) || roundsPerPair < 2 || !Number.isInteger(seed)) {
  console.error('balance: --rounds (≥ 2) e --seed precisam ser inteiros');
  process.exit(2);
}

const started = performance.now();
let ok: boolean;
if (values.weapons) {
  const report = runWeaponDuels({ roundsPerWeapon: roundsPerPair, seed });
  console.log(formatWeaponReport(report));
  ok = report.ok;
} else {
  const report = runDuels({ roundsPerPair, seed });
  console.log(formatReport(report));
  ok = report.ok;
}
console.log(`\n(${((performance.now() - started) / 1000).toFixed(1)} s, semente ${seed})`);
process.exit(ok ? 0 : 1);
