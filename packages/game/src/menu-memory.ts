import type { MatchRecipe } from '@boboforces/format';
import { PAD_BUTTON, type DeviceBinding, type RawInputState } from '@boboforces/input';

/**
 * M12 (fase 3, revisão): duas peças pequenas do fluxo dos menus, fora do `game.ts` para terem teste: o rascunho da
 * Personalizada aberta pelos Modos e o +/Start que começa a partida.
 */

/**
 * O rascunho da Personalizada aberta pelos Modos (na sessão). O Voltar guarda só se a receita ou a aba mudaram desde a
 * abertura (sem mexida, o rascunho fica como estava); qualquer partida começada limpa (ela vira a última, a do JOGAR).
 */
export interface CustomDraft {
  /** A receita e a aba para abrir: o rascunho, ou `fallback` (a última partida) e a 1ª aba. */
  recipeOr(fallback: MatchRecipe): MatchRecipe;
  readonly tab: number;
  /** A tela abriu com esta receita e esta aba. */
  opened(recipe: MatchRecipe, tab: number): void;
  /** O Voltar: guarda se mudou desde `opened`. */
  back(recipe: MatchRecipe, tab: number): void;
  /** Uma partida começou. */
  clear(): void;
}

export function createCustomDraft(): CustomDraft {
  let draft: MatchRecipe | null = null;
  let draftTab = 0;
  let openedRecipe: MatchRecipe | null = null;
  let openedTab = 0;
  return {
    recipeOr(fallback) {
      return draft ?? fallback;
    },
    get tab() {
      return draft === null ? 0 : draftTab;
    },
    opened(recipe, tab) {
      openedRecipe = recipe;
      openedTab = tab;
    },
    back(recipe, tab) {
      if (recipe === openedRecipe && tab === openedTab) return;
      draft = recipe;
      draftTab = tab;
    },
    clear() {
      draft = null;
      draftTab = 0;
    },
  };
}

/**
 * O +/Start apertado: com o sofá (`owner` = o dispositivo do P1, o dono dos menus, como no lobby), só o dele; sem sofá
 * (`null`), o de qualquer controle. Laço por índice, sem alocar.
 */
export function startButtonHeld(raw: Readonly<RawInputState>, owner: DeviceBinding | null): boolean {
  if (owner !== null) {
    return owner.kind === 'gamepad' && (raw.gamepads[owner.index]?.buttons[PAD_BUTTON.start] ?? 0) >= 0.5;
  }
  for (let i = 0; i < raw.gamepads.length; i++) {
    const pad = raw.gamepads[i]!;
    if (pad.connected && (pad.buttons[PAD_BUTTON.start] ?? 0) >= 0.5) return true;
  }
  return false;
}
