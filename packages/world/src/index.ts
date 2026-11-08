// @boboforces/world: grade de blocos de 0,5 m, chunks 32³, registro de blocos, consultas (DDA, AABB), formato
// RLE + deflate e mesher que só gera arrays. Puro e determinístico (sem DOM, sem relógio, sem Math.random).
// M1: catálogo de formas (`shapes.ts`), definições de bloco por nome (`block-source.ts`), luz em canais e grade de luz
// de 2 m (`light.ts`), colisores das props (`colliders.ts`) e mesher por região (`mesh/region.ts`).
export * from './constants.ts';
export * from './cell.ts';
export * from './shapes.ts';
export * from './blocks.ts';
export * from './block-source.ts';
export * from './chunk.ts';
export * from './grid.ts';
export * from './light.ts';
export * from './colliders.ts';
export * from './query.ts';
export * from './codec.ts';
export * from './arena.ts';
export * from './mesh/index.ts';
