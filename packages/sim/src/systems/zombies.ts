import { BUTTON } from '@boboforces/input';
import {
  PERK,
  runnerChance,
  ZOMBIE_KINDS,
  ZOMBIE_SPECIALS,
  ZOMBIE_TYPE,
  ZOMBIES_DOWN,
  ZOMBIES_MODE,
  ZOMBIE_PERKS,
  zombiesInWave,
  zombieWaveHp,
} from '../config/zombie.ts';
import type { SimContext } from '../context.ts';
import { ENTITY_FLAG, ENTITY_KIND, NULL_ENTITY } from '../entity.ts';
import { barricadesSystem } from './barricades.ts';
import { mysteryBoxSystem, perkSystem, wallBuySystem } from './shop.ts';
import { bleedOut, pickSpawn, respawn, standUp } from './life.ts';

const F = ENTITY_FLAG;

/**
 * M3 (fase 2a): o diretor de ondas do Bobo Zombies (passo 8 da ordem fixa, tecnico.md §4.1). Só no modo `zombies`.
 * - Intervalo: conta até a próxima onda; ao abrir, todos os bobos mortos voltam.
 * - Onda: solta um zumbi do pool a cada `spawnIntervalTicks` (no ponto mais longe dos bobos) com a vida da onda e, pela
 *   chance da onda, correndo; o último zumbi corre e fica marcado; acabou a onda, intervalo (ou vitória na última).
 * - Fase 2c: os caídos sangram, levantam sozinhos ou pelo colega (`updateDowned`). Ninguém de pé e nenhum "levanta
 *   sozinho" a caminho = derrota.
 * O fim usa a fase `ended` da partida: `winnerTeam` 0 = vitória, -1 = derrota.
 */
export function zombiesSystem(ctx: SimContext): void {
  if (!ctx.zombiesMode) return;
  const m = ctx.match;
  if (m.phase !== 'playing') return;
  const s = ctx.s;
  const w = ctx.waves;
  updateDowned(ctx);
  barricadesSystem(ctx);
  wallBuySystem(ctx);
  mysteryBoxSystem(ctx);
  perkSystem(ctx);
  let bobos = 0;
  let bobosUp = 0;
  let selfComing = false;
  let alive = 0;
  let last = -1;
  for (let e = 0; e < s.count; e++) {
    if (s.alive[e] === 0) continue;
    const dead = (s.flags[e]! & F.dead) !== 0;
    if (s.kind[e] === ENTITY_KIND.bobo) {
      bobos++;
      const down = (s.flags[e]! & F.downed) !== 0;
      if (!dead && !down) bobosUp++;
      if (down && s.selfUp[e] === 1) selfComing = true;
    } else if (s.kind[e] === ENTITY_KIND.zombie && !dead) {
      alive++;
      last = e;
    }
  }
  if (bobos > 0 && bobosUp === 0 && !selfComing) {
    endZombies(ctx, false);
    return;
  }
  if (w.resting === 1) {
    if (w.restTicks > 0) w.restTicks--;
    if (w.restTicks === 0) startWave(ctx);
    w.left = w.toSpawn + alive;
    return;
  }
  if (w.toSpawn > 0) {
    if (w.spawnTicks > 0) w.spawnTicks--;
    if (w.spawnTicks === 0) {
      if (spawnZombie(ctx)) {
        w.toSpawn--;
        alive++;
      }
      w.spawnTicks = ctx.zombieRules.spawnIntervalTicks;
    }
  }
  w.left = w.toSpawn + alive;
  // O último zumbi da onda corre até os bobos e ganha marcador (GDD §3.8).
  if (w.toSpawn === 0 && alive === 1 && last >= 0) {
    const id = s.idOf(last);
    if (w.lastZombie !== id) {
      w.lastZombie = id;
      if (s.zombieType[last] === ZOMBIE_TYPE.walker) s.zombieType[last] = ZOMBIE_TYPE.runner;
    }
  } else if (alive !== 1) w.lastZombie = NULL_ENTITY;
  if (w.left === 0) waveCleared(ctx);
}

/**
 * M3 (fase 2c): cada bobo caído. O "levanta sozinho" conta até voltar; senão, o colega de pé do mesmo time mais perto
 * (até `reviveRangeM`) que segura o usar enche o reviver (trocar de quem levanta recomeça; enquanto alguém levanta, o
 * sangramento para); sem ninguém, sangra até o golpe final.
 */
function updateDowned(ctx: SimContext): void {
  const s = ctx.s;
  const r = ctx.zombieRules;
  const range2 = ZOMBIES_DOWN.reviveRangeM * ZOMBIES_DOWN.reviveRangeM;
  for (let e = 0; e < s.count; e++) {
    if (s.alive[e] === 0 || s.kind[e] !== ENTITY_KIND.bobo) continue;
    const fl = s.flags[e]!;
    if ((fl & F.downed) === 0 || (fl & F.dead) !== 0) continue;
    if (s.selfUp[e] === 1) {
      if (s.downTicks[e]! > 0) s.downTicks[e]!--;
      if (s.downTicks[e] === 0) standUp(ctx, e, NULL_ENTITY);
      continue;
    }
    let helper = -1;
    let best = range2;
    const e3 = e * 3;
    for (let o = 0; o < s.count; o++) {
      if (o === e || s.alive[o] === 0 || s.kind[o] !== ENTITY_KIND.bobo || s.team[o] !== s.team[e]) continue;
      if ((s.flags[o]! & (F.dead | F.downed)) !== 0 || (s.inButtons[o]! & BUTTON.use) === 0) continue;
      const o3 = o * 3;
      const dx = s.position[o3]! - s.position[e3]!;
      const dy = s.position[o3 + 1]! - s.position[e3 + 1]!;
      const dz = s.position[o3 + 2]! - s.position[e3 + 2]!;
      const d = dx * dx + dy * dy + dz * dz;
      if (d <= best) {
        best = d;
        helper = o;
      }
    }
    if (helper >= 0) {
      const id = s.idOf(helper);
      if (s.reviver[e] !== id) {
        s.reviver[e] = id;
        s.reviveTicks[e] = 0;
      }
      s.reviveTicks[e] = s.reviveTicks[e]! + 1;
      // M3 (fase 4c): com a Buddy Brew, quem levanta leva a metade do tempo.
      const need =
        (s.perks[helper]! & PERK.buddy) !== 0
          ? Math.max(1, Math.round(r.reviveTicks * ZOMBIE_PERKS.buddyReviveMul))
          : r.reviveTicks;
      if (s.reviveTicks[e]! >= need) standUp(ctx, e, id);
      continue;
    }
    s.reviver[e] = NULL_ENTITY;
    s.reviveTicks[e] = 0;
    if (s.downTicks[e]! > 0) {
      s.downTicks[e]!--;
      // -1: o golpe final já foi para a fila (entra no dano do próximo tick).
      if (s.downTicks[e] === 0) {
        s.downTicks[e] = -1;
        bleedOut(ctx, e);
      }
    }
  }
}

function startWave(ctx: SimContext): void {
  const s = ctx.s;
  const w = ctx.waves;
  const r = ctx.zombieRules;
  w.wave++;
  w.resting = 0;
  w.restTicks = 0;
  w.toSpawn = zombiesInWave(w.wave, ctx.humans, r.quantity);
  w.spawnTicks = 1;
  w.waveHp = zombieWaveHp(w.wave, r.hpMul);
  w.runChance = runnerChance(w.wave);
  w.lastZombie = NULL_ENTITY;
  // M3 (fase 3b): o chefão sai primeiro, a cada `bossEvery` ondas (a mais no total da onda).
  w.bossPending = r.bosses && w.wave % ZOMBIE_SPECIALS.bossEvery === 0 ? 1 : 0;
  w.toSpawn += w.bossPending;
  // M3 (fase 3d): o teto dos pontos de conserto é por onda.
  s.repairPoints.fill(0);
  // Quem caiu na onda passada volta agora.
  for (let e = 0; e < s.count; e++) {
    if (s.alive[e] === 0 || s.kind[e] !== ENTITY_KIND.bobo || (s.flags[e]! & F.dead) === 0) continue;
    respawn(ctx, e, pickSpawn(ctx, e));
  }
  ctx.events.wave(ctx.tick, w.wave, 'start');
}

function waveCleared(ctx: SimContext): void {
  const w = ctx.waves;
  ctx.events.wave(ctx.tick, w.wave, 'clear');
  w.lastZombie = NULL_ENTITY;
  if (ctx.zombieRules.waves > 0 && w.wave >= ctx.zombieRules.waves) {
    endZombies(ctx, true);
    return;
  }
  w.resting = 1;
  w.restTicks = ctx.zombieRules.intermissionTicks;
}

/** Um zumbi do pool (fora de jogo) entra no ponto mais longe dos bobos. `false` = o pool está todo em jogo. */
function spawnZombie(ctx: SimContext): boolean {
  const s = ctx.s;
  const w = ctx.waves;
  for (let e = 0; e < s.count; e++) {
    if (s.alive[e] === 0 || s.kind[e] !== ENTITY_KIND.zombie || (s.flags[e]! & F.dead) === 0) continue;
    respawn(ctx, e, pickZombieSpawn(ctx));
    const type = rollType(ctx);
    const kind = ZOMBIE_KINDS[type]!;
    s.zombieType[e] = type;
    s.bodyScale[e] = kind.scale;
    s.health[e] =
      type === ZOMBIE_TYPE.boss
        ? Math.round(ZOMBIE_SPECIALS.bossHpPerHuman * Math.max(1, ctx.humans) * ctx.zombieRules.hpMul)
        : Math.max(1, Math.round(w.waveHp * kind.hpMul));
    return true;
  }
  return false;
}

/** M3 (fase 3b): o tipo do próximo zumbi: o chefão pendente; senão um especial (pela onda e pela chance); senão anda ou corre. */
function rollType(ctx: SimContext): number {
  const w = ctx.waves;
  const Z = ZOMBIE_SPECIALS;
  if (w.bossPending === 1) {
    w.bossPending = 0;
    return ZOMBIE_TYPE.boss;
  }
  const rng = ctx.rngZombies;
  if (ctx.zombieRules.specials) {
    const roll = rng.next();
    let edge = 0;
    if (w.wave >= Z.sprinterFrom) {
      edge += Z.sprinterChance;
      if (roll < edge) return ZOMBIE_TYPE.sprinter;
    }
    if (w.wave >= Z.chonkerFrom) {
      edge += Z.chonkerChance;
      if (roll < edge) return ZOMBIE_TYPE.chonker;
    }
    if (w.wave >= Z.spitterFrom) {
      edge += Z.spitterChance;
      if (roll < edge) return ZOMBIE_TYPE.spitter;
    }
  }
  return rng.next() < w.runChance ? ZOMBIE_TYPE.runner : ZOMBIE_TYPE.walker;
}

function endZombies(ctx: SimContext, won: boolean): void {
  const m = ctx.match;
  m.phase = 'ended';
  m.winnerTeam = won ? 0 : -1;
  m.winnerEntity = NULL_ENTITY;
  ctx.events.matchPhase(ctx.tick, 'ended');
}

/**
 * Onde o zumbi entra: os pontos sem time do mapa (ou todos, se não houver), sorteados entre os que ficam a
 * `minSpawnDistM` ou mais de todo bobo vivo; nenhum serve, o mais longe. Nunca em cima dos bobos (o `pickSpawn` do M1
 * sorteia entre os 3 mais longe, e num mapa de 2 pontos isso inclui o deles).
 */
export function pickZombieSpawn(ctx: SimContext): number {
  const spawns = ctx.spawns;
  let neutral = false;
  for (let i = 0; i < spawns.length; i++) if (spawns[i]!.team < 0) neutral = true;
  const min2 = ZOMBIES_MODE.minSpawnDistM * ZOMBIES_MODE.minSpawnDistM;
  let ok = 0;
  let far = 0;
  let farD = -1;
  for (let i = 0; i < spawns.length; i++) {
    const p = spawns[i]!;
    if (neutral && p.team >= 0) continue;
    const d = nearestBobo2(ctx, p.x, p.z);
    if (d >= min2) ok++;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  if (ok === 0) return far;
  let k = Math.floor(ctx.rngZombies.next() * ok);
  for (let i = 0; i < spawns.length; i++) {
    const p = spawns[i]!;
    if (neutral && p.team >= 0) continue;
    if (nearestBobo2(ctx, p.x, p.z) < min2) continue;
    if (k-- === 0) return i;
  }
  return far;
}

/** Distância² no plano até o bobo vivo mais perto (sem nenhum, infinito). */
function nearestBobo2(ctx: SimContext, x: number, z: number): number {
  const s = ctx.s;
  let best = Number.POSITIVE_INFINITY;
  for (let e = 0; e < s.count; e++) {
    if (s.alive[e] === 0 || s.kind[e] !== ENTITY_KIND.bobo || (s.flags[e]! & F.dead) !== 0) continue;
    const dx = s.position[e * 3]! - x;
    const dz = s.position[e * 3 + 2]! - z;
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return best;
}
