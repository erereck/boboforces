import type { NavGrid, NavGridImpl } from '@boboforces/nav';
import { METRICS } from '@boboforces/sim';

/**
 * M10 (fase 1c): os nós da navegação por ANDAR, para o passeio que sobe (`pickUpperGoal` do soldado). Andar = faixa de
 * `METRICS.storyHeight` (3 m) acima do piso mais baixo; só os nós em pé. O sorteio uniforme por nó quase nunca caía no
 * andar de cima (o térreo tem muito mais nós que o topo da torre): sorteando primeiro o andar e depois o nó dentro dele,
 * o andar pequeno tem a mesma vez que o grande.
 *
 * O `component` da navegação conta as quedas nos dois sentidos: o teto da cabine da torre do Construto (de onde só se
 * cai) é do mesmo componente que o chão, e o A* sem caminho varre a área toda antes de desistir. Por isso o índice só
 * guarda, de cada componente, os nós do maior componente FORTEMENTE conexo dele (o "grupo principal": dali se vai e se
 * volta pelas ligações no sentido certo; Tarjan iterativo). Navegação sem as ligações à vista (outra implementação do
 * contrato, como a de teste da sim): índice vazio, e o passeio é o de sempre.
 *
 * Montado uma vez por navegação (`bind`, no 1º tick, como o `NavPath` da busca); ordem estável pelo índice do nó
 * (determinístico). Nada é alocado depois.
 */
export class NavLevels {
  nav: NavGrid | null = null;
  /** Andares (0 = nenhum nó no índice). */
  count = 0;
  /** Piso do andar 0 (m). */
  baseY = 0;
  /** Grupo de cada nó (componente fortemente conexo) e o grupo principal de cada componente (-1 = nenhum). */
  group: Int32Array = new Int32Array(0);
  mainGroup: Int32Array = new Int32Array(0);
  /** Os nós do índice por componente e andar: os de (c, l) vão de `start[c * count + l]` a `start[c * count + l + 1]`. */
  order: Int32Array = new Int32Array(0);
  start: Int32Array = new Int32Array(1);

  bind(nav: NavGrid | null): void {
    if (nav === this.nav) return;
    this.nav = nav;
    this.count = 0;
    if (nav === null) return;
    const n = nav.nodeCount;
    const keep = this.groups(nav);
    const components = this.mainGroup.length;
    let lo = Infinity;
    let hi = -Infinity;
    let kept = 0;
    for (let i = 0; i < n; i++) {
      if (keep[i] === 0) continue;
      const y = nav.floorY[i]!;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
      kept++;
    }
    if (kept === 0) return;
    this.baseY = lo;
    this.count = Math.floor((hi - lo) / METRICS.storyHeight) + 1;
    const levels = this.count;
    const start = new Int32Array(components * levels + 1);
    for (let i = 0; i < n; i++)
      if (keep[i] !== 0) start[nav.component[i]! * levels + this.levelOf(nav.floorY[i]!) + 1]!++;
    for (let k = 0; k < components * levels; k++) start[k + 1]! += start[k]!;
    const fill = start.slice(0, components * levels);
    const order = new Int32Array(kept);
    for (let i = 0; i < n; i++) {
      if (keep[i] !== 0) order[fill[nav.component[i]! * levels + this.levelOf(nav.floorY[i]!)]!++] = i;
    }
    this.start = start;
    this.order = order;
  }

  /** Andar de uma altura dos pés (m), limitado aos andares do índice. */
  levelOf(y: number): number {
    const l = Math.floor((y - this.baseY) / METRICS.storyHeight);
    return l < 0 ? 0 : l >= this.count ? this.count - 1 : l;
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
