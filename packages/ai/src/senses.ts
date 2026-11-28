import type { BotRules } from '@boboforces/format';
import { angleDelta, clamp, DEG_TO_RAD } from '@boboforces/shared';
import {
  chaosScaleOf,
  ENTITY_FLAG,
  ENTITY_KIND,
  viewAimPoint,
  viewEyeHeight,
  WEAPON_FIRE,
  weaponDef,
  type AimPoint,
  type SimView,
} from '@boboforces/sim';
import {
  BLOCK_FLAG,
  cellBlock,
  CELLS_PER_METER,
  COLLIDER_FLAG,
  createRayHit,
  raycastGrid,
  type BlockRegistry,
} from '@boboforces/world';
import { AI_FEEL, AI_SENSES } from './config.ts';
import type { AiContext } from './context.ts';
import type { SoldierBrain, SoldierTiming } from './soldier.ts';

/**
 * M12 (fase 7a): a percepção do soldado com cara de gente (ARCHITECTURE §23.7). O que o bot vê, ouve e sabe pelas
 * regras dele (`rules`: cone, alcance, audição e conhecimento), a proteção de spawn, o mato que esconde, a reação que
 * varia, voltar ao alvo que sumiu, revidar quem bate, o raio da bala (o vidro) e as pistas que espalham o grupo. A
 * mira (o erro que deriva, o atraso, as rajadas) fica em `aim-feel.ts`. Sem alocação: rascunhos fixos.
 */

const F = ENTITY_FLAG;
const rayHit = createRayHit();
const aimScratch: AimPoint = { x: 0, y: 0, z: 0 };

/** O cone de visão (cosseno do meio-cone) e o da borda dele (`AI_FEEL.edgeFrac`) para `visionDeg` graus. */
export function coneCos(visionDeg: number): number {
  return Math.cos((visionDeg / 2) * DEG_TO_RAD);
}

export function edgeCos(visionDeg: number): number {
  return Math.cos((visionDeg / 2) * AI_FEEL.edgeFrac * DEG_TO_RAD);
}

/**
 * Os sentidos do cérebro pelas regras do bot e pelo nível de inteligência: o cone e a borda dele, o alcance (fração do
 * da partida), os raios de audição (× `hearing`; o N0 ouve tiro só até 25 m e nenhum passo) e o conhecimento. Os
 * valores padrão (`DEFAULT_BOT_RULES`) dão exatamente a percepção de antes. Revisão: o alcance nunca passa do da
 * partida (o `visionRange` acima de 1, o "Olho de águia", fica em 1): o alcance da partida já é o do teto da plataforma
 * (regra 19 do PORTABILIDADE), e a visão do bot também respeita.
 */
export function applySenses(b: SoldierBrain, rules: BotRules, intelligence: number): void {
  b.viewConeCos = coneCos(rules.visionDeg);
  b.viewEdgeCos = edgeCos(rules.visionDeg);
  b.viewRangeMul = Math.min(1, rules.visionRange);
  const h = rules.hearing;
  b.hearingMul = h;
  const n0 = intelligence <= 0;
  b.hearShotM = (n0 ? AI_SENSES.hearShotN0M : AI_SENSES.hearShotM) * h;
  b.hearSprintM = n0 ? 0 : AI_SENSES.hearSprintM * h;
  b.hearWalkM = n0 ? 0 : AI_SENSES.hearWalkM * h;
  b.wallhack = rules.knowledge === 'wallhack';
  b.knowsArea = rules.knowledge === 'area';
}

/** O corpo `j` está com a proteção de spawn (a sim zera o dano nele; atirar tira a proteção). */
export function spawnProtected(view: SimView, j: number): boolean {
  return (view.flags[j]! & F.spawnProtected) !== 0;
}

/**
 * Linha de visão do olho até o corpo `t` pela regra do bot: com o conhecimento "vê através", sem raio (o invisível do
 * Caos continua invisível); senão o `canSee` de sempre (até 2 raios do orçamento do tick).
 */
export function seeBody(c: AiContext, b: SoldierBrain, ex: number, ey: number, ez: number, t: number): boolean {
  if (b.wallhack) return !c.unseen(ex, ez, t);
  return c.canSee(ex, ey, ez, t);
}

/**
 * Revisão: o mato alto são o capim alto e o arbusto, pelos ids de conteúdo (estáveis, regra 20); as flores (0,5 m)
 * não escondem. Os ids locais do registro do mapa, guardados por registro (refeitos só quando o mapa muda).
 */
const TALL_PLANTS = ['tall-grass', 'bush'] as const;
let plantRegistry: BlockRegistry | null = null;
let plantA = -1;
let plantB = -1;

function tallPlant(blocks: BlockRegistry, id: number): boolean {
  if (blocks !== plantRegistry) {
    plantRegistry = blocks;
    plantA = blocks.byKey(TALL_PLANTS[0])?.id ?? -1;
    plantB = blocks.byKey(TALL_PLANTS[1])?.id ?? -1;
  }
  return id === plantA || id === plantB;
}

/**
 * O corpo `j` está no mato alto (capim alto ou arbusto)? As plantas dos mapas têm uma célula (0,5 m) no chão: vale a
 * célula dos pés ou a de cima (o tronco de quem está agachado ou deitado no mato). 2 leituras da grade, nenhum raio.
 */
export function inPlant(view: SimView, j: number): boolean {
  const j3 = j * 3;
  const g = view.world;
  const blocks = view.blocks;
  const x = Math.floor(view.position[j3]! * CELLS_PER_METER);
  const z = Math.floor(view.position[j3 + 2]! * CELLS_PER_METER);
  const y = Math.floor((view.position[j3 + 1]! + 0.25) * CELLS_PER_METER);
  for (let k = 0; k < 2; k++) {
    const id = cellBlock(g.get(x, y + k, z));
    if (id !== 0 && tallPlant(blocks, id)) return true;
  }
  return false;
}

/**
 * O alcance em que o candidato NOVO `j` a `d` m é notado (GDD §4.4.1, "a vegetação alta corta pela metade"): no mato,
 * metade do alcance; agachado no mato, um quarto com teto de 12 m; perto (< 3 m) ou tendo atirado há pouco, o normal.
 */
export function noticeRange(
  view: SimView,
  j: number,
  d: number,
  range: number,
  tick: number,
  t: SoldierTiming,
): number {
  if (d < AI_FEEL.plantNearM || tick - view.lastShotTick[j]! <= t.plantShot || !inPlant(view, j)) return range;
  if ((view.flags[j]! & F.crouching) !== 0) return Math.min(range * AI_FEEL.plantCrouchMul, AI_FEEL.plantCrouchMaxM);
  return range * AI_FEEL.plantRangeMul;
}

/** O multiplicador da reação de uma aquisição: 1 + 0,15·N(0,1), preso em 0,7–1,5 (um sorteio do RNG do bot). */
export function reactionRoll(b: SoldierBrain): number {
  return clamp(1 + AI_FEEL.reactionJitter * b.rng.gaussian(), AI_FEEL.reactionMinMul, AI_FEEL.reactionMaxMul);
}

/**
 * O alvo `j` está na borda da vista do bot (fora do miolo `edgeFrac` do cone, contando quem chega por trás no alerta)?
 * Pelo yaw da mira, no plano.
 */
export function atViewEdge(view: SimView, b: SoldierBrain, ex: number, ez: number, j: number): boolean {
  const dx = view.position[j * 3]! - ex;
  const dz = view.position[j * 3 + 2]! - ez;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 0.01) return false;
  return (dx * -Math.sin(b.aimYaw) + dz * -Math.cos(b.aimYaw)) / d < b.viewEdgeCos;
}

/**
 * Adquire o alvo `t`: a reação (a do nível, ou `switchTicks` na troca por revide) × o sorteio de 0,7–1,5 × 1,4 na
 * borda da vista, a cabeça ou o tronco, e zera o que é do alvo anterior (a parte vista, o erro, a velocidade estimada,
 * o raio da bala, a rajada). `edge`: o alvo está na borda da vista (padrão: não). `errBoost` multiplica o erro inicial
 * (2 no revide).
 */
export function acquire(
  view: SimView,
  b: SoldierBrain,
  t: number,
  tick: number,
  edge = false,
  switchTicks = -1,
  errBoost = 1,
): void {
  b.target = t;
  b.targetGen = view.generation[t]!;
  const base = switchTicks >= 0 ? switchTicks : b.reactionTicks;
  b.reactionReadyTick = tick + Math.round(base * reactionRoll(b) * (edge ? AI_FEEL.edgeMul : 1));
  b.acquireStartTick = b.reactionReadyTick;
  // M6 (fase 4): com "só na cabeça" ligado (na receita ou pela Roleta), todo bot mira na cabeça.
  const prefersHead = b.rng.chance(b.skill.headPreference);
  b.aimHead = prefersHead || view.mods.headshotOnly;
  b.aimOffset.x = 0;
  b.aimOffset.y = 0;
  b.aimOffset.z = 0;
  b.aimOffsetPosture = -1;
  b.aimOffsetNextTick = 0;
  b.aimOffsetScale = 1;
  b.errNextTick = 0;
  b.errBoost = errBoost;
  b.estVx = 0;
  b.estVz = 0;
  b.targetSeenTick = tick;
  b.bulletBlocked = false;
  b.bulletCheckTick = 0;
  b.burstShots = 0;
  b.burstPauseUntil = 0;
}

/** Lembra onde o corpo `j` está (viu ou ouviu): a pista para onde o bot vai sem alvo à vista. */
export function remember(view: SimView, b: SoldierBrain, j: number, tick: number): void {
  b.lastSeenTick = tick;
  b.hasLastKnown = true;
  b.lastKnownX = view.position[j * 3]!;
  b.lastKnownY = view.position[j * 3 + 1]!;
  b.lastKnownZ = view.position[j * 3 + 2]!;
}

/**
 * O alvo atual voltou à vista depois de sumir por mais que `regainGapS`: a reação de novo, pela metade (um quarto se o
 * bot segurava o ângulo e o alvo reaparece a até 10° da mira). Nunca encurta uma reação que ainda corre.
 */
export function regain(
  view: SimView,
  b: SoldierBrain,
  ex: number,
  ey: number,
  ez: number,
  tick: number,
  t: SoldierTiming,
): void {
  if (tick - b.targetSeenTick <= t.regainGap) return;
  let frac: number = AI_FEEL.regainFrac;
  if (tick < b.holdAngleUntil) {
    const tg = b.target;
    viewAimPoint(view, tg, false, aimScratch);
    const dx = aimScratch.x - ex;
    const dy = aimScratch.y - ey;
    const dz = aimScratch.z - ez;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, Math.sqrt(dx * dx + dz * dz));
    const off = Math.max(Math.abs(angleDelta(b.aimYaw, yaw)), Math.abs(pitch - b.aimPitch));
    if (off <= AI_FEEL.regainHoldDeg * DEG_TO_RAD) frac = AI_FEEL.regainHoldFrac;
  }
  const ready = tick + Math.round(b.reactionTicks * frac);
  if (ready > b.reactionReadyTick) b.reactionReadyTick = ready;
}

/**
 * O ponto que o bot mira no alvo atual (o centro da cabeça ou do tronco mais o desvio da parte que ele vê, levado ao
 * mundo pelo yaw do alvo; o desvio vai na proporção se o alvo mudou de tamanho). Escreve em `out`.
 */
export function targetAimPoint(view: SimView, b: SoldierBrain, out: AimPoint): void {
  const tg = b.target;
  viewAimPoint(view, tg, b.aimHead, out);
  const off = b.aimOffset;
  const sizeNow = chaosScaleOf(view, tg);
  const resize = sizeNow === b.aimOffsetScale ? 1 : sizeNow / b.aimOffsetScale;
  const offX = off.x * resize;
  const offZ = off.z * resize;
  const ty = view.yaw[tg]!;
  const tc = Math.cos(ty);
  const ts = Math.sin(ty);
  out.x += tc * offX - ts * offZ;
  out.y += off.y * resize;
  out.z += -ts * offX - tc * offZ;
}

/**
 * O que o raio da bala achou (`bulletRay`): passa; bate em algo que não tapa a vista (o vidro: `blocksBullets` sem
 * `blocksSight`); bate em algo opaco (o muro baixo na frente do tronco); sem orçamento de raio (-1).
 */
export const BULLET = { clear: 1, glass: 0, opaque: 2, noBudget: -1 } as const;

/**
 * A bala passa do olho (ex, ey, ez) ao ponto (px, py, pz)? 1 raio DDA com a máscara de tiro, do orçamento do tick; no
 * impacto, as flags do bloco (ou da prop) atingido dizem se é vidro ou opaco (`BULLET`).
 */
export function bulletRay(
  c: AiContext,
  ex: number,
  ey: number,
  ez: number,
  px: number,
  py: number,
  pz: number,
): number {
  if (c.raysLeft <= 0) return BULLET.noBudget;
  const view = c.view!;
  const dx = px - ex;
  const dy = py - ey;
  const dz = pz - ez;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 1e-6) return BULLET.clear;
  c.raysLeft--;
  c.raysTotal++;
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
    BLOCK_FLAG.blocksBullets,
    rayHit,
    view.colliders,
  );
  if (!hit) return BULLET.clear;
  const opaque =
    rayHit.prop >= 0 && view.colliders !== null
      ? (view.colliders.flags[rayHit.prop]! & COLLIDER_FLAG.blocksSight) !== 0
      : (view.blocks.flags[cellBlock(rayHit.cell)]! & BLOCK_FLAG.blocksSight) !== 0;
  return opaque ? BULLET.opaque : BULLET.glass;
}

/** A bala do olho de `e` até o ponto mirado no alvo atual (a parte escolhida mais o desvio da parte vista). */
export function bulletClear(c: AiContext, b: SoldierBrain, e: number): number {
  const view = c.view!;
  const e3 = e * 3;
  targetAimPoint(view, b, aimScratch);
  return bulletRay(
    c,
    view.position[e3]!,
    view.position[e3 + 1]! + viewEyeHeight(view, e, view.flags[e]!),
    view.position[e3 + 2]!,
    aimScratch.x,
    aimScratch.y,
    aimScratch.z,
  );
}

/**
 * Confere a bala até o alvo visível na aquisição e a cada `visibleAimRefresh` (carona no ritmo da parte vista). Só o
 * que deixa ver e tapa a bala (o vidro) faz o bot contornar pela pista em vez de atirar (`b.bulletBlocked`). Revisão:
 * bateu em algo opaco (o muro baixo na frente do tronco, que a parte vista não conta), testa a cabeça (+1 raio) e, se
 * ela passa, mira nela; se nada passa, briga como antes. Com a faca na mão, nunca contorna.
 */
export function checkBullet(c: AiContext, b: SoldierBrain, e: number, t: SoldierTiming): void {
  if (b.target < 0 || !b.targetVisible || c.tick < b.bulletCheckTick) return;
  const view = c.view!;
  if (weaponDef(view.weapon[e]!)?.fire === WEAPON_FIRE.melee) {
    b.bulletBlocked = false;
    b.bulletCheckTick = c.tick + t.visibleAimRefresh;
    return;
  }
  let r = bulletClear(c, b, e);
  if (r === BULLET.noBudget) return;
  if (r === BULLET.opaque && !b.aimHead) {
    if (c.raysLeft <= 0) return;
    const e3 = e * 3;
    viewAimPoint(view, b.target, true, aimScratch);
    const head = bulletRay(
      c,
      view.position[e3]!,
      view.position[e3 + 1]! + viewEyeHeight(view, e, view.flags[e]!),
      view.position[e3 + 2]!,
      aimScratch.x,
      aimScratch.y,
      aimScratch.z,
    );
    if (head === BULLET.clear) {
      // Mira na cabeça a partir de agora (a parte vista dela é escolhida de novo no próximo tick de combate).
      b.aimHead = true;
      b.aimOffset.x = 0;
      b.aimOffset.y = 0;
      b.aimOffset.z = 0;
      b.aimOffsetPosture = -1;
      b.aimOffsetNextTick = 0;
      b.aimOffsetScale = 1;
    }
    r = head === BULLET.glass ? BULLET.glass : BULLET.clear;
  }
  b.bulletBlocked = r === BULLET.glass;
  b.bulletCheckTick = c.tick + t.visibleAimRefresh;
}

/**
 * Revidar quem bate (`skill.targetSwitchS`): com o alvo à vista, o dano veio de OUTRO inimigo, mais perto que o alvo;
 * com linha de visão até ele (até 2 raios, no máximo a cada `retaliateEveryS`), troca para ele com a reação de troca e
 * o erro inicial 2×. Devolve se trocou.
 */
export function retaliate(c: AiContext, b: SoldierBrain, e: number, a: number, t: SoldierTiming): boolean {
  const view = c.view!;
  const tick = c.tick;
  if (!b.targetVisible || b.target < 0 || a === b.target || tick < b.retaliateNextTick) return false;
  const e3 = e * 3;
  const ex = view.position[e3]!;
  const ez = view.position[e3 + 2]!;
  const ax = view.position[a * 3]! - ex;
  const az = view.position[a * 3 + 2]! - ez;
  const tx = view.position[b.target * 3]! - ex;
  const tz = view.position[b.target * 3 + 2]! - ez;
  if (ax * ax + az * az >= tx * tx + tz * tz) return false;
  b.retaliateNextTick = tick + t.retaliateEvery;
  const ey = view.position[e3 + 1]! + viewEyeHeight(view, e, view.flags[e]!);
  if (!seeBody(c, b, ex, ey, ez, a)) return false;
  acquire(view, b, a, tick, false, b.targetSwitchTicks, AI_FEEL.switchErrorMul);
  remember(view, b, a, tick);
  return true;
}

/**
 * Conhecimento "sabe a área" (regra do bot, gameplay.md §6.5): a cada `areaEveryS`, sem alvo à vista e sem pista
 * fresca, a pista vira o ponto do inimigo vivo mais perto com até ±15 m de erro (o bot vai para lá).
 */
export function areaKnowledge(c: AiContext, b: SoldierBrain, e: number, t: SoldierTiming): void {
  const tick = c.tick;
  if (!b.knowsArea || b.targetVisible || tick < b.areaNextTick) return;
  b.areaNextTick = tick + t.areaEvery;
  if (b.hasLastKnown && tick - b.lastSeenTick <= t.memory) return;
  const view = c.view!;
  const x = view.position[e * 3]!;
  const z = view.position[e * 3 + 2]!;
  let best = -1;
  let bestD2 = Infinity;
  for (let j = 0; j < view.count; j++) {
    if (!c.living(j) || !c.hostile(e, j)) continue;
    const dx = view.position[j * 3]! - x;
    const dz = view.position[j * 3 + 2]! - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = j;
    }
  }
  if (best < 0) return;
  const s = AI_FEEL.areaSpreadM;
  b.hasLastKnown = true;
  b.lastSeenTick = tick;
  b.lastKnownX = view.position[best * 3]! + b.rng.range(-s, s);
  b.lastKnownY = view.position[best * 3 + 1]!;
  b.lastKnownZ = view.position[best * 3 + 2]! + b.rng.range(-s, s);
}

/**
 * O passeio que vai ao tiroteio (N1+): o inimigo que atirou há até `gunfireRecentS` mais perto entre o raio de audição
 * de tiro do bot e `gunfireMaxM` × `hearing` (é o som, não wallhack), ou -1.
 */
export function gunfireShooter(
  c: AiContext,
  b: SoldierBrain,
  e: number,
  x: number,
  z: number,
  t: SoldierTiming,
): number {
  if (b.intelligence.level < 1 || b.hearShotM <= 0) return -1;
  const view = c.view!;
  const tick = c.tick;
  const min2 = b.hearShotM * b.hearShotM;
  const maxM = AI_FEEL.gunfireMaxM * b.hearingMul;
  let best = -1;
  let bestD2 = maxM * maxM;
  for (let j = 0; j < view.count; j++) {
    if (tick - view.lastShotTick[j]! > t.gunfireRecent || view.kind[j] !== ENTITY_KIND.bobo) continue;
    if (!c.living(j) || !c.hostile(e, j)) continue;
    const dx = view.position[j * 3]! - x;
    const dz = view.position[j * 3 + 2]! - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < min2 || d2 >= bestD2) continue;
    bestD2 = d2;
    best = j;
  }
  return best;
}

/**
 * Sem fila indiana: o desvio lateral do ponto da pista para este bot (perpendicular à linha bot → ponto; o lado e a
 * distância de 1,5 a 3 m pelo índice; no máximo metade da distância até o ponto). Escreve em `b.spreadX/Z` e guarda
 * o ponto para o qual foi feito (refeito quando a pista muda).
 */
export function spreadFor(b: SoldierBrain, x: number, z: number): void {
  b.spreadForX = b.lastKnownX;
  b.spreadForZ = b.lastKnownZ;
  const dx = b.lastKnownX - x;
  const dz = b.lastKnownZ - z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 1e-3) {
    b.spreadX = 0;
    b.spreadZ = 0;
    return;
  }
  const steps = 4;
  const k = (b.index >> 1) % steps;
  const mag = Math.min(AI_FEEL.spreadMinM + ((AI_FEEL.spreadMaxM - AI_FEEL.spreadMinM) * k) / (steps - 1), d * 0.5);
  const side = (b.index & 1) === 0 ? 1 : -1;
  b.spreadX = (-dz / d) * mag * side;
  b.spreadZ = (dx / d) * mag * side;
}
