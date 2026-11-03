import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, posix } from 'node:path';
import { gzipSync } from 'node:zlib';
import { BUDGETS, LARGEST_EXCLUDED_EXTENSIONS, type Budget, type BudgetId } from './budgets.ts';

const utf8 = new TextDecoder();

/** Tipos que o host comprime na transferência (o resto já chega comprimido ou é binário). */
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.webmanifest', '.txt', '.xml']);

export interface FileSize {
  /** Caminho relativo ao dist, com `/`. */
  readonly path: string;
  readonly raw: number;
  /** Bytes que trafegam: gzip nível 9 para texto, cru para binário. */
  readonly transfer: number;
}

export interface DistReport {
  readonly files: readonly FileSize[];
  /** `index.html` + o fecho de JS/CSS que ele carrega sem esperar nada (scripts, modulepreload, imports estáticos). */
  readonly initial: readonly FileSize[];
  readonly html: number;
  readonly initialTotal: number;
  readonly total: number;
  readonly largest: FileSize | null;
}

export interface BudgetResult {
  readonly budget: Budget;
  readonly value: number;
  readonly ok: boolean;
  /** Arquivo responsável (só no "maior arquivo"). */
  readonly file: string | null;
}

/** Fica fora da conta: sourcemaps (ninguém baixa ao jogar) e o manifesto interno do Vite. */
export function isIgnored(path: string): boolean {
  return path.endsWith('.map') || path.startsWith('.vite/');
}

export function transferSize(path: string, bytes: Uint8Array): number {
  return COMPRESSIBLE.has(extname(path).toLowerCase()) ? gzipSync(bytes, { level: 9 }).length : bytes.length;
}

function listFiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(dir, rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/** `src` de `<script>` e `href` de `<link rel="modulepreload|stylesheet|preload">` do index.html. */
export function htmlInitialRefs(html: string): string[] {
  const refs: string[] = [];
  for (const tag of html.matchAll(/<script\b[^>]*>/gi)) {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag[0]);
    if (src?.[1]) refs.push(src[1]);
  }
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = /\brel\s*=\s*["']?([^"'>]+?)["'\s>]/i.exec(tag[0])?.[1]?.toLowerCase() ?? '';
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag[0])?.[1];
    if (href && /\b(modulepreload|stylesheet|preload)\b/.test(rel)) refs.push(href);
  }
  return refs;
}

/**
 * Especificadores de `import`/`export … from` ESTÁTICOS de um JS (minificado ou não). `import()` dinâmico fica de fora
 * de propósito: é carga sob demanda (ex.: `net` no M5), não inicial.
 */
export function staticImports(js: string): string[] {
  const out: string[] = [];
  const re = /(?:^|[^\w$.])(?:import|export)\s*(?:[\w$*{}\s,]+?\s*from\s*)?(["'])([^"'\n]+)\1/g;
  for (const match of js.matchAll(re)) if (match[2]) out.push(match[2]);
  return out;
}

/** Caminho no dist de uma referência feita a partir de `fromFile`; `null` se for externa (URL, data:). */
export function resolveRef(fromFile: string, ref: string): string | null {
  const clean = ref.replace(/[?#].*$/, '');
  if (clean === '' || /^[a-z][a-z0-9+.-]*:/i.test(clean) || clean.startsWith('//')) return null;
  const joined = clean.startsWith('/') ? clean.slice(1) : posix.join(posix.dirname(fromFile), clean);
  const normal = posix.normalize(joined);
  return normal.startsWith('..') ? null : normal;
}

/** Mede um `dist` do Vite. Falha se não houver `index.html`. */
export function measureDist(dir: string): DistReport {
  const contents = new Map<string, Uint8Array>();
  const files: FileSize[] = [];
  for (const path of listFiles(dir).sort()) {
    if (isIgnored(path)) continue;
    const bytes = readFileSync(join(dir, path));
    contents.set(path, bytes);
    files.push({ path, raw: bytes.length, transfer: transferSize(path, bytes) });
  }
  const byPath = new Map(files.map((f) => [f.path, f]));
  const htmlBytes = contents.get('index.html');
  if (!htmlBytes) throw new Error(`size-check: ${dir} não tem index.html`);

  const initial = new Set<string>(['index.html']);
  const queue: string[] = [];
  for (const ref of htmlInitialRefs(utf8.decode(htmlBytes))) {
    const path = resolveRef('index.html', ref);
    if (path && contents.has(path) && !initial.has(path)) {
      initial.add(path);
      queue.push(path);
    }
  }
  while (queue.length > 0) {
    const from = queue.pop() as string;
    if (!/\.m?js$/.test(from)) continue;
    for (const ref of staticImports(utf8.decode(contents.get(from)))) {
      const path = resolveRef(from, ref);
      if (path && contents.has(path) && !initial.has(path)) {
        initial.add(path);
        queue.push(path);
      }
    }
  }

  const initialFiles = [...initial].sort().map((p) => byPath.get(p) as FileSize);
  let largest: FileSize | null = null;
  for (const file of files) {
    if (LARGEST_EXCLUDED_EXTENSIONS.includes(extname(file.path).toLowerCase())) continue;
    if (!largest || file.transfer > largest.transfer) largest = file;
  }
  return {
    files,
    initial: initialFiles,
    html: (byPath.get('index.html') as FileSize).transfer,
    initialTotal: initialFiles.reduce((sum, f) => sum + f.transfer, 0),
    total: files.reduce((sum, f) => sum + f.transfer, 0),
    largest,
  };
}

export function checkBudgets(report: DistReport, budgets: readonly Budget[] = BUDGETS): BudgetResult[] {
  const values: Record<BudgetId, number> = {
    html: report.html,
    initial: report.initialTotal,
    total: report.total,
    largest: report.largest?.transfer ?? 0,
  };
  return budgets.map((budget) => ({
    budget,
    value: values[budget.id],
    ok: values[budget.id] <= budget.limit,
    file: budget.id === 'largest' ? (report.largest?.path ?? null) : null,
  }));
}

/** Bytes em pt-BR (vírgula decimal), sem `Intl`, para a saída do CI ficar igual em qualquer máquina. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1).replace('.', ',')} KB`;
  return `${(bytes / 1_000_000).toFixed(2).replace('.', ',')} MB`;
}

export function formatReport(report: DistReport, results: readonly BudgetResult[], verbose: boolean): string {
  const lines: string[] = [];
  const width = Math.max(...results.map((r) => r.budget.label.length));
  for (const r of results) {
    const status = (r.ok ? 'ok' : 'ESTOUROU').padEnd(8);
    const value = `${formatBytes(r.value)} / ${formatBytes(r.budget.limit)}`;
    const file = r.file ? `  (${r.file})` : '';
    lines.push(`  ${status} ${r.budget.label.padEnd(width)}  ${value.padStart(22)}${file}`);
  }
  if (verbose) {
    lines.push('', '  Carga inicial:');
    for (const f of report.initial) lines.push(`    ${formatBytes(f.transfer).padStart(10)}  ${f.path}`);
    lines.push('', '  Todos os arquivos:');
    for (const f of report.files) lines.push(`    ${formatBytes(f.transfer).padStart(10)}  ${f.path}`);
  }
  return lines.join('\n');
}
