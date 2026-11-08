import { BLOCK_FLAG, type BlockRegistry } from './blocks.ts';
import { cellBlock, CELL_ROTATION_SHIFT, MAX_BLOCK_ID, type Cell } from './cell.ts';
import { COLLIDER_CELL_M, COLLIDER_FLAG, COLLIDER_STRIDE, type StaticColliders } from './colliders.ts';
import { BLOCK_SIZE, CELLS_PER_METER } from './constants.ts';
import type { WorldGrid } from './grid.ts';
import { NORMAL, NORMAL_TABLE } from './mesh/vertex.ts';
import {
  COLL_BOXES,
  COLL_CUBE,
  COLL_NONE,
  COLL_SLOPE,
  RAY_BOXES,
  RAY_CROSS,
  RAY_CUBE,
  RAY_NONE,
  RAY_PARTS,
  SLOPE_MAX,
  SLOPE_SINGLE,
  SO_COLL_BOXES,
  SO_COLL_COUNT,
  SO_COLL_KIND,
  SO_RAY_BOXES,
  SO_RAY_COUNT,
  SO_RAY_KIND,
  SO_RAY_PLANE_COUNT,
  SO_RAY_PLANES,
  SO_SLOPE,
  SO_SLOPE_OP,
  SO_STEPPABLE,
  slopeMaxInRect,
} from './shape-geometry.ts';

/**
 * Consultas espaciais contra a grade (tecnico.md §7): raio por DDA e AABB varrida com degrau automático.
 * Tudo sem alocação: o resultado vai em objetos de rascunho passados pelo chamador; o estado intermediário fica em
 * variáveis do módulo (as consultas não são reentrantes; o jogo roda numa thread só).
 *
 * Limites do mundo: fora da grade em X ou Z conta como parede invisível para a COLISÃO (ninguém sai andando do mapa);
 * abaixo ou acima da grade em Y é ar (quem cai sai pelo plano de morte da sim). Para RAIOS, fora da grade é sempre ar
 * (bala e visão passam por cima das paredes invisíveis).
 *
 * M1: as consultas respeitam as formas do catálogo (`shapes.ts`, tabelas em `shape-geometry.ts`):
 * - colisão: cubo (caminho do M0, bit a bit igual), caixas de `shapeCollisionBoxes` (laje, degrau, painel, poste,
 *   rampa invertida = cubo) e o piso inclinado de `shapeFloorHeight` (rampas em pé), com o ponto de contato exato;
 *   a cruz não colide. Com `colliders`, as caixas das props (`colliders.ts`) entram como mais caixas.
 * - rampa: andando contra o plano, a caixa SOBE pelo plano (até 1:1, a rampa mais íngreme) em vez de bater; descendo,
 *   ela acompanha o plano se estava apoiada. Nenhum dos dois marca `stepped` (a câmera não suaviza rampa).
 * - degrau automático: igual ao M0, mas não pousa em cima de painel nem de poste + travessa (cerca bloqueia) nem de
 *   prop sem `COLLIDER_FLAG.walkable`.
 * - raio: caixas (o poste + travessa usa as visuais: a bala passa no vão), planos das rampas (em pé e invertidas) e os
 *   dois planos da cruz, respeitando a máscara (`blocksBullets`, `blocksSight`); props pela mesma máscara.
 * Sem `colliders` (ou `null`), só a grade, como no M0.
 */

/** Índice de `FACE` (0..5) a partir da normal de eixo do DDA; -1 sem normal. */
function axisFace(nx: number, ny: number, nz: number): number {
  if (nx > 0) return 0;
  if (nx < 0) return 1;
  if (ny > 0) return 2;
  if (ny < 0) return 3;
  if (nz > 0) return 4;
  if (nz < 0) return 5;
  return -1;
}

/** Folga numérica para faces encostadas (evita "grudar" em parede ou afundar no chão por arredondamento). */
const EPS = 1e-7;
/** A mesma folga em frações de célula. */
const EPS_F = EPS * CELLS_PER_METER;
/** Rampa mais íngreme do catálogo (1:1): quanto a caixa pode subir por metro andado contra um plano. */
const MAX_SLOPE = 1;
/** Folga da subida/descida pela rampa (arredondamento da conta do plano). */
const SLOPE_TOL = 1e-6;
/** Quanto a caixa pode estar afundada no plano da rampa e ainda ser erguida ao andar (deriva numérica, spawn rente). */
const SLOPE_SNAP = 0.02;
const S = BLOCK_SIZE;

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
  /** Normal da face atingida (unitária: nas faces de eixo -1, 0 ou 1; nos planos de rampa, inclinada). */
  normalX: number;
  normalY: number;
  normalZ: number;
  /**
   * M1: índice da face atingida na `NORMAL_TABLE` (0..5 = `FACE` nas faces de eixo; planos de rampa e cruz a partir
   * do 6), ou -1 quando o raio parou numa prop ou começou dentro do sólido. Com `BlockDef.faces` e `shapeFaceSource`
   * dá a camada do texel atingido (cor dos cubinhos).
   */
  face: number;
  /** M1: índice da caixa de prop atingida em `StaticColliders` (-1 = cenário da grade ou nada). */
  prop: number;
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
    face: -1,
    prop: -1,
  };
}

/** `so` (forma × orientação) da célula para a COLISÃO, ou -1 (ar, bloco não sólido, cruz, id fora do registro). */
function solidSo(registry: BlockRegistry, cell: Cell): number {
  if (cell === 0) return -1;
  const id = cell & MAX_BLOCK_ID;
  if ((registry.flags[id]! & BLOCK_FLAG.solid) === 0) return -1;
  const so = registry.shapes[id]! * 8 + ((cell >>> CELL_ROTATION_SHIFT) & 7);
  return SO_COLL_KIND[so] === COLL_NONE ? -1 : so;
}

// ---------------------------------------------------------------------------------------------------------------------
// Raio
// ---------------------------------------------------------------------------------------------------------------------

// Saída das funções de raio contra uma forma/prop (rascunho do módulo).
let rayFace = -1;
let rayNX = 0;
let rayNY = 0;
let rayNZ = 0;
let rayInside = false;

// Estado do teste de laje (slab test) em curso.
let slabEnter = 0;
let slabExit = 0;
let slabFace = -1;

/** Interseção com o intervalo [lo, hi] num eixo; `faceNeg`/`facePos` = face de entrada quando d > 0 / d < 0. */
function slabAxis(o: number, d: number, lo: number, hi: number, faceWhenPositive: number, faceWhenNegative: number) {
  if (d === 0) {
    if (o < lo || o > hi) slabExit = -Infinity;
    return;
  }
  const inv = 1 / d;
  let t0 = (lo - o) * inv;
  let t1 = (hi - o) * inv;
  let f = faceWhenPositive;
  if (t0 > t1) {
    const s = t0;
    t0 = t1;
    t1 = s;
    f = faceWhenNegative;
  }
  if (t0 > slabEnter) {
    slabEnter = t0;
    slabFace = f;
  }
  if (t1 < slabExit) slabExit = t1;
}

/** Começa o teste de laje contra a caixa [x0..x1]×[y0..y1]×[z0..z1] (frações ou metros, conforme o raio). */
function slabBox(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): void {
  slabEnter = -Infinity;
  slabExit = Infinity;
  slabFace = -1;
  // Entrando com d > 0 pela face mínima (normal -eixo); com d < 0 pela máxima (normal +eixo).
  slabAxis(ox, dx, x0, x1, 1, 0);
  slabAxis(oy, dy, y0, y1, 3, 2);
  slabAxis(oz, dz, z0, z1, 5, 4);
}

/**
 * Raio contra a forma da célula (cx, cy, cz). Devolve a distância (m) do acerto mais perto, ou -1. `rayInside` liga se
 * a origem já está dentro da forma. Normal e face em `rayN*`/`rayFace`.
 */
function rayShape(
  so: number,
  cx: number,
  cy: number,
  cz: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
): number {
  // Espaço da célula em frações; t continua em metros (direção × 2).
  const lx = ox * CELLS_PER_METER - cx;
  const ly = oy * CELLS_PER_METER - cy;
  const lz = oz * CELLS_PER_METER - cz;
  const ldx = dx * CELLS_PER_METER;
  const ldy = dy * CELLS_PER_METER;
  const ldz = dz * CELLS_PER_METER;
  const kind = SO_RAY_KIND[so]!;
  let best = Infinity;
  let bestFace = -1;
  rayInside = false;
  if (kind === RAY_BOXES) {
    for (let i = 0, n = SO_RAY_COUNT[so]!; i < n; i++) {
      const o = so * 18 + i * 6;
      slabBox(
        lx,
        ly,
        lz,
        ldx,
        ldy,
        ldz,
        SO_RAY_BOXES[o]!,
        SO_RAY_BOXES[o + 1]!,
        SO_RAY_BOXES[o + 2]!,
        SO_RAY_BOXES[o + 3]!,
        SO_RAY_BOXES[o + 4]!,
        SO_RAY_BOXES[o + 5]!,
      );
      if (slabEnter > slabExit || slabExit < 0) continue;
      if (slabEnter < 0) {
        rayInside = true;
        return 0;
      }
      if (slabEnter < best) {
        best = slabEnter;
        bestFace = slabFace;
      }
    }
  } else if (kind === RAY_PARTS) {
    for (let part = 0, n = SO_RAY_COUNT[so]!; part < n; part++) {
      slabBox(lx, ly, lz, ldx, ldy, ldz, 0, 0, 0, 1, 1, 1);
      for (let k = 0, m = SO_RAY_PLANE_COUNT[so * 2 + part]!; k < m; k++) {
        const at = ((so * 2 + part) * 2 + k) * 5;
        const nx = SO_RAY_PLANES[at]!;
        const ny = SO_RAY_PLANES[at + 1]!;
        const nz = SO_RAY_PLANES[at + 2]!;
        const denom = nx * ldx + ny * ldy + nz * ldz;
        const num = SO_RAY_PLANES[at + 3]! - (nx * lx + ny * ly + nz * lz);
        if (denom === 0) {
          if (num < 0) slabExit = -Infinity;
          continue;
        }
        const t = num / denom;
        if (denom < 0) {
          if (t > slabEnter) {
            slabEnter = t;
            slabFace = SO_RAY_PLANES[at + 4]!;
          }
        } else if (t < slabExit) {
          slabExit = t;
        }
      }
      if (slabEnter > slabExit || slabExit < 0) continue;
      if (slabEnter < 0) {
        rayInside = true;
        return 0;
      }
      if (slabEnter < best) {
        best = slabEnter;
        bestFace = slabFace;
      }
    }
  } else if (kind === RAY_CROSS) {
    // Planos x − z = 0 e x + z = 1 dentro da célula; sem espessura (nunca "dentro").
    for (let p = 0; p < 2; p++) {
      const sz = p === 0 ? -1 : 1;
      const c = p === 0 ? 0 : 1;
      const denom = ldx + sz * ldz;
      if (denom === 0) continue;
      const t = (c - (lx + sz * lz)) / denom;
      if (t < 0 || t >= best) continue;
      const px = lx + ldx * t;
      const py = ly + ldy * t;
      const pz = lz + ldz * t;
      if (px < -EPS_F || px > 1 + EPS_F || py < -EPS_F || py > 1 + EPS_F || pz < -EPS_F || pz > 1 + EPS_F) continue;
      best = t;
      // Normal virada para o raio: (1, 0, sz) se o raio vem do lado dela.
      const front = denom < 0;
      bestFace =
        p === 0
          ? front
            ? NORMAL.cross + 2 // (1, 0, -1)
            : NORMAL.cross + 3 // (-1, 0, 1)
          : front
            ? NORMAL.cross // (1, 0, 1)
            : NORMAL.cross + 1; // (-1, 0, -1)
    }
  }
  if (bestFace < 0) return -1;
  const n = NORMAL_TABLE[bestFace]!;
  rayFace = bestFace;
  rayNX = n[0];
  rayNY = n[1];
  rayNZ = n[2];
  return best;
}

// Raio contra as props (estado do visitante, sem fechamento por chamada).
let rcColl: StaticColliders | null = null;
let rcMask = 0;
let rcOX = 0;
let rcOY = 0;
let rcOZ = 0;
let rcDX = 0;
let rcDY = 0;
let rcDZ = 0;
let rcBest = 0;
let rcIndex = -1;
let rcFace = -1;

function visitRayCollider(i: number): boolean {
  const c = rcColl!;
  if ((c.flags[i]! & rcMask) === 0) return true;
  const o = i * COLLIDER_STRIDE;
  const b = c.boxes;
  slabBox(rcOX, rcOY, rcOZ, rcDX, rcDY, rcDZ, b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!, b[o + 4]!, b[o + 5]!);
  // Origem dentro da caixa da prop: ignora (quem está encostado/dentro de folhagem ainda atira para fora).
  if (slabEnter < 0 || slabEnter > slabExit || slabEnter >= rcBest) return true;
  rcBest = slabEnter;
  rcIndex = i;
  rcFace = slabFace;
  return true;
}

/** Máscara de `BLOCK_FLAG` → bits de `COLLIDER_FLAG`. */
function colliderMask(mask: number): number {
  return (
    (mask & BLOCK_FLAG.solid ? COLLIDER_FLAG.solid : 0) |
    (mask & BLOCK_FLAG.blocksBullets ? COLLIDER_FLAG.blocksBullets : 0) |
    (mask & BLOCK_FLAG.blocksSight ? COLLIDER_FLAG.blocksSight : 0)
  );
}

/** Prop mais perto até `tMax` (m): percorre o raio em trechos de 4 m consultando o hash. Resultado em `rc*`. */
function rayColliders(
  coll: StaticColliders,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  tMax: number,
  mask: number,
): void {
  rcColl = coll;
  rcMask = colliderMask(mask);
  rcOX = ox;
  rcOY = oy;
  rcOZ = oz;
  rcDX = dx;
  rcDY = dy;
  rcDZ = dz;
  rcBest = tMax;
  rcIndex = -1;
  rcFace = -1;
  if (rcMask === 0) return;
  for (let s = 0; s < rcBest; s += COLLIDER_CELL_M) {
    const e = Math.min(s + COLLIDER_CELL_M, rcBest);
    const ax = ox + dx * s;
    const ay = oy + dy * s;
    const az = oz + dz * s;
    const bx = ox + dx * e;
    const by = oy + dy * e;
    const bz = oz + dz * e;
    coll.query(
      Math.min(ax, bx),
      Math.min(ay, by),
      Math.min(az, bz),
      Math.max(ax, bx),
      Math.max(ay, by),
      Math.max(az, bz),
      visitRayCollider,
    );
  }
  rcColl = null;
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
  colliders?: StaticColliders | null,
): boolean {
  out.hit = false;
  out.distance = maxDistance;
  out.x = ox + dx * maxDistance;
  out.y = oy + dy * maxDistance;
  out.z = oz + dz * maxDistance;
  out.normalX = 0;
  out.normalY = 0;
  out.normalZ = 0;
  out.face = -1;
  out.prop = -1;

  const flags = registry.flags;
  const shapes = registry.shapes;
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
      const so = shapes[cellBlock(cell)]! * 8 + ((cell >>> CELL_ROTATION_SHIFT) & 7);
      const kind = SO_RAY_KIND[so]!;
      if (kind === RAY_CUBE) {
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
        out.face = axisFace(nx, ny, nz);
        break;
      }
      if (kind !== RAY_NONE) {
        const th = rayShape(so, cx, cy, cz, ox, oy, oz, dx, dy, dz);
        if (th > maxDistance) break;
        if (th >= 0) {
          out.hit = true;
          out.distance = th;
          out.x = ox + dx * th;
          out.y = oy + dy * th;
          out.z = oz + dz * th;
          out.cellX = cx;
          out.cellY = cy;
          out.cellZ = cz;
          out.cell = cell;
          if (rayInside) {
            out.normalX = 0;
            out.normalY = 0;
            out.normalZ = 0;
            out.face = -1;
          } else {
            out.normalX = rayNX;
            out.normalY = rayNY;
            out.normalZ = rayNZ;
            out.face = rayFace;
          }
          break;
        }
      }
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
    if (t > maxDistance) break;
    // Fora da grade e se afastando dela: nada mais para acertar.
    if ((cx < 0 && stepX <= 0) || (cx >= sizeX && stepX >= 0)) break;
    if ((cy < 0 && stepY <= 0) || (cy >= sizeY && stepY >= 0)) break;
    if ((cz < 0 && stepZ <= 0) || (cz >= sizeZ && stepZ >= 0)) break;
  }

  if (colliders && colliders.count > 0) {
    rayColliders(colliders, ox, oy, oz, dx, dy, dz, out.hit ? out.distance : maxDistance, mask);
    if (rcIndex >= 0 && (!out.hit || rcBest < out.distance)) {
      const n = NORMAL_TABLE[rcFace]!;
      out.hit = true;
      out.distance = rcBest;
      out.x = ox + dx * rcBest;
      out.y = oy + dy * rcBest;
      out.z = oz + dz * rcBest;
      out.normalX = n[0];
      out.normalY = n[1];
      out.normalZ = n[2];
      // Célula logo dentro da caixa (a frente da face atingida).
      out.cellX = Math.floor((out.x - n[0] * 1e-4) * CELLS_PER_METER);
      out.cellY = Math.floor((out.y - n[1] * 1e-4) * CELLS_PER_METER);
      out.cellZ = Math.floor((out.z - n[2] * 1e-4) * CELLS_PER_METER);
      out.cell = grid.get(out.cellX, out.cellY, out.cellZ);
      out.face = -1;
      out.prop = rcIndex;
    }
  }
  return out.hit;
}

// ---------------------------------------------------------------------------------------------------------------------
// Colisão de AABB
// ---------------------------------------------------------------------------------------------------------------------

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
 * Célula com colisão (bloco sólido de forma que colide; laje e rampa contam, cruz não), com as paredes invisíveis nas
 * bordas X/Z (ver o topo do arquivo). Coordenadas em células. Grosso: não diz QUANTO da célula é sólido.
 */
export function isCellSolid(grid: WorldGrid, registry: BlockRegistry, x: number, y: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= grid.sizeX || z >= grid.sizeZ) return true;
  if (y < 0 || y >= grid.sizeY) return false;
  return solidSo(registry, grid.get(x, y, z)) >= 0;
}

/** A AABB encosta (com folga) em algum sólido da GRADE? Serve para "dá para levantar do agachado?" e spawns. */
export function boxIntersectsSolid(grid: WorldGrid, registry: BlockRegistry, box: Aabb): boolean {
  return boxIntersectsWorld(grid, registry, box, null);
}

/**
 * Como `boxIntersectsSolid`, contando também as caixas sólidas das props (`colliders`). Função nova do M1 (o
 * `boxIntersectsSolid` do contrato não recebe colisores): use esta para levantar do agachado perto de prop.
 */
export function boxIntersectsWorld(
  grid: WorldGrid,
  registry: BlockRegistry,
  box: Aabb,
  colliders: StaticColliders | null | undefined,
): boolean {
  const x0 = Math.floor((box.minX + EPS) * CELLS_PER_METER);
  const x1 = Math.floor((box.maxX - EPS) * CELLS_PER_METER);
  const y0 = Math.floor((box.minY + EPS) * CELLS_PER_METER);
  const y1 = Math.floor((box.maxY - EPS) * CELLS_PER_METER);
  const z0 = Math.floor((box.minZ + EPS) * CELLS_PER_METER);
  const z1 = Math.floor((box.maxZ - EPS) * CELLS_PER_METER);
  const sizeX = grid.sizeX;
  const sizeY = grid.sizeY;
  const sizeZ = grid.sizeZ;
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || z < 0 || x >= sizeX || z >= sizeZ) return true;
        if (y < 0 || y >= sizeY) continue;
        const so = solidSo(registry, grid.get(x, y, z));
        if (so < 0) continue;
        const kind = SO_COLL_KIND[so]!;
        if (kind === COLL_CUBE) return true;
        if (kind === COLL_BOXES) {
          for (let i = 0, n = SO_COLL_COUNT[so]!; i < n; i++) {
            const o = so * 12 + i * 6;
            if (
              x * S + SO_COLL_BOXES[o]! * S < box.maxX - EPS &&
              x * S + SO_COLL_BOXES[o + 3]! * S > box.minX + EPS &&
              y * S + SO_COLL_BOXES[o + 1]! * S < box.maxY - EPS &&
              y * S + SO_COLL_BOXES[o + 4]! * S > box.minY + EPS &&
              z * S + SO_COLL_BOXES[o + 2]! * S < box.maxZ - EPS &&
              z * S + SO_COLL_BOXES[o + 5]! * S > box.minZ + EPS
            ) {
              return true;
            }
          }
        } else {
          const h = footprintSlopeMax(so, x, z, box);
          if (h > EPS_F && box.minY < y * S + h * S - EPS) return true;
        }
      }
    }
  }
  if (colliders && colliders.count > 0) {
    ovColl = colliders;
    ovHit = false;
    ovMinX = box.minX;
    ovMinY = box.minY;
    ovMinZ = box.minZ;
    ovMaxX = box.maxX;
    ovMaxY = box.maxY;
    ovMaxZ = box.maxZ;
    colliders.query(box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ, visitOverlap);
    ovColl = null;
    if (ovHit) return true;
  }
  return false;
}

let ovColl: StaticColliders | null = null;
let ovHit = false;
let ovMinX = 0;
let ovMinY = 0;
let ovMinZ = 0;
let ovMaxX = 0;
let ovMaxY = 0;
let ovMaxZ = 0;

function visitOverlap(i: number): boolean {
  const c = ovColl!;
  if ((c.flags[i]! & COLLIDER_FLAG.solid) === 0) return true;
  const o = i * COLLIDER_STRIDE;
  const b = c.boxes;
  if (
    b[o]! < ovMaxX - EPS &&
    b[o + 3]! > ovMinX + EPS &&
    b[o + 1]! < ovMaxY - EPS &&
    b[o + 4]! > ovMinY + EPS &&
    b[o + 2]! < ovMaxZ - EPS &&
    b[o + 5]! > ovMinZ + EPS
  ) {
    ovHit = true;
    return false;
  }
  return true;
}

/** Máximo do piso inclinado da célula (x, ·, z) sob a pegada XZ da caixa (frações). */
function footprintSlopeMax(so: number, x: number, z: number, b: Aabb): number {
  let fx0 = b.minX * CELLS_PER_METER - x;
  let fx1 = b.maxX * CELLS_PER_METER - x;
  let fz0 = b.minZ * CELLS_PER_METER - z;
  let fz1 = b.maxZ * CELLS_PER_METER - z;
  if (fx0 < 0) fx0 = 0;
  if (fx1 > 1) fx1 = 1;
  if (fz0 < 0) fz0 = 0;
  if (fz1 > 1) fz1 = 1;
  return slopeMaxInRect(so, fx0, fx1, fz0, fz1);
}

// --- Varredura em Y -------------------------------------------------------------------------------------------------

/** Bits do apoio achado pela última descida (`clipY` com d < 0). */
const SUP_SLOPE = 1;
const SUP_STEP = 2;
let ySup = 0;
let yBest = 0;

let cyColl: StaticColliders | null = null;
let cyBox: Aabb | null = null;
let cyDown = false;

function noteTop(cand: number, sup: number): void {
  if (cand > yBest) {
    yBest = cand;
    ySup = sup;
  } else if (cand === yBest) {
    ySup |= sup;
  }
}

function visitClipY(i: number): boolean {
  const c = cyColl!;
  const f = c.flags[i]!;
  if ((f & COLLIDER_FLAG.solid) === 0) return true;
  const b = cyBox!;
  const o = i * COLLIDER_STRIDE;
  const bx = c.boxes;
  if (!(bx[o]! < b.maxX - EPS && bx[o + 3]! > b.minX + EPS && bx[o + 2]! < b.maxZ - EPS && bx[o + 5]! > b.minZ + EPS)) {
    return true;
  }
  if (cyDown) {
    const top = bx[o + 4]!;
    if (top <= b.minY + EPS) noteTop(top - b.minY, f & COLLIDER_FLAG.walkable ? SUP_STEP : 0);
  } else {
    const bottom = bx[o + 1]!;
    if (bottom >= b.maxY - EPS && bottom - b.maxY < yBest) yBest = bottom - b.maxY;
  }
  return true;
}

/**
 * Quanto a AABB pode andar `d` metros em Y antes de encostar num sólido. Só considera o que está à frente da face que
 * se move (o que a caixa já invade é ignorado, para nunca "puxar" para trás). Na descida, `ySup` diz o tipo do apoio.
 */
function clipY(grid: WorldGrid, registry: BlockRegistry, coll: StaticColliders | null, b: Aabb, d: number): number {
  ySup = 0;
  if (d === 0) return 0;
  const x0 = Math.floor((b.minX + EPS) * CELLS_PER_METER);
  const x1 = Math.floor((b.maxX - EPS) * CELLS_PER_METER);
  const z0 = Math.floor((b.minZ + EPS) * CELLS_PER_METER);
  const z1 = Math.floor((b.maxZ - EPS) * CELLS_PER_METER);
  const sizeX = grid.sizeX;
  const sizeY = grid.sizeY;
  const sizeZ = grid.sizeZ;
  yBest = d;
  if (d > 0) {
    const first = Math.floor((b.maxY - EPS) * CELLS_PER_METER);
    const last = Math.ceil((b.maxY + d) * CELLS_PER_METER) - 1;
    for (let y = first; y <= last; y++) {
      if (y * BLOCK_SIZE - b.maxY >= yBest) break;
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          let bottom: number;
          if (x < 0 || z < 0 || x >= sizeX || z >= sizeZ) {
            bottom = y * BLOCK_SIZE;
          } else {
            if (y < 0 || y >= sizeY) continue;
            const so = solidSo(registry, grid.get(x, y, z));
            if (so < 0) continue;
            const kind = SO_COLL_KIND[so]!;
            if (kind === COLL_CUBE) {
              bottom = y * BLOCK_SIZE;
            } else if (kind === COLL_BOXES) {
              for (let i = 0, n = SO_COLL_COUNT[so]!; i < n; i++) {
                const o = so * 12 + i * 6;
                if (
                  x * S + SO_COLL_BOXES[o]! * S < b.maxX - EPS &&
                  x * S + SO_COLL_BOXES[o + 3]! * S > b.minX + EPS &&
                  z * S + SO_COLL_BOXES[o + 2]! * S < b.maxZ - EPS &&
                  z * S + SO_COLL_BOXES[o + 5]! * S > b.minZ + EPS
                ) {
                  const bt = y * S + SO_COLL_BOXES[o + 1]! * S;
                  if (bt >= b.maxY - EPS && bt - b.maxY < yBest) yBest = bt - b.maxY;
                }
              }
              continue;
            } else {
              if (footprintSlopeMax(so, x, z, b) <= EPS_F) continue;
              bottom = y * BLOCK_SIZE;
            }
          }
          if (bottom >= b.maxY - EPS && bottom - b.maxY < yBest) yBest = bottom - b.maxY;
        }
      }
    }
    if (coll) {
      cyColl = coll;
      cyBox = b;
      cyDown = false;
      coll.query(b.minX, b.maxY - EPS, b.minZ, b.maxX, b.maxY + d, b.maxZ, visitClipY);
      cyColl = null;
      cyBox = null;
    }
    return Math.max(0, Math.min(d, yBest));
  }
  const first = Math.floor((b.minY + EPS) * CELLS_PER_METER);
  const last = Math.floor((b.minY + d) * CELLS_PER_METER);
  for (let y = first; y >= last; y--) {
    if ((y + 1) * BLOCK_SIZE - b.minY < yBest) break;
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || z < 0 || x >= sizeX || z >= sizeZ) {
          const top = (y + 1) * BLOCK_SIZE;
          if (top <= b.minY + EPS) noteTop(top - b.minY, 0);
          continue;
        }
        if (y < 0 || y >= sizeY) continue;
        const so = solidSo(registry, grid.get(x, y, z));
        if (so < 0) continue;
        const kind = SO_COLL_KIND[so]!;
        if (kind === COLL_CUBE) {
          const top = (y + 1) * BLOCK_SIZE;
          if (top <= b.minY + EPS) noteTop(top - b.minY, SUP_STEP);
        } else if (kind === COLL_BOXES) {
          const step = SO_STEPPABLE[so] ? SUP_STEP : 0;
          for (let i = 0, n = SO_COLL_COUNT[so]!; i < n; i++) {
            const o = so * 12 + i * 6;
            if (
              x * S + SO_COLL_BOXES[o]! * S < b.maxX - EPS &&
              x * S + SO_COLL_BOXES[o + 3]! * S > b.minX + EPS &&
              z * S + SO_COLL_BOXES[o + 2]! * S < b.maxZ - EPS &&
              z * S + SO_COLL_BOXES[o + 5]! * S > b.minZ + EPS
            ) {
              const top = y * S + SO_COLL_BOXES[o + 4]! * S;
              if (top <= b.minY + EPS) noteTop(top - b.minY, step);
            }
          }
        } else {
          const top = y * S + footprintSlopeMax(so, x, z, b) * S;
          if (top <= b.minY + EPS) noteTop(top - b.minY, SUP_SLOPE | SUP_STEP);
        }
      }
    }
  }
  if (coll) {
    cyColl = coll;
    cyBox = b;
    cyDown = true;
    coll.query(b.minX, b.minY + d, b.minZ, b.maxX, b.minY + EPS, b.maxZ, visitClipY);
    cyColl = null;
    cyBox = null;
  }
  if (yBest === d) ySup = 0;
  return Math.min(0, Math.max(d, yBest));
}

// --- Varredura horizontal (X ou Z) ------------------------------------------------------------------------------------

// Caixa em curso, nos eixos "ao longo" (a) e "através" (c) do movimento.
let hAMin = 0;
let hAMax = 0;
let hCMin = 0;
let hCMax = 0;
let hYMin = 0;
let hYMax = 0;
let hBest = 0;
let hAlongX = true;
let hColl: StaticColliders | null = null;
let hPositive = true;
/** A última varredura horizontal passou por alguma célula de rampa (vale a pena procurar o plano para subir). */
let hSawSlope = false;

/** Contato do piso inclinado ao longo do movimento (ver `slopeContactH`). Rascunho das peças já reduzidas ao eixo. */
let pk0 = 0;
let pb0 = 0;
let pk1 = 0;
let pb1 = 0;

function slopeEval(op: number, t: number): number {
  const p0 = pk0 + pb0 * t;
  if (op === SLOPE_SINGLE) return p0;
  const p1 = pk1 + pb1 * t;
  return op === SLOPE_MAX ? (p0 > p1 ? p0 : p1) : p0 < p1 ? p0 : p1;
}

function pieceThreshold(k: number, b: number, target: number): number {
  if (b > 0) return (target - k) / b;
  return k > target ? 0 : Infinity;
}

/**
 * Onde a face da frente da caixa encosta no sólido inclinado da célula, medido em frações a partir da face de ENTRADA
 * da célula (0..1). `lead`/`trail` = faces da frente e de trás da caixa na mesma medida (podem ser < 0, antes da
 * célula). Devolve -1 sem contato (ou se a caixa já invade a rampa: nunca puxa para trás).
 */
function slopeContact(op: number, lead: number, trail: number, target: number): number {
  const inc = op === SLOPE_SINGLE ? pb0 >= 0 : pb0 + pb1 >= 0;
  if (lead <= 0) {
    if (slopeEval(op, 0) > target) return 0;
    if (!inc) return -1;
  } else if (inc) {
    if (slopeEval(op, lead < 1 ? lead : 1) > target) return -1;
  } else {
    // O máximo fica na face de trás, que só desce andando para a frente.
    void trail;
    return -1;
  }
  const t0 = pieceThreshold(pk0, pb0, target);
  const t =
    op === SLOPE_SINGLE
      ? t0
      : op === SLOPE_MAX
        ? Math.min(t0, pieceThreshold(pk1, pb1, target))
        : Math.max(t0, pieceThreshold(pk1, pb1, target));
  return t <= 1 ? (t > 0 ? t : 0) : -1;
}

/** Candidato (m) de uma célula sólida no eixo do movimento; atualiza `hBest`. */
function cellContactH(so: number, a: number, y: number, c: number): void {
  const kind = SO_COLL_KIND[so]!;
  if (kind === COLL_CUBE) {
    if (hPositive) {
      const p = a * BLOCK_SIZE;
      if (p >= hAMax - EPS && p - hAMax < hBest) hBest = p - hAMax;
    } else {
      const p = (a + 1) * BLOCK_SIZE;
      if (p <= hAMin + EPS && p - hAMin > hBest) hBest = p - hAMin;
    }
    return;
  }
  if (kind === COLL_BOXES) {
    // Índices das caixas: ao longo (a0/a1) e através (c0/c1) conforme o eixo.
    const ia = hAlongX ? 0 : 2;
    const ic = hAlongX ? 2 : 0;
    for (let i = 0, n = SO_COLL_COUNT[so]!; i < n; i++) {
      const o = so * 12 + i * 6;
      if (!(
        c * S + SO_COLL_BOXES[o + ic]! * S < hCMax - EPS &&
        c * S + SO_COLL_BOXES[o + ic + 3]! * S > hCMin + EPS &&
        y * S + SO_COLL_BOXES[o + 1]! * S < hYMax - EPS &&
        y * S + SO_COLL_BOXES[o + 4]! * S > hYMin + EPS
      )) {
        continue;
      }
      if (hPositive) {
        const p = a * S + SO_COLL_BOXES[o + ia]! * S;
        if (p >= hAMax - EPS && p - hAMax < hBest) hBest = p - hAMax;
      } else {
        const p = a * S + SO_COLL_BOXES[o + ia + 3]! * S;
        if (p <= hAMin + EPS && p - hAMin > hBest) hBest = p - hAMin;
      }
    }
    return;
  }
  // Piso inclinado: sólido em y ≤ célula + h(ao longo, através).
  hSawSlope = true;
  const level = hYMin * CELLS_PER_METER - y;
  if (level >= 1 - EPS_F) return;
  const target = (level > 0 ? level : 0) + EPS_F;
  let f0 = hCMin * CELLS_PER_METER - c;
  let f1 = hCMax * CELLS_PER_METER - c;
  if (f0 < 0) f0 = 0;
  if (f1 > 1) f1 = 1;
  const op = SO_SLOPE_OP[so]!;
  const o = so * 6;
  // Peça i: h = a + bx·fx + bz·fz → reduz o eixo "através" ao máximo na faixa da caixa.
  const ba0 = hAlongX ? SO_SLOPE[o + 1]! : SO_SLOPE[o + 2]!;
  const bc0 = hAlongX ? SO_SLOPE[o + 2]! : SO_SLOPE[o + 1]!;
  pk0 = SO_SLOPE[o]! + (bc0 > 0 ? bc0 * f1 : bc0 * f0);
  pb0 = ba0;
  if (op !== SLOPE_SINGLE) {
    const ba1 = hAlongX ? SO_SLOPE[o + 4]! : SO_SLOPE[o + 5]!;
    const bc1 = hAlongX ? SO_SLOPE[o + 5]! : SO_SLOPE[o + 4]!;
    pk1 = SO_SLOPE[o + 3]! + (bc1 > 0 ? bc1 * f1 : bc1 * f0);
    pb1 = ba1;
  }
  if (hPositive) {
    const t = slopeContact(op, hAMax * CELLS_PER_METER - a, hAMin * CELLS_PER_METER - a, target);
    if (t < 0) return;
    const p = (a + t) * S;
    if (p - hAMax < hBest) hBest = p - hAMax;
  } else {
    // Espelha o eixo: t' = 1 − t (peça k + b·t vira (k + b) − b·t').
    pk0 += pb0;
    pb0 = -pb0;
    pk1 += pb1;
    pb1 = -pb1;
    const t = slopeContact(op, a + 1 - hAMin * CELLS_PER_METER, a + 1 - hAMax * CELLS_PER_METER, target);
    if (t < 0) return;
    const p = (a + 1 - t) * S;
    if (p - hAMin > hBest) hBest = p - hAMin;
  }
}

function visitClipH(i: number): boolean {
  const c = hColl!;
  if ((c.flags[i]! & COLLIDER_FLAG.solid) === 0) return true;
  const o = i * COLLIDER_STRIDE;
  const b = c.boxes;
  const ia = hAlongX ? 0 : 2;
  const ic = hAlongX ? 2 : 0;
  if (!(
    b[o + ic]! < hCMax - EPS &&
    b[o + ic + 3]! > hCMin + EPS &&
    b[o + 1]! < hYMax - EPS &&
    b[o + 4]! > hYMin + EPS
  )) {
    return true;
  }
  if (hPositive) {
    const p = b[o + ia]!;
    if (p >= hAMax - EPS && p - hAMax < hBest) hBest = p - hAMax;
  } else {
    const p = b[o + ia + 3]!;
    if (p <= hAMin + EPS && p - hAMin > hBest) hBest = p - hAMin;
  }
  return true;
}

/** Quanto a AABB pode andar `d` em X (`alongX`) ou Z. Mesmo critério do `clipY`. */
function clipH(
  grid: WorldGrid,
  registry: BlockRegistry,
  coll: StaticColliders | null,
  b: Aabb,
  d: number,
  alongX: boolean,
): number {
  if (d === 0) return 0;
  hSawSlope = false;
  hAlongX = alongX;
  hPositive = d > 0;
  hAMin = alongX ? b.minX : b.minZ;
  hAMax = alongX ? b.maxX : b.maxZ;
  hCMin = alongX ? b.minZ : b.minX;
  hCMax = alongX ? b.maxZ : b.maxX;
  hYMin = b.minY;
  hYMax = b.maxY;
  hBest = d;
  const c0 = Math.floor((hCMin + EPS) * CELLS_PER_METER);
  const c1 = Math.floor((hCMax - EPS) * CELLS_PER_METER);
  const y0 = Math.floor((hYMin + EPS) * CELLS_PER_METER);
  const y1 = Math.floor((hYMax - EPS) * CELLS_PER_METER);
  const sizeA = alongX ? grid.sizeX : grid.sizeZ;
  const sizeC = alongX ? grid.sizeZ : grid.sizeX;
  const sizeY = grid.sizeY;
  if (d > 0) {
    const first = Math.floor((hAMax - EPS) * CELLS_PER_METER);
    const last = Math.ceil((hAMax + d) * CELLS_PER_METER) - 1;
    for (let a = first; a <= last; a++) {
      if (a * BLOCK_SIZE - hAMax >= hBest) break;
      scanLayerH(grid, registry, a, y0, y1, c0, c1, sizeA, sizeC, sizeY);
    }
  } else {
    const first = Math.floor((hAMin + EPS) * CELLS_PER_METER);
    const last = Math.floor((hAMin + d) * CELLS_PER_METER);
    for (let a = first; a >= last; a--) {
      if ((a + 1) * BLOCK_SIZE - hAMin <= hBest) break;
      scanLayerH(grid, registry, a, y0, y1, c0, c1, sizeA, sizeC, sizeY);
    }
  }
  if (coll) {
    hColl = coll;
    const lo = d > 0 ? hAMax - EPS : hAMin + d;
    const hi = d > 0 ? hAMax + d : hAMin + EPS;
    if (alongX) coll.query(lo, hYMin, hCMin, hi, hYMax, hCMax, visitClipH);
    else coll.query(hCMin, hYMin, lo, hCMax, hYMax, hi, visitClipH);
    hColl = null;
  }
  return d > 0 ? Math.max(0, Math.min(d, hBest)) : Math.min(0, Math.max(d, hBest));
}

function scanLayerH(
  grid: WorldGrid,
  registry: BlockRegistry,
  a: number,
  y0: number,
  y1: number,
  c0: number,
  c1: number,
  sizeA: number,
  sizeC: number,
  sizeY: number,
): void {
  const aOut = a < 0 || a >= sizeA;
  for (let y = y0; y <= y1; y++) {
    for (let c = c0; c <= c1; c++) {
      if (aOut || c < 0 || c >= sizeC) {
        // Parede invisível da borda: cubo cheio.
        cellContactH(SOLID_WALL_SO, a, y, c);
        continue;
      }
      if (y < 0 || y >= sizeY) continue;
      const so = solidSo(registry, hAlongX ? grid.get(a, y, c) : grid.get(c, y, a));
      if (so >= 0) cellContactH(so, a, y, c);
    }
  }
}

/** `so` de um cubo (forma 1, orientação 0) para a parede invisível. */
const SOLID_WALL_SO = 8;

// --- Subida e descida pela rampa ---------------------------------------------------------------------------------------

/** Topo mais alto de piso inclinado sob a pegada da caixa, entre `minY` e `minY + up` (metros); -Infinity se nenhum. */
function slopeTopUnder(grid: WorldGrid, registry: BlockRegistry, b: Aabb, up: number): number {
  const x0 = Math.floor((b.minX + EPS) * CELLS_PER_METER);
  const x1 = Math.floor((b.maxX - EPS) * CELLS_PER_METER);
  const z0 = Math.floor((b.minZ + EPS) * CELLS_PER_METER);
  const z1 = Math.floor((b.maxZ - EPS) * CELLS_PER_METER);
  const y0 = Math.max(0, Math.floor(b.minY * CELLS_PER_METER));
  const y1 = Math.min(grid.sizeY - 1, Math.floor((b.minY + up) * CELLS_PER_METER));
  let best = -Infinity;
  for (let y = y0; y <= y1; y++) {
    for (let z = Math.max(0, z0); z <= Math.min(grid.sizeZ - 1, z1); z++) {
      for (let x = Math.max(0, x0); x <= Math.min(grid.sizeX - 1, x1); x++) {
        const so = solidSo(registry, grid.get(x, y, z));
        if (so < 0 || SO_COLL_KIND[so] !== COLL_SLOPE) continue;
        const top = y * S + footprintSlopeMax(so, x, z, b) * S;
        if (top > best) best = top;
      }
    }
  }
  return best;
}

/** Subida pela rampa no último `moveH` (m, ≥ 0). */
let lastLift = 0;

// O registro tem rampa? (cache de uma entrada: o registro é imutável e quase sempre o mesmo da partida)
let slopeRegistry: BlockRegistry | null = null;
let slopeRegistryHas = false;

function registryHasSlopes(registry: BlockRegistry): boolean {
  if (registry !== slopeRegistry) {
    slopeRegistry = registry;
    slopeRegistryHas = false;
    for (let id = 1; id < registry.size; id++) {
      if (SO_COLL_KIND[registry.shapes[id]! * 8] === COLL_SLOPE) slopeRegistryHas = true;
    }
  }
  return slopeRegistryHas;
}

/**
 * Anda `d` no eixo; se no destino o plano de uma rampa fica acima dos pés (subida de até 1:1 do que andou), sobe pelo
 * plano em vez de parar, desde que a caixa erguida caiba. Vale também quando nada barrou (caixa que já estava um
 * pouco afundada no plano sai dele). Altera `b`. Devolve o deslocamento aplicado no eixo; a subida vai em `lastLift`.
 */
function moveH(
  grid: WorldGrid,
  registry: BlockRegistry,
  coll: StaticColliders | null,
  b: Aabb,
  d: number,
  alongX: boolean,
  onSlope: boolean,
): number {
  lastLift = 0;
  const r = clipH(grid, registry, coll, b, d, alongX);
  // Só procura plano de rampa se a caixa estava apoiada numa ou se a varredura passou por uma.
  if (d !== 0 && (onSlope || hSawSlope)) {
    const minA = alongX ? b.minX : b.minZ;
    const maxA = alongX ? b.maxX : b.maxZ;
    const minY = b.minY;
    const maxY = b.maxY;
    if (alongX) {
      b.minX = minA + d;
      b.maxX = maxA + d;
    } else {
      b.minZ = minA + d;
      b.maxZ = maxA + d;
    }
    const reach = Math.abs(d) * MAX_SLOPE + SLOPE_SNAP;
    const lift = slopeTopUnder(grid, registry, b, reach) - minY;
    if (lift > EPS && lift <= reach) {
      b.minY = minY + lift;
      b.maxY = maxY + lift;
      if (!boxIntersectsWorld(grid, registry, b, coll)) {
        lastLift = lift;
        return d;
      }
      b.minY = minY;
      b.maxY = maxY;
    }
    if (alongX) {
      b.minX = minA;
      b.maxX = maxA;
    } else {
      b.minZ = minA;
      b.maxZ = maxA;
    }
  }
  if (alongX) {
    b.minX += r;
    b.maxX += r;
  } else {
    b.minZ += r;
    b.maxZ += r;
  }
  return r;
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
 *
 * M1: formas, props (`colliders`) e rampas (ver o topo do arquivo). Num mundo só de cubos e sem props o resultado é
 * bit a bit o do M0 (o golden depende disso).
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
  colliders?: StaticColliders | null,
): SweepResult {
  const coll = colliders && colliders.count > 0 ? colliders : null;
  const slopes = registryHasSlopes(registry);
  const startX = box.minX;
  const startY = box.minY;
  const startZ = box.minZ;

  let ry = clipY(grid, registry, coll, box, dy);
  const startSup = ySup;
  const onSlope = (startSup & SUP_SLOPE) !== 0;
  box.minY += ry;
  box.maxY += ry;
  let rx = moveH(grid, registry, coll, box, dx, true, onSlope);
  let lift = lastLift;
  let rz = moveH(grid, registry, coll, box, dz, false, onSlope);
  lift += lastLift;

  let hitX = rx !== dx;
  let hitY = ry !== dy;
  let hitZ = rz !== dz;
  let onGround = hitY && dy < 0;
  let stepped = false;
  let outDy = ry;

  if (lift > 0) {
    // Subiu pela rampa: está no chão (se não estava pulando).
    outDy = box.minY - startY;
    if (dy <= 0) {
      hitY = true;
      onGround = true;
    }
  } else if (slopes && onGround && (rx !== 0 || rz !== 0)) {
    // Desce acompanhando a rampa (no máximo 1:1 do que andou), se o apoio antes ou depois é um plano inclinado.
    const want = -(Math.abs(rx) + Math.abs(rz)) * MAX_SLOPE - SLOPE_TOL;
    const follow = clipY(grid, registry, coll, box, want);
    if (follow < 0 && follow !== want && ((startSup | ySup) & SUP_SLOPE) !== 0) {
      box.minY += follow;
      box.maxY += follow;
      outDy = box.minY - startY;
    }
  }

  if (stepHeight > 0 && dy <= 0 && (hitX || hitZ)) {
    const endX = box.minX;
    const endY = box.minY;
    const endZ = box.minZ;
    moveBoxTo(box, startX, startY, startZ);
    const up = clipY(grid, registry, coll, box, stepHeight);
    box.minY += up;
    box.maxY += up;
    const sx = moveH(grid, registry, coll, box, dx, true, onSlope);
    const sz = moveH(grid, registry, coll, box, dz, false, onSlope);
    const downWanted = -up + dy;
    const down = clipY(grid, registry, coll, box, downWanted);
    box.minY += down;
    box.maxY += down;
    // Não pousa em cima de cerca (painel, poste) nem de prop não andável; no ar (sem apoio) vale como no M0.
    const landingOk = down === downWanted || (ySup & SUP_STEP) !== 0;
    if (landingOk && sx * sx + sz * sz > rx * rx + rz * rz + 1e-12) {
      rx = sx;
      rz = sz;
      ry = box.minY - startY;
      outDy = ry;
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
  out.dy = outDy;
  out.dz = rz;
  out.hitX = hitX;
  out.hitY = hitY;
  out.hitZ = hitZ;
  out.onGround = onGround;
  out.stepped = stepped;
  return out;
}
