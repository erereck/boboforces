import { assert } from '@boboforces/shared';

/**
 * Colisores ESTÁTICOS das props fora da grade (tecnico.md §5.2 e §7.3). CONTRATO DO M1; implementação da frente
 * "mundo". Cada prop declara caixas (cilindro vira caixa envolvente; não existe colisor cilíndrico) no `.bfmodel`; o
 * loading do mapa gira/escala/posiciona e entrega aqui caixas ALINHADAS AOS EIXOS em metros (giro livre só no visual:
 * a caixa é a envolvente da girada). Ficam num hash espacial uniforme para colisão e raios sem alocação.
 *
 * Implementação: hash de células de 4 m sobre a caixa envolvente de todas as caixas, em CSR (início por célula +
 * lista de índices crescentes). Uma caixa que atravessa várias células aparece em todas; a consulta visita cada uma
 * só uma vez (carimbo por consulta). A consulta NÃO é reentrante: não chame `query` de dentro do `visit`.
 */

/** Bits de `StaticColliders.flags`. */
export const COLLIDER_FLAG = {
  solid: 1 << 0,
  blocksBullets: 1 << 1,
  blocksSight: 1 << 2,
  /** Dá para andar em cima (topo conta como chão). */
  walkable: 1 << 3,
} as const;

/** Floats por caixa em `boxes`: minX, minY, minZ, maxX, maxY, maxZ (metros). */
export const COLLIDER_STRIDE = 6;

/** Lado da célula do hash, em metros (o mesmo do hash de entidades da sim). */
export const COLLIDER_CELL_M = 4;

export interface StaticColliderInput {
  /** `count × 6` floats em metros. */
  readonly boxes: Float32Array;
  /** `count` bits de `COLLIDER_FLAG`. */
  readonly flags: Uint8Array;
  /** `count` índices da prop dona no `.bfmap` (para a cor do cubinho e o print de dose). */
  readonly owner: Int32Array;
  readonly count: number;
}

export interface StaticColliders {
  readonly count: number;
  readonly boxes: Float32Array;
  readonly flags: Uint8Array;
  readonly owner: Int32Array;
  /**
   * Visita as caixas que tocam a AABB dada (metros), sem alocação, pelo hash espacial. `visit` devolve `false` para
   * parar. Ordem determinística (índice crescente dentro de cada célula do hash, células em ordem x, z, y).
   */
  query(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    visit: (index: number) => boolean,
  ): void;
}

/** Monta o hash espacial (célula de 4 m, a mesma do hash de entidades da sim). Só no loading. */
export function createStaticColliders(input: StaticColliderInput): StaticColliders {
  const count = input.count;
  assert(Number.isInteger(count) && count >= 0, 'colisores: count inválido');
  assert(input.boxes.length >= count * COLLIDER_STRIDE, 'colisores: boxes curto');
  assert(input.flags.length >= count && input.owner.length >= count, 'colisores: flags/owner curtos');
  const boxes = input.boxes.slice(0, count * COLLIDER_STRIDE);
  const flags = input.flags.slice(0, count);
  const owner = input.owner.slice(0, count);

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const o = i * COLLIDER_STRIDE;
    for (let k = 0; k < 3; k++) {
      const lo = boxes[o + k]!;
      const hi = boxes[o + 3 + k]!;
      assert(Number.isFinite(lo) && Number.isFinite(hi) && lo <= hi, `colisores: caixa ${i} inválida`);
    }
    minX = Math.min(minX, boxes[o]!);
    minY = Math.min(minY, boxes[o + 1]!);
    minZ = Math.min(minZ, boxes[o + 2]!);
    maxX = Math.max(maxX, boxes[o + 3]!);
    maxY = Math.max(maxY, boxes[o + 4]!);
    maxZ = Math.max(maxZ, boxes[o + 5]!);
  }
  const C = COLLIDER_CELL_M;
  const originX = count > 0 ? Math.floor(minX / C) * C : 0;
  const originY = count > 0 ? Math.floor(minY / C) * C : 0;
  const originZ = count > 0 ? Math.floor(minZ / C) * C : 0;
  const nx = count > 0 ? Math.floor((maxX - originX) / C) + 1 : 1;
  const ny = count > 0 ? Math.floor((maxY - originY) / C) + 1 : 1;
  const nz = count > 0 ? Math.floor((maxZ - originZ) / C) + 1 : 1;
  const cellCount = nx * ny * nz;
  const start = new Int32Array(cellCount + 1);
  const cellOf = (v: number, origin: number, n: number): number => {
    const c = Math.floor((v - origin) / C);
    return c < 0 ? 0 : c >= n ? n - 1 : c;
  };

  // Duas passadas: conta por célula, depois preenche (índices crescentes dentro de cada célula).
  const forEachCell = (i: number, fn: (cell: number) => void): void => {
    const o = i * COLLIDER_STRIDE;
    const x0 = cellOf(boxes[o]!, originX, nx);
    const y0 = cellOf(boxes[o + 1]!, originY, ny);
    const z0 = cellOf(boxes[o + 2]!, originZ, nz);
    const x1 = cellOf(boxes[o + 3]!, originX, nx);
    const y1 = cellOf(boxes[o + 4]!, originY, ny);
    const z1 = cellOf(boxes[o + 5]!, originZ, nz);
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) fn(x + z * nx + y * nx * nz);
  };
  for (let i = 0; i < count; i++) forEachCell(i, (c) => start[c + 1]!++);
  for (let c = 0; c < cellCount; c++) start[c + 1]! += start[c]!;
  const items = new Int32Array(start[cellCount]!);
  const fill = start.slice(0, cellCount);
  for (let i = 0; i < count; i++) forEachCell(i, (c) => (items[fill[c]!++] = i));

  const stamps = new Uint32Array(count);
  let stamp = 0;

  return {
    count,
    boxes,
    flags,
    owner,
    query(qMinX, qMinY, qMinZ, qMaxX, qMaxY, qMaxZ, visit) {
      if (count === 0) return;
      if (qMaxX < minX || qMinX > maxX || qMaxY < minY || qMinY > maxY || qMaxZ < minZ || qMinZ > maxZ) return;
      if (++stamp === 0xffffffff) {
        stamps.fill(0);
        stamp = 1;
      }
      const x0 = cellOf(qMinX, originX, nx);
      const y0 = cellOf(qMinY, originY, ny);
      const z0 = cellOf(qMinZ, originZ, nz);
      const x1 = cellOf(qMaxX, originX, nx);
      const y1 = cellOf(qMaxY, originY, ny);
      const z1 = cellOf(qMaxZ, originZ, nz);
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          for (let x = x0; x <= x1; x++) {
            const c = x + z * nx + y * nx * nz;
            for (let k = start[c]!, end = start[c + 1]!; k < end; k++) {
              const i = items[k]!;
              if (stamps[i] === stamp) continue;
              stamps[i] = stamp;
              const o = i * COLLIDER_STRIDE;
              if (
                boxes[o]! > qMaxX ||
                boxes[o + 3]! < qMinX ||
                boxes[o + 1]! > qMaxY ||
                boxes[o + 4]! < qMinY ||
                boxes[o + 2]! > qMaxZ ||
                boxes[o + 5]! < qMinZ
              ) {
                continue;
              }
              if (!visit(i)) return;
            }
          }
        }
      }
    },
  };
}
