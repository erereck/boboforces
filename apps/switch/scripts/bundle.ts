/**
 * Build do Switch (tecnico.md §19.2), herdado do `build.mjs` do MMM: esbuild de `src/main.ts` para `<romfs>/main.js`
 * (ESM, ES2022, sourcemap) com `__PLATFORM__ = 'switch'` e `__ONLINE__ = false`, cópia dos assets e um manifesto com
 * sha256 de cada arquivo e o commit. Usado por `build.ts` (romfs do app) e pelo `tools/portcheck` (pasta própria),
 * para os dois checarem exatamente o mesmo bundle.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { build } from 'esbuild';
import type { BuildManifest } from '../src/platform/build-info.ts';
import { APP_DIR, ROOT_DIR, readVersion } from './paths.ts';

/** Constantes de compilação do Switch. O código compartilhado pode testar `__ONLINE__` para cortar rede do bundle. */
export const SWITCH_DEFINE: Readonly<Record<string, string>> = {
  __PLATFORM__: JSON.stringify('switch'),
  __ONLINE__: 'false',
};

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
  };
  if (!table.files) throw new Error(`${RUNTIME_ASSETS_TABLE} sem "files"`);
  return table.files;
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
  return { mainPath, mainBytes: readFileSync(mainPath).length, assetFiles, manifest, warnings };
}
