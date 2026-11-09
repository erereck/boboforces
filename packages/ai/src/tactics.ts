import { entityIndex, NULL_ENTITY, type SimView } from '@boboforces/sim';
import { AI_COVER, AI_RETREAT } from './config.ts';
import type { AiContext } from './context.ts';
import type { SoldierBrain, SoldierTiming } from './soldier.ts';

/**
 * M2 (fase 3c): o N1 da IA (gameplay.md §6.3: "procura cobertura quando toma dano, recarrega protegido, investiga sons,
 * patrulha"). O bot sempre sabe de onde tomou dano (§6.3, percepção): vira para lá. Com `useCover`, decide pela
 * personalidade se corre para uma cobertura (um nó da navegação perto, fora da vista de quem atirou), fica agachado lá
 * um tempo e recarrega. Sem alocação: rascunhos fixos.
 */

/** Fases da cobertura no cérebro (`SoldierBrain.coverPhase`). */
export const COVER_PHASE = { none: 0, going: 1, holding: 2 } as const;

const nodePos = new Float64Array(3);

/**
 * Tomou dano: lembra de onde veio (vira e vai ver, em qualquer nível) e, com `useCover`, talvez corra para uma
 * cobertura. A chance cresce com a cautela e com a vida baixa e cai com a agressividade.
 */
export function onDamaged(c: AiContext, b: SoldierBrain, e: number, t: SoldierTiming): void {
  const view = c.view!;
  const attacker = view.lastAttacker[e]!;
  if (attacker === NULL_ENTITY) return;
  const a = entityIndex(attacker);
  if (!c.living(a) || !c.hostile(e, a) || view.generation[a] !== attacker >>> 16) return;
  const a3 = a * 3;
  b.threatX = view.position[a3]!;
  b.threatY = view.position[a3 + 1]!;
  b.threatZ = view.position[a3 + 2]!;
  if (!b.targetVisible) {
    b.hasLastKnown = true;
    b.lastSeenTick = c.tick;
    b.lastKnownX = b.threatX;
    b.lastKnownY = b.threatY;
    b.lastKnownZ = b.threatZ;
  }
  if (!b.intelligence.useCover || b.coverPhase !== COVER_PHASE.none || c.tick < b.coverCooldownUntil) return;
  const p = b.personality;
  const hpFrac = view.health[e]! / Math.max(1, b.maxHp);
  const chance = AI_COVER.baseChance + AI_COVER.cautionWeight * p.caution - AI_COVER.aggressionWeight * p.aggression;
  if (!b.rng.chance(Math.min(1, Math.max(0, chance + (hpFrac < AI_COVER.lowHpFrac ? AI_COVER.lowHpBonus : 0))))) return;
  seekCover(c, b, e, t);
}

/**
 * Procura a cobertura e entra na fase "indo": nós da navegação a `minM`..`maxM` m, para o lado oposto da ameaça (±75°),
 * alcançáveis, e de onde a ameaça não vê o olho do bot agachado. Gasta raios do orçamento do tick; sem achar, fica
 * como está (e tenta de novo no próximo dano).
 */
export function seekCover(c: AiContext, b: SoldierBrain, e: number, t: SoldierTiming, retreat = false): boolean {
  const view = c.view!;
  const nav = view.nav;
  if (nav === null) return false;
  const e3 = e * 3;
  const x = view.position[e3]!;
  const y = view.position[e3 + 1]!;
  const z = view.position[e3 + 2]!;
  const from = nav.nearestNode(x, y, z);
  if (from < 0) return false;
  const away = Math.atan2(x - b.threatX, z - b.threatZ);
  const ty = b.threatY + AI_COVER.threatEyeM;
  for (let k = 0; k < AI_COVER.samples && c.raysLeft > 0; k++) {
    const ang = away + b.rng.range(-AI_COVER.spreadRad, AI_COVER.spreadRad);
    const d = retreat ? b.rng.range(AI_RETREAT.minM, AI_RETREAT.maxM) : b.rng.range(AI_COVER.minM, AI_COVER.maxM);
    const n = nav.nearestNode(x + Math.sin(ang) * d, y, z + Math.cos(ang) * d);
    if (n < 0 || nav.component[n] !== nav.component[from] || nav.clearance[n] !== 1) continue;
    nav.nodePosition(n, nodePos, 0);
    if (c.clearLine(b.threatX, ty, b.threatZ, nodePos[0]!, nodePos[1]! + AI_COVER.coverEyeM, nodePos[2]!) !== 0)
      continue;
    b.coverPhase = COVER_PHASE.going;
    b.coverX = nodePos[0]!;
    b.coverY = nodePos[1]!;
    b.coverZ = nodePos[2]!;
    b.coverUntil = c.tick + t.coverGoing;
    b.coverRetreat = retreat;
    b.follower.clear();
    return true;
  }
  return false;
}

/**
 * Avança a fase da cobertura: chegou (vai para "segurando", agachado, por um tempo que cresce com a paciência) ou o
 * tempo acabou (desiste). Devolve se o bot ainda está nela.
 */
export function updateCover(view: SimView, b: SoldierBrain, e: number, tick: number, t: SoldierTiming): boolean {
  if (b.coverPhase === COVER_PHASE.none) return false;
  if (b.coverPhase === COVER_PHASE.going) {
    const dx = b.coverX - view.position[e * 3]!;
    const dz = b.coverZ - view.position[e * 3 + 2]!;
    if (dx * dx + dz * dz <= AI_COVER.arriveM * AI_COVER.arriveM) {
      b.coverPhase = COVER_PHASE.holding;
      b.coverUntil = b.coverRetreat
        ? tick + t.retreatHold
        : tick + t.coverHoldMin + Math.round(b.personality.patience * t.coverHoldExtra);
    } else if (tick >= b.coverUntil) endCover(b, tick, t);
    return b.coverPhase !== COVER_PHASE.none;
  }
  // Recuo (N2, fase 3d): sai quando a vida volta (regeneração do Bobo Warfare).
  if (tick >= b.coverUntil || (b.coverRetreat && view.health[e]! >= AI_RETREAT.untilHpFrac * b.maxHp))
    endCover(b, tick, t);
  return b.coverPhase !== COVER_PHASE.none;
}

export function endCover(b: SoldierBrain, tick: number, t: SoldierTiming): void {
  b.coverPhase = COVER_PHASE.none;
  b.coverCooldownUntil = tick + t.coverCooldown;
}
