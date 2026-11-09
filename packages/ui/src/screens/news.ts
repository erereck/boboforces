import type { StringKey } from '../strings.pt-BR.ts';
import { COLORS } from '../tokens.ts';
import type { Screen, UiNode } from '../tree.ts';

/**
 * M2 (fase 4g): Novidades (arte-ux.md §6.12, como no futbobo: "sem parede de patch note"): o codinome da versão, até 5
 * itens de 1 linha e, quando o save foi atualizado de formato, uma linha avisando. Aparece uma vez depois de atualizar
 * e fica no menu principal.
 */
export const NEWS_ACTION = { ok: 'ok' } as const;

/** Os itens da versão atual (trocam a cada versão; no máximo 5). */
export const NEWS_ITEMS: readonly StringKey[] = [
  'news.item.1',
  'news.item.2',
  'news.item.3',
  'news.item.4',
  'news.item.5',
];

export interface NewsState {
  readonly version: string;
  readonly codename: string;
  readonly items: readonly StringKey[];
  /** "3 itens do save foram atualizados…"; `''` = nada migrado. */
  readonly migrated: string;
}

export const newsScreen: Screen<NewsState> = {
  id: 'news',
  build(s) {
    const items: UiNode[] = s.items.slice(0, 5).map((key, i) => ({
      kind: 'row',
      id: `item${i}`,
      gap: 14,
      align: 'center',
      children: [
        { kind: 'box', width: 10, height: 10, color: COLORS.acao },
        { kind: 'text', id: `itemText${i}`, text: { key }, style: 'body', color: COLORS.texto },
      ],
    }));
    return {
      kind: 'box',
      id: 'root',
      color: COLORS.bunker,
      children: [
        {
          kind: 'column',
          id: 'main',
          anchor: 'left',
          children: [
            { kind: 'text', id: 'newsHeading', text: { key: 'menu.news' }, style: 'title', color: COLORS.texto },
            { kind: 'box', height: 16 },
            { kind: 'box', id: 'headingBar', width: 120, height: 8, color: COLORS.acao, chamfer: true },
            { kind: 'box', height: 20 },
            {
              kind: 'text',
              id: 'version',
              text: { key: 'news.version', params: { version: s.version, codename: s.codename } },
              style: 'label',
              color: COLORS.textoBaixo,
            },
            { kind: 'box', height: 16 },
            { kind: 'column', id: 'items', gap: 12, children: items },
            ...(s.migrated !== ''
              ? [
                  { kind: 'box', height: 16 } as UiNode,
                  {
                    kind: 'text',
                    id: 'migrated',
                    text: { literal: s.migrated },
                    style: 'caption',
                    color: COLORS.acao,
                  } as UiNode,
                ]
              : []),
            { kind: 'box', height: 28 },
            {
              kind: 'button',
              id: 'ok',
              text: { key: 'news.ok' },
              action: NEWS_ACTION.ok,
              variant: 'primary',
              autofocus: true,
            },
          ],
        },
      ],
    };
  },
};
