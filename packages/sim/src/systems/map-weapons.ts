import { recipeWeaponPickups, type MatchRecipe } from '@boboforces/format';
import { BUTTON, WEAPON_SLOT_COUNT } from '@boboforces/input';
import { MAP_WEAPONS, MATCH_DEFAULTS } from '../config/rules.ts';
import {
  ARSENAL,
  isPrimaryWeapon,
  WEAPON_CODE,
  WEAPON_SLOT,
  weaponCodeOf,
  weaponDef,
  weaponMaskBit,
} from '../config/weapons.ts';
import { secondsToTicks } from '../constants.ts';
import { WEAPON_NONE, type SimContext } from '../context.ts';
import { ENTITY_FLAG, ENTITY_KIND, NULL_ENTITY } from '../entity.ts';
import { isLivePhase, PICKUP_KIND, spotWeapon } from '../view.ts';
import { pickupWeapon, ROYALE_AMMO_BASE } from './royale.ts';

const F = ENTITY_FLAG;

/**
 * M11 (fase 4): as armas no mapa (`weapons.pickups`, GDD §4.3.2 e §4.4, estilo arena). Todo mundo nasce sem a
 * primária (pistola, faca e granadas); as armas ficam nos `weaponSpots` do mapa, cada uma num pickup da sim que vive a
 * partida toda:
 * - com a arma, o tipo é o da arma do Royale (`PICKUP_KIND.weaponBase` + código; o render, a IA e a dica da troca já
 *   sabem desenhar e medir) e o `ticksLeft` não conta (`ROYALE_AMMO_BASE`: nunca pisca);
 * - pega, o mesmo pickup vira o ponto vazio (`PICKUP_KIND.spotBase` + código) com o `ticksLeft` até a volta (20 s).
 * Assim o estado inteiro mora no pool de pickups, que já vai no snapshot, no hash e na rede (sem versão nova).
 * Pegar: passando por cima com a primária vazia (a arma na mão) ou com a mesma arma (enche o pente e a reserva); com
 * outra primária, no usar (a de agora some). O Jugg (Juggernaut) não pega; a regra de armas do bot e do time vale.
 * Revisão: ninguém nasce desarmado. Quem tem uma regra de armas que não deixa pegar nenhuma arma dos pontos, ou que não
 * tem arma de mão (pistola, revólver ou faca), fica com o loadout de sempre (`mapWeaponsDropPrimary`).
 */

/** Um ponto de arma da partida (metros nos pés; o código da arma já filtrado pelas armas permitidas). */
export interface MapWeaponSpot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly weapon: number;
}

export interface MapWeaponsState {
  readonly spots: readonly MapWeaponSpot[];
  /** Ticks até a arma pega voltar ao ponto. */
  readonly respawnTicks: number;
  /** Revisão: as armas dos pontos (o bit de `weaponMaskBit` de cada uma), para a conta de quem nasce sem a primária. */
  readonly spotMask: number;
}

/** Revisão: as armas de mão de reserva (pistola, revólver e faca): com uma delas, nascer sem a primária não desarma. */
const SIDEARMS =
  weaponMaskBit(WEAPON_CODE.pistol) | weaponMaskBit(WEAPON_CODE.revolver) | weaponMaskBit(WEAPON_CODE.knife);

/**
 * Revisão: com as armas no mapa, quem tem a regra de armas `mask` (a do bot, a do time e as permitidas da partida; 0 =
 * todas) nasce sem a primária? Só se ela deixa pegar alguma arma dos pontos (`spotMask`) e tem uma arma de mão; senão
 * fica com o loadout de sempre (o "Só fuzil", o Camper Carl só de sniper, o Jorge só de escopeta, o "Só X" do time no
 * Sandbox). A cena usa a mesma conta para o radial da morte.
 */
export function mapWeaponsDropPrimary(mask: number, spotMask: number): boolean {
  return mask === 0 || ((mask & spotMask) !== 0 && (mask & SIDEARMS) !== 0);
}

/** O ponto do mapa como a sim recebe (`SimMap.weaponSpots`: a arma pelo id do arsenal). */
export interface MapWeaponSpotDef {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly weapon: string;
}

/**
 * As armas da partida, ou `null` (regra desligada, modo que não aceita, ou nenhuma arma sobrou no mapa: aí vale o
 * loadout de sempre). Com `weapons.allowed`, a arma não permitida do ponto vira uma das permitidas (em rodízio, pela
 * ordem dos pontos); sem nenhuma primária permitida, nenhum ponto.
 */
export function createMapWeapons(
  recipe: MatchRecipe,
  defs: readonly MapWeaponSpotDef[],
  hz: number,
): MapWeaponsState | null {
  if (!recipeWeaponPickups(recipe) || defs.length === 0) return null;
  let mask = 0;
  for (const id of recipe.weapons?.allowed ?? []) {
    const code = weaponCodeOf(id);
    if (code >= 0) mask |= weaponMaskBit(code);
  }
  const allowed: number[] = [];
  for (const w of ARSENAL)
    if (isPrimaryWeapon(w.code) && (mask === 0 || (mask & weaponMaskBit(w.code)) !== 0)) {
      allowed.push(w.code);
    }
  if (allowed.length === 0) return null;
  const spots: MapWeaponSpot[] = [];
  let spotMask = 0;
  let swap = 0;
  for (const d of defs) {
    let code = weaponCodeOf(d.weapon);
    if (!isPrimaryWeapon(code)) continue;
    if (mask !== 0 && (mask & weaponMaskBit(code)) === 0) code = allowed[swap++ % allowed.length]!;
    spots.push({ x: d.x, y: d.y, z: d.z, weapon: code });
    spotMask |= weaponMaskBit(code);
  }
  if (spots.length === 0) return null;
  return { spots, respawnTicks: Math.max(1, secondsToTicks(MAP_WEAPONS.respawnS, hz)), spotMask };
}

/** A largada (no tick 0): cada arma no ponto dela, um pouco acima do chão (cai até ele, como o loot do Royale). */
export function spawnMapWeapons(ctx: SimContext): void {
  const st = ctx.mapWeapons;
  if (st === null) return;
  const s = ctx.s;
  for (const spot of st.spots) {
    const i = s.allocatePickup();
    if (i < 0) return;
    const i3 = i * 3;
    s.pickKind[i] = PICKUP_KIND.weaponBase + spot.weapon;
    s.pickPosition[i3] = spot.x;
    s.pickPosition[i3 + 1] = spot.y + 0.25;
    s.pickPosition[i3 + 2] = spot.z;
    s.pickPrevPosition[i3] = spot.x;
    s.pickPrevPosition[i3 + 1] = spot.y + 0.25;
    s.pickPrevPosition[i3 + 2] = spot.z;
    s.pickVelY[i] = -0.001;
    s.pickTicks[i] = ROYALE_AMMO_BASE;
    ctx.events.pickup(ctx.tick, 'drop', i, NULL_ENTITY, spot.x, spot.y, spot.z, s.pickKind[i]!);
  }
}

/** O ponto vazio `i` conta a volta; no fim, a arma reaparece nele (no `pickupSystem`, antes de qualquer outra coisa). */
export function mapWeaponCountdown(ctx: SimContext, i: number): void {
  const s = ctx.s;
  s.pickTicks[i] = s.pickTicks[i]! - 1;
  if (s.pickTicks[i]! > 0) return;
  s.pickKind[i] = PICKUP_KIND.weaponBase + spotWeapon(s.pickKind[i]!);
  s.pickTicks[i] = ROYALE_AMMO_BASE;
  const i3 = i * 3;
  ctx.events.pickup(
    ctx.tick,
    'drop',
    i,
    NULL_ENTITY,
    s.pickPosition[i3]!,
    s.pickPosition[i3 + 1]!,
    s.pickPosition[i3 + 2]!,
    s.pickKind[i]!,
  );
}

/** A arma do pickup `i` foi pega: o ponto fica vazio, contando a volta. */
function emptySpot(ctx: SimContext, i: number, by: number): void {
  const s = ctx.s;
  const kind = s.pickKind[i]!;
  const i3 = i * 3;
  ctx.events.pickup(
    ctx.tick,
    'take',
    i,
    by,
    s.pickPosition[i3]!,
    s.pickPosition[i3 + 1]!,
    s.pickPosition[i3 + 2]!,
    kind,
  );
  s.pickKind[i] = PICKUP_KIND.spotBase + pickupWeapon(kind);
  s.pickTicks[i] = ctx.mapWeapons!.respawnTicks;
}

/** `e` pode ter a arma `code` na mão? (de pé, não é o Jugg e a regra de armas dele deixa). */
function canHold(ctx: SimContext, e: number, code: number): boolean {
  const s = ctx.s;
  if (s.kind[e] !== ENTITY_KIND.bobo || (s.flags[e]! & (F.dead | F.downed)) !== 0) return false;
  if (ctx.party.jugg !== null && s.team[e] === 1) return false;
  const mask = ctx.rules.weaponMask[e]!;
  return mask === 0 || (mask & weaponMaskBit(code)) !== 0;
}

/**
 * Põe a arma `code` (pente e reserva cheios) na primária de `e` e leva a mão a ela, como a troca do sistema de armas
 * (o tempo de troca, sem recarga, mira nem rajada em curso).
 */
function holdPrimary(ctx: SimContext, e: number, code: number): void {
  const s = ctx.s;
  const def = weaponDef(code)!;
  const k = e * WEAPON_SLOT_COUNT + WEAPON_SLOT.primary;
  s.loadout[k] = code;
  s.slotClip[k] = def.clipSize;
  s.slotReserve[k] = def.reserve;
  s.slot[e] = WEAPON_SLOT.primary;
  s.weapon[e] = code;
  s.inWeapon[e] = WEAPON_SLOT.primary;
  s.switchTicks[e] = secondsToTicks(MATCH_DEFAULTS.weaponSwitchS, ctx.hz);
  s.reloadTicks[e] = 0;
  s.burstShots[e] = 0;
  s.adsAmount[e] = 0;
  s.flags[e] = s.flags[e]! & ~(F.reloading | F.ads);
  ctx.events.weapon(ctx.tick, s.idOf(e), code, 'switch');
}

/**
 * No `pickupSystem`: `e` passou por cima da arma do pickup `i` (tipo `kind`). Com a primária vazia, ela vai para a mão
 * (não com a granada cozinhando: a mão fica nela até lançar); com a mesma arma e munição faltando, enche o pente e a
 * reserva; com outra primária, nada (a troca é no usar). Pegou: o ponto fica vazio. Devolve se pegou.
 */
export function mapWeaponTouch(ctx: SimContext, e: number, i: number, kind: number): boolean {
  const s = ctx.s;
  const code = pickupWeapon(kind);
  if (code === WEAPON_NONE || !canHold(ctx, e, code)) return false;
  const k = e * WEAPON_SLOT_COUNT + WEAPON_SLOT.primary;
  const have = s.loadout[k]!;
  if (have === WEAPON_NONE) {
    if (s.cookTicks[e]! >= 0) return false;
    holdPrimary(ctx, e, code);
  } else if (have === code) {
    const def = weaponDef(code)!;
    if (s.slotClip[k]! >= def.clipSize && s.slotReserve[k]! >= def.reserve) return false;
    s.slotClip[k] = Math.max(s.slotClip[k]!, def.clipSize);
    s.slotReserve[k] = Math.max(s.slotReserve[k]!, def.reserve);
  } else return false;
  emptySpot(ctx, i, s.idOf(e));
  return true;
}

/** A arma do mapa mais perto de `e` ao alcance da troca (índice do pickup; -1 = nenhuma). Como a do Royale. */
function weaponInReach(ctx: SimContext, e: number): number {
  const s = ctx.s;
  const e3 = e * 3;
  let best = -1;
  let bestD = MAP_WEAPONS.swapReachM * MAP_WEAPONS.swapReachM;
  for (let i = 0; i < s.pickCount; i++) {
    if (s.pickAlive[i] === 0 || pickupWeapon(s.pickKind[i]!) === WEAPON_NONE) continue;
    const i3 = i * 3;
    const dx = s.pickPosition[i3]! - s.position[e3]!;
    const dy = s.pickPosition[i3 + 1]! - s.position[e3 + 1]!;
    const dz = s.pickPosition[i3 + 2]! - s.position[e3 + 2]!;
    const d = dx * dx + dz * dz;
    if (d <= bestD && dy > -0.6 && dy < 1.8) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Depois dos pickups: o usar (na borda do botão) perto de uma arma do mapa troca a primária de agora por ela (a de
 * agora some; a arma igual já entrou passando por cima). Não com a granada cozinhando. Revisão: também na morte súbita
 * (`isLivePhase`: lá o renascer continua).
 */
export function mapWeaponSystem(ctx: SimContext): void {
  if (ctx.mapWeapons === null || !isLivePhase(ctx.match.phase)) return;
  const s = ctx.s;
  for (let e = 0; e < s.count; e++) {
    if (s.alive[e] === 0) continue;
    if ((s.inButtons[e]! & BUTTON.use) === 0 || (s.prevButtons[e]! & BUTTON.use) !== 0) continue;
    const i = weaponInReach(ctx, e);
    if (i < 0) continue;
    const code = pickupWeapon(s.pickKind[i]!);
    const have = s.loadout[e * WEAPON_SLOT_COUNT + WEAPON_SLOT.primary]!;
    if (have === WEAPON_NONE || have === code || s.cookTicks[e]! >= 0 || !canHold(ctx, e, code)) continue;
    holdPrimary(ctx, e, code);
    emptySpot(ctx, i, s.idOf(e));
  }
}

/**
 * O loadout ao renascer com as armas no mapa (depois do de sempre e do modo): sem a primária, a mão no 1º slot que
 * sobrou (a pistola). O Jugg fica com a arma dele; quem a regra de armas deixaria desarmado, com o loadout de sempre
 * (`mapWeaponsDropPrimary`).
 */
export function mapWeaponLoadout(ctx: SimContext, e: number): void {
  const s = ctx.s;
  if (ctx.party.jugg !== null && s.team[e] === 1) return;
  if (!mapWeaponsDropPrimary(ctx.rules.weaponMask[e]!, ctx.mapWeapons!.spotMask)) return;
  const k = e * WEAPON_SLOT_COUNT;
  s.loadout[k + WEAPON_SLOT.primary] = WEAPON_NONE;
  s.slotClip[k + WEAPON_SLOT.primary] = 0;
  s.slotReserve[k + WEAPON_SLOT.primary] = 0;
  if (s.slot[e] !== WEAPON_SLOT.primary) return;
  for (let slot = WEAPON_SLOT.secondary; slot < WEAPON_SLOT_COUNT; slot++) {
    if (s.loadout[k + slot] === WEAPON_NONE) continue;
    s.slot[e] = slot;
    break;
  }
  s.weapon[e] = s.loadout[k + s.slot[e]!]!;
}
