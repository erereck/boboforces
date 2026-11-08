// size-check: confere o build web (apps/web/dist) contra os orçamentos de download do tecnico.md §16.4 e reprova
// (saída 1) se algum estourar. Roda depois do `npm run build`, no CI e à mão:
//
//   npm run size-check                  (apps/web/dist)
//   npm run size-check -- <pasta>       (outro dist)
//   npm run size-check -- --verbose     (lista a carga inicial e todos os arquivos)
//   npm run size-check -- --json        (saída para máquina)
//   npm run size-check -- --sem-modulos (pula a checagem dos módulos do boneco fora do menu e o build com mapas)
//   npm run size-check -- --sem-aposentados  (asset aposentado pelo porte do boneco no build reprova; portão do passo 5)
//
// Módulos do boneco (#56): o motor de animação, o pintor e a tabela de jogo não podem cair no chunk do menu. A conta
// vem dos sourcemaps: os do próprio dist, se existirem; senão (só no dist padrão) um build à parte com
// `--sourcemap hidden` numa pasta temporária, apagada no fim (alguns segundos a mais).
//
// Saída 2: não há build para medir.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BUDGETS, RETIRED_ASSETS_FAIL } from './budgets.ts';
import { checkBudgets, formatBytes, formatReport, measureDist } from './measure.ts';
import { checkMenuModules, formatModuleCheck, type ModuleCheck } from './modules.ts';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const DEFAULT_DIST = join(REPO_ROOT, 'apps', 'web', 'dist');

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const json = args.includes('--json');
const skipModules = args.includes('--sem-modulos');
const strictRetired = RETIRED_ASSETS_FAIL || args.includes('--sem-aposentados');
const positional = args.find((a) => !a.startsWith('--'));
const dist = positional ? resolve(positional) : DEFAULT_DIST;

if (!existsSync(join(dist, 'index.html'))) {
  console.error(`size-check: não achei ${join(dist, 'index.html')}. Rode "npm run build" antes.`);
  process.exit(2);
}

const report = measureDist(dist);
const results = checkBudgets(report, BUDGETS);
const failed = results.filter((r) => !r.ok);
const problems: string[] = [];
const notes: string[] = [];

/** Build da web com sourcemaps escondidos numa pasta à parte (o vite do repositório, sem dependência nova). */
function buildWithMaps(outDir: string): void {
  const vite = join(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  execFileSync(
    process.execPath,
    [vite, 'build', '--sourcemap', 'hidden', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'],
    { cwd: join(REPO_ROOT, 'apps', 'web'), stdio: ['ignore', 'ignore', 'pipe'] },
  );
}

let modules: ModuleCheck | null = null;
if (!skipModules) {
  const hasMaps = report.initial.some((f) => /\.m?js$/.test(f.path) && existsSync(join(dist, `${f.path}.map`)));
  if (hasMaps) modules = checkMenuModules(dist, report);
  else if (dist === DEFAULT_DIST) {
    const tmp = mkdtempSync(join(tmpdir(), 'bf-size-check-mapas-'));
    const t0 = performance.now();
    try {
      buildWithMaps(tmp);
      const mapped = measureDist(tmp);
      modules = checkMenuModules(tmp, mapped);
      notes.push(
        `módulos medidos num build à parte com sourcemaps (${((performance.now() - t0) / 1000).toFixed(1).replace('.', ',')} s)`,
      );
      if (mapped.initialTotal !== report.initialTotal) {
        notes.push(
          `o menu do build com mapas (${formatBytes(mapped.initialTotal)}) difere do dist medido ` +
            `(${formatBytes(report.initialTotal)}): o dist está velho? Rode "npm run build" de novo`,
        );
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      problems.push(`o build com sourcemaps falhou (módulos do boneco não conferidos): ${text.split('\n')[0]}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  } else {
    problems.push(
      `${dist} não tem sourcemaps: a checagem dos módulos do boneco só faz o build à parte no dist padrão ` +
        '(use --sem-modulos para pular)',
    );
  }
  if (modules && !modules.ok) {
    for (const p of modules.placements) {
      if (p.initialChunks.length > 0) problems.push(`${p.label} caiu no chunk do menu (${p.initialChunks.join(', ')})`);
    }
    if (modules.unmapped.length > 0) problems.push(`JS do menu sem sourcemap: ${modules.unmapped.join(', ')}`);
  }
}
if (strictRetired && report.retired.files.length > 0) {
  problems.push(`assets aposentados pelo porte ainda no build: ${report.retired.files.map((f) => f.path).join(', ')}`);
}

const ok = failed.length === 0 && problems.length === 0;
if (json) {
  console.log(
    JSON.stringify({
      dist,
      ok,
      results,
      problems,
      notes,
      modules,
      initial: report.initial,
      fonts: report.fonts,
      firstMatch: report.firstMatch,
      groups: report.groups,
      retired: report.retired,
      onDemand: report.onDemand,
      files: report.files,
    }),
  );
} else {
  console.log(`size-check: ${dist}`);
  console.log(formatReport(report, results, verbose));
  if (modules) console.log(formatModuleCheck(modules));
  for (const n of notes) console.log(`  Nota: ${n}`);
  for (const p of problems) console.log(`  PROBLEMA: ${p}`);
  console.log(
    ok
      ? '\nOrçamentos de download ok.'
      : failed.length > 0
        ? `\n${failed.length} orçamento(s) estourado(s). Veja tecnico.md §16.4 antes de mexer nos números.`
        : `\n${problems.length} problema(s) fora dos orçamentos (veja acima).`,
  );
}
process.exit(ok ? 0 : 1);
