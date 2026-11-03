// `npm run verify:nsp -- -k <caminho>/prod.keys` (apps/switch): abre o NSP gerado e confere os três NCAs (programa,
// controle, meta), os hashes IVFC do RomFS, o runtime embutido, cada arquivo do romfs/, o NACP e o ícone. Herdado do
// `verify-nsp.mjs` do MMM. As chaves só são lidas do caminho dado.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { decrypt as decryptXts } from '@tootallnate/aes-xts';
import { NACP } from '@tootallnate/nacp';
import { aesCtrEncrypt, aesEcbDecrypt, buildNcaCtr, initializeKeySet } from '@tootallnate/nca';
import { decode as decodeRomFs, type RomFsEntry } from '@tootallnate/romfs';
import {
  ICON_PATH,
  OUT_DIR,
  ROMFS_DIR,
  ROOT_DIR,
  keysetArg,
  packageBaseName,
  readNacpFields,
  readVersion,
} from './paths.ts';

const keyFile = keysetArg(process.argv.slice(2));
if (!keyFile) {
  console.error('Use: npm run verify:nsp -- -k <caminho para o seu prod.keys>');
  process.exit(1);
}
const { version } = readVersion();
const expected = readNacpFields();
const expectedId = BigInt(`0x${expected.id}`);
const file = join(OUT_DIR, `${packageBaseName(version)}.nsp`);
if (!existsSync(file)) throw new Error(`${relative(ROOT_DIR, file)} não existe: rode \`npm run nsp\``);
const runtime = dirname(createRequire(import.meta.url).resolve('@nx.js/nsp/package.json'));
const keys = await initializeKeySet(readFileSync(keyFile, 'utf8'));
const packageBytes = readFileSync(file);

const sha256 = (bytes: Uint8Array): Buffer => createHash('sha256').update(bytes).digest();
const view = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Lê um contêiner PFS0 (o NSP e a ExeFS são PFS0). */
function pfs0(bytes: Buffer): Map<string, Buffer> {
  assert.equal(bytes.toString('ascii', 0, 4), 'PFS0');
  const dv = view(bytes);
  const count = dv.getUint32(4, true);
  const names = 16 + count * 24;
  const data = names + dv.getUint32(8, true);
  const files = new Map<string, Buffer>();
  for (let index = 0; index < count; index++) {
    const entry = 16 + index * 24;
    const offset = data + Number(dv.getBigUint64(entry, true));
    const size = Number(dv.getBigUint64(entry + 8, true));
    const nameStart = names + dv.getUint32(entry + 16, true);
    const name = bytes.toString('utf8', nameStart, bytes.indexOf(0, nameStart));
    assert(offset + size <= bytes.length, `PFS0: ${name} fora do arquivo`);
    files.set(name, bytes.subarray(offset, offset + size));
  }
  return files;
}

let programTree: RomFsEntry | undefined;
let controlTree: RomFsEntry | undefined;
let exefsChecked = false;
const contentTypes: number[] = [];
for (const [name, nca] of pfs0(packageBytes)) {
  assert(name.endsWith('.nca'), `entrada inesperada no NSP: ${name}`);
  assert.equal(name.slice(0, 32), sha256(nca).toString('hex').slice(0, 32), `hash do NCA ${name}`);
  const header = Buffer.from(await decryptXts(keys.headerKey, nca.subarray(0, 0xc00), 0x200));
  assert.equal(header.toString('ascii', 0x200, 0x204), 'NCA3');
  const dv = view(header);
  const contentType = header[0x205] as number;
  contentTypes.push(contentType);
  assert.equal(dv.getBigUint64(0x210, true), expectedId, 'title ID do NCA');
  assert.equal(Number(dv.getBigUint64(0x208, true)), nca.length, 'tamanho do NCA');
  const keyGeneration = Math.max(header[0x206] as number, header[0x220] as number, 1) - 1;
  const areaKey = keys.keyAreaKeys[keyGeneration]?.[header[0x207] as number];
  assert(areaKey, 'chave de área ausente no keyset');
  const keyArea = await aesEcbDecrypt(areaKey, header.subarray(0x300, 0x340));
  const sectionKey = keyArea.subarray(32, 48);
  for (let section = 0; section < 4; section++) {
    const start = dv.getUint32(0x240 + section * 16, true) * 512;
    const end = dv.getUint32(0x244 + section * 16, true) * 512;
    if (!start) continue;
    const fh = header.subarray(0x400 + section * 0x200, 0x600 + section * 0x200);
    assert(
      sha256(fh).equals(header.subarray(0x280 + section * 32, 0x2a0 + section * 32)),
      'hash do cabeçalho de seção',
    );
    const fv = view(fh);
    const body =
      fh[4] === 3
        ? Buffer.from(
            await aesCtrEncrypt(sectionKey, nca.subarray(start, end), buildNcaCtr(fh.subarray(0x140, 0x148), start)),
          )
        : nca.subarray(start, end);
    if (fh[3] === 3) {
      assert.equal(fh.toString('ascii', 8, 12), 'IVFC');
      const levels = Array.from({ length: 6 }, (_, index) => {
        const offset = 0x18 + index * 24;
        const from = Number(fv.getBigUint64(offset, true));
        return body.subarray(from, from + Number(fv.getBigUint64(offset + 8, true)));
      });
      assert(sha256(levels[0] as Buffer).equals(fh.subarray(0xc8, 0xe8)), 'hash mestre do IVFC');
      for (let level = 1; level < 6; level++) {
        const data = levels[level] as Buffer;
        const parent = levels[level - 1] as Buffer;
        const blockSize = 1 << fv.getUint32(0x28 + level * 24, true);
        for (let block = 0, offset = 0; offset < data.length; block++, offset += blockSize) {
          assert(
            sha256(data.subarray(offset, offset + blockSize)).equals(parent.subarray(block * 32, block * 32 + 32)),
            'RomFS corrompido',
          );
        }
      }
      const tree = await decodeRomFs(new Blob([new Uint8Array(levels[5] as Buffer)]));
      if (contentType === 0) programTree = tree;
      if (contentType === 2) controlTree = tree;
    } else if (fh[3] === 2) {
      const from = Number(fv.getBigUint64(0x40, true));
      const archive = pfs0(body.subarray(from, from + Number(fv.getBigUint64(0x48, true))));
      const main = archive.get('main');
      if (contentType === 0 && main) {
        assert.equal(main.toString('ascii', 0, 4), 'NSO0');
        assert(main.equals(readFileSync(join(runtime, 'exefs', 'main'))), 'runtime embutido diferente do @nx.js/nsp');
        assert(archive.has('main.npdm'));
        exefsChecked = true;
      }
    }
  }
}
assert.deepEqual(contentTypes.sort(), [0, 1, 2], 'NCAs esperados: programa, meta e controle');
assert(programTree && controlTree && exefsChecked, 'NSP incompleto');

let verifiedFiles = 0;
async function checkFiles(directory: string, tree: RomFsEntry): Promise<void> {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const entry = tree[item.name];
    assert(entry, `faltou no RomFS: ${item.name}`);
    if (item.isDirectory()) {
      assert(!(entry instanceof Blob));
      await checkFiles(join(directory, item.name), entry);
    } else {
      assert(entry instanceof Blob);
      assert(
        Buffer.from(await entry.arrayBuffer()).equals(readFileSync(join(directory, item.name))),
        `bytes diferentes: ${item.name}`,
      );
      verifiedFiles++;
    }
  }
}
await checkFiles(ROMFS_DIR, programTree);

const control = controlTree['control.nacp'];
assert(control instanceof Blob && control.size === 0x4000, 'NACP com tamanho inválido');
const metadata = new NACP(await control.arrayBuffer());
assert.equal(metadata.title, expected.title);
assert.equal(metadata.author, expected.author);
assert.equal(metadata.version, version);
assert.equal(metadata.id, expectedId);
assert.equal(metadata.startupUserAccount, expected.startupUserAccount);
const iconEntry = controlTree['icon_AmericanEnglish.dat'];
assert(iconEntry instanceof Blob, 'NSP sem ícone');
const expectedIcon = readFileSync(existsSync(ICON_PATH) ? ICON_PATH : join(runtime, 'icon.jpg'));
assert(Buffer.from(await iconEntry.arrayBuffer()).equals(expectedIcon), 'ícone embutido diferente do esperado');

console.log(
  JSON.stringify(
    {
      valido: true,
      arquivo: relative(ROOT_DIR, file),
      arquivosConferidos: verifiedFiles,
      ncasConferidos: contentTypes.length,
      titulo: metadata.title,
      versao: metadata.version,
      titleId: metadata.id.toString(16).padStart(16, '0'),
      runtimeEmbutido: exefsChecked,
      sha256: sha256(packageBytes).toString('hex'),
    },
    null,
    2,
  ),
);
