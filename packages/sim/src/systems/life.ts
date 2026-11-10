import type { FigurePart } from '@boboforces/format';
import { BLOCK_FLAG, createRayHit, raycastGrid } from '@boboforces/world';
import { METRICS } from '../config/metrics.ts';
import { MATCH_DEFAULTS } from '../config/rules.ts';
import { ZOMBIE_POINTS, ZOMBIE_TYPE, ZOMBIES_DOWN } from '../config/zombie.ts';
import { MAX_TEAMS, RECENT_ATTACKERS } from '../constants.ts';
import { WEAPON_SLOT_COUNT } from '@boboforces/input';
import {
  DEFAULT_LOADOUT_REST,
  DEFAULT_PRIMARY,
  isPrimaryWeapon,
  WEAPON_CODE,
  WEAPON_ROCKET,
  ZOMBIE_GOO,
  WEAPONS,
  weaponDef,
} from '../config/weapons.ts';
import { dropAmmoBox } from './pickups.ts';
import { explode, launchProjectile } from './projectiles.ts';
import {
  HIT_PARTS,
  hostile,
  isBody,
  PART_HEAD,
  PART_TORSO,
  RULE_FLAG,
  WEAPON_BLEED_OUT,
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

/** Passo 5: aplica a fila de dano na ordem em que foi gerada. */
export function damageSystem(ctx: SimContext): void {
  const s = ctx.s;
  const q = ctx.damage;
  for (let i = 0; i < q.count; i++) {
    const t = q.target[i]!;
    if (s.alive[t] === 0 || (s.flags[t]! & F.dead) !== 0) continue;
    // M3 (fase 2c): caído não toma dano; só sangrar até o fim e o plano de morte acabam com ele.
    const weaponOf = q.weapon[i]!;
    if ((s.flags[t]! & F.downed) !== 0 && weaponOf !== WEAPON_BLEED_OUT && weaponOf !== WEAPON_KILL_PLANE) continue;
    const source = q.attacker[i]!;
    let amount = q.amount[i]!;
    // M2 (fase 3b): multiplicador de dano de quem atacou (regra do bot).
    if (source !== NULL_ENTITY && s.isCurrent(source)) {
      const a = source & 0xffff;
      amount *= ctx.rules.damageMult[a]! * ctx.mods.damageMul;
      // M2 (fase 4e): fogo amigo pela metade ou inteiro; um tiro mata (só dano de arma, nunca no aliado sem fogo amigo).
      if (a !== t && !hostile(ctx, a, t)) amount *= ctx.mods.friendlyFire;
      if (ctx.mods.oneShot && amount > 0) amount = Math.max(amount, s.health[t]!);
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
      s.health[t] = s.health[t]! - amount;
      s.lastDamageTick[t] = ctx.tick;
      s.lastAttacker[t] = attacker;
      if (source !== NULL_ENTITY) noteAttacker(ctx, t, source, amount);
      // M3 (fase 2b): o bobo que tira vida de um zumbi ganha os pontos do acerto.
      if (ctx.zombiesMode && s.kind[t] === ENTITY_KIND.zombie) award(ctx, attacker, ZOMBIE_POINTS.hit);
    }
    ctx.events.hit(ctx.tick, attacker, id, HIT_PARTS[part]!, bodyPart, amount, q.point, q.dir, i);
    if (s.health[t]! <= 0) {
      // M3 (fase 2c): no Bobo Zombies, o bobo cai em vez de morrer (menos no vazio e quando já sangrou).
      const canFall =
        ctx.zombiesMode &&
        s.kind[t] === ENTITY_KIND.bobo &&
        (s.flags[t]! & F.downed) === 0 &&
        weaponOf !== WEAPON_KILL_PLANE &&
        weaponOf !== WEAPON_BLEED_OUT;
      if (canFall) knockDown(ctx, t, attacker);
      else kill(ctx, t, attacker, weaponOf, part === PART_HEAD, bodyPart, i);
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
  s.cookTicks[t] = -1;
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

/** M3 (fase 2c): o bobo caído `t` levanta (por `by`, ou sozinho) com uma parte da vida. */
export function standUp(ctx: SimContext, t: number, by: EntityId): void {
  const s = ctx.s;
  const self = s.selfUp[t] === 1;
  s.flags[t] = s.flags[t]! & ~F.downed;
  s.health[t] = Math.max(1, Math.round(ctx.rules.maxHp[t]! * ZOMBIES_DOWN.revivedHpFrac));
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
  if (s.kind[e] !== ENTITY_KIND.bobo) return;
  s.points[e] = s.points[e]! + Math.round(base * ctx.zombieRules.economy);
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
  // Morreu cozinhando a granada: ela cai da mão com o pavio que sobrou.
  if (s.cookTicks[t]! >= 0) {
    const held = weaponDef(s.weapon[t]!);
    if (held !== null) {
      const k = t * WEAPON_SLOT_COUNT + s.slot[t]!;
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
  // M3 (fase 2b): o bônus do abate de zumbi (na cabeça e de faca valem mais).
  if (ctx.zombiesMode && zombie) {
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
      // Placar dos times: só bobo matando bobo (o zumbi do estresse fica fora do TDM).
      if (!ctx.ffa && !zombie && s.kind[k] === ENTITY_KIND.bobo) {
        const team = s.team[k]!;
        if (team < MAX_TEAMS) ctx.match.teamScore[team] = ctx.match.teamScore[team]! + 1;
      }
    }
  }
  // M3 (fase 3b): o Chonker explode em gosma ao morrer (machuca os bobos perto; no vazio, não).
  if (ctx.zombiesMode && zombie && s.zombieType[t] === ZOMBIE_TYPE.chonker && weapon !== WEAPON_KILL_PLANE) {
    explode(ctx, s.position[t * 3]!, s.position[t * 3 + 1]! + 1, s.position[t * 3 + 2]!, ZOMBIE_GOO, s.idOf(t), -1);
  }
  // Caixinha de munição (Bobo Warfare): quem caiu no vazio não deixa (ela sumiria lá embaixo).
  if (ctx.warfare && !zombie && weapon !== WEAPON_KILL_PLANE) dropAmmoBox(ctx, t);
  // M2 (fase 3b): "explode ao morrer" (regra do bot): a explosão do foguete no peito, de quem morreu.
  if ((ctx.rules.flags[t]! & RULE_FLAG.explodeOnDeath) !== 0 && weapon !== WEAPON_KILL_PLANE) {
    explode(ctx, s.position[t * 3]!, s.position[t * 3 + 1]! + 1, s.position[t * 3 + 2]!, WEAPON_ROCKET, s.idOf(t), -1);
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

function endMatch(ctx: SimContext, team: number): void {
  const m = ctx.match;
  m.phase = 'ended';
  m.winnerTeam = team;
  m.winnerEntity = ctx.ffa && team >= 0 ? leaderEntity : NULL_ENTITY;
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
  if (ctx.ffa) {
    for (let e = 0; e < s.count; e++) {
      if (s.alive[e] === 0 || s.kind[e] !== ENTITY_KIND.bobo) continue;
      const k = s.kills[e]!;
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
      // M3 (fase 2a): no Bobo Zombies quem volta é o diretor de ondas (bobos na onda seguinte, zumbis do pool).
      if (ctx.zombiesMode) continue;
      if (s.respawnTicks[e]! > 0) s.respawnTicks[e]!--;
      if (s.respawnTicks[e] === 0 && ctx.match.phase !== 'ended') respawn(ctx, e, pickSpawn(ctx, e));
      continue;
    }
    if (s.spawnProtectTicks[e]! > 0 && --s.spawnProtectTicks[e]! === 0) s.flags[e] = fl & ~F.spawnProtected;
    if (
      (ctx.warfare || ctx.zombiesMode) &&
      s.kind[e] === ENTITY_KIND.bobo &&
      s.health[e]! < ctx.rules.maxHp[e]! &&
      ctx.tick - s.lastDamageTick[e]! >= ctx.regenDelayTicks
    ) {
      s.health[e] = Math.min(ctx.rules.maxHp[e]!, s.health[e]! + ctx.regenPerTick);
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
  const anyTeam = ctx.ffa || zombie;
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

/** A 1ª primária permitida pela máscara, ou `WEAPON_NONE` (a lista só tem armas de outros slots). */
function firstAllowedPrimary(mask: number): number {
  for (let code = 0; code < WEAPONS.length; code++)
    if ((mask & (1 << code)) !== 0 && isPrimaryWeapon(code)) return code;
  return WEAPON_NONE;
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
  s.health[e] = zombie ? ctx.zombieHp : ctx.rules.maxHp[e]!;
  // Loadout do Bobo Warfare (gameplay.md §4.1): a primária escolhida (`primaryChoice`), pistola, faca e 2 granadas,
  // com pente e reserva cheios. Zumbi não tem arma (o render não desenha nenhuma; o golpe é o `meleeSystem`).
  const k = e * WEAPON_SLOT_COUNT;
  // M2 (fase 3b): armas permitidas (regra do bot): o que não está na lista sai do loadout; a primária vira a 1ª
  // permitida; a mão começa no 1º slot que sobrou.
  const mask = ctx.rules.weaponMask[e]!;
  let primary = isPrimaryWeapon(s.primaryChoice[e]!) ? s.primaryChoice[e]! : DEFAULT_PRIMARY;
  if (mask !== 0 && (mask & (1 << primary)) === 0) primary = firstAllowedPrimary(mask);
  let first = -1;
  for (let slot = 0; slot < WEAPON_SLOT_COUNT; slot++) {
    let code = zombie ? WEAPON_NONE : slot === 0 ? primary : (DEFAULT_LOADOUT_REST[slot - 1] ?? WEAPON_NONE);
    if (mask !== 0 && code !== WEAPON_NONE && (mask & (1 << code)) === 0) code = WEAPON_NONE;
    const def = weaponDef(code);
    s.loadout[k + slot] = code;
    s.slotClip[k + slot] = def ? def.clipSize : 0;
    s.slotReserve[k + slot] = def ? def.reserve : 0;
    if (first < 0 && def !== null) first = slot;
  }
  s.slot[e] = first < 0 ? 0 : first;
  s.weapon[e] = s.loadout[k + s.slot[e]!]!;
  s.cookTicks[e] = -1;
  s.adsAmount[e] = 0;
  s.burstShots[e] = 0;
  s.recoilPitch[e] = 0;
  s.recoilYaw[e] = 0;
  s.coyoteTicks[e] = 0;
  s.jumpBufferTicks[e] = 0;
  s.slideTicks[e] = 0;
  s.slideCooldownTicks[e] = 0;
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
