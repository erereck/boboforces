import {
  createBackup,
  issue,
  validateBackup,
  validatePresetLibrary,
  type BackupDocument,
  type ValidationResult,
} from '@boboforces/format';
import { STORAGE_RECIPE_LIMITS, type BackupMode, type SaveStore } from './save-store.ts';

/**
 * M9 (fase 0): exportar, ler e aplicar o `backup@1` em texto (a casca baixa e escolhe o arquivo). Saiu do
 * `save-store.ts` para o pedaço dos editores (os Ajustes e o importador da pasta `oficina/`): o menu da web não paga
 * pelo validador do backup. O save só entrega os documentos e troca todos de uma vez (`SaveStore.replaceAll`).
 */

/** O backup em texto (JSON), para baixar. `createdAt` vem de quem tem relógio (a casca). */
export function exportBackup(save: SaveStore, createdAt: string, gameVersion: string): string {
  const { settings, stats, bobo, presets, bots, squads } = save;
  return JSON.stringify(
    createBackup({ settings, stats, bobo, presets, bots, squads }, createdAt, gameVersion),
    null,
    2,
  );
}

/** Lê um backup (texto do arquivo escolhido): validado nos tetos do save, para o resumo antes de aplicar. */
export function readBackup(save: SaveStore, text: string): ValidationResult<BackupDocument> {
  let doc: unknown;
  try {
    doc = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, errors: [issue('', 'doc.notObject', 'JSON inválido')] };
  }
  return validateBackup(doc, STORAGE_RECIPE_LIMITS, save.caps);
}

/**
 * Aplica um backup lido. `replace` troca tudo; `merge` junta: os presets salvos e os bots do arquivo entram ao lado
 * dos atuais (nome repetido ganha " (2)", bot de id repetido fica o atual), e os ajustes e as estatísticas daqui ficam.
 */
export function applyBackup(save: SaveStore, backup: BackupDocument, mode: BackupMode): void {
  const caps = save.caps;
  if (mode === 'replace') {
    save.replaceAll({
      settings: backup.settings,
      stats: backup.stats,
      bobo: backup.bobo,
      presets: backup.presets,
      bots: backup.bots.slice(0, caps.bots),
      squads: backup.squads.slice(0, caps.squads),
    });
    return;
  }
  const { presets, bots, squads } = save;
  // Juntar: a validação da biblioteca dá nome único aos repetidos e corta no teto.
  const merged = validatePresetLibrary(
    {
      recent: presets.recent,
      saved: [...presets.saved, ...backup.presets.saved],
      favorites: presets.favorites,
      botFavorites: presets.botFavorites,
    },
    STORAGE_RECIPE_LIMITS,
    caps,
  );
  const ids = new Set(bots.map((b) => b.id));
  const squadIds = new Set(squads.map((q) => q.id));
  save.replaceAll({
    settings: save.settings,
    stats: save.stats,
    bobo: save.bobo,
    presets: merged.ok ? merged.value : presets,
    bots: [...bots, ...backup.bots.filter((b) => !ids.has(b.id))].slice(0, caps.bots),
    squads: [...squads, ...backup.squads.filter((q) => !squadIds.has(q.id))].slice(0, caps.squads),
  });
}
