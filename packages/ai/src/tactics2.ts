import { BUTTON, WEAPON_SLOT_COUNT } from '@boboforces/input';
import { angleDelta, clamp, DEG_TO_RAD, HALF_PI, wrapAngle } from '@boboforces/shared';
import { eyeHeightFor, GRENADE_THROW, WEAPON_CODE, WEAPON_GRENADE, WEAPON_SLOT, type SimView } from '@boboforces/sim';
import { AI_FLANK, AI_GRENADE, AI_HOLD, AI_PERSONA, AI_RETREAT, AI_TEAM } from './config.ts';
import type { AiContext } from './context.ts';
import type { SoldierBrain, SoldierTiming } from './soldier.ts';

/**
 * M2 (fase 3d): o N2 da IA (gameplay.md §6.3: "flanqueia, segura ângulos, recua com HP baixo, joga granada em
 * cobertura"). Quatro peças, todas ligadas pelos comportamentos do bot (`intelligence`) e pesadas pela personalidade:
 * - segurar o ângulo: perdeu o alvo de vista, fica parado mirando onde ele sumiu (mais tempo com paciência);
 * - flanquear: depois, em vez de ir reto, passa por um ponto de lado (±90° da linha) antes de voltar à caça;
 * - recuar: vida baixa com o alvo à vista, corre para longe e fora da vista e espera regenerar (a cobertura do N1 com
 *   distância e tempo maiores, `tactics.ts`);
 * - granada: o inimigo sumiu atrás de algo a 7–25 m, joga na última posição dele (troca de arma, mira o arco baixo,
 *   cozinha o que dá e solta). O bot fica parado durante o arremesso.
 * Sem alocação: rascunhos fixos.
 */

/** Fases da granada (`SoldierBrain.grenadePhase`). */
export const GRENADE_PHASE = { none: 0, switching: 1, aiming: 2, cooking: 3, release: 4 } as const;

const nodePos = new Float64Array(3);

/** Perdeu o alvo de vista: talvez segure o ângulo; depois, talvez flanqueie. */
export function onTargetLost(c: AiContext, b: SoldierBrain, e: number, t: SoldierTiming): void {
  if (b.intelligence.level < 2) return;
  const p = b.personality;
  const tick = c.tick;
  if (
    b.rng.chance(AI_HOLD.baseChance + AI_HOLD.patienceWeight * p.patience - AI_HOLD.aggressionWeight * p.aggression)
  ) {
    b.holdAngleUntil = tick + t.holdAngleMin + Math.round(p.patience * t.holdAngleExtra);
  }
  // N3 (fase 3e): cerco: o time flanqueia mais, e cada um vai para o lado do seu índice (as rotas se dividem).
  const siege = b.intelligence.callouts ? AI_TEAM.siegeFlankBonus : 0;
  // O Estrategista (fase 3g) flanqueia mais.
  const strategist = p.preset === 'strategist' ? AI_PERSONA.strategistFlankBonus : 0;
  if (
    b.intelligence.flank &&
    b.rng.chance(AI_FLANK.baseChance + AI_FLANK.patienceWeight * p.patience + siege + strategist)
  ) {
    planFlank(c, b, e, t, b.intelligence.callouts ? (b.index % 2 === 0 ? 1 : -1) : 0);
  }
}

/** Ponto de flanco: ao lado da última posição do inimigo (±90° da linha bot–inimigo), alcançável. */
function planFlank(c: AiContext, b: SoldierBrain, e: number, t: SoldierTiming, forcedSide: number): void {
  const view = c.view!;
  const nav = view.nav;
  if (nav === null) return;
  const x = view.position[e * 3]!;
  const y = view.position[e * 3 + 1]!;
  const z = view.position[e * 3 + 2]!;
  const dx = x - b.lastKnownX;
  const dz = z - b.lastKnownZ;
  const d = Math.hypot(dx, dz);
  if (d < AI_FLANK.minM || d > AI_FLANK.maxM) return;
  const ux = dx / d;
  const uz = dz / d;
  const from = nav.nearestNode(x, y, z);
  if (from < 0) return;
  const side = forcedSide !== 0 ? forcedSide : b.rng.chance(0.5) ? 1 : -1;
  for (let k = 0; k < 2; k++) {
    const sgn = k === 0 ? side : -side;
    const fx = b.lastKnownX + ux * AI_FLANK.backM - uz * sgn * AI_FLANK.sideM;
    const fz = b.lastKnownZ + uz * AI_FLANK.backM + ux * sgn * AI_FLANK.sideM;
    const n = nav.nearestNode(fx, b.lastKnownY, fz);
    if (n < 0 || nav.component[n] !== nav.component[from]) continue;
    nav.nodePosition(n, nodePos, 0);
    b.flankX = nodePos[0]!;
    b.flankY = nodePos[1]!;
    b.flankZ = nodePos[2]!;
    b.flankUntil = c.tick + t.flank;
    b.follower.clear();
    return;
  }
}

/** Segurando o ângulo: parado (agachado se for cauteloso), mirando no peito da última posição do inimigo. */
export function holdAngle(view: SimView, b: SoldierBrain, e: number, local: { x: number; y: number }): number {
  const e3 = e * 3;
  const ey = view.position[e3 + 1]! + eyeHeightFor(view.flags[e]!);
  const dx = b.lastKnownX - view.position[e3]!;
  const dy = b.lastKnownY + 1.2 - ey;
  const dz = b.lastKnownZ - view.position[e3 + 2]!;
  b.aimYaw = turnTo(b.aimYaw, Math.atan2(-dx, -dz), b.turnStep);
  b.aimPitch = clamp(stepTo(b.aimPitch, Math.atan2(dy, Math.hypot(dx, dz)), b.turnStep), -HALF_PI, HALF_PI);
  local.x = 0;
  local.y = 0;
  return b.personality.caution > 0.5 ? BUTTON.crouch : 0;
}

/**
 * Decide se começa a jogar granada agora (chamado sem alvo à vista): tem granada, o inimigo sumiu há pouco a 7–25 m e
 * o sorteio pelo uso de granada (`skill.grenadeUse`) passou. A decisão é tirada no máximo a cada `AI_GRENADE.decideS`.
 */
export function maybeStartGrenade(c: AiContext, b: SoldierBrain, e: number, t: SoldierTiming): void {
  const tick = c.tick;
  if (!b.intelligence.grenades || b.grenadePhase !== GRENADE_PHASE.none || tick < b.grenadeNextTick) return;
  b.grenadeNextTick = tick + t.grenadeDecide;
  const view = c.view!;
  if (!b.hasLastKnown || tick - b.lastSeenTick > t.grenadeMemory) {
    // N4 (fase 3f): sem pista, joga na célula mais quente perto (metade da chance de granada).
    const board = c.board;
    if (!b.intelligence.learn || board === null) return;
    const x = view.position[e * 3]!;
    const z = view.position[e * 3 + 2]!;
    const cell = board.hottest(view.team[e]!, x, z, AI_GRENADE.minM, AI_GRENADE.maxM, AI_TEAM.minHeat);
    if (cell < 0 || !hasGrenade(view, e) || !b.rng.chance(b.grenadeUse * 0.5)) return;
    board.cellCenter(cell, hotPos);
    startGrenade(b, tick, hotPos[0]!, view.position[e * 3 + 1]!, hotPos[1]!);
    return;
  }
  if (!hasGrenade(view, e)) return;
  const d = Math.hypot(b.lastKnownX - view.position[e * 3]!, b.lastKnownZ - view.position[e * 3 + 2]!);
  if (d < AI_GRENADE.minM || d > AI_GRENADE.maxM) return;
  if (!b.rng.chance(b.grenadeUse)) return;
  startGrenade(b, tick, b.lastKnownX, b.lastKnownY, b.lastKnownZ);
}

const hotPos = new Float64Array(2);

function hasGrenade(view: SimView, e: number): boolean {
  const k = e * WEAPON_SLOT_COUNT + WEAPON_SLOT.throwable;
  return view.loadout[k] === WEAPON_CODE.grenade && view.slotClip[k]! > 0;
}

function startGrenade(b: SoldierBrain, tick: number, x: number, y: number, z: number): void {
  b.grenadePhase = GRENADE_PHASE.switching;
  b.grenadePhaseTick = tick;
  b.grenadeX = x;
  b.grenadeY = y;
  b.grenadeZ = z;
}

/**
 * Um tick do arremesso: troca para a granada, mira o arco, segura o gatilho (cozinha) e solta; depois volta para a
 * primária. Escreve a mira no cérebro e devolve os botões (o bot fica parado). Cancela se a granada sumir da mão.
 */
export function stepGrenade(
  c: AiContext,
  b: SoldierBrain,
  e: number,
  t: SoldierTiming,
  local: { x: number; y: number },
): number {
  const view = c.view!;
  const tick = c.tick;
  local.x = 0;
  local.y = 0;
  b.wantSlot = WEAPON_SLOT.throwable;
  const inHand = view.weapon[e] === WEAPON_CODE.grenade;
  const since = tick - b.grenadePhaseTick;
  const e3 = e * 3;
  const ex = view.position[e3]!;
  const ey = view.position[e3 + 1]! + eyeHeightFor(view.flags[e]!);
  const ez = view.position[e3 + 2]!;
  const dx = b.grenadeX - ex;
  const dz = b.grenadeZ - ez;
  const d = Math.hypot(dx, dz);
  const pitch = throwPitch(d, b.grenadeY - ey, WEAPON_GRENADE.projectileSpeed, WEAPON_GRENADE.projectileGravity);
  if (Number.isNaN(pitch) || (b.grenadePhase !== GRENADE_PHASE.switching && !inHand)) {
    finishGrenade(b, tick, t);
    return 0;
  }
  b.aimYaw = turnTo(b.aimYaw, Math.atan2(-dx, -dz), b.turnStep);
  b.aimPitch = clamp(stepTo(b.aimPitch, pitch - GRENADE_THROW.lift, b.turnStep), -HALF_PI, HALF_PI);
  const aimed =
    Math.abs(angleDelta(b.aimYaw, Math.atan2(-dx, -dz))) < AI_GRENADE.aimTolDeg * DEG_TO_RAD &&
    Math.abs(b.aimPitch - (pitch - GRENADE_THROW.lift)) < AI_GRENADE.aimTolDeg * DEG_TO_RAD;
  switch (b.grenadePhase) {
    case GRENADE_PHASE.switching:
      if (inHand && since >= t.grenadeSwitch) {
        b.grenadePhase = GRENADE_PHASE.aiming;
        b.grenadePhaseTick = tick;
      } else if (since > t.grenadeSwitch * 3) finishGrenade(b, tick, t);
      return 0;
    case GRENADE_PHASE.aiming:
      if (aimed) {
        b.grenadePhase = GRENADE_PHASE.cooking;
        b.grenadePhaseTick = tick;
        // Cozinha o que o voo deixa: o pavio menos o tempo no ar e uma folga.
        const flight = d / (WEAPON_GRENADE.projectileSpeed * Math.cos(pitch));
        b.grenadeCookTicks = Math.max(
          1,
          Math.round(clamp(WEAPON_GRENADE.fuseS - flight - AI_GRENADE.fuseSlackS, 0, AI_GRENADE.maxCookS) * t.hz),
        );
        return BUTTON.fire;
      }
      if (since > t.grenadeSwitch * 4) finishGrenade(b, tick, t);
      return 0;
    case GRENADE_PHASE.cooking:
      if (since >= b.grenadeCookTicks) {
        b.grenadePhase = GRENADE_PHASE.release;
        b.grenadePhaseTick = tick;
        return 0;
      }
      return BUTTON.fire;
    default:
      if (since >= t.grenadeSwitch) finishGrenade(b, tick, t);
      return 0;
  }
}

function finishGrenade(b: SoldierBrain, tick: number, t: SoldierTiming): void {
  b.grenadePhase = GRENADE_PHASE.none;
  b.wantSlot = WEAPON_SLOT.primary;
  b.grenadeNextTick = tick + t.grenadeCooldown;
}

/**
 * Ângulo do arco BAIXO (rad, acima do horizonte) para levar o projétil a `d` m no plano e `dy` m de altura, com
 * velocidade `v` e gravidade `g`; `NaN` se não alcança.
 */
export function throwPitch(d: number, dy: number, v: number, g: number): number {
  if (d < 1e-3) return dy >= 0 ? HALF_PI : -HALF_PI;
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * d * d + 2 * dy * v2);
  if (disc < 0) return Number.NaN;
  return Math.atan((v2 - Math.sqrt(disc)) / (g * d));
}

function turnTo(current: number, goal: number, step: number): number {
  const delta = angleDelta(current, goal);
  return wrapAngle(current + (delta > step ? step : delta < -step ? -step : delta));
}

function stepTo(current: number, goal: number, step: number): number {
  return current + clamp(goal - current, -step, step);
}

/** Recuo do N2: vida abaixo desta fração (cresce com a cautela; o Covarde foge com 60%, o Kamikaze nunca recua). */
export function retreatBelow(b: SoldierBrain): number {
  const p = b.personality;
  if (p.preset === 'kamikaze') return 0;
  const base = AI_RETREAT.belowBase + AI_RETREAT.belowCaution * p.caution;
  return p.preset === 'coward' ? Math.max(base, AI_PERSONA.cowardFleeHp) : base;
}
