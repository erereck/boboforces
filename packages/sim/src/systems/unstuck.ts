import { BUTTON } from '@boboforces/input';
import { BLOCK_FLAG, createRayHit, raycastGrid } from '@boboforces/world';
import { METRICS } from '../config/metrics.ts';
import { MATCH_DEFAULTS } from '../config/rules.ts';
import { BOT_CONTROLLER_BASE } from '../constants.ts';
import type { SimContext } from '../context.ts';
import { ENTITY_FLAG, ENTITY_KIND } from '../entity.ts';
import { isLivePhase } from '../view.ts';
import { pickSpawn, respawn } from './life.ts';

/**
 * M2 (fase 2b): Destravar (GDD §3.8, gameplay.md §11). Na borda de `BUTTON.unstuck`, o bobo vai para o nó de
 * navegação livre (em pé, no componente principal do mapa) mais perto, a pelo menos `unstuckMinDistM` de onde estava.
 * O bot prefere um nó fora da vista dos humanos (testa os 8 mais perto, em ordem); se todos estão à vista, fica com o
 * mais perto. Na `botUnstuckRespawnAt`-ésima vez na mesma vida, o bot renasce num spawn (sem contar morte). Sem
 * navegação no mapa, o bobo renasce num spawn. Offline vale na hora; a regra do online PvP (3 s parado, recarga de
 * 30 s) é do M5.
 */

const F = ENTITY_FLAG;
const MAX_TRIES = 8;
const target = new Float64Array(3);
const from = new Float64Array(3);
const sightHit = createRayHit();

/** Passo 1b (logo depois da entrada): atende os pedidos de Destravar. */
export function unstuckSystem(ctx: SimContext): void {
  if (!isLivePhase(ctx.match.phase)) return;
  const s = ctx.s;
  for (let e = 0; e < s.count; e++) {
    if (s.alive[e] === 0 || s.kind[e] !== ENTITY_KIND.bobo || (s.flags[e]! & F.dead) !== 0) continue;
    if ((s.inButtons[e]! & BUTTON.unstuck) === 0 || (s.prevButtons[e]! & BUTTON.unstuck) !== 0) continue;
    unstuck(ctx, e);
  }
}

function unstuck(ctx: SimContext, e: number): void {
  const s = ctx.s;
  const e3 = e * 3;
  from[0] = s.position[e3]!;
  from[1] = s.position[e3 + 1]!;
  from[2] = s.position[e3 + 2]!;
  const bot = s.controller[e]! >= BOT_CONTROLLER_BASE;
  s.unstuckCount[e] = Math.min(255, s.unstuckCount[e]! + 1);
  if ((bot && s.unstuckCount[e]! >= MATCH_DEFAULTS.botUnstuckRespawnAt) || !findNode(ctx, bot)) {
    respawn(ctx, e, pickSpawn(ctx, e));
    ctx.events.unstuck(ctx.tick, s.idOf(e), from, 0, s.position[e3]!, s.position[e3 + 1]!, s.position[e3 + 2]!, true);
    return;
  }
  s.position[e3] = target[0]!;
  s.position[e3 + 1] = target[1]!;
  s.position[e3 + 2] = target[2]!;
  s.prevPosition[e3] = target[0]!;
  s.prevPosition[e3 + 1] = target[1]!;
  s.prevPosition[e3 + 2] = target[2]!;
  s.velocity[e3] = 0;
  s.velocity[e3 + 1] = 0;
  s.velocity[e3 + 2] = 0;
  // Sem dano de queda do lugar de onde saiu.
  s.airPeakY[e] = target[1]!;
  s.slideTicks[e] = 0;
  ctx.events.unstuck(ctx.tick, s.idOf(e), from, 0, target[0]!, target[1]!, target[2]!, false);
}

/**
 * Procura o nó de destino (em `target`, pés em metros): em ordem de distância (3D) a partir de `from`, pulando os a
 * menos de `unstuckMinDistM`; o humano fica com o primeiro, o bot com o primeiro que nenhum humano enxerga. `false` =
 * o mapa não tem navegação ou nenhum nó serve.
 */
function findNode(ctx: SimContext, bot: boolean): boolean {
  const nav = ctx.nav;
  if (nav === null) return false;
  const minD2 = MATCH_DEFAULTS.unstuckMinDistM * MATCH_DEFAULTS.unstuckMinDistM;
  let lastD2 = -1;
  let lastNode = -1;
  let fallback = -1;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    let best = -1;
    let bestD2 = Infinity;
    for (let n = 0; n < nav.nodeCount; n++) {
      if (nav.clearance[n] !== 1 || nav.component[n] !== ctx.navMainComponent) continue;
      nav.nodePosition(n, target, 0);
      const dx = target[0]! - from[0]!;
      const dy = target[1]! - from[1]!;
      const dz = target[2]! - from[2]!;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < minD2 || d2 < lastD2 || (d2 === lastD2 && n <= lastNode)) continue;
      if (d2 < bestD2) {
        best = n;
        bestD2 = d2;
      }
    }
    if (best < 0) break;
    if (fallback < 0) fallback = best;
    nav.nodePosition(best, target, 0);
    if (!bot || !humanSees(ctx, target[0]!, target[1]!, target[2]!)) return true;
    lastD2 = bestD2;
    lastNode = best;
  }
  if (fallback < 0) return false;
  nav.nodePosition(fallback, target, 0);
  return true;
}

/** Algum humano vivo enxerga o ponto (pés em x, y, z), olho no olho, até o alcance de visão? */
function humanSees(ctx: SimContext, x: number, y: number, z: number): boolean {
  const s = ctx.s;
  const eye = METRICS.eyeHeight;
  for (let j = 0; j < s.count; j++) {
    if (s.alive[j] === 0 || s.kind[j] !== ENTITY_KIND.bobo || (s.flags[j]! & F.dead) !== 0) continue;
    const c = s.controller[j]!;
    if (c < 0 || c >= BOT_CONTROLLER_BASE) continue;
    const ox = s.position[j * 3]!;
    const oy = s.position[j * 3 + 1]! + eye;
    const oz = s.position[j * 3 + 2]!;
    const dx = x - ox;
    const dy = y + eye - oy;
    const dz = z - oz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > MATCH_DEFAULTS.viewDistanceM) continue;
    if (d < 1e-6) return true;
    const blocked = raycastGrid(
      ctx.grid,
      ctx.blocks,
      ox,
      oy,
      oz,
      dx / d,
      dy / d,
      dz / d,
      d,
      BLOCK_FLAG.blocksSight,
      sightHit,
      ctx.colliders,
    );
    if (!blocked) return true;
  }
  return false;
}
