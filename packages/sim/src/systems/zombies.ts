import { runnerChance, ZOMBIE_TYPE, ZOMBIES_MODE, zombiesInWave, zombieWaveHp } from '../config/zombie.ts';
import type { SimContext } from '../context.ts';
import { ENTITY_FLAG, ENTITY_KIND, NULL_ENTITY } from '../entity.ts';
import { pickSpawn, respawn } from './life.ts';

const F = ENTITY_FLAG;

/**
 * M3 (fase 2a): o diretor de ondas do Bobo Zombies (passo 8 da ordem fixa, tecnico.md §4.1). Só no modo `zombies`.
 * - Intervalo: conta até a próxima onda; ao abrir, todos os bobos mortos voltam.
 * - Onda: solta um zumbi do pool a cada `spawnIntervalTicks` (no ponto mais longe dos bobos) com a vida da onda e, pela
 *   chance da onda, correndo; o último zumbi corre e fica marcado; acabou a onda, intervalo (ou vitória na última).
 * - Todos os bobos mortos ao mesmo tempo = derrota (o caído e o reviver chegam na fase 2c).
 * O fim usa a fase `ended` da partida: `winnerTeam` 0 = vitória, -1 = derrota.
 */
export function zombiesSystem(ctx: SimContext): void {
  if (!ctx.zombiesMode) return;
  const m = ctx.match;
  if (m.phase !== 'playing') return;
  const s = ctx.s;
  const w = ctx.waves;
  let bobos = 0;
  let bobosUp = 0;
  let alive = 0;
  let last = -1;
  for (let e = 0; e < s.count; e++) {
    if (s.alive[e] === 0) continue;
    const dead = (s.flags[e]! & F.dead) !== 0;
    if (s.kind[e] === ENTITY_KIND.bobo) {
      bobos++;
      if (!dead) bobosUp++;
    } else if (s.kind[e] === ENTITY_KIND.zombie && !dead) {
      alive++;
      last = e;
    }
  }
  if (bobos > 0 && bobosUp === 0) {
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
      s.zombieType[last] = ZOMBIE_TYPE.runner;
    }
  } else if (alive !== 1) w.lastZombie = NULL_ENTITY;
  if (w.left === 0) waveCleared(ctx);
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
    s.health[e] = w.waveHp;
    s.zombieType[e] = ctx.rngZombies.next() < w.runChance ? ZOMBIE_TYPE.runner : ZOMBIE_TYPE.walker;
    return true;
  }
  return false;
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
function pickZombieSpawn(ctx: SimContext): number {
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
