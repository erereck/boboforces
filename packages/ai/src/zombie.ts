import { BUTTON, quantizeAxis, type InputFrame } from '@boboforces/input';
import { DEG_TO_RAD, pitchToI16, yawToU16, type Rng } from '@boboforces/shared';
import {
  ENTITY_FLAG,
  ENTITY_KIND,
  secondsToTicks,
  ZOMBIE_BARRICADES,
  ZOMBIE_SPECIALS,
  ZOMBIE_TYPE,
  type SimView,
} from '@boboforces/sim';
import { AI_PATH, AI_ZOMBIE } from './config.ts';
import type { AiContext } from './context.ts';
import { createSteer, type PathFollower } from './paths.ts';
import { turnToward } from './soldier.ts';

/**
 * Zumbi do teste de estresse (tecnico.md §8.3: "zumbi é mais barato que soldado"): N0 puro, sem percepção por raio.
 * Sabe onde estão os bobos (como no Bobo Zombies), escolhe o vivo mais perto a cada 0,5 s (1 s longe dos humanos),
 * persegue pelo flow field compartilhado (M3, fase 3c; sem ele, pela rota do A*, na mesma fila com orçamento dos
 * soldados), vai direto nos últimos metros e segura o golpe quando está colado. Pula nas ligações de pulo e quando
 * empaca. M3 (fase 3a): no Bobo Zombies, quem está caído não é presa.
 */

const F = ENTITY_FLAG;

export class ZombieTiming {
  readonly retargetA: number;
  readonly retargetB: number;
  readonly replanA: number;
  readonly replanB: number;
  readonly stuck: number;
  /** M3 (fase 3c): sem andar `AI_PATH.unstuckMoveM` neste tempo (perseguindo, sem bater nem cuspir): Destravar. */
  readonly unstuck: number;
  readonly turnStep: number;

  constructor(hz: number) {
    this.retargetA = Math.max(1, secondsToTicks(AI_ZOMBIE.retargetSA, hz));
    this.retargetB = Math.max(1, secondsToTicks(AI_ZOMBIE.retargetSB, hz));
    this.replanA = secondsToTicks(AI_ZOMBIE.replanSA, hz);
    this.replanB = secondsToTicks(AI_ZOMBIE.replanSB, hz);
    this.stuck = Math.max(1, secondsToTicks(AI_PATH.stuckS, hz));
    this.unstuck = Math.max(1, secondsToTicks(AI_PATH.unstuckS, hz));
    this.turnStep = (AI_ZOMBIE.turnDegPerS * DEG_TO_RAD) / hz;
  }
}

export class ZombieBrain {
  readonly index: number;
  readonly controller: number;
  readonly rng: Rng;
  readonly follower: PathFollower;
  wasDead = true;
  aimYaw = 0;
  lodA = true;
  target = -1;
  targetGen = 0;
  nextRetargetTick = 0;
  stuckTick = 0;
  stuckX = 0;
  stuckZ = 0;
  stuckCount = 0;
  /** M3 (fase 3c): onde e quando andou de verdade pela última vez (para o Destravar). */
  progressTick = 0;
  progressX = 0;
  progressZ = 0;
  jumpHeld = false;

  constructor(index: number, controller: number, rng: Rng, timing: ZombieTiming, follower: PathFollower) {
    this.index = index;
    this.controller = controller;
    this.rng = rng;
    this.follower = follower;
    this.nextRetargetTick = index % timing.retargetA;
  }
}

const steer = createSteer();
const push = { x: 0, z: 0 };

/** O bobo vivo (humano ou bot) mais perto, ou -1. */
function nearestPrey(c: AiContext, x: number, y: number, z: number): number {
  const v = c.view!;
  let best = -1;
  let bestD2 = Infinity;
  for (let j = 0; j < v.count; j++) {
    // M3 (fase 3a): quem está caído não é presa (não toma dano; o zumbi vai atrás de quem está de pé).
    if (v.kind[j] !== ENTITY_KIND.bobo || !c.living(j) || (v.flags[j]! & F.downed) !== 0) continue;
    const dx = v.position[j * 3]! - x;
    const dy = v.position[j * 3 + 1]! - y;
    const dz = v.position[j * 3 + 2]! - z;
    // Andar de cima/de baixo pesa mais (a rota é mais longa que a reta).
    const d2 = dx * dx + dz * dz + dy * dy * 4;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = j;
    }
  }
  return best;
}

/** M3 (fase 3d): a janela com tábua de cujo lado de fora o zumbi está colado (a sim deixa ele arrancar), ou -1. */
function windowAhead(v: SimView, x: number, y: number, z: number, scale: number): number {
  const mo = v.mapObjects;
  if (mo === null) return -1;
  const reach = ZOMBIE_BARRICADES.tearReachM * scale;
  for (let w = 0; w < mo.barricades; w++) {
    if (mo.planks[w] === 0) continue;
    const dx = x - mo.bx[w]!;
    const dz = z - mo.bz[w]!;
    const dn = dx * mo.bnx[w]! + dz * mo.bnz[w]!;
    const dt = Math.abs(dx * mo.bnz[w]! - dz * mo.bnx[w]!);
    if (dn > 0 && dn <= reach && dt <= mo.bhw[w]! + ZOMBIE_BARRICADES.sideSlackM && Math.abs(y - mo.by[w]!) <= 1) {
      return w;
    }
  }
  return -1;
}

export function thinkZombie(c: AiContext, zb: ZombieBrain, f: InputFrame, t: ZombieTiming): void {
  const v = c.view!;
  f.seq = (f.seq + 1) & 0xffff;
  f.buttons = 0;
  f.moveX = 0;
  f.moveY = 0;
  f.weapon = 0;
  const e = c.ctrlToEntity[zb.controller]!;
  if (e < 0) return;
  if ((v.flags[e]! & F.dead) !== 0) {
    if (!zb.wasDead) zb.follower.clear();
    zb.wasDead = true;
    zb.target = -1;
    return;
  }
  const tick = c.tick;
  const e3 = e * 3;
  const x = v.position[e3]!;
  const y = v.position[e3 + 1]!;
  const z = v.position[e3 + 2]!;
  if (zb.wasDead) {
    zb.wasDead = false;
    zb.aimYaw = v.yaw[e]!;
    zb.target = -1;
    zb.nextRetargetTick = tick;
    zb.stuckTick = tick;
    zb.stuckX = x;
    zb.stuckZ = z;
    zb.stuckCount = 0;
    zb.progressTick = tick;
    zb.progressX = x;
    zb.progressZ = z;
    zb.follower.clear();
  }

  const valid =
    zb.target >= 0 &&
    c.living(zb.target) &&
    v.generation[zb.target] === zb.targetGen &&
    v.kind[zb.target] === ENTITY_KIND.bobo &&
    (v.flags[zb.target]! & F.downed) === 0;
  // Alvo morreu: procura outro já; sem ninguém vivo, só no próximo intervalo (não varre todo tick).
  if ((zb.target >= 0 && !valid) || tick >= zb.nextRetargetTick) {
    zb.lodA = c.nearObserver(x, z);
    const prey = nearestPrey(c, x, y, z);
    if (prey !== zb.target) zb.follower.invalidate();
    zb.target = prey;
    zb.targetGen = prey >= 0 ? v.generation[prey]! : 0;
    zb.nextRetargetTick = tick + (zb.lodA ? t.retargetA : t.retargetB);
  }
  let buttons = 0;
  let wx = 0;
  let wz = 0;
  /** M3 (fase 3b): o Spitter mirando para cuspir (vira para o alvo em vez do caminho) e o pitch da mira. */
  let spitting = false;
  let pitch = 0;
  if (zb.target >= 0) {
    const t3 = zb.target * 3;
    const tx = v.position[t3]!;
    const ty = v.position[t3 + 1]!;
    const tz = v.position[t3 + 2]!;
    const dx = tx - x;
    const dz = tz - z;
    const dy = ty - y;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const sameFloor = Math.abs(dy) < 1;
    if ((dist < AI_ZOMBIE.directM && sameFloor) || v.nav === null) {
      if (dist > 1e-6) {
        wx = dx / dist;
        wz = dz / dist;
      }
    } else if (c.flow !== null && c.flow.steer(x, y, z, (v.flags[e]! & F.onGround) !== 0, steer)) {
      // M3 (fase 3c): o flow field compartilhado (rumo ao bobo de pé mais perto pelo caminho).
      wx = steer.x;
      wz = steer.z;
      if (steer.jump) buttons |= BUTTON.jump;
      if (steer.crouch) buttons |= BUTTON.crouch;
    } else {
      c.paths.want(zb.follower, x, y, z, tx, ty, tz, tick, zb.lodA ? t.replanA : t.replanB);
      if (c.paths.steer(zb.follower, x, y, z, (v.flags[e]! & F.onGround) !== 0, steer)) {
        wx = steer.x;
        wz = steer.z;
        if (steer.jump) buttons |= BUTTON.jump;
        if (steer.crouch) buttons |= BUTTON.crouch;
      } else if (dist > 1e-6) {
        // Rota ainda na fila (ou impossível): vai reto.
        wx = dx / dist;
        wz = dz / dist;
      }
    }
    if (dist <= AI_ZOMBIE.attackM && sameFloor) {
      buttons |= BUTTON.melee;
      // Colado: vira para o alvo (o golpe precisa dele à frente) e para de empurrar.
      zb.aimYaw = turnToward(zb.aimYaw, Math.atan2(-dx, -dz), t.turnStep);
      wx *= 0.2;
      wz *= 0.2;
    }
    // M3 (fase 3b): o Spitter cospe de longe, mais devagar (a sim espera o intervalo entre cuspes).
    if (
      v.zombieType[e] === ZOMBIE_TYPE.spitter &&
      dist > AI_ZOMBIE.attackM * 2 &&
      dist < ZOMBIE_SPECIALS.spitRangeM &&
      Math.abs(dy) < 3
    ) {
      spitting = true;
      zb.aimYaw = turnToward(zb.aimYaw, Math.atan2(-dx, -dz), t.turnStep);
      pitch = Math.atan2(ty + 1 - (y + 1.5), dist);
      buttons |= BUTTON.fire;
      wx *= 0.3;
      wz *= 0.3;
    }

    // M3 (fase 3d): colado do lado de fora de uma janela com tábua: bate nelas (a sim arranca uma a cada 1,5 s),
    // virado para dentro, e continua empurrando. Não está preso.
    const w = windowAhead(v, x, y, z, v.bodyScale[e]!);
    if (w >= 0) {
      const mo = v.mapObjects!;
      buttons |= BUTTON.melee;
      zb.aimYaw = turnToward(zb.aimYaw, Math.atan2(mo.bnx[w]!, mo.bnz[w]!), t.turnStep);
      zb.progressTick = tick;
      zb.progressX = x;
      zb.progressZ = z;
      zb.stuckTick = tick;
      zb.stuckX = x;
      zb.stuckZ = z;
    }

    // M3 (fase 3c): preso de vez (enroscado numa quina, no ar): Destravar (a sim leva a um ponto de nascer).
    const pmx = x - zb.progressX;
    const pmz = z - zb.progressZ;
    if (
      (buttons & BUTTON.melee) !== 0 ||
      spitting ||
      pmx * pmx + pmz * pmz >= AI_PATH.unstuckMoveM * AI_PATH.unstuckMoveM
    ) {
      zb.progressTick = tick;
      zb.progressX = x;
      zb.progressZ = z;
    } else if (tick - zb.progressTick >= t.unstuck) {
      buttons |= BUTTON.unstuck;
      zb.progressTick = tick;
    }

    // Empacou: pula; de novo, pede outra rota.
    if (tick - zb.stuckTick >= t.stuck) {
      const mx = x - zb.stuckX;
      const mz = z - zb.stuckZ;
      if (dist > AI_ZOMBIE.attackM && mx * mx + mz * mz < AI_PATH.stuckMoveM * AI_PATH.stuckMoveM) {
        zb.stuckCount++;
        buttons |= BUTTON.jump;
        if (zb.stuckCount >= 2) zb.follower.invalidate();
      } else {
        zb.stuckCount = 0;
      }
      zb.stuckTick = tick;
      zb.stuckX = x;
      zb.stuckZ = z;
    }
  } else {
    // Sem presa: parado não é estar preso.
    zb.progressTick = tick;
    zb.progressX = x;
    zb.progressZ = z;
  }

  c.separation(e, x, y, z, push);
  wx += push.x * AI_PATH.separationWeight;
  wz += push.z * AI_PATH.separationWeight;
  const wl = Math.sqrt(wx * wx + wz * wz);
  if (wl > 1e-6) {
    if (wl > 1) {
      wx /= wl;
      wz /= wl;
    }
    if ((buttons & BUTTON.melee) === 0 && !spitting)
      zb.aimYaw = turnToward(zb.aimYaw, Math.atan2(-wx, -wz), t.turnStep);
  }
  // Pulo com borda (a sim só pula ao apertar).
  if ((buttons & BUTTON.jump) !== 0) {
    if (zb.jumpHeld) buttons &= ~BUTTON.jump;
    zb.jumpHeld = !zb.jumpHeld;
  } else {
    zb.jumpHeld = false;
  }
  const s = Math.sin(zb.aimYaw);
  const co = Math.cos(zb.aimYaw);
  f.buttons = buttons;
  f.moveX = quantizeAxis(co * wx - s * wz);
  f.moveY = quantizeAxis(-s * wx - co * wz);
  f.yaw = yawToU16(zb.aimYaw);
  f.pitch = pitchToI16(pitch);
}
