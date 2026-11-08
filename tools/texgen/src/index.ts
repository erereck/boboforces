// texgen: gera as texturas pixel-art a partir das receitas de `assets-src/textures/` (paleta mestra + validador + mips)
// e as definições de bloco de `assets-src/blocks/`, e grava tudo nas pastas `generated/` (ver `outputs.ts`).
//
//   npm run texgen            regenera (só reescreve o que mudou, apaga o que sobrou) e grava a folha de contato
//                             em local/m1/texturas.png (privada)
//   npm run texgen -- --check confere se os arquivos gravados estão em dia (para o CI); sai com 1 se não estiverem
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { buildContactSheetPng, buildTexgen, CONTACT_SHEET_PATH, TEXGEN_OUTPUT_DIRS } from './outputs.ts';

const root = resolve(import.meta.dirname, '../../..');
const check = process.argv.includes('--check');

/** Arquivos que já existem nas pastas de saída (caminho relativo à raiz, com `/`). */
function existingOutputs(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push(relative(root, path).replaceAll('\\', '/'));
    }
  };
  for (const dir of TEXGEN_OUTPUT_DIRS) walk(join(root, dir));
  return out;
}

const build = buildTexgen();
let stale = 0;
let written = 0;
for (const [rel, bytes] of build.files) {
  const path = join(root, rel);
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
let removed = 0;
for (const rel of existingOutputs()) {
  if (build.files.has(rel)) continue;
  if (check) {
    console.error(`sobrando: ${rel}`);
    stale++;
    continue;
  }
  rmSync(join(root, rel));
  removed++;
}
// Pastas que ficaram vazias depois da limpeza (ex.: a `preview/` do M0, que virou a folha de contato privada). O git
// não guarda pasta vazia, então o `--check` não se importa com elas.
const pruneEmpty = (dir: string, isRoot: boolean): void => {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) pruneEmpty(join(dir, entry.name), false);
  }
  if (!isRoot && readdirSync(dir).length === 0) rmSync(dir, { recursive: true });
};
if (!check) for (const dir of TEXGEN_OUTPUT_DIRS) pruneEmpty(join(root, dir), true);

if (check) {
  if (stale > 0) {
    console.error(`texgen: ${stale} arquivo(s) desatualizado(s). Rode "npm run texgen".`);
    process.exit(1);
  }
  console.log(`texgen: ${build.files.size} arquivo(s) em dia.`);
} else {
  const sheet = join(root, CONTACT_SHEET_PATH);
  mkdirSync(dirname(sheet), { recursive: true });
  writeFileSync(sheet, buildContactSheetPng(build));
  console.log(
    `texgen: ${written} gravado(s), ${build.files.size - written} sem mudança, ${removed} apagado(s); ` +
      `blocos16 com ${build.blocks.layers.length} camadas, modelos64-materiais com ${build.materials.layers.length}; ` +
      `folha de contato em ${CONTACT_SHEET_PATH}`,
  );
}
