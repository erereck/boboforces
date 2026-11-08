// Física cosmética (tecnico.md §4.4: fora da sim, sem sincronizar): pontos Verlet (posição atual e anterior) contra a
// grade do mapa, SÓ LEITURA, respeitando as formas do catálogo (`shapes.ts` do world: caixas e piso inclinado). Serve
// aos cubinhos de detrito e às 6 partes do desmonte. Sem three, sem alocação.
import {
  BLOCK_FLAG,
  cellOrientation,
  MAX_BLOCK_ID,
  SHAPE_ID,
  shapeCollision,
  shapeCollisionBoxes,
  shapeFloorHeight,
  type BlockRegistry,
  type ShapeId,
  type WorldGrid,
} from '@boboforces/world';

/** O que a física cosmética lê do mapa. */
export interface CollisionWorld {
  readonly grid: WorldGrid;
  readonly blocks: BlockRegistry;
}

const boxScratch = new Float32Array(12);

/** Bloco da célula, se for sólido para a colisão; senão 0. */
function solidBlock(world: CollisionWorld, cx: number, cy: number, cz: number): number {
  const grid = world.grid;
  if (cx < 0 || cz < 0 || cy < 0 || cx >= grid.sizeX || cz >= grid.sizeZ || cy >= grid.sizeY) return 0;
  const cell = grid.get(cx, cy, cz);
  if (cell === 0) return 0;
  const id = cell & MAX_BLOCK_ID;
  if (id >= world.blocks.size || (world.blocks.flags[id]! & BLOCK_FLAG.solid) === 0) return 0;
  return cell;
}

/**
 * O ponto (m) está dentro de algo sólido? Abaixo de y = 0 conta como chão (nada cai para sempre); fora da grade em X/Z
 * e acima dela é ar (detrito pode voar por cima da parede invisível e some pelo tempo de vida).
 */
export function pointSolid(world: CollisionWorld, x: number, y: number, z: number): boolean {
  if (y < 0) return true;
  const px = x * 2;
  const py = y * 2;
  const pz = z * 2;
  const cx = Math.floor(px);
  const cy = Math.floor(py);
  const cz = Math.floor(pz);
  const cell = solidBlock(world, cx, cy, cz);
  if (cell === 0) return false;
  const shape = world.blocks.shapes[cell & MAX_BLOCK_ID]!;
  if (shape === SHAPE_ID.cube) return true;
  const orientation = cellOrientation(cell);
  const kind = shapeCollision(shape as ShapeId, orientation);
  if (kind === 'none') return false;
  const fx = px - cx;
  const fy = py - cy;
  const fz = pz - cz;
  if (kind === 'slope') return fy < shapeFloorHeight(shape as ShapeId, orientation, fx, fz);
  const n = shapeCollisionBoxes(shape as ShapeId, orientation, boxScratch);
  const sx = fx * 16;
  const sy = fy * 16;
  const sz = fz * 16;
  for (let k = 0; k < n; k++) {
    const o = k * 6;
    if (
      sx >= boxScratch[o]! &&
      sy >= boxScratch[o + 1]! &&
      sz >= boxScratch[o + 2]! &&
      sx < boxScratch[o + 3]! &&
      sy < boxScratch[o + 4]! &&
      sz < boxScratch[o + 5]!
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Altura (m) da superfície sólida mais alta abaixo de (x, y, z), procurando até `maxDown` metros; `NaN` se não achar.
 * Para a sombra-blob de quem está no ar e para assentar um detrito que bateu no chão.
 */
export function floorBelow(world: CollisionWorld, x: number, y: number, z: number, maxDown: number): number {
  if (y <= 0) return 0;
  const cx = Math.floor(x * 2);
  const cz = Math.floor(z * 2);
  const fx = x * 2 - cx;
  const fz = z * 2 - cz;
  const top = Math.floor(y * 2);
  const bottom = Math.max(-1, Math.floor((y - maxDown) * 2));
  for (let cy = top; cy >= bottom; cy--) {
    if (cy < 0) return 0;
    const cell = solidBlock(world, cx, cy, cz);
    if (cell === 0) continue;
    const shape = world.blocks.shapes[cell & MAX_BLOCK_ID]!;
    const orientation = cellOrientation(cell);
    let h = -1;
    if (shape === SHAPE_ID.cube) h = 1;
    else {
      const kind = shapeCollision(shape as ShapeId, orientation);
      if (kind === 'slope') h = shapeFloorHeight(shape as ShapeId, orientation, fx, fz);
      else if (kind === 'boxes') {
        const n = shapeCollisionBoxes(shape as ShapeId, orientation, boxScratch);
        for (let k = 0; k < n; k++) {
          const o = k * 6;
          const inside =
            fx * 16 >= boxScratch[o]! &&
            fz * 16 >= boxScratch[o + 2]! &&
            fx * 16 < boxScratch[o + 3]! &&
            fz * 16 < boxScratch[o + 5]!;
          if (inside) h = Math.max(h, boxScratch[o + 4]! / 16);
        }
      }
    }
    if (h < 0) continue;
    const surface = (cy + h) * 0.5;
    if (surface <= y + 1e-4) return surface;
  }
  return Number.NaN;
}

/** Parâmetros do material do corpo cosmético. */
export interface VerletParams {
  /** m/s² para baixo. */
  readonly gravity: number;
  /** Fração da velocidade devolvida na batida (0..1). */
  readonly bounce: number;
  /** Atrito no chão por segundo (0..1 da velocidade horizontal perdida por segundo, aproximado). */
  readonly friction: number;
  /** Arrasto do ar por segundo. */
  readonly drag: number;
}

/** Bits do resultado de `verletStep`. */
export const VERLET_HIT = { ground: 1, wall: 2, ceiling: 4 } as const;

/**
 * Um passo de Verlet com colisão eixo a eixo (Y, X, Z) contra a grade. `pos`/`prev` em metros (3 floats a partir de
 * `o`); a velocidade implícita é (pos − prev) por `prevDt`. `ex/ey/ez` = meias medidas do corpo para a colisão. Sem
 * `world`, só cai (sem chão). Devolve os bits de `VERLET_HIT`.
 */
export function verletStep(
  pos: Float32Array,
  prev: Float32Array,
  o: number,
  dt: number,
  prevDt: number,
  ex: number,
  ey: number,
  ez: number,
  world: CollisionWorld | null,
  params: VerletParams,
): number {
  if (dt <= 0) return 0;
  const k = prevDt > 0 ? dt / prevDt : 1;
  const air = Math.max(0, 1 - params.drag * dt);
  let dx = (pos[o]! - prev[o]!) * k * air;
  const dy = (pos[o + 1]! - prev[o + 1]!) * k * air - params.gravity * dt * dt;
  let dz = (pos[o + 2]! - prev[o + 2]!) * k * air;
  const x = pos[o]!;
  const y = pos[o + 1]!;
  const z = pos[o + 2]!;
  let nx = x;
  let ny = y + dy;
  let nz = z;
  let hit = 0;

  if (world) {
    // Y: chão (assenta na superfície) ou teto.
    if (dy <= 0 && pointSolid(world, x, ny - ey, z)) {
      // Procura o piso a partir do CENTRO: se o giro aumentou a meia altura e a base já entrou no chão, o corpo é
      // empurrado para cima em vez de afundar até o piso de baixo.
      const floor = floorBelow(world, x, y, z, ey - dy + 0.1);
      ny = Number.isNaN(floor) ? y : Math.max(ny, floor + ey);
      hit |= VERLET_HIT.ground;
    } else if (dy > 0 && pointSolid(world, x, ny + ey, z)) {
      ny = y;
      hit |= VERLET_HIT.ceiling;
    }
    // X e Z: parede devolve a velocidade daquele eixo com o `bounce`.
    nx = x + dx;
    const sx = dx > 0 ? ex : -ex;
    if (dx !== 0 && pointSolid(world, nx + sx, ny, nz)) {
      nx = x;
      dx = -dx * params.bounce;
      hit |= VERLET_HIT.wall;
    }
    nz = z + dz;
    const sz = dz > 0 ? ez : -ez;
    if (dz !== 0 && pointSolid(world, nx, ny, nz + sz)) {
      nz = z;
      dz = -dz * params.bounce;
      hit |= VERLET_HIT.wall;
    }
  } else {
    nx = x + dx;
    nz = z + dz;
  }

  let vy = ny - y;
  if ((hit & VERLET_HIT.ground) !== 0) {
    // Quica com perda; devagar demais, para. Atrito na horizontal.
    vy = -dy * params.bounce;
    if (Math.abs(vy) < 0.6 * dt) vy = 0;
    const f = Math.max(0, 1 - params.friction * dt);
    dx *= f;
    dz *= f;
  } else if ((hit & VERLET_HIT.ceiling) !== 0) {
    vy = -dy * params.bounce;
  }
  pos[o] = nx;
  pos[o + 1] = ny;
  pos[o + 2] = nz;
  // O passo seguinte enxerga a velocidade nova pelo "anterior" (Verlet com batida): dx/dz já trazem o quique da
  // parede e o atrito do chão.
  prev[o] = nx - dx;
  prev[o + 1] = ny - vy;
  prev[o + 2] = nz - dz;
  return hit;
}
