import type { NemesisMemory } from '@boboforces/format';

/**
 * M8 (fase 4): o Nêmesis com memória entre partidas (gameplay.md: "memória entre partidas: só para o Nêmesis"; pergunta
 * Z3 no padrão). O rival é guardado pelo id do documento do bot (vários bots com o mesmo id, como 4 Normal Bobs, contam
 * juntos: o rival é o "tipo"). A IA não muda: só o aviso no começo e a rivalidade no resultado.
 */
export interface MatchBotTally {
  /** O id do documento do bot (`normal-bob`, `jorge-the-immortal` ou o da Oficina). */
  readonly id: string;
  readonly name: string;
  /** Quantas vezes ele pegou o jogador nesta partida, e o jogador a ele. */
  readonly killedYou: number;
  readonly youKilled: number;
}

interface Sum {
  name: string;
  killedYou: number;
  youKilled: number;
}

function sumById(tallies: readonly MatchBotTally[]): Map<string, Sum> {
  const out = new Map<string, Sum>();
  for (const t of tallies) {
    const s = out.get(t.id);
    if (s) {
      s.killedYou += t.killedYou;
      s.youKilled += t.youKilled;
    } else out.set(t.id, { name: t.name, killedYou: t.killedYou, youKilled: t.youKilled });
  }
  return out;
}

/**
 * O rival depois da partida:
 * - estando na partida, o rival soma quantas vezes te pegou e você a ele (e mais uma partida);
 * - o id que mais te pegou nesta partida (somando os bots dele) vira o rival novo se te pegou mais que o de antes nesta
 *   partida (o rival de antes fora dela não segura o lugar).
 */
export function updateNemesis(prev: NemesisMemory | null, tallies: readonly MatchBotTally[]): NemesisMemory | null {
  const byId = sumById(tallies);
  let matchNemesis: string | null = null;
  let most = 0;
  for (const [id, s] of byId) {
    if (s.killedYou > most) {
      most = s.killedYou;
      matchNemesis = id;
    }
  }
  let mem = prev;
  if (mem !== null) {
    const here = byId.get(mem.id);
    if (here) {
      mem = {
        id: mem.id,
        name: here.name || mem.name,
        killedYou: mem.killedYou + here.killedYou,
        youKilled: mem.youKilled + here.youKilled,
        matches: mem.matches + 1,
      };
    }
  }
  if (matchNemesis !== null && (mem === null || matchNemesis !== mem.id)) {
    const cand = byId.get(matchNemesis);
    const current = mem !== null ? (byId.get(mem.id)?.killedYou ?? 0) : -1;
    if (cand && cand.killedYou > 0 && cand.killedYou > current) {
      mem = { id: matchNemesis, name: cand.name, killedYou: cand.killedYou, youKilled: cand.youKilled, matches: 1 };
    }
  }
  return mem;
}

/** O rival estava na partida e já tem história (2 partidas ou mais): o resultado mostra a rivalidade. */
export function showsRivalry(mem: NemesisMemory | null, tallies: readonly MatchBotTally[]): boolean {
  return mem !== null && mem.matches >= 2 && tallies.some((t) => t.id === mem.id);
}
