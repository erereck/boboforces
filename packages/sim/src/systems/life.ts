import { MAX_TEAMS } from '../constants.ts';
import { WEAPON_SLOTS } from '../config/weapons.ts';
import { HIT_PARTS, hostile, PART_HEAD, type SimContext } from '../context.ts';
import { ENTITY_FLAG, ENTITY_KIND, NULL_ENTITY, type EntityId } from '../entity.ts';

/**
 * Passos 5 a 7: dano e morte, regras do modo (tempo e placar) e spawns (respawn, proteção, regeneração).
 * Spawn: entre os pontos do time (ou de qualquer time, `team = -1`), sorteia um dos 3 mais longe dos inimigos vivos
 * (gameplay.md §5.3, versão simples do M0: sem checar linha de visão).
 */

const F = ENTITY_FLAG;

/** Passo 5: aplica a fila de dano na ordem em que foi gerada. */
export function damageSystem(ctx: SimContext): void {
  const s = ctx.s;
  const q = ctx.damage;
  for (let i = 0; i < q.count; i++) {
    const t = q.target[i]!;
    if (s.alive[t] === 0 || (s.flags[t]! & F.dead) !== 0) continue;
    const attacker = q.attacker[i]!;
    let amount = q.amount[i]!;
    // Proteção de spawn segura dano de inimigo; queda e plano de morte passam.
    if (attacker !== NULL_ENTITY && (s.flags[t]! & F.spawnProtected) !== 0) amount = 0;
    if (ctx.match.phase === 'ended' && attacker !== NULL_ENTITY) amount = 0;
    const id = s.idOf(t);
    const part = q.part[i]!;
    if (amount > 0) {
      s.health[t] = s.health[t]! - amount;
      s.lastDamageTick[t] = ctx.tick;
      s.lastAttacker[t] = attacker;
    }
    const p3 = i * 3;
    ctx.events.hit(ctx.tick, attacker, id, HIT_PARTS[part]!, amount, q.point[p3]!, q.point[p3 + 1]!, q.point[p3 + 2]!);
    if (s.health[t]! <= 0) kill(ctx, t, attacker, q.weapon[i]!, part === PART_HEAD);
  }
  q.count = 0;
}

function kill(ctx: SimContext, t: number, killer: EntityId, weapon: number, headshot: boolean): void {
  const s = ctx.s;
  s.health[t] = 0;
  s.flags[t] = (s.flags[t]! & F.onGround) | F.dead;
  const t3 = t * 3;
  s.velocity[t3] = 0;
  s.velocity[t3 + 2] = 0;
  // +1: o spawnSystem roda no MESMO tick (passo 7) e já desconta um. Assim o bobo fica morto exatamente
  // `respawnTicks` ticks (no mínimo 1, mesmo com `respawnS = 0`), e a IA e o render enxergam a morte.
  s.respawnTicks[t] = ctx.respawnTicks + 1;
  s.reloadTicks[t] = 0;
  s.slideTicks[t] = 0;
  s.recoilPitch[t] = 0;
  s.recoilYaw[t] = 0;
  s.deaths[t] = s.deaths[t]! + 1;
  if (killer !== NULL_ENTITY && s.isCurrent(killer)) {
    const k = killer & 0xffff;
    if (hostile(ctx, k, t)) {
      s.kills[k] = s.kills[k]! + 1;
      if (!ctx.ffa) {
        const team = s.team[k]!;
        if (team < MAX_TEAMS) ctx.match.teamScore[team] = ctx.match.teamScore[team]! + 1;
      }
    }
  }
  ctx.events.kill(ctx.tick, killer, s.idOf(t), weapon, headshot);
}

/** Passo 6: relógio e limite de placar. Partida terminada não tem mais dano de arma nem respawn. */
export function rulesSystem(ctx: SimContext): void {
  const m = ctx.match;
  if (m.phase !== 'playing') return;
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
  m.phase = 'ended';
  m.winnerTeam = winner(ctx);
  ctx.events.matchPhase(ctx.tick, 'ended');
}

/** Time com mais pontos (no FFA, o time de quem tem mais abates); empate = -1. */
function winner(ctx: SimContext): number {
  const s = ctx.s;
  let best = -1;
  let bestScore = -1;
  let tie = false;
  if (ctx.ffa) {
    for (let e = 0; e < s.count; e++) {
      if (s.alive[e] === 0 || s.kind[e] !== ENTITY_KIND.bobo) continue;
      const k = s.kills[e]!;
      if (k > bestScore) {
        bestScore = k;
        best = s.team[e]!;
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

/** Passo 7: respawn, fim da proteção de spawn e regeneração. */
export function spawnSystem(ctx: SimContext): void {
  const s = ctx.s;
  for (let e = 0; e < s.count; e++) {
    if (s.alive[e] === 0 || s.kind[e] !== ENTITY_KIND.bobo) continue;
    const fl = s.flags[e]!;
    if ((fl & F.dead) !== 0) {
      if (s.respawnTicks[e]! > 0) s.respawnTicks[e]!--;
      if (s.respawnTicks[e] === 0 && ctx.match.phase !== 'ended') respawn(ctx, e, pickSpawn(ctx, e));
      continue;
    }
    if (s.spawnProtectTicks[e]! > 0 && --s.spawnProtectTicks[e]! === 0) s.flags[e] = fl & ~F.spawnProtected;
    if (ctx.warfare && s.health[e]! < ctx.maxHp && ctx.tick - s.lastDamageTick[e]! >= ctx.regenDelayTicks) {
      s.health[e] = Math.min(ctx.maxHp, s.health[e]! + ctx.regenPerTick);
    }
  }
}

/**
 * Melhor ponto para renascer: candidatos do time (ou `-1`), nota = menor distância² até um inimigo vivo, sorteio entre
 * os 3 melhores (`rng.spawn`). Sem candidatos, qualquer ponto.
 */
function pickSpawn(ctx: SimContext, e: number): number {
  const s = ctx.s;
  const spawns = ctx.spawns;
  let b0 = -1;
  let b1 = -1;
  let b2 = -1;
  let s0 = -1;
  let s1 = -1;
  let s2 = -1;
  for (let pass = 0; pass < 2 && b0 < 0; pass++) {
    for (let i = 0; i < spawns.length; i++) {
      const sp = spawns[i]!;
      if (pass === 0 && !ctx.ffa && sp.team !== -1 && sp.team !== s.team[e]) continue;
      let score = Infinity;
      for (let j = 0; j < s.count; j++) {
        if (s.alive[j] === 0 || s.kind[j] !== ENTITY_KIND.bobo || (s.flags[j]! & F.dead) !== 0) continue;
        if (!hostile(ctx, e, j)) continue;
        const dx = s.position[j * 3]! - sp.x;
        const dz = s.position[j * 3 + 2]! - sp.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < score) score = d2;
      }
      if (score > s0) {
        b2 = b1;
        s2 = s1;
        b1 = b0;
        s1 = s0;
        b0 = i;
        s0 = score;
      } else if (score > s1) {
        b2 = b1;
        s2 = s1;
        b1 = i;
        s1 = score;
      } else if (score > s2) {
        b2 = i;
        s2 = score;
      }
    }
  }
  const n = b2 >= 0 ? 3 : b1 >= 0 ? 2 : 1;
  const k = ctx.rngSpawn.int(0, n);
  return k === 0 ? b0 : k === 1 ? b1 : b2;
}

/** Põe o bobo `e` vivo no spawn `index`, com vida, munição e proteção cheias. */
export function respawn(ctx: SimContext, e: number, index: number): void {
  const s = ctx.s;
  const sp = ctx.spawns[index]!;
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
  s.health[e] = ctx.maxHp;
  s.weapon[e] = 0;
  const def = WEAPON_SLOTS[0];
  s.ammoClip[e] = def ? def.clipSize : 0;
  s.ammoReserve[e] = def ? def.reserve : 0;
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
  s.spawnProtectTicks[e] = ctx.spawnProtectTicks;
  s.lastDamageTick[e] = -1_000_000;
  s.lastAttacker[e] = NULL_ENTITY;
  s.flags[e] = F.onGround | (ctx.spawnProtectTicks > 0 ? F.spawnProtected : 0);
  ctx.events.spawn(ctx.tick, s.idOf(e));
}
