import { createDrawList, popClip, pushClip, pushGlyph, pushShape, pushSprite, resetDrawList } from '@boboforces/ui';
import { describe, expect, it } from 'vitest';
import { buildUiBatch, createUiBatch, UI_FLOATS_PER_VERTEX, UI_MODE, type UiAtlasInfo } from './ui-batch.ts';

const atlas: UiAtlasInfo = { width: 512, height: 256, layers: 3, msdfRanges: [4, 4, 0], spriteBase: 2 };

/** Vértice `v` (0..3) do quad `q`. */
function vertex(batch: ReturnType<typeof createUiBatch>, q: number, v: number): number[] {
  const o = (q * 4 + v) * UI_FLOATS_PER_VERTEX;
  return Array.from(batch.vertices.subarray(o, o + UI_FLOATS_PER_VERTEX));
}

describe('DrawList → lote de quads', () => {
  it('retângulo: coordenada local em px, tamanho e forma (chanfro, contorno, faixa) no vértice', () => {
    const dl = createDrawList(8);
    resetDrawList(dl, 1280, 720);
    pushShape(dl, 10, 20, 100, 40, 0x11223344, 6, 2, 8);
    const batch = createUiBatch(4);
    expect(buildUiBatch(dl, null, batch)).toBe(1);
    expect(vertex(batch, 0, 0)).toEqual([10, 20, 0, 0, UI_MODE.rect, 0, 100, 40, 6, 2, 8, 0]);
    expect(vertex(batch, 0, 3).slice(0, 4)).toEqual([110, 60, 100, 40]);
    expect(Array.from(batch.colors.subarray(0, 4))).toEqual([0x11, 0x22, 0x33, 0x44]);
    expect(Array.from(batch.colors.subarray(12, 16))).toEqual([0x11, 0x22, 0x33, 0x44]);
  });

  it('glifo: faixa MSDF em px de tela pela escala do quad e do DPR; sem atlas é pulado', () => {
    const dl = createDrawList(8);
    resetDrawList(dl, 1280, 720);
    // Glifo de 16 px no atlas (u 0..16/512) desenhado com 32 px de largura → escala 2 → faixa 4·2 = 8.
    pushGlyph(dl, 0, 0, 32, 40, 0, 0, 16 / 512, 20 / 256, 0xffffffff, 1);
    expect(buildUiBatch(dl, null, createUiBatch())).toBe(0);
    const batch = createUiBatch();
    expect(buildUiBatch(dl, atlas, batch)).toBe(1);
    expect(vertex(batch, 0, 0).slice(4, 7)).toEqual([UI_MODE.glyph, 1, 8]);
    buildUiBatch(dl, atlas, batch, 1.5);
    expect(vertex(batch, 0, 0)[6]).toBeCloseTo(12);
  });

  it('sprite usa a camada spriteBase + página; página fora do atlas é pulada', () => {
    const dl = createDrawList(8);
    resetDrawList(dl, 1280, 720);
    pushSprite(dl, 0, 0, 8, 8, 0, 0, 1, 1, 0xffffffff, 0);
    pushSprite(dl, 0, 0, 8, 8, 0, 0, 1, 1, 0xffffffff, 5);
    const batch = createUiBatch();
    expect(buildUiBatch(dl, atlas, batch)).toBe(1);
    expect(vertex(batch, 0, 0).slice(4, 6)).toEqual([UI_MODE.sprite, 2]);
  });

  it('recorte na CPU: corta o quad e interpola uv; recortes aninhados se intersectam; pop restaura', () => {
    const dl = createDrawList(16);
    resetDrawList(dl, 1280, 720);
    pushClip(dl, 0, 0, 50, 100);
    pushClip(dl, 25, 0, 100, 100); // intersecção: x 25..50
    pushGlyph(dl, 0, 0, 100, 10, 0, 0, 1, 1, 0xffffffff, 0);
    popClip(dl);
    pushShape(dl, 40, 0, 20, 10, 0xffffffff, 0); // só o primeiro recorte: x 40..50
    popClip(dl);
    pushShape(dl, 200, 0, 10, 10, 0xffffffff, 0); // fora de qualquer recorte: inteiro
    pushShape(dl, 0, 0, 10, 10, 0xffffffff, 0);
    const batch = createUiBatch();
    expect(buildUiBatch(dl, atlas, batch)).toBe(4);
    expect(vertex(batch, 0, 0).slice(0, 4)).toEqual([25, 0, 0.25, 0]);
    expect(vertex(batch, 0, 3).slice(0, 4)).toEqual([50, 10, 0.5, 1]);
    expect(vertex(batch, 1, 0).slice(0, 4)).toEqual([40, 0, 0, 0]);
    expect(vertex(batch, 1, 3).slice(0, 4)).toEqual([50, 10, 10, 10]);
    expect(vertex(batch, 1, 0).slice(6, 8)).toEqual([20, 10]); // o tamanho da forma não muda com o recorte
    expect(vertex(batch, 2, 0).slice(0, 2)).toEqual([200, 0]);
  });

  it('cresce quando a lista passa da capacidade (e conta)', () => {
    const dl = createDrawList(64);
    resetDrawList(dl, 1280, 720);
    for (let i = 0; i < 40; i++) pushShape(dl, i, 0, 1, 1, 0xffffffff, 0);
    const batch = createUiBatch(16);
    expect(buildUiBatch(dl, null, batch)).toBe(40);
    expect(batch.capacity).toBeGreaterThanOrEqual(40);
    expect(batch.grows).toBe(1);
    expect(vertex(batch, 39, 0)[0]).toBe(39);
  });
});
