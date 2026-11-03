import { describe, expect, it } from 'vitest';
import { packageBaseName, readNacpFields, readVersion } from './paths.ts';
import { nacpPackageJson } from './stage.ts';

describe('NACP do BoboForces', () => {
  it('título, autor e title ID fixados no M0 (tecnico.md §19.2)', () => {
    expect(readNacpFields()).toEqual({
      title: 'BoboForces',
      author: 'EriLab',
      id: '01E1AB0B0B0F0000',
      startupUserAccount: 0,
      userAccountSaveDataSize: '0',
    });
  });

  it('o package.json de montagem leva a versão do version.json', () => {
    const pkg = nacpPackageJson(readNacpFields(), '9.8.7');
    expect(pkg.name).toBe('boboforces');
    expect(pkg.version).toBe('9.8.7');
    expect(pkg.nacp.title).toBe('BoboForces');
    expect(pkg.nacp.id).toMatch(/^[0-9A-F]{16}$/);
    expect(readVersion().version).toMatch(/^\d+\.\d+\.\d+/);
    expect(packageBaseName('0.0.1')).toBe('BoboForces-0.0.1');
  });
});
