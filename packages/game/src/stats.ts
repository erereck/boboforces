import {
  STATS_RANGES,
  type StatsDocument,
  type StatsTotals,
  type ValidationIssue,
  type ZombieWaveRecord,
} from '@boboforces/format';
import type { MatchRecord, RecordBreaks } from './scene-api.ts';

/**
 * M2 (fase 4g): as estatísticas e os recordes do aparelho (gameplay.md §9: nada libera nada) e a Novidades
 * (arte-ux.md §6.12). Puro: o `game` grava o documento que sai daqui.
 */

/** Teto de cada contador (o save guarda inteiros; nada passa disto nem com anos de jogo). */
const COUNT_MAX = 2_000_000_000;

const add = (a: number, b: number): number => Math.min(COUNT_MAX, a + Math.max(0, Math.round(b)));

/**
 * Soma a partida. Recorde só conta depois da primeira partida (a primeira marca a base, sem "Recorde!" por 2 abates)
 * e só com mais de zero. Em tela dividida os totais já chegam somados e o recorde é do melhor jogador (rodada 8, D5).
 */
export function addMatch(doc: StatsDocument, m: MatchRecord): { doc: StatsDocument; records: RecordBreaks } {
  const o = doc.totals;
  const totals: StatsTotals = {
    matches: add(o.matches, 1),
    wins: add(o.wins, m.outcome === 'win' ? 1 : 0),
    losses: add(o.losses, m.outcome === 'loss' ? 1 : 0),
    draws: add(o.draws, m.outcome === 'draw' ? 1 : 0),
    kills: add(o.kills, m.kills),
    deaths: add(o.deaths, m.deaths),
    assists: add(o.assists, m.assists),
    shots: add(o.shots, m.shots),
    hits: add(o.hits, m.hits),
    headshots: add(o.headshots, m.headshots),
    playTimeS: add(o.playTimeS, m.playTimeS),
  };
  const veteran = o.matches > 0;
  const previousWave = m.zombies !== undefined ? zombieRecord(doc, m.zombies.key) : 0;
  const records: RecordBreaks = {
    mostKills: veteran && m.bestKills > 0 && m.bestKills > doc.records.mostKills,
    bestStreak: veteran && m.bestStreak > 0 && m.bestStreak > doc.records.bestStreak,
    zombieWave: m.zombies !== undefined && previousWave > 0 && m.zombies.wave > previousWave,
  };
  return {
    doc: {
      ...doc,
      totals,
      records: {
        mostKills: Math.max(doc.records.mostKills, m.bestKills),
        bestStreak: Math.max(doc.records.bestStreak, m.bestStreak),
        zombieWaves:
          m.zombies !== undefined ? withZombieWave(doc, m.zombies.key, m.zombies.wave) : doc.records.zombieWaves,
      },
    },
    records,
  };
}

/** M3 (fase 6a): a onda máxima de uma configuração do Bobo Zombies (0 = nunca jogou nela). */
export function zombieRecord(doc: StatsDocument, key: string): number {
  return doc.records.zombieWaves.find((r) => r.key === key)?.wave ?? 0;
}

/** O recorde `key` vai para o fim (o mais recente) com a maior onda; a lista tem teto e o mais antigo sai. */
function withZombieWave(doc: StatsDocument, key: string, wave: number): ZombieWaveRecord[] {
  const best = Math.min(STATS_RANGES.maxWave, Math.max(zombieRecord(doc, key), Math.max(0, Math.round(wave))));
  const rest = doc.records.zombieWaves.filter((r) => r.key !== key);
  return [...rest, { key, wave: best }].slice(-STATS_RANGES.zombieRecords);
}

// M9 (fase 0): as linhas em texto da aba Dados (`statsLines`, `playTimeText`, `bestZombieWave`) foram para o
// `stats-lines.ts`, com os Ajustes, no pedaço dos editores.

/**
 * A Novidades desta versão: `show` = mostrar no boot (já tinha jogado e ainda não viu esta); `silent` = instalação nova
 * (marca como vista, sem tela); `none` = já viu.
 */
export function newsOnBoot(doc: StatsDocument, version: string): 'show' | 'silent' | 'none' {
  if (doc.onboarding.seenNews === version) return 'none';
  return doc.totals.matches > 0 || doc.onboarding.seenNews !== '' ? 'show' : 'silent';
}

export function markNewsSeen(doc: StatsDocument, version: string): StatsDocument {
  return doc.onboarding.seenNews === version ? doc : { ...doc, onboarding: { ...doc.onboarding, seenNews: version } };
}

/** M2 (fase 4h): a dica `id` já apareceu (a lista tem teto; a mais antiga sai). */
export function markTipSeen(doc: StatsDocument, id: string): StatsDocument {
  const seen = doc.onboarding.tipsSeen;
  if (seen.includes(id)) return doc;
  const next = [...seen, id].slice(-STATS_RANGES.tips);
  return { ...doc, onboarding: { ...doc.onboarding, tipsSeen: next } };
}

/** Quantos documentos do save vieram de um formato antigo e foram atualizados ao carregar. */
export function migratedCount(warnings: readonly ValidationIssue[]): number {
  let n = 0;
  for (const w of warnings) if (w.code === 'format.migrated') n++;
  return n;
}
