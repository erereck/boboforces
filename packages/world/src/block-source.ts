import { formatId, type MapGrid } from '@boboforces/format';
import { assert } from '@boboforces/shared';
import {
  BLOCK_FLAG,
  createBlockRegistry,
  MAX_BLOCK_FRAMES,
  MAX_BLOCK_VARIANTS,
  type BlockDefInput,
  type BlockFaces,
  type BlockRegistry,
} from './blocks.ts';
import { cellHasReservedBits, MAX_BLOCK_ID } from './cell.ts';
import { chunkIsEmpty } from './chunk.ts';
import { CHUNK_SIZE, CHUNK_VOLUME } from './constants.ts';
import { createWorldGrid, type WorldGrid } from './grid.ts';
import { SHAPE_ID, type BlockShape } from './shapes.ts';

/**
 * Definições de bloco no ARQUIVO (`blocks/blocks.json`, gerado pela frente "texturas" a partir de
 * `assets-src/blocks/`): faces por NOME de camada de `blocos16`, flags por nome. CONTRATO DO M1, implementado aqui.
 * No loading: `parseBlockDefs` → `resolveBlockDefs` (nome → índice pelo manifesto do texgen) → `createMapBlockRegistry`
 * (na ordem da tabela de blocos do `.bfmap`).
 */
export const BLOCK_DEFS_FORMAT = formatId('blocks', 1);

/** Nomes das flags no arquivo (as chaves de `BLOCK_FLAG`). */
export type BlockFlagName = keyof typeof BLOCK_FLAG;

export interface BlockSourceDef {
  /** ID estável sem prefixo (`concrete` = `block:concrete`), registrado em `CONTENT_IDS`. */
  readonly key: string;
  readonly shape: BlockShape;
  /** Nome da camada BASE por face, na ordem de `FACE` (+X, -X, +Y, -Y, +Z, -Z). */
  readonly faces: readonly [string, string, string, string, string, string];
  readonly flags: readonly BlockFlagName[];
  /** 0..15; > 0 exige a flag `emissive`. */
  readonly emissive: number;
  readonly frames: number;
  readonly variants: number;
  readonly stepSound: string;
}

export interface BlockDefsDocument {
  readonly format: typeof BLOCK_DEFS_FORMAT;
  readonly blocks: readonly BlockSourceDef[];
}

function fail(message: string): never {
  throw new Error(`blocks.json: ${message}`);
}

const FLAG_NAMES = Object.keys(BLOCK_FLAG) as BlockFlagName[];

/** Valida o JSON de definições (lança com a mensagem do primeiro problema). Não confere se o ID está registrado. */
export function parseBlockDefs(json: unknown): BlockSourceDef[] {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) fail('não é um objeto');
  const doc = json as Record<string, unknown>;
  if (doc['format'] !== BLOCK_DEFS_FORMAT) fail(`format precisa ser "${BLOCK_DEFS_FORMAT}"`);
  if (doc['placeholder'] === true) fail('arquivo provisório da etapa de contratos: rode "npm run texgen"');
  const list = doc['blocks'];
  if (!Array.isArray(list)) fail('sem "blocks"');
  if (list.length > MAX_BLOCK_ID) fail(`mais de ${MAX_BLOCK_ID} blocos`);
  const seen = new Set<string>();
  return list.map((raw: unknown, i): BlockSourceDef => {
    if (typeof raw !== 'object' || raw === null) fail(`bloco ${i} não é objeto`);
    const b = raw as Record<string, unknown>;
    const key = b['key'];
    if (typeof key !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,47}$/.test(key)) fail(`bloco ${i} com key inválida`);
    if (key === 'air' || seen.has(key)) fail(`bloco "${key}" repetido ou reservado`);
    seen.add(key);
    const shape = b['shape'];
    if (typeof shape !== 'string' || !Object.hasOwn(SHAPE_ID, shape) || shape === 'empty') {
      fail(`bloco "${key}" com forma inválida: ${String(shape)}`);
    }
    const faces = b['faces'];
    if (!Array.isArray(faces) || faces.length !== 6 || faces.some((f) => typeof f !== 'string' || f.length === 0)) {
      fail(`bloco "${key}" precisa de 6 nomes de camada em "faces"`);
    }
    const flags = b['flags'];
    if (!Array.isArray(flags) || flags.some((f) => !FLAG_NAMES.includes(f as BlockFlagName))) {
      fail(`bloco "${key}" com flag desconhecida`);
    }
    const emissive = b['emissive'] ?? 0;
    const frames = b['frames'] ?? 1;
    const variants = b['variants'] ?? 1;
    const isInt = (v: unknown, min: number, max: number): v is number =>
      typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
    if (!isInt(emissive, 0, 15)) fail(`bloco "${key}" com emissive fora de 0..15`);
    if (emissive > 0 && !flags.includes('emissive')) fail(`bloco "${key}" com emissive sem a flag "emissive"`);
    if (!isInt(frames, 1, MAX_BLOCK_FRAMES)) fail(`bloco "${key}" com frames fora de 1..${MAX_BLOCK_FRAMES}`);
    if (!isInt(variants, 1, MAX_BLOCK_VARIANTS)) fail(`bloco "${key}" com variants fora de 1..${MAX_BLOCK_VARIANTS}`);
    const stepSound = b['stepSound'] ?? '';
    if (typeof stepSound !== 'string') fail(`bloco "${key}" com stepSound inválido`);
    return {
      key,
      shape: shape as BlockShape,
      faces: faces as unknown as BlockSourceDef['faces'],
      flags: flags as BlockFlagName[],
      emissive,
      frames,
      variants,
      stepSound,
    };
  });
}

/**
 * Resolve as faces por nome para o índice de camada de `blocos16`. Camada que não existe cai em `fallbackLayer` e o
 * nome entra em `missing` (o loading registra no log e a cena mostra o xadrez do `missing`).
 */
export function resolveBlockDefs(
  sources: readonly BlockSourceDef[],
  layerOf: (name: string) => number | undefined,
  missing: string[] = [],
  fallbackLayer = 0,
): BlockDefInput[] {
  return sources.map((s) => {
    const faces = s.faces.map((name) => {
      const layer = layerOf(name);
      if (layer === undefined) {
        missing.push(name);
        return fallbackLayer;
      }
      return layer;
    }) as unknown as BlockFaces;
    let flags = 0;
    for (const f of s.flags) flags |= BLOCK_FLAG[f];
    if (s.frames > 1) flags |= BLOCK_FLAG.animated;
    return {
      key: s.key,
      shape: s.shape,
      faces,
      flags,
      emissive: s.emissive,
      frames: s.frames,
      variants: s.variants,
      stepSound: s.stepSound,
    };
  });
}

/**
 * Registro de blocos de um MAPA: a posição i da tabela do `.bfmap` (1..; a 0 é `air`) vira o id i da célula. Chave
 * que não está em `defs` usa a definição de `fallbackKey` (o xadrez `missing`, fallback de conteúdo) com a chave
 * original, para os ids continuarem batendo com a grade; as chaves que caíram no fallback entram em `missing`.
 */
export function createMapBlockRegistry(
  table: readonly string[],
  defs: ReadonlyMap<string, BlockDefInput>,
  missing: string[] = [],
  fallbackKey = 'missing',
): BlockRegistry {
  assert(table.length >= 1 && table[0] === 'air', 'tabela de blocos do mapa precisa começar por "air"');
  const fallback = defs.get(fallbackKey);
  const list: BlockDefInput[] = [];
  for (let i = 1; i < table.length; i++) {
    const key = table[i]!;
    const def = defs.get(key);
    if (def) {
      list.push(def);
      continue;
    }
    missing.push(key);
    assert(fallback !== undefined, `bloco "${key}" desconhecido e sem o fallback "${fallbackKey}"`);
    list.push({ ...fallback, key });
  }
  return createBlockRegistry(list);
}

/** `MapGrid` do `.bfmap` → grade do world. Recusa célula com bit reservado. Só no loading. */
export function gridFromMapGrid(map: MapGrid): WorldGrid {
  const grid = createWorldGrid(map.sizeX, map.sizeY, map.sizeZ);
  for (const c of map.chunks) {
    assert(!cellHasReservedBits(c.uniform), 'mapa: célula com bit reservado');
    const baseX = c.cx * CHUNK_SIZE;
    const baseY = c.cy * CHUNK_SIZE;
    const baseZ = c.cz * CHUNK_SIZE;
    const cells = c.cells;
    if (cells) assert(cells.length === CHUNK_VOLUME, 'mapa: chunk com tamanho errado');
    for (let i = 0; i < CHUNK_VOLUME; i++) {
      const cell = cells ? cells[i]! : c.uniform;
      if (cell === 0) continue;
      assert(!cellHasReservedBits(cell), 'mapa: célula com bit reservado');
      const x = baseX + (i & 31);
      const z = baseZ + ((i >> 5) & 31);
      const y = baseY + (i >> 10);
      if (grid.inBounds(x, y, z)) grid.set(x, y, z, cell);
    }
  }
  return grid;
}

/** Grade do world → `MapGrid` (ferramentas: `mapc`). Copia as células (o mapa não divide memória com a grade). */
export function mapGridFromGrid(grid: WorldGrid): MapGrid {
  const chunks: MapGrid['chunks'][number][] = [];
  grid.forEachChunk((chunk) => {
    if (chunkIsEmpty(chunk)) return;
    chunks.push({
      cx: chunk.cx,
      cy: chunk.cy,
      cz: chunk.cz,
      uniform: chunk.uniform,
      cells: chunk.cells ? chunk.cells.slice() : null,
    });
  });
  return { sizeX: grid.sizeX, sizeY: grid.sizeY, sizeZ: grid.sizeZ, chunks };
}
