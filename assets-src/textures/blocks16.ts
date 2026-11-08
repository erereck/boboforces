/**
 * Receitas das camadas de `blocos16` (16×16 px por face de bloco de 0,5 m, decisão #6). Fonte da verdade em texto
 * (arte-ux.md §12): o `tools/texgen` roda estas receitas, valida contra a paleta mestra e grava a tira, os mips e o
 * manifesto `layers@1` em `generated/`. Regenerar: `npm run texgen`.
 *
 * As camadas são resolvidas SEMPRE por nome (o `BlockDef` aponta a face pelo nome e o runtime acha o índice no
 * manifesto); a ordem da lista só agrupa por família. Camada publicada nunca muda de nome: os nomes do M0 (`concrete`,
 * `metal`, `wood`, `grass`, `grass_side`, `dirt`, `brick`, `test_floor`) continuam valendo.
 *
 * Regras de pixel-art (arte-ux.md §1.3): materiais contínuos (concreto, grama, terra, água) são seamless e sem borda;
 * modulares (placa, painel, tijolo, tábua, caixote) têm bevel de 1 px (+1 tom em cima/esquerda, −1 embaixo/direita);
 * manchas de 2–3 px, nada de xadrez; sombreado pintado de no máximo ±1 tom, porque o volume vem da luz do motor.
 */
import type { LayerRecipe } from '../../tools/texgen/src/paint.ts';
import { BENCH_TEXTURES } from './blocos16/bancada.ts';
import { CONSTRUTO_TEXTURES } from './blocos16/construto.ts';
import { METAL_WOOD_TEXTURES } from './blocos16/metal-madeira.ts';
import { NATURE_TEXTURES } from './blocos16/natureza.ts';
import { SIGN_TEXTURES } from './blocos16/sinais.ts';

export const BLOCK_TEXTURES: readonly LayerRecipe[] = [
  ...CONSTRUTO_TEXTURES,
  ...METAL_WOOD_TEXTURES,
  ...NATURE_TEXTURES,
  ...SIGN_TEXTURES,
  ...BENCH_TEXTURES,
];
