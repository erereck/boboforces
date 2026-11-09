import { validateBot, type BotDocument } from './bot.ts';
import { DocReader } from './doc-read.ts';
import { formatId, type FormatId } from './format-id.ts';
import { validateMatchRecipe, type MatchRecipe } from './match-recipe.ts';
import { migrateDocument } from './migrations.ts';
import { DEFAULT_SETTINGS, validateSettings, type SettingsDocument } from './settings.ts';
import { EMPTY_STATS, validateStats, type StatsDocument } from './stats.ts';
import { isPlainObject, type RecipeLimits, type ValidationResult } from './validation.ts';

/**
 * M2 (fase 4b): a biblioteca de presets e o `backup@1` (tecnico.md §14.2 e §14.4; arte-ux.md §6.4 e §6.12).
 * - **Presets do jogador:** os 5 últimos (o primeiro é o que o JOGAR usa), os salvos (até 200 na web e 50 no
 *   Switch) e até 6 favoritos (nomes de salvos), que viram atalhos na Partida Rápida.
 * - **Backup:** tudo num arquivo só (ajustes, estatísticas, presets e bots da Oficina), para exportar e importar.
 * Cada parte é validada sozinha: o que não passa sai com o aviso `save.droppedEntry` (o resto do backup fica).
 */
export const BACKUP_FORMAT: FormatId = formatId('backup');

export interface PresetLibrary {
  readonly recent: readonly MatchRecipe[];
  readonly saved: readonly MatchRecipe[];
  readonly favorites: readonly string[];
  /** M2 (fase 5a): ids dos bots favoritos da Oficina (de fábrica ou salvos), na ordem em que entraram. */
  readonly botFavorites: readonly string[];
}

/** Tetos da biblioteca (gameplay.md §10.4 e §6.7). */
export const LIBRARY_LIMITS = {
  recent: 5,
  saved: 200,
  savedSwitch: 50,
  favorites: 6,
  bots: 500,
  botsSwitch: 100,
  nameLength: 40,
} as const;

export const EMPTY_PRESET_LIBRARY: PresetLibrary = { recent: [], saved: [], favorites: [], botFavorites: [] };

export interface BackupDocument {
  readonly format: FormatId;
  /** Quando foi exportado (texto ISO que o `game` passa: o `format` não lê relógio, regra 10) e de que versão. */
  readonly createdAt: string;
  readonly gameVersion: string;
  readonly settings: SettingsDocument;
  readonly stats: StatsDocument;
  readonly presets: PresetLibrary;
  /** Bots salvos da Oficina (fase 5). */
  readonly bots: readonly BotDocument[];
}

/** Tetos de uma plataforma para a biblioteca (os salvos e os bots). */
export interface LibraryCaps {
  readonly saved: number;
  readonly bots: number;
}

export const WEB_LIBRARY_CAPS: LibraryCaps = { saved: LIBRARY_LIMITS.saved, bots: LIBRARY_LIMITS.bots };

function readPresets(
  r: DocReader,
  src: Record<string, unknown>,
  key: string,
  path: string,
  max: number,
  limits: RecipeLimits,
): MatchRecipe[] {
  const v = src[key];
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    r.warn(path, 'save.invalidField');
    return [];
  }
  const out: MatchRecipe[] = [];
  for (let i = 0; i < v.length; i++) {
    if (out.length === max) {
      r.warn(path, 'save.valueClamped', `${v.length} → ${max} presets`);
      break;
    }
    const checked = validateMatchRecipe(v[i], limits);
    if (checked.ok) out.push(checked.value);
    else r.warn(`${path}[${i}]`, 'save.droppedEntry', checked.errors.map((e) => e.code).join(', '));
  }
  return out;
}

/**
 * Valida a biblioteca de presets (sem `format` próprio: cada preset é um `preset@1`). Os salvos ganham nome único
 * (sem nome, "Preset N"; repetido, " (2)"); os favoritos que não são nomes de salvos saem.
 */
export function validatePresetLibrary(
  input: unknown,
  limits: RecipeLimits,
  caps: LibraryCaps = WEB_LIBRARY_CAPS,
): ValidationResult<PresetLibrary> {
  const r = new DocReader('save.invalidField', 'save.valueClamped');
  const src = isPlainObject(input) ? input : {};
  if (input !== undefined && !isPlainObject(input)) r.warn('', 'save.invalidField');
  const recent = readPresets(r, src, 'recent', 'recent', LIBRARY_LIMITS.recent, limits);
  const savedRaw = readPresets(r, src, 'saved', 'saved', caps.saved, limits);
  const names = new Set<string>();
  const saved = savedRaw.map((p, i) => {
    const base = (p.name ?? '').trim().slice(0, LIBRARY_LIMITS.nameLength) || `Preset ${i + 1}`;
    let name = base;
    for (let n = 2; names.has(name); n++) name = `${base} (${n})`;
    names.add(name);
    return name === p.name ? p : { ...p, name };
  });
  const favorites = r
    .strings(src, 'favorites', 'favorites', LIBRARY_LIMITS.favorites, LIBRARY_LIMITS.nameLength)
    .filter((n, i, all) => names.has(n) && all.indexOf(n) === i);
  // Os bots não estão aqui: o id que sumiu só deixa de aparecer na Oficina.
  const botFavorites = r
    .strings(src, 'botFavorites', 'botFavorites', LIBRARY_LIMITS.favorites, LIBRARY_LIMITS.nameLength)
    .filter((n, i, all) => all.indexOf(n) === i);
  return { ok: true, value: { recent, saved, favorites, botFavorites }, warnings: r.warnings };
}

/** Monta o backup com o que o jogo tem agora. */
export function createBackup(
  parts: { settings: SettingsDocument; stats: StatsDocument; presets: PresetLibrary; bots: readonly BotDocument[] },
  createdAt: string,
  gameVersion: string,
): BackupDocument {
  return { format: BACKUP_FORMAT, createdAt, gameVersion, ...parts };
}

/**
 * Valida um `backup@1` (o arquivo importado): recusa o que não é backup (ou é de versão mais nova); cada parte vale
 * sozinha, e a que não passa cai no padrão com aviso.
 */
export function validateBackup(
  input: unknown,
  limits: RecipeLimits,
  caps: LibraryCaps = WEB_LIBRARY_CAPS,
): ValidationResult<BackupDocument> {
  const migrated = migrateDocument(input, 'backup');
  if (!migrated.ok) return migrated;
  const doc = migrated.value;
  const r = new DocReader('save.invalidField', 'save.valueClamped');
  r.warnings.push(...migrated.warnings);
  let settings = DEFAULT_SETTINGS;
  if (doc['settings'] !== undefined) {
    const s = validateSettings(doc['settings']);
    if (s.ok) {
      settings = s.value;
      r.warnings.push(...s.warnings);
    } else r.warn('settings', 'save.droppedEntry', s.errors.map((e) => e.code).join(', '));
  }
  let stats = EMPTY_STATS;
  if (doc['stats'] !== undefined) {
    const s = validateStats(doc['stats']);
    if (s.ok) {
      stats = s.value;
      r.warnings.push(...s.warnings);
    } else r.warn('stats', 'save.droppedEntry', s.errors.map((e) => e.code).join(', '));
  }
  const lib = validatePresetLibrary(doc['presets'], limits, caps);
  if (lib.ok) r.warnings.push(...lib.warnings);
  const bots: BotDocument[] = [];
  const rawBots = doc['bots'];
  if (rawBots !== undefined && !Array.isArray(rawBots)) r.warn('bots', 'save.invalidField');
  else if (Array.isArray(rawBots)) {
    for (let i = 0; i < rawBots.length; i++) {
      if (bots.length === caps.bots) {
        r.warn('bots', 'save.valueClamped', `${rawBots.length} → ${caps.bots} bots`);
        break;
      }
      const b = validateBot(rawBots[i]);
      if (b.ok) bots.push(b.value);
      else r.warn(`bots[${i}]`, 'save.droppedEntry', b.errors.map((e) => e.code).join(', '));
    }
  }
  return {
    ok: true,
    value: {
      format: BACKUP_FORMAT,
      createdAt: r.str(doc, 'createdAt', 'createdAt', '', 40),
      gameVersion: r.str(doc, 'gameVersion', 'gameVersion', '', 32),
      settings,
      stats,
      presets: lib.ok ? lib.value : EMPTY_PRESET_LIBRARY,
      bots,
    },
    warnings: r.warnings,
  };
}
