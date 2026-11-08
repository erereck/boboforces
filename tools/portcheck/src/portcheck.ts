/**
 * Portcheck (tecnico.md §3 item 3, §20 e §21): build do Switch + varredura do bundle + boot em `node:vm` com globais
 * falsos do nx.js. A evolução do `test/platform.test.mjs` do MMM. O CLI fica em `index.ts`.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { bootBundle, type BootReport } from './boot.ts';
import { checkRomfs, formatRomfs, type RomfsReport } from './romfs.ts';
import { BUNDLE_RULE_HELP, scanBundle, type BundleFinding } from './scan.ts';
import { parseSourceMap, type SourceMapLookup } from './sourcemap.ts';

export { bootBundle, MENU_READY_MARKER, APPLET_NOTICE, type BootReport, type BootStatus } from './boot.ts';
export { scanBundle, BUNDLE_RULE_HELP, type BundleFinding, type BundleRule } from './scan.ts';
export { parseSourceMap, decodeVlq } from './sourcemap.ts';
export { NXJS_GLOBALS } from './fake-nx.ts';
export { checkRomfs, formatRomfs, placeholderReason, ROMFS_BUDGET_BYTES, type RomfsReport } from './romfs.ts';

export interface MappedFinding extends BundleFinding {
  /** `packages/x/src/y.ts:12:3` quando o source map resolve; senão a posição no bundle. */
  readonly where: string;
}

export interface PortcheckResult {
  readonly findings: MappedFinding[];
  readonly boot: BootReport;
  readonly mainBytes: number;
  /** M1: assets do runtime-assets.json no RomFS, provisórios e orçamento de tamanho. */
  readonly romfs: RomfsReport;
}

/** Caminhos lógicos do `assets-src/runtime-assets.json` (`files`). */
export function readLogicalAssets(rootDir: string): string[] {
  const path = join(rootDir, 'assets-src', 'runtime-assets.json');
  if (!existsSync(path)) return [];
  const table = JSON.parse(readFileSync(path, 'utf8')) as { files?: Record<string, string> };
  return Object.keys(table.files ?? {}).sort();
}

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else out.push(full);
  }
  return out;
}

/** RomFS em memória: caminho relativo com `/` → bytes. */
export function readRomfs(dir: string): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const file of listFiles(dir))
    out.set(relative(dir, file).split(sep).join('/'), new Uint8Array(readFileSync(file)));
  return out;
}

/** Caminho do source map (relativo a `rootDir`), sem os `../` do esbuild. */
function prettySource(source: string, mapDir: string, rootDir: string): string {
  const abs = join(mapDir, source);
  const rel = relative(rootDir, abs).split(sep).join('/');
  return rel.startsWith('..') ? source : rel;
}

/** Troca `main.js:L:C` nas pilhas pela posição no fonte. */
export function mapStack(
  text: string,
  filename: string,
  lookup: SourceMapLookup | null,
  pretty: (s: string) => string,
): string {
  if (!lookup) return text;
  const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`${escaped}:(\\d+):(\\d+)`, 'g'), (whole, l: string, c: string) => {
    const pos = lookup.lookup(Number(l), Number(c));
    return pos ? `${pretty(pos.source)}:${pos.line}:${pos.col}` : whole;
  });
}

export interface PortcheckOptions {
  /** Pasta com o RomFS já gerado (`main.js`, `main.js.map`, `manifest.json`, `assets/`). */
  readonly romfsDir: string;
  /** Raiz do monorepo, para mostrar caminhos relativos. */
  readonly rootDir: string;
  readonly maxFrames?: number;
}

export async function runPortcheck(opts: PortcheckOptions): Promise<PortcheckResult> {
  const mainPath = join(opts.romfsDir, 'main.js');
  if (!existsSync(mainPath)) throw new Error(`portcheck: ${mainPath} não existe (rode o build do Switch)`);
  const code = readFileSync(mainPath, 'utf8');
  const mapPath = `${mainPath}.map`;
  const lookup = existsSync(mapPath) ? parseSourceMap(readFileSync(mapPath, 'utf8')) : null;
  const pretty = (s: string): string => prettySource(s, opts.romfsDir, opts.rootDir);

  const findings: MappedFinding[] = scanBundle(code).map((f) => {
    const pos = lookup?.lookup(f.line, f.col);
    const where = pos ? `${pretty(pos.source)}:${pos.line}:${pos.col}` : `main.js:${f.line}:${f.col}`;
    return { ...f, where };
  });

  const filename = 'romfs:/main.js';
  const romfs = readRomfs(opts.romfsDir);
  const romfsReport = checkRomfs(romfs, readLogicalAssets(opts.rootDir));
  const boot = await bootBundle({
    code,
    filename,
    romfs,
    ...(opts.maxFrames === undefined ? {} : { maxFrames: opts.maxFrames }),
  });
  const mapText = (t: string): string => mapStack(t, filename, lookup, pretty);
  const mapped: BootReport = {
    ...boot,
    problems: boot.problems.map(mapText),
    frameErrors: boot.frameErrors.map(mapText),
    bootError: boot.bootError === null ? null : mapText(boot.bootError),
    runtimeLog: mapText(boot.runtimeLog),
  };
  return { findings, boot: mapped, mainBytes: Buffer.byteLength(code), romfs: romfsReport };
}

/** Relatório legível (pt-BR) para o terminal e o CI. */
export function formatResult(result: PortcheckResult): string {
  const lines: string[] = [];
  const { boot, findings } = result;
  lines.push(`Bundle: ${(result.mainBytes / 1024).toFixed(0)} KB`);
  lines.push(...formatRomfs(result.romfs));
  if (findings.length) {
    lines.push(`Varredura: ${findings.length} identificador(es) proibido(s) no bundle`);
    for (const f of findings) lines.push(`  ${f.where}  [${f.rule}] ${f.what}: ${BUNDLE_RULE_HELP[f.rule]}`);
  } else lines.push('Varredura: ok (sem rede, threads, eval, localStorage, Node, WASM nem módulos soltos)');
  lines.push(
    `Boot (node:vm, sem GPU): ${boot.status.toUpperCase()} · frames pedidos ${boot.framesRequested}, rodados ` +
      `${boot.framesRun}` +
      (boot.menuReadyFrame !== null
        ? ` · menu no frame ${boot.menuReadyFrame} (${boot.menuReadyMs} ms simulados)`
        : ''),
  );
  lines.push(
    `  aviso de modo aplicativo: ${boot.appletNotice ? 'sim' : 'NÃO'} · + fecha sem GPU: ${boot.plusExits ? 'sim' : 'NÃO'}`,
  );
  for (const p of boot.problems) lines.push(`  ${boot.status === 'pendente' ? 'pendente' : 'problema'}: ${p}`);
  for (const n of boot.notes) lines.push(`  nota: ${n}`);
  const log = boot.runtimeLog.trim();
  if (log) {
    lines.push('  runtime.log:');
    for (const l of log.split('\n').slice(-12)) lines.push(`    ${l}`);
  }
  return lines.join('\n');
}
