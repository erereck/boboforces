import { DocReader } from './doc-read.ts';
import { formatId, type FormatId } from './format-id.ts';
import { migrateDocument } from './migrations.ts';
import type { ValidationResult } from './validation.ts';

/**
 * M2 (fase 4b): `stats@1` (tecnico.md §14.2): estatísticas e recordes do aparelho, sem progressão (#16), e o que o
 * onboarding precisa lembrar (as dicas já mostradas e a última Novidades vista). O `game` soma uma partida no fim de
 * cada uma (fase 4g).
 */
export const STATS_FORMAT: FormatId = formatId('stats');

export interface StatsTotals {
  readonly matches: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly kills: number;
  readonly deaths: number;
  readonly assists: number;
  readonly shots: number;
  readonly hits: number;
  readonly headshots: number;
  /** Tempo jogado, em segundos inteiros. */
  readonly playTimeS: number;
}

export interface StatsRecords {
  /** Mais abates numa partida e a maior sequência sem morrer. */
  readonly mostKills: number;
  readonly bestStreak: number;
}

export interface StatsOnboarding {
  /** Ids das dicas de 1 linha já mostradas (gameplay.md §2.5: cada uma no máximo 1 vez). */
  readonly tipsSeen: readonly string[];
  /** Versão cuja tela de Novidades já foi vista (`''` = nenhuma). */
  readonly seenNews: string;
}

export interface StatsDocument {
  readonly format: FormatId;
  readonly totals: StatsTotals;
  readonly records: StatsRecords;
  readonly onboarding: StatsOnboarding;
}

export const STATS_RANGES = { tips: 32, tipLength: 40, versionLength: 32 } as const;

export const EMPTY_STATS: StatsDocument = {
  format: STATS_FORMAT,
  totals: {
    matches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    shots: 0,
    hits: 0,
    headshots: 0,
    playTimeS: 0,
  },
  records: { mostKills: 0, bestStreak: 0 },
  onboarding: { tipsSeen: [], seenNews: '' },
};

const TOTAL_KEYS = [
  'matches',
  'wins',
  'losses',
  'draws',
  'kills',
  'deaths',
  'assists',
  'shots',
  'hits',
  'headshots',
  'playTimeS',
] as const satisfies readonly (keyof StatsTotals)[];

/** Valida e completa um `stats@1`: contadores inteiros ≥ 0; o que falta é zero; tipo errado vira zero com aviso. */
export function validateStats(input: unknown): ValidationResult<StatsDocument> {
  const migrated = migrateDocument(input, 'stats');
  if (!migrated.ok) return migrated;
  const doc = migrated.value;
  const r = new DocReader('save.invalidField', 'save.valueClamped');
  r.warnings.push(...migrated.warnings);
  const t = r.obj(doc, 'totals', 'totals');
  const totals = {} as Record<(typeof TOTAL_KEYS)[number], number>;
  for (const k of TOTAL_KEYS) totals[k] = r.count(t, k, `totals.${k}`);
  const rec = r.obj(doc, 'records', 'records');
  const o = r.obj(doc, 'onboarding', 'onboarding');
  const S = STATS_RANGES;
  return {
    ok: true,
    value: {
      format: STATS_FORMAT,
      totals,
      records: {
        mostKills: r.count(rec, 'mostKills', 'records.mostKills'),
        bestStreak: r.count(rec, 'bestStreak', 'records.bestStreak'),
      },
      onboarding: {
        tipsSeen: r.strings(o, 'tipsSeen', 'onboarding.tipsSeen', S.tips, S.tipLength),
        seenNews: r.str(o, 'seenNews', 'onboarding.seenNews', '', S.versionLength),
      },
    },
    warnings: r.warnings,
  };
}
