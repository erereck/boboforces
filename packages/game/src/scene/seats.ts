import type { BotSlotRecipe, MatchRecipe, TeamRecipe } from '@boboforces/format';
import type { DeviceBinding } from '@boboforces/input';
import { isFfaMode } from '@boboforces/sim';

/**
 * M3 (fase 1a): os assentos do sofá. Cada jogador local tem um dispositivo e um lado: com o P1 (coop contra os bots) ou
 * contra ele (versus). O P1 é sempre o controlador 0 e joga no time 0 da receita, porque o resultado, as estatísticas e
 * o Nêmesis falam com ele; quem escolhe "contra" vai para o time 1.
 */
export interface LocalSeat {
  readonly device: DeviceBinding;
  /**
   * 0 = no time do P1; 1 = no time adversário. O do P1 não conta (é sempre 0); no FFA e no treino também não. M9 (fase
   * 3): no Sandbox, o k-ésimo time depois do do P1 (dando a volta).
   */
  readonly side: number;
}

export interface SeatedRecipe {
  readonly recipe: MatchRecipe;
  /** O controlador da sim de cada assento, na ordem dos assentos (o P1 é o 0). */
  readonly controllers: readonly number[];
}

function botCount(bots: readonly BotSlotRecipe[]): number {
  let n = 0;
  for (const b of bots) n += b.count;
  return n;
}

/** Os primeiros `keep` bots da lista (corta do fim, que é onde ficam os de menos importância no preset). */
function keepBots(bots: readonly BotSlotRecipe[], keep: number): BotSlotRecipe[] {
  const out: BotSlotRecipe[] = [];
  let left = keep;
  for (const b of bots) {
    if (left <= 0) break;
    const count = Math.min(b.count, left);
    out.push(count === b.count ? b : { ...b, count });
    left -= count;
  }
  return out;
}

/**
 * Os assentos na receita. Os presets são feitos para 1 humano no time com `humans: 'all'`; com mais gente, cada time
 * mantém o tamanho e os humanos tomam o lugar de bots do próprio time (no FFA, de quaisquer bots). No treino os alvos
 * ficam. Os controladores seguem a ordem da sim (`expandRecipe`): os humanos do time 0 primeiro, depois os do time 1.
 */
export function seatRecipe(recipe: MatchRecipe, seats: readonly LocalSeat[]): SeatedRecipe {
  if (seats.length <= 1) return { recipe, controllers: [0] };
  // M9 (fase 3): o P1 fica no time dos humanos da receita (no Sandbox pode não ser o 0); os outros contam a partir dele.
  const n = Math.max(1, recipe.teams.length);
  const home = Math.max(
    0,
    recipe.teams.findIndex((tm) => (tm.humans ?? 0) !== 0),
  );
  return placeHumans(
    recipe,
    seats.map((s, i) => (i === 0 ? home : (home + s.side) % n)),
  );
}

/**
 * M5 (fase 4b): os humanos na receita pelo time de cada um, na ordem dada: o sofá (o P1 no time dos humanos) e o
 * online (cada um no time que escolheu). No FFA, no treino e nos modos de um time só, todos ficam no 0. M6 (fase 6b): no
 * Bobo Zombies também (na Horda armada o time 1 é só a horda de bots). M9 (fase 3): de 0 a 3 (o Sandbox); um time que a
 * receita não tem vale o 0. Os controladores seguem a ordem da sim (`expandRecipe`): os humanos do time 0, depois os do
 * 1, e assim por diante.
 */
export function placeHumans(recipe: MatchRecipe, chosen: readonly number[]): SeatedRecipe {
  const n = chosen.length;
  const training = recipe.mode === 'training';
  const oneTeam = training || isFfaMode(recipe.mode) || recipe.mode === 'zombies' || recipe.teams.length < 2;
  const sides = chosen.map((s) => (oneTeam || !(s >= 0 && s < recipe.teams.length) ? 0 : s));
  const want = recipe.teams.map(() => 0);
  for (const s of sides) want[s]!++;
  const controllers: number[] = new Array<number>(n);
  let next = 0;
  for (let t = 0; t < recipe.teams.length; t++) for (let i = 0; i < n; i++) if (sides[i] === t) controllers[i] = next++;
  const teams: TeamRecipe[] = recipe.teams.map((team, t) => {
    const before = team.humans === 'all' ? 1 : (team.humans ?? 0);
    const now = want[t]!;
    const bots = training ? team.bots : keepBots(team.bots, Math.max(0, before + botCount(team.bots) - now));
    return { ...team, humans: now, bots };
  });
  return { recipe: { ...recipe, teams }, controllers };
}
