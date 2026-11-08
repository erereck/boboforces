// Frente "render-atores": programa 4 (instanciado). Bonecos do FutBobo (#56: uma instância por caixa, skin de 2
// camadas; o bobo de 6 partes + rosto saiu no passo 5 do porte); armas (mundo e viewmodel), props fora da grade por
// grupo de 32 m e sombra-blob. Sem contorno de time (decisão #50). Interface com a render-mundo em
// `../shared/passes.ts`; trechos GLSL comuns em `../shared/glsl-common.ts` (os dois congelados).
//
// Sem three (podem ir para `@boboforces/render/data` se o `game` precisar): `skin-cache.ts` (skins por aparência),
// `anim/` (o rig dos bonecos), `props.ts`, as geometrias. Os mips da skin são do `writeLayerMips` (texture-gpu-data.ts).
export { createActorPass, type ActorPassFigureStats } from './actor-pass.ts';
// #56: bonecos do FutBobo (uma instância por caixa do cubo, faixa estável por ator; sem three).
export { buildFigureCubeGeometry, writeFigureBoxData } from './figure-cube.ts';
export { clipHairBox, createFigureFrame, figureHairSpans, type FigureFrame } from './figure-frame.ts';
export {
  createFigureInstances,
  FIGURE_ACTORS_MAX,
  FIGURE_INSTANCES_MAX,
  type FigureInstances,
} from './figure-instances.ts';
export { createRestFigureRig, FIGURE_HAIR_CEILING } from './figure-rest-rig.ts';
export { FIGURE_INST, INST, INSTANCE_FLOATS, LAYER_FROM_INSTANCE, VERTEX_FLAG } from './layout.ts';
export {
  buildModelBinding,
  modelSocket,
  type LayerLookup,
  type LayerRef,
  type ModelBinding,
  type SocketM,
} from './model-geometry.ts';
export {
  buildPropGroups,
  PROP_DRAWS_PER_VIEW,
  PROP_DRAWS_PER_VIEW_SMALL,
  PROP_GROUP_SIZE_M,
  propSurfaceDistance,
} from './props.ts';
export { INSTANCED_FRAGMENT, INSTANCED_VERTEX } from './shader.ts';
export {
  createFigureSkinCache,
  type FigureSkinCache,
  type FigureSkinCacheOptions,
  type SkinLayerCacheStats,
} from './skin-cache.ts';
export {
  buildFigureArmGeometry,
  buildViewmodelGeometry,
  VIEWMODEL_FIGURE_ARM,
  VIEWMODEL_POSE,
  viewmodelAimOffset,
} from './viewmodel.ts';
