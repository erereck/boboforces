import { describe, expect, it } from 'vitest';
import { readWorkshopFiles } from './files.ts';
import { createFakeSwitch } from './testing.ts';

const DIR = 'sdmc:/switch/boboforces';

describe('pasta oficina/ (M4, fase 2c)', () => {
  it('lê os .json em ordem de nome; arquivo grande fica de fora com uma linha; sem a pasta, nada', () => {
    const fake = createFakeSwitch({
      files: {
        [`${DIR}/oficina/b.json`]: '{"format":"boboforces/bot@1"}',
        [`${DIR}/oficina/a.json`]: '{"format":"boboforces/preset@1"}',
        [`${DIR}/oficina/leia-me.txt`]: 'texto',
        [`${DIR}/oficina/grande.json`]: ' '.repeat(64 * 1024 + 1),
      },
    });
    const lines: string[] = [];
    const files = readWorkshopFiles(fake.nx.Switch, DIR, (l) => lines.push(l));
    expect(files.map((f) => f.name)).toEqual(['a.json', 'b.json']);
    expect(files[0]!.text).toBe('{"format":"boboforces/preset@1"}');
    expect(lines).toEqual(['oficina: grande.json ignorado (maior que 64 KB)']);
    expect(readWorkshopFiles(createFakeSwitch().nx.Switch, DIR, () => {})).toEqual([]);
  });
});
