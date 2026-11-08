import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  buildLicenses,
  bundledPackageDirs,
  composeLicenses,
  FONT_LICENSES_FILE,
  GEIST_MONO_NOTICE,
  LICENSES_HEADER,
  nxjsRuntimeDir,
  readPackageLicense,
  runtimeSection,
} from './licenses.ts';

// Pacotes e fontes sintéticos numa pasta temporária (nada de texto de licença de terceiros copiado para cá).
const tmp = mkdtempSync(join(tmpdir(), 'bf-licencas-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function fakePackage(dir: string, pkg: object, licenseFile: string | null): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
  if (licenseFile) writeFileSync(join(dir, licenseFile), `  Licença sintética de ${JSON.stringify(pkg)}\n\n`);
  return dir;
}

describe('licencas.txt do RomFS', () => {
  it('acha a pasta de cada pacote npm do bundle (escopo, aninhado, caminho relativo) e ignora o workspace', () => {
    const cwd = resolve('/repo/apps/switch');
    const dirs = bundledPackageDirs(
      [
        '../../node_modules/three/build/three.module.js',
        '../../node_modules/three/build/three.core.js',
        'node_modules/@scope/lib/dist/index.js',
        '../../node_modules/a/node_modules/b/index.js',
        '..\\..\\node_modules\\win\\index.js',
        '../../packages/render/src/index.ts',
        'src/main.ts',
      ],
      cwd,
    );
    expect(dirs).toEqual([
      resolve(cwd, '../../node_modules/three'),
      resolve(cwd, 'node_modules/@scope/lib'),
      resolve(cwd, '../../node_modules/a/node_modules/b'),
      resolve(cwd, '..\\..\\node_modules\\win'),
    ]);
  });

  it('lê nome, versão, licença e texto; pacote sem arquivo de licença reprova', () => {
    const ok = fakePackage(join(tmp, 'ok'), { name: 'ok', version: '1.2.3', license: 'MIT' }, 'LICENSE.md');
    expect(readPackageLicense(ok)).toEqual({
      name: 'ok',
      version: '1.2.3',
      license: 'MIT',
      text: 'Licença sintética de {"name":"ok","version":"1.2.3","license":"MIT"}',
    });
    const bare = fakePackage(join(tmp, 'bare'), { name: 'bare', version: '0.1.0' }, null);
    expect(() => readPackageLicense(bare)).toThrow(/bare não tem arquivo de licença/);
  });

  const runtime = { name: '@sintetico/runtime', version: '9.9.9', license: 'MIT', text: 'R' };

  it('cabeçalho com a exceção OFL, runtime do nx.js e Geist Mono, pacotes em ordem sem repetir e as fontes no fim', () => {
    const text = composeLicenses(
      [
        { name: 'zeta', version: '2.0.0', license: 'MIT', text: 'Z' },
        { name: 'alfa', version: '1.0.0', license: 'ISC', text: 'A' },
        { name: 'zeta', version: '2.0.0', license: 'MIT', text: 'Z' },
      ],
      '\n== BoboForces HUD: atlas MSDF derivado de Fonte Sintética 1.0 (SIL OFL 1.1) ==\n\nOFL sintética\n\n',
      runtime,
    );
    expect(text.startsWith(LICENSES_HEADER)).toBe(true);
    expect(LICENSES_HEADER).toContain('assets/fonts/ui-fonts.*');
    expect(LICENSES_HEADER).toContain('SIL Open Font License 1.1');
    // O cabeçalho não promete o que o arquivo não traz: diz o que cobre e o que ainda falta (bibliotecas do runtime).
    expect(LICENSES_HEADER).toContain('runtime do nx.js');
    expect(LICENSES_HEADER).toContain('ainda não estão neste arquivo');
    expect(runtimeSection(runtime)).toBe('== nx.js (runtime embutido no NRO/NSP) 9.9.9 (MIT) ==\n\nR');
    expect(GEIST_MONO_NOTICE).toContain('Geist Mono 1.700');
    expect(GEIST_MONO_NOTICE).toContain('Copyright 2024 The Geist Project Authors');
    expect(GEIST_MONO_NOTICE).toContain('OFL-1.1');
    expect(text).toBe(
      `${LICENSES_HEADER}\n\n${runtimeSection(runtime)}\n\n${GEIST_MONO_NOTICE}\n\n` +
        '== alfa 1.0.0 (ISC) ==\n\nA\n\n== zeta 2.0.0 (MIT) ==\n\nZ\n\n' +
        '== BoboForces HUD: atlas MSDF derivado de Fonte Sintética 1.0 (SIL OFL 1.1) ==\n\nOFL sintética\n',
    );
    expect(() => composeLicenses([], ' \n ', runtime)).toThrow(/rode npm run fontbake/);
  });

  it('o runtime do nx.js de verdade resolve e tem arquivo de licença MIT', () => {
    const section = readPackageLicense(nxjsRuntimeDir());
    expect(section.name).toBe('@nx.js/runtime');
    expect(section.license).toBe('MIT');
    expect(section.text.length).toBeGreaterThan(0);
  });

  it('sem o arquivo gerado pelo fontbake, o build para com a dica', () => {
    const root = join(tmp, 'raiz');
    mkdirSync(root, { recursive: true });
    expect(() => buildLicenses([], root, root)).toThrow(/falta assets-src\/fonts\/generated\/ui-fonts\.licencas\.txt/);
    const fonts = join(root, ...FONT_LICENSES_FILE.split('/'));
    mkdirSync(join(fonts, '..'), { recursive: true });
    writeFileSync(fonts, '== Fonte sintética ==\n\nOFL\n');
    fakePackage(join(root, 'node_modules', 'lib'), { name: 'lib', version: '3.0.0', license: 'MIT' }, 'license');
    const rt = fakePackage(join(tmp, 'rt'), { name: 'rt', version: '0.0.1', license: 'MIT' }, 'LICENSE');
    const text = buildLicenses(['node_modules/lib/index.js', 'src/main.ts'], root, root, rt);
    expect(text).toContain('== nx.js (runtime embutido no NRO/NSP) 0.0.1 (MIT) ==');
    expect(text).toContain(GEIST_MONO_NOTICE);
    expect(text).toContain('== lib 3.0.0 (MIT) ==');
    // Runtime sem arquivo de licença reprova, como qualquer pacote.
    const bareRt = fakePackage(join(tmp, 'rt-bare'), { name: 'rt-bare', version: '0.0.1' }, null);
    expect(() => buildLicenses([], root, root, bareRt)).toThrow(/rt-bare não tem arquivo de licença/);
    expect(text.endsWith('== Fonte sintética ==\n\nOFL\n')).toBe(true);
  });
});
