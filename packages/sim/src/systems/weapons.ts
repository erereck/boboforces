import { PERK, ZOMBIE_PERKS } from '../config/zombie.ts';
import { FIGURE_BONE, FIGURE_PART_CATEGORY, type FigurePart } from '@boboforces/format';
import { BUTTON, WEAPON_SLOT_COUNT } from '@boboforces/input';
import { clamp, DEG_TO_RAD, HALF_PI, TAU } from '@boboforces/shared';
import { BLOCK_FLAG, cellBlock, createRayHit, raycastGrid } from '@boboforces/world';
import { MATCH_DEFAULTS } from '../config/rules.ts';
import { PART_DAMAGE_MULTIPLIER } from '../config/metrics.ts';
import {
  GRENADE_THROW,
  SPREAD_STATE_MULTIPLIER,
  SPREAD_WALKING_SPEED,
  WEAPON_FIRE,
  weaponDamageAt,
  weaponDef,
  type WeaponDef,
} from '../config/weapons.ts';
import {
  AMMO_RULE,
  HIT_PARTS,
  canHurt,
  hostile,
  isBody,
  PART_HEAD,
  PART_TORSO,
  RULE_FLAG,
  type SimContext,
} from '../context.ts';
import { BOT_CONTROLLER_BASE, secondsToTicks } from '../constants.ts';
import { ENTITY_FLAG, ENTITY_KIND, NULL_ENTITY } from '../entity.ts';
import { aimPointWorldWith, eyeHeightFor, figurePostureOf, weaponGrip, type AimPoint } from '../hitbox.ts';
import { isLivePhase } from '../view.ts';
import { explode, launchProjectile, rocketFuseTicks } from './projectiles.ts';

/**
 * Passo 3: armas (tecnico.md §7.2; M2 fase 1: as 8 armas). Troca de slot, ADS com tempo de entrada, recarga (pente
 * inteiro ou por cartucho), cadência e o disparo de cada tipo (`WEAPON_FIRE`):
 * - bala: DDA na grade até o primeiro bloco que para bala e depois o raio contra as hitboxes dos inimigos;
 * - chumbos: `pellets` raios num cone fixo em volta da mira; o dano soma por alvo (um item de dano por alvo e por
 *   tiro, com a parte e o ponto do primeiro chumbo que acertou);
 * - golpe (faca): o inimigo mais perto à frente até `meleeRangeM`; pelas costas vale `backstabDamage`;
 * - projétil (foguete): lança no pool de projéteis (`projectiles.ts`), que explode no contato;
 * - arremesso (granada): apertar puxa o pino e começa a cozinhar (o pavio corre na mão), soltar joga com o pavio que
 *   sobrou; se o pavio acabar na mão, explode ali. Cozinhando não troca de slot.
 * O dano vai para a fila e só é aplicado no passo 5. Sem fogo amigo no M2 por padrão (o raio atravessa aliados).
 *
 * Recuo: cada tiro sobe `recoilPitch` e anda no padrão horizontal fixo da arma (`recoilPatternDeg`, pelo número do
 * tiro na rajada) mais um ruído pequeno; parado de atirar, volta ao centro. A `SimView` expõe os dois para a câmera e
 * para a IA compensar (controle de recoil).
 *
 * Slots: `InputFrame.weapon` é o slot DESEJADO (absoluto). A sim troca quando o slot desejado tem arma usável (a
 * granada sem nenhuma sobrando não é); se o slot na mão fica vazio (última granada), volta para a primária.
 *
 * Busca linear nas entidades (até 4 + 64 + 64), sem o hash espacial de 4 m: medido no bench headless, não pesa.
 */

const F = ENTITY_FLAG;
const S = WEAPON_SLOT_COUNT;
/** Folga do "pronto para atirar" (s): a soma de frações de tick em float nunca chega a zero exato. */
const FIRE_READY_EPS = 1e-6;
/** Passo do padrão horizontal do recuo por tiro (rad do seno). */
const RECOIL_PATTERN_STEP = 0.9;
/** Faca: meio-ângulo do cone à frente (graus), desnível máximo (m) e o cosseno de "pelas costas". */
const KNIFE_HALF_ANGLE_COS = Math.cos(50 * DEG_TO_RAD);
const KNIFE_MAX_DY = 1.0;
const BACKSTAB_COS = 0.5;
/** Granada: a mira sobe isto (rad) no arremesso, e a velocidade de quem joga entra por esta fração. */
const THROW_LIFT = GRENADE_THROW.lift;
const THROW_INHERIT = GRENADE_THROW.inherit;
/** Teto de alvos distintos por tiro de chumbos (a escopeta tem 8 chumbos). */
const MAX_PELLET_TARGETS = 16;

const rayHit = createRayHit();
const knifePoint: AimPoint = { x: 0, y: 0, z: 0 };

/** Rascunho do tiro de chumbos (alocado uma vez; regra 11). */
const pelletTarget = new Int32Array(MAX_PELLET_TARGETS);
const pelletDamage = new Float64Array(MAX_PELLET_TARGETS);
const pelletPart = new Uint8Array(MAX_PELLET_TARGETS);
const pelletBodyPart = new Uint8Array(MAX_PELLET_TARGETS);
const pelletPoint = new Float64Array(MAX_PELLET_TARGETS * 3);
const pelletDir = new Float64Array(MAX_PELLET_TARGETS * 3);
/** Direção do raio atual (saída de `aimDirection` e de `coneOffset`). */
const dir = new Float64Array(3);

/** O slot `k` (índice já multiplicado) tem arma usável? A granada sem nenhuma sobrando não conta. */
function slotUsable(s: SimContext['s'], k: number): boolean {
  const code = s.loadout[k]!;
  const def = weaponDef(code);
  if (def === null) return false;
  return def.fire !== WEAPON_FIRE.thrown || s.slotClip[k]! > 0;
}

export function weaponSystem(ctx: SimContext): void {
  const s = ctx.s;
  const hz = ctx.hz;
  const switchTicks = secondsToTicks(MATCH_DEFAULTS.weaponSwitchS, hz);
  const playing = isLivePhase(ctx.match.phase);

  for (let e = 0; e < s.count; e++) {
    if (s.alive[e] === 0 || s.kind[e] !== ENTITY_KIND.bobo) continue;
    let fl = s.flags[e]! & ~(F.firing | F.reloading);
    if ((fl & F.dead) !== 0) {
      s.flags[e] = fl;
      continue;
    }
    const btn = s.inButtons[e]!;
    const pressed = btn & ~s.prevButtons[e]!;
    const base = e * S;

    if (s.fireCooldownS[e]! > FIRE_READY_EPS) s.fireCooldownS[e] = s.fireCooldownS[e]! - ctx.dt;
    if ((fl & F.sprinting) === 0 && s.sprintFireDelayTicks[e]! > 0) s.sprintFireDelayTicks[e]!--;

    // Troca de slot: o desejado, se usável; o da mão vazio (última granada) volta para a primária.
    let want = s.inWeapon[e]!;
    if (want >= S || !slotUsable(s, base + want) || s.cookTicks[e]! >= 0) want = s.slot[e]!;
    // Sem o slot da mão (a lista de armas do bot tirou a primária, M2 fase 3b): o 1º slot usável.
    for (let q = 0; q < S && !slotUsable(s, base + want); q++) want = q;
    if (want !== s.slot[e]) {
      s.slot[e] = want;
      s.weapon[e] = s.loadout[base + want]!;
      s.switchTicks[e] = switchTicks;
      s.reloadTicks[e] = 0;
      s.burstShots[e] = 0;
      s.adsAmount[e] = 0;
      ctx.events.weapon(ctx.tick, s.idOf(e), s.weapon[e]!, 'switch');
    }
    if (s.switchTicks[e]! > 0) s.switchTicks[e]!--;
    // M2 (fase 3b): munição infinita (regra do bot): pente ou reserva voltam ao cheio a cada tick.
    const ammoRule = ctx.rules.ammo[e]!;
    if (ammoRule !== AMMO_RULE.normal) {
      for (let q = 0; q < S; q++) {
        const d = weaponDef(s.loadout[base + q]!);
        if (d === null) continue;
        if (ammoRule === AMMO_RULE.infiniteClip) s.slotClip[base + q] = d.clipSize;
        else s.slotReserve[base + q] = d.reserve;
      }
    }
    const def = weaponDef(s.weapon[e]!);
    if (def === null) {
      s.flags[e] = fl;
      continue;
    }
    const k = base + s.slot[e]!;

    // ADS: entra e sai em `adsInS` (o movimento liga o bit `ads` só parado de correr e de deslizar).
    const adsStep = def.adsInS > 0 ? ctx.dt / def.adsInS : 1;
    // M2 (fase 4e): sem ADS na partida, a mira nunca entra.
    s.adsAmount[e] =
      (fl & F.ads) !== 0 && ctx.mods.ads
        ? Math.min(1, s.adsAmount[e]! + adsStep)
        : Math.max(0, s.adsAmount[e]! - adsStep);

    const trigger = def.automatic ? (btn & BUTTON.fire) !== 0 : (pressed & BUTTON.fire) !== 0;

    // Recarga: termina (pente inteiro ou 1 cartucho), ou começa (botão com pente incompleto, ou pente vazio). A
    // escopeta (por cartucho) interrompe a recarga quando o gatilho é puxado com algum cartucho no pente.
    if (s.reloadTicks[e]! > 0 && def.reloadPerRoundS > 0 && trigger && s.slotClip[k]! > 0) {
      s.reloadTicks[e] = 0;
      ctx.events.weapon(ctx.tick, s.idOf(e), s.weapon[e]!, 'reloadEnd');
    }
    if (s.reloadTicks[e]! > 0) {
      if (--s.reloadTicks[e]! === 0) finishReload(ctx, e, k, def);
    } else if (
      s.switchTicks[e] === 0 &&
      def.clipSize > 0 &&
      s.slotReserve[k]! > 0 &&
      (s.slotClip[k] === 0 || ((pressed & BUTTON.reload) !== 0 && s.slotClip[k]! < def.clipSize))
    ) {
      s.reloadTicks[e] = Math.max(
        1,
        secondsToTicks((def.reloadPerRoundS > 0 ? def.reloadPerRoundS : def.reloadS) * reloadMul(ctx, e), hz),
      );
      ctx.events.weapon(ctx.tick, s.idOf(e), s.weapon[e]!, 'reloadStart');
    }
    if (s.reloadTicks[e]! > 0) fl |= F.reloading;

    const ready =
      playing &&
      s.reloadTicks[e] === 0 &&
      s.switchTicks[e] === 0 &&
      s.fireCooldownS[e]! <= FIRE_READY_EPS &&
      (fl & F.sprinting) === 0 &&
      s.sprintFireDelayTicks[e] === 0;

    // Granada: cozinha segurando, joga ao soltar, explode na mão se o pavio acabar.
    if (def.fire === WEAPON_FIRE.thrown) {
      let thrown = false;
      if (s.cookTicks[e]! >= 0) {
        s.cookTicks[e] = s.cookTicks[e]! - 1;
        if (s.cookTicks[e]! <= 0) {
          s.cookTicks[e] = -1;
          s.slotClip[k] = s.slotClip[k]! - 1;
          const e3 = e * 3;
          explode(
            ctx,
            s.position[e3]!,
            s.position[e3 + 1]! + eyeHeightFor(fl),
            s.position[e3 + 2]!,
            def,
            s.idOf(e),
            -1,
          );
          thrown = true;
        } else if ((btn & BUTTON.fire) === 0 || !playing) {
          throwGrenade(ctx, e, k, def, fl, s.cookTicks[e]!);
          s.cookTicks[e] = -1;
          thrown = true;
        }
      } else if ((pressed & BUTTON.fire) !== 0 && ready && s.slotClip[k]! > 0) {
        s.cookTicks[e] = Math.max(2, secondsToTicks(def.fuseS, hz));
        ctx.events.weapon(ctx.tick, s.idOf(e), s.weapon[e]!, 'cook');
      }
      if (thrown) {
        s.fireCooldownS[e] = 60 / def.rpm;
        s.lastShotTick[e] = ctx.tick;
        fl |= F.firing;
        fl &= ~F.spawnProtected;
        s.spawnProtectTicks[e] = 0;
      }
    }

    // Gatilho.
    if (trigger && ready && def.fire !== WEAPON_FIRE.thrown) {
      let fired = false;
      if (def.fire === WEAPON_FIRE.melee) {
        swingKnife(ctx, e, def);
        fired = true;
      } else if (
        def.fire === WEAPON_FIRE.bullet ||
        def.fire === WEAPON_FIRE.pellets ||
        def.fire === WEAPON_FIRE.projectile
      ) {
        if (s.slotClip[k] === 0) {
          if ((pressed & BUTTON.fire) !== 0) ctx.events.weapon(ctx.tick, s.idOf(e), s.weapon[e]!, 'empty');
        } else {
          if (def.fire === WEAPON_FIRE.projectile) fireRocket(ctx, e, k, def, fl);
          else fireHitscan(ctx, e, k, def, fl);
          fired = true;
        }
      }
      if (fired) {
        fl |= F.firing;
        fl &= ~F.spawnProtected;
        s.spawnProtectTicks[e] = 0;
      }
    }
    // O resto só vale atirando sem parar: parado, o próximo tiro não pode "adiantar" (sem rajada acumulada).
    if ((fl & F.firing) === 0 && s.fireCooldownS[e]! < 0) s.fireCooldownS[e] = 0;

    // Recuo volta ao centro depois de um tempo sem atirar; centrado, a rajada recomeça do 1º tiro do padrão.
    if (ctx.tick - s.lastShotTick[e]! > secondsToTicks(def.recoilRecoverDelayS, hz)) {
      const step = def.recoilRecoverDegPerS * DEG_TO_RAD * ctx.dt;
      s.recoilPitch[e] = towardZero(s.recoilPitch[e]!, step);
      s.recoilYaw[e] = towardZero(s.recoilYaw[e]!, step);
      if (s.recoilPitch[e] === 0 && s.recoilYaw[e] === 0) s.burstShots[e] = 0;
    }
    s.flags[e] = fl;
  }
}

/**
 * M3 (fase 7c): no Bobo Zombies o bot de apoio não gasta a reserva (recarrega o pente, mas a reserva não acaba). Ele não
 * compra munição na parede: sem isso, lá pela onda 7 os 4 bots estavam só na faca (robô das 10 ondas).
 */
const freeReserve = (ctx: SimContext, e: number): boolean =>
  ctx.zombiesMode && ctx.s.controller[e]! >= BOT_CONTROLLER_BASE;

/** Fim de um ciclo de recarga: o pente inteiro, ou 1 cartucho (e o próximo ciclo, se ainda faltar). */
function finishReload(ctx: SimContext, e: number, k: number, def: WeaponDef): void {
  const s = ctx.s;
  const spend = freeReserve(ctx, e) ? 0 : 1;
  if (def.reloadPerRoundS > 0) {
    s.slotClip[k] = s.slotClip[k]! + 1;
    s.slotReserve[k] = s.slotReserve[k]! - spend;
    if (s.slotClip[k]! < def.clipSize && s.slotReserve[k]! > 0) {
      s.reloadTicks[e] = Math.max(1, secondsToTicks(def.reloadPerRoundS * reloadMul(ctx, e), ctx.hz));
      return;
    }
  } else {
    const take = Math.min(def.clipSize - s.slotClip[k]!, s.slotReserve[k]!);
    s.slotClip[k] = s.slotClip[k]! + take;
    s.slotReserve[k] = s.slotReserve[k]! - take * spend;
  }
  ctx.events.weapon(ctx.tick, s.idOf(e), s.weapon[e]!, 'reloadEnd');
}

function towardZero(v: number, step: number): number {
  if (v > step) return v - step;
  if (v < -step) return v + step;
  return 0;
}

/** Direção da mira em `dir` (InputFrame + recuo acumulado; convenção do shared: yaw 0 olha para -Z). */
function aimDirection(ctx: SimContext, e: number): void {
  const s = ctx.s;
  const yaw = s.yaw[e]! + s.recoilYaw[e]!;
  const pitch = clamp(s.pitch[e]! + s.recoilPitch[e]!, -HALF_PI, HALF_PI);
  const cp = Math.cos(pitch);
  dir[0] = -Math.sin(yaw) * cp;
  dir[1] = Math.sin(pitch);
  dir[2] = -Math.cos(yaw) * cp;
}

/** Desvia `dir` por um ponto uniforme no disco do cone de meio-ângulo `halfAngle` (rad), com o RNG das armas. */
function coneOffset(ctx: SimContext, halfAngle: number): void {
  const rng = ctx.rngWeapons;
  const r = halfAngle * Math.sqrt(rng.next());
  const a = rng.next() * TAU;
  if (r <= 0) return;
  const dx = dir[0]!;
  const dy = dir[1]!;
  const dz = dir[2]!;
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
  let nx = dx * cr + rx * ca + ux * sa;
  let ny = dy * cr + uy * sa;
  let nz = dz * cr + rz * ca + uz * sa;
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
  nx /= nl;
  ny /= nl;
  nz /= nl;
  dir[0] = nx;
  dir[1] = ny;
  dir[2] = nz;
}

/** M2 (fase 4e): dano da "sniper mata no corpo" (passa de qualquer vida da faixa da receita). */
const SNIPER_KILL_DAMAGE = 10_000;

/** Meio-ângulo da dispersão da mira (rad) pelo estado do corpo e pelo ADS; 0 sem espalhamento na partida. */
function aimSpread(ctx: SimContext, e: number, def: WeaponDef, fl: number): number {
  if (!ctx.mods.spread) return 0;
  const s = ctx.s;
  const i3 = e * 3;
  const vx = s.velocity[i3]!;
  const vz = s.velocity[i3 + 2]!;
  let mul: number;
  // M2 (fase 6a): o perfil pesa a dispersão andando e no ar (o Tático erra mais em movimento).
  const moving = ctx.profile.moveSpreadMul ?? 1;
  if ((fl & F.onGround) === 0) mul = SPREAD_STATE_MULTIPLIER.air * moving;
  else if ((fl & F.crouching) !== 0) mul = SPREAD_STATE_MULTIPLIER.crouching;
  else if (vx * vx + vz * vz > SPREAD_WALKING_SPEED * SPREAD_WALKING_SPEED)
    mul = SPREAD_STATE_MULTIPLIER.walking * moving;
  else mul = SPREAD_STATE_MULTIPLIER.still;
  const ads = s.adsAmount[e]!;
  mul *= 1 + (def.adsSpreadMul - 1) * ads;
  return def.hipSpreadDeg * mul * DEG_TO_RAD;
}

/**
 * Lança um raio de `dir` a partir de (ox, oy, oz): cenário até `range`, depois as hitboxes dos inimigos antes disso.
 * Devolve o índice do alvo (ou -1) e deixa a distância em `castT` e o osso em `castBone`; sem alvo e com cenário,
 * `rayHit` traz o impacto.
 */
let castT = 0;
let castBone: FigurePart = FIGURE_BONE.torso;
function castRay(ctx: SimContext, e: number, ox: number, oy: number, oz: number, range: number): number {
  const s = ctx.s;
  const dx = dir[0]!;
  const dy = dir[1]!;
  const dz = dir[2]!;
  raycastGrid(ctx.grid, ctx.blocks, ox, oy, oz, dx, dy, dz, range, BLOCK_FLAG.blocksBullets, rayHit, ctx.colliders);
  const wallT = rayHit.hit ? rayHit.distance : range;
  const figures = ctx.figures;
  figures.beginRay(ox, oy, oz, dx, dy, dz, wallT);
  let best = -1;
  let bestBone: FigurePart = FIGURE_BONE.torso;
  for (let j = 0; j < s.count; j++) {
    if (s.alive[j] === 0 || !isBody(s.kind[j]!) || !canHurt(ctx, e, j)) continue;
    const fj = s.flags[j]!;
    if ((fj & F.dead) !== 0) continue;
    const bone = figures.testEntity(s, j, figurePostureOf(fj, weaponGrip(s.weapon[j]!), s.kind[j]!), ctx.tick);
    if (bone >= 0) {
      best = j;
      bestBone = bone as FigurePart;
    }
  }
  castT = best >= 0 ? figures.bestT() : wallT;
  castBone = bestBone;
  return best;
}

function emitImpact(ctx: SimContext): void {
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
    rayHit.prop >= 0 ? 0 : cellBlock(rayHit.cell),
    rayHit.face,
    rayHit.prop,
  );
}

/**
 * Dano de 1 raio (ou chumbo) da arma `def` a `t` m no osso `bone` de `target`. Quem é imune a tiro de cabeça (regra
 * do bot, M2 fase 3b) leva na cabeça o dano do tronco.
 */
function rayDamage(ctx: SimContext, def: WeaponDef, t: number, bone: FigurePart, target: number): number {
  const cat = FIGURE_PART_CATEGORY[bone]!;
  // M2 (fase 4e): sniper mata no corpo; só cabeça conta.
  if (ctx.mods.sniperBodyKill && def.category === 'sniper') return SNIPER_KILL_DAMAGE;
  if (ctx.mods.headshotOnly && cat !== PART_HEAD) return 0;
  const base = weaponDamageAt(def, t);
  if (cat === PART_HEAD) {
    return base * ((ctx.rules.flags[target]! & RULE_FLAG.headshotImmune) !== 0 ? 1 : def.headMultiplier);
  }
  return base * PART_DAMAGE_MULTIPLIER[HIT_PARTS[cat] as 'torso' | 'arm' | 'leg'];
}

/** Bala ou chumbos: gasta 1 do pente, carrega a cadência e o recuo, e lança o(s) raio(s). */
function fireHitscan(ctx: SimContext, e: number, k: number, def: WeaponDef, fl: number): void {
  const s = ctx.s;
  s.slotClip[k] = s.slotClip[k]! - 1;
  // Carrega o resto do tick (no máximo 1 tick, para cadência acima do tick não acumular dívida).
  s.fireCooldownS[e] = Math.max(s.fireCooldownS[e]!, -ctx.dt) + 60 / def.rpm;
  s.lastShotTick[e] = ctx.tick;

  const i3 = e * 3;
  const ox = s.position[i3]!;
  const oy = s.position[i3 + 1]! + eyeHeightFor(fl);
  const oz = s.position[i3 + 2]!;

  // Centro do tiro: a mira com a dispersão do estado (amostrada uniforme no disco).
  aimDirection(ctx, e);
  coneOffset(ctx, aimSpread(ctx, e, def, fl));
  const cx = dir[0]!;
  const cy = dir[1]!;
  const cz = dir[2]!;

  // Recuo para os próximos tiros: sobe, e anda no padrão horizontal da arma mais o ruído.
  if (ctx.mods.recoil) kickRecoil(ctx, e, def);

  const shooter = s.idOf(e);
  const code = s.weapon[e]!;

  if (def.fire === WEAPON_FIRE.bullet) {
    const target = castRay(ctx, e, ox, oy, oz, def.rangeM);
    const t = castT;
    if (target >= 0) {
      const i = ctx.damage.push(
        target,
        shooter,
        rayDamage(ctx, def, t, castBone, target),
        FIGURE_PART_CATEGORY[castBone]!,
        castBone,
        code,
        ox + cx * t,
        oy + cy * t,
        oz + cz * t,
      );
      ctx.damage.setDirection(i, cx, cy, cz, def.killForce);
    } else if (rayHit.hit) emitImpact(ctx);
    ctx.events.shot(ctx.tick, shooter, code, ox, oy, oz, cx, cy, cz, t);
    return;
  }

  // Chumbos: cada um num ponto do cone fixo em volta do centro; o dano soma por alvo.
  let targets = 0;
  const pelletCone = def.pelletSpreadDeg * DEG_TO_RAD;
  for (let p = 0; p < def.pellets; p++) {
    dir[0] = cx;
    dir[1] = cy;
    dir[2] = cz;
    coneOffset(ctx, pelletCone);
    const px = dir[0]!;
    const py = dir[1]!;
    const pz = dir[2]!;
    const target = castRay(ctx, e, ox, oy, oz, def.rangeM);
    const t = castT;
    if (target >= 0) {
      const amount = rayDamage(ctx, def, t, castBone, target);
      let slot = -1;
      for (let q = 0; q < targets; q++) if (pelletTarget[q] === target) slot = q;
      if (slot < 0 && targets < MAX_PELLET_TARGETS) {
        slot = targets++;
        pelletTarget[slot] = target;
        pelletDamage[slot] = 0;
        pelletPart[slot] = FIGURE_PART_CATEGORY[castBone]!;
        pelletBodyPart[slot] = castBone;
        pelletPoint[slot * 3] = ox + px * t;
        pelletPoint[slot * 3 + 1] = oy + py * t;
        pelletPoint[slot * 3 + 2] = oz + pz * t;
        pelletDir[slot * 3] = px;
        pelletDir[slot * 3 + 1] = py;
        pelletDir[slot * 3 + 2] = pz;
      }
      if (slot >= 0) pelletDamage[slot] = pelletDamage[slot]! + amount;
    } else if (rayHit.hit) emitImpact(ctx);
    ctx.events.shot(ctx.tick, shooter, code, ox, oy, oz, px, py, pz, t);
  }
  for (let q = 0; q < targets; q++) {
    // Chumbos a 0 de dano (longe demais) não viram acerto.
    if (pelletDamage[q]! <= 0) continue;
    const i = ctx.damage.push(
      pelletTarget[q]!,
      shooter,
      pelletDamage[q]!,
      pelletPart[q]!,
      pelletBodyPart[q]! as FigurePart,
      code,
      pelletPoint[q * 3]!,
      pelletPoint[q * 3 + 1]!,
      pelletPoint[q * 3 + 2]!,
    );
    ctx.damage.setDirection(i, pelletDir[q * 3]!, pelletDir[q * 3 + 1]!, pelletDir[q * 3 + 2]!, def.killForce);
  }
}

/**
 * Faca: o inimigo mais perto à frente (cone de 50°, desnível até 1 m) até `meleeRangeM`. Pelas costas (o alvo olha
 * para o mesmo lado do golpe) vale `backstabDamage`. Emite `melee` (com o alvo, ou `NULL_ENTITY` se errou).
 */
function swingKnife(ctx: SimContext, e: number, def: WeaponDef): void {
  const s = ctx.s;
  s.fireCooldownS[e] = Math.max(s.fireCooldownS[e]!, -ctx.dt) + 60 / def.rpm;
  s.lastShotTick[e] = ctx.tick;
  const e3 = e * 3;
  const ex = s.position[e3]!;
  const ey = s.position[e3 + 1]!;
  const ez = s.position[e3 + 2]!;
  const fx = -Math.sin(s.yaw[e]!);
  const fz = -Math.cos(s.yaw[e]!);
  const range2 = def.meleeRangeM * def.meleeRangeM;
  let best = -1;
  let bestD2 = range2;
  for (let j = 0; j < s.count; j++) {
    if (s.alive[j] === 0 || !isBody(s.kind[j]!) || (s.flags[j]! & F.dead) !== 0 || !canHurt(ctx, e, j)) continue;
    const j3 = j * 3;
    const dx = s.position[j3]! - ex;
    const dz = s.position[j3 + 2]! - ez;
    const d2 = dx * dx + dz * dz;
    if (d2 > bestD2 || Math.abs(s.position[j3 + 1]! - ey) > KNIFE_MAX_DY) continue;
    const d = Math.sqrt(d2);
    if (d > 0.05 && (dx * fx + dz * fz) / d < KNIFE_HALF_ANGLE_COS) continue;
    best = j;
    bestD2 = d2;
  }
  const attacker = s.idOf(e);
  if (best < 0) {
    ctx.events.melee(ctx.tick, attacker, NULL_ENTITY);
    return;
  }
  const b3 = best * 3;
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
  // Pelas costas: o alvo olha para o mesmo lado do golpe.
  const tfx = -Math.sin(s.yaw[best]!);
  const tfz = -Math.cos(s.yaw[best]!);
  const back = tfx * dx + tfz * dz > BACKSTAB_COS;
  const table = ctx.figures.table;
  if (table === null) throw new Error('sim: tabela de jogo solta (dispose)');
  aimPointWorldWith(table, s, best, false, knifePoint);
  ctx.events.melee(ctx.tick, attacker, s.idOf(best));
  const i = ctx.damage.push(
    best,
    attacker,
    back ? def.backstabDamage : def.damage,
    PART_TORSO,
    FIGURE_BONE.torso,
    s.weapon[e]!,
    knifePoint.x,
    knifePoint.y,
    knifePoint.z,
  );
  ctx.damage.setDirection(i, dx, 0, dz, def.killForce);
}

/** Recuo de um disparo (sobe e anda no padrão horizontal da arma, mais o ruído). */
function kickRecoil(ctx: SimContext, e: number, def: WeaponDef): void {
  const s = ctx.s;
  const n = s.burstShots[e]!;
  s.burstShots[e] = Math.min(0xffff, n + 1);
  s.recoilPitch[e] = Math.min(def.recoilMaxDeg * DEG_TO_RAD, s.recoilPitch[e]! + def.recoilKickDeg * DEG_TO_RAD);
  const sideDeg =
    def.recoilPatternDeg * Math.sin(n * RECOIL_PATTERN_STEP) + (ctx.rngWeapons.next() * 2 - 1) * def.recoilYawNoiseDeg;
  s.recoilYaw[e] = clamp(
    s.recoilYaw[e]! + sideDeg * DEG_TO_RAD,
    -def.recoilMaxDeg * DEG_TO_RAD * 0.5,
    def.recoilMaxDeg * DEG_TO_RAD * 0.5,
  );
}

/** Foguete: gasta 1, carrega a cadência e o recuo e lança do olho na direção da mira (com a dispersão do estado). */
function fireRocket(ctx: SimContext, e: number, k: number, def: WeaponDef, fl: number): void {
  const s = ctx.s;
  s.slotClip[k] = s.slotClip[k]! - 1;
  s.fireCooldownS[e] = Math.max(s.fireCooldownS[e]!, -ctx.dt) + 60 / def.rpm;
  s.lastShotTick[e] = ctx.tick;
  aimDirection(ctx, e);
  coneOffset(ctx, aimSpread(ctx, e, def, fl));
  if (ctx.mods.recoil) kickRecoil(ctx, e, def);
  const e3 = e * 3;
  const v = def.projectileSpeed;
  launchProjectile(
    ctx,
    s.idOf(e),
    def,
    s.position[e3]!,
    s.position[e3 + 1]! + eyeHeightFor(fl),
    s.position[e3 + 2]!,
    dir[0]! * v,
    dir[1]! * v,
    dir[2]! * v,
    rocketFuseTicks(def, ctx.hz),
  );
}

/** Granada: gasta 1 e joga do olho, com a mira um pouco acima, metade da velocidade de quem joga e o pavio que sobrou. */
function throwGrenade(ctx: SimContext, e: number, k: number, def: WeaponDef, fl: number, fuseTicks: number): void {
  const s = ctx.s;
  s.slotClip[k] = s.slotClip[k]! - 1;
  const yaw = s.yaw[e]!;
  const pitch = clamp(s.pitch[e]! + THROW_LIFT, -HALF_PI, HALF_PI);
  const cp = Math.cos(pitch);
  const v = def.projectileSpeed;
  const e3 = e * 3;
  launchProjectile(
    ctx,
    s.idOf(e),
    def,
    s.position[e3]!,
    s.position[e3 + 1]! + eyeHeightFor(fl),
    s.position[e3 + 2]!,
    -Math.sin(yaw) * cp * v + s.velocity[e3]! * THROW_INHERIT,
    Math.sin(pitch) * v + s.velocity[e3 + 1]! * THROW_INHERIT,
    -Math.cos(yaw) * cp * v + s.velocity[e3 + 2]! * THROW_INHERIT,
    fuseTicks,
  );
}

/** M3 (fase 4c): a Speedy Soda recarrega na metade do tempo (só no Bobo Zombies). */
function reloadMul(ctx: SimContext, e: number): number {
  return ctx.zombiesMode && (ctx.s.perks[e]! & PERK.speedy) !== 0 ? ZOMBIE_PERKS.speedyReloadMul : 1;
}
