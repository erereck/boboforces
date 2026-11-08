// O renderer three do M1 (frente render-mundo): dono do `WebGLRenderer`, da cena única, dos 4 programas do mundo e do
// laço por vista (tecnico.md §6.8, contrato interno em `shared/passes.ts`). Os passes de atores e VFX (render-atores) e
// o de UI chegam por fábrica: `renderer.ts` liga as fábricas de verdade; a bancada de validação no Edge liga falsos.
//
// Por frame (`renderViews`): ambiente já nos uniforms (`setEnvironment`) → retângulo, câmera e frustum de TODAS as
// vistas, copiados em `frame.views` (#56: a animação dos bonecos escolhe o LOD por eles) → `update` dos passes 1x →
// por vista: viewport + scissor + clear → fog da vista (câmera e frustum já prontos) → culling das regiões →
// `beforeView` dos passes → UM `three.render` (opacos de frente para trás por programa, cutout, instanciados, céu só
// onde nada cobriu, translúcidos e partículas de trás para a frente) → `afterView` (viewmodel, clarão) → HUD da vista →
// estatísticas.
import type { GraphicsSurface } from '@boboforces/platform-api';
import type { Unsubscribe } from '@boboforces/shared';
import { createDrawList, pushRect, resetDrawList, type DrawList, type UiAtlasImage } from '@boboforces/ui';
import {
  PLATFORM_PROFILES,
  type FigureGameTable,
  type FigureTemplateSet,
  type ModelDocument,
} from '@boboforces/format';
import { NO_SLOT } from './actors/layout.ts';
import {
  Color,
  Frustum,
  getConsoleFunction,
  Matrix4,
  PerspectiveCamera,
  REVISION,
  Scene,
  setConsoleFunction,
  WebGLRenderer,
  type BufferAttribute,
  type BufferGeometry,
  type InterleavedBufferAttribute,
  type Object3D,
  type Vector3,
} from 'three';
import { createEnvironment, TIME_OF_DAY_PRESETS, type EnvironmentState, type TimeOfDayParams } from './environment.ts';
import {
  buildGradeLut,
  channel01,
  emissiveLayerBits,
  fogRange,
  GRADE_LUT_SIZE,
  type FogRange,
} from './environment-data.ts';
import type { FxQueue } from './fx-queue.ts';
import { MAX_SHADER_PROGRAMS } from './limits.ts';
import { createRegionSet, type RegionSet } from './region-meshes.ts';
import {
  createFrameViews,
  FRAME_VIEW_PLANE_FLOATS,
  FRAME_VIEWS_MAX,
  type ActorPass,
  type ActorPassFactory,
  type FrameContext,
  type FxPass,
  type FxPassFactory,
  type PassContext,
  type ViewContext,
} from './shared/passes.ts';
import { createGpuTextures } from './texture-gpu.ts';
import {
  createRenderDebug,
  createViewDesc,
  type ActorBuffer,
  type RenderDebug,
  type Renderer,
  type RendererOptions,
  type RenderInfo,
  type RenderMap,
  type RenderMemory,
  type RenderStats,
  type RenderTextures,
  type ViewDesc,
  type ViewStats,
} from './types.ts';
import type { UiPass, UiPassFactory } from './ui-pass.ts';
import { bufferScale, createGlRect, surfaceRectToGl, type GlRect } from './viewport.ts';
import {
  createSharedTextures,
  createSharedUniforms,
  createSkyMesh,
  createWarmupMeshes,
  createWorldMaterials,
  creationDefines,
} from './world-materials.ts';

/** Até 4 vistas por frame (tela dividida, tecnico.md §6.8); o número mora no `shared/passes.ts` (`FrameViews`). */
export const MAX_VIEWS = FRAME_VIEWS_MAX;
/** Teto de avisos do three guardados em `info.warnings` (item 3 do T0) e tamanho máximo de cada um. */
const MAX_WARNINGS = 64;
const MAX_WARNING_CHARS = 600;
/** Teto padrão de cubinhos (`RendererOptions.maxDebris`; perfil celular/Switch). */
const DEFAULT_MAX_DEBRIS = 200;
/** LOD padrão dos bonecos até o `game` passar o do perfil (`setFigureLod`): o do Switch 1P, como os detritos. */
const DEFAULT_FIGURE_NEAR_M = PLATFORM_PROFILES.switch1p.figureNearM;
const DEFAULT_FIGURE_HALF_RATE = PLATFORM_PROFILES.switch1p.figureHalfRate;
/** Floats por vista em `FrameViews.planes`: 6 planos × (nx, ny, nz, d). */
const PLANE_FLOATS = FRAME_VIEW_PLANE_FLOATS;

/** Copia os 6 planos do frustum (normal e constante do three) em out[o .. o+24). */
function copyPlanes(frustum: Frustum, out: Float32Array, o: number): void {
  for (let p = 0; p < 6; p++) {
    const plane = frustum.planes[p]!;
    const k = o + p * 4;
    out[k] = plane.normal.x;
    out[k + 1] = plane.normal.y;
    out[k + 2] = plane.normal.z;
    out[k + 3] = plane.constant;
  }
}

/** Vista sem área (não desenhada): planos que rejeitam todo ponto (n = 0, d = −1). */
function rejectAllPlanes(out: Float32Array, o: number): void {
  for (let p = 0; p < 6; p++) {
    const k = o + p * 4;
    out[k] = 0;
    out[k + 1] = 0;
    out[k + 2] = 0;
    out[k + 3] = -1;
  }
}

/** As fábricas dos passes que vivem dentro do laço (render-atores). */
export interface RenderPassFactories {
  readonly actors: ActorPassFactory;
  readonly fx: FxPassFactory;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Limites do GL que vão no relatório do bench e nas linhas [t0] (itens 2, 4, 6 e 11). */
const GL_LIMIT_NAMES = [
  'MAX_TEXTURE_SIZE',
  'MAX_ARRAY_TEXTURE_LAYERS',
  'MAX_3D_TEXTURE_SIZE',
  'MAX_TEXTURE_IMAGE_UNITS',
  'MAX_VERTEX_TEXTURE_IMAGE_UNITS',
  'MAX_COMBINED_TEXTURE_IMAGE_UNITS',
  'MAX_VERTEX_ATTRIBS',
  'MAX_VERTEX_UNIFORM_VECTORS',
  'MAX_FRAGMENT_UNIFORM_VECTORS',
  'MAX_VARYING_VECTORS',
  'MAX_SAMPLES',
  'MAX_RENDERBUFFER_SIZE',
  'MAX_ELEMENT_INDEX',
] as const;

function readGlLimits(gl: WebGL2RenderingContext): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of GL_LIMIT_NAMES) {
    // Um shim (nx.js) pode não ter a constante ou o parâmetro: o limite só fica de fora do relatório.
    const pname = gl[name] as number | undefined;
    if (typeof pname !== 'number') continue;
    try {
      const value: unknown = gl.getParameter(pname);
      if (typeof value === 'number') out[name] = value;
    } catch {
      // segue sem este limite
    }
  }
  out['DRAWING_BUFFER_WIDTH'] = gl.drawingBufferWidth;
  out['DRAWING_BUFFER_HEIGHT'] = gl.drawingBufferHeight;
  return out;
}

/** Cor 0xRRGGBB → vetor 0..1 sem conversão (textura, luz e fog falam o mesmo espaço, como no M0). */
function setRgb(out: Vector3, rgb: number): void {
  out.set(channel01(rgb, 0), channel01(rgb, 1), channel01(rgb, 2));
}

function createViewStats(): Mutable<ViewStats> {
  return { drawCalls: 0, triangles: 0, regions: 0, propGroups: 0, actors: 0, actorDraws: 0 };
}

interface Passes {
  readonly actors: ActorPass;
  readonly fx: FxPass;
}

export function createRendererCore(
  surface: GraphicsSurface,
  options: RendererOptions,
  createUiPass: UiPassFactory | null,
  factories: RenderPassFactories,
): Renderer {
  const maxPixelRatio = options.maxPixelRatio ?? 2;
  const textureMode = options.textureMode ?? 'array';
  const vertexAttributes = options.vertexAttributes ?? 'int';

  // Avisos e erros do three (extensão ausente, erro de shader) desde a criação: item 3 do Teste Zero.
  const warnings: string[] = [];
  const previousConsole = getConsoleFunction();
  setConsoleFunction((type, message, ...params) => {
    if (type !== 'log' && warnings.length < MAX_WARNINGS) {
      const extra = params.filter((p): p is string => typeof p === 'string').join(' ');
      warnings.push(`${type}: ${message}${extra ? ` ${extra}` : ''}`.slice(0, MAX_WARNING_CHARS));
    }
    if (previousConsole) previousConsole(type, message, ...params);
    else if (type === 'error') console.error(message, ...params);
    else if (type === 'warn') console.warn(message, ...params);
    else console.log(message, ...params);
  });

  const three = new WebGLRenderer({
    canvas: surface.canvas as HTMLCanvasElement,
    context: surface.context as WebGL2RenderingContext,
    antialias: options.antialias ?? false,
    alpha: false,
    stencil: false,
    preserveDrawingBuffer: false,
  });
  three.autoClear = false;
  three.info.autoReset = false;
  three.setPixelRatio(1);
  const gl = three.getContext() as WebGL2RenderingContext;

  const scene = new Scene();
  scene.name = 'cena';

  // --- uniforms e texturas divididos com os passes ---
  const { uniforms: shared, lut } = createSharedUniforms();
  const lutData = lut.image.data as Uint8Array;
  const sharedTextures = createSharedTextures();
  const defines = creationDefines(textureMode, vertexAttributes);
  const gpuTextures = createGpuTextures(three, textureMode, sharedTextures);
  const materials = createWorldMaterials(shared, sharedTextures, defines);
  const sky = createSkyMesh(materials.sky);
  sky.visible = false;
  const warmMeshes = createWarmupMeshes(materials.regions, vertexAttributes);
  scene.add(sky, ...warmMeshes);

  const uiPass: UiPass | null = createUiPass ? createUiPass(three) : null;
  let uiAtlasBytes = 0;

  // --- estado ---
  const env: EnvironmentState = createEnvironment();
  /** Teto de detritos: o da criação até o `game` passar o do perfil da cena (`setDebrisBudget`). */
  let debrisBudget = options.maxDebris ?? DEFAULT_MAX_DEBRIS;
  // Bonecos (#56): guardados aqui e repassados quando os passes nascem (o `game` pode chamar antes deles).
  let figureTemplates: FigureTemplateSet | null = null;
  let figureTable: FigureGameTable | null = null;
  let figureNearM = DEFAULT_FIGURE_NEAR_M;
  let figureHalfRate = DEFAULT_FIGURE_HALF_RATE;
  let appliedTime: TimeOfDayParams | null = null;
  const horizon = new Color();
  const debug: RenderDebug = createRenderDebug();
  let regions: RegionSet | null = null;
  let map: RenderMap | null = null;
  let passes: Passes | null = null;
  let lastFrameTimeS = -1;
  const frame: Mutable<FrameContext> = { dt: 0, timeS: 0, debug, world: null, views: createFrameViews() };
  const fog: FogRange = { near: 40, far: 90 };

  // Por vista: câmera, frustum, retângulo e contexto dos passes (criados uma vez; nada se aloca no laço).
  const cameras: PerspectiveCamera[] = [];
  const frustums: Frustum[] = [];
  const rects: GlRect[] = [];
  const contexts: Mutable<ViewContext>[] = [];
  const warmView = createViewDesc();
  for (let i = 0; i < MAX_VIEWS; i++) {
    const camera = new PerspectiveCamera(70, 16 / 9, 0.05, 140);
    camera.rotation.order = 'YXZ';
    const frustum = new Frustum();
    const rect = createGlRect();
    cameras.push(camera);
    frustums.push(frustum);
    rects.push(rect);
    contexts.push({ index: i, view: warmView, camera, frustum, rect, debug });
  }
  const projScreen = new Matrix4();

  const viewStatsPool: Mutable<ViewStats>[] = [];
  for (let i = 0; i < MAX_VIEWS; i++) viewStatsPool.push(createViewStats());
  // Uma lista pronta por quantidade de vistas: `stats.views` troca de lista sem alocar.
  const viewLists: (readonly ViewStats[])[] = [];
  for (let n = 0; n <= MAX_VIEWS; n++) viewLists.push(viewStatsPool.slice(0, n));

  const stats: Mutable<RenderStats> = {
    drawCalls: 0,
    triangles: 0,
    programs: 0,
    viewports: 0,
    textures: 0,
    geometries: 0,
    views: viewLists[0]!,
    gpuMs: -1,
    figureL0: 0,
    figureL1: 0,
    figureL2: 0,
    figureOverflow: 0,
  };
  const info: RenderInfo = {
    threeRevision: REVISION,
    textureMode,
    vertexAttributes,
    glLimits: readGlLimits(gl),
    warnings,
  };
  const memory: Mutable<RenderMemory> = { textureBytes: 0, worldMeshBytes: 0, instanceBytes: 0, otherBytes: 0 };
  let warnedPrograms = false;
  const uiTarget = { x: 0, y: 0, width: 0, height: 0, scale: 1 };
  const uiRect = createGlRect();
  const warmList: DrawList = createDrawList(4);

  // Tamanho da superfície (px de ViewDesc/DrawList) e do drawing buffer (com o teto de DPR).
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

  /** Hora do dia, sol, clarão, vento e relógio nos uniforms comuns (só números; a LUT só muda com a hora do dia). */
  function applyEnvironment(): void {
    const preset = TIME_OF_DAY_PRESETS[env.timeOfDay] ?? TIME_OF_DAY_PRESETS.day;
    if (preset !== appliedTime) {
      appliedTime = preset;
      setRgb(shared.uSunColor.value, preset.sunColor);
      setRgb(shared.uSkyLightColor.value, preset.skyLightColor);
      setRgb(shared.uGroundColor.value, preset.groundColor);
      setRgb(shared.uEmissiveColor.value, preset.emissiveColor);
      setRgb(shared.uFogColor.value, preset.horizonColor);
      setRgb(materials.skyUniforms.uZenithColor.value, preset.zenithColor);
      shared.uSunStrength.value = preset.sunStrength;
      shared.uSkyStrength.value = preset.skyStrength;
      shared.uGradeStrength.value = preset.gradeStrength;
      materials.skyUniforms.uStars.value = preset.stars;
      horizon.setHex(preset.horizonColor);
      buildGradeLut(preset, lutData);
      lut.needsUpdate = true;
    }
    const len = Math.hypot(env.sunDirX, env.sunDirY, env.sunDirZ);
    if (len > 1e-6) shared.uSunDir.value.set(env.sunDirX / len, env.sunDirY / len, env.sunDirZ / len);
    shared.uTime.value = env.timeS;
    shared.uFlash.value = Math.max(0, Math.min(1, env.flash));
    shared.uWind.value = Math.max(0, Math.min(1, env.wind));
  }
  applyEnvironment();

  function ensurePasses(): Passes {
    if (passes) return passes;
    const ctx: PassContext = {
      three,
      textureMode,
      vertexAttributes,
      defines,
      scene,
      uniforms: shared,
      textures: sharedTextures,
    };
    const actors = factories.actors(ctx);
    let fx: FxPass;
    try {
      fx = factories.fx(ctx);
    } catch (error) {
      actors.dispose();
      throw error;
    }
    fx.setDebrisBudget(debrisBudget);
    actors.setFigureLod(figureNearM, figureHalfRate);
    actors.setFigures(figureTemplates, figureTable);
    fx.setFigures(figureTemplates);
    passes = { actors, fx };
    return passes;
  }

  /** Câmera de uma vista (convenção do shared: yaw 0 olha para -Z, pitch + para cima; Hor+ já vem no `fovY`). */
  function setupCamera(camera: PerspectiveCamera, view: ViewDesc): void {
    const c = view.camera;
    camera.position.set(c.x, c.y, c.z);
    camera.rotation.set(c.pitch, c.yaw, 0);
    camera.fov = (c.fovY * 180) / Math.PI;
    camera.aspect = view.width / Math.max(1, view.height);
    camera.near = c.near;
    camera.far = c.far;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  function setFrustum(camera: PerspectiveCamera, frustum: Frustum): void {
    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);
  }

  function applyRect(rect: GlRect): void {
    three.setViewport(rect.x, rect.y, rect.width, rect.height);
    three.setScissor(rect.x, rect.y, rect.width, rect.height);
    three.setScissorTest(true);
  }

  function drawListIn(list: DrawList, rect: GlRect): void {
    if (!uiPass) return;
    applyRect(rect);
    uiTarget.x = rect.x;
    uiTarget.y = rect.y;
    uiTarget.width = rect.width;
    uiTarget.height = rect.height;
    uiTarget.scale = scale;
    uiPass.draw(list, uiTarget);
  }

  // --- memória (F2 e bench; fora do laço quente) ---
  const seenBuffers = new Set<unknown>();
  let instanceBytes = 0;
  let otherBytes = 0;
  function countAttribute(attribute: BufferAttribute | InterleavedBufferAttribute): void {
    const isInterleaved = (attribute as InterleavedBufferAttribute).isInterleavedBufferAttribute === true;
    const array = isInterleaved
      ? (attribute as InterleavedBufferAttribute).data.array
      : (attribute as BufferAttribute).array;
    if (seenBuffers.has(array)) return;
    seenBuffers.add(array);
    const instanced = isInterleaved
      ? (attribute as InterleavedBufferAttribute & { data: { isInstancedInterleavedBuffer?: boolean } }).data
          .isInstancedInterleavedBuffer === true
      : (attribute as { isInstancedBufferAttribute?: boolean }).isInstancedBufferAttribute === true;
    if (instanced) instanceBytes += array.byteLength;
    else otherBytes += array.byteLength;
  }
  const visitMemory = (object: Object3D): void => {
    const mesh = object as Object3D & {
      isMesh?: boolean;
      isInstancedMesh?: boolean;
      geometry?: BufferGeometry;
      instanceMatrix?: BufferAttribute;
      instanceColor?: BufferAttribute | null;
    };
    if (mesh.isMesh !== true || !mesh.geometry) return;
    if (regions && object.parent === regions.group) return;
    if (mesh.isInstancedMesh === true) {
      for (const a of [mesh.instanceMatrix, mesh.instanceColor]) {
        if (!a || seenBuffers.has(a.array)) continue;
        seenBuffers.add(a.array);
        instanceBytes += a.array.byteLength;
      }
    }
    const geometry = mesh.geometry;
    for (const name in geometry.attributes) countAttribute(geometry.attributes[name]!);
    if (geometry.index && !seenBuffers.has(geometry.index.array)) {
      seenBuffers.add(geometry.index.array);
      otherBytes += geometry.index.array.byteLength;
    }
  };

  const renderer: Renderer = {
    resize,

    setActors(buffer: ActorBuffer): void {
      if (disposed) return;
      ensurePasses().actors.setActors(buffer);
    },

    renderViews(views: readonly ViewDesc[]): void {
      if (disposed) return;
      const timing = debug.gpuFinish;
      const startMs = timing ? performance.now() : 0;
      gpuTextures.sync();
      three.info.reset();

      // Relógio do frame: o `game` avança `env.timeS` no `setEnvironment` de cada frame (pausado, não anda).
      frame.dt = lastFrameTimeS < 0 ? 0 : Math.max(0, Math.min(0.1, env.timeS - lastFrameTimeS));
      lastFrameTimeS = env.timeS;
      frame.timeS = env.timeS;

      // 1º laço (#56): retângulo, câmera e frustum de TODAS as vistas antes do `update` dos passes, copiados em
      // `frame.views` (a animação dos bonecos escolhe o LOD por eles). As mesmas chamadas de antes, só mais cedo: o
      // laço de desenho reaproveita câmera, frustum e retângulo sem calcular de novo.
      const count = Math.min(views.length, MAX_VIEWS);
      const fv = frame.views;
      fv.count = count;
      for (let i = 0; i < count; i++) {
        const view = views[i]!;
        const rect = rects[i]!;
        surfaceRectToGl(view.x, view.y, view.width, view.height, scale, bufferHeight, rect);
        const c = view.camera;
        fv.eye[i * 3] = c.x;
        fv.eye[i * 3 + 1] = c.y;
        fv.eye[i * 3 + 2] = c.z;
        // Dono = quem a vista esconde (1ª pessoa), a regra do `uHideSlot` do passe dos atores.
        fv.owner[i] = !view.thirdPerson && view.localSlot >= 0 && view.localSlot < NO_SLOT ? view.localSlot : NO_SLOT;
        if (rect.width <= 0 || rect.height <= 0) {
          rejectAllPlanes(fv.planes, i * PLANE_FLOATS);
          continue;
        }
        const camera = cameras[i]!;
        const frustum = frustums[i]!;
        setupCamera(camera, view);
        setFrustum(camera, frustum);
        copyPlanes(frustum, fv.planes, i * PLANE_FLOATS);
      }

      if (passes) {
        passes.actors.update(frame);
        passes.fx.update(frame);
        // #56: bonecos por nível de animação deste frame (o rig conta no `update` dos atores).
        const lod = passes.actors.figureLod;
        stats.figureL0 = lod.l0;
        stats.figureL1 = lod.l1;
        stats.figureL2 = lod.l2;
        stats.figureOverflow = passes.actors.figureOverflow;
      } else {
        stats.figureL0 = 0;
        stats.figureL1 = 0;
        stats.figureL2 = 0;
        stats.figureOverflow = 0;
      }

      three.setClearColor(horizon, 1);
      three.setScissorTest(true);
      let drawn = 0;
      for (let i = 0; i < count; i++) {
        const view = views[i]!;
        const rect = rects[i]!;
        if (rect.width <= 0 || rect.height <= 0) continue;
        applyRect(rect);
        three.clear(true, true, false);

        const camera = cameras[i]!;
        const frustum = frustums[i]!;
        fogRange(view.camera.far, env.viewDistanceM, env.fogStartFraction, fog);
        shared.uFogNear.value = fog.near;
        shared.uFogFar.value = fog.far;
        // Clarão de tiro por vista (arte-ux.md §1.8): o global do ambiente + o desta vista.
        shared.uFlash.value = Math.max(0, Math.min(1, env.flash + view.flash));
        const visibleRegions = regions ? regions.cull(frustum) : 0;

        const ctx = contexts[i]!;
        ctx.view = view;
        const calls0 = three.info.render.calls;
        const triangles0 = three.info.render.triangles;
        if (passes) {
          passes.actors.beforeView(ctx);
          passes.fx.beforeView(ctx);
        }
        three.render(scene, camera);
        if (passes) {
          passes.actors.afterView(ctx);
          passes.fx.afterView(ctx);
        }
        if (view.hud) drawListIn(view.hud, rect);

        const vs = viewStatsPool[drawn]!;
        vs.drawCalls = three.info.render.calls - calls0;
        vs.triangles = three.info.render.triangles - triangles0;
        vs.regions = visibleRegions;
        vs.propGroups = passes ? passes.actors.lastViewPropGroups : 0;
        vs.actors = passes ? passes.actors.lastViewActors : 0;
        // #56: draws de corpo de bobo nesta vista (só a malha "bobos": 1, eram 7 com o bobo A).
        vs.actorDraws = passes ? passes.actors.lastViewActorDraws : 0;
        drawn++;
      }
      three.setScissorTest(false);
      stats.viewports = drawn;
      stats.views = viewLists[drawn]!;
      if (timing) {
        // Item 10 do T0: do começo do frame do render até a GPU esvaziar a fila (limite de cima do tempo de GPU).
        gl.finish();
        stats.gpuMs = performance.now() - startMs;
      } else {
        stats.gpuMs = -1;
      }
      refreshStats();
    },

    drawUi(list: DrawList, viewport?: ViewDesc): void {
      if (disposed || uiPass === null) return;
      const rect = uiRect;
      if (viewport) surfaceRectToGl(viewport.x, viewport.y, viewport.width, viewport.height, scale, bufferHeight, rect);
      else surfaceRectToGl(0, 0, surfaceWidth, surfaceHeight, scale, bufferHeight, rect);
      if (rect.width <= 0 || rect.height <= 0) return;
      drawListIn(list, rect);
      three.setScissorTest(false);
      refreshStats();
    },

    setUiAtlas(atlas: UiAtlasImage | null): void {
      if (disposed) return;
      uiPass?.setAtlas?.(atlas);
      uiAtlasBytes = atlas ? atlas.pixels.byteLength : 0;
    },

    get stats(): RenderStats {
      return stats;
    },

    setTextures(textures: RenderTextures | null): void {
      if (disposed) return;
      gpuTextures.set(textures);
      emissiveLayerBits(textures ? textures.blocks.info : [], materials.emissiveLayers.value);
      refreshStats();
    },

    writeModelLayer(firstLayer: number, rgba: Uint8Array, level1?: Uint8Array): void {
      if (disposed) return;
      gpuTextures.writeModelLayer(firstLayer, rgba, level1);
    },

    setModels(models: readonly ModelDocument[] | null): void {
      if (disposed) return;
      // Liberar sem nunca ter criado os passes não cria nada (troca de cena no caminho do M0).
      if (models === null && passes === null) return;
      ensurePasses().actors.setModels(models);
    },

    setMap(next: RenderMap | null): void {
      if (disposed) return;
      const p = next === null ? passes : ensurePasses();
      regions?.dispose();
      regions = null;
      map = next;
      if (next) {
        regions = createRegionSet(next.regions, materials.regions, vertexAttributes);
        scene.add(regions.group);
        frame.world = { grid: next.grid, blocks: next.blocks, lightGrid: next.lightGrid };
      } else {
        frame.world = null;
      }
      sky.visible = next !== null;
      p?.actors.setMap(next);
      p?.fx.setMap(next);
      refreshStats();
    },

    setEnvironment(next: EnvironmentState): void {
      if (disposed) return;
      env.timeOfDay = next.timeOfDay;
      env.sunDirX = next.sunDirX;
      env.sunDirY = next.sunDirY;
      env.sunDirZ = next.sunDirZ;
      env.viewDistanceM = next.viewDistanceM;
      env.fogStartFraction = next.fogStartFraction;
      env.timeS = next.timeS;
      env.flash = next.flash;
      env.wind = next.wind;
      applyEnvironment();
    },

    submitFx(queue: FxQueue): void {
      if (disposed) return;
      ensurePasses().fx.submit(queue);
    },

    setDebug(next: RenderDebug): void {
      if (disposed) return;
      debug.grayscale = next.grayscale;
      debug.mipFilter = next.mipFilter;
      debug.propDose = next.propDose;
      debug.hideViewmodel = next.hideViewmodel;
      debug.gpuFinish = next.gpuFinish;
      shared.uGrayscale.value = next.grayscale ? 1 : 0;
      gpuTextures.setMinFilter(next.mipFilter);
    },

    setDebrisBudget(maxDebris: number): void {
      if (disposed) return;
      debrisBudget = maxDebris;
      passes?.fx.setDebrisBudget(maxDebris);
    },

    setFigures(templates: FigureTemplateSet | null, table: FigureGameTable | null): void {
      if (disposed) return;
      // Como o teto de detritos: guarda e repassa; os passes que nascerem depois recebem no `ensurePasses`.
      figureTemplates = templates;
      figureTable = table;
      if (passes) {
        passes.actors.setFigures(templates, table);
        passes.fx.setFigures(templates);
      }
    },

    setFigureLod(nearM: number, halfRate: boolean): void {
      if (disposed) return;
      figureNearM = nearM;
      figureHalfRate = halfRate;
      passes?.actors.setFigureLod(nearM, halfRate);
    },

    warmup(): void {
      if (disposed) return;
      const p = ensurePasses();
      // Tudo visível: compila os programas e sobe todos os buffers e texturas agora (tela de loading), não no primeiro
      // frame da partida (o Switch não tem KHR_parallel_shader_compile, tecnico.md §6.5).
      regions?.showAll();
      for (const mesh of warmMeshes) mesh.visible = true;
      sky.visible = true;
      const camera = cameras[0]!;
      const view = warmView;
      view.camera.x = map ? map.sizeX * 0.25 : 0;
      view.camera.y = map ? map.sizeY * 0.25 : 1.6;
      view.camera.z = map ? map.sizeZ * 0.25 : 0;
      view.camera.fovY = Math.PI / 2;
      view.camera.far = 140;
      view.width = 1;
      view.height = 1;
      setupCamera(camera, view);
      setFrustum(camera, frustums[0]!);
      three.compile(scene, camera);
      p.actors.warmup();
      p.fx.warmup();

      // 1 frame "fora da tela": viewport de 1 px no canto, apagado logo depois (o loading redesenha por cima).
      const rect = rects[0]!;
      rect.x = 0;
      rect.y = 0;
      rect.width = 1;
      rect.height = 1;
      applyRect(rect);
      const ctx = contexts[0]!;
      ctx.view = view;
      p.actors.beforeView(ctx);
      p.fx.beforeView(ctx);
      three.render(scene, camera);
      p.actors.afterView(ctx);
      p.fx.afterView(ctx);
      if (uiPass) {
        resetDrawList(warmList, 1, 1);
        pushRect(warmList, 0, 0, 1, 1, 0x000000ff);
        drawListIn(warmList, rect);
      }
      three.setClearColor(horizon, 1);
      three.clear(true, true, false);
      three.setScissorTest(false);
      for (const mesh of warmMeshes) mesh.visible = false;
      sky.visible = map !== null;
      refreshStats();
    },

    memory(): RenderMemory {
      seenBuffers.clear();
      instanceBytes = 0;
      otherBytes = 0;
      scene.traverse(visitMemory);
      seenBuffers.clear();
      memory.textureBytes = gpuTextures.bytes + GRADE_LUT_SIZE * 4 + uiAtlasBytes;
      memory.worldMeshBytes = regions?.bytes ?? 0;
      memory.instanceBytes = instanceBytes;
      memory.otherBytes = otherBytes;
      return memory;
    },

    get info(): RenderInfo {
      return info;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribeResize();
      if (passes) {
        passes.actors.dispose();
        passes.fx.dispose();
        passes = null;
      }
      regions?.dispose();
      regions = null;
      map = null;
      figureTemplates = null;
      figureTable = null;
      for (const mesh of warmMeshes) mesh.geometry.dispose();
      sky.geometry.dispose();
      materials.dispose();
      gpuTextures.dispose();
      lut.dispose();
      uiPass?.dispose();
      scene.clear();
      // Libera programas, buffers e texturas do three; o contexto GL continua sendo da casca.
      three.dispose();
      setConsoleFunction(previousConsole as Parameters<typeof setConsoleFunction>[0]);
    },
  };
  return renderer;
}
