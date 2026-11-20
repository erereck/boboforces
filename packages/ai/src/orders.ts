import type { BotPersonality } from '@boboforces/format';
import { ORDER } from '@boboforces/input';
import type { Rng } from '@boboforces/shared';
import { ENTITY_FLAG, eyeHeightFor, secondsToTicks, type SimView } from '@boboforces/sim';
import { BLOCK_FLAG, createRayHit, raycastGrid } from '@boboforces/world';
import { AI_ORDERS } from './config.ts';
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
}

export function createOrderAnswer(): OrderAnswer {
  return { tick: -1, order: 0, asked: 0, obeyed: 0, nowhere: false };
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
  const ey = y + eyeHeightFor(view.flags[e]!);
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
    const o3 = b.orderOwner * 3;
    const ox = view.position[o3]!;
    const oy = view.position[o3 + 1]!;
    const oz = view.position[o3 + 2]!;
    const dx = ox - x;
    const dz = oz - z;
    const far = order === ORDER.cover ? AI_ORDERS.coverFarM : AI_ORDERS.followFarM;
    const near = order === ORDER.cover ? AI_ORDERS.coverNearM : AI_ORDERS.followNearM;
    const d2 = dx * dx + dz * dz;
    // Colado (dentro do "perto" e no mesmo andar), fica; entre o perto e o longe, só segue se já estava indo (sem
    // tremer na borda).
    const sameFloor = Math.abs(oy - y) < AI_ORDERS.sameFloorM;
    if (sameFloor && (d2 <= near * near || (d2 <= far * far && !b.orderMoving))) {
      b.orderMoving = false;
      stay(out, x, y, z);
      return ORDER_GOAL.stay;
    }
    b.orderMoving = true;
    // Atrás de quem mandou (do lado contrário ao que ele olha), dentro do "perto" (chegando, já fica) e do lado de cá
    // do que estiver atrás dele (de costas para a parede, o ponto não cai na sala vizinha).
    const yaw = view.yaw[b.orderOwner]!;
    const bx = Math.sin(yaw);
    const bz = Math.cos(yaw);
    const back = near * 0.6;
    const hit = raycastGrid(
      view.world,
      view.blocks,
      ox,
      oy + 1,
      oz,
      bx,
      0,
      bz,
      back + 0.5,
      BLOCK_FLAG.solid,
      rayHit,
      view.colliders,
    );
    const t = hit ? Math.max(0, rayHit.distance - 0.5) : back;
    out.x = ox + bx * t;
    out.y = oy;
    out.z = oz + bz * t;
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
