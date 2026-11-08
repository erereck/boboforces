// Materiais dos 4 programas do mundo (1 opaco, 2 cutout, 3 translúcido, 6 céu) e os uniforms que eles dividem com os
// passes de atores e VFX (`SharedUniforms`, `SharedTextures`). Um objeto `{ value }` por uniform, o MESMO em todos os
// materiais: a render-mundo escreve 1x por frame (ou por vista) e todo programa enxerga.
import type { RegionPass } from '@boboforces/world';
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  GLSL3,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  LinearFilter,
  Mesh,
  NoColorSpace,
  RGBAFormat,
  ShaderMaterial,
  Sphere,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  type IUniform,
} from 'three';
import { GRADE_LUT_SIZE } from './environment-data.ts';
import { IntegerInterleavedAttribute } from './region-meshes.ts';
import { GLSL_DEFINE } from './shared/glsl-common.ts';
import type { SharedUniforms } from './shared/passes.ts';
import type { MutableSharedTextures } from './texture-gpu.ts';
import type { TextureMode, VertexAttributeMode } from './types.ts';
import { REGION_FRAGMENT, REGION_VERTEX, SKY_FRAGMENT, SKY_VERTEX } from './world-shaders.ts';

/** O céu vem DEPOIS de todo opaco (só pinta o que sobrou) e antes dos transparentes (lista separada do three). */
export const SKY_RENDER_ORDER = 1_000_000;

export interface SkyUniforms {
  readonly uZenithColor: IUniform<Vector3>;
  readonly uStars: IUniform<number>;
  readonly uCloudCover: IUniform<number>;
}

/** Os uniforms comuns, com a LUT de grading (256×1 RGBA8, three cuida do envio e do restore do contexto). */
export function createSharedUniforms(): { readonly uniforms: SharedUniforms; readonly lut: DataTexture } {
  const lut = new DataTexture(new Uint8Array(GRADE_LUT_SIZE * 4).fill(255), GRADE_LUT_SIZE, 1, RGBAFormat);
  lut.name = 'lut-grading';
  lut.type = UnsignedByteType;
  lut.colorSpace = NoColorSpace;
  lut.magFilter = LinearFilter;
  lut.minFilter = LinearFilter;
  lut.wrapS = ClampToEdgeWrapping;
  lut.wrapT = ClampToEdgeWrapping;
  lut.generateMipmaps = false;
  lut.needsUpdate = true;
  const uniforms: SharedUniforms = {
    uSunDir: { value: new Vector3(0, 1, 0) },
    uSunColor: { value: new Vector3(1, 1, 1) },
    uSkyLightColor: { value: new Vector3(1, 1, 1) },
    uGroundColor: { value: new Vector3(0.5, 0.5, 0.5) },
    uEmissiveColor: { value: new Vector3(1, 1, 1) },
    uFogColor: { value: new Vector3(0.8, 0.85, 0.9) },
    uSunStrength: { value: 0.55 },
    uSkyStrength: { value: 0.85 },
    uFogNear: { value: 40 },
    uFogFar: { value: 90 },
    uTime: { value: 0 },
    uFlash: { value: 0 },
    uWind: { value: 1 },
    uGrayscale: { value: 0 },
    uGradeLut: { value: lut },
    uGradeStrength: { value: 0 },
  };
  return { uniforms, lut };
}

export function createSharedTextures(): MutableSharedTextures {
  return {
    blocks: { value: null },
    blocksAtlas: { value: new Vector4(1, 1, 16, 0) },
    blocksAtlasSize: { value: new Vector2(16, 16) },
    models: { value: null },
    modelsAtlas: { value: new Vector4(1, 1, 64, 0) },
    modelsAtlasSize: { value: new Vector2(64, 64) },
    assets: null,
  };
}

/** `#define`s de criação (vão também no `PassContext.defines` dos passes de atores e VFX). */
export function creationDefines(
  textureMode: TextureMode,
  vertexAttributes: VertexAttributeMode,
): Record<string, string> {
  const defines: Record<string, string> = {};
  if (textureMode === 'atlas') defines[GLSL_DEFINE.atlas] = '1';
  if (vertexAttributes === 'float') defines[GLSL_DEFINE.vertexFloat] = '1';
  return defines;
}

export interface WorldMaterials {
  readonly regions: Readonly<Record<RegionPass, ShaderMaterial>>;
  readonly sky: ShaderMaterial;
  readonly skyUniforms: SkyUniforms;
  /** Bits das camadas emissivas de `blocos16` (`uEmissiveLayers`). */
  readonly emissiveLayers: IUniform<Int32Array>;
  dispose(): void;
}

export function createWorldMaterials(
  shared: SharedUniforms,
  textures: MutableSharedTextures,
  defines: Readonly<Record<string, string>>,
): WorldMaterials {
  const emissiveLayers: IUniform<Int32Array> = { value: new Int32Array(8) };
  const blockUniforms = {
    ...shared,
    uBlocks: textures.blocks,
    uBlocksAtlas: textures.blocksAtlas,
    uBlocksAtlasSize: textures.blocksAtlasSize,
    uEmissiveLayers: emissiveLayers,
  };
  const region = (pass: RegionPass): ShaderMaterial => {
    const extra: Record<string, string> = {};
    if (pass === 'cutout') extra[GLSL_DEFINE.cutout] = '1';
    if (pass === 'translucent') extra[GLSL_DEFINE.translucent] = '1';
    return new ShaderMaterial({
      name: `blocos-${pass}`,
      glslVersion: GLSL3,
      vertexShader: REGION_VERTEX,
      fragmentShader: REGION_FRAGMENT,
      uniforms: blockUniforms,
      defines: { ...defines, ...extra },
      transparent: pass === 'translucent',
      depthWrite: pass !== 'translucent',
    });
  };
  // Ordem de criação = ordem do three entre programas opacos (ele ordena por material antes da distância).
  const regions = { opaque: region('opaque'), cutout: region('cutout'), translucent: region('translucent') };
  const skyUniforms: SkyUniforms = {
    uZenithColor: { value: new Vector3(0.4, 0.6, 0.85) },
    uStars: { value: 0 },
    uCloudCover: { value: 0.42 },
  };
  const sky = new ShaderMaterial({
    name: 'ceu',
    glslVersion: GLSL3,
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    uniforms: { ...shared, ...skyUniforms },
    side: BackSide,
    depthWrite: false,
  });
  return {
    regions,
    sky,
    skyUniforms,
    emissiveLayers,
    dispose(): void {
      regions.opaque.dispose();
      regions.cutout.dispose();
      regions.translucent.dispose();
      sky.dispose();
    },
  };
}

/** Cubo do céu (8 vértices, faces para fora; o material desenha o lado de dentro). */
export function createSkyMesh(material: ShaderMaterial): Mesh {
  const geometry = new BufferGeometry();
  const p = new Float32Array(24);
  for (let i = 0; i < 8; i++) {
    p[i * 3] = i & 1 ? 1 : -1;
    p[i * 3 + 1] = i & 2 ? 1 : -1;
    p[i * 3 + 2] = i & 4 ? 1 : -1;
  }
  geometry.setAttribute('position', new BufferAttribute(p, 3));
  geometry.setIndex([
    1, 3, 7, 1, 7, 5, 0, 4, 6, 0, 6, 2, 2, 6, 7, 2, 7, 3, 0, 1, 5, 0, 5, 4, 4, 5, 7, 4, 7, 6, 0, 2, 3, 0, 3, 1,
  ]);
  geometry.boundingSphere = new Sphere(new Vector3(), Math.sqrt(3));
  const mesh = new Mesh(geometry, material);
  mesh.name = 'ceu';
  mesh.renderOrder = SKY_RENDER_ORDER;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/**
 * Uma malha degenerada por material de região (1 triângulo no vértice compacto): o aquecimento compila e usa os 3
 * programas de bloco mesmo sem mapa carregado (tela de loading antes do mapa, ou o bench sem o Construto).
 */
export function createWarmupMeshes(
  regions: Readonly<Record<RegionPass, ShaderMaterial>>,
  mode: VertexAttributeMode,
): Mesh[] {
  const out: Mesh[] = [];
  for (const pass of ['opaque', 'cutout', 'translucent'] as const) {
    const geometry = new BufferGeometry();
    const buffer = new InterleavedBuffer(new Uint16Array(18), 6);
    const Attr = mode === 'int' ? IntegerInterleavedAttribute : InterleavedBufferAttribute;
    geometry.setAttribute('aPos', new Attr(buffer, 3, 0, false));
    geometry.setAttribute('aData', new Attr(buffer, 3, 3, false));
    geometry.setIndex([0, 1, 2]);
    geometry.boundingSphere = new Sphere(new Vector3(), 1);
    const mesh = new Mesh(geometry, regions[pass]);
    mesh.name = `aquecimento ${pass}`;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    out.push(mesh);
  }
  return out;
}
