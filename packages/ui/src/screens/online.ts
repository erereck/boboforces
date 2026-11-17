import type { StringKey } from '../strings.pt-BR.ts';
import { t } from '../text.ts';
import { COLORS } from '../tokens.ts';
import type { Screen, TextContent, UiNode } from '../tree.ts';

/**
 * M5 (fase 4c): as telas do Online (GDD §3.7; PLANO_M5 fase 4): o aviso de privacidade na 1ª vez, a casa do Online
 * (o nome, Criar sala e Entrar com código), a digitação do código, a espera (procurando a sala, ou o motivo de ela ter
 * acabado) e a sala (os 4 lugares, o time de cada um, o código grande e, para o host, Começar, Escolher partida,
 * Trancar e Tirar). Chegam com o pedaço do Online (fora do menu da web). Tudo navegável só com D-pad + confirmar/voltar.
 */
export const ONLINE_ACTION = {
  ok: 'ok',
  back: 'back',
  name: 'name',
  create: 'create',
  join: 'join',
  privacy: 'privacy',
  type: 'type',
  go: 'go',
  cancel: 'cancel',
  team: 'team',
  start: 'start',
  match: 'match',
  lock: 'lock',
  copy: 'copy',
  leave: 'leave',
  /** M5 (fase 5c): aplica a versão nova (o jogo recarrega). */
  update: 'update',
  /** `kick:<slot>`: tira o amigo daquele lugar (só o host). */
  kickPrefix: 'kick:',
} as const;

/** A coluna da casa do Online e a área do nome (cabe o nome mais largo de 16 caracteres). */
export const ONLINE_HOME = { width: 680, nameValue: 400 } as const;

/** Largura do painel dos jogadores e da coluna de botões da sala (px de referência). */
export const ONLINE_ROOM = { panel: 720, buttons: 400, nameW: 320, teamW: 130, statusW: 110 } as const;

const text = (id: string, content: TextContent, style: 'body' | 'caption', color: number): UiNode => ({
  kind: 'text',
  id,
  text: content,
  style,
  color,
});

/** Um texto da tabela com quebras (`\n`) vira uma linha de texto por pedaço (o layout não quebra sozinho). */
function lines(id: string, key: StringKey, color: number = COLORS.texto): UiNode[] {
  return t(key)
    .split('\n')
    .map((line, i) => text(`${id}${i}`, { literal: line }, 'body', color));
}

function button(id: string, key: StringKey, action: string, extra: Partial<UiNode> = {}): UiNode {
  return { kind: 'button', id, text: { key }, action, variant: 'secondary', ...extra } as UiNode;
}

function page(title: StringKey | { readonly literal: string }, body: UiNode[]): UiNode {
  return {
    kind: 'box',
    id: 'root',
    color: COLORS.bunker,
    children: [
      {
        kind: 'column',
        id: 'main',
        anchor: 'left',
        gap: 10,
        children: [
          {
            kind: 'text',
            id: 'heading',
            text: typeof title === 'string' ? { key: title } : title,
            style: 'title',
            color: COLORS.texto,
          },
          { kind: 'box', id: 'headingBar', width: 120, height: 8, color: COLORS.acao, chamfer: true },
          { kind: 'box', height: 12 },
          ...body,
        ],
      },
    ],
  };
}

// --- o aviso de privacidade ---

/** Os parágrafos do aviso, na ordem. */
export const ONLINE_PRIVACY_PARAGRAPHS = [
  'online.privacy.p2p',
  'online.privacy.relays',
  'online.privacy.data',
  'online.privacy.friends',
] as const satisfies readonly StringKey[];

export const onlinePrivacyScreen: Screen<Record<string, never>> = {
  id: 'onlinePrivacy',
  build() {
    return page('online.privacy.title', [
      {
        kind: 'box',
        id: 'card',
        color: COLORS.chapa,
        chamfer: true,
        padding: 22,
        children: [
          {
            kind: 'column',
            gap: 6,
            children: ONLINE_PRIVACY_PARAGRAPHS.flatMap((key, i) => [
              ...(i > 0 ? [{ kind: 'box', height: 8 } as UiNode] : []),
              ...lines(`p${i}-`, key),
            ]),
          },
        ],
      },
      { kind: 'box', height: 8 },
      {
        kind: 'row',
        id: 'actions',
        gap: 14,
        children: [
          button('ok', 'online.privacy.ok', ONLINE_ACTION.ok, { variant: 'primary', autofocus: true }),
          button('back', 'menu.back', ONLINE_ACTION.back),
        ],
      },
    ]);
  },
};

// --- a casa do Online ---

export interface OnlineHomeState {
  /** O nome salvo (`''` = sem nome). */
  readonly name: string;
  /** Aviso embaixo (o motivo de a última sala ter acabado), `''` = nenhum. */
  readonly note: string;
}

export const onlineHomeScreen: Screen<OnlineHomeState> = {
  id: 'onlineHome',
  build(state) {
    return page('online.title', [
      text('help', { key: 'online.home.help' }, 'body', COLORS.textoBaixo),
      { kind: 'box', height: 6 },
      {
        kind: 'column',
        id: 'buttons',
        gap: 10,
        width: ONLINE_HOME.width,
        align: 'stretch',
        children: [
          {
            kind: 'button',
            id: 'name',
            text: { key: 'online.name' },
            action: ONLINE_ACTION.name,
            variant: 'secondary',
            value: state.name === '' ? { key: 'online.noName' } : { literal: state.name },
            valueOnly: true,
            valueWidth: ONLINE_HOME.nameValue,
          },
          button('create', 'online.create', ONLINE_ACTION.create, { variant: 'primary', autofocus: true }),
          button('join', 'online.join', ONLINE_ACTION.join),
          {
            kind: 'row',
            id: 'more',
            gap: 10,
            children: [
              button('privacy', 'online.privacy.read', ONLINE_ACTION.privacy, { width: (ONLINE_HOME.width - 10) / 2 }),
              button('back', 'menu.back', ONLINE_ACTION.back, { width: (ONLINE_HOME.width - 10) / 2 }),
            ],
          },
        ],
      },
      ...(state.note !== '' ? [text('note', { literal: state.note }, 'body', COLORS.perigo)] : []),
    ]);
  },
};

// --- entrar com código ---

export interface OnlineJoinState {
  /** O que já foi digitado (até 5). */
  readonly code: string;
  readonly length: number;
  /** O código está completo e válido (o Entrar acende). */
  readonly ready: boolean;
  readonly note: string;
}

/** O código com os lugares vazios ("AB3__" vira "A B 3 _ _"). */
export function codeSlots(code: string, length: number): string {
  const chars = [...code.slice(0, length)];
  while (chars.length < length) chars.push('_');
  return chars.join(' ');
}

export const onlineJoinScreen: Screen<OnlineJoinState> = {
  id: 'onlineJoin',
  build(state) {
    return page('online.join.title', [
      {
        kind: 'box',
        id: 'codeBox',
        color: COLORS.chapa,
        chamfer: true,
        padding: 18,
        width: 620,
        children: [
          {
            kind: 'text',
            id: 'code',
            text: { literal: codeSlots(state.code, state.length) },
            style: 'title',
            color: state.ready ? COLORS.acao : COLORS.texto,
            textAlign: 'center',
            width: 584,
          },
        ],
      },
      text('help', { key: 'online.join.help' }, 'body', COLORS.textoBaixo),
      { kind: 'box', height: 6 },
      {
        kind: 'column',
        id: 'buttons',
        gap: 10,
        width: 620,
        align: 'stretch',
        children: [
          button('type', 'online.join.type', ONLINE_ACTION.type, { autofocus: !state.ready }),
          button('go', 'online.join.go', ONLINE_ACTION.go, {
            variant: 'primary',
            disabled: !state.ready,
            autofocus: state.ready,
          }),
          button('back', 'menu.back', ONLINE_ACTION.back),
        ],
      },
      ...(state.note !== '' ? [text('note', { literal: state.note }, 'body', COLORS.perigo)] : []),
    ]);
  },
};

// --- a espera (procurando a sala) e o fim ---

export interface OnlineStatusState {
  readonly message: string;
  /** Ainda esperando (Cancelar) ou acabou (OK). */
  readonly busy: boolean;
  /** M5 (fase 5c): uma linha embaixo (a procura da versão nova); `''` = nenhuma. */
  readonly detail?: string;
  /** M5 (fase 5c): o botão Atualizar (`ready` = a versão nova chegou; sem ela, apagado). Ausente = sem o botão. */
  readonly update?: { readonly ready: boolean };
}

export const onlineStatusScreen: Screen<OnlineStatusState> = {
  id: 'onlineStatus',
  build(state) {
    const update = state.update;
    return page('online.title', [
      text('message', { literal: state.message }, 'body', state.busy ? COLORS.texto : COLORS.perigo),
      ...(state.detail !== undefined && state.detail !== ''
        ? [text('detail', { literal: state.detail }, 'body', COLORS.textoBaixo)]
        : []),
      { kind: 'box', height: 12 },
      state.busy
        ? button('cancel', 'online.cancel', ONLINE_ACTION.cancel, { autofocus: true })
        : update !== undefined
          ? ({
              kind: 'row',
              id: 'actions',
              gap: 14,
              children: [
                button('update', 'online.update', ONLINE_ACTION.update, {
                  variant: 'primary',
                  disabled: !update.ready,
                  autofocus: update.ready,
                }),
                button('ok', 'online.ok', ONLINE_ACTION.ok, { autofocus: !update.ready }),
              ],
            } as UiNode)
          : button('ok', 'online.ok', ONLINE_ACTION.ok, { variant: 'primary', autofocus: true }),
    ]);
  },
};

// --- a sala ---

export interface OnlineRoomMemberRow {
  readonly slot: number;
  /** O nome já limpo. */
  readonly name: string;
  /** É este aparelho (o nome sai na cor de ação). */
  readonly you: boolean;
  /** "Laranja", "Azul", "Tanto faz" ou "Cada um por si". */
  readonly team: string;
  readonly teamColor: number;
  /** "host", "você", "no resultado" ou `''`. */
  readonly status: string;
  /** O host pode tirar este (não é ele mesmo). */
  readonly kickable: boolean;
}

export interface OnlineRoomState {
  readonly code: string;
  /** O resumo da partida escolhida ("Times · De boa · 4 contra 4 · Construto"). */
  readonly summary: string;
  readonly host: boolean;
  /** Até 4 linhas (os lugares vagos não vêm: a tela completa). */
  readonly members: readonly OnlineRoomMemberRow[];
  /** O meu time ("Laranja"); `null` = a partida não tem times (FFA, Bobo Zombies). */
  readonly team: string | null;
  readonly locked: boolean;
  readonly note: string;
}

export const ONLINE_ROOM_SEATS = 4;

function memberRow(m: OnlineRoomMemberRow | null, i: number, host: boolean): UiNode {
  const cells: UiNode[] =
    m === null
      ? [
          {
            kind: 'text',
            id: `name${i}`,
            text: { key: 'online.room.empty' },
            style: 'body',
            color: COLORS.textoBaixo,
            width: ONLINE_ROOM.nameW,
          },
        ]
      : [
          {
            kind: 'text',
            id: `name${i}`,
            text: { literal: m.name },
            style: 'body',
            color: m.you ? COLORS.acao : COLORS.texto,
            width: ONLINE_ROOM.nameW,
          },
          {
            kind: 'text',
            id: `team${i}`,
            text: { literal: m.team },
            style: 'body',
            color: m.teamColor,
            width: ONLINE_ROOM.teamW,
          },
          {
            kind: 'text',
            id: `status${i}`,
            text: { literal: m.status },
            style: 'caption',
            color: COLORS.textoBaixo,
            width: ONLINE_ROOM.statusW,
          },
          ...(host && m.kickable
            ? [
                button(`kick${m.slot}`, 'online.room.kick', ONLINE_ACTION.kickPrefix + String(m.slot), {
                  compact: true,
                }),
              ]
            : []),
        ];
  return { kind: 'row', id: `seat${i}`, gap: 8, align: 'center', height: 48, children: cells } as UiNode;
}

export const onlineRoomScreen: Screen<OnlineRoomState> = {
  id: 'onlineRoom',
  build(state) {
    const seats: UiNode[] = [];
    for (let i = 0; i < ONLINE_ROOM_SEATS; i++) seats.push(memberRow(state.members[i] ?? null, i, state.host));
    const actions: UiNode[] = state.host
      ? [
          button('start', 'online.room.start', ONLINE_ACTION.start, { variant: 'primary', autofocus: true }),
          button('match', 'online.room.match', ONLINE_ACTION.match),
          button('lock', state.locked ? 'online.room.unlock' : 'online.room.lock', ONLINE_ACTION.lock),
          button('copy', 'online.room.copy', ONLINE_ACTION.copy),
          button('leave', 'online.room.leave', ONLINE_ACTION.leave, { variant: 'danger' }),
        ]
      : [
          button('copy', 'online.room.copy', ONLINE_ACTION.copy, { autofocus: state.team === null }),
          button('leave', 'online.room.leave', ONLINE_ACTION.leave, { variant: 'danger' }),
        ];
    const left: UiNode[] = [
      {
        kind: 'box',
        id: 'players',
        color: COLORS.chapa,
        chamfer: true,
        padding: 16,
        width: ONLINE_ROOM.panel,
        children: [
          {
            kind: 'column',
            gap: 4,
            children: [
              {
                kind: 'text',
                id: 'playersTitle',
                text: { key: 'online.room.players', params: { n: state.members.length } },
                style: 'label',
                color: COLORS.textoBaixo,
              },
              ...seats,
            ],
          },
        ],
      },
      ...(state.team !== null
        ? [
            {
              kind: 'button',
              id: 'team',
              text: { key: 'online.room.team' },
              action: ONLINE_ACTION.team,
              variant: 'secondary',
              value: { literal: state.team },
              width: ONLINE_ROOM.panel,
              autofocus: !state.host,
            } as UiNode,
          ]
        : []),
      ...(state.host ? [] : [text('wait', { key: 'online.room.wait' }, 'body', COLORS.textoBaixo)]),
      ...(state.note !== '' ? [text('note', { literal: state.note }, 'body', COLORS.acao)] : []),
    ];
    return page({ literal: t('online.room.code', { code: state.code }) }, [
      text('summary', { literal: state.summary }, 'body', COLORS.textoBaixo),
      { kind: 'box', height: 4 },
      {
        kind: 'row',
        id: 'body',
        gap: 24,
        children: [
          { kind: 'column', id: 'left', gap: 10, width: ONLINE_ROOM.panel, children: left },
          {
            kind: 'column',
            id: 'actions',
            gap: 10,
            width: ONLINE_ROOM.buttons,
            align: 'stretch',
            children: actions,
          },
        ],
      },
    ]);
  },
};
