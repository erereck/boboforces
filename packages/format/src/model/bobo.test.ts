import { describe, expect, it } from 'vitest';
import { SKIN_LAYER_RESERVE, TEXTURE_ARRAYS } from '../layers.ts';
import {
  boxCrossRects,
  FACE_EXPRESSION,
  FACE_EXPRESSIONS,
  SKIN_FACE_AXES,
  ZOMBIE_KINDS,
  ZOMBIE_SCALE,
} from './bobo.ts';
import { FIGURE_SKIN_LAYERS } from './figure-layout.ts';

describe('o que fica do bobo de caixas (#56, PLANO do porte §B18)', () => {
  it('cruz de uma caixa: 6 retângulos na ordem de FACE, sem sobrepor, no envelope (2d + 2w) × (d + h)', () => {
    const [w, h, d] = [8, 12, 4];
    const rects = boxCrossRects(3, 5, w, h, d);
    expect(rects.map((r) => [r.w, r.h])).toEqual([
      [d, h],
      [d, h],
      [w, d],
      [w, d],
      [w, h],
      [w, h],
    ]);
    const used = new Set<string>();
    for (const r of rects) {
      expect(r.u >= 3 && r.v >= 5 && r.u + r.w <= 3 + 2 * d + 2 * w && r.v + r.h <= 5 + d + h).toBe(true);
      for (let y = r.v; y < r.v + r.h; y++) {
        for (let x = r.u; x < r.u + r.w; x++) {
          expect(used.has(`${x},${y}`), `(${x}, ${y})`).toBe(false);
          used.add(`${x},${y}`);
        }
      }
    }
    // Frente (-Z) logo à direita da lateral +X, topo em cima da frente.
    expect(rects[5]).toEqual({ u: 3 + d, v: 5 + d, w, h });
    expect(rects[2]).toEqual({ u: 3 + d, v: 5, w, h: d });
  });

  it('eixos de textura por face: unitários, ortogonais e no plano da face', () => {
    const normals = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ] as const;
    const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    SKIN_FACE_AXES.forEach((axes, face) => {
      expect(dot(axes.u, axes.u)).toBe(1);
      expect(dot(axes.v, axes.v)).toBe(1);
      expect(dot(axes.u, axes.v)).toBe(0);
      expect(dot(axes.u, normals[face]!)).toBe(0);
      expect(dot(axes.v, normals[face]!)).toBe(0);
    });
  });

  it('expressões e zumbis: índices estáveis e escala de todo tipo', () => {
    FACE_EXPRESSIONS.forEach((name, k) => expect(FACE_EXPRESSION[name]).toBe(k));
    expect(FACE_EXPRESSIONS).toHaveLength(8);
    for (const kind of ZOMBIE_KINDS) expect(ZOMBIE_SCALE[kind]).toBeGreaterThan(0);
  });

  it('a reserva do modelos64 guarda skins inteiras do boneco: 32 skins de 2 camadas', () => {
    expect(SKIN_LAYER_RESERVE % FIGURE_SKIN_LAYERS).toBe(0);
    expect(SKIN_LAYER_RESERVE / FIGURE_SKIN_LAYERS).toBe(32);
    expect(SKIN_LAYER_RESERVE).toBeLessThan(TEXTURE_ARRAYS.modelos64.maxLayers);
  });
});
