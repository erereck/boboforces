import type { StringKey } from '../strings.pt-BR.ts';
import { COLORS } from '../tokens.ts';
import type { Screen, UiNode } from '../tree.ts';

/**
 * Tela de título (arte-ux.md §6.3): logotipo, JOGAR (com o resumo do preset que ele vai jogar embaixo) e o rodapé com
 * crédito e versão. Composição à esquerda, como um painel de comando: a direita fica livre para o fundo vitrine
 * (arte-ux.md §5.6). Refino R3b (#79): o título é o centro de tudo, sem o "Mudar" e o menu principal no meio do
 * caminho: JOGAR, Modos (o lugar de escolher o que jogar), Jogar no sofá, Meu Bobo, Laboratório, Ajustes e, no Switch,
 * Sair. A Novidades foi para Ajustes → Sobre; o Surpreenda-me e a Partida personalizada, para os Modos.
 */

export interface TitleState {
  /** `version.json` → `version` (o `game` lê pelo `format`). */
  readonly version: string;
  readonly codename: string;
  /**
   * M2 (fase 4c): o que o JOGAR vai jogar ("Times · De boa · 4 contra 4 · Construto"): o último preset ou a partida de
   * estreia. Texto já montado pelo `game`; ausente = sem linha.
   */
  readonly playSummary?: string;
  /** A plataforma sabe sair (Switch): mostra "Sair". Na web não existe sair (regra 16). */
  readonly canExit?: boolean;
  /**
   * M1 (contrato; desenho da frente ui-fontes): itens extras de teste que a casca pede (Switch: presets do bench,
   * Teste de controles, Teclado, Áudio), como botões secundários à direita (`TITLE_TESTS`). A ação devolvida é
   * `TITLE_ACTION_TEST_PREFIX + id`.
   */
  readonly extraItems?: readonly TitleExtraItem[];
  /** M5 (fase 4c): a casca tem online (só a web): o botão Online ao lado de Modos (O4). */
  readonly online?: boolean;
  /**
   * M11 (fase 5, revisão): um aviso no lugar do resumo do JOGAR, em destaque (a partida que este aparelho recusou: "Este
   * modo só roda no PC."). Texto já montado pelo `game`; a mesma linha, então o título não muda de altura.
   */
  readonly note?: string;
}

/** M1: item extra do título (o `game` recebe da casca por `GameDeps.testItems`). */
export interface TitleExtraItem {
  /** Identificador estável em inglês (`bench`, `controllers`, `keyboard`, `audio`). */
  readonly id: string;
  /** Rótulo pela tabela pt-BR. */
  readonly labelKey: StringKey;
}

/** Ações devolvidas por `navigateMenu` nesta tela. */
export const TITLE_ACTION = {
  play: 'play',
  modes: 'modes',
  /** M5 (fase 4c): o Online (a casca carrega o pedaço dele ao abrir). */
  online: 'online',
  couch: 'couch',
  bobo: 'bobo',
  lab: 'lab',
  settings: 'settings',
  /** Refino R3b (#79): os itens de teste numa tela própria (`testListScreen`). */
  tests: 'tests',
  quit: 'quit',
} as const;

/** Refino R3b (#79): os botões do título depois do JOGAR, na ordem (jogar, personalizar, ajustar). */
const TITLE_ITEMS = [
  ['modes', 'menu.modes'],
  ['couch', 'menu.couchShort'],
  ['bobo', 'menu.bobo'],
  ['lab', 'menu.lab'],
  ['settings', 'menu.settings'],
] as const satisfies readonly (readonly [keyof typeof TITLE_ACTION, StringKey])[];
/** M1: prefixo da ação de item extra (`test:bench`). */
export const TITLE_ACTION_TEST_PREFIX = 'test:';

const spacer = (height: number): UiNode => ({ kind: 'box', height });

/** Refino R3b (#79): a grade dos botões do título depois do JOGAR (px de referência). */
export const TITLE_GRID = { columns: 2, button: 300, gap: 10 } as const;

function gridRows(items: readonly { readonly id: keyof typeof TITLE_ACTION; readonly key: StringKey }[]): UiNode[] {
  const rows: UiNode[] = [];
  for (let i = 0; i < items.length; i += TITLE_GRID.columns) {
    rows.push({
      kind: 'row',
      id: `titleRow${i / TITLE_GRID.columns}`,
      gap: TITLE_GRID.gap,
      children: items.slice(i, i + TITLE_GRID.columns).map(
        (it) =>
          ({
            kind: 'button',
            id: it.id,
            text: { key: it.key },
            action: TITLE_ACTION[it.id],
            variant: 'secondary',
            width: TITLE_GRID.button,
          }) as UiNode,
      ),
    });
  }
  return rows;
}

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

/** Refino R3b (#79): estado da tela de testes (os mesmos itens extras da casca). */
export interface TestListState {
  readonly items: readonly TitleExtraItem[];
}

/** Ação de voltar da tela de testes (os itens devolvem `test:<id>`). */
export const TEST_LIST_ACTION = { back: 'back' } as const;

/**
 * Refino R3b (#79): os itens extras de teste (Switch: presets do bench, Controles, Teclado, Áudio; web: Cena-vitrine)
 * numa tela própria, aberta pelo botão TESTES do título: até `maxColumnItems` numa coluna, acima disso numa grade de
 * `gridColumns` colunas. Ids `test:<id>`. Rótulos curtos (`test.item.*`): o botão não tem quebra de linha.
 */
export const testListScreen: Screen<TestListState> = {
  id: 'testList',
  build(state) {
    const items = state.items;
    const buttons = items.map(
      (item, i) => (i === 0 ? { ...testButton(item), autofocus: true } : testButton(item)) as UiNode,
    );
    const rows: UiNode[] = [];
    if (items.length <= TITLE_TESTS.maxColumnItems) rows.push(...buttons);
    else {
      for (let i = 0; i < buttons.length; i += TITLE_TESTS.gridColumns) {
        rows.push({ kind: 'row', gap: TITLE_TESTS.gap, children: buttons.slice(i, i + TITLE_TESTS.gridColumns) });
      }
    }
    return {
      kind: 'box',
      id: 'root',
      color: COLORS.bunker,
      children: [
        {
          kind: 'column',
          id: 'main',
          anchor: 'left',
          gap: TITLE_TESTS.gap,
          children: [
            { kind: 'text', id: 'heading', text: { key: 'title.tests' }, style: 'title', color: COLORS.texto },
            spacer(8),
            { kind: 'column', id: 'tests', gap: TITLE_TESTS.gap, children: rows },
            spacer(8),
            {
              kind: 'button',
              id: 'back',
              text: { key: 'menu.back' },
              action: TEST_LIST_ACTION.back,
              variant: 'secondary',
              ...(items.length === 0 ? { autofocus: true } : {}),
            },
          ],
        },
      ],
    };
  },
};

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
            spacer(30),
            {
              kind: 'column',
              id: 'buttons',
              gap: 10,
              align: 'stretch',
              width: TITLE_GRID.columns * TITLE_GRID.button + TITLE_GRID.gap,
              children: [
                {
                  kind: 'button',
                  id: 'play',
                  text: { key: 'menu.play' },
                  action: TITLE_ACTION.play,
                  variant: 'primary',
                  autofocus: true,
                },
                ...(state.note || state.playSummary
                  ? [
                      {
                        kind: 'text',
                        id: 'playSummary',
                        text: { literal: state.note || state.playSummary || '' },
                        style: 'caption',
                        color: state.note ? COLORS.perigo : COLORS.textoBaixo,
                      } as const,
                    ]
                  : []),
                // Refino R3b (#79): o resto numa grade de 2 colunas (6 botões em coluna não cabiam embaixo do logo).
                ...gridRows([
                  ...TITLE_ITEMS.slice(0, 1).map(([id, key]) => ({ id, key }) as const),
                  ...(state.online === true ? [{ id: 'online', key: 'menu.online' } as const] : []),
                  ...TITLE_ITEMS.slice(1).map(([id, key]) => ({ id, key }) as const),
                  ...((state.extraItems ?? []).length > 0 ? [{ id: 'tests', key: 'title.tests' } as const] : []),
                  ...(state.canExit === true ? [{ id: 'quit', key: 'menu.quit' } as const] : []),
                ]),
              ],
            },
          ],
        },
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
