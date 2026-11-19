import { validateBot, type BotDocument } from './bot.ts';
import { DocReader } from './doc-read.ts';
import { formatId, type FormatId } from './format-id.ts';
import { isValidContentLocal, resolveContent } from './content-ids.ts';
import { FALLBACK_BOT_REF, type BotRef, type BotSlotRecipe } from './match-recipe.ts';
import { migrateDocument } from './migrations.ts';
import type { ValidationResult } from './validation.ts';

/**
 * M8 (fase 2): o esquadrão (GDD §4.4.3, gameplay.md "Oficina"): um grupo de bots com nome ("The Jorges", 6 bots),
 * reaproveitável nos times da Partida personalizada e base do Bobo War Sim. No save, as entradas apontam para os bots
 * de fábrica (`builtin:`) e para os da Oficina (`embedded:<id>`, resolvidos na hora de usar); no código (`BFS1-`), os
 * da Oficina vão junto em `embeddedBots`, para quem recebe não precisar deles.
 */
export const SQUAD_FORMAT: FormatId = formatId('squad');

export const SQUAD_LIMITS = {
  nameLength: 24,
  /** Bots diferentes num esquadrão. */
  entries: 8,
  /** Quantos de cada um. */
  count: 16,
  /** Esquadrões salvos (web e Switch, como os presets: gameplay.md §10.4). */
  saved: 100,
  savedSwitch: 30,
} as const;

export interface SquadDocument {
  readonly format: FormatId;
  readonly id: string;
  readonly name: string;
  /** Até 8 entradas (o bot e quantos), cada uma de 1 a 16. */
  readonly bots: readonly BotSlotRecipe[];
  /** Os bots da Oficina que ele usa (só no código: no save, eles moram na Oficina). */
  readonly embeddedBots?: readonly BotDocument[];
}

const REF_RE = /^(builtin|embedded):[a-z0-9][a-z0-9._-]{0,47}$/;
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,47}$/;

/** O bot de fábrica que não existe vira o Normal Bob (o aposentado, o substituto), como no preset. */
function knownRef(ref: BotRef, path: string, r: DocReader): BotRef {
  if (!ref.startsWith('builtin:')) return ref;
  const local = ref.slice('builtin:'.length);
  const c = isValidContentLocal(local) ? resolveContent('bot', local) : null;
  if (c !== null && (c.status === 'known' || c.status === 'retired')) return `builtin:${c.local}`;
  r.warn(path, 'content.missingBot', ref);
  return FALLBACK_BOT_REF;
}

/** Valida um `squad@1`: o nome com teto, as entradas válidas (a que não passa sai com aviso) e os embutidos. */
export function validateSquad(input: unknown): ValidationResult<SquadDocument> {
  const migrated = migrateDocument(input, 'squad');
  if (!migrated.ok) return migrated;
  const doc = migrated.value;
  const r = new DocReader('save.invalidField', 'save.valueClamped');
  r.warnings.push(...migrated.warnings);
  const rawId = typeof doc['id'] === 'string' ? doc['id'] : '';
  const id = ID_RE.test(rawId) ? rawId : 'squad';
  if (rawId !== id) r.warn('id', 'save.invalidField');
  const name = r.str(doc, 'name', 'name', '', SQUAD_LIMITS.nameLength).trim();
  const bots: BotSlotRecipe[] = [];
  const raw = doc['bots'];
  if (!Array.isArray(raw)) r.warn('bots', 'save.invalidField');
  else {
    for (let i = 0; i < raw.length; i++) {
      if (bots.length === SQUAD_LIMITS.entries) {
        r.warn('bots', 'save.valueClamped', `${raw.length} → ${SQUAD_LIMITS.entries}`);
        break;
      }
      const e = raw[i] as { ref?: unknown; count?: unknown } | null;
      const ref = typeof e?.ref === 'string' && REF_RE.test(e.ref) ? (e.ref as BotRef) : null;
      const n = typeof e?.count === 'number' && Number.isFinite(e.count) ? Math.round(e.count) : 0;
      if (ref === null || n < 1) {
        r.warn(`bots[${i}]`, 'save.droppedEntry');
        continue;
      }
      if (n > SQUAD_LIMITS.count) r.warn(`bots[${i}].count`, 'save.valueClamped');
      bots.push({ ref: knownRef(ref, `bots[${i}].ref`, r), count: Math.min(n, SQUAD_LIMITS.count) });
    }
  }
  const embedded: BotDocument[] = [];
  const rawEmbedded = doc['embeddedBots'];
  if (Array.isArray(rawEmbedded)) {
    for (let i = 0; i < rawEmbedded.length && embedded.length < SQUAD_LIMITS.entries; i++) {
      const b = validateBot(rawEmbedded[i]);
      if (b.ok) embedded.push(b.value);
      else r.warn(`embeddedBots[${i}]`, 'save.droppedEntry');
    }
  }
  return {
    ok: true,
    value: { format: SQUAD_FORMAT, id, name, bots, ...(embedded.length > 0 ? { embeddedBots: embedded } : {}) },
    warnings: r.warnings,
  };
}

/** Quantos bots o esquadrão põe no time. */
export function squadSize(squad: SquadDocument): number {
  let n = 0;
  for (const b of squad.bots) n += b.count;
  return n;
}
