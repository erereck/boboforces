import { STORAGE_DEBOUNCE_MS, type Storage } from '@boboforces/platform-api';
import type { NxFs } from './nx.ts';

/**
 * Save no SD, como no MMM (DECISOES "Save no Switch"; tecnico.md §14.1): um JSON plano chave → texto em
 * `save.json`, com cópia do último save válido em `save.backup.json` antes de cada escrita. Leitura síncrona;
 * escrita com debounce de 250 ms e `flush()` ao pausar e ao sair. Os valores já são documentos versionados
 * (`format: "boboforces/…@n"`); este arquivo é só o contêiner, sem progressão nem dados de sessão.
 *
 * `getBackup` (contrato da Platform) é por CHAVE, igual à web: `save.previous.json` guarda o valor de cada chave
 * antes da última gravação que a mudou. Ele não substitui o `save.backup.json`, que segue sendo o save inteiro da
 * gravação anterior (é com ele que um `save.json` corrompido se recupera).
 */
export interface SdStorageOptions {
  readonly fs: NxFs;
  /** Pasta no SD, sem barra no fim (ex.: `sdmc:/switch/boboforces`). */
  readonly dir: string;
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
  /** Avisa o diagnóstico (runtime.log) quando ler ou gravar dá errado. Nunca lança. */
  readonly onProblem: (message: string) => void;
  readonly debounceMs?: number;
  /**
   * M4 (fase 2b): o dia de hoje (`AAAA-MM-DD`), para a cópia diária do save em `backup/`; ausente (ou `null`, sem
   * relógio) = sem cópia diária.
   */
  readonly today?: () => string | null;
}

/** M4 (fase 2b): a pasta das cópias diárias e quantas ficam. */
export const DAILY_BACKUP_SUBDIR = 'backup';
export const DAILY_BACKUPS_KEPT = 3;

export interface SdStorage extends Storage {
  /** Grava agora, de forma síncrona (usado no `unload`, quando o laço de eventos já parou). */
  flushSync(): void;
  /** De onde o save veio no boot: arquivo principal, backup ou nenhum (save novo). */
  readonly loadedFrom: 'primary' | 'backup' | 'none';
}

const decoder = new TextDecoder();

/** Save válido = objeto JSON plano; só entram os valores de texto (o resto é descartado). */
function parseSave(bytes: ArrayBuffer | null): Map<string, string> | null {
  if (!bytes) return null;
  try {
    const parsed: unknown = JSON.parse(decoder.decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const out = new Map<string, string>();
    for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') out.set(k, v);
    return out;
  } catch {
    return null;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createSdStorage(opts: SdStorageOptions): SdStorage {
  const { fs, dir, onProblem } = opts;
  const primary = `${dir}/save.json`;
  const backup = `${dir}/save.backup.json`;
  const previousPath = `${dir}/save.previous.json`;
  const debounceMs = opts.debounceMs ?? STORAGE_DEBOUNCE_MS;

  const read = (path: string): ArrayBuffer | null => {
    try {
      return fs.readFileSync(path);
    } catch {
      return null; // arquivo ausente: o nx.js pode lançar ou devolver null
    }
  };

  let data = parseSave(read(primary));
  let loadedFrom: SdStorage['loadedFrom'] = data ? 'primary' : 'none';
  if (!data) {
    data = parseSave(read(backup));
    if (data) {
      loadedFrom = 'backup';
      onProblem(`save: ${primary} ilegível; usando o backup`);
    }
  }
  // M4 (fase 2b): na 1ª abertura do dia, o save que abriu bem vira `backup/save-AAAA-MM-DD.json` (ficam os 3 mais
  // recentes). É a volta para quem apagou algo sem querer (o `save.backup.json` é só a gravação anterior).
  const today = opts.today?.() ?? null;
  if (today !== null && /^\d{4}-\d{2}-\d{2}$/.test(today) && loadedFrom === 'primary') {
    const folder = `${dir}/${DAILY_BACKUP_SUBDIR}`;
    const daily = `${folder}/save-${today}.json`;
    try {
      if (read(daily) === null) {
        const bytes = read(primary);
        fs.mkdirSync(folder);
        if (bytes) fs.writeFileSync(daily, new Uint8Array(bytes));
      }
      const old = (fs.readDirSync(folder) ?? [])
        .filter((n) => /^save-\d{4}-\d{2}-\d{2}\.json$/.test(n))
        .sort()
        .reverse()
        .slice(DAILY_BACKUPS_KEPT);
      for (const name of old) fs.removeSync(`${folder}/${name}`);
    } catch (error) {
      onProblem(`save: não foi possível gravar a cópia do dia: ${errorText(error)}`);
    }
  }
  const values = data ?? new Map<string, string>();
  /** O que está no `save.json` agora: a base para saber o que cada gravação mudou. */
  let persisted = new Map(values);
  /** Valor de cada chave antes da última gravação que a mudou (`getBackup`). */
  const previous = parseSave(read(previousPath)) ?? new Map<string, string>();
  let timer: unknown = null;
  let dirty = false;

  const sortedJson = (map: ReadonlyMap<string, string>): string => {
    const sorted: Record<string, string> = {};
    for (const key of [...map.keys()].sort()) sorted[key] = map.get(key) as string;
    return JSON.stringify(sorted);
  };

  const writeNow = (): void => {
    if (timer !== null) opts.clearTimeout(timer);
    timer = null;
    if (!dirty) return;
    try {
      fs.mkdirSync(dir);
      // O último save válido vira o backup antes de ser substituído (um principal corrompido nunca vira backup).
      const last = read(primary);
      if (parseSave(last) && last) fs.writeFileSync(backup, new Uint8Array(last));
      fs.writeFileSync(primary, sortedJson(values));
      dirty = false;
      let changed = false;
      for (const [key, old] of persisted) {
        const now = values.get(key);
        if (now === undefined) changed = previous.delete(key) || changed;
        else if (now !== old) {
          previous.set(key, old);
          changed = true;
        }
      }
      persisted = new Map(values);
      if (changed) fs.writeFileSync(previousPath, sortedJson(previous));
    } catch (error) {
      onProblem(`save: não foi possível gravar ${primary}: ${errorText(error)}`);
    }
  };

  const schedule = (): void => {
    dirty = true;
    if (timer !== null) opts.clearTimeout(timer);
    timer = opts.setTimeout(writeNow, debounceMs);
  };

  return {
    get loadedFrom() {
      return loadedFrom;
    },
    get(key) {
      return values.get(key) ?? null;
    },
    set(key, value) {
      if (values.get(key) === value) return;
      values.set(key, value);
      schedule();
    },
    remove(key) {
      if (!values.delete(key)) return;
      schedule();
    },
    keys() {
      return [...values.keys()];
    },
    getBackup(key) {
      return values.has(key) ? (previous.get(key) ?? null) : null;
    },
    flush() {
      writeNow();
      return Promise.resolve();
    },
    flushSync: writeNow,
  };
}
