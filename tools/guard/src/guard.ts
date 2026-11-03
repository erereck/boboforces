/**
 * Guardas de portabilidade do monorepo (substituem o ESLint, PLANO_M0.md): varrem o código que vai para o jogo
 * (`packages/*\/src` e `apps/*\/src`, sem testes nem `.d.ts`) e aplicam as regras de `rules.ts`.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { checkFile, type CheckContext, type Violation, type WorkspaceInfo } from './check.ts';

export { checkFile, type CheckContext, type Violation, type WorkspaceInfo } from './check.ts';
export { tokenize, type Comment, type LexResult, type Token, type TokenKind } from './lexer.ts';
export { RULE_HELP, type RuleId } from './rules.ts';

const SOURCE_EXT = /\.(?:ts|mts|cts|tsx|js|mjs|cjs|jsx)$/;
const SKIP_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$|\.d\.[cm]?ts$/;

interface PackageJson {
  readonly name?: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
}

const toPosix = (p: string): string => p.split(sep).join('/');

/** Workspaces de `packages/`, `apps/` e `tools/` com as dependências declaradas. */
export function loadWorkspaces(root: string): WorkspaceInfo[] {
  const out: WorkspaceInfo[] = [];
  for (const group of ['packages', 'apps', 'tools']) {
    const dir = join(root, group);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const pkgPath = join(dir, entry.name, 'package.json');
      if (!entry.isDirectory() || !existsSync(pkgPath)) continue;
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageJson;
      const deps = new Set([
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
        ...Object.keys(pkg.peerDependencies ?? {}),
      ]);
      out.push({ dir: `${group}/${entry.name}`, packageName: pkg.name ?? entry.name, deps });
    }
  }
  return out;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE_EXT.test(entry.name) && !SKIP_FILE.test(entry.name)) out.push(full);
  }
}

/** Arquivos do jogo a varrer, relativos à raiz e ordenados. */
export function collectFiles(root: string): string[] {
  const out: string[] = [];
  for (const group of ['packages', 'apps']) {
    const dir = join(root, group);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const src = join(dir, entry.name, 'src');
      if (entry.isDirectory() && existsSync(src)) walk(src, out);
    }
  }
  return out.map((f) => toPosix(relative(root, f))).sort();
}

export interface GuardResult {
  readonly files: number;
  readonly violations: Violation[];
  readonly suppressed: number;
}

export function runGuard(root: string): GuardResult {
  const ctx: CheckContext = { workspaces: loadWorkspaces(root) };
  const files = collectFiles(root);
  const violations: Violation[] = [];
  let suppressed = 0;
  for (const rel of files) {
    const report = checkFile(rel, readFileSync(join(root, rel), 'utf8'), ctx);
    violations.push(...report.violations);
    suppressed += report.suppressed;
  }
  return { files: files.length, violations, suppressed };
}

/** `arquivo:linha:coluna  [regra] mensagem`, um por linha. */
export function formatViolation(v: Violation): string {
  return `${v.file}:${v.line}:${v.col}  [${v.rule}] ${v.message}`;
}
