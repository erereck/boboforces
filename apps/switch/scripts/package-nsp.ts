// `npm run nsp -- -k <caminho>/prod.keys` (apps/switch): NSP instalável e autocontido (runtime do nx.js embutido),
// herdado do `package-nsp.mjs` do MMM. As chaves são lidas só do caminho dado: nunca copiadas, impressas ou guardadas
// no repositório. Só na máquina do Erick (decisão #33); o CI nunca gera NSP.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { patchNACP } from '@nx.js/patch-nacp';
import { buildNsp } from '@tootallnate/hacbrewpack';
import { NACP } from '@tootallnate/nacp';
import type { RomFsEntry } from '@tootallnate/romfs';
import { OUT_DIR, ROOT_DIR, keysetArg, packageBaseName } from './paths.ts';
import { stagePackage } from './stage.ts';

const keyFile = keysetArg(process.argv.slice(2));
if (!keyFile) {
  console.error('Use: npm run nsp -- -k <caminho para o seu prod.keys> (as chaves nunca entram no projeto).');
  process.exit(1);
}

function readTree(directory: string): RomFsEntry {
  const tree: RomFsEntry = {};
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, item.name);
    tree[item.name] = item.isDirectory() ? readTree(full) : new Blob([readFileSync(full)]);
  }
  return tree;
}

const stage = stagePackage('stage-nsp');
const runtime = dirname(createRequire(import.meta.url).resolve('@nx.js/nsp/package.json'));
const base = readFileSync(join(runtime, 'nxjs.nacp'));
assert.equal(base.length, 0x4000, 'nxjs.nacp com tamanho inesperado');
// Hack do MMM, ainda necessário na beta.7: `Buffer.buffer` pode trazer bytes de outros buffers do pool. Passa só os
// bytes deste NACP (senão o NACP e a capa saem corrompidos).
const nacp = new NACP(base.buffer.slice(base.byteOffset, base.byteOffset + base.byteLength));
const { warnings } = patchNACP(nacp, pathToFileURL(join(stage.dir, 'package.json')));
for (const w of warnings) console.warn(`NACP: ${w}`);
const icon = readFileSync(stage.hasIcon ? join(stage.dir, 'icon.jpg') : join(runtime, 'icon.jpg'));
assert.equal(icon.readUInt16BE(0), 0xffd8, 'o ícone precisa ser JPEG');
const exefs = new Map<string, Blob>();
for (const name of readdirSync(join(runtime, 'exefs')))
  exefs.set(name, new Blob([readFileSync(join(runtime, 'exefs', name))]));

const result = await buildNsp({
  keys: readFileSync(keyFile, 'utf8'),
  titleId: nacp.id.toString(16).padStart(16, '0'),
  noPatchNacpLogo: true,
  noLogo: true,
  exefs,
  control: new Map([
    ['control.nacp', new Blob([new Uint8Array(nacp.buffer)])],
    ['icon_AmericanEnglish.dat', new Blob([icon])],
  ]),
  // Runtime (GeistMono, runtime.js.map) + o RomFS do jogo, que vence em caso de nome igual.
  romfs: { ...readTree(join(runtime, 'romfs')), ...readTree(join(stage.dir, 'romfs')) },
});
const output = join(OUT_DIR, `${packageBaseName(stage.version)}.nsp`);
writeFileSync(output, Buffer.from(await result.nsp.arrayBuffer()));
console.log(
  JSON.stringify(
    { arquivo: relative(ROOT_DIR, output), bytes: result.nsp.size, versao: nacp.version, titleId: result.titleId },
    null,
    2,
  ),
);
console.log('Confira com `npm run verify:nsp -- -k <prod.keys>`.');
