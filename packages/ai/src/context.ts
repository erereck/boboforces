import {
  aimPointWorld,
  ENTITY_FLAG,
  ENTITY_KIND,
  MAX_CONTROLLERS_WITH_ZOMBIES,
  MAX_HUMANS,
  type AimPoint,
  type SimView,
} from '@boboforces/sim';
import { BLOCK_FLAG, createRayHit, raycastGrid } from '@boboforces/world';
import type { TeamBoard } from './team.ts';
import { AI_BUDGET, AI_LOD, AI_PATH, AI_SOLDIER } from './config.ts';
import type { PathService } from './paths.ts';

const F = ENTITY_FLAG;

/** Entidade com corpo de bobo (bobo ou zumbi). */
export function isBodyKind(kind: number): boolean {
  return kind === ENTITY_KIND.bobo || kind === ENTITY_KIND.zombie;
}

/**
 * Estado do tick compartilhado pelos cérebros (montado uma vez por partida, preenchido no começo de cada `think`):
 * a `SimView`, controlador → entidade, os observadores (humanos vivos, para o LOD), o orçamento de raios do tick e a
 * fila de caminhos. Sem alocação por tick.
 */
export class AiContext {
  view: SimView | null = null;
  tick = 0;
  readonly hz: number;
  readonly ffa: boolean;
  /** M3 (fase 3a): Bobo Zombies (zumbis ignoram os caídos; os bots levantam os colegas). */
  zombiesMode = false;
  readonly viewDistance: number;
  readonly paths: PathService;
  readonly ctrlToEntity = new Int32Array(MAX_CONTROLLERS_WITH_ZOMBIES);
  /** Raios de percepção que ainda cabem neste tick. */
  raysLeft = 0;
  /** Raios gastos desde a criação (estatística do bench). */
  raysTotal = 0;
  /** Escolhas da mira visível que ainda cabem neste tick (`AI_SOLDIER.visibleAimPerTick`). */
  aimsLeft = 0;
  /** Escolhas da mira visível desde a criação (estatística do bench). */
  aimsTotal = 0;
  observerCount = 0;
  /** M2 (fases 3e e 3f): o quadro do time (avisos, objetivos, calor), criado no 1º tick com o tamanho do mapa. */
  board: TeamBoard | null = null;
  readonly observers = new Float64Array(MAX_HUMANS * 3);
  private readonly rayHit = createRayHit();
  /** Rascunho do ponto de mira (cabeça ou tronco do alvo, no mundo). */
  private readonly aim: AimPoint = { x: 0, y: 0, z: 0 };

  /** Raios de percepção por tick (`AiBudget.raysPerTick`). */
  private readonly raysPerTick: number;

  constructor(
    hz: number,
    ffa: boolean,
    viewDistance: number,
    paths: PathService,
    raysPerTick: number = AI_BUDGET.raysPerTick,
  ) {
    this.raysPerTick = raysPerTick;
    this.hz = hz;
    this.ffa = ffa;
    this.viewDistance = viewDistance;
    this.paths = paths;
  }

  begin(view: SimView): void {
    this.view = view;
    this.tick = view.tick;
    this.raysLeft = this.raysPerTick;
    this.aimsLeft = AI_SOLDIER.visibleAimPerTick;
    this.ctrlToEntity.fill(-1);
    this.observerCount = 0;
    for (let i = 0; i < view.count; i++) {
      if (view.alive[i] === 0 || !isBodyKind(view.kind[i]!)) continue;
      const c = view.controller[i]!;
      if (c < 0 || c >= MAX_CONTROLLERS_WITH_ZOMBIES) continue;
      this.ctrlToEntity[c] = i;
      // Observadores = câmeras dos humanos (controladores 0..3), vivos ou na câmera de morte.
      if (c < MAX_HUMANS && view.kind[i] === ENTITY_KIND.bobo) {
        const o = this.observerCount * 3;
        this.observers[o] = view.position[i * 3]!;
        this.observers[o + 1] = view.position[i * 3 + 1]!;
        this.observers[o + 2] = view.position[i * 3 + 2]!;
        this.observerCount++;
      }
    }
    this.paths.bind(view.nav);
  }

  /** Mesma regra da sim: zumbi é inimigo de todo bobo e de nenhum zumbi; entre bobos, FFA ou times diferentes. */
  hostile(a: number, b: number): boolean {
    if (a === b) return false;
    const v = this.view!;
    const za = v.kind[a] === ENTITY_KIND.zombie;
    const zb = v.kind[b] === ENTITY_KIND.zombie;
    if (za || zb) return za !== zb;
    return this.ffa || v.team[a] !== v.team[b];
  }

  /** Corpo vivo (não morto) na entidade `i`. */
  living(i: number): boolean {
    const v = this.view!;
    return i >= 0 && i < v.count && v.alive[i] === 1 && isBodyKind(v.kind[i]!) && (v.flags[i]! & F.dead) === 0;
  }

  /** LOD A pela distância: sem observadores (partida só de bots) ou algum a até `AI_LOD.nearM` no plano. */
  nearObserver(x: number, z: number): boolean {
    if (this.observerCount === 0) return true;
    const r2 = AI_LOD.nearM * AI_LOD.nearM;
    for (let k = 0; k < this.observerCount; k++) {
      const dx = this.observers[k * 3]! - x;
      const dz = this.observers[k * 3 + 2]! - z;
      if (dx * dx + dz * dz <= r2) return true;
    }
    return false;
  }

  /**
   * Linha de visão do olho (ex, ey, ez) até a cabeça ou o tronco do corpo `t` (até 2 raios DDA, descontados do
   * orçamento do tick; sem orçamento devolve `false` e quem chama tenta de novo depois). Os pontos são os centros das
   * hitboxes na postura e no pitch do alvo, levados ao mundo pelo yaw dele (`aimPointWorld`).
   */
  canSee(ex: number, ey: number, ez: number, t: number): boolean {
    const v = this.view!;
    const aim = this.aim;
    for (let k = 0; k < 2; k++) {
      if (this.raysLeft <= 0) return false;
      aimPointWorld(v, t, k === 0, aim);
      const dx = aim.x - ex;
      const dy = aim.y - ey;
      const dz = aim.z - ez;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-6) return true;
      this.raysLeft--;
      this.raysTotal++;
      const hit = raycastGrid(
        v.world,
        v.blocks,
        ex,
        ey,
        ez,
        dx / d,
        dy / d,
        dz / d,
        d,
        BLOCK_FLAG.blocksSight,
        this.rayHit,
        v.colliders,
      );
      if (!hit) return true;
    }
    return false;
  }

  /**
   * M2 (fase 3c): linha de visão entre dois pontos (1 raio DDA do orçamento do tick): 1 = livre, 0 = tapada, -1 = sem
   * orçamento.
   */
  clearLine(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    if (this.raysLeft <= 0) return -1;
    const v = this.view!;
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-6) return 1;
    this.raysLeft--;
    this.raysTotal++;
    const hit = raycastGrid(
      v.world,
      v.blocks,
      ax,
      ay,
      az,
      dx / d,
      dy / d,
      dz / d,
      d,
      BLOCK_FLAG.blocksSight,
      this.rayHit,
      v.colliders,
    );
    return hit ? 0 : 1;
  }

  /**
   * Empurrão para longe dos corpos vivos a menos de `AI_PATH.separationM` de (x, z) no plano (sem RVO, tecnico.md
   * §8.1). Soma em `out` (x, z), sem normalizar; zero se ninguém perto.
   */
  separation(self: number, x: number, y: number, z: number, out: { x: number; z: number }): void {
    const v = this.view!;
    const r = AI_PATH.separationM;
    out.x = 0;
    out.z = 0;
    for (let j = 0; j < v.count; j++) {
      if (j === self || !this.living(j)) continue;
      const dx = x - v.position[j * 3]!;
      const dz = z - v.position[j * 3 + 2]!;
      if (dx > r || dx < -r || dz > r || dz < -r || Math.abs(v.position[j * 3 + 1]! - y) > 1) continue;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d >= r) continue;
      if (d < 1e-4) {
        // Empilhados no mesmo ponto: desempata pelo índice (determinístico).
        out.x += self < j ? 1 : -1;
        continue;
      }
      const w = (r - d) / r;
      out.x += (dx / d) * w;
      out.z += (dz / d) * w;
    }
  }
}
