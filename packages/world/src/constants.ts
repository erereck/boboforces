/**
 * Constantes da grade (tecnico.md §5.1; decisão #6). Unidades: metros e células.
 * Eixos: Y para cima. Uma célula de coordenada inteira (x, y, z) ocupa [x, x+1) × [y, y+1) × [z, z+1) em células,
 * ou seja, [x·0,5, (x+1)·0,5) em metros.
 */

/** Lado da célula de construção, colisão e navegação, em metros. */
export const BLOCK_SIZE = 0.5;

/** Células por metro (inverso de BLOCK_SIZE, para evitar divisão no laço quente). */
export const CELLS_PER_METER = 2;

/** Lado do chunk de dados, em células (32³ = 16×16×16 m). */
export const CHUNK_SIZE = 32;
export const CHUNK_SHIFT = 5;
export const CHUNK_MASK = CHUNK_SIZE - 1;
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE;

/**
 * Teto do motor para o tamanho da grade, em células: 2.048 × 256 × 2.048 (1.024 × 128 × 1.024 m, até 32.768 chunks).
 * O maior mapa previsto é o Royale Mini (400 × 64 × 400, tecnico.md §5.3); o teto existe para um arquivo de fora
 * (`.bfmap` do M1, códigos da Oficina no M6) não pedir uma grade gigante com meia dúzia de bytes de cabeçalho.
 */
export const MAX_GRID_SIZE_XZ = 2048;
export const MAX_GRID_SIZE_Y = 256;

/** Texels por face de bloco (16×16 px, 32 px/m, filtro nearest). */
export const TEXELS_PER_CELL = 16;

/** Menor passo de formas e props: 1/16 de célula = 3,125 cm = 1 texel do cenário. */
export const SUBCELL_STEPS = 16;
