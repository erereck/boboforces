import type { StringKey } from '../strings.pt-BR.ts';
import { COLORS } from '../tokens.ts';
import type { Screen, UiNode } from '../tree.ts';

/**
 * M2 (fase 5a): a Oficina (gameplay.md §6.7), a entrada do Laboratório: à esquerda, a biblioteca numa coluna com
 * rolagem (favoritos, os seus e os de fábrica; o escolhido em âmbar); à direita, o card do bot escolhido com toda regra
 * ativa à vista (§6.5) e as ações. Todo texto vem montado do `game`.
 */
export const WORKSHOP_ACTION = {
  edit: 'edit',
  duplicate: 'duplicate',
  favorite: 'favorite',
  delete: 'delete',
  back: 'back',
} as const;

/** Ação de um bot da lista: `bot:<grupo>:<id>` (o mesmo bot pode estar nos favoritos e no grupo dele). */
export const WORKSHOP_BOT_PREFIX = 'bot:';

export interface WorkshopGroup {
  readonly id: string;
  readonly titleKey: StringKey;
  readonly items: readonly { readonly id: string; readonly label: string }[];
  /** Texto quando o grupo está vazio (`''` = o grupo some). */
  readonly empty: string;
}

export interface WorkshopState {
  readonly groups: readonly WorkshopGroup[];
  /** O bot escolhido (id); o card mostra ele. */
  readonly selected: string;
  readonly name: string;
  readonly lines: readonly string[];
  /** Aviso de uma linha em âmbar (`''` = nenhum). */
  readonly note: string;
  readonly canEdit: boolean;
  readonly canDelete: boolean;
  readonly favorite: boolean;
  /** Apagar pede confirmação: o botão vira "Confirmar". */
  readonly confirmDelete: boolean;
}

/** Medidas (px de referência): a lista e o card. */
export const WORKSHOP_LAYOUT = {
  listWidth: 480,
  listHeight: 470,
  cardWidth: 600,
  cardHeight: 520,
  actionWidth: 280,
} as const;

/** O id do botão do escolhido na lista (a primeira vez que ele aparece: nos favoritos, se estiver lá). */
function selectedNodeId(state: WorkshopState): string | null {
  for (const g of state.groups) {
    if (g.items.some((i) => i.id === state.selected)) return `${WORKSHOP_BOT_PREFIX}${g.id}:${state.selected}`;
  }
  return null;
}

function list(state: WorkshopState): UiNode[] {
  // Da lista, a direita entra no card pela primeira ação (sem depender da altura do bot na lista).
  const firstAction = state.canEdit ? 'edit' : 'duplicate';
  const nodes: UiNode[] = [];
  for (const g of state.groups) {
    if (g.items.length === 0 && g.empty === '') continue;
    nodes.push({
      kind: 'text',
      id: `group:${g.id}`,
      text: { key: g.titleKey },
      style: 'label',
      color: COLORS.textoBaixo,
    });
    if (g.items.length === 0) {
      nodes.push({
        kind: 'text',
        id: `empty:${g.id}`,
        text: { literal: g.empty },
        style: 'caption',
        color: COLORS.textoBaixo,
      });
    }
    for (const item of g.items) {
      const id = `${WORKSHOP_BOT_PREFIX}${g.id}:${item.id}`;
      nodes.push({
        kind: 'button',
        id,
        text: { literal: item.label },
        action: id,
        variant: item.id === state.selected ? 'primary' : 'secondary',
        width: WORKSHOP_LAYOUT.listWidth,
        // Compacto: o nome do bot (até 24 letras, em caixa alta) cabe na lista.
        compact: true,
        focusOverride: { right: firstAction },
        ...(item.id === state.selected ? { autofocus: true } : {}),
      });
    }
  }
  return nodes;
}

export const workshopScreen: Screen<WorkshopState> = {
  id: 'workshop',
  build(state) {
    // Duas fileiras compactas (cabem no card do 640×360): Editar e Duplicar; Favoritar e Apagar.
    // A esquerda das ações da ponta volta ao bot escolhido na lista.
    const back = selectedNodeId(state);
    const button = (id: string, key: StringKey, action: string, danger = false, leftmost = false): UiNode => ({
      kind: 'button',
      id,
      text: { key },
      action,
      variant: danger ? 'danger' : 'secondary',
      compact: true,
      width: WORKSHOP_LAYOUT.actionWidth,
      ...(leftmost && back !== null ? { focusOverride: { left: back } } : {}),
    });
    const top: UiNode[] = [
      ...(state.canEdit ? [button('edit', 'workshop.edit', WORKSHOP_ACTION.edit, false, true)] : []),
      button('duplicate', 'workshop.duplicate', WORKSHOP_ACTION.duplicate, false, !state.canEdit),
    ];
    const bottom: UiNode[] = [
      button(
        'favorite',
        state.favorite ? 'workshop.unfavorite' : 'workshop.favorite',
        WORKSHOP_ACTION.favorite,
        false,
        true,
      ),
      ...(state.canDelete
        ? [
            button(
              'delete',
              state.confirmDelete ? 'workshop.confirmDelete' : 'workshop.delete',
              WORKSHOP_ACTION.delete,
              true,
            ),
          ]
        : []),
    ];
    return {
      kind: 'box',
      id: 'root',
      color: COLORS.bunker,
      children: [
        {
          kind: 'column',
          id: 'main',
          anchor: 'topLeft',
          children: [
            { kind: 'text', id: 'heading', text: { key: 'workshop.title' }, style: 'heading', color: COLORS.texto },
            { kind: 'box', height: 12 },
            { kind: 'box', id: 'headingBar', width: 120, height: 8, color: COLORS.acao, chamfer: true },
            { kind: 'box', height: 16 },
            {
              kind: 'column',
              id: 'bots',
              scroll: true,
              gap: 8,
              width: WORKSHOP_LAYOUT.listWidth,
              height: WORKSHOP_LAYOUT.listHeight,
              children: list(state),
            },
          ],
        },
        {
          kind: 'column',
          id: 'card',
          anchor: 'topRight',
          // Com rolagem: nas telas pequenas (toque) o card mais cheio não desce até o Voltar.
          scroll: true,
          gap: 8,
          width: WORKSHOP_LAYOUT.cardWidth,
          height: WORKSHOP_LAYOUT.cardHeight,
          children: [
            // O nome como o jogador escreveu, na fonte do HUD (a display só tem maiúsculas no atlas): 24 letras cabem.
            {
              kind: 'text',
              id: 'cardName',
              text: { literal: state.name },
              style: 'heading',
              font: 'hud',
              size: 44,
              uppercase: false,
              color: COLORS.texto,
            },
            ...state.lines.map(
              (line, i) =>
                ({
                  kind: 'text',
                  id: `cardLine${i}`,
                  text: { literal: line },
                  style: 'body',
                  color: COLORS.texto,
                }) as UiNode,
            ),
            {
              kind: 'text',
              id: 'note',
              text: { literal: state.note },
              style: 'caption',
              color: COLORS.acao,
            },
            { kind: 'box', height: 8 },
            {
              kind: 'column',
              id: 'actions',
              gap: 10,
              children: [
                { kind: 'row', id: 'actionsTop', gap: 12, children: top },
                { kind: 'row', id: 'actionsBottom', gap: 12, children: bottom },
              ],
            },
          ],
        },
        {
          kind: 'row',
          id: 'buttons',
          anchor: 'bottomRight',
          gap: 14,
          children: [
            {
              kind: 'button',
              id: 'back',
              text: { key: 'menu.back' },
              action: WORKSHOP_ACTION.back,
              variant: 'secondary',
            },
          ],
        },
      ],
    };
  },
};
