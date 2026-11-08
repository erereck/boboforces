import type { NavGridImpl } from '@boboforces/nav';
import {
  BLOCK_FLAG,
  CELLS_PER_METER,
  SHAPE_BOX_STRIDE,
  shapeCollisionBoxes,
  type BlockRegistry,
  type ShapeId,
  type WorldGrid,
} from '@boboforces/world';

/**
 * Linha de visão para as validações do `mapc` (tecnico.md §15.3 e GDD §4.6.3). Grade própria de ocupação (1 byte por
 * célula) para o raio ser rápido: o Construto mede ~25 milhões de pares de nós.
 *
 * CONSERVADORA (nunca subestima a visão): só bloqueia célula com `blocksSight` cuja colisão é a célula INTEIRA (cubo,
 * rampa invertida); laje, degrau, rampa, painel, cerca e props deixam a visão passar. Assim a "maior linha de visão
 * medida" é um teto e a regra "nenhum spawn visível de um spawn inimigo" fica mais rígida, nunca mais frouxa.
 */
export interface SightGrid {
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  readonly occ: Uint8Array;
}

export function buildSightGrid(grid: WorldGrid, registry: BlockRegistry): SightGrid {
  const { sizeX, sizeY, sizeZ } = grid;
  const occ = new Uint8Array(sizeX * sizeY * sizeZ);
  const full = new Uint8Array(registry.size * 8);
  const boxes = new Float32Array(4 * SHAPE_BOX_STRIDE);
  for (let id = 1; id < registry.size; id++) {
    if ((registry.flags[id]! & BLOCK_FLAG.blocksSight) === 0) continue;
    for (let o = 0; o < 8; o++) {
      const n = shapeCollisionBoxes(registry.shapes[id] as ShapeId, o, boxes);
      for (let b = 0; b < n; b++) {
        const s = b * SHAPE_BOX_STRIDE;
        const isFull =
          boxes[s] === 0 &&
          boxes[s + 1] === 0 &&
          boxes[s + 2] === 0 &&
          boxes[s + 3] === 16 &&
          boxes[s + 4] === 16 &&
          boxes[s + 5] === 16;
        if (isFull) full[id * 8 + o] = 1;
      }
    }
  }
  for (let y = 0; y < sizeY; y++) {
    for (let z = 0; z < sizeZ; z++) {
      for (let x = 0; x < sizeX; x++) {
        const cell = grid.get(x, y, z);
        if (cell !== 0 && full[(cell & 0x3ff) * 8 + ((cell >>> 10) & 7)] === 1)
          occ[x + z * sizeX + y * sizeX * sizeZ] = 1;
      }
    }
  }
  return { sizeX, sizeY, sizeZ, occ };
}

/** Linha livre de A a B (metros)? DDA de Amanatides & Woo; fora da grade é ar. */
export function lineOfSight(
  s: SightGrid,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): boolean {
  const px = ax * CELLS_PER_METER;
  const py = ay * CELLS_PER_METER;
  const pz = az * CELLS_PER_METER;
  const dx = (bx - ax) * CELLS_PER_METER;
  const dy = (by - ay) * CELLS_PER_METER;
  const dz = (bz - az) * CELLS_PER_METER;
  let cx = Math.floor(px);
  let cy = Math.floor(py);
  let cz = Math.floor(pz);
  const ex = Math.floor(px + dx);
  const ey = Math.floor(py + dy);
  const ez = Math.floor(pz + dz);
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tdx = stepX !== 0 ? 1 / Math.abs(dx) : Infinity;
  const tdy = stepY !== 0 ? 1 / Math.abs(dy) : Infinity;
  const tdz = stepZ !== 0 ? 1 / Math.abs(dz) : Infinity;
  let tx = stepX > 0 ? (cx + 1 - px) * tdx : stepX < 0 ? (px - cx) * tdx : Infinity;
  let ty = stepY > 0 ? (cy + 1 - py) * tdy : stepY < 0 ? (py - cy) * tdy : Infinity;
  let tz = stepZ > 0 ? (cz + 1 - pz) * tdz : stepZ < 0 ? (pz - cz) * tdz : Infinity;
  const { sizeX, sizeY, sizeZ, occ } = s;
  const layer = sizeX * sizeZ;
  for (;;) {
    if (cx >= 0 && cy >= 0 && cz >= 0 && cx < sizeX && cy < sizeY && cz < sizeZ) {
      if (occ[cx + cz * sizeX + cy * layer] === 1) return false;
    }
    if (cx === ex && cy === ey && cz === ez) return true;
    if (tx < ty) {
      if (tx < tz) {
        if (tx > 1) return true;
        cx += stepX;
        tx += tdx;
      } else {
        if (tz > 1) return true;
        cz += stepZ;
        tz += tdz;
      }
    } else if (ty < tz) {
      if (ty > 1) return true;
      cy += stepY;
      ty += tdy;
    } else {
      if (tz > 1) return true;
      cz += stepZ;
      tz += tdz;
    }
  }
}

export interface SightLine {
  readonly distance: number;
  readonly a: readonly [number, number, number];
  readonly b: readonly [number, number, number];
}

export interface SightMeasure {
  /** Maior linha de visão entre olhos de nós andáveis (metros, horizontal + vertical). */
  readonly max: SightLine | null;
  /** As mais longas, uma por par de "regiões" de 4 m (para achar o que abrir ou fechar no mapa). */
  readonly longest: readonly SightLine[];
  readonly nodes: number;
  readonly rays: number;
}

/**
 * Mede a maior linha de visão: olho (1,3 m em pé, 0,8 m agachado) de cada nó aceito por `accept` contra o de todos os
 * outros. Duas passadas: uma grade de 2 m acha um piso bom, e a passada completa só lança raio nos pares mais longos
 * que o piso (o resto é descartado pela distância, sem raio).
 */
export function measureMaxSightLine(
  nav: NavGridImpl,
  sight: SightGrid,
  accept: (node: number) => boolean,
  eye: number,
  crouchEye: number,
  keep = 10,
): SightMeasure {
  const nodes: number[] = [];
  for (let n = 0; n < nav.nodeCount; n++) if (accept(n)) nodes.push(n);
  const count = nodes.length;
  const px = new Float64Array(count);
  const py = new Float64Array(count);
  const pz = new Float64Array(count);
  const coarse = new Uint8Array(count);
  const tmp = new Float64Array(3);
  for (let i = 0; i < count; i++) {
    const n = nodes[i]!;
    nav.nodePosition(n, tmp);
    px[i] = tmp[0]!;
    py[i] = tmp[1]! + (nav.clearance[n] === 1 ? eye : crouchEye);
    pz[i] = tmp[2]!;
    const col = nav.nodeColumn[n]!;
    const ci = col % nav.columnsX;
    const ck = (col - ci) / nav.columnsX;
    coarse[i] = ci % 2 === 0 && ck % 2 === 0 ? 1 : 0;
  }
  let rays = 0;
  const longest: SightLine[] = [];
  const regionKey = (i: number): number => Math.floor(px[i]! / 4) + Math.floor(pz[i]! / 4) * 1024;
  const pairKey = new Map<string, number>();
  let floor = 0;
  const record = (i: number, j: number, d: number): void => {
    const ka = regionKey(i);
    const kb = regionKey(j);
    const key = ka < kb ? `${ka}:${kb}` : `${kb}:${ka}`;
    const at = pairKey.get(key);
    const line: SightLine = { distance: d, a: [px[i]!, py[i]!, pz[i]!], b: [px[j]!, py[j]!, pz[j]!] };
    if (at !== undefined) {
      if (longest[at]!.distance < d) longest[at] = line;
    } else {
      pairKey.set(key, longest.length);
      longest.push(line);
    }
  };
  const pass = (onlyCoarse: boolean, threshold: number): number => {
    let best = threshold;
    for (let i = 0; i < count; i++) {
      if (onlyCoarse && coarse[i] === 0) continue;
      const ax = px[i]!;
      const ay = py[i]!;
      const az = pz[i]!;
      for (let j = i + 1; j < count; j++) {
        if (onlyCoarse && coarse[j] === 0) continue;
        const dx = px[j]! - ax;
        const dy = py[j]! - ay;
        const dz = pz[j]! - az;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 <= best * best) continue;
        rays++;
        if (!lineOfSight(sight, ax, ay, az, px[j]!, py[j]!, pz[j]!)) continue;
        const d = Math.sqrt(d2);
        if (!onlyCoarse) record(i, j, d);
        if (onlyCoarse) best = Math.max(best, d);
      }
    }
    return best;
  };
  // Passada grossa: o maior par da grade de 2 m já é um par de verdade, então serve de piso para a fina (menos 1 m de
  // folga, só para a lista das mais longas ter as "quase máximas" também).
  floor = Math.max(0, pass(true, 0) - 1);
  pass(false, floor);
  longest.sort((p, q) => q.distance - p.distance);
  const top = longest.slice(0, keep);
  return { max: top[0] ?? null, longest: top, nodes: count, rays };
}
