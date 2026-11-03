// Parte do render SEM three (subcaminho `@boboforces/render/data`): contrato, limites, presets de céu, montagem de
// texture arrays e conta de viewports. É o único pedaço do render que o `game` importa como VALOR (o guard confere);
// o resto ele importa só como tipo, para o three nunca carregar sem GPU (NullRenderer, portcheck).
export * from './types.ts';
export * from './limits.ts';
export * from './sky.ts';
export * from './texture-data.ts';
export * from './viewport.ts';
