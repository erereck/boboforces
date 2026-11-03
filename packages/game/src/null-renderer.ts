import type { ActorBuffer, Renderer, RenderStats, RenderWorld, ViewDesc } from '@boboforces/render/data';
import type { DrawList, UiAtlasImage } from '@boboforces/ui';

/**
 * Renderer que não desenha nada. Usado quando `GameDeps.createRenderer` é `null`: boot do portcheck em `node:vm`,
 * testes headless e bench. Importa só TIPOS do render, então o three não é carregado.
 */
export function createNullRenderer(): Renderer {
  const stats: RenderStats = { drawCalls: 0, triangles: 0, programs: 0, viewports: 0, textures: 0, geometries: 0 };
  let viewports = 0;
  return {
    resize(width: number, height: number, pixelRatio: number): void {
      void [width, height, pixelRatio];
    },
    setWorld(world: RenderWorld | null): void {
      void world;
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
      return { ...stats, viewports };
    },
    dispose(): void {},
  };
}
