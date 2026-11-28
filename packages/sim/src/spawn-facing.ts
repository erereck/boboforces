import { wrapAngle } from '@boboforces/shared';
import {
  BLOCK_FLAG,
  createRayHit,
  raycastGrid,
  type BlockRegistry,
  type StaticColliders,
  type WorldGrid,
} from '@boboforces/world';
import { METRICS } from './config/metrics.ts';
import { SPAWN_FACING } from './config/rules.ts';

/**
 * M12 (fase 7b): para onde o bobo olha ao nascer. O yaw vem do marcador do mapa (o `mapc` aponta quase todos para o
 * meio do mapa); quando há parede logo à frente (o abrigo de 2,5 m dos nascimentos do Ringue, o nicho atrás de um
 * pilar), o nascido ficava de cara para ela, sem pista de onde está o jogo. Aqui, uma vez por mapa (no `SimMap`, sem
 * mudar o ponto; e nas casas dos times sem ponto do Sandbox): se a vista no rumo do marcador, na altura do olho e nos
 * dois rumos vizinhos (±22,5°), acaba antes de `SPAWN_FACING.keepM`, o yaw vira o do lado mais aberto (a maior
 * abertura entre `directions` rumos, medida pelo pior de 3 vizinhos, com um bônus para o rumo do marcador). Só conta o
 * que tapa a vista (revisão: a cerca, o vidro e a prop fina não). Determinístico (só raios na grade e nas props).
 */

/** A área jogável (as paredes invisíveis contam como parede). */
interface FacingArea {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

const hit = createRayHit();
const free = new Float64Array(SPAWN_FACING.directions);

/** Distância livre (m) do olho em (x, y, z) no rumo `yaw` (frente = −sin, −cos), até a parede ou a borda da área. */
function freeAhead(
  grid: WorldGrid,
  blocks: BlockRegistry,
  colliders: StaticColliders | null,
  area: FacingArea | null,
  x: number,
  y: number,
  z: number,
  yaw: number,
): number {
  const dx = -Math.sin(yaw);
  const dz = -Math.cos(yaw);
  let range: number = SPAWN_FACING.rangeM;
  if (area !== null) {
    if (dx > 1e-9) range = Math.min(range, (area.maxX - x) / dx);
    else if (dx < -1e-9) range = Math.min(range, (area.minX - x) / dx);
    if (dz > 1e-9) range = Math.min(range, (area.maxZ - z) / dz);
    else if (dz < -1e-9) range = Math.min(range, (area.minZ - z) / dz);
    range = Math.max(0, range);
  }
  if (range <= 0) return 0;
  const eye = y + METRICS.eyeHeight;
  return raycastGrid(grid, blocks, x, eye, z, dx, 0, dz, range, BLOCK_FLAG.blocksSight, hit, colliders)
    ? hit.distance
    : range;
}

/**
 * O yaw de nascimento do ponto (pés em x, y, z) com o yaw do marcador `yaw`: o mesmo, com a vista livre à frente; senão
 * o rumo mais aberto (ver `SPAWN_FACING`).
 */
export function openSpawnYaw(
  grid: WorldGrid,
  blocks: BlockRegistry,
  colliders: StaticColliders | null,
  area: FacingArea | null,
  x: number,
  y: number,
  z: number,
  yaw: number,
): number {
  const n = SPAWN_FACING.directions;
  const step = (Math.PI * 2) / n;
  // Os rumos começam no do marcador: o 0 é ele mesmo (e o desempate fica com o mais perto dele). A frente conta com os
  // dois vizinhos (o pilar colado num canto da vista também tapa).
  free[0] = freeAhead(grid, blocks, colliders, area, x, y, z, yaw);
  free[1] = freeAhead(grid, blocks, colliders, area, x, y, z, yaw + step);
  free[n - 1] = freeAhead(grid, blocks, colliders, area, x, y, z, yaw - step);
  if (Math.min(free[0]!, free[1]!, free[n - 1]!) >= SPAWN_FACING.keepM) return yaw;
  for (let k = 2; k < n - 1; k++) free[k] = freeAhead(grid, blocks, colliders, area, x, y, z, yaw + k * step);
  let best = 0;
  let bestValue = -Infinity;
  for (let k = 0; k < n; k++) {
    const wide = Math.min(free[(k + n - 1) % n]!, free[k]!, free[(k + 1) % n]!);
    const value = wide + SPAWN_FACING.bonusM * Math.cos(k * step);
    if (value > bestValue + 1e-9) {
      bestValue = value;
      best = k;
    }
  }
  return best === 0 ? yaw : wrapAngle(yaw + best * step);
}
