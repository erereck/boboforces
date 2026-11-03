/**
 * Motor do guard: aplica as regras de `rules.ts` sobre os tokens de um arquivo (sem comentários nem strings).
 * Heurístico de propósito (sem AST nem checagem de tipos), mas com escopo aproximado por blocos: um parâmetro
 * `document` só vale dentro da sua função. Também enxerga os disfarces comuns de um global: `obj['nome']` vale como
 * `obj.nome`, `(globalThis as any).x` como `globalThis.x`, e alias, desestruturação e `Reflect.get` da raiz global.
 * O que escapa daqui ainda passa pelo typecheck dos pacotes puros e pelo portcheck do bundle do Switch.
 */
import { posix } from 'node:path';
import { tokenize, type Token } from './lexer.ts';
import {
  CLOCK_GLOBALS,
  IDENTIFIER_RULES,
  MATH_PURE_MEMBERS,
  NEW_RULES,
  RENDER_DATA_SPECS,
  RULE_HELP,
  allowsDynamicImport,
  isApp,
  isDeterministic,
  isForbiddenThreeSubpath,
  isPackage,
  isShared,
  type FileInfo,
  type IdentifierRule,
  type RuleId,
} from './rules.ts';

export interface Violation {
  readonly file: string;
  readonly line: number;
  readonly col: number;
  readonly rule: RuleId;
  readonly message: string;
}

/** Um workspace do monorepo (`packages/sim`, `apps/web`…), com as dependências declaradas no package.json. */
export interface WorkspaceInfo {
  /** Pasta relativa à raiz, com `/`. */
  readonly dir: string;
  readonly packageName: string;
  readonly deps: ReadonlySet<string>;
}

export interface CheckContext {
  readonly workspaces: readonly WorkspaceInfo[];
}

export interface FileReport {
  readonly violations: Violation[];
  /** Violações silenciadas por `guard-allow: <regra> <motivo>`. */
  readonly suppressed: number;
}

/** Objetos globais pelos quais um nome proibido ainda é "o global": `globalThis.fetch`, `window.document`… */
const GLOBAL_ROOTS = new Set(['globalThis', 'window', 'self', 'global']);
const DECLARATION_KEYWORDS = new Set([
  'const',
  'let',
  'var',
  'function',
  'class',
  'interface',
  'type',
  'enum',
  'namespace',
  'declare',
]);
/** Modificadores que podem vir antes do nome de um método ou campo (classe, interface, tipo). */
const METHOD_MODIFIERS = new Set([
  'static',
  'async',
  'get',
  'set',
  'public',
  'private',
  'protected',
  'readonly',
  'override',
  'abstract',
  'declare',
  'accessor',
]);
/** Palavras que podem vir antes de `(` sem serem nome de função (então os nomes dentro não são parâmetros). */
const NOT_A_FUNCTION_NAME = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'with',
  'return',
  'typeof',
  'await',
  'yield',
  'new',
  'in',
  'of',
  'do',
  'else',
  'case',
  'throw',
  'void',
  'delete',
  'instanceof',
  'import',
  'super',
]);
/** Depois destas palavras, `[` abre um array ou tupla (e não um acesso por índice). */
const NOT_AN_OBJECT = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
  'default',
  'readonly',
  'keyof',
  'extends',
  'implements',
  'export',
  'as',
  'satisfies',
  'is',
  'infer',
  'unique',
  'let',
  'const',
  'var',
]);
/**
 * Palavras reservadas e contextuais: `obj['const']` NÃO vira `obj.const`, para a análise de declarações não confundir
 * a propriedade com a palavra-chave (nenhum global interessante tem esses nomes).
 */
const RESERVED = new Set([
  ...DECLARATION_KEYWORDS,
  ...NOT_A_FUNCTION_NAME,
  ...NOT_AN_OBJECT,
  'break',
  'continue',
  'debugger',
  'false',
  'finally',
  'null',
  'this',
  'true',
  'try',
  'from',
  'package',
  'static',
  'private',
  'protected',
  'public',
  'abstract',
  'async',
]);
const IDENT_NAME = /^[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*$/u;

const isPunct = (t: Token | undefined, value: string): boolean => t?.kind === 'punct' && t.value === value;
const isIdent = (t: Token | undefined, value?: string): boolean =>
  t?.kind === 'ident' && (value === undefined || t.value === value);
const isMemberDot = (t: Token | undefined): boolean => isPunct(t, '.') || isPunct(t, '?.');
const isOpener = (t: Token | undefined): boolean => isPunct(t, '(') || isPunct(t, '[') || isPunct(t, '{');
const isCloser = (t: Token | undefined): boolean => isPunct(t, ')') || isPunct(t, ']') || isPunct(t, '}');

/**
 * `obj['nome']` e ``obj[`nome`]`` viram `obj.nome`, e `obj?.['nome']` vira `obj?.nome`: as regras de membro e de
 * global valem igual por colchete. `['a']` depois de `=`, `(`, `return`… é array e fica como está.
 */
export function normalizeBracketAccess(tokens: readonly Token[]): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as Token;
    const lit = tokens[i + 1];
    if (
      isPunct(t, '[') &&
      (lit?.kind === 'string' || lit?.kind === 'template') &&
      isPunct(tokens[i + 2], ']') &&
      IDENT_NAME.test(lit.value) &&
      !RESERVED.has(lit.value)
    ) {
      const prev = out[out.length - 1];
      const name: Token = { kind: 'ident', value: lit.value, line: lit.line, col: lit.col };
      if (isPunct(prev, '?.')) {
        out.push(name);
        i += 2;
        continue;
      }
      const objectEnd =
        (prev?.kind === 'ident' && !NOT_AN_OBJECT.has(prev.value)) || isPunct(prev, ')') || isPunct(prev, ']');
      if (objectEnd) {
        out.push({ kind: 'punct', value: '.', line: t.line, col: t.col }, name);
        i += 2;
        continue;
      }
    }
    out.push(t);
  }
  return out;
}

/** Aninhamento por `(`, `[` e `{` (tolerante a código malformado). */
export interface Structure {
  /** Fechamento de cada abertura (ou -1 para o que não é abertura). */
  readonly close: Int32Array;
  /** Abertura mais interna (de qualquer tipo) que contém o token, ou -1. */
  readonly group: Int32Array;
  /** `{` mais interno que contém o token, ou -1. */
  readonly block: Int32Array;
}

export function analyzeStructure(tokens: readonly Token[]): Structure {
  const n = tokens.length;
  const close = new Int32Array(n).fill(-1);
  const group = new Int32Array(n).fill(-1);
  const block = new Int32Array(n).fill(-1);
  const stack: number[] = [];
  const blocks: number[] = [];
  const opening: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  for (let i = 0; i < n; i++) {
    const t = tokens[i] as Token;
    group[i] = stack.length > 0 ? (stack[stack.length - 1] as number) : -1;
    block[i] = blocks.length > 0 ? (blocks[blocks.length - 1] as number) : -1;
    if (isOpener(t)) {
      stack.push(i);
      if (t.value === '{') blocks.push(i);
    } else if (isCloser(t)) {
      const want = opening[t.value];
      while (stack.length > 0) {
        const o = stack.pop() as number;
        close[o] = i;
        if (tokens[o]?.value === '{') blocks.pop();
        if (tokens[o]?.value === want) break;
      }
    }
  }
  for (const o of stack) close[o] = n - 1;
  return { close, group, block };
}

/** Nomes locais com o intervalo de tokens onde valem (aproximação de escopo por bloco/função). */
export class Scopes {
  private readonly ranges = new Map<string, number[]>();

  add(name: string, from: number, to: number): void {
    const list = this.ranges.get(name);
    if (list) list.push(from, to);
    else this.ranges.set(name, [from, to]);
  }

  /** O nome está declarado localmente no token `at`? */
  has(name: string, at: number): boolean {
    const list = this.ranges.get(name);
    if (!list) return false;
    for (let k = 0; k < list.length; k += 2)
      if ((list[k] as number) <= at && at <= (list[k + 1] as number)) return true;
    return false;
  }
}

/** Fim (inclusive) do corpo de uma arrow function cujo `=>` está em `k`. */
function arrowEnd(tokens: readonly Token[], st: Structure, k: number): number {
  if (isPunct(tokens[k + 1], '{')) return st.close[k + 1] as number;
  const g = st.group[k] as number;
  for (let j = k + 1; j < tokens.length; j++) {
    const t = tokens[j] as Token;
    if (isOpener(t)) {
      j = st.close[j] as number;
      continue;
    }
    if (isCloser(t)) return j - 1;
    if ((isPunct(t, ';') || isPunct(t, ',')) && st.group[j] === g) return j - 1;
  }
  return tokens.length - 1;
}

/** Tokens que, antes de `{`, indicam um tipo literal (e não o corpo da função). */
const TYPE_POSITION = new Set([':', '|', '&', '<', ',', '=>', '(', '[', '?']);

/**
 * Pula a anotação de tipo de retorno que começa em `k` (logo depois do `:`) e devolve o índice do corpo: o `{` do
 * corpo ou o `=>` de uma arrow function. -1 se não parece uma assinatura de função (ex.: ternário).
 */
function skipReturnType(tokens: readonly Token[], st: Structure, k: number): number {
  let angle = 0;
  for (let j = k; j < tokens.length; j++) {
    const t = tokens[j] as Token;
    const prev = tokens[j - 1];
    if (isPunct(t, '<')) angle++;
    else if (isPunct(t, '>')) angle = Math.max(0, angle - 1);
    else if (isPunct(t, '{')) {
      const typeLiteral = angle > 0 || j === k || (prev?.kind === 'punct' && TYPE_POSITION.has(prev.value));
      if (!typeLiteral) return j;
      j = st.close[j] as number;
    } else if (isPunct(t, '(') || isPunct(t, '[')) j = st.close[j] as number;
    else if (isPunct(t, '=>') && angle === 0 && j > k && !isPunct(prev, ')')) return j;
    else if (angle === 0 && (isPunct(t, ';') || isPunct(t, ',') || isPunct(t, '=') || isCloser(t))) return -1;
  }
  return -1;
}

/**
 * Nomes de ligação num trecho (lista de parâmetros ou padrão de desestruturação): pula chaves de objeto (`{ a: b }`
 * declara `b`), anotações de tipo dos parâmetros (`x: T`), valores padrão (`= y`) e membros (`o.x`).
 */
function addBindings(
  tokens: readonly Token[],
  st: Structure,
  from: number,
  to: number,
  rangeFrom: number,
  rangeTo: number,
  scopes: Scopes,
): void {
  for (let k = from; k <= to; k++) {
    const t = tokens[k] as Token;
    if (t.kind !== 'ident' || METHOD_MODIFIERS.has(t.value) || t.value === 'this') continue;
    const prev = tokens[k - 1];
    const next = tokens[k + 1];
    if (isMemberDot(prev) || isPunct(prev, '=')) continue;
    const owner = tokens[st.group[k] as number];
    if (isPunct(owner, '{') && isPunct(next, ':')) continue; // chave de objeto
    if (isPunct(owner, '(') && isPunct(prev, ':')) continue; // tipo do parâmetro
    scopes.add(t.value, rangeFrom, rangeTo);
  }
}

/** Intervalo do bloco `{…}` mais interno que contém `i` (ou o arquivo inteiro). */
function blockRange(st: Structure, i: number, n: number): [number, number] {
  const b = st.block[i] as number;
  return b < 0 ? [0, n - 1] : [b, st.close[b] as number];
}

/**
 * Nomes declarados no arquivo, com escopo aproximado: `const`/`let`/`var`/`function`/`class` valem no bloco onde
 * aparecem, parâmetros e `catch (e)` só na sua função/bloco, imports e tipos no arquivo inteiro.
 */
export function collectScopes(tokens: readonly Token[], st: Structure): Scopes {
  const scopes = new Scopes();
  const n = tokens.length;
  const whole: [number, number] = [0, n - 1];
  for (let i = 0; i < n; i++) {
    const t = tokens[i] as Token;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    if (t.kind === 'ident' && !isMemberDot(prev)) {
      if (t.value === 'const' || t.value === 'let' || t.value === 'var') {
        const [from, to] = blockRange(st, i, n);
        if (next?.kind === 'ident') scopes.add(next.value, from, to);
        else if (isPunct(next, '{') || isPunct(next, '[')) {
          addBindings(tokens, st, i + 2, (st.close[i + 1] as number) - 1, from, to, scopes);
        }
        // Mais declaradores no mesmo comando: `let a = 0, b = 0;`
        for (let k = i + 2; k < n; k++) {
          const u = tokens[k] as Token;
          if (isOpener(u)) {
            k = st.close[k] as number;
            continue;
          }
          if (isPunct(u, ';') || isCloser(u)) break;
          if (isPunct(u, ',') && tokens[k + 1]?.kind === 'ident') scopes.add((tokens[k + 1] as Token).value, from, to);
        }
      } else if (t.value === 'function' || t.value === 'class') {
        const name = isPunct(next, '*') ? tokens[i + 2] : next;
        const [from, to] = blockRange(st, i, n);
        if (name?.kind === 'ident') scopes.add(name.value, from, to);
      } else if (DECLARATION_KEYWORDS.has(t.value)) {
        if (next?.kind === 'ident') scopes.add(next.value, ...whole);
      } else if (t.value === 'import' && !isPunct(next, '(') && !isMemberDot(next)) {
        // import X, { a as b } from '…'
        for (let k = i + 1; k < n; k++) {
          const u = tokens[k] as Token;
          if (u.kind === 'string' || isPunct(u, ';')) break;
          if (u.kind === 'ident' && u.value !== 'type' && u.value !== 'as' && u.value !== 'from') {
            scopes.add(u.value, ...whole);
          }
        }
      } else if (t.value === 'catch' && isPunct(next, '(')) {
        const c = st.close[i + 1] as number;
        const body = isPunct(tokens[c + 1], '{') ? (st.close[c + 1] as number) : c;
        addBindings(tokens, st, i + 2, c - 1, i + 1, body, scopes);
      }
    } else if (isPunct(t, '=>')) {
      // `x => …` (o caso `(a, b) =>` sai pelo ramo do `(`).
      if (prev?.kind === 'ident' && !isMemberDot(tokens[i - 2])) scopes.add(prev.value, i - 1, arrowEnd(tokens, st, i));
    } else if (isPunct(t, '(')) {
      const c = st.close[i] as number;
      const after = tokens[c + 1];
      const before = tokens[i - 1];
      const named =
        (before?.kind === 'ident' && !NOT_A_FUNCTION_NAME.has(before.value)) ||
        isIdent(before, 'function') ||
        isPunct(before, '>');
      let end = -1;
      if (isPunct(after, '=>')) end = arrowEnd(tokens, st, c + 1);
      else if (isPunct(after, '{') && named) end = st.close[c + 1] as number;
      else if (isPunct(after, ':')) {
        const body = skipReturnType(tokens, st, c + 2);
        if (body >= 0 && isPunct(tokens[body], '=>')) end = arrowEnd(tokens, st, body);
        else if (body >= 0 && named) end = st.close[body] as number;
      }
      if (end >= 0) addBindings(tokens, st, i + 1, c - 1, i, end, scopes);
    }
  }
  return scopes;
}

/** Corpos de classe (índice do `{`): o que começa um "comando" ali dentro é nome de membro, não referência. */
function classBodies(tokens: readonly Token[], st: Structure): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    if (!isIdent(tokens[i], 'class') || isMemberDot(tokens[i - 1])) continue;
    for (let k = i + 1; k < tokens.length; k++) {
      if (st.group[k] !== st.group[i]) continue;
      if (isPunct(tokens[k], '{')) {
        out.add(k);
        break;
      }
      if (isPunct(tokens[k], ';')) break;
    }
  }
  return out;
}

interface FileAnalysis {
  readonly tokens: readonly Token[];
  readonly st: Structure;
  readonly scopes: Scopes;
  readonly classBodies: ReadonlySet<number>;
  /** Nomes locais que são alias de uma raiz global (`const g = globalThis`). */
  readonly aliases: ReadonlySet<string>;
}

/**
 * O token em `i` é uma referência livre ao nome (e não `obj.nome`, chave de objeto, membro de tipo ou de classe,
 * declaração ou nome de método)? Não olha o escopo: isso é com `Scopes`.
 */
export function isFreeReference(a: FileAnalysis, i: number): boolean {
  const { tokens, st } = a;
  const prev = tokens[i - 1];
  const next = tokens[i + 1];
  if (isMemberDot(prev)) return false;
  if (prev?.kind === 'ident' && (DECLARATION_KEYWORDS.has(prev.value) || prev.value === 'import')) return false;
  const afterSeparator =
    prev === undefined ||
    (prev.kind === 'punct' && (prev.value === '{' || prev.value === ',' || prev.value === ';' || prev.value === '('));
  const afterModifier = prev?.kind === 'ident' && METHOD_MODIFIERS.has(prev.value);
  const keyLike = isPunct(next, ':') || (isPunct(next, '?') && isPunct(tokens[i + 2], ':'));
  if (keyLike && (afterSeparator || afterModifier)) return false;
  // Campo ou método direto no corpo de uma classe: `location = 1`, `readonly screen: X`, `fetch() {}`.
  const owner = st.group[i] as number;
  if (owner >= 0 && a.classBodies.has(owner)) {
    if (prev === undefined || isPunct(prev, '{') || isPunct(prev, '}') || isPunct(prev, ';') || afterModifier) {
      return false;
    }
  }
  // Método `nome(…) {` ou `nome(…): T {` num corpo de classe ou objeto.
  if (isPunct(next, '(')) {
    const methodPosition =
      prev === undefined ||
      (prev.kind === 'punct' &&
        (prev.value === '{' || prev.value === ',' || prev.value === ';' || prev.value === '}')) ||
      afterModifier;
    if (methodPosition) {
      const after = tokens[(st.close[i + 1] as number) + 1];
      if (isPunct(after, '{') || isPunct(after, ':')) return false;
    }
  }
  return true;
}

/** O token em `i` é a raiz global (ou um alias dela) usada como referência livre? */
function isRootRef(a: FileAnalysis, i: number): boolean {
  const t = a.tokens[i];
  if (t?.kind !== 'ident' || !isFreeReference(a, i)) return false;
  if (a.aliases.has(t.value)) return true;
  return GLOBAL_ROOTS.has(t.value) && !a.scopes.has(t.value, i);
}

/**
 * Raiz do acesso `X.nome` (com o nome em `i`) quando X é uma raiz global: `globalThis.x`, `window?.x`, um alias
 * (`g.x`) ou a raiz entre parênteses com cast (`(globalThis as any).x`). `null` se não for.
 */
function globalRootOf(a: FileAnalysis, i: number): string | null {
  const { tokens } = a;
  if (!isMemberDot(tokens[i - 1])) return null;
  const r = tokens[i - 2];
  if (r?.kind === 'ident') return isRootRef(a, i - 2) ? r.value : null;
  if (isPunct(r, ')')) {
    const open = a.st.group[i - 2] as number;
    const inner = tokens[open + 1];
    const after = tokens[open + 2];
    const cast = isPunct(after, ')') || isIdent(after, 'as') || isIdent(after, 'satisfies') || isPunct(after, '!');
    if (inner?.kind === 'ident' && cast && isRootRef(a, open + 1)) return inner.value;
  }
  return null;
}

/** A raiz global em `i` está sendo usada só para acessar um membro (`globalThis.x`, `(globalThis as T).x`)? */
function isRootMemberAccess(a: FileAnalysis, i: number): boolean {
  const { tokens, st } = a;
  if (isMemberDot(tokens[i + 1])) return true;
  const open = st.group[i] as number;
  const after = tokens[i + 1];
  const cast = isPunct(after, ')') || isIdent(after, 'as') || isIdent(after, 'satisfies') || isPunct(after, '!');
  return cast && open === i - 1 && isPunct(tokens[open], '(') && isMemberDot(tokens[(st.close[open] as number) + 1]);
}

/** Aliases de raiz global: `const g = globalThis;`, `let w = window as X;`. */
function findAliases(tokens: readonly Token[], scopes: Scopes): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 3 < tokens.length; i++) {
    const kw = tokens[i] as Token;
    if (kw.kind !== 'ident' || (kw.value !== 'const' && kw.value !== 'let' && kw.value !== 'var')) continue;
    const name = tokens[i + 1];
    const eq = tokens[i + 2];
    const root = tokens[i + 3];
    if (name?.kind !== 'ident' || !isPunct(eq, '=') || root?.kind !== 'ident') continue;
    if (!GLOBAL_ROOTS.has(root.value) || scopes.has(root.value, i + 3)) continue;
    const after = tokens[i + 4];
    if (after === undefined || isPunct(after, ';') || isPunct(after, ',') || isIdent(after, 'as')) out.add(name.value);
  }
  return out;
}

interface ImportRef {
  readonly spec: string;
  readonly typeOnly: boolean;
  readonly dynamic: boolean;
  /** `import()` com especificador que não é string literal (variável, template com `${}`). */
  readonly computed: boolean;
  readonly token: Token;
}

/** Imports e re-exports estáticos (`import … from`, `export … from`, `import '…'`) e `import('…')`. */
export function findImports(tokens: readonly Token[]): ImportRef[] {
  const out: ImportRef[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as Token;
    if (t.kind !== 'ident' || (t.value !== 'import' && t.value !== 'export')) continue;
    if (isMemberDot(tokens[i - 1])) continue;
    const next = tokens[i + 1];
    if (t.value === 'import' && isPunct(next, '(')) {
      const arg = tokens[i + 2];
      const end = tokens[i + 3];
      // Template sem `${}` é um token só: conta como literal (e passa pelas regras de import como qualquer outro).
      const literal = (arg?.kind === 'string' || arg?.kind === 'template') && (isPunct(end, ')') || isPunct(end, ','));
      out.push({ spec: literal ? arg.value : '', typeOnly: false, dynamic: true, computed: !literal, token: t });
      continue;
    }
    if (t.value === 'import' && isMemberDot(next)) continue; // import.meta
    if (t.value === 'import' && next?.kind === 'string') {
      out.push({ spec: next.value, typeOnly: false, dynamic: false, computed: false, token: t });
      continue;
    }
    // `import type X from`, `export type { … } from` (mas `import type, { … }` é um default chamado `type`).
    const typeOnly = isIdent(next, 'type') && !isPunct(tokens[i + 2], ',') && !isIdent(tokens[i + 2], 'from');
    for (let k = i + 1; k < tokens.length; k++) {
      const u = tokens[k] as Token;
      if (isPunct(u, ';')) break;
      if (u.kind === 'string') {
        if (isIdent(tokens[k - 1], 'from')) {
          out.push({ spec: u.value, typeOnly, dynamic: false, computed: false, token: t });
        }
        break;
      }
      // `export const x = …` e afins não são re-export: acabam antes de qualquer `from '…'`.
      if (t.value === 'export' && k === i + 1 && u.kind === 'ident' && u.value !== 'type' && u.value !== 'from') {
        if (u.value !== '*') break;
      }
    }
  }
  return out;
}

/** Nome do pacote npm de um especificador nu: `three/addons/x` → `three`, `@a/b/c` → `@a/b`. */
export function packageNameOf(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? spec);
}

function workspaceOf(rel: string, ctx: CheckContext): WorkspaceInfo | undefined {
  return ctx.workspaces.find((w) => rel === w.dir || rel.startsWith(`${w.dir}/`));
}

const SUPPRESS = /guard-allow:\s*([a-z-]+)\s+\S/;

/** Aplica todas as regras a um arquivo. `rel` é relativo à raiz, com `/`. */
export function checkFile(rel: string, source: string, ctx: CheckContext): FileReport {
  const parts = rel.split('/');
  const group = parts[0];
  const name = parts[1];
  if ((group !== 'packages' && group !== 'apps') || name === undefined) return { violations: [], suppressed: 0 };
  const file: FileInfo = { rel, group, name };
  const lexed = tokenize(source);
  const tokens = normalizeBracketAccess(lexed.tokens);
  const st = analyzeStructure(tokens);
  const scopes = collectScopes(tokens, st);
  const a: FileAnalysis = {
    tokens,
    st,
    scopes,
    classBodies: classBodies(tokens, st),
    aliases: findAliases(tokens, scopes),
  };
  const found: Violation[] = [];
  const report = (rule: RuleId, t: Token, what: string): void => {
    found.push({ file: rel, line: t.line, col: t.col, rule, message: `${what}: ${RULE_HELP[rule]}` });
  };

  const identRules = IDENTIFIER_RULES.filter((r) => r.applies(file));
  const freeRules: readonly IdentifierRule[] = identRules.filter((r) => r.match === 'free');
  const newRules = NEW_RULES.filter((r) => r.applies(file));
  const shared = isShared(file);
  const deterministic = isDeterministic(file);

  /** Referência ao global `tokens[i]` (livre e não declarada, ou membro de uma raiz global). */
  const isGlobal = (i: number): boolean => {
    const t = tokens[i] as Token;
    return globalRootOf(a, i) !== null || (!scopes.has(t.value, i) && isFreeReference(a, i));
  };
  /** Nome de global obtido por um caminho indireto (desestruturação ou `Reflect.get` da raiz). */
  const checkGlobalName = (prop: string, t: Token, how: string): void => {
    for (const rule of freeRules) if (rule.names.has(prop)) report(rule.id, t, how);
    if (prop === 'Function' || prop === 'eval') report('eval', t, how);
    if (deterministic && (CLOCK_GLOBALS.has(prop) || prop === 'Math')) report('clock', t, how);
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as Token;
    if (t.kind !== 'ident') continue;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    for (const rule of identRules) {
      if (!rule.names.has(t.value)) continue;
      if (rule.match === 'any') report(rule.id, t, `\`${t.value}\``);
      else if (rule.match === 'member') {
        if (isMemberDot(prev)) report(rule.id, t, `\`.${t.value}\``);
      } else {
        const root = globalRootOf(a, i);
        if (root !== null) report(rule.id, t, `\`${root}.${t.value}\``);
        else if (!scopes.has(t.value, i) && isFreeReference(a, i)) report(rule.id, t, `\`${t.value}\``);
      }
    }

    // Regra 10 por lista branca (ver CLOCK_GLOBALS e MATH_PURE_MEMBERS).
    if (deterministic && (CLOCK_GLOBALS.has(t.value) || t.value === 'Math') && isGlobal(i)) {
      if (t.value !== 'Math') report('clock', t, `\`${t.value}\``);
      else if (!isMemberDot(next) || !MATH_PURE_MEMBERS.has(tokens[i + 2]?.value ?? '')) {
        const member = isMemberDot(next) && tokens[i + 2]?.kind === 'ident' ? `.${tokens[i + 2]?.value}` : '';
        report('clock', t, `\`Math${member}\` (só as funções puras, por acesso direto)`);
      }
    }

    if (t.value === 'new') {
      const target = tokens[i + 1];
      const rootDot = target?.kind === 'ident' && isRootRef(a, i + 1) && isMemberDot(tokens[i + 2]);
      const named = rootDot ? tokens[i + 3] : target;
      if (named?.kind === 'ident' && (rootDot || !scopes.has(named.value, i + 1))) {
        for (const rule of newRules) if (rule.names.has(named.value)) report(rule.id, named, `\`new ${named.value}\``);
      }
    }

    // Código a partir de texto: `Function(…)`/`new Function(…)` (direto ou pela raiz), `x.constructor(…)` (o
    // construtor de uma função É o Function) e `setTimeout('…')`.
    if (t.value === 'Function' && isPunct(next, '(') && isGlobal(i)) report('eval', t, '`Function(…)`');
    if (t.value === 'constructor' && isMemberDot(prev) && isPunct(next, '(')) report('eval', t, '`.constructor(…)`');
    if ((t.value === 'setTimeout' || t.value === 'setInterval') && isPunct(next, '(') && isGlobal(i)) {
      const arg = tokens[i + 2];
      if (arg?.kind === 'string' || arg?.kind === 'template') report('eval', t, `\`${t.value}\` com texto`);
    }

    if (isRootRef(a, i)) {
      // Desestruturação da raiz: `const { localStorage: ls } = globalThis` vale como `globalThis.localStorage`.
      if (isPunct(prev, '=') && isPunct(tokens[i - 2], '}')) {
        const open = st.group[i - 2] as number;
        for (let k = open + 1; k < i - 2; k++) {
          const key = tokens[k] as Token;
          if (key.kind !== 'ident' || st.group[k] !== open) continue;
          const kp = tokens[k - 1];
          const kn = tokens[k + 1];
          const keyPos = isPunct(kp, '{') || isPunct(kp, ',') || isPunct(kp, '...');
          if (keyPos && (isPunct(kn, ':') || isPunct(kn, ',') || isPunct(kn, '}') || isPunct(kn, '='))) {
            checkGlobalName(key.value, key, `\`${key.value}\` desestruturado de \`${t.value}\``);
          }
        }
      }
      // Fora das cascas, a raiz global só pode aparecer para acessar um membro.
      if (shared && !isRootMemberAccess(a, i)) report('global-root', t, `\`${t.value}\` como valor`);
    }

    // `Reflect.get(globalThis, 'fetch')` vale como `globalThis.fetch`.
    if (t.value === 'Reflect' && isMemberDot(next) && isIdent(tokens[i + 2], 'get') && isPunct(tokens[i + 3], '(')) {
      const prop = tokens[i + 6];
      if (
        isRootRef(a, i + 4) &&
        isPunct(tokens[i + 5], ',') &&
        (prop?.kind === 'string' || prop?.kind === 'template')
      ) {
        checkGlobalName(prop.value, t, `\`Reflect.get(${tokens[i + 4]?.value}, '${prop.value}')\``);
      }
    }

    if (shared && t.value === 'import' && isMemberDot(next) && isIdent(tokens[i + 2], 'meta')) {
      report('import-meta', t, '`import.meta`');
    }
  }

  // Imports.
  const ws = workspaceOf(rel, ctx);
  for (const imp of findImports(tokens)) {
    const { spec, token } = imp;
    if (imp.computed) {
      report('dynamic-import', token, '`import(<expressão>)`');
      continue;
    }
    if (imp.dynamic && !allowsDynamicImport(file)) {
      report('dynamic-import', token, `\`import('${spec}')\``);
      continue;
    }
    if (spec.startsWith('.') || spec.startsWith('/')) {
      const target = posix.normalize(posix.join(posix.dirname(rel), spec));
      const targetWs = workspaceOf(target, ctx);
      if (targetWs && ws && targetWs.dir !== ws.dir) report('import-cross-workspace', token, `'${spec}'`);
      continue;
    }
    if (spec.startsWith('node:')) {
      report('import-node', token, `'${spec}'`);
      continue;
    }
    const pkg = packageNameOf(spec);
    if (pkg === 'three') {
      if (!isPackage(file, 'render')) report('import-three', token, `'${spec}'`);
      else if (isForbiddenThreeSubpath(spec)) report('import-three-addon', token, `'${spec}'`);
    }
    if (pkg === 'trystero' || pkg.startsWith('@trystero')) {
      if (!isPackage(file, 'net')) report('import-trystero', token, `'${spec}'`);
    }
    if (pkg === '@boboforces/net' && !isApp(file, 'web')) report('import-net', token, `'${spec}'`);
    // O game só enxerga o render pelo subcaminho sem three e sem DOM, até para tipos (compila sem a lib DOM).
    if (pkg === '@boboforces/render' && isPackage(file, 'game') && !RENDER_DATA_SPECS.has(spec)) {
      report('import-render', token, `'${spec}'${imp.typeOnly ? ' (import type)' : ''}`);
    }
    if (ws && pkg !== ws.packageName && !ws.deps.has(pkg)) report('import-undeclared', token, `'${spec}'`);
  }

  // Supressões explícitas: `// guard-allow: <regra> <motivo>` no fim da linha ou sozinho na linha de cima.
  const codeLines = new Set(lexed.tokens.map((t) => t.line));
  const allowed = new Map<number, Set<string>>();
  for (const c of lexed.comments) {
    const m = SUPPRESS.exec(c.text);
    if (!m) continue;
    for (const line of codeLines.has(c.line) ? [c.line] : [c.line, c.line + 1]) {
      const rules = allowed.get(line) ?? new Set<string>();
      rules.add(m[1] as string);
      allowed.set(line, rules);
    }
  }
  const violations = found.filter((v) => !allowed.get(v.line)?.has(v.rule));
  return { violations, suppressed: found.length - violations.length };
}
