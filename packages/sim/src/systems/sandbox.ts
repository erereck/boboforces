import type { NavGrid } from '@boboforces/nav';
import { BLOCK_SIZE } from '@boboforces/world';
import { SANDBOX_SPAWN } from '../config/rules.ts';
import { MAX_TEAMS } from '../constants.ts';
import type { PlayArea, SimContext } from '../context.ts';
import { ENTITY_FLAG, ENTITY_KIND } from '../entity.ts';
import type { SimMap, SpawnPoint } from '../sim.ts';

/**
 * M9 (fase 2): o Bobo Sandbox (`mode: 'sandbox'`, GDD §4.1.2). Na sim ele é o TDM de até 4 times (o placar de abates,
 * a regeneração e a caixinha de munição) com:
 * - a vida e as armas de cada time (`TeamRecipe.hp`/`weapons`, montadas nas regras por entidade no `createSim`);
 * - o objetivo: pontos (o fim do TDM), nenhum (sem tempo nem meta) ou eliminação (aqui: sem respawn; o último time de
 *   pé vence; no fim do tempo, o time com mais gente viva);
 * - a casa dos times sem ponto de spawn no mapa (`sandboxSpawns`).
 * Tudo sai da receita: nada novo no estado, no hash ou no snapshot.
 */
export interface SandboxState {
  /** O objetivo é a eliminação. */
  readonly elimination: boolean;
  /** Bit por time que começou com alguém: a eliminação só decide uma partida que começou com 2 times ou mais. */
  readonly teamsMask: number;
}

/** "Ainda não acabou" de `sandboxSurvivor`. */
export const SANDBOX_UNDECIDED = -2;

/** Bits dos times com alguém vivo (bobo que não está morto). */
function standingTeams(ctx: SimContext): number {
  const s = ctx.s;
  let mask = 0;
  for (let e = 0; e < s.count; e++) {
    if (s.alive[e] === 0 || s.kind[e] !== ENTITY_KIND.bobo || (s.flags[e]! & ENTITY_FLAG.dead) !== 0) continue;
    const t = s.team[e]!;
    if (t < MAX_TEAMS) mask |= 1 << t;
  }
  return mask;
}

/**
 * Na eliminação, o time que sobrou de pé (-1 = ninguém: os últimos caíram no mesmo tick, empate), ou
 * `SANDBOX_UNDECIDED` (fora da eliminação, ou ainda há 2 times ou mais de pé).
 */
export function sandboxSurvivor(ctx: SimContext): number {
  const sb = ctx.sandbox;
  if (sb === null || !sb.elimination || (sb.teamsMask & (sb.teamsMask - 1)) === 0) return SANDBOX_UNDECIDED;
  const mask = standingTeams(ctx);
  if ((mask & (mask - 1)) !== 0) return SANDBOX_UNDECIDED;
  return mask === 0 ? -1 : 31 - Math.clz32(mask);
}

/** Rascunho de `sandboxLeader` (gente viva por time). */
const aliveBy = new Int32Array(MAX_TEAMS);

/**
 * Na eliminação, quem está na frente (fim do tempo, `finish`, morte súbita): o time com mais gente viva; no empate, o
 * placar de abates entre os empatados; ainda empatado, -1 (a morte súbita: o próximo abate que desempata decide).
 */
export function sandboxLeader(ctx: SimContext): number {
  const s = ctx.s;
  aliveBy.fill(0);
  for (let e = 0; e < s.count; e++) {
    if (s.alive[e] === 0 || s.kind[e] !== ENTITY_KIND.bobo || (s.flags[e]! & ENTITY_FLAG.dead) !== 0) continue;
    const t = s.team[e]!;
    if (t < MAX_TEAMS) aliveBy[t] = aliveBy[t]! + 1;
  }
  let best = -1;
  let tie = false;
  for (let t = 0; t < MAX_TEAMS; t++) {
    if (aliveBy[t] === 0) continue;
    const d = best < 0 ? 1 : aliveBy[t]! - aliveBy[best]! || ctx.match.teamScore[t]! - ctx.match.teamScore[best]!;
    if (d > 0) {
      best = t;
      tie = false;
    } else if (d === 0) tie = true;
  }
  return tie ? -1 : best;
}

/** A direção (rad) no meio da maior folga entre as já ocupadas (a 1ª folga maior; sem nenhuma, +Z). */
function widestGap(angles: readonly number[]): number {
  if (angles.length === 0) return Math.PI / 2;
  const sorted = [...angles].sort((a, b) => a - b);
  let start = sorted[sorted.length - 1]!;
  let gap = sorted[0]! + 2 * Math.PI - start;
  for (let i = 1; i < sorted.length; i++) {
    const g = sorted[i]! - sorted[i - 1]!;
    if (g > gap) {
      gap = g;
      start = sorted[i - 1]!;
    }
  }
  return start + gap / 2;
}

const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);

/**
 * O nó em pé do componente principal mais perto (no plano) de (x, z), dentro da área; no empate, o mais baixo (o
 * térreo, não o telhado). M10 (fase 8): o nó no chão das bases (o piso a menos de `SANDBOX_SPAWN.groundToleranceM` de
 * `floorY`, até `groundReachM` de distância) ganha de qualquer outro mais perto (em cima de um muro ou de um caixote);
 * sem nenhum no chão, o mais perto. -1 = nenhum.
 */
function standingNode(
  nav: NavGrid,
  main: number,
  area: PlayArea,
  x: number,
  z: number,
  floorY: number,
  pos: Float64Array,
): number {
  let best = -1;
  let bestD = Infinity;
  let bestY = Infinity;
  let ground = -1;
  let groundD = SANDBOX_SPAWN.groundReachM * SANDBOX_SPAWN.groundReachM;
  let groundY = Infinity;
  for (let n = 0; n < nav.nodeCount; n++) {
    if (nav.clearance[n] !== 1 || nav.component[n] !== main) continue;
    nav.nodePosition(n, pos, 0);
    if (pos[0]! < area.minX + 1 || pos[0]! > area.maxX - 1 || pos[2]! < area.minZ + 1 || pos[2]! > area.maxZ - 1)
      continue;
    const dx = pos[0]! - x;
    const dz = pos[2]! - z;
    const d = dx * dx + dz * dz;
    const y = pos[1]!;
    if (d < bestD || (d === bestD && y < bestY)) {
      best = n;
      bestD = d;
      bestY = y;
    }
    if (Math.abs(y - floorY) < SANDBOX_SPAWN.groundToleranceM && (d < groundD || (d === groundD && y < groundY))) {
      ground = n;
      groundD = d;
      groundY = y;
    }
  }
  return ground >= 0 ? ground : best;
}

/**
 * M10 (fase 8): a altura do chão das bases: o pé mais baixo dos spawns dos times da partida que têm ponto no mapa (sem
 * nenhum, de todos os spawns; sem spawn, `NaN`: nenhum nó conta como chão).
 */
function baseFloorY(spawns: readonly SpawnPoint[], teams: number): number {
  let own = Infinity;
  let any = Infinity;
  for (const sp of spawns) {
    if (sp.team >= 0 && sp.team < teams) own = Math.min(own, sp.y);
    any = Math.min(any, sp.y);
  }
  return Number.isFinite(own) ? own : Number.isFinite(any) ? any : Number.NaN;
}

/**
 * Os pontos de spawn do Sandbox com `teams` times. Os times com ponto no mapa ficam com eles (o centro deles dá a
 * direção da base, a partir do centro da área jogável). Cada time sem ponto (o 2 e o 3; o 1 num mapa que só marca o 0),
 * na ordem, ganha uma casa no meio da maior folga entre as direções já ocupadas, à distância média das bases do centro
 * (no Construto: o 2 a oeste e o 3 a leste, entre as bases do norte e do sul). Então:
 * - a base dele: `SANDBOX_SPAWN.basePoints` nós da navegação em cruz em volta da casa, de preferência no chão das bases
 *   do mapa (M10, fase 8: não em cima de um muro; `standingNode`) (sem navegação, nenhum);
 * - o território dele: os pontos sem time mais perto da casa dele que da de qualquer outro time viram dele (os times do
 *   mapa não renascem ali; os pontos sem time do resto continuam de todos).
 * O array começa pelas bases e pelos territórios (do ponto mais perto da casa ao mais longe), e o resto vem na ordem do
 * mapa: o spawn inicial (o k-ésimo do time no k-ésimo ponto dele) começa na base, ou, sem ela, perto da casa. Sem time
 * sem ponto, devolve os do mapa (o mesmo array). Determinístico; só na criação (aloca).
 */
export function sandboxSpawns(map: SimMap, teams: number, navMain: number, populated = -1): readonly SpawnPoint[] {
  const spawns = map.spawns;
  const area: PlayArea = map.playArea ?? {
    minX: 0,
    minZ: 0,
    maxX: map.grid.sizeX * BLOCK_SIZE,
    maxZ: map.grid.sizeZ * BLOCK_SIZE,
  };
  const cx = (area.minX + area.maxX) / 2;
  const cz = (area.minZ + area.maxZ) / 2;
  const homeX: number[] = [];
  const homeZ: number[] = [];
  const angles: number[] = [];
  let radius = 0;
  for (let t = 0; t < teams; t++) {
    let n = 0;
    let sx = 0;
    let sz = 0;
    for (const sp of spawns) {
      if (sp.team !== t) continue;
      n++;
      sx += sp.x;
      sz += sp.z;
    }
    homeX.push(n > 0 ? sx / n : NaN);
    homeZ.push(n > 0 ? sz / n : NaN);
    if (n === 0) continue;
    angles.push(Math.atan2(sz / n - cz, sx / n - cx));
    radius += Math.hypot(sx / n - cx, sz / n - cz);
  }
  const margin = SANDBOX_SPAWN.marginM;
  radius = angles.length > 0 ? radius / angles.length : 0.35 * Math.min(area.maxX - area.minX, area.maxZ - area.minZ);
  const homeless: number[] = [];
  for (let t = 0; t < teams; t++) {
    // M9 (fase 2, revisão): o time que começa vazio fica sem casa (e sem território).
    if (!Number.isNaN(homeX[t]!) || (populated & (1 << t)) === 0) continue;
    const a = widestGap(angles);
    angles.push(a);
    homeX[t] = clamp(cx + radius * Math.cos(a), area.minX + margin, area.maxX - margin);
    homeZ[t] = clamp(cz + radius * Math.sin(a), area.minZ + margin, area.maxZ - margin);
    homeless.push(t);
  }
  if (homeless.length === 0) return spawns;
  const out: SpawnPoint[] = [];
  const pos = new Float64Array(3);
  const d = SANDBOX_SPAWN.baseSpreadM;
  const cross = [0, 0, d, 0, -d, 0, 0, d, 0, -d];
  const floorY = baseFloorY(spawns, teams);
  for (const t of homeless) {
    if (map.nav === undefined || navMain < 0) break;
    const used: number[] = [];
    for (let k = 0; k < cross.length && used.length < SANDBOX_SPAWN.basePoints; k += 2) {
      const n = standingNode(map.nav, navMain, area, homeX[t]! + cross[k]!, homeZ[t]! + cross[k + 1]!, floorY, pos);
      if (n < 0 || used.includes(n)) continue;
      used.push(n);
      map.nav.nodePosition(n, pos, 0);
      const yaw = Math.atan2(-(cx - pos[0]!), -(cz - pos[2]!));
      out.push({ x: pos[0]!, y: pos[1]!, z: pos[2]!, yaw, team: t });
    }
  }
  const territory: { readonly sp: SpawnPoint; readonly d: number }[] = [];
  const rest: SpawnPoint[] = [];
  for (const sp of spawns) {
    let near = -1;
    let nearD = Infinity;
    for (let t = 0; t < teams && sp.team === -1; t++) {
      const dd = (sp.x - homeX[t]!) ** 2 + (sp.z - homeZ[t]!) ** 2;
      if (dd < nearD) {
        nearD = dd;
        near = t;
      }
    }
    if (near >= 0 && homeless.includes(near)) territory.push({ sp: { ...sp, team: near }, d: nearD });
    else rest.push(sp);
  }
  // O sort é estável: no empate, a ordem do mapa.
  territory.sort((a, b) => a.sp.team - b.sp.team || a.d - b.d);
  for (const t of territory) out.push(t.sp);
  return out.concat(rest);
}
