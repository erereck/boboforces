import { FIGURE_BONE } from '@boboforces/format';
import { BUTTON } from '@boboforces/input';
import { DEG_TO_RAD } from '@boboforces/shared';
import { ZOMBIE_KINDS, ZOMBIE_RULES, ZOMBIE_SPECIALS, ZOMBIE_TYPE } from '../config/zombie.ts';
import { ZOMBIE_SPIT } from '../config/weapons.ts';
import { launchProjectile } from './projectiles.ts';
import { canHurt, hostile, isBody, PART_TORSO, WEAPON_NONE, type SimContext } from '../context.ts';
import { ENTITY_FLAG, ENTITY_KIND, NULL_ENTITY } from '../entity.ts';
import { aimPointWorldWith, type AimPoint } from '../hitbox.ts';
import { isLivePhase } from '../view.ts';

/**
 * Passo 3 (zumbis): o golpe corpo a corpo do zumbi do teste de estresse. Segurando `melee` (ou `fire`), golpeia a cada
 * `ZOMBIE_RULES.meleeIntervalS`: acerta o inimigo mais perto dentro do alcance, à frente e na mesma altura, com dano no
 * tronco pela fila (passo 5; o ponto do golpe é o centro da hitbox do tronco na postura e no pitch do alvo), e emite
 * `melee` (com o alvo, ou `NULL_ENTITY` se errou) para animação e som.
 * O tempo até o próximo golpe usa o mesmo campo do tiro (`fireCooldownS`): zumbi não tem arma.
 */

const F = ENTITY_FLAG;
const READY_EPS = 1e-6;
const CONE_COS = Math.cos(ZOMBIE_RULES.meleeHalfAngleDeg * DEG_TO_RAD);
const point: AimPoint = { x: 0, y: 0, z: 0 };

export function meleeSystem(ctx: SimContext): void {
  const s = ctx.s;
  const playing = isLivePhase(ctx.match.phase);
  for (let e = 0; e < s.count; e++) {
    if (s.alive[e] === 0 || s.kind[e] !== ENTITY_KIND.zombie) continue;
    let fl = s.flags[e]! & ~F.firing;
    if ((fl & F.dead) !== 0) {
      s.flags[e] = fl;
      continue;
    }
    if (s.fireCooldownS[e]! > READY_EPS) s.fireCooldownS[e] = s.fireCooldownS[e]! - ctx.dt;
    const btn = s.inButtons[e]!;
    const kind = ZOMBIE_KINDS[s.zombieType[e]!] ?? ZOMBIE_KINDS[0]!;
    if (playing && (btn & (BUTTON.melee | BUTTON.fire)) !== 0 && s.fireCooldownS[e]! <= READY_EPS) {
      // M3 (fase 3b): o Spitter cospe com o atirar (o golpe continua no corpo a corpo).
      if (s.zombieType[e] === ZOMBIE_TYPE.spitter && (btn & BUTTON.melee) === 0) {
        s.fireCooldownS[e] = ZOMBIE_SPECIALS.spitCooldownS;
        spit(ctx, e);
      } else {
        s.fireCooldownS[e] = kind.intervalS;
        swing(ctx, e, kind.damage, kind.rangeM * kind.rangeM);
      }
      fl |= F.firing;
    }
    s.flags[e] = fl;
  }
}

function swing(ctx: SimContext, e: number, damage: number, range2: number): void {
  const s = ctx.s;
  const e3 = e * 3;
  const ex = s.position[e3]!;
  const ey = s.position[e3 + 1]!;
  const ez = s.position[e3 + 2]!;
  const fx = -Math.sin(s.yaw[e]!);
  const fz = -Math.cos(s.yaw[e]!);
  let best = -1;
  let bestD2 = range2;
  for (let j = 0; j < s.count; j++) {
    if (s.alive[j] === 0 || !isBody(s.kind[j]!) || (s.flags[j]! & F.dead) !== 0 || !canHurt(ctx, e, j)) continue;
    const j3 = j * 3;
    const dx = s.position[j3]! - ex;
    const dz = s.position[j3 + 2]! - ez;
    const d2 = dx * dx + dz * dz;
    if (d2 > bestD2 || Math.abs(s.position[j3 + 1]! - ey) > ZOMBIE_RULES.meleeMaxDy) continue;
    // Colado no alvo (d ≈ 0) conta como à frente.
    const d = Math.sqrt(d2);
    if (d > 0.05 && (dx * fx + dz * fz) / d < CONE_COS) continue;
    best = j;
    bestD2 = d2;
  }
  const attacker = s.idOf(e);
  if (best < 0) {
    ctx.events.melee(ctx.tick, attacker, NULL_ENTITY);
    return;
  }
  // Direção pelo eixo do alvo (como antes); o ponto do golpe é o centro do tronco dele.
  const b3 = best * 3;
  const table = ctx.figures.table;
  if (table === null) throw new Error('sim: tabela de jogo solta (dispose)');
  aimPointWorldWith(table, s, best, false, point);
  let dx = s.position[b3]! - ex;
  let dz = s.position[b3 + 2]! - ez;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d > 1e-6) {
    dx /= d;
    dz /= d;
  } else {
    dx = fx;
    dz = fz;
  }
  ctx.events.melee(ctx.tick, attacker, s.idOf(best));
  const i = ctx.damage.push(
    best,
    attacker,
    damage,
    PART_TORSO,
    FIGURE_BONE.torso,
    WEAPON_NONE,
    point.x,
    point.y,
    point.z,
  );
  ctx.damage.setDirection(i, dx, 0, dz, ZOMBIE_RULES.meleeForce);
}

/** M3 (fase 3b): o cuspe do Spitter: projétil lento da boca, na direção da mira. */
function spit(ctx: SimContext, e: number): void {
  const s = ctx.s;
  const e3 = e * 3;
  const yaw = s.yaw[e]!;
  const pitch = s.pitch[e]!;
  const cp = Math.cos(pitch);
  const v = ZOMBIE_SPECIALS.spitSpeed;
  launchProjectile(
    ctx,
    s.idOf(e),
    ZOMBIE_SPIT,
    s.position[e3]!,
    s.position[e3 + 1]! + 1.5 * s.bodyScale[e]!,
    s.position[e3 + 2]!,
    -Math.sin(yaw) * cp * v,
    Math.sin(pitch) * v,
    -Math.cos(yaw) * cp * v,
    0,
  );
}
