import { BOT_LEVELS, type BotLevel } from '@boboforces/format';
import { COLORS, PLAYER_COLORS, t, type Screen, type StringKey, type UiNode } from '@boboforces/ui';

/**
 * Ações da tela de pausa (gameplay.md §2.2: Continuar · Ajustar desafio · Ajustes · Destravar · Sair). Refino R4 (#79):
 * na tela, "Dificuldade" e "Estou preso" (os ids ficam).
 */
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
  /** M4 (fase 3): a página Jogadores (refazer os assentos do sofá). */
  players: 'players',
  /** M9 (fase 5): a página das Ferramentas do Dono (só no Sandbox, só o P1; `scene/owner-tools.ts`). */
  owner: 'owner',
} as const;

/** M4 (fase 3): a página Jogadores: Continuar volta à partida (o B do P1 volta à pausa). */
export const PLAYERS_ACTION = { resume: 'resume' } as const;

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
  /** Refino R4 (#79): a frase do item com o foco, embaixo dos botões (`pauseHelp`); ausente = sem a linha. */
  readonly help?: string;
  /** M4 (fase 3): partida do sofá: o P1 tem o item Jogadores. */
  readonly players?: boolean;
  /** M4 (fase 3): a linha da bateria ("Bateria 64%"); ausente ou vazia = sem a linha (web, ou sem leitura). */
  readonly battery?: string;
  /** M8 (fase 5): a linha do Diretor de Partida ("Diretor de Partida (Equilibrado): bots –½"); ausente = desligado. */
  readonly director?: string;
  /** M7 (fase 9): os itens do P1 já montados (os do Aquário); ausente = os de sempre. */
  readonly items?: readonly UiNode[];
  /** M9 (fase 5): o P1 tem o botão das Ferramentas do Dono (o Sandbox), no canto de cima. */
  readonly owner?: boolean;
}

/** Refino R4 (#79): a frase de cada item da pausa (o que ele faz), pelo id do botão. */
const PAUSE_HELP: Readonly<Record<string, StringKey>> = {
  resume: 'pause.help.resume',
  challenge: 'pause.help.challenge',
  settings: 'pause.help.settings',
  unstuck: 'pause.help.unstuck',
  quit: 'pause.help.quit',
  leave: 'pause.help.leave',
  players: 'pause.help.players',
  owner: 'pause.help.owner',
};

/** A frase do item com o foco (`''` sem frase). Calibrar e Pular calibração dependem do estado. */
export function pauseHelp(focusedId: string | null, state: PauseState | null): string {
  if (focusedId === null) return '';
  if (focusedId === 'calibrate') return t(state?.calibrating ? 'pause.help.calibrateSkip' : 'pause.help.calibrate');
  const key = PAUSE_HELP[focusedId];
  return key !== undefined ? t(key) : '';
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
        // M9 (fase 5): as Ferramentas do Dono (o Sandbox, só o P1) num botão compacto no canto de cima, fora da coluna:
        // no celular os alvos de toque crescem, e um 7º item na coluna passava da tela. No D-pad, para cima do Continuar.
        ...((state?.owner ?? false) && (state?.player ?? 0) === 0
          ? [button('owner', 'pause.owner', PAUSE_ACTION.owner, { compact: true, anchor: 'topRight' })]
          : []),
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
              text: { key: 'pause.title' },
              style: 'title',
              color: COLORS.texto,
              textAlign: 'center',
            },
            ...couchLines(state),
            { kind: 'box', height: 10 },
            button('resume', 'pause.resume', PAUSE_ACTION.resume, { variant: 'primary', autofocus: true }),
            ...((state?.player ?? 0) > 0
              ? [button('leave', 'pause.leaveCouch', PAUSE_ACTION.leave, { variant: 'danger' })]
              : (state?.items ?? mainItems(state, challenge))),
            ...(state?.help !== undefined
              ? [
                  { kind: 'box', height: 4 } as const,
                  {
                    kind: 'text',
                    id: 'help',
                    text: { literal: state.help },
                    style: 'caption',
                    color: COLORS.texto,
                    textAlign: 'center',
                  } as const,
                ]
              : []),
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
  if (state?.battery) {
    out.push({
      kind: 'text',
      id: 'battery',
      text: { literal: state.battery },
      style: 'caption',
      color: COLORS.textoBaixo,
      textAlign: 'center',
    });
  }
  if (state?.director) {
    out.push({
      kind: 'text',
      id: 'director',
      text: { literal: state.director },
      style: 'caption',
      color: COLORS.textoBaixo,
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
    ...(state?.players ? [button('players', 'pause.players', PAUSE_ACTION.players)] : []),
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

/** M4 (fase 3): uma linha da página Jogadores (o jogador `player`, 0 = P1). */
export interface PlayerSeatLine {
  readonly player: number;
  /** `pad` e `keyboard` = sentado; `lost` = o controle caiu (o assento espera); `free` = ninguém. */
  readonly state: 'pad' | 'keyboard' | 'lost' | 'free';
  /** O índice do controle (`pad`), ou -1. */
  readonly pad: number;
}

/** M4 (fase 3): o que a página Jogadores mostra. */
export interface PlayersState {
  readonly seats: readonly PlayerSeatLine[];
  /** O jogador (0 = P1) cujo controle caiu, ou -1. */
  readonly lost: number;
  /** Ainda cabe gente (assento livre e um bot para assumir). */
  readonly canJoin: boolean;
  /** Há P2–P4 sentados (a linha do B que sai). */
  readonly canLeave: boolean;
}

/** O texto e a cor de uma linha da página Jogadores. */
function seatLine(line: PlayerSeatLine): UiNode {
  const n = line.player + 1;
  const key: StringKey =
    line.state === 'pad'
      ? 'players.seat.pad'
      : line.state === 'keyboard'
        ? 'players.seat.keyboard'
        : line.state === 'lost'
          ? 'players.seat.lost'
          : 'players.seat.free';
  return {
    kind: 'text',
    id: `seat-${line.player}`,
    text: { key, params: { n, c: line.pad + 1 } },
    style: 'body',
    color:
      line.state === 'lost'
        ? COLORS.perigo
        : line.state === 'free'
          ? COLORS.textoBaixo
          : (PLAYER_COLORS[line.player] as number),
    textAlign: 'center',
  };
}

/**
 * M4 (fase 3): a página Jogadores da pausa (GDD §3.6: dock/portátil, controle caído e HOME reabrem o "aperte A"). Os 4
 * assentos e o que fazer: A num controle livre fica no lugar de quem caiu (ou entra), B no controle do P2–P4 sai. A
 * partida fica pausada por trás; Continuar volta para ela.
 */
export const playersScreen: Screen<PlayersState> = {
  id: 'players',
  build(state) {
    const hint = (id: string, key: StringKey, n = 0): UiNode => ({
      kind: 'text',
      id,
      text: { key, params: { n } },
      style: 'caption',
      color: COLORS.texto,
      textAlign: 'center',
    });
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
          gap: 8,
          children: [
            {
              kind: 'text',
              id: 'title',
              text: { key: 'pause.players' },
              style: 'title',
              color: COLORS.texto,
              textAlign: 'center',
            },
            { kind: 'box', height: 6 },
            ...state.seats.map(seatLine),
            { kind: 'box', height: 6 },
            state.lost >= 0
              ? hint('hint', 'players.hint.lost', state.lost + 1)
              : hint('hint', state.canJoin ? 'players.hint.join' : 'players.hint.full'),
            ...(state.canLeave ? [hint('hint-leave', 'players.hint.leave')] : []),
            { kind: 'box', height: 10 },
            button('resume', 'pause.resume', PLAYERS_ACTION.resume, { variant: 'primary', autofocus: true }),
          ],
        },
      ],
    };
  },
};
