import {
  createBackup,
  DEFAULT_SETTINGS,
  EMPTY_PRESET_LIBRARY,
  EMPTY_STATS,
  ENGINE_MAX_BOTS,
  issue,
  LIBRARY_LIMITS,
  PLATFORM_PROFILES,
  validateBackup,
  validateBot,
  validatePresetLibrary,
  validateSettings,
  validateStats,
  WEB_LIBRARY_CAPS,
  type BackupDocument,
  type BotDocument,
  type LibraryCaps,
  type MatchRecipe,
  type PresetLibrary,
  type RecipeLimits,
  type SettingsDocument,
  type StatsDocument,
  type ValidationIssue,
  type ValidationResult,
} from '@boboforces/format';
import type { PlatformId, Storage } from '@boboforces/platform-api';

/**
 * M2 (fase 4b): o save do jogador sobre o `platform.storage` (tecnico.md §14.1 e §14.4): ajustes, estatísticas, a
 * biblioteca de presets e os bots da Oficina, cada um numa chave, em JSON. A leitura valida e migra (o que estiver
 * estragado cai no padrão, com aviso em `loadWarnings`); a escrita vai direto para o storage, que junta as gravações
 * (debounce) e guarda a versão anterior. Exportar e importar o `backup@1` em texto (a casca baixa e escolhe o arquivo).
 */
export const SAVE_KEYS = { settings: 'settings', stats: 'stats', presets: 'presets', bots: 'bots' } as const;

/** Tetos de receita para guardar presets: os do motor (o corte ao aparelho é na hora de jogar). */
export const STORAGE_RECIPE_LIMITS: RecipeLimits = {
  maxBots: ENGINE_MAX_BOTS,
  maxLocalHumans: 4,
  maxViewDistanceM: PLATFORM_PROFILES.pc.maxViewDistanceM,
};

/** Tetos da biblioteca por plataforma (gameplay.md §10.4 e §6.7: 200 presets e 500 bots na web; 50 e 100 no Switch). */
export function libraryCapsFor(platform: PlatformId): LibraryCaps {
  return platform === 'switch'
    ? { saved: LIBRARY_LIMITS.savedSwitch, bots: LIBRARY_LIMITS.botsSwitch }
    : WEB_LIBRARY_CAPS;
}

export type BackupMode = 'merge' | 'replace';

export interface SaveStore {
  readonly settings: SettingsDocument;
  readonly stats: StatsDocument;
  readonly presets: PresetLibrary;
  readonly bots: readonly BotDocument[];
  /** Avisos da leitura (migrou, corrigiu, descartou), para o relatório e a Novidades. */
  readonly loadWarnings: readonly ValidationIssue[];
  setSettings(next: SettingsDocument): void;
  setStats(next: StatsDocument): void;
  /** O preset vai para o topo dos últimos (é o do JOGAR); o mesmo jeito de partida não se repete na lista. */
  pushRecent(preset: MatchRecipe): void;
  /** Salva pelo nome (o mesmo nome substitui); `false` se a biblioteca está cheia. */
  savePreset(preset: MatchRecipe & { readonly name: string }): boolean;
  deletePreset(name: string): void;
  /** Liga ou desliga o favorito de um salvo; `false` se não existe ou se já há 6 favoritos. */
  setFavorite(name: string, on: boolean): boolean;
  /** O backup em texto (JSON), para baixar. `createdAt` vem de quem tem relógio (a casca). */
  exportBackup(createdAt: string, gameVersion: string): string;
  /** Lê um backup (texto do arquivo escolhido): validado, para o resumo antes de aplicar. */
  readBackup(text: string): ValidationResult<BackupDocument>;
  /**
   * Aplica um backup lido. `replace` troca tudo; `merge` junta: os presets salvos e os bots do arquivo entram ao lado
   * dos atuais (nome repetido ganha " (2)", bot de id repetido fica o atual), e os ajustes e as estatísticas daqui ficam.
   */
  applyBackup(backup: BackupDocument, mode: BackupMode): void;
  flush(): Promise<void>;
}

/** Mesmo jeito de partida (ignora o nome e a semente, que muda a cada partida). */
function sameSetup(a: MatchRecipe, b: MatchRecipe): boolean {
  return JSON.stringify({ ...a, name: '', seed: 0 }) === JSON.stringify({ ...b, name: '', seed: 0 });
}

function parse(storage: Storage, key: string, warnings: ValidationIssue[]): unknown {
  const text = storage.get(key);
  if (text === null) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    warnings.push(issue(key, 'save.droppedEntry', 'JSON inválido'));
    return undefined;
  }
}

export function createSaveStore(storage: Storage, caps: LibraryCaps = WEB_LIBRARY_CAPS): SaveStore {
  const warnings: ValidationIssue[] = [];
  const prefixed = (key: string, list: readonly ValidationIssue[]): void => {
    for (const w of list) warnings.push(issue(w.path === '' ? key : `${key}.${w.path}`, w.code as never, w.detail));
  };

  let settings = DEFAULT_SETTINGS;
  const rawSettings = parse(storage, SAVE_KEYS.settings, warnings);
  if (rawSettings !== undefined) {
    const r = validateSettings(rawSettings);
    if (r.ok) {
      settings = r.value;
      prefixed(SAVE_KEYS.settings, r.warnings);
    } else prefixed(SAVE_KEYS.settings, r.errors);
  }
  let stats = EMPTY_STATS;
  const rawStats = parse(storage, SAVE_KEYS.stats, warnings);
  if (rawStats !== undefined) {
    const r = validateStats(rawStats);
    if (r.ok) {
      stats = r.value;
      prefixed(SAVE_KEYS.stats, r.warnings);
    } else prefixed(SAVE_KEYS.stats, r.errors);
  }
  let presets = EMPTY_PRESET_LIBRARY;
  const rawPresets = parse(storage, SAVE_KEYS.presets, warnings);
  if (rawPresets !== undefined) {
    const r = validatePresetLibrary(rawPresets, STORAGE_RECIPE_LIMITS, caps);
    if (r.ok) {
      presets = r.value;
      prefixed(SAVE_KEYS.presets, r.warnings);
    }
  }
  let bots: readonly BotDocument[] = [];
  const rawBots = parse(storage, SAVE_KEYS.bots, warnings);
  if (Array.isArray(rawBots)) {
    const list: BotDocument[] = [];
    for (let i = 0; i < rawBots.length && list.length < caps.bots; i++) {
      const r = validateBot(rawBots[i]);
      if (r.ok) list.push(r.value);
      else warnings.push(issue(`${SAVE_KEYS.bots}[${i}]`, 'save.droppedEntry', r.errors.map((e) => e.code).join(', ')));
    }
    bots = list;
  } else if (rawBots !== undefined) warnings.push(issue(SAVE_KEYS.bots, 'save.invalidField'));

  const write = (key: string, value: unknown): void => storage.set(key, JSON.stringify(value));
  const writePresets = (): void => write(SAVE_KEYS.presets, presets);

  return {
    get settings() {
      return settings;
    },
    get stats() {
      return stats;
    },
    get presets() {
      return presets;
    },
    get bots() {
      return bots;
    },
    loadWarnings: warnings,
    setSettings(next) {
      settings = next;
      write(SAVE_KEYS.settings, settings);
    },
    setStats(next) {
      stats = next;
      write(SAVE_KEYS.stats, stats);
    },
    pushRecent(preset) {
      const recent = [preset, ...presets.recent.filter((p) => !sameSetup(p, preset))].slice(0, LIBRARY_LIMITS.recent);
      presets = { ...presets, recent };
      writePresets();
    },
    savePreset(preset) {
      const i = presets.saved.findIndex((p) => p.name === preset.name);
      if (i < 0 && presets.saved.length >= caps.saved) return false;
      const saved = presets.saved.slice();
      if (i >= 0) saved[i] = preset;
      else saved.push(preset);
      presets = { ...presets, saved };
      writePresets();
      return true;
    },
    deletePreset(name) {
      presets = {
        ...presets,
        saved: presets.saved.filter((p) => p.name !== name),
        favorites: presets.favorites.filter((n) => n !== name),
      };
      writePresets();
    },
    setFavorite(name, on) {
      if (!presets.saved.some((p) => p.name === name)) return false;
      const has = presets.favorites.includes(name);
      if (on === has) return true;
      if (on && presets.favorites.length >= LIBRARY_LIMITS.favorites) return false;
      presets = {
        ...presets,
        favorites: on ? [...presets.favorites, name] : presets.favorites.filter((n) => n !== name),
      };
      writePresets();
      return true;
    },
    exportBackup(createdAt, gameVersion) {
      return JSON.stringify(createBackup({ settings, stats, presets, bots }, createdAt, gameVersion), null, 2);
    },
    readBackup(text) {
      let doc: unknown;
      try {
        doc = JSON.parse(text) as unknown;
      } catch {
        return { ok: false, errors: [issue('', 'doc.notObject', 'JSON inválido')] };
      }
      return validateBackup(doc, STORAGE_RECIPE_LIMITS, caps);
    },
    applyBackup(backup, mode) {
      if (mode === 'replace') {
        settings = backup.settings;
        stats = backup.stats;
        presets = backup.presets;
        bots = backup.bots.slice(0, caps.bots);
      } else {
        // Juntar: a validação da biblioteca dá nome único aos repetidos e corta no teto.
        const merged = validatePresetLibrary(
          {
            recent: presets.recent,
            saved: [...presets.saved, ...backup.presets.saved],
            favorites: presets.favorites,
          },
          STORAGE_RECIPE_LIMITS,
          caps,
        );
        if (merged.ok) presets = merged.value;
        const ids = new Set(bots.map((b) => b.id));
        bots = [...bots, ...backup.bots.filter((b) => !ids.has(b.id))].slice(0, caps.bots);
      }
      write(SAVE_KEYS.settings, settings);
      write(SAVE_KEYS.stats, stats);
      writePresets();
      write(SAVE_KEYS.bots, bots);
    },
    flush() {
      return storage.flush();
    },
  };
}
