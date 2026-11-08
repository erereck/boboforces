// Mesher do cenário (tecnico.md §6.2 e §6.3): `buildRegionMesh` (região de 2×2×1 chunks, vértice compacto de 12 bytes
// num buffer só, em `region.ts`). O mesher por chunk do M0 (`buildChunkMesh`) saiu na integração do M1. O world só
// gera arrays; quem sobe para a GPU é o `render`.
export * from './vertex.ts';
export * from './region.ts';
