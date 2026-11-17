// A CENA na web (integração do M1): o subcaminho `@boboforces/game/scene` (mundo, mesher, luz, navegação, IA) e o
// renderer COMPLETO do three (mundo, atores, VFX). Este módulo só é carregado por `import()` no `main.ts`, quando o
// jogador entra na cena (ou a URL pede o bench): o menu fica no orçamento de 350 KB (tecnico.md §16.4) e o resto
// conta na primeira partida. Regra 15: `import()` só aqui, na casca.
import type { RendererFactory, SceneBundle } from '@boboforces/game';
import { SCENE_MODULE } from '@boboforces/game/scene';
import { createMsdfUiPass, createRenderer, type RendererOptions } from '@boboforces/render';

// M5 (fase 4c): o Online (as telas e a sala) vem no mesmo pedaço da cena: quem abre o Online vai jogar e baixaria a
// cena de qualquer jeito, e assim nada vira pedaço comum entre a cena e o Online (um pedaço comum que precisa da `sim`
// ou do `format` faz o empacotador tirar módulos do menu para pedaços à parte, e o menu passava dos 350 KB). O `net`
// (Trystero) continua num pedaço só dele, pedido ao abrir o Online.
export { loadWebOnline } from './online-bundle.ts';

/** Monta o pacote da cena com a fábrica do renderer completo (mesmas opções de superfície do renderer do menu). */
export function sceneBundle(base: RendererOptions): SceneBundle {
  const factory: RendererFactory = (surface, routes) =>
    createRenderer(surface, { ...base, ...(routes ?? {}) }, (three) => createMsdfUiPass(three));
  return { module: SCENE_MODULE, createRenderer: factory };
}
