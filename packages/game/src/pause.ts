import { BOT_LEVELS, type BotLevel } from '@boboforces/format';
import { COLORS, PLAYER_COLORS, type Screen, type StringKey, type UiNode } from '@boboforces/ui';

/** Ações da tela de pausa (gameplay.md §2.2: Continuar · Ajustar desafio · Ajustes · Destravar · Sair). */
export const PAUSE_ACTION = {
  resume: 'resume',
  challenge: 'challenge',
  settings: 'settings',
  unstuck: 'unstuck',
  quit: 'quit',
  /** M3 (fase 1c): o jogador 2–4 que pausou sai do sofá (um bot assume o lugar dele). */
  leave: 'leave',
  /** M2 (fase 5f): no Bobo Training, no lugar do "Ajustar desafio". */
  calibrate: 'calibrate',
} as const;

/** M2 (fase 5f): a página do resultado da calibração: OK fica com o ajuste; Desfazer volta o de antes. */
export const CALIBRATED_ACTION = { ok: 'ok', undo: 'undo' } as const;

/** Ações do "Ajustar desafio": `level:<nível>` escolhe; `back` volta à pausa. */
export const CHALLENGE_ACTION = { back: 'back', levelPrefix: 'level:' } as const;

/** O que a pausa precisa saber: se há partida de verdade (sem ela, o desafio não vale e fica apagado). */
export interface PauseState {
  readonly challenge: boolean;
  /** M2 (fase 5f): Bobo Training (o item vira "Calibrar mira"). */
  readonly calibrate?: boolean;
  /** Calibrando agora (o item vira "Pular calibração"). */
  readonly calibrating?: boolean;
  /**
   * M3 (fase 1c): o jogador (0 = P1) que pausou. Do P2 ao P4, a pausa é dele: Continuar e Sair do sofá (o resto é do
   * P1). Ausente = o P1.
   */
  readonly player?: number;
  /** M3 (fase 1c): o controle deste jogador (0 = P1) caiu; a linha avisa até ele voltar. Ausente ou -1 = nenhum. */
  readonly lost?: number;
}

function button(id: string, key: StringKey, action: string, extra: Partial<UiNode> = {}): UiNode {
  return { kind: 'button', id, text: { key }, action, variant: 'secondary', ...extra } as UiNode;
}

/** Pausa (arte-ux.md §6): véu sobre a partida congelada, as 5 opções e Sair (faixa de perigo). */
export const pauseScreen: Screen<PauseState | null> = {
  id: 'pause',
  build(state) {
    const challenge = state?.challenge ?? true;
    return {
      kind: 'box',
      id: 'root',
      color: COLORS.veu,
      children: [
        {
          kind: 'column',
          id: 'main',
          anchor: 'center',
          align: 'stretch',
          width: 380,
          gap: 14,
          children: [
            {
              kind: 'text',
              id: 'title',
              text: { key: 'pause.title' },
              style: 'title',
              color: COLORS.texto,
              textAlign: 'center',
            },
            ...couchLines(state),
            { kind: 'box', height: 18 },
            button('resume', 'pause.resume', PAUSE_ACTION.resume, { variant: 'primary', autofocus: true }),
            ...((state?.player ?? 0) > 0
              ? [button('leave', 'pause.leaveCouch', PAUSE_ACTION.leave, { variant: 'danger' })]
              : mainItems(state, challenge)),
          ],
        },
      ],
    };
  },
};

/** M3 (fase 1c): quem pausou (P2–P4) e o aviso de controle desconectado. */
function couchLines(state: PauseState | null): UiNode[] {
  const out: UiNode[] = [];
  const player = state?.player ?? 0;
  if (player > 0) {
    out.push({
      kind: 'text',
      id: 'player',
      text: { key: 'couch.player', params: { n: player + 1 } },
      style: 'heading',
      color: PLAYER_COLORS[player] as number,
      textAlign: 'center',
    });
  }
  const lost = state?.lost ?? -1;
  if (lost >= 0) {
    out.push({
      kind: 'text',
      id: 'lost',
      text: { key: 'pause.lost', params: { n: lost + 1 } },
      style: 'body',
      color: COLORS.perigo,
      textAlign: 'center',
    });
  }
  return out;
}

/** Os itens do P1 (e da partida solo). */
function mainItems(state: PauseState | null, challenge: boolean): UiNode[] {
  return [
    state?.calibrate
      ? button('calibrate', state.calibrating ? 'pause.calibrateSkip' : 'pause.calibrate', PAUSE_ACTION.calibrate)
      : button('challenge', 'pause.challenge', PAUSE_ACTION.challenge, { disabled: !challenge }),
    button('settings', 'menu.settings', PAUSE_ACTION.settings),
    button('unstuck', 'pause.unstuck', PAUSE_ACTION.unstuck),
    button('quit', 'pause.quitMatch', PAUSE_ACTION.quit, { variant: 'danger' }),
  ];
}

/**
 * "Ajustar desafio": os 5 níveis rápidos (#21), o atual em destaque e com o foco. Vale na hora para os bots
 * adversários (os aliados ficam como estão).
 */
export const challengeScreen: Screen<BotLevel> = {
  id: 'challenge',
  build(current) {
    return {
      kind: 'box',
      id: 'root',
      color: COLORS.veu,
      children: [
        {
          kind: 'column',
          id: 'main',
          anchor: 'center',
          align: 'stretch',
          width: 380,
          gap: 12,
          children: [
            {
              kind: 'text',
              id: 'title',
              text: { key: 'pause.challenge' },
              style: 'heading',
              color: COLORS.texto,
              textAlign: 'center',
            },
            {
              kind: 'text',
              id: 'hint',
              text: { key: 'pause.challengeHint' },
              style: 'caption',
              color: COLORS.textoBaixo,
              textAlign: 'center',
            },
            { kind: 'box', height: 8 },
            ...BOT_LEVELS.map((level) =>
              button(`level-${level}`, `level.${level}` as StringKey, CHALLENGE_ACTION.levelPrefix + level, {
                variant: level === current ? 'primary' : 'secondary',
                autofocus: level === current,
              }),
            ),
            { kind: 'box', height: 8 },
            button('back', 'menu.back', CHALLENGE_ACTION.back),
          ],
        },
      ],
    };
  },
};

/** O nível pedido por uma ação do "Ajustar desafio", ou `null`. */
export function challengeLevel(action: string | null): BotLevel | null {
  if (action === null || !action.startsWith(CHALLENGE_ACTION.levelPrefix)) return null;
  const level = action.slice(CHALLENGE_ACTION.levelPrefix.length);
  return (BOT_LEVELS as readonly string[]).includes(level) ? (level as BotLevel) : null;
}

/** Um passo no nível rápido (Mais fácil −1, Mais difícil +1), sem passar das pontas. */
export function stepLevel(level: BotLevel, step: number): BotLevel {
  const i = BOT_LEVELS.indexOf(level);
  return BOT_LEVELS[Math.max(0, Math.min(BOT_LEVELS.length - 1, i + step))]!;
}

/** M2 (fase 5f): o resultado da calibração ("Sua mira passava do alvo: ×1 → ×0,85"), com OK e Desfazer. */
export const calibratedScreen: Screen<{ readonly message: string; readonly changed: boolean }> = {
  id: 'calibrated',
  build(state) {
    return {
      kind: 'box',
      id: 'root',
      color: COLORS.veu,
      children: [
        {
          kind: 'column',
          id: 'main',
          anchor: 'center',
          align: 'center',
          width: 760,
          gap: 16,
          children: [
            { kind: 'text', id: 'title', text: { key: 'pause.calibrate' }, style: 'heading', color: COLORS.texto },
            {
              kind: 'text',
              id: 'message',
              text: { literal: state.message },
              style: 'body',
              color: COLORS.texto,
              textAlign: 'center',
            },
            {
              kind: 'row',
              id: 'actions',
              gap: 14,
              children: [
                button('ok', 'news.ok', CALIBRATED_ACTION.ok, { variant: 'primary', autofocus: true }),
                ...(state.changed ? [button('undo', 'calibrate.undo', CALIBRATED_ACTION.undo)] : []),
              ],
            },
          ],
        },
      ],
    };
  },
};
