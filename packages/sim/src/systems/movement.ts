import { FIGURE_BONE } from '@boboforces/format';
import { BUTTON } from '@boboforces/input';
import {
  cellBlock,
  cellFlipped,
  CELLS_PER_METER,
  createAabb,
  createSweepResult,
  SHAPE_ID,
  sweepAabb,
  type Aabb,
} from '@boboforces/world';
import { MATCH_DEFAULTS } from '../config/rules.ts';
import { ZOMBIE_TYPE } from '../config/zombie.ts';
import { METRICS } from '../config/metrics.ts';
import type { MovementProfile } from '../config/movement.ts';
import { isBody, PART_TORSO, WEAPON_KILL_PLANE, WEAPON_NONE, type SimContext } from '../context.ts';
import { secondsToTicks } from '../constants.ts';
import { ENTITY_FLAG, ENTITY_KIND, NULL_ENTITY } from '../entity.ts';

/**
 * Passo 2: movimento e colisão (tecnico.md §7.2, gameplay.md §3.3). Perfil de movimento como dado; AABB varrida eixo a
 * eixo contra a grade, degrau automático de 0,5 m no chão. No ar, o degrau vira "mantle": sobe até
 * `mantleHeight - jump` (0,5 m no Bobo), então pulo + borda alcança os 1,5 m do perfil (mais 5 cm de folga, fase 6a).
 *
 * Integração exata, para a sensação não depender do `SIM_HZ` (o Switch pode rodar a 30 Hz sem rebalancear): altura pela
 * parábola (`y += v·dt - g·dt²/2`), atrito exponencial (`v·e^(-f·t)`, andando a integral dele) e, no resto, a média
 * da velocidade no início e no fim do tick (exata para aceleração constante e para o deslize linear).
 *
 * No chão, o bobo também GRUDA para descer degraus de até `METRICS.stepHeight` (escada de blocos sem ficar no ar,
 * sem dispersão de pulo nem evento de pouso). Sem alocação: caixa e resultados de rascunho no módulo.
 *
 * M1 (Construto): as formas do catálogo (laje, degrau, rampas, painel, poste) e as caixas das props entram pelas
 * consultas do world (`sweepAabb` com `colliders`): rampa sobe e desce lisa (o "grudar" acima faz a descida), sem
 * evento de degrau a cada tick; levantar do agachado é um teste varrido para cima (respeita laje e teto inclinado);
 * a área jogável do mapa é parede invisível em X/Z. Zumbis andam pelo mesmo código, com o perfil deles.
 */

const box: Aabb = createAabb();
const sweep = createSweepResult();
const drop = createSweepResult();
const standProbe: Aabb = createAabb();
const standSweep = createSweepResult();

const F = ENTITY_FLAG;
const MOVE_FLAGS = F.onGround | F.crouching | F.sprinting | F.sliding | F.ads;

/** Abaixo disto (m/s) a velocidade no chão zera (evita deslizar para sempre com atrito exponencial). */
const STOP_SPEED = 0.05;
/** Sprint só com o direcional para a frente (fração do eixo). */
const SPRINT_MIN_FORWARD = 0.3;
/** Folga para achar a célula do piso sob os pés (a rampa pode estar na célula dos pés ou logo abaixo). */
const FLOOR_PROBE = 0.02;

/**
 * M2 (fase 6a): folga da escalada no ar. O ápice da parábola quase nunca cai num tick, então "pulo + borda = altura de
 * escalada" exato não sobe (o Tático: 0,8 + 0,2 = 1,0 m). No Bobo a borda já está no teto de 0,5 m: nada muda.
 */
const MANTLE_SLACK = 0.05;

/** Números do perfil já convertidos para o `hz` da partida (preenchidos no começo do passo, sem alocar). */
class ProfileTicks {
  profile: MovementProfile | null = null;
  hz = 0;
  jumpSpeed = 0;
  coyoteMax = 0;
  jumpBufferMax = 0;
  sprintFireDelay = 0;
  slideTotal = 0;
  slideCooldown = 0;
  airStep = 0;

  update(p: MovementProfile, hz: number): void {
    if (this.profile === p && this.hz === hz) return;
    this.profile = p;
    this.hz = hz;
    this.jumpSpeed = Math.sqrt(2 * p.gravity * p.jump);
    this.coyoteMax = secondsToTicks(p.coyoteS, hz);
    this.jumpBufferMax = secondsToTicks(p.jumpBufferS, hz);
    this.sprintFireDelay = secondsToTicks(p.sprintFireDelayS, hz);
    this.slideTotal = p.slide ? Math.max(1, secondsToTicks(p.slide.durationS, hz)) : 0;
    this.slideCooldown = p.slide ? secondsToTicks(p.slide.cooldownS, hz) : 0;
    this.airStep = Math.max(0, Math.min(METRICS.stepHeight, p.mantleHeight - p.jump) + MANTLE_SLACK);
  }
}

const boboTicks = new ProfileTicks();
const zombieTicks = new ProfileTicks();
// M3 (fase 2a): o zumbi que corre (Bobo Zombies).
const runnerTicks = new ProfileTicks();
// M3 (fase 2c): o bobo caído rastejando.
const downedTicks = new ProfileTicks();
// M3 (fase 3b): o Sprinter e o devagar (Chonker e chefão).
const sprinterTicks = new ProfileTicks();
const slowTicks = new ProfileTicks();

function setBox(b: Aabb, x: number, y: number, z: number, height: number): void {
  const hw = METRICS.aabbWidth / 2;
  b.minX = x - hw;
  b.maxX = x + hw;
  b.minY = y;
  b.maxY = y + height;
  b.minZ = z - hw;
  b.maxZ = z + hw;
}

/** O piso sob os pés é uma rampa em pé (forma inclinada)? Lá a altura muda a cada tick sem ser "degrau". */
function onSlope(ctx: SimContext, x: number, y: number, z: number): boolean {
  const cx = Math.floor(x * CELLS_PER_METER);
  const cz = Math.floor(z * CELLS_PER_METER);
  for (let k = 0; k < 2; k++) {
    const cy = Math.floor((k === 0 ? y - FLOOR_PROBE : y + FLOOR_PROBE) * CELLS_PER_METER);
    const cell = ctx.grid.get(cx, cy, cz);
    if (cell === 0 || cellFlipped(cell)) continue;
    const shape = ctx.blocks.shapes[cellBlock(cell)]!;
    if (shape >= SHAPE_ID.ramp && shape <= SHAPE_ID.rampCornerOut) return true;
  }
  return false;
}

/** M3 (fase 3b): o perfil de cada tipo de zumbi. */
function zombieTicksFor(type: number): ProfileTicks {
  if (type === ZOMBIE_TYPE.runner) return runnerTicks;
  if (type === ZOMBIE_TYPE.sprinter) return sprinterTicks;
  if (type === ZOMBIE_TYPE.chonker || type === ZOMBIE_TYPE.boss) return slowTicks;
  return zombieTicks;
}

export function movementSystem(ctx: SimContext): void {
  const s = ctx.s;
  const dt = ctx.dt;
  const area = ctx.playArea;
  const hw = METRICS.aabbWidth / 2;
  boboTicks.update(ctx.profile, ctx.hz);
  zombieTicks.update(ctx.zombieProfile, ctx.hz);
  runnerTicks.update(ctx.zombieRunProfile, ctx.hz);
  downedTicks.update(ctx.downedProfile, ctx.hz);
  sprinterTicks.update(ctx.sprinterProfile, ctx.hz);
  slowTicks.update(ctx.slowProfile, ctx.hz);

  for (let e = 0; e < s.count; e++) {
    const kind = s.kind[e]!;
    if (s.alive[e] === 0 || !isBody(kind)) continue;
    let fl = s.flags[e]!;
    if ((fl & F.dead) !== 0) continue;
    // M3 (fase 3d): o zumbi bate nas tábuas da janela; o bobo, na janela inteira (as portas valem para os dois).
    const colliders = kind === ENTITY_KIND.zombie ? ctx.zombieColliders : ctx.colliders;
    const pt =
      kind === ENTITY_KIND.zombie ? zombieTicksFor(s.zombieType[e]!) : (fl & F.downed) !== 0 ? downedTicks : boboTicks;
    const p = pt.profile!;
    const g = p.gravity;
    const slide = p.slide;
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
      s.slideTicks[e] = pt.slideTotal;
      s.slideDir[e * 2] = vx / hSpeed;
      s.slideDir[e * 2 + 1] = vz / hSpeed;
      ctx.events.move(ctx.tick, s.idOf(e), 'slide', slide.startSpeed);
    }

    // --- Agachar (levanta só se couber em pé: caixa agachada varrida para cima, com formas e props) ---
    let crouching = (fl & F.crouching) !== 0;
    if ((btn & BUTTON.crouch) !== 0 || sliding) {
      crouching = true;
    } else if (crouching) {
      setBox(standProbe, x, y, z, METRICS.aabbCrouchHeight);
      const rise = METRICS.aabbHeight - METRICS.aabbCrouchHeight;
      sweepAabb(ctx.grid, ctx.blocks, standProbe, 0, rise, 0, 0, standSweep, colliders);
      if (!standSweep.hitY) crouching = false;
    }

    // --- Correr e mirar ---
    const adsHeld = (btn & BUTTON.ads) !== 0;
    const sprinting =
      (btn & BUTTON.sprint) !== 0 && my > SPRINT_MIN_FORWARD && !crouching && !adsHeld && (wasOnGround || wasSprinting);
    const ads = adsHeld && !sprinting && !sliding;
    if (sprinting) s.sprintFireDelayTicks[e] = pt.sprintFireDelay;

    // --- Velocidade no plano ---
    if (sliding && slide) {
      const left = --s.slideTicks[e]!;
      const t = 1 - left / pt.slideTotal;
      const speed = slide.startSpeed + (p.crouch - slide.startSpeed) * t;
      vx = s.slideDir[e * 2]! * speed;
      vz = s.slideDir[e * 2 + 1]! * speed;
      if (left <= 0 || (btn & BUTTON.crouch) === 0) {
        sliding = false;
        s.slideCooldownTicks[e] = pt.slideCooldown;
      }
    } else {
      // M2 (fase 3b): velocidade por regra do bot (×0,5 a ×2).
      let target = (crouching ? p.crouch : sprinting ? p.sprint : p.walk) * ctx.rules.speed[e]!;
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
    if ((pressed & BUTTON.jump) !== 0) jumpBuffer = pt.jumpBufferMax + 1;
    let coyote = s.coyoteTicks[e]!;
    let jumped = false;
    if (jumpBuffer > 0 && (wasOnGround || coyote > 0)) {
      vy = pt.jumpSpeed;
      jumpBuffer = 0;
      coyote = 0;
      jumped = true;
      if (sliding) {
        sliding = false;
        s.slideCooldownTicks[e] = pt.slideCooldown;
      }
      ctx.events.move(ctx.tick, s.idOf(e), 'jump', pt.jumpSpeed);
    }
    if (jumpBuffer > 0) jumpBuffer--;

    // --- Gravidade e colisão ---
    if (wasOnGround && !jumped && vy < 0) vy = 0;
    const dy = vy * dt - 0.5 * g * dt * dt;
    vy -= g * dt;
    if (vy < -MATCH_DEFAULTS.terminalSpeed) vy = -MATCH_DEFAULTS.terminalSpeed;
    const fallSpeed = -vy;
    setBox(box, x, y, z, crouching ? METRICS.aabbCrouchHeight : METRICS.aabbHeight);
    const stepHeight = wasOnGround && !jumped ? METRICS.stepHeight : pt.airStep;
    // Rampa linear até o alvo (média de início e fim) e depois velocidade constante; no atrito, a integral exata.
    const ramp = rampFrac * 0.5;
    const moveX = frictionTravel >= 0 ? vx0 * frictionTravel : (vx0 * ramp + vx * (1 - ramp)) * dt;
    const moveZ = frictionTravel >= 0 ? vz0 * frictionTravel : (vz0 * ramp + vz * (1 - ramp)) * dt;
    sweepAabb(ctx.grid, ctx.blocks, box, moveX, dy, moveZ, stepHeight, sweep, colliders);
    if (sweep.hitX) vx = 0;
    if (sweep.hitZ) vz = 0;
    if (sweep.hitY) vy = 0;
    let onGround = sweep.onGround;
    // Descer degrau (ou rampa): estava no chão, não pulou e o chão sumiu; se houver chão até um degrau abaixo, gruda.
    let stepDown = 0;
    if (wasOnGround && !jumped && !onGround && vy <= 0) {
      const minY = box.minY;
      const maxY = box.maxY;
      sweepAabb(ctx.grid, ctx.blocks, box, 0, -METRICS.stepHeight, 0, 0, drop, colliders);
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

    // Área jogável: parede invisível em X/Z (tecnico.md §4.5). Volta para dentro só no eixo que passou.
    if (area !== null) {
      if (x < area.minX + hw) {
        x = area.minX + hw;
        if (vx < 0) vx = 0;
      } else if (x > area.maxX - hw) {
        x = area.maxX - hw;
        if (vx > 0) vx = 0;
      }
      if (z < area.minZ + hw) {
        z = area.minZ + hw;
        if (vz < 0) vz = 0;
      } else if (z > area.maxZ - hw) {
        z = area.maxZ - hw;
        if (vz > 0) vz = 0;
      }
    }

    if (onGround && !wasOnGround) {
      const fall = s.airPeakY[e]! - y;
      ctx.events.move(ctx.tick, s.idOf(e), 'land', fallSpeed);
      // M2 (fase 6a): o Tático freia no pouso (sem bhop).
      if (p.landingKeep !== undefined) {
        vx *= p.landingKeep;
        vz *= p.landingKeep;
      }
      if (p.fallDamage && fall > METRICS.safeFallHeight) {
        const dmg = (fall - METRICS.safeFallHeight) * MATCH_DEFAULTS.fallDamagePerM;
        ctx.damage.push(e, NULL_ENTITY, dmg, PART_TORSO, FIGURE_BONE.footR, WEAPON_NONE, x, y, z);
      }
    }
    if (!onGround) {
      if (wasOnGround) {
        coyote = jumped ? 0 : pt.coyoteMax;
        s.airPeakY[e] = y;
      } else {
        if (coyote > 0) coyote--;
        if (y > s.airPeakY[e]!) s.airPeakY[e] = y;
      }
    } else {
      coyote = 0;
      s.airPeakY[e] = y;
    }
    // Degrau só quando a altura muda de uma vez (bloco, laje, degrau); na rampa a altura muda todo tick.
    const stepDy = sweep.stepped && wasOnGround ? sweep.dy : stepDown;
    if (stepDy !== 0 && !onSlope(ctx, x, y, z)) ctx.events.move(ctx.tick, s.idOf(e), 'step', stepDy);

    // Plano de morte (tecnico.md §4.5): dano letal sem atacante, passa pela proteção de spawn.
    if (y < ctx.killPlaneY)
      ctx.damage.push(e, NULL_ENTITY, 1e9, PART_TORSO, FIGURE_BONE.torso, WEAPON_KILL_PLANE, x, y, z);

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
