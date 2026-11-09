import { PERSONALITY_PRESETS } from '@boboforces/format';
import { BUTTON, WEAPON_SLOT_COUNT } from '@boboforces/input';
import { angleDelta, clamp, DEG_TO_RAD, HALF_PI, wrapAngle } from '@boboforces/shared';
import {
  ENTITY_FLAG,
  ENTITY_KIND,
  entityIndex,
  heldClip,
  MAX_HUMANS,
  NULL_ENTITY,
  WEAPON_SLOT,
  weaponDef,
  type SimView,
} from '@boboforces/sim';
import { CELLS_PER_METER } from '@boboforces/world';
import { AI_PERSONA, AI_TEAM, type AiWeaponUse } from './config.ts';
import type { AiContext } from './context.ts';
import type { SoldierBrain, SoldierTiming } from './soldier.ts';

/**
 * M2 (fase 3g): o comportamento visível das 10 personalidades (gameplay.md §6.4). Os pesos (agressividade, cautela,
 * paciência) já mexem nas chances do N1 e do N2 (cobertura, ângulo, flanco, recuo); aqui fica o que se VÊ:
 * - **Rusher:** corre até o contato, chega a 6 m, atira andando e pula muito;
 * - **Lunático:** troca de intenção a cada 2–5 s (avança pulando, roda pulando, recua, atira pro alto), com uma
 *   distância sorteada a cada troca;
 * - **Covarde:** foge com a vida abaixo de 60% (com o recuo do N2) e manda um aviso de ajuda ao time; mantém
 *   distância; às vezes finge de morto (agachado, parado, olhando o chão) até tomar dano de novo;
 * - **Camper:** escolhe um ponto alto e espera agachado, olhando em volta; muda depois de 2 abates, ao tomar dano (foi
 *   descoberto) ou no fim do tempo;
 * - **Estrategista** (N2+): flanqueia mais e anda com o time (dupla sem precisar do N3);
 * - **Kamikaze:** persegue o humano mais perto, nunca recua e cola no alvo; com granada, se explode (segura o gatilho
 *   até ela estourar na mão);
 * - **Caçador:** escolhe o humano com mais abates e o persegue pelo mapa, preferindo ele a qualquer outro alvo;
 * - **Suporte:** segue o humano aliado, vigia as costas dele e vai atrás de quem atirou nele;
 * - **Palhaço:** dancinha depois do abate (gira, agacha e pula) e pulinhos andando;
 * - **Equilibrado:** o padrão.
 * A distância preferida é relativa à do Equilibrado (a de cada arma) e só encurta. A perseguição
 * do Kamikaze e do Caçador sabe onde a presa está, com erro (é o comportamento declarado no card). A personalidade só
 * se expressa dentro da inteligência (§6.1): o recuo do Covarde precisa do N2, e o Estrategista também.
 * Sem alocação: rascunhos fixos.
 */

const F = ENTITY_FLAG;

/** Fases do Camper (`SoldierBrain.campPhase`). */
export const CAMP_PHASE = { none: 0, going: 1, holding: 2 } as const;

/** Intenções do Lunático (`SoldierBrain.lunaticIntent`). */
export const LUNATIC_INTENT = { charge: 0, circle: 1, back: 2, sky: 3 } as const;

const BALANCED_RANGE_M = PERSONALITY_PRESETS.balanced.preferredRangeM;
const SKY_PITCH = AI_PERSONA.lunaticSkyDeg * DEG_TO_RAD;
const CAMP_ARRIVE_M = 1;
const nodePos = new Float64Array(3);
const cellPos = new Float64Array(2);

/** Renasceu: zera o estado desta vida. */
export function personaSpawn(view: SimView, b: SoldierBrain, e: number, tick: number): void {
  b.lastKills = view.kills[e]!;
  b.playDeadUntil = 0;
  b.playedDead = false;
  b.campPhase = CAMP_PHASE.none;
  b.campNextTry = tick;
  b.danceUntil = 0;
  b.lunaticUntil = 0;
  b.pursuitNextTick = 0;
  b.kamikazeArmed = false;
  b.kamikazeCooking = false;
}

/** O foco da personalidade (presa do Caçador e do Kamikaze, humano do Suporte) ainda vale? */
export function focusValid(c: AiContext, b: SoldierBrain): boolean {
  const f = b.focus;
  return f >= 0 && c.living(f) && c.view!.generation[f] === b.focusGen;
}

/** Uma vez por tick (vivo), antes das decisões: abates novos (dancinha, troca de ponto), foco e guarda do Suporte. */
export function personaTick(c: AiContext, b: SoldierBrain, e: number, t: SoldierTiming): void {
  const view = c.view!;
  const tick = c.tick;
  const preset = b.personality.preset;
  const kills = view.kills[e]!;
  if (kills > b.lastKills) {
    if (preset === 'clown') b.danceUntil = tick + t.dance;
    if (b.campPhase === CAMP_PHASE.holding) {
      b.campKillCount += kills - b.lastKills;
      if (b.campKillCount >= AI_PERSONA.campKills) leaveCamp(b, tick, t);
    }
  }
  b.lastKills = kills;
  if (preset !== 'hunter' && preset !== 'kamikaze' && preset !== 'support') return;
  if (tick >= b.focusNextTick || (b.focus >= 0 && !focusValid(c, b))) {
    b.focusNextTick = tick + t.quarryEvery;
    pickFocus(c, b, e, preset === 'support', preset === 'hunter');
    b.guardHp = b.focus >= 0 ? view.health[b.focus]! : 0;
  }
  if (preset === 'support') guardHuman(c, b, e, tick);
}

/**
 * Escolhe o foco: o humano aliado mais perto (Suporte) ou o inimigo da perseguição (humanos primeiro; o Caçador
 * prefere quem tem mais abates, o Kamikaze o mais perto).
 */
function pickFocus(c: AiContext, b: SoldierBrain, e: number, ally: boolean, mostKills: boolean): void {
  const view = c.view!;
  const x = view.position[e * 3]!;
  const z = view.position[e * 3 + 2]!;
  let best = -1;
  let bestHuman = false;
  let bestKills = -1;
  let bestD2 = Infinity;
  for (let j = 0; j < view.count; j++) {
    if (j === e || !c.living(j) || view.kind[j] !== ENTITY_KIND.bobo || c.hostile(e, j) === ally) continue;
    const ctrl = view.controller[j]!;
    const human = ctrl >= 0 && ctrl < MAX_HUMANS;
    if (ally && !human) continue;
    const dx = view.position[j * 3]! - x;
    const dz = view.position[j * 3 + 2]! - z;
    const d2 = dx * dx + dz * dz;
    const k = view.kills[j]!;
    const better =
      best < 0 || (human !== bestHuman ? human : mostKills && k !== bestKills ? k > bestKills : d2 < bestD2);
    if (!better) continue;
    best = j;
    bestHuman = human;
    bestKills = k;
    bestD2 = d2;
  }
  b.focus = best;
  b.focusGen = best >= 0 ? view.generation[best]! : 0;
}

/** Suporte: o humano seguido tomou dano: vai atrás de quem atirou nele (se não estiver vendo outro alvo). */
function guardHuman(c: AiContext, b: SoldierBrain, e: number, tick: number): void {
  if (!focusValid(c, b)) return;
  const view = c.view!;
  const h = b.focus;
  const hp = view.health[h]!;
  if (hp < b.guardHp - 0.01 && !b.targetVisible) {
    const a = view.lastAttacker[h]!;
    if (a !== NULL_ENTITY) {
      const i = entityIndex(a);
      if (c.living(i) && c.hostile(e, i) && view.generation[i] === a >>> 16) {
        b.hasLastKnown = true;
        b.lastSeenTick = tick;
        b.lastKnownX = view.position[i * 3]!;
        b.lastKnownY = view.position[i * 3 + 1]!;
        b.lastKnownZ = view.position[i * 3 + 2]!;
      }
    }
  }
  b.guardHp = hp;
}

/** Tomou dano: para a dancinha, sai do ponto (o Camper foi descoberto), acorda de "morto" ou começa a fingir. */
export function personaOnDamaged(c: AiContext, b: SoldierBrain, e: number, t: SoldierTiming): void {
  const tick = c.tick;
  b.danceUntil = 0;
  if (b.campPhase !== CAMP_PHASE.none) leaveCamp(b, tick, t);
  if (tick < b.playDeadUntil) {
    b.playDeadUntil = 0;
    return;
  }
  if (
    b.personality.preset === 'coward' &&
    !b.playedDead &&
    c.view!.health[e]! < AI_PERSONA.playDeadBelowHp * b.maxHp &&
    b.rng.chance(AI_PERSONA.playDeadChance)
  ) {
    b.playedDead = true;
    b.playDeadUntil = tick + t.playDead;
  }
}

/** O Covarde começou a fugir: grita por ajuda (um aviso do time na posição dele). */
export function personaFled(c: AiContext, b: SoldierBrain, e: number): void {
  if (b.personality.preset !== 'coward' || c.board === null) return;
  const view = c.view!;
  const e3 = e * 3;
  c.board.post(view.team[e]!, view.position[e3]!, view.position[e3 + 1]!, view.position[e3 + 2]!, c.tick);
}

/**
 * Comportamentos que tomam o tick inteiro, antes de tudo: fingir de morto (Covarde) e a dancinha (Palhaço). Devolve
 * os botões, ou -1 se nenhum vale agora; o movimento vai em `local`.
 */
export function personaOverride(
  view: SimView,
  b: SoldierBrain,
  e: number,
  tick: number,
  t: SoldierTiming,
  local: { x: number; y: number },
): number {
  if (b.personality.preset === 'dummy') {
    // M2 (fase 5d): o Alvo não ataca nem procura ninguém: o paciente fica parado; o outro anda de lado, indo e voltando.
    local.y = 0;
    local.x = b.personality.patience >= 0.5 ? 0 : Math.floor(tick / t.dummyStride) % 2 === 0 ? 1 : -1;
    b.fireHeld = false;
    return 0;
  }
  if (tick < b.playDeadUntil) {
    local.x = 0;
    local.y = 0;
    b.fireHeld = false;
    b.aimPitch = stepTo(b.aimPitch, -HALF_PI * 0.9, b.turnStep);
    return BUTTON.crouch;
  }
  if (tick < b.danceUntil) {
    local.x = 0;
    local.y = 0;
    b.fireHeld = false;
    b.aimYaw = wrapAngle(b.aimYaw + t.danceSpinStep);
    b.aimPitch = stepTo(b.aimPitch, 0, b.turnStep);
    const left = b.danceUntil - tick;
    if (Math.floor(left / t.danceCrouch) % 2 === 0) return BUTTON.crouch;
    return left % t.danceJump === 0 && (view.flags[e]! & F.onGround) !== 0 ? BUTTON.jump : 0;
  }
  return -1;
}

/**
 * Até onde o bot chega do alvo (m). A distância preferida (§6.4) é relativa à do Equilibrado (20 m), que usa a de
 * cada arma (fase 1d), e só encurta: o Rusher (6 m) chega a 30% dela, o Caçador (15 m) a 75%; quem prefere mais longe
 * (Camper, Covarde, Estrategista) fica na da arma, porque segurar o alvo longe esfria o combate (média de 8 sementes
 * do golden: 13,6 abates por minuto alongando, 14,8 só encurtando, 15,4 sem personalidade). O Camper no ponto não sai
 * dele.
 */
export function personaApproach(b: SoldierBrain, use: AiWeaponUse): number {
  const p = b.personality;
  if (p.preset === 'camper' && b.campPhase === CAMP_PHASE.holding) return Infinity;
  const pref = p.preferredRangeM < 0 ? b.lunaticRange : p.preferredRangeM;
  return Math.max(use.retreatM, use.approachM * Math.min(1, pref / BALANCED_RANGE_M));
}

/** Abaixo de quanto (m) o bot recua do alvo: o da arma; o Covarde mantém metade da distância preferida dele. */
export function personaRetreat(b: SoldierBrain, use: AiWeaponUse): number {
  const p = b.personality;
  if (p.preset === 'camper' && b.campPhase === CAMP_PHASE.holding) return 0;
  return p.preset === 'coward' ? Math.max(use.retreatM, p.preferredRangeM * AI_PERSONA.cowardKeepFrac) : use.retreatM;
}

/** Depois do combate do soldado: o jeito da personalidade de trocar tiro (correr, pular, rodar, segurar o ponto). */
export function personaCombat(
  c: AiContext,
  b: SoldierBrain,
  e: number,
  t: SoldierTiming,
  buttons: number,
  dist: number,
  approach: number,
  local: { x: number; y: number },
): number {
  const view = c.view!;
  const tick = c.tick;
  const onGround = (view.flags[e]! & F.onGround) !== 0;
  switch (b.personality.preset) {
    case 'rusher':
    case 'kamikaze':
      if (dist > approach + AI_PERSONA.sprintGapM) {
        // Corre até o contato (correndo não atira).
        buttons = (buttons & ~(BUTTON.fire | BUTTON.ads)) | BUTTON.sprint;
        local.x = 0;
        local.y = 1;
        b.fireHeld = false;
      } else if (b.personality.preset === 'rusher' && onGround && tick >= b.personaJumpTick) {
        buttons |= BUTTON.jump;
        b.personaJumpTick = tick + b.rng.int(t.rusherJumpMin, t.rusherJumpMax + 1);
      }
      if (b.personality.preset === 'kamikaze') buttons = kamikazeBoom(view, b, e, dist, buttons, local);
      return buttons;
    case 'lunatic':
      return lunaticStep(view, b, e, tick, t, buttons, local, true);
    case 'camper':
      if (b.campPhase === CAMP_PHASE.holding) {
        local.x = 0;
        local.y = 0;
        buttons |= BUTTON.crouch;
      }
      return buttons;
    default:
      return buttons;
  }
}

/** Kamikaze com granada: colado no alvo, troca para ela e segura o gatilho até ela estourar na mão. */
function kamikazeBoom(
  view: SimView,
  b: SoldierBrain,
  e: number,
  dist: number,
  buttons: number,
  local: { x: number; y: number },
): number {
  if (!b.kamikazeArmed) {
    const k = e * WEAPON_SLOT_COUNT + WEAPON_SLOT.throwable;
    if (dist > AI_PERSONA.kamikazeBoomM || weaponDef(view.loadout[k]!) === null || view.slotClip[k] === 0) {
      return buttons;
    }
    b.kamikazeArmed = true;
  }
  b.wantSlot = WEAPON_SLOT.throwable;
  local.y = 1;
  buttons &= ~(BUTTON.ads | BUTTON.sprint | BUTTON.fire);
  if (view.slot[e] !== WEAPON_SLOT.throwable) {
    // Ainda trocando de arma.
    b.fireHeld = false;
    return buttons;
  }
  // Na mão: a sim só começa a cozinhar na borda do gatilho; depois segura até estourar.
  if (!b.kamikazeCooking && b.fireHeld) {
    b.fireHeld = false;
    return buttons;
  }
  b.kamikazeCooking = true;
  b.fireHeld = true;
  return buttons | BUTTON.fire;
}

/** Lunático: troca de intenção a cada 2–5 s e faz a dela (em combate e andando). */
function lunaticStep(
  view: SimView,
  b: SoldierBrain,
  e: number,
  tick: number,
  t: SoldierTiming,
  buttons: number,
  local: { x: number; y: number },
  fighting: boolean,
): number {
  if (tick >= b.lunaticUntil) {
    b.lunaticIntent = b.rng.int(0, 4);
    b.lunaticStart = tick;
    b.lunaticUntil = tick + b.rng.int(t.lunaticIntentMin, t.lunaticIntentMax + 1);
    b.lunaticRange = b.rng.range(AI_PERSONA.lunaticRangeMinM, AI_PERSONA.lunaticRangeMaxM);
  }
  const since = tick - b.lunaticStart;
  const hop = (view.flags[e]! & F.onGround) !== 0 && since % t.lunaticJump === 0;
  switch (b.lunaticIntent) {
    case LUNATIC_INTENT.charge:
      if (fighting) local.y = 1;
      if (hop) buttons |= BUTTON.jump;
      break;
    case LUNATIC_INTENT.circle:
      if (fighting) local.x = b.strafeDir;
      if (hop) buttons |= BUTTON.jump;
      break;
    case LUNATIC_INTENT.back:
      if (fighting) local.y = -1;
      break;
    case LUNATIC_INTENT.sky:
      if (since < t.lunaticSky) {
        // Atira pro alto (a mira volta ao alvo depois); semiautomática precisa da borda do gatilho.
        b.aimPitch = stepTo(b.aimPitch, SKY_PITCH, b.turnStep * 3);
        buttons &= ~(BUTTON.sprint | BUTTON.ads | BUTTON.fire);
        b.fireHeld = !b.fireHeld;
        if (b.fireHeld) buttons |= BUTTON.fire;
      }
      break;
  }
  return buttons;
}

/** Andando sem alvo à vista: pulinhos de bobeira e as intenções do Lunático. */
export function personaTravel(
  view: SimView,
  b: SoldierBrain,
  e: number,
  tick: number,
  t: SoldierTiming,
  buttons: number,
  local: { x: number; y: number },
): number {
  if (tick >= b.hopNextTick) {
    b.hopNextTick = tick + t.hop;
    if ((view.flags[e]! & F.onGround) !== 0 && b.rng.chance(b.personality.silliness * AI_PERSONA.hopWeight)) {
      buttons |= BUTTON.jump;
    }
  }
  if (b.personality.preset === 'lunatic') buttons = lunaticStep(view, b, e, tick, t, buttons, local, false);
  return buttons;
}

/**
 * Objetivo de passeio da personalidade (sem pista do inimigo): o ponto do Camper, a presa do Caçador e do Kamikaze,
 * o humano do Suporte. Escreve em `b.goalX/Y/Z` e devolve `true`; `false` = o passeio de sempre.
 */
export function personaGoal(
  c: AiContext,
  b: SoldierBrain,
  e: number,
  t: SoldierTiming,
  x: number,
  y: number,
  z: number,
): boolean {
  const preset = b.personality.preset;
  if (preset === 'camper') return campGoal(c, b, e, t, x, y, z);
  if (preset !== 'hunter' && preset !== 'kamikaze' && preset !== 'support') return false;
  if (!focusValid(c, b)) return false;
  const view = c.view!;
  const tick = c.tick;
  const f3 = b.focus * 3;
  const fx = view.position[f3]!;
  const fz = view.position[f3 + 2]!;
  if (b.follower.failed) {
    b.follower.clear();
    b.pursuitNextTick = 0;
  }
  if (preset === 'support') {
    const dx = fx - x;
    const dz = fz - z;
    if (dx * dx + dz * dz <= AI_PERSONA.supportFarM * AI_PERSONA.supportFarM) return false;
    if (tick >= b.pursuitNextTick || !b.hasGoal) {
      // Atrás do humano (do lado contrário ao que ele olha).
      b.pursuitNextTick = tick + t.supportEvery;
      const yaw = view.yaw[b.focus]!;
      b.goalX = fx + Math.sin(yaw) * AI_PERSONA.supportNearM;
      b.goalY = view.position[f3 + 1]!;
      b.goalZ = fz + Math.cos(yaw) * AI_PERSONA.supportNearM;
      b.hasGoal = true;
    }
    b.goalUntil = tick + t.wander;
    return true;
  }
  if (tick >= b.pursuitNextTick || !b.hasGoal) {
    b.pursuitNextTick = tick + t.pursuitEvery;
    b.goalX = fx + b.rng.range(-AI_PERSONA.pursuitNoiseM, AI_PERSONA.pursuitNoiseM);
    b.goalY = view.position[f3 + 1]!;
    b.goalZ = fz + b.rng.range(-AI_PERSONA.pursuitNoiseM, AI_PERSONA.pursuitNoiseM);
    b.hasGoal = true;
  }
  b.goalUntil = tick + t.wander;
  return true;
}

/** Camper: escolhe o ponto, vai até ele e passa a segurar (o `personaHold` cuida de lá). */
function campGoal(
  c: AiContext,
  b: SoldierBrain,
  e: number,
  t: SoldierTiming,
  x: number,
  y: number,
  z: number,
): boolean {
  const tick = c.tick;
  if (b.campPhase === CAMP_PHASE.none) {
    if (tick < b.campNextTry) return false;
    if (!pickCampSpot(c, b, e, x, y, z)) {
      b.campNextTry = tick + t.campRetry;
      return false;
    }
    b.campPhase = CAMP_PHASE.going;
    b.campUntil = tick + t.wander;
    b.follower.clear();
  }
  if (b.campPhase !== CAMP_PHASE.going) return false;
  const dx = b.campX - x;
  const dz = b.campZ - z;
  if (dx * dx + dz * dz <= CAMP_ARRIVE_M * CAMP_ARRIVE_M) {
    b.campPhase = CAMP_PHASE.holding;
    b.campUntil = tick + t.campHold + Math.round(b.personality.patience * t.campHoldExtra);
    b.campKillCount = 0;
    b.campLook = campLookYaw(c, e, x, z);
  } else if (tick >= b.campUntil || b.follower.failed) {
    leaveCamp(b, tick, t);
    return false;
  }
  b.goalX = b.campX;
  b.goalY = b.campY;
  b.goalZ = b.campZ;
  b.hasGoal = true;
  b.goalUntil = tick + t.wander;
  return true;
}

/** Ponto do Camper: o mais alto (altura = visão) entre nós sorteados a 8–50 m, alcançáveis e na área jogável. */
function pickCampSpot(c: AiContext, b: SoldierBrain, e: number, x: number, y: number, z: number): boolean {
  const view = c.view!;
  const nav = view.nav;
  if (nav === null || nav.nodeCount === 0) return false;
  const from = nav.nearestNode(x, y, z);
  const area = view.playArea;
  const board = c.board;
  let found = false;
  let bestScore = -Infinity;
  for (let k = 0; k < AI_PERSONA.campSamples; k++) {
    const n = b.rng.int(0, nav.nodeCount);
    if (from >= 0 && nav.component[n] !== nav.component[from]) continue;
    nav.nodePosition(n, nodePos, 0);
    const d = Math.hypot(nodePos[0]! - x, nodePos[2]! - z);
    if (d < AI_PERSONA.campMinM || d > AI_PERSONA.campMaxM) continue;
    if (
      area &&
      (nodePos[0]! < area.minX || nodePos[0]! > area.maxX || nodePos[2]! < area.minZ || nodePos[2]! > area.maxZ)
    ) {
      continue;
    }
    let score = nodePos[1]! + b.rng.range(0, 1);
    if (board !== null && b.intelligence.learn) score -= board.dangerAt(view.team[e]!, nodePos[0]!, nodePos[2]!);
    if (score <= bestScore) continue;
    bestScore = score;
    b.campX = nodePos[0]!;
    b.campY = nodePos[1]!;
    b.campZ = nodePos[2]!;
    found = true;
  }
  return found;
}

/** Para onde o Camper olha do ponto: a célula mais quente dos humanos, senão o meio da área jogável. */
function campLookYaw(c: AiContext, e: number, x: number, z: number): number {
  const view = c.view!;
  const board = c.board;
  if (board !== null) {
    const cell = board.hottest(view.team[e]!, x, z, AI_TEAM.heatCellM, Infinity, AI_TEAM.minHeat);
    if (cell >= 0) {
      board.cellCenter(cell, cellPos);
      return Math.atan2(-(cellPos[0]! - x), -(cellPos[1]! - z));
    }
  }
  const area = view.playArea;
  const cx = area ? (area.minX + area.maxX) / 2 : view.world.sizeX / CELLS_PER_METER / 2;
  const cz = area ? (area.minZ + area.maxZ) / 2 : view.world.sizeZ / CELLS_PER_METER / 2;
  return Math.atan2(-(cx - x), -(cz - z));
}

function leaveCamp(b: SoldierBrain, tick: number, t: SoldierTiming): void {
  b.campPhase = CAMP_PHASE.none;
  b.campNextTry = tick + t.campRetry;
}

/**
 * Parado por escolha, sem alvo à vista: o Camper no ponto (agachado, olhando em volta devagar, virando para o que
 * ouviu) e o Suporte perto do humano (vigiando as costas dele). Devolve os botões, ou -1 para andar.
 */
export function personaHold(
  c: AiContext,
  b: SoldierBrain,
  e: number,
  t: SoldierTiming,
  local: { x: number; y: number },
): number {
  const view = c.view!;
  const tick = c.tick;
  const e3 = e * 3;
  const x = view.position[e3]!;
  const z = view.position[e3 + 2]!;
  let look: number;
  let buttons = 0;
  const preset = b.personality.preset;
  if (preset === 'camper' && b.campPhase === CAMP_PHASE.holding) {
    if (tick >= b.campUntil) {
      leaveCamp(b, tick, t);
      return -1;
    }
    look =
      b.hasLastKnown && tick - b.lastSeenTick < t.chase
        ? Math.atan2(-(b.lastKnownX - x), -(b.lastKnownZ - z))
        : b.campLook + Math.sin((tick / t.hz) * 1.3) * AI_PERSONA.campScanDeg * DEG_TO_RAD;
    buttons = BUTTON.crouch;
  } else if (preset === 'support' && !b.hasLastKnown && focusValid(c, b)) {
    const f3 = b.focus * 3;
    const dx = view.position[f3]! - x;
    const dz = view.position[f3 + 2]! - z;
    if (dx * dx + dz * dz > AI_PERSONA.supportFarM * AI_PERSONA.supportFarM) return -1;
    // Vigia as costas do humano, varrendo devagar.
    look = view.yaw[b.focus]! + Math.PI + Math.sin((tick / t.hz) * 0.9) * HALF_PI * 0.6;
  } else {
    return -1;
  }
  b.aimYaw = turnTo(b.aimYaw, wrapAngle(look), b.turnStep);
  b.aimPitch = stepTo(b.aimPitch, 0, b.turnStep);
  local.x = 0;
  local.y = 0;
  const def = weaponDef(view.weapon[e]!);
  if (def && def.clipSize > 0 && heldClip(view, e) < def.clipSize) buttons |= BUTTON.reload;
  return buttons;
}

function turnTo(current: number, goal: number, step: number): number {
  const d = angleDelta(current, goal);
  return wrapAngle(current + (d > step ? step : d < -step ? -step : d));
}

function stepTo(current: number, goal: number, step: number): number {
  return current + clamp(goal - current, -step, step);
}
