import { assert } from '@boboforces/shared';
import { MAX_BLOCK_ID, type BlockId } from './cell.ts';
import { SHAPE_ID, type BlockShape } from './shapes.ts';

export type { BlockShape } from './shapes.ts';

/**
 * Bits de `BlockDef.flags` (e de `BlockRegistry.flags`, o espelho em typed array para o laço quente). Ordem fixa:
 * entra nos registros dos mapas e nunca é reordenada (só cresce).
 *
 * - `emissive` liga o bloco como FONTE do flood fill de luz (o nível 0..15 fica em `BlockDef.emissive`).
 * - `animated`: N quadros em camadas seguidas (`BlockDef.frames`); `swaysInWind`: o vértice balança (vegetação).
 * - `randomUv` (M1): o shader gira/espelha a UV por célula (materiais contínuos, quebra a repetição).
 * - `climbable` (M1, reservado para a escada de mão do M2).
 */
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
  randomUv: 1 << 10,
  climbable: 1 << 11,
} as const;

/** Ordem das faces em `BlockDef.faces` e índices 0..5 da tabela de normais do mesher. */
export const FACE = { px: 0, nx: 1, py: 2, ny: 3, pz: 4, nz: 5 } as const;

/** Camada de `blocos16` por face, na ordem de `FACE` (+X, -X, +Y, -Y, +Z, -Z), já resolvida para índice. */
export type BlockFaces = readonly [px: number, nx: number, py: number, ny: number, pz: number, nz: number];

/** Teto de quadros de animação e de variantes por bloco (4 bits cada no vértice compacto, `mesh/vertex.ts`). */
export const MAX_BLOCK_FRAMES = 16;
export const MAX_BLOCK_VARIANTS = 16;

export interface BlockDef {
  /** Índice local no registro (vai na célula, 10 bits). 0 = ar. NÃO é o ID de conteúdo. */
  readonly id: BlockId;
  /** ID de conteúdo estável SEM prefixo (`concrete` = `block:concrete`). */
  readonly key: string;
  readonly shape: BlockShape;
  /**
   * Camada no texture array `blocos16` por face, na ordem de `FACE`. No arquivo de definições (`BlockSourceDef`) a
   * face vem por NOME de camada; o índice é resolvido no loading (`resolveBlockDefs`), então reordenar a tira do
   * texgen nunca quebra mapa nenhum. Faces de forma (rampa, cruz…) usam as regras de `shapeFaceLayer`.
   */
  readonly faces: BlockFaces;
  /** Bits de `BLOCK_FLAG`. */
  readonly flags: number;
  /** Nível emissivo 0..15 (0 = não emite). Só vale com `BLOCK_FLAG.emissive`. */
  readonly emissive: number;
  /** Quadros de animação em camadas seguidas (1 = estático; até `MAX_BLOCK_FRAMES`). */
  readonly frames: number;
  /** Variantes de textura em camadas seguidas, sorteadas no shader por célula (1 = sem variante). */
  readonly variants: number;
  /** Som de passo (id de som, M2). */
  readonly stepSound: string;
}

/**
 * Entrada de `createBlockRegistry`. `emissive` e `variants` são opcionais para os blocos de teste do M0 continuarem
 * válidos (padrão 0 e 1).
 */
export type BlockDefInput = Omit<BlockDef, 'id' | 'emissive' | 'variants'> & {
  readonly emissive?: number;
  readonly variants?: number;
};

export interface BlockRegistry {
  /** Ids válidos: 0..size-1 (0 é o ar). */
  readonly size: number;
  /** Espelho de `BlockDef.flags` por id, para colisão/DDA sem tocar em objetos. */
  readonly flags: Uint16Array;
  /** Espelho de `SHAPE_ID[BlockDef.shape]` por id (colisão, DDA, mesher, navegação). */
  readonly shapes: Uint8Array;
  /** Espelho de `BlockDef.emissive` por id (luz). */
  readonly emissive: Uint8Array;
  get(id: BlockId): BlockDef;
  byKey(key: string): BlockDef | undefined;
}

export const AIR_BLOCK: BlockDef = {
  id: 0,
  key: 'air',
  shape: 'empty',
  faces: [0, 0, 0, 0, 0, 0],
  flags: 0,
  emissive: 0,
  frames: 1,
  variants: 1,
  stepSound: '',
};

/** Cria o registro de um mapa: o ar é o id 0 e os blocos recebem ids 1, 2, 3… na ordem dada. */
export function createBlockRegistry(defs: readonly BlockDefInput[]): BlockRegistry {
  assert(defs.length <= MAX_BLOCK_ID, `BlockRegistry: no máximo ${MAX_BLOCK_ID} blocos`);
  const list: BlockDef[] = [AIR_BLOCK];
  const byKey = new Map<string, BlockDef>([[AIR_BLOCK.key, AIR_BLOCK]]);
  for (const def of defs) {
    assert(!byKey.has(def.key), `BlockRegistry: bloco repetido "${def.key}"`);
    const emissive = def.emissive ?? 0;
    const variants = def.variants ?? 1;
    assert(Number.isInteger(emissive) && emissive >= 0 && emissive <= 15, `BlockRegistry: emissivo de "${def.key}"`);
    assert(def.frames >= 1 && def.frames <= MAX_BLOCK_FRAMES, `BlockRegistry: quadros de "${def.key}"`);
    assert(variants >= 1 && variants <= MAX_BLOCK_VARIANTS, `BlockRegistry: variantes de "${def.key}"`);
    const full: BlockDef = {
      key: def.key,
      shape: def.shape,
      faces: def.faces,
      flags: def.flags,
      emissive,
      frames: def.frames,
      variants,
      stepSound: def.stepSound,
      id: list.length,
    };
    list.push(full);
    byKey.set(full.key, full);
  }
  const flags = new Uint16Array(list.length);
  const shapes = new Uint8Array(list.length);
  const emissive = new Uint8Array(list.length);
  for (const def of list) {
    flags[def.id] = def.flags;
    shapes[def.id] = SHAPE_ID[def.shape];
    emissive[def.id] = def.emissive;
  }
  return {
    size: list.length,
    flags,
    shapes,
    emissive,
    get(id) {
      const def = list[id];
      assert(def !== undefined, `BlockRegistry: id ${id} inexistente`);
      return def;
    },
    byKey: (key) => byKey.get(key),
  };
}
