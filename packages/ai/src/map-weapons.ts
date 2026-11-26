import { WEAPON_SLOT_COUNT } from '@boboforces/input';
import {
  isLivePhase,
  MAP_WEAPONS,
  pickupWeapon,
  WEAPON_CODE,
  WEAPON_NONE,
  WEAPON_SLOT,
  weaponDef,
  weaponMaskBit,
} from '@boboforces/sim';
import type { AiContext } from './context.ts';
import { ROYALE_ACT, royaleGoal, type RoyaleClaims } from './royale.ts';

/**
 * M11 (fase 4): a IA das armas no mapa (`weapons.pickups`). O bot que só tem a pistola (ou está quase sem munição da
 * primária) vai à arma do chão que mais vale por perto, pesando o perigo como o loot do Royale: a arma com um inimigo
 * mais perto dela que o bot fica para depois, e com inimigo perto à vista ele briga antes. O objetivo sai em
 * `royaleGoal` (a mesma ação do loot e da troca do Royale): o `soldier.ts` anda até lá pelo passo do Royale (passa por
 * cima, ou aperta o usar na troca). O ponto vazio não é arma (`pickupWeapon`): quem chega tarde escolhe outra ou volta
 * a lutar. Os números são escolhas minhas (revisáveis).
 */
export const AI_MAP_WEAPONS = {
  /** Até onde procura (m) e o peso da distância na nota (cai pela metade a cada `halfM`). */
  searchM: 40,
  halfM: 12,
  /** De pistola, com o inimigo à vista mais perto que isto (m), briga antes de buscar. */
  fightM: 12,
  /** Revisão: ferido agora há pouco, revida o inimigo à vista a até isto (m), como o `royaleEngage`. */
  hurtM: 40,
  /** Com um inimigo a menos disto (m) da arma e mais perto dela que o bot, a arma fica para depois. */
  contestM: 6,
  /** Quase sem munição: a primária com menos que isto (pente + reserva, em pentes) também busca. */
  lowAmmoClips: 1,
  /** Chegou na arma (m, dos pés): o passar por cima pega a até 1 m. */
  reachM: 0.8,
  /** Quanto tempo a arma que um colega já mira fica para ele (s). */
  claimS: 3,
} as const;

/** O valor de cada primária para o bot (minha: o fuzil e a SMG primeiro; as de longe e de explosão por último). */
function weaponValue(code: number): number {
  switch (code) {
    case WEAPON_NONE:
      return 0;
    case WEAPON_CODE.rifle:
      return 4;
    case WEAPON_CODE.smg:
      return 3.7;
    case WEAPON_CODE.lmg:
      return 3.6;
    case WEAPON_CODE.dmr:
      return 3.4;
    case WEAPON_CODE.autoShotgun:
      return 3.3;
    case WEAPON_CODE.shotgun:
      return 3.2;
    case WEAPON_CODE.rocket:
      return 3;
    case WEAPON_CODE.grenadeLauncher:
      return 2.8;
    case WEAPON_CODE.sniper:
      return 2.7;
    case WEAPON_CODE.crossbow:
      return 2.5;
    default:
      return 1;
  }
}

/** A primária de `e` está quase vazia (pente + reserva abaixo de `lowAmmoClips` pentes)? */
function lowAmmo(c: AiContext, e: number, primary: number): boolean {
  const view = c.view!;
  const def = weaponDef(primary);
  if (def === null || def.clipSize <= 0) return false;
  const k = e * WEAPON_SLOT_COUNT + WEAPON_SLOT.primary;
  return view.slotClip[k]! + view.slotReserve[k]! < def.clipSize * AI_MAP_WEAPONS.lowAmmoClips;
}

/** Quanto a arma `code` do chão vale para `e` agora (0 = nada): a primeira arma, a recarga da mesma ou a troca. */
function value(c: AiContext, e: number, code: number, primary: number, low: boolean): number {
  const mask = c.view!.weaponMask[e]!;
  if (mask !== 0 && (mask & weaponMaskBit(code)) === 0) return 0;
  if (primary === WEAPON_NONE) return 2 + weaponValue(code);
  if (!low) return 0;
  // Sem munição: a mesma arma enche (passando por cima); outra entra no usar.
  return code === primary ? 2 : 1 + Math.max(0, weaponValue(code) - weaponValue(primary)) * 0.5;
}

/** Um inimigo vivo está colado na arma `i` (a menos de `contestM` e mais perto dela que `e`, a `d2`)? */
function contested(c: AiContext, e: number, i: number, d2: number): boolean {
  const view = c.view!;
  const p = view.pickups;
  const lim = Math.min(d2, AI_MAP_WEAPONS.contestM * AI_MAP_WEAPONS.contestM);
  for (let o = 0; o < view.count; o++) {
    if (o === e || !c.living(o) || !c.hostile(e, o)) continue;
    const dx = p.position[i * 3]! - view.position[o * 3]!;
    const dz = p.position[i * 3 + 2]! - view.position[o * 3 + 2]!;
    if (dx * dx + dz * dz < lim) return true;
  }
  return false;
}

/**
 * O objetivo do bot `e` agora, em `royaleGoal` (`false` = nenhum: luta ou passeia como sempre). `enemy` é o inimigo à
 * vista (-1 = nenhum) a `enemyM` m; `keep` é a arma que ele já buscava (ganha um pouco, para não trocar à toa); `hurt`,
 * se ele levou dano agora há pouco (revisão: aí revida o inimigo à vista a até `hurtM`, em vez de seguir andando).
 * Revisão: vale também na morte súbita (`isLivePhase`: lá o renascer continua).
 */
export function mapWeaponObjective(
  c: AiContext,
  e: number,
  claims: RoyaleClaims,
  keep: number,
  enemy: number,
  enemyM: number,
  hurt = false,
): boolean {
  const view = c.view!;
  if (view.mapWeapons === null || !isLivePhase(view.match.phase)) return false;
  // O Jugg fica com a arma dele.
  if (c.juggernaut && view.team[e] === 1) return false;
  const k = e * WEAPON_SLOT_COUNT + WEAPON_SLOT.primary;
  const primary = view.loadout[k]!;
  const low = primary !== WEAPON_NONE && lowAmmo(c, e, primary);
  if (primary !== WEAPON_NONE && !low) return false;
  // Com a primária (mesmo no fim), com o inimigo perto ou levando tiro dele, briga antes.
  if (
    enemy >= 0 &&
    (primary !== WEAPON_NONE || enemyM < AI_MAP_WEAPONS.fightM || (hurt && enemyM < AI_MAP_WEAPONS.hurtM))
  )
    return false;
  const p = view.pickups;
  const x = view.position[e * 3]!;
  const z = view.position[e * 3 + 2]!;
  const r2 = AI_MAP_WEAPONS.searchM * AI_MAP_WEAPONS.searchM;
  const claimTicks = Math.round(AI_MAP_WEAPONS.claimS * c.hz);
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < p.count; i++) {
    if (p.alive[i] === 0) continue;
    const code = pickupWeapon(p.kind[i]!);
    if (code === WEAPON_NONE) continue;
    const dx = p.position[i * 3]! - x;
    const dz = p.position[i * 3 + 2]! - z;
    const d2 = dx * dx + dz * dz;
    if (d2 > r2) continue;
    // Quem mira a arma e está mais perto dela fica com ela (o colega de time, sempre).
    const other = claims.by[i]!;
    if (
      other >= 0 &&
      other !== e &&
      other < view.count &&
      c.tick - claims.tick[i]! < claimTicks &&
      claims.kind[i] === p.kind[i] &&
      (!c.hostile(e, other) || claims.dist2[i]! < d2)
    )
      continue;
    // Com o inimigo à vista mais perto da arma do que este bot, a arma fica para depois.
    if (enemy >= 0) {
      const ex = p.position[i * 3]! - view.position[enemy * 3]!;
      const ez = p.position[i * 3 + 2]! - view.position[enemy * 3 + 2]!;
      if (ex * ex + ez * ez < d2) continue;
    }
    if (contested(c, e, i, d2)) continue;
    const v = value(c, e, code, primary, low);
    if (v <= 0) continue;
    const score = v / (1 + Math.sqrt(d2) / AI_MAP_WEAPONS.halfM) + (i === keep ? 0.3 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0) return false;
  royaleGoal.item = best;
  royaleGoal.x = p.position[best * 3]!;
  royaleGoal.y = p.position[best * 3 + 1]!;
  royaleGoal.z = p.position[best * 3 + 2]!;
  // A arma diferente com a primária na mão se troca no usar (de perto); a primeira e a mesma entram passando por cima.
  const swap = primary !== WEAPON_NONE && pickupWeapon(p.kind[best]!) !== primary;
  royaleGoal.act = swap ? ROYALE_ACT.swap : ROYALE_ACT.loot;
  royaleGoal.reach = swap ? MAP_WEAPONS.swapReachM * 0.7 : AI_MAP_WEAPONS.reachM;
  return true;
}
