import { clamp } from '@boboforces/shared';
import type { SimView, WeaponDef } from '@boboforces/sim';
import { AI_FEEL } from './config.ts';
import type { SoldierBrain, SoldierTiming } from './soldier.ts';

/**
 * M12 (fase 7a): a mira com cara de gente (ARCHITECTURE §23.7). O erro deriva em vez de pular (Ornstein-Uhlenbeck), a
 * mira atrasa a mudança de velocidade do alvo (segue o strafe com atraso) e a arma automática atira em rajadas de
 * longe (`skill.triggerHold`). Nenhum raio; sem alocação.
 */

const RHO = AI_FEEL.errorRho;
const RHO_NOISE = Math.sqrt(1 - AI_FEEL.errorRho * AI_FEEL.errorRho);

/**
 * Um passo do erro normalizado (z, um por eixo): na aquisição (`errNextTick` zerado), z ~ N(0,1); depois, a cada
 * `errorStepS`, z ← ρ·z + √(1 − ρ²)·N(0,1) (a mesma variância, correlacionada no tempo).
 */
export function stepAimError(b: SoldierBrain, tick: number, t: SoldierTiming): void {
  if (tick < b.errNextTick) return;
  if (b.errNextTick === 0) {
    b.errZYaw = b.rng.gaussian();
    b.errZPitch = b.rng.gaussian();
  } else {
    b.errZYaw = RHO * b.errZYaw + RHO_NOISE * b.rng.gaussian();
    b.errZPitch = RHO * b.errZPitch + RHO_NOISE * b.rng.gaussian();
  }
  b.errNextTick = tick + t.errorResample;
}

/**
 * A escala do erro agora (rad, desvio por eixo): o erro do nível × (3 − 2p)·√½, com p o quanto a mira já fechou
 * (`acquireS`), e o reforço do revide (`errBoost`, 2× → 1× junto com p).
 */
export function aimErrorScale(b: SoldierBrain, tick: number): number {
  const p = b.acquireTicks > 0 ? clamp((tick - b.acquireStartTick) / b.acquireTicks, 0, 1) : 1;
  return b.errorRad * (3 - 2 * p) * Math.SQRT1_2 * (1 + (b.errBoost - 1) * (1 - p));
}

/**
 * A velocidade do alvo que o bot estima (no plano): segue a real com constante de tempo τ = `lagFrac`·reação. Um
 * tick por chamada (o combate chama uma vez por tick, inclusive durante a reação: o bot já está olhando).
 */
export function trackTarget(view: SimView, b: SoldierBrain): void {
  const t3 = b.target * 3;
  const a = 1 / b.lagTicks;
  b.estVx += (view.velocity[t3]! - b.estVx) * a;
  b.estVz += (view.velocity[t3 + 2]! - b.estVz) * a;
}

/**
 * Rajadas (`skill.triggerHold`): conta os tiros de `e`; com arma automática e o alvo a mais de `burstMinM`, a cada
 * `burstLen` tiros solta o gatilho por 0,15–0,3 s. Devolve se o gatilho pode ficar apertado neste tick.
 */
export function burstAllows(
  view: SimView,
  b: SoldierBrain,
  e: number,
  held: WeaponDef | null,
  dist: number,
  tick: number,
  t: SoldierTiming,
): boolean {
  const shot = view.lastShotTick[e]!;
  if (shot !== b.lastShotSeen) {
    b.lastShotSeen = shot;
    b.burstShots++;
  }
  if (held === null || !held.automatic || dist <= AI_FEEL.burstMinM) {
    b.burstShots = 0;
    return true;
  }
  if (tick < b.burstPauseUntil) return false;
  // Soltou o gatilho por mais que uma pausa (a mira saiu do alvo, trocou de arma): a rajada recomeça.
  if (tick - shot > t.burstPauseMax) b.burstShots = 0;
  if (b.burstShots < b.burstLen) return true;
  b.burstShots = 0;
  b.burstPauseUntil = tick + b.rng.int(t.burstPauseMin, t.burstPauseMax + 1);
  return false;
}

/** O tamanho da rajada pela habilidade: 3 + 10·`triggerHold` tiros (0,7 → 10; 0,3 → 6). */
export function burstLength(triggerHold: number): number {
  return Math.max(1, Math.round(AI_FEEL.burstBase + AI_FEEL.burstPerHold * triggerHold));
}
