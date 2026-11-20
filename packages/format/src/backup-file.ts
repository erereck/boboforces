import { validateBot, type BotDocument } from './bot.ts';
import { DocReader } from './doc-read.ts';
import { migrateDocument } from './migrations.ts';
import { DEFAULT_SETTINGS, validateSettings, type SettingsDocument } from './settings.ts';
import { EMPTY_STATS, validateStats, type StatsDocument } from './stats.ts';
import { DEFAULT_BOBO, validateBobo, type BoboDocument } from './bobo.ts';
import { validateSquad, type SquadDocument } from './squad.ts';
import type { RecipeLimits, ValidationResult } from './validation.ts';
import {
  BACKUP_FORMAT,
  EMPTY_PRESET_LIBRARY,
  readDocList,
  validatePresetLibrary,
  WEB_LIBRARY_CAPS,
  type BackupDocument,
  type LibraryCaps,
  type PresetLibrary,
} from './backup.ts';

/**
 * M2 (fase 4b): o arquivo `backup@1` (tecnico.md §14.4): montar com o que o jogo tem e validar o importado. M9 (fase 0):
 * à parte de `backup.ts` (a biblioteca de presets, que o save do menu lê no boot), para o menu da web não levar o
 * validador do backup; quem usa são os Ajustes e o importador da pasta `oficina/`, no pedaço dos editores.
 */

/** Monta o backup com o que o jogo tem agora. */
export function createBackup(
  parts: {
    settings: SettingsDocument;
    stats: StatsDocument;
    bobo: BoboDocument;
    presets: PresetLibrary;
    bots: readonly BotDocument[];
    squads: readonly SquadDocument[];
  },
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
  let bobo = DEFAULT_BOBO;
  if (doc['bobo'] !== undefined) {
    const b = validateBobo(doc['bobo']);
    if (b.ok) {
      bobo = b.value;
      r.warnings.push(...b.warnings);
    } else r.warn('bobo', 'save.droppedEntry', b.errors.map((e) => e.code).join(', '));
  }
  const lib = validatePresetLibrary(doc['presets'], limits, caps);
  if (lib.ok) r.warnings.push(...lib.warnings);
  const bots = readDocList(doc['bots'], 'bots', caps.bots, validateBot, r.warnings);
  const squads = readDocList(doc['squads'], 'squads', caps.squads, validateSquad, r.warnings);
  return {
    ok: true,
    value: {
      format: BACKUP_FORMAT,
      createdAt: r.str(doc, 'createdAt', 'createdAt', '', 40),
      gameVersion: r.str(doc, 'gameVersion', 'gameVersion', '', 32),
      settings,
      stats,
      bobo,
      presets: lib.ok ? lib.value : EMPTY_PRESET_LIBRARY,
      bots,
      squads,
    },
    warnings: r.warnings,
  };
}
