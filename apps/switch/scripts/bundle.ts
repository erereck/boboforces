/**
 * Build do Switch (tecnico.md §19.2), herdado do `build.mjs` do MMM: esbuild de `src/main.ts` para `<romfs>/main.js`
 * (ESM, ES2022, sourcemap) com `__PLATFORM__ = 'switch'` e `__ONLINE__ = false`, cópia dos assets, o `licencas.txt`
 * da raiz (`licenses.ts`), o `nxjs.ini` (V8 sem Sparkplug) e um manifesto com sha256 de cada arquivo e o commit.
 * Usado por `build.ts` (romfs do app) e pelo `tools/portcheck` (pasta própria), para os dois checarem exatamente o
 * mesmo bundle.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { build } from 'esbuild';
import type { BuildManifest } from '../src/platform/build-info.ts';
import { buildLicenses, ROMFS_LICENSES_NAME } from './licenses.ts';
import { APP_DIR, ROOT_DIR, readVersion } from './paths.ts';

/** Constantes de compilação do Switch. O código compartilhado pode testar `__ONLINE__` para cortar rede do bundle. */
export const SWITCH_DEFINE: Readonly<Record<string, string>> = {
  __PLATFORM__: JSON.stringify('switch'),
  __ONLINE__: 'false',
};

/** `nxjs.ini` na raiz do RomFS: o runtime do nx.js lê antes de subir o V8 (docs do nx.js, runtime/configuration). */
export const NXJS_INI_NAME = 'nxjs.ini';

/**
 * Sem o Sparkplug: no console, com o JIT do modo aplicativo (aberto segurando R), o nx.js 1.0.0-beta.7 cai no boot com
 * Data Abort (erro 2168-0002) ao gravar o cabeçalho de uma página grande de código do Sparkplug, antes de qualquer
 * linha do app (issue #424 do nx.js, aberta; o Eden não reproduz). Maglev e TurboFan seguem ligados; o `jit = auto`
 * mantém o padrão de cada modo (JIT no aplicativo, interpretador no applet). Só ASCII: o arquivo é lido em C.
 */
export const NXJS_INI = [
  '; BoboForces: configuracao do runtime do nx.js (lida antes do V8).',
  '; --no-sparkplug: o Sparkplug derruba o boot no console com JIT (nx.js issue #424).',
  '[v8]',
  'jit = auto',
  'flags = --no-sparkplug',
  '',
].join('\n');

/** Assets gerados (assets-src → build/, tecnico.md §3), copiados para `<romfs>/assets/`. A variante do Switch vence. */
export const ASSET_SOURCES = ['build/assets', 'build/assets-switch'] as const;

/**
 * Tabela dos assets que o jogo carrega pelo caminho lógico (a mesma que o Vite usa na web): cada entrada vai para
 * `<romfs>/assets/<lógico>`, onde a `platform.assets` do Switch procura.
 */
export const RUNTIME_ASSETS_TABLE = 'assets-src/runtime-assets.json';

export function readRuntimeAssets(): Readonly<Record<string, string>> {
  const table = JSON.parse(readFileSync(join(ROOT_DIR, RUNTIME_ASSETS_TABLE), 'utf8')) as {
    files?: Record<string, string>;
    local?: Record<string, string>;
  };
  if (!table.files) throw new Error(`${RUNTIME_ASSETS_TABLE} sem "files"`);
  // `local`: assets gerados só sob demanda na máquina do Erick; o NRO local leva os que existirem. Vazio desde a
  // decisão #54 (a chave fica no contrato da tabela).
  const local = Object.entries(table.local ?? {}).filter(([, file]) => existsSync(join(ROOT_DIR, 'assets-src', file)));
  return { ...table.files, ...Object.fromEntries(local) };
}

export interface SwitchBuildOptions {
  /** Pasta de saída; é apagada e recriada. Precisa se chamar `romfs`. */
  readonly outDir: string;
  readonly minify?: boolean;
}

export interface SwitchBuildResult {
  readonly mainPath: string;
  readonly mainBytes: number;
  readonly assetFiles: number;
  /** Tamanho do `licencas.txt` da raiz do RomFS. */
  readonly licensesBytes: number;
  readonly manifest: BuildManifest;
  readonly warnings: readonly string[];
}

function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: ROOT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else out.push(full);
  }
  return out;
}

export async function buildSwitch(opts: SwitchBuildOptions): Promise<SwitchBuildResult> {
  // Trava de segurança: a pasta é apagada inteira.
  if (basename(opts.outDir) !== 'romfs')
    throw new Error(`buildSwitch: a saída precisa ser uma pasta "romfs" (${opts.outDir})`);
  rmSync(opts.outDir, { recursive: true, force: true });
  mkdirSync(opts.outDir, { recursive: true });

  const mainPath = join(opts.outDir, 'main.js');
  const result = await build({
    entryPoints: [join(APP_DIR, 'src', 'main.ts')],
    outfile: mainPath,
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    sourcemap: true,
    sourcesContent: false,
    minify: opts.minify ?? false,
    define: SWITCH_DEFINE,
    legalComments: 'eof',
    logLevel: 'silent',
    // Os pacotes npm que entraram no bundle, para o `licencas.txt`.
    metafile: true,
  });
  const warnings = result.warnings.map((w) => `${w.location ? `${w.location.file}:${w.location.line} ` : ''}${w.text}`);

  let assetFiles = 0;
  for (const [logical, source] of Object.entries(readRuntimeAssets())) {
    const target = join(opts.outDir, 'assets', ...logical.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(ROOT_DIR, 'assets-src', source), target);
    assetFiles++;
  }
  for (const source of ASSET_SOURCES) {
    const dir = join(ROOT_DIR, source);
    if (!existsSync(dir)) continue;
    cpSync(dir, join(opts.outDir, 'assets'), { recursive: true });
    assetFiles += listFiles(dir).length;
  }
  const licenses = buildLicenses(Object.keys(result.metafile.inputs), process.cwd(), ROOT_DIR);
  writeFileSync(join(opts.outDir, ROMFS_LICENSES_NAME), licenses);
  writeFileSync(join(opts.outDir, NXJS_INI_NAME), NXJS_INI);

  const { version, codename } = readVersion();
  const commit = git(['rev-parse', 'HEAD']);
  const status = commit ? git(['status', '--porcelain']) : null;
  const files: Record<string, string> = {};
  for (const file of listFiles(opts.outDir).sort()) {
    const rel = relative(opts.outDir, file).split(sep).join('/');
    files[rel] = createHash('sha256').update(readFileSync(file)).digest('hex');
  }
  const manifest: BuildManifest = {
    name: 'BoboForces',
    version,
    codename,
    platform: 'switch',
    online: false,
    commit,
    dirty: status === null ? null : status.length > 0,
    files,
  };
  writeFileSync(join(opts.outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    mainPath,
    mainBytes: readFileSync(mainPath).length,
    assetFiles,
    licensesBytes: Buffer.byteLength(licenses),
    manifest,
    warnings,
  };
}
