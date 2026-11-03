import { botLevelFromRef, type BotLevel, type MatchRecipe } from '@boboforces/format';
import { BUTTON, quantizeAxis, type InputFrame } from '@boboforces/input';
import {
  angleDelta,
  assert,
  clamp,
  createRng,
  DEG_TO_RAD,
  HALF_PI,
  pitchToI16,
  wrapAngle,
  yawToU16,
  type Disposable,
  type Rng,
} from '@boboforces/shared';
import {
  aimPointHeight,
  ENTITY_FLAG,
  ENTITY_KIND,
  expandRecipe,
  eyeHeightFor,
  isFfaMode,
  MATCH_DEFAULTS,
  MAX_CONTROLLERS,
  secondsToTicks,
  SIM_HZ,
  WEAPON_SLOTS,
  type SimView,
} from '@boboforces/sim';
import { BLOCK_FLAG, CELLS_PER_METER, createRayHit, isCellSolid, raycastGrid } from '@boboforces/world';
import { aimSkillForLevel, type AimSkill } from './skill.ts';

/**
 * Controla TODOS os bots de uma partida. Roda antes de cada `sim.step` (passo 0 da ordem fixa) e escreve o frame de
 * cada bot em `frames[BOT_CONTROLLER_BASE + botIndex]` (a ordem dos bots é a de expansão da receita).
 */
export interface BotDirector extends Disposable {
  readonly botCount: number;
  think(view: SimView, frames: InputFrame[]): void;
}

export interface BotDirectorConfig {
  readonly recipe: MatchRecipe;
  /** Humanos ocupando os controladores 0..humans-1 (os bots começam em BOT_CONTROLLER_BASE de qualquer jeito). */
  readonly humans: number;
  /** Ticks por segundo da sim (`sim.hz`; padrão `SIM_HZ`): os tempos da IA são em segundos e viram ticks aqui. */
  readonly hz?: number;
}

/**
 * Bot mínimo do M0 (PLANO_M0, área `ai`; tecnico.md §8.2 sem a camada de decisão):
 * - percepção a 10 Hz (bots escalonados entre os ticks): cone de 120°, alcance de visão da partida e raio DDA de
 *   oclusão até a cabeça e o tronco; quem toma dano olha em volta (360°) por 1 s;
 * - sem alvo: anda em linha reta até a última posição vista, ou até um ponto sorteado da arena, com desvio simples
 *   (sonda de células à frente, pulo em obstáculo de 1 m, troca de lado se empacar). Navegação de verdade é M1;
 * - com alvo: tempo de reação, mira com velocidade de giro limitada e erro gaussiano que cai de 3x ao mínimo durante a
 *   aquisição, compensação de recoil, preferência por cabeça, ADS de longe e movimento em combate do nível.
 * Determinístico: um fluxo de RNG por bot (`rng.fork('bot', i)` a partir da semente da receita), orçamento em raios.
 * LOD de IA, utility AI, blackboard de time e audição chegam no M2.
 */

/** Raios de percepção por bot por percepção (orçamento em unidades de trabalho, nunca em ms). */
const RAYS_PER_PERCEPTION = 4;
/** Meio-ângulo do cone de visão (120° no total). */
const VIEW_CONE_COS = Math.cos(60 * DEG_TO_RAD);
/** Folga angular extra para apertar o gatilho, além do tamanho aparente do alvo. */
const FIRE_TOLERANCE = 1 * DEG_TO_RAD;
/** Mira com zoom de longe (gameplay.md §3.4: ADS reduz a dispersão a 0,3x). */
const ADS_MIN_DISTANCE = 8;
/** Mais longe que isso, chega mais perto enquanto troca tiro. */
const APPROACH_DISTANCE = 30;
const SPRINT_MIN_DISTANCE = 8;
const SPRINT_MAX_TURN = 30 * DEG_TO_RAD;
const GOAL_REACHED = 1.5;
const STUCK_DISTANCE = 0.5;

const PROBE_FREE = 0;
const PROBE_JUMP = 1;
const PROBE_BLOCKED = 2;

const F = ENTITY_FLAG;

/** Estado de um bot. Objetos criados uma vez por partida; o `think` não aloca. */
class Brain {
  readonly index: number;
  readonly controller: number;
  readonly level: BotLevel;
  readonly skill: AimSkill;
  readonly rng: Rng;
  readonly reactionTicks: number;
  readonly acquireTicks: number;
  readonly turnStep: number;
  readonly errorRad: number;

  wasDead = true;
  aimYaw = 0;
  aimPitch = 0;

  target = -1;
  targetGen = 0;
  targetVisible = false;
  lastSeenTick = -1_000_000;
  reactionReadyTick = 0;
  acquireStartTick = 0;
  aimHead = false;
  errYaw = 0;
  errPitch = 0;
  errNextTick = 0;

  hasLastKnown = false;
  lastKnownX = 0;
  lastKnownZ = 0;
  hasGoal = false;
  goalX = 0;
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

  constructor(index: number, controller: number, level: BotLevel, rng: Rng, hz: number) {
    this.index = index;
    this.controller = controller;
    this.level = level;
    this.skill = aimSkillForLevel(level);
    this.rng = rng;
    this.reactionTicks = secondsToTicks(this.skill.reactionS, hz);
    this.acquireTicks = secondsToTicks(this.skill.acquireS, hz);
    this.turnStep = (this.skill.turnDegPerS * DEG_TO_RAD) / hz;
    this.errorRad = this.skill.aimErrorDeg * DEG_TO_RAD;
    this.strafeDir = rng.chance(0.5) ? 1 : -1;
  }
}

const rayHit = createRayHit();

function turnToward(current: number, goal: number, step: number): number {
  const d = angleDelta(current, goal);
  return wrapAngle(current + (d > step ? step : d < -step ? -step : d));
}

function moveToward(current: number, goal: number, step: number): number {
  const d = goal - current;
  return current + (d > step ? step : d < -step ? -step : d);
}

/** Bots a partir da receita: um `Brain` por bot, na ordem de expansão (a mesma da sim). */
export function createBotDirector(config: BotDirectorConfig): BotDirector {
  const { recipe } = config;
  const hz = config.hz ?? SIM_HZ;
  const PERCEPTION_TICKS = Math.max(1, secondsToTicks(0.1, hz));
  const ERROR_RESAMPLE_TICKS = Math.max(1, secondsToTicks(0.2, hz));
  const MEMORY_TICKS = secondsToTicks(3, hz);
  const CHASE_TICKS = secondsToTicks(5, hz);
  const ALERT_TICKS = secondsToTicks(1, hz);
  const WANDER_TICKS = secondsToTicks(8, hz);
  const DETOUR_TICKS = secondsToTicks(0.5, hz);
  const STUCK_TICKS = secondsToTicks(1, hz);
  /** Janelas sorteadas da IA foram calibradas em ticks de 60 Hz: em outro hz, mesma duração em segundos. */
  const ticks60 = (n: number): number => (hz === SIM_HZ ? n : Math.max(1, Math.round((n * hz) / SIM_HZ)));
  const ffa = isFfaMode(recipe.mode);
  const root = createRng(recipe.seed);
  const brains: Brain[] = [];
  let maxController = -1;
  for (const slot of expandRecipe(recipe, config.humans)) {
    if (slot.bot === null) continue;
    // Bot embutido (`embedded:`) ainda não existe no M0: vira Normal.
    const level = botLevelFromRef(slot.bot) ?? 'normal';
    brains.push(new Brain(slot.botIndex, slot.controller, level, root.fork('bot', slot.botIndex), hz));
    maxController = Math.max(maxController, slot.controller);
  }
  const viewDistance = recipe.match?.viewDistanceM ?? MATCH_DEFAULTS.viewDistanceM;
  const ctrlToEntity = new Int32Array(MAX_CONTROLLERS);
  /** Candidatos da percepção (os mais próximos no cone), em rascunho fixo: o `think` não aloca. */
  const candIndex = new Int32Array(RAYS_PER_PERCEPTION);
  const candD2 = new Float64Array(RAYS_PER_PERCEPTION);

  const hostile = (view: SimView, a: number, b: number): boolean => a !== b && (ffa || view.team[a] !== view.team[b]);

  const targetValid = (view: SimView, b: Brain): boolean => {
    const t = b.target;
    return (
      t >= 0 &&
      t < view.count &&
      view.alive[t] === 1 &&
      view.generation[t] === b.targetGen &&
      (view.flags[t]! & F.dead) === 0
    );
  };

  /** Linha de visão do olho até a cabeça ou o tronco do bobo `t`. */
  const canSee = (view: SimView, ex: number, ey: number, ez: number, t: number): boolean => {
    const t3 = t * 3;
    const tx = view.position[t3]!;
    const tz = view.position[t3 + 2]!;
    const tfl = view.flags[t]!;
    for (let k = 0; k < 2; k++) {
      const ty = view.position[t3 + 1]! + aimPointHeight(tfl, k === 0);
      const dx = tx - ex;
      const dy = ty - ey;
      const dz = tz - ez;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-6) return true;
      const hit = raycastGrid(
        view.world,
        view.blocks,
        ex,
        ey,
        ez,
        dx / d,
        dy / d,
        dz / d,
        d,
        BLOCK_FLAG.blocksSight,
        rayHit,
      );
      if (!hit) return true;
    }
    return false;
  };

  const acquire = (view: SimView, b: Brain, t: number, tick: number): void => {
    b.target = t;
    b.targetGen = view.generation[t]!;
    b.reactionReadyTick = tick + b.reactionTicks;
    b.acquireStartTick = b.reactionReadyTick;
    b.aimHead = b.rng.chance(b.skill.headPreference);
    b.errNextTick = 0;
  };

  const perceive = (view: SimView, b: Brain, e: number, tick: number): void => {
    const e3 = e * 3;
    const ex = view.position[e3]!;
    const ey = view.position[e3 + 1]! + eyeHeightFor(view.flags[e]!);
    const ez = view.position[e3 + 2]!;
    b.targetVisible = false;
    if (targetValid(view, b) && canSee(view, ex, ey, ez, b.target)) {
      b.targetVisible = true;
      b.lastSeenTick = tick;
      b.hasLastKnown = true;
      b.lastKnownX = view.position[b.target * 3]!;
      b.lastKnownZ = view.position[b.target * 3 + 2]!;
      return;
    }
    const fwdX = -Math.sin(b.aimYaw);
    const fwdZ = -Math.cos(b.aimYaw);
    const alert = tick < b.alertUntil;
    // O orçamento de raios vai para os inimigos MAIS PRÓXIMOS no cone (e não para os primeiros na ordem de entidade,
    // que deixava os de índice alto invisíveis atrás de 4 de índice baixo escondidos).
    const maxD2 = viewDistance * viewDistance;
    let candidates = 0;
    for (let j = 0; j < view.count; j++) {
      if (view.alive[j] === 0 || view.kind[j] !== ENTITY_KIND.bobo || (view.flags[j]! & F.dead) !== 0) continue;
      if (!hostile(view, e, j)) continue;
      const dx = view.position[j * 3]! - ex;
      const dz = view.position[j * 3 + 2]! - ez;
      const d2 = dx * dx + dz * dz;
      if (d2 >= maxD2) continue;
      if (candidates === RAYS_PER_PERCEPTION && d2 >= candD2[RAYS_PER_PERCEPTION - 1]!) continue;
      if (!alert) {
        const d = Math.sqrt(d2);
        if (d > 0.01 && (dx * fwdX + dz * fwdZ) / d < VIEW_CONE_COS) continue;
      }
      // Inserção ordenada por distância num vetor fixo de RAYS_PER_PERCEPTION.
      let k = candidates < RAYS_PER_PERCEPTION ? candidates++ : RAYS_PER_PERCEPTION - 1;
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
      if (canSee(view, ex, ey, ez, j)) {
        best = j;
        break;
      }
    }
    if (best < 0) return;
    if (best !== b.target || !targetValid(view, b)) acquire(view, b, best, tick);
    b.targetVisible = true;
    b.lastSeenTick = tick;
    b.hasLastKnown = true;
    b.lastKnownX = view.position[best * 3]!;
    b.lastKnownZ = view.position[best * 3 + 2]!;
  };

  /** Sonda as células à frente (0,45 e 0,8 m) na direção `heading`: livre, precisa pular, ou bloqueado. */
  const probe = (view: SimView, x: number, y: number, z: number, heading: number): number => {
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
      if (!s2 && !s3 && (!s1 || !s4))
        res = PROBE_FREE; // livre ou degrau de 0,5 m
      else if (s2 && !s3 && !s4 && !isCellSolid(g, r, cx, fy + 4, cz))
        res = PROBE_JUMP; // obstáculo de 1,0 m
      else res = PROBE_BLOCKED;
      if (res > worst) worst = res;
    }
    return worst;
  };

  const pickWanderGoal = (view: SimView, b: Brain, tick: number): void => {
    const g = view.world;
    const maxX = g.sizeX / CELLS_PER_METER;
    const maxZ = g.sizeZ / CELLS_PER_METER;
    b.goalX = b.rng.range(2, Math.max(2.5, maxX - 2));
    b.goalZ = b.rng.range(2, Math.max(2.5, maxZ - 2));
    b.hasGoal = true;
    b.goalUntil = tick + WANDER_TICKS;
  };

  /** Com alvo à vista: mira, atira e se mexe conforme o nível. Devolve os botões; escreve o strafe em `local`. */
  const local = { x: 0, y: 0 };
  const combat = (view: SimView, b: Brain, e: number, tick: number): number => {
    const sk = b.skill;
    const e3 = e * 3;
    const fl = view.flags[e]!;
    const ex = view.position[e3]!;
    const ey = view.position[e3 + 1]! + eyeHeightFor(fl);
    const ez = view.position[e3 + 2]!;
    const t3 = b.target * 3;
    const tx = view.position[t3]!;
    const ty = view.position[t3 + 1]! + aimPointHeight(view.flags[b.target]!, b.aimHead);
    const tz = view.position[t3 + 2]!;
    const dx = tx - ex;
    const dy = ty - ey;
    const dz = tz - ez;
    const horiz = Math.sqrt(dx * dx + dz * dz);
    const dist = Math.sqrt(horiz * horiz + dy * dy);
    let goalYaw = Math.atan2(-dx, -dz);
    let goalPitch = Math.atan2(dy, horiz);
    const ready = tick >= b.reactionReadyTick;
    let buttons = 0;

    if (ready) {
      if (tick >= b.errNextTick) {
        const p = b.acquireTicks > 0 ? clamp((tick - b.acquireStartTick) / b.acquireTicks, 0, 1) : 1;
        const scale = b.errorRad * (3 - 2 * p) * Math.SQRT1_2;
        b.errYaw = b.rng.gaussian() * scale;
        b.errPitch = b.rng.gaussian() * scale;
        b.errNextTick = tick + ERROR_RESAMPLE_TICKS;
      }
      goalYaw += b.errYaw - sk.recoilControl * view.recoilYaw[e]!;
      goalPitch += b.errPitch - sk.recoilControl * view.recoilPitch[e]!;
      b.aimYaw = turnToward(b.aimYaw, goalYaw, b.turnStep);
      b.aimPitch = clamp(moveToward(b.aimPitch, goalPitch, b.turnStep), -HALF_PI, HALF_PI);
      const remaining = Math.max(Math.abs(angleDelta(b.aimYaw, goalYaw)), Math.abs(goalPitch - b.aimPitch));
      const tolerance = FIRE_TOLERANCE + Math.atan(0.25 / Math.max(dist, 1));
      if (remaining <= tolerance && view.ammoClip[e]! > 0) buttons |= BUTTON.fire;
    }
    if (dist > ADS_MIN_DISTANCE) buttons |= BUTTON.ads;

    local.x = 0;
    local.y = dist > APPROACH_DISTANCE ? 1 : 0;
    switch (sk.combatMove) {
      case 'none':
        break;
      case 'light':
        if (tick >= b.strafeUntil) {
          b.strafeActive = b.rng.chance(0.5);
          b.strafeDir = b.rng.chance(0.5) ? 1 : -1;
          b.strafeUntil = tick + ticks60(b.rng.int(36, 84));
        }
        if (b.strafeActive) local.x = b.strafeDir;
        break;
      case 'strafe':
      case 'strafeDodge':
        if (tick >= b.strafeUntil) {
          b.strafeDir = b.rng.chance(0.7) ? -b.strafeDir : b.strafeDir;
          b.strafeUntil = tick + ticks60(b.rng.int(24, 60));
        }
        local.x = b.strafeDir;
        if (sk.combatMove === 'strafeDodge') {
          // Agacha em rajadas enquanto troca tiro; pulinho de esquiva só fora do tiro (no ar a dispersão é 2,5x).
          if (ready && tick >= b.dodgeDecisionTick) {
            b.dodgeDecisionTick = tick + ticks60(b.rng.int(18, 42));
            b.crouchUntil = b.rng.chance(0.4) ? b.dodgeDecisionTick : 0;
          }
          if (tick < b.crouchUntil) buttons |= BUTTON.crouch;
          if (!ready && tick >= b.nextJumpTick && (fl & F.onGround) !== 0) {
            buttons |= BUTTON.jump;
            b.nextJumpTick = tick + ticks60(b.rng.int(40, 100));
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
  };

  /** Sem alvo à vista: vai até a última posição vista ou passeia, com desvio simples. Devolve os botões. */
  const travel = (view: SimView, b: Brain, e: number, tick: number): number => {
    const e3 = e * 3;
    const x = view.position[e3]!;
    const y = view.position[e3 + 1]!;
    const z = view.position[e3 + 2]!;
    let buttons = 0;

    let gx: number;
    let gz: number;
    if (b.hasLastKnown && tick - b.lastSeenTick < CHASE_TICKS) {
      gx = b.lastKnownX;
      gz = b.lastKnownZ;
      const ddx = gx - x;
      const ddz = gz - z;
      if (ddx * ddx + ddz * ddz < GOAL_REACHED * GOAL_REACHED) b.hasLastKnown = false;
    } else {
      b.hasLastKnown = false;
      const ddx = b.goalX - x;
      const ddz = b.goalZ - z;
      if (!b.hasGoal || tick >= b.goalUntil || ddx * ddx + ddz * ddz < GOAL_REACHED * GOAL_REACHED) {
        pickWanderGoal(view, b, tick);
      }
      gx = b.goalX;
      gz = b.goalZ;
    }
    const dx = gx - x;
    const dz = gz - z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    let heading = Math.atan2(-dx, -dz);

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
              b.detourUntil = tick + DETOUR_TICKS;
              heading = b.detourHeading;
              found = true;
              break;
            }
          }
        }
        if (!found) pickWanderGoal(view, b, tick);
      } else if (res === PROBE_JUMP && (view.flags[e]! & F.onGround) !== 0) {
        buttons |= BUTTON.jump;
      }
    }

    // Empacou: troca o lado do desvio; empacou de novo, desiste do objetivo.
    if (tick - b.stuckTick >= STUCK_TICKS) {
      const mx = x - b.stuckX;
      const mz = z - b.stuckZ;
      if (mx * mx + mz * mz < STUCK_DISTANCE * STUCK_DISTANCE) {
        b.detourSign = -b.detourSign;
        b.detourUntil = 0;
        if (++b.stuckCount >= 2) {
          b.stuckCount = 0;
          b.hasLastKnown = false;
          pickWanderGoal(view, b, tick);
        }
        buttons |= BUTTON.jump;
      } else {
        b.stuckCount = 0;
      }
      b.stuckTick = tick;
      b.stuckX = x;
      b.stuckZ = z;
    }

    b.aimYaw = turnToward(b.aimYaw, heading, b.turnStep);
    b.aimPitch = moveToward(b.aimPitch, 0, b.turnStep);
    // Olha para onde anda: a direção desejada no mundo vira moveX/moveY relativos à mira atual.
    const wx = -Math.sin(heading);
    const wz = -Math.cos(heading);
    const s = Math.sin(b.aimYaw);
    const c = Math.cos(b.aimYaw);
    local.y = -s * wx - c * wz;
    local.x = c * wx - s * wz;
    if (distance > SPRINT_MIN_DISTANCE && Math.abs(angleDelta(b.aimYaw, heading)) < SPRINT_MAX_TURN) {
      buttons |= BUTTON.sprint;
    }
    const def = WEAPON_SLOTS[view.weapon[e]!];
    if (def && view.ammoClip[e]! < def.clipSize / 2) buttons |= BUTTON.reload;
    return buttons;
  };

  const thinkOne = (view: SimView, b: Brain, f: InputFrame): void => {
    f.seq = (f.seq + 1) & 0xffff;
    f.buttons = 0;
    f.moveX = 0;
    f.moveY = 0;
    f.weapon = 0;
    const e = ctrlToEntity[b.controller]!;
    if (e < 0) return;
    const fl = view.flags[e]!;
    if ((fl & F.dead) !== 0) {
      b.wasDead = true;
      b.target = -1;
      b.targetVisible = false;
      return;
    }
    const tick = view.tick;
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
    }
    const hp = view.health[e]!;
    if (hp < b.lastHealth - 0.01) b.alertUntil = tick + ALERT_TICKS;
    b.lastHealth = hp;

    if ((tick + b.index) % PERCEPTION_TICKS === 0) perceive(view, b, e, tick);
    if (b.target >= 0 && !targetValid(view, b)) {
      b.target = -1;
      b.targetVisible = false;
    }
    if (b.target >= 0 && !b.targetVisible && tick - b.lastSeenTick > MEMORY_TICKS) b.target = -1;

    let buttons: number;
    if (b.target >= 0 && b.targetVisible) {
      buttons = combat(view, b, e, tick);
    } else {
      buttons = travel(view, b, e, tick);
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
  };

  let disposed = false;
  return {
    botCount: brains.length,
    think(view, frames): void {
      assert(!disposed, 'ai: think depois do dispose');
      assert(frames.length > maxController, 'ai: frames precisa cobrir todos os controladores de bot');
      ctrlToEntity.fill(-1);
      for (let i = 0; i < view.count; i++) {
        if (view.alive[i] === 0 || view.kind[i] !== ENTITY_KIND.bobo) continue;
        const c = view.controller[i]!;
        if (c >= 0 && c < MAX_CONTROLLERS) ctrlToEntity[c] = i;
      }
      for (let i = 0; i < brains.length; i++) {
        const b = brains[i]!;
        thinkOne(view, b, frames[b.controller]!);
      }
    },
    dispose(): void {
      disposed = true;
      brains.length = 0;
    },
  };
}
