import { DROP_KINDS, PICKUP_KIND } from '../view.ts';
import { partyActive, partyKill, partyLoadout } from './party.ts';
import { canSwap, MOD, modOn, swapPrimary } from './chaos.ts';
import { paintDamage, paintLoadout } from './paintball.ts';
import { strikeArmor, strikeKill } from './strike.ts';
import { ROYALE, ROYALE_UNDECIDED, royaleDrops, royaleLoadout, ZONE } from './royale.ts';
import { SANDBOX_UNDECIDED, sandboxLeader, sandboxSurvivor } from './sandbox.ts';
import { mapWeaponLoadout } from './map-weapons.ts';
import type { FigurePart } from '@boboforces/format';
import { BLOCK_FLAG, createRayHit, raycastGrid } from '@boboforces/world';
import { METRICS } from '../config/metrics.ts';
import { MATCH_DEFAULTS } from '../config/rules.ts';
import {
  hordeHpMul,
  ZOMBIE_POINTS,
  ZOMBIE_TYPE,
  ZOMBIES_DOWN,
  PERK,
  ZOMBIE_PERKS,
  ZOMBIE_DROPS,
} from '../config/zombie.ts';
import { BOT_CONTROLLER_BASE, MAX_TEAMS, RECENT_ATTACKERS } from '../constants.ts';
import { WEAPON_SLOT_COUNT } from '@boboforces/input';
import {
  CHAOS_BLAST,
  DEFAULT_LOADOUT_REST,
  isPaintWeapon,
  DEFAULT_PRIMARY,
  firstAllowedPrimary,
  isPrimaryWeapon,
  loadoutSecondary,
  WEAPON_CODE,
  WEAPON_SLOT,
  WEAPON_ROCKET,
  ZOMBIE_GOO,
  weaponDef,
  weaponMaskBit,
} from '../config/weapons.ts';
import { dropAmmoBox, dropZombieDrop } from './pickups.ts';
import { explode, launchProjectile } from './projectiles.ts';
import {
  HIT_PARTS,
  hostile,
  isBody,
  isHorde,
  PART_HEAD,
  PART_TORSO,
  RULE_FLAG,
  WEAPON_BLEED_OUT,
  WEAPON_ZONE,
  WEAPON_KILL_PLANE,
  WEAPON_NONE,
  type SimContext,
} from '../context.ts';
import { ENTITY_FLAG, ENTITY_KIND, NULL_ENTITY, type EntityId } from '../entity.ts';

/**
 * Passos 5 a 7: dano e morte, regras do modo (contagem, tempo, meta e morte súbita) e spawns (respawn, proteção,
 * regeneração).
 *
 * Spawn pontuado (gameplay.md §5.3; M2, fase 2a): no FFA, um dos 3 melhores pontos sem linha de visão de inimigo e a
 * mais de 20 m dele; no TDM, entre os pontos do time (ou `team = -1`), o com menos inimigos à vista e, no empate, o
 * mais longe deles. Os pontos vêm dos marcadores do mapa (`simMapFromMarkers`). Zumbis (M1, estresse) usam qualquer
 * ponto, o mais longe dos bobos, sem proteção nem regeneração, e abates de zumbi não contam no placar dos times.
 */

const F = ENTITY_FLAG;
const R = RECENT_ATTACKERS;

/** M7 (fase 2, revisão): o colete do BoboStrike segura tiro e explosão; a queda, o vazio e o sangrar passam inteiros. */
function armored(weapon: number): boolean {
  return (
    weapon !== WEAPON_NONE && weapon !== WEAPON_KILL_PLANE && weapon !== WEAPON_BLEED_OUT && weapon !== WEAPON_ZONE
  );
}

/** M7 (fase 6): o colete do BoboStrike e o do Royale (o mesmo: metade do dano fora da cabeça). */
function hasArmor(ctx: SimContext): boolean {
  return ctx.strike !== null || ctx.royale !== null;
}

/** M7 (fase 6): no Royale em grupo, `t` cai (em vez de morrer) se alguém do esquadrão está de pé. */
function royaleCanFall(ctx: SimContext, t: number): boolean {
  const st = ctx.royale;
  if (st === null || st.squad <= 1) return false;
  const s = ctx.s;
  for (let e = 0; e < s.count; e++) {
    if (e === t || s.alive[e] === 0 || s.kind[e] !== ENTITY_KIND.bobo || s.team[e] !== s.team[t]) continue;
    if ((s.flags[e]! & (F.dead | F.downed)) === 0) return true;
  }
  return false;
}

/** Passo 5: aplica a fila de dano na ordem em que foi gerada. */
export function damageSystem(ctx: SimContext): void {
  const s = ctx.s;
  const q = ctx.damage;
  for (let i = 0; i < q.count; i++) {
    const t = q.target[i]!;
    if (s.alive[t] === 0 || (s.flags[t]! & F.dead) !== 0) continue;
    // M3 (fase 2c): caído não toma dano; só sangrar até o fim e o plano de morte acabam com ele.
    const weaponOf = q.weapon[i]!;
    // M7 (fase 6): no Royale, o caído continua tomando dano (o tiro e a zona acabam com ele).
    if (
      (s.flags[t]! & F.downed) !== 0 &&
      ctx.royale === null &&
      weaponOf !== WEAPON_BLEED_OUT &&
      weaponOf !== WEAPON_KILL_PLANE
    )
      continue;
    const source = q.attacker[i]!;
    let amount = q.amount[i]!;
    // M6 (fase 5): no Paintball, todo dano de tinta (a bola ou o respingo do balde) é um acerto inteiro; os
    // multiplicadores de dano não mudam o acerto, mas o fogo amigo e o "um tiro mata" abaixo continuam valendo.
    const paint = ctx.paintHits > 0 && isPaintWeapon(weaponOf);
    if (paint && amount > 0) amount = paintDamage(ctx, maxHpOf(ctx, t));
    // M2 (fase 3b): multiplicador de dano de quem atacou (regra do bot).
    if (source !== NULL_ENTITY && s.isCurrent(source)) {
      const a = source & 0xffff;
      if (!paint) amount *= ctx.rules.damageMult[a]! * ctx.mods.damageMul;
      // M2 (fase 4e): fogo amigo pela metade ou inteiro; um tiro mata (só dano de arma, nunca no aliado sem fogo amigo).
      if (a !== t && !hostile(ctx, a, t)) amount *= ctx.mods.friendlyFire;
      // M7 (fase 2, revisão): o colete do BoboStrike antes do "um tiro mata".
      if (hasArmor(ctx) && armored(weaponOf)) amount = strikeArmor(ctx, t, amount, q.part[i] === PART_HEAD);
      if (ctx.mods.oneShot && amount > 0) amount = Math.max(amount, s.health[t]!);
    } else if (hasArmor(ctx) && armored(weaponOf)) {
      // Sem dono (a Boom Box): o colete também segura.
      amount = strikeArmor(ctx, t, amount, q.part[i] === PART_HEAD);
    }
    // M3 (fase 4d): insta-kill: qualquer dano de bobo mata o zumbi (menos o chefão). M6 (fase 6b): e o soldado da
    // horda (pelo dano de quem não é da horda).
    if (
      ctx.zombiesMode &&
      ctx.waves.instaTicks > 0 &&
      amount > 0 &&
      isHorde(ctx, t) &&
      (s.kind[t] !== ENTITY_KIND.zombie || s.zombieType[t] !== ZOMBIE_TYPE.boss) &&
      source !== NULL_ENTITY &&
      s.isCurrent(source) &&
      s.kind[source & 0xffff] === ENTITY_KIND.bobo &&
      !isHorde(ctx, source & 0xffff)
    ) {
      amount = Math.max(amount, s.health[t]!);
    }
    // Proteção de spawn segura dano de inimigo; queda e plano de morte passam.
    if (source !== NULL_ENTITY && (s.flags[t]! & F.spawnProtected) !== 0) amount = 0;
    if (ctx.match.phase === 'ended' && source !== NULL_ENTITY) amount = 0;
    // Plano de morte: o abate vai para quem feriu a vítima pouco antes (GDD §3.8); sem ninguém, é acidente.
    const attacker =
      source === NULL_ENTITY && q.weapon[i] === WEAPON_KILL_PLANE
        ? recentAttacker(ctx, t, ctx.killPlaneCreditTicks)
        : source;
    const id = s.idOf(t);
    const part = q.part[i]!;
    const bodyPart = q.bodyPart[i]! as FigurePart;
    if (amount > 0) {
      // M6 (fase 4): vampiro: quem fere um inimigo recupera o que tirou (até a vida dele).
      if (source !== NULL_ENTITY && modOn(ctx, MOD.vampire) && s.isCurrent(source)) {
        const a = source & 0xffff;
        if (
          a !== t &&
          s.kind[a] === ENTITY_KIND.bobo &&
          hostile(ctx, a, t) &&
          s.alive[a] === 1 &&
          (s.flags[a]! & F.dead) === 0
        ) {
          s.health[a] = Math.min(maxHpOf(ctx, a), s.health[a]! + Math.min(amount, Math.max(0, s.health[t]!)));
        }
      }
      s.health[t] = s.health[t]! - amount;
      s.lastDamageTick[t] = ctx.tick;
      s.lastAttacker[t] = attacker;
      if (source !== NULL_ENTITY) noteAttacker(ctx, t, source, amount);
      // M3 (fase 2b): o bobo que tira vida de um zumbi ganha os pontos do acerto.
      if (ctx.zombiesMode && isHorde(ctx, t)) award(ctx, attacker, ZOMBIE_POINTS.hit);
    }
    ctx.events.hit(ctx.tick, attacker, id, HIT_PARTS[part]!, bodyPart, amount, q.point, q.dir, i);
    if (s.health[t]! <= 0) {
      // M3 (fase 2c): no Bobo Zombies, o bobo cai em vez de morrer (menos no vazio e quando já sangrou).
      const canFall =
        ctx.zombiesMode &&
        s.kind[t] === ENTITY_KIND.bobo &&
        !isHorde(ctx, t) &&
        (s.flags[t]! & F.downed) === 0 &&
        weaponOf !== WEAPON_KILL_PLANE &&
        weaponOf !== WEAPON_BLEED_OUT;
      // M7 (fase 6): no Royale em grupo, cai com alguém do esquadrão de pé (e o caído tem a vida dele).
      const royaleFall =
        (s.flags[t]! & F.downed) === 0 &&
        weaponOf !== WEAPON_KILL_PLANE &&
        weaponOf !== WEAPON_BLEED_OUT &&
        royaleCanFall(ctx, t);
      if (canFall) knockDown(ctx, t, attacker);
      else if (royaleFall) {
        knockDown(ctx, t, attacker);
        s.health[t] = ROYALE.downHp;
      } else kill(ctx, t, attacker, weaponOf, part === PART_HEAD, bodyPart, i);
    }
  }
  q.count = 0;
}

/**
 * M3 (fase 2c): o bobo `t` cai. Sem ninguém de pé no time para levantar ele e com "levanta sozinho" sobrando, gasta
 * um e volta em `selfReviveTicks`; senão sangra por `bleedTicks`. Solta a granada que cozinhava (ela some).
 */
function knockDown(ctx: SimContext, t: number, by: EntityId): void {
  const s = ctx.s;
  const r = ctx.zombieRules;
  const w = ctx.waves;
  s.health[t] = 0;
  s.flags[t] = (s.flags[t]! & ~(F.sprinting | F.sliding | F.ads | F.firing | F.reloading)) | F.downed;
  // M3 (fase 4c): caiu, perde as vantagens.
  s.perks[t] = 0;
  s.cookTicks[t] = -1;
  s.quickNade[t] = 0;
  s.reviveTicks[t] = 0;
  s.reviver[t] = NULL_ENTITY;
  let helper = false;
  for (let e = 0; e < s.count; e++) {
    if (e === t || s.alive[e] === 0 || s.kind[e] !== ENTITY_KIND.bobo) continue;
    if ((s.flags[e]! & (F.dead | F.downed)) === 0 && s.team[e] === s.team[t]) helper = true;
  }
  if (!helper && w.selfRevivesLeft !== 0) {
    if (w.selfRevivesLeft > 0) w.selfRevivesLeft--;
    s.selfUp[t] = 1;
    s.downTicks[t] = r.selfReviveTicks;
  } else {
    s.selfUp[t] = 0;
    s.downTicks[t] = r.bleedTicks;
  }
  ctx.events.down(ctx.tick, s.idOf(t), by, 'down');
}

/** M3 (fase 4c): a vida máxima de `e` (a da regra, × 1,5 com a Chonky Cola no Bobo Zombies). */
export function maxHpOf(ctx: SimContext, e: number): number {
  const base = ctx.rules.maxHp[e]!;
  // M6 (fase 6b): o soldado da horda fica mais forte a cada onda.
  if (ctx.zombieArmed && isHorde(ctx, e))
    return Math.max(1, Math.round(base * hordeHpMul(ctx.waves.wave, ctx.zombieRules.hpMul)));
  return ctx.zombiesMode && (ctx.s.perks[e]! & PERK.chonky) !== 0 ? Math.round(base * ZOMBIE_PERKS.chonkyHpMul) : base;
}

/** M3 (fase 2c): o bobo caído `t` levanta (por `by`, ou sozinho) com uma parte da vida. */
export function standUp(ctx: SimContext, t: number, by: EntityId): void {
  const s = ctx.s;
  const self = s.selfUp[t] === 1;
  s.flags[t] = s.flags[t]! & ~F.downed;
  s.health[t] = Math.max(1, Math.round(maxHpOf(ctx, t) * ZOMBIES_DOWN.revivedHpFrac));
  s.downTicks[t] = 0;
  s.selfUp[t] = 0;
  s.reviveTicks[t] = 0;
  s.reviver[t] = NULL_ENTITY;
  s.lastDamageTick[t] = ctx.tick;
  ctx.events.down(ctx.tick, s.idOf(t), self ? s.idOf(t) : by, self ? 'selfRevive' : 'revive');
}

/** M3 (fase 2c): sangrou até o fim: o golpe final sai pela fila de dano (o abate não é de ninguém). */
export function bleedOut(ctx: SimContext, t: number): void {
  const s = ctx.s;
  const t3 = t * 3;
  ctx.damage.push(
    t,
    NULL_ENTITY,
    1e9,
    PART_TORSO,
    1 as FigurePart,
    WEAPON_BLEED_OUT,
    s.position[t3]!,
    s.position[t3 + 1]!,
    s.position[t3 + 2]!,
  );
}

/** M3 (fase 2b): pontos para o bobo `who` (× a economia da partida); zumbi, morto ou ninguém não ganha. */
function award(ctx: SimContext, who: EntityId, base: number): void {
  const s = ctx.s;
  if (who === NULL_ENTITY || !s.isCurrent(who)) return;
  const e = who & 0xffff;
  if (s.kind[e] !== ENTITY_KIND.bobo || isHorde(ctx, e)) return;
  // M3 (fase 4d): pontos em dobro.
  const mul = ctx.waves.doubleTicks > 0 ? 2 : 1;
  s.points[e] = s.points[e]! + Math.round(base * mul * ctx.zombieRules.economy);
}

/**
 * Guarda o golpe de um inimigo em `t` (assistência e crédito do plano de morte). O mesmo agressor soma o dano; o dano
 * de fora da janela da assistência não conta. Sem vaga, entra no lugar do golpe mais antigo.
 */
function noteAttacker(ctx: SimContext, t: number, attacker: EntityId, amount: number): void {
  const s = ctx.s;
  if (!s.isCurrent(attacker) || !hostile(ctx, attacker & 0xffff, t)) return;
  const base = t * R;
  let slot = -1;
  let empty = -1;
  let oldest = -1;
  for (let k = base; k < base + R; k++) {
    const from = s.recentFrom[k]!;
    if (from === attacker) {
      slot = k;
      break;
    }
    if (from === NULL_ENTITY) {
      if (empty < 0) empty = k;
    } else if (oldest < 0 || s.recentTick[k]! < s.recentTick[oldest]!) oldest = k;
  }
  if (slot < 0) {
    slot = empty >= 0 ? empty : oldest;
    s.recentFrom[slot] = attacker;
    s.recentDamage[slot] = 0;
  } else if (ctx.tick - s.recentTick[slot]! > ctx.assistWindowTicks) s.recentDamage[slot] = 0;
  s.recentDamage[slot] = s.recentDamage[slot]! + amount;
  s.recentTick[slot] = ctx.tick;
}

/** O inimigo que feriu `t` por último, se foi há no máximo `windowTicks` e ele ainda existe; senão `NULL_ENTITY`. */
function recentAttacker(ctx: SimContext, t: number, windowTicks: number): EntityId {
  const s = ctx.s;
  let best: EntityId = NULL_ENTITY;
  let bestTick = ctx.tick - windowTicks - 1;
  for (let k = t * R; k < t * R + R; k++) {
    const from = s.recentFrom[k]!;
    if (from === NULL_ENTITY || s.recentTick[k]! <= bestTick || !s.isCurrent(from)) continue;
    best = from;
    bestTick = s.recentTick[k]!;
  }
  return best;
}

/**
 * Conta as assistências da morte de `t` (quem não é o matador e fez `assistMinDamage` ou mais na janela) e devolve
 * a maior delas (`NULL_ENTITY` se nenhuma).
 */
function creditAssists(ctx: SimContext, t: number, killer: EntityId): EntityId {
  const s = ctx.s;
  let assister: EntityId = NULL_ENTITY;
  let best = 0;
  for (let k = t * R; k < t * R + R; k++) {
    const from = s.recentFrom[k]!;
    if (from === NULL_ENTITY || from === killer || !s.isCurrent(from)) continue;
    if (ctx.tick - s.recentTick[k]! > ctx.assistWindowTicks) continue;
    const dmg = s.recentDamage[k]!;
    if (dmg < ctx.assistMinDamage) continue;
    const a = from & 0xffff;
    s.assists[a] = s.assists[a]! + 1;
    if (dmg > best) {
      best = dmg;
      assister = from;
    }
  }
  return assister;
}

function kill(
  ctx: SimContext,
  t: number,
  killer: EntityId,
  weapon: number,
  headshot: boolean,
  bodyPart: FigurePart,
  item: number,
): void {
  const s = ctx.s;
  const q = ctx.damage;
  s.health[t] = 0;
  // Morreu cozinhando a granada: ela cai da mão com o pavio que sobrou (no arremesso rápido, a do slot de arremesso).
  if (s.cookTicks[t]! >= 0) {
    const quick = s.quickNade[t] === 1;
    const slotK = quick ? WEAPON_SLOT.throwable : s.slot[t]!;
    const held = weaponDef(quick ? s.loadout[t * WEAPON_SLOT_COUNT + slotK]! : s.weapon[t]!);
    s.quickNade[t] = 0;
    if (held !== null) {
      const k = t * WEAPON_SLOT_COUNT + slotK;
      if (s.slotClip[k]! > 0) s.slotClip[k] = s.slotClip[k]! - 1;
      const t3 = t * 3;
      launchProjectile(
        ctx,
        s.idOf(t),
        held,
        s.position[t3]!,
        s.position[t3 + 1]! + 1,
        s.position[t3 + 2]!,
        0,
        0,
        0,
        s.cookTicks[t]!,
      );
    }
    s.cookTicks[t] = -1;
  }
  s.flags[t] = (s.flags[t]! & F.onGround) | F.dead;
  const t3 = t * 3;
  s.velocity[t3] = 0;
  s.velocity[t3 + 2] = 0;
  // +1: o spawnSystem roda no MESMO tick (passo 7) e já desconta um. Assim o bobo fica morto exatamente
  // `respawnTicks` ticks (no mínimo 1, mesmo com `respawnS = 0`), e a IA e o render enxergam a morte.
  const zombie = s.kind[t] === ENTITY_KIND.zombie;
  s.respawnTicks[t] = (zombie ? ctx.zombieRespawnTicks : ctx.respawnTicks) + 1;
  s.reloadTicks[t] = 0;
  s.slideTicks[t] = 0;
  s.adsAmount[t] = 0;
  s.burstShots[t] = 0;
  s.recoilPitch[t] = 0;
  s.recoilYaw[t] = 0;
  s.deaths[t] = s.deaths[t]! + 1;
  // M3 (fase 2b): o bônus do abate de zumbi (na cabeça e de faca valem mais). M6 (fase 6b): e do soldado da horda.
  const horde = ctx.zombiesMode && isHorde(ctx, t);
  if (horde) {
    const bonus =
      weapon === WEAPON_CODE.knife
        ? ZOMBIE_POINTS.knifeKill
        : headshot
          ? ZOMBIE_POINTS.headshotKill
          : ZOMBIE_POINTS.kill;
    award(ctx, killer, bonus);
  }
  if (killer !== NULL_ENTITY && s.isCurrent(killer)) {
    const k = killer & 0xffff;
    if (hostile(ctx, k, t)) {
      s.kills[k] = s.kills[k]! + 1;
      // M7 (fase 2): o dinheiro do abate no BoboStrike.
      if (ctx.strike !== null && s.kind[k] === ENTITY_KIND.bobo) strikeKill(ctx, k, t);
      // Placar dos times: só bobo matando bobo (o zumbi do estresse fica fora do TDM). M6 (fase 1): no Domination o
      // placar é dos pontos.
      if (
        !ctx.ffa &&
        !zombie &&
        !ctx.zombiesMode &&
        ctx.rounds === null &&
        ctx.royale === null &&
        s.kind[k] === ENTITY_KIND.bobo &&
        ctx.domination === null &&
        ctx.party.infectedSpeed <= 0 &&
        ctx.party.jugg === null
      ) {
        const team = s.team[k]!;
        if (team < MAX_TEAMS) ctx.match.teamScore[team] = ctx.match.teamScore[team]! + 1;
      }
    }
  }
  // M6 (fase 2): o Gun Game (o nível e a arma) e o Infection (quem morre vira infectado). Fase 3: o Juggernaut (quem
  // derruba o Jugg vira o Jugg).
  if (partyActive(ctx.party)) partyKill(ctx, t, killer, weapon);
  // M3 (fase 3b): o Chonker explode em gosma ao morrer (machuca os bobos perto; no vazio, não).
  if (ctx.zombiesMode && zombie && s.zombieType[t] === ZOMBIE_TYPE.chonker && weapon !== WEAPON_KILL_PLANE) {
    explode(ctx, s.position[t * 3]!, s.position[t * 3 + 1]! + 1, s.position[t * 3 + 2]!, ZOMBIE_GOO, s.idOf(t), -1);
  }
  // M3 (fase 4d): o zumbi abatido por um bobo (não no vazio nem pela bomba) pode deixar um drop. M6 (fase 6b): o
  // soldado da horda também (o Carpinteiro, sem tábua na Horda armada, vira munição).
  if (
    horde &&
    weapon !== WEAPON_KILL_PLANE &&
    killer !== NULL_ENTITY &&
    s.isCurrent(killer) &&
    s.kind[killer & 0xffff] === ENTITY_KIND.bobo &&
    !isHorde(ctx, killer & 0xffff) &&
    ctx.waves.drops < ZOMBIE_DROPS.perWave &&
    ctx.rngZombies.next() < ctx.dropChance
  ) {
    ctx.waves.drops++;
    const kind = 1 + ctx.rngZombies.int(0, DROP_KINDS);
    dropZombieDrop(ctx, t, ctx.zombieArmed && kind === PICKUP_KIND.carpenter ? PICKUP_KIND.maxAmmo : kind);
  }
  // Caixinha de munição (Bobo Warfare): quem caiu no vazio não deixa (ela sumiria lá embaixo).
  if (ctx.warfare && ctx.paintHits === 0 && !zombie && weapon !== WEAPON_KILL_PLANE) dropAmmoBox(ctx, t);
  // M7 (fase 6): no Royale, a primária, o colete e os kits de quem morreu ficam no chão.
  if (ctx.royale !== null && !zombie && weapon !== WEAPON_KILL_PLANE) royaleDrops(ctx, t);
  // M2 (fase 3b): "explode ao morrer" (regra do bot): a explosão do foguete no peito, de quem morreu.
  if ((ctx.rules.flags[t]! & RULE_FLAG.explodeOnDeath) !== 0 && weapon !== WEAPON_KILL_PLANE) {
    explode(ctx, s.position[t * 3]!, s.position[t * 3 + 1]! + 1, s.position[t * 3 + 2]!, WEAPON_ROCKET, s.idOf(t), -1);
  }
  // M6 (fase 4): tudo explode (quem morre, menos no vazio; não no Infection e no Juggernaut, que trocam o time de
  // quem morre antes de a explosão ferir) e a troca de arma por abate (fora dos modos de festa e do Bobo Zombies).
  if (
    modOn(ctx, MOD.explosive) &&
    weapon !== WEAPON_KILL_PLANE &&
    ctx.party.infectedSpeed <= 0 &&
    ctx.party.jugg === null
  ) {
    explode(ctx, s.position[t * 3]!, s.position[t * 3 + 1]! + 1, s.position[t * 3 + 2]!, CHAOS_BLAST, s.idOf(t), -1);
  }
  if (
    modOn(ctx, MOD.swapOnKill) &&
    !partyActive(ctx.party) &&
    !ctx.zombiesMode &&
    ctx.paintHits === 0 &&
    killer !== NULL_ENTITY &&
    s.isCurrent(killer)
  ) {
    const k = killer & 0xffff;
    if (k !== t && hostile(ctx, k, t) && canSwap(ctx, k)) swapPrimary(ctx, k);
  }
  const assister = creditAssists(ctx, t, killer);
  ctx.events.kill(ctx.tick, killer, s.idOf(t), weapon, headshot, bodyPart, q.dir, q.force[item]!, item, assister);
}

/**
 * Passo 6: contagem inicial, relógio, meta e morte súbita. Empate no fim (tempo ou meta) abre a morte súbita, se a
 * partida tiver; nela, o primeiro abate que desempata encerra, e o fim do relógio dela encerra empatado. Partida
 * terminada não tem mais dano de arma nem respawn.
 */
export function rulesSystem(ctx: SimContext): void {
  const m = ctx.match;
  if (m.phase === 'ended') return;
  if (m.phase === 'warmup') {
    if (m.countdownTicks > 0) m.countdownTicks--;
    if (m.countdownTicks === 0) {
      m.phase = 'playing';
      ctx.events.matchPhase(ctx.tick, 'playing');
    }
    return;
  }
  // M6 (fase 2): o modo de festa já decidiu (a escada fechada, os sobreviventes no fim ou ninguém sobrando).
  const party = ctx.party;
  if (party.winnerEntity !== NULL_ENTITY && ctx.s.isCurrent(party.winnerEntity)) {
    leaderEntity = party.winnerEntity;
    endMatch(ctx, ctx.s.team[party.winnerEntity & 0xffff]!);
    return;
  }
  if (party.winnerTeam !== -2) {
    endMatch(ctx, party.winnerTeam);
    return;
  }
  // M7 (fase 6): o Royale acaba com o último esquadrão vivo (no solo, o vencedor também é o bobo).
  const royale = ctx.royale;
  if (royale !== null && royale.data[ZONE.winner] !== ROYALE_UNDECIDED) {
    const team = royale.data[ZONE.winner]!;
    endMatch(ctx, team);
    if (royale.squad === 1 && team >= 0) {
      const s = ctx.s;
      for (let e = 0; e < s.count; e++) {
        if (s.alive[e] === 1 && s.kind[e] === ENTITY_KIND.bobo && s.team[e] === team) m.winnerEntity = s.idOf(e);
      }
    }
    return;
  }
  // M9 (fase 2): a eliminação do Sandbox acaba com o último time de pé (todos caindo no mesmo tick: empate).
  const survivor = sandboxSurvivor(ctx);
  if (survivor !== SANDBOX_UNDECIDED) {
    endMatch(ctx, survivor);
    return;
  }
  if (m.phase === 'suddenDeath') {
    const lead = leader(ctx);
    if (lead >= 0) endMatch(ctx, lead);
    else if (m.ticksLeft > 0 && --m.ticksLeft === 0) endMatch(ctx, -1);
    return;
  }
  let ended = false;
  if (m.ticksLeft > 0) {
    m.ticksLeft--;
    if (m.ticksLeft === 0) ended = true;
  }
  if (ctx.scoreLimit > 0) {
    if (ctx.ffa) {
      const s = ctx.s;
      for (let e = 0; e < s.count; e++) {
        if (s.alive[e] === 1 && s.kind[e] === ENTITY_KIND.bobo && s.kills[e]! >= ctx.scoreLimit) ended = true;
      }
    } else {
      for (let t = 0; t < MAX_TEAMS; t++) if (m.teamScore[t]! >= ctx.scoreLimit) ended = true;
    }
  }
  if (!ended) return;
  const lead = leader(ctx);
  if (lead < 0 && ctx.suddenDeathTicks > 0) {
    m.phase = 'suddenDeath';
    m.ticksLeft = ctx.suddenDeathTicks;
    ctx.events.matchPhase(ctx.tick, 'suddenDeath');
    return;
  }
  endMatch(ctx, lead);
}

/**
 * M5 (fase 5a): encerra a partida agora, com quem está na frente (empate sem ninguém na frente). O host online chama
 * quando volta de mais de 10 s em segundo plano num PvP (tecnico.md §13.4). Já encerrada, nada muda.
 */
export function finishMatch(ctx: SimContext): void {
  if (ctx.match.phase === 'ended') return;
  endMatch(ctx, ctx.royale !== null ? royaleLeader(ctx) : leader(ctx));
}

/** M7 (fase 6, revisão): no Royale, o esquadrão com mais gente de pé (empate: -1). */
function royaleLeader(ctx: SimContext): number {
  const s = ctx.s;
  const n = ctx.royale!.squads;
  let best = -1;
  let bestCount = 0;
  let tie = false;
  for (let t = 0; t < n; t++) {
    let count = 0;
    for (let e = 0; e < s.count; e++) {
      if (s.alive[e] === 0 || s.kind[e] !== ENTITY_KIND.bobo || s.team[e] !== t) continue;
      if ((s.flags[e]! & (F.dead | F.downed)) === 0) count++;
    }
    if (count > bestCount) {
      best = t;
      bestCount = count;
      tie = false;
    } else if (count > 0 && count === bestCount) tie = true;
  }
  return tie ? -1 : best;
}

function endMatch(ctx: SimContext, team: number): void {
  const m = ctx.match;
  m.phase = 'ended';
  m.winnerTeam = team;
  m.winnerEntity = (ctx.ffa || ctx.party.jugg !== null) && team >= 0 ? leaderEntity : NULL_ENTITY;
  ctx.events.matchPhase(ctx.tick, 'ended');
}

/** O bobo na frente no FFA (escrito por `leader`). */
let leaderEntity: EntityId = NULL_ENTITY;

/**
 * Time com mais pontos (no FFA, o time de quem tem mais abates, e o bobo vai em `leaderEntity`); empate = -1.
 */
function leader(ctx: SimContext): number {
  const s = ctx.s;
  let best = -1;
  let bestScore = -1;
  let tie = false;
  leaderEntity = NULL_ENTITY;
  // M9 (fase 2): na eliminação do Sandbox, quem tem mais gente viva.
  if (ctx.sandbox !== null && ctx.sandbox.elimination) return sandboxLeader(ctx);
  // M6 (fase 3): o Juggernaut também é de cada um (os pontos de Jugg), mesmo com os caçadores no mesmo time.
  if (ctx.ffa || ctx.party.jugg !== null) {
    for (let e = 0; e < s.count; e++) {
      if (s.alive[e] === 0 || s.kind[e] !== ENTITY_KIND.bobo) continue;
      // M9 (fase 4, revisão): o bot que o dono tirou de jogo (morto sem contagem, `respawnTicks` -1) não lidera.
      if (s.respawnTicks[e]! < 0 && (s.flags[e]! & F.dead) !== 0) continue;
      // M6 (fase 2): no Gun Game vence o nível mais alto (os pontos), não os abates.
      let k = ctx.party.ladder !== null || ctx.party.jugg !== null ? s.points[e]! : s.kills[e]!;
      // M7 (fase 0, revisão): no Jugg Fixo, quem aguenta as rodadas empata nos pontos: desempata pelos abates e depois
      // por menos mortes (escolha minha, revisável).
      if (ctx.party.juggFixed)
        k = k * 1_000_000 + Math.min(s.kills[e]!, 999) * 1000 + (999 - Math.min(s.deaths[e]!, 999));
      if (k > bestScore) {
        bestScore = k;
        best = s.team[e]!;
        leaderEntity = s.idOf(e);
        tie = false;
      } else if (k === bestScore) tie = true;
    }
    return tie ? -1 : best;
  }
  for (let t = 0; t < MAX_TEAMS; t++) {
    const sc = ctx.match.teamScore[t]!;
    if (sc > bestScore) {
      bestScore = sc;
      best = t;
      tie = false;
    } else if (sc === bestScore) tie = true;
  }
  return tie ? -1 : best;
}

/** Passo 7: respawn, fim da proteção de spawn e regeneração (só bobos nos modos `warfare.*`). */
export function spawnSystem(ctx: SimContext): void {
  const s = ctx.s;
  for (let e = 0; e < s.count; e++) {
    if (s.alive[e] === 0 || !isBody(s.kind[e]!)) continue;
    const fl = s.flags[e]!;
    if ((fl & F.dead) !== 0) {
      // M3 (fase 2a): no Bobo Zombies quem volta é o diretor de ondas (bobos na onda seguinte, zumbis do pool). M7
      // (fase 0): nas rodadas sem respawn, quem morre espera a próxima.
      // M7 (fase 6): no Royale, ninguém volta. M9 (fase 2): nem na eliminação do Sandbox.
      if (
        ctx.zombiesMode ||
        ctx.royale !== null ||
        (ctx.rounds !== null && !ctx.rounds.rules.respawn) ||
        (ctx.sandbox !== null && ctx.sandbox.elimination)
      )
        continue;
      if (s.respawnTicks[e]! > 0) s.respawnTicks[e]!--;
      if (s.respawnTicks[e] === 0 && ctx.match.phase !== 'ended') respawn(ctx, e, pickSpawn(ctx, e));
      continue;
    }
    if (s.spawnProtectTicks[e]! > 0 && --s.spawnProtectTicks[e]! === 0) s.flags[e] = fl & ~F.spawnProtected;
    if (
      (ctx.warfare || ctx.zombiesMode) &&
      ctx.paintHits === 0 &&
      s.kind[e] === ENTITY_KIND.bobo &&
      s.health[e]! < maxHpOf(ctx, e) &&
      ctx.tick - s.lastDamageTick[e]! >= ctx.regenDelayTicks
    ) {
      s.health[e] = Math.min(maxHpOf(ctx, e), s.health[e]! + ctx.regenPerTick);
    }
  }
}

/** Teto da nota (distância², m²): sem inimigo vivo, todo ponto empata nele (e o 1º da lista ganha, como antes). */
const SPAWN_SCORE_CAP = 1e8;
/** Cada inimigo que enxerga o ponto do TDM pesa mais que qualquer distância. */
const SIGHT_PENALTY = 1e9;
/** No TDM, contar até 3 inimigos à vista basta (mais que isso é igualmente ruim) e poupa raios. */
const SIGHT_COUNT_MAX = 3;
const sightHit = createRayHit();
let best0 = -1;
let best1 = -1;
let best2 = -1;

/**
 * Melhor ponto para renascer (gameplay.md §5.3). Candidatos: os do time (ou `-1`; FFA e zumbi: todos; sem nenhum,
 * qualquer ponto). Nota base = menor distância² até um inimigo vivo.
 * - FFA: em ordem de nota, os pontos a mais de `ffaSpawnMinDistM` de todo inimigo e sem linha de visão de nenhum; a
 *   visão só é testada até achar 3. Sem ponto seguro, cai na regra da distância.
 * - TDM: cada inimigo que enxerga o ponto tira `SIGHT_PENALTY` da nota; o sorteio fica entre os 3 melhores que têm
 *   tão poucos inimigos à vista quanto o melhor.
 * - Zumbi: só a distância.
 * O sorteio entre os 3 usa `rng.spawn`.
 */
export function pickSpawn(ctx: SimContext, e: number): number {
  const s = ctx.s;
  const spawns = ctx.spawns;
  const n = spawns.length;
  const score = ctx.spawnScore;
  const mark = ctx.spawnMark;
  const zombie = s.kind[e] === ENTITY_KIND.zombie;
  // M6 (fase 3): no Juggernaut os caçadores nascem em qualquer ponto (longe do Jugg), não numa base.
  const anyTeam = ctx.ffa || zombie || ctx.party.jugg !== null;
  // M2 (fase 5d): no Bobo Training, os bots (fora do time do jogador) nascem só nos pontos sem time, longe de qualquer
  // bobo: os alvos se espalham pela arena em vez de ir para a base do outro time.
  const spread = ctx.training && s.team[e] !== 0;
  let allowed = 0;
  for (let pass = 0; pass < 2 && allowed === 0; pass++) {
    for (let i = 0; i < n; i++) {
      const sp = spawns[i]!;
      const wrongTeam = spread ? sp.team !== -1 : !anyTeam && sp.team !== -1 && sp.team !== s.team[e];
      if (pass === 0 && wrongTeam) {
        score[i] = -Infinity;
        continue;
      }
      score[i] = Math.min(
        spread ? nearestBody2(ctx, e, sp.x, sp.z) : nearestEnemy2(ctx, e, sp.x, sp.z),
        SPAWN_SCORE_CAP,
      );
      allowed++;
    }
  }
  if (!zombie && ctx.ffa) {
    const minD2 = MATCH_DEFAULTS.ffaSpawnMinDistM * MATCH_DEFAULTS.ffaSpawnMinDistM;
    mark.fill(0, 0, n);
    let found = 0;
    let a0 = -1;
    let a1 = -1;
    let a2 = -1;
    while (found < 3) {
      let pick = -1;
      let v = -Infinity;
      for (let i = 0; i < n; i++) {
        if (mark[i] === 0 && score[i]! > v) {
          v = score[i]!;
          pick = i;
        }
      }
      // Daqui para baixo todo ponto está a menos de 20 m de algum inimigo.
      if (pick < 0 || v <= minD2) break;
      mark[pick] = 1;
      const sp = spawns[pick]!;
      if (enemiesSeeing(ctx, e, sp.x, sp.y, sp.z, 1) > 0) continue;
      if (found === 0) a0 = pick;
      else if (found === 1) a1 = pick;
      else a2 = pick;
      found++;
    }
    if (a0 >= 0) return chooseSpawn(ctx, a0, a1, a2);
  } else if (!zombie) {
    for (let i = 0; i < n; i++) {
      if (score[i] === -Infinity) continue;
      const sp = spawns[i]!;
      const seen = enemiesSeeing(ctx, e, sp.x, sp.y, sp.z, SIGHT_COUNT_MAX);
      mark[i] = seen;
      score[i] = score[i]! - seen * SIGHT_PENALTY;
    }
    top3(score, n);
    const fewest = mark[best0]!;
    return chooseSpawn(
      ctx,
      best0,
      best1 >= 0 && mark[best1] === fewest ? best1 : -1,
      best2 >= 0 && mark[best1] === fewest && mark[best2] === fewest ? best2 : -1,
    );
  }
  top3(score, n);
  return chooseSpawn(ctx, best0, best1, best2);
}

/** Menor distância² (no plano) de um inimigo vivo de `e` até (x, z); `Infinity` se não houver. */
/** M2 (fase 5d): distância² até o bobo vivo mais perto (de qualquer time), fora o próprio. */
function nearestBody2(ctx: SimContext, e: number, x: number, z: number): number {
  const s = ctx.s;
  let best = Infinity;
  for (let j = 0; j < s.count; j++) {
    if (j === e || s.alive[j] === 0 || !isBody(s.kind[j]!) || (s.flags[j]! & F.dead) !== 0) continue;
    const dx = s.position[j * 3]! - x;
    const dz = s.position[j * 3 + 2]! - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) best = d2;
  }
  return best;
}

function nearestEnemy2(ctx: SimContext, e: number, x: number, z: number): number {
  const s = ctx.s;
  let best = Infinity;
  for (let j = 0; j < s.count; j++) {
    if (s.alive[j] === 0 || !isBody(s.kind[j]!) || (s.flags[j]! & F.dead) !== 0) continue;
    if (!hostile(ctx, e, j)) continue;
    const dx = s.position[j * 3]! - x;
    const dz = s.position[j * 3 + 2]! - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) best = d2;
  }
  return best;
}

/**
 * Quantos inimigos vivos de `e` enxergam o ponto (pés em x, y, z): olho no olho, dentro do alcance de visão, sem
 * bloco ou prop que tape a vista no caminho. Para de contar em `max`.
 */
function enemiesSeeing(ctx: SimContext, e: number, x: number, y: number, z: number, max: number): number {
  const s = ctx.s;
  // M9: o olho normal de todos, mesmo com o Mini e os Bots gigantes (`CHAOS_SCALE`).
  const eye = METRICS.eyeHeight;
  const range = MATCH_DEFAULTS.viewDistanceM;
  let n = 0;
  for (let j = 0; j < s.count && n < max; j++) {
    if (s.alive[j] === 0 || !isBody(s.kind[j]!) || (s.flags[j]! & F.dead) !== 0) continue;
    if (!hostile(ctx, e, j)) continue;
    const ox = s.position[j * 3]!;
    const oy = s.position[j * 3 + 1]! + eye;
    const oz = s.position[j * 3 + 2]!;
    const dx = x - ox;
    const dy = y + eye - oy;
    const dz = z - oz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > range) continue;
    if (d < 1e-6) {
      n++;
      continue;
    }
    const blocked = raycastGrid(
      ctx.grid,
      ctx.blocks,
      ox,
      oy,
      oz,
      dx / d,
      dy / d,
      dz / d,
      d,
      BLOCK_FLAG.blocksSight,
      sightHit,
      ctx.colliders,
    );
    if (!blocked) n++;
  }
  return n;
}

/** Os 3 maiores de `score` (fora os `-Infinity`), em `best0..2` (-1 = faltou); no empate, o de índice menor. */
function top3(score: Float64Array, n: number): void {
  best0 = -1;
  best1 = -1;
  best2 = -1;
  let s0 = -Infinity;
  let s1 = -Infinity;
  let s2 = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = score[i]!;
    if (v === -Infinity) continue;
    if (v > s0) {
      best2 = best1;
      s2 = s1;
      best1 = best0;
      s1 = s0;
      best0 = i;
      s0 = v;
    } else if (v > s1) {
      best2 = best1;
      s2 = s1;
      best1 = i;
      s1 = v;
    } else if (v > s2) {
      best2 = i;
      s2 = v;
    }
  }
}

/** Sorteia um dos até 3 pontos (`-1` = não há; `a` sempre existe). */
function chooseSpawn(ctx: SimContext, a: number, b: number, c: number): number {
  const n = b < 0 ? 1 : c < 0 ? 2 : 3;
  const k = ctx.rngSpawn.int(0, n);
  return k === 0 ? a : k === 1 ? b : c;
}

/** A 1ª primária permitida pela máscara (na ordem do arsenal), ou `WEAPON_NONE` (a lista só tem outros slots). */
export function allowedPrimaryOrNone(mask: number): number {
  const code = firstAllowedPrimary(mask);
  return code < 0 ? WEAPON_NONE : code;
}

/** Põe o bobo (ou zumbi) `e` vivo no spawn `index`, com vida, munição e proteção cheias. */
export function respawn(ctx: SimContext, e: number, index: number): void {
  const s = ctx.s;
  const sp = ctx.spawns[index]!;
  const zombie = s.kind[e] === ENTITY_KIND.zombie;
  const e3 = e * 3;
  s.position[e3] = sp.x;
  s.position[e3 + 1] = sp.y;
  s.position[e3 + 2] = sp.z;
  s.prevPosition[e3] = sp.x;
  s.prevPosition[e3 + 1] = sp.y;
  s.prevPosition[e3 + 2] = sp.z;
  s.velocity[e3] = 0;
  s.velocity[e3 + 1] = 0;
  s.velocity[e3 + 2] = 0;
  s.yaw[e] = sp.yaw;
  s.prevYaw[e] = sp.yaw;
  s.pitch[e] = 0;
  s.prevPitch[e] = 0;
  s.perks[e] = 0;
  s.health[e] = zombie ? ctx.zombieHp : ctx.rules.maxHp[e]!;
  // Loadout do Bobo Warfare (gameplay.md §4.1): a primária escolhida (`primaryChoice`), pistola, faca e 2 granadas,
  // com pente e reserva cheios. Zumbi não tem arma (o render não desenha nenhuma; o golpe é o `meleeSystem`).
  const k = e * WEAPON_SLOT_COUNT;
  // M2 (fase 3b): armas permitidas (regra do bot): o que não está na lista sai do loadout; a primária vira a 1ª
  // permitida; a mão começa no 1º slot que sobrou. M10 (AK5): a secundária é o revólver quando a lista o cita.
  const mask = ctx.rules.weaponMask[e]!;
  let primary = isPrimaryWeapon(s.primaryChoice[e]!) ? s.primaryChoice[e]! : DEFAULT_PRIMARY;
  if (mask !== 0 && (mask & weaponMaskBit(primary)) === 0) primary = allowedPrimaryOrNone(mask);
  let first = -1;
  for (let slot = 0; slot < WEAPON_SLOT_COUNT; slot++) {
    let code = zombie
      ? WEAPON_NONE
      : slot === WEAPON_SLOT.primary
        ? primary
        : slot === WEAPON_SLOT.secondary
          ? loadoutSecondary(mask)
          : (DEFAULT_LOADOUT_REST[slot - 1] ?? WEAPON_NONE);
    // M3 (fase 4a): no Bobo Zombies, o humano nasce sem a primária (vem da parede ou da caixa); os bots, com ela.
    if (slot === 0 && ctx.zombiesMode && s.controller[e]! < BOT_CONTROLLER_BASE) code = WEAPON_NONE;
    if (mask !== 0 && code !== WEAPON_NONE && (mask & weaponMaskBit(code)) === 0) code = WEAPON_NONE;
    const def = weaponDef(code);
    s.loadout[k + slot] = code;
    s.slotClip[k + slot] = def ? def.clipSize : 0;
    s.slotReserve[k + slot] = def ? def.reserve : 0;
    if (first < 0 && def !== null) first = slot;
  }
  s.slot[e] = first < 0 ? 0 : first;
  s.weapon[e] = s.loadout[k + s.slot[e]!]!;
  // M6 (fase 2): a arma do nível (Gun Game) ou a faca do infectado.
  if (partyActive(ctx.party)) partyLoadout(ctx, e);
  // M6 (fase 5): as armas de tinta.
  if (ctx.paintHits > 0 && !partyActive(ctx.party)) paintLoadout(ctx, e);
  // M7 (fase 6): o Royale começa só com a pistola.
  if (ctx.royale !== null && !zombie) royaleLoadout(ctx, e);
  // M11 (fase 4): com as armas no mapa, sem a primária (ela está no chão).
  if (ctx.mapWeapons !== null && !zombie) mapWeaponLoadout(ctx, e);
  s.cookTicks[e] = -1;
  s.quickNade[e] = 0;
  s.adsAmount[e] = 0;
  s.burstShots[e] = 0;
  s.recoilPitch[e] = 0;
  s.recoilYaw[e] = 0;
  s.coyoteTicks[e] = 0;
  s.jumpBufferTicks[e] = 0;
  s.slideTicks[e] = 0;
  s.slideCooldownTicks[e] = 0;
  s.slideBufferTicks[e] = 0;
  // M8 (fase 7): o Arcade.
  s.airJumps[e] = 0;
  s.groundTicks[e] = 0;
  s.landSpeed[e] = 0;
  s.slideSpeed[e] = 0;
  s.wallKeys[e * 2] = 0;
  s.wallKeys[e * 2 + 1] = 0;
  s.airPeakY[e] = sp.y;
  s.fireCooldownS[e] = 0;
  s.reloadTicks[e] = 0;
  s.switchTicks[e] = 0;
  s.sprintFireDelayTicks[e] = 0;
  s.respawnTicks[e] = 0;
  const protect = zombie ? 0 : ctx.spawnProtectTicks;
  s.spawnProtectTicks[e] = protect;
  s.lastDamageTick[e] = -1_000_000;
  s.lastAttacker[e] = NULL_ENTITY;
  s.recentFrom.fill(NULL_ENTITY, e * R, e * R + R);
  s.recentDamage.fill(0, e * R, e * R + R);
  s.recentTick.fill(0, e * R, e * R + R);
  s.unstuckCount[e] = 0;
  s.flags[e] = F.onGround | (protect > 0 ? F.spawnProtected : 0);
  ctx.events.spawn(ctx.tick, s.idOf(e));
}
