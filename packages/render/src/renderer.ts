import type { GraphicsSurface } from '@boboforces/platform-api';
import { REVISION } from 'three';
import { createActorPass } from './actors/index.ts';
import { createFxPass } from './fx/index.ts';
import { createRendererCore } from './renderer-core.ts';
import type { Renderer, RendererOptions } from './types.ts';
import type { UiPassFactory } from './ui-pass.ts';

/** Revisão do three embutida (vai no relatório de diagnóstico). */
export const THREE_REVISION = REVISION;

/**
 * Cria o renderer three (só `WebGLRenderer`, WebGL2 puro, no máximo 7 programas) sobre a superfície da plataforma.
 * Recebe canvas + contexto já criados pela casca: é a costura do shim do nx.js (tecnico.md §6.11). Nunca usar
 * `TextureLoader`/`ImageLoader` (dependem de `document`): as texturas chegam decodificadas pelo PNG próprio.
 *
 * - O contexto é da casca: `antialias` e `alpha` valem o que ela pediu no `getContext` (o three não recria o contexto).
 * - `ViewDesc` e `DrawList` falam em px da superfície (`surface.width/height`); se o teto de DPR encolher o drawing
 *   buffer, o render converte. O CSS do canvas é da casca (o render nunca mexe em `style`).
 * - `createUiPass` liga o programa de UI (`src/ui/`); sem ele, `drawUi` e a HUD das vistas não desenham.
 * - Os passes de atores e VFX (`src/actors/`, `src/fx/`) nascem na primeira chamada que precisa deles (`setActors`,
 *   `setModels`, `setMap`, `submitFx`, `warmup`). O caminho do M0 (`setWorld`, caixas) saiu na integração do M1.
 */
export function createRenderer(
  surface: GraphicsSurface,
  options: RendererOptions = {},
  createUiPass: UiPassFactory | null = null,
): Renderer {
  return createRendererCore(surface, options, createUiPass, { actors: createActorPass, fx: createFxPass });
}
