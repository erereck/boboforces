import { describe, expect, it } from 'vitest';
import { showsRivalry, updateNemesis, type MatchBotTally } from './nemesis.ts';

const tally = (id: string, killedYou: number, youKilled: number, name = id): MatchBotTally => ({
  id,
  name,
  killedYou,
  youKilled,
});

describe('M8 (fase 4): o Nêmesis com memória', () => {
  it('o 1º rival é o id que mais te pegou, somando os bots dele (5 Normal Bobs com 1 cada vencem um Jorge com 2)', () => {
    const bobs = Array.from({ length: 5 }, () => tally('normal-bob', 1, 0));
    expect(updateNemesis(null, [...bobs, tally('jorge', 2, 2)])).toEqual({
      id: 'normal-bob',
      name: 'normal-bob',
      killedYou: 5,
      youKilled: 0,
      matches: 1,
    });
  });

  it('o rival presente soma a partida; ausente, fica como estava', () => {
    const prev = { id: 'jorge', name: 'Jorge', killedYou: 5, youKilled: 2, matches: 2 };
    expect(updateNemesis(prev, [tally('jorge', 1, 3, 'Jorge')])).toEqual({
      ...prev,
      killedYou: 6,
      youKilled: 5,
      matches: 3,
    });
    expect(updateNemesis(prev, [tally('carl', 0, 4)])).toBe(prev);
  });

  it('outro te pegou mais que o rival nesta partida: vira o rival novo; menos ou igual, não', () => {
    const prev = { id: 'jorge', name: 'Jorge', killedYou: 9, youKilled: 1, matches: 4 };
    expect(updateNemesis(prev, [tally('jorge', 1, 0), tally('carl', 3, 0, 'Carl')])).toEqual({
      id: 'carl',
      name: 'Carl',
      killedYou: 3,
      youKilled: 0,
      matches: 1,
    });
    expect(updateNemesis(prev, [tally('jorge', 2, 0), tally('carl', 2, 0)])).toMatchObject({
      id: 'jorge',
      killedYou: 11,
      matches: 5,
    });
    // Sem nenhum abate no jogador, não há Nêmesis.
    expect(updateNemesis(null, [tally('carl', 0, 5)])).toBeNull();
  });

  it('a rivalidade aparece com o rival na partida e 2 partidas ou mais', () => {
    const one = { id: 'jorge', name: 'Jorge', killedYou: 2, youKilled: 0, matches: 1 };
    expect(showsRivalry(one, [tally('jorge', 2, 0)])).toBe(false);
    expect(showsRivalry({ ...one, matches: 2 }, [tally('jorge', 1, 0)])).toBe(true);
    expect(showsRivalry({ ...one, matches: 2 }, [tally('carl', 1, 0)])).toBe(false);
  });
});
