import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIGURE_BONE, FIGURE_BOX_FIELD as F, FIGURE_BOX_FLAG, FIGURE_BOX_STRIDE } from './figure.ts';
import {
  FIGURE_BEARD_LONG,
  FIGURE_EARRING,
  FIGURE_HAIR_MAX_BOXES,
  FIGURE_HEADWEAR,
  figureHairBoxes,
} from './figure-hair.ts';
import { FIGURE_LAYOUT, FIGURE_SWATCH, figureSwatchCorner } from './figure-layout.ts';
import { FIGURE_LOOK_DEFAULT, type FigureLook } from './figure-look.ts';

/**
 * Cabelo do FutBobo medido no próprio FutBobo (estudo do porte, `cabelo.json`): por corte, as caixas e a AABB do
 * cabelo no espaço do pescoço (px; min x, y, z, max x, y, z; arredondada a 0,001), sem chapéu, barba nem brinco.
 */
const STUDY_CUTS: readonly (readonly [number, readonly number[] | null])[] = [
  [1, [-4.25, 7.85, -4.25, 4.25, 8.95, 4.25]],
  [2, [-4.25, 6.65, -4.25, 4.25, 8.95, 4.5]],
  [10, [-4.35, 7.85, -4.35, 4.35, 10.1, 4.35]],
  [1, [-0.95, 7.75, -4.4, 0.95, 10.85, 4.4]],
  [1, [-5.3, 5.6, -5.6, 5.3, 11, 5]],
  [0, null],
  [5, [-4.2, 2.5, -4.85, 4.2, 8.75, 4.2]],
  [2, [-4.25, 7.85, -4.35, 4.3, 9.55, 4.35]],
  [2, [-4.25, 7.85, -4.25, 4.25, 11.276, 4.414]],
  [9, [-4.8, -0.1, -4.8, 4.8, 9.05, 4.35]],
  [2, [-4.2, 7.85, -4.2, 4.2, 11.7, 4.2]],
  [1, [-4.25, 7.85, -4.25, 4.25, 8.95, 4.25]],
  [0, null],
  [2, [-4.25, 1.8, -4.95, 4.25, 8.95, 4.25]],
  [1, [-4.45, 5.45, -4.45, 4.45, 8.95, 4.45]],
  [1, [-1.8, 7.85, -4.4, 1.8, 9.95, 4.4]],
  [17, [-4.2, 7.85, -4.2, 4.2, 10.2, 4.2]],
  [2, [-4.25, 5.3, -4.25, 4.25, 8.95, 4.5]],
  [1, [-3.7, 7.8, -4.2, 3.7, 9.6, 4.2]],
  [3, [-4.2, 2.412, -6.977, 4.2, 8.75, 4.2]],
  [0, null],
  [1, [-4.65, 7.65, -4.65, 4.65, 10.15, 4.65]],
  [2, [-1.6, 7.85, 0.6, 1.6, 8.65, 4.1]],
  [5, [-4.9, -1.9, -4.9, 4.9, 9.05, 4.4]],
  [15, [-4.282, 7.837, -4.265, 4.25, 12.113, 4.374]],
  [4, [-4.25, 5.955, -4.35, 4.25, 9.192, 4.5]],
  [1, [-3.8, 7, -3.9, 3.8, 12.2, 3.7]],
  [10, [-3.5, 3.45, -4.4, 3.5, 8.475, 4.15]],
  [4, [-4.1, 7.9, -2.2, 4.1, 11.1, 1]],
  [3, [-4.3, 6.9, -4.4, 4.3, 9.1, 2.2]],
  [11, [-0.95, 7.85, -5.001, 0.95, 13.3, 5.068]],
  [5, [-7.2, 4.1, -7.5, 7.2, 15.2, 5.5]],
  [6, [-4.8, 1.6, -4.8, 4.8, 9.6, 4.75]],
  [15, [-4.25, -7.242, -5.486, 4.25, 8.85, 4.25]],
];
/** Extras medidos sobre o careca (corte 12): [look, caixas, AABB]. */
const STUDY_EXTRAS: readonly (readonly [Partial<FigureLook>, number, readonly number[]])[] = [
  [{ beard: FIGURE_BEARD_LONG }, 2, [-3.2, -3.75, 2.7, 3.2, 0.35, 4.2]],
  [{ headwear: FIGURE_HEADWEAR.band }, 1, [-4.15, 6.5, -4.15, 4.15, 7.5, 4.15]],
  [{ headwear: FIGURE_HEADWEAR.tiara }, 1, [-4.15, 7, -4.15, 4.15, 7.5, 4.15]],
  [{ headwear: FIGURE_HEADWEAR.bandana }, 3, [-1.229, 3.713, -4.939, 1.213, 6.85, -3.9]],
  [{ headwear: FIGURE_HEADWEAR.cap }, 4, [-4.5, 6.541, -4.5, 4.5, 10.225, 8.309]],
  [{ earrings: FIGURE_EARRING.stud }, 1, [3.925, 2.025, -0.025, 4.475, 2.575, 0.525]],
  [{ earrings: FIGURE_EARRING.pair }, 2, [-4.475, 2.025, -0.025, 4.475, 2.575, 0.525]],
  [{ earrings: FIGURE_EARRING.hoops }, 8, [-4.35, 1.05, -0.4, 4.35, 2.35, 0.9]],
];

const look = (over: Partial<FigureLook>): FigureLook => ({
  ...FIGURE_LOOK_DEFAULT,
  beard: 0,
  headwear: 0,
  earrings: 0,
  ...over,
});
const scratch = new Float32Array(40 * FIGURE_BOX_STRIDE);

/** Meia AABB (x, y, z) da caixa i (giro Rx(rotX)·Rz(rotZ)) e o centro. */
function aabb(out: Float32Array, i: number): { c: number[]; e: number[] } {
  const o = i * FIGURE_BOX_STRIDE;
  const cx = Math.cos(out[o + F.rotX]!);
  const sx = Math.sin(out[o + F.rotX]!);
  const cz = Math.cos(out[o + F.rotZ]!);
  const sz = Math.sin(out[o + F.rotZ]!);
  const r = [cz, -sz, 0, cx * sz, cx * cz, -sx, sx * sz, sx * cz, cx];
  const h = [out[o + F.sx]! / 2, out[o + F.sy]! / 2, out[o + F.sz]! / 2];
  const e = [0, 1, 2].map(
    (a) => Math.abs(r[a * 3]!) * h[0]! + Math.abs(r[a * 3 + 1]!) * h[1]! + Math.abs(r[a * 3 + 2]!) * h[2]!,
  );
  return { c: [out[o + F.cx]!, out[o + F.cy]!, out[o + F.cz]!], e };
}

function extent(out: Float32Array, n: number): number[] {
  const m = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const { c, e } = aabb(out, i);
    for (let a = 0; a < 3; a++) {
      m[a] = Math.min(m[a]!, c[a]! - e[a]!);
      m[a + 3] = Math.max(m[a + 3]!, c[a]! + e[a]!);
    }
  }
  return m;
}

/** Amostra da paleta lida pela caixa i (pelo canto da UV). */
function swatchOf(out: Float32Array, i: number): number {
  const o = i * FIGURE_BOX_STRIDE;
  const corner = out[o + F.u]! + 64 * out[o + F.v]!;
  for (let s = 0; s < 16; s++) if (figureSwatchCorner(s) === corner) return s;
  return -1;
}

describe('cabelo do boneco (E.10)', () => {
  it('caixas por corte = lista do FutBobo (1, 2, 10, 1, 1, 0, 5, …, 15) e AABB = estudo ± 0,001 px', () => {
    expect(STUDY_CUTS.map(([n]) => n)).toEqual([
      1, 2, 10, 1, 1, 0, 5, 2, 2, 9, 2, 1, 0, 2, 1, 1, 17, 2, 1, 3, 0, 1, 2, 5, 15, 4, 1, 10, 4, 3, 11, 5, 6, 15,
    ]);
    STUDY_CUTS.forEach(([boxes, box], hairStyle) => {
      const n = figureHairBoxes(look({ hairStyle }), scratch, 0);
      expect(n, `corte ${hairStyle}`).toBe(boxes);
      if (box === null) return;
      const m = extent(scratch, n);
      for (let k = 0; k < 6; k++) expect(Math.abs(m[k]! - box[k]!), `corte ${hairStyle} [${k}]`).toBeLessThan(1e-3);
      // O topo (acima da cabeça, que vai até y 8) é o número do estudo.
      expect(Math.abs(m[4]! - 8 - (box[4]! - 8))).toBeLessThan(1e-3);
    });
  });

  it('barba longa, os 4 chapéus e os brincos: caixas e AABB = estudo ± 0,001 px', () => {
    for (const [extra, boxes, box] of STUDY_EXTRAS) {
      const n = figureHairBoxes(look({ hairStyle: 12, ...extra }), scratch, 0);
      expect(n, JSON.stringify(extra)).toBe(boxes);
      const m = extent(scratch, n);
      for (let k = 0; k < 6; k++)
        expect(Math.abs(m[k]! - box[k]!), `${JSON.stringify(extra)} [${k}]`).toBeLessThan(1e-3);
    }
  });

  it('≤ 28 caixas nas 1.360 combinações (corte × chapéu × barba longa × brincos), nenhum NaN, tudo no osso head', () => {
    let max = 0;
    const allowed = [
      FIGURE_SWATCH.hair,
      FIGURE_SWATCH.hairShade,
      FIGURE_SWATCH.beard,
      FIGURE_SWATCH.accessory,
      FIGURE_SWATCH.accessoryShade,
      FIGURE_SWATCH.gold,
    ] as number[];
    for (let hairStyle = 0; hairStyle < 34; hairStyle++)
      for (let headwear = 0; headwear < 5; headwear++)
        for (const beard of [0, FIGURE_BEARD_LONG])
          for (let earrings = 0; earrings < 4; earrings++) {
            const out = new Float32Array(FIGURE_HAIR_MAX_BOXES * FIGURE_BOX_STRIDE);
            const n = figureHairBoxes(look({ hairStyle, headwear, beard, earrings }), out, 0);
            max = Math.max(max, n);
            expect(n).toBeLessThanOrEqual(FIGURE_HAIR_MAX_BOXES);
            expect(out.every((v) => Number.isFinite(v))).toBe(true);
            for (let i = 0; i < n; i++) {
              const o = i * FIGURE_BOX_STRIDE;
              expect(out[o + F.bone]).toBe(FIGURE_BONE.head);
              expect(out[o + F.flags]).toBe(FIGURE_BOX_FLAG.hair);
              expect(out[o + F.layer]).toBe(FIGURE_LAYOUT.palette.layer);
              expect([out[o + F.w], out[o + F.h], out[o + F.d]]).toEqual([0, 0, 0]);
              expect(allowed).toContain(swatchOf(out, i));
              for (const f of [F.sx, F.sy, F.sz]) expect(out[o + f]).toBeGreaterThan(0);
            }
          }
    expect(max).toBe(FIGURE_HAIR_MAX_BOXES);
  });

  it('tons: cabelo, sombra (elos da trança), barba, acessório, sombra do acessório e ouro', () => {
    const tones = (l: Partial<FigureLook>): number[] => {
      const n = figureHairBoxes(look(l), scratch, 0);
      return Array.from({ length: n }, (_, i) => swatchOf(scratch, i));
    };
    const S = FIGURE_SWATCH;
    // Trança longa: casca, laço, 6 × (elo, sombra) e a ponta.
    expect(tones({ hairStyle: 33 })).toEqual([S.hair, S.hair, ...Array(6).fill([S.hair, S.hairShade]).flat(), S.hair]);
    expect(tones({ hairStyle: 12, beard: FIGURE_BEARD_LONG })).toEqual([S.beard, S.beard]);
    expect(tones({ hairStyle: 12, headwear: FIGURE_HEADWEAR.cap })).toEqual([
      S.accessory,
      S.accessory,
      S.accessoryShade,
      S.accessoryShade,
    ]);
    expect(tones({ hairStyle: 12, headwear: FIGURE_HEADWEAR.bandana })).toEqual([
      S.accessory,
      S.accessoryShade,
      S.accessoryShade,
    ]);
    expect(tones({ hairStyle: 12, earrings: FIGURE_EARRING.pair })).toEqual([S.gold, S.gold]);
  });

  it('boné e bandana tiram o cabelo de centro acima de 7,9 px; o black power escapa pelos lados', () => {
    for (let hairStyle = 0; hairStyle < 34; hairStyle++) {
      for (const headwear of [FIGURE_HEADWEAR.cap, FIGURE_HEADWEAR.bandana]) {
        const n = figureHairBoxes(look({ hairStyle, headwear }), scratch, 0);
        for (let i = 0; i < n; i++) {
          const s = swatchOf(scratch, i);
          if (s === FIGURE_SWATCH.hair || s === FIGURE_SWATCH.hairShade) {
            expect(scratch[i * FIGURE_BOX_STRIDE + F.cy]!, `corte ${hairStyle}`).toBeLessThanOrEqual(7.9);
          }
        }
      }
    }
    const n = figureHairBoxes(look({ hairStyle: 4, headwear: FIGURE_HEADWEAR.cap }), scratch, 0);
    expect(Array.from(scratch.subarray(F.cx, F.sz + 1))).toEqual([0, 6.6, -1, 9.8, 2.2, 9.6].map(Math.fround));
    expect(n).toBe(5);
  });

  it('o around abraça o cabelo da faixa: a faixa contém (x, z) todo cabelo largo da faixa y 6,5..7,5, com 0,15 de folga', () => {
    for (let hairStyle = 0; hairStyle < 34; hairStyle++) {
      const n = figureHairBoxes(look({ hairStyle, headwear: FIGURE_HEADWEAR.band }), scratch, 0);
      const band = aabb(scratch, n - 1);
      expect(swatchOf(scratch, n - 1)).toBe(FIGURE_SWATCH.accessory);
      expect(scratch[(n - 1) * FIGURE_BOX_STRIDE + F.cy]).toBe(7);
      // A cabeça (±4) e a folga entram sempre.
      for (const a of [0, 2]) expect(band.e[a]! - Math.abs(band.c[a]!)).toBeGreaterThanOrEqual(4.15 - 1e-5);
      for (let i = 0; i < n - 1; i++) {
        const { c, e } = aabb(scratch, i);
        if (c[1]! + e[1]! < 6.7 || c[1]! - e[1]! > 7.3 || Math.max(2 * e[0]!, 2 * e[2]!) < 3) continue;
        for (const a of [0, 2]) {
          expect(c[a]! - e[a]! - 0.15, `corte ${hairStyle} caixa ${i}`).toBeGreaterThanOrEqual(
            band.c[a]! - band.e[a]! - 1e-5,
          );
          expect(c[a]! + e[a]! + 0.15, `corte ${hairStyle} caixa ${i}`).toBeLessThanOrEqual(
            band.c[a]! + band.e[a]! + 1e-5,
          );
        }
      }
    }
  });

  it('pontas giradas: rotX/rotZ do FutBobo (espetos do corte 24 inclinados para fora)', () => {
    const n = figureHairBoxes(look({ hairStyle: 24 }), scratch, 0);
    // Casca sem giro; o 1º espeto em (−2,6; −2,4): Rx(−0,24)·Rz(0,26).
    expect([scratch[F.rotX], scratch[F.rotZ]]).toEqual([0, 0]);
    expect(scratch[FIGURE_BOX_STRIDE + F.rotX]).toBeCloseTo(-0.24, 6);
    expect(scratch[FIGURE_BOX_STRIDE + F.rotZ]).toBeCloseTo(0.26, 6);
    expect(n).toBe(15);
  });

  it('escreve só em out[o .. o + n·stride), determinístico', () => {
    const l = look({ hairStyle: 16, headwear: FIGURE_HEADWEAR.band, beard: FIGURE_BEARD_LONG, earrings: 3 });
    const out = new Float32Array(3 + 30 * FIGURE_BOX_STRIDE).fill(-9);
    const n = figureHairBoxes(l, out, 3);
    expect(n).toBe(28);
    expect(Array.from(out.subarray(0, 3))).toEqual([-9, -9, -9]);
    expect(out[3 + n * FIGURE_BOX_STRIDE]).toBe(-9);
    const again = new Float32Array(3 + 30 * FIGURE_BOX_STRIDE).fill(-9);
    figureHairBoxes(l, again, 3);
    expect(Array.from(again)).toEqual(Array.from(out));
  });

  it('importar o módulo não monta nada (só constantes e funções no topo)', () => {
    const src = readFileSync(new URL('./figure-hair.ts', import.meta.url), 'utf8');
    for (const line of src.split('\n')) {
      if (/^(export )?(const|let|var) /.test(line)) expect(line, line).not.toMatch(/new |\(/);
      expect(line, line).not.toMatch(/^[A-Za-z_$][\w$.]*\(/);
    }
  });
});
