import { BUTTON } from '@boboforces/input';
import { clamp, DEG_TO_RAD, HALF_PI, TAU } from '@boboforces/shared';
import { BLOCK_FLAG, cellBlock, createRayHit, raycastGrid } from '@boboforces/world';
import { MATCH_DEFAULTS } from '../config/rules.ts';
import { PART_DAMAGE_MULTIPLIER } from '../config/metrics.ts';
import {
  SPREAD_STATE_MULTIPLIER,
  SPREAD_WALKING_SPEED,
  WEAPON_SLOTS,
  weaponDamageAt,
  type WeaponDef,
} from '../config/weapons.ts';
import { HIT_PARTS, hostile, PART_HEAD, type SimContext } from '../context.ts';
import { secondsToTicks } from '../constants.ts';
import { ENTITY_FLAG, ENTITY_KIND } from '../entity.ts';
import { createBoboHit, eyeHeightFor, rayVsBobo } from '../hitbox.ts';

/**
 * Passo 3: armas (tecnico.md §7.2). Recarga, troca, cadência e hitscan: DDA na grade até o primeiro bloco que para
 * bala (distância máxima) e depois o raio contra as hitboxes dos inimigos. O dano vai para a fila e só é aplicado no
 * passo 5. Sem fogo amigo no M0 (o raio atravessa aliados).
 *
 * Recuo: cada tiro sobe `recoilPitch` (e mexe um pouco o `recoilYaw`), somados à mira do InputFrame; parado de atirar,
 * volta ao centro. A `SimView` expõe os dois para a câmera e para a IA compensar (controle de recoil).
 *
 * M0: busca linear nos bobos (até 68), sem o hash espacial de 4 m; ele entra quando houver projéteis e props (M2).
 */

const F = ENTITY_FLAG;
/** Folga do "pronto para atirar" (s): a soma de frações de tick em float nunca chega a zero exato. */
const FIRE_READY_EPS = 1e-6;
const rayHit = createRayHit();
const boboHit = createBoboHit();

export function weaponSystem(ctx: SimContext): void {
  const s = ctx.s;
  const hz = ctx.hz;
  const switchTicks = secondsToTicks(MATCH_DEFAULTS.weaponSwitchS, hz);
  const playing = ctx.match.phase === 'playing';

  for (let e = 0; e < s.count; e++) {
    if (s.alive[e] === 0 || s.kind[e] !== ENTITY_KIND.bobo) continue;
    let fl = s.flags[e]! & ~(F.firing | F.reloading);
    if ((fl & F.dead) !== 0) {
      s.flags[e] = fl;
      continue;
    }
    const btn = s.inButtons[e]!;
    const pressed = btn & ~s.prevButtons[e]!;

    if (s.fireCooldownS[e]! > FIRE_READY_EPS) s.fireCooldownS[e] = s.fireCooldownS[e]! - ctx.dt;
    if ((fl & F.sprinting) === 0 && s.sprintFireDelayTicks[e]! > 0) s.sprintFireDelayTicks[e]!--;

    // Troca de arma: o InputFrame traz o slot absoluto; só age se o slot tiver arma e for outro.
    const want = s.inWeapon[e]!;
    if (want !== s.weapon[e] && WEAPON_SLOTS[want]) {
      s.weapon[e] = want;
      s.switchTicks[e] = switchTicks;
      s.reloadTicks[e] = 0;
      ctx.events.weapon(ctx.tick, s.idOf(e), want, 'switch');
    }
    if (s.switchTicks[e]! > 0) s.switchTicks[e]!--;
    const def = WEAPON_SLOTS[s.weapon[e]!];
    if (!def) {
      s.flags[e] = fl;
      continue;
    }

    // Recarga: termina, ou começa (botão com pente incompleto, ou pente vazio).
    if (s.reloadTicks[e]! > 0) {
      if (--s.reloadTicks[e]! === 0) {
        const take = Math.min(def.clipSize - s.ammoClip[e]!, s.ammoReserve[e]!);
        s.ammoClip[e] = s.ammoClip[e]! + take;
        s.ammoReserve[e] = s.ammoReserve[e]! - take;
        ctx.events.weapon(ctx.tick, s.idOf(e), s.weapon[e]!, 'reloadEnd');
      }
    } else if (
      s.switchTicks[e] === 0 &&
      s.ammoReserve[e]! > 0 &&
      (s.ammoClip[e] === 0 || ((pressed & BUTTON.reload) !== 0 && s.ammoClip[e]! < def.clipSize))
    ) {
      s.reloadTicks[e] = Math.max(1, secondsToTicks(def.reloadS, hz));
      ctx.events.weapon(ctx.tick, s.idOf(e), s.weapon[e]!, 'reloadStart');
    }
    if (s.reloadTicks[e]! > 0) fl |= F.reloading;

    // Gatilho.
    const trigger = def.automatic ? (btn & BUTTON.fire) !== 0 : (pressed & BUTTON.fire) !== 0;
    if (
      trigger &&
      playing &&
      s.reloadTicks[e] === 0 &&
      s.switchTicks[e] === 0 &&
      s.fireCooldownS[e]! <= FIRE_READY_EPS &&
      (fl & F.sprinting) === 0 &&
      s.sprintFireDelayTicks[e] === 0
    ) {
      if (s.ammoClip[e] === 0) {
        if ((pressed & BUTTON.fire) !== 0) ctx.events.weapon(ctx.tick, s.idOf(e), s.weapon[e]!, 'empty');
      } else {
        fire(ctx, e, def, fl);
        fl |= F.firing;
        fl &= ~F.spawnProtected;
        s.spawnProtectTicks[e] = 0;
      }
    }
    // O resto só vale atirando sem parar: parado, o próximo tiro não pode "adiantar" (sem rajada acumulada).
    if ((fl & F.firing) === 0 && s.fireCooldownS[e]! < 0) s.fireCooldownS[e] = 0;

    // Recuo volta ao centro depois de um tempo sem atirar.
    if (ctx.tick - s.lastShotTick[e]! > secondsToTicks(def.recoilRecoverDelayS, hz)) {
      const step = def.recoilRecoverDegPerS * DEG_TO_RAD * ctx.dt;
      s.recoilPitch[e] = towardZero(s.recoilPitch[e]!, step);
      s.recoilYaw[e] = towardZero(s.recoilYaw[e]!, step);
    }
    s.flags[e] = fl;
  }
}

function towardZero(v: number, step: number): number {
  if (v > step) return v - step;
  if (v < -step) return v + step;
  return 0;
}

function fire(ctx: SimContext, e: number, def: WeaponDef, fl: number): void {
  const s = ctx.s;
  const rng = ctx.rngWeapons;
  const i3 = e * 3;
  s.ammoClip[e] = s.ammoClip[e]! - 1;
  // Carrega o resto do tick (no máximo 1 tick, para cadência acima do tick não acumular dívida).
  s.fireCooldownS[e] = Math.max(s.fireCooldownS[e]!, -ctx.dt) + 60 / def.rpm;
  s.lastShotTick[e] = ctx.tick;

  const ox = s.position[i3]!;
  const oy = s.position[i3 + 1]! + eyeHeightFor(fl);
  const oz = s.position[i3 + 2]!;

  // Direção da mira (InputFrame + recuo acumulado), convenção do shared: yaw 0 olha para -Z.
  const yaw = s.yaw[e]! + s.recoilYaw[e]!;
  const pitch = clamp(s.pitch[e]! + s.recoilPitch[e]!, -HALF_PI, HALF_PI);
  const cp = Math.cos(pitch);
  let dx = -Math.sin(yaw) * cp;
  let dy = Math.sin(pitch);
  let dz = -Math.cos(yaw) * cp;

  // Cone de dispersão pelo estado (gameplay.md §3.4), amostrado uniforme no disco.
  const vx = s.velocity[i3]!;
  const vz = s.velocity[i3 + 2]!;
  let mul: number;
  if ((fl & F.onGround) === 0) mul = SPREAD_STATE_MULTIPLIER.air;
  else if ((fl & F.crouching) !== 0) mul = SPREAD_STATE_MULTIPLIER.crouching;
  else if (vx * vx + vz * vz > SPREAD_WALKING_SPEED * SPREAD_WALKING_SPEED) mul = SPREAD_STATE_MULTIPLIER.walking;
  else mul = SPREAD_STATE_MULTIPLIER.still;
  if ((fl & F.ads) !== 0) mul *= def.adsSpreadMul;
  const spread = def.hipSpreadDeg * mul * DEG_TO_RAD;
  const r = spread * Math.sqrt(rng.next());
  const a = rng.next() * TAU;
  if (r > 0) {
    // Base ortonormal em volta de `d`: direita no plano e "cima" perpendicular.
    let rx = -dz;
    let rz = dx;
    const rl = Math.sqrt(rx * rx + rz * rz);
    if (rl < 1e-9) {
      rx = 1;
      rz = 0;
    } else {
      rx /= rl;
      rz /= rl;
    }
    // up = right × d
    const ux = -rz * dy;
    const uy = rz * dx - rx * dz;
    const uz = rx * dy;
    const sr = Math.sin(r);
    const cr = Math.cos(r);
    const ca = Math.cos(a) * sr;
    const sa = Math.sin(a) * sr;
    dx = dx * cr + rx * ca + ux * sa;
    dy = dy * cr + uy * sa;
    dz = dz * cr + rz * ca + uz * sa;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    dx /= dl;
    dy /= dl;
    dz /= dl;
  }

  // Recuo para os próximos tiros.
  s.recoilPitch[e] = Math.min(def.recoilMaxDeg * DEG_TO_RAD, s.recoilPitch[e]! + def.recoilKickDeg * DEG_TO_RAD);
  s.recoilYaw[e] = clamp(
    s.recoilYaw[e]! + (rng.next() * 2 - 1) * def.recoilYawNoiseDeg * DEG_TO_RAD,
    -def.recoilMaxDeg * DEG_TO_RAD * 0.5,
    def.recoilMaxDeg * DEG_TO_RAD * 0.5,
  );

  // 1) Cenário: até onde a bala vai.
  raycastGrid(ctx.grid, ctx.blocks, ox, oy, oz, dx, dy, dz, def.rangeM, BLOCK_FLAG.blocksBullets, rayHit);
  const wallT = rayHit.hit ? rayHit.distance : def.rangeM;

  // 2) Hitboxes dos inimigos antes disso.
  let bestT = wallT;
  let bestTarget = -1;
  let bestPart = 0;
  for (let j = 0; j < s.count; j++) {
    if (s.alive[j] === 0 || s.kind[j] !== ENTITY_KIND.bobo || !hostile(ctx, e, j)) continue;
    const fj = s.flags[j]!;
    if ((fj & F.dead) !== 0) continue;
    const j3 = j * 3;
    const t = rayVsBobo(
      s.position[j3]!,
      s.position[j3 + 1]!,
      s.position[j3 + 2]!,
      s.yaw[j]!,
      (fj & F.crouching) !== 0,
      ox,
      oy,
      oz,
      dx,
      dy,
      dz,
      bestT,
      boboHit,
    );
    if (t < bestT) {
      bestT = t;
      bestTarget = j;
      bestPart = boboHit.part;
    }
  }

  const shooter = s.idOf(e);
  if (bestTarget >= 0) {
    const part = HIT_PARTS[bestPart]!;
    const base = weaponDamageAt(def, bestT);
    const mult = bestPart === PART_HEAD ? def.headMultiplier : PART_DAMAGE_MULTIPLIER[part as 'torso' | 'arm' | 'leg'];
    ctx.damage.push(
      bestTarget,
      shooter,
      base * mult,
      bestPart,
      s.weapon[e]!,
      ox + dx * bestT,
      oy + dy * bestT,
      oz + dz * bestT,
    );
  } else if (rayHit.hit) {
    ctx.events.impact(
      ctx.tick,
      rayHit.x,
      rayHit.y,
      rayHit.z,
      rayHit.normalX,
      rayHit.normalY,
      rayHit.normalZ,
      rayHit.cellX,
      rayHit.cellY,
      rayHit.cellZ,
      cellBlock(rayHit.cell),
    );
  }
  ctx.events.shot(ctx.tick, shooter, s.weapon[e]!, ox, oy, oz, dx, dy, dz, bestT);
}
