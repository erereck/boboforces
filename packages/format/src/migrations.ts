import { CURRENT_FORMAT_VERSION, formatId, parseFormatId, type FormatKind } from './format-id.ts';
import { cloneJson, isPlainObject, issue, type ValidationIssue, type ValidationResult } from './validation.ts';

/**
 * Leva um documento de `@n` para `@n+1`. Recebe uma CÓPIA do documento (pode mexer à vontade) e devolve JSON solto;
 * campos que a migração não conhece devem continuar no resultado. O campo `format` é reescrito depois de cada passo:
 * a migração não precisa tocar nele.
 */
export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/** `MIGRATIONS[tipo][n - 1]` migra de `@n` para `@n+1`. Vazio no M0: todos os formatos estão no @1. */
export const MIGRATIONS: Readonly<Partial<Record<FormatKind, readonly Migration[]>>> = {};

/** Para testes e ferramentas: outra tabela de migrações ou outra versão atual. */
export interface MigrateOptions {
  readonly migrations?: Readonly<Partial<Record<FormatKind, readonly Migration[]>>>;
  readonly currentVersion?: number;
}

/**
 * Lê o `format`, recusa versão maior que a atual (`format.newerVersion`), aplica as migrações até a atual e devolve o
 * documento pronto para o validador do tipo. Documento já na versão atual volta sem cópia; migrado volta como cópia
 * (o de entrada nunca é alterado) e com o aviso `format.migrated`.
 */
export function migrateDocument(
  doc: unknown,
  expected: FormatKind,
  options: MigrateOptions = {},
): ValidationResult<Record<string, unknown>> {
  if (!isPlainObject(doc)) return { ok: false, errors: [issue('', 'doc.notObject')] };
  if (!('format' in doc)) return { ok: false, errors: [issue('format', 'format.missing')] };
  const parsed = parseFormatId(doc['format']);
  if (!parsed) return { ok: false, errors: [issue('format', 'format.invalid', String(doc['format']))] };
  if (parsed.kind !== expected) {
    return { ok: false, errors: [issue('format', 'format.wrongKind', `esperado ${expected}, veio ${parsed.kind}`)] };
  }
  const current = options.currentVersion ?? CURRENT_FORMAT_VERSION[expected];
  if (parsed.version > current) {
    return {
      ok: false,
      errors: [issue('format', 'format.newerVersion', `${expected}@${parsed.version} > ${expected}@${current}`)],
    };
  }
  if (parsed.version === current) return { ok: true, value: doc, warnings: [] };

  const chain = (options.migrations ?? MIGRATIONS)[expected] ?? [];
  let value = cloneJson(doc);
  for (let v = parsed.version; v < current; v++) {
    const step = chain[v - 1];
    if (!step) {
      return { ok: false, errors: [issue('format', 'format.migrationMissing', `${expected}@${v} → @${v + 1}`)] };
    }
    try {
      value = step(value);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      return { ok: false, errors: [issue('format', 'format.migrationFailed', `${expected}@${v} → @${v + 1}: ${why}`)] };
    }
    if (!isPlainObject(value)) {
      return { ok: false, errors: [issue('format', 'format.migrationFailed', `${expected}@${v} → @${v + 1}`)] };
    }
    value['format'] = formatId(expected, v + 1);
  }
  const warnings: ValidationIssue[] = [
    issue('format', 'format.migrated', `${expected}@${parsed.version} → @${current}`),
  ];
  return { ok: true, value, warnings };
}
