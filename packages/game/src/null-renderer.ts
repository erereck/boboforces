import type { FigureGameTable, FigureTemplateSet, ModelDocument } from '@boboforces/format';
import type {
  ActorBuffer,
  EnvironmentState,
  FxQueue,
  RenderDebug,
  Renderer,
  RenderInfo,
  RenderMap,
  RenderMemory,
  RenderStats,
  RenderTextures,
  ViewDesc,
} from '@boboforces/render/data';
import type { DrawList, UiAtlasImage } from '@boboforces/ui';

/**
 * Renderer que não desenha nada. Usado quando `GameDeps.createRenderer` é `null`: boot do portcheck em `node:vm`,
 * testes headless e bench sem GPU. Importa só TIPOS do render, então o three não é carregado. Os membros do M1 são
 * no-ops (a sim, a IA e o loading rodam iguais; só não há GPU).
 */
export function createNullRenderer(): Renderer {
  let viewports = 0;
  const memory: RenderMemory = { textureBytes: 0, worldMeshBytes: 0, instanceBytes: 0, otherBytes: 0 };
  const info: RenderInfo = {
    threeRevision: 'nenhum',
    textureMode: 'array',
    vertexAttributes: 'int',
    glLimits: {},
    warnings: [],
  };
  return {
    resize(width: number, height: number, pixelRatio: number): void {
      void [width, height, pixelRatio];
    },
    setProjectiles(): void {
      // Sem GPU, nada a desenhar.
    },

    setActors(actors: ActorBuffer): void {
      void actors;
    },
    renderViews(views: readonly ViewDesc[]): void {
      viewports = views.length;
    },
    drawUi(list: DrawList, viewport?: ViewDesc): void {
      void [list, viewport];
    },
    setUiAtlas(atlas: UiAtlasImage | null): void {
      void atlas;
    },
    get stats(): RenderStats {
      return {
        drawCalls: 0,
        triangles: 0,
        programs: 0,
        viewports,
        textures: 0,
        geometries: 0,
        views: [],
        gpuMs: -1,
        figureL0: 0,
        figureL1: 0,
        figureL2: 0,
        figureOverflow: 0,
      };
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
    dispose(): void {},
  };
}
