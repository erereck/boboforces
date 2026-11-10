import { COLORS, PLAYER_COLORS, withAlpha } from '../tokens.ts';
import type { Screen, TextContent, UiNode } from '../tree.ts';

/**
 * M3 (fase 1b): a tela "Jogar no sofá" (GDD §3.6, gameplay.md §10.6). Quatro cartões, um por assento: vago mostra
 * "Aperte A para entrar"; ocupado mostra o símbolo e a cor do jogador (P1 ▲, P2 ●, P3 ■, P4 ◆), o dispositivo e o
 * lado. O P1 escolhe a partida e começa; os outros trocam o próprio lado e saem com o voltar (a tela lê cada dispositivo).
 */
export const COUCH_ACTION = { match: 'match', start: 'start', back: 'back' } as const;

export interface CouchSeatView {
  /** O dispositivo ("Controle 2", "Teclado e mouse"); `null` = assento vago. */
  readonly device: string | null;
  /** 0 = com o P1, 1 = contra; `null` no P1 e quando o modo não tem times. */
  readonly side: 0 | 1 | null;
  /** O controle do assento caiu (o assento fica guardado até ele voltar). */
  readonly disconnected: boolean;
}

export interface CouchState {
  /** Sempre 4 (os vagos com `device: null`). */
  readonly seats: readonly CouchSeatView[];
  /** A partida que o P1 escolheu (o resumo do preset). */
  readonly match: string;
  /** O teclado ainda não entrou (o cartão vago lembra do Enter). */
  readonly keyboardFree: boolean;
}

/** Largura e altura de um cartão (px de referência): os 4 lado a lado cabem em 1280. */
export const COUCH_CARD = { width: 268, height: 214 } as const;

function seatCard(seat: CouchSeatView, k: number, keyboardFree: boolean): UiNode {
  const color = PLAYER_COLORS[k] as number;
  const joined = seat.device !== null;
  const lines: UiNode[] = [];
  const line = (id: string, text: TextContent, c: number): void => {
    lines.push({ kind: 'text', id: `seat${k}${id}`, text, style: 'body', color: c });
  };
  if (joined) {
    line('Device', { literal: seat.device }, COLORS.texto);
    if (seat.disconnected) line('Lost', { key: 'couch.disconnected' }, COLORS.perigo);
    else if (k === 0) line('Role', { key: 'couch.p1' }, COLORS.textoBaixo);
    else if (seat.side !== null) {
      line('Side', { key: seat.side === 0 ? 'couch.side.with' : 'couch.side.against' }, COLORS.acao);
    }
    if (k > 0 && seat.side !== null) line('HintSide', { key: 'couch.hint.side' }, COLORS.textoBaixo);
    if (k > 0) line('HintLeave', { key: 'couch.hint.leave' }, COLORS.textoBaixo);
  } else {
    line('Join', { key: 'couch.join' }, COLORS.texto);
    if (keyboardFree) line('Keys', { key: 'couch.joinKeys' }, COLORS.textoBaixo);
  }
  return {
    kind: 'box',
    id: `seat${k}`,
    width: COUCH_CARD.width,
    height: COUCH_CARD.height,
    color: joined ? COLORS.chapa : COLORS.bunker,
    borderColor: joined ? color : COLORS.linha,
    border: joined ? 3 : 1,
    chamfer: true,
    padding: 18,
    children: [
      {
        kind: 'column',
        gap: 10,
        children: [
          {
            kind: 'row',
            gap: 12,
            align: 'center',
            children: [
              {
                kind: 'box',
                id: `seat${k}Icon`,
                width: 34,
                height: 34,
                icon: k,
                iconColor: joined ? color : withAlpha(color, 0.35),
                children: [],
              },
              {
                kind: 'text',
                id: `seat${k}Name`,
                text: { key: 'couch.player', params: { n: k + 1 } },
                style: 'heading',
                color: joined ? color : COLORS.textoBaixo,
              },
            ],
          },
          ...lines,
        ],
      },
    ],
  };
}

export const couchScreen: Screen<CouchState> = {
  id: 'couch',
  build(state) {
    return {
      kind: 'box',
      id: 'root',
      color: COLORS.bunker,
      children: [
        {
          kind: 'column',
          id: 'main',
          anchor: 'center',
          gap: 12,
          children: [
            { kind: 'text', id: 'heading', text: { key: 'couch.title' }, style: 'title', color: COLORS.texto },
            { kind: 'text', id: 'pitch', text: { key: 'couch.pitch' }, style: 'body', color: COLORS.textoBaixo },
            { kind: 'box', height: 6 },
            {
              kind: 'row',
              id: 'seats',
              gap: 16,
              children: state.seats.map((s, k) => seatCard(s, k, state.keyboardFree)),
            },
            { kind: 'box', height: 10 },
            {
              kind: 'column',
              id: 'actions',
              gap: 12,
              width: 760,
              align: 'stretch',
              children: [
                {
                  kind: 'button',
                  id: 'match',
                  text: { key: 'couch.match' },
                  value: { literal: state.match },
                  valueWidth: 540,
                  action: COUCH_ACTION.match,
                  variant: 'secondary',
                },
                {
                  kind: 'row',
                  gap: 16,
                  children: [
                    {
                      kind: 'button',
                      id: 'start',
                      text: { key: 'couch.start' },
                      action: COUCH_ACTION.start,
                      variant: 'primary',
                      autofocus: true,
                      width: 372,
                    },
                    {
                      kind: 'button',
                      id: 'back',
                      text: { key: 'menu.back' },
                      action: COUCH_ACTION.back,
                      variant: 'secondary',
                      width: 372,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
  },
};
