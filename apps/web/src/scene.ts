// A CENA na web (integração do M1): o subcaminho `@boboforces/game/scene` (mundo, mesher, luz, navegação, IA) e o
// renderer COMPLETO do three (mundo, atores, VFX). Este módulo só é carregado por `import()` no `main.ts`, quando o
// jogador entra na cena (ou a URL pede o bench): o menu fica no orçamento de 350 KB (tecnico.md §16.4) e o resto
// conta na primeira partida. Regra 15: `import()` só aqui, na casca.
import type { RendererFactory, SceneBundle } from '@boboforces/game';
import { SCENE_MODULE } from '@boboforces/game/scene';
import { createMsdfUiPass, createRenderer, type RendererOptions } from '@boboforces/render';

/** Monta o pacote da cena com a fábrica do renderer completo (mesmas opções de superfície do renderer do menu). */
export function sceneBundle(base: RendererOptions): SceneBundle {
  const factory: RendererFactory = (surface, routes) =>
    createRenderer(surface, { ...base, ...(routes ?? {}) }, (three) => createMsdfUiPass(three));
  return { module: SCENE_MODULE, createRenderer: factory };
}
