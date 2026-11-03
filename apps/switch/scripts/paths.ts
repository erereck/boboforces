/**
 * Caminhos e metadados comuns aos scripts do Switch (build, NRO, NSP, verificações). Tudo roda no Node 24+ com os
 * `.ts` direto, a partir de qualquer pasta.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const APP_DIR = resolve(import.meta.dirname, '..');
export const ROOT_DIR = resolve(APP_DIR, '..', '..');
/** Saída do esbuild e dos assets; vira o RomFS do NRO/NSP. Fora do git. */
export const ROMFS_DIR = join(APP_DIR, 'romfs');
/** Pacotes gerados (NRO/NSP) e pastas de montagem. Fora do git (`build/`). */
export const OUT_DIR = join(APP_DIR, 'build');
/** Ícone do HOME e do homebrew menu: JPEG 256×256 (`npm run icon` gera a partir de um PNG quadrado). */
export const ICON_PATH = join(APP_DIR, 'icon.jpg');
/** Pasta privada da raiz (fora do git): config do Eden, logs. As chaves nunca são copiadas para cá. */
export const LOCAL_DIR = join(ROOT_DIR, 'local');

export interface VersionJson {
  readonly version: string;
  readonly codename: string;
}

export function readVersion(): VersionJson {
  const v = JSON.parse(readFileSync(join(ROOT_DIR, 'version.json'), 'utf8')) as Partial<VersionJson>;
  if (typeof v.version !== 'string' || typeof v.codename !== 'string')
    throw new Error('version.json sem version/codename');
  return { version: v.version, codename: v.codename };
}

/** Campos do `nacp` no package.json do app (fonte única do título, autor e title ID). */
export interface NacpFields {
  readonly title: string;
  readonly author: string;
  readonly id: string;
  readonly startupUserAccount: number;
  readonly userAccountSaveDataSize: string;
}

export function readNacpFields(): NacpFields {
  const pkg = JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8')) as { nacp?: Partial<NacpFields> };
  const n = pkg.nacp ?? {};
  if (!n.title || !n.author || !n.id || n.startupUserAccount === undefined || n.userAccountSaveDataSize === undefined) {
    throw new Error('apps/switch/package.json: campo "nacp" incompleto');
  }
  return {
    title: n.title,
    author: n.author,
    id: n.id,
    startupUserAccount: n.startupUserAccount,
    userAccountSaveDataSize: n.userAccountSaveDataSize,
  };
}

/** `BoboForces-0.0.1` */
export function packageBaseName(version: string): string {
  return `BoboForces-${version}`;
}

/** Valor de `-k <arquivo>` / `--keyset <arquivo>` na linha de comando. */
export function keysetArg(argv: readonly string[]): string | undefined {
  const i = argv.findIndex((a) => a === '-k' || a === '--keyset');
  return i >= 0 ? argv[i + 1] : undefined;
}
