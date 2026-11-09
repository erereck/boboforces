import type { StringKey } from './strings.pt-BR.ts';
import type { TextParams } from './text.ts';
import type { FontRole, TypeToken } from './tokens.ts';

export type { FontRole } from './tokens.ts';

/**
 * Árvore de UI (tecnico.md §9): telas são funções `estado → árvore`; o layout (`layoutTree`) resolve âncoras, linhas,
 * colunas e safe area; o foco (`moveFocus`) anda pelo vizinho mais próximo na direção (D-pad + confirmar/voltar
 * bastam: regra 12); `drawTree` gera a `DrawList`. Pacote puro, testável em Node.
 *
 * Medidas dos nós em px de REFERÊNCIA (1280×720); o layout multiplica pela escala da viewport.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Margens (safe area) em px reais. */
export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export type Anchor =
  'topLeft' | 'top' | 'topRight' | 'left' | 'center' | 'right' | 'bottomLeft' | 'bottom' | 'bottomRight';

/** Alinhamento dos filhos no eixo cruzado de uma linha/coluna. */
export type CrossAlign = 'start' | 'center' | 'end' | 'stretch';

/** Texto sempre por chave da tabela; `literal` só para dado do jogador (nome de bot, de preset). */
export type TextContent = { readonly key: StringKey; readonly params?: TextParams } | { readonly literal: string };

interface NodeBase {
  /** Id estável dentro da tela (foco, testes, exceções de navegação). */
  readonly id?: string;
  /** Posição dentro de um pai `box` (ou da tela). Em linha/coluna vale a ordem, não a âncora. */
  readonly anchor?: Anchor;
  /** Deslocamento a partir da âncora, em px de referência (x + = direita, y + = baixo). */
  readonly x?: number;
  readonly y?: number;
  /** Tamanho fixo em px de referência; sem ele, o nó mede o próprio conteúdo. */
  readonly width?: number;
  readonly height?: number;
  readonly padding?: number;
  readonly gap?: number;
}

export interface BoxNode extends NodeBase {
  readonly kind: 'box';
  readonly color?: number;
  /** Contorno (cor e espessura em px de referência). */
  readonly borderColor?: number;
  readonly border?: number;
  /** Chanfro de 45° no canto superior direito (assinatura de cards). */
  readonly chamfer?: boolean;
  /** Faixa zebrada diagonal (só avisos e "sair da partida"). */
  readonly stripes?: boolean;
  readonly children?: readonly UiNode[];
}

export interface StackNode extends NodeBase {
  readonly kind: 'row' | 'column';
  /** Alinhamento dos filhos no eixo cruzado (padrão `start`). */
  readonly align?: CrossAlign;
  /**
   * M2 (fase 4a): coluna com rolagem (precisa de `height` e de `id`): a janela segue o foco com o menor deslocamento,
   * o que sai dela é recortado e não recebe toque, e uma barrinha à direita mostra onde está. Só coluna, sem aninhar.
   */
  readonly scroll?: boolean;
  readonly children: readonly UiNode[];
}

export interface TextNode extends NodeBase {
  readonly kind: 'text';
  readonly text: TextContent;
  /** Estilo da escala tipográfica (padrão `body`); `font`, `size`, `tracking` e `uppercase` sobrescrevem. */
  readonly style?: TypeToken;
  readonly font?: FontRole;
  /** Tamanho da fonte (em) em px de referência. */
  readonly size?: number;
  readonly tracking?: number;
  readonly uppercase?: boolean;
  readonly color?: number;
  /** Alinhamento horizontal dentro da caixa (quando `width` é maior que o texto). */
  readonly textAlign?: 'left' | 'center' | 'right';
}

/** `tab`: aba de uma barra de abas (M2, fase 4a); a selecionada ganha `selected`. */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'tab';

export interface ButtonNode extends NodeBase {
  readonly kind: 'button';
  readonly text: TextContent;
  /** Id da ação devolvida ao confirmar (a tela decide o que fazer). */
  readonly action: string;
  readonly variant?: ButtonVariant;
  readonly disabled?: boolean;
  /** Foco inicial da tela. */
  readonly autofocus?: boolean;
  /**
   * M2 (fase 4a): linha de opção: o rótulo à esquerda e este valor à direita, entre setas ("◀ Normal ▶"). Com o foco,
   * esquerda e direita mudam o valor (`MenuNavigation.delta` ∓1) em vez de mover o foco; no toque e no mouse, as setas.
   * Serve de seletor, alternador (Sim/Não) e passo numérico: quem muda o valor é a tela, ao receber a ação.
   */
  readonly value?: TextContent;
  /** Largura da área do valor (setas incluídas), em px de referência (padrão `OPTION.valueWidth`). */
  readonly valueWidth?: number;
  /**
   * M2 (fase 4f): o valor é só para ler (sem setas; esquerda e direita movem o foco, confirmar ativa): a linha de um
   * botão remapeável ("PULAR · Espaço").
   */
  readonly valueOnly?: boolean;
  /** M2 (fase 6c): quadradinho de cor (RGB, `0xRRGGBB`) antes do valor (as cores do Meu Bobo). */
  readonly swatch?: number;
  /** M2 (fase 4a): aba selecionada (variante `tab`). */
  readonly selected?: boolean;
  /** M2 (fase 4e): botão compacto (texto menor, 48 de altura, sem largura mínima): abas e barras de ferramentas. */
  readonly compact?: boolean;
  /** Exceções de foco declaradas: id do vizinho por direção. */
  readonly focusOverride?: Readonly<Partial<Record<'up' | 'down' | 'left' | 'right', string>>>;
}

export interface SpriteNode extends NodeBase {
  readonly kind: 'sprite';
  readonly sprite: string;
  readonly color?: number;
}

export type UiNode = BoxNode | StackNode | TextNode | ButtonNode | SpriteNode;

/** Uma tela: função pura do estado para a árvore. */
export interface Screen<S> {
  readonly id: string;
  build(state: Readonly<S>): UiNode;
}
