// Malhas do cenário do M1 por REGIÃO (2×2×1 chunks, tecnico.md §5.1 e §6.2): um buffer intercalado de 12 bytes por
// vértice (`aPos` = palavras 0–2, `aData` = palavras 3–5) e o culling por vista contra o frustum de cada câmera.
import {
  BLOCK_SIZE,
  REGION_VERTEX_WORDS,
  SUBCELL_STEPS,
  type RegionMesh,
  type RegionMeshArrays,
  type RegionPass,
} from '@boboforces/world';
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  IntType,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  Sphere,
  type Frustum,
  type Material,
} from 'three';
import type { VertexAttributeMode } from './types.ts';

export const REGION_PASSES: readonly RegionPass[] = ['opaque', 'cutout', 'translucent'];

/** Escala do vértice compacto até metros: 1/16 de célula × 0,5 m = 1/32 m. */
export const REGION_POSITION_TO_METERS = BLOCK_SIZE / SUBCELL_STEPS;

/** Folga do AABB de culling em metros (o topo da vegetação balança até ~4 cm). */
const CULL_MARGIN_M = 0.1;

/**
 * `InterleavedBufferAttribute` lido como INTEIRO no GL (`vertexAttribIPointer`, `uvec3` no shader). O three só olha
 * `gpuType === IntType` no atributo (o `InterleavedBufferAttribute` não tem o campo), então a subclasse o declara.
 */
export class IntegerInterleavedAttribute extends InterleavedBufferAttribute {
  readonly gpuType = IntType;
}

/**
 * AABB do conteúdo de uma região em METROS de mundo (o mesher dá células inclusivas relativas à origem). Devolve
 * `false` quando a região está vazia (min > max).
 */
export function regionWorldBounds(mesh: RegionMesh, out: Box3, margin = CULL_MARGIN_M): boolean {
  if (mesh.minX > mesh.maxX || mesh.minY > mesh.maxY || mesh.minZ > mesh.maxZ) {
    out.makeEmpty();
    return false;
  }
  out.min.set(
    (mesh.originX + mesh.minX) * BLOCK_SIZE - margin,
    (mesh.originY + mesh.minY) * BLOCK_SIZE - margin,
    (mesh.originZ + mesh.minZ) * BLOCK_SIZE - margin,
  );
  out.max.set(
    (mesh.originX + mesh.maxX + 1) * BLOCK_SIZE + margin,
    (mesh.originY + mesh.maxY + 1) * BLOCK_SIZE + margin,
    (mesh.originZ + mesh.maxZ + 1) * BLOCK_SIZE + margin,
  );
  return true;
}

/** Geometria three de UMA malha de região (vértices e índices até o `count`; a capacidade que sobra não sobe). */
export function createRegionGeometry(
  arrays: RegionMeshArrays,
  mode: VertexAttributeMode,
  localBounds: Box3,
): BufferGeometry {
  const geometry = new BufferGeometry();
  const vertices = arrays.vertices.subarray(0, arrays.vertexCount * REGION_VERTEX_WORDS);
  const buffer = new InterleavedBuffer(vertices, REGION_VERTEX_WORDS);
  // Rota int: u16 → uvec3 sem conversão. Rota float (item 5 do T0): o GL converte o u16 para float (sem normalizar).
  const Attr = mode === 'int' ? IntegerInterleavedAttribute : InterleavedBufferAttribute;
  geometry.setAttribute('aPos', new Attr(buffer, 3, 0, false));
  geometry.setAttribute('aData', new Attr(buffer, 3, 3, false));
  geometry.setIndex(new BufferAttribute(arrays.indices.subarray(0, arrays.indexCount), 1));
  // Sem atributo `position`: as caixas vão prontas (o three usa a esfera para ordenar de frente para trás).
  geometry.boundingBox = localBounds.clone();
  geometry.boundingSphere = localBounds.getBoundingSphere(new Sphere());
  return geometry;
}

/** Bytes que uma malha de região manda para a GPU (vértices de 12 bytes + índices). */
export function regionArraysBytes(arrays: RegionMeshArrays): number {
  return arrays.vertexCount * REGION_VERTEX_WORDS * 2 + arrays.indexCount * arrays.indices.BYTES_PER_ELEMENT;
}

interface RegionEntry {
  /** AABB de mundo (culling). */
  readonly box: Box3;
  readonly meshes: Mesh[];
}

export interface RegionSet {
  /** Grupo com as malhas (fica na cena principal). */
  readonly group: Group;
  /** Quantas regiões têm malha. */
  readonly count: number;
  /** Bytes enviados (vértices + índices). */
  readonly bytes: number;
  readonly triangles: number;
  /** Marca `visible` por região contra o frustum da vista; devolve quantas passaram. */
  cull(frustum: Frustum): number;
  /** Tudo visível (aquecimento: sobe todos os buffers e usa todos os programas). */
  showAll(): void;
  dispose(): void;
}

const _local = new Box3();

/**
 * Monta as malhas das regiões com os 3 materiais (`materials[pass]`). Cada malha é um `Mesh` estático (matriz
 * calculada uma vez: origem da região em metros e escala 1/32) com `frustumCulled = false`: quem faz o culling é
 * `cull`, por AABB e por vista. O three ainda ordena os opacos de frente para trás e os translúcidos de trás para a
 * frente pela esfera de cada malha.
 */
export function createRegionSet(
  regions: readonly { readonly mesh: RegionMesh }[],
  materials: Readonly<Record<RegionPass, Material>>,
  mode: VertexAttributeMode,
): RegionSet {
  const group = new Group();
  group.name = 'regioes';
  group.matrixAutoUpdate = false;
  const entries: RegionEntry[] = [];
  let bytes = 0;
  let triangles = 0;
  const scaleToLocal = SUBCELL_STEPS / BLOCK_SIZE;
  for (const region of regions) {
    const mesh = region.mesh;
    const box = new Box3();
    if (!regionWorldBounds(mesh, box)) continue;
    // Caixa local (unidades do vértice: 1/16 de célula a partir da origem da região).
    const ox = mesh.originX * BLOCK_SIZE;
    const oy = mesh.originY * BLOCK_SIZE;
    const oz = mesh.originZ * BLOCK_SIZE;
    _local.min.set((box.min.x - ox) * scaleToLocal, (box.min.y - oy) * scaleToLocal, (box.min.z - oz) * scaleToLocal);
    _local.max.set((box.max.x - ox) * scaleToLocal, (box.max.y - oy) * scaleToLocal, (box.max.z - oz) * scaleToLocal);
    const meshes: Mesh[] = [];
    for (const pass of REGION_PASSES) {
      const arrays = mesh[pass];
      if (arrays.indexCount === 0 || arrays.vertexCount === 0) continue;
      const object = new Mesh(createRegionGeometry(arrays, mode, _local), materials[pass]);
      object.name = `regiao ${mesh.rx},${mesh.ry},${mesh.rz} ${pass}`;
      object.position.set(ox, oy, oz);
      object.scale.setScalar(REGION_POSITION_TO_METERS);
      // Cenário estático (decisão #4): matriz calculada uma vez.
      object.matrixAutoUpdate = false;
      object.updateMatrix();
      object.frustumCulled = false;
      group.add(object);
      meshes.push(object);
      bytes += regionArraysBytes(arrays);
      triangles += arrays.indexCount / 3;
    }
    if (meshes.length > 0) entries.push({ box, meshes });
  }

  return {
    group,
    count: entries.length,
    bytes,
    triangles,
    cull(frustum: Frustum): number {
      let visible = 0;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!;
        const inside = frustum.intersectsBox(entry.box);
        if (inside) visible++;
        const meshes = entry.meshes;
        for (let m = 0; m < meshes.length; m++) meshes[m]!.visible = inside;
      }
      return visible;
    },
    showAll(): void {
      for (const entry of entries) for (const mesh of entry.meshes) mesh.visible = true;
    },
    dispose(): void {
      for (const entry of entries) {
        for (const mesh of entry.meshes) {
          mesh.geometry.dispose();
          mesh.removeFromParent();
        }
      }
      entries.length = 0;
      group.removeFromParent();
    },
  };
}
