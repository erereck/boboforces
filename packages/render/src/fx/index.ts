// Frente "render-atores": programa 5 (partículas e quads: clarão, traçante, faíscas, confete, fumaça e poeira de cubos,
// marcas de tiro, sombra-blob) e, no programa 4, os cubinhos de detrito e o desmonte de morte (pool do perfil).
// Consome a `FxQueue` do frame.
export { createFxPass, DECAL_LIFE_S, FX_QUEUE_CAPACITY, FX_RING_SIZES } from './fx-pass.ts';
export { blockTexelColor, FALLBACK_DEBRIS_COLOR } from './colors.ts';
export { DEBRIS_CAPACITY } from './debris.ts';
export { CORPSE_LIFE_S, FIGURE_CORPSES_MAX } from './figure-corpses.ts';
export { PARTICLE_FRAGMENT, PARTICLE_KIND, PARTICLE_VERTEX } from './shader.ts';
export { floorBelow, pointSolid, verletStep, type CollisionWorld } from './verlet.ts';
