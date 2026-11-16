import { describe, expect, it } from 'vitest';
import { drawIconArt } from './icon-art.ts';

/** A cor (0xRRGGBB) do pixel no centro do bloco (bx, by) da grade 32×32. */
function blockColor(art: ReturnType<typeof drawIconArt>, bx: number, by: number): number {
  const cell = art.width / 32;
  const o = ((by * cell + cell / 2) * art.width + bx * cell + cell / 2) * 4;
  return (art.data[o]! << 16) | (art.data[o + 1]! << 8) | art.data[o + 2]!;
}

describe('arte do ícone (M4, fase 6a)', () => {
  it('512×512 opaco, sempre igual: fundo do menu, pele do bobo, capacete, olhos e a barra âmbar', () => {
    const art = drawIconArt(512);
    expect([art.width, art.height, art.data.length]).toEqual([512, 512, 512 * 512 * 4]);
    for (let i = 3; i < art.data.length; i += 4) if (art.data[i] !== 255) throw new Error('pixel transparente');
    expect(blockColor(art, 3, 3)).toBe(0x0a0d0b);
    expect(blockColor(art, 15, 18)).toBe(0xe5aa84);
    expect(blockColor(art, 15, 9)).toBe(0x556b3c);
    expect(blockColor(art, 12, 16)).toBe(0x1a1a1a);
    expect(blockColor(art, 15, 27)).toBe(0xf2b233);
    expect(drawIconArt(512).data).toEqual(art.data);
    expect(() => drawIconArt(500)).toThrow();
  });
});
