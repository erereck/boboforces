// `npm run verify:nro` (apps/switch): confere o NRO gerado contra o romfs/ e o NACP esperado (herdado do MMM).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { NACP } from '@tootallnate/nacp';
import { decode as decodeNro } from '@tootallnate/nro';
import { decode as decodeRomFs, type RomFsEntry } from '@tootallnate/romfs';
import { ICON_PATH, OUT_DIR, ROMFS_DIR, ROOT_DIR, packageBaseName, readNacpFields, readVersion } from './paths.ts';

const { version } = readVersion();
const expected = readNacpFields();
const file = join(OUT_DIR, `${packageBaseName(version)}.nro`);
if (!existsSync(file)) throw new Error(`${relative(ROOT_DIR, file)} não existe: rode \`npm run nro\``);
const bytes = readFileSync(file);
const nro = await decodeNro(new Blob([bytes]));
assert(nro.nacp && nro.romfs && nro.icon, 'NRO sem NACP, RomFS ou ícone');

const nacp = new NACP(await nro.nacp.arrayBuffer());
assert.equal(nacp.id, BigInt(`0x${expected.id}`), 'title ID');
assert.equal(nacp.title, expected.title, 'título');
assert.equal(nacp.author, expected.author, 'autor');
assert.equal(nacp.version, version, 'versão (version.json)');
assert.equal(nacp.startupUserAccount, expected.startupUserAccount, 'startupUserAccount');
if (existsSync(ICON_PATH)) {
  assert(
    Buffer.from(await nro.icon.arrayBuffer()).equals(readFileSync(ICON_PATH)),
    'ícone embutido difere do icon.jpg',
  );
}

let verified = 0;
async function walk(directory: string, entries: RomFsEntry): Promise<void> {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const entry = entries[item.name];
    assert(entry, `faltou no RomFS: ${item.name}`);
    if (item.isDirectory()) {
      assert(!(entry instanceof Blob), `${item.name} deveria ser pasta`);
      await walk(join(directory, item.name), entry);
    } else {
      assert(entry instanceof Blob, `${item.name} deveria ser arquivo`);
      assert(
        Buffer.from(await entry.arrayBuffer()).equals(readFileSync(join(directory, item.name))),
        `bytes diferentes: ${item.name}`,
      );
      verified++;
    }
  }
}
await walk(ROMFS_DIR, await decodeRomFs(nro.romfs));
console.log(
  JSON.stringify(
    {
      valido: true,
      arquivo: relative(ROOT_DIR, file),
      arquivosConferidos: verified,
      titulo: nacp.title,
      versao: nacp.version,
      titleId: nacp.id.toString(16).padStart(16, '0'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
    null,
    2,
  ),
);
