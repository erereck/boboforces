import { describe, expect, it } from 'vitest';
import { BLOCK_FLAG, type BlockRegistry } from './blocks.ts';
import { chunkIsEmpty } from './chunk.ts';
import type { WorldGrid } from './grid.ts';
import { buildLightGrid, createLightJob } from './light.ts';
import { REGION_VERTEX_BYTES, type RegionMesh } from './mesh/region.ts';
import { meshWholeGrid, syntheticConstruto, syntheticRegistry } from './testing/synthetic-world.ts';

/**
 * Teste de fumaça e MEDIÇÃO da luz e da malha no Construto sintético (`testing/synthetic-world.ts`). Com
 * `BF_WORLD_BENCH=1` imprime tempos, quads antes/depois do greedy e bytes por região (relatório e docs/PERF.md).
 */

/** Faces visíveis sem fusão: cada face de cubo exposta conta 1 (o "antes" do greedy, só para os cubos). */
function exposedCubeFaces(grid: WorldGrid, registry: BlockRegistry): number {
  let n = 0;
  const isOpaqueCube = (x: number, y: number, z: number) => {
    const c = grid.get(x, y, z);
    if (c === 0) return false;
    const d = registry.get(c & 1023);
    return d.shape === 'cube' && (d.flags & (BLOCK_FLAG.cutout | BLOCK_FLAG.translucent)) === 0;
  };
  for (let y = 0; y < grid.sizeY; y++)
    for (let z = 0; z < grid.sizeZ; z++)
      for (let x = 0; x < grid.sizeX; x++) {
        if (!isOpaqueCube(x, y, z)) continue;
        if (!isOpaqueCube(x + 1, y, z)) n++;
        if (!isOpaqueCube(x - 1, y, z)) n++;
        if (!isOpaqueCube(x, y + 1, z)) n++;
        if (!isOpaqueCube(x, y - 1, z)) n++;
        if (!isOpaqueCube(x, y, z + 1)) n++;
        if (!isOpaqueCube(x, y, z - 1)) n++;
      }
  return n;
}

/** FNV-1a de todas as malhas (determinismo). */
function hashMeshes(meshes: RegionMesh[]): number {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h ^= v & 0xffff;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (const m of meshes) {
    for (const a of [m.opaque, m.cutout, m.translucent]) {
      for (let i = 0; i < a.vertexCount * 6; i++) mix(a.vertices[i]!);
      for (let i = 0; i < a.indexCount; i++) mix(a.indices[i]!);
    }
  }
  return h;
}

describe('Construto sintético (160 × 48 × 160)', () => {
  it('luz e malha completas: determinísticas, greedy reduz, ~30 chunks não vazios', () => {
    const registry = syntheticRegistry();
    const t0 = performance.now();
    const grid = syntheticConstruto();
    const t1 = performance.now();
    let nonEmpty = 0;
    grid.forEachChunk((c) => (nonEmpty += chunkIsEmpty(c) ? 0 : 1));

    const job = createLightJob(grid, registry, {
      sunDirX: 0.4,
      sunDirY: 0.8,
      sunDirZ: 0.3,
      emitters: [{ x: 80, y: 4, z: 80, level: 12 }],
    });
    let slices = 0;
    while (!job.step(65536)) slices++;
    const light = job.result;
    const t2 = performance.now();
    const lightGrid = buildLightGrid(light);
    const t3 = performance.now();
    const meshes = meshWholeGrid(grid, registry, light);
    const t4 = performance.now();
    const meshesAgain = meshWholeGrid(grid, registry, light);
    const t5 = performance.now();

    let quads = 0;
    let tris = 0;
    let bytes = 0;
    let regionsWithContent = 0;
    let maxBytes = 0;
    for (const m of meshes) {
      let b = 0;
      for (const a of [m.opaque, m.cutout, m.translucent]) {
        tris += a.indexCount / 3;
        quads += a.indexCount / 6;
        b += a.vertexCount * REGION_VERTEX_BYTES + a.indexCount * (a.indices instanceof Uint16Array ? 2 : 4);
      }
      if (b > 0) regionsWithContent++;
      bytes += b;
      maxBytes = Math.max(maxBytes, b);
    }
    const opaqueQuads = meshes.reduce((s, m) => s + m.opaque.indexCount / 6, 0);
    const before = exposedCubeFaces(grid, registry);

    expect(nonEmpty).toBeGreaterThanOrEqual(25);
    expect(nonEmpty).toBeLessThanOrEqual(40);
    expect(opaqueQuads).toBeLessThan(before);
    expect(hashMeshes(meshesAgain)).toBe(hashMeshes(meshes));
    expect(lightGrid.sizeX).toBe(40);

    if (process.env['BF_WORLD_BENCH']) {
      const ms = (a: number, b: number) => (b - a).toFixed(1);
      console.log(
        [
          `grade: ${ms(t0, t1)} ms, chunks não vazios ${nonEmpty}`,
          `luz: ${ms(t1, t2)} ms em ${slices + 1} fatias de 65.536; grade de 2 m: ${ms(t2, t3)} ms`,
          `malha (${meshes.length} regiões, ${regionsWithContent} com conteúdo): ${ms(t3, t4)} ms; de novo: ${ms(t4, t5)} ms`,
          `faces de cubo opaco expostas (antes do greedy): ${before}; quads opacos depois: ${opaqueQuads.toFixed(0)}`,
          `quads totais ${quads.toFixed(0)}, triângulos ${tris.toFixed(0)}`,
          `bytes: total ${(bytes / 1024).toFixed(1)} KB, média por região com conteúdo ${(bytes / regionsWithContent / 1024).toFixed(1)} KB, maior ${(maxBytes / 1024).toFixed(1)} KB`,
        ].join('\n'),
      );
    }
  });
});
