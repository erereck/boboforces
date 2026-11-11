import { DocReader } from './doc-read.ts';
import { ZOMBIES_DEFAULTS, type MatchRecipe } from './match-recipe.ts';
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
  /**
   * M3 (fase 6a): a onda máxima do Bobo Zombies por mapa, configuração e jogadores locais (gameplay.md §9), do mais
   * antigo ao mais recente (a lista tem teto; o mais antigo sai).
   */
  readonly zombieWaves: readonly ZombieWaveRecord[];
}

/** M3 (fase 6a): um recorde de onda; `key` sai de `zombieRecordKey`. */
export interface ZombieWaveRecord {
  readonly key: string;
  readonly wave: number;
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

export const STATS_RANGES = {
  tips: 32,
  tipLength: 40,
  versionLength: 32,
  // M3 (fase 6a): recordes de onda do Bobo Zombies.
  zombieRecords: 64,
  zombieKeyLength: 96,
  maxWave: 9999,
} as const;

/**
 * M3 (fase 6a): a chave do recorde de onda (gameplay.md §9, "por mapa e configuração"): o mapa, as regras do modo que
 * mudam a dificuldade (padrões preenchidos, para a receita sem o bloco e a com os padrões darem a mesma chave) e os
 * jogadores locais (4 no sofá não apaga o recorde solo). Ex.: `base|w10|q1|h1|v1|s11|e1|r3|p1`.
 */
export function zombieRecordKey(recipe: MatchRecipe, players: number): string {
  const z = recipe.zombies ?? {};
  const D = ZOMBIES_DEFAULTS;
  const flags = `${(z.specials ?? D.specials) ? 1 : 0}${(z.bosses ?? D.bosses) ? 1 : 0}`;
  return [
    recipe.map,
    `w${z.waves ?? D.waves}`,
    `q${z.quantity ?? D.quantity}`,
    `h${z.hpMul ?? D.hpMul}`,
    `v${z.speed ?? D.speed}`,
    `s${flags}`,
    `e${z.economy ?? D.economy}`,
    `r${z.selfRevives ?? D.selfRevives}`,
    `p${Math.max(1, Math.round(players))}`,
  ]
    .join('|')
    .slice(0, STATS_RANGES.zombieKeyLength);
}

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
  records: { mostKills: 0, bestStreak: 0, zombieWaves: [] },
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
        zombieWaves: readZombieWaves(r, rec),
      },
      onboarding: {
        tipsSeen: r.strings(o, 'tipsSeen', 'onboarding.tipsSeen', S.tips, S.tipLength),
        seenNews: r.str(o, 'seenNews', 'onboarding.seenNews', '', S.versionLength),
      },
    },
    warnings: r.warnings,
  };
}

/** M3 (fase 6a): os recordes de onda; item torto sai com aviso, chave repetida fica a de onda maior. */
function readZombieWaves(r: DocReader, rec: Record<string, unknown>): ZombieWaveRecord[] {
  const v = rec['zombieWaves'];
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    r.warn('records.zombieWaves', 'save.invalidField');
    return [];
  }
  const S = STATS_RANGES;
  const out: ZombieWaveRecord[] = [];
  for (const item of v) {
    const ok =
      typeof item === 'object' &&
      item !== null &&
      typeof (item as { key?: unknown }).key === 'string' &&
      typeof (item as { wave?: unknown }).wave === 'number';
    const key = ok ? (item as { key: string }).key : '';
    const wave = ok ? (item as { wave: number }).wave : -1;
    if (!ok || key.length === 0 || key.length > S.zombieKeyLength || !Number.isInteger(wave) || wave < 0) {
      r.warn('records.zombieWaves', 'save.invalidField');
      continue;
    }
    const at = out.findIndex((x) => x.key === key);
    const best = Math.min(S.maxWave, Math.max(wave, at >= 0 ? out[at]!.wave : 0));
    if (at >= 0) out.splice(at, 1);
    out.push({ key, wave: best });
  }
  return out.slice(-S.zombieRecords);
}
