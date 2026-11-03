import { BLOCK_FLAG, type BlockRegistry } from './blocks.ts';
import { cellBlock, type Cell } from './cell.ts';
import { BLOCK_SIZE, CELLS_PER_METER } from './constants.ts';
import type { WorldGrid } from './grid.ts';

/**
 * Consultas espaciais contra a grade (tecnico.md §7): raio por DDA e AABB varrida com degrau automático.
 * Tudo sem alocação: o resultado vai em objetos de rascunho passados pelo chamador.
 *
 * Limites do mundo: fora da grade em X ou Z conta como parede invisível para a COLISÃO (ninguém sai andando do mapa);
 * abaixo ou acima da grade em Y é ar (quem cai sai pelo plano de morte da sim). Para RAIOS, fora da grade é sempre ar
 * (bala e visão passam por cima das paredes invisíveis).
 *
 * M0: toda célula sólida conta como cubo cheio. Lajes, rampas e caixas das formas do catálogo chegam no M1.
 */

/** Folga numérica para faces encostadas (evita "grudar" em parede ou afundar no chão por arredondamento). */
const EPS = 1e-7;

/** Resultado de um raio por DDA. */
export interface RayHit {
  hit: boolean;
  /** Distância em metros até o ponto de impacto. */
  distance: number;
  /** Ponto de impacto em metros. */
  x: number;
  y: number;
  z: number;
  /** Célula atingida. */
  cellX: number;
  cellY: number;
  cellZ: number;
  cell: Cell;
  /** Normal da face atingida (eixo: -1, 0 ou 1). */
  normalX: number;
  normalY: number;
  normalZ: number;
}

export function createRayHit(): RayHit {
  return {
    hit: false,
    distance: 0,
    x: 0,
    y: 0,
    z: 0,
    cellX: 0,
    cellY: 0,
    cellZ: 0,
    cell: 0,
    normalX: 0,
    normalY: 0,
    normalZ: 0,
  };
}

/**
 * Raio por DDA na grade (Amanatides & Woo) até o primeiro bloco com algum bit de `mask` (`BLOCK_FLAG.blocksBullets`
 * para tiro, `blocksSight` para visão). Direção unitária, em metros. Devolve `out.hit`. Se a origem já estiver dentro de
 * um bloco que bloqueia, acerta na distância 0 com normal nula.
 */
export function raycastGrid(
  grid: WorldGrid,
  registry: BlockRegistry,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDistance: number,
  mask: number,
  out: RayHit,
): boolean {
  out.hit = false;
  out.distance = maxDistance;
  out.x = ox + dx * maxDistance;
  out.y = oy + dy * maxDistance;
  out.z = oz + dz * maxDistance;
  out.normalX = 0;
  out.normalY = 0;
  out.normalZ = 0;

  const flags = registry.flags;
  const px = ox * CELLS_PER_METER;
  const py = oy * CELLS_PER_METER;
  const pz = oz * CELLS_PER_METER;
  let cx = Math.floor(px);
  let cy = Math.floor(py);
  let cz = Math.floor(pz);
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  // Distância (m) para atravessar uma célula inteira em cada eixo, e até a próxima fronteira.
  const tDeltaX = stepX !== 0 ? BLOCK_SIZE / Math.abs(dx) : Infinity;
  const tDeltaY = stepY !== 0 ? BLOCK_SIZE / Math.abs(dy) : Infinity;
  const tDeltaZ = stepZ !== 0 ? BLOCK_SIZE / Math.abs(dz) : Infinity;
  let tMaxX = stepX > 0 ? (cx + 1 - px) * tDeltaX : stepX < 0 ? (px - cx) * tDeltaX : Infinity;
  let tMaxY = stepY > 0 ? (cy + 1 - py) * tDeltaY : stepY < 0 ? (py - cy) * tDeltaY : Infinity;
  let tMaxZ = stepZ > 0 ? (cz + 1 - pz) * tDeltaZ : stepZ < 0 ? (pz - cz) * tDeltaZ : Infinity;
  let t = 0;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const sizeX = grid.sizeX;
  const sizeY = grid.sizeY;
  const sizeZ = grid.sizeZ;

  for (;;) {
    const cell = grid.get(cx, cy, cz);
    if (cell !== 0 && (flags[cellBlock(cell)]! & mask) !== 0) {
      out.hit = true;
      out.distance = t;
      out.x = ox + dx * t;
      out.y = oy + dy * t;
      out.z = oz + dz * t;
      out.cellX = cx;
      out.cellY = cy;
      out.cellZ = cz;
      out.cell = cell;
      out.normalX = nx;
      out.normalY = ny;
      out.normalZ = nz;
      return true;
    }
    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        t = tMaxX;
        cx += stepX;
        tMaxX += tDeltaX;
        nx = -stepX;
        ny = 0;
        nz = 0;
      } else {
        t = tMaxZ;
        cz += stepZ;
        tMaxZ += tDeltaZ;
        nx = 0;
        ny = 0;
        nz = -stepZ;
      }
    } else if (tMaxY < tMaxZ) {
      t = tMaxY;
      cy += stepY;
      tMaxY += tDeltaY;
      nx = 0;
      ny = -stepY;
      nz = 0;
    } else {
      t = tMaxZ;
      cz += stepZ;
      tMaxZ += tDeltaZ;
      nx = 0;
      ny = 0;
      nz = -stepZ;
    }
    if (t > maxDistance) return false;
    // Fora da grade e se afastando dela: nada mais para acertar.
    if ((cx < 0 && stepX <= 0) || (cx >= sizeX && stepX >= 0)) return false;
    if ((cy < 0 && stepY <= 0) || (cy >= sizeY && stepY >= 0)) return false;
    if ((cz < 0 && stepZ <= 0) || (cz >= sizeZ && stepZ >= 0)) return false;
  }
}

/** AABB em metros (mínimo e máximo). */
export interface Aabb {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export function createAabb(): Aabb {
  return { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
}

/** Resultado do movimento varrido de uma AABB. */
export interface SweepResult {
  /** Deslocamento efetivamente aplicado, em metros. */
  dx: number;
  dy: number;
  dz: number;
  /** Bateu em cada eixo (para zerar velocidade e detectar chão/teto). */
  hitX: boolean;
  hitY: boolean;
  hitZ: boolean;
  onGround: boolean;
  /** Subiu degrau automático neste movimento (a câmera suaviza). */
  stepped: boolean;
}

export function createSweepResult(): SweepResult {
  return { dx: 0, dy: 0, dz: 0, hitX: false, hitY: false, hitZ: false, onGround: false, stepped: false };
}

/**
 * Célula sólida para a colisão, com as paredes invisíveis nas bordas X/Z (ver o topo do arquivo).
 * Coordenadas em células.
 */
export function isCellSolid(grid: WorldGrid, registry: BlockRegistry, x: number, y: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= grid.sizeX || z >= grid.sizeZ) return true;
  if (y < 0 || y >= grid.sizeY) return false;
  const cell = grid.get(x, y, z);
  return cell !== 0 && (registry.flags[cellBlock(cell)]! & BLOCK_FLAG.solid) !== 0;
}

/** A AABB encosta (com folga) em algum sólido? Serve para "dá para levantar do agachado?" e spawns. */
export function boxIntersectsSolid(grid: WorldGrid, registry: BlockRegistry, box: Aabb): boolean {
  const x0 = Math.floor((box.minX + EPS) * CELLS_PER_METER);
  const x1 = Math.floor((box.maxX - EPS) * CELLS_PER_METER);
  const y0 = Math.floor((box.minY + EPS) * CELLS_PER_METER);
  const y1 = Math.floor((box.maxY - EPS) * CELLS_PER_METER);
  const z0 = Math.floor((box.minZ + EPS) * CELLS_PER_METER);
  const z1 = Math.floor((box.maxZ - EPS) * CELLS_PER_METER);
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (isCellSolid(grid, registry, x, y, z)) return true;
      }
    }
  }
  return false;
}

/**
 * Quanto a AABB pode andar `d` metros em Y antes de encostar num sólido. Só considera células à frente da face que se
 * move (as que a caixa já invade são ignoradas, para nunca "puxar" para trás).
 */
function clipY(grid: WorldGrid, registry: BlockRegistry, b: Aabb, d: number): number {
  if (d === 0) return 0;
  const x0 = Math.floor((b.minX + EPS) * CELLS_PER_METER);
  const x1 = Math.floor((b.maxX - EPS) * CELLS_PER_METER);
  const z0 = Math.floor((b.minZ + EPS) * CELLS_PER_METER);
  const z1 = Math.floor((b.maxZ - EPS) * CELLS_PER_METER);
  if (d > 0) {
    const first = Math.ceil((b.maxY - EPS) * CELLS_PER_METER);
    const last = Math.ceil((b.maxY + d) * CELLS_PER_METER) - 1;
    for (let y = first; y <= last; y++) {
      if (layerSolidY(grid, registry, y, x0, x1, z0, z1)) return Math.max(0, Math.min(d, y * BLOCK_SIZE - b.maxY));
    }
  } else {
    const first = Math.floor((b.minY + EPS) * CELLS_PER_METER) - 1;
    const last = Math.floor((b.minY + d) * CELLS_PER_METER);
    for (let y = first; y >= last; y--) {
      if (layerSolidY(grid, registry, y, x0, x1, z0, z1)) {
        return Math.min(0, Math.max(d, (y + 1) * BLOCK_SIZE - b.minY));
      }
    }
  }
  return d;
}

function clipX(grid: WorldGrid, registry: BlockRegistry, b: Aabb, d: number): number {
  if (d === 0) return 0;
  const y0 = Math.floor((b.minY + EPS) * CELLS_PER_METER);
  const y1 = Math.floor((b.maxY - EPS) * CELLS_PER_METER);
  const z0 = Math.floor((b.minZ + EPS) * CELLS_PER_METER);
  const z1 = Math.floor((b.maxZ - EPS) * CELLS_PER_METER);
  if (d > 0) {
    const first = Math.ceil((b.maxX - EPS) * CELLS_PER_METER);
    const last = Math.ceil((b.maxX + d) * CELLS_PER_METER) - 1;
    for (let x = first; x <= last; x++) {
      if (layerSolidX(grid, registry, x, y0, y1, z0, z1)) return Math.max(0, Math.min(d, x * BLOCK_SIZE - b.maxX));
    }
  } else {
    const first = Math.floor((b.minX + EPS) * CELLS_PER_METER) - 1;
    const last = Math.floor((b.minX + d) * CELLS_PER_METER);
    for (let x = first; x >= last; x--) {
      if (layerSolidX(grid, registry, x, y0, y1, z0, z1)) {
        return Math.min(0, Math.max(d, (x + 1) * BLOCK_SIZE - b.minX));
      }
    }
  }
  return d;
}

function clipZ(grid: WorldGrid, registry: BlockRegistry, b: Aabb, d: number): number {
  if (d === 0) return 0;
  const x0 = Math.floor((b.minX + EPS) * CELLS_PER_METER);
  const x1 = Math.floor((b.maxX - EPS) * CELLS_PER_METER);
  const y0 = Math.floor((b.minY + EPS) * CELLS_PER_METER);
  const y1 = Math.floor((b.maxY - EPS) * CELLS_PER_METER);
  if (d > 0) {
    const first = Math.ceil((b.maxZ - EPS) * CELLS_PER_METER);
    const last = Math.ceil((b.maxZ + d) * CELLS_PER_METER) - 1;
    for (let z = first; z <= last; z++) {
      if (layerSolidZ(grid, registry, z, x0, x1, y0, y1)) return Math.max(0, Math.min(d, z * BLOCK_SIZE - b.maxZ));
    }
  } else {
    const first = Math.floor((b.minZ + EPS) * CELLS_PER_METER) - 1;
    const last = Math.floor((b.minZ + d) * CELLS_PER_METER);
    for (let z = first; z >= last; z--) {
      if (layerSolidZ(grid, registry, z, x0, x1, y0, y1)) {
        return Math.min(0, Math.max(d, (z + 1) * BLOCK_SIZE - b.minZ));
      }
    }
  }
  return d;
}

function layerSolidY(
  grid: WorldGrid,
  registry: BlockRegistry,
  y: number,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
): boolean {
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) if (isCellSolid(grid, registry, x, y, z)) return true;
  }
  return false;
}

function layerSolidX(
  grid: WorldGrid,
  registry: BlockRegistry,
  x: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
): boolean {
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) if (isCellSolid(grid, registry, x, y, z)) return true;
  }
  return false;
}

function layerSolidZ(
  grid: WorldGrid,
  registry: BlockRegistry,
  z: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): boolean {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) if (isCellSolid(grid, registry, x, y, z)) return true;
  }
  return false;
}

function moveBoxTo(box: Aabb, minX: number, minY: number, minZ: number): void {
  box.maxX = minX + (box.maxX - box.minX);
  box.maxY = minY + (box.maxY - box.minY);
  box.maxZ = minZ + (box.maxZ - box.minZ);
  box.minX = minX;
  box.minY = minY;
  box.minZ = minZ;
}

/**
 * Move a AABB eixo a eixo contra os blocos sólidos (estilo Minecraft: Y, depois X, depois Z), com degrau automático
 * de até `stepHeight` metros (0,5 m no perfil Bobo). Altera `box` para a posição final.
 *
 * Degrau: se o movimento horizontal bateu e o vertical não sobe (`dy <= 0`), tenta de novo a partir da origem
 * "subindo `stepHeight`, andando e descendo de volta"; fica com a tentativa que andar mais no plano. Quem chama decide
 * quando pode (no chão: o degrau do perfil; no ar: o que sobra do mantle, ver a sim). `stepHeight = 0` desliga.
 */
export function sweepAabb(
  grid: WorldGrid,
  registry: BlockRegistry,
  box: Aabb,
  dx: number,
  dy: number,
  dz: number,
  stepHeight: number,
  out: SweepResult,
): SweepResult {
  const startX = box.minX;
  const startY = box.minY;
  const startZ = box.minZ;

  let ry = clipY(grid, registry, box, dy);
  box.minY += ry;
  box.maxY += ry;
  let rx = clipX(grid, registry, box, dx);
  box.minX += rx;
  box.maxX += rx;
  let rz = clipZ(grid, registry, box, dz);
  box.minZ += rz;
  box.maxZ += rz;

  let hitX = rx !== dx;
  let hitY = ry !== dy;
  let hitZ = rz !== dz;
  let onGround = hitY && dy < 0;
  let stepped = false;

  if (stepHeight > 0 && dy <= 0 && (hitX || hitZ)) {
    const endX = box.minX;
    const endY = box.minY;
    const endZ = box.minZ;
    moveBoxTo(box, startX, startY, startZ);
    const up = clipY(grid, registry, box, stepHeight);
    box.minY += up;
    box.maxY += up;
    const sx = clipX(grid, registry, box, dx);
    box.minX += sx;
    box.maxX += sx;
    const sz = clipZ(grid, registry, box, dz);
    box.minZ += sz;
    box.maxZ += sz;
    const downWanted = -up + dy;
    const down = clipY(grid, registry, box, downWanted);
    box.minY += down;
    box.maxY += down;
    if (sx * sx + sz * sz > rx * rx + rz * rz + 1e-12) {
      rx = sx;
      rz = sz;
      ry = box.minY - startY;
      hitX = sx !== dx;
      hitZ = sz !== dz;
      hitY = down !== downWanted;
      onGround = hitY;
      stepped = ry > 1e-6;
    } else {
      moveBoxTo(box, endX, endY, endZ);
    }
  }

  out.dx = rx;
  out.dy = ry;
  out.dz = rz;
  out.hitX = hitX;
  out.hitY = hitY;
  out.hitZ = hitZ;
  out.onGround = onGround;
  out.stepped = stepped;
  return out;
}
