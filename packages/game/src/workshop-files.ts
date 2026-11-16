import {
  BACKUP_FORMAT,
  BOT_FORMAT,
  MATCH_RECIPE_FORMAT,
  validateBot,
  validateMatchRecipe,
  type BotDocument,
  type RecipeLimits,
} from '@boboforces/format';
import type { SaveStore } from './save-store.ts';

/**
 * M4 (fase 2c): os arquivos da pasta `oficina/` do cartão SD (GDD §4.8, tecnico.md §9): bots (`bot@1`), presets
 * (`preset@1`) e o backup que a web exporta (`backup@1`: só os bots e os presets salvos dele) chegam ao Switch pelo
 * cartão. A casca só lista e lê; aqui cada arquivo passa pelo validador
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
/** O backup inteiro da web pode ser maior (até 50 presets e os bots): até 1 MB. */
export const WORKSHOP_BACKUP_MAX_BYTES = 1024 * 1024;

const kindOf = (format: string): string => format.slice(0, format.indexOf('@') + 1);
const BOT_KIND = kindOf(BOT_FORMAT);
const PRESET_KIND = kindOf(MATCH_RECIPE_FORMAT);
const BACKUP_KIND = kindOf(BACKUP_FORMAT);

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
  const codes = (issues: readonly { readonly code: string }[]): string => issues.map((e) => e.code).join(', ');
  /** Um bot validado: entra se o id é novo (a pasta é lida sempre; não passa por cima do que mudou no Switch). */
  const addBot = (bot: BotDocument, file: string): void => {
    if (save.bots.some((b) => b.id === bot.id)) return;
    if (!save.saveBot(bot)) skip(file, `biblioteca de bots cheia (${bot.id})`);
    else bots++;
  };
  /** Um preset: valida contra os tetos do aparelho e entra se o nome é novo. */
  const addPreset = (doc: unknown, file: string): void => {
    const r = validateMatchRecipe(doc, limits);
    if (!r.ok) {
      skip(file, codes(r.errors));
      return;
    }
    const name = presetName(r.value, file);
    if (save.presets.saved.some((p) => p.name === name)) return;
    if (!save.savePreset({ ...r.value, name })) skip(file, `biblioteca de presets cheia (${name})`);
    else {
      presets++;
      if (r.warnings.length > 0) lines.push(`oficina: ${file} entrou com aviso (${codes(r.warnings)})`);
    }
  };
  for (const f of files) {
    if (f.text.length > WORKSHOP_BACKUP_MAX_BYTES) {
      skip(f.name, 'maior que 1 MB');
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
    const kind = format.slice(0, format.indexOf('@') + 1);
    if (kind !== BACKUP_KIND && f.text.length > WORKSHOP_FILE_MAX_BYTES) skip(f.name, 'maior que 64 KB');
    else if (kind === BOT_KIND) {
      const r = validateBot(doc);
      if (!r.ok) skip(f.name, codes(r.errors));
      else addBot(r.value, f.name);
    } else if (kind === PRESET_KIND) addPreset(doc, f.name);
    else if (kind === BACKUP_KIND) {
      // O backup que a web exporta (Ajustes → Dados): os bots e os presets salvos dele, pelas mesmas regras (os
      // ajustes, as estatísticas e o Meu Bobo do Switch ficam como estão).
      const r = save.readBackup(f.text);
      if (!r.ok) skip(f.name, codes(r.errors));
      else {
        for (const b of r.value.bots) addBot(b, f.name);
        for (const p of r.value.presets.saved) addPreset(p, `${f.name}: ${p.name}`);
      }
    } else skip(f.name, format === '' ? 'sem "format"' : `formato ${format}`);
  }
  return { bots, presets, lines };
}
