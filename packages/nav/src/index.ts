// @boboforces/nav: navegação 2,5D sobre a grade de 0,5 m (tecnico.md §8.1): nós nos cantos (2×2 células = 1,0 m),
// A* com orçamento de nós por tick, flow field multi-fonte e pontos táticos, pré-calculados no build.
// M0: só o contrato. No M0 os bots andam direto até o alvo, sem navegação (PLANO_M0, área `ai`). Implementação no M1.
import type { WorldGrid } from '@boboforces/world';

/** Células por lado de um nó de navegação (1,0 m: um bobo de 0,6 m cabe, e uma porta de 1,0 m tem 1 nó no meio). */
export const NAV_NODE_CELLS = 2;

/** Índice de nó; -1 = nenhum. */
export type NavNode = number;

export const NO_NAV_NODE: NavNode = -1;

/** Grafo de navegação de um mapa (sai do `.bfmap`). Orçamentos em unidades de trabalho, nunca em ms (regra 10). */
export interface NavGraph {
  readonly nodeCount: number;
  /** Nó livre mais próximo de um ponto em metros ("destravar" e bot parado há 8 s). */
  nearestNode(x: number, y: number, z: number): NavNode;
  /** Centro do nó em metros, escrito em `out` (x, y, z). */
  nodePosition(node: NavNode, out: Float64Array): void;
}

export function buildNavGraph(grid: WorldGrid): NavGraph {
  void grid;
  throw new Error('M1: navegação ainda não implementada');
}
