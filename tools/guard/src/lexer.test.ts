import { describe, expect, it } from 'vitest';
import { tokenize } from './lexer.ts';

const idents = (src: string): string[] =>
  tokenize(src)
    .tokens.filter((t) => t.kind === 'ident')
    .map((t) => t.value);

describe('tokenize', () => {
  it('tira comentários e strings do código, guardando o texto à parte', () => {
    const { tokens, comments } = tokenize('// fetch()\nconst a = \'document\'; /* window */ b("localStorage");');
    expect(tokens.filter((t) => t.kind === 'ident').map((t) => t.value)).toEqual(['const', 'a', 'b']);
    expect(tokens.filter((t) => t.kind === 'string').map((t) => t.value)).toEqual(['document', 'localStorage']);
    expect(comments.map((c) => c.text.trim())).toEqual(['fetch()', 'window']);
  });

  it('conta linhas e colunas, inclusive depois de comentários e templates de várias linhas', () => {
    const src = '/*\n\n*/ x\n`a\nb` y\n  z';
    const pos = tokenize(src)
      .tokens.filter((t) => t.kind === 'ident')
      .map((t) => [t.value, t.line, t.col]);
    expect(pos).toEqual([
      ['x', 3, 4],
      ['y', 5, 4],
      ['z', 6, 3],
    ]);
  });

  it('templates: o texto fica de fora, mas o código dentro de ${} é varrido (com chaves aninhadas)', () => {
    expect(idents('`navigator ${ fetch({ a: `x ${document}` }) } window`')).toEqual(['fetch', 'a', 'document']);
  });

  it('distingue regex de divisão', () => {
    expect(idents('const r = /window[/]x/g.test(s); const d = a / b / c;')).toEqual([
      'const',
      'r',
      'test',
      's',
      'const',
      'd',
      'a',
      'b',
      'c',
    ]);
    expect(idents('return /fetch/.source')).toEqual(['return', 'source']);
    expect(idents('x = (a) / 2; y = [1] / 2')).toEqual(['x', 'a', 'y']);
  });

  it('pontuação que importa: ?. , ... e =>', () => {
    const punct = tokenize('a?.b; c ? .5 : d; f(...g); h => 1')
      .tokens.filter((t) => t.kind === 'punct')
      .map((t) => t.value);
    expect(punct).toContain('?.');
    expect(punct).toContain('...');
    expect(punct).toContain('=>');
    expect(tokenize('c ? .5 : d').tokens.map((t) => t.value)).toEqual(['c', '?', '.5', ':', 'd']);
  });

  it('números, nomes privados e escapes não viram identificadores', () => {
    expect(idents('0x1fn + 1_000.5e-3 + .5; this.#window = "a\\"b";')).toEqual(['this']);
    expect(tokenize('"a\\"b"').tokens[0]?.value).toBe('a"b');
  });

  it('string sem fechar não engole o resto do arquivo', () => {
    expect(idents("const a = 'oops\nwindow")).toEqual(['const', 'a', 'window']);
  });
});
