import { transformSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { mapStack } from './portcheck.ts';
import { decodeVlq, parseSourceMap } from './sourcemap.ts';

describe('source map', () => {
  it('decodifica VLQ (valores da especificação)', () => {
    expect(decodeVlq('AAAA')).toEqual([0, 0, 0, 0]);
    expect(decodeVlq('AACA')).toEqual([0, 0, 1, 0]);
    expect(decodeVlq('D')).toEqual([-1]);
    expect(decodeVlq('gB')).toEqual([16]);
    expect(decodeVlq('2Hwcwc')).toEqual([123, 456, 456]);
    expect(decodeVlq('wmB')).toEqual([616]);
  });

  it('mapeia uma posição do JS gerado de volta para o .ts', () => {
    const src = 'type A = number;\nconst a: A = 1;\n\nexport function f(): void {\n  globalThis.alvo();\n}\n';
    const out = transformSync(src, { loader: 'ts', sourcemap: 'external', sourcefile: 'packages/x/src/y.ts' });
    const lines = out.code.split('\n');
    const line = lines.findIndex((l) => l.includes('alvo')) + 1;
    const col = (lines[line - 1]?.indexOf('globalThis') ?? 0) + 1;
    const pos = parseSourceMap(out.map).lookup(line, col);
    expect(pos).toEqual({ source: 'packages/x/src/y.ts', line: 5, col: 3 });
    const stack = mapStack(
      `Error: x\n    at f (romfs:/main.js:${line}:${col})`,
      'romfs:/main.js',
      parseSourceMap(out.map),
      (s) => s,
    );
    expect(stack).toContain('(packages/x/src/y.ts:5:3)');
  });
});
