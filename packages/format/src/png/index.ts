// PNG próprio (tecnico.md §6.1 e §15.2): decodificador para o jogo e as tools, codificador para as tools (texgen,
// fontbake). Puro, sobre o deflate do fflate; sem DOM, sem Node, sem relógio.
export * from './types.ts';
export * from './crc32.ts';
export * from './decode.ts';
export * from './encode.ts';
