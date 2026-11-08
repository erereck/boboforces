import type { BlockRegistry } from '../blocks.ts';
import { CHUNK_SIZE } from '../constants.ts';
import type { WorldGrid } from '../grid.ts';
import type { LightField } from '../light.ts';
import { buildRegion } from './region-build.ts';

/**
 * Mesher do M1 por REGIÃO (tecnico.md §5.1, §6.2 e §6.3). CONTRATO; implementação da frente "mundo".
 *
 * Região de render = 2×2×1 chunks (64×32×64 células = 32×16×32 m). Cada região gera até 3 malhas (opaca, cutout,
 * translúcida), todas relativas ao canto mínimo da região. Greedy meshing por textura com AO 0fps e troca da diagonal;
 * só funde faces com a mesma camada, a mesma normal, o mesmo AO nos 4 cantos e a mesma luz (céu, sol, emissivo) e os
 * mesmos bytes 9–10. Formas do catálogo (`shapes.ts`) entram na mesma malha, no passo de 1/16 de célula.
 *
 * VÉRTICE COMPACTO DE 12 BYTES, um buffer intercalado só (`vertices`: Uint16Array, 6 palavras por vértice,
 * little-endian, como todo aparelho-alvo):
 *
 * | bytes | palavra | campo                                                                                  |
 * |-------|---------|----------------------------------------------------------------------------------------|
 * | 0–1   | w0      | x: u16, passo de 1/16 de célula a partir da origem da região (0..1024)                  |
 * | 2–3   | w1      | y: u16, idem (0..512)                                                                   |
 * | 4–5   | w2      | z: u16, idem (0..1024)                                                                  |
 * | 6     | w3 lo   | normal (bits 0–4, índice da `NORMAL_TABLE`) · AO (bits 5–6, 0 = mais escuro, 3 = aberto) · variação de cor (bit 7) |
 * | 7     | w3 hi   | camada de `blocos16` (u8, a BASE: quadro 0 e variante 0)                                |
 * | 8     | w4 lo   | céu (bits 0–3) · sol (bits 4–7), 0..15 cada                                            |
 * | 9     | w4 hi   | emissivo (bits 0–3) · flags (bits 4–7, `REGION_VERTEX_FLAG`)                            |
 * | 10    | w5 lo   | variantes − 1 (bits 0–3) · quadros de animação − 1 (bits 4–7)                          |
 * | 11    | w5 hi   | reservado (0)                                                                           |
 *
 * No GL: `aPos` = palavras 0..2 (3 × u16) e `aData` = palavras 3..5 (3 × u16), stride 12 bytes, offsets 0 e 6. Rota
 * inteira (`vertexAttribIPointer`, `uvec3`) ou float (`vec3` com o valor inteiro, decodificado no shader): as duas
 * leem o mesmo buffer (chave `vertexAttributes` do render, item 5 do Teste Zero). A decodificação GLSL está em
 * `packages/render/src/shared/glsl-common.ts` (`unpackBlockVertex`).
 *
 * Camada final no shader: `base + (hash(célula) % variantes)·quadros + floor(tempo·fps) % quadros` (variantes e
 * quadros vêm do byte 10; fps fixo `BLOCK_ANIMATION_FPS`). A tira do texgen guarda as variantes de um bloco em
 * sequência e, dentro de cada variante, os quadros em sequência.
 */

export const REGION_CHUNKS_X = 2;
export const REGION_CHUNKS_Y = 1;
export const REGION_CHUNKS_Z = 2;
export const REGION_CELLS_X = REGION_CHUNKS_X * CHUNK_SIZE;
export const REGION_CELLS_Y = REGION_CHUNKS_Y * CHUNK_SIZE;
export const REGION_CELLS_Z = REGION_CHUNKS_Z * CHUNK_SIZE;

export const REGION_VERTEX_BYTES = 12;
export const REGION_VERTEX_WORDS = 6;
/** Quadros por segundo das texturas animadas (água, telas). */
export const BLOCK_ANIMATION_FPS = 4;

/** Bits do nibble de flags (byte 9, bits 4–7). */
export const REGION_VERTEX_FLAG = {
  animated: 1,
  swaysInWind: 2,
  /** Gira/espelha a UV por célula (materiais contínuos; `BLOCK_FLAG.randomUv`). */
  randomUv: 4,
  /** Vértice de cima da cruz (só ele balança com o vento). */
  top: 8,
} as const;

/** Campos de um vértice compacto (entrada de `packRegionVertex`; também o que `unpackRegionVertex` devolve). */
export interface RegionVertex {
  x: number;
  y: number;
  z: number;
  normal: number;
  ao: number;
  colorVariation: boolean;
  layer: number;
  sky: number;
  sun: number;
  emissive: number;
  flags: number;
  variants: number;
  frames: number;
}

/** Escreve um vértice (6 palavras) em `out` a partir da palavra `o`. Sem alocação. */
export function packRegionVertex(out: Uint16Array, o: number, v: Readonly<RegionVertex>): void {
  out[o] = v.x;
  out[o + 1] = v.y;
  out[o + 2] = v.z;
  out[o + 3] = (v.normal & 31) | ((v.ao & 3) << 5) | ((v.colorVariation ? 1 : 0) << 7) | ((v.layer & 255) << 8);
  out[o + 4] = (v.sky & 15) | ((v.sun & 15) << 4) | ((v.emissive & 15) << 8) | ((v.flags & 15) << 12);
  out[o + 5] = ((v.variants - 1) & 15) | (((v.frames - 1) & 15) << 4);
}

/** Lê um vértice (testes, depuração e a leitura do texel no acerto). */
export function unpackRegionVertex(src: Uint16Array, o: number, out: RegionVertex): RegionVertex {
  const w3 = src[o + 3]!;
  const w4 = src[o + 4]!;
  const w5 = src[o + 5]!;
  out.x = src[o]!;
  out.y = src[o + 1]!;
  out.z = src[o + 2]!;
  out.normal = w3 & 31;
  out.ao = (w3 >> 5) & 3;
  out.colorVariation = ((w3 >> 7) & 1) === 1;
  out.layer = w3 >> 8;
  out.sky = w4 & 15;
  out.sun = (w4 >> 4) & 15;
  out.emissive = (w4 >> 8) & 15;
  out.flags = (w4 >> 12) & 15;
  out.variants = (w5 & 15) + 1;
  out.frames = ((w5 >> 4) & 15) + 1;
  return out;
}

export interface RegionMeshArrays {
  vertexCount: number;
  indexCount: number;
  /** 6 × u16 por vértice (ver o layout acima). Tamanho ≥ vertexCount × 6 (pode sobrar capacidade). */
  vertices: Uint16Array;
  /** Triângulos. Uint16 quando couber (≤ 65.535 vértices), senão Uint32 (núcleo do WebGL2). */
  indices: Uint16Array | Uint32Array;
}

/** Programas que recebem malha de cenário (tecnico.md §6.5). */
export type RegionPass = 'opaque' | 'cutout' | 'translucent';

export interface RegionMesh {
  /** Coordenadas da região (em regiões). */
  readonly rx: number;
  readonly ry: number;
  readonly rz: number;
  /** Origem da malha em células (canto mínimo da região). */
  readonly originX: number;
  readonly originY: number;
  readonly originZ: number;
  /** AABB do conteúdo, em células, relativa à origem (culling por vista; vazia = min > max). */
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
  readonly opaque: RegionMeshArrays;
  readonly cutout: RegionMeshArrays;
  readonly translucent: RegionMeshArrays;
}

export interface RegionMeshOptions {
  /** Reaproveita os buffers de uma malha anterior (loading fatiado sem lixo); a anterior deixa de valer. */
  readonly reuse?: RegionMesh;
  /** Sem AO (comparação nos prints e no Teste Zero). Padrão: com AO. */
  readonly noAo?: boolean;
}

/** Quantas regiões a grade tem em cada eixo. */
export function regionCounts(grid: WorldGrid): { readonly x: number; readonly y: number; readonly z: number } {
  return {
    x: Math.ceil(grid.chunksX / REGION_CHUNKS_X),
    y: Math.ceil(grid.chunksY / REGION_CHUNKS_Y),
    z: Math.ceil(grid.chunksZ / REGION_CHUNKS_Z),
  };
}

/**
 * Malhas de uma região (até 3). `light` `null` = luz cheia (céu e sol 15, emissivo 0), como o M0. Consulta os
 * vizinhos fora da região para não gerar faces escondidas na borda. No loading, uma região por fatia.
 */
export function buildRegionMesh(
  grid: WorldGrid,
  registry: BlockRegistry,
  light: LightField | null,
  rx: number,
  ry: number,
  rz: number,
  options?: RegionMeshOptions,
): RegionMesh {
  return buildRegion(grid, registry, light, rx, ry, rz, options);
}
