import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, posix } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  BUDGETS,
  FONT_TEXT_GZIP_LEVEL,
  LARGEST_EXCLUDED_EXTENSIONS,
  MATCH_GROUPS,
  ON_DEMAND_ASSETS,
  ON_DEMAND_CODE,
  RETIRED_ASSETS,
  UI_FONT_FILES,
  type Budget,
  type BudgetId,
  type MatchGroupId,
} from './budgets.ts';

const utf8 = new TextDecoder();

/** Tipos que o host comprime na transferência (o resto já chega comprimido ou é binário). */
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.webmanifest', '.txt', '.xml']);

export interface FileSize {
  /** Caminho relativo ao dist, com `/`. */
  readonly path: string;
  readonly raw: number;
  /** Bytes que trafegam: gzip nível 9 para texto (o JSON das fontes no nível de `FONT_TEXT_GZIP_LEVEL`), cru para binário. */
  readonly transfer: number;
}

export interface FileGroup {
  readonly files: readonly FileSize[];
  readonly total: number;
}

export interface DistReport {
  readonly files: readonly FileSize[];
  /** `index.html` + o fecho de JS/CSS que ele carrega sem esperar nada (scripts, modulepreload, imports estáticos). */
  readonly initial: readonly FileSize[];
  readonly html: number;
  readonly initialTotal: number;
  /** O atlas de fontes da UI (`UI_FONT_FILES`: PNG cru + JSON em gzip -4), parte do menu (decisão #54). */
  readonly fonts: FileGroup;
  /**
   * M1: o menu + os assets que a primeira partida no Construto baixa (tudo em `assets/` menos os chunks sob demanda e
   * os de `ON_DEMAND_ASSETS`). Arquivos fora de `assets/` (ícone, manifest, licenças, `bench/`) não entram.
   */
  readonly firstMatch: readonly FileSize[];
  readonly firstMatchTotal: number;
  /** Partes da primeira partida além do menu (`other` = asset sem grupo, que conta no acumulado mesmo assim). */
  readonly groups: Readonly<Record<MatchGroupId | 'other', FileGroup>>;
  /**
   * Assets aposentados pelo porte do boneco (`RETIRED_ASSETS`) que ainda estão no build: contam na primeira partida e
   * no total, fora do sub-orçamento de texturas.
   */
  readonly retired: FileGroup;
  /** Assets sob demanda (só contam no build inteiro). */
  readonly onDemand: readonly FileSize[];
  readonly total: number;
  readonly largest: FileSize | null;
}

export interface BudgetResult {
  readonly budget: Budget;
  readonly value: number;
  readonly ok: boolean;
  /** Acima da meta (`Budget.goal`) mas dentro do teto: só aviso. */
  readonly overGoal: boolean;
  /** Arquivo responsável (só no "maior arquivo"). */
  readonly file: string | null;
}

/** Fica fora da conta: sourcemaps (ninguém baixa ao jogar) e o manifesto interno do Vite. */
export function isIgnored(path: string): boolean {
  return path.endsWith('.map') || path.startsWith('.vite/');
}

export function transferSize(path: string, bytes: Uint8Array): number {
  if (!COMPRESSIBLE.has(extname(path).toLowerCase())) return bytes.length;
  return gzipSync(bytes, { level: UI_FONT_FILES.test(path) ? FONT_TEXT_GZIP_LEVEL : 9 }).length;
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

  const groups: Record<MatchGroupId | 'other', FileSize[]> = { construto: [], textures: [], sounds: [], other: [] };
  const onDemand: FileSize[] = [];
  const retired: FileSize[] = [];
  for (const file of files) {
    const kind = classifyFile(file.path, initial);
    if (kind === 'onDemand') onDemand.push(file);
    else if (kind === 'retired') retired.push(file);
    else if (kind !== 'initial' && kind !== 'outside') groups[kind].push(file);
  }
  const sum = (list: readonly FileSize[]): number => list.reduce((acc, f) => acc + f.transfer, 0);
  const firstMatch = [
    ...initialFiles,
    ...groups.construto,
    ...groups.textures,
    ...groups.sounds,
    ...groups.other,
    ...retired,
  ];
  const group = (list: FileSize[]): FileGroup => ({ files: list, total: sum(list) });
  return {
    files,
    initial: initialFiles,
    html: (byPath.get('index.html') as FileSize).transfer,
    initialTotal: sum(initialFiles),
    fonts: group(files.filter((f) => UI_FONT_FILES.test(f.path))),
    firstMatch,
    firstMatchTotal: sum(firstMatch),
    groups: {
      construto: group(groups.construto),
      textures: group(groups.textures),
      sounds: group(groups.sounds),
      other: group(groups.other),
    },
    retired: group(retired),
    onDemand,
    total: sum(files),
    largest,
  };
}

/**
 * Onde um arquivo do dist entra: na carga inicial (menu), num grupo da primeira partida (`other` quando nenhum casa:
 * conservador; inclui o chunk preguiçoso da cena), sob demanda, aposentado pelo porte do boneco (`retired`: conta na
 * partida, fora das texturas, até o passo 5 apagar) ou fora de tudo (fora de `assets/`, ou código sob demanda de
 * `ON_DEMAND_CODE`: a casca do bench e o `net` lazy do M5).
 */
export function classifyFile(
  path: string,
  initial: ReadonlySet<string>,
): 'initial' | MatchGroupId | 'other' | 'onDemand' | 'retired' | 'outside' {
  if (initial.has(path)) return 'initial';
  if (!path.startsWith('assets/')) return 'outside';
  // Código preguiçoso (integração do M1): o da cena conta na primeira partida (`other`); o do bench e o do `net`
  // ficam de fora.
  if (/\.(?:m?js|css)$/.test(path)) return ON_DEMAND_CODE.some((re) => re.test(path)) ? 'outside' : 'other';
  if (ON_DEMAND_ASSETS.some((re) => re.test(path))) return 'onDemand';
  if (RETIRED_ASSETS.some((re) => re.test(path))) return 'retired';
  return MATCH_GROUPS.find((g) => g.test.test(path))?.id ?? 'other';
}

export function checkBudgets(report: DistReport, budgets: readonly Budget[] = BUDGETS): BudgetResult[] {
  const values: Record<BudgetId, number> = {
    html: report.html,
    initial: report.initialTotal,
    fonts: report.fonts.total,
    firstMatch: report.firstMatchTotal,
    construto: report.groups.construto.total,
    textures: report.groups.textures.total,
    sounds: report.groups.sounds.total,
    total: report.total,
    largest: report.largest?.transfer ?? 0,
  };
  return budgets.map((budget) => {
    const value = values[budget.id];
    const ok = value <= budget.limit;
    return {
      budget,
      value,
      ok,
      overGoal: ok && budget.goal !== undefined && value > budget.goal,
      file: budget.id === 'largest' ? (report.largest?.path ?? null) : null,
    };
  });
}

/** Bytes em pt-BR (vírgula decimal), sem `Intl`, para a saída do CI ficar igual em qualquer máquina. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1).replace('.', ',')} KB`;
  return `${(bytes / 1_000_000).toFixed(2).replace('.', ',')} MB`;
}

export function formatReport(report: DistReport, results: readonly BudgetResult[], verbose: boolean): string {
  const lines: string[] = [];
  const label = (b: Budget): string => (b.parent ? `  ${b.label}` : b.label);
  const width = Math.max(...results.map((r) => label(r.budget).length));
  for (const r of results) {
    const status = (r.ok ? (r.overGoal ? 'meta!' : 'ok') : 'ESTOUROU').padEnd(8);
    const value = `${formatBytes(r.value)} / ${formatBytes(r.budget.limit)}`;
    const goal = r.budget.goal !== undefined ? `  (meta ${formatBytes(r.budget.goal)})` : '';
    const file = r.file ? `  (${r.file})` : '';
    lines.push(`  ${status} ${label(r.budget).padEnd(width)}  ${value.padStart(22)}${goal}${file}`);
  }
  for (const r of results.filter((x) => x.overGoal)) {
    lines.push(
      '',
      `  Aviso: ${r.budget.label} acima da meta de ${formatBytes(r.budget.goal ?? 0)} (o teto de ` +
        `${formatBytes(r.budget.limit)} é que reprova).`,
    );
  }
  if (report.retired.files.length > 0) {
    lines.push(
      '',
      '  Aviso: assets aposentados pelo porte do boneco (#56) ainda no build (contam na primeira partida, fora das' +
        ' texturas; o passo 5 tira do runtime-assets.json):',
    );
    for (const f of report.retired.files) lines.push(`    ${formatBytes(f.transfer).padStart(10)}  ${f.path}`);
  }
  const list = (title: string, files: readonly FileSize[]): void => {
    lines.push('', `  ${title}:`);
    if (files.length === 0) lines.push('    (nenhum)');
    for (const f of files) lines.push(`    ${formatBytes(f.transfer).padStart(10)}  ${f.path}`);
  };
  if (report.groups.other.files.length > 0) {
    lines.push(
      '',
      '  Aviso: assets sem grupo (contam na primeira partida; se forem sob demanda, ponha em ON_DEMAND_ASSETS):',
    );
    for (const f of report.groups.other.files) lines.push(`    ${formatBytes(f.transfer).padStart(10)}  ${f.path}`);
  }
  if (verbose) {
    list('Carga inicial (menu)', report.initial);
    list('Fontes (atlas MSDF)', report.fonts.files);
    list('Primeira partida: Construto', report.groups.construto.files);
    list('Primeira partida: texturas', report.groups.textures.files);
    list('Primeira partida: sons', report.groups.sounds.files);
    list('Aposentados pelo porte do boneco (#56)', report.retired.files);
    list('Sob demanda', report.onDemand);
    list('Todos os arquivos', report.files);
  }
  return lines.join('\n');
}
