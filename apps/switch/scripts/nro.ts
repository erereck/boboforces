// `npm run nro` (apps/switch): NRO "gordo" (runtime do nx.js embutido, ~60 MB) para o homebrew menu e o Eden.
// Só na máquina do Erick (decisão #33): o CI nunca gera nem guarda NRO.
import { spawnSync } from 'node:child_process';
import { renameSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { OUT_DIR, ROOT_DIR, packageBaseName } from './paths.ts';
import { stagePackage } from './stage.ts';

const stage = stagePackage('stage-nro');
const cli = createRequire(import.meta.url).resolve('@nx.js/nro/dist/main.js');
const run = spawnSync(process.execPath, [cli, '--fat'], { cwd: stage.dir, stdio: 'inherit' });
if (run.status !== 0) {
  console.error('nxjs-nro falhou.');
  process.exit(run.status ?? 1);
}
const output = join(OUT_DIR, `${packageBaseName(stage.version)}.nro`);
renameSync(join(stage.dir, 'boboforces.nro'), output);
console.log(`\nNRO: ${relative(ROOT_DIR, output)} (title ID ${stage.nacp.id}). Confira com \`npm run verify:nro\`.`);
