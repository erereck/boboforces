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
  /** 0 = no time do P1; 1 = no time adversário. O do P1 não conta (é sempre 0); no FFA e no treino também não. */
  readonly side: 0 | 1;
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
  const n = seats.length;
  if (n <= 1) return { recipe, controllers: [0] };
  const training = recipe.mode === 'training';
  const oneTeam = training || isFfaMode(recipe.mode) || recipe.teams.length < 2;
  const sides = seats.map((s, i) => (i === 0 || oneTeam ? 0 : s.side));
  const want = [0, 0];
  for (const s of sides) want[s]!++;
  const controllers: number[] = new Array<number>(n);
  let next = 0;
  for (let i = 0; i < n; i++) if (sides[i] === 0) controllers[i] = next++;
  for (let i = 0; i < n; i++) if (sides[i] === 1) controllers[i] = next++;
  const teams: TeamRecipe[] = recipe.teams.map((team, t) => {
    const before = team.humans === 'all' ? 1 : (team.humans ?? 0);
    const now = t < 2 ? want[t]! : 0;
    const bots = training ? team.bots : keepBots(team.bots, Math.max(0, before + botCount(team.bots) - now));
    return { ...team, humans: now, bots };
  });
  return { recipe: { ...recipe, teams }, controllers };
}
