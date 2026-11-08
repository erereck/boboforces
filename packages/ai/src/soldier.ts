import type { BotLevel } from '@boboforces/format';
import { BUTTON, quantizeAxis, type InputFrame } from '@boboforces/input';
import { angleDelta, clamp, DEG_TO_RAD, HALF_PI, pitchToI16, wrapAngle, yawToU16, type Rng } from '@boboforces/shared';
import {
  aimPointWorld,
  ENTITY_FLAG,
  eyeHeightFor,
  figurePostureOf,
  secondsToTicks,
  WEAPON_SLOTS,
  visibleAimOffset,
  weaponGrip,
  type AimPoint,
  type SimView,
} from '@boboforces/sim';
import { CELLS_PER_METER, isCellSolid } from '@boboforces/world';
import { AI_LOD, AI_PATH, AI_SENSES, AI_SOLDIER } from './config.ts';
import type { AiContext } from './context.ts';
import { createSteer, PathFollower } from './paths.ts';
import { aimSkillForLevel, type AimSkill } from './skill.ts';

/**
 * Soldado N0 do M1 (gameplay.md §6.3 "Zumbi": vai pela rota e atira quando vê; ignora cobertura). Três camadas
 * (tecnico.md §8.2) sem a de decisão:
 * - percepção (10 Hz no LOD A, 4 Hz no B, com orçamento de raios do tick): cone de 120°, alcance de visão da partida
 *   (o mesmo do render), raio DDA de oclusão até a cabeça e o tronco; audição de tiro (50 m), passo correndo (15 m) e
 *   andando (6 m); tomou dano, olha em volta por 1 s;
 * - movimento: sem alvo à vista, vai até onde viu ou ouviu o inimigo, senão passeia entre nós da navegação; anda pela
 *   rota do A* (fila com orçamento) com o seguidor de caminho, pulando nas ligações de pulo e se afastando dos outros
 *   corpos. Sem navegação (M0, mapas de teste), anda reto com desvio simples por sondas de células;
 * - mira e tiro pelo modelo de habilidade dos 5 níveis (reação, giro, erro gaussiano que fecha na aquisição, recoil,
 *   cabeça), ADS de longe e o movimento em combate do nível.
 * Determinístico: um fluxo de RNG por bot (`rng.fork('bot', i)`).
 */

const F = ENTITY_FLAG;
const VIEW_CONE_COS = Math.cos((AI_SENSES.viewConeDeg / 2) * DEG_TO_RAD);
const FIRE_TOLERANCE = AI_SOLDIER.fireToleranceDeg * DEG_TO_RAD;
const SPRINT_MAX_TURN = AI_SOLDIER.sprintMaxTurnDeg * DEG_TO_RAD;
const GOAL_REACHED = 1.5;
const STUCK_DISTANCE = 0.5;
const PROBE_FREE = 0;
const PROBE_JUMP = 1;
const PROBE_BLOCKED = 2;

/** Tempos do soldado já em ticks do `hz` da partida (um por diretor). */
export class SoldierTiming {
  readonly hz: number;
  readonly perceptionA: number;
  readonly perceptionB: number;
  readonly errorResample: number;
  readonly visibleAimRefresh: number;
  readonly memory: number;
  readonly chase: number;
  readonly alert: number;
  readonly wander: number;
  readonly detour: number;
  readonly stuck: number;
  readonly replanA: number;
  readonly replanB: number;

  constructor(hz: number) {
    this.hz = hz;
    this.perceptionA = Math.max(1, Math.round(hz / AI_LOD.perceptionHzA));
    this.perceptionB = Math.max(1, Math.round(hz / AI_LOD.perceptionHzB));
    this.errorResample = Math.max(1, secondsToTicks(0.2, hz));
    this.visibleAimRefresh = Math.max(1, secondsToTicks(AI_SOLDIER.visibleAimRefreshS, hz));
    this.memory = secondsToTicks(AI_SENSES.memoryS, hz);
    this.chase = secondsToTicks(AI_SENSES.chaseS, hz);
    this.alert = secondsToTicks(AI_SENSES.alertS, hz);
    this.wander = secondsToTicks(AI_SOLDIER.wanderS, hz);
    this.detour = secondsToTicks(0.5, hz);
    this.stuck = Math.max(1, secondsToTicks(AI_PATH.stuckS, hz));
    this.replanA = secondsToTicks(AI_LOD.replanSA, hz);
    this.replanB = secondsToTicks(AI_LOD.replanSB, hz);
  }

  /** Janelas sorteadas da IA foram calibradas em ticks de 60 Hz: em outro hz, mesma duração em segundos. */
  ticks60(n: number): number {
    return this.hz === 60 ? n : Math.max(1, Math.round((n * this.hz) / 60));
  }
}

/** Estado de um soldado. Criado uma vez por partida; o `think` não aloca. */
export class SoldierBrain {
  readonly index: number;
  readonly controller: number;
  readonly level: BotLevel;
  readonly skill: AimSkill;
  readonly rng: Rng;
  readonly reactionTicks: number;
  readonly acquireTicks: number;
  readonly turnStep: number;
  readonly errorRad: number;
  readonly follower: PathFollower;

  wasDead = true;
  aimYaw = 0;
  aimPitch = 0;
  lodA = true;
  nextPerceiveTick = 0;

  target = -1;
  targetGen = 0;
  targetVisible = false;
  lastSeenTick = -1_000_000;
  reactionReadyTick = 0;
  acquireStartTick = 0;
  aimHead = false;
  /**
   * Desvio do ponto mirado (frame do alvo) para a parte da cabeça ou do tronco que o bot vê: o antebraço armado pode
   * tapar o centro (`visibleAimOffset`). Escolhido ao mirar, a cada `visibleAimRefreshS` e de novo quando a postura
   * do alvo muda (agachar tapa outra parte).
   */
  readonly aimOffset: AimPoint = { x: 0, y: 0, z: 0 };
  /** Postura do alvo (`figurePostureOf`) quando o desvio foi escolhido; −1 = nenhum. */
  aimOffsetPosture = -1;
  /** Tick em que o desvio é refeito. */
  aimOffsetNextTick = 0;
  errYaw = 0;
  errPitch = 0;
  errNextTick = 0;

  hasLastKnown = false;
  lastKnownX = 0;
  lastKnownY = 0;
  lastKnownZ = 0;
  hasGoal = false;
  goalX = 0;
  goalY = 0;
  goalZ = 0;
  goalUntil = 0;
  detourHeading = 0;
  detourUntil = 0;
  detourSign = 1;
  stuckTick = 0;
  stuckX = 0;
  stuckZ = 0;
  stuckCount = 0;
  jumpHeld = false;

  strafeDir = 1;
  strafeActive = false;
  strafeUntil = 0;
  crouchUntil = 0;
  dodgeDecisionTick = 0;
  nextJumpTick = 0;

  lastHealth = 0;
  alertUntil = 0;

  constructor(
    index: number,
    controller: number,
    level: BotLevel,
    rng: Rng,
    timing: SoldierTiming,
    follower: PathFollower,
  ) {
    this.index = index;
    this.controller = controller;
    this.level = level;
    this.skill = aimSkillForLevel(level);
    this.rng = rng;
    this.reactionTicks = secondsToTicks(this.skill.reactionS, timing.hz);
    this.acquireTicks = secondsToTicks(this.skill.acquireS, timing.hz);
    this.turnStep = (this.skill.turnDegPerS * DEG_TO_RAD) / timing.hz;
    this.errorRad = this.skill.aimErrorDeg * DEG_TO_RAD;
    this.strafeDir = rng.chance(0.5) ? 1 : -1;
    this.follower = follower;
    // Espalha as percepções entre os ticks (baldes por índice).
    this.nextPerceiveTick = index % timing.perceptionA;
  }
}

export function turnToward(current: number, goal: number, step: number): number {
  const d = angleDelta(current, goal);
  return wrapAngle(current + (d > step ? step : d < -step ? -step : d));
}

export function moveToward(current: number, goal: number, step: number): number {
  const d = goal - current;
  return current + (d > step ? step : d < -step ? -step : d);
}

/** Rascunhos do módulo (o `think` não aloca). */
const local = { x: 0, y: 0 };
/** Ponto mirado no alvo (centro da hitbox da cabeça ou do tronco, no mundo) e o olho do bot. */
const aimPoint: AimPoint = { x: 0, y: 0, z: 0 };
const eyePoint: AimPoint = { x: 0, y: 0, z: 0 };
const steer = createSteer();
const push = { x: 0, z: 0 };
const nodePos = new Float64Array(3);

function targetValid(view: SimView, b: SoldierBrain): boolean {
  const t = b.target;
  return (
    t >= 0 &&
    t < view.count &&
    view.alive[t] === 1 &&
    view.generation[t] === b.targetGen &&
    (view.flags[t]! & F.dead) === 0
  );
}

function acquire(view: SimView, b: SoldierBrain, t: number, tick: number): void {
  b.target = t;
  b.targetGen = view.generation[t]!;
  b.reactionReadyTick = tick + b.reactionTicks;
  b.acquireStartTick = b.reactionReadyTick;
  b.aimHead = b.rng.chance(b.skill.headPreference);
  b.aimOffset.x = 0;
  b.aimOffset.y = 0;
  b.aimOffset.z = 0;
  b.aimOffsetPosture = -1;
  b.aimOffsetNextTick = 0;
  b.errNextTick = 0;
}

function remember(view: SimView, b: SoldierBrain, j: number, tick: number): void {
  b.lastSeenTick = tick;
  b.hasLastKnown = true;
  b.lastKnownX = view.position[j * 3]!;
  b.lastKnownY = view.position[j * 3 + 1]!;
  b.lastKnownZ = view.position[j * 3 + 2]!;
}

/** Candidatos da percepção (os mais próximos no cone), em rascunho fixo. */
const MAX_CANDIDATES = 4;
const candIndex = new Int32Array(MAX_CANDIDATES);
const candD2 = new Float64Array(MAX_CANDIDATES);

/** Percepção: confirma o alvo atual ou procura o inimigo visível mais próximo; ouve tiros e passos. */
function perceive(c: AiContext, b: SoldierBrain, e: number, tick: number): void {
  const view = c.view!;
  const e3 = e * 3;
  const ex = view.position[e3]!;
  const ey = view.position[e3 + 1]! + eyeHeightFor(view.flags[e]!);
  const ez = view.position[e3 + 2]!;
  b.targetVisible = false;
  if (targetValid(view, b) && c.canSee(ex, ey, ez, b.target)) {
    b.targetVisible = true;
    remember(view, b, b.target, tick);
    return;
  }
  const maxCandidates = b.lodA ? AI_LOD.candidatesA : AI_LOD.candidatesB;
  const fwdX = -Math.sin(b.aimYaw);
  const fwdZ = -Math.cos(b.aimYaw);
  const alert = tick < b.alertUntil;
  const maxD2 = c.viewDistance * c.viewDistance;
  let candidates = 0;
  let heard = -1;
  let heardD2 = Infinity;
  for (let j = 0; j < view.count; j++) {
    if (!c.living(j) || !c.hostile(e, j)) continue;
    const dx = view.position[j * 3]! - ex;
    const dz = view.position[j * 3 + 2]! - ez;
    const d2 = dx * dx + dz * dz;
    // Audição (gameplay.md §6.3): tiro, passo correndo, passo andando; agachado não faz barulho.
    const fj = view.flags[j]!;
    let hearR = 0;
    if ((fj & F.firing) !== 0) hearR = AI_SENSES.hearShotM;
    else if ((fj & F.crouching) === 0) {
      const vx = view.velocity[j * 3]!;
      const vz = view.velocity[j * 3 + 2]!;
      if (vx * vx + vz * vz > AI_SENSES.hearStepSpeed * AI_SENSES.hearStepSpeed) {
        hearR = (fj & F.sprinting) !== 0 ? AI_SENSES.hearSprintM : AI_SENSES.hearWalkM;
      }
    }
    if (d2 <= hearR * hearR && d2 < heardD2) {
      heard = j;
      heardD2 = d2;
    }
    if (d2 >= maxD2) continue;
    if (candidates === maxCandidates && d2 >= candD2[maxCandidates - 1]!) continue;
    if (!alert) {
      const d = Math.sqrt(d2);
      if (d > 0.01 && (dx * fwdX + dz * fwdZ) / d < VIEW_CONE_COS) continue;
    }
    // Inserção ordenada por distância num vetor fixo: o orçamento de raios vai para os inimigos MAIS PRÓXIMOS.
    let k = candidates < maxCandidates ? candidates++ : maxCandidates - 1;
    while (k > 0 && candD2[k - 1]! > d2) {
      candD2[k] = candD2[k - 1]!;
      candIndex[k] = candIndex[k - 1]!;
      k--;
    }
    candD2[k] = d2;
    candIndex[k] = j;
  }
  let best = -1;
  for (let k = 0; k < candidates; k++) {
    const j = candIndex[k]!;
    if (c.canSee(ex, ey, ez, j)) {
      best = j;
      break;
    }
  }
  if (best < 0) {
    // Ouviu e não viu: vai ver de onde veio (sem trocar o alvo).
    if (heard >= 0 && !b.targetVisible) remember(view, b, heard, tick);
    return;
  }
  if (best !== b.target || !targetValid(view, b)) acquire(view, b, best, tick);
  b.targetVisible = true;
  remember(view, b, best, tick);
}

/** Sem navegação: sonda as células à frente (0,45 e 0,8 m) em `heading`: livre, precisa pular ou bloqueado. */
function probe(view: SimView, x: number, y: number, z: number, heading: number): number {
  const sx = -Math.sin(heading);
  const sz = -Math.cos(heading);
  const fy = Math.floor((y + 0.01) * CELLS_PER_METER);
  let worst = PROBE_FREE;
  for (let k = 0; k < 2; k++) {
    const d = k === 0 ? 0.45 : 0.8;
    const cx = Math.floor((x + sx * d) * CELLS_PER_METER);
    const cz = Math.floor((z + sz * d) * CELLS_PER_METER);
    const g = view.world;
    const r = view.blocks;
    const s1 = isCellSolid(g, r, cx, fy, cz);
    const s2 = isCellSolid(g, r, cx, fy + 1, cz);
    const s3 = isCellSolid(g, r, cx, fy + 2, cz);
    const s4 = isCellSolid(g, r, cx, fy + 3, cz);
    let res: number;
    if (!s2 && !s3 && (!s1 || !s4)) res = PROBE_FREE;
    else if (s2 && !s3 && !s4 && !isCellSolid(g, r, cx, fy + 4, cz)) res = PROBE_JUMP;
    else res = PROBE_BLOCKED;
    if (res > worst) worst = res;
  }
  return worst;
}

/** Novo objetivo de passeio: um nó alcançável da navegação, ou um ponto da arena (sem navegação). */
function pickWanderGoal(c: AiContext, b: SoldierBrain, x: number, y: number, z: number, t: SoldierTiming): void {
  const view = c.view!;
  const nav = view.nav;
  b.hasGoal = false;
  b.goalUntil = c.tick + t.wander;
  if (nav !== null && nav.nodeCount > 0) {
    const from = nav.nearestNode(x, y, z);
    for (let k = 0; k < AI_SOLDIER.wanderTries; k++) {
      const n = b.rng.int(0, nav.nodeCount);
      if (from >= 0 && nav.component[n] !== nav.component[from]) continue;
      nav.nodePosition(n, nodePos, 0);
      // Fora da área jogável (paredes invisíveis da sim) o bot nunca chega: tenta outro nó.
      const area = view.playArea;
      if (
        area &&
        (nodePos[0]! < area.minX || nodePos[0]! > area.maxX || nodePos[2]! < area.minZ || nodePos[2]! > area.maxZ)
      )
        continue;
      b.goalX = nodePos[0]!;
      b.goalY = nodePos[1]!;
      b.goalZ = nodePos[2]!;
      b.hasGoal = true;
      return;
    }
    return;
  }
  const g = view.world;
  const area = view.playArea;
  const minX = area ? area.minX : 0;
  const minZ = area ? area.minZ : 0;
  const maxX = area ? area.maxX : g.sizeX / CELLS_PER_METER;
  const maxZ = area ? area.maxZ : g.sizeZ / CELLS_PER_METER;
  b.goalX = b.rng.range(minX + 2, Math.max(minX + 2.5, maxX - 2));
  b.goalY = y;
  b.goalZ = b.rng.range(minZ + 2, Math.max(minZ + 2.5, maxZ - 2));
  b.hasGoal = true;
}

/** Com alvo à vista: mira, atira e se mexe conforme o nível. Devolve os botões; escreve o strafe em `local`. */
function combat(c: AiContext, b: SoldierBrain, e: number, tick: number, t: SoldierTiming): number {
  const view = c.view!;
  const sk = b.skill;
  const e3 = e * 3;
  const fl = view.flags[e]!;
  const ex = view.position[e3]!;
  const ey = view.position[e3 + 1]! + eyeHeightFor(fl);
  const ez = view.position[e3 + 2]!;
  // Cabeça ou tronco na postura e no pitch do alvo, levados ao mundo pelo yaw dele; de tempos em tempos (e quando o
  // alvo troca de postura), o bot escolhe a parte que ele vê da caixa (o antebraço armado pode tapar o centro).
  const ready = tick >= b.reactionReadyTick;
  const off = b.aimOffset;
  const tg = b.target;
  const posture = figurePostureOf(view.flags[tg]!, weaponGrip(view.weapon[tg]!), view.kind[tg]!);
  if (ready && c.aimsLeft > 0 && (tick >= b.aimOffsetNextTick || posture !== b.aimOffsetPosture)) {
    // Teto por tick (`AI_SOLDIER.visibleAimPerTick`): sem vaga, fica a escolha anterior e tenta no próximo tick.
    c.aimsLeft--;
    c.aimsTotal++;
    eyePoint.x = ex;
    eyePoint.y = ey;
    eyePoint.z = ez;
    visibleAimOffset(view, tg, b.aimHead, eyePoint, off);
    b.aimOffsetPosture = posture;
    b.aimOffsetNextTick = tick + t.visibleAimRefresh;
  }
  aimPointWorld(view, b.target, b.aimHead, aimPoint);
  const ty = view.yaw[b.target]!;
  const tc = Math.cos(ty);
  const ts = Math.sin(ty);
  const dx = aimPoint.x + tc * off.x - ts * off.z - ex;
  const dy = aimPoint.y + off.y - ey;
  const dz = aimPoint.z - ts * off.x - tc * off.z - ez;
  const horiz = Math.sqrt(dx * dx + dz * dz);
  const dist = Math.sqrt(horiz * horiz + dy * dy);
  let goalYaw = Math.atan2(-dx, -dz);
  let goalPitch = Math.atan2(dy, horiz);
  let buttons = 0;

  if (ready) {
    if (tick >= b.errNextTick) {
      const p = b.acquireTicks > 0 ? clamp((tick - b.acquireStartTick) / b.acquireTicks, 0, 1) : 1;
      const scale = b.errorRad * (3 - 2 * p) * Math.SQRT1_2;
      b.errYaw = b.rng.gaussian() * scale;
      b.errPitch = b.rng.gaussian() * scale;
      b.errNextTick = tick + t.errorResample;
    }
    goalYaw += b.errYaw - sk.recoilControl * view.recoilYaw[e]!;
    goalPitch += b.errPitch - sk.recoilControl * view.recoilPitch[e]!;
    b.aimYaw = turnToward(b.aimYaw, goalYaw, b.turnStep);
    b.aimPitch = clamp(moveToward(b.aimPitch, goalPitch, b.turnStep), -HALF_PI, HALF_PI);
    const remaining = Math.max(Math.abs(angleDelta(b.aimYaw, goalYaw)), Math.abs(goalPitch - b.aimPitch));
    const tolerance = FIRE_TOLERANCE + Math.atan(0.25 / Math.max(dist, 1));
    if (remaining <= tolerance && view.ammoClip[e]! > 0) buttons |= BUTTON.fire;
  }
  if (dist > AI_SOLDIER.adsMinM) buttons |= BUTTON.ads;

  local.x = 0;
  local.y = dist > AI_SOLDIER.approachM ? 1 : 0;
  switch (sk.combatMove) {
    case 'none':
      break;
    case 'light':
      if (tick >= b.strafeUntil) {
        b.strafeActive = b.rng.chance(0.5);
        b.strafeDir = b.rng.chance(0.5) ? 1 : -1;
        b.strafeUntil = tick + t.ticks60(b.rng.int(36, 84));
      }
      if (b.strafeActive) local.x = b.strafeDir;
      break;
    case 'strafe':
    case 'strafeDodge':
      if (tick >= b.strafeUntil) {
        b.strafeDir = b.rng.chance(0.7) ? -b.strafeDir : b.strafeDir;
        b.strafeUntil = tick + t.ticks60(b.rng.int(24, 60));
      }
      local.x = b.strafeDir;
      if (sk.combatMove === 'strafeDodge') {
        // Agacha em rajadas enquanto troca tiro; pulinho de esquiva só fora do tiro (no ar a dispersão é 2,5x).
        if (ready && tick >= b.dodgeDecisionTick) {
          b.dodgeDecisionTick = tick + t.ticks60(b.rng.int(18, 42));
          b.crouchUntil = b.rng.chance(0.4) ? b.dodgeDecisionTick : 0;
        }
        if (tick < b.crouchUntil) buttons |= BUTTON.crouch;
        if (!ready && tick >= b.nextJumpTick && (fl & F.onGround) !== 0) {
          buttons |= BUTTON.jump;
          b.nextJumpTick = tick + t.ticks60(b.rng.int(40, 100));
        }
      }
      break;
  }
  // Strafe batendo em parede: troca de lado.
  if (local.x !== 0) {
    const side = b.aimYaw - (local.x > 0 ? HALF_PI : -HALF_PI);
    if (probe(view, view.position[e3]!, view.position[e3 + 1]!, view.position[e3 + 2]!, side) === PROBE_BLOCKED) {
      b.strafeDir = -b.strafeDir;
      local.x = -local.x;
    }
  }
  return buttons;
}

/**
 * Sem navegação (mapas do M0 e de teste): anda reto até o objetivo com desvio simples por sondas. Devolve a direção
 * no mundo em `steer` e os botões.
 */
function travelDirect(
  c: AiContext,
  b: SoldierBrain,
  x: number,
  y: number,
  z: number,
  gx: number,
  gz: number,
  t: SoldierTiming,
): number {
  const view = c.view!;
  const tick = c.tick;
  let buttons = 0;
  let heading = Math.atan2(-(gx - x), -(gz - z));
  if (tick < b.detourUntil) {
    heading = b.detourHeading;
  } else {
    const res = probe(view, x, y, z, heading);
    if (res === PROBE_BLOCKED) {
      let found = false;
      for (let side = 0; side < 2 && !found; side++) {
        const sign = side === 0 ? b.detourSign : -b.detourSign;
        for (let k = 1; k <= 3; k++) {
          const h = heading + sign * k * 45 * DEG_TO_RAD;
          if (probe(view, x, y, z, h) !== PROBE_BLOCKED) {
            b.detourHeading = wrapAngle(h);
            b.detourUntil = tick + t.detour;
            heading = b.detourHeading;
            found = true;
            break;
          }
        }
      }
      if (!found) pickWanderGoal(c, b, x, y, z, t);
    } else if (res === PROBE_JUMP) {
      buttons |= BUTTON.jump;
    }
  }
  steer.x = -Math.sin(heading);
  steer.z = -Math.cos(heading);
  const dx = gx - x;
  const dz = gz - z;
  steer.remaining = Math.sqrt(dx * dx + dz * dz);
  return buttons;
}

/** Sem alvo à vista: vai até onde viu/ouviu o inimigo, ou passeia. Devolve os botões; o movimento vai em `local`. */
function travel(c: AiContext, b: SoldierBrain, e: number, t: SoldierTiming): number {
  const view = c.view!;
  const tick = c.tick;
  const e3 = e * 3;
  const x = view.position[e3]!;
  const y = view.position[e3 + 1]!;
  const z = view.position[e3 + 2]!;
  const onGround = (view.flags[e]! & F.onGround) !== 0;
  const f = b.follower;
  let buttons = 0;

  let gx: number;
  let gy: number;
  let gz: number;
  if (b.hasLastKnown && tick - b.lastSeenTick < t.chase) {
    gx = b.lastKnownX;
    gy = b.lastKnownY;
    gz = b.lastKnownZ;
    const ddx = gx - x;
    const ddz = gz - z;
    if (ddx * ddx + ddz * ddz < GOAL_REACHED * GOAL_REACHED || f.failed) b.hasLastKnown = false;
  } else {
    b.hasLastKnown = false;
    const ddx = b.goalX - x;
    const ddz = b.goalZ - z;
    if (!b.hasGoal || tick >= b.goalUntil || ddx * ddx + ddz * ddz < GOAL_REACHED * GOAL_REACHED || f.failed) {
      if (f.failed) f.clear();
      pickWanderGoal(c, b, x, y, z, t);
    }
    gx = b.goalX;
    gy = b.goalY;
    gz = b.goalZ;
  }

  const paths = c.paths;
  if (view.nav !== null) {
    paths.want(f, x, y, z, gx, gy, gz, tick, b.lodA ? t.replanA : t.replanB);
    if (!paths.steer(f, x, y, z, onGround, steer)) {
      // Sem rota ainda (na fila), ou chegou: vai reto até o objetivo.
      const dx = gx - x;
      const dz = gz - z;
      const d = Math.sqrt(dx * dx + dz * dz);
      steer.x = d > 0.2 ? dx / d : 0;
      steer.z = d > 0.2 ? dz / d : 0;
      steer.remaining = d;
    }
    if (steer.jump) buttons |= BUTTON.jump;
    if (steer.crouch) buttons |= BUTTON.crouch;
  } else {
    buttons |= travelDirect(c, b, x, y, z, gx, gz, t);
  }

  // Empacou: pula; de novo, pede outra rota (ou troca o lado do desvio); de novo, desiste do objetivo.
  if (tick - b.stuckTick >= t.stuck) {
    const mx = x - b.stuckX;
    const mz = z - b.stuckZ;
    if (steer.remaining > GOAL_REACHED && mx * mx + mz * mz < STUCK_DISTANCE * STUCK_DISTANCE) {
      b.detourSign = -b.detourSign;
      b.detourUntil = 0;
      b.stuckCount++;
      if (b.stuckCount === 2) f.invalidate();
      if (b.stuckCount >= 4) {
        b.stuckCount = 0;
        b.hasLastKnown = false;
        f.clear();
        pickWanderGoal(c, b, x, y, z, t);
      }
      buttons |= BUTTON.jump;
    } else {
      b.stuckCount = 0;
    }
    b.stuckTick = tick;
    b.stuckX = x;
    b.stuckZ = z;
  }

  // Afasta-se dos outros corpos (sem RVO).
  c.separation(e, x, y, z, push);
  let wx = steer.x + push.x * AI_PATH.separationWeight;
  let wz = steer.z + push.z * AI_PATH.separationWeight;
  const wl = Math.sqrt(wx * wx + wz * wz);
  if (wl > 1e-6) {
    wx /= wl;
    wz /= wl;
    const heading = Math.atan2(-wx, -wz);
    b.aimYaw = turnToward(b.aimYaw, heading, b.turnStep);
    if (steer.remaining > AI_SOLDIER.sprintMinM && Math.abs(angleDelta(b.aimYaw, heading)) < SPRINT_MAX_TURN) {
      buttons |= BUTTON.sprint;
    }
  } else {
    wx = 0;
    wz = 0;
  }
  b.aimPitch = moveToward(b.aimPitch, 0, b.turnStep);
  // Direção desejada no mundo vira moveX/moveY relativos à mira atual (olha para onde anda).
  const s = Math.sin(b.aimYaw);
  const co = Math.cos(b.aimYaw);
  local.y = -s * wx - co * wz;
  local.x = co * wx - s * wz;
  const def = WEAPON_SLOTS[view.weapon[e]!];
  if (def && view.ammoClip[e]! < def.clipSize / 2) buttons |= BUTTON.reload;
  return buttons;
}

/** Um tick de um soldado: escreve o frame do controlador dele. */
export function thinkSoldier(c: AiContext, b: SoldierBrain, f: InputFrame, t: SoldierTiming): void {
  const view = c.view!;
  f.seq = (f.seq + 1) & 0xffff;
  f.buttons = 0;
  f.moveX = 0;
  f.moveY = 0;
  f.weapon = 0;
  const e = c.ctrlToEntity[b.controller]!;
  if (e < 0) return;
  const fl = view.flags[e]!;
  if ((fl & F.dead) !== 0) {
    if (!b.wasDead) b.follower.clear();
    b.wasDead = true;
    b.target = -1;
    b.targetVisible = false;
    return;
  }
  const tick = c.tick;
  if (b.wasDead) {
    b.wasDead = false;
    b.aimYaw = view.yaw[e]!;
    b.aimPitch = 0;
    b.target = -1;
    b.targetVisible = false;
    b.hasLastKnown = false;
    b.hasGoal = false;
    b.detourUntil = 0;
    b.lastHealth = view.health[e]!;
    b.stuckTick = tick;
    b.stuckX = view.position[e * 3]!;
    b.stuckZ = view.position[e * 3 + 2]!;
    b.stuckCount = 0;
    b.follower.clear();
  }
  const hp = view.health[e]!;
  if (hp < b.lastHealth - 0.01) b.alertUntil = tick + t.alert;
  b.lastHealth = hp;

  // Percepção no ritmo do LOD, quando o orçamento de raios do tick deixa (senão fica para o próximo tick).
  if (tick >= b.nextPerceiveTick && c.raysLeft >= 2) {
    b.lodA = b.targetVisible || c.nearObserver(view.position[e * 3]!, view.position[e * 3 + 2]!);
    perceive(c, b, e, tick);
    b.nextPerceiveTick = tick + (b.lodA ? t.perceptionA : t.perceptionB);
  }
  if (b.target >= 0 && !targetValid(view, b)) {
    b.target = -1;
    b.targetVisible = false;
  }
  if (b.target >= 0 && !b.targetVisible && tick - b.lastSeenTick > t.memory) b.target = -1;

  let buttons: number;
  if (b.target >= 0 && b.targetVisible) {
    buttons = combat(c, b, e, tick, t);
  } else {
    buttons = travel(c, b, e, t);
  }
  // Pulo precisa de borda (a sim só pula ao apertar): solta um tick entre dois pulos.
  if ((buttons & BUTTON.jump) !== 0) {
    if (b.jumpHeld) buttons &= ~BUTTON.jump;
    b.jumpHeld = !b.jumpHeld;
  } else {
    b.jumpHeld = false;
  }
  f.buttons = buttons;
  f.moveX = quantizeAxis(local.x);
  f.moveY = quantizeAxis(local.y);
  f.yaw = yawToU16(b.aimYaw);
  f.pitch = pitchToI16(b.aimPitch);
}
