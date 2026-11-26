import { isRoyaleMode, SANDBOX_DEFAULTS, type BotRef, type MatchRecipe } from '@boboforces/format';
import { assert } from '@boboforces/shared';
import { BOT_CONTROLLER_BASE, MAX_BOTS, MAX_HUMANS, MAX_TEAMS } from './constants.ts';

/**
 * Expansão da receita em controladores (convenção do ARCHITECTURE §3): humanos em 0..humans-1, bots a partir de
 * `BOT_CONTROLLER_BASE`, na ordem "times em ordem, cada `bots[]` em ordem, `count` vezes". A sim e a IA usam a MESMA
 * função, então o bot `i` da IA é sempre o controlador `BOT_CONTROLLER_BASE + i` da sim.
 */
export interface ControllerSlot {
  readonly controller: number;
  readonly team: number;
  /** `null` para humano. */
  readonly bot: BotRef | null;
  /** Índice do bot (0..), ou -1 para humano. */
  readonly botIndex: number;
}

/**
 * Humanos: cada time com `humans: 'all'` pega todos os que sobraram; com número, pega até esse tanto. Quem sobrar
 * depois de todos os times vai para o time 0.
 */
export function expandRecipe(recipe: MatchRecipe, humans: number): ControllerSlot[] {
  assert(recipe.teams.length >= 1 && recipe.teams.length <= MAX_TEAMS, `receita: 1 a ${MAX_TEAMS} times`);
  assert(Number.isInteger(humans) && humans >= 0 && humans <= MAX_HUMANS, `receita: 0 a ${MAX_HUMANS} humanos`);
  const slots: ControllerSlot[] = [];
  let nextHuman = 0;
  recipe.teams.forEach((team, t) => {
    const want = team.humans === 'all' ? humans : (team.humans ?? 0);
    for (let i = 0; i < want && nextHuman < humans; i++) {
      slots.push({ controller: nextHuman++, team: t, bot: null, botIndex: -1 });
    }
  });
  while (nextHuman < humans) slots.push({ controller: nextHuman++, team: 0, bot: null, botIndex: -1 });
  let botIndex = 0;
  recipe.teams.forEach((team, t) => {
    for (const slot of team.bots) {
      assert(Number.isInteger(slot.count) && slot.count >= 0, 'receita: count inválido');
      for (let i = 0; i < slot.count; i++) {
        assert(botIndex < MAX_BOTS, `receita: no máximo ${MAX_BOTS} bots`);
        slots.push({ controller: BOT_CONTROLLER_BASE + botIndex, team: t, bot: slot.ref, botIndex });
        botIndex++;
      }
    }
  });
  return slots;
}

/** FFA: todos contra todos, mesmo estando no mesmo "time" da receita (o FFA usa um time só). */
export function isFfaMode(mode: string): boolean {
  return mode === 'warfare.ffa';
}

/**
 * Família Bobo Warfare (regeneração, respawn padrão, caixinha de munição). M2 (fase 5d): o Bobo Training joga com as
 * mesmas regras (sem placar e sem fim: tempo e meta zerados). M6: o Juggernaut (fase 3) e o Paintball (fase 5) também.
 * M9 (fase 2): e o Bobo Sandbox (o placar de abates por time, como o TDM).
 */
export function isWarfareMode(mode: string): boolean {
  return (
    mode.startsWith('warfare.') ||
    mode === 'training' ||
    mode === 'juggernaut' ||
    mode === 'paintball' ||
    mode === 'sandbox'
  );
}

/** O tempo (s; 0 = sem) e a meta (0 = sem) que valem na partida: os da receita, com as exceções de cada modo. */
export interface MatchLimits {
  readonly timeLimitS: number;
  readonly scoreLimit: number;
}

/**
 * M9 (fase 3): os limites efetivos da receita, a MESMA conta do `createSim` (o HUD e a dica da derrota feia leem daqui,
 * não da receita crua). Nas rodadas (o BoboStrike e o Jugg Fixo) e no Royale, nenhum: quem acaba a partida são as
 * rodadas e o último esquadrão. No Sandbox, o objetivo: nos pontos, o tempo e a meta da receita (ausentes = os do
 * `SANDBOX_DEFAULTS`); na eliminação, só o tempo, e sempre com um (0 ou ausente = o padrão: a partida acaba); no
 * "nenhum", sem os dois.
 */
export function matchLimits(recipe: MatchRecipe): MatchLimits {
  const rounds = recipe.mode === 'strike' || (recipe.mode === 'juggernaut' && recipe.juggernaut?.variant === 'fixed');
  if (rounds || isRoyaleMode(recipe.mode)) return { timeLimitS: 0, scoreLimit: 0 };
  const time = recipe.match?.timeLimitS;
  const score = recipe.match?.scoreLimit;
  if (recipe.mode !== 'sandbox') return { timeLimitS: time ?? 0, scoreLimit: score ?? 0 };
  const objective = recipe.sandbox?.objective ?? SANDBOX_DEFAULTS.objective;
  if (objective === 'none') return { timeLimitS: 0, scoreLimit: 0 };
  if (objective === 'elimination') return { timeLimitS: time || SANDBOX_DEFAULTS.timeLimitS, scoreLimit: 0 };
  return { timeLimitS: time ?? SANDBOX_DEFAULTS.timeLimitS, scoreLimit: score ?? SANDBOX_DEFAULTS.scoreLimit };
}
