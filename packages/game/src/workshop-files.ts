import {
  BOT_FORMAT,
  MATCH_RECIPE_FORMAT,
  validateBot,
  validateMatchRecipe,
  type RecipeLimits,
} from '@boboforces/format';
import type { SaveStore } from './save-store.ts';

/**
 * M4 (fase 2c): os arquivos da pasta `oficina/` do cartão SD (GDD §4.8, tecnico.md §9): bots (`bot@1`) e presets
 * (`preset@1`) feitos no PC chegam ao Switch pelo cartão. A casca só lista e lê; aqui cada arquivo passa pelo validador
 * do `format` e entra na biblioteca sem passar por cima do que já existe (bot pelo id, preset pelo nome): assim ler a
 * pasta a cada abertura não duplica nada. O que não entra fica numa linha do registro com a razão.
 */
export interface WorkshopFile {
  /** O nome do arquivo (sem a pasta). */
  readonly name: string;
  readonly text: string;
}

export interface WorkshopImport {
  readonly bots: number;
  readonly presets: number;
  /** Uma linha por arquivo que não entrou (ou que entrou com aviso), para o registro. */
  readonly lines: readonly string[];
}

/** Teto de um arquivo da pasta (o mesmo do GDD §4.8 para preset e bot). */
export const WORKSHOP_FILE_MAX_BYTES = 64 * 1024;

function formatOf(doc: unknown): string {
  return doc !== null && typeof doc === 'object' && 'format' in doc && typeof doc.format === 'string' ? doc.format : '';
}

/** O nome do preset: o do documento ou, sem ele, o do arquivo (sem a extensão), até 24 caracteres. */
function presetName(doc: { readonly name?: string }, file: string): string {
  const name = (doc.name ?? '').trim() || file.replace(/\.json$/i, '');
  return name.slice(0, 24);
}

export function importWorkshopFiles(
  files: readonly WorkshopFile[],
  save: SaveStore,
  limits: RecipeLimits,
): WorkshopImport {
  let bots = 0;
  let presets = 0;
  const lines: string[] = [];
  const skip = (file: string, why: string): void => void lines.push(`oficina: ${file} ignorado (${why})`);
  for (const f of files) {
    if (f.text.length > WORKSHOP_FILE_MAX_BYTES) {
      skip(f.name, 'maior que 64 KB');
      continue;
    }
    let doc: unknown;
    try {
      doc = JSON.parse(f.text);
    } catch {
      skip(f.name, 'não é JSON');
      continue;
    }
    const format = formatOf(doc);
    if (format.startsWith(BOT_FORMAT.slice(0, BOT_FORMAT.indexOf('@') + 1))) {
      const r = validateBot(doc);
      if (!r.ok) skip(f.name, r.errors.map((e) => e.code).join(', '));
      else if (save.bots.some((b) => b.id === r.value.id))
        continue; // já na biblioteca (a pasta é lida sempre)
      else if (!save.saveBot(r.value)) skip(f.name, 'biblioteca de bots cheia');
      else bots++;
    } else if (format.startsWith(MATCH_RECIPE_FORMAT.slice(0, MATCH_RECIPE_FORMAT.indexOf('@') + 1))) {
      const r = validateMatchRecipe(doc, limits);
      if (!r.ok) {
        skip(f.name, r.errors.map((e) => e.code).join(', '));
        continue;
      }
      const name = presetName(r.value, f.name);
      if (save.presets.saved.some((p) => p.name === name)) continue;
      if (!save.savePreset({ ...r.value, name })) skip(f.name, 'biblioteca de presets cheia');
      else {
        presets++;
        if (r.warnings.length > 0) {
          lines.push(`oficina: ${f.name} entrou com aviso (${r.warnings.map((w) => w.code).join(', ')})`);
        }
      }
    } else skip(f.name, format === '' ? 'sem "format"' : `formato ${format}`);
  }
  return { bots, presets, lines };
}
