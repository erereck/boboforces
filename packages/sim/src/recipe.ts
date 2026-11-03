import type { BotRef, MatchRecipe } from '@boboforces/format';
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

/** Família Bobo Warfare (regeneração, respawn padrão). */
export function isWarfareMode(mode: string): boolean {
  return mode.startsWith('warfare.');
}
