// Parte do render SEM three (subcaminho `@boboforces/render/data`): contrato, limites, presets de céu e de hora do dia,
// montagem de texture arrays, fila de VFX e conta de viewports. É o único pedaço do render que o `game` importa como
// VALOR (o guard confere); o resto ele importa só como tipo, para o three nunca carregar sem GPU (NullRenderer,
// portcheck). `data.test.ts` garante que nada neste fecho importa three.
export * from './types.ts';
export * from './limits.ts';
export * from './environment.ts';
export * from './fx-queue.ts';
export * from './texture-data.ts';
export * from './texture-assets.ts';
export * from './viewport.ts';
// M1 (integração): peças da render-atores sem three que o `game` usa no loading e por frame: o cache de skins do
// boneco do FutBobo (#56: 2 camadas por skin e o pintor do format, injetado pelo `game`).
export * from './actors/skin-cache.ts';
export { viewmodelAimOffset, VIEWMODEL_POSE } from './actors/viewmodel.ts';
// #56 (porte do boneco): o programa 4 e a cena da sonda T4. A casca do Switch compila os shaders REAIS num contexto
// WebGL2 puro, desenha a cena e confere os pixels pelo gêmeo do vertex shader (sem three: o fecho continua limpo).
export { INSTANCED_FRAGMENT, INSTANCED_UNIFORM_NAMES, INSTANCED_VERTEX } from './actors/shader.ts';
export {
  checkFigureProbe,
  createFigureProbeScene,
  figureProbeTexel,
  type FigureProbeCheck,
  type FigureProbeDraw,
  type FigureProbeSample,
  type FigureProbeScene,
} from './actors/figure-probe.ts';
