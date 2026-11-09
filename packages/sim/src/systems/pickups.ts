import { WEAPON_SLOT_COUNT } from '@boboforces/input';
import { BLOCK_FLAG, createRayHit, raycastGrid } from '@boboforces/world';
import { MATCH_DEFAULTS } from '../config/rules.ts';
import { weaponDef } from '../config/weapons.ts';
import type { SimContext } from '../context.ts';
import { ENTITY_FLAG, ENTITY_KIND } from '../entity.ts';
import { PICKUP_KIND } from '../view.ts';

/**
 * M2 (fase 2b): a caixinha de munição do Bobo Warfare (gameplay.md §4.1). Quem morre deixa uma nos pés; ela salta um
 * pouco, cai com a gravidade do bobo até o chão e fica parada (o cenário é estático, #4) até alguém pegar ou o tempo
 * acabar. Quem passa por cima ganha 1 pente de reserva de cada arma com reserva (primária e pistola) e 1 granada, até o
 * máximo de cada; com tudo cheio, a caixinha fica para o próximo.
 */

const F = ENTITY_FLAG;
const hit = createRayHit();
/** A caixinha nasce um pouco acima dos pés (e cai), para não nascer enterrada num degrau. */
const DROP_LIFT_M = 0.25;
/** Velocidade inicial de queda: diferente de 0 marca "no ar" (0 = parada no chão). */
const DROP_START_VY = -0.001;
/** Altura da caixinha em relação aos pés de quem pega (m): de um pouco abaixo até a cabeça. */
const REACH_BELOW_M = 0.6;
const REACH_ABOVE_M = 1.8;

/** Solta a caixinha de quem morreu (`e`) nos pés dele. Sem vaga no pool, não solta. */
export function dropAmmoBox(ctx: SimContext, e: number): void {
  const s = ctx.s;
  const i = s.allocatePickup();
  if (i < 0) return;
  const e3 = e * 3;
  const i3 = i * 3;
  const x = s.position[e3]!;
  const y = s.position[e3 + 1]! + DROP_LIFT_M;
  const z = s.position[e3 + 2]!;
  s.pickKind[i] = PICKUP_KIND.ammoBox;
  s.pickPosition[i3] = x;
  s.pickPosition[i3 + 1] = y;
  s.pickPosition[i3 + 2] = z;
  s.pickPrevPosition[i3] = x;
  s.pickPrevPosition[i3 + 1] = y;
  s.pickPrevPosition[i3 + 2] = z;
  s.pickVelY[i] = DROP_START_VY;
  s.pickTicks[i] = ctx.ammoBoxTicks;
  ctx.events.pickup(ctx.tick, 'drop', i, s.idOf(e), x, y, z);
}

/** Passo 4b (depois dos projéteis): tempo, queda e coleta das caixinhas. */
export function pickupSystem(ctx: SimContext): void {
  const s = ctx.s;
  const reach2 = MATCH_DEFAULTS.ammoBoxReachM * MATCH_DEFAULTS.ammoBoxReachM;
  for (let i = 0; i < s.pickCount; i++) {
    if (s.pickAlive[i] === 0) continue;
    const i3 = i * 3;
    s.pickPrevPosition[i3] = s.pickPosition[i3]!;
    s.pickPrevPosition[i3 + 1] = s.pickPosition[i3 + 1]!;
    s.pickPrevPosition[i3 + 2] = s.pickPosition[i3 + 2]!;
    s.pickTicks[i] = s.pickTicks[i]! - 1;
    if (s.pickTicks[i]! <= 0) {
      s.freePickup(i);
      continue;
    }
    const x = s.pickPosition[i3]!;
    const z = s.pickPosition[i3 + 2]!;
    let y = s.pickPosition[i3 + 1]!;
    let vy = s.pickVelY[i]!;
    if (vy !== 0) {
      vy = Math.max(vy - ctx.profile.gravity * ctx.dt, -MATCH_DEFAULTS.terminalSpeed);
      const fall = -vy * ctx.dt;
      if (raycastGrid(ctx.grid, ctx.blocks, x, y, z, 0, -1, 0, fall, BLOCK_FLAG.solid, hit, ctx.colliders)) {
        y = hit.y;
        vy = 0;
      } else y -= fall;
      if (y < ctx.killPlaneY) {
        s.freePickup(i);
        continue;
      }
      s.pickPosition[i3 + 1] = y;
      s.pickVelY[i] = vy;
    }
    for (let e = 0; e < s.count; e++) {
      if (s.alive[e] === 0 || s.kind[e] !== ENTITY_KIND.bobo || (s.flags[e]! & F.dead) !== 0) continue;
      const e3 = e * 3;
      const dx = s.position[e3]! - x;
      const dz = s.position[e3 + 2]! - z;
      if (dx * dx + dz * dz > reach2) continue;
      const dy = y - s.position[e3 + 1]!;
      if (dy < -REACH_BELOW_M || dy > REACH_ABOVE_M) continue;
      if (!refill(ctx, e)) continue;
      ctx.events.pickup(ctx.tick, 'take', i, s.idOf(e), x, y, z);
      s.freePickup(i);
      break;
    }
  }
}

/**
 * Dá a munição da caixinha a `e`: +1 pente de reserva em cada slot com reserva (até a reserva cheia da arma) e +1 na
 * granada (até o pente dela). Devolve se coube alguma coisa.
 */
export function refill(ctx: SimContext, e: number): boolean {
  const s = ctx.s;
  let changed = false;
  for (let slot = 0; slot < WEAPON_SLOT_COUNT; slot++) {
    const k = e * WEAPON_SLOT_COUNT + slot;
    const def = weaponDef(s.loadout[k]!);
    if (def === null) continue;
    if (def.reserve > 0) {
      const reserve = s.slotReserve[k]!;
      if (reserve < def.reserve) {
        s.slotReserve[k] = Math.min(def.reserve, reserve + def.clipSize);
        changed = true;
      }
    } else if (def.category === 'throwable' && s.slotClip[k]! < def.clipSize) {
      s.slotClip[k] = s.slotClip[k]! + 1;
      changed = true;
    }
  }
  return changed;
}
