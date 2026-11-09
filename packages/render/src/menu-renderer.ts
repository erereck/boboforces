import type { FigureGameTable, FigureTemplateSet, ModelDocument } from '@boboforces/format';
import type { GraphicsSurface } from '@boboforces/platform-api';
import type { Unsubscribe } from '@boboforces/shared';
import type { DrawList, UiAtlasImage } from '@boboforces/ui';
import { REVISION, WebGLRenderer } from 'three';
import type { EnvironmentState } from './environment.ts';
import type { FxQueue } from './fx-queue.ts';
import type {
  ActorBuffer,
  RenderDebug,
  Renderer,
  RendererOptions,
  RenderInfo,
  RenderMap,
  RenderMemory,
  RenderStats,
  RenderTextures,
  ViewDesc,
} from './types.ts';
import type { UiPass, UiPassFactory } from './ui-pass.ts';
import { bufferScale, createGlRect, surfaceRectToGl } from './viewport.ts';

/**
 * Renderer SÓ DE UI (integração do M1): o `WebGLRenderer` do three e o passe de UI (programa 7), sem o mundo, os
 * atores e os VFX. A web desenha o menu com ele, para o código do mundo ficar fora da carga inicial (tecnico.md
 * §16.4: menu ≤ 350 KB); ao entrar na primeira cena o `game` libera este e cria o completo (`createRenderer`) no MESMO
 * contexto GL da casca. Os membros do mundo são no-ops (o menu não chama). O Switch não usa: lá o completo já nasce no
 * boot (um arquivo só).
 */
export function createMenuRenderer(
  surface: GraphicsSurface,
  options: RendererOptions = {},
  createUiPass: UiPassFactory | null = null,
): Renderer {
  const maxPixelRatio = options.maxPixelRatio ?? 2;
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
  const uiPass: UiPass | null = createUiPass ? createUiPass(three) : null;
  const rect = createGlRect();
  const target = { x: 0, y: 0, width: 0, height: 0, scale: 1 };
  let surfaceWidth = 1;
  let surfaceHeight = 1;
  let scale = 1;
  let bufferWidth = 0;
  let bufferHeight = 0;
  let disposed = false;
  const stats: { -readonly [K in keyof RenderStats]: RenderStats[K] } = {
    drawCalls: 0,
    triangles: 0,
    programs: 0,
    viewports: 0,
    textures: 0,
    geometries: 0,
    views: [],
    gpuMs: -1,
    figureL0: 0,
    figureL1: 0,
    figureL2: 0,
    figureOverflow: 0,
  };
  const info: RenderInfo = {
    threeRevision: REVISION,
    textureMode: options.textureMode ?? 'array',
    vertexAttributes: options.vertexAttributes ?? 'int',
    glLimits: {},
    warnings: [],
  };
  const memory: RenderMemory = { textureBytes: 0, worldMeshBytes: 0, instanceBytes: 0, otherBytes: 0 };

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
  }

  return {
    resize,
    setProjectiles(): void {
      // O menu não tem cena.
    },

    setActors(actors: ActorBuffer): void {
      void actors;
    },
    renderViews(views: readonly ViewDesc[]): void {
      if (disposed) return;
      three.info.reset();
      stats.viewports = 0;
      void views;
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
      target.x = rect.x;
      target.y = rect.y;
      target.width = rect.width;
      target.height = rect.height;
      target.scale = scale;
      uiPass.draw(list, target);
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
    setTextures(textures: RenderTextures | null): void {
      void textures;
    },
    writeModelLayer(firstLayer: number, rgba: Uint8Array, level1?: Uint8Array): void {
      void [firstLayer, rgba, level1];
    },
    setModels(models: readonly ModelDocument[] | null): void {
      void models;
    },
    setMap(map: RenderMap | null): void {
      void map;
    },
    setEnvironment(env: EnvironmentState): void {
      void env;
    },
    submitFx(queue: FxQueue): void {
      void queue;
    },
    setDebug(debug: RenderDebug): void {
      void debug;
    },
    warmup(): void {},
    setDebrisBudget(maxDebris: number): void {
      void maxDebris;
    },
    setFigures(templates: FigureTemplateSet | null, table: FigureGameTable | null): void {
      void [templates, table];
    },
    setFigureLod(nearM: number, halfRate: boolean): void {
      void [nearM, halfRate];
    },
    memory(): RenderMemory {
      return memory;
    },
    get info(): RenderInfo {
      return info;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribeResize();
      uiPass?.dispose();
      // Devolve o estado do GL ao padrão: o renderer completo nasce no mesmo contexto e parte do zero.
      three.resetState();
      three.dispose();
    },
  };
}
