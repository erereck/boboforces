import { describe, expect, it } from 'vitest';
import { createImage, createPaint } from './paint.ts';
import { ramp } from './palette.ts';
import { countCheckerWindows, validateTexture } from './validate.ts';

const solid = (rgb: number, size = 16): ReturnType<typeof createImage> => {
  const img = createImage(size);
  createPaint(img, 'teste').fill(rgb);
  return img;
};

describe('validador de camadas', () => {
  it('aceita camada só com cores da paleta', () => {
    expect(validateTexture('ok', solid(ramp('concreto')[2]!), { size: 16, kind: 'opaque' })).toEqual([]);
    expect(validateTexture('ok', solid(ramp('aco')[1]!, 64), { size: 64, kind: 'emissive' })).toEqual([]);
  });

  it('reprova cor fora da paleta e tamanho errado', () => {
    expect(validateTexture('x', solid(0x123456), { size: 16, kind: 'opaque' })[0]).toMatch(/fora da paleta.*#123456/);
    expect(validateTexture('x', createImage(32), { size: 16, kind: 'opaque' }).join()).toMatch(/32×32/);
  });

  it('reprova alfa parcial e buraco em camada opaca ou emissiva', () => {
    const partial = solid(ramp('grama')[1]!);
    partial.data[3] = 128;
    expect(validateTexture('x', partial, { size: 16, kind: 'opaque' }).join()).toMatch(/alfa parcial/);
    expect(validateTexture('x', partial, { size: 16, kind: 'emissive' }).join()).toMatch(/alfa parcial/);
    const hole = solid(ramp('grama')[1]!);
    createPaint(hole, 'teste').clear(3, 3);
    expect(validateTexture('x', hole, { size: 16, kind: 'opaque' }).join()).toMatch(/transparente/);
  });

  it('cutout: alfa só 0 ou 255 e pelo menos um buraco', () => {
    const hole = solid(ramp('grama')[1]!);
    createPaint(hole, 'teste').clear(3, 3);
    expect(validateTexture('x', hole, { size: 16, kind: 'cutout' })).toEqual([]);
    expect(validateTexture('x', solid(ramp('grama')[1]!), { size: 16, kind: 'cutout' }).join()).toMatch(/sem nenhum/);
    hole.data[3] = 200;
    expect(validateTexture('x', hole, { size: 16, kind: 'cutout' }).join()).toMatch(/alfa parcial/);
  });

  it('translúcida precisa de alfa parcial', () => {
    const glass = solid(ramp('aco')[3]!);
    expect(validateTexture('x', glass, { size: 16, kind: 'translucent' }).join()).toMatch(/sem alfa parcial/);
    createPaint(glass, 'teste').pxa(1, 1, ramp('aco')[3]!, 70);
    expect(validateTexture('x', glass, { size: 16, kind: 'translucent' })).toEqual([]);
  });

  it('cor de time e preto puro ficam fora do cenário (só o debug usa)', () => {
    const team = solid(ramp('time')[0]!);
    expect(validateTexture('x', team, { size: 16, kind: 'opaque' }).join()).toMatch(/reservada/);
    expect(validateTexture('x', team, { size: 16, kind: 'opaque', material: 'debug' })).toEqual([]);
    expect(validateTexture('x', solid(0x000000), { size: 16, kind: 'opaque' }).join()).toMatch(/reservada/);
  });

  it('xadrez de dithering reprova material contínuo', () => {
    const img = solid(ramp('concreto')[3]!);
    const p = createPaint(img, 'teste');
    for (let y = 4; y < 10; y++) for (let x = 4; x < 10; x++) if ((x + y) % 2 === 0) p.px(x, y, ramp('concreto')[2]!);
    expect(countCheckerWindows(img)).toBeGreaterThan(10);
    expect(validateTexture('x', img, { size: 16, kind: 'opaque', material: 'continuo' }).join()).toMatch(/xadrez/);
    // Modular pode ter padrão regular (chapa xadrez, losango da cerca): a regra é só dos contínuos.
    expect(validateTexture('x', img, { size: 16, kind: 'opaque', material: 'modular' })).toEqual([]);
    // Manchas de 2 px não contam.
    const ok = solid(ramp('concreto')[3]!);
    createPaint(ok, 'teste').rect(3, 3, 2, 2, ramp('concreto')[2]!);
    expect(countCheckerWindows(ok)).toBe(0);
  });
});
