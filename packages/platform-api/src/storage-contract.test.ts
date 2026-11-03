import { describe, expect, it } from 'vitest';
import type { Storage } from './index.ts';
import { checkStorageContract } from './storage-contract.ts';

/** Implementação de referência, em memória: a menor coisa que cumpre o contrato (e prova que o contrato é cumprível). */
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  const backups = new Map<string, string>();
  return {
    get: (key) => values.get(key) ?? null,
    set(key, value) {
      const old = values.get(key);
      if (old === value) return;
      if (old !== undefined) backups.set(key, old);
      values.set(key, value);
    },
    remove(key) {
      values.delete(key);
      backups.delete(key);
    },
    keys: () => [...values.keys()],
    getBackup: (key) => backups.get(key) ?? null,
    flush: async () => {},
  };
}

describe('contrato do Storage', () => {
  it('a referência em memória cumpre', async () => {
    expect(await checkStorageContract(memoryStorage)).toEqual([]);
  });

  it('acusa backup errado', async () => {
    const broken = (): Storage => ({ ...memoryStorage(), getBackup: () => null });
    expect((await checkStorageContract(broken)).join('\n')).toContain('backup depois de mudar');
  });
});
