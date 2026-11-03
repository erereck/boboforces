// size-check: confere o build web (apps/web/dist) contra os orçamentos de download do tecnico.md §16.4 e reprova
// (saída 1) se algum estourar. Roda depois do `npm run build`, no CI e à mão:
//
//   npm run size-check                  (apps/web/dist)
//   npm run size-check -- <pasta>       (outro dist)
//   npm run size-check -- --verbose     (lista a carga inicial e todos os arquivos)
//   npm run size-check -- --json        (saída para máquina)
//
// Saída 2: não há build para medir.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BUDGETS } from './budgets.ts';
import { checkBudgets, formatReport, measureDist } from './measure.ts';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const json = args.includes('--json');
const positional = args.find((a) => !a.startsWith('--'));
const dist = positional ? resolve(positional) : resolve(import.meta.dirname, '../../../apps/web/dist');

if (!existsSync(join(dist, 'index.html'))) {
  console.error(`size-check: não achei ${join(dist, 'index.html')}. Rode "npm run build" antes.`);
  process.exit(2);
}

const report = measureDist(dist);
const results = checkBudgets(report, BUDGETS);
const failed = results.filter((r) => !r.ok);

if (json) {
  console.log(JSON.stringify({ dist, ok: failed.length === 0, results, initial: report.initial, files: report.files }));
} else {
  console.log(`size-check: ${dist}`);
  console.log(formatReport(report, results, verbose));
  console.log(
    failed.length === 0
      ? '\nOrçamentos de download ok.'
      : `\n${failed.length} orçamento(s) estourado(s). Veja tecnico.md §16.4 antes de mexer nos números.`,
  );
}
process.exit(failed.length === 0 ? 0 : 1);
