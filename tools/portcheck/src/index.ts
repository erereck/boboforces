// CLI do portcheck: `npm run portcheck` (raiz). Faz o build do Switch numa pasta própria (`.cache/portcheck/romfs`),
// varre o bundle e dá boot em node:vm com globais falsos do nx.js até o primeiro frame do menu.
//   --no-build      usa o RomFS já gerado por `npm run build:switch` (apps/switch/romfs), como no CI
//   --romfs <pasta> usa outra pasta de RomFS
//   --frames <n>    teto de frames simulados (padrão 600 = 10 s)
//   --strict        "pendente" (game ainda sem laço) também reprova
// Sai com 1 se a varredura achar algo ou o boot falhar.
import { join, resolve } from 'node:path';
import { buildSwitch } from '../../../apps/switch/scripts/bundle.ts';
import { formatResult, runPortcheck } from './portcheck.ts';

const root = resolve(import.meta.dirname, '..', '..', '..');
const args = process.argv.slice(2);
const argValue = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

let romfsDir = argValue('--romfs');
if (!romfsDir) {
  if (args.includes('--no-build')) romfsDir = join(root, 'apps', 'switch', 'romfs');
  else {
    romfsDir = join(root, '.cache', 'portcheck', 'romfs');
    const built = await buildSwitch({ outDir: romfsDir });
    for (const w of built.warnings) console.warn(`aviso do esbuild: ${w}`);
  }
}
const frames = argValue('--frames');
const result = await runPortcheck({
  romfsDir: resolve(romfsDir),
  rootDir: root,
  ...(frames ? { maxFrames: Number(frames) } : {}),
});
console.log(formatResult(result));

const strict = args.includes('--strict');
const failed =
  result.findings.length > 0 || result.boot.status === 'falha' || (strict && result.boot.status === 'pendente');
if (failed) {
  console.log('\nportcheck: REPROVADO');
  process.exit(1);
}
console.log(
  result.boot.status === 'pendente'
    ? '\nportcheck: ok, com o boot até o menu PENDENTE (o game ainda é stub; --strict reprova).'
    : '\nportcheck: ok',
);
