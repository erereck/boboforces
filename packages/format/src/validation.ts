/**
 * Resultado de validação de documentos. Os problemas têm `code` estável: a UI traduz pela tabela de textos (regra 13),
 * nunca mostra `detail` cru ao jogador.
 */
export interface ValidationIssue {
  /** Caminho no documento, ex.: `teams[0].bots[1].count`. */
  readonly path: string;
  /** Código estável, ex.: `format.newerVersion`, `recipe.botsOverPlatformCap`, `content.missingWeapon`. */
  readonly code: string;
  /** Detalhe técnico para log e relatório. */
  readonly detail?: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T; readonly warnings: readonly ValidationIssue[] }
  | { readonly ok: false; readonly errors: readonly ValidationIssue[] };

/** Tetos da plataforma que o validador aplica (regra 19: corta no teto e avisa). */
export interface RecipeLimits {
  readonly maxBots: number;
  readonly maxLocalHumans: number;
  readonly maxViewDistanceM: number;
}

/**
 * Todos os códigos que os validadores do `format` emitem. A UI precisa de uma chave de texto para cada um (o resumo
 * do import mostra o que caiu em fallback). Erro = documento recusado; aviso = documento aceito com ajuste.
 */
export const ISSUE_CODES = [
  // Erros de estrutura e versão
  'doc.notObject',
  'format.missing',
  'format.invalid',
  'format.wrongKind',
  /** "Este bot foi feito numa versão mais nova do BoboForces. Atualize o jogo." */
  'format.newerVersion',
  'format.migrationMissing',
  'format.migrationFailed',
  // Aviso: o documento veio de uma versão antiga e foi migrado
  'format.migrated',
  // Conteúdo (tecnico.md §14.5): modo e mapa ausentes recusam; o resto cai em fallback com aviso
  'content.missingMode',
  'content.missingMap',
  'content.missingBot',
  'content.missingMovement',
  'content.missingWeapon',
  'content.missingBlock',
  'content.missingLook',
  'content.retired',
  // Receita de partida
  'recipe.noTeams',
  'recipe.invalidField',
  'recipe.valueClamped',
  'recipe.seedMissing',
  'recipe.tooManyTeams',
  'recipe.tooManyBotEntries',
  'recipe.duplicateAllHumans',
  'recipe.botsOverPlatformCap',
  'recipe.humansOverPlatformCap',
  'recipe.viewDistanceOverPlatformCap',
] as const;

export type IssueCode = (typeof ISSUE_CODES)[number];

/** Monta um problema sem deixar `detail: undefined` (exactOptionalPropertyTypes). */
export function issue(path: string, code: IssueCode, detail?: string): ValidationIssue {
  return detail === undefined ? { path, code } : { path, code, detail };
}

/** Objeto JSON comum (não array, não null). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Campos que o validador não conhece, para manter ao regravar (tecnico.md §14.5: "ignorados e mantidos quando
 * possível"). Cópia rasa: o valor de cada campo desconhecido é o mesmo objeto do documento de entrada.
 */
export function unknownFields(src: Record<string, unknown>, known: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src)) {
    if (!known.includes(key)) out[key] = src[key];
  }
  return out;
}

/** Cópia profunda de JSON solto (objetos, arrays e primitivos). Sem `structuredClone`, que não é ES puro. */
export function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v: unknown) => cloneJson(v)) as T;
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) out[key] = cloneJson(value[key]);
    return out as T;
  }
  return value;
}
