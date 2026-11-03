/**
 * Roda `tsc -p` em todos os tsconfig do monorepo, em paralelo, e agrega o resultado (padrão do VNbobo).
 *
 * Convenção: cada pacote/app/tool tem `tsconfig.json` (src + testes, com tipos do Node, para o editor) e, quando o
 * código precisa ficar livre de APIs do Node, um `tsconfig.src.json` só com `src` (sem os `*.test.ts`) e as libs
 * permitidas. Os dois são checados. É o `tsconfig.src.json` dos pacotes puros que garante "sem DOM, sem Node".
 *
 * Uso: `npm run typecheck` (tudo) ou `node scripts/typecheck.ts packages/sim` (filtro por caminho).
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const filters = process.argv.slice(2).map((f) => resolve(root, f));

function configs(): string[] {
  const out = [join(root, 'tsconfig.json')];
  for (const group of ['packages', 'apps', 'tools']) {
    const dir = join(root, group);
    if (!existsSync(dir)) continue;
    for (const pkg of readdirSync(dir, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      for (const f of readdirSync(join(dir, pkg.name))) {
        if (/^tsconfig(\.[a-z]+)?\.json$/.test(f)) out.push(join(dir, pkg.name, f));
      }
    }
  }
  return out.filter((c) => filters.length === 0 || filters.some((f) => c.startsWith(f)));
}

const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');

interface Result {
  config: string;
  code: number;
  output: string;
}

function check(config: string): Promise<Result> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [tsc, '-p', config, '--pretty', 'false'], { cwd: root });
    let output = '';
    child.stdout.on('data', (d: Buffer) => (output += d.toString()));
    child.stderr.on('data', (d: Buffer) => (output += d.toString()));
    child.on('close', (code) => done({ config, code: code ?? 1, output }));
  });
}

const list = configs();
if (list.length === 0) {
  console.log('Nenhum tsconfig encontrado para o filtro.');
  process.exit(1);
}
const limit = Math.max(1, Math.min(list.length, availableParallelism()));
const results: Result[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: limit }, async () => {
    while (next < list.length) {
      const c = list[next++] as string;
      results.push(await check(c));
    }
  }),
);

let failed = 0;
for (const r of results.sort((a, b) => a.config.localeCompare(b.config))) {
  const name = relative(root, r.config).split(sep).join('/');
  if (r.code === 0) console.log(`ok    ${name}`);
  else {
    failed++;
    console.log(`FALHA ${name}\n${r.output.trim()}\n`);
  }
}
console.log(
  failed
    ? `\n${failed} de ${results.length} configurações com erro.`
    : `\nTypecheck ok (${results.length} configurações).`,
);
process.exit(failed ? 1 : 0);
