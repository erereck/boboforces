import {
  intelligenceForLevel,
  LEVEL_ORDER,
  LEVEL_SKILLS,
  levelBot,
  type BotDocument,
  type BotIntelligence,
  type BotLevel,
  type BotPersonality,
  type BotRules,
} from '@boboforces/format';
import { BUTTON, quantizeAxis, WEAPON_SLOT_COUNT, type InputFrame } from '@boboforces/input';
import { angleDelta, clamp, DEG_TO_RAD, HALF_PI, pitchToI16, wrapAngle, yawToU16, type Rng } from '@boboforces/shared';
import {
  aimPointWorld,
  ENTITY_FLAG,
  ENTITY_KIND,
  eyeHeightFor,
  figurePostureOf,
  secondsToTicks,
  heldClip,
  WEAPON_FIRE,
  WEAPON_SLOT,
  weaponDef,
  visibleAimOffset,
  weaponGrip,
  type AimPoint,
  type SimView,
} from '@boboforces/sim';
import { CELLS_PER_METER, isCellSolid } from '@boboforces/world';
import {
  AI_KNIFE,
  AI_LOD,
  AI_COVER,
  AI_FLANK,
  AI_GRENADE,
  AI_HOLD,
  AI_PATH,
  AI_PERSONA,
  AI_RETREAT,
  AI_TEAM,
  AI_PATROL,
  AI_PISTOL_HYSTERESIS_M,
  AI_SENSES,
  AI_SOLDIER,
  AI_SUPPORT,
  AI_WEAPON_USE,
  type AiWeaponUse,
} from './config.ts';
import type { AiContext } from './context.ts';
import { createSteer, PathFollower } from './paths.ts';
import {
  CAMP_PHASE,
  focusValid,
  personaApproach,
  personaCombat,
  personaFled,
  personaGoal,
  personaHold,
  personaOnDamaged,
  personaOverride,
  personaRetreat,
  personaSpawn,
  personaTick,
  personaTravel,
} from './persona.ts';
import { COVER_PHASE, onDamaged, seekCover, updateCover } from './tactics.ts';
import { GRENADE_PHASE, holdAngle, maybeStartGrenade, onTargetLost, retreatBelow, stepGrenade } from './tactics2.ts';
import { aimSkillForLevel, aimSkillFromBot, type AimSkill } from './skill.ts';

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
 *   cabeça), ADS de longe e o movimento em combate do nível;
 * - M2 (fase 1d): uso de cada arma (`AI_WEAPON_USE`): distância preferida (chega perto ou recua), ADS por arma, a
 *   sniper só atira com o ADS completo, o foguete mira no pé com antecipação; troca para a pistola com a primária vazia
 *   ou com o alvo perto demais para o foguete e a sniper, e para a faca com o alvo colado. Nas semiautomáticas o
 *   gatilho solta um tick entre dois tiros (a sim só atira na borda). Granada: só com o N2 (fase 3).
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
  readonly unstuck: number;
  /** M2 (fase 3c): cobertura e patrulha, em ticks. */
  readonly coverGoing: number;
  readonly coverHoldMin: number;
  readonly coverHoldExtra: number;
  readonly coverCooldown: number;
  readonly scanMin: number;
  readonly scanMax: number;
  readonly scanHold: number;
  /** M2 (fase 3d): ângulo, flanco, recuo e granada, em ticks. */
  readonly holdAngleMin: number;
  readonly holdAngleExtra: number;
  readonly flank: number;
  readonly retreatHold: number;
  readonly grenadeDecide: number;
  readonly grenadeMemory: number;
  readonly grenadeSwitch: number;
  readonly grenadeCooldown: number;
  /** M2 (fases 3e e 3f): avisos, dupla e calor, em ticks. */
  readonly pingEvery: number;
  readonly pingMaxAge: number;
  readonly buddyGoalAge: number;
  readonly preAimEvery: number;
  readonly fakeRetreatEvery: number;
  /** M2 (fase 3g): personalidades, em ticks (a dancinha gira `danceSpinStep` rad por tick). */
  readonly hop: number;
  readonly rusherJumpMin: number;
  readonly rusherJumpMax: number;
  readonly lunaticIntentMin: number;
  readonly lunaticIntentMax: number;
  readonly lunaticSky: number;
  readonly lunaticJump: number;
  readonly playDead: number;
  readonly campHold: number;
  readonly campHoldExtra: number;
  readonly campRetry: number;
  readonly quarryEvery: number;
  readonly pursuitEvery: number;
  readonly supportEvery: number;
  readonly dance: number;
  readonly danceCrouch: number;
  readonly danceJump: number;
  readonly danceSpinStep: number;
  readonly dummyStride: number;
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
    this.unstuck = secondsToTicks(AI_PATH.unstuckS, hz);
    this.coverGoing = secondsToTicks(AI_COVER.goingS, hz);
    this.coverHoldMin = secondsToTicks(AI_COVER.holdMinS, hz);
    this.coverHoldExtra = secondsToTicks(AI_COVER.holdExtraS, hz);
    this.coverCooldown = secondsToTicks(AI_COVER.cooldownS, hz);
    this.scanMin = secondsToTicks(AI_PATROL.everyMinS, hz);
    this.scanMax = secondsToTicks(AI_PATROL.everyMaxS, hz);
    this.scanHold = secondsToTicks(AI_PATROL.holdS, hz);
    this.holdAngleMin = secondsToTicks(AI_HOLD.minS, hz);
    this.holdAngleExtra = secondsToTicks(AI_HOLD.extraS, hz);
    this.flank = secondsToTicks(AI_FLANK.timeoutS, hz);
    this.retreatHold = secondsToTicks(AI_RETREAT.holdS, hz);
    this.grenadeDecide = secondsToTicks(AI_GRENADE.decideS, hz);
    this.grenadeMemory = secondsToTicks(AI_GRENADE.memoryS, hz);
    this.grenadeSwitch = Math.max(1, secondsToTicks(AI_GRENADE.switchS, hz));
    this.grenadeCooldown = secondsToTicks(AI_GRENADE.cooldownS, hz);
    this.pingEvery = secondsToTicks(AI_TEAM.pingEveryS, hz);
    this.pingMaxAge = secondsToTicks(AI_TEAM.pingMaxAgeS, hz);
    this.buddyGoalAge = secondsToTicks(AI_TEAM.buddyGoalAgeS, hz);
    this.preAimEvery = secondsToTicks(AI_TEAM.preAimEveryS, hz);
    this.fakeRetreatEvery = secondsToTicks(10, hz);
    const P = AI_PERSONA;
    this.hop = Math.max(1, secondsToTicks(P.hopEveryS, hz));
    this.rusherJumpMin = Math.max(1, secondsToTicks(P.rusherJumpMinS, hz));
    this.rusherJumpMax = Math.max(this.rusherJumpMin, secondsToTicks(P.rusherJumpMaxS, hz));
    this.lunaticIntentMin = Math.max(1, secondsToTicks(P.lunaticIntentMinS, hz));
    this.lunaticIntentMax = Math.max(this.lunaticIntentMin, secondsToTicks(P.lunaticIntentMaxS, hz));
    this.lunaticSky = Math.max(1, secondsToTicks(P.lunaticSkyS, hz));
    this.lunaticJump = Math.max(2, secondsToTicks(P.lunaticJumpS, hz));
    this.playDead = secondsToTicks(P.playDeadS, hz);
    this.campHold = secondsToTicks(P.campHoldS, hz);
    this.campHoldExtra = secondsToTicks(P.campHoldExtraS, hz);
    this.campRetry = secondsToTicks(P.campRetryS, hz);
    this.quarryEvery = secondsToTicks(P.quarryEveryS, hz);
    this.pursuitEvery = secondsToTicks(P.pursuitEveryS, hz);
    this.supportEvery = secondsToTicks(P.supportEveryS, hz);
    this.dance = secondsToTicks(P.danceS, hz);
    this.danceCrouch = Math.max(1, secondsToTicks(P.danceCrouchS, hz));
    this.danceJump = Math.max(2, secondsToTicks(P.danceJumpS, hz));
    this.danceSpinStep = (P.danceSpinDegPerS * DEG_TO_RAD) / hz;
    this.dummyStride = Math.max(1, secondsToTicks(P.dummyStrideS, hz));
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
  /**
   * M2 (fase 3a): o bot (`bot@1`): inteligência (os comportamentos que valem), personalidade e regras. A habilidade
   * sai dele em `skill`.
   */
  intelligence: BotIntelligence;
  readonly personality: BotPersonality;
  readonly rules: BotRules;
  /** Nível e o que sai dele; mudam no meio da partida pelo "Ajustar desafio" (M2, fase 2e: `setLevel`). */
  level: BotLevel;
  skill: AimSkill;
  readonly rng: Rng;
  reactionTicks: number;
  acquireTicks: number;
  turnStep: number;
  errorRad: number;
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
  /** M3 (fase 3a): o colega caído que este bot vai levantar (índice), ou -1. */
  reviveTarget = -1;
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
  /**
   * M2 (fase 2b): progresso (Destravar): onde o bot estava na última vez que andou, o objetivo medido, o menor resto
   * do caminho até ele e quando houve progresso.
   */
  progressX = 0;
  progressZ = 0;
  progressGoalX = 0;
  progressGoalZ = 0;
  progressBest = Infinity;
  progressTick = 0;
  jumpHeld = false;

  strafeDir = 1;
  strafeActive = false;
  strafeUntil = 0;
  crouchUntil = 0;
  dodgeDecisionTick = 0;
  nextJumpTick = 0;

  lastHealth = 0;
  alertUntil = 0;

  /** M2 (fase 3c): de onde veio o último dano (a ameaça), a vida cheia desta vida e a cobertura (`COVER_PHASE`). */
  threatX = 0;
  threatY = 0;
  threatZ = 0;
  maxHp = 100;
  coverPhase: number = COVER_PHASE.none;
  coverX = 0;
  coverY = 0;
  coverZ = 0;
  coverUntil = 0;
  coverCooldownUntil = 0;
  /** M2 (fase 3d): a cobertura é um recuo (fica até a vida voltar). */
  coverRetreat = false;
  /** M2 (fase 3d): uso de granada do bot (0..1, `skill.grenadeUse`). */
  grenadeUse = 0;
  /** M2 (fase 3d): via o alvo no tick anterior (para notar quando ele some). */
  wasTargetVisible = false;
  holdAngleUntil = 0;
  flankX = 0;
  flankY = 0;
  flankZ = 0;
  flankUntil = 0;
  grenadePhase: number = GRENADE_PHASE.none;
  grenadePhaseTick = 0;
  grenadeNextTick = 0;
  grenadeCookTicks = 0;
  grenadeX = 0;
  grenadeY = 0;
  grenadeZ = 0;
  /** M2 (fases 3e e 3f): próximo aviso, o último aviso seguido, a pré-mira do calor e o próximo "fingir recuar". */
  pingNextTick = 0;
  pingTakenTick = -1;
  preAimNextTick = 0;
  preAimValid = false;
  preAimX = 0;
  preAimZ = 0;
  fakeRetreatNextTick = 0;
  /** M2 (fase 3g): estado da personalidade (`persona.ts`). */
  lastKills = 0;
  hopNextTick = 0;
  personaJumpTick = 0;
  lunaticIntent = 0;
  lunaticStart = 0;
  lunaticUntil = 0;
  lunaticRange = 20;
  playDeadUntil = 0;
  playedDead = false;
  campPhase: number = CAMP_PHASE.none;
  campX = 0;
  campY = 0;
  campZ = 0;
  campUntil = 0;
  campNextTry = 0;
  campKillCount = 0;
  campLook = 0;
  /** Foco: a presa do Caçador e do Kamikaze, o humano do Suporte (-1 = nenhum). */
  focus = -1;
  focusGen = 0;
  focusNextTick = 0;
  pursuitNextTick = 0;
  guardHp = 0;
  danceUntil = 0;
  kamikazeArmed = false;
  kamikazeCooking = false;
  /** M2 (fase 3c): patrulha: quando olhar em volta de novo, até quando e para que lado (rad). */
  scanNextTick = 0;
  scanUntil = 0;
  scanOffset = 0;

  /** M2: slot pedido no `InputFrame.weapon` (0 primária, 1 pistola, 2 faca) e o gatilho do tick anterior. */
  wantSlot = 0;
  fireHeld = false;

  constructor(
    index: number,
    controller: number,
    level: BotLevel,
    rng: Rng,
    timing: SoldierTiming,
    follower: PathFollower,
    bot: BotDocument = levelBot(level),
    personality: BotPersonality = bot.personality,
  ) {
    this.index = index;
    this.controller = controller;
    this.rng = rng;
    this.level = level;
    this.intelligence = bot.intelligence;
    this.personality = personality;
    this.rules = bot.rules;
    this.skill = aimSkillFromBot(bot.skill, bot.intelligence.level);
    this.grenadeUse = bot.skill.grenadeUse;
    this.reactionTicks = 0;
    this.acquireTicks = 0;
    this.turnStep = 0;
    this.errorRad = 0;
    this.applySkill(timing);
    this.strafeDir = rng.chance(0.5) ? 1 : -1;
    this.follower = follower;
    // Espalha as percepções entre os ticks (baldes por índice).
    this.nextPerceiveTick = index % timing.perceptionA;
  }

  /**
   * Troca o nível (habilidade e inteligência do nível; reação, giro e erro de mira); personalidade e regras ficam.
   */
  setLevel(level: BotLevel, timing: SoldierTiming): void {
    this.level = level;
    this.skill = aimSkillForLevel(level);
    this.intelligence = intelligenceForLevel(LEVEL_ORDER.indexOf(level));
    this.grenadeUse = LEVEL_SKILLS[level].grenadeUse;
    this.applySkill(timing);
  }

  private applySkill(timing: SoldierTiming): void {
    this.reactionTicks = secondsToTicks(this.skill.reactionS, timing.hz);
    this.acquireTicks = secondsToTicks(this.skill.acquireS, timing.hz);
    this.turnStep = (this.skill.turnDegPerS * DEG_TO_RAD) / timing.hz;
    this.errorRad = this.skill.aimErrorDeg * DEG_TO_RAD;
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
  // M2 (fase 3g): o Caçador procura primeiro a presa dele e troca de alvo para ela assim que a vê.
  if (
    b.personality.preset === 'hunter' &&
    b.focus !== b.target &&
    focusValid(c, b) &&
    inSight(view, b, ex, ez, c.viewDistance)
  ) {
    if (c.canSee(ex, ey, ez, b.focus)) {
      acquire(view, b, b.focus, tick);
      b.targetVisible = true;
      remember(view, b, b.focus, tick);
      return;
    }
  }
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

/** O foco do bot está no alcance de visão e no cone (ou o bot está alerta)? */
function inSight(view: SimView, b: SoldierBrain, ex: number, ez: number, maxM: number): boolean {
  const f3 = b.focus * 3;
  const dx = view.position[f3]! - ex;
  const dz = view.position[f3 + 2]! - ez;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d >= maxM) return false;
  return d < 0.01 || (dx * -Math.sin(b.aimYaw) + dz * -Math.cos(b.aimYaw)) / d >= VIEW_CONE_COS;
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
  const board = c.board;
  const e = c.ctrlToEntity[b.controller]!;
  const team = e >= 0 ? view.team[e]! : 0;
  if (nav !== null && nav.nodeCount > 0) {
    const from = nav.nearestNode(x, y, z);
    // M2 (fase 3f): o N4 às vezes vai caçar onde os humanos ficam (a célula mais quente).
    if (board !== null && b.intelligence.learn && b.rng.chance(AI_TEAM.huntChance)) {
      const cell = board.hottest(team, x, z, AI_TEAM.huntMinM, AI_TEAM.huntMaxM, AI_TEAM.minHeat);
      if (cell >= 0) {
        board.cellCenter(cell, cellPos);
        const n = nav.nearestNode(cellPos[0]!, y, cellPos[1]!);
        if (n >= 0 && (from < 0 || nav.component[n] === nav.component[from])) {
          nav.nodePosition(n, nodePos, 0);
          setWanderGoal(c, b, e);
          return;
        }
      }
    }
    // M2 (fase 3e): o N3 anda em dupla ou trio: segue o objetivo de um líder (aliado de controlador menor, perto).
    // O Estrategista (N2+, fase 3g) também anda com o time.
    const teamUp = b.intelligence.callouts || (b.personality.preset === 'strategist' && b.intelligence.level >= 2);
    if (board !== null && teamUp && e >= 0) {
      const leader = findLeader(c, b, e, t);
      if (leader >= 0) {
        const n = nav.nearestNode(
          board.goalX[leader]! + b.rng.range(-AI_TEAM.buddyOffsetM, AI_TEAM.buddyOffsetM),
          y,
          board.goalZ[leader]! + b.rng.range(-AI_TEAM.buddyOffsetM, AI_TEAM.buddyOffsetM),
        );
        if (n >= 0 && (from < 0 || nav.component[n] === nav.component[from])) {
          nav.nodePosition(n, nodePos, 0);
          setWanderGoal(c, b, e);
          return;
        }
      }
    }
    for (let k = 0; k < AI_SOLDIER.wanderTries; k++) {
      const n = b.rng.int(0, nav.nodeCount);
      if (from >= 0 && nav.component[n] !== nav.component[from]) continue;
      nav.nodePosition(n, nodePos, 0);
      // M2 (fase 3f): o N4 evita passear onde o time dele morreu.
      if (
        board !== null &&
        b.intelligence.learn &&
        board.dangerAt(team, nodePos[0]!, nodePos[2]!) >= AI_TEAM.dangerAvoid
      ) {
        continue;
      }
      // Fora da área jogável (paredes invisíveis da sim) o bot nunca chega: tenta outro nó.
      const area = view.playArea;
      if (
        area &&
        (nodePos[0]! < area.minX || nodePos[0]! > area.maxX || nodePos[2]! < area.minZ || nodePos[2]! > area.maxZ)
      )
        continue;
      setWanderGoal(c, b, e);
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

/** Rascunho do centro da célula de calor (x, z). */
const cellPos = new Float64Array(2);

/** O objetivo de passeio é o nó em `nodePos`; fica no quadro do time (para os aliados andarem junto). */
function setWanderGoal(c: AiContext, b: SoldierBrain, e: number): void {
  b.goalX = nodePos[0]!;
  b.goalY = nodePos[1]!;
  b.goalZ = nodePos[2]!;
  b.hasGoal = true;
  const board = c.board;
  if (board !== null && e >= 0) {
    board.goalX[e] = b.goalX;
    board.goalZ[e] = b.goalZ;
    board.goalTick[e] = c.tick;
  }
}

/** Líder da dupla (N3): o aliado bot de controlador menor mais perto, a até `buddyM`, com objetivo recente; -1. */
function findLeader(c: AiContext, b: SoldierBrain, e: number, t: SoldierTiming): number {
  const view = c.view!;
  const board = c.board!;
  const x = view.position[e * 3]!;
  const z = view.position[e * 3 + 2]!;
  let best = -1;
  let bestD2 = AI_TEAM.buddyM * AI_TEAM.buddyM;
  for (let j = 0; j < view.count; j++) {
    if (j === e || !c.living(j) || view.kind[j] !== ENTITY_KIND.bobo || c.hostile(e, j)) continue;
    if (view.controller[j]! >= b.controller || c.tick - board.goalTick[j]! > t.buddyGoalAge) continue;
    const dx = view.position[j * 3]! - x;
    const dz = view.position[j * 3 + 2]! - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      best = j;
      bestD2 = d2;
    }
  }
  return best;
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
  let dx = aimPoint.x + tc * off.x - ts * off.z - ex;
  let dy = aimPoint.y + off.y - ey;
  let dz = aimPoint.z - ts * off.x - tc * off.z - ez;
  let horiz = Math.sqrt(dx * dx + dz * dz);
  let dist = Math.sqrt(horiz * horiz + dy * dy);

  // M2: slot pela distância e pela munição; a decisão de tiro vale para a arma NA MÃO (a troca leva 0,4 s).
  chooseSlot(view, b, e, dist);
  const held = weaponDef(view.weapon[e]!);
  const use: AiWeaponUse = held ? AI_WEAPON_USE[held.category] : AI_WEAPON_USE.rifle;
  if (held !== null && use.splash && held.projectileSpeed > 0) {
    // Foguete: no pé do alvo, adiantado pelo tempo de voo (velocidade atual do alvo).
    const t3 = tg * 3;
    const flight = dist / held.projectileSpeed;
    dx = view.position[t3]! + view.velocity[t3]! * flight - ex;
    dy = view.position[t3 + 1]! + 0.1 - ey;
    dz = view.position[t3 + 2]! + view.velocity[t3 + 2]! * flight - ez;
    horiz = Math.sqrt(dx * dx + dz * dz);
    dist = Math.sqrt(horiz * horiz + dy * dy);
  }
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
    if (remaining <= tolerance && canFire(view, b, e, held, use, dist)) buttons |= BUTTON.fire;
  }
  if (dist > use.adsMinM) buttons |= BUTTON.ads;
  // Semiautomática: solta o gatilho um tick entre dois tiros (a sim só atira na borda).
  if (held !== null && !held.automatic && (buttons & BUTTON.fire) !== 0 && b.fireHeld) buttons &= ~BUTTON.fire;
  b.fireHeld = (buttons & BUTTON.fire) !== 0;

  local.x = 0;
  // Distância preferida da arma e da personalidade (fase 3g): chega perto, recua (foguete, sniper, Covarde) ou segura a
  // posição; a faca vai em cima.
  const approach = personaApproach(b, use);
  local.y = dist > Math.max(approach, 1) ? 1 : dist < personaRetreat(b, use) ? -1 : 0;
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
  buttons = personaCombat(c, b, e, t, buttons, dist, approach, local);
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

/** Pente e reserva do slot `slot` de `e` vazios? */
function slotEmpty(view: SimView, e: number, slot: number): boolean {
  const k = e * WEAPON_SLOT_COUNT + slot;
  return view.slotClip[k] === 0 && view.slotReserve[k] === 0;
}

/**
 * Slot do bot em combate (M2, fase 1d): faca com o alvo colado (menos de escopeta na mão: ela mata de perto), pistola
 * com a primária vazia ou com o alvo perto demais para a primária (`pistolBelowM`), senão a primária. Volta com
 * folga (`AI_KNIFE.backM`, `AI_PISTOL_HYSTERESIS_M`) para não trocar sem parar.
 */
function chooseSlot(view: SimView, b: SoldierBrain, e: number, dist: number): void {
  const primary = weaponDef(view.loadout[e * WEAPON_SLOT_COUNT + WEAPON_SLOT.primary]!);
  const primaryUse = primary ? AI_WEAPON_USE[primary.category] : AI_WEAPON_USE.rifle;
  const primaryEmpty = slotEmpty(view, e, WEAPON_SLOT.primary);
  const pistolEmpty = slotEmpty(view, e, WEAPON_SLOT.secondary);
  // M2 (fase 3g): loadout restrito (regra do bot): sem faca não troca para ela; sem nada além da primária, fica nela.
  const hasMelee = hasSlotWeapon(view, e, WEAPON_SLOT.melee);
  let want = b.wantSlot;
  if (dist < AI_KNIFE.switchM && primary?.category !== 'shotgun' && hasMelee) want = WEAPON_SLOT.melee;
  else if (want === WEAPON_SLOT.melee && (dist > AI_KNIFE.backM || !hasMelee)) want = WEAPON_SLOT.primary;
  if (want !== WEAPON_SLOT.melee) {
    const tooClose = primaryUse.pistolBelowM > 0 && dist < primaryUse.pistolBelowM;
    if (primaryEmpty || tooClose) {
      want = !pistolEmpty ? WEAPON_SLOT.secondary : hasMelee ? WEAPON_SLOT.melee : WEAPON_SLOT.primary;
    } else if (
      want === WEAPON_SLOT.secondary &&
      (primaryUse.pistolBelowM === 0 || dist > primaryUse.pistolBelowM + AI_PISTOL_HYSTERESIS_M)
    ) {
      want = WEAPON_SLOT.primary;
    }
  }
  b.wantSlot = want;
}

/** O slot `slot` de `e` tem arma (o loadout restrito tira armas)? */
function hasSlotWeapon(view: SimView, e: number, slot: number): boolean {
  return weaponDef(view.loadout[e * WEAPON_SLOT_COUNT + slot]!) !== null;
}

/**
 * A arma na mão pode atirar agora? Munição (a faca não usa), alcance da faca, ADS completo da sniper e distância
 * segura do foguete. De perto, a sniper espera a troca pela pistola ou faca, se houver (fase 3g: o Camper Carl só tem
 * a sniper); o foguete nunca atira colado, menos no Kamikaze.
 */
function canFire(
  view: SimView,
  b: SoldierBrain,
  e: number,
  held: ReturnType<typeof weaponDef>,
  use: AiWeaponUse,
  dist: number,
): boolean {
  if (held === null) return false;
  if (held.fire === WEAPON_FIRE.melee) return dist <= held.meleeRangeM;
  if (held.clipSize > 0 && heldClip(view, e) === 0) return false;
  // M2 (fase 4e): sem ADS na partida, a sniper atira sem esperar a mira cheia.
  if (use.needFullAds && view.mods.ads && view.adsAmount[e]! < 0.95) return false;
  if (use.pistolBelowM > 0 && dist < use.pistolBelowM) {
    const other = use.splash
      ? b.personality.preset !== 'kamikaze'
      : !slotEmpty(view, e, WEAPON_SLOT.secondary) || hasSlotWeapon(view, e, WEAPON_SLOT.melee);
    if (other) return false;
  }
  return true;
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
  // M2 (fase 3e): sem pista, o N3 vai atrás do aviso mais novo do time (cada aviso uma vez).
  const board = c.board;
  if (!b.hasLastKnown && board !== null && b.intelligence.callouts) {
    const k = board.freshest(view.team[e]!, x, z, tick, t.pingMaxAge, AI_TEAM.pingMaxM);
    if (k >= 0 && board.pingTick[k] !== b.pingTakenTick) {
      b.pingTakenTick = board.pingTick[k]!;
      b.hasLastKnown = true;
      b.lastSeenTick = board.pingTick[k]!;
      b.lastKnownX = board.pingX[k]!;
      b.lastKnownY = board.pingY[k]!;
      b.lastKnownZ = board.pingZ[k]!;
    }
  }
  const scouting = !b.hasLastKnown;
  if (b.reviveTarget >= 0) {
    // M3 (fase 3a): indo levantar o colega caído.
    const r3 = b.reviveTarget * 3;
    gx = view.position[r3]!;
    gy = view.position[r3 + 1]!;
    gz = view.position[r3 + 2]!;
  } else if (b.coverPhase === COVER_PHASE.going) {
    // M2 (fase 3c): indo para a cobertura.
    gx = b.coverX;
    gy = b.coverY;
    gz = b.coverZ;
  } else if (tick < b.flankUntil) {
    // M2 (fase 3d): passando pelo ponto de flanco antes de voltar à caça.
    gx = b.flankX;
    gy = b.flankY;
    gz = b.flankZ;
    const fdx = gx - x;
    const fdz = gz - z;
    if (fdx * fdx + fdz * fdz < GOAL_REACHED * GOAL_REACHED || f.failed) b.flankUntil = 0;
  } else if (b.hasLastKnown && tick - b.lastSeenTick < t.chase) {
    gx = b.lastKnownX;
    gy = b.lastKnownY;
    gz = b.lastKnownZ;
    const ddx = gx - x;
    const ddz = gz - z;
    if (ddx * ddx + ddz * ddz < GOAL_REACHED * GOAL_REACHED || f.failed) b.hasLastKnown = false;
  } else {
    b.hasLastKnown = false;
    // M2 (fase 3g): o objetivo da personalidade (ponto do Camper, presa, humano do Suporte) vem antes do passeio.
    if (!personaGoal(c, b, e, t, x, y, z)) {
      const ddx = b.goalX - x;
      const ddz = b.goalZ - z;
      if (!b.hasGoal || tick >= b.goalUntil || ddx * ddx + ddz * ddz < GOAL_REACHED * GOAL_REACHED || f.failed) {
        if (f.failed) f.clear();
        pickWanderGoal(c, b, x, y, z, t);
      }
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

  // Anti-frustração (GDD §3.8): 8 s sem andar 2 m nem chegar 1 m mais perto do objetivo → Destravar.
  const pmx = x - b.progressX;
  const pmz = z - b.progressZ;
  if (pmx * pmx + pmz * pmz >= AI_PATH.unstuckMoveM * AI_PATH.unstuckMoveM) {
    b.progressX = x;
    b.progressZ = z;
    b.progressBest = steer.remaining;
    b.progressTick = tick;
  } else if (
    Math.abs(gx - b.progressGoalX) > AI_PATH.replanGoalM ||
    Math.abs(gz - b.progressGoalZ) > AI_PATH.replanGoalM
  ) {
    // Objetivo novo: mede o caminho até ele, sem recomeçar a conta.
    b.progressGoalX = gx;
    b.progressGoalZ = gz;
    b.progressBest = steer.remaining;
  } else if (steer.remaining < b.progressBest - AI_PATH.unstuckProgressM) {
    b.progressBest = steer.remaining;
    b.progressTick = tick;
  } else if (tick - b.progressTick >= t.unstuck) {
    buttons |= BUTTON.unstuck;
    b.progressBest = Infinity;
    b.progressTick = tick;
    b.progressX = x;
    b.progressZ = z;
    b.stuckCount = 0;
    f.clear();
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
    // M2 (fase 3c): patrulha do N1: sem pista do inimigo, olha para os lados de tempos em tempos.
    let look = heading;
    // M2 (fase 3f): o N4 pré-mira a célula mais quente perto (onde os humanos costumam estar).
    if (b.intelligence.learn && scouting && board !== null) {
      if (tick >= b.preAimNextTick) {
        b.preAimNextTick = tick + t.preAimEvery;
        const cell = board.hottest(view.team[e]!, x, z, AI_TEAM.preAimMinM, AI_TEAM.preAimMaxM, AI_TEAM.minHeat);
        b.preAimValid = cell >= 0;
        if (b.preAimValid) {
          board.cellCenter(cell, cellPos);
          b.preAimX = cellPos[0]!;
          b.preAimZ = cellPos[1]!;
        }
      }
    }
    const preAim = b.preAimValid && scouting ? Math.atan2(-(b.preAimX - x), -(b.preAimZ - z)) : heading;
    if (b.preAimValid && scouting && Math.abs(angleDelta(heading, preAim)) < HALF_PI) {
      look = preAim;
    } else if (b.intelligence.level >= 1 && scouting && b.coverPhase === COVER_PHASE.none) {
      if (tick >= b.scanNextTick) {
        b.scanNextTick = tick + b.rng.int(t.scanMin, t.scanMax + 1);
        b.scanUntil = tick + t.scanHold;
        b.scanOffset = (b.rng.chance(0.5) ? 1 : -1) * AI_PATROL.deg * DEG_TO_RAD;
      }
      if (tick < b.scanUntil) look = heading + b.scanOffset;
    }
    b.aimYaw = turnToward(b.aimYaw, look, b.turnStep);
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
  if (b.wantSlot !== WEAPON_SLOT.primary && !slotEmpty(view, e, WEAPON_SLOT.primary)) b.wantSlot = WEAPON_SLOT.primary;
  const def = weaponDef(view.weapon[e]!);
  if (def && def.clipSize > 0 && heldClip(view, e) < def.clipSize / 2) buttons |= BUTTON.reload;
  return personaTravel(view, b, e, tick, t, buttons, local);
}

/** Distância (no plano) de `e` até `j`. */
function targetDistance(view: SimView, e: number, j: number): number {
  return Math.hypot(
    view.position[j * 3]! - view.position[e * 3]!,
    view.position[j * 3 + 2]! - view.position[e * 3 + 2]!,
  );
}

/** A arma na mão está sem pente, mas tem reserva? */
function clipOutWithReserve(view: SimView, e: number): boolean {
  const def = weaponDef(view.weapon[e]!);
  if (def === null || def.clipSize === 0 || heldClip(view, e) > 0) return false;
  return view.slotReserve[e * WEAPON_SLOT_COUNT + view.slot[e]!]! > 0;
}

/**
 * M2 (fase 3c): segurando a cobertura sem alvo à vista: agachado, parado, olhando para de onde veio o dano e
 * recarregando se o pente não está cheio.
 */
function holdCover(view: SimView, b: SoldierBrain, e: number): number {
  const e3 = e * 3;
  const goal = Math.atan2(-(b.threatX - view.position[e3]!), -(b.threatZ - view.position[e3 + 2]!));
  b.aimYaw = turnToward(b.aimYaw, goal, b.turnStep);
  b.aimPitch = moveToward(b.aimPitch, 0, b.turnStep);
  local.x = 0;
  local.y = 0;
  let buttons = BUTTON.crouch;
  const def = weaponDef(view.weapon[e]!);
  if (def && def.clipSize > 0 && heldClip(view, e) < def.clipSize) buttons |= BUTTON.reload;
  return buttons;
}

/** Um tick de um soldado: escreve o frame do controlador dele. */
/** M3 (fase 3a): o colega do mesmo time caído (e não levantando sozinho) mais perto, até `reviveSeekM`; senão -1. */
function downedAlly(c: AiContext, e: number): number {
  const view = c.view!;
  const e3 = e * 3;
  let best = -1;
  let bestD2 = AI_SUPPORT.reviveSeekM * AI_SUPPORT.reviveSeekM;
  for (let j = 0; j < view.count; j++) {
    if (j === e || view.kind[j] !== ENTITY_KIND.bobo || !c.living(j) || view.team[j] !== view.team[e]) continue;
    if ((view.flags[j]! & F.downed) === 0 || view.selfUp[j] === 1) continue;
    const dx = view.position[j * 3]! - view.position[e3]!;
    const dy = view.position[j * 3 + 1]! - view.position[e3 + 1]!;
    const dz = view.position[j * 3 + 2]! - view.position[e3 + 2]!;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = j;
    }
  }
  return best;
}

/** M3 (fase 3a): o alvo visível é um zumbi a menos de `fightM` (atira em vez de ir levantar alguém). */
function zombieClose(view: SimView, b: SoldierBrain, e: number): boolean {
  if (b.target < 0 || !b.targetVisible || view.kind[b.target] !== ENTITY_KIND.zombie) return false;
  return targetDistance(view, e, b.target) < AI_SUPPORT.fightM;
}

/** M3 (fase 3a): vai até o colega caído e, colado, olha para ele e segura o usar (a sim conta os 3 s). */
function reviveStep(
  c: AiContext,
  b: SoldierBrain,
  e: number,
  t: SoldierTiming,
  local: { x: number; y: number },
): number {
  const view = c.view!;
  const r = b.reviveTarget;
  const dx = view.position[r * 3]! - view.position[e * 3]!;
  const dz = view.position[r * 3 + 2]! - view.position[e * 3 + 2]!;
  if (dx * dx + dz * dz > AI_SUPPORT.reviveReachM * AI_SUPPORT.reviveReachM) return travel(c, b, e, t);
  b.aimYaw = turnToward(b.aimYaw, Math.atan2(-dx, -dz), b.turnStep);
  local.x = 0;
  local.y = 0;
  return BUTTON.use;
}

export function thinkSoldier(c: AiContext, b: SoldierBrain, f: InputFrame, t: SoldierTiming): void {
  const view = c.view!;
  f.seq = (f.seq + 1) & 0xffff;
  f.buttons = 0;
  f.moveX = 0;
  f.moveY = 0;
  const e = c.ctrlToEntity[b.controller]!;
  if (e < 0) return;
  const fl = view.flags[e]!;
  if ((fl & F.dead) !== 0) {
    if (!b.wasDead) b.follower.clear();
    b.wasDead = true;
    b.target = -1;
    b.targetVisible = false;
    b.wantSlot = WEAPON_SLOT.primary;
    b.fireHeld = false;
    f.weapon = WEAPON_SLOT.primary;
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
    b.progressBest = Infinity;
    b.progressTick = tick;
    b.progressX = view.position[e * 3]!;
    b.progressZ = view.position[e * 3 + 2]!;
    b.maxHp = view.health[e]!;
    b.coverPhase = COVER_PHASE.none;
    b.grenadePhase = GRENADE_PHASE.none;
    b.holdAngleUntil = 0;
    b.flankUntil = 0;
    b.wasTargetVisible = false;
    b.follower.clear();
    personaSpawn(view, b, e, tick);
  }
  const hp = view.health[e]!;
  if (hp < b.lastHealth - 0.01) {
    b.alertUntil = tick + t.alert;
    // M2 (fase 3c): sabe de onde veio; o N1 talvez corra para a cobertura.
    onDamaged(c, b, e, t);
    personaOnDamaged(c, b, e, t);
  }
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
  personaTick(c, b, e, t);

  // M2 (fase 3e): o N3 avisa o time de onde está o inimigo que vê.
  if (c.board !== null && b.intelligence.callouts && b.targetVisible && b.target >= 0 && tick >= b.pingNextTick) {
    const t3 = b.target * 3;
    c.board.post(view.team[e]!, view.position[t3]!, view.position[t3 + 1]!, view.position[t3 + 2]!, tick);
    b.pingNextTick = tick + t.pingEvery;
  }
  // M2 (fase 3d): perdeu o alvo de vista agora (segura o ângulo, talvez flanqueie).
  if (b.wasTargetVisible && !b.targetVisible) onTargetLost(c, b, e, t);
  b.wasTargetVisible = b.targetVisible;
  let buttons: number;
  updateCover(view, b, e, tick, t);
  const closeFight = b.targetVisible && b.target >= 0 && targetDistance(view, e, b.target) < AI_COVER.fightBelowM;
  // M3 (fase 3a): no Bobo Zombies, o colega caído mais perto (sem zumbi colado: aí atira primeiro).
  b.reviveTarget =
    c.zombiesMode && (view.flags[e]! & F.downed) === 0 && !zombieClose(view, b, e) ? downedAlly(c, e) : -1;
  // M2 (fase 3g): fingir de morto e a dancinha tomam o tick inteiro.
  const override = b.reviveTarget >= 0 ? -1 : personaOverride(view, b, e, tick, t, local);
  if (b.reviveTarget >= 0) {
    buttons = reviveStep(c, b, e, t, local);
    b.progressTick = tick;
  } else if (override >= 0) {
    buttons = override;
    b.progressTick = tick;
  } else if (b.grenadePhase !== GRENADE_PHASE.none) {
    // M2 (fase 3d): jogando granada (parado).
    buttons = stepGrenade(c, b, e, t, local);
    b.progressTick = tick;
  } else if (b.coverPhase === COVER_PHASE.going && !closeFight) {
    // M2 (fase 3c): correndo para a cobertura (de perto, troca tiro).
    buttons = travel(c, b, e, t);
    b.progressTick = tick;
  } else if (b.target >= 0 && b.targetVisible) {
    buttons = combat(c, b, e, tick, t);
    // M3 (fase 3a): no Bobo Zombies, zumbi perto: recua atirando (o golpe dele é de perto) e sem correr.
    if (
      c.zombiesMode &&
      view.kind[b.target] === ENTITY_KIND.zombie &&
      targetDistance(view, e, b.target) < AI_SUPPORT.kiteM
    ) {
      local.y = -1;
      buttons &= ~BUTTON.sprint;
    }
    // Trocando tiro não é estar preso.
    b.progressTick = tick;
    if (b.coverPhase === COVER_PHASE.holding) {
      // Atira da cobertura: agachado, sem strafe.
      local.x = 0;
      local.y = 0;
      buttons |= BUTTON.crouch;
    } else if (
      b.intelligence.retreat &&
      b.coverPhase === COVER_PHASE.none &&
      tick >= b.coverCooldownUntil &&
      view.health[e]! < retreatBelow(b) * b.maxHp
    ) {
      // Vida baixa (N2): recua para longe e fora da vista até regenerar.
      const t3 = b.target * 3;
      b.threatX = view.position[t3]!;
      b.threatY = view.position[t3 + 1]!;
      b.threatZ = view.position[t3 + 2]!;
      // O Covarde (fase 3g) grita por ajuda ao fugir.
      if (seekCover(c, b, e, t, true)) personaFled(c, b, e);
    } else if (
      b.intelligence.learn &&
      b.coverPhase === COVER_PHASE.none &&
      tick >= b.fakeRetreatNextTick &&
      view.health[e]! > AI_TEAM.fakeRetreatHpFrac * b.maxHp
    ) {
      // N4 (fase 3f): às vezes finge recuar: vai para a cobertura sem precisar e embosca de lá.
      b.fakeRetreatNextTick = tick + t.fakeRetreatEvery;
      if (b.rng.chance(AI_TEAM.fakeRetreatChance)) {
        const t3 = b.target * 3;
        b.threatX = view.position[t3]!;
        b.threatY = view.position[t3 + 1]!;
        b.threatZ = view.position[t3 + 2]!;
        seekCover(c, b, e, t);
      }
    } else if (b.intelligence.useCover && clipOutWithReserve(view, e) && tick >= b.coverCooldownUntil) {
      // Pente vazio no meio do tiroteio: recarrega protegido (o N1 procura cobertura do alvo).
      const t3 = b.target * 3;
      b.threatX = view.position[t3]!;
      b.threatY = view.position[t3 + 1]!;
      b.threatZ = view.position[t3 + 2]!;
      seekCover(c, b, e, t);
    }
  } else if (b.coverPhase === COVER_PHASE.holding) {
    buttons = holdCover(view, b, e);
    b.progressTick = tick;
  } else if (tick < b.holdAngleUntil) {
    // M2 (fase 3d): segurando o ângulo de onde o alvo sumiu.
    buttons = holdAngle(view, b, e, local);
    b.progressTick = tick;
  } else {
    maybeStartGrenade(c, b, e, t);
    if (b.grenadePhase !== GRENADE_PHASE.none) buttons = stepGrenade(c, b, e, t, local);
    else {
      // M2 (fase 3g): parado por escolha (Camper no ponto, Suporte perto do humano).
      const held = personaHold(c, b, e, t, local);
      if (held >= 0) {
        buttons = held;
        b.progressTick = tick;
      } else buttons = travel(c, b, e, t);
    }
  }
  // Pulo precisa de borda (a sim só pula ao apertar): solta um tick entre dois pulos.
  if ((buttons & BUTTON.jump) !== 0) {
    if (b.jumpHeld) buttons &= ~BUTTON.jump;
    b.jumpHeld = !b.jumpHeld;
  } else {
    b.jumpHeld = false;
  }
  f.buttons = buttons;
  f.weapon = b.wantSlot;
  f.moveX = quantizeAxis(local.x);
  f.moveY = quantizeAxis(local.y);
  f.yaw = yawToU16(b.aimYaw);
  f.pitch = pitchToI16(b.aimPitch);
}
