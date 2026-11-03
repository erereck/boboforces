/**
 * Montagem do pacote (só local, decisão #33): o `nxjs-nro` e o `patchNACP` leem `package.json`, `icon.jpg` e
 * `romfs/` da pasta atual e usam `name`/`version` do package.json. O do workspace não serve (`@boboforces/switch`,
 * versão 0.0.0), então montamos uma pasta com um package.json gerado: título, autor e title ID do campo `nacp` do app
 * e a versão do `version.json` (tecnico.md §19.2).
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ICON_PATH, OUT_DIR, ROMFS_DIR, readNacpFields, readVersion, type NacpFields } from './paths.ts';

export interface NacpPackageJson {
  readonly name: string;
  readonly version: string;
  readonly author: string;
  readonly private: true;
  readonly nacp: NacpFields;
}

/** package.json que o `patchNACP` do nx.js transforma no NACP. `name` vira o nome do arquivo gerado. */
export function nacpPackageJson(nacp: NacpFields, version: string): NacpPackageJson {
  return { name: 'boboforces', version, author: nacp.author, private: true, nacp: { ...nacp } };
}

export interface Stage {
  readonly dir: string;
  readonly version: string;
  readonly nacp: NacpFields;
  readonly hasIcon: boolean;
}

/** Monta `apps/switch/build/<nome>/` com package.json, icon.jpg (se houver) e uma cópia do RomFS. */
export function stagePackage(name: string): Stage {
  if (!existsSync(join(ROMFS_DIR, 'main.js'))) throw new Error('romfs/main.js não existe: rode `npm run build` antes');
  const dir = join(OUT_DIR, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const { version } = readVersion();
  const nacp = readNacpFields();
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(nacpPackageJson(nacp, version), null, 2)}\n`);
  const hasIcon = existsSync(ICON_PATH);
  if (hasIcon) copyFileSync(ICON_PATH, join(dir, 'icon.jpg'));
  else console.warn('Sem apps/switch/icon.jpg: o pacote usa o ícone padrão do nx.js (`npm run icon -- <png>`).');
  cpSync(ROMFS_DIR, join(dir, 'romfs'), { recursive: true });
  return { dir, version, nacp, hasIcon };
}
