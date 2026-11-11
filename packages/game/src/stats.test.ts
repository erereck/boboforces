import { EMPTY_STATS, issue, STATS_RANGES } from '@boboforces/format';
import { describe, expect, it } from 'vitest';
import type { MatchRecord } from './scene-api.ts';
import {
  addMatch,
  bestZombieWave,
  markNewsSeen,
  markTipSeen,
  migratedCount,
  newsOnBoot,
  playTimeText,
  statsLines,
  zombieRecord,
} from './stats.ts';

/** M2, fase 4g: estatísticas e recordes do aparelho, e quando a Novidades aparece. */

const match = (m: Partial<MatchRecord> = {}): MatchRecord => ({
  outcome: 'win',
  kills: 5,
  deaths: 2,
  assists: 1,
  shots: 40,
  hits: 10,
  headshots: 3,
  bestStreak: 3,
  playTimeS: 312,
  ...m,
  bestKills: m.bestKills ?? m.kills ?? 5,
});

describe('estatísticas', () => {
  it('soma a partida; a primeira só marca a base; recorde é passar o anterior', () => {
    const first = addMatch(EMPTY_STATS, match());
    expect(first.records).toEqual({ mostKills: false, bestStreak: false, zombieWave: false });
    expect(first.doc.totals).toMatchObject({ matches: 1, wins: 1, kills: 5, headshots: 3, playTimeS: 312 });
    expect(first.doc.records).toEqual({ mostKills: 5, bestStreak: 3, zombieWaves: [] });
    const second = addMatch(first.doc, match({ outcome: 'loss', kills: 6, bestStreak: 3 }));
    expect(second.records).toEqual({ mostKills: true, bestStreak: false, zombieWave: false });
    expect(second.doc.totals).toMatchObject({ matches: 2, wins: 1, losses: 1, kills: 11 });
    const third = addMatch(second.doc, match({ outcome: 'draw', kills: 0, bestStreak: 4 }));
    expect(third.records).toEqual({ mostKills: false, bestStreak: true, zombieWave: false });
    expect(third.doc.totals.draws).toBe(1);
    expect(third.doc.records).toEqual({ mostKills: 6, bestStreak: 4, zombieWaves: [] });
  });

  it('rodada 8 (D5): tela dividida soma os abates, mas o recorde é do melhor jogador', () => {
    const first = addMatch(EMPTY_STATS, match({ kills: 10, bestKills: 6 }));
    expect([first.doc.totals.kills, first.doc.records.mostKills]).toEqual([10, 6]);
    const second = addMatch(first.doc, match({ kills: 12, bestKills: 7 }));
    expect([second.doc.totals.kills, second.records.mostKills]).toEqual([22, true]);
  });

  it('M3 (fase 6a): recorde de onda por configuração; a primeira partida nela só marca a base', () => {
    const z = (key: string, wave: number): MatchRecord =>
      match({ kills: 40, bestKills: 0, bestStreak: 0, zombies: { key, wave } });
    const first = addMatch(EMPTY_STATS, z('base|p1', 6));
    expect(first.records.zombieWave).toBe(false);
    expect(zombieRecord(first.doc, 'base|p1')).toBe(6);
    const lower = addMatch(first.doc, z('base|p1', 4));
    expect([lower.records.zombieWave, zombieRecord(lower.doc, 'base|p1')]).toEqual([false, 6]);
    const higher = addMatch(lower.doc, z('base|p1', 9));
    expect([higher.records.zombieWave, zombieRecord(higher.doc, 'base|p1')]).toEqual([true, 9]);
    // Outra configuração (2 jogadores) começa do zero e não mexe na primeira.
    const duo = addMatch(higher.doc, z('base|p2', 3));
    expect([duo.records.zombieWave, zombieRecord(duo.doc, 'base|p2'), zombieRecord(duo.doc, 'base|p1')]).toEqual([
      false,
      3,
      9,
    ]);
    // O Zombies não mexe nos recordes de abates e de sequência.
    expect(duo.doc.records.mostKills).toBe(0);
    expect(bestZombieWave(duo.doc)).toEqual({ wave: 9, map: 'base' });
    expect(statsLines(duo.doc).at(-1)).toBe('Melhor onda no Bobo Zombies: 9 (Base Abandonada)');
  });

  it('M3 (fase 6a): a lista de recordes de onda tem teto; sai o mais antigo', () => {
    let doc = EMPTY_STATS;
    for (let i = 0; i < STATS_RANGES.zombieRecords + 3; i++)
      doc = addMatch(doc, match({ zombies: { key: `k${i}`, wave: 1 } })).doc;
    expect(doc.records.zombieWaves).toHaveLength(STATS_RANGES.zombieRecords);
    expect(zombieRecord(doc, 'k0')).toBe(0);
    expect(zombieRecord(doc, `k${STATS_RANGES.zombieRecords + 2}`)).toBe(1);
  });

  it('as linhas da aba Dados e o tempo jogado', () => {
    expect(statsLines(EMPTY_STATS)).toEqual(['Nenhuma partida terminada ainda.']);
    const doc = addMatch(EMPTY_STATS, match({ playTimeS: 4320 })).doc;
    expect(statsLines(doc)).toEqual([
      'Partidas 1 · Vitórias 1 · Abates 5 · Mortes 2',
      'Precisão 25% · Na cabeça 3 · Tempo de jogo 1 h 12 min',
      'Recordes: abates numa partida 5 · sequência 3',
    ]);
    expect(playTimeText(30)).toBe('menos de 1 min');
    expect(playTimeText(35 * 60)).toBe('35 min');
  });

  it('Novidades: só para quem já jogava e ainda não viu esta versão; instalação nova só marca', () => {
    expect(newsOnBoot(EMPTY_STATS, '0.0.1')).toBe('silent');
    const played = addMatch(EMPTY_STATS, match()).doc;
    expect(newsOnBoot(played, '0.0.1')).toBe('show');
    const seen = markNewsSeen(played, '0.0.1');
    expect(newsOnBoot(seen, '0.0.1')).toBe('none');
    expect(markNewsSeen(seen, '0.0.1')).toBe(seen);
    // Viu a anterior e atualizou: mostra, mesmo sem partida terminada.
    expect(newsOnBoot(markNewsSeen(EMPTY_STATS, '0.0.0'), '0.0.1')).toBe('show');
    expect(migratedCount([issue('bots[0].format', 'format.migrated'), issue('x', 'save.valueClamped')])).toBe(1);
  });

  it('dica vista entra uma vez na lista do onboarding', () => {
    const a = markTipSeen(EMPTY_STATS, 'reload');
    expect(a.onboarding.tipsSeen).toEqual(['reload']);
    expect(markTipSeen(a, 'reload')).toBe(a);
  });
});
