// Ponte entre os dois passes da render-atores (`ActorPass` e `FxPass`), que a render-mundo cria separados com o MESMO
// `PassContext`. O contrato congelado não dá ao `FxPass` os atores nem os modelos, mas o acerto em bobo precisa da pose
// do frame (as faixas dos bonecos: cor do texel da caixa atingida e o desmonte) e o clarão do viewmodel precisa do cano
// na tela. A ponte é chaveada pela cena principal (a mesma para os dois) e só carrega referências: nada é copiado. Sem
// three em tempo de execução.
import type { FigureTemplateSet } from '@boboforces/format';
import type { PerspectiveCamera, Scene } from 'three';
import type { ActorBuffer } from '../types.ts';
import type { FigureInstances } from './figure-instances.ts';
import type { ModelBinding } from './model-geometry.ts';

export interface ActorFxLink {
  /** Atores do frame (`setActors`), como o `update` do `ActorPass` os viu. */
  actors: ActorBuffer | null;
  /** Modelos de `setModels`, no mesmo índice (null = inválido). */
  models: readonly (ModelBinding | null)[];
  /** Boca do cano do viewmodel por vista (x, y, z, válido) e a câmera do viewmodel, no `afterView` do `ActorPass`. */
  readonly viewmodelMuzzle: Float32Array;
  viewmodelCamera: PerspectiveCamera | null;
  /**
   * #56: faixas dos bonecos do FutBobo (o desmonte nasce das 12 matrizes de osso, o cubinho acha a caixa atingida) e
   * os gabaritos da partida. `instances.actorRecord[i]` ≥ 0 = o ator i foi desenhado como boneco neste quadro.
   */
  figure: FigureInstances | null;
  figureTemplates: FigureTemplateSet | null;
}

const links = new WeakMap<Scene, ActorFxLink>();

export function linkFor(scene: Scene): ActorFxLink {
  let link = links.get(scene);
  if (!link) {
    link = {
      actors: null,
      models: [],
      viewmodelMuzzle: new Float32Array(4 * 4),
      viewmodelCamera: null,
      figure: null,
      figureTemplates: null,
    };
    links.set(scene, link);
  }
  return link;
}

/** Acha o ator da entidade no frame (busca linear: só nos frames com acerto, ≤ 72 atores). */
export function findActor(link: ActorFxLink, entity: number): number {
  const actors = link.actors;
  if (!actors || entity === 0) return -1;
  for (let i = 0; i < actors.count; i++) if (actors.entity[i] === entity >>> 0) return i;
  return -1;
}
