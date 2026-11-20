import type { MatchRecipe } from '@boboforces/format';
import { BOT_CONTROLLER_BASE, ownerAllowed, ownerReserveBase, ownerReserveCount } from '@boboforces/sim';

/**
 * M9 (fase 5): quando a partida liga as Ferramentas do Dono e com quantos bots na reserva. Fica fora da cena porque o
 * host online decide no lobby (`online-screens.ts`, que manda a reserva aos amigos) e a cena offline decide na criação;
 * as duas contas têm que ser a mesma.
 */

/** AH7: "criar bot onde mira" usa uma reserva de 8 bots dormentes separada na largada (dentro do teto do aparelho). */
export const OWNER_RESERVE = 8;

/** AH6: as Ferramentas do Dono só no Sandbox (e onde a sim aceita a opção: `ownerAllowed`). */
export function ownerToolsAllowed(recipe: MatchRecipe): boolean {
  return recipe.mode === 'sandbox' && ownerAllowed(recipe);
}

/**
 * A reserva do dono desta receita: `null` fora do Sandbox; senão 8, cortada no teto de bots do aparelho (ou da sala)
 * menos os bots da receita e nos tetos do motor (`ownerReserveCount`). Já cortada: é o número de bots que a sim cria,
 * e o que o começo da partida online leva ao amigo (o host e o amigo conferem que é o mesmo).
 */
export function ownerReserveFor(recipe: MatchRecipe, humans: number, maxBots: number): number | null {
  if (!ownerToolsAllowed(recipe)) return null;
  const bots = ownerReserveBase(recipe, humans) - BOT_CONTROLLER_BASE;
  return ownerReserveCount(recipe, humans, Math.min(OWNER_RESERVE, Math.max(0, maxBots - bots)));
}
