/**
 * Receitas da tira `modelos64-materiais` (camadas 64×64 do array `modelos64`, a primeira tira dele; tecnico.md §6.1):
 * - `mat_white`: a camada branca dos detritos (o cubinho usa branco × a cor sólida da instância, tecnico.md §6.6);
 * - `mat_*`: material do cenário que uma prop usa, como tile 64×64 do MESMO material (arte-ux.md §1.2), na mesma
 *   densidade de 32 px/m: 4×4 blocos de 0,5 m = 2 m de material. Materiais contínuos sorteiam a variante por bloco,
 *   para a prop não repetir o mesmo desenho 16 vezes.
 * As camadas de `modelos64` são resolvidas por nome; o prefixo `mat_` evita colisão com a tira do modelgen (a do
 * skingen, com as folhas de rosto do bobo A, saiu no passo 5 do porte; os nomes `faces`/`faces_zombie` não voltam).
 */
import type { LayerRecipe, MaterialClass, TextureKind } from '../../tools/texgen/src/paint.ts';
import { renderRecipe } from '../../tools/texgen/src/paint.ts';
import { BLOCK_TEXTURES } from './blocks16.ts';

const BLOCK = 16;

function blockRecipe(name: string): LayerRecipe {
  const r = BLOCK_TEXTURES.find((t) => t.name === name);
  if (!r) throw new Error(`modelos64: camada de bloco "${name}" não existe`);
  return r;
}

/** Tile 64×64 de uma camada de bloco (4×4 cópias; variante sorteada por bloco quando a receita tem variantes). */
function tileFrom(name: string, source: string, kind: TextureKind, material: MaterialClass): LayerRecipe {
  return {
    name,
    kind,
    material,
    draw(p) {
      const src = blockRecipe(source);
      const variants = src.variants ?? 1;
      const tiles = Array.from({ length: variants }, (_, v) => renderRecipe(src, BLOCK, v, 0));
      for (let ty = 0; ty < p.size / BLOCK; ty++) {
        for (let tx = 0; tx < p.size / BLOCK; tx++) {
          const img = tiles[variants > 1 ? p.rng.int(0, variants) : 0]!;
          for (let y = 0; y < BLOCK; y++) {
            for (let x = 0; x < BLOCK; x++) {
              const i = (y * BLOCK + x) * 4;
              const d = img.data;
              const alpha = d[i + 3]!;
              if (alpha === 0) continue;
              p.pxa(tx * BLOCK + x, ty * BLOCK + y, (d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!, alpha);
            }
          }
        }
      }
    },
  };
}

const white: LayerRecipe = {
  name: 'mat_white',
  kind: 'opaque',
  material: 'modular',
  draw(p) {
    p.fill(p.tone('neutro', 1));
  },
};

export const MODEL_MATERIAL_TEXTURES: readonly LayerRecipe[] = [
  white,
  tileFrom('mat_concrete', 'concrete', 'opaque', 'continuo'),
  tileFrom('mat_metal', 'metal', 'opaque', 'modular'),
  tileFrom('mat_checker_plate', 'checker_plate', 'opaque', 'modular'),
  tileFrom('mat_metal_roof', 'metal_roof', 'opaque', 'continuo'),
  tileFrom('mat_wood', 'wood', 'opaque', 'modular'),
  tileFrom('mat_canvas', 'canvas', 'opaque', 'continuo'),
  tileFrom('mat_log', 'log', 'opaque', 'continuo'),
  tileFrom('mat_leaves', 'leaves', 'cutout', 'vegetacao'),
];
