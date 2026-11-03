import { STORAGE_PREFIX } from '@boboforces/platform-api';
import { checkStorageContract } from '@boboforces/platform-api/testing';
import { describe, expect, it } from 'vitest';
import { BACKUP_SUFFIX, createWebStorage, type StorageBackend, type Timers } from './storage.ts';

/** `localStorage` sintético; `quota` em caracteres (chave + valor), como os navegadores contam. */
class MemoryBackend implements StorageBackend {
  readonly map = new Map<string, string>();
  quota = Infinity;
  get length(): number {
    return this.map.size;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    let used = 0;
    for (const [k, v] of this.map) if (k !== key) used += k.length + v.length;
    if (used + key.length + value.length > this.quota) throw new Error('QuotaExceededError');
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** Relógio manual: o debounce só dispara quando o teste manda. */
function manualTimers(): Timers & { fire(): void; readonly pending: number } {
  let queue: (() => void)[] = [];
  return {
    setTimeout(callback) {
      queue.push(callback);
      return queue.length;
    },
    clearTimeout() {
      queue = [];
    },
    fire() {
      const run = queue;
      queue = [];
      for (const cb of run) cb();
    },
    get pending() {
      return queue.length;
    },
  };
}

describe('createWebStorage', () => {
  it('cumpre o contrato do Storage (o mesmo teste do Switch)', async () => {
    expect(
      await checkStorageContract(() => createWebStorage({ backend: new MemoryBackend(), timers: manualTimers() })),
    ).toEqual([]);
  });

  it('grava com o prefixo boboforces: só depois do debounce, e lê na hora', () => {
    const backend = new MemoryBackend();
    const timers = manualTimers();
    const storage = createWebStorage({ backend, timers });
    storage.set('settings', '{"v":1}');
    expect(storage.get('settings')).toBe('{"v":1}');
    expect(backend.map.size).toBe(0);
    storage.set('bots', '[]');
    expect(timers.pending).toBe(1); // a segunda escrita pega carona no mesmo flush
    timers.fire();
    expect(backend.map.get(`${STORAGE_PREFIX}settings`)).toBe('{"v":1}');
    expect(backend.map.get(`${STORAGE_PREFIX}bots`)).toBe('[]');
  });

  it('guarda a versão anterior como backup e esconde o backup da listagem', async () => {
    const backend = new MemoryBackend();
    const storage = createWebStorage({ backend, timers: manualTimers() });
    storage.set('settings', 'v1');
    await storage.flush();
    storage.set('settings', 'v2');
    await storage.flush();
    expect(storage.get('settings')).toBe('v2');
    expect(storage.getBackup('settings')).toBe('v1');
    expect(backend.map.get(`${STORAGE_PREFIX}settings${BACKUP_SUFFIX}`)).toBe('v1');
    expect(storage.keys()).toEqual(['settings']);
  });

  it('não mexe em chaves de outros jogos da mesma origem', async () => {
    const backend = new MemoryBackend();
    backend.map.set('gamebobo:save', 'deles');
    const storage = createWebStorage({ backend, timers: manualTimers() });
    storage.set('a', '1');
    storage.remove('a');
    await storage.flush();
    expect(storage.keys()).toEqual([]);
    expect(backend.map.get('gamebobo:save')).toBe('deles');
  });

  it('remove a chave e o backup', async () => {
    const backend = new MemoryBackend();
    const storage = createWebStorage({ backend, timers: manualTimers() });
    storage.set('preset', 'a');
    await storage.flush();
    storage.set('preset', 'b');
    await storage.flush();
    storage.remove('preset');
    expect(storage.get('preset')).toBeNull();
    await storage.flush();
    expect(backend.map.size).toBe(0);
  });

  it('com a cota estourada, mantém o valor na sessão e avisa', async () => {
    const backend = new MemoryBackend();
    backend.quota = 40;
    const warnings: string[] = [];
    const storage = createWebStorage({ backend, timers: manualTimers(), onWarning: (m) => warnings.push(m) });
    storage.set('grande', 'x'.repeat(100));
    await storage.flush();
    expect(storage.get('grande')).toBe('x'.repeat(100));
    expect(storage.failedWrites).toBe(1);
    expect(storage.durable).toBe(false);
    expect(storage.keys()).toEqual(['grande']);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('sem localStorage, funciona só em memória', async () => {
    const storage = createWebStorage({ backend: null, timers: manualTimers() });
    storage.set('a', '1');
    await storage.flush();
    expect(storage.get('a')).toBe('1');
    expect(storage.keys()).toEqual(['a']);
    expect(storage.durable).toBe(false);
  });

  it('sobrevive a um backend que lança em toda leitura', () => {
    const hostile: StorageBackend = {
      length: 0,
      key: () => null,
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {},
    };
    const storage = createWebStorage({ backend: hostile, timers: manualTimers() });
    expect(storage.get('x')).toBeNull();
    storage.set('x', '1');
    void storage.flush();
    expect(storage.get('x')).toBe('1');
  });

  it('recusa chave vazia ou com o sufixo de backup', () => {
    const storage = createWebStorage({ backend: null, timers: manualTimers() });
    expect(() => storage.set('', 'x')).toThrow();
    expect(() => storage.set(`a${BACKUP_SUFFIX}`, 'x')).toThrow();
  });

  it('avisa a cada escrita (gancho do navigator.storage.persist)', () => {
    let writes = 0;
    const storage = createWebStorage({ backend: null, timers: manualTimers(), onWrite: () => writes++ });
    storage.set('a', '1');
    storage.set('b', '2');
    expect(writes).toBe(2);
  });
});
