import { BUTTON } from '@boboforces/input';
import { CELLS_PER_METER, isCellSolid } from '@boboforces/world';
import type { SpawnPoint } from '../sim.ts';
import type { SimContext } from '../context.ts';
import { ENTITY_FLAG, ENTITY_KIND } from '../entity.ts';
import type { BlockRegistry, WorldGrid } from '@boboforces/world';
import { ZOMBIE_TYPE } from '../config/zombie.ts';

/**
 * M6 (fase 6a): o Bobo Zombies Fortress (`zombies.variant: 'fortress'`, GDD §4.1.5): um gerador com vida (estado da
 * sim, não cenário) que os zumbis atacam e os humanos defendem. Cada zumbi colado nele tira `FORTRESS.dps` por segundo
 * (o chefão, `bossMul` vezes isso); o gerador no zero perde a partida. Quem é do time dos humanos (eles e os bots de
 * apoio), de pé, conserta segurando o usar perto dele (`repairPerS`), fora da onda e durante ela. A posição sai do mapa: o ponto de spawn dos humanos mais perto do centro
 * deles, 1,5 m para o lado livre (sem marcador novo nos mapas).
 */
export const FORTRESS = {
  hp: 4000,
  dps: 20,
  bossMul: 4,
  reachM: 1.8,
  repairPerS: 60,
  repairReachM: 2.2,
} as const;

export class FortressState {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly maxHp: number;
  /** A vida do gerador (estado: hash, snapshot e rede). */
  readonly hp = new Float32Array(1);

  constructor(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.maxHp = FORTRESS.hp;
    this.hp[0] = FORTRESS.hp;
  }
}

/** O lugar do gerador: o spawn humano mais perto do centro dos spawns humanos, 1,5 m para um lado livre. */
export function createFortress(spawns: readonly SpawnPoint[], grid: WorldGrid, blocks: BlockRegistry): FortressState {
  const humans = spawns.filter((sp) => sp.team === 0);
  const list = humans.length > 0 ? humans : spawns;
  let cx = 0;
  let cz = 0;
  for (const sp of list) {
    cx += sp.x;
    cz += sp.z;
  }
  cx /= Math.max(1, list.length);
  cz /= Math.max(1, list.length);
  let best = list[0] ?? { x: 0, y: 0, z: 0 };
  let bestD = Infinity;
  for (const sp of list) {
    const d = (sp.x - cx) ** 2 + (sp.z - cz) ** 2;
    if (d < bestD) {
      bestD = d;
      best = sp;
    }
  }
  const cell = (m: number): number => Math.floor(m * CELLS_PER_METER);
  for (const [dx, dz] of [
    [1.5, 0],
    [-1.5, 0],
    [0, 1.5],
    [0, -1.5],
  ] as const) {
    const x = best.x + dx;
    const z = best.z + dz;
    const free = !isCellSolid(grid, blocks, cell(x), cell(best.y + 0.5), cell(z));
    const floor = isCellSolid(grid, blocks, cell(x), cell(best.y - 0.1), cell(z));
    if (free && floor) return new FortressState(x, best.y, z);
  }
  return new FortressState(best.x, best.y, best.z);
}

/**
 * O passo do gerador (no diretor de ondas, durante a partida): o dano dos zumbis colados, o conserto dos humanos e o fim
 * (devolve `true` quando o gerador caiu).
 */
export function fortressSystem(ctx: SimContext): boolean {
  const f = ctx.fortress;
  if (f === null) return false;
  const s = ctx.s;
  let hp = f.hp[0]!;
  const reach2 = FORTRESS.reachM * FORTRESS.reachM;
  const fix2 = FORTRESS.repairReachM * FORTRESS.repairReachM;
  for (let e = 0; e < s.count; e++) {
    if (s.alive[e] !== 1 || (s.flags[e]! & ENTITY_FLAG.dead) !== 0) continue;
    const e3 = e * 3;
    const dx = s.position[e3]! - f.x;
    const dz = s.position[e3 + 2]! - f.z;
    const dy = Math.abs(s.position[e3 + 1]! - f.y);
    const d2 = dx * dx + dz * dz;
    if (s.kind[e] === ENTITY_KIND.zombie) {
      if (d2 <= reach2 && dy < 1.5) {
        const mul = s.zombieType[e] === ZOMBIE_TYPE.boss ? FORTRESS.bossMul : 1;
        hp -= FORTRESS.dps * mul * ctx.dt;
      }
    } else if (
      s.kind[e] === ENTITY_KIND.bobo &&
      s.team[e] === 0 &&
      (s.flags[e]! & ENTITY_FLAG.downed) === 0 &&
      (s.inButtons[e]! & BUTTON.use) !== 0 &&
      d2 <= fix2 &&
      dy < 1.5
    ) {
      hp += FORTRESS.repairPerS * ctx.dt;
    }
  }
  f.hp[0] = Math.max(0, Math.min(f.maxHp, hp));
  return f.hp[0]! <= 0;
}
