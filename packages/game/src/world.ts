import { SKY_PRESETS, type RenderChunk, type RenderWorld, type TextureArrayData } from '@boboforces/render/data';
import type { SimMap } from '@boboforces/sim';
import {
  buildChunkMesh,
  buildTestArena,
  createBlockRegistry,
  TEST_BLOCK_DEFS,
  type BlockFaces,
  type BlockRegistry,
  type TestMap,
} from '@boboforces/world';

/**
 * Textura de cada bloco de teste pelo NOME da camada do `blocos16` (ordem das faces de `FACE`: +x, -x, +y, -y, +z,
 * -z). O jogo monta `BlockDef.faces` com o manifesto do texgen, então reordenar a tira não quebra o mapa.
 * O topo do concreto usa o piso de teste: é a cara de "sala de teste" do Construto (decisão #20).
 */
export const TEST_BLOCK_TEXTURES: Readonly<Record<string, readonly [string, string, string, string, string, string]>> =
  {
    concrete: ['concrete', 'concrete', 'test_floor', 'concrete', 'concrete', 'concrete'],
    crate: ['wood', 'wood', 'wood', 'wood', 'wood', 'wood'],
    // Não existe camada "missing" no M0; o metal verde destoa o bastante para chamar atenção.
    missing: ['metal', 'metal', 'metal', 'metal', 'metal', 'metal'],
  };

/**
 * Registro de blocos para o MESHER: mesmos blocos, ids e flags de `TEST_BLOCK_DEFS` (a grade guarda ids), com as
 * faces resolvidas pelo nome. Camada que não existe cai na 0 e vai para `missing` (aviso no log).
 */
export function createRenderBlocks(layers: ReadonlyMap<string, number>, missing: string[] = []): BlockRegistry {
  return createBlockRegistry(
    TEST_BLOCK_DEFS.map((def) => {
      const names = TEST_BLOCK_TEXTURES[def.key];
      if (!names) return def;
      const faces = names.map((name) => {
        const layer = layers.get(name);
        if (layer === undefined) {
          missing.push(name);
          return 0;
        }
        return layer;
      }) as unknown as BlockFaces;
      return { ...def, faces };
    }),
  );
}

/** Mapa da partida. M0: o Construto ainda não existe (M1), então todo mapa resolve para a arena de teste do `world`. */
export function loadMatchMap(mapId: string): TestMap {
  void mapId;
  return buildTestArena();
}

/** Malhas de todos os chunks do mapa (no loading da partida, nunca por frame). */
export function buildRenderWorld(
  map: SimMap,
  blocks: BlockRegistry,
  textures: TextureArrayData,
  sky = SKY_PRESETS.day,
): RenderWorld {
  const chunks: RenderChunk[] = [];
  const grid = map.grid;
  for (let cy = 0; cy < grid.chunksY; cy++) {
    for (let cz = 0; cz < grid.chunksZ; cz++) {
      for (let cx = 0; cx < grid.chunksX; cx++) {
        if (grid.getChunk(cx, cy, cz) === null) continue;
        chunks.push({ cx, cy, cz, mesh: buildChunkMesh(grid, blocks, cx, cy, cz) });
      }
    }
  }
  return { blockTextures: textures, chunks, sky };
}
