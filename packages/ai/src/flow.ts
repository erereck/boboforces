import { NAV_LINK, NO_NAV_NODE, type FlowField, type NavGrid } from '@boboforces/nav';
import { ENTITY_FLAG, ENTITY_KIND, secondsToTicks } from '@boboforces/sim';
import { AI_FLOW, AI_PATH } from './config.ts';
import type { AiContext } from './context.ts';
import type { Steer } from './paths.ts';

/**
 * M3 (fase 3c): o flow field dos zumbis (tecnico.md §8.3). Um campo só, refeito a cada `AI_FLOW.rebuildS` a partir
 * dos bobos de pé (vivos e não caídos), fatiado com o mesmo orçamento de nós do A* (`AiBudget.pathNodesPerTick`), e
 * lido por todos os zumbis: cada um olha o próximo nó do campo a partir do nó onde está. Enquanto o primeiro campo
 * não fica pronto (ou sem o `createFlowField`, na navegação de teste da sim), o zumbi segue pelo A* como no M1.
 *
 * Só refaz quando precisa (medido: o campo inteiro custa ~3× o A* de 24 zumbis): algum bobo de pé andou mais de
 * `AI_FLOW.sourceMoveM` desde o último campo, caiu, levantou, morreu ou nasceu, ou algum zumbi ficou fora do campo
 * (nasceu longe, foi destravado). Os bobos parados (segurando posição, o normal no Bobo Zombies) não custam nada.
 */
export class ZombieFlow {
  field: FlowField | null = null;
  /** Campos prontos desde o começo (estatística do bench). */
  builds = 0;
  private nav: NavGrid | null = null;
  private nextBuildTick = 0;
  private readonly create: (nav: NavGrid) => FlowField;
  private readonly periodTicks: number;
  private readonly nodesPerTick: number;
  private readonly pos = new Float32Array(3);
  /** Os bobos que foram fonte do último campo (1 por entidade) e onde estavam; criados no 1º tick (tamanho da view). */
  private srcMark = new Uint8Array(0);
  private srcX = new Float32Array(0);
  private srcZ = new Float32Array(0);
  private srcCount = 0;

  constructor(create: (nav: NavGrid) => FlowField, hz: number, nodesPerTick: number) {
    this.create = create;
    this.periodTicks = Math.max(1, secondsToTicks(AI_FLOW.rebuildS, hz));
    this.nodesPerTick = Math.max(1, nodesPerTick);
  }

  /** Uma vez por tick, antes dos cérebros: liga ao mapa, começa outro campo no intervalo e avança o cálculo. */
  update(c: AiContext): void {
    const v = c.view!;
    const nav = v.nav;
    if (nav !== this.nav) {
      this.nav = nav;
      this.field = nav === null ? null : this.create(nav);
      this.nextBuildTick = c.tick;
    }
    const field = this.field;
    if (field === null || nav === null) return;
    if (!field.building && c.tick >= this.nextBuildTick) {
      this.nextBuildTick = c.tick + this.periodTicks;
      if (this.stale(c, nav, field)) this.start(c, nav, field);
    }
    if (field.building && field.run(this.nodesPerTick)) this.builds++;
  }

  /** O campo pronto ainda serve? Não serve (`true`) sem campo, com fonte que mudou ou com zumbi fora dele. */
  private stale(c: AiContext, nav: NavGrid, field: FlowField): boolean {
    if (field.ready === 0) return true;
    const v = c.view!;
    const max2 = AI_FLOW.sourceMoveM * AI_FLOW.sourceMoveM;
    let sources = 0;
    for (let j = 0; j < v.count; j++) {
      if (!c.living(j)) continue;
      const j3 = j * 3;
      if (v.kind[j] === ENTITY_KIND.zombie) {
        const n = nav.nearestNode(v.position[j3]!, v.position[j3 + 1]!, v.position[j3 + 2]!);
        if (n !== NO_NAV_NODE && field.distance(n) === Infinity) return true;
      } else if (v.kind[j] === ENTITY_KIND.bobo && (v.flags[j]! & ENTITY_FLAG.downed) === 0) {
        if (j >= this.srcMark.length || this.srcMark[j] !== 1) return true;
        const dx = v.position[j3]! - this.srcX[j]!;
        const dz = v.position[j3 + 2]! - this.srcZ[j]!;
        if (dx * dx + dz * dz > max2) return true;
        sources++;
      }
    }
    return sources !== this.srcCount;
  }

  /** Começa outro campo: os bobos de pé são as fontes e os zumbis, os alvos (o cálculo para quando todos estão cobertos). */
  private start(c: AiContext, nav: NavGrid, field: FlowField): void {
    const v = c.view!;
    if (this.srcMark.length < v.kind.length) {
      this.srcMark = new Uint8Array(v.kind.length);
      this.srcX = new Float32Array(v.kind.length);
      this.srcZ = new Float32Array(v.kind.length);
    }
    this.srcMark.fill(0);
    this.srcCount = 0;
    field.begin();
    for (let j = 0; j < v.count; j++) {
      if (!c.living(j)) continue;
      const kind = v.kind[j];
      const j3 = j * 3;
      const x = v.position[j3]!;
      const y = v.position[j3 + 1]!;
      const z = v.position[j3 + 2]!;
      if (kind === ENTITY_KIND.zombie) {
        field.addTarget(nav.nearestNode(x, y, z));
      } else if (kind === ENTITY_KIND.bobo && (v.flags[j]! & ENTITY_FLAG.downed) === 0) {
        field.addSource(nav.nearestNode(x, y, z));
        this.srcMark[j] = 1;
        this.srcX[j] = x;
        this.srcZ[j] = z;
        this.srcCount++;
      }
    }
  }

  /**
   * Direção pelo campo pronto, de (x, y, z) até o centro do próximo nó (e pulo/agachar pela ligação), como o
   * `PathService.steer`. Devolve `false` sem campo, fora da navegação, no nó de um bobo ou sem caminho até um.
   */
  steer(x: number, y: number, z: number, onGround: boolean, out: Steer): boolean {
    out.x = 0;
    out.z = 0;
    out.jump = false;
    out.crouch = false;
    out.remaining = 0;
    const field = this.field;
    const nav = this.nav;
    if (field === null || nav === null || field.ready === 0) return false;
    const n = nav.nearestNode(x, y, z);
    if (n === NO_NAV_NODE) return false;
    const next = field.next(n);
    if (next === NO_NAV_NODE) return false;
    const p = this.pos;
    nav.nodePosition(next, p);
    const dx = p[0]! - x;
    const dz = p[2]! - z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 1e-6) {
      out.x = dx / d;
      out.z = dz / d;
    }
    const link = field.link(n);
    out.jump = link === NAV_LINK.jump && onGround && d < AI_PATH.jumpTriggerM && p[1]! - y > 0.55;
    out.crouch = link === NAV_LINK.crouch;
    out.remaining = field.distance(n);
    return true;
  }
}
