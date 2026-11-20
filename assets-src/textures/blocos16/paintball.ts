/**
 * M10 (fase 0): as camadas do Galpão de Paintball (PLANO_M10 fase 3). No fim da tira: as de antes não mudam de lugar.
 * O colorido do galpão vem dos infláveis (props do `map-kit.ts`); o chão e a rede ficam calmos.
 *
 * - `turf` (contínuo, 3 variantes): grama sintética, mais lisa e uniforme que a `grass` (fios curtos de 2 px).
 * - `turf_line`: a linha branca pintada (o bloco inteiro, como as outras faixas).
 * - `net` (cutout): a rede escura de malha de 4 px com os nós (no painel fino; deixa passar bala e visão).
 */
import type { LayerRecipe, Paint } from '../../../tools/texgen/src/paint.ts';

/** Grama sintética: base média, fios de 2 px um tom acima, manchas escuras e a borracha (variante c). */
function paintTurf(p: Paint, variant: number): void {
  const g = p.ramp('grama');
  p.fill(g[2]!);
  p.blotches(3, g[1]!, 2, 2);
  for (let i = 0; i < 10; i++) p.vline(p.rng.int(0, 16), p.rng.int(0, 16), 2, g[3]!);
  if (variant === 1) p.blotches(2, g[3]!, 2, 3);
  if (variant === 2) for (let i = 0; i < 3; i++) p.hline(p.rng.int(0, 16), p.rng.int(0, 16), 2, g[1]!);
}

const turf: LayerRecipe = {
  name: 'turf',
  kind: 'opaque',
  material: 'continuo',
  variants: 3,
  draw: paintTurf,
};

/** Linha branca da quadra, gasta: a grama aparece em manchas pequenas. */
const turfLine: LayerRecipe = {
  name: 'turf_line',
  kind: 'opaque',
  material: 'sinal',
  draw(p) {
    const w = p.ramp('placa');
    p.fill(w[3]!);
    p.blotches(3, w[2]!, 2, 2);
    p.blotches(2, p.tone('grama', 2), 2, 2);
  },
};

/** Rede (cutout): fios de 1 px a cada 4 px (o vertical pega um pouco mais de luz) e os nós um tom acima. */
const net: LayerRecipe = {
  name: 'net',
  kind: 'cutout',
  material: 'modular',
  draw(p) {
    const c = p.ramp('concreto');
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const vx = x % 4 === 0;
        const hy = y % 4 === 0;
        if (vx && hy) p.px(x, y, c[2]!);
        else if (vx) p.px(x, y, c[1]!);
        else if (hy) p.px(x, y, c[0]!);
      }
    }
  },
};

export const PAINTBALL_TEXTURES: readonly LayerRecipe[] = [turf, turfLine, net];
