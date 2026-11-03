/**
 * Contrato do mesher (tecnico.md §6.2 e §6.3). O world SÓ gera arrays; quem sobe para a GPU é o `render`.
 *
 * Vértice compacto (10 bytes úteis dos 12 do §6.3, em dois buffers para o three não exigir um tipo só):
 * - `positions`: 3 × u16 por vértice, posição local à origem da malha, no passo de 1/16 de célula (1 texel).
 * - `attributes`: 4 × u8 por vértice:
 *   [0] normal (5 bits, índice de `NORMAL_TABLE`) | AO (2 bits) << 5 | variação de cor (1 bit) << 7
 *   [1] camada da textura em `blocos16`
 *   [2] luz do céu (4 bits) | luz do sol (4 bits) << 4
 *   [3] emissivo (4 bits) | flags (4 bits, `VERTEX_FLAG`) << 4
 * A UV sai no shader a partir da posição e da normal (`uv = vec2(dot(p, T), dot(p, B)) * 2`), por isso não vai no vértice.
 */
export interface MeshArrays {
  vertexCount: number;
  indexCount: number;
  /** 3 × u16 por vértice. Tamanho ≥ vertexCount × 3 (pode sobrar capacidade). */
  positions: Uint16Array;
  /** 4 × u8 por vértice. Tamanho ≥ vertexCount × 4. */
  attributes: Uint8Array;
  /** Triângulos. Uint32 é núcleo do WebGL2; Uint16 quando couber. */
  indices: Uint16Array | Uint32Array;
}

/** Programas de shader que recebem malha de cenário (tecnico.md §6.5: opaco, cutout, translúcido). */
export type MeshPass = 'opaque' | 'cutout' | 'translucent';

/** Malhas de um chunk (ou região), uma por programa, todas relativas à mesma origem. */
export interface ChunkMesh {
  /** Origem da malha em células (canto mínimo do chunk/região). */
  readonly originX: number;
  readonly originY: number;
  readonly originZ: number;
  readonly opaque: MeshArrays;
  readonly cutout: MeshArrays;
  readonly translucent: MeshArrays;
}

export const POSITION_COMPONENTS = 3;
export const ATTRIBUTE_COMPONENTS = 4;
/** Passos de posição por célula (1/16 de célula = 1 texel). */
export const POSITION_STEPS_PER_CELL = 16;

/** Bits do nibble de flags do vértice. */
export const VERTEX_FLAG = { animated: 1, swaysInWind: 2 } as const;

/** AO sem oclusão (canto aberto). O M0 não calcula AO: todo vértice sai com este valor. */
export const AO_NONE = 3;

/** Luz cheia de um canal (0..15). O M0 não calcula luz: céu e sol saem cheios. */
export const LIGHT_FULL = 15;

/**
 * Tabela de normais (até 32). Os 6 primeiros índices são FIXOS e iguais a `FACE` (+X, -X, +Y, -Y, +Z, -Z); as diagonais
 * das cruzes e as rampas 1:1 e 1:2 entram a partir do índice 6 no M1, sem mudar os 6 primeiros.
 */
export const NORMAL_TABLE: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export function packNormalAo(normal: number, ao: number, colorVariation: boolean): number {
  return (normal & 31) | ((ao & 3) << 5) | ((colorVariation ? 1 : 0) << 7);
}

export function packLight(sky: number, sun: number): number {
  return (sky & 15) | ((sun & 15) << 4);
}

export function packEmissiveFlags(emissive: number, flags: number): number {
  return (emissive & 15) | ((flags & 15) << 4);
}

export interface MeshOptions {
  /**
   * Reaproveita os buffers de uma malha anterior (loading fatiado sem lixo). A malha passada aqui deixa de valer: os
   * arrays dela passam a ser os da nova.
   */
  readonly reuse?: ChunkMesh;
}
