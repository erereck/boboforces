import type { RemapAction } from '@boboforces/input';
import type { StringKey } from '@boboforces/ui';

/**
 * M2 (fase 4h): dicas de 1 linha nas 2 primeiras partidas (gameplay.md §2.5): no contexto, cada uma no máximo 1 vez
 * (o `stats@1` lembra), sem pausar, com a tecla ou o botão do dispositivo ativo. Desligáveis em Ajustes. Puro e sem
 * alocação por frame: a cena entrega os sinais do jogador e mostra a dica que sair daqui.
 *
 * Os gatilhos, na ordem de prioridade:
 * - `reload`: pente vazio com reserva;
 * - `ads`: mirando num inimigo a mais de 20 m sem o ADS;
 * - `slide`: correndo há 1,5 s (a regra do design é "correr perto de cobertura"; correr basta por ora);
 * - `sprint`: 5 s andando sem correr.
 */
export const TIPS = {
  reload: { action: 'reload', textKey: 'tip.reload' },
  ads: { action: 'ads', textKey: 'tip.ads' },
  slide: { action: 'crouch', textKey: 'tip.slide' },
  sprint: { action: 'sprint', textKey: 'tip.sprint' },
} as const satisfies Record<string, { readonly action: RemapAction; readonly textKey: StringKey }>;

export type TipId = keyof typeof TIPS;
export const TIP_IDS = Object.keys(TIPS) as readonly TipId[];

export const TIP_RULES = {
  /** Só nas partidas de número 1 e 2 (as que começam com menos de 2 terminadas). */
  maxMatches: 2,
  walkS: 5,
  sprintS: 1.5,
  farM: 20,
  farS: 0.5,
  /** Na tela por 4 s (o último meio segundo some aos poucos); 3 s de folga até a próxima. */
  showS: 4,
  fadeS: 0.5,
  gapS: 3,
} as const;

/** O que o jogador está fazendo neste frame. */
export interface TipSignals {
  alive: boolean;
  moving: boolean;
  sprinting: boolean;
  /** Mirando (sem ADS) num inimigo a mais de `TIP_RULES.farM`. */
  farEnemy: boolean;
  magEmpty: boolean;
}

export interface TipsState {
  /** As que ainda podem aparecer nesta partida. */
  readonly pending: Set<TipId>;
  current: TipId | null;
  shownS: number;
  gapS: number;
  walkS: number;
  sprintS: number;
  farS: number;
}

export function createTipSignals(): TipSignals {
  return { alive: false, moving: false, sprinting: false, farEnemy: false, magEmpty: false };
}

/** `enabled` = a regra das 2 primeiras partidas e o ajuste "Dicas"; `seen` = as já mostradas (do `stats@1`). */
export function createTips(enabled: boolean, seen: readonly string[]): TipsState {
  const pending = new Set<TipId>();
  if (enabled) for (const id of TIP_IDS) if (!seen.includes(id)) pending.add(id);
  return { pending, current: null, shownS: 0, gapS: 0, walkS: 0, sprintS: 0, farS: 0 };
}

/**
 * Um frame (`dt` em s). Devolve a dica que começou agora (para gravar como vista), ou `null`. `canShow` diz se a ação
 * da dica tem tecla no dispositivo ativo (no toque não há "correr").
 */
export function stepTips(
  st: TipsState,
  sig: Readonly<TipSignals>,
  dt: number,
  canShow: (id: TipId) => boolean,
): TipId | null {
  if (st.current !== null) {
    st.shownS += dt;
    if (st.shownS >= TIP_RULES.showS) {
      st.current = null;
      st.gapS = TIP_RULES.gapS;
    }
  } else if (st.gapS > 0) st.gapS = Math.max(0, st.gapS - dt);
  if (st.pending.size === 0) return null;
  // Os contadores andam sempre (a dica certa sai assim que a vez chegar).
  const walking = sig.alive && sig.moving && !sig.sprinting;
  st.walkS = walking ? st.walkS + dt : 0;
  st.sprintS = sig.alive && sig.sprinting ? st.sprintS + dt : 0;
  st.farS = sig.alive && sig.farEnemy ? st.farS + dt : 0;
  if (st.current !== null || st.gapS > 0 || !sig.alive) return null;
  for (const id of TIP_IDS) {
    if (!st.pending.has(id) || !triggered(st, sig, id) || !canShow(id)) continue;
    st.pending.delete(id);
    st.current = id;
    st.shownS = 0;
    return id;
  }
  return null;
}

function triggered(st: TipsState, sig: Readonly<TipSignals>, id: TipId): boolean {
  switch (id) {
    case 'reload':
      return sig.magEmpty;
    case 'ads':
      return st.farS >= TIP_RULES.farS;
    case 'slide':
      return st.sprintS >= TIP_RULES.sprintS;
    case 'sprint':
      return st.walkS >= TIP_RULES.walkS;
  }
}

/** Opacidade da dica na tela (0 = nenhuma). */
export function tipAlpha(st: TipsState): number {
  if (st.current === null) return 0;
  const left = TIP_RULES.showS - st.shownS;
  return left >= TIP_RULES.fadeS ? 1 : Math.max(0, left / TIP_RULES.fadeS);
}
