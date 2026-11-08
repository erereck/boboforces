import { describe, expect, it } from 'vitest';
import {
  createMapBlockRegistry,
  gridFromMapGrid,
  mapGridFromGrid,
  parseBlockDefs,
  resolveBlockDefs,
} from './block-source.ts';
import { BLOCK_FLAG, createBlockRegistry, FACE } from './blocks.ts';
import { cellBlock, cellFlipped, cellOrientation, cellRotation, makeCell } from './cell.ts';
import { createWorldGrid } from './grid.ts';
import { createLightJob, sampleLightGrid } from './light.ts';
import {
  BITANGENT_TABLE,
  buildRegionMesh,
  NORMAL,
  NORMAL_TABLE,
  packRegionVertex,
  rampNormalIndex,
  REGION_CELLS_X,
  REGION_CELLS_Y,
  REGION_CELLS_Z,
  TANGENT_TABLE,
  unpackRegionVertex,
  type RegionVertex,
} from './mesh/index.ts';
import { createRayHit } from './query.ts';
import {
  orientFace,
  SHAPE_ID,
  SHAPE_NAMES,
  shapeCollision,
  shapeCollisionBoxes,
  shapeCoveredFaces,
  shapeFaceSource,
  shapeFloorHeight,
  shapeVisualBoxes,
} from './shapes.ts';

describe('célula do M1', () => {
  it('compatível com o makeCell do M0 e orientação = giro | inversão << 2', () => {
    const c = makeCell(1023, 3, true);
    expect(cellBlock(c)).toBe(1023);
    expect(cellRotation(c)).toBe(3);
    expect(cellFlipped(c)).toBe(true);
    expect(cellOrientation(c)).toBe(7);
    expect(c & 0xe000).toBe(0);
    expect(makeCell(5, 1)).toBe(5 | (1 << 10));
  });
});

describe('catálogo de formas', () => {
  it('ids estáveis e nomes na ordem', () => {
    expect(SHAPE_NAMES.length).toBe(12);
    SHAPE_NAMES.forEach((name, i) => expect(SHAPE_ID[name]).toBe(i));
  });

  it('giro anti-horário visto de cima: -Z → -X → +Z → +X → -Z', () => {
    expect(orientFace(FACE.nz, 1)).toBe(FACE.nx);
    expect(orientFace(FACE.nx, 1)).toBe(FACE.pz);
    expect(orientFace(FACE.pz, 1)).toBe(FACE.px);
    expect(orientFace(FACE.px, 1)).toBe(FACE.nz);
    expect(orientFace(FACE.py, 4)).toBe(FACE.ny);
  });

  it('caixas orientadas e piso das rampas', () => {
    const out = new Float32Array(12);
    expect(shapeCollisionBoxes(SHAPE_ID.slab, 0, out)).toBe(1);
    expect([...out.subarray(0, 6)]).toEqual([0, 0, 0, 16, 8, 16]);
    expect(shapeCollisionBoxes(SHAPE_ID.slab, 4, out)).toBe(1);
    expect([...out.subarray(0, 6)]).toEqual([0, 8, 0, 16, 16, 16]);
    expect(shapeCollisionBoxes(SHAPE_ID.panel, 1, out)).toBe(1);
    expect([...out.subarray(0, 6)]).toEqual([7, 0, 0, 9, 16, 16]);
    expect(shapeCollisionBoxes(SHAPE_ID.ramp, 0, out)).toBe(0);
    expect(shapeCollision(SHAPE_ID.ramp, 0)).toBe('slope');
    expect(shapeCollision(SHAPE_ID.ramp, 4)).toBe('boxes');
    expect(shapeVisualBoxes(SHAPE_ID.postRail, 0, new Float32Array(18))).toBe(3);
    // Rampa canônica sobe para -Z; girada 1 vez, sobe para -X.
    expect(shapeFloorHeight(SHAPE_ID.ramp, 0, 0.5, 0)).toBeCloseTo(1);
    expect(shapeFloorHeight(SHAPE_ID.ramp, 0, 0.5, 1)).toBeCloseTo(0);
    expect(shapeFloorHeight(SHAPE_ID.ramp, 1, 0, 0.5)).toBeCloseTo(1);
    expect(shapeFloorHeight(SHAPE_ID.ramp, 1, 1, 0.5)).toBeCloseTo(0);
    expect(shapeFloorHeight(SHAPE_ID.rampHalfHigh, 0, 0.5, 1)).toBeCloseTo(0.5);
    expect(shapeFloorHeight(SHAPE_ID.cross, 0, 0.5, 0.5)).toBe(-1);
    expect(shapeCoveredFaces(SHAPE_ID.ramp, 1)).toBe((1 << FACE.ny) | (1 << FACE.nx));
  });
});

describe('vértice compacto de 12 bytes', () => {
  it('ida e volta dos campos e posição dos bytes', () => {
    const v: RegionVertex = {
      x: 1024,
      y: 512,
      z: 3,
      normal: 25,
      ao: 2,
      colorVariation: true,
      layer: 200,
      sky: 15,
      sun: 7,
      emissive: 9,
      flags: 5,
      variants: 3,
      frames: 16,
    };
    const words = new Uint16Array(6);
    packRegionVertex(words, 0, v);
    const bytes = new Uint8Array(words.buffer);
    expect(bytes[6]).toBe(25 | (2 << 5) | (1 << 7));
    expect(bytes[7]).toBe(200);
    expect(bytes[8]).toBe(15 | (7 << 4));
    expect(bytes[9]).toBe(9 | (5 << 4));
    expect(bytes[10]).toBe(2 | (15 << 4));
    expect(bytes[11]).toBe(0);
    expect(unpackRegionVertex(words, 0, { ...v, x: 0 })).toEqual(v);
  });

  it('tabela de normais: 26 entradas unitárias, eixos do M0 e base ortonormal', () => {
    expect(NORMAL_TABLE.length).toBe(NORMAL.count);
    expect(NORMAL_TABLE.slice(0, 6)).toEqual([
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ]);
    NORMAL_TABLE.forEach((n, i) => {
      const t = TANGENT_TABLE[i]!;
      const b = BITANGENT_TABLE[i]!;
      const dot = (a: readonly number[], c: readonly number[]) => a[0]! * c[0]! + a[1]! * c[1]! + a[2]! * c[2]!;
      expect(dot(n, n)).toBeCloseTo(1);
      expect(dot(t, n)).toBeCloseTo(0);
      expect(dot(b, n)).toBeCloseTo(0);
      expect(dot(t, b)).toBeCloseTo(0);
    });
    // Rampa 1:1 girada 1 vez encara +X (sobe para -X).
    const r1 = NORMAL_TABLE[rampNormalIndex(1, 1, false)]!;
    expect(r1[0]).toBeGreaterThan(0);
    expect(r1[1]).toBeGreaterThan(0);
    expect(shapeFaceSource(rampNormalIndex(2, 3, true))).toBe(FACE.ny);
    expect(shapeFaceSource(NORMAL.cross + 1)).toBe(FACE.px);
  });

  it('região de 2×2×1 chunks', () => {
    expect([REGION_CELLS_X, REGION_CELLS_Y, REGION_CELLS_Z]).toEqual([64, 32, 64]);
  });
});

describe('definições de bloco por nome', () => {
  const doc = {
    format: 'boboforces/blocks@1',
    blocks: [
      {
        key: 'missing',
        shape: 'cube',
        faces: ['x', 'x', 'x', 'x', 'x', 'x'],
        flags: ['solid', 'blocksBullets'],
        stepSound: 'concrete',
      },
      {
        key: 'lamp',
        shape: 'cube',
        faces: ['lamp', 'lamp', 'lamp', 'lamp', 'lamp', 'nada'],
        flags: ['solid', 'emissive'],
        emissive: 14,
        frames: 2,
      },
    ],
  };

  it('resolve faces pelo manifesto e monta o registro na ordem do mapa', () => {
    const sources = parseBlockDefs(doc);
    const missingLayers: string[] = [];
    const layers = new Map([
      ['x', 3],
      ['lamp', 7],
    ]);
    const defs = resolveBlockDefs(sources, (n) => layers.get(n), missingLayers);
    expect(missingLayers).toEqual(['nada']);
    expect(defs[1]!.faces).toEqual([7, 7, 7, 7, 7, 0]);
    expect(defs[1]!.flags & BLOCK_FLAG.animated).not.toBe(0);
    const missingBlocks: string[] = [];
    const registry = createMapBlockRegistry(
      ['air', 'lamp', 'concrete'],
      new Map(defs.map((d) => [d.key, d])),
      missingBlocks,
    );
    expect(missingBlocks).toEqual(['concrete']);
    expect(registry.byKey('lamp')!.id).toBe(1);
    expect(registry.emissive[1]).toBe(14);
    expect(registry.shapes[2]).toBe(SHAPE_ID.cube);
  });

  it('recusa emissivo sem flag e forma desconhecida', () => {
    expect(() => parseBlockDefs({ ...doc, blocks: [{ ...doc.blocks[1], flags: ['solid'] }] })).toThrow('emissive');
    expect(() => parseBlockDefs({ ...doc, blocks: [{ ...doc.blocks[0], shape: 'sphere' }] })).toThrow('forma');
  });
});

describe('MapGrid ↔ WorldGrid', () => {
  it('ida e volta', () => {
    const grid = createWorldGrid(40, 8, 40);
    grid.set(1, 2, 3, makeCell(2, 1));
    grid.set(39, 7, 39, makeCell(1));
    const back = gridFromMapGrid(mapGridFromGrid(grid));
    expect(back.get(1, 2, 3)).toBe(makeCell(2, 1));
    expect(back.get(39, 7, 39)).toBe(makeCell(1));
    expect(back.get(0, 0, 0)).toBe(0);
  });
});

describe('frente mundo implementada (sem stubs)', () => {
  it('mesher, luz e grade de luz respondem numa grade vazia; RayHit ganhou face e prop', () => {
    const grid = createWorldGrid(4, 4, 4);
    const registry = createBlockRegistry([]);
    const mesh = buildRegionMesh(grid, registry, null, 0, 0, 0);
    expect(mesh.opaque.vertexCount + mesh.cutout.vertexCount + mesh.translucent.vertexCount).toBe(0);
    expect(mesh.minX).toBeGreaterThan(mesh.maxX);
    const job = createLightJob(grid, registry, { sunDirX: 0, sunDirY: 1, sunDirZ: 0, emitters: [] });
    expect(job.done).toBe(false);
    while (!job.step(1000));
    expect(job.result.sky(1, 1, 1)).toBe(15);
    const out = new Float32Array(3);
    sampleLightGrid({ sizeX: 1, sizeY: 1, sizeZ: 1, data: Uint8Array.from([255, 0, 51]) }, 0, 0, 0, out, 0);
    expect([...out]).toEqual([1, 0, 0.20000000298023224]);
    const hit = createRayHit();
    expect(hit.face).toBe(-1);
    expect(hit.prop).toBe(-1);
  });
});
