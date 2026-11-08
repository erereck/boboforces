import type { StringKey } from '../strings.pt-BR.ts';
import { COLORS } from '../tokens.ts';
import type { Screen, UiNode } from '../tree.ts';

/**
 * Tela de título do M0 (arte-ux.md §6.3, versão mínima): logotipo, JOGAR, Ajustes e o rodapé com crédito e versão.
 * Composição à esquerda, como um painel de comando: a direita fica livre para o fundo vitrine do M1 (arte-ux.md §5.6).
 */

export interface TitleState {
  /** `version.json` → `version` (o `game` lê pelo `format`). */
  readonly version: string;
  readonly codename: string;
  /** A plataforma sabe sair (Switch): mostra "Sair". Na web não existe sair (regra 16). */
  readonly canExit?: boolean;
  /**
   * M1 (contrato; desenho da frente ui-fontes): itens extras de teste que a casca pede (Switch: presets do bench,
   * Teste de controles, Teclado, Áudio), como botões secundários à direita (`TITLE_TESTS`). A ação devolvida é
   * `TITLE_ACTION_TEST_PREFIX + id`.
   */
  readonly extraItems?: readonly TitleExtraItem[];
}

/** M1: item extra do título (o `game` recebe da casca por `GameDeps.testItems`). */
export interface TitleExtraItem {
  /** Identificador estável em inglês (`bench`, `controllers`, `keyboard`, `audio`). */
  readonly id: string;
  /** Rótulo pela tabela pt-BR. */
  readonly labelKey: StringKey;
}

/** Ações devolvidas por `navigateMenu` nesta tela. */
export const TITLE_ACTION = { play: 'play', settings: 'settings', quit: 'quit' } as const;
/** M1: prefixo da ação de item extra (`test:bench`). */
export const TITLE_ACTION_TEST_PREFIX = 'test:';

const spacer = (height: number): UiNode => ({ kind: 'box', height });

/**
 * Medidas dos itens de teste (px de referência): botões secundários mais baixos que os do menu (48 ≥ 44), coluna de
 * 330 (o rótulo mais longo da web, CENA-VITRINE, tinha 3 px de folga em 300 com a Russo One). Com mais de
 * `maxColumnItems` itens, eles viram uma grade de `gridColumns` colunas embaixo à direita, `gridBottom` px acima do
 * rodapé (a linha da versão): a coluna única de 9 itens do Switch cobria o logotipo (decisão #54).
 */
export const TITLE_TESTS = {
  width: 330,
  buttonHeight: 48,
  gap: 10,
  maxColumnItems: 4,
  gridColumns: 2,
  gridBottom: -44,
} as const;

function testButton(item: TitleExtraItem): UiNode {
  return {
    kind: 'button',
    id: TITLE_ACTION_TEST_PREFIX + item.id,
    text: { key: item.labelKey },
    action: TITLE_ACTION_TEST_PREFIX + item.id,
    variant: 'secondary',
    width: TITLE_TESTS.width,
    height: TITLE_TESTS.buttonHeight,
  };
}

/**
 * Itens extras de teste (Switch: presets do bench, Controles, Teclado, Áudio; web: Cena-vitrine) à direita, com o
 * rótulo TESTES: não disputam com JOGAR (que segue com o foco inicial) e o D-pad chega neles pela direita. Até
 * `maxColumnItems`, uma coluna centrada na altura; acima disso, a grade de 2 colunas ancorada embaixo à direita, acima
 * da versão. Ids `test:<id>`. Rótulos curtos (`test.item.*`): o botão não tem quebra de linha.
 */
function testItems(items: readonly TitleExtraItem[]): UiNode[] {
  if (items.length === 0) return [];
  const label: UiNode = {
    kind: 'text',
    id: 'testsLabel',
    text: { key: 'title.tests' },
    style: 'label',
    color: COLORS.textoBaixo,
  };
  if (items.length <= TITLE_TESTS.maxColumnItems) {
    return [
      {
        kind: 'column',
        id: 'tests',
        anchor: 'right',
        gap: TITLE_TESTS.gap,
        width: TITLE_TESTS.width,
        children: [label, ...items.map(testButton)],
      },
    ];
  }
  const rows: UiNode[] = [];
  for (let i = 0; i < items.length; i += TITLE_TESTS.gridColumns) {
    rows.push({
      kind: 'row',
      gap: TITLE_TESTS.gap,
      children: items.slice(i, i + TITLE_TESTS.gridColumns).map(testButton),
    });
  }
  return [
    {
      kind: 'column',
      id: 'tests',
      anchor: 'bottomRight',
      y: TITLE_TESTS.gridBottom,
      gap: TITLE_TESTS.gap,
      children: [label, ...rows],
    },
  ];
}

export const titleScreen: Screen<TitleState> = {
  id: 'title',
  build(state) {
    return {
      kind: 'box',
      id: 'root',
      color: COLORS.bunker,
      children: [
        {
          kind: 'column',
          id: 'main',
          anchor: 'left',
          y: -12,
          children: [
            { kind: 'text', id: 'logo', text: { key: 'title.logo' }, style: 'logo', color: COLORS.texto },
            spacer(18),
            { kind: 'box', id: 'logoBar', width: 176, height: 10, color: COLORS.acao, chamfer: true },
            spacer(56),
            {
              kind: 'column',
              id: 'buttons',
              gap: 14,
              align: 'stretch',
              width: 380,
              children: [
                {
                  kind: 'button',
                  id: 'play',
                  text: { key: 'menu.play' },
                  action: TITLE_ACTION.play,
                  variant: 'primary',
                  autofocus: true,
                },
                {
                  kind: 'button',
                  id: 'settings',
                  text: { key: 'menu.settings' },
                  action: TITLE_ACTION.settings,
                  variant: 'secondary',
                },
                ...(state.canExit === true
                  ? [
                      {
                        kind: 'button',
                        id: 'quit',
                        text: { key: 'menu.quit' },
                        action: TITLE_ACTION.quit,
                        variant: 'secondary',
                      } as const,
                    ]
                  : []),
              ],
            },
          ],
        },
        ...testItems(state.extraItems ?? []),
        {
          kind: 'text',
          id: 'credit',
          anchor: 'bottomLeft',
          text: { key: 'title.credit' },
          style: 'caption',
          color: COLORS.textoBaixo,
        },
        {
          kind: 'text',
          id: 'version',
          anchor: 'bottomRight',
          text: { key: 'title.version', params: { version: state.version, codename: state.codename } },
          style: 'caption',
          color: COLORS.textoBaixo,
        },
      ],
    };
  },
};
