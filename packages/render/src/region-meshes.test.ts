import {
  NORMAL,
  packRegionVertex,
  REGION_VERTEX_WORDS,
  type RegionMesh,
  type RegionMeshArrays,
  type RegionVertex,
} from '@boboforces/world';
import {
  Box3,
  Frustum,
  IntType,
  Matrix4,
  MeshBasicMaterial,
  PerspectiveCamera,
  type InterleavedBufferAttribute,
  type Mesh,
} from 'three';
import { describe, expect, it } from 'vitest';
import { createRegionSet, REGION_POSITION_TO_METERS, regionArraysBytes, regionWorldBounds } from './region-meshes.ts';

const EMPTY: RegionMeshArrays = {
  vertexCount: 0,
  indexCount: 0,
  vertices: new Uint16Array(0),
  indices: new Uint16Array(0),
};

/** Um quad de chão (topo de uma célula) por quad pedido, com capacidade sobrando nos arrays. */
function quads(n: number, layer: number): RegionMeshArrays {
  const vertices = new Uint16Array((n * 4 + 2) * REGION_VERTEX_WORDS);
  const indices = new Uint16Array(n * 6 + 3);
  const v: RegionVertex = {
    x: 0,
    y: 16,
    z: 0,
    normal: NORMAL.py,
    ao: 3,
    colorVariation: true,
    layer,
    sky: 15,
    sun: 15,
    emissive: 0,
    flags: 0,
    variants: 1,
    frames: 1,
  };
  for (let q = 0; q < n; q++) {
    for (let c = 0; c < 4; c++) {
      v.x = (q + (c & 1)) * 16;
      v.z = (c >> 1) * 16;
      packRegionVertex(vertices, (q * 4 + c) * REGION_VERTEX_WORDS, v);
    }
    indices.set([q * 4, q * 4 + 2, q * 4 + 1, q * 4 + 1, q * 4 + 2, q * 4 + 3], q * 6);
  }
  return { vertexCount: n * 4, indexCount: n * 6, vertices, indices };
}

function region(rx: number, rz: number, opaque: RegionMeshArrays, translucent = EMPTY): RegionMesh {
  return {
    rx,
    ry: 0,
    rz,
    originX: rx * 64,
    originY: 0,
    originZ: rz * 64,
    minX: 0,
    minY: 0,
    minZ: 0,
    maxX: 3,
    maxY: 1,
    maxZ: 1,
    opaque,
    cutout: EMPTY,
    translucent,
  };
}

const materials = {
  opaque: new MeshBasicMaterial(),
  cutout: new MeshBasicMaterial(),
  translucent: new MeshBasicMaterial(),
};

describe('malhas das regiões', () => {
  it('AABB de mundo em metros a partir das células inclusivas (vazia = falso)', () => {
    const box = new Box3();
    expect(regionWorldBounds(region(1, 0, quads(1, 0)), box, 0)).toBe(true);
    expect(box.min.toArray()).toEqual([32, 0, 0]);
    expect(box.max.toArray()).toEqual([34, 1, 1]);
    const empty = { ...region(0, 0, EMPTY), minX: 1, maxX: 0 };
    expect(regionWorldBounds(empty, box)).toBe(false);
  });

  it('um buffer intercalado de 12 bytes: aPos nas palavras 0–2, aData nas 3–5, inteiro ou float', () => {
    for (const mode of ['int', 'float'] as const) {
      const set = createRegionSet([{ mesh: region(1, 0, quads(2, 7), quads(1, 9)) }], materials, mode);
      expect(set.count).toBe(1);
      expect(set.group.children).toHaveLength(2);
      const mesh = set.group.children[0] as Mesh;
      const pos = mesh.geometry.getAttribute('aPos') as InterleavedBufferAttribute;
      const data = mesh.geometry.getAttribute('aData') as InterleavedBufferAttribute;
      expect(pos.data).toBe(data.data);
      expect(pos.data.stride).toBe(6);
      expect([pos.offset, pos.itemSize, data.offset, data.itemSize]).toEqual([0, 3, 3, 3]);
      expect(pos.data.array.length).toBe(8 * 6); // só até o vertexCount, sem a capacidade que sobra
      expect(mesh.geometry.index!.count).toBe(12);
      const gpuType = (pos as unknown as { gpuType?: number }).gpuType;
      if (mode === 'int') expect(gpuType).toBe(IntType);
      else expect(gpuType).toBeUndefined();
      // Origem da região em metros e escala do passo de 1/16 de célula.
      expect(mesh.position.toArray()).toEqual([32, 0, 0]);
      expect(mesh.scale.x).toBeCloseTo(REGION_POSITION_TO_METERS);
      expect(mesh.frustumCulled).toBe(false);
      expect(set.bytes).toBe(regionArraysBytes(quads(2, 7)) + regionArraysBytes(quads(1, 9)));
      expect(regionArraysBytes(quads(2, 7))).toBe(8 * 12 + 12 * 2);
      expect(set.triangles).toBe(6);
      set.dispose();
      expect(set.group.children).toHaveLength(0);
    }
  });

  it('culling por vista: só as regiões no frustum da câmera ficam visíveis', () => {
    const set = createRegionSet(
      [{ mesh: region(0, 0, quads(1, 0)) }, { mesh: region(0, 3, quads(1, 0)) }, { mesh: region(3, 3, EMPTY) }],
      materials,
      'int',
    );
    expect(set.count).toBe(2);
    // Câmera em (1, 2, 40) olhando para -Z (yaw 0): vê a região de z = 0 m, não a de z = 96 m (atrás).
    const camera = new PerspectiveCamera(60, 1, 0.05, 90);
    camera.rotation.order = 'YXZ';
    camera.position.set(1, 2, 40);
    camera.updateMatrixWorld();
    const frustum = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    expect(set.cull(frustum)).toBe(1);
    const [near, far] = set.group.children as Mesh[];
    expect(near!.visible).toBe(true);
    expect(far!.visible).toBe(false);
    set.showAll();
    expect(far!.visible).toBe(true);
    set.dispose();
  });
});
