import { STORAGE_DEBOUNCE_MS, STORAGE_PREFIX, type Storage } from '@boboforces/platform-api';

/** O subconjunto do `localStorage` que a casca usa (permite testar com um mapa em memória). */
export interface StorageBackend {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface WebStorageOptions {
  /** `null` quando o `localStorage` não existe ou é bloqueado (aba anônima antiga, iframe, cookies desligados). */
  readonly backend: StorageBackend | null;
  readonly debounceMs?: number;
  readonly timers?: Timers;
  /** Avisos (cota estourada, acesso negado). A casca manda para o log. */
  readonly onWarning?: (message: string, error: unknown) => void;
  /** Chamado a cada `set` (a casca usa para pedir `navigator.storage.persist()` no primeiro gesto que salva algo). */
  readonly onWrite?: () => void;
}

export interface WebStorage extends Storage {
  /** `true` quando os dados sobrevivem ao fechar a aba (há `localStorage` e a última escrita deu certo). */
  readonly durable: boolean;
  /** Escritas que falharam (cota) e ficaram só na memória desta sessão. */
  readonly failedWrites: number;
}

/** Sufixo da cópia de backup. A chave lógica não pode terminar com ele. */
export const BACKUP_SUFFIX = '~bak';

const defaultTimers: Timers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

/**
 * `Storage` sobre o `localStorage` (tecnico.md §14.1 e §14.4). Toda chave física leva o prefixo `boboforces:` (a
 * origem do GitHub Pages é dividida com o gamebobo; nunca `clear()`). Leitura síncrona; escrita agrupada em até 250 ms
 * (a primeira escrita agenda o flush e as seguintes pegam carona, então nada espera mais que isso) e flush explícito ao
 * pausar e no `pagehide`. Antes de sobrescrever, a versão anterior vai para `<chave>~bak`.
 *
 * Falhas nunca derrubam o jogo: cota estourada ou acesso negado deixam o valor na memória desta sessão e geram aviso.
 */
export function createWebStorage(options: WebStorageOptions): WebStorage {
  const backend = options.backend;
  const debounceMs = options.debounceMs ?? STORAGE_DEBOUNCE_MS;
  const timers = options.timers ?? defaultTimers;
  const warn = options.onWarning ?? (() => {});
  /** Escritas ainda não gravadas (`null` = remoção). */
  const pending = new Map<string, string | null>();
  /** Valores que só existem nesta sessão (sem backend ou escrita recusada). Têm prioridade sobre o backend. */
  const memory = new Map<string, string>();
  let timer: unknown = null;
  let failedWrites = 0;
  let lastWriteOk = true;

  function checkKey(key: string): void {
    if (key.length === 0 || key.endsWith(BACKUP_SUFFIX)) throw new Error(`Storage: chave inválida "${key}"`);
  }

  function read(physical: string): string | null {
    if (!backend) return null;
    try {
      return backend.getItem(physical);
    } catch (error) {
      warn(`storage: leitura negada (${physical})`, error);
      return null;
    }
  }

  function writeOne(key: string, value: string | null): void {
    const physical = STORAGE_PREFIX + key;
    const backup = physical + BACKUP_SUFFIX;
    if (!backend) {
      if (value === null) memory.delete(key);
      else memory.set(key, value);
      return;
    }
    if (value === null) {
      memory.delete(key);
      try {
        backend.removeItem(physical);
        backend.removeItem(backup);
      } catch (error) {
        warn(`storage: remoção falhou (${key})`, error);
      }
      return;
    }
    const previous = read(physical);
    if (previous === value) {
      memory.delete(key);
      return;
    }
    if (previous !== null) {
      try {
        backend.setItem(backup, previous);
      } catch (error) {
        // Sem espaço para o backup: o backup velho já não corresponde à versão anterior, então sai também.
        warn(`storage: sem espaço para o backup de "${key}"`, error);
        try {
          backend.removeItem(backup);
        } catch {
          // nada a fazer
        }
      }
    }
    try {
      backend.setItem(physical, value);
      memory.delete(key);
      lastWriteOk = true;
    } catch (error) {
      memory.set(key, value);
      failedWrites++;
      lastWriteOk = false;
      warn(`storage: escrita recusada, "${key}" fica só nesta sessão`, error);
    }
  }

  function flushNow(): void {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
    for (const [key, value] of pending) writeOne(key, value);
    pending.clear();
  }

  function schedule(): void {
    if (timer === null) {
      timer = timers.setTimeout(() => {
        timer = null;
        flushNow();
      }, debounceMs);
    }
  }

  return {
    get durable() {
      return backend !== null && lastWriteOk;
    },
    get failedWrites() {
      return failedWrites;
    },
    get(key) {
      const queued = pending.get(key);
      if (queued !== undefined) return queued;
      const session = memory.get(key);
      if (session !== undefined) return session;
      return read(STORAGE_PREFIX + key);
    },
    set(key, value) {
      checkKey(key);
      pending.set(key, value);
      schedule();
      options.onWrite?.();
    },
    remove(key) {
      checkKey(key);
      pending.set(key, null);
      schedule();
    },
    keys() {
      const out = new Set<string>(memory.keys());
      if (backend) {
        try {
          for (let i = 0; i < backend.length; i++) {
            const physical = backend.key(i);
            if (physical === null || !physical.startsWith(STORAGE_PREFIX) || physical.endsWith(BACKUP_SUFFIX)) continue;
            out.add(physical.slice(STORAGE_PREFIX.length));
          }
        } catch (error) {
          warn('storage: listagem negada', error);
        }
      }
      for (const [key, value] of pending) {
        if (value === null) out.delete(key);
        else out.add(key);
      }
      return [...out].sort();
    },
    getBackup(key) {
      checkKey(key);
      return read(STORAGE_PREFIX + key + BACKUP_SUFFIX);
    },
    flush() {
      flushNow();
      return Promise.resolve();
    },
  };
}

/** Pega o `localStorage` sem estourar: o próprio getter lança `SecurityError` em alguns contextos. */
export function readLocalStorage(win: Window): StorageBackend | null {
  try {
    const storage = win.localStorage;
    storage.getItem(STORAGE_PREFIX + 'probe');
    return storage;
  } catch {
    return null;
  }
}
