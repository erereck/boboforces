import type { NavGrid, NavGridImpl } from '@boboforces/nav';
import { AI_SOLDIER } from './config.ts';

/**
 * Os LUGARES da navegação, para o passeio que sobe (`pickUpperGoal` do soldado). Lugar = piso plano: os nós em pé
 * ligados entre si sem degrau maior que `AI_SOLDIER.upperPlaceStepM` (o lance de escada e a rampa ficam de fora: cada
 * degrau de 0,5 m separa), com pelo menos `upperPlaceMinNodes` nós, 2 colunas em X e 2 em Z (a fila de 1 nó em cima
 * de um fardo ou de uma viga não é lugar) e pelo menos `upperPlaceMinNodes` nós dentro da área jogável (a beirada de
 * fora do mapa não gasta o sorteio). O soldado sorteia primeiro o lugar e depois o nó dentro dele: o lugar pequeno
 * tem a mesma vez que o grande.
 *
 * M10 (fase 1c) sorteava por ANDAR (faixas de 3 m acima do piso mais baixo). M11 (fase 2): a faixa não separa o que
 * importa. Na Estação Lunar, o deque da antena (16 nós, a 3 m do chão) cai na mesma faixa do anel da estação (a 4 m;
 * 623 nós na faixa) e quase nunca era sorteado; no Galpão, a passarela e, no Construto, o 1º andar dos Prédios de Teste
 * (2,75 m acima do chão) caem na faixa do chão e nunca eram sorteados como lugar alto.
 *
 * O `component` da navegação conta as quedas nos dois sentidos: o teto da cabine da torre do Construto (de onde só se
 * cai) é do mesmo componente que o chão, e o A* sem caminho varre a área toda antes de desistir. Por isso o índice só
 * guarda, de cada componente, os nós do maior componente FORTEMENTE conexo dele (o "grupo principal": dali se vai e se
 * volta pelas ligações no sentido certo; Tarjan iterativo). Navegação sem as ligações à vista (outra implementação do
 * contrato, como a de teste da sim): índice vazio, e o passeio é o de sempre.
 *
 * Montado uma vez por navegação (`bind`, no 1º tick, como o `NavPath` da busca); ordem estável (componente, piso e
 * menor índice de nó; determinístico). Nada é alocado depois.
 *
 * M12 (fase 7b): o jogo monta o índice numa etapa do loading (`prepareNavLevels`, em `game/src/scene/load.ts`): o 1º
 * tick só copia as referências (15–110 ms a menos no PC; ~50 ms no Royale Grande). O índice pronto é o MESMO que o
 * `bind` montaria (mesma função, mesma navegação e mesma área): a IA não muda.
 */
/** A área jogável (a da `SimView.playArea`), para o índice não contar os lugares de fora. */
export interface PlaceArea {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** O índice pronto de uma navegação (só leitura depois de montado: os cérebros compartilham os arrays). */
interface PreparedLevels {
  readonly area: PlaceArea | null;
  readonly count: number;
  readonly group: Int32Array;
  readonly mainGroup: Int32Array;
  readonly compStart: Int32Array;
  readonly floorY: Float32Array;
  readonly start: Int32Array;
  readonly order: Int32Array;
}

/**
 * Os índices montados no loading, por navegação. Fraco: some com a navegação (a partida e a cena soltam o mapa), sem
 * `dispose` a fazer; no máximo um por mapa carregado.
 */
const prepared = new WeakMap<NavGrid, PreparedLevels>();

function sameArea(a: PlaceArea | null, b: PlaceArea | null): boolean {
  if (a === null || b === null) return a === b;
  return a.minX === b.minX && a.maxX === b.maxX && a.minZ === b.minZ && a.maxZ === b.maxZ;
}

/**
 * M12 (fase 7b): monta o índice de lugares de `nav` fora da partida (a etapa do loading). O `bind` do 1º tick com a
 * mesma navegação e a mesma área só copia. Devolve quantos lugares o índice tem.
 */
export function prepareNavLevels(nav: NavGrid, area: PlaceArea | null = null): number {
  const known = prepared.get(nav);
  if (known !== undefined && sameArea(known.area, area)) return known.count;
  const levels = new NavLevels();
  levels.bind(nav, area);
  return levels.count;
}

export class NavLevels {
  nav: NavGrid | null = null;
  /** Lugares no índice (0 = nenhum). */
  count = 0;
  /** Grupo de cada nó (componente fortemente conexo) e o grupo principal de cada componente (-1 = nenhum). */
  group: Int32Array = new Int32Array(0);
  mainGroup: Int32Array = new Int32Array(0);
  /** Os lugares do componente c vão de `compStart[c]` a `compStart[c + 1] - 1`, do piso mais baixo ao mais alto. */
  compStart: Int32Array = new Int32Array(1);
  /** O piso mais baixo de cada lugar (m). */
  floorY: Float32Array = new Float32Array(0);
  /** Os nós do lugar k: `order[start[k]]` a `order[start[k + 1] - 1]`. */
  start: Int32Array = new Int32Array(1);
  order: Int32Array = new Int32Array(0);

  bind(nav: NavGrid | null, area: PlaceArea | null = null): void {
    if (nav === this.nav) return;
    this.nav = nav;
    this.count = 0;
    this.compStart = new Int32Array(1);
    this.floorY = new Float32Array(0);
    this.start = new Int32Array(1);
    this.order = new Int32Array(0);
    if (nav === null) return;
    // M12 (fase 7b): montado no loading (`prepareNavLevels`): só as referências.
    const ready = prepared.get(nav);
    if (ready !== undefined && sameArea(ready.area, area)) {
      this.count = ready.count;
      this.group = ready.group;
      this.mainGroup = ready.mainGroup;
      this.compStart = ready.compStart;
      this.floorY = ready.floorY;
      this.start = ready.start;
      this.order = ready.order;
      return;
    }
    this.build(nav, area);
    prepared.set(nav, {
      area: area === null ? null : { minX: area.minX, maxX: area.maxX, minZ: area.minZ, maxZ: area.maxZ },
      count: this.count,
      group: this.group,
      mainGroup: this.mainGroup,
      compStart: this.compStart,
      floorY: this.floorY,
      start: this.start,
      order: this.order,
    });
  }

  private build(nav: NavGrid, area: PlaceArea | null): void {
    const n = nav.nodeCount;
    const keep = this.groups(nav);
    const components = this.mainGroup.length;
    this.compStart = new Int32Array(components + 1);
    const csr = nav as Partial<Pick<NavGridImpl, 'linkStart' | 'linkTarget'>>;
    if (csr.linkStart === undefined || csr.linkTarget === undefined) return;
    const linkStart = csr.linkStart;
    const linkTarget = csr.linkTarget;
    // Os pisos planos: união dos nós do índice ligados sem degrau (as duas pontas no índice).
    const root = new Int32Array(n);
    for (let i = 0; i < n; i++) root[i] = i;
    const find = (a: number): number => {
      while (root[a] !== a) {
        root[a] = root[root[a]!]!;
        a = root[a]!;
      }
      return a;
    };
    const step = AI_SOLDIER.upperPlaceStepM + 1e-3;
    for (let a = 0; a < n; a++) {
      if (keep[a] === 0) continue;
      for (let l = linkStart[a]!; l < linkStart[a + 1]!; l++) {
        const b = linkTarget[l]!;
        if (keep[b] === 0 || Math.abs(nav.floorY[a]! - nav.floorY[b]!) > step) continue;
        const ra = find(a);
        const rb = find(b);
        // A raiz é sempre o menor índice do lugar (a ordem não depende da ordem das ligações).
        if (ra < rb) root[rb] = ra;
        else if (rb < ra) root[ra] = rb;
      }
    }
    const size = new Int32Array(n);
    const low = new Float32Array(n).fill(Infinity);
    // A caixa de cada lugar (para exigir 2 colunas em X e em Z) e quantos nós dele caem na área jogável.
    const minX = new Float32Array(n).fill(Infinity);
    const maxX = new Float32Array(n).fill(-Infinity);
    const minZ = new Float32Array(n).fill(Infinity);
    const maxZ = new Float32Array(n).fill(-Infinity);
    const inside = new Int32Array(n);
    const pos = new Float32Array(3);
    for (let i = 0; i < n; i++) {
      if (keep[i] === 0) continue;
      const r = find(i);
      size[r]!++;
      if (nav.floorY[i]! < low[r]!) low[r] = nav.floorY[i]!;
      nav.nodePosition(i, pos, 0);
      const x = pos[0]!;
      const z = pos[2]!;
      if (x < minX[r]!) minX[r] = x;
      if (x > maxX[r]!) maxX[r] = x;
      if (z < minZ[r]!) minZ[r] = z;
      if (z > maxZ[r]!) maxZ[r] = z;
      if (area === null || (x >= area.minX && x <= area.maxX && z >= area.minZ && z <= area.maxZ)) inside[r]!++;
    }
    const min = AI_SOLDIER.upperPlaceMinNodes;
    const places: number[] = [];
    for (let i = 0; i < n; i++) {
      if (keep[i] === 0 || root[i] !== i || size[i]! < min || inside[i]! < min) continue;
      if (maxX[i]! - minX[i]! < 0.01 || maxZ[i]! - minZ[i]! < 0.01) continue;
      places.push(i);
    }
    places.sort((a, b) => nav.component[a]! - nav.component[b]! || low[a]! - low[b]! || a - b);
    const count = places.length;
    const slot = new Int32Array(n).fill(-1);
    const floorY = new Float32Array(count);
    const start = new Int32Array(count + 1);
    for (let k = 0; k < count; k++) {
      const r = places[k]!;
      slot[r] = k;
      floorY[k] = low[r]!;
      start[k + 1] = start[k]! + size[r]!;
      this.compStart[nav.component[r]! + 1]!++;
    }
    for (let c = 0; c < components; c++) this.compStart[c + 1]! += this.compStart[c]!;
    const fill = start.slice(0, count);
    const order = new Int32Array(start[count]!);
    for (let i = 0; i < n; i++) {
      if (keep[i] === 0) continue;
      const k = slot[find(i)]!;
      if (k >= 0) order[fill[k]!++] = i;
    }
    this.count = count;
    this.floorY = floorY;
    this.start = start;
    this.order = order;
  }

  /**
   * Preenche `group` e `mainGroup` e devolve quem entra no índice (em pé e no grupo principal do componente). Sem as
   * ligações à vista, ninguém entra: sem o sentido das ligações não dá para saber o que o A* alcança.
   */
  private groups(nav: NavGrid): Uint8Array {
    const n = nav.nodeCount;
    const group = new Int32Array(n);
    const csr = nav as Partial<Pick<NavGridImpl, 'linkStart' | 'linkTarget'>>;
    let components = 0;
    for (let i = 0; i < n; i++) if (nav.component[i]! >= components) components = nav.component[i]! + 1;
    const keep = new Uint8Array(n);
    if (csr.linkStart === undefined || csr.linkTarget === undefined) {
      this.group = group;
      this.mainGroup = new Int32Array(components).fill(-1);
      return keep;
    }
    const groups = strongComponents(n, csr.linkStart, csr.linkTarget, group);
    // O maior grupo de cada componente (empate: o de menor número).
    const size = new Int32Array(groups);
    for (let i = 0; i < n; i++) size[group[i]!]!++;
    const main = new Int32Array(components).fill(-1);
    for (let i = 0; i < n; i++) {
      const c = nav.component[i]!;
      const g = group[i]!;
      const b = main[c]!;
      if (b < 0 || size[g]! > size[b]! || (size[g] === size[b] && g < b)) main[c] = g;
    }
    this.group = group;
    this.mainGroup = main;
    for (let i = 0; i < n; i++) if (nav.clearance[i] === 1 && group[i] === main[nav.component[i]!]) keep[i] = 1;
    return keep;
  }
}

/**
 * Componentes fortemente conexos (Tarjan, iterativo: a pilha de chamadas são dois typed arrays) das ligações em CSR
 * (`linkStart`/`linkTarget`). Escreve o componente de cada nó em `out` e devolve quantos são.
 */
export function strongComponents(n: number, linkStart: Int32Array, linkTarget: Int32Array, out: Int32Array): number {
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const stack = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const callNode = new Int32Array(n);
  const callLink = new Int32Array(n);
  let sp = 0;
  let next = 0;
  let count = 0;
  for (let root = 0; root < n; root++) {
    if (index[root] !== -1) continue;
    let cp = 0;
    index[root] = next;
    low[root] = next++;
    stack[sp++] = root;
    onStack[root] = 1;
    callNode[cp] = root;
    callLink[cp++] = linkStart[root]!;
    while (cp > 0) {
      const v = callNode[cp - 1]!;
      const l = callLink[cp - 1]!;
      if (l < linkStart[v + 1]!) {
        callLink[cp - 1] = l + 1;
        const w = linkTarget[l]!;
        if (index[w] === -1) {
          index[w] = next;
          low[w] = next++;
          stack[sp++] = w;
          onStack[w] = 1;
          callNode[cp] = w;
          callLink[cp++] = linkStart[w]!;
        } else if (onStack[w] === 1 && index[w]! < low[v]!) {
          low[v] = index[w]!;
        }
        continue;
      }
      if (low[v] === index[v]) {
        let w: number;
        do {
          w = stack[--sp]!;
          onStack[w] = 0;
          out[w] = count;
        } while (w !== v);
        count++;
      }
      cp--;
      if (cp > 0) {
        const u = callNode[cp - 1]!;
        if (low[v]! < low[u]!) low[u] = low[v]!;
      }
    }
  }
  return count;
}
