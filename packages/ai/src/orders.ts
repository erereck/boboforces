import type { BotPersonality } from '@boboforces/format';
import { ORDER } from '@boboforces/input';
import type { Rng } from '@boboforces/shared';
import { ENTITY_FLAG, entityIndex, secondsToTicks, viewEyeHeight, type SimView } from '@boboforces/sim';
import { BLOCK_FLAG, createRayHit, raycastGrid } from '@boboforces/world';
import { AI_ORDERS } from './config.ts';
import { AI_GROUP } from './config-group.ts';
import type { AiContext } from './context.ts';
import { turnYaw } from './group.ts';
import { seeBody, spawnProtected } from './senses.ts';
import type { SoldierBrain } from './soldier.ts';

/**
 * M8 (fase 6): as ordens aos bots aliados (gameplay.md §6.10; GDD §4.4.3). O humano manda pela roda (a ordem vai no
 * frame dele, `frameOrder`); o diretor dos bots lê na borda e passa aos aliados mais perto, que obedecem (ou não) por
 * aqui. Tudo nos ticks da sim e com o RNG das ordens (à parte do cérebro): determinístico, e o golden não muda sem
 * ordem.
 */

/** Um ponto no mundo (m). */
export interface OrderPoint {
  x: number;
  y: number;
  z: number;
}

/** A resposta da última ordem de um humano (o `game` mostra a quem mandou: "Vem comigo: 2 de 3 bots"). */
export interface OrderAnswer {
  /** Tick da ordem (-1 = nenhuma ainda). */
  tick: number;
  order: number;
  /** Quantos bots aliados ouviram e quantos obedeceram. */
  asked: number;
  obeyed: number;
  /** M8 (fase 6, revisão): o Ataca ali sem chão no ponto (mirando o céu ou o vazio): ninguém ouviu. */
  nowhere: boolean;
  /** M12 (fase 2, prints): dos que ouviram, quantos são de nível baixo demais para ordens (N0 e N1 sempre recusam). */
  lowLevel: number;
}

export function createOrderAnswer(): OrderAnswer {
  return { tick: -1, order: 0, asked: 0, obeyed: 0, nowhere: false, lowLevel: 0 };
}

/** A chance de obedecer a ordem: a lealdade, com os cortes do Covarde no Ataca ali e do Camper no Vem comigo. */
export function orderChance(p: BotPersonality, order: number): number {
  let mul = 1;
  if (p.preset === 'coward' && order === ORDER.attack) mul = AI_ORDERS.cowardAttackMul;
  else if (p.preset === 'camper' && order === ORDER.follow) mul = AI_ORDERS.camperFollowMul;
  return Math.max(0, Math.min(1, p.loyalty * mul));
}

/** Quanto tempo a ordem vale (ticks). */
export function orderTicks(order: number, hz: number): number {
  const s =
    order === ORDER.follow
      ? AI_ORDERS.followS
      : order === ORDER.hold
        ? AI_ORDERS.holdS
        : order === ORDER.attack
          ? AI_ORDERS.attackS
          : AI_ORDERS.coverS;
  return secondsToTicks(s, hz);
}

const rayHit = createRayHit();

/**
 * O ponto da ordem (em `out`): no Ataca ali, onde a mira de quem mandou bate (até `attackRangeM`, como o ping da
 * sim), um pouco antes do que tapou e no chão embaixo dele; no resto, onde ele está. `yaw`/`pitch` são os do quadro
 * da ordem (a mira da `SimView` é a do tick anterior). Devolve `false` sem ponto (o Ataca ali para o céu ou o vazio).
 */
export function orderPoint(
  view: SimView,
  e: number,
  order: number,
  yaw: number,
  pitch: number,
  out: OrderPoint,
): boolean {
  const e3 = e * 3;
  const x = view.position[e3]!;
  const y = view.position[e3 + 1]!;
  const z = view.position[e3 + 2]!;
  if (order !== ORDER.attack) {
    out.x = x;
    out.y = y;
    out.z = z;
    return true;
  }
  const ey = y + viewEyeHeight(view, e, view.flags[e]!);
  const dx = -Math.sin(yaw) * Math.cos(pitch);
  const dy = Math.sin(pitch);
  const dz = -Math.cos(yaw) * Math.cos(pitch);
  const range = AI_ORDERS.attackRangeM;
  const hit = raycastGrid(
    view.world,
    view.blocks,
    x,
    ey,
    z,
    dx,
    dy,
    dz,
    range,
    BLOCK_FLAG.blocksSight,
    rayHit,
    view.colliders,
  );
  if (!hit) return false;
  const t = Math.max(0, rayHit.distance - 0.5);
  out.x = x + dx * t;
  out.z = z + dz * t;
  // No chão embaixo do ponto (a parede alta não vira um ponto no ar).
  const py = ey + dy * t;
  const ground = raycastGrid(
    view.world,
    view.blocks,
    out.x,
    py,
    out.z,
    0,
    -1,
    0,
    AI_ORDERS.groundDropM,
    BLOCK_FLAG.solid,
    rayHit,
    view.colliders,
  );
  if (!ground) return false;
  out.y = py - rayHit.distance;
  return true;
}

/** O bot recebe a ordem (quem mandou, o ponto e até quando vale). */
export function takeOrder(
  b: SoldierBrain,
  order: number,
  owner: number,
  ownerGen: number,
  p: Readonly<OrderPoint>,
  untilTick: number,
): void {
  b.order = order;
  b.orderOwner = owner;
  b.orderOwnerGen = ownerGen;
  b.orderX = p.x;
  b.orderY = p.y;
  b.orderZ = p.z;
  b.orderUntil = untilTick;
  b.orderMoving = true;
  b.hasGoal = false;
  b.hasLastKnown = false;
  // Rota nova do zero (um "sem rota" do objetivo de antes não derruba a ordem).
  b.follower.clear();
}

/** Tira a ordem do bot. */
export function dropOrder(b: SoldierBrain): void {
  if (b.order === ORDER.none) return;
  b.order = ORDER.none;
  b.orderOwner = -1;
  b.follower.invalidate();
}

/** Quem mandou ainda existe (mesma geração) e não morreu (caído conta: o Me revive é para ele). */
export function orderOwnerAlive(view: SimView, b: SoldierBrain): boolean {
  const o = b.orderOwner;
  return (
    o >= 0 &&
    o < view.count &&
    view.alive[o] === 1 &&
    view.generation[o] === b.orderOwnerGen &&
    (view.flags[o]! & ENTITY_FLAG.dead) === 0
  );
}

/** M8 (fase 6): o que a ordem pede ao passeio do bot. */
export const ORDER_GOAL = { none: 0, go: 1, stay: 2 } as const;

/**
 * O objetivo de movimento da ordem (em `out`) para o passeio do bot: `ORDER_GOAL.go` (andar até `out`),
 * `ORDER_GOAL.stay` (perto o bastante: ficar) ou `ORDER_GOAL.none` sem ordem valendo (a vencida, a de quem morreu
 * e o Ataca ali que chegou caem aqui).
 */
export function orderGoal(
  view: SimView,
  b: SoldierBrain,
  tick: number,
  x: number,
  y: number,
  z: number,
  out: OrderPoint,
): number {
  const order = b.order;
  if (order === ORDER.none) return ORDER_GOAL.none;
  if (tick >= b.orderUntil) {
    dropOrder(b);
    return ORDER_GOAL.none;
  }
  if (order === ORDER.follow || order === ORDER.cover) {
    if (!orderOwnerAlive(view, b)) {
      dropOrder(b);
      return ORDER_GOAL.none;
    }
    // M12 (fase 7b): a vaga atrás de quem mandou (`group.ts`: pelo rumo de movimento dele e pela ordem do bot entre os
    // que o seguem), calculada no `personaTick` deste tick. Era um ponto só para todos, atrás do YAW: quem olhava
    // para trás punha o ponto na frente dele.
    const g = b.group;
    if (g.tick !== tick || g.leader !== b.orderOwner) {
      // Sem a vaga deste tick (quem chama não passou pelo `personaTick`): vai até quem mandou.
      const o3 = b.orderOwner * 3;
      out.x = view.position[o3]!;
      out.y = view.position[o3 + 1]!;
      out.z = view.position[o3 + 2]!;
      return ORDER_GOAL.go;
    }
    b.orderMoving = g.moving;
    if (!g.moving) {
      // Parado na vaga: olha para fora (o yaw de quem mandou + o setor da vaga), não para as costas dele. O `orderHold`
      // (da 7a) avisa o `travel` para não girar a mira de novo neste tick (o `personaTick` desliga a cada tick).
      b.aimYaw = turnYaw(b.aimYaw, g.watchYaw, b.turnStep);
      b.orderHold = true;
      stay(out, x, y, z);
      return ORDER_GOAL.stay;
    }
    out.x = g.slotX;
    out.y = g.slotY;
    out.z = g.slotZ;
    return ORDER_GOAL.go;
  }
  const dx = b.orderX - x;
  const dz = b.orderZ - z;
  const d2 = dx * dx + dz * dz;
  if (order === ORDER.attack && d2 <= AI_ORDERS.attackReachM * AI_ORDERS.attackReachM) {
    dropOrder(b);
    return ORDER_GOAL.none;
  }
  if (order === ORDER.hold && d2 <= AI_ORDERS.holdM * AI_ORDERS.holdM) {
    stay(out, x, y, z);
    return ORDER_GOAL.stay;
  }
  out.x = b.orderX;
  out.y = b.orderY;
  out.z = b.orderZ;
  return ORDER_GOAL.go;
}

function stay(out: OrderPoint, x: number, y: number, z: number): void {
  out.x = x;
  out.y = y;
  out.z = z;
}

/** `j` (vivo, da geração do handle guardado) feriu o bobo `victim` nos últimos `recent` ticks? */
function hurtRecently(c: AiContext, victim: number, j: number, recent: number): boolean {
  const n = AI_GROUP.coverAttackers;
  const gen = c.view!.generation[j]!;
  for (let k = victim * n; k < victim * n + n; k++) {
    if (c.tick - c.hurtTick[k]! > recent) continue;
    const a = c.hurtBy[k]!;
    if (entityIndex(a) === j && a >>> 16 === gen) return true;
  }
  return false;
}

/**
 * O inimigo `j` vale para o Me cobre: vivo, inimigo, sem a proteção de spawn, no alcance de visão do bot e no cone
 * dele (ou o bot alerta), ou fora do cone a até a audição de tiro dele (`hearShotM`, das regras do bot: a 7a); devolve
 * a distância² no plano, ou -1.
 */
function coverCandidate(c: AiContext, b: SoldierBrain, e: number, j: number, ex: number, ez: number): number {
  const view = c.view!;
  if (j === e || !c.living(j) || !c.hostile(e, j) || spawnProtected(view, j)) return -1;
  const dx = view.position[j * 3]! - ex;
  const dz = view.position[j * 3 + 2]! - ez;
  const d2 = dx * dx + dz * dz;
  const range = c.viewDistance * b.viewRangeMul;
  if (d2 >= range * range) return -1;
  if (c.tick < b.alertUntil || d2 <= b.hearShotM * b.hearShotM) return d2;
  const d = Math.sqrt(d2);
  return d < 0.01 || (dx * -Math.sin(b.aimYaw) + dz * -Math.cos(b.aimYaw)) / d >= b.viewConeCos ? d2 : -1;
}

/**
 * M12 (fase 7b): no Me cobre, o alvo vem primeiro dos inimigos que feriram quem mandou nos últimos
 * `AI_GROUP.coverAttackerS` (o `AiContext` guarda os últimos de cada bobo): o mais perto que o bot vê agora (no
 * alcance e com a linha de visão do orçamento; fora do cone só até `hearShotM`: o guarda-costas ouve os tiros em quem
 * ele cobre e vira para o atirador). Revisão: com histerese: o alvo atual fica enquanto é um desses atacantes (ou
 * alguém que feriu o próprio bot) e está à vista; outro atacante só toma o lugar estando a menos de
 * `coverSwitchFrac` da distância dele (cada troca zera a reação e o erro da mira). Sem nenhum à vista, -1: a
 * percepção de sempre escolhe entre todos (os outros inimigos não somem). Antes o Me cobre só colava e levantava quem
 * mandou.
 */
export function coverThreat(c: AiContext, b: SoldierBrain, e: number, ex: number, ey: number, ez: number): number {
  if (b.order !== ORDER.cover || c.tick >= b.orderUntil) return -1;
  const view = c.view!;
  if (!orderOwnerAlive(view, b)) return -1;
  const recent = secondsToTicks(AI_GROUP.coverAttackerS, c.hz);
  const owner = b.orderOwner;
  let best = -1;
  let bestD2 = Infinity;
  // O alvo atual, se ainda é um atacante (de quem mandou ou do próprio bot) e está à vista.
  const cur = b.target;
  if (cur >= 0 && cur < view.count && view.generation[cur] === b.targetGen) {
    const d2 = coverCandidate(c, b, e, cur, ex, ez);
    if (
      d2 >= 0 &&
      (hurtRecently(c, owner, cur, recent) || hurtRecently(c, e, cur, recent)) &&
      seeBody(c, b, ex, ey, ez, cur)
    ) {
      best = cur;
      bestD2 = d2 * AI_GROUP.coverSwitchFrac * AI_GROUP.coverSwitchFrac;
    }
  }
  const n = AI_GROUP.coverAttackers;
  for (let k = owner * n; k < owner * n + n; k++) {
    if (c.tick - c.hurtTick[k]! > recent) continue;
    const a = c.hurtBy[k]!;
    const j = entityIndex(a);
    if (j === best || j >= view.count || view.generation[j] !== a >>> 16) continue;
    const d2 = coverCandidate(c, b, e, j, ex, ez);
    if (d2 < 0 || d2 >= bestD2) continue;
    if (!seeBody(c, b, ex, ey, ez, j)) continue;
    best = j;
    bestD2 = d2;
  }
  return best;
}

/**
 * A obediência (N0 e N1 ignoram; do N2 para cima, pela lealdade). O bot que já cumpre a mesma ordem do mesmo humano
 * renova sem sortear; o que recusou não sorteia de novo a mesma ordem do mesmo humano por `refuseS` (reenviar não
 * vence a lealdade).
 */
export function obeys(
  rng: Rng,
  b: SoldierBrain,
  order: number,
  owner: number,
  ownerGen: number,
  tick: number,
  hz: number,
): boolean {
  if (b.intelligence.level < AI_ORDERS.minIntelligence) return false;
  if (b.order === order && b.orderOwner === owner && b.orderOwnerGen === ownerGen) return true;
  if (b.refusedOrder === order && b.refusedOwner === owner && b.refusedOwnerGen === ownerGen && tick < b.refusedUntil) {
    return false;
  }
  if (rng.next() < orderChance(b.personality, order)) return true;
  b.refusedOrder = order;
  b.refusedOwner = owner;
  b.refusedOwnerGen = ownerGen;
  b.refusedUntil = tick + secondsToTicks(AI_ORDERS.refuseS, hz);
  return false;
}
