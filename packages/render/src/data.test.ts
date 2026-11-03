import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = dirname(fileURLToPath(import.meta.url));

/** Imports (valor ou tipo) de um arquivo do render, por texto: basta para o fecho pequeno do `data.ts`. */
function importsOf(file: string): string[] {
  const text = readFileSync(join(SRC, file), 'utf8');
  return [...text.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+'([^']+)'/gms)].map((m) => m[1] as string);
}

describe('@boboforces/render/data', () => {
  it('nada no fecho do data.ts importa three (o game importa daqui como valor)', () => {
    const seen = new Set<string>();
    const queue = ['data.ts'];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of importsOf(file)) {
        expect(spec === 'three' || spec.startsWith('three/'), `${file} importa ${spec}`).toBe(false);
        if (spec.startsWith('./')) queue.push(spec.slice(2));
      }
    }
    expect(seen.size).toBeGreaterThan(4);
  });
});
