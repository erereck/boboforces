// @boboforces/world: grade de blocos de 0,5 m, chunks 32³, registro de blocos, consultas (DDA, AABB), formato
// RLE + deflate e mesher que só gera arrays. Puro e determinístico (sem DOM, sem relógio, sem Math.random).
export * from './constants.ts';
export * from './cell.ts';
export * from './blocks.ts';
export * from './chunk.ts';
export * from './grid.ts';
export * from './query.ts';
export * from './codec.ts';
export * from './arena.ts';
export * from './mesh/index.ts';
