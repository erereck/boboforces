import type { GraphicsSurface } from '@boboforces/platform-api';
import type { Unsubscribe } from '@boboforces/shared';
import type { DrawList, UiAtlasImage } from '@boboforces/ui';
import { BLOCK_SIZE, POSITION_STEPS_PER_CELL, type MeshArrays, type MeshPass } from '@boboforces/world';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataArrayTexture,
  DynamicDrawUsage,
  GLSL3,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  NearestFilter,
  NearestMipmapLinearFilter,
  NoColorSpace,
  PerspectiveCamera,
  REVISION,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
  WebGLRenderer,
  type IUniform,
} from 'three';
import {
  ACTOR_EXTRA_COMPONENTS,
  createActorInstanceArrays,
  writeActorInstances,
  type ActorInstanceArrays,
} from './actor-instances.ts';
import { FOG_START_FRACTION, INITIAL_ACTOR_CAPACITY, MAX_SHADER_PROGRAMS } from './limits.ts';
import { ACTOR_FRAGMENT, ACTOR_VERTEX, BLOCK_FRAGMENT, BLOCK_VERTEX } from './shaders.ts';
import { SKY_PRESETS } from './sky.ts';
import { assertTextureArray } from './texture-data.ts';
import type {
  ActorBuffer,
  Renderer,
  RendererOptions,
  RenderStats,
  RenderWorld,
  SkyParams,
  TextureArrayData,
  ViewDesc,
} from './types.ts';
import type { UiPass, UiPassFactory } from './ui-pass.ts';
import { bufferScale, createGlRect, surfaceRectToGl } from './viewport.ts';

/** Revisão do three embutida (vai no relatório de diagnóstico). */
export const THREE_REVISION = REVISION;

/** Escala do vértice compacto até metros: 1/16 de célula × 0,5 m = 1/32 m. */
const POSITION_TO_METERS = BLOCK_SIZE / POSITION_STEPS_PER_CELL;
const PASSES: readonly MeshPass[] = ['opaque', 'cutout', 'translucent'];

/** Uniforms de luz e fog: objetos `{ value }` divididos por todos os materiais (atualizar um atualiza todos). */
interface LightUniforms {
  readonly uSunDir: IUniform<Vector3>;
  readonly uSunColor: IUniform<Vector3>;
  readonly uSkyColor: IUniform<Vector3>;
  readonly uGroundColor: IUniform<Vector3>;
  readonly uEmissiveColor: IUniform<Vector3>;
  readonly uFogColor: IUniform<Vector3>;
  readonly uFogNear: IUniform<number>;
  readonly uFogFar: IUniform<number>;
}

function createLightUniforms(): LightUniforms {
  return {
    uSunDir: { value: new Vector3(0, 1, 0) },
    uSunColor: { value: new Vector3() },
    uSkyColor: { value: new Vector3() },
    uGroundColor: { value: new Vector3() },
    uEmissiveColor: { value: new Vector3() },
    uFogColor: { value: new Vector3() },
    uFogNear: { value: 60 },
    uFogFar: { value: 140 },
  };
}

/**
 * Cores em 0xRRGGBB vão para o shader como estão (/255), sem a conversão sRGB→linear do ColorManagement: as texturas
 * pixel-art também não são convertidas, então luz, textura e fog falam o mesmo espaço e o hex do design aparece igual.
 */
function setRgb(out: Vector3, rgb: number, scale = 1): void {
  out.set((((rgb >> 16) & 0xff) / 255) * scale, (((rgb >> 8) & 0xff) / 255) * scale, ((rgb & 0xff) / 255) * scale);
}

function applySky(u: LightUniforms, sky: SkyParams, clear: Color): void {
  u.uSunDir.value.set(sky.sunDirX, sky.sunDirY, sky.sunDirZ).normalize();
  setRgb(u.uSunColor.value, sky.sunColor);
  setRgb(u.uSkyColor.value, sky.skyColor);
  // Chão do hemisfério: o próprio céu mais escuro (faces de baixo e laterais ficam um pouco mais frias e escuras).
  setRgb(u.uGroundColor.value, sky.skyColor, 0.7);
  setRgb(u.uEmissiveColor.value, sky.emissiveColor);
  setRgb(u.uFogColor.value, sky.fogColor);
  // Sem programa de céu no M0: o fundo é a cor da fog (o mapa se dissolve no horizonte).
  clear.setHex(sky.fogColor);
}

function createBlockTexture(data: TextureArrayData): DataArrayTexture {
  assertTextureArray(data);
  const texture = new DataArrayTexture(data.levels[0]!, data.width, data.height, data.layers);
  texture.format = RGBAFormat;
  texture.type = UnsignedByteType;
  texture.colorSpace = NoColorSpace;
  texture.magFilter = NearestFilter;
  // Mip com nearest dentro do nível e linear entre níveis: o pixel-art não cintila ao longe (tecnico.md §6.1).
  texture.minFilter = NearestMipmapLinearFilter;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  // M0: mips por `generateMipmap` (atalho permitido para camadas opacas). Os níveis extras de `levels` (mips do texgen,
  // com cobertura de alfa para cutout) entram quando houver camada cutout, no M1.
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function createBlockMaterial(texture: DataArrayTexture, light: LightUniforms, pass: MeshPass): ShaderMaterial {
  return new ShaderMaterial({
    name: `blocos-${pass}`,
    glslVersion: GLSL3,
    vertexShader: BLOCK_VERTEX,
    fragmentShader: BLOCK_FRAGMENT,
    uniforms: { uBlocks: { value: texture }, ...light },
    defines: pass === 'cutout' ? { CUTOUT: 1 } : pass === 'translucent' ? { TRANSLUCENT: 1 } : {},
    transparent: pass === 'translucent',
    depthWrite: pass !== 'translucent',
  });
}

function createChunkGeometry(arrays: MeshArrays): BufferGeometry {
  const geometry = new BufferGeometry();
  // u16 e u8 sem normalizar: o GL converte para float (vertexAttribPointer), o caminho mais compatível [T0: IntType].
  geometry.setAttribute('position', new BufferAttribute(arrays.positions.subarray(0, arrays.vertexCount * 3), 3));
  geometry.setAttribute('aAttr', new BufferAttribute(arrays.attributes.subarray(0, arrays.vertexCount * 4), 4));
  geometry.setIndex(new BufferAttribute(arrays.indices.subarray(0, arrays.indexCount), 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** Caixa 1×1×1 com a base em y = 0; `frontShade` escurece a face -Z (a frente com yaw 0). */
function createActorBox(frontShade: number): BufferGeometry {
  const geometry = new BoxGeometry(1, 1, 1);
  geometry.translate(0, 0.5, 0);
  const shade = new Float32Array(geometry.getAttribute('position').count).fill(1);
  // BoxGeometry gera as faces na ordem +X, -X, +Y, -Y, +Z, -Z, com 4 vértices cada.
  shade.fill(frontShade, 20, 24);
  geometry.setAttribute('aShade', new BufferAttribute(shade, 1));
  return geometry;
}

interface ActorMeshes {
  readonly arrays: ActorInstanceArrays;
  readonly body: InstancedMesh;
  readonly head: InstancedMesh;
}

function dynamicInstanced(array: Float32Array, size: number): InstancedBufferAttribute {
  const attribute = new InstancedBufferAttribute(array, size);
  attribute.setUsage(DynamicDrawUsage);
  return attribute;
}

function createActorMeshes(capacity: number, material: ShaderMaterial): ActorMeshes {
  const arrays = createActorInstanceArrays(capacity);
  const extra = dynamicInstanced(arrays.extra, ACTOR_EXTRA_COMPONENTS);
  const make = (matrices: Float32Array, colors: Float32Array, frontShade: number, name: string): InstancedMesh => {
    const geometry = createActorBox(frontShade);
    geometry.setAttribute('aExtra', extra);
    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.name = name;
    mesh.instanceMatrix = dynamicInstanced(matrices, 16);
    mesh.instanceColor = dynamicInstanced(colors, 3);
    mesh.count = 0;
    // Poucos atores e matrizes novas todo frame: culling por instância custaria mais que desenhar.
    mesh.frustumCulled = false;
    return mesh;
  };
  return {
    arrays,
    body: make(arrays.bodyMatrix, arrays.bodyColor, 0.85, 'atores-corpo'),
    head: make(arrays.headMatrix, arrays.headColor, 0.45, 'atores-cabeca'),
  };
}

function disposeActorMeshes(a: ActorMeshes): void {
  // Os dois InstancedMesh dividem o atributo `aExtra`; dispose duas vezes é inofensivo no three.
  a.body.geometry.dispose();
  a.head.geometry.dispose();
  a.body.dispose();
  a.head.dispose();
  a.body.removeFromParent();
  a.head.removeFromParent();
}

/**
 * Sobe o atributo inteiro, SEM faixa de upload (regra 11): no three cada `addUpdateRange` cria um objeto
 * `{ start, count }` e o upload ordena a lista com uma closure nova. A capacidade dos atores é pequena (72 instâncias ≈
 * 11 KB nos 5 atributos), então o `bufferSubData` do buffer todo sai mais barato que o lixo por frame.
 */
function markUpdated(attribute: InstancedBufferAttribute): void {
  attribute.needsUpdate = true;
}

function updateInstances(mesh: InstancedMesh, count: number): void {
  mesh.count = count;
  markUpdated(mesh.instanceMatrix);
  if (mesh.instanceColor) markUpdated(mesh.instanceColor);
}

type MutableStats = { -readonly [K in keyof RenderStats]: RenderStats[K] };

/**
 * Cria o renderer three (só `WebGLRenderer`, WebGL2 puro, no máximo 7 programas) sobre a superfície da plataforma.
 * Recebe canvas + contexto já criados pela casca: é a costura do shim do nx.js (tecnico.md §6.11). Nunca usar
 * `TextureLoader`/`ImageLoader` (dependem de `document`): texturas chegam como `TextureArrayData`.
 *
 * - O contexto é da casca: `antialias` e `alpha` valem o que ela pediu no `getContext` (o three não recria o contexto).
 * - `ViewDesc` e `DrawList` falam em px da superfície (`surface.width/height`); se o teto de DPR encolher o drawing
 *   buffer, o render converte. O CSS do canvas é da casca (o render nunca mexe em `style`).
 * - `createUiPass` liga o programa de UI (`src/ui/`); sem ele, `drawUi` só não desenha nada.
 */
export function createRenderer(
  surface: GraphicsSurface,
  options: RendererOptions = {},
  createUiPass: UiPassFactory | null = null,
): Renderer {
  const maxPixelRatio = options.maxPixelRatio ?? 2;
  const three = new WebGLRenderer({
    canvas: surface.canvas as HTMLCanvasElement,
    context: surface.context as WebGLRenderingContext,
    antialias: options.antialias ?? false,
    alpha: false,
    stencil: false,
    preserveDrawingBuffer: false,
  });
  three.autoClear = false;
  three.info.autoReset = false;
  three.setPixelRatio(1);

  const scene = new Scene();
  scene.matrixWorldAutoUpdate = true;
  const worldGroup = new Group();
  worldGroup.name = 'mundo';
  const actorGroup = new Group();
  actorGroup.name = 'atores';
  scene.add(worldGroup, actorGroup);

  const camera = new PerspectiveCamera(70, 16 / 9, 0.05, 140);
  camera.rotation.order = 'YXZ';

  const light = createLightUniforms();
  const clearColor = new Color();
  applySky(light, SKY_PRESETS.day, clearColor);

  const hideSlot: IUniform<number> = { value: -1 };
  const actorMaterial = new ShaderMaterial({
    name: 'instanciado',
    glslVersion: GLSL3,
    vertexShader: ACTOR_VERTEX,
    fragmentShader: ACTOR_FRAGMENT,
    uniforms: { ...light, uHideSlot: hideSlot },
  });
  let actors = createActorMeshes(INITIAL_ACTOR_CAPACITY, actorMaterial);
  actorGroup.add(actors.body, actors.head);

  // Mundo atual (malhas, texture array e materiais de bloco), liberado inteiro em `setWorld`.
  let blockTexture: DataArrayTexture | null = null;
  let blockMaterials: ShaderMaterial[] = [];
  const chunkMeshes: Mesh[] = [];

  const uiPass: UiPass | null = createUiPass ? createUiPass(three) : null;

  const stats: MutableStats = { drawCalls: 0, triangles: 0, programs: 0, viewports: 0, textures: 0, geometries: 0 };
  let warnedPrograms = false;
  const rect = createGlRect();
  const uiTarget = { x: 0, y: 0, width: 0, height: 0, scale: 1 };

  // Tamanho da superfície (px que ViewDesc e DrawList usam) e do drawing buffer (com o teto de DPR).
  let surfaceWidth = 0;
  let surfaceHeight = 0;
  let scale = 1;
  let bufferWidth = 0;
  let bufferHeight = 0;
  let disposed = false;

  function resize(width: number, height: number, pixelRatio: number): void {
    if (disposed) return;
    surfaceWidth = Math.max(1, Math.floor(width));
    surfaceHeight = Math.max(1, Math.floor(height));
    scale = bufferScale(pixelRatio, maxPixelRatio);
    const w = Math.max(1, Math.floor(surfaceWidth * scale));
    const h = Math.max(1, Math.floor(surfaceHeight * scale));
    if (w === bufferWidth && h === bufferHeight) return;
    bufferWidth = w;
    bufferHeight = h;
    three.setSize(w, h, false);
  }

  resize(surface.width, surface.height, surface.pixelRatio);
  const unsubscribeResize: Unsubscribe = surface.onResize(resize);

  function refreshStats(): void {
    stats.drawCalls = three.info.render.calls;
    stats.triangles = three.info.render.triangles;
    stats.programs = three.info.programs?.length ?? 0;
    stats.textures = three.info.memory.textures;
    stats.geometries = three.info.memory.geometries;
    if (stats.programs > MAX_SHADER_PROGRAMS && !warnedPrograms) {
      warnedPrograms = true;
      console.warn(`render: ${stats.programs} programas de shader (teto ${MAX_SHADER_PROGRAMS}, regra 8)`);
    }
  }

  function disposeWorld(): void {
    for (const mesh of chunkMeshes) mesh.geometry.dispose();
    chunkMeshes.length = 0;
    worldGroup.clear();
    for (const material of blockMaterials) material.dispose();
    blockMaterials = [];
    blockTexture?.dispose();
    blockTexture = null;
  }

  function setupCamera(view: ViewDesc): void {
    const c = view.camera;
    camera.position.set(c.x, c.y, c.z);
    camera.rotation.set(c.pitch, c.yaw, 0);
    camera.fov = (c.fovY * 180) / Math.PI;
    camera.aspect = view.width / Math.max(1, view.height);
    camera.near = c.near;
    camera.far = c.far;
    camera.updateProjectionMatrix();
    light.uFogFar.value = c.far;
    light.uFogNear.value = c.far * FOG_START_FRACTION;
  }

  const renderer: Renderer = {
    resize,

    setWorld(world: RenderWorld | null): void {
      if (disposed) return;
      disposeWorld();
      if (world === null) {
        refreshStats();
        return;
      }
      const texture = createBlockTexture(world.blockTextures);
      blockTexture = texture;
      const materials = new Map<MeshPass, ShaderMaterial>();
      for (const chunk of world.chunks) {
        const mesh = chunk.mesh;
        for (const pass of PASSES) {
          const arrays = mesh[pass];
          if (arrays.indexCount === 0) continue;
          let material = materials.get(pass);
          if (!material) {
            material = createBlockMaterial(texture, light, pass);
            materials.set(pass, material);
          }
          const object = new Mesh(createChunkGeometry(arrays), material);
          object.name = `chunk ${chunk.cx},${chunk.cy},${chunk.cz} ${pass}`;
          object.position.set(mesh.originX * BLOCK_SIZE, mesh.originY * BLOCK_SIZE, mesh.originZ * BLOCK_SIZE);
          object.scale.setScalar(POSITION_TO_METERS);
          // Cenário estático (decisão #4): matriz calculada uma vez.
          object.matrixAutoUpdate = false;
          object.updateMatrix();
          worldGroup.add(object);
          chunkMeshes.push(object);
        }
      }
      blockMaterials = [...materials.values()];
      applySky(light, world.sky, clearColor);
      // Compila e aquece os programas agora (tela de loading), não no primeiro frame da partida: o Switch não tem
      // KHR_parallel_shader_compile (tecnico.md §6.5).
      three.compile(scene, camera);
      refreshStats();
    },

    setActors(buffer: ActorBuffer): void {
      if (disposed) return;
      if (buffer.count > actors.arrays.capacity) {
        disposeActorMeshes(actors);
        actors = createActorMeshes(Math.max(buffer.count, buffer.capacity), actorMaterial);
        actorGroup.add(actors.body, actors.head);
      }
      const n = writeActorInstances(buffer, actors.arrays);
      updateInstances(actors.body, n);
      updateInstances(actors.head, n);
      markUpdated(actors.body.geometry.getAttribute('aExtra') as InstancedBufferAttribute);
    },

    renderViews(views: readonly ViewDesc[]): void {
      if (disposed) return;
      three.info.reset();
      three.setClearColor(clearColor, 1);
      three.setScissorTest(true);
      let drawn = 0;
      for (const view of views) {
        surfaceRectToGl(view.x, view.y, view.width, view.height, scale, bufferHeight, rect);
        if (rect.width <= 0 || rect.height <= 0) continue;
        three.setViewport(rect.x, rect.y, rect.width, rect.height);
        three.setScissor(rect.x, rect.y, rect.width, rect.height);
        three.clear(true, true, false);
        setupCamera(view);
        hideSlot.value = !view.thirdPerson && view.localSlot >= 0 ? view.localSlot : -1;
        three.render(scene, camera);
        drawn++;
      }
      three.setScissorTest(false);
      stats.viewports = drawn;
      refreshStats();
    },

    drawUi(list: DrawList, viewport?: ViewDesc): void {
      if (disposed || uiPass === null) return;
      if (viewport) surfaceRectToGl(viewport.x, viewport.y, viewport.width, viewport.height, scale, bufferHeight, rect);
      else surfaceRectToGl(0, 0, surfaceWidth, surfaceHeight, scale, bufferHeight, rect);
      if (rect.width <= 0 || rect.height <= 0) return;
      three.setViewport(rect.x, rect.y, rect.width, rect.height);
      three.setScissor(rect.x, rect.y, rect.width, rect.height);
      three.setScissorTest(true);
      uiTarget.x = rect.x;
      uiTarget.y = rect.y;
      uiTarget.width = rect.width;
      uiTarget.height = rect.height;
      uiTarget.scale = scale;
      uiPass.draw(list, uiTarget);
      three.setScissorTest(false);
      refreshStats();
    },

    setUiAtlas(atlas: UiAtlasImage | null): void {
      if (disposed) return;
      uiPass?.setAtlas?.(atlas);
    },

    get stats(): RenderStats {
      return stats;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribeResize();
      disposeWorld();
      disposeActorMeshes(actors);
      actorMaterial.dispose();
      uiPass?.dispose();
      scene.clear();
      // Libera programas, buffers e texturas do three; o contexto GL continua sendo da casca.
      three.dispose();
    },
  };
  return renderer;
}
