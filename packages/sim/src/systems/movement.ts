import { BUTTON } from '@boboforces/input';
import { boxIntersectsSolid, createAabb, createSweepResult, sweepAabb, type Aabb } from '@boboforces/world';
import { MATCH_DEFAULTS } from '../config/rules.ts';
import { METRICS } from '../config/metrics.ts';
import { PART_TORSO, WEAPON_NONE, type SimContext } from '../context.ts';
import { secondsToTicks } from '../constants.ts';
import { ENTITY_FLAG, ENTITY_KIND, NULL_ENTITY } from '../entity.ts';

/**
 * Passo 2: movimento e colisão (tecnico.md §7.2, gameplay.md §3.3). Perfil de movimento como dado; AABB varrida eixo a
 * eixo contra a grade, degrau automático de 0,5 m no chão. No ar, o degrau vira "mantle": sobe até
 * `mantleHeight - jump` (0,5 m no Bobo), então pulo + borda alcança os 1,5 m do perfil.
 *
 * Integração exata, para a sensação não depender do `SIM_HZ` (o Switch pode rodar a 30 Hz sem rebalancear): altura pela
 * parábola (`y += v·dt - g·dt²/2`), atrito exponencial (`v·e^(-f·t)`, andando a integral dele) e, no resto, a média
 * da velocidade no início e no fim do tick (exata para aceleração constante e para o deslize linear).
 *
 * No chão, o bobo também GRUDA para descer degraus de até `METRICS.stepHeight` (escada de blocos sem ficar no ar,
 * sem dispersão de pulo nem evento de pouso). Sem alocação: caixa e resultados de rascunho no módulo.
 */

const box: Aabb = createAabb();
const sweep = createSweepResult();
const drop = createSweepResult();

const F = ENTITY_FLAG;
const MOVE_FLAGS = F.onGround | F.crouching | F.sprinting | F.sliding | F.ads;

/** Abaixo disto (m/s) a velocidade no chão zera (evita deslizar para sempre com atrito exponencial). */
const STOP_SPEED = 0.05;
/** Sprint só com o direcional para a frente (fração do eixo). */
const SPRINT_MIN_FORWARD = 0.3;

function setBox(b: Aabb, x: number, y: number, z: number, height: number): void {
  const hw = METRICS.aabbWidth / 2;
  b.minX = x - hw;
  b.maxX = x + hw;
  b.minY = y;
  b.maxY = y + height;
  b.minZ = z - hw;
  b.maxZ = z + hw;
}

export function movementSystem(ctx: SimContext): void {
  const s = ctx.s;
  const p = ctx.profile;
  const dt = ctx.dt;
  const hz = ctx.hz;
  const g = p.gravity;
  const jumpSpeed = Math.sqrt(2 * g * p.jump);
  const coyoteMax = secondsToTicks(p.coyoteS, hz);
  const jumpBufferMax = secondsToTicks(p.jumpBufferS, hz);
  const sprintFireDelay = secondsToTicks(p.sprintFireDelayS, hz);
  const slide = p.slide;
  const slideTotal = slide ? Math.max(1, secondsToTicks(slide.durationS, hz)) : 0;
  const slideCooldown = slide ? secondsToTicks(slide.cooldownS, hz) : 0;
  const airStep = Math.max(0, Math.min(METRICS.stepHeight, p.mantleHeight - p.jump));

  for (let e = 0; e < s.count; e++) {
    if (s.alive[e] === 0 || s.kind[e] !== ENTITY_KIND.bobo) continue;
    let fl = s.flags[e]!;
    if ((fl & F.dead) !== 0) continue;
    const btn = s.inButtons[e]!;
    const pressed = btn & ~s.prevButtons[e]!;
    const i3 = e * 3;
    let x = s.position[i3]!;
    let y = s.position[i3 + 1]!;
    let z = s.position[i3 + 2]!;
    let vx = s.velocity[i3]!;
    let vy = s.velocity[i3 + 1]!;
    let vz = s.velocity[i3 + 2]!;
    const wasOnGround = (fl & F.onGround) !== 0;
    const wasSprinting = (fl & F.sprinting) !== 0;
    // Deslocamento no plano deste tick (ver o comentário do módulo); o padrão é a média de início e fim.
    const vx0 = vx;
    const vz0 = vz;
    let frictionTravel = -1;
    // Fração do tick em que a velocidade ainda variava (chegou no alvo no meio do tick: o resto é a velocidade final).
    let rampFrac = 1;

    // Direção desejada no plano: frente (-sin, -cos) · moveY + direita (cos, -sin) · moveX.
    const yaw = s.yaw[e]!;
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    const mx = s.inMoveX[e]!;
    const my = s.inMoveY[e]!;
    let wx = -sinY * my + cosY * mx;
    let wz = -cosY * my - sinY * mx;
    let wishLen = Math.sqrt(wx * wx + wz * wz);
    if (wishLen > 1) {
      wx /= wishLen;
      wz /= wishLen;
      wishLen = 1;
    }
    const hSpeed = Math.sqrt(vx * vx + vz * vz);

    // --- Deslize (agachar correndo, perfil Bobo) ---
    let sliding = (fl & F.sliding) !== 0;
    if (s.slideCooldownTicks[e]! > 0) s.slideCooldownTicks[e]!--;
    if (
      slide &&
      !sliding &&
      (pressed & BUTTON.crouch) !== 0 &&
      wasSprinting &&
      wasOnGround &&
      s.slideCooldownTicks[e] === 0 &&
      hSpeed >= p.walk * 0.9
    ) {
      sliding = true;
      s.slideTicks[e] = slideTotal;
      s.slideDir[e * 2] = vx / hSpeed;
      s.slideDir[e * 2 + 1] = vz / hSpeed;
      ctx.events.move(ctx.tick, s.idOf(e), 'slide', slide.startSpeed);
    }

    // --- Agachar (levanta só se couber em pé) ---
    let crouching = (fl & F.crouching) !== 0;
    if ((btn & BUTTON.crouch) !== 0 || sliding) {
      crouching = true;
    } else if (crouching) {
      setBox(box, x, y, z, METRICS.aabbHeight);
      if (!boxIntersectsSolid(ctx.grid, ctx.blocks, box)) crouching = false;
    }

    // --- Correr e mirar ---
    const adsHeld = (btn & BUTTON.ads) !== 0;
    const sprinting =
      (btn & BUTTON.sprint) !== 0 && my > SPRINT_MIN_FORWARD && !crouching && !adsHeld && (wasOnGround || wasSprinting);
    const ads = adsHeld && !sprinting && !sliding;
    if (sprinting) s.sprintFireDelayTicks[e] = sprintFireDelay;

    // --- Velocidade no plano ---
    if (sliding && slide) {
      const left = --s.slideTicks[e]!;
      const t = 1 - left / slideTotal;
      const speed = slide.startSpeed + (p.crouch - slide.startSpeed) * t;
      vx = s.slideDir[e * 2]! * speed;
      vz = s.slideDir[e * 2 + 1]! * speed;
      if (left <= 0 || (btn & BUTTON.crouch) === 0) {
        sliding = false;
        s.slideCooldownTicks[e] = slideCooldown;
      }
    } else {
      let target = crouching ? p.crouch : sprinting ? p.sprint : p.walk;
      if (ads) target *= p.adsMoveMul;
      const tx = wx * target;
      const tz = wz * target;
      if (wasOnGround) {
        if (wishLen > 0) {
          const ddx = tx - vx;
          const ddz = tz - vz;
          const dl = Math.sqrt(ddx * ddx + ddz * ddz);
          const maxDelta = p.accel * dt;
          if (dl <= maxDelta) {
            rampFrac = maxDelta > 0 ? dl / maxDelta : 0;
            vx = tx;
            vz = tz;
          } else {
            vx += (ddx / dl) * maxDelta;
            vz += (ddz / dl) * maxDelta;
          }
        } else {
          const k = Math.exp(-p.friction * dt);
          // Quanto anda neste tick pela integral de v·e^(-f·t): o total até parar é v/f em qualquer SIM_HZ.
          frictionTravel = p.friction > 0 ? (1 - k) / p.friction : dt;
          vx *= k;
          vz *= k;
          if (vx * vx + vz * vz < STOP_SPEED * STOP_SPEED) {
            vx = 0;
            vz = 0;
          }
        }
      } else if (wishLen > 0) {
        // No ar: controle parcial e sem ganhar velocidade além da que já tinha (sem bhop no Bobo).
        const ddx = tx - vx;
        const ddz = tz - vz;
        const dl = Math.sqrt(ddx * ddx + ddz * ddz);
        const maxDelta = p.accel * p.airControl * dt;
        if (dl <= maxDelta) {
          rampFrac = maxDelta > 0 ? dl / maxDelta : 0;
          vx = tx;
          vz = tz;
        } else {
          vx += (ddx / dl) * maxDelta;
          vz += (ddz / dl) * maxDelta;
        }
        const cap = Math.max(hSpeed, target);
        const ns = Math.sqrt(vx * vx + vz * vz);
        if (ns > cap && ns > 0) {
          vx *= cap / ns;
          vz *= cap / ns;
        }
      }
    }

    // --- Pulo (buffer + coyote) ---
    let jumpBuffer = s.jumpBufferTicks[e]!;
    if ((pressed & BUTTON.jump) !== 0) jumpBuffer = jumpBufferMax + 1;
    let coyote = s.coyoteTicks[e]!;
    let jumped = false;
    if (jumpBuffer > 0 && (wasOnGround || coyote > 0)) {
      vy = jumpSpeed;
      jumpBuffer = 0;
      coyote = 0;
      jumped = true;
      if (sliding) {
        sliding = false;
        s.slideCooldownTicks[e] = slideCooldown;
      }
      ctx.events.move(ctx.tick, s.idOf(e), 'jump', jumpSpeed);
    }
    if (jumpBuffer > 0) jumpBuffer--;

    // --- Gravidade e colisão ---
    if (wasOnGround && !jumped && vy < 0) vy = 0;
    const dy = vy * dt - 0.5 * g * dt * dt;
    vy -= g * dt;
    if (vy < -MATCH_DEFAULTS.terminalSpeed) vy = -MATCH_DEFAULTS.terminalSpeed;
    const fallSpeed = -vy;
    setBox(box, x, y, z, crouching ? METRICS.aabbCrouchHeight : METRICS.aabbHeight);
    const stepHeight = wasOnGround && !jumped ? METRICS.stepHeight : airStep;
    // Rampa linear até o alvo (média de início e fim) e depois velocidade constante; no atrito, a integral exata.
    const ramp = rampFrac * 0.5;
    const moveX = frictionTravel >= 0 ? vx0 * frictionTravel : (vx0 * ramp + vx * (1 - ramp)) * dt;
    const moveZ = frictionTravel >= 0 ? vz0 * frictionTravel : (vz0 * ramp + vz * (1 - ramp)) * dt;
    sweepAabb(ctx.grid, ctx.blocks, box, moveX, dy, moveZ, stepHeight, sweep);
    if (sweep.hitX) vx = 0;
    if (sweep.hitZ) vz = 0;
    if (sweep.hitY) vy = 0;
    let onGround = sweep.onGround;
    // Descer degrau: estava no chão, não pulou e o chão sumiu; se houver chão até um degrau abaixo, gruda nele.
    let stepDown = 0;
    if (wasOnGround && !jumped && !onGround && vy <= 0) {
      const minY = box.minY;
      const maxY = box.maxY;
      sweepAabb(ctx.grid, ctx.blocks, box, 0, -METRICS.stepHeight, 0, 0, drop);
      if (drop.onGround) {
        onGround = true;
        vy = 0;
        stepDown = drop.dy;
      } else {
        box.minY = minY;
        box.maxY = maxY;
      }
    }
    x = (box.minX + box.maxX) / 2;
    y = box.minY;
    z = (box.minZ + box.maxZ) / 2;

    if (onGround && !wasOnGround) {
      const fall = s.airPeakY[e]! - y;
      ctx.events.move(ctx.tick, s.idOf(e), 'land', fallSpeed);
      if (p.fallDamage && fall > METRICS.safeFallHeight) {
        const dmg = (fall - METRICS.safeFallHeight) * MATCH_DEFAULTS.fallDamagePerM;
        ctx.damage.push(e, NULL_ENTITY, dmg, PART_TORSO, WEAPON_NONE, x, y, z);
      }
    }
    if (!onGround) {
      if (wasOnGround) {
        coyote = jumped ? 0 : coyoteMax;
        s.airPeakY[e] = y;
      } else {
        if (coyote > 0) coyote--;
        if (y > s.airPeakY[e]!) s.airPeakY[e] = y;
      }
    } else {
      coyote = 0;
      s.airPeakY[e] = y;
    }
    if (sweep.stepped && wasOnGround) ctx.events.move(ctx.tick, s.idOf(e), 'step', sweep.dy);
    else if (stepDown < 0) ctx.events.move(ctx.tick, s.idOf(e), 'step', stepDown);

    // Plano de morte (tecnico.md §4.5): dano letal sem atacante, passa pela proteção de spawn.
    if (y < ctx.killPlaneY) ctx.damage.push(e, NULL_ENTITY, 1e9, PART_TORSO, WEAPON_NONE, x, y, z);

    s.position[i3] = x;
    s.position[i3 + 1] = y;
    s.position[i3 + 2] = z;
    s.velocity[i3] = vx;
    s.velocity[i3 + 1] = vy;
    s.velocity[i3 + 2] = vz;
    s.jumpBufferTicks[e] = jumpBuffer;
    s.coyoteTicks[e] = coyote;
    fl &= ~MOVE_FLAGS;
    if (onGround) fl |= F.onGround;
    if (crouching) fl |= F.crouching;
    if (sprinting) fl |= F.sprinting;
    if (sliding) fl |= F.sliding;
    if (ads) fl |= F.ads;
    s.flags[e] = fl;
  }
}
