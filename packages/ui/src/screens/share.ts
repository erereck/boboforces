import type { StringKey } from '../strings.pt-BR.ts';
import { COLORS } from '../tokens.ts';
import type { Screen, UiNode } from '../tree.ts';

/**
 * M8 (fase 1): a tela de compartilhar (GDD §4.8), no pedaço dos editores. Quatro jeitos:
 * - `export`: o bot ou o preset escolhido, com o tamanho do código; Copiar código, Copiar link, Colar um código;
 * - `paste`: esperando o código colado (o campo de texto escondido da web);
 * - `bot` / `preset`: o que o código trouxe, com o resumo do que mudou; Salvar (e Jogar, no preset);
 * - `error`: por que o código não abriu; Colar outro.
 * Todo texto vem montado do `game`.
 */
export const SHARE_ACTION = {
  copyCode: 'share.copyCode',
  copyLink: 'share.copyLink',
  paste: 'share.paste',
  save: 'share.save',
  play: 'share.play',
  back: 'share.back',
} as const;

export type ShareMode = 'export' | 'paste' | 'bot' | 'preset' | 'error';

export interface ShareState {
  readonly mode: ShareMode;
  readonly title: string;
  readonly lines: readonly string[];
  /** Aviso de uma linha em âmbar (`''` = nenhum). */
  readonly note: string;
  /** A web tem a área de transferência (Copiar). */
  readonly canCopy: boolean;
  /** A casca monta o link (Copiar link). */
  readonly canLink: boolean;
  /** Dá para colar (o campo de texto da web). */
  readonly canPaste: boolean;
  /** A partida recebida já foi salva (sem o Salvar: cada aperto faria outra cópia). */
  readonly saved?: boolean;
}

function button(id: string, key: StringKey, action: string, primary = false): UiNode {
  return {
    kind: 'button',
    id,
    text: { key },
    action,
    variant: primary ? 'primary' : 'secondary',
    ...(primary ? { autofocus: true } : {}),
  } as UiNode;
}

function buttons(state: ShareState): UiNode[] {
  const back = button('back', 'menu.back', SHARE_ACTION.back, state.mode === 'paste');
  switch (state.mode) {
    case 'export':
      return [
        ...(state.canCopy ? [button('copyCode', 'share.copyCode', SHARE_ACTION.copyCode, true)] : []),
        ...(state.canCopy && state.canLink ? [button('copyLink', 'share.copyLink', SHARE_ACTION.copyLink)] : []),
        ...(state.canPaste ? [button('paste', 'share.paste', SHARE_ACTION.paste, !state.canCopy)] : []),
        back,
      ];
    case 'paste':
      return [back];
    case 'bot':
      return [button('save', 'share.saveBot', SHARE_ACTION.save, true), back];
    case 'preset':
      return [
        button('play', 'share.play', SHARE_ACTION.play, true),
        ...(state.saved === true ? [] : [button('save', 'share.savePreset', SHARE_ACTION.save)]),
        back,
      ];
    case 'error':
      return [...(state.canPaste ? [button('paste', 'share.pasteAgain', SHARE_ACTION.paste, true)] : []), back];
  }
}

/** Os botões em fileiras de até 2. */
function rowsOf(list: UiNode[]): UiNode[] {
  const rows: UiNode[] = [];
  for (let i = 0; i < list.length; i += 2) {
    rows.push({ kind: 'row', id: `buttons${i / 2}`, gap: 14, children: list.slice(i, i + 2) });
  }
  return rows;
}

export const shareScreen: Screen<ShareState> = {
  id: 'share',
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
          align: 'center',
          width: 900,
          gap: 10,
          children: [
            {
              kind: 'text',
              id: 'title',
              text: { literal: state.title },
              style: 'heading',
              color: state.mode === 'error' ? COLORS.perigo : COLORS.texto,
            },
            { kind: 'box', id: 'headingBar', width: 120, height: 8, color: COLORS.acao, chamfer: true },
            { kind: 'box', height: 6 },
            ...state.lines.map(
              (line, i) =>
                ({
                  kind: 'text',
                  id: `line${i}`,
                  text: { literal: line },
                  style: 'body',
                  color: COLORS.texto,
                  textAlign: 'center',
                }) as UiNode,
            ),
            {
              kind: 'text',
              id: 'note',
              text: { literal: state.note },
              style: 'caption',
              color: COLORS.acao,
              textAlign: 'center',
            },
            { kind: 'box', height: 10 },
            // Até 2 por fileira (4 lado a lado não cabem no celular).
            ...rowsOf(buttons(state)),
          ],
        },
      ],
    };
  },
};
