import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A suíte só é verde de verdade se cada projeto do Vitest roda os SEUS testes. Um glob que deixa de casar (teste
 * renomeado para `.spec.ts`, pasta movida, `include` trocado) faria os testes de um pacote sumirem sem reprovar nada,
 * então aqui cada workspace precisa: do `vitest.config.ts` com o include da convenção e de pelo menos 1 teste nele.
 */
const ROOT = resolve(import.meta.dirname, '..', '..', '..');
// O include começa pela convenção (as cascas também incluem os testes de `scripts/`).
const INCLUDE = "include: ['src/**/*.test.ts'";

function testFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) testFiles(full, out);
    else if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) out.push(entry.name);
  }
  return out;
}

const workspaces = ['packages', 'apps', 'tools'].flatMap((group) =>
  readdirSync(join(ROOT, group), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(ROOT, group, e.name, 'package.json')))
    .map((e) => `${group}/${e.name}`),
);

describe('projetos do Vitest', () => {
  it('acha os workspaces', () => {
    expect(workspaces).toContain('packages/sim');
    expect(workspaces.length).toBeGreaterThan(15);
  });

  it.each(workspaces)('%s: nome, scripts e tsconfig da convenção (o typecheck e o Vitest acham o workspace)', (ws) => {
    const dir = ws.split('/')[1]!;
    const pkg = JSON.parse(readFileSync(join(ROOT, ws, 'package.json'), 'utf8')) as {
      name?: string;
      version?: string;
      type?: string;
      scripts?: Record<string, string>;
    };
    expect(pkg.name).toBe(`@boboforces/${dir}`);
    expect(pkg.version).toBe('0.0.0');
    expect(pkg.type).toBe('module');
    expect(pkg.scripts?.['test']).toBe('vitest run');
    expect(pkg.scripts?.['typecheck']).toBe(`node ../../scripts/typecheck.ts ${ws}`);
    // `scripts/typecheck.ts` checa todo `tsconfig*.json` da pasta: o principal precisa existir e cobrir `src`.
    const tsconfig = readFileSync(join(ROOT, ws, 'tsconfig.json'), 'utf8');
    expect(tsconfig).toMatch(/"include":\s*\[[^\]]*"src"/);
    const config = readFileSync(join(ROOT, ws, 'vitest.config.ts'), 'utf8');
    expect(config).toContain(`name: '${dir}'`);
    expect(config).toContain("environment: 'node'");
  });

  it.each(workspaces)('%s: include da convenção, pelo menos 1 *.test.ts em src/ e nenhum .spec', (ws) => {
    const config = readFileSync(join(ROOT, ws, 'vitest.config.ts'), 'utf8');
    expect(config).toContain(INCLUDE);
    const files = testFiles(join(ROOT, ws, 'src'));
    const all = [...files, ...testFiles(join(ROOT, ws, 'scripts'))];
    expect(all.filter((f) => /\.spec\./.test(f))).toEqual([]);
    expect(files.filter((f) => /\.test\.ts$/.test(f)).length).toBeGreaterThan(0);
  });
});
