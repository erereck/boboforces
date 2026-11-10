// @boboforces/nav: navegação 2,5D sobre a grade de 0,5 m (tecnico.md §8.1). CONTRATO DO M1; implementação da frente
// "mapa-nav" (`build.ts`: grade e ligações; `search.ts`: A* com orçamento e suavização). Puro e determinístico
// (regra 10), sem alocação no laço quente (regra 11).
//
// Grade de nós de 1,0 m (2×2 células): cada coluna de nós pode ter vários SPANS andáveis (térreo, mezanino, telhado):
// piso sólido embaixo (cubo, laje, degrau ou rampa, pelo `shapeFloorHeight` do world) e altura livre em cima (em pé ou
// só agachado). Ligações: andar com degrau de até `stepHeight`, pulo até `jumpHeight`, queda até `maxDrop`. Props com
// `blocksNav` marcam os nós que ocupam. No M1 a grade é montada no LOADING (rápido: o Construto tem 80×80 colunas) e
// pelo `mapc` (validação de spawns alcançáveis); a seção 'NAV ' do `.bfmap` fica reservada.
import type { BlockRegistry, StaticColliders, WorldGrid } from '@boboforces/world';
import { buildNavGridImpl, type NavGridImpl } from './build.ts';
import { NO_NAV_NODE, type NavNode } from './constants.ts';
import { FlowFieldImpl } from './flow.ts';
import { createNavPathImpl, findPathImpl, type NavPathImpl } from './search.ts';

export { MAX_NAV_GATES, NAV_GATE_BLOCK, NAV_LINK, NAV_NODE_CELLS, NAV_NODE_SIZE_M, NO_NAV_NODE } from './constants.ts';
export type { NavLinkKind, NavNode } from './constants.ts';
export { NAV_COST, type NavGridImpl } from './build.ts';
export { SEARCH_SLOTS, SMOOTH_LOOKAHEAD } from './search.ts';
export { FLOW_TARGET_MARGIN } from './flow.ts';

/**
 * Medidas do corpo que a navegação respeita. Vêm da tabela única de métricas da sim (`BOBO_NAV_METRICS` em
 * `@boboforces/sim`); o nav não importa a sim (a sim importa o nav).
 */
export interface NavMetrics {
  /** Altura em pé e agachado (m): 1,75 e 0,95. */
  readonly height: number;
  readonly crouchHeight: number;
  /** Meia largura da AABB (m): 0,3. */
  readonly radius: number;
  /** Degrau automático (m): 0,5. */
  readonly stepHeight: number;
  /** Altura alcançada no pulo padrão (m): 1,0. */
  readonly jumpHeight: number;
  /** Maior queda que a IA aceita (m): 3,0. */
  readonly maxDrop: number;
}

/** O que a navegação lê do mapa. */
export interface NavWorld {
  readonly grid: WorldGrid;
  readonly blocks: BlockRegistry;
  /** Caixas das props (as com `COLLIDER_FLAG.solid` bloqueiam nós); ausente = nenhuma. */
  readonly colliders?: StaticColliders | null;
}

/**
 * Grafo de navegação de um mapa. Estático (cenário estático, decisão #4); portas do Zombies ligam/desligam links no M3.
 * Os campos em typed arrays são SOMENTE LEITURA para quem consome.
 */
export interface NavGrid {
  /** Colunas de nós em X e Z (ceil(células / 2)). */
  readonly columnsX: number;
  readonly columnsZ: number;
  /** Total de nós (spans). */
  readonly nodeCount: number;
  /** Altura do piso de cada nó, em metros. */
  readonly floorY: Float32Array;
  /** 1 = cabe em pé; 2 = só agachado. */
  readonly clearance: Uint8Array;
  /** Componente conexo de cada nó (mesmo número = um alcança o outro, seguindo as ligações nos dois sentidos). */
  readonly component: Uint16Array;
  /** Nó mais próximo de um ponto em metros (pés), procurando no máximo 2 m em volta; `NO_NAV_NODE` se nenhum. */
  nearestNode(x: number, y: number, z: number): NavNode;
  /** Centro do nó em metros (pés), escrito em `out[offset..offset+2]`. */
  nodePosition(node: NavNode, out: Float32Array | Float64Array, offset?: number): void;
  /**
   * M3 (fase 3d): prende ao portão `g` (0..count-1, até `MAX_NAV_GATES`) as ligações que atravessam a caixa `g`
   * (`boxes[g*6..]`: minX, minY, minZ, maxX, maxY, maxZ em metros) e solta todos (bloqueio 0). Na criação da sim.
   */
  assignGates(boxes: Float32Array, count: number): void;
  /** M3 (fase 3d): quem não passa pelo portão `g` (bits de `NAV_GATE_BLOCK`; 0 = todos passam). */
  setGateBlock(gate: number, block: number): void;
}

/** Monta a grade de navegação a partir do mundo. Só no loading e no `mapc`. */
export function buildNavGrid(world: NavWorld, metrics: NavMetrics): NavGrid {
  return buildNavGridImpl(world, metrics);
}

/** Os dois nós se alcançam (O(1), pelos componentes; ligações de queda contam nos dois sentidos para isto). */
export function isReachable(nav: NavGrid, from: NavNode, to: NavNode): boolean {
  if (from === NO_NAV_NODE || to === NO_NAV_NODE) return false;
  return nav.component[from] === nav.component[to];
}

/** Estado de um pedido de caminho. */
export type PathStatus = 'idle' | 'pending' | 'found' | 'unreachable';

/**
 * Caminho e estado do A* de UM pedido, pré-alocados (`createNavPath`), para o A* ser fatiado entre frames sem
 * alocar: `findPath` com os mesmos `from`/`to` e o mesmo `out` continua de onde parou; com outros, recomeça.
 */
export interface NavPath {
  readonly capacity: number;
  status: PathStatus;
  readonly from: NavNode;
  readonly to: NavNode;
  /** Nós do início ao fim (`length` válidos). */
  readonly nodes: Int32Array;
  length: number;
  /** Pontos suavizados por linha de visada (3 floats por ponto, metros, pés), do início ao fim. */
  readonly points: Float32Array;
  pointCount: number;
  /** Tipo da ligação que CHEGA a cada ponto (`NAV_LINK`), para a IA pular ou agachar. */
  readonly pointLinks: Uint8Array;
}

/**
 * Aloca um caminho com o estado do A* para `nav` (no loading, um por bot). `capacity` = nós no caminho (padrão 256).
 * Implementação: o caminho guarda só o resultado; as áreas de trabalho do A* são um pool da grade (`SEARCH_SLOTS`),
 * pego no começo da busca e devolvido no fim (ver `search.ts`). Caminho maior que `capacity` guarda o começo.
 */
export function createNavPath(nav: NavGrid, capacity?: number): NavPath {
  return createNavPathImpl(nav as NavGridImpl, capacity);
}

/**
 * A* com heurística octile e ORÇAMENTO: expande no máximo `budget` nós nesta chamada (regra 10: orçamento em trabalho,
 * nunca em ms). Devolve o status, também gravado em `out.status`: `pending` = chame de novo no próximo frame;
 * `found` = `out.nodes`/`out.points` prontos; `unreachable` = sem caminho (o diretor de IA tenta outro alvo).
 * Sem alocação. `pending` também quer dizer "na fila": com as `SEARCH_SLOTS` áreas do A* ocupadas, a chamada espera
 * sem trabalho.
 */
export function findPath(nav: NavGrid, from: NavNode, to: NavNode, out: NavPath, budget: number): PathStatus {
  return findPathImpl(nav as NavGridImpl, from, to, out as NavPathImpl, budget);
}

/**
 * M3 (fase 3c): campo de direções compartilhado (flow field): um Dijkstra de várias fontes sobre as ligações ao
 * contrário. Para cada nó, o próximo nó do caminho mais curto até a fonte mais perto (os bobos de pé, para os zumbis).
 * Fatiado por orçamento e com buffer duplo: o campo pronto vale até o próximo terminar. Ver `flow.ts`.
 */
export interface FlowField {
  /** Campos que já ficaram prontos (0 = nenhum: quem consome usa outro jeito, como o A*). */
  readonly ready: number;
  /** Um cálculo está em andamento (nas costas do campo pronto). */
  readonly building: boolean;
  /** Próximo nó rumo à fonte mais perto, no campo pronto; `NO_NAV_NODE` = é fonte, sem caminho ou nenhum campo. */
  next(node: NavNode): NavNode;
  /** Ligação de `node` até `next(node)` (`NAV_LINK`), para pular ou agachar. */
  link(node: NavNode): number;
  /** Custo (metros equivalentes, como o do A*) até a fonte mais perto; `Infinity` = sem caminho. */
  distance(node: NavNode): number;
  /** Começa outro cálculo, sem fontes (o campo pronto continua valendo até este terminar). */
  begin(): void;
  /** Fonte do cálculo em andamento (custo 0). */
  addSource(node: NavNode): void;
  /**
   * Nó que precisa ficar no campo (o de cada zumbi). Com alvos, o cálculo para quando todos fecharam, mais uma folga
   * (`FLOW_TARGET_MARGIN`), em vez de cobrir o mapa todo; sem nenhum, cobre tudo o que alcança.
   */
  addTarget(node: NavNode): void;
  /** Avança o cálculo fechando até `budget` nós; devolve `true` ao terminar (o novo campo passa a valer). */
  run(budget: number): boolean;
}

/** Cria o flow field de `nav` (no loading: aloca as ligações invertidas e os dois buffers). */
export function createFlowField(nav: NavGrid): FlowField {
  return new FlowFieldImpl(nav as NavGridImpl);
}
