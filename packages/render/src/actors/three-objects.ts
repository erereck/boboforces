// Cola com o three dos passes da render-atores: geometrias do programa 4, buffers de instância com faixa de upload
// fixa (sem lixo por frame) e os materiais dos programas 4 e 5. Todo material de um programa usa EXATAMENTE os mesmos
// shaders e `defines`, e todo objeto é `InstancedMesh` com os mesmos atributos de vértice: o cache de programas do
// three (chave = shaders + defines + flags do objeto e da geometria) devolve o MESMO programa (regra 8).
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  FrontSide,
  GLSL3,
  InstancedBufferAttribute,
  InstancedInterleavedBuffer,
  InstancedMesh,
  InterleavedBufferAttribute,
  NormalBlending,
  ShaderMaterial,
  Sphere,
  StaticDrawUsage,
  Vector3,
  type IUniform,
} from 'three';
import type { PassContext } from '../shared/passes.ts';
import { TEXTURE_UNIFORM_NAMES } from '../shared/glsl-common.ts';
import type { GeometryArrays } from './geometry.ts';
import { INSTANCE_FLOATS, VERT_COMPONENTS } from './layout.ts';
import { MAT4 } from './math.ts';
import { INSTANCED_FRAGMENT, INSTANCED_VERTEX } from './shader.ts';
import { PARTICLE_FRAGMENT, PARTICLE_VERTEX } from '../fx/shader.ts';
import { PARTICLE_FLOATS } from '../fx/particles.ts';

/** Faixa de upload de um buffer (a mesma forma do `updateRanges` do three). */
interface UpdateRange {
  start: number;
  count: number;
}
interface RangedBuffer {
  updateRanges: UpdateRange[];
  clearUpdateRanges(): void;
  needsUpdate: boolean;
}

function keepRanges(): void {}

/**
 * Fixa UMA faixa de upload no buffer (o mesmo objeto sempre; o `clearUpdateRanges` desta instância não apaga): por
 * frame só mudam `start`/`count`. Sem isso, cada `addUpdateRange` do three cria um objeto.
 */
export function pinRange(buffer: RangedBuffer): UpdateRange {
  const range: UpdateRange = { start: 0, count: 0 };
  buffer.updateRanges.length = 0;
  buffer.updateRanges.push(range);
  buffer.clearUpdateRanges = keepRanges;
  return range;
}

/** Marca para subir os elementos [first, last] (em itens de `itemSize` floats). Nada se a faixa é vazia. */
export function uploadRange(
  buffer: RangedBuffer,
  range: UpdateRange,
  itemSize: number,
  first: number,
  last: number,
): void {
  if (last < first || first < 0) return;
  range.start = first * itemSize;
  range.count = (last - first + 1) * itemSize;
  buffer.needsUpdate = true;
}

/** Atributos de vértice de uma geometria do programa 4, criados uma vez e divididos entre malhas (props, armas). */
export interface VertexBuffers {
  readonly position: BufferAttribute;
  readonly normal: BufferAttribute;
  readonly uv: BufferAttribute;
  readonly aVert: BufferAttribute;
  readonly index: BufferAttribute;
  readonly vertexCount: number;
}

export function createVertexBuffers(g: GeometryArrays): VertexBuffers {
  return {
    position: new BufferAttribute(g.positions, 3),
    normal: new BufferAttribute(g.normals, 3),
    uv: new BufferAttribute(g.uvs, 2),
    aVert: new BufferAttribute(g.verts, VERT_COMPONENTS),
    index: new BufferAttribute(g.indices, 1),
    vertexCount: g.vertexCount,
  };
}

/** Matrizes de instância com faixa de upload fixa. */
export interface MatrixSet {
  readonly matrices: Float32Array;
  readonly attribute: InstancedBufferAttribute;
  readonly range: UpdateRange;
}

export function createMatrixSet(capacity: number): MatrixSet {
  const matrices = new Float32Array(Math.max(1, capacity) * MAT4);
  const attribute = new InstancedBufferAttribute(matrices, MAT4);
  attribute.setUsage(DynamicDrawUsage);
  return { matrices, attribute, range: pinRange(attribute) };
}

/** Dados de instância intercalados (16 floats) com faixa de upload fixa. */
export interface DataSet {
  readonly data: Float32Array;
  readonly buffer: InstancedInterleavedBuffer;
  readonly range: UpdateRange;
}

export function createDataSet(capacity: number): DataSet {
  const data = new Float32Array(Math.max(1, capacity) * INSTANCE_FLOATS);
  const buffer = new InstancedInterleavedBuffer(data, INSTANCE_FLOATS);
  buffer.setUsage(DynamicDrawUsage);
  return { data, buffer, range: pinRange(buffer) };
}

/** Dados de instância (matriz + 16 floats intercalados) com faixas de upload fixas. */
export interface InstanceSet {
  readonly capacity: number;
  readonly matrices: Float32Array;
  readonly data: Float32Array;
  readonly matrixAttribute: InstancedBufferAttribute;
  readonly dataBuffer: InstancedInterleavedBuffer;
  readonly matrixRange: UpdateRange;
  readonly dataRange: UpdateRange;
}

export function createInstanceSet(
  capacity: number,
  matrices: Float32Array = new Float32Array(Math.max(1, capacity) * MAT4),
  data: Float32Array = new Float32Array(Math.max(1, capacity) * INSTANCE_FLOATS),
  dynamic = true,
): InstanceSet {
  const matrixAttribute = new InstancedBufferAttribute(matrices, MAT4);
  const dataBuffer = new InstancedInterleavedBuffer(data, INSTANCE_FLOATS);
  matrixAttribute.setUsage(dynamic ? DynamicDrawUsage : StaticDrawUsage);
  dataBuffer.setUsage(dynamic ? DynamicDrawUsage : StaticDrawUsage);
  return {
    capacity,
    matrices,
    data,
    matrixAttribute,
    dataBuffer,
    matrixRange: pinRange(matrixAttribute),
    dataRange: pinRange(dataBuffer),
  };
}

/** Geometria = atributos de vértice (divididos) + os 4 vec4 de instância do buffer intercalado (dividido ou não). */
export function instancedGeometry(vertex: VertexBuffers, dataBuffer: InstancedInterleavedBuffer): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', vertex.position);
  g.setAttribute('normal', vertex.normal);
  g.setAttribute('uv', vertex.uv);
  g.setAttribute('aVert', vertex.aVert);
  g.setIndex(vertex.index);
  g.setAttribute('iLayer', new InterleavedBufferAttribute(dataBuffer, 4, 0));
  g.setAttribute('iLight', new InterleavedBufferAttribute(dataBuffer, 4, 4));
  g.setAttribute('iColor', new InterleavedBufferAttribute(dataBuffer, 4, 8));
  g.setAttribute('iPart', new InterleavedBufferAttribute(dataBuffer, 4, 12));
  return g;
}

/** Raio da esfera fixa das malhas instanciadas: cobre qualquer mapa (m). */
export const FIXED_SPHERE_RADIUS = 1e6;

/**
 * Esfera envolvente FIXA (centro 0, raio 1e6) atribuída na criação (#56, PLANO do porte §B10 e risco 2 do §F): o three
 * só chama `computeBoundingSphere()` quando a esfera é `null` (ordenação no `projectObject`, culling, raycast), e
 * essa conta percorre TODAS as instâncias lendo a 4ª linha da matriz, que nas caixas do boneco leva luz e expressão
 * (NaN na ordenação) e custaria O(instâncias) por malha. A esfera dá a ordem por objeto, igual para todas.
 */
export function fixBoundingSphere(mesh: InstancedMesh): void {
  mesh.boundingSphere = new Sphere(new Vector3(0, 0, 0), FIXED_SPHERE_RADIUS);
}

/** `InstancedMesh` do programa 4 sobre um conjunto (sem culling do three: o passe decide por vista). */
export function instancedMesh(
  geometry: BufferGeometry,
  material: ShaderMaterial,
  matrices: InstancedBufferAttribute,
  name: string,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, 0);
  mesh.instanceMatrix = matrices;
  mesh.count = 0;
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.visible = false;
  fixBoundingSphere(mesh);
  return mesh;
}

/** Sobe `count` instâncias do conjunto (matrizes sempre; dados só se `dataFirst..dataLast` for válido). */
export function uploadInstances(set: InstanceSet, count: number, dataFirst: number, dataLast: number): void {
  if (count > 0) uploadRange(set.matrixAttribute, set.matrixRange, MAT4, 0, count - 1);
  uploadRange(set.dataBuffer, set.dataRange, INSTANCE_FLOATS, dataFirst, dataLast);
}

// --- materiais ---

/**
 * Uniforms por vista do programa 4 (objetos `{ value }` próprios de cada material). Sem contorno de time (#50) e sem
 * a skin de teste de densidade (#51): só o slot escondido e a distância da camada externa.
 */
export interface InstancedUniforms {
  readonly uHideSlot: IUniform<number>;
  readonly uOuterMaxDist: IUniform<number>;
}

export function createInstancedUniforms(): InstancedUniforms {
  return {
    uHideSlot: { value: -1 },
    uOuterMaxDist: { value: 1e6 },
  };
}

/** Material do programa 4 (opaco, `discard` para a camada externa e camadas cutout). */
export function createInstancedMaterial(ctx: PassContext, perView: InstancedUniforms, name: string): ShaderMaterial {
  const t = TEXTURE_UNIFORM_NAMES.models;
  return new ShaderMaterial({
    name,
    glslVersion: GLSL3,
    vertexShader: INSTANCED_VERTEX,
    fragmentShader: INSTANCED_FRAGMENT,
    defines: { ...ctx.defines },
    uniforms: {
      ...ctx.uniforms,
      [t.sampler]: ctx.textures.models,
      [t.atlas]: ctx.textures.modelsAtlas,
      [t.atlasSize]: ctx.textures.modelsAtlasSize,
      ...perView,
    },
    side: FrontSide,
  });
}

/** Uniforms do programa 5: relógio dos efeitos e slot escondido da vista (divididos entre os materiais do passe). */
export interface ParticleUniforms {
  readonly uFxTime: IUniform<number>;
  readonly uHideSlot: IUniform<number>;
}

export function createParticleUniforms(): ParticleUniforms {
  return { uFxTime: { value: 0 }, uHideSlot: { value: -1 } };
}

/**
 * Material do programa 5. `additive`: clarão, traçante, faíscas (sem luz, a fog apaga). `alpha`: fumaça, poeira,
 * confete. `decal`: marcas de tiro e sombra-blob (sem gravar profundidade, puxado para a frente pelo polygon offset).
 * Mudam só blend, profundidade e o uniform `uAdditive`: o programa é o mesmo.
 */
export function createParticleMaterial(
  ctx: PassContext,
  shared: ParticleUniforms,
  mode: 'additive' | 'alpha' | 'decal',
): ShaderMaterial {
  const material = new ShaderMaterial({
    name: `particulas-${mode}`,
    glslVersion: GLSL3,
    vertexShader: PARTICLE_VERTEX,
    fragmentShader: PARTICLE_FRAGMENT,
    defines: { ...ctx.defines },
    uniforms: { ...ctx.uniforms, ...shared, uAdditive: { value: mode === 'additive' ? 1 : 0 } },
    transparent: true,
    depthWrite: false,
    blending: mode === 'additive' ? AdditiveBlending : NormalBlending,
    side: DoubleSide,
  });
  if (mode === 'decal') {
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -4;
  }
  return material;
}

/** Quad unitário (-0,5..0,5) das partículas: só `position` (o resto é por instância). */
export function createQuadGeometry(): { position: BufferAttribute; index: BufferAttribute } {
  return {
    position: new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3),
    index: new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1),
  };
}

/** Malha de partículas sobre um buffer de 24 floats por instância (6 vec4: pA..pF). */
export interface ParticleMesh {
  readonly mesh: InstancedMesh;
  readonly buffer: InstancedInterleavedBuffer;
  readonly range: UpdateRange;
}

export function createParticleMesh(
  quad: { position: BufferAttribute; index: BufferAttribute },
  data: Float32Array,
  material: ShaderMaterial,
  name: string,
): ParticleMesh {
  const buffer = new InstancedInterleavedBuffer(data, PARTICLE_FLOATS);
  buffer.setUsage(DynamicDrawUsage);
  const range = pinRange(buffer);
  const g = new BufferGeometry();
  g.setAttribute('position', quad.position);
  g.setIndex(quad.index);
  const names = ['pA', 'pB', 'pC', 'pD', 'pE', 'pF'];
  names.forEach((n, i) => g.setAttribute(n, new InterleavedBufferAttribute(buffer, 4, i * 4)));
  const mesh = new InstancedMesh(g, material, 0);
  mesh.count = 0;
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.visible = false;
  fixBoundingSphere(mesh);
  return { mesh, buffer, range };
}
