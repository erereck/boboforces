import { describe, expect, it } from 'vitest';
import { bleedTransparent, buildMipChain, coverage, mipSize } from './mips.ts';
import { createImage, createPaint } from './paint.ts';

const rgbAt = (img: { data: Uint8Array }, i: number): number =>
  (img.data[i * 4]! << 16) | (img.data[i * 4 + 1]! << 8) | img.data[i * 4 + 2]!;

describe('mips', () => {
  it('cadeia completa: 16 → 8, 4, 2, 1 e 64 → 32 … 1', () => {
    expect(buildMipChain(createImage(16), 'opaque', 5).map((m) => m.width)).toEqual([8, 4, 2, 1]);
    expect(buildMipChain(createImage(64), 'opaque', 7).map((m) => m.width)).toEqual([32, 16, 8, 4, 2, 1]);
    expect(mipSize(16, 9)).toBe(1);
  });

  it('cor chapada continua igual em todos os níveis (opaca com alfa 255)', () => {
    const img = createImage(16);
    createPaint(img, 't').fill(0x7d7f82);
    for (const mip of buildMipChain(img, 'opaque', 5)) {
      for (let i = 0; i < mip.width * mip.height; i++) {
        expect(rgbAt(mip, i)).toBe(0x7d7f82);
        expect(mip.data[i * 4 + 3]).toBe(255);
      }
    }
  });

  it('média em luz linear: preto + branco dá o cinza de 50% de luz (188), não 128', () => {
    const img = createImage(16);
    const p = createPaint(img, 't');
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.px(x, y, (x + y) % 2 === 0 ? 0xffffff : 0x000000);
    const [level1] = buildMipChain(img, 'opaque', 2);
    expect(level1!.data[0]).toBe(188);
  });

  it('cutout preserva a cobertura do nível 0 (até o 2×2) e não pinta texel sem cobertura', () => {
    // Cerca: losangos de 1 px (≈ 22% de cobertura), o caso que some ao longe sem preservação.
    const fence = createImage(16);
    const p = createPaint(fence, 't');
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) if ((x + y) % 8 === 0 || (x - y + 16) % 8 === 0) p.px(x, y, 0x959aa3);
    const c0 = coverage(fence);
    const chain = buildMipChain(fence, 'cutout', 5);
    for (const mip of chain.slice(0, 3)) {
      const n = mip.width * mip.height;
      expect(Math.abs(coverage(mip) - c0), `${mip.width}×${mip.width}`).toBeLessThanOrEqual(0.5 / n + 1e-9);
    }
    // Sem preservação, a média pura (alfa ≈ 0,22) cortaria tudo no 0,5 do shader.
    expect(coverage(chain[1]!)).toBeGreaterThan(0);

    const half = createImage(16);
    createPaint(half, 't').rect(0, 8, 16, 8, 0x4f7a3a);
    const [h1] = buildMipChain(half, 'cutout', 2);
    for (let x = 0; x < 8; x++) {
      expect(h1!.data[x * 4 + 3], 'linha de cima vazia').toBeLessThan(128);
      expect(h1!.data[(7 * 8 + x) * 4 + 3], 'linha de baixo cheia').toBeGreaterThanOrEqual(128);
    }
  });

  it('a cor dos buracos da cutout puxa a dos vizinhos (sem franja preta no filtro entre níveis)', () => {
    const img = createImage(16);
    createPaint(img, 't').rect(0, 0, 8, 16, 0x4f7a3a);
    const bled = bleedTransparent(img);
    expect(bled.data[(5 * 16 + 12) * 4 + 3]).toBe(0);
    expect(rgbAt(bled, 5 * 16 + 12)).toBe(0x4f7a3a);
  });

  it('translúcida: alfa médio e cor ponderada pelo alfa', () => {
    const img = createImage(16);
    const p = createPaint(img, 't');
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.pxa(x, y, x < 8 ? 0x6a7183 : 0xffffff, x < 8 ? 200 : 0);
    const [level1] = buildMipChain(img, 'translucent', 2);
    expect(level1!.data[3]).toBe(200);
    expect(rgbAt(level1!, 0)).toBe(0x6a7183);
    expect(level1!.data[(0 * 8 + 4) * 4 + 3]).toBe(0);
  });
});
