// texgen: gera as texturas pixel-art de bloco a partir das receitas de `assets-src/textures/` (paleta mestra +
// validador) e grava os PNGs em `assets-src/textures/generated/`.
//
//   npm run texgen            regenera (só reescreve o que mudou)
//   npm run texgen -- --check confere se os arquivos gravados estão em dia (para o CI); sai com 1 se não estiverem
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { buildOutputs } from './generate.ts';

const root = resolve(import.meta.dirname, '../../..');
const outDir = join(root, 'assets-src', 'textures', 'generated');
const check = process.argv.includes('--check');

const files = buildOutputs();
let stale = 0;
let written = 0;
for (const [rel, bytes] of files) {
  const path = join(outDir, rel);
  const same = existsSync(path) && Buffer.compare(readFileSync(path), bytes) === 0;
  if (same) continue;
  if (check) {
    console.error(`desatualizado: ${rel}`);
    stale++;
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  written++;
}

if (check) {
  if (stale > 0) {
    console.error(`texgen: ${stale} arquivo(s) desatualizado(s). Rode "npm run texgen".`);
    process.exit(1);
  }
  console.log(`texgen: ${files.size} arquivo(s) em dia.`);
} else {
  console.log(`texgen: ${written} arquivo(s) gravado(s), ${files.size - written} sem mudança, em ${outDir}`);
}
