import { deflateSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildTestArena } from './arena.ts';
import { makeCell } from './cell.ts';
import { decodeGrid, encodeGrid, gridsEqual } from './codec.ts';
import { createWorldGrid } from './grid.ts';

describe('grade em RLE + deflate', () => {
  it('ida e volta da arena de teste, bem menor que a grade crua', () => {
    const arena = buildTestArena();
    const bytes = encodeGrid(arena.grid);
    const back = decodeGrid(bytes);
    expect(gridsEqual(arena.grid, back)).toBe(true);
    // 4 chunks materializados = 256 KB crus; RLE + deflate fica em poucos KB.
    expect(bytes.length).toBeLessThan(4096);
    expect(encodeGrid(back)).toEqual(bytes);
  });

  it('preserva chunk uniforme sem materializar e células com giro/inversão', () => {
    const grid = createWorldGrid(40, 40, 40);
    for (let y = 0; y < 32; y++) for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) grid.set(x, y, z, 3);
    grid.getChunk(0, 0, 0)!.cells = null;
    grid.getChunk(0, 0, 0)!.uniform = 3;
    grid.set(35, 35, 1, makeCell(7, 2, true));
    const back = decodeGrid(encodeGrid(grid));
    expect(gridsEqual(grid, back)).toBe(true);
    expect(back.getChunk(0, 0, 0)!.cells).toBeNull();
    expect(back.get(35, 35, 1)).toBe(makeCell(7, 2, true));
    expect(back.getChunk(1, 0, 0)).toBeNull();
  });

  it('não confia no cabeçalho: tamanho fora do teto, chunks demais, chunk repetido e zip bomb', () => {
    const header = (x: number, y: number, z: number, extra: number[] = []): Uint8Array =>
      deflateSync(
        new Uint8Array([0x42, 0x46, 0x47, 0x52, 1, x & 255, x >> 8, y & 255, y >> 8, z & 255, z >> 8, ...extra]),
      );
    // 12 bytes pedindo 8192×1024×8192 (antes: diretório de 2 milhões de chunks) e 65535³ (antes: RangeError do V8).
    expect(() => decodeGrid(header(8192, 1024, 8192, [0]))).toThrow(/teto do motor/);
    expect(() => decodeGrid(header(65535, 65535, 65535, [0]))).toThrow(/teto do motor/);
    expect(() => decodeGrid(header(0, 16, 16, [0]))).toThrow(/teto do motor/);
    // Grade de 1 chunk declarando 2.
    expect(() => decodeGrid(header(32, 32, 32, [2]))).toThrow(/não cabem/);
    // O mesmo chunk duas vezes (cada um 1 corrida de ar).
    const air = [0, 0, 0, 0, 0, 0, 1, 0, 0, 0x80, 0x80, 0x02];
    expect(() => decodeGrid(header(64, 32, 32, [2, ...air, ...air]))).toThrow(/repetido/);
    // 8 MB de zeros depois de um cabeçalho de grade 1×1×1: para no teto, sem descompactar tudo.
    const bomb = new Uint8Array(8 << 20);
    bomb.set([0x42, 0x46, 0x47, 0x52, 1, 1, 0, 1, 0, 1, 0, 0]);
    expect(() => decodeGrid(deflateSync(bomb))).toThrow(/maiores que a grade/);
  });

  it('recusa assinatura errada, versão maior e dados truncados', () => {
    expect(() => decodeGrid(deflateSync(new Uint8Array([1, 2, 3, 4, 1])))).toThrow(/assinatura/);
    expect(() => decodeGrid(deflateSync(new Uint8Array([0x42, 0x46, 0x47, 0x52, 9])))).toThrow(/versão/);
    expect(() => decodeGrid(deflateSync(new Uint8Array([0x42, 0x46, 0x47, 0x52, 1, 4])))).toThrow(/truncados/);
  });
});
