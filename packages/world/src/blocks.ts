import { assert } from '@boboforces/shared';
import { MAX_BLOCK_ID, type BlockId } from './cell.ts';

/** Formas do catálogo dentro da célula (tecnico.md §5.2). M0 só usa `cube`; as outras chegam no M1. */
export type BlockShape =
  | 'empty'
  | 'cube'
  | 'slab'
  | 'step'
  | 'ramp'
  | 'rampHalf'
  | 'rampCornerIn'
  | 'rampCornerOut'
  | 'panel'
  | 'post'
  | 'cross';

/** Bits de `BlockDef.flags` (e de `BlockRegistry.flags`, o espelho em typed array para o laço quente). */
export const BLOCK_FLAG = {
  solid: 1 << 0,
  cutout: 1 << 1,
  translucent: 1 << 2,
  emissive: 1 << 3,
  blocksBullets: 1 << 4,
  blocksSight: 1 << 5,
  walkable: 1 << 6,
  colorVariation: 1 << 7,
  animated: 1 << 8,
  swaysInWind: 1 << 9,
} as const;

/** Ordem das faces em `BlockDef.faces` e índices 0..5 da tabela de normais do mesher. */
export const FACE = { px: 0, nx: 1, py: 2, ny: 3, pz: 4, nz: 5 } as const;

export type BlockFaces = readonly [px: number, nx: number, py: number, ny: number, pz: number, nz: number];

export interface BlockDef {
  /** Índice local no registro (vai na célula, 10 bits). 0 = ar. */
  readonly id: BlockId;
  /** ID de conteúdo estável SEM prefixo (`concrete` = `block:concrete`). */
  readonly key: string;
  readonly shape: BlockShape;
  /** Camada no texture array `blocos16` por face, na ordem de `FACE`. */
  readonly faces: BlockFaces;
  /** Bits de `BLOCK_FLAG`. */
  readonly flags: number;
  /** Quadros de animação em camadas seguidas (1 = estático). */
  readonly frames: number;
  /** Som de passo (id de som, M2). */
  readonly stepSound: string;
}

export type BlockDefInput = Omit<BlockDef, 'id'>;

export interface BlockRegistry {
  /** Ids válidos: 0..size-1 (0 é o ar). */
  readonly size: number;
  /** Espelho de `BlockDef.flags` por id, para colisão/DDA sem tocar em objetos. */
  readonly flags: Uint16Array;
  get(id: BlockId): BlockDef;
  byKey(key: string): BlockDef | undefined;
}

export const AIR_BLOCK: BlockDef = {
  id: 0,
  key: 'air',
  shape: 'empty',
  faces: [0, 0, 0, 0, 0, 0],
  flags: 0,
  frames: 1,
  stepSound: '',
};

/** Cria o registro de um mapa: o ar é o id 0 e os blocos recebem ids 1, 2, 3… na ordem dada. */
export function createBlockRegistry(defs: readonly BlockDefInput[]): BlockRegistry {
  assert(defs.length <= MAX_BLOCK_ID, `BlockRegistry: no máximo ${MAX_BLOCK_ID} blocos`);
  const list: BlockDef[] = [AIR_BLOCK];
  const byKey = new Map<string, BlockDef>([[AIR_BLOCK.key, AIR_BLOCK]]);
  for (const def of defs) {
    assert(!byKey.has(def.key), `BlockRegistry: bloco repetido "${def.key}"`);
    const full: BlockDef = { ...def, id: list.length };
    list.push(full);
    byKey.set(full.key, full);
  }
  const flags = new Uint16Array(list.length);
  for (const def of list) flags[def.id] = def.flags;
  return {
    size: list.length,
    flags,
    get(id) {
      const def = list[id];
      assert(def !== undefined, `BlockRegistry: id ${id} inexistente`);
      return def;
    },
    byKey: (key) => byKey.get(key),
  };
}
