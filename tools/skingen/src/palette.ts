// Paleta mestra da frente de texturas (tools/texgen, só leitura; arte-ux.md §1.3), reexportada para o `modelgen` e as
// receitas de `assets-src/models/` (props e armas). As peças de skin tingíveis do bobo A, a única exceção, saíram no
// passo 5 do porte do boneco (#56).
import { inPalette, PALETTE, ramp, RAMPS, type RampName } from '../../texgen/src/palette.ts';

export { inPalette, PALETTE, ramp, RAMPS, type RampName };

/** Cor `i` da rampa (do escuro para o claro), presa às pontas. */
export function tone(name: RampName, i: number): number {
  const r = ramp(name);
  return r[Math.max(0, Math.min(r.length - 1, i))]!;
}

/** Rampa (e posição) de uma cor da paleta; `undefined` se a cor não estiver em nenhuma. */
export function rampOf(rgb: number): { readonly colors: readonly number[]; readonly index: number } | undefined {
  for (const r of RAMPS) {
    const index = (r.colors as readonly number[]).indexOf(rgb);
    if (index >= 0) return { colors: r.colors, index };
  }
  return undefined;
}

/** A cor `delta` tons acima (+) ou abaixo (−) na mesma rampa (sombreado pintado de ±1 tom). */
export function shiftTone(rgb: number, delta: number): number {
  const r = rampOf(rgb);
  if (r === undefined) return rgb;
  return r.colors[Math.max(0, Math.min(r.colors.length - 1, r.index + delta))]!;
}
