// Cache de skins do boneco do FutBobo (#56): 2 camadas por skin, pintor injetado; bots iguais = 1 skin, estouro divide
// a menos recente e conta no relatório. A skin de 4 camadas do bobo A saiu no passo 5 do porte.
import {
  FIGURE_LOOK_DEFAULT,
  FIGURE_PRESETS,
  FIGURE_SKIN_BYTES,
  FIGURE_SKIN_LAYERS,
  FIGURE_SKIN_LEVEL1_BYTES,
  paintFigureSkin,
  SKIN_LAYER_RESERVE,
  type FigureSkinRecipe,
} from '@boboforces/format';
import { describe, expect, it } from 'vitest';
import { createFigureSkinCache } from './skin-cache.ts';

const recipe = (look = FIGURE_LOOK_DEFAULT, team = -1): FigureSkinRecipe => ({
  look,
  team,
  teamColors: [0xff7a1a, 0x2e8bff],
});

describe('cache de skins do boneco (FIGURE_SKIN_LAYERS)', () => {
  it('2 camadas por skin, pintor injetado com buffers do tamanho certo e zerados, bots iguais = 1 skin', () => {
    const writes: [number, number, number][] = [];
    const painted: [number, number][] = [];
    const cache = createFigureSkinCache({
      firstLayer: 100,
      count: 7,
      paint: (_r, out, level1) => {
        painted.push([out.length, level1.length]);
        expect(out.every((b) => b === 0)).toBe(true);
        out.fill(9);
        level1.fill(3);
      },
      write: (layer, rgba, level1) => writes.push([layer, rgba.length, level1.length]),
    });
    expect(FIGURE_SKIN_LAYERS).toBe(2);
    expect(cache.slots).toBe(3);
    const a = cache.acquire(recipe());
    const b = cache.acquire(recipe(FIGURE_PRESETS.mechanic, 0));
    const c = cache.acquire(recipe());
    expect([a, b, c]).toEqual([100, 102, 100]);
    expect(painted).toEqual([
      [FIGURE_SKIN_BYTES, FIGURE_SKIN_LEVEL1_BYTES],
      [FIGURE_SKIN_BYTES, FIGURE_SKIN_LEVEL1_BYTES],
    ]);
    expect(writes.map((w) => w[0])).toEqual([100, 102]);
    expect(cache.stats).toMatchObject({ used: 2, composed: 2, hits: 1, overflows: 0 });
    // Time diferente = outra skin (o colete e o ícone mudam).
    expect(cache.acquire(recipe(FIGURE_PRESETS.mechanic, 1))).toBe(104);
    // Cheio: a 4ª aparência divide a menos recente e conta como estouro.
    cache.acquire(recipe(FIGURE_PRESETS.pilot, 0));
    expect(cache.stats.overflows).toBe(1);
    // Solta e reaproveita: a skin sem uso é a primeira a ir.
    cache.release(102);
    cache.release(102);
    expect(cache.acquire(recipe(FIGURE_PRESETS.zombie))).toBe(102);
    cache.clear();
    expect(cache.stats.used).toBe(0);
  });

  it('com o pintor de verdade (paintFigureSkin); reserva menor que uma skin é erro', () => {
    let painted: Uint8Array | null = null;
    const cache = createFigureSkinCache({
      firstLayer: 0,
      count: 4,
      paint: paintFigureSkin,
      write: (_l, rgba) => {
        painted = rgba.slice();
      },
    });
    cache.acquire(recipe(FIGURE_PRESETS.recruit, 0));
    // Frente da cabeça (camada 0) e a amostra da manga (paleta) pintadas e opacas.
    const at = (layer: number, x: number, y: number) => painted![((layer * 64 + y) * 64 + x) * 4 + 3];
    expect(at(0, 20, 20)).toBe(255);
    expect(at(0, 2, 10)).toBe(255);
    expect(at(1, 4, 12)).toBe(255);
    expect(() => createFigureSkinCache({ firstLayer: 0, count: 1, paint: paintFigureSkin, write: () => {} })).toThrow(
      /sem reserva/,
    );
  });

  it('a reserva de 64 camadas guarda 32 skins de 2; camada fora do começo de uma skin é ignorada no release', () => {
    const firstLayer = 24;
    const cache = createFigureSkinCache({ firstLayer, count: SKIN_LAYER_RESERVE, paint: () => {}, write: () => {} });
    expect(cache.slots).toBe(32);
    const looks = [FIGURE_LOOK_DEFAULT, FIGURE_PRESETS.mechanic, FIGURE_PRESETS.pilot];
    const layers = new Set<number>();
    for (const look of looks) for (const team of [-1, 0, 1]) layers.add(cache.acquire(recipe(look, team)));
    layers.add(cache.acquire(recipe(FIGURE_PRESETS.zombie)));
    expect(layers.size).toBe(10);
    for (const layer of layers) {
      expect((layer - firstLayer) % FIGURE_SKIN_LAYERS).toBe(0);
      expect(layer + FIGURE_SKIN_LAYERS).toBeLessThanOrEqual(firstLayer + SKIN_LAYER_RESERVE);
    }
    expect(cache.stats).toMatchObject({ used: 10, composed: 10, overflows: 0 });
    // Camada do meio de uma skin: o release não mexe em nada (a skin continua em uso).
    const small = createFigureSkinCache({ firstLayer: 0, count: 2, paint: () => {}, write: () => {} });
    const only = small.acquire(recipe());
    small.release(only + 1);
    small.acquire(recipe(FIGURE_PRESETS.mechanic));
    expect(small.stats).toMatchObject({ composed: 1, overflows: 1 });
  });
});
