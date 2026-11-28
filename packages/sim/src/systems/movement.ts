import { FIGURE_BONE } from '@boboforces/format';
import { BUTTON, FRAME_HUMAN } from '@boboforces/input';
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
import { ARCADE_TUNING, type MovementProfile } from '../config/movement.ts';
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
// M8 (fase 7): a sonda da parede do wall jump e a do chão logo abaixo (o pulo guardado antes do pouso).
const wallProbe: Aabb = createAabb();
const wallSweep = createSweepResult();
const groundProbe: Aabb = createAabb();
const groundSweep = createSweepResult();

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
  /** M12 (fase 6): quanto o agachar apertado no ar fica guardado para o deslize no pouso, em ticks. */
  slideLandBuffer = 0;
  airStep = 0;
  /** M8 (fase 7): a janela do bunny hop, em ticks no chão desde o pouso. */
  bhopWindow = 0;

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
    this.slideLandBuffer = p.slide ? secondsToTicks(p.slide.landBufferS, hz) : 0;
    this.airStep = Math.max(0, Math.min(METRICS.stepHeight, p.mantleHeight - p.jump) + MANTLE_SLACK);
    this.bhopWindow = secondsToTicks(ARCADE_TUNING.bhopWindowS, hz);
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

/**
 * M8 (fase 7): a parede encostada (a até `wallProbeM` em ±X ou ±Z, nessa ordem, pulando as já usadas neste voo) e a
 * chave dela: o lado (1 a 4, no bit 16) e o plano da face no contato (a 1/16 m: a mesma face dá sempre a mesma chave,
 * na grade ou numa prop); 0 = nenhuma. A sonda começa um degrau acima dos pés (meio-fio, degrau e caixote baixo não
 * são parede).
 */
function touchingWall(
  ctx: SimContext,
  x: number,
  y: number,
  z: number,
  height: number,
  colliders: SimContext['colliders'],
  used0: number,
  used1: number,
): number {
  const d = ARCADE_TUNING.wallProbeM;
  const lift = METRICS.stepHeight;
  if (height <= lift) return 0;
  for (let k = 0; k < 4; k++) {
    const dx = k === 0 ? d : k === 1 ? -d : 0;
    const dz = k === 2 ? d : k === 3 ? -d : 0;
    setBox(wallProbe, x, y + lift, z, height - lift);
    sweepAabb(ctx.grid, ctx.blocks, wallProbe, dx, 0, dz, 0, wallSweep, colliders);
    if (dx !== 0 ? !wallSweep.hitX : !wallSweep.hitZ) continue;
    const face = dx > 0 ? wallProbe.maxX : dx < 0 ? wallProbe.minX : dz > 0 ? wallProbe.maxZ : wallProbe.minZ;
    const key = ((k + 1) << 16) | (Math.round(face * 16) & 0xffff);
    if (key !== used0 && key !== used1) return key;
  }
  return 0;
}

/**
 * M8 (fase 7, revisão): caindo com o chão ao alcance do pulo guardado (`jumpBufferS`): o toque é o pulo do pouso (o
 * bunny hop), não o duplo.
 */
function groundBelow(
  ctx: SimContext,
  x: number,
  y: number,
  z: number,
  vy: number,
  height: number,
  p: MovementProfile,
  colliders: SimContext['colliders'],
): boolean {
  if (vy >= 0) return false;
  const t = p.jumpBufferS;
  const reach = -vy * t + 0.5 * p.gravity * t * t;
  setBox(groundProbe, x, y, z, height);
  sweepAabb(ctx.grid, ctx.blocks, groundProbe, 0, -reach, 0, 0, groundSweep, colliders);
  return groundSweep.onGround;
}

/** M3 (fase 3b): o perfil de cada tipo de zumbi. */
function zombieTicksFor(type: number): ProfileTicks {
  if (type === ZOMBIE_TYPE.runner) return runnerTicks;
  if (type === ZOMBIE_TYPE.sprinter) return sprinterTicks;
  if (type === ZOMBIE_TYPE.chonker || type === ZOMBIE_TYPE.boss) return slowTicks;
  return zombieTicks;
}

export function movementSystem(ctx: SimContext): void {
  updateProfiles(ctx);
  for (let e = 0; e < ctx.s.count; e++) moveBody(ctx, e);
}

/**
 * M5 (fase 2b, a predição do cliente online): o movimento de uma entidade só, com o mesmo código do sistema (o cliente
 * move o próprio boneco a cada tick e refaz as entradas que o host ainda não usou).
 */
export function moveOne(ctx: SimContext, e: number): void {
  updateProfiles(ctx);
  moveBody(ctx, e);
}

function updateProfiles(ctx: SimContext): void {
  boboTicks.update(ctx.profile, ctx.hz);
  zombieTicks.update(ctx.zombieProfile, ctx.hz);
  runnerTicks.update(ctx.zombieRunProfile, ctx.hz);
  downedTicks.update(ctx.downedProfile, ctx.hz);
  sprinterTicks.update(ctx.sprinterProfile, ctx.hz);
  slowTicks.update(ctx.slowProfile, ctx.hz);
}

function moveBody(ctx: SimContext, e: number): void {
  const s = ctx.s;
  const dt = ctx.dt;
  const area = ctx.playArea;
  const hw = METRICS.aabbWidth / 2;
  const kind = s.kind[e]!;
  if (s.alive[e] === 0 || !isBody(kind)) return;
  let fl = s.flags[e]!;
  if ((fl & F.dead) !== 0) return;
  // M3 (fase 3d): o zumbi bate nas tábuas da janela; o bobo, na janela inteira (as portas valem para os dois).
  const colliders = kind === ENTITY_KIND.zombie ? ctx.zombieColliders : ctx.colliders;
  const pt =
    kind === ENTITY_KIND.zombie ? zombieTicksFor(s.zombieType[e]!) : (fl & F.downed) !== 0 ? downedTicks : boboTicks;
  const p = pt.profile!;
  const g = p.gravity;
  const slide = p.slide;
  // M8 (fase 7): o Arcade (o bobo de pé; o caído e o zumbi seguem os perfis deles). O bunny hop e o wall jump só de
  // quem joga (gameplay.md §3.6: os bots não fazem).
  const arcade = ctx.arcade && pt === boboTicks;
  const btn = s.inButtons[e]!;
  // Revisão: quem joga pela marca do quadro (quem pilota um bot faz; o cérebro de reserva no lugar de alguém, não).
  const human = (btn & FRAME_HUMAN) !== 0;
  // Caído, o estado do Arcade zera (levantar não lança com o pouso de antes).
  if (ctx.arcade && pt === downedTicks) {
    s.airJumps[e] = 0;
    s.groundTicks[e] = 0;
    s.landSpeed[e] = 0;
    s.slideSpeed[e] = 0;
    s.wallKeys[e * 2] = 0;
    s.wallKeys[e * 2 + 1] = 0;
  }
  // O teto do Arcade (12 m/s) com a regra de velocidade do bobo (o Jugg mais lento também no bunny hop).
  const arcadeCap = ARCADE_TUNING.bhopMaxSpeed * ctx.rules.speed[e]!;
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
  // M12 (fase 6): o deslize no pouso. O agachar apertado no ar vindo de corrida fica guardado `landBufferS` (como o
  // pulo); no 1º tick no chão, com ele guardado e o agachar ainda seguro, desliza (no ar o agachar desliga a corrida,
  // então pular e pousar deslizando não saía).
  let slideBuffer = s.slideBufferTicks[e]!;
  if (slide && !wasOnGround && wasSprinting && (pressed & BUTTON.crouch) !== 0) slideBuffer = pt.slideLandBuffer + 1;
  // Revisão: com o pulo saindo neste tick (guardado ou apertado agora) o pouso não desliza: o deslize de um tick
  // levaria a velocidade dele (7,9 m/s) para o pulo, gastaria a recarga e soltaria o som e a pose à toa.
  const jumpNow = s.jumpBufferTicks[e]! > 0 || (pressed & BUTTON.jump) !== 0;
  const landSlide = slideBuffer > 0 && (btn & BUTTON.crouch) !== 0 && !jumpNow;
  if (
    slide &&
    !sliding &&
    (((pressed & BUTTON.crouch) !== 0 && wasSprinting) || landSlide) &&
    wasOnGround &&
    s.slideCooldownTicks[e] === 0 &&
    hSpeed >= p.walk * 0.9
  ) {
    sliding = true;
    s.slideTicks[e] = pt.slideTotal;
    s.slideDir[e * 2] = vx / hSpeed;
    s.slideDir[e * 2 + 1] = vz / hSpeed;
    // M8 (fase 7): no Arcade o deslize começa na velocidade que já tinha (se for maior).
    if (arcade && p.slideKeepsMomentum === true) {
      s.slideSpeed[e] = Math.min(Math.max(arcadeCap, slide.startSpeed), Math.max(slide.startSpeed, hSpeed));
    }
    ctx.events.move(ctx.tick, s.idOf(e), 'slide', arcade ? s.slideSpeed[e]! : slide.startSpeed);
  }
  // No chão o guardado já valeu (ou não); no ar ele corre como o do pulo.
  if (wasOnGround) slideBuffer = 0;
  else if (slideBuffer > 0) slideBuffer--;
  s.slideBufferTicks[e] = slideBuffer;

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
  // Refino R1 (#79): o gatilho corta a corrida (antes ele não fazia nada enquanto o bobo corria).
  const adsHeld = (btn & BUTTON.ads) !== 0;
  const sprinting =
    (btn & BUTTON.sprint) !== 0 &&
    // M8 (fase 7): no Arcade o tiro não corta a corrida (atira correndo, com a dispersão de "no ar").
    (p.fireWhileSprinting === true || (btn & (BUTTON.fire | BUTTON.grenade)) === 0) &&
    my > SPRINT_MIN_FORWARD &&
    !crouching &&
    !adsHeld &&
    (wasOnGround || wasSprinting);
  const ads = adsHeld && !sprinting && !sliding;
  if (sprinting) s.sprintFireDelayTicks[e] = pt.sprintFireDelay;

  // --- Velocidade no plano ---
  if (sliding && slide) {
    const left = --s.slideTicks[e]!;
    const t = 1 - left / pt.slideTotal;
    // M8 (fase 7): no Arcade, da velocidade do começo até uma fração dela (mantém o momento).
    const from = arcade && p.slideKeepsMomentum === true ? s.slideSpeed[e]! : slide.startSpeed;
    const to = arcade && p.slideKeepsMomentum === true ? from * ARCADE_TUNING.slideEndKeep : p.crouch;
    const speed = from + (to - from) * t;
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
      } else if (arcade && hSpeed > target && ns < hSpeed && ns > 0) {
        // M8 (fase 7): no Arcade o controle no ar vira sem frear (o momento do bunny hop fica até o pouso).
        vx *= hSpeed / ns;
        vz *= hSpeed / ns;
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
    // M8 (fase 7): o bunny hop: pulando logo depois de pousar, a velocidade do pouso (ou a de agora, se maior) +5%,
    // até o teto, na direção de agora.
    // A janela em ticks no chão (`<`: 0,1 s igual a 30 e a 60 Hz).
    if (arcade && p.bhop === true && human && wasOnGround && s.groundTicks[e]! < pt.bhopWindow) {
      const cur = Math.sqrt(vx * vx + vz * vz);
      if (cur > STOP_SPEED) {
        const sp = Math.min(arcadeCap, Math.max(s.landSpeed[e]!, cur) * ARCADE_TUNING.bhopGain);
        vx = (vx / cur) * sp;
        vz = (vz / cur) * sp;
      }
    }
    ctx.events.move(ctx.tick, s.idOf(e), 'jump', pt.jumpSpeed);
  } else if (arcade && (pressed & BUTTON.jump) !== 0 && !wasOnGround) {
    // M8 (fase 7): no ar, o wall jump (de quem joga, numa parede nova encostada) ou o pulo duplo (um por pulo).
    const height = crouching ? METRICS.aabbCrouchHeight : METRICS.aabbHeight;
    const used0 = s.wallKeys[e * 2]!;
    const used1 = s.wallKeys[e * 2 + 1]!;
    // Revisão: uma vez por parede e no máximo duas por voo (num corredor, A-B-A-B não vira escada).
    const wall =
      p.wallJump === true && human && used1 === 0 ? touchingWall(ctx, x, y, z, height, colliders, used0, used1) : 0;
    if (wall !== 0) {
      s.wallKeys[e * 2 + (used0 === 0 ? 0 : 1)] = wall;
      vy = pt.jumpSpeed;
      const side = wall >> 16;
      const push = ARCADE_TUNING.wallPushSpeed;
      if (side === 1) vx = -push;
      else if (side === 2) vx = push;
      else if (side === 3) vz = -push;
      else vz = push;
      // O empurrão não passa do teto.
      const ws = Math.sqrt(vx * vx + vz * vz);
      if (ws > arcadeCap && ws > 0) {
        vx *= arcadeCap / ws;
        vz *= arcadeCap / ws;
      }
      jumpBuffer = 0;
      jumped = true;
      ctx.events.move(ctx.tick, s.idOf(e), 'jump', pt.jumpSpeed);
    } else if (p.doubleJump === true && s.airJumps[e]! < 1 && !groundBelow(ctx, x, y, z, vy, height, p, colliders)) {
      s.airJumps[e] = s.airJumps[e]! + 1;
      vy = pt.jumpSpeed * ARCADE_TUNING.doubleJumpMul;
      // Vira para onde o jogador aponta, sem perder a velocidade que tinha (o analógico pela metade também).
      if (wishLen > 0) {
        const sp = Math.min(arcadeCap, Math.max(Math.sqrt(vx * vx + vz * vz), p.walk * ctx.rules.speed[e]!));
        vx = (wx / wishLen) * sp;
        vz = (wz / wishLen) * sp;
      }
      jumpBuffer = 0;
      jumped = true;
      ctx.events.move(ctx.tick, s.idOf(e), 'jump', vy);
    }
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
  // M8 (fase 7): no chão, os pulos no ar e a parede voltam; o pouso guarda a velocidade (a do bunny hop).
  if (arcade) {
    if (onGround) {
      if (!wasOnGround) {
        s.landSpeed[e] = Math.sqrt(vx * vx + vz * vz);
        s.groundTicks[e] = 0;
      } else if (s.groundTicks[e]! < 255) s.groundTicks[e] = s.groundTicks[e]! + 1;
      s.airJumps[e] = 0;
      s.wallKeys[e * 2] = 0;
      s.wallKeys[e * 2 + 1] = 0;
    } else s.groundTicks[e] = 0;
  }
  fl &= ~MOVE_FLAGS;
  if (onGround) fl |= F.onGround;
  if (crouching) fl |= F.crouching;
  if (sprinting) fl |= F.sprinting;
  if (sliding) fl |= F.sliding;
  if (ads) fl |= F.ads;
  s.flags[e] = fl;
}
