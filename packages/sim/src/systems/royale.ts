import { FIGURE_BONE, type FigurePart } from '@boboforces/format';
import { BUTTON, WEAPON_SLOT_COUNT } from '@boboforces/input';
import { royaleWeaponCode, WEAPON_CODE, WEAPON_SLOT, weaponDef } from '../config/weapons.ts';
import { ZOMBIES_DOWN } from '../config/zombie.ts';
import { MATCH_DEFAULTS } from '../config/rules.ts';
import { MAX_ENTITIES, secondsToTicks } from '../constants.ts';
import { PART_TORSO, WEAPON_NONE, WEAPON_ZONE, type SimContext } from '../context.ts';
import { ENTITY_FLAG, ENTITY_KIND, NULL_ENTITY } from '../entity.ts';
import { PICKUP_KIND } from '../view.ts';
import { bleedOut, maxHpOf } from './life.ts';
import { updateDowned } from './zombies.ts';

const F = ENTITY_FLAG;

/**
 * M7 (fase 6): o Bobo Royale Mini (`mode: 'royale.mini'`, GDD §4.6.4 e gameplay.md "Bobo Royale"): até 24
 * participantes sem respawn, em esquadrões de 1, 2 ou 4 (o `team` da sim é o esquadrão); o loot no chão dos
 * `lootSpots` do mapa; a zona em 5 fases (dano de 2 / 5 / 10 / 20 / 40 HP/s fora dela); vence o último esquadrão com
 * alguém vivo (o caído conta). Os números do GDD são os do GDD; os marcados "minha" são escolhas minhas (revisáveis).
 */
export const ROYALE = {
  /** A zona, por fase: a espera, o encolher até o raio e o dano fora dela (os tempos e os raios são meus: ~8 min). */
  zone: [
    { waitS: 90, shrinkS: 60, radiusM: 80, dps: 2 },
    { waitS: 70, shrinkS: 50, radiusM: 50, dps: 5 },
    { waitS: 55, shrinkS: 40, radiusM: 28, dps: 10 },
    { waitS: 40, shrinkS: 35, radiusM: 12, dps: 20 },
    { waitS: 30, shrinkS: 30, radiusM: 0, dps: 40 },
  ],
  /**
   * M11 (fase 5): a zona do Royale Grande (`royale.grande`, o Arquipélago de 380 m de área): 6 fases, os raios no
   * dobro dos do Mini nas primeiras e os tempos ~1,4× (12,4 min até fechar; o GDD pede uns 12–15). Minha, revisável.
   */
  zoneGrande: [
    { waitS: 120, shrinkS: 90, radiusM: 170, dps: 2 },
    { waitS: 90, shrinkS: 70, radiusM: 110, dps: 4 },
    { waitS: 75, shrinkS: 55, radiusM: 65, dps: 8 },
    { waitS: 60, shrinkS: 45, radiusM: 35, dps: 12 },
    { waitS: 45, shrinkS: 35, radiusM: 15, dps: 20 },
    { waitS: 30, shrinkS: 30, radiusM: 0, dps: 40 },
  ],
  /** A zona fere em pulsos (o dano de `zonePulseS` de uma vez): um acerto por pulso, não um por tick (minha). */
  zonePulseS: 0.5,
  /** Os pentes de reserva da pistola na largada (minha). */
  startPistolClips: 2,
  /** O kit de cura: segurar o usar por `healUseS` cura `healHp` (até a vida máxima); carrega até `healMax` (minha). */
  healUseS: 3,
  healHp: 60,
  healMax: 3,
  /** Até onde dá para trocar a primária por uma arma do chão (m, dos pés). */
  swapReachM: 1.2,
  /** A vida do caído (duplas e quartetos): o tiro e a zona tiram; zerou, morreu (minha). */
  downHp: 100,
  /** A chance de um ponto de loot ter um 2º item e os pesos dos itens (arma, colete, kit, munição; minha). */
  secondItemChance: 0.35,
  itemWeights: [45, 20, 20, 15],
  /** As armas do loot e os pesos das raridades (comum, rara, épica; minha). */
  lootWeapons: [WEAPON_CODE.smg, WEAPON_CODE.shotgun, WEAPON_CODE.rifle, WEAPON_CODE.sniper],
  rarityWeights: [60, 30, 10],
  /** A parte dos coletes que é de 100 (minha). */
  armor100Chance: 0.33,
} as const;

/** Os índices de `RoyaleState.data`. */
export const ZONE = {
  /** A fase da zona (0..4; 5 = fechada). */
  stage: 0,
  /** 1 = encolhendo (0 = esperando). */
  shrinking: 1,
  /** Ticks que faltam da espera ou do encolher. */
  ticks: 2,
  /** Esquadrões com alguém vivo. */
  squadsAlive: 3,
  /** O esquadrão vencedor (`ROYALE_UNDECIDED` = ainda não; -1 = ninguém, empate). */
  winner: 4,
} as const;
export const ZONE_FIELDS = 5;
/** Os índices de `RoyaleState.circle` (metros): o círculo de agora, o de onde vem e o para onde vai. */
export const CIRCLE = { cx: 0, cz: 1, r: 2, fromCx: 3, fromCz: 4, fromR: 5, toCx: 6, toCz: 7, toR: 8 } as const;
export const CIRCLE_FIELDS = 9;
export const ROYALE_UNDECIDED = -2;
/**
 * Os itens do Royale não somem: o `pickTicks` guarda a munição da arma (`ROYALE_AMMO_BASE` + pente + reserva × 1000),
 * para trocar de arma não encher o pente de graça.
 */
export const ROYALE_AMMO_BASE = 1_000_000;

export interface RoyaleSpot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Uma fase da zona (`ROYALE.zone`, `ROYALE.zoneGrande`). */
export interface RoyaleZoneStage {
  readonly waitS: number;
  readonly shrinkS: number;
  readonly radiusM: number;
  readonly dps: number;
}

export interface RoyaleState {
  /** Participantes por esquadrão (1, 2 ou 4) e quantos esquadrões. */
  readonly squad: number;
  readonly squads: number;
  readonly data: Int32Array;
  readonly circle: Float64Array;
  /** A colocação de cada esquadrão (0 = ainda vivo; 1 = venceu). */
  readonly place: Uint8Array;
  /** Os ticks de cada fase (a espera e o encolher). */
  readonly waitTicks: Int32Array;
  readonly shrinkTicks: Int32Array;
  readonly loot: readonly RoyaleSpot[];
  /** M11 (fase 5): as fases da zona do modo (`ROYALE.zone` no Mini, `ROYALE.zoneGrande` no Grande). */
  readonly zone: readonly RoyaleZoneStage[];
}

export function createRoyaleState(
  squad: number,
  participants: number,
  hz: number,
  loot: readonly RoyaleSpot[],
  area: { readonly minX: number; readonly minZ: number; readonly maxX: number; readonly maxZ: number },
  zone: readonly RoyaleZoneStage[] = ROYALE.zone,
): RoyaleState {
  const squads = Math.max(1, Math.ceil(participants / squad));
  const data = new Int32Array(ZONE_FIELDS);
  const circle = new Float64Array(CIRCLE_FIELDS);
  // A zona começa cobrindo a área inteira (o meio dela, com a meia diagonal de raio), esperando a 1ª fase.
  const cx = (area.minX + area.maxX) / 2;
  const cz = (area.minZ + area.maxZ) / 2;
  const w = area.maxX - area.minX;
  const h = area.maxZ - area.minZ;
  const r = Math.sqrt(w * w + h * h) / 2;
  circle[CIRCLE.cx] = cx;
  circle[CIRCLE.cz] = cz;
  circle[CIRCLE.r] = r;
  const waitTicks = new Int32Array(zone.length);
  const shrinkTicks = new Int32Array(zone.length);
  zone.forEach((z, i) => {
    waitTicks[i] = Math.max(1, secondsToTicks(z.waitS, hz));
    shrinkTicks[i] = Math.max(1, secondsToTicks(z.shrinkS, hz));
  });
  data[ZONE.ticks] = waitTicks[0]!;
  data[ZONE.squadsAlive] = squads;
  data[ZONE.winner] = ROYALE_UNDECIDED;
  return { squad, squads, data, circle, place: new Uint8Array(squads), waitTicks, shrinkTicks, loot, zone };
}

/** O pickup é um item do Royale (não some; o `pickTicks` guarda a munição). */
export function isRoyaleItem(kind: number): boolean {
  return (
    kind === PICKUP_KIND.armor50 ||
    kind === PICKUP_KIND.armor100 ||
    kind === PICKUP_KIND.heal ||
    kind >= PICKUP_KIND.weaponBase
  );
}

/** A arma de um pickup do Royale (`WEAPON_NONE` se não for arma). */
export function pickupWeapon(kind: number): number {
  return kind >= PICKUP_KIND.weaponBase ? kind - PICKUP_KIND.weaponBase : WEAPON_NONE;
}

function living(ctx: SimContext, e: number): boolean {
  const s = ctx.s;
  return s.alive[e] === 1 && s.kind[e] === ENTITY_KIND.bobo && (s.flags[e]! & F.dead) === 0;
}

function standing(ctx: SimContext, e: number): boolean {
  return living(ctx, e) && (ctx.s.flags[e]! & F.downed) === 0;
}

/** Solta um item do Royale em (x, y, z) (cai até o chão). Sem vaga no pool, não solta. */
function dropItem(ctx: SimContext, kind: number, ammo: number, x: number, y: number, z: number, by: number): void {
  const s = ctx.s;
  const i = s.allocatePickup();
  if (i < 0) return;
  const i3 = i * 3;
  s.pickKind[i] = kind;
  s.pickPosition[i3] = x;
  s.pickPosition[i3 + 1] = y + 0.25;
  s.pickPosition[i3 + 2] = z;
  s.pickPrevPosition[i3] = x;
  s.pickPrevPosition[i3 + 1] = y + 0.25;
  s.pickPrevPosition[i3 + 2] = z;
  s.pickVelY[i] = -0.001;
  s.pickTicks[i] = ROYALE_AMMO_BASE + ammo;
  ctx.events.pickup(ctx.tick, 'drop', i, by, x, y, z, kind);
}

function weighted(ctx: SimContext, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += w;
  let r = ctx.rngRoyale.next() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!;
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/** Um item sorteado do loot: a arma (com a raridade), o colete, o kit de cura ou a caixinha de munição. */
function rollItem(ctx: SimContext): number {
  const pick = weighted(ctx, ROYALE.itemWeights);
  if (pick === 0) {
    const base = ROYALE.lootWeapons[ctx.rngRoyale.int(0, ROYALE.lootWeapons.length)]!;
    return PICKUP_KIND.weaponBase + royaleWeaponCode(base, weighted(ctx, ROYALE.rarityWeights));
  }
  if (pick === 1) return ctx.rngRoyale.next() < ROYALE.armor100Chance ? PICKUP_KIND.armor100 : PICKUP_KIND.armor50;
  return pick === 2 ? PICKUP_KIND.heal : PICKUP_KIND.ammoBox;
}

/** A munição da arma nova no chão: o pente cheio e um pente de reserva. */
function freshAmmo(kind: number): number {
  const def = weaponDef(pickupWeapon(kind));
  return def === null ? 0 : def.clipSize + def.clipSize * 1000;
}

/** A largada do loot (no tick 0): um item por ponto, às vezes dois. */
export function spawnRoyaleLoot(ctx: SimContext): void {
  const st = ctx.royale!;
  for (const spot of st.loot) {
    const n = ctx.rngRoyale.next() < ROYALE.secondItemChance ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const kind = rollItem(ctx);
      dropItem(ctx, kind, freshAmmo(kind), spot.x + k * 0.5, spot.y, spot.z, NULL_ENTITY);
    }
  }
}

/**
 * Põe a arma `code` (com a munição empacotada) na primária de `e` e leva a mão a ela, como a troca do sistema de armas
 * (o tempo de troca, sem recarga, mira nem rajada em curso).
 */
function giveWeapon(ctx: SimContext, e: number, code: number, ammo: number): void {
  const s = ctx.s;
  const k = e * WEAPON_SLOT_COUNT + WEAPON_SLOT.primary;
  s.loadout[k] = code;
  s.slotClip[k] = ammo % 1000;
  s.slotReserve[k] = Math.floor(ammo / 1000);
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

/** Dá para pegar ou trocar a arma agora (não com a granada cozinhando: a mão fica nela até lançar). */
function canTakeWeapon(ctx: SimContext, e: number): boolean {
  return ctx.s.cookTicks[e]! < 0;
}

/**
 * No `pickupSystem`: `e` pega sozinho o item `kind` do pickup `i`? O colete se for melhor que o dele, o kit até o teto
 * e a arma com a primária vazia (com a primária ocupada, a troca é no usar).
 */
export function royaleTake(ctx: SimContext, e: number, i: number, kind: number): boolean {
  const s = ctx.s;
  if (kind === PICKUP_KIND.armor50 || kind === PICKUP_KIND.armor100) {
    const value = kind === PICKUP_KIND.armor100 ? 100 : 50;
    if (s.armor[e]! >= value) return false;
    s.armor[e] = value;
    return true;
  }
  if (kind === PICKUP_KIND.heal) {
    if (s.heals[e]! >= ROYALE.healMax) return false;
    s.heals[e] = s.heals[e]! + 1;
    return true;
  }
  const code = pickupWeapon(kind);
  if (code === WEAPON_NONE || s.loadout[e * WEAPON_SLOT_COUNT + WEAPON_SLOT.primary] !== WEAPON_NONE) return false;
  if (!canTakeWeapon(ctx, e)) return false;
  giveWeapon(ctx, e, code, s.pickTicks[i]! - ROYALE_AMMO_BASE);
  return true;
}

/** Quem morre no Royale deixa no chão a primária (com a munição), o colete e os kits. */
export function royaleDrops(ctx: SimContext, e: number): void {
  const s = ctx.s;
  const e3 = e * 3;
  const x = s.position[e3]!;
  const y = s.position[e3 + 1]!;
  const z = s.position[e3 + 2]!;
  const id = s.idOf(e);
  const k = e * WEAPON_SLOT_COUNT + WEAPON_SLOT.primary;
  const code = s.loadout[k]!;
  if (code !== WEAPON_NONE) {
    dropItem(ctx, PICKUP_KIND.weaponBase + code, s.slotClip[k]! + s.slotReserve[k]! * 1000, x, y, z, id);
  }
  const armor = s.armor[e]!;
  if (armor > 0) dropItem(ctx, armor > 50 ? PICKUP_KIND.armor100 : PICKUP_KIND.armor50, 0, x + 0.5, y, z, id);
  for (let h = 0; h < s.heals[e]!; h++) dropItem(ctx, PICKUP_KIND.heal, 0, x - 0.5, y, z + h * 0.4, id);
  s.armor[e] = 0;
  s.heals[e] = 0;
  s.healTicks[e] = 0;
}

/** A largada do Royale: só a pistola (com 2 pentes de reserva), a faca e a granada vazia (a munição do chão enche). */
export function royaleLoadout(ctx: SimContext, e: number): void {
  const s = ctx.s;
  const k = e * WEAPON_SLOT_COUNT;
  s.loadout[k + WEAPON_SLOT.primary] = WEAPON_NONE;
  s.slotClip[k + WEAPON_SLOT.primary] = 0;
  s.slotReserve[k + WEAPON_SLOT.primary] = 0;
  const pistol = weaponDef(s.loadout[k + WEAPON_SLOT.secondary]!);
  if (pistol !== null) s.slotReserve[k + WEAPON_SLOT.secondary] = pistol.clipSize * ROYALE.startPistolClips;
  s.slotClip[k + WEAPON_SLOT.throwable] = 0;
  s.slot[e] = WEAPON_SLOT.secondary;
  s.weapon[e] = s.loadout[k + WEAPON_SLOT.secondary]!;
  s.armor[e] = 0;
  s.heals[e] = 0;
  s.healTicks[e] = 0;
}

/** O ponto de loot cabe como centro do círculo novo (a até `room` m do centro de agora). */
function fits(spot: RoyaleSpot, c: Float64Array, room: number): boolean {
  const dx = spot.x - c[CIRCLE.cx]!;
  const dz = spot.z - c[CIRCLE.cz]!;
  return room >= 0 && dx * dx + dz * dz <= room * room;
}

/** Sorteia o círculo da fase de agora: o centro num ponto de loot que caiba dentro do círculo de agora. */
export function planZone(ctx: SimContext): void {
  const st = ctx.royale!;
  const c = st.circle;
  const stage = st.data[ZONE.stage]!;
  c[CIRCLE.fromCx] = c[CIRCLE.cx]!;
  c[CIRCLE.fromCz] = c[CIRCLE.cz]!;
  c[CIRCLE.fromR] = c[CIRCLE.r]!;
  c[CIRCLE.toCx] = c[CIRCLE.cx]!;
  c[CIRCLE.toCz] = c[CIRCLE.cz]!;
  c[CIRCLE.toR] = c[CIRCLE.r]!;
  if (stage >= st.zone.length) return;
  // O círculo novo nunca é maior que o de agora (num mapa pequeno, as primeiras fases só esperam).
  const r = Math.min(st.zone[stage]!.radiusM, c[CIRCLE.r]!);
  const room = c[CIRCLE.r]! - r;
  let n = 0;
  for (const spot of st.loot) if (fits(spot, c, room)) n++;
  if (n > 0) {
    let pick = ctx.rngRoyale.int(0, n);
    for (const spot of st.loot) {
      if (!fits(spot, c, room)) continue;
      if (pick-- === 0) {
        c[CIRCLE.toCx] = spot.x;
        c[CIRCLE.toCz] = spot.z;
        break;
      }
    }
  }
  c[CIRCLE.toR] = r;
}

/** O dano da zona por segundo agora (o da fase; fechada, o da última). */
export function zoneDps(st: RoyaleState): number {
  return st.zone[Math.min(st.data[ZONE.stage]!, st.zone.length - 1)]!.dps;
}

function updateZone(ctx: SimContext, st: RoyaleState): void {
  const d = st.data;
  const c = st.circle;
  const stage = d[ZONE.stage]!;
  if (stage >= st.zone.length) return;
  d[ZONE.ticks] = d[ZONE.ticks]! - 1;
  if (d[ZONE.shrinking] === 0) {
    if (d[ZONE.ticks]! > 0) return;
    d[ZONE.shrinking] = 1;
    d[ZONE.ticks] = st.shrinkTicks[stage]!;
    return;
  }
  const t = Math.min(1, 1 - d[ZONE.ticks]! / st.shrinkTicks[stage]!);
  c[CIRCLE.cx] = c[CIRCLE.fromCx]! + (c[CIRCLE.toCx]! - c[CIRCLE.fromCx]!) * t;
  c[CIRCLE.cz] = c[CIRCLE.fromCz]! + (c[CIRCLE.toCz]! - c[CIRCLE.fromCz]!) * t;
  c[CIRCLE.r] = c[CIRCLE.fromR]! + (c[CIRCLE.toR]! - c[CIRCLE.fromR]!) * t;
  if (d[ZONE.ticks]! > 0) return;
  d[ZONE.stage] = stage + 1;
  d[ZONE.shrinking] = 0;
  d[ZONE.ticks] = stage + 1 < st.zone.length ? st.waitTicks[stage + 1]! : 0;
  planZone(ctx);
}

/**
 * Fora do círculo, o dano da fase (sem dono; o colete não segura), em pulsos de `zonePulseS`. Entra na fila antes do
 * dano deste tick.
 */
function zoneDamage(ctx: SimContext, st: RoyaleState): void {
  const pulse = Math.max(1, secondsToTicks(ROYALE.zonePulseS, ctx.hz));
  if (ctx.tick % pulse !== 0) return;
  const s = ctx.s;
  const c = st.circle;
  const amount = (zoneDps(st) * pulse) / ctx.hz;
  const r2 = c[CIRCLE.r]! * c[CIRCLE.r]!;
  for (let e = 0; e < s.count; e++) {
    if (!living(ctx, e)) continue;
    const e3 = e * 3;
    const dx = s.position[e3]! - c[CIRCLE.cx]!;
    const dz = s.position[e3 + 2]! - c[CIRCLE.cz]!;
    // Dentro é estritamente dentro: com a zona fechada (raio 0), ninguém escapa.
    if (dx * dx + dz * dz < r2) continue;
    ctx.damage.push(
      e,
      NULL_ENTITY,
      amount,
      PART_TORSO,
      FIGURE_BONE.torso as FigurePart,
      WEAPON_ZONE,
      s.position[e3]!,
      s.position[e3 + 1]! + 1,
      s.position[e3 + 2]!,
    );
  }
}

/** A arma do chão mais perto de `e` ao alcance da troca (índice do pickup; -1 = nenhuma). */
function weaponInReach(ctx: SimContext, e: number): number {
  const s = ctx.s;
  const e3 = e * 3;
  let best = -1;
  let bestD = ROYALE.swapReachM * ROYALE.swapReachM;
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

const REVIVE_RANGE2 = ZOMBIES_DOWN.reviveRangeM * ZOMBIES_DOWN.reviveRangeM;

/** Um aliado caído ao alcance de levantar (aí o usar é do reviver, não da cura). */
function downedMateNear(ctx: SimContext, e: number): boolean {
  const s = ctx.s;
  const e3 = e * 3;
  for (let o = 0; o < s.count; o++) {
    if (o === e || !living(ctx, o) || (s.flags[o]! & F.downed) === 0 || s.team[o] !== s.team[e]) continue;
    const o3 = o * 3;
    const dx = s.position[o3]! - s.position[e3]!;
    const dy = s.position[o3 + 1]! - s.position[e3 + 1]!;
    const dz = s.position[o3 + 2]! - s.position[e3 + 2]!;
    if (dx * dx + dy * dy + dz * dz <= REVIVE_RANGE2) return true;
  }
  return false;
}

/** O usar: apertar perto de uma arma troca a primária; segurar longe de tudo usa um kit (cura em `healUseS`). */
function useActions(ctx: SimContext): void {
  const s = ctx.s;
  const need = Math.max(1, secondsToTicks(ROYALE.healUseS, ctx.hz));
  for (let e = 0; e < s.count; e++) {
    if (!standing(ctx, e)) {
      s.healTicks[e] = 0;
      continue;
    }
    const held = (s.inButtons[e]! & BUTTON.use) !== 0;
    if (held && (s.prevButtons[e]! & BUTTON.use) === 0) {
      const i = weaponInReach(ctx, e);
      const k = e * WEAPON_SLOT_COUNT + WEAPON_SLOT.primary;
      // Com um aliado caído ao alcance, o usar é do reviver (não troca a arma).
      if (i >= 0 && s.loadout[k] !== WEAPON_NONE && canTakeWeapon(ctx, e) && !downedMateNear(ctx, e)) {
        const kind = s.pickKind[i]!;
        const ammo = s.pickTicks[i]! - ROYALE_AMMO_BASE;
        const i3 = i * 3;
        const x = s.pickPosition[i3]!;
        const y = s.pickPosition[i3 + 1]!;
        const z = s.pickPosition[i3 + 2]!;
        const id = s.idOf(e);
        ctx.events.pickup(ctx.tick, 'take', i, id, x, y, z, kind);
        s.freePickup(i);
        // A primária de agora cai no lugar da que foi pega (na altura dela: o `dropItem` soma o meio palmo da queda).
        dropItem(
          ctx,
          PICKUP_KIND.weaponBase + s.loadout[k]!,
          s.slotClip[k]! + s.slotReserve[k]! * 1000,
          x,
          y - 0.25,
          z,
          id,
        );
        giveWeapon(ctx, e, pickupWeapon(kind), ammo);
        s.healTicks[e] = 0;
        continue;
      }
    }
    if (
      !held ||
      (s.inButtons[e]! & BUTTON.fire) !== 0 ||
      s.heals[e] === 0 ||
      s.health[e]! >= maxHpOf(ctx, e) ||
      downedMateNear(ctx, e)
    ) {
      s.healTicks[e] = 0;
      continue;
    }
    s.healTicks[e] = s.healTicks[e]! + 1;
    if (s.healTicks[e]! < need) continue;
    s.healTicks[e] = 0;
    s.heals[e] = s.heals[e]! - 1;
    s.health[e] = Math.min(maxHpOf(ctx, e), s.health[e]! + ROYALE.healHp);
  }
}

const standingIn = new Int32Array(MAX_ENTITIES);

/** Conta quem está de pé em cada esquadrão (em `standingIn`). */
function countStanding(ctx: SimContext, st: RoyaleState): void {
  const s = ctx.s;
  standingIn.fill(0, 0, st.squads);
  for (let e = 0; e < s.count; e++) {
    if (!living(ctx, e) || (s.flags[e]! & F.downed) !== 0) continue;
    const t = s.team[e]!;
    if (t < st.squads) standingIn[t] = standingIn[t]! + 1;
  }
}

/** O esquadrão que só tem caídos (ninguém para levantar) sangra inteiro (o golpe vale no dano deste tick). */
function bleedLonelyDowned(ctx: SimContext, st: RoyaleState): void {
  const s = ctx.s;
  countStanding(ctx, st);
  for (let e = 0; e < s.count; e++) {
    if (!living(ctx, e) || (s.flags[e]! & F.downed) === 0) continue;
    const t = s.team[e]!;
    if (t < st.squads && standingIn[t] === 0 && s.downTicks[e]! >= 0) {
      s.downTicks[e] = -1;
      bleedOut(ctx, e);
    }
  }
}

/**
 * Os esquadrões: vivo é quem tem alguém de pé (o que só tem caídos sangra no começo do tick seguinte, antes do dano);
 * quem fica sem ninguém de pé ganha a colocação (empate entre os que caem no mesmo tick); com um esquadrão só, ele
 * vence (nenhum: empate).
 */
function squads(ctx: SimContext, st: RoyaleState): void {
  countStanding(ctx, st);
  let remaining = 0;
  let last = -1;
  for (let t = 0; t < st.squads; t++) {
    if (standingIn[t]! > 0) {
      remaining++;
      last = t;
    }
  }
  for (let t = 0; t < st.squads; t++) if (standingIn[t] === 0 && st.place[t] === 0) st.place[t] = remaining + 1;
  st.data[ZONE.squadsAlive] = remaining;
  if (remaining <= 1 && st.data[ZONE.winner] === ROYALE_UNDECIDED) {
    st.data[ZONE.winner] = remaining === 1 ? last : -1;
    if (remaining === 1) st.place[last] = 1;
  }
}

/**
 * Antes do dano: a zona anda e fere quem está fora no mesmo tick (a fila de dano não vai no snapshot: o dano que
 * sobrasse para o tick seguinte faria a cópia do estado divergir).
 */
export function royaleZoneSystem(ctx: SimContext): void {
  const st = ctx.royale;
  if (st === null || ctx.match.phase !== 'playing') return;
  updateZone(ctx, st);
  zoneDamage(ctx, st);
  // O caído também: o golpe de quem sangra (ou do esquadrão que ficou sem ninguém de pé) vale neste tick.
  if (st.squad > 1) {
    updateDowned(ctx);
    bleedLonelyDowned(ctx, st);
  }
}

/** Depois do dano: o usar (trocar a arma e curar) e os esquadrões. */
export function royaleSystem(ctx: SimContext): void {
  const st = ctx.royale;
  if (st === null || ctx.match.phase !== 'playing') return;
  useActions(ctx);
  squads(ctx, st);
}
