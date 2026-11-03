// Mesher do cenário (tecnico.md §6.2 e §6.3): contrato do vértice compacto em `vertex.ts`, greedy meshing em `greedy.ts`.
// O world só gera arrays; quem sobe para a GPU é o `render`.
export * from './vertex.ts';
export { buildChunkMesh } from './greedy.ts';
