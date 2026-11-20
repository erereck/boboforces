import type { StatsDocument, ZombieWaveRecord } from '@boboforces/format';
import { t } from '@boboforces/ui';
import { mapName } from './maps.ts';

/**
 * M2 (fase 4g): as estatísticas e os recordes em texto, para a aba Dados dos Ajustes. M9 (fase 0): saiu do `stats.ts`
 * junto com os Ajustes, para o pedaço dos editores (o menu da web só soma e marca; quem mostra chega depois).
 */

/** M3 (fase 6a): a maior onda de todas as configurações e o mapa dela (`null` = nunca jogou o Bobo Zombies). */
export function bestZombieWave(doc: StatsDocument): { readonly wave: number; readonly map: string } | null {
  let best: ZombieWaveRecord | null = null;
  for (const r of doc.records.zombieWaves) if (best === null || r.wave > best.wave) best = r;
  return best === null || best.wave === 0 ? null : { wave: best.wave, map: best.key.split('|')[0] ?? '' };
}

/** "1 h 12 min", "35 min", "menos de 1 min". */
export function playTimeText(seconds: number): string {
  const min = Math.floor(seconds / 60);
  if (min < 1) return t('stats.lessThanMinute');
  const h = Math.floor(min / 60);
  return h > 0 ? t('stats.hours', { h, m: min % 60 }) : t('stats.minutes', { m: min });
}

/** As linhas da aba Dados: totais, precisão e tempo; recordes. Sem partida, uma linha só. */
export function statsLines(doc: StatsDocument): string[] {
  const s = doc.totals;
  if (s.matches === 0) return [t('stats.none')];
  const accuracy = s.shots > 0 ? Math.round((Math.min(s.hits, s.shots) * 100) / s.shots) : 0;
  const zombies = bestZombieWave(doc);
  return [
    t('stats.totals', { matches: s.matches, wins: s.wins, kills: s.kills, deaths: s.deaths }),
    t('stats.more', { accuracy, heads: s.headshots, time: playTimeText(s.playTimeS) }),
    t('stats.records', { kills: doc.records.mostKills, streak: doc.records.bestStreak }),
    // M3 (fase 6a): a melhor onda do Bobo Zombies (de qualquer configuração).
    ...(zombies !== null ? [t('stats.zombies', { wave: zombies.wave, map: mapName(zombies.map) })] : []),
  ];
}
