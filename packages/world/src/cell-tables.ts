import { BLOCK_FLAG, type BlockRegistry } from './blocks.ts';
import { CELL_ROTATION_SHIFT, MAX_BLOCK_ID } from './cell.ts';
import { shapeOrientation } from './shape-geometry.ts';
import { SHAPE_ID, shapeCoveredFaces } from './shapes.ts';

/**
 * Tabelas por "tipo de célula" de um registro: `ti = blockId · 8 + orientação` (`cellTypeIndex`). Montadas uma vez por
 * registro (cache fraco) para a luz e o mesher lerem typed arrays em vez de objetos no laço.
 */

export const KIND_NONE = 0;
export const KIND_OPAQUE = 1;
export const KIND_CUTOUT = 2;
export const KIND_TRANSLUCENT = 3;

export interface CellTables {
  /** Entradas = `registry.size · 8`. */
  readonly length: number;
  /** Forma × orientação (`shape-geometry.ts`); 0 = vazio. */
  readonly so: Uint8Array;
  /** Programa da malha (`KIND_*`); `KIND_NONE` = não desenha (ar, forma vazia). */
  readonly kind: Uint8Array;
  /** Faces (bits de `FACE`) que barram a luz: as cobertas por inteiro, só nos opacos (cutout e translúcido deixam passar). */
  readonly lightCover: Uint8Array;
  /** 1 = escurece o AO do vizinho (cubo opaco ou cutout). */
  readonly aoOccluder: Uint8Array;
  /** 1 = sem luz própria (cubo opaco): fica fora da média da luz suave. */
  readonly lightOpaque: Uint8Array;
  /** Nível emissivo 0..15 (só com `BLOCK_FLAG.emissive`). */
  readonly emissive: Uint8Array;
}

const cache = new WeakMap<BlockRegistry, CellTables>();

/** Índice de tabela da célula (id fora do registro vira ar). */
export function cellTypeIndex(cell: number, registrySize: number): number {
  const id = cell & MAX_BLOCK_ID;
  return id < registrySize ? (id << 3) | ((cell >>> CELL_ROTATION_SHIFT) & 7) : 0;
}

export function cellTablesFor(registry: BlockRegistry): CellTables {
  const cached = cache.get(registry);
  if (cached) return cached;
  const length = registry.size * 8;
  const so = new Uint8Array(length);
  const kind = new Uint8Array(length);
  const lightCover = new Uint8Array(length);
  const aoOccluder = new Uint8Array(length);
  const lightOpaque = new Uint8Array(length);
  const emissive = new Uint8Array(length);
  for (let id = 1; id < registry.size; id++) {
    const shape = registry.shapes[id]!;
    if (shape === SHAPE_ID.empty) continue;
    const flags = registry.flags[id]!;
    const k = flags & BLOCK_FLAG.translucent ? KIND_TRANSLUCENT : flags & BLOCK_FLAG.cutout ? KIND_CUTOUT : KIND_OPAQUE;
    const level = flags & BLOCK_FLAG.emissive ? registry.emissive[id]! : 0;
    for (let o = 0; o < 8; o++) {
      const ti = (id << 3) | o;
      so[ti] = shapeOrientation(shape, o);
      kind[ti] = k;
      const cover = k === KIND_OPAQUE ? shapeCoveredFaces(shape as never, o) : 0;
      lightCover[ti] = cover;
      aoOccluder[ti] = shape === SHAPE_ID.cube && k !== KIND_TRANSLUCENT ? 1 : 0;
      lightOpaque[ti] = cover === 63 ? 1 : 0;
      emissive[ti] = level;
    }
  }
  const tables: CellTables = { length, so, kind, lightCover, aoOccluder, lightOpaque, emissive };
  cache.set(registry, tables);
  return tables;
}
