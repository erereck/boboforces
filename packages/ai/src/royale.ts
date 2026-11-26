import { WEAPON_SLOT_COUNT } from '@boboforces/input';
import {
  CIRCLE,
  ENTITY_FLAG,
  MAX_PICKUPS,
  PICKUP_KIND,
  pickupWeapon,
  ROYALE,
  WEAPON_CODE,
  WEAPON_NONE,
  WEAPON_SLOT,
  weaponBase,
  weaponDef,
  weaponRarity,
  ZONE,
  type SimView,
} from '@boboforces/sim';
import type { AiContext } from './context.ts';

const F = ENTITY_FLAG;

/**
 * M7 (fase 7): a IA do Bobo Royale (gameplay.md "Bobo Royale": lootear, ir para a zona, se curar e entrar na luta
 * alheia). Aqui ficam as decisões do modo; o `soldier.ts` só pergunta o objetivo (o ponto e a ação) e o passeio. Os
 * números marcados "minha" são escolhas minhas (revisáveis).
 */
export const ROYALE_ACT = { none: 0, loot: 1, swap: 2, zone: 3, heal: 4, hold: 5 } as const;

export const AI_ROYALE = {
  /** Até onde procura item no chão (m) e o peso da distância na nota (a nota cai pela metade a cada `lootHalfM`). */
  lootRadiusM: 45,
  lootHalfM: 14,
  /** Chegou no item (m, dos pés): o que pega sozinho entra passando por cima; a arma da troca, no usar. */
  lootReachM: 0.8,
  /** A folga dentro do círculo (m) e quanto antes do encolher ele já vai para o círculo novo (s). */
  zoneMarginM: 5,
  zoneHurryS: 20,
  /** M11 (fase 5): no Royale Grande (o Arquipélago tem 380 m), vai para o círculo novo mais cedo (minha). */
  zoneHurryGrandeS: 40,
  /** Cura abaixo disto da vida máxima, sem inimigo à vista a menos de `healSafeM` (m). */
  healBelow: 0.65,
  healSafeM: 35,
  /** Um item que um colega de esquadrão já mira fica para ele por este tempo (s). */
  claimS: 3,
  /** Item com um bobo de outro esquadrão a menos disto (m) e mais perto dele fica para depois (espalha o loot). */
  contestM: 6,
  /**
   * Briga só com quem está perto (m), e cada vez mais longe conforme a zona fecha: na 1ª espera, só de muito perto
   * (o começo é do loot); depois, só de pistola, de perto; com a primária, a meia distância. Ferido, revida a até
   * `hurtM`. Longe disso, o loot e a zona vêm antes (minha).
   */
  engageFirstM: 5,
  engagePistolM: 8,
  engageM: 30,
  engageLateM: 45,
  hurtM: 40,
} as const;

/**
 * O bobo `e` vai atrás de onde viu ou ouviu o inimigo (a 3ª parte da luta alheia)? Só armado e com a zona já
 * fechando: no começo, o loot vem antes.
 */
export function royaleChase(view: SimView, e: number): boolean {
  const rv = view.royale;
  if (rv === null) return true;
  if (rv.data[ZONE.stage] === 0 && rv.data[ZONE.shrinking] === 0) return false;
  return view.loadout[e * WEAPON_SLOT_COUNT + WEAPON_SLOT.primary] !== WEAPON_NONE;
}

/** O bobo `e` briga com o alvo a `distM` m (ou foi ferido agora há pouco: `hurt`)? */
export function royaleEngage(view: SimView, e: number, distM: number, hurt: boolean): boolean {
  if (hurt && distM < AI_ROYALE.hurtM) return true;
  const rv = view.royale;
  const stage = rv !== null ? rv.data[ZONE.stage]! : 0;
  const shrinking = rv !== null && rv.data[ZONE.shrinking] === 1;
  if (stage === 0 && !shrinking) return distM < AI_ROYALE.engageFirstM;
  const armed = view.loadout[e * WEAPON_SLOT_COUNT + WEAPON_SLOT.primary] !== WEAPON_NONE;
  if (!armed) return distM < AI_ROYALE.engagePistolM;
  return distM < (stage >= 2 ? AI_ROYALE.engageLateM : AI_ROYALE.engageM);
}

/** O valor de cada arma para o bot (minha: o fuzil e a SMG primeiro; a sniper por último, de perto ela atrapalha). */
function weaponValue(code: number): number {
  if (code === WEAPON_NONE) return 0;
  const base = weaponBase(code);
  const v =
    base === WEAPON_CODE.rifle
      ? 4
      : base === WEAPON_CODE.smg
        ? 3.6
        : base === WEAPON_CODE.shotgun
          ? 3.2
          : base === WEAPON_CODE.sniper
            ? 2.6
            : 1;
  return v + weaponRarity(code) * 0.7;
}

/** Quanto o item `kind` vale para o bobo `e` agora (0 = nada). */
export function itemValue(view: SimView, e: number, kind: number, maxHp: number): number {
  const k = e * WEAPON_SLOT_COUNT;
  const primary = view.loadout[k + WEAPON_SLOT.primary]!;
  const code = pickupWeapon(kind);
  if (code !== WEAPON_NONE) {
    const gain = weaponValue(code) - weaponValue(primary);
    if (primary === WEAPON_NONE) return 2 + weaponValue(code);
    return gain > 0.4 ? gain : 0;
  }
  if (kind === PICKUP_KIND.armor50 || kind === PICKUP_KIND.armor100) {
    const value = kind === PICKUP_KIND.armor100 ? 100 : 50;
    return value > view.armor[e]! ? (value - view.armor[e]!) / 25 : 0;
  }
  if (kind === PICKUP_KIND.heal) {
    const heals = view.heals[e]!;
    if (heals >= ROYALE.healMax) return 0;
    return (view.health[e]! < maxHp ? 2 : 1) * ((ROYALE.healMax - heals) / ROYALE.healMax);
  }
  if (kind === PICKUP_KIND.ammoBox) {
    const def = weaponDef(primary);
    if (def !== null && view.slotReserve[k + WEAPON_SLOT.primary]! < def.clipSize) return 1.5;
    return view.slotClip[k + WEAPON_SLOT.throwable]! === 0 ? 0.3 : 0;
  }
  return 0;
}

/** Saída de `royaleObjective` (rascunho do módulo): a ação, o ponto, a distância que basta e o item. */
export const royaleGoal = { act: 0, x: 0, y: 0, z: 0, reach: 0, item: -1 };

/**
 * Quem mira cada item (o bobo, o tick e a distância² dele ao item): ninguém corre atrás do item que outro bobo, mais
 * perto, já mira (do esquadrão ou não: a briga pelo mesmo item no começo acabava a partida em 1 min).
 */
export class RoyaleClaims {
  readonly by = new Int32Array(MAX_PICKUPS).fill(-1);
  readonly tick = new Int32Array(MAX_PICKUPS).fill(-1_000_000);
  readonly dist2 = new Float64Array(MAX_PICKUPS);
  /** O tipo do item quando foi mirado (o slot de um item que sumiu é reaproveitado: o claim velho não vale). */
  readonly kind = new Int32Array(MAX_PICKUPS).fill(-1);
}

/** O bobo `e` adotou o item `i` como objetivo (marca para os outros não correrem atrás). */
export function royaleClaim(c: AiContext, claims: RoyaleClaims, e: number, i: number): void {
  const view = c.view!;
  const p = view.pickups;
  const dx = p.position[i * 3]! - view.position[e * 3]!;
  const dz = p.position[i * 3 + 2]! - view.position[e * 3 + 2]!;
  claims.by[i] = e;
  claims.tick[i] = c.tick;
  claims.dist2[i] = dx * dx + dz * dz;
  claims.kind[i] = p.kind[i]!;
}

/** O ponto (x, z) está dentro do círculo (cx, cz, r) com folga `margin`? */
function insidePoint(x: number, z: number, cx: number, cz: number, r: number, margin: number): boolean {
  const dx = x - cx;
  const dz = z - cz;
  const lim = Math.max(0, r - margin);
  return dx * dx + dz * dz <= lim * lim;
}

/** O bobo `e` está dentro do círculo (cx, cz, r) com folga `margin`? */
function inside(view: SimView, e: number, cx: number, cz: number, r: number, margin: number): boolean {
  return insidePoint(view.position[e * 3]!, view.position[e * 3 + 2]!, cx, cz, r, margin);
}

/** O ponto do mapa (um ponto de loot: está na navegação) dentro do círculo (cx, cz, r) mais perto do bobo `e`. */
function zoneSpot(view: SimView, e: number, cx: number, cz: number, r: number): boolean {
  const loot = view.royale!.loot;
  const x = view.position[e * 3]!;
  const z = view.position[e * 3 + 2]!;
  const lim = Math.max(0, r - AI_ROYALE.zoneMarginM);
  let best = -1;
  let bestD = Infinity;
  let center = -1;
  let centerD = Infinity;
  for (let i = 0; i < loot.length; i++) {
    const s = loot[i]!;
    const ox = s.x - cx;
    const oz = s.z - cz;
    const fromCenter = ox * ox + oz * oz;
    if (fromCenter < centerD) {
      centerD = fromCenter;
      center = i;
    }
    if (fromCenter > lim * lim) continue;
    const dx = s.x - x;
    const dz = s.z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const pick = best >= 0 ? best : center;
  if (pick < 0) return false;
  const s = loot[pick]!;
  royaleGoal.x = s.x;
  royaleGoal.y = s.y;
  royaleGoal.z = s.z;
  royaleGoal.reach = Math.max(1.5, Math.min(6, lim * 0.5));
  return true;
}

/** Tem uma arma do chão ao alcance da troca (o usar dele trocaria em vez de curar). */
function weaponNear(view: SimView, e: number): boolean {
  const p = view.pickups;
  const reach = ROYALE.swapReachM + 0.4;
  for (let i = 0; i < p.count; i++) {
    if (p.alive[i] === 0 || pickupWeapon(p.kind[i]!) === WEAPON_NONE) continue;
    const dx = p.position[i * 3]! - view.position[e * 3]!;
    const dz = p.position[i * 3 + 2]! - view.position[e * 3 + 2]!;
    if (dx * dx + dz * dz <= reach * reach) return true;
  }
  return false;
}

/** Um bobo de outro esquadrão está colado no item `i` (a menos de `contestM` e mais perto que `e`, a `d2`)? */
function contested(c: AiContext, e: number, i: number, d2: number): boolean {
  const view = c.view!;
  const p = view.pickups;
  const lim = Math.min(d2, AI_ROYALE.contestM * AI_ROYALE.contestM);
  for (let o = 0; o < view.count; o++) {
    if (o === e || view.team[o] === view.team[e] || !c.living(o)) continue;
    const dx = p.position[i * 3]! - view.position[o * 3]!;
    const dz = p.position[i * 3 + 2]! - view.position[o * 3 + 2]!;
    if (dx * dx + dz * dz < lim) return true;
  }
  return false;
}

/** O melhor item ao alcance da procura (índice do pickup; -1 = nenhum), pela nota valor × perto. */
function bestItem(
  c: AiContext,
  e: number,
  claims: RoyaleClaims,
  keep: number,
  maxHp: number,
  enemy: number,
  hurry: boolean,
): number {
  const view = c.view!;
  const p = view.pickups;
  const circle = view.royale!.circle;
  const x = view.position[e * 3]!;
  const z = view.position[e * 3 + 2]!;
  const r2 = AI_ROYALE.lootRadiusM * AI_ROYALE.lootRadiusM;
  const claimTicks = Math.round(AI_ROYALE.claimS * c.hz);
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < p.count; i++) {
    if (p.alive[i] === 0) continue;
    const dx = p.position[i * 3]! - x;
    const dz = p.position[i * 3 + 2]! - z;
    const d2 = dx * dx + dz * dz;
    if (d2 > r2) continue;
    // Só o item dentro do círculo de agora (e, com pressa, do próximo): senão o bot oscila entre o loot e a zona.
    const ix = p.position[i * 3]!;
    const iz = p.position[i * 3 + 2]!;
    if (!insidePoint(ix, iz, circle[CIRCLE.cx]!, circle[CIRCLE.cz]!, circle[CIRCLE.r]!, 2)) continue;
    if (
      hurry &&
      !insidePoint(ix, iz, circle[CIRCLE.toCx]!, circle[CIRCLE.toCz]!, circle[CIRCLE.toR]!, AI_ROYALE.zoneMarginM)
    )
      continue;
    // Quem mira o item e está mais perto dele fica com ele (o colega de esquadrão, sempre).
    const other = claims.by[i]!;
    if (
      other >= 0 &&
      other !== e &&
      c.tick - claims.tick[i]! < claimTicks &&
      claims.kind[i] === p.kind[i] &&
      other < view.count &&
      (view.team[other] === view.team[e] || claims.dist2[i]! < d2)
    )
      continue;
    // Com o inimigo à vista mais perto do item do que este bobo, o item fica para depois.
    if (enemy >= 0) {
      const ex = p.position[i * 3]! - view.position[enemy * 3]!;
      const ez = p.position[i * 3 + 2]! - view.position[enemy * 3 + 2]!;
      if (ex * ex + ez * ez < d2) continue;
    }
    // M11 (fase 5): o valor (barato) antes da disputa (que olha todos os bobos): o mesmo resultado, mais barato com 48.
    const value = itemValue(view, e, p.kind[i]!, maxHp);
    if (value <= 0) continue;
    if (contested(c, e, i, d2)) continue;
    const score = value / (1 + Math.sqrt(d2) / AI_ROYALE.lootHalfM) + (i === keep ? 0.3 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/**
 * O objetivo do bobo `e` agora, em `royaleGoal` (`false` = nenhum: passeia). Na ordem: fora da zona (ou com ela para
 * encolher), vai para dentro do círculo; machucado e sem inimigo perto, cura; senão, o item que mais vale por perto
 * (a arma melhor, o colete, o kit, a munição).
 */
export function royaleObjective(
  c: AiContext,
  e: number,
  claims: RoyaleClaims,
  keepItem: number,
  enemyNearM: number,
  maxHp: number,
  enemy: number,
  lootBlocked: boolean,
): boolean {
  const view = c.view!;
  const rv = view.royale;
  if (rv === null || view.match.phase !== 'playing' || (view.flags[e]! & F.downed) !== 0) return false;
  royaleGoal.item = -1;
  const circle = rv.circle;
  const d = rv.data;
  // A zona: fora do círculo de agora, ou fora do próximo com ele já encolhendo (ou perto de encolher).
  const outsideNow = !inside(view, e, circle[CIRCLE.cx]!, circle[CIRCLE.cz]!, circle[CIRCLE.r]!, 1);
  const hurryS = c.royaleGrande ? AI_ROYALE.zoneHurryGrandeS : AI_ROYALE.zoneHurryS;
  const hurry = d[ZONE.shrinking] === 1 || d[ZONE.ticks]! < hurryS * c.hz;
  const outsideNext = !inside(
    view,
    e,
    circle[CIRCLE.toCx]!,
    circle[CIRCLE.toCz]!,
    circle[CIRCLE.toR]!,
    AI_ROYALE.zoneMarginM,
  );
  let holdHere = false;
  if (outsideNow || (hurry && outsideNext)) {
    if (zoneSpot(view, e, circle[CIRCLE.toCx]!, circle[CIRCLE.toCz]!, circle[CIRCLE.toR]!)) {
      const gx = royaleGoal.x - view.position[e * 3]!;
      const gz = royaleGoal.z - view.position[e * 3 + 2]!;
      const there = gx * gx + gz * gz <= royaleGoal.reach * royaleGoal.reach;
      // Já no ponto e dentro do círculo de agora, não há onde ir (o último círculo tem raio 0): fica (curando, se
      // precisar; senão parado, que o passeio voltaria ao mesmo ponto e o Destravar renasceria o bot fora da zona).
      if (!(there && !outsideNow)) {
        royaleGoal.act = ROYALE_ACT.zone;
        return true;
      }
      holdHere = true;
    }
  }
  // A cura: machucado, com kit, sem inimigo perto à vista e sem arma no pé (o usar trocaria).
  if (
    view.heals[e]! > 0 &&
    view.health[e]! < AI_ROYALE.healBelow * maxHp &&
    enemyNearM > AI_ROYALE.healSafeM &&
    !weaponNear(view, e)
  ) {
    royaleGoal.act = ROYALE_ACT.heal;
    royaleGoal.x = view.position[e * 3]!;
    royaleGoal.y = view.position[e * 3 + 1]!;
    royaleGoal.z = view.position[e * 3 + 2]!;
    royaleGoal.reach = 2;
    return true;
  }
  // O loot.
  if (holdHere) {
    royaleGoal.act = ROYALE_ACT.hold;
    royaleGoal.x = view.position[e * 3]!;
    royaleGoal.y = view.position[e * 3 + 1]!;
    royaleGoal.z = view.position[e * 3 + 2]!;
    royaleGoal.reach = 2;
    return true;
  }
  if (lootBlocked) return false;
  const i = bestItem(c, e, claims, keepItem, maxHp, enemy, hurry);
  if (i < 0) return false;
  const p = view.pickups;
  royaleGoal.item = i;
  royaleGoal.x = p.position[i * 3]!;
  royaleGoal.y = p.position[i * 3 + 1]!;
  royaleGoal.z = p.position[i * 3 + 2]!;
  // A arma com a primária ocupada se troca no usar (de perto); o resto entra passando por cima.
  const swap =
    pickupWeapon(p.kind[i]!) !== WEAPON_NONE &&
    view.loadout[e * WEAPON_SLOT_COUNT + WEAPON_SLOT.primary] !== WEAPON_NONE;
  royaleGoal.act = swap ? ROYALE_ACT.swap : ROYALE_ACT.loot;
  royaleGoal.reach = swap ? ROYALE.swapReachM * 0.7 : AI_ROYALE.lootReachM;
  return true;
}

/** O passeio do Royale: um ponto de loot dentro do próximo círculo (o bot fica na zona e passa pelo loot). */
export function royaleWander(c: AiContext, e: number, pick: number, out: Float64Array): boolean {
  const view = c.view!;
  const rv = view.royale;
  if (rv === null || rv.loot.length === 0) return false;
  const circle = rv.circle;
  const cx = circle[CIRCLE.toCx]!;
  const cz = circle[CIRCLE.toCz]!;
  const lim = Math.max(0, circle[CIRCLE.toR]! - AI_ROYALE.zoneMarginM);
  let n = 0;
  for (const s of rv.loot) {
    const dx = s.x - cx;
    const dz = s.z - cz;
    if (dx * dx + dz * dz <= lim * lim) n++;
  }
  if (n === 0) return zoneSpot(view, e, cx, cz, circle[CIRCLE.toR]!) && copyGoal(out);
  let k = pick % n;
  for (const s of rv.loot) {
    const dx = s.x - cx;
    const dz = s.z - cz;
    if (dx * dx + dz * dz > lim * lim) continue;
    if (k-- === 0) {
      out[0] = s.x;
      out[1] = s.y;
      out[2] = s.z;
      out[3] = 3;
      return true;
    }
  }
  return false;
}

function copyGoal(out: Float64Array): boolean {
  out[0] = royaleGoal.x;
  out[1] = royaleGoal.y;
  out[2] = royaleGoal.z;
  out[3] = 3;
  return true;
}

/** A arma do chão que a sim trocaria agora pelo usar de `e` (a mais perto ao alcance da troca; -1 = nenhuma). */
export function weaponForSwap(view: SimView, e: number): number {
  const p = view.pickups;
  let best = -1;
  let bestD = ROYALE.swapReachM * ROYALE.swapReachM;
  for (let i = 0; i < p.count; i++) {
    if (p.alive[i] === 0 || pickupWeapon(p.kind[i]!) === WEAPON_NONE) continue;
    const dx = p.position[i * 3]! - view.position[e * 3]!;
    const dy = p.position[i * 3 + 1]! - view.position[e * 3 + 1]!;
    const dz = p.position[i * 3 + 2]! - view.position[e * 3 + 2]!;
    const d = dx * dx + dz * dz;
    if (d <= bestD && dy > -0.6 && dy < 1.8) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
