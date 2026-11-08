import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BLOCK_FLAG,
  parseBlockDefs,
  resolveBlockDefs,
  type BlockDefInput,
  type BlockFlagName,
  type BlockShape,
} from '@boboforces/world';
import { ROOT } from './paths.ts';

/**
 * Definições de bloco que o `mapc` usa para colisão, navegação e linha de visão. A fonte da verdade é o
 * `assets-src/blocks/generated/blocks.json` da frente "texturas" (`npm run texgen` roda antes do `mapc`). Enquanto ele
 * é provisório, vale a tabela RESERVA abaixo (formas e flags deduzidas dos IDs e da arte-ux.md §1.4), com aviso: a
 * grade compilada não muda (o `.bfmap` só guarda IDs), mas a validação pode mudar quando a tabela real chegar.
 */
export const BLOCKS_JSON = join(ROOT, 'assets-src', 'blocks', 'generated', 'blocks.json');

type Flags = readonly BlockFlagName[];
const SOLID: Flags = ['solid', 'walkable', 'blocksBullets', 'blocksSight'];
const CONTINUOUS: Flags = [...SOLID, 'colorVariation', 'randomUv'];
const CUTOUT_FENCE: Flags = ['solid', 'cutout'];
const PLANT: Flags = ['cutout', 'swaysInWind'];

const RESERVE: readonly (readonly [key: string, shape: BlockShape, flags: Flags, emissive?: number])[] = [
  ['missing', 'cube', SOLID],
  ['concrete', 'cube', CONTINUOUS],
  ['crate', 'cube', SOLID],
  ['concrete-slab', 'slab', CONTINUOUS],
  ['concrete-step', 'step', CONTINUOUS],
  ['concrete-ramp', 'ramp', CONTINUOUS],
  ['concrete-ramp-half-low', 'rampHalfLow', CONTINUOUS],
  ['concrete-ramp-half-high', 'rampHalfHigh', CONTINUOUS],
  ['concrete-ramp-corner-in', 'rampCornerIn', CONTINUOUS],
  ['concrete-ramp-corner-out', 'rampCornerOut', CONTINUOUS],
  ['test-floor', 'cube', SOLID],
  ['test-floor-stripe', 'cube', SOLID],
  ['sector-marker-1', 'cube', SOLID],
  ['sector-marker-2', 'cube', SOLID],
  ['sector-marker-3', 'cube', SOLID],
  ['sector-marker-4', 'cube', SOLID],
  ['sector-marker-5', 'cube', SOLID],
  ['sector-marker-6', 'cube', SOLID],
  ['sector-marker-7', 'cube', SOLID],
  ['sector-marker-8', 'cube', SOLID],
  ['sector-marker-9', 'cube', SOLID],
  ['test-wall', 'cube', SOLID],
  ['metal-panel', 'cube', SOLID],
  ['metal-roof-ramp', 'ramp', SOLID],
  ['metal-roof-ramp-corner-in', 'rampCornerIn', SOLID],
  ['metal-roof-ramp-corner-out', 'rampCornerOut', SOLID],
  ['brick', 'cube', SOLID],
  ['plank', 'cube', SOLID],
  ['plank-slab', 'slab', SOLID],
  ['grass', 'cube', CONTINUOUS],
  ['dirt', 'cube', CONTINUOUS],
  ['log', 'cube', SOLID],
  ['leaves', 'cube', ['solid', 'cutout', 'swaysInWind']],
  ['tall-grass', 'cross', PLANT],
  ['flowers', 'cross', PLANT],
  ['bush', 'cross', PLANT],
  ['fence-wire', 'panel', CUTOUT_FENCE],
  ['fence-wood', 'panel', ['solid', 'blocksBullets', 'blocksSight']],
  ['railing', 'postRail', ['solid', 'cutout']],
  ['grate-slab', 'slab', ['solid', 'walkable', 'cutout']],
  ['light-panel', 'cube', [...SOLID, 'emissive'], 12],
  ['lamp', 'cube', [...SOLID, 'emissive'], 15],
  ['glass', 'cube', ['solid', 'translucent', 'blocksBullets']],
  ['glass-pane', 'panel', ['solid', 'translucent', 'blocksBullets']],
  ['water', 'slab', ['translucent', 'animated']],
];

export interface BlockTable {
  readonly defs: ReadonlyMap<string, BlockDefInput>;
  /** `blocks.json` (real) ou `reserva` (provisório). */
  readonly source: 'blocks.json' | 'reserva';
  readonly warnings: readonly string[];
}

function reserveTable(): Map<string, BlockDefInput> {
  const defs = new Map<string, BlockDefInput>();
  for (const [key, shape, flags, emissive = 0] of RESERVE) {
    let bits = 0;
    for (const f of flags) bits |= BLOCK_FLAG[f];
    defs.set(key, { key, shape, faces: [0, 0, 0, 0, 0, 0], flags: bits, emissive, frames: 1, stepSound: '' });
  }
  return defs;
}

/** Lê as definições reais; cai na reserva (com aviso) se o arquivo for o provisório. */
export function loadBlockTable(path = BLOCKS_JSON): BlockTable {
  const warnings: string[] = [];
  if (existsSync(path)) {
    const json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    if (json['placeholder'] !== true) {
      // As camadas de textura não importam aqui: o mapc só olha forma e flags.
      const list = resolveBlockDefs(parseBlockDefs(json), () => 0);
      const defs = new Map<string, BlockDefInput>();
      for (const d of list) defs.set(d.key, d);
      if (!defs.has('missing')) defs.set('missing', reserveTable().get('missing')!);
      return { defs, source: 'blocks.json', warnings };
    }
  }
  warnings.push(
    'blocks.json ainda é o provisório da etapa de contratos: formas e flags vieram da tabela reserva do mapc ' +
      '(rode "npm run assets" quando o texgen gerar as definições).',
  );
  return { defs: reserveTable(), source: 'reserva', warnings };
}
