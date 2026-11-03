/**
 * Tokenizador mínimo de JS/TS para as guardas (sem dependências, sem AST). Separa comentários, strings, templates e
 * regex do código, para que as regras olhem só para identificadores e pontuação de verdade. Não valida sintaxe: o
 * objetivo é nunca confundir texto com código. Também serve ao portcheck, que varre o bundle do Switch.
 */

export type TokenKind = 'ident' | 'punct' | 'string' | 'template' | 'number' | 'regex' | 'private';

export interface Token {
  readonly kind: TokenKind;
  /** Identificador/pontuação como no fonte; para `string`, o valor já sem aspas (escapes simples resolvidos). */
  readonly value: string;
  /** 1-based. */
  readonly line: number;
  readonly col: number;
}

export interface Comment {
  readonly text: string;
  readonly line: number;
}

export interface LexResult {
  readonly tokens: Token[];
  readonly comments: Comment[];
}

// Depois destas palavras, `/` abre uma regex (e não é divisão).
const REGEX_AFTER_KEYWORD = new Set([
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
]);

const ID_START = /[\p{ID_Start}$_]/u;
const ID_CONTINUE = /[\p{ID_Continue}$‌‍]/u;
const NUMBER =
  /0[xX][\da-fA-F_]+n?|0[oO][0-7_]+n?|0[bB][01_]+n?|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?n?/y;

const SIMPLE_ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0' };

export function tokenize(source: string): LexResult {
  const tokens: Token[] = [];
  const comments: Comment[] = [];
  const n = source.length;
  let i = 0;
  let line = 1;
  let lineStart = 0;
  // Pilha de chaves: 'b' = bloco/objeto comum, 't' = expressão `${…}` de um template (o `}` volta para o template).
  const braces: ('b' | 't')[] = [];

  const push = (kind: TokenKind, value: string, startLine: number, startCol: number): void => {
    tokens.push({ kind, value, line: startLine, col: startCol });
  };

  const newline = (at: number): void => {
    line++;
    lineStart = at + 1;
  };

  const regexAllowed = (): boolean => {
    const prev = tokens[tokens.length - 1];
    if (!prev) return true;
    if (prev.kind === 'ident') return REGEX_AFTER_KEYWORD.has(prev.value);
    if (prev.kind === 'punct') return prev.value !== ')' && prev.value !== ']' && prev.value !== '}';
    return false;
  };

  /** Lê o corpo de um template a partir de `i` (logo depois do "`" ou do "}"); para no "`" final ou no "${". */
  const readTemplatePart = (startLine: number, startCol: number): void => {
    let text = '';
    while (i < n) {
      const c = source[i] as string;
      if (c === '\\') {
        text += source.slice(i, i + 2);
        if (source[i + 1] === '\n') newline(i + 1);
        i += 2;
        continue;
      }
      if (c === '`') {
        i++;
        push('template', text, startLine, startCol);
        return;
      }
      if (c === '$' && source[i + 1] === '{') {
        i += 2;
        push('template', text, startLine, startCol);
        braces.push('t');
        return;
      }
      if (c === '\n') newline(i);
      text += c;
      i++;
    }
    push('template', text, startLine, startCol);
  };

  while (i < n) {
    const c = source[i] as string;
    const col = i - lineStart + 1;

    if (c === '\n') {
      newline(i);
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === '﻿' || c === ' ') {
      i++;
      continue;
    }

    // Comentários (e o hashbang da primeira linha).
    if ((c === '/' && source[i + 1] === '/') || (i === 0 && c === '#' && source[1] === '!')) {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      comments.push({ text: source.slice(i + 2, stop), line });
      i = stop;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const startLine = line;
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end;
      for (let k = i; k < stop; k++) if (source[k] === '\n') newline(k);
      comments.push({ text: source.slice(i + 2, stop), line: startLine });
      i = end === -1 ? n : end + 2;
      continue;
    }

    // Strings.
    if (c === '"' || c === "'") {
      const startLine = line;
      let value = '';
      i++;
      while (i < n) {
        const d = source[i] as string;
        if (d === c) {
          i++;
          break;
        }
        if (d === '\n') break; // string sem fechar: não deixa o resto do arquivo virar texto
        if (d === '\\') {
          const e = source[i + 1] ?? '';
          if (e === '\n') newline(i + 1);
          else value += SIMPLE_ESCAPES[e] ?? e;
          i += 2;
          continue;
        }
        value += d;
        i++;
      }
      push('string', value, startLine, col);
      continue;
    }

    // Templates.
    if (c === '`') {
      i++;
      readTemplatePart(line, col);
      continue;
    }

    // Identificadores e palavras-chave.
    if (ID_START.test(c)) {
      let j = i + 1;
      while (j < n && ID_CONTINUE.test(source[j] as string)) j++;
      push('ident', source.slice(i, j), line, col);
      i = j;
      continue;
    }

    // Nomes privados de classe (#campo).
    if (c === '#' && i + 1 < n && ID_START.test(source[i + 1] as string)) {
      let j = i + 2;
      while (j < n && ID_CONTINUE.test(source[j] as string)) j++;
      push('private', source.slice(i, j), line, col);
      i = j;
      continue;
    }

    // Números (inclusive `.5`).
    if ((c >= '0' && c <= '9') || (c === '.' && /\d/.test(source[i + 1] ?? ''))) {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(source);
      const len = m ? m[0].length : 1;
      push('number', source.slice(i, i + len), line, col);
      i += len;
      continue;
    }

    // Regex literal.
    if (c === '/' && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      while (j < n) {
        const d = source[j] as string;
        if (d === '\n') break;
        if (d === '\\') {
          j += 2;
          continue;
        }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
        j++;
      }
      j++;
      while (j < n && ID_CONTINUE.test(source[j] as string)) j++;
      push('regex', source.slice(i, j), line, col);
      i = j;
      continue;
    }

    // Pontuação. Só alguns operadores de vários caracteres importam para as regras.
    if (c === '?' && source[i + 1] === '.' && !/\d/.test(source[i + 2] ?? '')) {
      push('punct', '?.', line, col);
      i += 2;
      continue;
    }
    if (c === '.' && source[i + 1] === '.' && source[i + 2] === '.') {
      push('punct', '...', line, col);
      i += 3;
      continue;
    }
    if (c === '=' && source[i + 1] === '>') {
      push('punct', '=>', line, col);
      i += 2;
      continue;
    }
    if (c === '{') braces.push('b');
    if (c === '}') {
      const kind = braces.pop();
      if (kind === 't') {
        i++;
        readTemplatePart(line, col);
        continue;
      }
    }
    push('punct', c, line, col);
    i++;
  }

  return { tokens, comments };
}
